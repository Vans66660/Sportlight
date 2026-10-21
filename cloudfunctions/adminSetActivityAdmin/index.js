const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return !!((res.data || [])[0] && res.data[0].userType === 'admin')
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const targetOpenid = String(event.targetOpenid || '').trim()
  const enabled = event.enabled !== false
  if (!targetOpenid) return { code: -1, msg: '缺少目标用户 openid' }
  if (event.confirm !== 'SET_ACTIVITY_ADMIN') return { code: -1, msg: '缺少确认参数' }

  try {
    if (!await ensureAdmin(OPENID)) return { code: -1, msg: '无权限' }
    const userRes = await db.collection('users').where({ openid: targetOpenid }).limit(1).get()
    const user = (userRes.data || [])[0] || {}
    if (!user._id) return { code: -1, msg: '目标用户不存在' }
    await db.collection('users').doc(user._id).update({
      data: {
        activityAdmin: enabled,
        'permissions.activityAdmin': enabled,
        activityAdminUpdatedAt: db.serverDate(),
        activityAdminUpdatedBy: OPENID,
        updatedAt: db.serverDate()
      }
    })
    return { code: 0, msg: enabled ? '已设为活动管理员' : '已取消活动管理员' }
  } catch (e) {
    return { code: -1, msg: e.message || e.errMsg || '操作失败' }
  }
}
