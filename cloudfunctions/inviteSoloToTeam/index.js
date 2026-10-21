const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function countOccupied(members) {
  return (members || []).filter(m => m && m.openid).length
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, '').toLowerCase()
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, soloRegistrationId, teamRegistrationId } = event

  if (!postId || !soloRegistrationId || !teamRegistrationId) return { code: -1, msg: '参数缺失' }
  if (soloRegistrationId === teamRegistrationId) return { code: -1, msg: '不能邀请自己的报名记录' }

  try {
    const [postRes, soloRes, teamRes] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('event_registrations').doc(soloRegistrationId).get(),
      db.collection('event_registrations').doc(teamRegistrationId).get()
    ])

    const post = postRes.data
    const solo = soloRes.data
    const team = teamRes.data

    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }
    if (post.eventStatus === 'closed') return { code: -1, msg: '报名已关闭' }
    if (post.registrationDeadline) {
      const deadline = new Date(post.registrationDeadline)
      deadline.setHours(23, 59, 59, 999)
      if (new Date() > deadline) return { code: -1, msg: '报名已截止' }
    }

    if (!team || team.postId !== postId || team.captainOpenid !== OPENID) return { code: -1, msg: '无权操作该队伍' }
    if (team.status !== 'assembling') return { code: -1, msg: '该队伍已提交审核，不能继续邀请' }
    if (!solo || solo.postId !== postId || solo.status !== 'solo_pending') return { code: -1, msg: '该散客报名不可邀请' }

    const soloMember = (solo.members || []).find(m => m && m.openid)
    if (!soloMember || !soloMember.openid) return { code: -1, msg: '散客报名缺少球员信息' }
    if (soloMember.openid === OPENID) return { code: -1, msg: '不能邀请自己' }
    if ((team.memberOpenids || []).includes(soloMember.openid)) return { code: -1, msg: '该球员已在你的队伍中' }
    const soloNameKey = normalizeName(soloMember.name)
    if (soloNameKey && (team.members || []).some(m => m.openid && normalizeName(m.name) === soloNameKey)) {
      return { code: -1, msg: '队员名不能重复' }
    }

    const maxTeamMembers = post.maxTeamMembers || 0
    if (maxTeamMembers && countOccupied(team.members) >= maxTeamMembers) return { code: -1, msg: '队伍人数已达上限' }

    const pendingInviteRes = await db.collection('notifications')
      .where({
        type: 'solo_team_invite',
        toOpenid: soloMember.openid,
        soloRegistrationId,
        teamRegistrationId,
        responded: false
      })
      .limit(1)
      .get()
    if (pendingInviteRes.data.length > 0) return { code: -1, msg: '已邀请，等待球员确认' }

    const postTitle = post.title || post.content?.slice(0, 20) || '赛事'
    await cloud.callFunction({
      name: 'sendImportantNotice',
      data: {
        internalChannel: 'notification',
        fromOpenid: OPENID,
        toOpenid: soloMember.openid,
        category: 'team',
        priority: 'urgent',
        actionRequired: true,
        externalPush: true,
        templateType: 'team',
        noticeType: 'solo_team_invite',
        notificationType: 'solo_team_invite',
        title: '队伍邀请',
        content: `「${team.teamName}」· ${postTitle}`,
        postId,
        registrationId: teamRegistrationId,
        teamRegistrationId,
        soloRegistrationId,
        captainName: (team.members || []).find(m => m.role === 'captain')?.name || '',
        teamName: team.teamName || '',
        responded: false,
        page: '/pages/notifications/notifications'
      }
    }).catch(() => db.collection('notifications').add({
      data: {
        fromOpenid: OPENID,
        toOpenid: soloMember.openid,
        type: 'solo_team_invite',
        content: `「${team.teamName}」· ${postTitle}`,
        postId,
        registrationId: teamRegistrationId,
        teamRegistrationId,
        soloRegistrationId,
        captainName: (team.members || []).find(m => m.role === 'captain')?.name || '',
        teamName: team.teamName || '',
        read: false,
        responded: false,
        createdAt: db.serverDate()
      }
    }))

    await db.collection('messages').add({
      data: {
        fromOpenid: 'system',
        toOpenid: soloMember.openid,
        type: 'text',
        content: `📩 队伍「${team.teamName}」邀请你一起参加「${postTitle}」，请到通知页确认。`,
        createdAt: db.serverDate(),
        read: false
      }
    }).catch(() => {})

    return { code: 0, msg: '邀请已发送' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
