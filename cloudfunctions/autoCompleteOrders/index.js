const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const fs = require('fs')
const path = require('path')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MCHID = '1747444613'
const APPID = 'wxe030eaf6a9059fca'
const SERIAL_NO = '2CACD3222614672EA8F2B2366AB29C6A9FA4EBB6'
const TRANSFER_SCENE_ID = '1005'
const TRANSFER_API_PATH = '/v3/fund-app/mch-transfer/transfer-bills'
const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, 'apiclient_key.pem'), 'utf8')
const PAYOUT_AUTO_CONFIRM_HOURS = 24

function platformFeeRate(type) {
  return type === 'ad' ? 0.15 : 0.10
}

function resolvePlatformFeeRate(order = {}) {
  if (order.sport === '篮球') return 0
  return order.platformFeeRate !== undefined && order.platformFeeRate !== null
    ? Number(order.platformFeeRate) || 0
    : platformFeeRate(order.type)
}

const buildTransferReportInfos = (orderId) => ([
  { info_type: '岗位类型', info_content: '运动员' },
  { info_type: '报酬说明', info_content: `订单${String(orderId).slice(-8)}合作报酬` }
])

function normalizeTransferState(data = {}) {
  const state = data.state || data.transfer_state || ''
  if (state === 'WAIT_USER_CONFIRM' && data.package_info) {
    return { paymentStatus: 'release_pending', payoutStatus: 'wait_user_confirm' }
  }
  if (state === 'USER_CONFIRMED') {
    return { paymentStatus: 'released', payoutStatus: 'user_confirmed' }
  }
  if (['SUCCESS', 'FINISHED', 'TRANSFERRED'].includes(state)) {
    return { paymentStatus: 'released', payoutStatus: 'success' }
  }
  return { paymentStatus: 'released', payoutStatus: 'success' }
}

function autoConfirmAtFrom(dateLike) {
  const base = dateLike ? new Date(dateLike) : new Date()
  if (Number.isNaN(base.getTime())) return new Date(Date.now() + PAYOUT_AUTO_CONFIRM_HOURS * 60 * 60 * 1000)
  return new Date(base.getTime() + PAYOUT_AUTO_CONFIRM_HOURS * 60 * 60 * 1000)
}

function shouldAutoConfirmPayout(order, now) {
  if (order.status !== 'done' || order.payoutStatus !== 'wait_user_confirm') return false
  const raw = order.payoutAutoConfirmAt || (order.completedAt ? autoConfirmAtFrom(order.completedAt) : '')
  if (!raw) return false
  const date = new Date(raw)
  return !Number.isNaN(date.getTime()) && date <= now
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
    const auth = buildAuth(method, urlPath, body)
    const req = https.request({
      hostname: 'api.mch.weixin.qq.com',
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': auth, 'User-Agent': 'WechatPay-NodeJS' }
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

async function transferToAthlete(orderId, order) {
  const price = order.price || 0
  const feeRate = resolvePlatformFeeRate(order)
  const platformFee = Math.round(price * feeRate * 100) / 100
  const athleteAmount = Math.round((price - platformFee) * 100) / 100
  const amountFen = Math.round(athleteAmount * 100)
  if (amountFen <= 0) return { ok: true, data: { skipped: true, reason: 'amount <= 0' } }

  const outBillNo = ('PAY' + orderId).slice(0, 32)

  const ledger = await db.collection('funds_ledger').add({
    data: {
      type: 'payout',
      orderId,
      athleteOpenid: order.athleteOpenid,
      amount: price,
      platformFee,
      athleteAmount,
      wxOutBillNo: outBillNo,
      transferSceneId: TRANSFER_SCENE_ID,
      transferApiVersion: 'mch-transfer',
      status: 'pending',
      createdAt: db.serverDate()
    }
  })

  try {
    const transferBody = {
      appid: APPID,
      out_bill_no: outBillNo,
      transfer_scene_id: TRANSFER_SCENE_ID,
      openid: order.athleteOpenid,
      transfer_amount: amountFen,
      transfer_remark: 'Sportlight订单合作报酬',
      transfer_scene_report_infos: buildTransferReportInfos(orderId)
    }

    await db.collection('funds_ledger').doc(ledger._id).update({ data: { wxRequest: transferBody } })
    const result = await wxpayRequest('POST', TRANSFER_API_PATH, transferBody)

    if (result.status === 200 || result.status === 202) {
      await db.collection('funds_ledger').doc(ledger._id).update({
        data: {
          status: 'success',
          wxTransferBillNo: result.data.transfer_bill_no || '',
          wxState: result.data.state || '',
          wxPackageInfo: result.data.package_info || '',
          wxResponse: result.data
        }
      })
      return { ok: true, data: result.data }
    } else {
      console.error('auto transfer failed', result)
      await db.collection('funds_ledger').doc(ledger._id).update({ data: { status: 'failed', failReason: JSON.stringify(result.data) } })
      return { ok: false, data: result.data }
    }
  } catch (e) {
    await db.collection('funds_ledger').doc(ledger._id).update({ data: { status: 'failed', failReason: e.message } })
    return { ok: false, data: { message: e.message } }
  }
}

exports.main = async (event, context) => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  try {
    const res = await db.collection('orders')
      .where({ status: 'locked', athleteConfirmed: true, athleteConfirmedAt: _.lt(cutoff) })
      .get()

    const orders = res.data
    console.log(`自动结算：找到 ${orders.length} 个超时订单`)

    for (const order of orders) {
      try {
        const transferResult = await transferToAthlete(order._id, order)
        const transferState = transferResult.ok
          ? normalizeTransferState(transferResult.data || {})
          : { paymentStatus: 'release_failed', payoutStatus: 'failed' }

        await db.collection('orders').doc(order._id).update({
          data: {
            status: 'done',
            statusLabel: '已完成',
            paymentStatus: transferState.paymentStatus,
            payoutStatus: transferState.payoutStatus,
            payoutAutoConfirmAt: transferState.payoutStatus === 'wait_user_confirm' ? autoConfirmAtFrom(new Date()) : _.remove(),
            payoutError: transferResult.ok ? '' : JSON.stringify(transferResult.data || {}),
            autoCompleted: true,
            completedAt: db.serverDate(),
            newApplicantsCount: 0
          }
        })

        if (order.athleteOpenid) {
          const athleteRes = await db.collection('athletes').where({ openid: order.athleteOpenid }).limit(1).get()
          if (athleteRes.data.length > 0) {
            const cur = athleteRes.data[0].reputation || 80
            await db.collection('athletes').where({ openid: order.athleteOpenid }).update({ data: { reputation: Math.min(100, cur + 5) } })
          }
          await cloud.callFunction({ name: 'calcMarketValue', data: { athleteOpenid: order.athleteOpenid } })
        }

        await db.collection('messages').add({
          data: {
            orderId: order._id,
            fromOpenid: 'system',
            toOpenid: order.athleteOpenid,
            type: 'text',
            content: transferState.payoutStatus === 'wait_user_confirm'
              ? '⏰ 系统提示：确认完成已超过24小时，平台已自动发起打款。若你未手动确认收款，24小时后将自动确认。'
              : (transferResult.ok
                ? '⏰ 系统提示：确认完成已超过24小时，平台已自动结算此订单，款项将在1-3个工作日内到账。'
                : '⏰ 系统提示：确认完成已超过24小时，订单已自动完成，平台打款暂未成功，工作人员会尽快处理。'),
            createdAt: db.serverDate(),
            read: false
          }
        })
      } catch (e) {
        console.error(`自动结算订单 ${order._id} 失败`, e)
      }
    }

    const payoutRes = await db.collection('orders')
      .where({ status: 'done', payoutStatus: 'wait_user_confirm' })
      .limit(100)
      .get()
    const now = new Date()
    const duePayouts = (payoutRes.data || []).filter(order => shouldAutoConfirmPayout(order, now))
    for (const order of duePayouts) {
      try {
        await db.collection('orders').doc(order._id).update({
          data: {
            paymentStatus: 'released',
            payoutStatus: 'user_confirmed',
            payoutAutoConfirmedAt: db.serverDate(),
            payoutAutoConfirmAt: _.remove()
          }
        })
        const ledgerRes = await db.collection('funds_ledger')
          .where({ orderId: order._id, type: 'payout', status: 'success' })
          .limit(10)
          .get()
        await Promise.all((ledgerRes.data || []).map(item => db.collection('funds_ledger').doc(item._id).update({
          data: { status: 'user_confirmed', wxState: 'AUTO_CONFIRMED', autoConfirmedAt: db.serverDate() }
        })))
      } catch (e) {
        console.error(`自动确认收款 ${order._id} 失败`, e)
      }
    }

    return { code: 0, completed: orders.length, payoutAutoConfirmed: duePayouts.length }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
