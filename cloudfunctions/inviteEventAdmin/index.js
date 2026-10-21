const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function ensureCollection() {
  try { await db.createCollection('eventAdmins') } catch (e) {}
}

async function getUserByOpenid(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  return (res.data || [])[0] || null
}

async function isPlatformAdmin(openid) {
  const user = await getUserByOpenid(openid)
  return !!(user && user.userType === 'admin')
}

function displayName(user = {}) {
  return user.nickname || user.displayName || user.name || user.sportlightId || 'Sportlight 用户'
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, adminOpenid, role = 'full' } = event || {}
  if (!postId || !adminOpenid) return { code: -1, msg: '参数缺失' }
  if (!['full', 'score'].includes(role)) return { code: -1, msg: '权限类型无效' }
  if (adminOpenid === OPENID) return { code: -1, msg: '不能邀请自己' }

  try {
    await ensureCollection()
    const postRes = await db.collection('posts').doc(postId).get()
    const post = postRes.data
    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }
    if (post.openid !== OPENID && !await isPlatformAdmin(OPENID)) return { code: -1, msg: '无权限邀请管理员' }

    const user = await getUserByOpenid(adminOpenid)
    if (!user) return { code: -1, msg: '用户不存在' }

    const existing = await db.collection('eventAdmins')
      .where({ postId, adminOpenid, status: _.in(['pending', 'accepted']) })
      .limit(1)
      .get()
    if ((existing.data || []).length) return { code: -1, msg: '该用户已在管理员列表中' }

    const inviter = await getUserByOpenid(OPENID)
    const eventTitle = post.title || post.content || '赛事'
    const adminName = displayName(user)
    const doc = {
      postId,
      eventTitle,
      ownerOpenid: post.openid,
      invitedByOpenid: OPENID,
      invitedByName: displayName(inviter),
      adminOpenid,
      adminUserId: user._id || '',
      adminName,
      adminNickname: user.nickname || '',
      sportlightId: user.sportlightId || '',
      role,
      status: 'pending',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
    const addRes = await db.collection('eventAdmins').add({ data: doc })
    await db.collection('notifications').add({
      data: {
        fromOpenid: OPENID,
        toOpenid: adminOpenid,
        type: 'event_admin_invite',
        content: `${doc.invitedByName} 邀请你成为《${eventTitle}》的${role === 'score' ? '成绩管理员' : '协作管理员'}`,
        postId,
        eventAdminId: addRes._id,
        role,
        responded: false,
        read: false,
        createdAt: db.serverDate()
      }
    })

    return { code: 0, msg: '已发送邀请' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
