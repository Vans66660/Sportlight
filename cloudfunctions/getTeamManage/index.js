const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function isCollectionMissing(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

function initials(name) {
  const text = String(name || '').trim()
  return text ? text.slice(0, 1) : '队'
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { teamId } = event
  if (!teamId) return { code: -1, msg: '缺少球队ID' }
  try {
    const teamRes = await db.collection('teams').doc(teamId).get()
    const team = teamRes.data || {}
    if (team.captainOpenid !== OPENID) return { code: -1, msg: '只有队长可以管理球队' }
    const memberOpenids = team.memberOpenids || []
    const athleteRes = memberOpenids.length
      ? await db.collection('athletes').where({ openid: _.in(memberOpenids) }).field({ openid: true, name: true, photo: true, currentSeasonScore: true, competitionScore: true, position: true }).get()
      : { data: [] }
    const athleteMap = {}
    ;(athleteRes.data || []).forEach(a => { athleteMap[a.openid] = a })
    const members = (team.members || []).map(member => {
      const athlete = athleteMap[member.openid] || {}
      return {
        ...member,
        name: athlete.name || member.name || '队员',
        avatar: athlete.photo || member.avatar || '',
        score: athlete.currentSeasonScore || athlete.competitionScore || member.score || 0,
        position: athlete.position || member.position || ''
      }
    })
    let reqRes = { data: [] }
    try {
      reqRes = await db.collection('teamJoinRequests')
        .where({ teamId, status: 'pending' })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
    } catch (e) {
      if (!isCollectionMissing(e)) throw e
    }
    return { code: 0, team: { ...team, members, logoText: initials(team.name) }, requests: reqRes.data || [] }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
