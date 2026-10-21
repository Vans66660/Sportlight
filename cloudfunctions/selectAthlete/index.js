const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const fs = require('fs')
const path = require('path')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MCHID = '1747444613'
const APPID = 'wxe030eaf6a9059fca'
const SERIAL_NO = '2CACD3222614672EA8F2B2366AB29C6A9FA4EBB6'
const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, 'apiclient_key.pem'), 'utf8')
const NOTIFY_URL = 'https://cloud1-d1gc37qacf1fd1eee-1432153437.ap-shanghai.app.tcloudbase.com/paymentNotify'

function platformFeeRate(type) {
  return type === 'ad' ? 0.15 : 0.10
}

function resolvePlatformFeeRate(order = {}) {
  if (order.sport === '篮球') return 0
  return order.platformFeeRate !== undefined && order.platformFeeRate !== null
    ? Number(order.platformFeeRate) || 0
    : platformFeeRate(order.type)
}

async function ensureTradesCollection() {
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection('order_payment_trades')
  } catch (err) {
    if (!String((err && (err.message || err.errMsg)) || '').includes('exist')) throw err
  }
}

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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { orderId, athleteOpenid } = event

  if (!orderId) return { code: -1, msg: 'orderId 缺失' }
  if (!athleteOpenid) return { code: -1, msg: 'athleteOpenid 缺失' }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data

    if (order.bossOpenid !== OPENID) return { code: -1, msg: '无权操作' }
    if (order.status !== 'open') return { code: -1, msg: '订单已锁单或已完成，无法重新选人' }

    const price = Number(order.price) || 0
    const amountFen = Math.max(1, Math.round(price * 100))
    const feeRate = resolvePlatformFeeRate(order)
    const platformFee = Math.round(price * feeRate * 100) / 100
    const athleteAmount = Math.round((price - platformFee) * 100) / 100

    let basketballSettlement = null
    if (order.sport === '篮球') {
      const athleteRes = await db.collection('athletes').where({ openid: athleteOpenid }).field({ currentTier: true, competitionScore: true, guaranteedAppearanceFee: true, performanceBonus: true, marketValue: true }).limit(1).get()
      const athlete = (athleteRes.data || [])[0] || {}
      basketballSettlement = {
        pricingVersion: 'basketball-bounty-v1',
        tier: athlete.currentTier || athlete.rank || 'D',
        competitionScore: Number(athlete.competitionScore) || 0,
        guaranteedAppearanceFee: Number(athlete.guaranteedAppearanceFee) || 0,
        performanceBonus: Number(athlete.performanceBonus) || 0,
        maxAmount: Number(athlete.marketValue) || 0
      }
    }

    const tradeNo = `OR${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32)
    await ensureTradesCollection()
    await db.collection('order_payment_trades').add({
      data: {
        tradeNo,
        orderId,
        bossOpenid: OPENID,
        athleteOpenid,
        amountFen,
        amount: price,
        feeRate,
        platformFee,
        athleteAmount,
        status: 'pending',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })

    // 仅作页面兼容展示；支付回调以 order_payment_trades 为准。
    await db.collection('orders').doc(orderId).update({
      data: { pendingAthleteOpenid: athleteOpenid, lastTradeNo: tradeNo, ...(basketballSettlement ? { basketballPricingVersion: 'basketball-bounty-v1', basketballSettlement } : {}) }
    })

    const payBody = {
      appid: APPID,
      mchid: MCHID,
      description: order.title || '球匠坊订单',
      out_trade_no: tradeNo,
      notify_url: NOTIFY_URL,
      amount: { total: amountFen, currency: 'CNY' },
      payer: { openid: OPENID }
    }

    const result = await wxpayRequest('POST', '/v3/pay/transactions/jsapi', payBody)

    if (result.status !== 200 || !result.data.prepay_id) {
      console.error('统一下单失败', result)
      await db.collection('order_payment_trades').where({ tradeNo }).update({
        data: { status: 'failed', failReason: JSON.stringify(result.data || {}), updatedAt: db.serverDate() }
      }).catch(() => {})
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
    return { code: -1, msg: e.message || JSON.stringify(e) }
  }
}
