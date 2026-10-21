const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function initials(name) {
  return name ? String(name).slice(0, 1) : '队'
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const res = await db.collection('teams')
      .where({ memberOpenids: OPENID, status: _.neq('deleted') })
      .orderBy('updatedAt', 'desc')
      .limit(20)
      .get()

    const teams = (res.data || []).map(team => ({
      _id: team._id,
      name: team.name || '未命名球队',
      logo: team.logo || '',
      logoText: initials(team.name),
      cover: team.cover || '',
      sport: team.sport || '',
      averageScore: Math.round(team.averageScore || 0),
      memberCount: (team.members || []).length || (team.memberOpenids || []).length || 0,
      captainOpenid: team.captainOpenid || '',
      isCaptain: team.captainOpenid === OPENID,
      recruitmentStatus: team.recruitmentStatus || 'open'
    }))

    return {
      code: 0,
      data: teams,
      leaderTeams: teams.filter(team => team.isCaptain),
      joinedTeams: teams.filter(team => !team.isCaptain),
      canCreate: !teams.some(team => team.isCaptain),
      teamCount: teams.length
    }
  } catch (e) {
    return { code: 0, data: [], leaderTeams: [], joinedTeams: [], canCreate: true, teamCount: 0, msg: e.message }
  }
}
