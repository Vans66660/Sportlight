const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const [ordersRes, eventsRes] = await Promise.all([
      db.collection('orders')
        .where({ bossOpenid: OPENID, newApplicantsCount: _.gt(0) })
        .field({ newApplicantsCount: true })
        .limit(50)
        .get(),
      db.collection('posts')
        .where({ openid: OPENID, postType: 'event' })
        .field({ pendingTeams: true })
        .limit(50)
        .get()
    ])
    const orderCount = ordersRes.data.reduce((sum, o) => sum + (o.newApplicantsCount || 0), 0)
    const eventCount = eventsRes.data.reduce((sum, p) => sum + (p.pendingTeams || 0), 0)
    return { code: 0, count: orderCount + eventCount }
  } catch (e) {
    return { code: 0, count: 0 }
  }
}
