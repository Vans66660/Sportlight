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

const PLAN = {
  id: 'boss_pro_monthly',
  name: '探照 Pro 月卡',
  amountFen: 2990,
  amount: 29.9,
  days: 30,
  dailyContactLimit: 30
}

async function ensureCollections() {
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection('pro_subscription_trades')
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
  return {
    authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${MCHID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${SERIAL_NO}",signature="${signature}"`,
    timestamp,
    nonce
  }
}

function wxpayRequest(method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : ''
    const { authorization } = buildAuth(method, urlPath, body)
    const req = https.request({
      hostname: 'api.mch.weixin.qq.com',
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': authorization,
        'User-Agent': 'WechatPay-NodeJS'
      }
    }, res => {
      let buf = ''
      res.on('data', c => { buf += c })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(buf) })
        } catch (e) {
          resolve({ status: res.statusCode, data: buf })
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function buildPayParams(prepayId) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = crypto.randomBytes(16).toString('hex')
  const signMsg = `${APPID}\n${timestamp}\n${nonce}\nprepay_id=${prepayId}\n`
  const s = crypto.createSign('RSA-SHA256')
  s.update(signMsg)
  const paySign = s.sign({ key: PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, 'base64')
  return { timeStamp: timestamp, nonceStr: nonce, package: `prepay_id=${prepayId}`, signType: 'RSA', paySign }
}

async function getViewer(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  return (res.data || [])[0] || null
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function normalizeUntil(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function calcNextUntil(currentUntil) {
  const now = new Date()
  const current = normalizeUntil(currentUntil)
  const base = current && current.getTime() > now.getTime() ? current : now
  return addDays(base, PLAN.days)
}

async function activatePro({ userDocId, bossOpenid, tradeNo, transaction }) {
  const userRes = await db.collection('users').doc(userDocId).get()
  const user = userRes.data || {}
  const nextUntil = calcNextUntil(user.scoutProUntil || user.vipUntil || user.proUntil)
  const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number'
    ? transaction.amount.total
    : PLAN.amountFen

  await db.collection('users').doc(userDocId).update({
    data: {
      scoutProUntil: nextUntil.toISOString(),
      proPlan: PLAN.id,
      proDailyContactLimit: PLAN.dailyContactLimit,
      proUpdatedAt: db.serverDate()
    }
  })

  await db.collection('funds_ledger').add({
    data: {
      type: 'pro_subscription_payment',
      bossOpenid,
      tradeNo,
      wxTransactionId: transaction.transaction_id || '',
      planId: PLAN.id,
      amount: paidAmountFen / 100,
      durationDays: PLAN.days,
      status: 'paid',
      createdAt: db.serverDate()
    }
  }).catch(() => {})

  return nextUntil
}

async function createPayment({ OPENID }) {
  await ensureCollections()
  const viewer = await getViewer(OPENID)
  if (!viewer) return { code: -1, msg: '请先注册主办方账号' }
  if (viewer.userType !== 'boss' && viewer.userType !== 'admin') return { code: -1, msg: '仅主办方可升级 Pro' }

  const tradeNo = `PRO${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32)
  await db.collection('pro_subscription_trades').add({
    data: {
      tradeNo,
      bossOpenid: OPENID,
      userDocId: viewer._id,
      planId: PLAN.id,
      planName: PLAN.name,
      amountFen: PLAN.amountFen,
      amount: PLAN.amount,
      durationDays: PLAN.days,
      dailyContactLimit: PLAN.dailyContactLimit,
      status: 'pending',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })

  const result = await wxpayRequest('POST', '/v3/pay/transactions/jsapi', {
    appid: APPID,
    mchid: MCHID,
    description: PLAN.name,
    out_trade_no: tradeNo,
    notify_url: NOTIFY_URL,
    amount: { total: PLAN.amountFen, currency: 'CNY' },
    payer: { openid: OPENID }
  })

  if (result.status !== 200 || !result.data.prepay_id) {
    await db.collection('pro_subscription_trades').where({ tradeNo }).update({
      data: {
        status: 'failed',
        failReason: JSON.stringify(result.data || {}),
        updatedAt: db.serverDate()
      }
    }).catch(() => {})
    return { code: -1, msg: '发起支付失败：' + ((result.data && result.data.message) || JSON.stringify(result.data || {})) }
  }

  return {
    code: 0,
    tradeNo,
    amount: PLAN.amount,
    plan: PLAN,
    payParams: buildPayParams(result.data.prepay_id)
  }
}

async function confirmPayment({ OPENID, tradeNo }) {
  await ensureCollections()
  if (!tradeNo) return { code: -1, msg: 'tradeNo 缺失' }

  const tradeRes = await db.collection('pro_subscription_trades').where({ tradeNo, bossOpenid: OPENID }).limit(1).get()
  const trade = (tradeRes.data || [])[0]
  if (!trade) return { code: -1, msg: '支付单不存在' }
  if (trade.status === 'paid') return { code: 0, activated: true, scoutProUntil: trade.scoutProUntil || '', msg: 'Pro 已开通' }

  const queryPath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(tradeNo)}?mchid=${MCHID}`
  const result = await wxpayRequest('GET', queryPath)
  if (result.status !== 200 || !result.data) return { code: 0, activated: false, msg: '支付尚未确认' }
  const transaction = result.data
  if (transaction.trade_state !== 'SUCCESS') return { code: 0, activated: false, msg: '支付尚未完成' }
  if (transaction.appid && transaction.appid !== APPID) return { code: -1, msg: 'appid 不匹配' }
  if (transaction.mchid && transaction.mchid !== MCHID) return { code: -1, msg: 'mchid 不匹配' }

  const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number' ? transaction.amount.total : 0
  if (paidAmountFen !== PLAN.amountFen) return { code: -1, msg: '支付金额不匹配' }

  const nextUntil = await activatePro({
    userDocId: trade.userDocId,
    bossOpenid: OPENID,
    tradeNo,
    transaction
  })

  await db.collection('pro_subscription_trades').doc(trade._id).update({
    data: {
      status: 'paid',
      wxTransactionId: transaction.transaction_id || '',
      paidAmountFen,
      scoutProUntil: nextUntil.toISOString(),
      paidAt: db.serverDate(),
      transaction,
      updatedAt: db.serverDate()
    }
  })

  return { code: 0, activated: true, scoutProUntil: nextUntil.toISOString(), msg: 'Pro 已开通' }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action = 'create', tradeNo = '' } = event || {}
  if (!OPENID) return { code: -1, msg: '请先登录' }

  try {
    if (action === 'confirm') return await confirmPayment({ OPENID, tradeNo })
    return await createPayment({ OPENID })
  } catch (e) {
    return { code: -1, msg: e.message || JSON.stringify(e) }
  }
}
