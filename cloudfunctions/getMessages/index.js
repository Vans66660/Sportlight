const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { orderId } = event

  try {
    const convRes = await db.collection('conversations').doc(orderId).get()
    const conv = convRes.data
    const participants = conv.participants || [conv.bossOpenid, conv.athleteOpenid].filter(Boolean)
    if (!participants.includes(OPENID)) {
      return { code: -1, msg: '无权限' }
    }

    const result = await db.collection('messages')
      .where({ orderId })
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get()

    return { code: 0, data: result.data }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
