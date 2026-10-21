const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function recalcAverage(teamId) {
  const teamRes = await db.collection('teams').doc(teamId).get()
  const team = teamRes.data || {}
  const members = team.members || []
  const averageScore = members.length
    ? Math.round(members.reduce((sum, m) => sum + Number(m.score || 0), 0) / members.length)
    : 0
  await db.collection('teams').doc(teamId).update({ data: { averageScore, updatedAt: new Date() } })
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { requestId, action } = event
  if (!requestId || !['approve', 'reject'].includes(action)) return { code: -1, msg: '参数错误' }
  try {
    const reqRes = await db.collection('teamJoinRequests').doc(requestId).get()
    const request = reqRes.data || {}
    if (!request._id || request.status !== 'pending') return { code: -1, msg: '申请不存在或已处理' }
    const teamRes = await db.collection('teams').doc(request.teamId).get()
    const team = teamRes.data || {}
    if (team.captainOpenid !== OPENID) return { code: -1, msg: '只有队长可以审核' }

    const now = new Date()
    if (action === 'reject') {
      await db.collection('teamJoinRequests').doc(requestId).update({ data: { status: 'rejected', reviewedAt: now, updatedAt: now } })
      const content = `${request.teamName || team.name || '球队'} 婉拒了你的入队申请`
      await cloud.callFunction({
        name: 'sendImportantNotice',
        data: {
          internalChannel: 'notification',
          toOpenid: request.applicantOpenid,
          category: 'team',
          priority: 'important',
          actionRequired: false,
          externalPush: true,
          templateType: 'team',
          noticeType: 'team_join_rejected',
          notificationType: 'team_join_rejected',
          title: '入队申请未通过',
          teamId: request.teamId,
          teamName: request.teamName || team.name || '',
          content,
          page: `/pages/team-home/team-home?id=${request.teamId}`
        }
      }).catch(() => db.collection('notifications').add({
        data: {
          toOpenid: request.applicantOpenid,
          type: 'team_join_rejected',
          teamId: request.teamId,
          teamName: request.teamName || team.name || '',
          content,
          read: false,
          createdAt: now
        }
      }))
      return { code: 0 }
    }

    const myTeamsRes = await db.collection('teams')
      .where({ memberOpenids: request.applicantOpenid, status: _.neq('deleted') })
      .limit(5)
      .get()
    if ((myTeamsRes.data || []).length >= 3) return { code: -1, msg: '该用户已达到3个球队上限' }
    if ((team.memberOpenids || []).includes(request.applicantOpenid)) return { code: -1, msg: '该用户已在队内' }

    const member = {
      openid: request.applicantOpenid,
      name: request.applicantName || '队员',
      avatar: request.applicantAvatar || '',
      score: request.applicantScore || 0,
      position: request.applicantPosition || '',
      role: 'member',
      joinedAt: now
    }
    await db.collection('teams').doc(request.teamId).update({
      data: {
        memberOpenids: _.push(request.applicantOpenid),
        members: _.push(member),
        updatedAt: now
      }
    })
    await db.collection('teamJoinRequests').doc(requestId).update({ data: { status: 'approved', reviewedAt: now, updatedAt: now } })
    await recalcAverage(request.teamId)
    const content = `你已加入 ${request.teamName || team.name || '球队'}`
    await cloud.callFunction({
      name: 'sendImportantNotice',
      data: {
        internalChannel: 'notification',
        toOpenid: request.applicantOpenid,
        category: 'team',
        priority: 'important',
        actionRequired: false,
        externalPush: true,
        templateType: 'team',
        noticeType: 'team_join_approved',
        notificationType: 'team_join_approved',
        title: '入队申请已通过',
        teamId: request.teamId,
        teamName: request.teamName || team.name || '',
        content,
        page: `/pages/team-home/team-home?id=${request.teamId}`
      }
    }).catch(() => db.collection('notifications').add({
      data: {
        toOpenid: request.applicantOpenid,
        type: 'team_join_approved',
        teamId: request.teamId,
        teamName: request.teamName || team.name || '',
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
