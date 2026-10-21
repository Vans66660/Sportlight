const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { keyword } = event
  if (!keyword || keyword.trim().length < 1) return { code: 0, users: [] }

  try {
    const res = await db.collection('athletes')
      .where({ name: db.RegExp({ regexp: keyword.trim(), options: 'i' }) })
      .field({ openid: true, name: true, photo: true })
      .limit(15)
      .get()

    const users = res.data.filter(u => u.openid !== OPENID)

    const cloudIds = [...new Set(users.map(u => u.photo).filter(url => url && url.startsWith('cloud://')))]
    let urlMap = {}
    if (cloudIds.length > 0) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: cloudIds })
        tempRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
      } catch (e) {}
    }

    return {
      code: 0,
      users: users.map(u => ({
        openid: u.openid,
        name: u.name || '',
        photoUrl: urlMap[u.photo] || (u.photo && !u.photo.startsWith('cloud://') ? u.photo : '')
      }))
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
