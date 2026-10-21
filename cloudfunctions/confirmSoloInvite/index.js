const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function countConfirmed(members) {
  return (members || []).filter(m => m && m.openid && m.confirmed).length
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, '').toLowerCase()
}

async function sendTeamMessage(data, fallback) {
  try {
    return await cloud.callFunction({
      name: 'sendImportantNotice',
      data: {
        internalChannel: 'message',
        category: 'team',
        priority: 'urgent',
        actionRequired: !!data.actionRequired,
        externalPush: true,
        templateType: 'team',
        page: '/pages/notifications/notifications',
        ...data
      }
    })
  } catch (e) {
    return fallback ? fallback() : null
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { notificationId, action } = event

  if (!notificationId) return { code: -1, msg: '通知不存在' }
  if (!['accept', 'decline'].includes(action)) return { code: -1, msg: '无效操作' }

  try {
    const notifRes = await db.collection('notifications').doc(notificationId).get()
    const notif = notifRes.data
    if (!notif || notif.type !== 'solo_team_invite' || notif.toOpenid !== OPENID) return { code: -1, msg: '邀请不存在' }
    if (notif.responded) return { code: -1, msg: '该邀请已处理' }

    const { postId, soloRegistrationId, teamRegistrationId } = notif

    if (action === 'decline') {
      await db.collection('notifications').doc(notificationId).update({
        data: { responded: true, responseAction: 'decline', read: true, respondedAt: db.serverDate() }
      })
      const declineContent = `❌ ${notif.toName || '散客池球员'} 拒绝加入「${notif.teamName || '你的队伍'}」。`
      await sendTeamMessage({
        fromOpenid: 'system',
        toOpenid: notif.fromOpenid,
        noticeType: 'solo_invite_declined',
        title: '球员拒绝邀请',
        content: declineContent,
        actionRequired: true
      }, () => db.collection('messages').add({
        data: { fromOpenid: 'system', toOpenid: notif.fromOpenid, type: 'text', content: declineContent, createdAt: db.serverDate(), read: false }
      })).catch(() => {})
      return { code: 0, msg: '已拒绝邀请' }
    }

    const [postRes, soloRes, teamRes] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('event_registrations').doc(soloRegistrationId).get(),
      db.collection('event_registrations').doc(teamRegistrationId).get()
    ])
    const post = postRes.data
    const solo = soloRes.data
    const team = teamRes.data

    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }
    if (!solo || solo.status !== 'solo_pending' || solo.postId !== postId) return { code: -1, msg: '你的散客报名已失效' }
    if (!team || team.status !== 'assembling' || team.postId !== postId) return { code: -1, msg: '队伍已不可加入' }

    const soloMember = (solo.members || []).find(m => m && m.openid === OPENID)
    if (!soloMember) return { code: -1, msg: '散客报名信息不匹配' }

    const maxTeamMembers = post.maxTeamMembers || 0
    const members = [...(team.members || [])]
    const occupied = members.filter(m => m && m.openid).length
    if (maxTeamMembers && occupied >= maxTeamMembers) return { code: -1, msg: '队伍人数已达上限' }
    const soloNameKey = normalizeName(soloMember.name)
    if (soloNameKey && members.some(m => m.openid && normalizeName(m.name) === soloNameKey)) {
      return { code: -1, msg: '队员名不能重复' }
    }

    const conflictRes = await db.collection('event_registrations')
      .where({
        postId,
        memberOpenids: OPENID,
        status: _.in(['assembling', 'pending', 'approved'])
      })
      .limit(1)
      .get()
    if (conflictRes.data.length > 0) return { code: -1, msg: '你已加入该赛事的其他队伍' }

    const emptyIndex = members.findIndex(m => !m.openid)
    const joinedMember = {
      openid: OPENID,
      name: soloMember.name || '',
      photoUrl: soloMember.photoUrl || '',
      confirmed: true,
      role: 'member',
      assignedFromSolo: true,
      joinedAt: new Date()
    }
    if (emptyIndex >= 0) members[emptyIndex] = joinedMember
    else members.push(joinedMember)

    await Promise.all([
      db.collection('event_registrations').doc(teamRegistrationId).update({
        data: {
          members,
          memberOpenids: _.push(OPENID),
          memberCount: countConfirmed(members),
          updatedAt: db.serverDate()
        }
      }),
      db.collection('event_registrations').doc(soloRegistrationId).update({
        data: {
          status: 'assigned',
          assignedTeamId: teamRegistrationId,
          assignedAt: db.serverDate()
        }
      }),
      db.collection('notifications').doc(notificationId).update({
        data: { responded: true, responseAction: 'accept', read: true, respondedAt: db.serverDate() }
      })
    ])

    await db.collection('notifications')
      .where({ type: 'solo_team_invite', toOpenid: OPENID, soloRegistrationId, responded: false })
      .update({ data: { responded: true, responseAction: 'expired', read: true } })
      .catch(() => {})

    const minTeamSize = post.minTeamSize || post.teamSize || 1
    const confirmedCount = countConfirmed(members)
    const acceptContent = `✅ ${soloMember.name || '散客池球员'} 已同意加入「${team.teamName}」。${confirmedCount >= minTeamSize ? '队伍已达到成队人数，可提交审核。' : `当前 ${confirmedCount}/${minTeamSize} 人，继续组队。`}`
    await sendTeamMessage({
      fromOpenid: 'system',
      toOpenid: team.captainOpenid,
      noticeType: 'solo_invite_accepted',
      title: '球员已加入队伍',
      content: acceptContent,
      actionRequired: confirmedCount >= minTeamSize
    }, () => db.collection('messages').add({
      data: { fromOpenid: 'system', toOpenid: team.captainOpenid, type: 'text', content: acceptContent, createdAt: db.serverDate(), read: false }
    })).catch(() => {})

    return { code: 0, msg: '已加入队伍' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
