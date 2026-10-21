const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { page = 0, limit = 15 } = event

  try {
    const res = await db.collection('posts')
      .where({ openid: OPENID })
      .orderBy('createdAt', 'desc')
      .skip(page * limit)
      .limit(limit)
      .get()

    return {
      code: 0,
      data: res.data,
      hasMore: res.data.length === limit
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
