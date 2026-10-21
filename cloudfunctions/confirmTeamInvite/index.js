const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
  const { registrationId, action } = event // action: 'accept' | 'decline'

  if (!['accept', 'decline'].includes(action)) return { code: -1, msg: '无效操作' }

  try {
    const regRes = await db.collection('event_registrations').doc(registrationId).get()
    const reg = regRes.data
    const postRes = await db.collection('posts').doc(reg.postId).get()
    const post = postRes.data

    if (reg.status !== 'assembling') return { code: -1, msg: '报名已关闭' }

    const memberIdx = reg.members.findIndex(m => m.openid === OPENID && !m.confirmed)
    if (memberIdx === -1) return { code: -1, msg: '该邀请已失效，对应位置可能已被他人加入或邀请已过期' }

    const newMembers = [...reg.members]
    const userRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    const userName = userRes.data[0]?.name || '队员'

    if (action === 'accept') {
      const conflictRes = await db.collection('event_registrations')
        .where({ postId: reg.postId, memberOpenids: OPENID, status: _.in(['assembling', 'pending', 'approved', 'solo_pending']) })
        .limit(1).get()
      if (conflictRes.data.length > 0) return { code: -1, msg: '你已在该赛事的另一支队伍中，无法接受此邀请' }

      newMembers[memberIdx] = { ...newMembers[memberIdx], confirmed: true, respondedAt: new Date() }
      const confirmedCount = newMembers.filter(m => m.openid && m.confirmed).length
      const minTeamSize = post.minTeamSize || post.teamSize || 1

      await db.collection('event_registrations').doc(registrationId).update({
        data: {
          members: newMembers,
          status: 'assembling',
          memberOpenids: _.push(OPENID),
          memberCount: confirmedCount
        }
      })

      const acceptContent = `✅ ${userName} 已确认加入队伍「${reg.teamName}」${confirmedCount >= minTeamSize ? '，队伍已达到成队人数，可提交审核！🎉' : ''}`
      await sendTeamMessage({
        fromOpenid: 'system',
        toOpenid: reg.captainOpenid,
        noticeType: 'team_invite_accepted',
        title: '队友已确认参赛',
        content: acceptContent,
        actionRequired: confirmedCount >= minTeamSize
      }, () => db.collection('messages').add({
        data: { fromOpenid: 'system', toOpenid: reg.captainOpenid, type: 'text', content: acceptContent, createdAt: db.serverDate(), read: false }
      }))

      // 标记通知已响应
      try {
        const notifRes = await db.collection('notifications')
          .where({ toOpenid: OPENID, registrationId, type: 'team_invite' }).limit(1).get()
        if (notifRes.data.length > 0) {
          await db.collection('notifications').doc(notifRes.data[0]._id).update({
            data: { responded: true, responseAction: 'accept', read: true }
          })
        }
      } catch (e) {}

      return { code: 0, msg: '已确认参赛！' }
    } else {
      newMembers[memberIdx] = { openid: null, name: '', photoUrl: '', confirmed: false, role: 'member' }

      await db.collection('event_registrations').doc(registrationId).update({
        data: {
          members: newMembers,
          status: 'assembling',
          memberOpenids: _.pull(OPENID)
        }
      })

      const declineContent = `❌ ${userName} 拒绝了加入「${reg.teamName}」的邀请，该槽位已释放，请重新邀请队员`
      await sendTeamMessage({
        fromOpenid: 'system',
        toOpenid: reg.captainOpenid,
        noticeType: 'team_invite_declined',
        title: '队友拒绝邀请',
        content: declineContent,
        actionRequired: true
      }, () => db.collection('messages').add({
        data: { fromOpenid: 'system', toOpenid: reg.captainOpenid, type: 'text', content: declineContent, createdAt: db.serverDate(), read: false }
      }))

      // 标记通知已响应
      try {
        const notifRes = await db.collection('notifications')
          .where({ toOpenid: OPENID, registrationId, type: 'team_invite' }).limit(1).get()
        if (notifRes.data.length > 0) {
          await db.collection('notifications').doc(notifRes.data[0]._id).update({
            data: { responded: true, responseAction: 'decline', read: true }
          })
        }
      } catch (e) {}

      return { code: 0, msg: '已拒绝邀请' }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
