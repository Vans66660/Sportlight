const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function toTempURLs(urls) {
  const cloudUrls = urls.filter(url => url && url.startsWith('cloud://'))
  if (!cloudUrls.length) return {}
  try {
    const res = await cloud.getTempFileURL({ fileList: cloudUrls })
    const map = {}
    res.fileList.forEach(item => { if (item.tempFileURL) map[item.fileID] = item.tempFileURL })
    return map
  } catch (e) {
    return {}
  }
}

function isCollectionMissing(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    const res = await db.collection('friends')
      .where({ userOpenid: OPENID, status: 'active' })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get()
    const tempMap = await toTempURLs((res.data || []).map(item => item.friendAvatar || ''))
    const data = (res.data || []).map(item => ({
      ...item,
      friendAvatar: tempMap[item.friendAvatar] || item.friendAvatar || ''
    }))
    return { code: 0, data }
  } catch (e) {
    if (isCollectionMissing(e)) return { code: 0, data: [] }
    return { code: -1, msg: e.message }
  }
}
