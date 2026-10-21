const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function addNotice(data) {
  return db.collection('notifications').add({
    data: {
      read: false,
      createdAt: db.serverDate(),
      ...data
    }
  }).catch(() => null)
}

async function addMessage(data) {
  return db.collection('messages').add({
    data: {
      fromOpenid: 'system',
      type: 'text',
      read: false,
      createdAt: db.serverDate(),
      ...data
    }
  }).catch(() => null)
}

function isPaidPlatform(reg) {
  return reg.paymentStatus === 'paid' || !!reg.wxTransactionId
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { registrationId } = event || {}
  if (!registrationId) return { code: -1, msg: '缺少报名ID' }

  try {
    const regRes = await db.collection('event_registrations').doc(registrationId).get()
    const reg = regRes.data || {}
    if (!reg._id && !reg.postId) return { code: -1, msg: '报名记录不存在' }
    if (['cancelled', 'rejected', 'expired'].includes(reg.status)) return { code: -1, msg: '该报名已失效' }
    if (!(reg.memberOpenids || []).includes(OPENID) && reg.captainOpenid !== OPENID) return { code: -1, msg: '无权取消该报名' }

    const postRes = await db.collection('posts').doc(reg.postId).get()
    const post = postRes.data || {}
    if (post.eventStatus === 'closed') return { code: -1, msg: '赛事已结束，不能取消报名' }

    const isCaptain = reg.captainOpenid === OPENID
    const isSolo = reg.registrationType === 'solo' || reg.status === 'solo_pending'

    if (!isCaptain && !isSolo) {
      const members = (reg.members || []).map(member => {
        if (member.openid !== OPENID) return member
        if (reg.status === 'assembling') return { openid: null, name: '', photoUrl: '', confirmed: false, role: 'member' }
        return { ...member, confirmed: false, declined: true, cancelledAt: new Date() }
      })
      const nextOpenids = (reg.memberOpenids || []).filter(id => id !== OPENID)
      await db.collection('event_registrations').doc(registrationId).update({
        data: {
          members,
          memberOpenids: nextOpenids,
          memberCount: nextOpenids.length,
          updatedAt: db.serverDate()
        }
      })
      await addMessage({
        toOpenid: reg.captainOpenid,
        content: `有队员已退出「${reg.teamName || '队伍'}」本次赛事报名，请及时确认参赛名单。`
      })
      return { code: 0, msg: '已退出本次赛事' }
    }

    if (isPaidPlatform(reg)) {
      await db.collection('event_registrations').doc(registrationId).update({
        data: {
          cancelRequested: true,
          cancelRequestedAt: db.serverDate(),
          cancelRequestedBy: OPENID
        }
      })
      await addNotice({
        toOpenid: post.openid,
        type: 'event_cancel_requested',
        postId: reg.postId,
        registrationId,
        teamName: reg.teamName || '',
        content: `队伍「${reg.teamName || '报名队伍'}」申请取消已支付报名，请人工处理退款。`
      })
      return { code: 0, msg: '已提交取消申请，等待平台处理退款' }
    }

    const updateTasks = [
      db.collection('event_registrations').doc(registrationId).update({
        data: {
          status: 'cancelled',
          cancelledAt: db.serverDate(),
          cancelledBy: OPENID,
          cancelReason: 'user_cancel'
        }
      })
    ]

    const postUpdate = {}
    if (reg.status === 'pending') postUpdate.pendingTeams = _.inc(-1)
    if (reg.status === 'approved') {
      postUpdate.registeredTeams = _.inc(-1)
      if (post.eventStatus === 'full') postUpdate.eventStatus = 'open'
    }
    if (Object.keys(postUpdate).length) {
      updateTasks.push(db.collection('posts').doc(reg.postId).update({ data: postUpdate }))
    }

    updateTasks.push(
      db.collection('notifications')
        .where({ registrationId })
        .update({ data: { responded: true, responseAction: 'cancelled', read: true } })
        .catch(() => null)
    )

    await Promise.all(updateTasks)

    const noticeTargets = [...new Set([post.openid, ...(reg.memberOpenids || []), ...(reg.invitedMemberOpenids || [])].filter(id => id && id !== OPENID))]
    await Promise.all(noticeTargets.map(openid => addNotice({
      toOpenid: openid,
      type: 'event_registration_cancelled',
      postId: reg.postId,
      registrationId,
      teamName: reg.teamName || '',
      content: `「${reg.teamName || '报名'}」已取消参加「${post.title || post.content || '赛事'}」。`
    })))

    return { code: 0, msg: '已取消报名' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
