const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureCollection(name) {
  try { await db.createCollection(name) } catch (e) {}
}

function specOptions(sport) {
  if (sport === '篮球') return ['3v3', '5v5']
  if (sport === '羽毛球') return ['单打', '双打', '混双', '团体赛']
  return ['5v5', '7v7', '8v8', '9v9', '11v11']
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const {
    teamId,
    targetTeamId = '',
    date,
    time,
    venueId,
    venueName,
    spec,
    paymentMethod = 'aa',
    opponentRequirement = '不限',
    description = '',
    visibility = 'public'
  } = event
  if (!teamId || !date || !time || !venueId || !spec) return { code: -1, msg: '请补全约战信息' }
  if (!['aa', 'host'].includes(paymentMethod)) return { code: -1, msg: '请选择有效的费用方式' }

  try {
    await ensureCollection('teamChallenges')
    const teamRes = await db.collection('teams').doc(teamId).get()
    const team = teamRes.data || {}
    if (team.captainOpenid !== OPENID) return { code: -1, msg: '只有队长可以发起约战' }
    if (!specOptions(team.sport).includes(spec)) return { code: -1, msg: '比赛规格不符合该运动类型' }

    let targetTeam = null
    if (targetTeamId) {
      const targetRes = await db.collection('teams').doc(targetTeamId).get()
      targetTeam = targetRes.data || null
      if (!targetTeam || targetTeam.status !== 'active') return { code: -1, msg: '目标球队不存在' }
    }

    const venueRes = await db.collection('venues').doc(venueId).get()
    const venue = venueRes.data || {}
    if (venue.status !== 'approved') return { code: -1, msg: '请选择已入驻球馆' }

    const now = new Date()
    const doc = {
      creatorOpenid: OPENID,
      homeTeamId: teamId,
      homeTeamName: team.name || '',
      homeTeamLogo: team.logo || '',
      homeAverageScore: Math.round(team.averageScore || 0),
      homeMembers: team.members || [],
      awayTeamId: targetTeamId || '',
      awayTeamName: targetTeam ? targetTeam.name || '' : '',
      awayTeamLogo: targetTeam ? targetTeam.logo || '' : '',
      awayAverageScore: targetTeam ? Math.round(targetTeam.averageScore || 0) : 0,
      awayMembers: targetTeam ? targetTeam.members || [] : [],
      teamIds: targetTeamId ? [teamId, targetTeamId] : [teamId],
      sport: team.sport || '',
      spec,
      date,
      time,
      venueId,
      venueName: venueName || venue.name || '',
      venueAddress: venue.address || venue.locationName || '',
      paymentMethod,
      opponentRequirement,
      description: String(description || '').slice(0, 300),
      visibility: targetTeamId ? 'direct' : visibility,
      status: targetTeamId ? 'invited' : 'open',
      applications: [],
      participants: [],
      createdAt: now,
      updatedAt: now
    }
    const addRes = await db.collection('teamChallenges').add({ data: doc })

    if (targetTeam && targetTeam.captainOpenid) {
      const content = `${team.name || '有球队'} 向你发起球队约战邀请`
      await cloud.callFunction({
        name: 'sendImportantNotice',
        data: {
          internalChannel: 'notification',
          toOpenid: targetTeam.captainOpenid,
          category: 'team',
          priority: 'urgent',
          actionRequired: true,
          externalPush: true,
          templateType: 'team',
          noticeType: 'team_challenge_invite',
          notificationType: 'team_challenge_invite',
          title: '球队约战邀请',
          challengeId: addRes._id,
          teamId,
          teamName: team.name || '',
          content,
          page: `/pages/team-challenge-detail/team-challenge-detail?id=${addRes._id}`
        }
      }).catch(() => db.collection('notifications').add({
        data: {
          toOpenid: targetTeam.captainOpenid,
          type: 'team_challenge_invite',
          challengeId: addRes._id,
          teamId,
          teamName: team.name || '',
          content,
          read: false,
          createdAt: now
        }
      }))
    }

    return { code: 0, challengeId: addRes._id }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
