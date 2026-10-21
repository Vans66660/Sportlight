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
    if (!team._id || team.status === 'deleted') return { code: -1, msg: '球队不存在' }

    const memberOpenids = team.memberOpenids || []
    const members = team.members || []
    const athleteRes = memberOpenids.length
      ? await db.collection('athletes').where({ openid: _.in(memberOpenids) }).field({ openid: true, name: true, photo: true, currentSeasonScore: true, competitionScore: true, position: true }).get()
      : { data: [] }
    const athleteMap = {}
    ;(athleteRes.data || []).forEach(a => { athleteMap[a.openid] = a })

    const mergedMembers = members.map(m => {
      const a = athleteMap[m.openid] || {}
      return {
        ...m,
        name: a.name || m.name || '队员',
        avatar: a.photo || m.avatar || '',
        score: a.currentSeasonScore || a.competitionScore || m.score || 0,
        position: a.position || m.position || ''
      }
    })

    const myTeamsRes = await db.collection('teams').where({ memberOpenids: OPENID, status: _.neq('deleted') }).limit(5).get()
    const myTeams = myTeamsRes.data || []
    let pendingRes = { data: [] }
    try {
      pendingRes = await db.collection('teamJoinRequests')
        .where({ teamId, applicantOpenid: OPENID, status: 'pending' })
        .limit(1)
        .get()
    } catch (e) {
      if (!isCollectionMissing(e)) throw e
    }

    let challengeRes = { data: [] }
    try {
      challengeRes = await db.collection('teamChallenges')
        .where({ teamIds: _.all([teamId]), status: _.in(['matched', 'completed']) })
        .orderBy('updatedAt', 'desc')
        .limit(5)
        .get()
    } catch (e) {
      if (!isCollectionMissing(e)) throw e
    }

    const isMember = memberOpenids.includes(OPENID)
    const isCaptain = team.captainOpenid === OPENID
    const canApply = !isMember && (team.recruitmentStatus || 'open') === 'open' && myTeams.length < 3 && pendingRes.data.length === 0
    const myCaptainTeam = myTeams.find(item => item.captainOpenid === OPENID)
    const canChallenge = !!myCaptainTeam && myCaptainTeam._id !== teamId

    return {
      code: 0,
      data: {
        ...team,
        logoText: initials(team.name),
        members: mergedMembers,
        memberCount: mergedMembers.length,
        averageScore: Math.round(team.averageScore || 0),
        isMember,
        isCaptain,
        canApply,
        hasPendingApply: pendingRes.data.length > 0,
        canChallenge,
        myCaptainTeamId: myCaptainTeam ? myCaptainTeam._id : '',
        recentChallenges: challengeRes.data || []
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
