const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { eventAdminId, notificationId, action } = event || {}
  if (!eventAdminId || !['accept', 'decline'].includes(action)) return { code: -1, msg: '参数无效' }

  try {
    const adminRes = await db.collection('eventAdmins').doc(eventAdminId).get()
    const admin = adminRes.data
    if (!admin || admin.adminOpenid !== OPENID) return { code: -1, msg: '邀请不存在' }
    if (admin.status !== 'pending') return { code: -1, msg: '该邀请已处理' }

    const status = action === 'accept' ? 'accepted' : 'declined'
    await db.collection('eventAdmins').doc(eventAdminId).update({
      data: {
        status,
        respondedAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    if (notificationId) {
      await db.collection('notifications').doc(notificationId).update({
        data: { responded: true, responseAction: action, read: true }
      }).catch(() => null)
    }

    await db.collection('notifications').add({
      data: {
        fromOpenid: OPENID,
        toOpenid: admin.ownerOpenid,
        type: action === 'accept' ? 'event_admin_accepted' : 'event_admin_declined',
        content: `${admin.adminName || '用户'}${action === 'accept' ? '已接受' : '已拒绝'}《${admin.eventTitle || '赛事'}》管理员邀请`,
        postId: admin.postId,
        read: false,
        createdAt: db.serverDate()
      }
    }).catch(() => null)

    return { code: 0, msg: action === 'accept' ? '已接受邀请' : '已拒绝邀请' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
