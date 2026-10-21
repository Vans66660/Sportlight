const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function getTimeValue(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return new Date(value).getTime() || 0
  if (value.$date) return new Date(value.$date).getTime() || 0
  return 0
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()

  try {
    const regRes = await db.collection('event_registrations')
      .where({ captainOpenid: OPENID })
      .limit(100)
      .get()

    const teammateMap = {}
    ;(regRes.data || []).filter(reg =>
      (reg.registrationType || 'team') === 'team' &&
      ['assembling', 'pending', 'approved', 'expired'].includes(reg.status)
    ).forEach(reg => {
      const createdAt = getTimeValue(reg.createdAt)
      ;(reg.members || []).forEach(member => {
        if (!member || !member.openid || member.openid === OPENID) return
        const key = member.openid
        const current = teammateMap[key] || {
          openid: key,
          name: '',
          photoUrl: '',
          count: 0,
          lastSeenAt: 0,
          lastTeamName: ''
        }
        current.count += 1
        if (createdAt >= current.lastSeenAt) {
          current.name = member.name || current.name
          current.photoUrl = member.photoUrl || current.photoUrl
          current.lastSeenAt = createdAt
          current.lastTeamName = reg.teamName || ''
        }
        teammateMap[key] = current
      })
    })

    const users = Object.values(teammateMap)
      .filter(user => user.name)
      .sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
      .slice(0, 12)

    const cloudIds = [...new Set(users.map(u => u.photoUrl).filter(url => url && url.startsWith('cloud://')))]
    const urlMap = {}
    if (cloudIds.length > 0) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: cloudIds })
        tempRes.fileList.forEach(file => {
          if (file.tempFileURL) urlMap[file.fileID] = file.tempFileURL
        })
      } catch (e) {}
    }

    return {
      code: 0,
      users: users.map(user => ({
        openid: user.openid,
        name: user.name,
        photoUrl: urlMap[user.photoUrl] || (user.photoUrl && !user.photoUrl.startsWith('cloud://') ? user.photoUrl : ''),
        count: user.count,
        lastTeamName: user.lastTeamName
      }))
    }
  } catch (e) {
    return { code: -1, msg: e.message, users: [] }
  }
}
