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
const REPORT_PRICE_FEN = 690
const REPORT_PRICE = REPORT_PRICE_FEN / 100

function unlockId(bossOpenid, athleteOpenid) {
  return `${bossOpenid}_${athleteOpenid}`.replace(/[^\w-]/g, '_')
}

async function ensureCollections() {
  if (typeof db.createCollection !== 'function') return
  for (const name of ['scout_report_trades', 'scout_report_unlocks']) {
    try {
      await db.createCollection(name)
    } catch (err) {
      if (!String((err && (err.message || err.errMsg)) || '').includes('exist')) throw err
    }
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

async function getViewer(OPENID) {
  const res = await db.collection('users').where({ openid: OPENID }).field({ userType: true, name: true, displayName: true }).limit(1).get()
  return (res.data || [])[0] || null
}

async function getAthlete(athleteOpenid) {
  const res = await db.collection('athletes').where({ openid: athleteOpenid }).field({ openid: true, name: true, nickname: true, displayName: true, sportlightId: true }).limit(1).get()
  return (res.data || [])[0] || null
}

async function hasUnlocked(bossOpenid, athleteOpenid) {
  const res = await db.collection('scout_report_unlocks').doc(unlockId(bossOpenid, athleteOpenid)).get().catch(() => ({ data: null }))
  return !!(res.data && res.data.status === 'unlocked')
}

async function markUnlocked({ bossOpenid, athleteOpenid, tradeNo, transaction }) {
  const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number'
    ? transaction.amount.total
    : REPORT_PRICE_FEN
  await db.collection('scout_report_unlocks').doc(unlockId(bossOpenid, athleteOpenid)).set({
    data: {
      bossOpenid,
      athleteOpenid,
      tradeNo,
      status: 'unlocked',
      amountFen: paidAmountFen,
      amount: paidAmountFen / 100,
      wxTransactionId: transaction.transaction_id || '',
      unlockedAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })
  await db.collection('funds_ledger').add({
    data: {
      type: 'scout_report_payment',
      bossOpenid,
      athleteOpenid,
      tradeNo,
      wxTransactionId: transaction.transaction_id || '',
      amount: paidAmountFen / 100,
      status: 'paid',
      createdAt: db.serverDate()
    }
  }).catch(() => {})
}

async function createPayment({ OPENID, athleteOpenid }) {
  await ensureCollections()
  const [viewer, athlete] = await Promise.all([getViewer(OPENID), getAthlete(athleteOpenid)])
  if (!viewer || (viewer.userType !== 'boss' && viewer.userType !== 'admin')) return { code: -1, msg: '仅老板可解锁球探报告' }
  if (!athlete) return { code: -1, msg: '运动员不存在' }
  if (athleteOpenid === OPENID) return { code: -1, msg: '不能解锁自己的报告' }
  if (await hasUnlocked(OPENID, athleteOpenid)) return { code: 0, unlocked: true, msg: '已解锁' }

  const tradeNo = `SR${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32)
  await db.collection('scout_report_trades').add({
    data: {
      tradeNo,
      bossOpenid: OPENID,
      athleteOpenid,
      amountFen: REPORT_PRICE_FEN,
      amount: REPORT_PRICE,
      status: 'pending',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })

  const name = athlete.displayName || athlete.nickname || athlete.name || '球员'
  const result = await wxpayRequest('POST', '/v3/pay/transactions/jsapi', {
    appid: APPID,
    mchid: MCHID,
    description: `球探报告-${String(name).slice(0, 20)}`,
    out_trade_no: tradeNo,
    notify_url: NOTIFY_URL,
    amount: { total: REPORT_PRICE_FEN, currency: 'CNY' },
    payer: { openid: OPENID }
  })

  if (result.status !== 200 || !result.data.prepay_id) {
    await db.collection('scout_report_trades').where({ tradeNo }).update({
      data: {
        status: 'failed',
        failReason: JSON.stringify(result.data || {}),
        updatedAt: db.serverDate()
      }
    }).catch(() => {})
    return { code: -1, msg: '发起支付失败：' + ((result.data && result.data.message) || JSON.stringify(result.data || {})) }
  }

  return { code: 0, tradeNo, amount: REPORT_PRICE, payParams: buildPayParams(result.data.prepay_id) }
}

async function confirmPayment({ OPENID, athleteOpenid, tradeNo }) {
  await ensureCollections()
  if (!tradeNo) return { code: -1, msg: 'tradeNo 缺失' }
  const tradeRes = await db.collection('scout_report_trades').where({ tradeNo, bossOpenid: OPENID, athleteOpenid }).limit(1).get()
  const trade = (tradeRes.data || [])[0]
  if (!trade) return { code: -1, msg: '支付单不存在' }
  if (trade.status === 'paid' || await hasUnlocked(OPENID, athleteOpenid)) return { code: 0, unlocked: true, msg: '报告已解锁' }

  const queryPath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(tradeNo)}?mchid=${MCHID}`
  const result = await wxpayRequest('GET', queryPath)
  if (result.status !== 200 || !result.data) return { code: 0, unlocked: false, msg: '支付尚未确认' }
  const transaction = result.data
  if (transaction.trade_state !== 'SUCCESS') return { code: 0, unlocked: false, msg: '支付尚未完成' }
  if (transaction.appid && transaction.appid !== APPID) return { code: -1, msg: 'appid 不匹配' }
  if (transaction.mchid && transaction.mchid !== MCHID) return { code: -1, msg: 'mchid 不匹配' }
  const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number' ? transaction.amount.total : 0
  if (paidAmountFen !== REPORT_PRICE_FEN) return { code: -1, msg: '支付金额不匹配' }

  await db.collection('scout_report_trades').doc(trade._id).update({
    data: {
      status: 'paid',
      wxTransactionId: transaction.transaction_id || '',
      paidAmountFen,
      paidAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })
  await markUnlocked({ bossOpenid: OPENID, athleteOpenid, tradeNo, transaction })
  return { code: 0, unlocked: true, msg: '报告已解锁' }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action = 'create', athleteOpenid = '', tradeNo = '' } = event || {}
  if (!OPENID) return { code: -1, msg: '请先登录' }
  if (!athleteOpenid) return { code: -1, msg: '运动员参数缺失' }

  try {
    if (action === 'confirm') return await confirmPayment({ OPENID, athleteOpenid, tradeNo })
    return await createPayment({ OPENID, athleteOpenid })
  } catch (e) {
    return { code: -1, msg: e.message || JSON.stringify(e) }
  }
}
