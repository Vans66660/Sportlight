const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function sendImportantNotice(data, fallback) {
  try {
    return await Promise.race([
      cloud.callFunction({
        name: 'sendImportantNotice',
        data: {
          externalPush: true,
          templateType: data.templateType || data.category || 'event',
          ...data
        }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('notice timeout')), 800))
    ])
  } catch (e) {
    if (fallback) {
      try {
        return await Promise.race([
          fallback(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('fallback notice timeout')), 500))
        ])
      } catch (fallbackError) {
        return null
      }
    }
    return null
  }
}

function isMissingCollection(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist')
}

async function getEventAdmin(postId, openid) {
  try {
    const res = await db.collection('eventAdmins')
      .where({ postId, adminOpenid: openid, status: 'accepted' })
      .limit(1)
      .get()
    return (res.data || [])[0] || null
  } catch (e) {
    if (isMissingCollection(e)) return null
    throw e
  }
}

const REJECT_REASON_LABELS = {
  team_size_not_met: '队伍人数未达标',
  member_info_incomplete: '队员信息不完整',
  member_identity_not_eligible: '队员身份不符合赛事要求',
  offline_payment_unconfirmed: '报名费/线下收款未确认',
  team_profile_invalid: '队名或头像不符合规范',
  duplicate_registration: '重复报名',
  event_full: '赛事名额已满',
  other: '其它'
}

function normalizeRejectMeta(event = {}) {
  const type = String(event.rejectReasonType || '').trim()
  const label = REJECT_REASON_LABELS[type] || ''
  const rawReason = String(event.rejectReason || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const rawRemark = String(event.rejectRemark || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const reason = type === 'other' ? (rawRemark || rawReason) : (label || rawReason)
  return {
    rejectReasonType: label ? type : 'other',
    rejectReason: reason,
    rejectRemark: type === 'other' ? (rawRemark || rawReason) : rawRemark
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, registrationId, action } = event

  try {
    if (!postId || !registrationId || !['approve', 'reject'].includes(action)) {
      return { code: -1, msg: '参数错误' }
    }
    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    const eventAdmin = await getEventAdmin(postId, OPENID)
    if (!isAdmin && post.openid !== OPENID && (!eventAdmin || eventAdmin.role !== 'full')) return { code: -1, msg: '无权限' }

    const regRes = await db.collection('event_registrations').doc(registrationId).get()
    const reg = regRes.data
    if (reg.status !== 'pending') return { code: -1, msg: '该报名已处理' }

    const eventContent = post.content ? post.content.slice(0, 30) : '赛事'

    if (action === 'approve') {
      const minTeamSize = post.minTeamSize || post.teamSize || 1
      const maxTeamMembers = post.maxTeamMembers || 0
      const confirmedOpenids = new Set((reg.memberOpenids || []).filter(Boolean))
      ;(reg.members || []).forEach(member => {
        if (member && member.openid && member.confirmed) confirmedOpenids.add(member.openid)
      })
      const confirmedCount = confirmedOpenids.size
      if (confirmedCount < minTeamSize) {
        return { code: -1, msg: `人数不足，至少 ${minTeamSize} 人才能通过报名` }
      }
      if (maxTeamMembers && confirmedCount > maxTeamMembers) {
        return { code: -1, msg: `人数超过上限，最多 ${maxTeamMembers} 人` }
      }
      if (post.maxTeams && (post.registeredTeams || 0) >= post.maxTeams) {
        return { code: -1, msg: '名额已满，无法继续通过报名' }
      }
      const isFree = !post.entryFee || post.entryFee <= 0
      const paymentStatus = isFree ? 'free' : 'offline'
      await db.collection('event_registrations').doc(registrationId).update({
        data: {
          status: 'approved',
          paymentStatus,
          approvedAt: db.serverDate()
        }
      })

      const postUpdate = {
        pendingTeams: _.inc(-1),
        registeredTeams: _.inc(1)
      }
      const newTeamCount = (post.registeredTeams || 0) + 1
      if (post.maxTeams && newTeamCount >= post.maxTeams) {
        postUpdate.eventStatus = 'full'
      }
      await db.collection('posts').doc(postId).update({ data: postUpdate })

      const notifyContent = isFree
        ? `🎉 你的队伍「${reg.teamName}」已通过审核，参赛资格已确认！请到赛事详情页查看赛务联系二维码。`
        : `🎉 你的队伍「${reg.teamName}」已通过审核，参赛资格已确认！报名截止后将由已确认参赛队员按 AA 方式缴费，请留意赛务通知。`

      const memberOnlyOpenids = (reg.memberOpenids || []).filter(id => id !== reg.captainOpenid)

      try {
        // 通知队长
        await sendImportantNotice({
          internalChannel: 'notification',
          toOpenid: reg.captainOpenid,
          category: 'event',
          priority: 'urgent',
          actionRequired: !isFree,
          noticeType: 'event_approved',
          notificationType: 'event_approved',
          title: '报名已通过',
          content: notifyContent,
          postId,
          registrationId,
          eventContent,
          entryFee: post.entryFee || 0,
          page: `/pages/post-detail/post-detail?id=${postId}`
        }, () => db.collection('notifications').add({
          data: { toOpenid: reg.captainOpenid, type: 'event_approved', postId, registrationId, eventContent, entryFee: post.entryFee || 0, read: false, createdAt: db.serverDate() }
        }))

        // 通知其他队员
        const memberMsg = isFree
          ? `🎉 队伍「${reg.teamName}」已通过审核，参赛资格已确认！`
          : `🎉 队伍「${reg.teamName}」已通过审核，参赛资格已确认！报名截止后将统一按 AA 方式缴费，请留意赛务通知。`
        await Promise.all(memberOnlyOpenids.map(openid =>
          sendImportantNotice({
            internalChannel: 'message',
            fromOpenid: 'system',
            toOpenid: openid,
            category: 'event',
            priority: 'important',
            actionRequired: false,
            noticeType: 'event_approved_member',
            title: '参赛资格已确认',
            content: memberMsg,
            page: `/pages/post-detail/post-detail?id=${postId}`
          }, () => db.collection('messages').add({
            data: { fromOpenid: 'system', toOpenid: openid, type: 'text', content: memberMsg, createdAt: db.serverDate(), read: false }
          }))
        ))
      } catch (e) {}

      return { code: 0, msg: '已通过' }
    } else {
      const rejectMeta = normalizeRejectMeta(event)
      if (!rejectMeta.rejectReason) {
        return { code: -1, msg: '请选择或填写拒绝原因' }
      }
      await db.collection('event_registrations').doc(registrationId).update({
        data: {
          status: 'rejected',
          ...rejectMeta,
          rejectedBy: OPENID,
          rejectedAt: db.serverDate()
        }
      })
      await db.collection('posts').doc(postId).update({
        data: { pendingTeams: _.inc(-1) }
      })

      const memberOnlyOpenids = (reg.memberOpenids || []).filter(id => id !== reg.captainOpenid)
      const rejectedContent = `❌ 队伍「${reg.teamName}」报名未通过审核：${rejectMeta.rejectReason}`

      try {
        await sendImportantNotice({
          internalChannel: 'notification',
          toOpenid: reg.captainOpenid,
          category: 'event',
          priority: 'urgent',
          actionRequired: false,
          noticeType: 'event_rejected',
          notificationType: 'event_rejected',
          title: '报名未通过',
          content: rejectedContent,
          postId,
          registrationId,
          ...rejectMeta,
          eventContent,
          page: `/pages/post-detail/post-detail?id=${postId}`
        }, () => db.collection('notifications').add({
          data: {
            toOpenid: reg.captainOpenid,
            type: 'event_rejected',
            postId,
            registrationId,
            eventContent,
            content: rejectedContent,
            ...rejectMeta,
            read: false,
            createdAt: db.serverDate()
          }
        }))
        // 通知其他队员
        await Promise.all(memberOnlyOpenids.map(openid =>
          sendImportantNotice({
            internalChannel: 'message',
            fromOpenid: 'system',
            toOpenid: openid,
            category: 'event',
            priority: 'important',
            actionRequired: false,
            noticeType: 'event_rejected_member',
            title: '报名未通过',
            content: rejectedContent,
            ...rejectMeta,
            page: `/pages/post-detail/post-detail?id=${postId}`
          }, () => db.collection('messages').add({
            data: { fromOpenid: 'system', toOpenid: openid, type: 'text', content: rejectedContent, createdAt: db.serverDate(), read: false }
          }))
        ))
      } catch (e) {}

      return { code: 0, msg: '已拒绝' }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
