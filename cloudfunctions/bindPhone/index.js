const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { code } = event

  if (!OPENID) return { code: -1, msg: '未获取到微信身份' }
  if (!code) return { code: -1, msg: '缺少手机号授权码' }

  try {
    const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({ code })
    const phoneInfo = phoneRes.phoneInfo || {}
    const phoneNumber = phoneInfo.phoneNumber || ''
    const purePhoneNumber = phoneInfo.purePhoneNumber || phoneNumber
    const countryCode = phoneInfo.countryCode || ''

    if (!phoneNumber) return { code: -1, msg: '未获取到手机号' }

    const data = {
      phone: phoneNumber,
      purePhoneNumber,
      countryCode,
      phoneVerified: true,
      phoneBoundAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    const updateRes = await db.collection('users').where({ openid: OPENID }).update({ data })
    if (!updateRes.stats || updateRes.stats.updated === 0) {
      await db.collection('users').add({
        data: {
          openid: OPENID,
          userType: '',
          registered: false,
          createdAt: db.serverDate(),
          ...data
        }
      })
    }

    return {
      code: 0,
      msg: 'success',
      phone: phoneNumber,
      purePhoneNumber,
      countryCode
    }
  } catch (e) {
    return { code: -1, msg: e.message || '手机号绑定失败' }
  }
}
