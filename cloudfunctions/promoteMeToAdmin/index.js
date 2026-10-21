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
  const { OPENID, APPID, UNIONID } = cloud.getWXContext()
  const { adminKey } = event || {}

  if (!OPENID) {
    return { code: -1, msg: '请从小程序端登录后调用' }
  }

  try {
    const expectedKey = process.env.ADMIN_BOOTSTRAP_KEY || ''
    if (!expectedKey) {
      return { code: -1, msg: '管理员升级密钥未配置，请先在云函数环境变量 ADMIN_BOOTSTRAP_KEY 中设置密钥' }
    }
    if (!process.env.ADMIN_BOOTSTRAP_OPENID) {
      return { code: -1, msg: '管理员 OPENID 白名单未配置，请先设置 ADMIN_BOOTSTRAP_OPENID' }
    }
    if (!isAllowedBootstrapOpenid(OPENID)) {
      return { code: -1, msg: '当前微信账号不在管理员初始化白名单中' }
    }
    if (!adminKey || adminKey !== expectedKey) {
      return { code: -1, msg: '管理员升级密钥错误' }
    }

    const res = await db.collection('users').where({ openid: OPENID }).get()
    if (res.data.length === 0) {
      await db.collection('users').add({
        data: {
          openid: OPENID,
          unionid: UNIONID || '',
          appid: APPID || '',
          userType: 'admin',
          isPlatformAdmin: true,
          registered: true,
          name: 'Sportlight 管理员',
          nickName: '',
          phone: '',
          gender: 0,
          adminPromotedAt: db.serverDate(),
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      return { code: 0, msg: '已创建并升级为管理员' }
    }

    const user = res.data[0]
    if (user.userType === 'admin') {
      return { code: 0, msg: '你已经是管理员了' }
    }

    await db.collection('users').doc(user._id).update({
      data: {
        userType: 'admin',
        isPlatformAdmin: true,
        previousUserType: user.userType || user.activeUserType || '',
        previousSubjectTypes: user.subjectTypes || [],
        adminPromotedAt: db.serverDate()
      }
    })

    return { code: 0, msg: '已升级为管理员' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
