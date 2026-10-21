const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function ensureCollection(name) { try { await db.createCollection(name) } catch (e) {} }
async function profileOf(openid) {
  const [athleteRes, userRes] = await Promise.all([
    db.collection('athletes').where({ openid }).limit(1).get().catch(() => ({ data: [] })),
    db.collection('users').where({ openid }).limit(1).get().catch(() => ({ data: [] }))
  ])
  return athleteRes.data[0] || userRes.data[0] || {}
}
function display(a) { return a.displayName || a.nickname || a.name || `用户${a.sportlightId || ''}` }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const toOpenid = String((event && event.toOpenid) || '')
  const message = String((event && event.message) || '').trim().slice(0, 120)
  if (!toOpenid) return { code: -1, msg: '缺少用户' }
  if (toOpenid === OPENID) return { code: -1, msg: '不能添加自己' }
  try {
    await Promise.all(['friendRequests', 'friends', 'notifications'].map(ensureCollection))
    const [me, target] = await Promise.all([profileOf(OPENID), profileOf(toOpenid)])
    if (!target.openid) return { code: -1, msg: '用户不存在' }
    const friendRes = await db.collection('friends').where({ userOpenid: OPENID, friendOpenid: toOpenid, status: 'active' }).limit(1).get()
    if (friendRes.data.length) return { code: -1, msg: '已经是好友' }
    const pending = await db.collection('friendRequests')
      .where(_.or([
        { fromOpenid: OPENID, toOpenid, status: 'pending' },
        { fromOpenid: toOpenid, toOpenid: OPENID, status: 'pending' }
      ])).limit(1).get()
    if (pending.data.length) return { code: -1, msg: '已有待处理申请' }
    const addRes = await db.collection('friendRequests').add({
      data: {
        fromOpenid: OPENID,
        toOpenid,
        fromSportlightId: me.sportlightId || '',
        toSportlightId: target.sportlightId || '',
        fromDisplayName: display(me),
        toDisplayName: display(target),
        message,
        status: 'pending',
        createdAt: db.serverDate()
      }
    })
    await db.collection('notifications').add({
      data: {
        toOpenid,
        type: 'friend_request',
        requestId: addRes._id,
        fromOpenid: OPENID,
        fromName: display(me),
        content: `${display(me)} 想和你成为好友`,
        message,
        read: false,
        createdAt: db.serverDate()
      }
    })
    return { code: 0, requestId: addRes._id }
  } catch (e) { return { code: -1, msg: e.message } }
}
