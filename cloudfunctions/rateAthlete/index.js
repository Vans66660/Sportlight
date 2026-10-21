const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { orderId, rating, comment } = event

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { code: -1, msg: '评分无效，请选择 1-5 星' }
  }

  try {
    // 验证订单
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data

    if (order.bossOpenid !== OPENID) {
      return { code: -1, msg: '只有发单人才能评分' }
    }

    if (order.status !== 'done') {
      return { code: -1, msg: '订单未完成，无法评分' }
    }

    if (order.rated) {
      return { code: -1, msg: '已经评过分了' }
    }

    // 更新订单评分状态
    await db.collection('orders').doc(orderId).update({
      data: {
        rated: true,
        rating,
        comment,
        ratedAt: db.serverDate()
      }
    })

    // 更新运动员评分
    const athleteRes = await db.collection('athletes')
      .where({ openid: order.athleteOpenid })
      .get()

    if (athleteRes.data.length > 0) {
      const athlete = athleteRes.data[0]
      const oldRating = athlete.rating || 0
      const oldCount = athlete.ratingCount || 0
      const newCount = oldCount + 1
      const newRating = ((oldRating * oldCount) + rating) / newCount

      // 评分影响信誉分：5★+3, 4★+1, 3★0, 2★-2, 1★-5
      const repDelta = [0, -5, -2, 0, 1, 3][rating] || 0
      const newRep = Math.max(0, Math.min(100, (athlete.reputation || 80) + repDelta))

      await db.collection('athletes')
        .where({ openid: order.athleteOpenid })
        .update({
          data: {
            rating: Math.round(newRating * 10) / 10,
            ratingCount: newCount,
            reputation: newRep
          }
        })
    }

    return { code: 0, msg: '评分成功' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}