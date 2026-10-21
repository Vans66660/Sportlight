const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

async function ensureAdmin(openid) {
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true })
    .limit(1)
    .get()
  return !!(res.data.length && res.data[0].userType === 'admin')
}

async function removeWhere(collection, condition) {
  try {
    const res = await db.collection(collection).where(condition).remove()
    return res.stats ? res.stats.removed : 0
  } catch (e) {
    return { error: e.message }
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { openid, confirm } = event || {}
  const targetOpenid = String(openid || '').trim()

  if (!OPENID) return { code: -1, msg: '无法识别管理员身份' }
  if (!targetOpenid) return { code: -1, msg: '缺少目标 openid' }
  if (targetOpenid === OPENID) return { code: -1, msg: '不能重置当前管理员账号' }
  if (confirm !== 'RESET_ACCOUNT') return { code: -1, msg: '缺少确认参数' }

  try {
    if (!await ensureAdmin(OPENID)) return { code: -1, msg: '无权限' }

    const userRes = await db.collection('users')
      .where({ openid: targetOpenid })
      .limit(1)
      .get()
    if (!userRes.data.length) return { code: -1, msg: '目标用户不存在或已重置' }

    const summary = {
      targetOpenid,
      users: await removeWhere('users', { openid: targetOpenid }),
      athletes: await removeWhere('athletes', { openid: targetOpenid })
    }
    await writeAudit({ adminOpenid: OPENID, action: 'user_account_reset', category: 'account', targetType: 'user', targetId: targetOpenid, targetName: userRes.data[0].name || '', detail: { summary } })

    return { code: 0, msg: '账号已重置，下次登录会重新创建未注册用户', summary }
  } catch (e) {
    return { code: -1, msg: e.message || '重置失败' }
  }
}
