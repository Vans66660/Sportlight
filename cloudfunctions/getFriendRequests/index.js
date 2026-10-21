const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isCollectionMissing(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    const [received, sent] = await Promise.all([
      db.collection('friendRequests').where({ toOpenid: OPENID, status: 'pending' }).orderBy('createdAt', 'desc').limit(50).get(),
      db.collection('friendRequests').where({ fromOpenid: OPENID, status: 'pending' }).orderBy('createdAt', 'desc').limit(50).get()
    ])
    return { code: 0, received: received.data || [], sent: sent.data || [] }
  } catch (e) {
    if (isCollectionMissing(e)) return { code: 0, received: [], sent: [] }
    return { code: -1, msg: e.message }
  }
}
