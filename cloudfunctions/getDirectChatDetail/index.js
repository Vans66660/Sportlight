const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { chatId } = event || {}
  if (!chatId) return { code: -1, msg: '缺少会话ID' }

  try {
    const convRes = await db.collection('conversations').doc(chatId).get()
    const conv = convRes.data || {}
    const participants = conv.participants || [conv.bossOpenid, conv.athleteOpenid].filter(Boolean)
    if (!participants.includes(OPENID)) return { code: -1, msg: '无权限' }

    const athleteRes = await db.collection('athletes')
      .where({ openid: _.in(participants) })
      .field({ openid: true, name: true, nickname: true, displayName: true, sportlightId: true, photo: true })
      .get()
    const athleteMap = {}
    ;(athleteRes.data || []).forEach(item => { athleteMap[item.openid] = item })

    const userRes = await db.collection('users')
      .where({ openid: _.in(participants) })
      .field({ openid: true, name: true, nickName: true, nickname: true, displayName: true, avatarUrl: true, logo: true })
      .get()
    const userMap = {}
    ;(userRes.data || []).forEach(item => { userMap[item.openid] = item })

    const otherOpenid = participants.find(id => id !== OPENID) || ''
    const meAthlete = athleteMap[OPENID] || {}
    const otherAthlete = athleteMap[otherOpenid] || {}
    const meUser = userMap[OPENID] || {}
    const otherUser = userMap[otherOpenid] || {}
    const raw = [
      meAthlete.photo || meUser.avatarUrl || meUser.logo || '',
      otherAthlete.photo || otherUser.avatarUrl || otherUser.logo || ''
    ]
    const temp = await toTempURLs(raw)

    return {
      code: 0,
      data: {
        chatId,
        title: conv.title || '聊天',
        myOpenid: OPENID,
        otherOpenid,
        myName: meAthlete.displayName || meAthlete.nickname || meAthlete.name || meUser.displayName || meUser.nickname || meUser.name || meUser.nickName || '我',
        otherName: otherAthlete.displayName || otherAthlete.nickname || otherAthlete.name || otherUser.displayName || otherUser.nickname || otherUser.name || otherUser.nickName || '队长',
        myPhoto: temp[raw[0]] || raw[0] || '',
        otherPhoto: temp[raw[1]] || raw[1] || '',
        chatKind: conv.chatKind || 'direct',
        teamCaptainChat: !!conv.teamCaptainChat,
        teamId: conv.teamId || '',
        teamName: conv.teamName || ''
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
