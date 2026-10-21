const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const fs = require('fs')
const path = require('path')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MCHID = process.env.WXPAY_MCHID || '1747444613'
const APPID = process.env.WXPAY_APPID || 'wxe030eaf6a9059fca'
const SERIAL_NO = process.env.WXPAY_SERIAL_NO || '2CACD3222614672EA8F2B2366AB29C6A9FA4EBB6'
const NOTIFY_URL = process.env.EVENT_PAYMENT_NOTIFY_URL || 'https://cloud1-d1gc37qacf1fd1eee-1432153437.ap-shanghai.app.tcloudbase.com/eventPaymentNotify'
const PRIVATE_KEY = (process.env.WXPAY_PRIVATE_KEY || fs.readFileSync(path.join(__dirname, 'apiclient_key.pem'), 'utf8')).replace(/\\n/g, '\n')
const PLATFORM_EVENT_PAYMENT_ENABLED = false

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
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(buf) }) } catch (e) { resolve({ status: res.statusCode, data: buf }) } })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function markPaid({ registrationId, reg, trade, post, transaction }) {
  const wxTransactionId = transaction.transaction_id || ''
  const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number'
    ? transaction.amount.total
    : (trade.amountFen || Math.max(1, Math.round((post.entryFee || 0) * 100)))

  await db.collection('event_registrations').doc(registrationId).update({
    data: {
      paymentStatus: 'paid',
      paidAt: db.serverDate(),
      wxTransactionId,
      paidConfirmSource: 'wxpay_query'
    }
  })

  if (trade._id) {
    await db.collection('event_payment_trades').doc(trade._id).update({
      data: {
        status: 'paid',
        wxTransactionId,
        paidAmountFen,
        paidAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    }).catch(e => console.error("eventPayment: 支付回调更新失败", e))
  }

  const newTeamCount = (post.registeredTeams || 0) + 1
  const postUpdate = { registeredTeams: _.inc(1) }
  if (post.maxTeams && newTeamCount >= post.maxTeams) {
    postUpdate.eventStatus = 'full'
  }
  await db.collection('posts').doc(reg.postId).update({ data: postUpdate })

  await db.collection('funds_ledger').add({
    data: {
      type: 'event_payment',
      registrationId,
      postId: reg.postId,
      captainOpenid: reg.captainOpenid,
      bossOpenid: post.openid,
      amount: post.entryFee || 0,
      wxTransactionId,
      status: 'escrowed',
      createdAt: db.serverDate()
    }
  }).catch(e => console.error("eventPayment: 支付回调更新失败", e))
}

async function confirmPaidByQuery({ registrationId, reg }) {
  if (reg.paymentStatus === 'paid' || reg.paymentStatus === 'free') {
    return { code: 0, confirmed: true, msg: '已确认付款' }
  }
  if (reg.status !== 'approved' || reg.paymentStatus !== 'unpaid' || !reg.lastTradeNo) {
    return { code: 0, confirmed: false, msg: '暂无可确认的支付订单' }
  }

  const [postRes, tradeRes] = await Promise.all([
    db.collection('posts').doc(reg.postId).get(),
    db.collection('event_payment_trades')
      .where({ tradeNo: reg.lastTradeNo, registrationId })
      .limit(1)
      .get()
  ])
  const post = postRes.data
  const trade = tradeRes.data[0]
  if (!trade) return { code: 0, confirmed: false, msg: '暂无可确认的支付订单' }

  const tradeNo = encodeURIComponent(reg.lastTradeNo)
  const queryPath = `/v3/pay/transactions/out-trade-no/${tradeNo}?mchid=${MCHID}`
  const result = await wxpayRequest('GET', queryPath)
  if (result.status !== 200 || !result.data) {
    return { code: 0, confirmed: false, msg: '支付尚未确认' }
  }
  const transaction = result.data
  if (transaction.trade_state !== 'SUCCESS') {
    return { code: 0, confirmed: false, msg: '支付尚未完成' }
  }
  if (transaction.appid && transaction.appid !== APPID) return { code: -1, msg: 'appid 不匹配' }
  if (transaction.mchid && transaction.mchid !== MCHID) return { code: -1, msg: 'mchid 不匹配' }

  const expectedAmountFen = trade.amountFen || Math.max(1, Math.round((post.entryFee || 0) * 100))
  const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number'
    ? transaction.amount.total
    : null
  if (paidAmountFen !== expectedAmountFen) return { code: -1, msg: '支付金额不匹配' }

  await markPaid({ registrationId, reg, trade, post, transaction })
  return { code: 0, confirmed: true, msg: '付款已确认' }
}

exports.main = async (event, context) => {
  if (!PLATFORM_EVENT_PAYMENT_ENABLED) {
    return { code: -1, msg: '当前版本报名费由主办方自收，无需平台支付' }
  }

  const { OPENID } = cloud.getWXContext()
  const { registrationId, action } = event

  if (!registrationId) return { code: -1, msg: 'registrationId 缺失' }

  try {
    const regRes = await db.collection('event_registrations').doc(registrationId).get()
    const reg = regRes.data

    if (action === 'confirm') {
      if (reg.captainOpenid !== OPENID) {
        const [postRes, userRes] = await Promise.all([
          db.collection('posts').doc(reg.postId).get(),
          db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
        ])
        const post = postRes.data
        const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
        if (post.openid !== OPENID && !isAdmin) return { code: -1, msg: '无权操作' }
      }
      return await confirmPaidByQuery({ registrationId, reg })
    }
    if (reg.captainOpenid !== OPENID) return { code: -1, msg: '无权操作' }
    if (reg.status !== 'approved') return { code: -1, msg: '报名尚未审核通过' }
    if (reg.paymentStatus === 'paid') return { code: -1, msg: '已付款，无需重复支付' }
    if (reg.paymentStatus !== 'unpaid') return { code: -1, msg: '该报名无需支付' }
    if (reg.paymentDeadline && new Date(reg.paymentDeadline) < new Date()) {
      await db.collection('event_registrations').doc(registrationId).update({
        data: { status: 'expired', expiredAt: db.serverDate() }
      })
      return { code: -1, msg: '付款已超时，名额已释放，请重新报名' }
    }

    const postRes = await db.collection('posts').doc(reg.postId).get()
    const post = postRes.data
    if (post.eventStatus === 'closed') return { code: -1, msg: '报名已关闭' }
    if (post.maxTeams && (post.registeredTeams || 0) >= post.maxTeams) {
      await db.collection('event_registrations').doc(registrationId).update({
        data: { status: 'expired', expiredAt: db.serverDate() }
      })
      return { code: -1, msg: '名额已满，无法继续支付' }
    }
    const amountFen = Math.max(1, Math.round((post.entryFee || 0) * 100))

    const tradeNo = crypto.randomBytes(8).toString('hex')
    await Promise.all([
      db.collection('event_registrations').doc(registrationId).update({
        data: { lastTradeNo: tradeNo }
      }),
      db.collection('event_payment_trades').add({
        data: {
          tradeNo,
          registrationId,
          postId: reg.postId,
          captainOpenid: OPENID,
          amountFen,
          amount: post.entryFee || 0,
          status: 'pending',
          createdAt: db.serverDate()
        }
      })
    ])

    const result = await wxpayRequest('POST', '/v3/pay/transactions/jsapi', {
      appid: APPID,
      mchid: MCHID,
      description: `报名费 - ${post.title || post.content?.slice(0, 20) || '赛事'}`,
      out_trade_no: tradeNo,
      notify_url: NOTIFY_URL,
      amount: { total: amountFen, currency: 'CNY' },
      payer: { openid: OPENID }
    })

    if (result.status !== 200 || !result.data.prepay_id) {
      console.error('统一下单失败', result)
      return { code: -1, msg: '发起支付失败：' + (result.data.message || JSON.stringify(result.data)) }
    }

    const prepayId = result.data.prepay_id
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = crypto.randomBytes(16).toString('hex')
    const signMsg = `${APPID}\n${timestamp}\n${nonce}\nprepay_id=${prepayId}\n`
    const s = crypto.createSign('RSA-SHA256')
    s.update(signMsg)
    const paySign = s.sign({ key: PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, 'base64')

    return {
      code: 0,
      payParams: { timeStamp: timestamp, nonceStr: nonce, package: `prepay_id=${prepayId}`, signType: 'RSA', paySign }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
