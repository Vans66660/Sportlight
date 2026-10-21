const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const PAYOUT_AUTO_CONFIRM_HOURS = 24

// 将 cloud:// 路径批量转为临时 HTTPS 链接
const toTempURLs = async (urlMap) => {
  const cloudKeys = Object.keys(urlMap).filter(k => urlMap[k] && urlMap[k].startsWith('cloud://'))
  if (cloudKeys.length === 0) return urlMap
  const fileList = cloudKeys.map(k => urlMap[k])
  try {
    const res = await cloud.getTempFileURL({ fileList })
    res.fileList.forEach((f, i) => {
      urlMap[cloudKeys[i]] = f.tempFileURL || urlMap[cloudKeys[i]]
    })
  } catch (e) {}
  return urlMap
}

const fmt = (d) => {
  if (!d) return ''
  const date = new Date(d)
  return `${date.getMonth() + 1}.${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function platformFeeRate(type) {
  return type === 'ad' ? 0.15 : 0.10
}

function resolvePlatformFeeRate(order = {}) {
  if (order.sport === '篮球') return 0
  return order.platformFeeRate !== undefined && order.platformFeeRate !== null
    ? Number(order.platformFeeRate) || 0
    : platformFeeRate(order.type)
}

function usesBasketballSettlement(order = {}) {
  const settlement = order.basketballSettlement || {}
  const guaranteedAppearanceFee = Number(order.guaranteedAppearanceFee || settlement.guaranteedAppearanceFee)
  const performanceBonus = Number(order.performanceBonus || settlement.performanceBonus)
  return order.sport === '篮球' &&
    order.basketballPricingVersion === 'basketball-bounty-v1' &&
    guaranteedAppearanceFee > 0 && performanceBonus > 0
}

function readablePayoutError(raw) {
  if (!raw) return ''
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    return data.message || data.code || data.errmsg || data.errMsg || JSON.stringify(data)
  } catch (e) {
    return String(raw)
  }
}

function getDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function calcPayoutAutoConfirmAt(order) {
  const saved = getDate(order.payoutAutoConfirmAt)
  if (saved) return saved
  const base = getDate(order.completedAt) || getDate(order.settlingAt) || getDate(order.updatedAt)
  if (!base) return null
  return new Date(base.getTime() + PAYOUT_AUTO_CONFIRM_HOURS * 60 * 60 * 1000)
}

function formatRemain(ms) {
  if (ms <= 0) return '即将'
  const totalMinutes = Math.ceil(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}分钟`
  if (minutes === 0) return `${hours}小时`
  return `${hours}小时${minutes}分钟`
}

function normalizeTier(tier) {
  const value = String(tier || '').trim()
  return !value || value === 'F' || value.startsWith('F') ? 'D' : value
}

async function getBossProfile(openid) {
  const [userRes, bossRes] = await Promise.all([
    db.collection('users').where({ openid }).limit(1).get(),
    db.collection('bosses').where({ openid }).limit(1).get().catch(() => ({ data: [] }))
  ])
  return {
    ...((userRes.data || [])[0] || {}),
    ...((bossRes.data || [])[0] || {})
  }
}

async function autoConfirmPayoutIfDue(orderId, order) {
  if (order.status !== 'done' || order.payoutStatus !== 'wait_user_confirm') return order

  const autoConfirmAt = calcPayoutAutoConfirmAt(order)
  if (!autoConfirmAt) return order

  if (autoConfirmAt <= new Date()) {
    await db.collection('orders').doc(orderId).update({
      data: {
        paymentStatus: 'released',
        payoutStatus: 'user_confirmed',
        payoutAutoConfirmedAt: db.serverDate(),
        payoutAutoConfirmAt: _.remove()
      }
    })

    try {
      const payoutRes = await db.collection('funds_ledger')
        .where({ orderId, type: 'payout', status: 'success' })
        .limit(10)
        .get()
      await Promise.all((payoutRes.data || []).map(item => db.collection('funds_ledger').doc(item._id).update({
        data: { status: 'user_confirmed', wxState: 'AUTO_CONFIRMED', autoConfirmedAt: db.serverDate() }
      })))
    } catch (e) {}

    return {
      ...order,
      paymentStatus: 'released',
      payoutStatus: 'user_confirmed',
      payoutAutoConfirmAt: null,
      payoutAutoConfirmedAt: new Date()
    }
  }

  if (!order.payoutAutoConfirmAt) {
    await db.collection('orders').doc(orderId).update({
      data: { payoutAutoConfirmAt: autoConfirmAt }
    }).catch(() => {})
  }

  return { ...order, payoutAutoConfirmAt: autoConfirmAt }
}

function getApplicationState(order, openid) {
  if (order.athleteOpenid === openid || order.pendingAthleteOpenid === openid) {
    return {
      status: 'approved',
      text: '报名已通过',
      title: '报名已通过',
      desc: '发布方已选择与你合作，后续请在订单聊天中确认细节。'
    }
  }
  if (Array.isArray(order.rejectedApplicants) && order.rejectedApplicants.includes(openid)) {
    const cancelledAfterApproval = order.status === 'cancelled' && order.cooperationCancelledAt
    return {
      status: 'rejected',
      text: cancelledAfterApproval ? '合作已取消' : '报名未通过',
      title: cancelledAfterApproval ? '合作已取消' : '报名未通过',
      desc: cancelledAfterApproval
        ? '发布方已取消本次合作，这条赏金令暂不能再次报名。'
        : '发布方已取消你的报名，这条赏金令暂不能再次报名。'
    }
  }
  if (Array.isArray(order.applicants) && order.applicants.includes(openid)) {
    return {
      status: 'pending',
      text: '审核中',
      title: '已提交报名',
      desc: '你的报名已进入候选列表，等待发布方筛选确认。'
    }
  }
  return {
    status: 'none',
    text: '',
    title: '确认参与这条赏金令',
    desc: '报名后发布方会在候选运动员中选择合作对象，锁单后报酬进入平台托管。'
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { orderId } = event

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    let order = orderRes.data
    order = await autoConfirmPayoutIfDue(orderId, order)

    // 获取发布方信息
    let bossName = '发布方'
    let bossPhoto = ''
    const b = await getBossProfile(order.bossOpenid)
    if (b.openid || b.name || b.logo) {
      bossName = b.displayName || b.name || b.nickName || '发布方'
      bossPhoto = b.logo || b.avatarUrl || b.photo || ''
    }
    if (order.teamCaptainChat) {
      const bossAthleteRes = await db.collection('athletes').where({ openid: order.bossOpenid }).limit(1).get()
      if (bossAthleteRes.data.length > 0) {
        const a = bossAthleteRes.data[0]
        bossName = a.name || bossName
        bossPhoto = a.photo || bossPhoto
      }
    }

    // 获取运动员信息（已锁单才有）
    let athleteName = '待定'
    let athletePhoto = ''
    let athleteRank = '-'
    let athleteRating = 0
    if (order.athleteOpenid) {
      const athleteRes = await db.collection('athletes').where({ openid: order.athleteOpenid }).limit(1).get()
      if (athleteRes.data.length > 0) {
        const a = athleteRes.data[0]
        athleteName = a.name || '待定'
        athletePhoto = a.photo || ''
        athleteRank = normalizeTier(a.currentTier || a.rank)
        athleteRating = a.rating || 0
      }
      // fallback 到 users
      if (!athletePhoto) {
        const aUserRes = await db.collection('users').where({ openid: order.athleteOpenid }).limit(1).get()
        if (aUserRes.data.length > 0) {
          athletePhoto = aUserRes.data[0].avatarUrl || ''
          if (athleteName === '待定') athleteName = aUserRes.data[0].nickName || aUserRes.data[0].name || '待定'
        }
      }
    }

    // 转换 cloud:// 头像链接
    const photoMap = await toTempURLs({ bossPhoto, athletePhoto })
    bossPhoto = photoMap.bossPhoto
    athletePhoto = photoMap.athletePhoto

    // 转换宣传图片链接
    let promoImages = order.promoImages || []
    const promoCloudIDs = promoImages.filter(p => p && p.startsWith('cloud://'))
    if (promoCloudIDs.length > 0) {
      try {
        const promoRes = await cloud.getTempFileURL({ fileList: promoCloudIDs })
        const promoMap = {}
        promoRes.fileList.forEach(f => { promoMap[f.fileID] = f.tempFileURL })
        promoImages = promoImages.map(p => promoMap[p] || p)
      } catch (e) {}
    }

    // 计算费用
    const feeRate = resolvePlatformFeeRate(order)
    const platformFee = Math.round((order.price || 0) * feeRate * 100) / 100
    const athleteGet = Math.round(((order.price || 0) - platformFee) * 100) / 100

    // 计算进度步骤
    const stepMap = { open: 2, pending: 2, locked: 3, settlement_confirmation: 4, settlement_disputed: 4, settling: 4, done: 5, cancelled: 1 }
    const step = stepMap[order.status] || 1
    const finalPayoutStates = ['SUCCESS', 'FINISHED', 'TRANSFERRED', 'USER_CONFIRMED']
    const application = getApplicationState(order, OPENID)
    const payoutAutoConfirmAt = getDate(order.payoutAutoConfirmAt)
    const payoutAutoConfirmRemainText = order.payoutStatus === 'wait_user_confirm' && payoutAutoConfirmAt
      ? formatRemain(payoutAutoConfirmAt.getTime() - Date.now())
      : ''

    let payoutInfo = null
    try {
      const payoutRes = await db.collection('funds_ledger')
        .where({ orderId, type: 'payout' })
        .get()
      if (payoutRes.data.length > 0) {
        const p = payoutRes.data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
        payoutInfo = {
          status: p.status || '',
          wxState: p.wxState || '',
          wxPackageInfo: p.wxPackageInfo || '',
          wxTransferBillNo: p.wxTransferBillNo || '',
          failReason: p.failReason || ''
        }
      }
    } catch (e) {}

    return {
      code: 0,
      data: {
        ...order,
        bossName,
        bossPhoto,
        athleteName,
        athletePhoto,
        athleteRank,
        athleteRating,
        platformFee,
        platformFeeRate: feeRate,
        platformFeeRateText: `${Math.round(feeRate * 100)}%`,
        athleteGet,
        isBasketballOrder: order.sport === '篮球',
        basketballSettlementEnabled: usesBasketballSettlement(order),
        canConfirmExceptionSettlement: order.status === 'settlement_confirmation' && order.athleteOpenid === OPENID,
        canDisputeExceptionSettlement: order.status === 'settlement_confirmation' && order.athleteOpenid === OPENID,
        exceptionSettlementStatus: (order.exceptionSettlement || {}).status || '',
        exceptionSettlementLabel: (order.exceptionSettlement || {}).label || '',
        exceptionSettlementPayout: Number((order.exceptionSettlement || {}).payoutAmount) || 0,
        exceptionSettlementRefund: Number((order.exceptionSettlement || {}).refundAmount) || 0,
        exceptionSettlementAppealDeadline: fmt((order.exceptionSettlement || {}).appealDeadline),
        step,
        payoutInfo,
        canConfirmPayout: !!(
          order.status === 'done' &&
          ((order.payoutStatus === 'wait_user_confirm' && order.payoutPackageInfo) ||
          (payoutInfo && payoutInfo.wxState === 'WAIT_USER_CONFIRM' && payoutInfo.wxPackageInfo))
        ),
        canRefreshPayout: !!(
          order.status === 'done' &&
          (['processing', 'release_pending'].includes(order.payoutStatus) ||
          (order.payoutStatus === 'success' && order.payoutWxState && !finalPayoutStates.includes(order.payoutWxState)))
        ),
        canRetryPayout: !!(
          order.status === 'done' &&
          ['failed', 'release_failed'].includes(order.payoutStatus || order.paymentStatus)
        ),
        payoutStatusText: order.payoutStatus === 'wait_user_confirm'
          ? '待确认收款'
          : (order.payoutStatus === 'processing'
            ? '打款处理中'
            : (order.payoutStatus === 'failed' ? '打款失败' : (order.payoutStatus === 'user_confirmed' ? '已确认收款' : ''))),
        payoutFailReason: readablePayoutError(order.payoutError || (payoutInfo && payoutInfo.failReason)),
        payoutPackageInfo: order.payoutPackageInfo || (payoutInfo && payoutInfo.wxPackageInfo) || '',
        payoutAutoConfirmAt: payoutAutoConfirmAt ? fmt(payoutAutoConfirmAt) : '',
        payoutAutoConfirmRemainText,
        isApplied: application.status !== 'none',
        canApplyToOrder: order.status === 'open' && application.status === 'none',
        applicationStatus: application.status,
        applicationStatusText: application.text,
        applicationTitle: application.title,
        applicationDesc: application.desc,
        promoImages,
        createdAt: fmt(order.createdAt),
        acceptedAt: fmt(order.lockedAt),
        lockedAt: fmt(order.lockedAt),
        completedAt: fmt(order.completedAt),
        settledAt: order.status === 'done' ? fmt(order.completedAt) : ''
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
