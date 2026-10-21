const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 临时云函数：按手机号把用户升级为 admin
// 用完请删除，不要长期保留
exports.main = async (event, context) => {
  const { phone } = event

  if (!phone) {
    return { code: -1, msg: '请传入 phone 参数' }
  }

  try {
    // 查找该手机号的用户
    const res = await db.collection('users')
      .where({ phone })
      .limit(5)
      .get()

    if (res.data.length === 0) {
      return { code: -1, msg: `未找到手机号为 ${phone} 的用户` }
    }

    // 更新所有匹配的用户
    const updated = []
    for (const user of res.data) {
      await db.collection('users').doc(user._id).update({
        data: {
          userType: 'admin',
          updatedAt: db.serverDate()
        }
      })
      updated.push({
        _id: user._id,
        name: user.name || user.nickName || '',
        phone: user.phone,
        userType: 'admin'
      })
    }

    return {
      code: 0,
      msg: `已将 ${updated.length} 个用户升级为 admin`,
      users: updated
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
