const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return (res.data || []).some(user => user.userType === 'admin')
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    if (!(await ensureAdmin(OPENID))) return { code: -1, msg: '无权限' }
    const keys = [
      { key: 'WXPAY_MCHID', label: '商户号' },
      { key: 'WXPAY_APPID', label: '小程序 AppID' },
      { key: 'WXPAY_SERIAL_NO', label: '商户证书序列号' },
      { key: 'WXPAY_PRIVATE_KEY', label: '商户私钥' },
      { key: 'WXPAY_API_V3_KEY', label: 'API v3 密钥' },
      { key: 'WXPAY_PLATFORM_PUBLIC_KEY', label: '微信支付平台公钥' },
      { key: 'SOLO_GAME_NOTIFY_URL', label: '约场支付回调地址' }
    ]
    return {
      code: 0,
      data: keys.map(item => ({
        ...item,
        configured: !!process.env[item.key]
      }))
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
