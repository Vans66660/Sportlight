const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function chatIdFor(a, b) { return `friend_${[a, b].sort().join('_')}`.replace(/[^\w-]/g, '_').slice(0, 180) }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const friendOpenid = String((event && event.friendOpenid) || '')
  if (!friendOpenid || friendOpenid === OPENID) return { code: -1, msg: '参数错误' }
  try {
    const friendRes = await db.collection('friends').where({ userOpenid: OPENID, friendOpenid, status: 'active' }).limit(1).get()
    if (!friendRes.data.length) return { code: -1, msg: '成为好友后才能聊天' }
    const chatId = chatIdFor(OPENID, friendOpenid)
    const title = friendRes.data[0].remarkName || friendRes.data[0].friendDisplayName || '好友聊天'
    await db.collection('conversations').doc(chatId).set({
      data: {
        orderId: chatId,
        bossOpenid: OPENID,
        athleteOpenid: friendOpenid,
        participants: [OPENID, friendOpenid],
        chatKind: 'friend',
        directChat: true,
        title,
        lastMsg: '点击进入聊天',
        lastMsgTime: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    return { code: 0, orderId: chatId, title }
  } catch (e) { return { code: -1, msg: e.message } }
}
