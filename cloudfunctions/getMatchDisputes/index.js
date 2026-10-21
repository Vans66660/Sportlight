const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    if (!userRes.data.length || userRes.data[0].userType !== 'admin') {
      return { code: -1, msg: '无权访问' }
    }
    const { status = 'pending' } = event
    const limit = Math.min(Math.max(Number(event.limit) || 30, 1), 50)
    const page = Math.max(Number(event.page) || 0, 0)
    const condition = status === 'all' ? {} : { status }
    const res = await db.collection('matchDisputes')
      .where(condition)
      .orderBy('createdAt', 'desc')
      .skip(page * limit)
      .limit(limit)
      .get()
    return { code: 0, data: res.data, page, hasMore: res.data.length === limit }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
