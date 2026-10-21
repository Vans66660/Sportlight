const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function checkTextSafe(content) {
  const result = await cloud.openapi.security.msgSecCheck({
    content: String(content || '').slice(0, 500000)
  })
  const errCode = result.errCode !== undefined ? result.errCode : result.errcode
  if (errCode === 0) return true
  if (errCode === 87014) return false
  throw new Error('内容审核服务异常')
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, content } = event

  if (!content || !content.trim()) return { code: -1, msg: '评论不能为空' }
  const trimmedContent = content.trim()

  try {
    const safe = await checkTextSafe(trimmedContent)
    if (!safe) return { code: -1, msg: '评论含有不适宜内容，请修改后重试' }

    let name = '', photo = ''
    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).get()
    if (athleteRes.data.length > 0) {
      name = athleteRes.data[0].name || ''
      photo = athleteRes.data[0].photo || ''
    } else {
      const userRes = await db.collection('users').where({ openid: OPENID }).get()
      if (userRes.data.length > 0) {
        const u = userRes.data[0]
        name = u.name || u.nickName || ''
        photo = u.logo || u.avatarUrl || ''
      }
    }

    try { await db.createCollection('comments') } catch (e) {}

    const addRes = await db.collection('comments').add({
      data: {
        postId,
        openid: OPENID,
        authorName: name,
        authorPhoto: photo,
        content: trimmedContent,
        createdAt: db.serverDate()
      }
    })

    await db.collection('posts').doc(postId).update({
      data: { commentCount: db.command.inc(1) }
    })

    // 通知帖子作者（不通知自己）
    try {
      const postRes = await db.collection('posts').doc(postId).field({ openid: true, content: true }).get()
      const post = postRes.data
      if (post.openid && post.openid !== OPENID) {
        await db.collection('notifications').add({
          data: {
            toOpenid: post.openid,
            fromOpenid: OPENID,
            fromName: name,
            type: 'comment',
            postId,
            eventContent: trimmedContent.slice(0, 40),
            read: false,
            createdAt: db.serverDate()
          }
        })
      }
    } catch (e) {}

    // Return the new comment with a temp URL for the photo
    let photoUrl = photo
    if (photo && photo.startsWith('cloud://')) {
      try {
        const t = await cloud.getTempFileURL({ fileList: [photo] })
        photoUrl = t.fileList[0].tempFileURL || photo
      } catch (e) {}
    }

    return {
      code: 0,
      comment: {
        _id: addRes._id,
        openid: OPENID,
        authorName: name,
        authorPhotoUrl: photoUrl,
        content: trimmedContent,
        createdAt: new Date().toISOString()
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
