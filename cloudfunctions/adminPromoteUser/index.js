const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return res.data.length > 0 && res.data[0].userType === 'admin'
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const { targetOpenid = '', confirm = '' } = event

  if (!targetOpenid) return { code: -1, msg: '缺少目标用户 openid' }
  if (confirm !== 'PROMOTE_ADMIN') return { code: -1, msg: '缺少确认参数' }

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const userRes = await db.collection('users').where({ openid: targetOpenid }).limit(1).get()
    const user = userRes.data[0] || {}
    if (!user._id) return { code: -1, msg: '目标用户不存在' }
    if (user.userType === 'admin') return { code: 0, msg: '目标用户已经是管理员' }

    await db.collection('users').doc(user._id).update({
      data: {
        previousUserType: user.userType || '',
        userType: 'admin',
        activeUserType: 'admin',
        registered: true,
        adminPromotedAt: db.serverDate(),
        adminPromotedBy: OPENID,
        updatedAt: db.serverDate()
      }
    })

    return { code: 0, msg: '已设为管理员' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
