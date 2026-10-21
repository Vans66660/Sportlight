const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MCHID = process.env.WXPAY_MCHID || ''
const SERIAL_NO = process.env.WXPAY_SERIAL_NO || ''
const PRIVATE_KEY = (process.env.WXPAY_PRIVATE_KEY || '').replace(/\\n/g, '\n')

function isMissingCollection(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

function parseMs(date, time) {
  const value = new Date(`${date || ''} ${time || '00:00'}`).getTime()
  return Number.isFinite(value) ? value : 0
}

function minutesAgo(dateLike) {
  const raw = dateLike && typeof dateLike.toDate === 'function' ? dateLike.toDate() : dateLike
  const time = raw instanceof Date ? raw.getTime() : new Date(raw || 0).getTime()
  if (!Number.isFinite(time)) return 0
  return (Date.now() - time) / 60000
}

async function addNotification(openid, content, data = {}) {
  if (!openid) return
  await db.collection('notifications').add({
    data: {
      fromOpenid: 'system',
      toOpenid: openid,
      type: data.type || 'venue_booking',
      content,
      ...data,
      read: false,
      createdAt: db.serverDate()
    }
  }).catch(() => {})
}

async function updateGame(sourceId, data) {
  if (!sourceId) return
  await db.collection('soloGames').doc(sourceId).update({ data: { ...data, updatedAt: db.serverDate() } }).catch(() => {})
}

function wxpayReady() {
  return MCHID && SERIAL_NO && PRIVATE_KEY
}

function buildAuth(method, urlPath, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = crypto.randomBytes(16).toString('hex')
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(message)
  const signature = sign.sign({ key: PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, 'base64')
  return `WECHATPAY2-SHA256-RSA2048 mchid="${MCHID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${SERIAL_NO}",signature="${signature}"`
}

function wxpayRequest(method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : ''
    const authorization = buildAuth(method, urlPath, body)
    const req = https.request({
      hostname: 'api.mch.weixin.qq.com',
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': authorization, 'User-Agent': 'WechatPay-NodeJS' }
    }, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }) } catch (e) { resolve({ status: res.statusCode, data: buf }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function refundPaidTrades(gameId, reason) {
  const tradeRes = await db.collection('solo_game_payment_trades')
    .where({ gameId, status: 'paid' })
    .limit(100)
    .get()
    .catch(() => ({ data: [] }))
  const trades = tradeRes.data || []
  let refunded = 0
  let pending = 0
  for (const trade of trades) {
    if (!wxpayReady()) {
      await db.collection('solo_game_payment_trades').doc(trade._id).update({
        data: { refundStatus: 'pending_manual', refundReason: reason, updatedAt: db.serverDate() }
      }).catch(() => {})
      pending += 1
      continue
    }
    const refundNo = `SGA${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32)
    const result = await wxpayRequest('POST', '/v3/refund/domestic/refunds', {
      out_trade_no: trade.tradeNo,
      out_refund_no: refundNo,
      reason,
      amount: { refund: trade.amountFen, total: trade.amountFen, currency: 'CNY' }
    }).catch(e => ({ status: 0, data: { message: e.message } }))
    if (result.status === 200) {
      await db.collection('solo_game_payment_trades').doc(trade._id).update({
        data: { status: 'refunded', refundStatus: 'success', refundNo, wxRefundId: result.data.refund_id || '', refundedAt: db.serverDate(), updatedAt: db.serverDate() }
      }).catch(() => {})
      refunded += 1
    } else {
      await db.collection('solo_game_payment_trades').doc(trade._id).update({
        data: { refundStatus: 'pending_manual', refundFailReason: JSON.stringify(result.data || {}), updatedAt: db.serverDate() }
      }).catch(() => {})
      pending += 1
    }
  }
  return { refunded, pending }
}

exports.main = async () => {
  const now = Date.now()
  const result = { released: 0, cancelled: 0, started: 0, awaitingConfirm: 0 }

  try {
    const res = await db.collection('venueBookings')
      .where({ status: _.in(['pending_payment', 'open', 'formed', 'locked', 'in_progress']) })
      .limit(300)
      .get()

    for (const booking of (res.data || [])) {
      const startAt = parseMs(booking.date, booking.startTime)
      const endAt = parseMs(booking.date, booking.endTime)
      const deadlineAt = parseMs(booking.deadlineDate || booking.date, booking.deadlineTime || booking.startTime)
      const participants = booking.participants || []
      const isPrivate = booking.paymentMethod === 'private' || booking.sourceType === 'private_booking'

      if (booking.status === 'pending_payment' && minutesAgo(booking.createdAt) >= 15) {
        await db.collection('venueBookings').doc(booking._id).update({
          data: { status: 'cancelled', cancelReason: '支付超时自动释放', updatedAt: db.serverDate() }
        })
        await updateGame(booking.sourceId, { status: 'cancelled', cancelReason: '支付超时自动释放' })
        await addNotification(booking.creatorOpenid, `你在「${booking.venueName || '球馆'}」的包场订单因超过15分钟未支付，场地已自动释放。`, { gameId: booking.sourceId })
        result.released += 1
        continue
      }

      if (!isPrivate && ['open', 'formed'].includes(booking.status) && deadlineAt && now >= deadlineAt && participants.length < Number(booking.minPlayers || 0)) {
        const refundResult = await refundPaidTrades(booking.sourceId, '散客组局人数不足自动取消')
        await db.collection('venueBookings').doc(booking._id).update({
          data: {
            status: 'cancelled',
            paymentStatus: refundResult.pending > 0 ? 'refund_pending' : 'refunded',
            cancelReason: '人数不足自动取消',
            refundResult,
            updatedAt: db.serverDate()
          }
        })
        await updateGame(booking.sourceId, { status: 'cancelled', cancelReason: '人数不足自动取消' })
        await Promise.all(participants.map(p => addNotification(p.openid, `你报名的「${booking.venueName || '球馆'}」散客组局因人数不足已自动取消。${refundResult.pending > 0 ? '退款已进入人工处理。' : '已支付款项会原路退回。'}`, { gameId: booking.sourceId })))
        result.cancelled += 1
        continue
      }

      if (['formed', 'locked'].includes(booking.status) && startAt && now >= startAt && (!endAt || now < endAt)) {
        await db.collection('venueBookings').doc(booking._id).update({
          data: { status: 'in_progress', startedAt: db.serverDate(), updatedAt: db.serverDate() }
        })
        await updateGame(booking.sourceId, { status: 'in_progress' })
        result.started += 1
        continue
      }

      if (booking.status === 'in_progress' && endAt && now >= endAt) {
        await db.collection('venueBookings').doc(booking._id).update({
          data: { status: 'awaiting_confirm', awaitingConfirmAt: db.serverDate(), updatedAt: db.serverDate() }
        })
        await updateGame(booking.sourceId, { status: 'awaiting_confirm' })
        result.awaitingConfirm += 1
      }
    }

    return { code: 0, data: result }
  } catch (e) {
    if (isMissingCollection(e)) return { code: 0, data: result, msg: 'venueBookings 不存在' }
    return { code: -1, msg: e.message }
  }
}
