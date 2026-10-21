const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    const user = await db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    if (!user.data.length || user.data[0].userType !== 'admin') return { code: -1, msg: '无权限' }
    const res = await db.collection('deletedPosts').orderBy('deletedAt', 'desc').limit(100).get()
    return { code: 0, data: (res.data || []).map(item => ({ ...item, contentPreview: String((item.post || {}).content || (item.post || {}).title || '无内容').slice(0, 100) })) }
  } catch (e) {
    return { code: -1, msg: e.message || '加载失败' }
  }
}
