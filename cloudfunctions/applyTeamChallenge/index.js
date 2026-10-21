const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { challengeId, teamId } = event
  if (!challengeId || !teamId) return { code: -1, msg: '参数错误' }
  try {
    const [challengeRes, teamRes] = await Promise.all([
      db.collection('teamChallenges').doc(challengeId).get(),
      db.collection('teams').doc(teamId).get()
    ])
    const challenge = challengeRes.data || {}
    const team = teamRes.data || {}
    if (team.captainOpenid !== OPENID) return { code: -1, msg: '只有队长可以应战' }
    if (challenge.status !== 'open') return { code: -1, msg: '当前约战不可应战' }
    if (challenge.homeTeamId === teamId) return { code: -1, msg: '不能应战自己的约战' }
    const existed = (challenge.applications || []).some(app => app.teamId === teamId && app.status === 'pending')
    if (existed) return { code: -1, msg: '已提交应战申请' }
    const now = new Date()
    const application = {
      teamId,
      teamName: team.name || '',
      teamLogo: team.logo || '',
      averageScore: Math.round(team.averageScore || 0),
      captainOpenid: OPENID,
      members: team.members || [],
      status: 'pending',
      createdAt: now
    }
    await db.collection('teamChallenges').doc(challengeId).update({
      data: {
        applications: _.push(application),
        status: 'pending_confirm',
        updatedAt: now
      }
    })
    const content = `${team.name || '有球队'} 申请应战你的球队约战`
    await cloud.callFunction({
      name: 'sendImportantNotice',
      data: {
        internalChannel: 'notification',
        toOpenid: challenge.creatorOpenid,
        category: 'team',
        priority: 'urgent',
        actionRequired: true,
        externalPush: true,
        templateType: 'team',
        noticeType: 'team_challenge_apply',
        notificationType: 'team_challenge_apply',
        title: '球队应战申请',
        challengeId,
        teamId,
        teamName: team.name || '',
        content,
        page: `/pages/team-challenge-detail/team-challenge-detail?id=${challengeId}`
      }
    }).catch(() => db.collection('notifications').add({
      data: {
        toOpenid: challenge.creatorOpenid,
        type: 'team_challenge_apply',
        challengeId,
        teamId,
        teamName: team.name || '',
        content,
        read: false,
        createdAt: now
      }
    }))
    return { code: 0 }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
