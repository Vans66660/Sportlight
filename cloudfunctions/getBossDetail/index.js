const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isRealOrder(order) {
  return !(
    order.directChat ||
    order.teamCaptainChat ||
    order.chatKind ||
    order.mode === 'direct' ||
    order.mode === 'team_contact' ||
    order.type === 'team_contact'
  )
}

async function getBossProfile(openid, fallback = {}) {
  const res = await db.collection('bosses').where({ openid }).limit(1).get().catch(() => ({ data: [] }))
  return {
    ...(fallback || {}),
    ...((res.data || [])[0] || {})
  }
}

async function isFriend(viewerOpenid, targetOpenid) {
  if (!viewerOpenid || !targetOpenid || viewerOpenid === targetOpenid) return viewerOpenid === targetOpenid
  const res = await db.collection('friends')
    .where({ userOpenid: viewerOpenid, friendOpenid: targetOpenid, status: 'active' })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))
  return (res.data || []).length > 0
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { bossOpenid } = event

  try {
    const userRes = await db.collection('users').where({ openid: bossOpenid }).limit(1).get()
    if (userRes.data.length === 0) return { code: -1, msg: '用户不存在' }
    const user = userRes.data[0]
    const boss = await getBossProfile(bossOpenid, user)

    const [ordersRes, postsRes, allOrdersRes] = await Promise.all([
      db.collection('orders').where({ bossOpenid }).orderBy('createdAt', 'desc').limit(50).get(),
      db.collection('posts').where({ openid: bossOpenid }).orderBy('createdAt', 'desc').limit(10).get(),
      db.collection('orders').where({ bossOpenid }).field({ directChat: true, teamCaptainChat: true, chatKind: true, mode: true, type: true, status: true }).limit(100).get()
    ])
    const orders = (ordersRes.data || []).filter(isRealOrder).slice(0, 10)
    const allOrders = (allOrdersRes.data || []).filter(isRealOrder)
    const orderCount = allOrders.length
    const doneCount = allOrders.filter(o => o.status === 'done').length
    const friend = await isFriend(OPENID, bossOpenid)
    const recentPosts = postsRes.data.filter(p => {
      const visibility = p.visibility || 'public'
      if (bossOpenid === OPENID) return true
      if (visibility === 'private') return false
      if (visibility === 'friends') return friend
      return true
    }).slice(0, 3).map(p => ({
      _id: p._id,
      type: p.type || 'general',
      content: p.content || '',
      createdAt: p.createdAt,
      visibility: p.visibility || 'public',
      likesCount: p.likesCount || 0
    }))

    return {
      code: 0,
      data: {
        name: boss.name || '老板',
        displayName: boss.displayName || boss.name || '',
        sportlightId: boss.sportlightId || user.sportlightId || '',
        logo: boss.logo || '',
        bossType: boss.bossType || '',
        city: boss.city || '',
        description: boss.description || '',
        wechatVerified: boss.wechatVerified || false,
        phoneVerified: boss.phoneVerified || user.phoneVerified || false,
        orderCount,
        doneCount,
        recentPosts
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
