const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return !!((res.data || [])[0] && res.data[0].userType === 'admin')
}

async function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const targetOpenid = String((event || {}).targetOpenid || '').trim()
  const reason = String((event || {}).reason || '').trim().slice(0, 120)
  if (!targetOpenid || !reason) return { code: -1, msg: '请填写查看原因' }
  if (!await ensureAdmin(OPENID)) return { code: -1, msg: '无权限' }

  try {
    const res = await db.collection('users').where({ openid: targetOpenid }).field({ openid: true, phone: true, purePhoneNumber: true, name: true, sportlightId: true }).limit(1).get()
    const user = (res.data || [])[0]
    if (!user) return { code: -1, msg: '用户不存在' }
    await writeAudit({
      adminOpenid: OPENID,
      action: 'sensitive_data_view',
      category: 'account',
      targetType: 'user',
      targetId: user.openid,
      targetName: user.name || user.sportlightId || '',
      detail: { reason, fields: ['openid', 'phone'] }
    })
    return {
      code: 0,
      data: {
        openid: user.openid || '',
        phone: user.phone || user.purePhoneNumber || '',
        sportlightId: user.sportlightId || ''
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message || '加载失败' }
  }
}
