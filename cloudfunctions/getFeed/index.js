const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { page = 0, limit = 15 } = event

  try {
    let friendOpenids = []
    try {
      const friendRes = await db.collection('friends')
        .where({ userOpenid: OPENID, status: 'active' })
        .field({ friendOpenid: true })
        .limit(500)
        .get()
      friendOpenids = (friendRes.data || []).map(item => item.friendOpenid).filter(Boolean)
    } catch (e) {}

    const res = await db.collection('posts')
      .where({ postType: _.neq('event') })
      .orderBy('createdAt', 'desc')
      .skip(page * limit)
      .limit(limit * 3)
      .get()

    const posts = (res.data || []).filter(p => {
      const visibility = p.visibility || 'public'
      if (p.openid === OPENID) return true
      if (visibility === 'private') return false
      if (visibility === 'friends') return friendOpenids.includes(p.openid)
      return true
    }).slice(0, limit)

    const fileIDs = []
    posts.forEach(p => {
      const photo = p.authorPhoto || p.athletePhoto
      if (photo && photo.startsWith('cloud://')) fileIDs.push(photo)
      ;(p.images || []).forEach(img => {
        if (img && img.startsWith('cloud://')) fileIDs.push(img)
      })
    })

    let urlMap = {}
    if (fileIDs.length > 0) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: [...new Set(fileIDs)] })
        tempRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
      } catch (e) {}
    }

    const data = posts.map(p => {
      const rawPhoto = p.authorPhoto || p.athletePhoto || ''
      const { likedBy, ...rest } = p
      return {
        ...rest,
        authorType: p.authorType || 'athlete',
        authorName: p.authorName || p.athleteName || '',
        visibility: p.visibility || 'public',
        visibilityLabel: p.visibility === 'friends' ? '好友可见' : (p.visibility === 'private' ? '仅自己' : '公开'),
        authorPhotoUrl: urlMap[rawPhoto] || rawPhoto,
        imageUrls: (p.images || []).map(img => urlMap[img] || img),
        liked: (likedBy || []).includes(OPENID),
        isAuthor: p.openid === OPENID
      }
    })

    return { code: 0, data, hasMore: res.data.length === limit * 3 }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
