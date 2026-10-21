const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const API_V3_KEY = process.env.WXPAY_API_V3_KEY || ''
const APPID = 'wxe030eaf6a9059fca'
const MCHID = '1747444613'

function platformFeeRate(type) {
  return type === 'ad' ? 0.15 : 0.10
}

function resolvePlatformFeeRate(order = {}) {
  if (order.sport === '篮球') return 0
  return order.platformFeeRate !== undefined && order.platformFeeRate !== null
    ? Number(order.platformFeeRate) || 0
    : platformFeeRate(order.type)
}

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

const OK = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'SUCCESS', message: '成功' }) }
const FAIL = (msg) => ({ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'FAIL', message: msg }) })

function scoutUnlockId(bossOpenid, athleteOpenid) {
  return `${bossOpenid}_${athleteOpenid}`.replace(/[^\w-]/g, '_')
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function normalizeUntil(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function calcNextProUntil(currentUntil, durationDays) {
  const now = new Date()
  const current = normalizeUntil(currentUntil)
  const base = current && current.getTime() > now.getTime() ? current : now
  return addDays(base, Number(durationDays) || 30)
}

async function handleProSubscriptionPayment({ tradeNo, transaction, wxTransactionId }) {
  let trade = null
  try {
    const tradeRes = await db.collection('pro_subscription_trades').where({ tradeNo }).limit(1).get()
    trade = tradeRes.data[0] || null
  } catch (e) {}
  if (!trade) return null

  const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number'
    ? transaction.amount.total
    : null
  const expectedAmountFen = Number(trade.amountFen) || 2990
  if (paidAmountFen !== expectedAmountFen) {
    await db.collection('pro_subscription_trades').doc(trade._id).update({
      data: {
        status: 'amount_mismatch',
        expectedAmountFen,
        paidAmountFen,
        wxTransactionId,
        transaction,
        updatedAt: db.serverDate()
      }
    }).catch(() => {})
    return FAIL('Pro 支付金额不匹配')
  }

  if (trade.status === 'paid') return OK

  const userDocId = trade.userDocId || ''
  let user = null
  if (userDocId) {
    user = await db.collection('users').doc(userDocId).get().then(res => res.data).catch(() => null)
  }
  if (!user) {
    const userRes = await db.collection('users').where({ openid: trade.bossOpenid }).limit(1).get()
    user = (userRes.data || [])[0] || null
  }
  if (!user || !user._id) return FAIL('未找到 Pro 用户')

  const durationDays = Number(trade.durationDays) || 30
  const dailyLimit = Number(trade.dailyContactLimit) || 30
  const nextUntil = calcNextProUntil(user.scoutProUntil || user.vipUntil || user.proUntil, durationDays)

  await db.collection('users').doc(user._id).update({
    data: {
      scoutProUntil: nextUntil.toISOString(),
      proPlan: trade.planId || 'boss_pro_monthly',
      proDailyContactLimit: dailyLimit,
      proUpdatedAt: db.serverDate()
    }
  })

  await db.collection('pro_subscription_trades').doc(trade._id).update({
    data: {
      status: 'paid',
      wxTransactionId,
      paidAmountFen,
      scoutProUntil: nextUntil.toISOString(),
      paidAt: db.serverDate(),
      transaction,
      updatedAt: db.serverDate()
    }
  })

  await db.collection('funds_ledger').add({
    data: {
      type: 'pro_subscription_payment',
      bossOpenid: trade.bossOpenid,
      tradeNo,
      wxTransactionId,
      planId: trade.planId || 'boss_pro_monthly',
      amount: paidAmountFen / 100,
      durationDays,
      status: 'paid',
      createdAt: db.serverDate()
    }
  }).catch(() => {})

  return OK
}

async function handleScoutReportPayment({ tradeNo, transaction, wxTransactionId }) {
  let trade = null
  try {
    const tradeRes = await db.collection('scout_report_trades').where({ tradeNo }).limit(1).get()
    trade = tradeRes.data[0] || null
  } catch (e) {}
  if (!trade) return null

  const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number'
    ? transaction.amount.total
    : null
  const expectedAmountFen = Number(trade.amountFen) || 690
  if (paidAmountFen !== expectedAmountFen) {
    await db.collection('scout_report_trades').doc(trade._id).update({
      data: {
        status: 'amount_mismatch',
        expectedAmountFen,
        paidAmountFen,
        wxTransactionId,
        transaction,
        updatedAt: db.serverDate()
      }
    }).catch(() => {})
    return FAIL('球探报告支付金额不匹配')
  }

  if (trade.status === 'paid') return OK

  await db.collection('scout_report_trades').doc(trade._id).update({
    data: {
      status: 'paid',
      wxTransactionId,
      paidAmountFen,
      paidAt: db.serverDate(),
      transaction,
      updatedAt: db.serverDate()
    }
  })

  await db.collection('scout_report_unlocks').doc(scoutUnlockId(trade.bossOpenid, trade.athleteOpenid)).set({
    data: {
      bossOpenid: trade.bossOpenid,
      athleteOpenid: trade.athleteOpenid,
      tradeNo,
      status: 'unlocked',
      amountFen: paidAmountFen,
      amount: paidAmountFen / 100,
      wxTransactionId,
      unlockedAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })

  await db.collection('funds_ledger').add({
    data: {
      type: 'scout_report_payment',
      bossOpenid: trade.bossOpenid,
      athleteOpenid: trade.athleteOpenid,
      amount: paidAmountFen / 100,
      tradeNo,
      wxTransactionId,
      status: 'paid',
      createdAt: db.serverDate()
    }
  }).catch(() => {})

  return OK
}

exports.main = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' }

  try {
    const notification = JSON.parse(event.body || '{}')

    if (notification.event_type !== 'TRANSACTION.SUCCESS') return OK

    const { ciphertext, nonce, associated_data } = notification.resource
    const transaction = decryptResource(ciphertext, nonce, associated_data)

    const tradeNo = transaction.out_trade_no
    const wxTransactionId = transaction.transaction_id
    if (transaction.trade_state && transaction.trade_state !== 'SUCCESS') return OK
    if (transaction.appid && transaction.appid !== APPID) return FAIL('appid 不匹配')
    if (transaction.mchid && transaction.mchid !== MCHID) return FAIL('mchid 不匹配')

    const proResult = await handleProSubscriptionPayment({ tradeNo, transaction, wxTransactionId })
    if (proResult) return proResult

    const scoutResult = await handleScoutReportPayment({ tradeNo, transaction, wxTransactionId })
    if (scoutResult) return scoutResult

    let trade = null
    try {
      const tradeRes = await db.collection('order_payment_trades').where({ tradeNo }).limit(1).get()
      trade = tradeRes.data[0] || null
    } catch (e) {}

    const orderRes = trade
      ? await db.collection('orders').doc(trade.orderId).get()
      : await db.collection('orders').where({ lastTradeNo: tradeNo }).limit(1).get()
    const order = trade ? orderRes.data : orderRes.data[0]
    if (!order || !order._id) return FAIL('未找到对应订单')
    const orderId = order._id

    const expectedAmountFen = trade ? trade.amountFen : Math.max(1, Math.round((order.price || 0) * 100))
    const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number'
      ? transaction.amount.total
      : null
    if (paidAmountFen !== expectedAmountFen) {
      if (trade && trade._id) {
        await db.collection('order_payment_trades').doc(trade._id).update({
          data: { status: 'amount_mismatch', expectedAmountFen, paidAmountFen, wxTransactionId, transaction, updatedAt: db.serverDate() }
        }).catch(() => {})
      }
      return FAIL('支付金额不匹配')
    }

    if (trade && trade.status === 'paid') return OK

    if (order.status !== 'open') {
      if (trade && trade._id) {
        await db.collection('order_payment_trades').doc(trade._id).update({
          data: { status: 'paid_order_unavailable', wxTransactionId, paidAmountFen, transaction, failReason: '订单已锁单或已结束', updatedAt: db.serverDate() }
        }).catch(() => {})
      }
      return OK
    }

    const athleteOpenid = trade ? trade.athleteOpenid : order.pendingAthleteOpenid
    if (!athleteOpenid) return FAIL('缺少待合作运动员')
    const price = order.price || 0
    const feeRate = trade && trade.feeRate !== undefined && trade.feeRate !== null ? Number(trade.feeRate) : resolvePlatformFeeRate(order)
    const platformFee = trade && trade.platformFee !== undefined && trade.platformFee !== null ? Number(trade.platformFee) : Math.round(price * feeRate * 100) / 100
    const athleteAmount = trade && trade.athleteAmount !== undefined && trade.athleteAmount !== null ? Number(trade.athleteAmount) : Math.round((price - platformFee) * 100) / 100

    await db.collection('orders').doc(orderId).update({
      data: {
        status: 'locked',
        statusLabel: '进行中',
        paymentStatus: 'escrowed',
        athleteOpenid,
        athleteGet: athleteAmount,
        platformFee,
        platformFeeRate: feeRate,
        basketballPricingVersion: order.basketballPricingVersion || '',
        basketballSettlement: order.basketballSettlement || {},
        guaranteedAppearanceFee: Number((order.basketballSettlement || {}).guaranteedAppearanceFee) || 0,
        performanceBonus: Number((order.basketballSettlement || {}).performanceBonus) || 0,
        paidAmountFen,
        pendingAthleteOpenid: _.remove(),
        lockedAt: db.serverDate(),
        wxTransactionId
      }
    })

    if (trade && trade._id) {
      await db.collection('order_payment_trades').doc(trade._id).update({
        data: {
          status: 'paid',
          wxTransactionId,
          paidAmountFen,
          paidAt: db.serverDate(),
          transaction,
          updatedAt: db.serverDate()
        }
      }).catch(() => {})
    }

    await db.collection('funds_ledger').add({
      data: {
        type: 'payment',
        orderId,
        bossOpenid: order.bossOpenid,
        athleteOpenid,
        amount: price,
        platformFee,
        athleteAmount,
        tradeNo,
        wxTransactionId,
        status: 'success',
        createdAt: db.serverDate()
      }
    })

    const tips = ['期待我们的合作，一起创造佳绩！💪', '你的实力打动了我，加油！🔥', '相信你能带来精彩表现，期待合作！⚡', '选你，因为你值得。加油！🏆']
    const msgContent = '🎉 恭喜你通过挑选！' + tips[Math.floor(Math.random() * tips.length)]

    await Promise.all([
      cloud.callFunction({
        name: 'sendImportantNotice',
        data: {
          internalChannel: 'message',
          orderId,
          fromOpenid: order.bossOpenid,
          toOpenid: athleteOpenid,
          category: 'order',
          priority: 'urgent',
          actionRequired: true,
          noticeType: 'athlete_selected',
          templateType: 'order',
          externalPush: true,
          page: `/pages/order-detail/order-detail?id=${orderId}`,
          messageType: 'order_card',
          title: '你已通过挑选',
          content: msgContent,
          orderSnapshot: { title: order.title, type: order.type, price: order.price, city: order.city, date: order.date }
        }
      }).catch(() => db.collection('messages').add({
        data: {
          orderId,
          fromOpenid: order.bossOpenid,
          toOpenid: athleteOpenid,
          type: 'order_card',
          content: msgContent,
          orderSnapshot: { title: order.title, type: order.type, price: order.price, city: order.city, date: order.date },
          createdAt: db.serverDate(),
          read: false
        }
      })),
      db.collection('conversations').doc(orderId).set({
        data: {
          orderId,
          bossOpenid: order.bossOpenid,
          athleteOpenid,
          status: 'locked',
          lastMsg: msgContent,
          lastMsgTime: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
    ])

    return OK
  } catch (e) {
    console.error('paymentNotify error', e)
    return FAIL(e.message)
  }
}
