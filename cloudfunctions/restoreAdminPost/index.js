const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return !!(res.data.length && res.data[0].userType === 'admin')
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const postId = String((event || {}).postId || '').trim()
  if (!postId) return { code: -1, msg: '缺少帖子ID' }
  try {
    if (!await ensureAdmin(OPENID)) return { code: -1, msg: '无权限' }
    const archiveRes = await db.collection('deletedPosts').doc(postId).get()
    const archive = archiveRes.data || {}
    if (!archive.post) return { code: -1, msg: '未找到可恢复的帖子' }
    const expiry = archive.restoreUntil && new Date(archive.restoreUntil).getTime()
    if (expiry && expiry < Date.now()) return { code: -1, msg: '恢复期限已过' }
    const existing = await db.collection('posts').doc(postId).get().catch(() => ({ data: null }))
    if (existing.data) return { code: -1, msg: '帖子已存在，无需恢复' }
    await db.collection('posts').doc(postId).set({ data: { ...archive.post, restoredAt: db.serverDate(), restoredBy: OPENID, updatedAt: db.serverDate() } })
    await db.collection('deletedPosts').doc(postId).remove()
    await db.collection('adminAuditLogs').add({ data: { adminOpenid: OPENID, action: 'post_restore', category: 'content', targetType: 'post', targetId: postId, targetName: String(archive.post.content || archive.post.title || '').slice(0, 80), detail: { deletedBy: archive.deletedBy || '' }, createdAt: db.serverDate() } }).catch(() => null)
    return { code: 0, msg: '帖子已恢复' }
  } catch (e) {
    return { code: -1, msg: e.message || '恢复失败' }
  }
}
