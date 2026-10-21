const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollection(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist')
}

async function ensureCollection() {
  try { await db.createCollection('eventAdmins') } catch (e) {}
}

async function getUser(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return (res.data || [])[0] || {}
}

async function canManageOwner(post, openid) {
  if (!post || post.postType !== 'event') return false
  if (post.openid === openid) return true
  const user = await getUser(openid)
  return user.userType === 'admin'
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { postId } = event || {}
  if (!postId) return { code: -1, msg: 'postId 缺失' }

  try {
    await ensureCollection()
    const postRes = await db.collection('posts').doc(postId).get()
    const post = postRes.data
    if (!await canManageOwner(post, OPENID)) return { code: -1, msg: '无权限管理协作管理员' }

    const res = await db.collection('eventAdmins')
      .where({ postId })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get()
      .catch(e => {
        if (isMissingCollection(e)) return { data: [] }
        throw e
      })

    const data = (res.data || []).map(item => ({
      _id: item._id,
      postId: item.postId,
      adminOpenid: item.adminOpenid,
      adminName: item.adminName || item.adminNickname || '',
      adminNickname: item.adminNickname || '',
      sportlightId: item.sportlightId || '',
      role: item.role || 'full',
      roleLabel: item.role === 'score' ? '成绩管理员' : '全部权限',
      status: item.status || 'pending',
      statusLabel: item.status === 'accepted' ? '已接受' : item.status === 'declined' ? '已拒绝' : '待接受'
    }))

    return { code: 0, data }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
