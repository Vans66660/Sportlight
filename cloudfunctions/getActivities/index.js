const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function canManageActivity(openid) {
  if (!openid) return false
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true, activityAdmin: true, permissions: true })
    .limit(1)
    .get()
  const user = (res.data || [])[0] || {}
  return user.userType === 'admin' || !!user.activityAdmin || !!((user.permissions || {}).activityAdmin)
}

function formatDate(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const manage = await canManageActivity(OPENID)
  const status = manage && event.includeDrafts ? db.command.in(['published', 'draft']) : 'published'

  try {
    const res = await db.collection('activities')
      .where({ status })
      .orderBy('pinned', 'desc')
      .orderBy('publishedAtMs', 'desc')
      .limit(Math.min(Number(event.limit) || 50, 100))
      .get()
    const data = (res.data || []).map(item => ({
      ...item,
      dateLabel: item.displayDate || formatDate(item.publishedAtMs || item.createdAtMs),
      typeLabel: item.type === 'announcement' ? '更新公告'
        : item.type === 'article' ? '公众号'
          : item.type === 'collaboration' ? '联名'
            : '活动'
    }))
    return { code: 0, data, canManage: manage }
  } catch (e) {
    const msg = String(e && (e.message || e.errMsg) || '')
    if (msg.includes('collection not exist') || msg.includes('-502005')) {
      return { code: 0, data: [], canManage: manage }
    }
    return { code: -1, msg }
  }
}
