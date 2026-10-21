const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function updateAverage(teamId) {
  const teamRes = await db.collection('teams').doc(teamId).get()
  const team = teamRes.data || {}
  const members = team.members || []
  const averageScore = members.length ? Math.round(members.reduce((sum, m) => sum + Number(m.score || 0), 0) / members.length) : 0
  await db.collection('teams').doc(teamId).update({ data: { averageScore, updatedAt: db.serverDate() } })
}

function sportLabel(sport) {
  if (sport === 'football') return '足球'
  if (sport === 'basketball') return '篮球'
  if (sport === 'badminton') return '羽毛球'
  return sport || ''
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const inviteId = String((event && event.inviteId) || '')
  const action = String((event && event.action) || '')
  if (!inviteId || !['accept', 'decline'].includes(action)) return { code: -1, msg: '参数错误' }
  try {
    const inviteRes = await db.collection('teamInvites').doc(inviteId).get()
    const invite = inviteRes.data || {}
    if (invite.toOpenid !== OPENID) return { code: -1, msg: '无权限' }
    if (invite.status !== 'pending') return { code: -1, msg: '邀请已处理' }
    const now = db.serverDate()
    if (action === 'decline') {
      await db.collection('teamInvites').doc(inviteId).update({ data: { status: 'declined', handledAt: now } })
      return { code: 0, msg: '已拒绝' }
    }
    const [teamRes, athleteRes, myTeamsRes] = await Promise.all([
      db.collection('teams').doc(invite.teamId).get(),
      db.collection('athletes').where({ openid: OPENID }).limit(1).get(),
      db.collection('teams').where({ memberOpenids: OPENID, status: _.neq('deleted') }).limit(5).get()
    ])
    const team = teamRes.data || {}
    if ((team.memberOpenids || []).includes(OPENID)) return { code: -1, msg: '你已经在该球队中' }
    if ((myTeamsRes.data || []).length >= 3) return { code: -1, msg: '最多加入3支球队' }
    const athlete = athleteRes.data[0] || {}
    const teamSport = sportLabel(team.sport)
    const athleteSport = sportLabel(athlete.sport)
    if (teamSport && athleteSport && teamSport !== athleteSport) return { code: -1, msg: `该球队是${teamSport}球队，仅允许${teamSport}运动员加入` }
    const member = {
      openid: OPENID,
      name: athlete.name || invite.toName || '队员',
      displayName: athlete.nickname || (athlete.displayName && athlete.displayName !== athlete.name ? athlete.displayName : '') || `用户${athlete.sportlightId || invite.toSportlightId || ''}`,
      avatar: athlete.photo || '',
      score: athlete.currentSeasonScore || athlete.competitionScore || 0,
      position: athlete.position || '',
      role: 'member',
      joinedAt: now
    }
    await db.collection('teams').doc(invite.teamId).update({
      data: { members: _.push(member), memberOpenids: _.push(OPENID), updatedAt: now }
    })
    await db.collection('teamInvites').doc(inviteId).update({ data: { status: 'accepted', handledAt: now } })
    await updateAverage(invite.teamId)
    await db.collection('notifications').add({
      data: { toOpenid: team.captainOpenid, type: 'team_member_invite_accepted', teamId: invite.teamId, teamName: team.name || invite.teamName || '', content: `${member.displayName} 已同意加入「${team.name || invite.teamName || '球队'}」`, read: false, createdAt: now }
    })
    return { code: 0, msg: '已加入球队' }
  } catch (e) { return { code: -1, msg: e.message } }
}
