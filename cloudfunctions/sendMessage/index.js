const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function checkTextSafe(content) {
  const result = await cloud.openapi.security.msgSecCheck({
    content: String(content || '').slice(0, 500000)
  })
  const errCode = result.errCode !== undefined ? result.errCode : result.errcode
  if (errCode === 0) return true
  if (errCode === 87014) return false
  throw new Error('内容审核服务异常')
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { orderId, content } = event

  if (!orderId || !content || !String(content).trim()) return { code: -1, msg: '参数缺失' }
  const trimmed = String(content).trim().slice(0, 1000)

  try {
    const safe = await checkTextSafe(trimmed)
    if (!safe) return { code: -1, msg: '消息含有不适宜内容，请修改后重试' }

    let bossOpenid, athleteOpenid, participants = []
    let hasConversation = false

    try {
      const convRes = await db.collection('conversations').doc(orderId).get()
      bossOpenid = convRes.data.bossOpenid
      athleteOpenid = convRes.data.athleteOpenid
      participants = convRes.data.participants || [bossOpenid, athleteOpenid].filter(Boolean)
      hasConversation = true
    } catch (_) {
      // conversations 文档不存在时降级查 orders
      const orderRes = await db.collection('orders').doc(orderId).get()
      bossOpenid = orderRes.data.bossOpenid
      athleteOpenid = orderRes.data.athleteOpenid
      participants = [bossOpenid, athleteOpenid].filter(Boolean)
    }

    if (!participants.includes(OPENID)) {
      return { code: -1, msg: '无权操作' }
    }

    const toOpenid = participants.find(id => id && id !== OPENID)
    if (!toOpenid) return { code: -1, msg: '无法找到接收方' }

    const result = await db.collection('messages').add({
      data: {
        orderId,
        fromOpenid: OPENID,
        toOpenid,
        type: 'text',
        content: trimmed,
        createdAt: db.serverDate(),
        read: false
      }
    })

    const conversationUpdate = {
      lastMsg: trimmed,
      lastMsgTime: db.serverDate(),
      updatedAt: db.serverDate()
    }

    if (hasConversation) {
      await db.collection('conversations').doc(orderId).update({ data: conversationUpdate })
    } else {
      await db.collection('conversations').doc(orderId).set({
        data: {
          orderId,
          bossOpenid,
          athleteOpenid,
          participants,
          ...conversationUpdate
        }
      })
    }

    return { code: 0, msgId: result._id }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
