const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function checkReputation(openid) {
  const res = await db.collection('athletes').where({ openid }).field({ name: true, reputation: true }).limit(1).get()
  const athlete = res.data[0] || {}
  if ((athlete.reputation || 80) < 60) return { ok: false, msg: '你的信誉分低于60，暂不能参加该项目' }
  return { ok: true }
}

async function sendMessage(data, fallback) {
  try {
    return await cloud.callFunction({
      name: 'sendImportantNotice',
      data: {
        internalChannel: 'message',
        category: 'team',
        priority: 'important',
        templateType: 'team',
        externalPush: true,
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
  const { registrationId, action } = event || {}
  if (!registrationId || !['accept', 'decline'].includes(action)) return { code: -1, msg: '参数无效' }

  try {
    const regRes = await db.collection('event_registrations').doc(registrationId).get()
    const reg = regRes.data || {}
    if (reg.registrationType !== 'regular_team') return { code: -1, msg: '不是球队报名邀请' }
    if (!['assembling', 'pending', 'approved'].includes(reg.status)) return { code: -1, msg: '该报名已关闭' }
    if (reg.captainOpenid === OPENID) return { code: -1, msg: '队长已默认确认参赛' }

    const memberIdx = (reg.members || []).findIndex(m => m && m.openid === OPENID)
    if (memberIdx === -1) return { code: -1, msg: '你不在该球队报名名单中' }
    const members = [...(reg.members || [])]
    const member = members[memberIdx] || {}

    if (action === 'accept') {
      const postRes = await db.collection('posts').doc(reg.postId).get()
      const post = postRes.data || {}
      const maxTeamMembers = post.maxTeamMembers || post.teamSize || 0
      const currentConfirmedCount = (reg.memberOpenids || []).filter(Boolean).length
      if (maxTeamMembers && currentConfirmedCount >= maxTeamMembers) {
        return { code: -1, msg: `本赛事每队最多 ${maxTeamMembers} 人，参赛名单已满` }
      }
      const repCheck = await checkReputation(OPENID)
      if (!repCheck.ok) return { code: -1, msg: repCheck.msg }
      const conflictRes = await db.collection('event_registrations')
        .where({ postId: reg.postId, memberOpenids: OPENID, status: _.in(['assembling', 'pending', 'approved', 'solo_pending']) })
        .limit(5)
        .get()
      const conflict = (conflictRes.data || []).find(item => item._id !== registrationId)
      if (conflict) return { code: -1, msg: '你已在该赛事的另一支队伍中，无法重复参赛' }
      if (member.confirmed) return { code: 0, msg: '你已确认参赛' }

      members[memberIdx] = { ...member, confirmed: true, declined: false, respondedAt: new Date() }
      const memberOpenids = [...new Set([...(reg.memberOpenids || []), OPENID].filter(Boolean))]
      await db.collection('event_registrations').doc(registrationId).update({
        data: {
          members,
          memberOpenids,
          memberCount: memberOpenids.length,
          updatedAt: db.serverDate()
        }
      })

      await sendMessage({
        fromOpenid: 'system',
        toOpenid: reg.captainOpenid,
        noticeType: 'regular_team_event_member_accepted',
        title: '队员确认参赛',
        content: `${member.name || '队员'} 已确认代表「${reg.teamName || '球队'}」参赛`
      }, () => db.collection('messages').add({
        data: { fromOpenid: 'system', toOpenid: reg.captainOpenid, type: 'text', content: `${member.name || '队员'} 已确认代表「${reg.teamName || '球队'}」参赛`, createdAt: db.serverDate(), read: false }
      }))

      await db.collection('notifications')
        .where({ toOpenid: OPENID, registrationId, type: 'regular_team_event_invite' })
        .update({ data: { responded: true, responseAction: 'accept', read: true } })
        .catch(() => null)

      return { code: 0, msg: '已确认参赛' }
    }

    members[memberIdx] = { ...member, confirmed: false, declined: true, respondedAt: new Date() }
    await db.collection('event_registrations').doc(registrationId).update({
      data: {
        members,
        memberOpenids: _.pull(OPENID),
        memberCount: Math.max(1, (reg.memberOpenids || []).filter(id => id && id !== OPENID).length),
        updatedAt: db.serverDate()
      }
    })

    await sendMessage({
      fromOpenid: 'system',
      toOpenid: reg.captainOpenid,
      noticeType: 'regular_team_event_member_declined',
      title: '队员暂不参赛',
      content: `${member.name || '队员'} 暂不参加「${reg.teamName || '球队'}」本次赛事`
    }, () => db.collection('messages').add({
      data: { fromOpenid: 'system', toOpenid: reg.captainOpenid, type: 'text', content: `${member.name || '队员'} 暂不参加「${reg.teamName || '球队'}」本次赛事`, createdAt: db.serverDate(), read: false }
    }))

    await db.collection('notifications')
      .where({ toOpenid: OPENID, registrationId, type: 'regular_team_event_invite' })
      .update({ data: { responded: true, responseAction: 'decline', read: true } })
      .catch(() => null)

    return { code: 0, msg: '已选择暂不参加' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
