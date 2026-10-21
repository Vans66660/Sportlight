const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  try {
    const [messageRes, notifRes] = await Promise.all([
      db.collection('messages')
        .where({ toOpenid: OPENID, read: false })
        .count(),
      db.collection('notifications')
        .where({ toOpenid: OPENID, read: false })
        .count()
    ])

    const messageCount = messageRes.total || 0
    const notificationCount = notifRes.total || 0
    return { code: 0, count: messageCount + notificationCount, messageCount, notificationCount }
  } catch (e) {
    return { code: 0, count: 0 }
  }
}
