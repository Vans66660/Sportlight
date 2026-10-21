const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId } = event

  try {
    if (!postId) return { code: -1, msg: '缺少动态ID' }

    const transaction = await db.startTransaction()
    let post
    let nextLiked = false
    let nextLikesCount = 0

    try {
      const postRes = await transaction.collection('posts').doc(postId).get()
      post = postRes.data
      const likedBy = Array.isArray(post.likedBy) ? [...new Set(post.likedBy)] : []
      const isLiked = likedBy.includes(OPENID)
      const nextLikedBy = isLiked
        ? likedBy.filter(id => id !== OPENID)
        : [...likedBy, OPENID]

      nextLiked = !isLiked
      nextLikesCount = nextLikedBy.length

      await transaction.collection('posts').doc(postId).update({
        data: {
          likedBy: nextLikedBy,
          likesCount: nextLikesCount
        }
      })
      await transaction.commit()
    } catch (e) {
      await transaction.rollback()
      throw e
    }

    // 新增点赞时通知帖子作者（不通知自己）
    if (nextLiked && post.openid && post.openid !== OPENID) {
      try {
        let fromName = ''
        const athleteRes = await db.collection('athletes').where({ openid: OPENID }).field({ name: true }).limit(1).get()
        if (athleteRes.data.length > 0) {
          fromName = athleteRes.data[0].name || ''
        } else {
          const userRes = await db.collection('users').where({ openid: OPENID }).field({ name: true, nickName: true }).limit(1).get()
          if (userRes.data.length > 0) fromName = userRes.data[0].name || userRes.data[0].nickName || ''
        }
        await db.collection('notifications').add({
          data: {
            toOpenid: post.openid,
            fromOpenid: OPENID,
            fromName,
            type: 'like',
            postId,
            eventContent: (post.content || '').slice(0, 40),
            read: false,
            createdAt: db.serverDate()
          }
        })
      } catch (e) {}
    }

    return { code: 0, liked: nextLiked, likesCount: nextLikesCount }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
