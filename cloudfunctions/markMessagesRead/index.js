const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { orderId } = event

  try {
    const convRes = await db.collection('conversations').doc(orderId).get()
    const conv = convRes.data
    const participants = conv.participants || [conv.bossOpenid, conv.athleteOpenid].filter(Boolean)
    if (!participants.includes(OPENID)) return { code: 0 }

    await db.collection('messages')
      .where({ orderId, fromOpenid: _.neq(OPENID), read: false })
      .update({ data: { read: true } })

    return { code: 0 }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
