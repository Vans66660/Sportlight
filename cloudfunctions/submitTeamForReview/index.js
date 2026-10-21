const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { registrationId } = event

  if (!registrationId) return { code: -1, msg: 'registrationId 缺失' }

  try {
    const regRes = await db.collection('event_registrations').doc(registrationId).get()
    const reg = regRes.data
    if (!reg) return { code: -1, msg: '报名不存在' }
    if (reg.status !== 'assembling') return { code: -1, msg: '该队伍不能提交审核' }

    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(reg.postId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }
    const isAdmin = (userRes.data || []).some(user => user.userType === 'admin')
    const eventAdmin = await getEventAdmin(reg.postId, OPENID)
    const canSubmit = reg.captainOpenid === OPENID || isAdmin || post.openid === OPENID || (eventAdmin && eventAdmin.role === 'full')
    if (!canSubmit) return { code: -1, msg: '无权操作' }
    if (post.eventStatus === 'full') return { code: -1, msg: '名额已满' }
    if (post.eventStatus === 'closed') return { code: -1, msg: '报名已关闭' }
    if (post.registrationDeadline) {
      const deadline = new Date(post.registrationDeadline)
      deadline.setHours(23, 59, 59, 999)
      if (new Date() > deadline) return { code: -1, msg: '报名已截止' }
    }

    const members = reg.members || []
    const confirmedMembers = members.filter(m => m && m.openid && m.confirmed)
    const membersForReview = members.map(m => {
      if (m && m.openid && !m.confirmed) return { openid: null, name: '', photoUrl: '', confirmed: false, role: 'member' }
      return m
    })
    const minTeamSize = post.minTeamSize || post.teamSize || 1
    const maxTeamMembers = post.maxTeamMembers || 0

    if (confirmedMembers.length < minTeamSize) {
      return { code: -1, msg: `人数不足，至少 ${minTeamSize} 人才能成队` }
    }
    if (maxTeamMembers && confirmedMembers.length > maxTeamMembers) {
      return { code: -1, msg: `人数超过上限，最多 ${maxTeamMembers} 人` }
    }
    await Promise.all([
      db.collection('event_registrations').doc(registrationId).update({
        data: {
          status: 'pending',
          members: membersForReview,
          memberOpenids: confirmedMembers.map(m => m.openid),
          memberCount: confirmedMembers.length,
          submittedBy: OPENID,
          submittedAt: db.serverDate()
        }
      }),
      db.collection('posts').doc(reg.postId).update({
        data: { pendingTeams: _.inc(1) }
      })
    ])

    return { code: 0, msg: '已提交审核' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
