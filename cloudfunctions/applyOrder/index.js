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

const clampRep = (current, delta) => Math.max(0, Math.min(100, (current || 80) + delta))

const conductDelta = (punctuality, communication) => {
  const p = { good: 2, ok: 0, bad: -3 }[punctuality] ?? 1
  const c = { good: 1, ok: 0, bad: -2 }[communication] ?? 0
  return p + c
}

const ratingDelta = (rating) => [0, -5, -2, 0, 1, 3][rating] || 0

const BASKETBALL_EXIT_TYPES = ['normal', 'injury', 'tactical_low_minutes', 'unauthorized_leave']

function isBasketballOrder(order = {}) {
  return order.sport === '篮球'
}

function usesBasketballSettlement(order = {}) {
  const settlement = order.basketballSettlement || {}
  const guaranteedAppearanceFee = Number(order.guaranteedAppearanceFee || settlement.guaranteedAppearanceFee)
  const performanceBonus = Number(order.performanceBonus || settlement.performanceBonus)
  return isBasketballOrder(order) &&
    order.basketballPricingVersion === 'basketball-bounty-v1' &&
    guaranteedAppearanceFee > 0 && performanceBonus > 0
}

function addWorkingDays(date, days) {
  const result = new Date(date)
  let remaining = Math.max(0, Number(days) || 0)
  while (remaining > 0) {
    result.setDate(result.getDate() + 1)
    const day = result.getDay()
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return result
}

function compact(data) {
  const out = {}
  Object.keys(data).forEach(key => {
    if (data[key] !== undefined) out[key] = data[key]
  })
  return out
}

const buildTransferReportInfos = (orderId) => ([
  { info_type: '岗位类型', info_content: '运动员' },
  { info_type: '报酬说明', info_content: `订单${String(orderId).slice(-8)}合作报酬` }
])

function normalizeTransferState(data = {}) {
  const state = data.state || data.transfer_state || ''
  const hasConfirmPackage = !!data.package_info
  if (state === 'WAIT_USER_CONFIRM' && hasConfirmPackage) {
    return { paymentStatus: 'release_pending', payoutStatus: 'wait_user_confirm', label: '待确认收款' }
  }
  if (['SUCCESS', 'FINISHED', 'TRANSFERRED'].includes(state)) {
    return { paymentStatus: 'released', payoutStatus: 'success', label: '已到账' }
  }
  if (state === 'USER_CONFIRMED') {
    return { paymentStatus: 'released', payoutStatus: 'user_confirmed', label: '已确认收款' }
  }
  if (['FAIL', 'FAILED', 'CANCELLED'].includes(state)) {
    return { paymentStatus: 'release_failed', payoutStatus: 'failed', label: '打款失败' }
  }
  return { paymentStatus: 'release_pending', payoutStatus: 'processing', label: '打款处理中' }
}

function autoConfirmAtFrom(dateLike) {
  const base = dateLike ? new Date(dateLike) : new Date()
  if (Number.isNaN(base.getTime())) return new Date(Date.now() + PAYOUT_AUTO_CONFIRM_HOURS * 60 * 60 * 1000)
  return new Date(base.getTime() + PAYOUT_AUTO_CONFIRM_HOURS * 60 * 60 * 1000)
}

const normalizeEvaluation = (evaluation = {}, order = {}) => {
  const rating = Number(evaluation.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, msg: '请给球员选择 1-5 星评分' }
  }

  const data = {
    ok: true,
    data: {
      punctuality: ['good', 'ok', 'bad'].includes(evaluation.punctuality) ? evaluation.punctuality : 'good',
      communication: ['good', 'ok', 'bad'].includes(evaluation.communication) ? evaluation.communication : 'good',
      contentQuality: ['good', 'ok', 'bad'].includes(evaluation.contentQuality) ? evaluation.contentQuality : 'good',
      rating,
      comment: String(evaluation.comment || '').trim().slice(0, 120)
    }
  }
  if (!usesBasketballSettlement(order)) return data

  const exitType = BASKETBALL_EXIT_TYPES.includes(evaluation.exitType) ? evaluation.exitType : 'normal'
  const playerPoints = Number(evaluation.playerPoints)
  const teamResult = evaluation.teamResult
  if (exitType !== 'unauthorized_leave') {
    if (evaluation.playerPoints === '' || evaluation.playerPoints === null || evaluation.playerPoints === undefined || !Number.isInteger(playerPoints) || playerPoints < 0) return { ok: false, msg: '请填写球员本场实际得分' }
    if (!['win', 'loss'].includes(teamResult)) return { ok: false, msg: '请选择本场胜负结果' }
  }
  data.data.exitType = exitType
  data.data.playerPoints = exitType === 'unauthorized_leave' ? 0 : playerPoints
  data.data.teamResult = exitType === 'unauthorized_leave' ? '' : teamResult
  return data
}

function calculateBasketballSettlement(order = {}, evaluation = {}) {
  const escrowAmount = Math.max(0, Number(order.price) || 0)
  const configuredBase = Number(order.guaranteedAppearanceFee || (order.basketballSettlement || {}).guaranteedAppearanceFee)
  const configuredBonus = Number(order.performanceBonus || (order.basketballSettlement || {}).performanceBonus)
  // 发布页接入固定档位前，旧订单仍可安全结算：整笔托管款视为保底，不会多打款。
  const guaranteedAppearanceFee = Math.min(escrowAmount, Number.isFinite(configuredBase) && configuredBase > 0 ? configuredBase : escrowAmount)
  const performanceBonus = Math.max(0, Math.min(
    Math.max(0, escrowAmount - guaranteedAppearanceFee),
    Number.isFinite(configuredBonus) && configuredBonus > 0 ? configuredBonus : 0
  ))
  const exitType = evaluation.exitType || 'normal'
  if (exitType === 'unauthorized_leave') {
    return {
      exitType,
      guaranteedAppearanceFee: 0,
      performanceBonus,
      winBonus: 0,
      scoreBonus: 0,
      payoutAmount: 0,
      refundAmount: escrowAmount,
      reputationDelta: -30,
      label: '未经允许提前离场/擅自罢赛'
    }
  }
  const points = Math.max(0, Number(evaluation.playerPoints) || 0)
  const scoreRate = points >= 20 ? 1 : (points >= 10 ? 0.5 : 0)
  const winBonus = evaluation.teamResult === 'win' ? performanceBonus * 0.7 : 0
  const scoreBonus = performanceBonus * 0.3 * scoreRate
  const payoutAmount = Math.min(escrowAmount, Math.round((guaranteedAppearanceFee + winBonus + scoreBonus) * 100) / 100)
  return {
    exitType,
    guaranteedAppearanceFee,
    performanceBonus,
    winBonus: Math.round(winBonus * 100) / 100,
    scoreBonus: Math.round(scoreBonus * 100) / 100,
    payoutAmount,
    refundAmount: Math.round((escrowAmount - payoutAmount) * 100) / 100,
    reputationDelta: 0,
    label: exitType === 'injury' ? '因公受伤退场' : (exitType === 'tactical_low_minutes' ? '雇主战术导致出场时间少' : '正常完赛')
  }
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

async function addOptional(collectionName, data, label) {
  try {
    return await db.collection(collectionName).add({ data })
  } catch (e) {
    console.error(`${label || collectionName} add failed`, e)
    return null
  }
}

async function sendImportantMessage(payload) {
  const messageData = {
    orderId: payload.orderId || '',
    fromOpenid: payload.fromOpenid || 'system',
    toOpenid: payload.toOpenid,
    type: payload.messageType || 'text',
    content: payload.content,
    orderSnapshot: payload.orderSnapshot,
    createdAt: db.serverDate(),
    read: false
  }
  try {
    return await cloud.callFunction({
      name: 'sendImportantNotice',
      data: {
        ...payload,
        internalChannel: 'message',
        externalPush: payload.externalPush !== false,
        page: payload.page || (payload.orderId ? `/pages/order-detail/order-detail?id=${payload.orderId}` : ''),
        templateType: payload.templateType || payload.category || 'order'
      }
    })
  } catch (e) {
    console.error('sendImportantNotice failed, fallback to messages', e)
    return await addOptional('messages', compact(messageData), 'important message fallback')
  }
}

async function updateOptional(collectionName, id, data, label) {
  if (!id) return
  try {
    await db.collection(collectionName).doc(id).update({ data })
  } catch (e) {
    console.error(`${label || collectionName} update failed`, e)
  }
}

async function transferToAthlete(orderId, order, options = {}) {
  const price = order.price || 0
  const feeRate = resolvePlatformFeeRate(order)
  const platformFee = Math.round(price * feeRate * 100) / 100
  const defaultAthleteAmount = Math.round((price - platformFee) * 100) / 100
  const athleteAmount = options.athleteAmount === undefined
    ? defaultAthleteAmount
    : Math.max(0, Math.min(defaultAthleteAmount, Math.round(Number(options.athleteAmount) * 100) / 100))
  const amountFen = Math.round(athleteAmount * 100)
  if (amountFen <= 0) return { ok: true, data: { skipped: true, reason: 'amount <= 0' } }

  const outBillNo = (options.outBillNo || ('PAY' + orderId)).slice(0, 32)

  const ledger = await addOptional('funds_ledger', {
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
  }, 'payout ledger')

  try {
    const transferBody = {
      appid: APPID,
      out_bill_no: outBillNo,
      transfer_scene_id: TRANSFER_SCENE_ID,
      openid: order.athleteOpenid,
      transfer_amount: amountFen,
      transfer_remark: `Sportlight订单合作报酬`,
      transfer_scene_report_infos: buildTransferReportInfos(orderId)
    }

    await updateOptional('funds_ledger', ledger && ledger._id, { wxRequest: transferBody }, 'payout ledger')
    const result = await wxpayRequest('POST', TRANSFER_API_PATH, transferBody)

    if (result.status === 200 || result.status === 202) {
      const responseData = { ...(result.data || {}), outBillNo }
      await updateOptional('funds_ledger', ledger && ledger._id, {
        status: 'success',
        wxTransferBillNo: result.data.transfer_bill_no || '',
        wxState: result.data.state || '',
        wxPackageInfo: result.data.package_info || '',
        wxResponse: responseData
      }, 'payout ledger')
      return { ok: true, data: responseData }
    } else {
      console.error('transfer failed', result)
      await updateOptional('funds_ledger', ledger && ledger._id, { status: 'failed', failReason: JSON.stringify(result.data) }, 'payout ledger')
      return { ok: false, data: result.data }
    }
  } catch (e) {
    await updateOptional('funds_ledger', ledger && ledger._id, { status: 'failed', failReason: e.message }, 'payout ledger')
    return { ok: false, data: { message: e.message } }
  }
}

async function retryPayout(orderId, openid) {
  const lockResult = await db.runTransaction(async transaction => {
    const orderRes = await transaction.collection('orders').doc(orderId).get()
    const order = orderRes.data || {}
    if (!order._id) return { code: -1, msg: '订单不存在' }
    if (order.bossOpenid !== openid) return { code: -1, msg: '无权操作' }
    if (order.status !== 'done' || !['failed', 'release_failed'].includes(order.payoutStatus || order.paymentStatus)) {
      return { code: -1, msg: '当前订单不可重新打款' }
    }
    if (!order.athleteOpenid) return { code: -1, msg: '缺少收款球员' }

    await transaction.collection('orders').doc(orderId).update({
      data: {
        payoutStatus: 'settling',
        paymentStatus: 'release_pending',
        payoutError: '',
        payoutRetryingAt: db.serverDate()
      }
    })
    return { code: 0, order }
  })
  if (lockResult.code !== 0) return lockResult

  const retryNo = `PY${Date.now()}${crypto.randomBytes(3).toString('hex')}`.slice(0, 32)
  const transferResult = await transferToAthlete(orderId, lockResult.order, { outBillNo: retryNo })
  const transferData = transferResult && transferResult.data || {}
  const transferState = transferResult && transferResult.ok
    ? normalizeTransferState(transferData)
    : { paymentStatus: 'release_failed', payoutStatus: 'failed', label: '打款失败' }

  await db.collection('orders').doc(orderId).update({
    data: {
      paymentStatus: transferState.paymentStatus,
      payoutStatus: transferState.payoutStatus,
      payoutAutoConfirmAt: transferState.payoutStatus === 'wait_user_confirm' ? autoConfirmAtFrom(new Date()) : _.remove(),
      payoutError: transferResult && transferResult.ok ? '' : JSON.stringify(transferData || {}),
      payoutPackageInfo: transferData.package_info || '',
      payoutWxState: transferData.state || '',
      payoutWxBillNo: transferData.transfer_bill_no || '',
      payoutWxOutBillNo: transferData.out_bill_no || transferData.outBillNo || retryNo,
      payoutRetriedAt: db.serverDate()
    }
  })

  await sendImportantMessage({
    orderId,
    fromOpenid: 'system',
    toOpenid: lockResult.order.athleteOpenid,
    category: 'payment',
    priority: 'urgent',
    actionRequired: transferState.payoutStatus === 'wait_user_confirm',
    noticeType: 'payout_retry',
    title: '重新发起打款',
    content: transferState.payoutStatus === 'wait_user_confirm'
      ? '平台已重新发起打款，请进入订单详情确认收款。'
      : (transferState.payoutStatus === 'processing'
      ? '平台已重新发起打款，微信正在处理中，请稍后刷新状态。'
      : (transferState.payoutStatus === 'success'
      ? '平台已重新发起打款，请留意到账状态。'
      : '平台重新打款仍未成功，请进入订单详情查看失败原因。'))
  })

  return { code: transferState.payoutStatus === 'failed' ? -1 : 0, msg: transferState.label }
}

async function queryTransferBill(outBillNo) {
  const encoded = encodeURIComponent(outBillNo)
  return await wxpayRequest('GET', `${TRANSFER_API_PATH}/out-bill-no/${encoded}`)
}

async function getLatestPayout(orderId) {
  const payoutRes = await db.collection('funds_ledger')
    .where({ orderId, type: 'payout' })
    .limit(20)
    .get()
  const payouts = payoutRes.data || []
  return payouts.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null
}

async function refundOrder(orderId, order, refundAmount = order.price || 0, reason = '取消订单，原路退款') {
  const amountFen = Math.max(1, Math.round((refundAmount || 0) * 100))
  const refundNo = ('RFD' + orderId).slice(0, 32)

  const ledger = await addOptional('funds_ledger', {
    type: 'refund',
    orderId,
    bossOpenid: order.bossOpenid,
    amount: refundAmount || 0,
    wxRefundNo: refundNo,
    status: 'pending',
    createdAt: db.serverDate()
  }, 'refund ledger')

  try {
    const result = await wxpayRequest('POST', '/v3/refund/domestic/refunds', {
      out_trade_no: order.lastTradeNo || orderId,
      out_refund_no: refundNo,
      reason,
      amount: { refund: amountFen, total: Math.max(1, Math.round((order.price || 0) * 100)), currency: 'CNY' }
    })

    if (result.status === 200) {
      await updateOptional('funds_ledger', ledger && ledger._id, { status: 'success', wxRefundId: result.data.refund_id || '' }, 'refund ledger')
    } else {
      console.error('refund failed', result)
      await updateOptional('funds_ledger', ledger && ledger._id, { status: 'failed', failReason: JSON.stringify(result.data) }, 'refund ledger')
    }
  } catch (e) {
    await updateOptional('funds_ledger', ledger && ledger._id, { status: 'failed', failReason: e.message }, 'refund ledger')
  }
}

async function lockOrderForSettlement(orderId, openid, evaluation) {
  return await db.runTransaction(async transaction => {
    const orderRes = await transaction.collection('orders').doc(orderId).get()
    const order = orderRes.data || {}
    if (!order._id) return { code: -1, msg: '订单不存在' }
    if (order.bossOpenid !== openid) return { code: -1, msg: '无权操作' }
    if (order.status !== 'locked') return { code: -1, msg: order.status === 'settling' ? '订单正在结算中，请勿重复操作' : '订单未进行中，无法确认完成' }
    if (order.payoutStatus === 'settling') return { code: -1, msg: '订单正在结算中，请勿重复操作' }

    await transaction.collection('orders').doc(orderId).update({
      data: {
        status: 'settling',
        statusLabel: '结算中',
        payoutStatus: 'settling',
        settlingAt: db.serverDate(),
        pendingEvaluation: evaluation
      }
    })
    return { code: 0, order }
  })
}

async function ensureOrderDisputesCollection() {
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection('orderDisputes')
  } catch (e) {
    if (!String((e && (e.message || e.errMsg)) || '').includes('exist')) throw e
  }
}

async function submitExceptionSettlement(orderId, openid, evaluation) {
  const settlement = await db.runTransaction(async transaction => {
    const orderRes = await transaction.collection('orders').doc(orderId).get()
    const order = orderRes.data || {}
    if (!order._id) return { code: -1, msg: '订单不存在' }
    if (order.bossOpenid !== openid) return { code: -1, msg: '无权操作' }
    if (order.status !== 'locked') return { code: -1, msg: '订单当前无法提交异常结算' }
    const breakdown = calculateBasketballSettlement(order, evaluation)
    const proposal = {
      ...breakdown,
      playerPoints: evaluation.playerPoints || 0,
      teamResult: evaluation.teamResult || '',
      submittedBy: openid,
      submittedAt: new Date().toISOString(),
      status: 'pending_athlete_confirmation'
    }
    await transaction.collection('orders').doc(orderId).update({
      data: {
        status: 'settlement_confirmation',
        statusLabel: '等待球员确认异常结算',
        payoutStatus: 'awaiting_settlement_confirmation',
        exceptionSettlement: proposal,
        pendingEvaluation: evaluation,
        settlementSubmittedAt: db.serverDate()
      }
    })
    return { code: 0, order, proposal }
  })
  if (settlement.code !== 0) return settlement
  await sendImportantMessage({
    orderId,
    fromOpenid: 'system',
    toOpenid: settlement.order.athleteOpenid,
    category: 'order',
    priority: 'urgent',
    actionRequired: true,
    noticeType: 'exception_settlement_confirmation',
    title: '请确认异常退场结算方案',
    content: `发布方提交了「${settlement.proposal.label}」结算，拟结算 ¥${settlement.proposal.payoutAmount}。请在订单详情确认或提出异议。`
  })
  return { code: 0, msg: '异常结算已提交，等待球员确认' }
}

const finishOrder = async (orderId, order, evaluation = {}) => {
  const basketballSettlement = usesBasketballSettlement(order) ? calculateBasketballSettlement(order, evaluation) : null
  const isUnauthorizedLeave = basketballSettlement && basketballSettlement.exitType === 'unauthorized_leave'
  if (basketballSettlement && basketballSettlement.refundAmount > 0) {
    await refundOrder(orderId, order, basketballSettlement.refundAmount, isUnauthorizedLeave ? '球员擅自离场，退回托管款' : '篮球表现提成未解锁，退回剩余托管款')
  }
  const transferResult = isUnauthorizedLeave
    ? { ok: true, data: { skipped: true, reason: 'unauthorized_leave_refund' } }
    : await transferToAthlete(orderId, order, basketballSettlement ? { athleteAmount: basketballSettlement.payoutAmount } : {})
  const transferData = transferResult && transferResult.data || {}
  const transferState = transferResult && transferResult.ok
    ? normalizeTransferState(transferData)
    : { paymentStatus: 'release_failed', payoutStatus: 'failed', label: '打款失败' }

  const orderUpdate = {
    status: 'done',
    statusLabel: '已完成',
    paymentStatus: isUnauthorizedLeave ? 'refunded' : transferState.paymentStatus,
    payoutStatus: isUnauthorizedLeave ? 'refunded' : transferState.payoutStatus,
    payoutAutoConfirmAt: transferState.payoutStatus === 'wait_user_confirm' ? autoConfirmAtFrom(new Date()) : _.remove(),
    payoutError: transferResult && transferResult.ok ? '' : JSON.stringify(transferData || {}),
    payoutPackageInfo: transferData.package_info || '',
    payoutWxState: transferData.state || '',
    payoutWxBillNo: transferData.transfer_bill_no || '',
    payoutWxOutBillNo: transferData.out_bill_no || transferData.outBillNo || '',
    completedAt: db.serverDate(),
    newApplicantsCount: 0,
    pendingEvaluation: _.remove(),
    rated: true,
    rating: evaluation.rating,
    comment: evaluation.comment,
    evaluation,
    exceptionSettlement: basketballSettlement ? {
      ...basketballSettlement,
      playerPoints: evaluation.playerPoints || 0,
      teamResult: evaluation.teamResult || '',
      status: 'confirmed'
    } : _.remove(),
    athleteGet: basketballSettlement ? basketballSettlement.payoutAmount : (order.athleteGet || order.price || 0),
    ratedAt: db.serverDate()
  }

  await db.collection('orders').doc(orderId).update({ data: orderUpdate })

  if (order.athleteOpenid) {
    const athleteRes = await db.collection('athletes').where({ openid: order.athleteOpenid }).limit(1).get()
    if (athleteRes.data.length > 0) {
      const athlete = athleteRes.data[0]
      const delta = isUnauthorizedLeave
        ? -30
        : conductDelta(evaluation.punctuality, evaluation.communication) + ratingDelta(evaluation.rating)
      const newRep = clampRep(athlete.reputation, delta)
      const oldRating = athlete.rating || 0
      const oldCount = athlete.ratingCount || 0
      const newCount = oldCount + 1
      const updateData = {
        reputation: newRep,
        rating: Math.round(((oldRating * oldCount + evaluation.rating) / newCount) * 10) / 10,
        ratingCount: newCount
      }

      await db.collection('athletes').where({ openid: order.athleteOpenid }).update({ data: updateData })
    }
    await cloud.callFunction({ name: 'calcMarketValue', data: { athleteOpenid: order.athleteOpenid } })
  }

  await sendImportantMessage({
    orderId,
    fromOpenid: 'system',
    toOpenid: order.athleteOpenid,
    category: 'payment',
    priority: 'urgent',
    actionRequired: transferState.payoutStatus === 'wait_user_confirm',
    noticeType: 'order_settlement',
    title: '订单结算通知',
    content: isUnauthorizedLeave
      ? '订单已按违规规则处理，托管款将退回发布方。'
      : (transferState.payoutStatus === 'wait_user_confirm'
      ? '✅ 订单已完成，平台已发起打款，请进入订单详情确认收款。'
      : (transferState.payoutStatus === 'processing'
      ? '✅ 订单已完成，平台已发起打款，款项正在处理中，请稍后在订单详情刷新状态。'
      : (transferState.payoutStatus === 'success'
      ? '✅ 订单已完成，平台已向你打款，款项将按微信处理结果到账 🎉'
      : '✅ 订单已完成，平台打款暂未成功，请进入订单详情查看失败原因，工作人员会尽快处理。')))
  })
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { orderId, action, evaluation } = event

  try {
    if (action === 'confirm_payout') {
      const orderRes = await db.collection('orders').doc(orderId).get()
      const order = orderRes.data || {}
      if (order.athleteOpenid !== OPENID) return { code: -1, msg: '无权操作' }
      if (order.status !== 'done' || order.payoutStatus !== 'wait_user_confirm') return { code: -1, msg: '暂无待确认收款' }

      await db.collection('orders').doc(orderId).update({
        data: {
          paymentStatus: 'released',
          payoutStatus: 'user_confirmed',
          payoutUserConfirmedAt: db.serverDate(),
          payoutAutoConfirmAt: _.remove()
        }
      })

      try {
        const payoutRes = await db.collection('funds_ledger')
          .where({ orderId, type: 'payout', status: 'success' })
          .limit(10)
          .get()
        const payouts = payoutRes.data || []
        await Promise.all(payouts.map(item => db.collection('funds_ledger').doc(item._id).update({
          data: { status: 'user_confirmed', wxState: 'USER_CONFIRMED', userConfirmedAt: db.serverDate() }
        })))
      } catch (e) {}

      return { code: 0, msg: '已确认收款' }
    }

    if (action === 'refresh_payout') {
      const orderRes = await db.collection('orders').doc(orderId).get()
      const order = orderRes.data || {}
      const isBoss = order.bossOpenid === OPENID
      const isAthlete = order.athleteOpenid === OPENID
      if (!isBoss && !isAthlete) return { code: -1, msg: '无权操作' }
      if (order.status !== 'done') return { code: -1, msg: '订单尚未完成结算' }

      const payout = await getLatestPayout(orderId)
      const outBillNo = order.payoutWxOutBillNo || (payout && payout.wxOutBillNo) || ''
      if (!outBillNo) return { code: -1, msg: '缺少转账单号' }

      const result = await queryTransferBill(outBillNo)
      if (result.status !== 200 || !result.data) {
        return { code: -1, msg: '查询打款状态失败' }
      }

      const transferState = normalizeTransferState(result.data)
      await db.collection('orders').doc(orderId).update({
        data: {
          paymentStatus: transferState.paymentStatus,
          payoutStatus: transferState.payoutStatus,
          payoutWxState: result.data.state || result.data.transfer_state || '',
          payoutPackageInfo: result.data.package_info || order.payoutPackageInfo || '',
          payoutWxBillNo: result.data.transfer_bill_no || order.payoutWxBillNo || '',
          payoutWxOutBillNo: outBillNo,
          payoutAutoConfirmAt: transferState.payoutStatus === 'wait_user_confirm'
            ? (order.payoutAutoConfirmAt || autoConfirmAtFrom(order.completedAt))
            : _.remove(),
          payoutError: transferState.payoutStatus === 'failed' ? JSON.stringify(result.data || {}) : '',
          payoutCheckedAt: db.serverDate()
        }
      })

      if (payout && payout._id) {
        await db.collection('funds_ledger').doc(payout._id).update({
          data: {
            wxState: result.data.state || result.data.transfer_state || '',
            wxPackageInfo: result.data.package_info || '',
            wxTransferBillNo: result.data.transfer_bill_no || '',
            wxResponse: result.data,
            checkedAt: db.serverDate()
          }
        }).catch(() => {})
      }

      return { code: 0, msg: transferState.label, data: { payoutStatus: transferState.payoutStatus } }
    }

    if (action === 'retry_payout') {
      return await retryPayout(orderId, OPENID)
    }

    if (action === 'confirm_exception_settlement') {
      const confirmRes = await db.runTransaction(async transaction => {
        const orderRes = await transaction.collection('orders').doc(orderId).get()
        const order = orderRes.data || {}
        if (!order._id) return { code: -1, msg: '订单不存在' }
        if (order.athleteOpenid !== OPENID) return { code: -1, msg: '无权确认该结算方案' }
        if (order.status !== 'settlement_confirmation' || !order.pendingEvaluation) return { code: -1, msg: '当前没有待确认的异常结算' }
        await transaction.collection('orders').doc(orderId).update({
          data: {
            status: 'settling',
            statusLabel: '结算中',
            payoutStatus: 'settling',
            exceptionSettlement: { ...(order.exceptionSettlement || {}), status: 'athlete_confirmed', athleteConfirmedAt: new Date().toISOString() },
            settlementConfirmedAt: db.serverDate()
          }
        })
        return { code: 0, order }
      })
      if (confirmRes.code !== 0) return confirmRes
      await finishOrder(orderId, confirmRes.order, confirmRes.order.pendingEvaluation)
      return { code: 0, msg: '已确认异常结算，平台正在处理款项' }
    }

    if (action === 'dispute_exception_settlement') {
      const disputeReason = String(event.disputeReason || '').trim().slice(0, 200)
      if (!disputeReason) return { code: -1, msg: '请填写异议原因' }
      const disputeRes = await db.runTransaction(async transaction => {
        const orderRes = await transaction.collection('orders').doc(orderId).get()
        const order = orderRes.data || {}
        if (!order._id) return { code: -1, msg: '订单不存在' }
        if (order.athleteOpenid !== OPENID) return { code: -1, msg: '无权提出异议' }
        if (order.status !== 'settlement_confirmation') return { code: -1, msg: '当前没有可申诉的异常结算' }
        const appealDeadline = addWorkingDays(new Date(), 5)
        await transaction.collection('orders').doc(orderId).update({
          data: {
            status: 'settlement_disputed',
            statusLabel: '异常结算申诉处理中',
            payoutStatus: 'frozen_for_dispute',
            exceptionSettlement: { ...(order.exceptionSettlement || {}), status: 'disputed', disputeReason, disputedAt: new Date().toISOString(), appealDeadline: appealDeadline.toISOString() },
            settlementDisputedAt: db.serverDate()
          }
        })
        return { code: 0, order, appealDeadline }
      })
      if (disputeRes.code !== 0) return disputeRes
      await ensureOrderDisputesCollection()
      await db.collection('orderDisputes').add({
        data: {
          orderId,
          bossOpenid: disputeRes.order.bossOpenid,
          athleteOpenid: OPENID,
          type: 'exception_settlement',
          status: 'pending',
          reason: disputeReason,
          settlement: disputeRes.order.exceptionSettlement || {},
          appealDeadline: disputeRes.appealDeadline.toISOString(),
          createdAt: db.serverDate()
        }
      })
      await sendImportantMessage({
        orderId,
        fromOpenid: 'system',
        toOpenid: disputeRes.order.bossOpenid,
        category: 'order',
        priority: 'urgent',
        actionRequired: false,
        noticeType: 'exception_settlement_disputed',
        title: '球员已对异常结算提出异议',
        content: '订单款项已冻结，平台将在 5 个工作日内介入处理。'
      })
      return { code: 0, msg: '异议已提交，款项已冻结等待平台处理' }
    }

    if (action === 'complete') {
      const orderRes = await db.collection('orders').doc(orderId).get()
      const order = orderRes.data
      const isBoss = order.bossOpenid === OPENID
      const isAthlete = order.athleteOpenid === OPENID
      if (!isBoss && !isAthlete) return { code: -1, msg: '无权操作' }

      if (isBoss) {
        const normalized = normalizeEvaluation(evaluation, order)
        if (!normalized.ok) return { code: -1, msg: normalized.msg }
        if (usesBasketballSettlement(order) && normalized.data.exitType !== 'normal') {
          return await submitExceptionSettlement(orderId, OPENID, normalized.data)
        }
        const lockResult = await lockOrderForSettlement(orderId, OPENID, normalized.data)
        if (lockResult.code !== 0) return lockResult
        await finishOrder(orderId, lockResult.order, normalized.data)
        return { code: 0, msg: '已确认完成，平台将向球员发起结算 🎉' }
      }

      if (isAthlete) {
        if (order.athleteConfirmed) return { code: -1, msg: '你已确认过了，等待老板确认' }
        await db.collection('orders').doc(orderId).update({ data: { athleteConfirmed: true, athleteConfirmedAt: db.serverDate() } })
        await sendImportantMessage({
          orderId,
          fromOpenid: OPENID,
          toOpenid: order.bossOpenid,
          category: 'order',
          priority: 'urgent',
          actionRequired: true,
          noticeType: 'athlete_completed',
          title: '球员已确认完成',
          messageType: 'order_card',
          content: '✅ 我已确认完成，请老板确认。若24小时内未确认，平台将自动结算。',
          orderSnapshot: { title: order.title, type: order.type, price: order.price, city: order.city, date: order.date },
        })
        return { code: 0, msg: '已确认完成，等待老板确认' }
      }
    }

    if (action === 'cancel') {
      const cancelRes = await db.collection('orders').doc(orderId).get()
      const cancelOrder = cancelRes.data
      if (cancelOrder.bossOpenid !== OPENID) return { code: -1, msg: '无权取消此订单' }
      if (cancelOrder.status !== 'open') return { code: -1, msg: '只能取消招募中的订单' }

      const wasEscrowed = cancelOrder.paymentStatus === 'escrowed'
      await db.collection('orders').doc(orderId).update({
        data: { status: 'cancelled', statusLabel: '已取消', paymentStatus: wasEscrowed ? 'refunded' : cancelOrder.paymentStatus, newApplicantsCount: 0 }
      })

      if (wasEscrowed) await refundOrder(orderId, cancelOrder)

      const applicants = cancelOrder.applicants || []
      for (const applicantOpenid of applicants) {
        await sendImportantMessage({
          orderId,
          fromOpenid: 'system',
          toOpenid: applicantOpenid,
          category: 'order',
          priority: 'important',
          actionRequired: false,
          noticeType: 'order_cancelled',
          title: '订单已取消',
          content: `📢 你报名的「${cancelOrder.title}」已被发布方取消。`,
        })
      }
      return { code: 0, msg: '订单已取消' + (wasEscrowed ? '，款项将原路退回' : '') }
    }

    if (action === 'reject_applicant') {
      const { athleteOpenid } = event
      if (!athleteOpenid) return { code: -1, msg: '缺少球员信息' }

      const orderRes = await db.collection('orders').doc(orderId).get()
      const order = orderRes.data || {}
      if (order.bossOpenid !== OPENID) return { code: -1, msg: '无权操作' }
      if (order.status !== 'open') return { code: -1, msg: '只能处理招募中的报名' }

      const applicants = order.applicants || []
      if (!applicants.includes(athleteOpenid)) return { code: -1, msg: '该球员不在待审核列表中' }

      const rejectedApplicants = order.rejectedApplicants || []
      const nextApplicants = applicants.filter(id => id !== athleteOpenid)
      const nextRejectedApplicants = rejectedApplicants.includes(athleteOpenid)
        ? rejectedApplicants
        : [...rejectedApplicants, athleteOpenid]

      await db.collection('orders').doc(orderId).update({
        data: {
          applicants: nextApplicants,
          rejectedApplicants: nextRejectedApplicants,
          newApplicantsCount: Math.min(order.newApplicantsCount || 0, nextApplicants.length)
        }
      })

      await sendImportantMessage({
        orderId,
        fromOpenid: 'system',
        toOpenid: athleteOpenid,
        category: 'order',
        priority: 'important',
        actionRequired: false,
        noticeType: 'application_rejected',
        title: '报名未通过',
        content: `📢 你报名的「${order.title || '订单'}」未被选中。`,
      })

      return { code: 0, msg: '已拒绝该球员' }
    }

    if (action === 'cancel_cooperation') {
      const orderRes = await db.collection('orders').doc(orderId).get()
      const order = orderRes.data || {}
      if (order.bossOpenid !== OPENID) return { code: -1, msg: '无权操作' }
      if (order.status !== 'locked') return { code: -1, msg: '只能取消进行中的合作' }
      if (order.athleteConfirmed) return { code: -1, msg: '球员已确认完成，请走完成结算流程' }

      const athleteOpenid = order.athleteOpenid || order.pendingAthleteOpenid
      if (!athleteOpenid) return { code: -1, msg: '缺少合作球员信息' }

      const rejectedApplicants = order.rejectedApplicants || []
      const nextRejectedApplicants = rejectedApplicants.includes(athleteOpenid)
        ? rejectedApplicants
        : [...rejectedApplicants, athleteOpenid]

      const wasEscrowed = order.paymentStatus === 'escrowed'
      await db.collection('orders').doc(orderId).update({
        data: {
          status: 'cancelled',
          statusLabel: '已取消',
          paymentStatus: wasEscrowed ? 'refunded' : order.paymentStatus,
          payoutStatus: 'cancelled',
          athleteOpenid: _.remove(),
          pendingAthleteOpenid: _.remove(),
          rejectedApplicants: nextRejectedApplicants,
          cooperationCancelledAt: db.serverDate(),
          newApplicantsCount: 0
        }
      })

      if (wasEscrowed) await refundOrder(orderId, order)

      await sendImportantMessage({
        orderId,
        fromOpenid: 'system',
        toOpenid: athleteOpenid,
        category: 'order',
        priority: 'important',
        actionRequired: false,
        noticeType: 'cooperation_cancelled',
        title: '合作已取消',
        content: `📢 发布方已取消「${order.title || '订单'}」的合作。`,
      })

      return { code: 0, msg: '合作已取消' + (wasEscrowed ? '，款项将原路退回' : '') }
    }

    if (action === 'submit_delivery') {
      return { code: -1, msg: '当前不开放该提交入口' }
    }

    // 报名
    if (action && action !== 'apply') return { code: -1, msg: '无效操作' }
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data
    if (order.bossOpenid === OPENID) return { code: -1, msg: '不能报名自己发的单' }
    if (order.applicants && order.applicants.includes(OPENID)) return { code: -1, msg: '已经报名过了' }
    if (order.rejectedApplicants && order.rejectedApplicants.includes(OPENID)) return { code: -1, msg: '该报名已被发布方取消' }
    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).field({ reputation: true, sport: true, basketballPricingVersion: true, basketballBountyEligible: true, levelReviewStatus: true }).limit(1).get()
    const athlete = athleteRes.data[0] || {}
    if ((athlete.reputation || 80) < 60) return { code: -1, msg: '你的信誉分低于60，暂不能参加该项目' }
    if (order.sport === '篮球' && athlete.sport === '篮球' && athlete.basketballPricingVersion === 'basketball-bounty-v1' && athlete.basketballBountyEligible !== true) {
      return { code: -1, msg: athlete.levelReviewStatus === 'pending' ? '篮球档案审核中，暂不能接赏金令' : '篮球档案暂未通过审核，暂不能接赏金令' }
    }
    await db.collection('orders').doc(orderId).update({ data: { applicants: _.push(OPENID), newApplicantsCount: _.inc(1) } })
    return { code: 0, msg: '报名成功' }

  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
