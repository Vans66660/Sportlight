const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function isPlatformAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return !!((res.data || [])[0] && res.data[0].userType === 'admin')
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { eventAdminId } = event || {}
  if (!eventAdminId) return { code: -1, msg: '参数缺失' }

  try {
    const adminRes = await db.collection('eventAdmins').doc(eventAdminId).get()
    const admin = adminRes.data
    if (!admin) return { code: -1, msg: '管理员记录不存在' }
    const postRes = await db.collection('posts').doc(admin.postId).get()
    const post = postRes.data
    if (!post || (post.openid !== OPENID && !await isPlatformAdmin(OPENID))) {
      return { code: -1, msg: '无权限移除管理员' }
    }
    await db.collection('eventAdmins').doc(eventAdminId).update({
      data: { status: 'removed', removedAt: db.serverDate(), updatedAt: db.serverDate() }
    })
    if (admin.adminOpenid) {
      await db.collection('notifications').add({
        data: {
          fromOpenid: OPENID,
          toOpenid: admin.adminOpenid,
          type: 'event_admin_removed',
          content: `你已被移出《${admin.eventTitle || post.title || '赛事'}》协作管理员`,
          postId: admin.postId,
          read: false,
          createdAt: db.serverDate()
        }
      }).catch(() => null)
    }
    return { code: 0, msg: '已移除' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
