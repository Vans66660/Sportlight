const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function sportLabel(sport) {
  if (sport === 'football') return '足球'
  if (sport === 'basketball') return '篮球'
  if (sport === 'badminton') return '羽毛球'
  return sport || ''
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { athleteOpenid, teamName, orderId } = event

  if (!athleteOpenid || !teamName) {
    return { code: -1, msg: '参数不完整' }
  }

  const cleanName = String(teamName).trim()
  if (!cleanName) return { code: -1, msg: '球队名称不能为空' }

  try {
    // 查找主办方已有的同名球队
    const existing = await db.collection('teams')
      .where({ name: cleanName, captainOpenid: OPENID, status: _.neq('deleted') })
      .limit(1)
      .get()

    // 获取运动员信息
    const athleteRes = await db.collection('athletes').where({ openid: athleteOpenid }).limit(1).get()
    const athlete = athleteRes.data[0] || {}
    const newMember = {
      openid: athleteOpenid,
      name: athlete.name || '未命名球员',
      avatar: athlete.photo || '',
      score: athlete.currentSeasonScore || athlete.competitionScore || 0,
      role: 'member',
      joinedAt: new Date()
    }

    if (existing.data.length > 0) {
      // 已有该球队，追加成员
      const team = existing.data[0]
      const teamSport = sportLabel(team.sport)
      const athleteSport = sportLabel(athlete.sport)
      if (teamSport && athleteSport && teamSport !== athleteSport) return { code: -1, msg: `该球队是${teamSport}球队，仅允许${teamSport}运动员加入` }
      const memberOpenids = team.memberOpenids || []
      if (memberOpenids.includes(athleteOpenid)) {
        return { code: 0, msg: '球员已在球队中', teamId: team._id }
      }
      const members = team.members || []
      members.push(newMember)
      memberOpenids.push(athleteOpenid)
      const totalScore = members.reduce((sum, m) => sum + (m.score || 0), 0)
      const averageScore = members.length > 0 ? Math.round(totalScore / members.length) : 0

      await db.collection('teams').doc(team._id).update({
        data: {
          members,
          memberOpenids,
          averageScore,
          updatedAt: new Date()
        }
      })
      return { code: 0, msg: '已加入球队', teamId: team._id }
    }

    // 不存在则创建新球队，主办方为队长
    const bossAthleteRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    const bossAthlete = bossAthleteRes.data[0] || {}
    const captain = {
      openid: OPENID,
      name: bossAthlete.name || '队长',
      avatar: bossAthlete.photo || '',
      score: bossAthlete.currentSeasonScore || bossAthlete.competitionScore || 0,
      role: 'captain',
      joinedAt: new Date()
    }
    const members = [captain, newMember]
    const totalScore = members.reduce((sum, m) => sum + (m.score || 0), 0)
    const averageScore = Math.round(totalScore / members.length)

    const addRes = await db.collection('teams').add({
      data: {
        name: cleanName,
        sport: athlete.sport || '',
        logo: '',
        cover: '',
        gallery: [],
        description: '',
        venues: [],
        venueIds: [],
        recruitmentStatus: 'open',
        captainOpenid: OPENID,
        memberOpenids: [OPENID, athleteOpenid],
        members,
        averageScore,
        status: 'active',
        recentChallenges: [],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })
    return { code: 0, msg: '球队已创建并加入球员', teamId: addRes._id }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
