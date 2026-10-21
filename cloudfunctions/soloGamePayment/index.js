const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const fs = require('fs')
const path = require('path')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MCHID = process.env.WXPAY_MCHID || '1747444613'
const APPID = process.env.WXPAY_APPID || 'wxe030eaf6a9059fca'
const SERIAL_NO = process.env.WXPAY_SERIAL_NO || '2CACD3222614672EA8F2B2366AB29C6A9FA4EBB6'
const NOTIFY_URL = process.env.SOLO_GAME_NOTIFY_URL || 'https://cloud1-d1gc37qacf1fd1eee-1432153437.ap-shanghai.app.tcloudbase.com/soloGamePaymentNotify'
const PRIVATE_KEY = (process.env.WXPAY_PRIVATE_KEY || fs.readFileSync(path.join(__dirname, 'apiclient_key.pem'), 'utf8')).replace(/\\n/g, '\n')

function buildAuth(method, urlPath, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = crypto.randomBytes(16).toString('hex')
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(message)
  const signature = sign.sign({ key: PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, 'base64')
  return { authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${MCHID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${SERIAL_NO}",signature="${signature}"`, timestamp, nonce }
}

function wxpayRequest(method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : ''
    const { authorization } = buildAuth(method, urlPath, body)
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

function isMissingCollection(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

function deadlineMs(game) {
  const value = new Date(`${game.deadlineDate || game.date || ''} ${game.deadlineTime || game.startTime || '00:00'}`).getTime()
  return Number.isFinite(value) ? value : 0
}

function amountFen(game) {
  if (game.paymentMethod === 'private') return Math.max(0, Math.round((Number(game.privateAmount) || 0) * 100))
  return Math.max(0, Math.round((Number(game.aaPricePerPerson || game.pricePerPerson) || 0) * 100))
}

function buildPayParams(prepayId) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = crypto.randomBytes(16).toString('hex')
  const signMsg = `${APPID}\n${timestamp}\n${nonce}\nprepay_id=${prepayId}\n`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(signMsg)
  const paySign = sign.sign({ key: PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, 'base64')
  return { timeStamp: timestamp, nonceStr: nonce, package: `prepay_id=${prepayId}`, signType: 'RSA', paySign }
}

async function getAthlete(openid) {
  const res = await db.collection('athletes').where({ openid }).limit(1).get()
  return res.data[0] || {}
}

function validateJoinable(game, openid) {
  if (!game._id || game.status === 'cancelled' || game.paymentMethod !== 'aa') return '球局不可报名'
  if (deadlineMs(game) <= Date.now()) return '已过报名截止时间'
  const participants = game.participants || []
  if (participants.some(p => p.openid === openid)) return '你已报名'
  if (participants.length >= Number(game.maxPlayers || 0)) return '人数已满'
  if (amountFen(game) <= 0) return '该场地未配置散客价格'
  return ''
}

function validatePrivatePayable(game, openid) {
  if (!game._id || game.paymentMethod !== 'private') return '不是包场订单'
  if (game.creatorOpenid !== openid) return '只有包场人可以支付包场费'
  if (game.status === 'privateBooked') return '包场已支付'
  if (game.status === 'cancelled') return '球局已取消'
  if (amountFen(game) <= 0) return '该场地未配置包场价格'
  return ''
}

async function ensureTradesCollection() {
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection('solo_game_payment_trades')
  } catch (err) {
    if (!String((err && (err.message || err.errMsg)) || '').includes('exist')) throw err
  }
}

async function createPayment({ gameId, openid }) {
  const gameRes = await db.collection('soloGames').doc(gameId).get()
  const game = gameRes.data || {}
  const isPrivatePay = game.paymentMethod === 'private'
  const invalid = isPrivatePay ? validatePrivatePayable(game, openid) : validateJoinable(game, openid)
  if (invalid) return { code: -1, msg: invalid }

  const fen = amountFen(game)
  const tradeNo = `SG${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32)
  await ensureTradesCollection()
  await db.collection('solo_game_payment_trades').add({
    data: {
      tradeNo,
      gameId,
      openid,
      tradeType: isPrivatePay ? 'private_booking' : 'solo_join',
      amountFen: fen,
      amount: fen / 100,
      status: 'pending',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })

  const result = await wxpayRequest('POST', '/v3/pay/transactions/jsapi', {
    appid: APPID,
    mchid: MCHID,
    description: `${isPrivatePay ? '包场' : '散客组局AA'} - ${game.venueName || 'Sportlight'}`,
    out_trade_no: tradeNo,
    notify_url: NOTIFY_URL,
    amount: { total: fen, currency: 'CNY' },
    payer: { openid }
  })

  if (result.status !== 200 || !result.data.prepay_id) {
    await db.collection('solo_game_payment_trades').where({ tradeNo }).update({
      data: { status: 'failed', failReason: JSON.stringify(result.data || {}), updatedAt: db.serverDate() }
    }).catch(e => console.error("soloGamePayment: 支付记录更新失败", e))
    return { code: -1, msg: '发起支付失败：' + ((result.data && result.data.message) || JSON.stringify(result.data)) }
  }

  return { code: 0, tradeNo, amount: fen / 100, payParams: buildPayParams(result.data.prepay_id) }
}

async function refundTrade({ trade, gameId, openid, reason }) {
  const refundNo = `SGR${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32)
  const result = await wxpayRequest('POST', '/v3/refund/domestic/refunds', {
    out_trade_no: trade.tradeNo,
    out_refund_no: refundNo,
    reason: reason || '取消散客组局报名',
    amount: { refund: trade.amountFen, total: trade.amountFen, currency: 'CNY' }
  })

  if (result.status !== 200) {
    await db.collection('solo_game_payment_trades').doc(trade._id).update({
      data: { refundStatus: 'failed', refundFailReason: JSON.stringify(result.data || {}), updatedAt: db.serverDate() }
    }).catch(e => console.error("soloGamePayment: 支付记录更新失败", e))
    return { code: -1, msg: '退款发起失败，请联系平台处理' }
  }

  await db.collection('soloGames').doc(gameId).get().then(res => {
    const game = res.data || {}
    const participants = (game.participants || []).filter(p => p.openid !== openid)
    db.collection('venueBookings').where({ sourceId: gameId }).update({
      data: {
        participants,
        amount: db.command.inc(-(trade.amount || 0)),
        amountFen: db.command.inc(-(trade.amountFen || 0)),
        updatedAt: db.serverDate()
      }
    }).catch(e => console.error("soloGamePayment: 支付记录更新失败", e))
    return db.collection('soloGames').doc(gameId).update({ data: { participants, updatedAt: db.serverDate() } })
  })

  await db.collection('solo_game_payment_trades').doc(trade._id).update({
    data: {
      status: 'refunded',
      refundStatus: 'success',
      refundNo,
      wxRefundId: result.data.refund_id || '',
      refundedAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  }).catch(e => console.error("soloGamePayment: 支付记录更新失败", e))

  await db.collection('funds_ledger').add({
    data: {
      type: 'solo_game_refund',
      gameId,
      openid,
      tradeNo: trade.tradeNo,
      refundNo,
      amount: trade.amount || 0,
      status: 'success',
      createdAt: db.serverDate()
    }
  }).catch(e => console.error("soloGamePayment: 支付记录更新失败", e))

  return { code: 0, msg: '已取消报名，退款将原路退回' }
}

async function confirmPayment({ gameId, tradeNo, openid }) {
  const tradeRes = await db.collection('solo_game_payment_trades').where({ gameId, tradeNo, openid }).limit(1).get()
  const trade = tradeRes.data[0]
  if (!trade) return { code: -1, msg: '支付单不存在' }
  if (trade.status === 'paid') return { code: 0, msg: '报名成功' }
  if (trade.status === 'refunded') return { code: -1, msg: '该支付单已退款' }

  const result = await wxpayRequest('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(tradeNo)}?mchid=${MCHID}`)
  if (result.status !== 200 || !result.data || result.data.trade_state !== 'SUCCESS') return { code: -1, msg: '支付尚未确认' }
  const transaction = result.data
  const paidFen = transaction.amount && typeof transaction.amount.total === 'number' ? transaction.amount.total : 0
  if (paidFen !== trade.amountFen) return { code: -1, msg: '支付金额不匹配' }

  if (trade.tradeType === 'private_booking') {
    const txResult = await db.runTransaction(async transactionDb => {
      const gameRes = await transactionDb.collection('soloGames').doc(gameId).get()
      const game = gameRes.data || {}
      const invalid = validatePrivatePayable(game, openid)
      if (invalid && invalid !== '包场已支付') return { code: -1, msg: invalid }
      const participants = (game.participants || []).map(item => item.openid === openid
        ? { ...item, paid: true, paymentStatus: 'paid_private', tradeNo, wxTransactionId: transaction.transaction_id || '', paidAmountFen: paidFen }
        : item)
      await transactionDb.collection('soloGames').doc(gameId).update({
        data: { status: 'privateBooked', participants, privatePaymentStatus: 'paid', updatedAt: db.serverDate() }
      })
      await transactionDb.collection('solo_game_payment_trades').doc(trade._id).update({
        data: {
          status: 'paid',
          wxTransactionId: transaction.transaction_id || '',
          paidAmountFen: paidFen,
          paidAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      return { code: 0, msg: '包场成功' }
    })
    if (txResult.code === 0) {
      await db.collection('venueBookings').where({ sourceId: gameId }).update({
        data: {
          status: 'locked',
          paymentStatus: 'paid',
          amount: trade.amount || paidFen / 100,
          amountFen: paidFen,
          paidAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      }).catch(e => console.error("soloGamePayment: 支付记录更新失败", e))
      await db.collection('funds_ledger').add({
        data: {
          type: 'solo_private_booking_payment',
          gameId,
          openid,
          tradeNo,
          amount: trade.amount || paidFen / 100,
          wxTransactionId: transaction.transaction_id || '',
          status: 'escrowed',
          createdAt: db.serverDate()
        }
      }).catch(e => console.error("soloGamePayment: 支付记录更新失败", e))
    }
    return txResult
  }

  const athlete = await getAthlete(openid)
  const participant = {
    openid,
    name: athlete.name || '球员',
    avatar: athlete.photo || '',
    competitionScore: Number(athlete.competitionScore) || 0,
    joinedAt: db.serverDate(),
    paid: true,
    paymentStatus: 'paid',
    tradeNo,
    wxTransactionId: transaction.transaction_id || '',
    paidAmountFen: paidFen
  }

  const txResult = await db.runTransaction(async transactionDb => {
    const gameRes = await transactionDb.collection('soloGames').doc(gameId).get()
    const game = gameRes.data || {}
    if ((game.participants || []).some(p => p.openid === openid)) {
      await transactionDb.collection('solo_game_payment_trades').doc(trade._id).update({
        data: {
          status: 'paid',
          wxTransactionId: participant.wxTransactionId,
          paidAmountFen: paidFen,
          paidAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      return { code: 0, msg: '报名成功' }
    }
    const invalid = validateJoinable(game, openid)
    if (invalid) return { code: -1, msg: invalid, shouldRefund: invalid === '人数已满' || invalid === '已过报名截止时间' }

    await transactionDb.collection('soloGames').doc(gameId).update({
      data: { participants: db.command.push(participant), updatedAt: db.serverDate() }
    })
    await transactionDb.collection('solo_game_payment_trades').doc(trade._id).update({
      data: {
        status: 'paid',
        wxTransactionId: participant.wxTransactionId,
        paidAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    return { code: 0, msg: '报名成功' }
  })

  if (txResult.code !== 0 && txResult.shouldRefund) {
    await refundTrade({ trade: { ...trade, status: 'paid' }, gameId, openid, reason: txResult.msg })
    return { code: -1, msg: `${txResult.msg}，款项已发起原路退款` }
  }

  if (txResult.code === 0) {
    await db.collection('venueBookings').where({ sourceId: gameId }).update({
      data: {
        participants: db.command.push(participant),
        paymentStatus: 'partial',
        amount: db.command.inc(trade.amount || 0),
        amountFen: db.command.inc(paidFen),
        updatedAt: db.serverDate()
      }
    }).catch(e => console.error("soloGamePayment: 支付记录更新失败", e))
    await db.collection('funds_ledger').add({
      data: {
        type: 'solo_game_payment',
        gameId,
        openid,
        tradeNo,
        amount: trade.amount || 0,
        wxTransactionId: participant.wxTransactionId,
        status: 'escrowed',
        createdAt: db.serverDate()
      }
    }).catch(e => console.error("soloGamePayment: 支付记录更新失败", e))
  }

  return txResult
}

async function refundPayment({ gameId, openid }) {
  const gameRes = await db.collection('soloGames').doc(gameId).get()
  const game = gameRes.data || {}
  if (!game._id) return { code: -1, msg: '球局不存在' }
  if (deadlineMs(game) <= Date.now()) return { code: -1, msg: '已过报名截止时间，无法退款' }

  const participant = (game.participants || []).find(p => p.openid === openid)
  if (!participant) return { code: -1, msg: '你未报名该球局' }
  if (!participant.tradeNo) return { code: -1, msg: '该报名没有平台支付单' }

  const tradeRes = await db.collection('solo_game_payment_trades').where({ gameId, tradeNo: participant.tradeNo, openid }).limit(1).get()
  const trade = tradeRes.data[0]
  if (!trade || trade.status !== 'paid') return { code: -1, msg: '支付单状态不可退款' }
  return await refundTrade({ trade, gameId, openid, reason: '用户截止前取消报名' })
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action, gameId, tradeNo } = event || {}
  if (!gameId) return { code: -1, msg: '缺少球局ID' }

  try {
    if (action === 'create') return await createPayment({ gameId, openid: OPENID })
    if (action === 'confirm') return await confirmPayment({ gameId, tradeNo, openid: OPENID })
    if (action === 'refund') return await refundPayment({ gameId, openid: OPENID })
    return { code: -1, msg: '无效操作' }
  } catch (e) {
    if (isMissingCollection(e)) return { code: -1, msg: '支付记录不存在' }
    return { code: -1, msg: e.message }
  }
}
