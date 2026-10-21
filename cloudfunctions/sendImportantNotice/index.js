const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const IMPORTANT_PRIORITIES = ['important', 'urgent']
const EXTERNAL_CATEGORIES = ['payment', 'order', 'event', 'team']
const DEFAULT_SUBSCRIBE_TEMPLATES = {
  team: {
    templateId: 'FP_FE6U6eL2ELj1skG8I9JDpfP9nC1R67MyHgmeJgMI'
  },
  event: {
    templateId: 'hMUrnvn6T2-bsx0pGPx_63hdPWbiIecwDOV7D17sgJY'
  },
  payment: {
    templateId: 'l0eD560SJKTqx5hlQ1TDt4ZUowKAv4m55cHteQnTXDk'
  },
  order: {
    templateId: 'XS3YNclz2a6W5xi4cgHQvpryhVotR92yqS-gTeqoOuI'
  }
}

function trimText(value, max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function nowText() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

function amountText(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0元'
  return `${Math.round(n * 100) / 100}元`
}

function getOrderTitle(notice) {
  return trimText(
    notice.itemName ||
    notice.eventContent ||
    (notice.orderSnapshot && notice.orderSnapshot.title) ||
    notice.title ||
    'Sportlight赛事',
    20
  )
}

function getOrderAmount(notice) {
  return notice.amount !== undefined
    ? notice.amount
    : (notice.orderSnapshot && notice.orderSnapshot.price !== undefined ? notice.orderSnapshot.price : '')
}

function getStatus(notice) {
  if (notice.statusText) return trimText(notice.statusText, 10)
  const map = {
    athlete_selected: '已通过',
    athlete_completed: '待确认',
    order_settlement: '待收款',
    payout_retry: '重新打款',
    order_cancelled: '已取消',
    cooperation_cancelled: '已取消',
    application_rejected: '未通过',
    event_approved: '已通过',
    event_rejected: '未通过',
    team_invite: '待确认',
    solo_team_invite: '待确认',
    team_join_request: '待审核',
    team_join_approved: '已通过',
    team_join_rejected: '未通过'
  }
  return map[notice.noticeType] || trimText(notice.actionText || '待查看', 10)
}

function compact(data) {
  const out = {}
  Object.keys(data).forEach(key => {
    if (data[key] !== undefined) out[key] = data[key]
  })
  return out
}

function normalizeTemplateConfig(settings, templateType) {
  const templates = {
    ...DEFAULT_SUBSCRIBE_TEMPLATES,
    ...(settings.subscribeTemplates || settings.importantNoticeTemplates || {})
  }
  const config = templates[templateType] || templates.default
  if (!config) return null
  if (typeof config === 'string') return { templateId: config }
  return config.templateId ? config : null
}

function buildTemplateData(notice, templateConfig) {
  if (notice.templateData) return notice.templateData
  if (templateConfig && templateConfig.data) return templateConfig.data
  const templateType = notice.templateType || notice.category || 'order'
  const status = getStatus(notice)
  const title = getOrderTitle(notice)
  const content = trimText(notice.content || '请进入小程序查看详情', 20)

  if (templateType === 'order') {
    return {
      phrase1: { value: status },
      thing2: { value: title },
      amount3: { value: amountText(getOrderAmount(notice)) },
      thing4: { value: content }
    }
  }

  if (templateType === 'payment') {
    return {
      thing1: { value: title || '合作报酬' },
      amount2: { value: amountText(getOrderAmount(notice)) },
      time3: { value: nowText() }
    }
  }

  if (templateType === 'event') {
    return {
      thing1: { value: title },
      time2: { value: notice.startTime || nowText() },
      phrase3: { value: status }
    }
  }

  if (templateType === 'team') {
    return {
      time1: { value: nowText() },
      thing2: { value: trimText(notice.teamName || title, 20) },
      thing3: { value: title }
    }
  }

  return {
    thing1: { value: trimText(notice.title || 'Sportlight通知', 20) },
    thing2: { value: content },
    phrase3: { value: status },
    time4: { value: nowText() }
  }
}

function getExternalErrorHint(errCode) {
  const code = Number(errCode)
  const map = {
    40003: '接收人 openid 不正确',
    40037: '订阅模板 ID 不正确',
    43101: '接收人未授权该模板，或一次性订阅次数已用完',
    47003: '模板参数不准确',
    41030: '跳转页面路径不正确'
  }
  return map[code] || ''
}

async function getPlatformSettings() {
  try {
    const res = await db.collection('platformSettings').doc('global').get()
    return res.data || {}
  } catch (e) {
    return {}
  }
}

async function writeInternalNotice(notice) {
  const now = db.serverDate()
  const base = {
    fromOpenid: notice.fromOpenid || 'system',
    toOpenid: notice.toOpenid,
    category: notice.category || 'system',
    priority: notice.priority || 'normal',
    actionRequired: !!notice.actionRequired,
    noticeType: notice.noticeType || '',
    content: trimText(notice.content, 300),
    createdAt: now,
    read: false
  }

  if (notice.internalChannel === 'message') {
    const msg = {
      ...base,
      orderId: notice.orderId || notice.conversationId || notice.relatedId || '',
      type: notice.messageType || 'text',
      orderSnapshot: notice.orderSnapshot || undefined
    }
    const res = await db.collection('messages').add({ data: compact(msg) })
    return { channel: 'message', id: res._id }
  }

  const notification = {
    ...base,
    type: notice.notificationType || notice.noticeType || 'important_notice',
    title: trimText(notice.title, 60),
    eventContent: trimText(notice.eventContent || notice.content, 120),
    postId: notice.postId || '',
    registrationId: notice.registrationId || '',
    teamRegistrationId: notice.teamRegistrationId || '',
    soloRegistrationId: notice.soloRegistrationId || '',
    teamId: notice.teamId || '',
    challengeId: notice.challengeId || '',
    relatedId: notice.relatedId || '',
    captainName: notice.captainName || '',
    teamName: notice.teamName || '',
    fromName: notice.fromName || '',
    entryFee: notice.entryFee || 0,
    responded: !!notice.responded,
    responseAction: notice.responseAction || ''
  }
  const res = await db.collection('notifications').add({ data: compact(notification) })
  return { channel: 'notification', id: res._id }
}

async function tryExternalPush(notice, internalResult) {
  const priority = notice.priority || 'normal'
  const category = notice.category || 'system'
  const templateType = notice.templateType || category
  const writeLog = async (pushResult = {}, extra = {}) => {
    try {
      await db.collection('important_notice_logs').add({
        data: {
          toOpenid: notice.toOpenid,
          noticeType: notice.noticeType || '',
          category,
          priority,
          templateType,
          templateId: extra.templateId || '',
          externalAttempted: !!pushResult.attempted,
          externalOk: !!pushResult.ok,
          externalError: pushResult.error || extra.reason || '',
          externalErrCode: pushResult.errCode || '',
          externalErrorHint: getExternalErrorHint(pushResult.errCode),
          internalChannel: internalResult.channel,
          internalId: internalResult.id,
          createdAt: db.serverDate()
        }
      })
    } catch (e) {
      console.error('important_notice_logs write failed', e)
    }
  }

  if (!notice.externalPush || !IMPORTANT_PRIORITIES.includes(priority) || !EXTERNAL_CATEGORIES.includes(category)) {
    await writeLog({ attempted: false }, { reason: 'not_external_notice' })
    return { attempted: false, reason: 'not_external_notice' }
  }

  const settings = await getPlatformSettings()
  const templateConfig = normalizeTemplateConfig(settings, templateType)
  if (!templateConfig) {
    await writeLog({ attempted: false }, { reason: 'template_not_configured' })
    return { attempted: false, reason: 'template_not_configured', templateType }
  }

  const page = notice.page || templateConfig.page || ''
  let pushResult = { attempted: false }
  try {
    const res = await cloud.openapi.subscribeMessage.send({
      touser: notice.toOpenid,
      templateId: templateConfig.templateId,
      page,
      data: buildTemplateData(notice, templateConfig),
      miniprogramState: templateConfig.miniprogramState || 'formal',
      lang: templateConfig.lang || 'zh_CN'
    })
    pushResult = { attempted: true, ok: true, result: res }
    return pushResult
  } catch (e) {
    pushResult = { attempted: true, ok: false, error: e.message || String(e), errCode: e.errCode || e.errcode }
    return pushResult
  } finally {
    await writeLog(pushResult, { templateId: templateConfig.templateId })
  }
}

exports.main = async (event) => {
  const notice = event || {}
  if (!notice.toOpenid) return { code: -1, msg: '缺少接收人' }
  if (!notice.content) return { code: -1, msg: '缺少通知内容' }

  try {
    const internal = await writeInternalNotice(notice)
    const external = await tryExternalPush(notice, internal)
    return { code: 0, internal, external }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
