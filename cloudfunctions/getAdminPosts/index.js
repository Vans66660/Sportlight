const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureAdmin(openid) {
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true })
    .limit(1)
    .get()
  return !!(res.data.length && res.data[0].userType === 'admin')
}

function formatDate(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { page = 0, limit = 50 } = event || {}

  try {
    if (!await ensureAdmin(OPENID)) return { code: -1, msg: '无权限' }

    const res = await db.collection('posts')
      .orderBy('createdAt', 'desc')
      .skip(Number(page) * Number(limit))
      .limit(Math.min(Number(limit) || 50, 100))
      .get()

    const posts = res.data || []
    const fileIDs = []
    posts.forEach(post => {
      const avatar = post.authorPhoto || post.athletePhoto || post.logo || ''
      if (avatar && avatar.startsWith('cloud://')) fileIDs.push(avatar)
      ;(post.images || []).forEach(img => {
        if (img && img.startsWith('cloud://')) fileIDs.push(img)
      })
    })

    const tempMap = {}
    if (fileIDs.length) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: [...new Set(fileIDs)] })
        ;(tempRes.fileList || []).forEach(file => {
          if (file.fileID && file.tempFileURL) tempMap[file.fileID] = file.tempFileURL
        })
      } catch (e) {}
    }

    const data = posts.map(post => {
      const avatar = post.authorPhoto || post.athletePhoto || post.logo || ''
      const images = post.images || []
      return {
        _id: post._id,
        postType: post.postType || 'post',
        type: post.type || '',
        typeLabel: post.postType === 'event' ? '赛事' : (post.type || '动态'),
        title: post.title || '',
        content: post.content || '',
        contentPreview: (post.title || post.content || '（无内容）').slice(0, 120),
        authorName: post.authorName || post.athleteName || post.name || '未知用户',
        authorType: post.authorType || '',
        authorOpenid: post.openid || '',
        authorAvatar: tempMap[avatar] || avatar,
        imageUrls: images.map(img => tempMap[img] || img),
        imageCount: images.length,
        likesCount: post.likesCount || 0,
        commentsCount: post.commentsCount || 0,
        eventDate: post.eventDate || '',
        eventLocation: post.eventLocation || '',
        createdAtLabel: formatDate(post.createdAt),
        createdAt: post.createdAt
      }
    })

    return { code: 0, data, hasMore: posts.length === Math.min(Number(limit) || 50, 100) }
  } catch (e) {
    return { code: -1, msg: e.message || '加载失败' }
  }
}
