const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureCollection(name) { try { await db.createCollection(name) } catch (e) {} }
async function profileOf(openid) {
  const [athleteRes, userRes] = await Promise.all([
    db.collection('athletes').where({ openid }).limit(1).get().catch(() => ({ data: [] })),
    db.collection('users').where({ openid }).limit(1).get().catch(() => ({ data: [] }))
  ])
  return athleteRes.data[0] || userRes.data[0] || {}
}
function display(a) { return a.displayName || a.nickname || a.name || `用户${a.sportlightId || ''}` }
function chatIdFor(a, b) { return `friend_${[a, b].sort().join('_')}`.replace(/[^\w-]/g, '_').slice(0, 180) }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const requestId = String((event && event.requestId) || '')
  const action = String((event && event.action) || '')
  if (!requestId || !['approve', 'reject'].includes(action)) return { code: -1, msg: '参数错误' }
  try {
    await Promise.all(['friends', 'conversations', 'notifications'].map(ensureCollection))
    const reqRes = await db.collection('friendRequests').doc(requestId).get()
    const req = reqRes.data || {}
    if (req.toOpenid !== OPENID) return { code: -1, msg: '无权限' }
    if (req.status !== 'pending') return { code: -1, msg: '该申请已处理' }
    const now = db.serverDate()
    // 申请处理完不保留待办数据或通知卡片，避免用户反复看到已处理的申请。
    await Promise.all([
      db.collection('friendRequests').doc(requestId).remove(),
      db.collection('notifications').where({ toOpenid: OPENID, type: 'friend_request', requestId }).remove().catch(() => null)
    ])
    if (action === 'reject') return { code: 0, msg: '已拒绝' }
    const [from, to] = await Promise.all([profileOf(req.fromOpenid), profileOf(req.toOpenid)])
    const docs = [
      { userOpenid: req.fromOpenid, friendOpenid: req.toOpenid, friendSportlightId: to.sportlightId || '', friendDisplayName: display(to), friendAvatar: to.photo || to.logo || to.avatarUrl || '', remarkName: '', status: 'active', createdAt: now, updatedAt: now },
      { userOpenid: req.toOpenid, friendOpenid: req.fromOpenid, friendSportlightId: from.sportlightId || '', friendDisplayName: display(from), friendAvatar: from.photo || from.logo || from.avatarUrl || '', remarkName: '', status: 'active', createdAt: now, updatedAt: now }
    ]
    await Promise.all(docs.map(d => db.collection('friends').add({ data: d })))
    const chatId = chatIdFor(req.fromOpenid, req.toOpenid)
    await db.collection('conversations').doc(chatId).set({
      data: {
        orderId: chatId,
        bossOpenid: req.fromOpenid,
        athleteOpenid: req.toOpenid,
        participants: [req.fromOpenid, req.toOpenid],
        chatKind: 'friend',
        directChat: true,
        title: `${display(from)} 与 ${display(to)}`,
        lastMsg: '你们已成为好友',
        lastMsgTime: now,
        createdAt: now,
        updatedAt: now
      }
    })
    await db.collection('notifications').add({ data: { toOpenid: req.fromOpenid, type: 'friend_approved', fromOpenid: OPENID, fromName: display(to), content: `${display(to)} 已通过你的好友申请`, read: false, createdAt: now } })
    return { code: 0, msg: '已成为好友', orderId: chatId }
  } catch (e) { return { code: -1, msg: e.message } }
}
