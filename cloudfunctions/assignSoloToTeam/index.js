const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function canManageEvent(postId, post, openid) {
  const userRes = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  if ((userRes.data || []).some(user => user.userType === 'admin') || post.openid === openid) return true
  const adminRes = await db.collection('eventAdmins')
    .where({ postId, adminOpenid: openid, status: 'accepted' })
    .limit(1).get()
    .catch(() => ({ data: [] }))
  return (adminRes.data || []).length > 0
}

function countOccupied(members) {
  return (members || []).filter(member => member && member.openid).length
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, soloRegistrationId, teamRegistrationId } = event
  if (!postId || !soloRegistrationId || !teamRegistrationId) return { code: -1, msg: '参数缺失' }
  if (soloRegistrationId === teamRegistrationId) return { code: -1, msg: '不能分配到同一条报名记录' }

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
    if (!(await canManageEvent(postId, post, OPENID))) return { code: -1, msg: '无权直接分配球员' }
    if (!solo || solo.postId !== postId || solo.status !== 'solo_pending') return { code: -1, msg: '该散客报名不可分配' }
    if (!team || team.postId !== postId || !['assembling', 'pending', 'approved'].includes(team.status) || team.registrationType === 'solo') return { code: -1, msg: '目标队伍当前不可接收队员' }

    const soloMember = (solo.members || []).find(member => member && member.openid)
    if (!soloMember) return { code: -1, msg: '散客报名缺少球员信息' }
    if ((team.memberOpenids || []).includes(soloMember.openid)) return { code: -1, msg: '该球员已在目标队伍中' }
    const maxTeamMembers = post.maxTeamMembers || post.teamSize || 0
    if (maxTeamMembers && countOccupied(team.members) >= maxTeamMembers) return { code: -1, msg: '目标队伍人数已达上限' }

    const members = [...(team.members || [])]
    const member = { openid: soloMember.openid, name: soloMember.name || '', photoUrl: soloMember.photoUrl || '', confirmed: true, role: 'member', assignedFromSolo: true, assignedBy: OPENID, assignedAt: new Date() }
    const emptyIndex = members.findIndex(item => !item.openid)
    if (emptyIndex >= 0) members[emptyIndex] = member
    else members.push(member)
    const memberOpenids = [...new Set([...(team.memberOpenids || []), soloMember.openid])]

    await Promise.all([
      db.collection('event_registrations').doc(teamRegistrationId).update({
        data: { members, memberOpenids, memberCount: members.filter(item => item.openid && item.confirmed).length, updatedAt: db.serverDate() }
      }),
      db.collection('event_registrations').doc(soloRegistrationId).update({
        data: { status: 'assigned', assignedTeamId: teamRegistrationId, assignedBy: OPENID, assignedAt: db.serverDate() }
      }),
      db.collection('notifications').where({ type: 'solo_team_invite', toOpenid: soloMember.openid, soloRegistrationId, responded: false })
        .update({ data: { responded: true, responseAction: 'admin_assigned', read: true } }).catch(() => null),
      db.collection('messages').add({
        data: { fromOpenid: 'system', toOpenid: soloMember.openid, type: 'text', content: `赛事管理方已将你分配至「${team.teamName || '该队伍'}」参加「${post.title || '本次赛事'}」。`, createdAt: db.serverDate(), read: false }
      })
    ])
    return { code: 0, msg: '已直接分配到队伍' }
  } catch (e) { return { code: -1, msg: e.message } }
}
