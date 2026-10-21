const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function ensureCollection(name) {
  try { await db.createCollection(name) } catch (e) {}
}

function sportLabel(sport) {
  if (sport === 'football') return '足球'
  if (sport === 'basketball') return '篮球'
  if (sport === 'badminton') return '羽毛球'
  return sport || ''
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { teamId, reason = '', fromInvite = false } = event
  if (!teamId) return { code: -1, msg: '缺少球队ID' }
  try {
    await ensureCollection('teamJoinRequests')
    const myTeamsRes = await db.collection('teams').where({ memberOpenids: OPENID, status: _.neq('deleted') }).limit(5).get()
    if ((myTeamsRes.data || []).length >= 3) return { code: -1, msg: '最多只能加入3个球队' }
    const teamRes = await db.collection('teams').doc(teamId).get()
    const team = teamRes.data || {}
    if (!team._id || team.status !== 'active') return { code: -1, msg: '球队不存在' }
    if ((team.memberOpenids || []).includes(OPENID)) return { code: -1, msg: '你已经在该球队中' }
    if (!fromInvite && (team.recruitmentStatus || 'open') !== 'open') return { code: -1, msg: '该球队暂不招募' }

    const existed = await db.collection('teamJoinRequests').where({ teamId, applicantOpenid: OPENID, status: 'pending' }).limit(1).get()
    if (existed.data.length) return { code: -1, msg: '已提交申请，请等待队长审核' }

    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    const athlete = athleteRes.data[0] || {}
    const teamSport = sportLabel(team.sport)
    const athleteSport = sportLabel(athlete.sport)
    if (teamSport && athleteSport && teamSport !== athleteSport) return { code: -1, msg: `该球队是${teamSport}球队，仅允许${teamSport}运动员申请` }
    const now = new Date()
    await db.collection('teamJoinRequests').add({
      data: {
        teamId,
        teamName: team.name || '',
        captainOpenid: team.captainOpenid || '',
        applicantOpenid: OPENID,
        applicantName: athlete.name || '申请人',
        applicantAvatar: athlete.photo || '',
        applicantScore: athlete.currentSeasonScore || athlete.competitionScore || 0,
        applicantPosition: athlete.position || '',
        reason: String(reason || '').slice(0, 200),
        status: 'pending',
        createdAt: now,
        updatedAt: now
      }
    })
    if (team.captainOpenid) {
      const content = `${athlete.name || '有球员'} 申请加入 ${team.name || '球队'}`
      await cloud.callFunction({
        name: 'sendImportantNotice',
        data: {
          internalChannel: 'notification',
          toOpenid: team.captainOpenid,
          category: 'team',
          priority: 'urgent',
          actionRequired: true,
          externalPush: true,
          templateType: 'team',
          noticeType: 'team_join_request',
          notificationType: 'team_join_request',
          title: '新的入队申请',
          teamId,
          teamName: team.name || '',
          fromOpenid: OPENID,
          fromName: athlete.name || '申请人',
          content,
          page: `/pages/team-manage/team-manage?id=${teamId}`
        }
      }).catch(() => db.collection('notifications').add({
        data: {
          toOpenid: team.captainOpenid,
          type: 'team_join_request',
          teamId,
          teamName: team.name || '',
          fromOpenid: OPENID,
          fromName: athlete.name || '申请人',
          content,
          read: false,
          createdAt: now
        }
      }))
    }
    return { code: 0 }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
