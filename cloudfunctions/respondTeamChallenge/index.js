const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function notifyMembers(challenge, now) {
  const openids = [
    ...((challenge.homeMembers || []).map(m => m.openid)),
    ...((challenge.awayMembers || []).map(m => m.openid))
  ].filter(Boolean)
  const content = `${challenge.homeTeamName || '主队'} VS ${challenge.awayTeamName || '客队'} 约战已达成，请确认是否参战`
  await Promise.all([...new Set(openids)].map(openid => cloud.callFunction({
    name: 'sendImportantNotice',
    data: {
      internalChannel: 'notification',
      toOpenid: openid,
      category: 'team',
      priority: 'urgent',
      actionRequired: true,
      externalPush: true,
      templateType: 'team',
      noticeType: 'team_challenge_matched',
      notificationType: 'team_challenge_matched',
      title: '球队约战已达成',
      challengeId: challenge._id,
      content,
      page: `/pages/team-challenge-detail/team-challenge-detail?id=${challenge._id}`
    }
  }).catch(() => db.collection('notifications').add({
    data: { toOpenid: openid, type: 'team_challenge_matched', challengeId: challenge._id, content, read: false, createdAt: now }
  }))))
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { challengeId, action = 'accept', teamId = '' } = event
  if (!challengeId || !['accept', 'reject'].includes(action)) return { code: -1, msg: '参数错误' }
  try {
    const res = await db.collection('teamChallenges').doc(challengeId).get()
    const challenge = res.data || {}
    if (!challenge._id) return { code: -1, msg: '约战不存在' }
    const now = new Date()

    if (challenge.status === 'invited') {
      const targetTeamRes = await db.collection('teams').doc(challenge.awayTeamId).get()
      const targetTeam = targetTeamRes.data || {}
      if (targetTeam.captainOpenid !== OPENID) return { code: -1, msg: '只有被邀请球队队长可以处理' }
      if (action === 'reject') {
        await db.collection('teamChallenges').doc(challengeId).update({ data: { status: 'rejected', updatedAt: now } })
        return { code: 0 }
      }
      const update = {
        status: 'matched',
        awayTeamName: targetTeam.name || challenge.awayTeamName || '',
        awayTeamLogo: targetTeam.logo || challenge.awayTeamLogo || '',
        awayAverageScore: Math.round(targetTeam.averageScore || 0),
        awayMembers: targetTeam.members || [],
        teamIds: [challenge.homeTeamId, challenge.awayTeamId],
        matchedAt: now,
        updatedAt: now
      }
      await db.collection('teamChallenges').doc(challengeId).update({ data: update })
      await notifyMembers({ ...challenge, ...update, _id: challengeId }, now)
      return { code: 0 }
    }

    if (challenge.status !== 'pending_confirm') return { code: -1, msg: '当前约战不可处理' }
    if (challenge.creatorOpenid !== OPENID) return { code: -1, msg: '只有发起方队长可以确认' }
    if (action === 'reject') {
      await db.collection('teamChallenges').doc(challengeId).update({ data: { status: 'open', updatedAt: now } })
      return { code: 0 }
    }

    const app = (challenge.applications || []).find(item => item.teamId === teamId && item.status === 'pending')
    if (!app) return { code: -1, msg: '未找到应战申请' }
    const update = {
      status: 'matched',
      awayTeamId: app.teamId,
      awayTeamName: app.teamName || '',
      awayTeamLogo: app.teamLogo || '',
      awayAverageScore: Math.round(app.averageScore || 0),
      awayMembers: app.members || [],
      teamIds: [challenge.homeTeamId, app.teamId],
      applications: (challenge.applications || []).map(item => item.teamId === app.teamId ? { ...item, status: 'accepted' } : { ...item, status: 'rejected' }),
      matchedAt: now,
      updatedAt: now
    }
    await db.collection('teamChallenges').doc(challengeId).update({ data: update })
    await notifyMembers({ ...challenge, ...update, _id: challengeId }, now)
    return { code: 0 }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
