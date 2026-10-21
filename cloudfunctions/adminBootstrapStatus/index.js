const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function isAllowedBootstrapOpenid(openid) {
  const allowlist = (process.env.ADMIN_BOOTSTRAP_OPENID || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  return !!openid && allowlist.includes(openid)
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  if (!OPENID) return { code: -1, msg: '无法识别微信身份', eligible: false }

  try {
    const userRes = await db.collection('users')
      .where({ openid: OPENID })
      .field({ userType: true, registered: true })
      .limit(1)
      .get()
    const user = userRes.data[0] || null
    const isAdmin = !!(user && user.userType === 'admin')
    const canBootstrap = isAdmin || isAllowedBootstrapOpenid(OPENID)

    return {
      code: 0,
      eligible: canBootstrap,
      isAdmin,
      hasUser: !!user
    }
  } catch (e) {
    return { code: -1, msg: e.message, eligible: false }
  }
}
