const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    const res = await db.collection('playerCards').where({ ownerOpenid: OPENID, seen: false }).limit(100).get()
    await Promise.all((res.data || []).map(card => db.collection('playerCards').doc(card._id).update({ data: { seen: true, seenAt: db.serverDate(), updatedAt: db.serverDate() } })))
    return { code: 0, updated: (res.data || []).length }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
