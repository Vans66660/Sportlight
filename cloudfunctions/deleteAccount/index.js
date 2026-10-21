const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 注销账号：删除用户在 users、bosses、athletes、posts、orders、messages 等集合中的数据
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  try {
    // 1. 删除 athletes 集合中的运动员资料
    try {
      await db.collection('athletes').where({ openid: OPENID }).remove()
    } catch (e) { console.error('deleteAccount athletes error:', e) }

    try {
      await db.collection('bosses').where({ openid: OPENID }).remove()
    } catch (e) { console.error('deleteAccount bosses error:', e) }

    // 2. 删除用户发布的动态和赛事
    try {
      await db.collection('posts').where({ openid: OPENID }).remove()
    } catch (e) { console.error('deleteAccount posts error:', e) }

    // 3. 删除用户发布的订单
    try {
      await db.collection('orders').where({ bossOpenid: OPENID }).remove()
    } catch (e) { console.error('deleteAccount orders error:', e) }

    // 4. 删除用户的评论
    try {
      await db.collection('comments').where({ openid: OPENID }).remove()
    } catch (e) { console.error('deleteAccount comments error:', e) }

    // 5. 删除用户的消息
    try {
      await db.collection('messages').where(
        db.command.or([{ fromOpenid: OPENID }, { toOpenid: OPENID }])
      ).remove()
    } catch (e) { console.error('deleteAccount messages error:', e) }

    // 6. 删除用户的通知
    try {
      await db.collection('notifications').where({ toOpenid: OPENID }).remove()
    } catch (e) { console.error('deleteAccount notifications error:', e) }

    // 7. 删除赛事报名记录
    try {
      await db.collection('eventRegistrations').where({ openid: OPENID }).remove()
    } catch (e) { console.error('deleteAccount eventRegistrations error:', e) }

    // 8. 最后删除 users 集合中的用户记录
    await db.collection('users').where({ openid: OPENID }).remove()

    return { code: 0, msg: '账号已注销' }
  } catch (e) {
    console.error('Delete account error:', e)
    return { code: -1, msg: '注销失败，请稍后重试' }
  }
}
