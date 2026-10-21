const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function canManageActivity(openid) {
  if (!openid) return false
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true, activityAdmin: true, permissions: true, name: true, nickname: true, displayName: true })
    .limit(1)
    .get()
  const user = (res.data || [])[0] || {}
  const allowed = user.userType === 'admin' || !!user.activityAdmin || !!((user.permissions || {}).activityAdmin)
  return allowed ? user : null
}

async function ensureCollection() {
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection('activities')
  } catch (e) {
    if (!String(e && (e.message || e.errMsg) || '').includes('exist')) throw e
  }
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max)
}

function normalizeType(type) {
  return ['activity', 'announcement', 'article', 'collaboration'].includes(type) ? type : 'activity'
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const operator = await canManageActivity(OPENID)
  if (!operator) return { code: -1, msg: '无活动管理权限' }

  const title = cleanText(event.title, 60)
  const summary = cleanText(event.summary, 180)
  const content = cleanText(event.content, 2000)
  const type = normalizeType(event.type)
  const status = event.status === 'draft' ? 'draft' : 'published'
  if (!title) return { code: -1, msg: '请填写标题' }
  if (!summary && !content) return { code: -1, msg: '请填写内容或摘要' }

  const now = Date.now()
  const data = {
    type,
    status,
    title,
    summary,
    content,
    cover: cleanText(event.cover, 300),
    linkUrl: cleanText(event.linkUrl, 500),
    sourceName: cleanText(event.sourceName, 40),
    partnerName: cleanText(event.partnerName, 40),
    displayDate: cleanText(event.displayDate, 20),
    pinned: !!event.pinned,
    publisherOpenid: OPENID,
    publisherName: operator.name || operator.displayName || operator.nickname || '',
    updatedAt: db.serverDate(),
    updatedAtMs: now
  }
  if (status === 'published') {
    data.publishedAt = db.serverDate()
    data.publishedAtMs = now
  }

  try {
    await ensureCollection()
    if (event.activityId) {
      const doc = await db.collection('activities').doc(event.activityId).get()
      if (!doc.data || (!doc.data.publisherOpenid && operator.userType !== 'admin')) return { code: -1, msg: '内容不存在' }
      await db.collection('activities').doc(event.activityId).update({ data })
      return { code: 0, msg: '已更新', activityId: event.activityId }
    }
    data.createdAt = db.serverDate()
    data.createdAtMs = now
    const res = await db.collection('activities').add({ data })
    return { code: 0, msg: '已发布', activityId: res._id }
  } catch (e) {
    return { code: -1, msg: e.message || e.errMsg || '保存失败' }
  }
}
