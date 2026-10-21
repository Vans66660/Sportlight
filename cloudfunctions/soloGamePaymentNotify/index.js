const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const API_V3_KEY = process.env.WXPAY_API_V3_KEY || ''
const APPID = process.env.WXPAY_APPID || 'wxe030eaf6a9059fca'
const MCHID = process.env.WXPAY_MCHID || '1747444613'
const PLATFORM_PUBLIC_KEY = (process.env.WXPAY_PLATFORM_PUBLIC_KEY || '').replace(/\\n/g, '\n')

function decryptResource(ciphertext, nonce, associatedData) {
  const key = Buffer.from(API_V3_KEY, 'utf8')
  const buf = Buffer.from(ciphertext, 'base64')
  const authTag = buf.slice(-16)
  const data = buf.slice(0, -16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'))
  decipher.setAuthTag(authTag)
  decipher.setAAD(Buffer.from(associatedData || '', 'utf8'))
  return JSON.parse(decipher.update(data, undefined, 'utf8') + decipher.final('utf8'))
}

function deadlineMs(game) {
  const value = new Date(`${game.deadlineDate || game.date || ''} ${game.deadlineTime || game.startTime || '00:00'}`).getTime()
  return Number.isFinite(value) ? value : 0
}

function validateJoinable(game, openid) {
  if (!game._id || game.status === 'cancelled' || game.paymentMethod !== 'aa') return '球局不可报名'
  if (deadlineMs(game) <= Date.now()) return '已过报名截止时间'
  const participants = game.participants || []
  if (participants.some(p => p.openid === openid)) return ''
  if (participants.length >= Number(game.maxPlayers || 0)) return '人数已满'
  return ''
}

function validatePrivatePayable(game, openid) {
  if (!game._id || game.paymentMethod !== 'private') return '不是包场订单'
  if (game.creatorOpenid !== openid) return '只有包场人可以支付包场费'
  if (game.status === 'privateBooked') return '包场已支付'
  if (game.status === 'cancelled') return '球局已取消'
  return ''
}

function headerValue(headers, key) {
  const target = key.toLowerCase()
  const found = Object.keys(headers || {}).find(item => item.toLowerCase() === target)
  return found ? headers[found] : ''
}

function verifySignature(event) {
  if (!PLATFORM_PUBLIC_KEY) return true
  const headers = event.headers || {}
  const timestamp = headerValue(headers, 'Wechatpay-Timestamp')
  const nonce = headerValue(headers, 'Wechatpay-Nonce')
  const signature = headerValue(headers, 'Wechatpay-Signature')
  if (!timestamp || !nonce || !signature) return false
  const body = event.rawBody || event.body || ''
  const message = `${timestamp}\n${nonce}\n${body}\n`
  const verify = crypto.createVerify('RSA-SHA256')
  verify.update(message)
  return verify.verify(PLATFORM_PUBLIC_KEY, signature, 'base64')
}

async function getAthlete(openid) {
  const res = await db.collection('athletes').where({ openid }).limit(1).get()
  return res.data[0] || {}
}

const OK = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'SUCCESS', message: '成功' }) }
const FAIL = (msg) => ({ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'FAIL', message: msg }) })

exports.main = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' }

  try {
    if (!verifySignature(event)) return FAIL('微信支付回调签名验证失败')
    const notification = JSON.parse(event.body || '{}')
    if (notification.event_type !== 'TRANSACTION.SUCCESS') return OK

    const { ciphertext, nonce, associated_data } = notification.resource
    const transaction = decryptResource(ciphertext, nonce, associated_data)
    if (transaction.trade_state && transaction.trade_state !== 'SUCCESS') return OK
    if (transaction.appid && transaction.appid !== APPID) return FAIL('appid 不匹配')
    if (transaction.mchid && transaction.mchid !== MCHID) return FAIL('mchid 不匹配')

    const tradeNo = transaction.out_trade_no
    const wxTransactionId = transaction.transaction_id
    const tradeRes = await db.collection('solo_game_payment_trades').where({ tradeNo }).limit(1).get()
    const trade = tradeRes.data[0]
    if (!trade) return FAIL('未找到对应支付单')
    if (trade.status === 'paid' || trade.status === 'refunded') return OK

    const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number'
      ? transaction.amount.total
      : null
    if (paidAmountFen !== trade.amountFen) {
      await db.collection('solo_game_payment_trades').doc(trade._id).update({
        data: { status: 'amount_mismatch', paidAmountFen, wxTransactionId, transaction, updatedAt: db.serverDate() }
      }).catch(e => console.error("soloGamePaymentNotify: 支付回调更新失败", e))
      return FAIL('支付金额不匹配')
    }

    if (trade.tradeType === 'private_booking') {
      const result = await db.runTransaction(async transactionDb => {
        const gameRes = await transactionDb.collection('soloGames').doc(trade.gameId).get()
        const game = gameRes.data || {}
        const invalid = validatePrivatePayable(game, trade.openid)
        if (invalid && invalid !== '包场已支付') {
          await transactionDb.collection('solo_game_payment_trades').doc(trade._id).update({
            data: { status: 'paid_join_failed', failReason: invalid, wxTransactionId, paidAmountFen, transaction, updatedAt: db.serverDate() }
          })
          return { paid: false, reason: invalid }
        }
        const participants = (game.participants || []).map(item => item.openid === trade.openid
          ? { ...item, paid: true, paymentStatus: 'paid_private', tradeNo, wxTransactionId, paidAmountFen }
          : item)
        await transactionDb.collection('soloGames').doc(trade.gameId).update({
          data: { status: 'privateBooked', participants, privatePaymentStatus: 'paid', updatedAt: db.serverDate() }
        })
        await transactionDb.collection('solo_game_payment_trades').doc(trade._id).update({
          data: { status: 'paid', wxTransactionId, paidAmountFen, paidAt: db.serverDate(), transaction, updatedAt: db.serverDate() }
        })
        return { paid: true }
      })

      if (result.paid) {
        await db.collection('venueBookings').where({ sourceId: trade.gameId }).update({
          data: { status: 'locked', paymentStatus: 'paid', amount: trade.amount || paidAmountFen / 100, amountFen: paidAmountFen, paidAt: db.serverDate(), updatedAt: db.serverDate() }
        }).catch(e => console.error("soloGamePaymentNotify: 支付回调更新失败", e))
        await db.collection('funds_ledger').add({
          data: {
            type: 'solo_private_booking_payment',
            gameId: trade.gameId,
            openid: trade.openid,
            tradeNo,
            amount: trade.amount || paidAmountFen / 100,
            wxTransactionId,
            status: 'escrowed',
            createdAt: db.serverDate()
          }
        }).catch(e => console.error("soloGamePaymentNotify: 支付回调更新失败", e))
      }
      return OK
    }

    const athlete = await getAthlete(trade.openid)
    const participant = {
      openid: trade.openid,
      name: athlete.name || '球员',
      avatar: athlete.photo || '',
      competitionScore: Number(athlete.competitionScore) || 0,
      joinedAt: db.serverDate(),
      paid: true,
      paymentStatus: 'paid',
      tradeNo,
      wxTransactionId,
      paidAmountFen
    }

    const result = await db.runTransaction(async transactionDb => {
      const gameRes = await transactionDb.collection('soloGames').doc(trade.gameId).get()
      const game = gameRes.data || {}
      const invalid = validateJoinable(game, trade.openid)
      if (invalid) {
        await transactionDb.collection('solo_game_payment_trades').doc(trade._id).update({
          data: { status: 'paid_join_failed', failReason: invalid, wxTransactionId, paidAmountFen, transaction, updatedAt: db.serverDate() }
        })
        return { joined: false, reason: invalid }
      }
      if (!(game.participants || []).some(p => p.openid === trade.openid)) {
        await transactionDb.collection('soloGames').doc(trade.gameId).update({
          data: { participants: db.command.push(participant), updatedAt: db.serverDate() }
        })
      }
      await transactionDb.collection('solo_game_payment_trades').doc(trade._id).update({
        data: { status: 'paid', wxTransactionId, paidAmountFen, paidAt: db.serverDate(), transaction, updatedAt: db.serverDate() }
      })
      return { joined: true }
    })

    if (result.joined) {
      await db.collection('venueBookings').where({ sourceId: trade.gameId }).update({
        data: {
          participants: db.command.push(participant),
          paymentStatus: 'partial',
          amount: db.command.inc(trade.amount || 0),
          amountFen: db.command.inc(paidAmountFen),
          updatedAt: db.serverDate()
        }
      }).catch(e => console.error("soloGamePaymentNotify: 支付回调更新失败", e))
      await db.collection('funds_ledger').add({
        data: {
          type: 'solo_game_payment',
          gameId: trade.gameId,
          openid: trade.openid,
          tradeNo,
          amount: trade.amount || 0,
          wxTransactionId,
          status: 'escrowed',
          createdAt: db.serverDate()
        }
      }).catch(e => console.error("soloGamePaymentNotify: 支付回调更新失败", e))
    }

    return OK
  } catch (e) {
    console.error('soloGamePaymentNotify error', e)
    return FAIL(e.message)
  }
}
