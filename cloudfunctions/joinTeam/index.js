const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, '').toLowerCase()
}

function sportLabel(sport) {
  if (sport === 'football') return '足球'
  if (sport === 'basketball') return '篮球'
  if (sport === 'badminton') return '羽毛球'
  return sport || ''
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { inviteCode, preview } = event

  if (!inviteCode) return { code: -1, msg: '邀请码缺失' }

  try {
    const regRes = await db.collection('event_registrations')
      .where({ inviteCode, status: _.in(['assembling', 'pending', 'approved']) })
      .limit(1).get()

    if (regRes.data.length === 0) return { code: -1, msg: '邀请链接已失效' }
    const reg = regRes.data[0]
    const isRegularTeam = reg.registrationType === 'regular_team' && reg.sourceTeamId

    const existingMember = (reg.members || []).find(m => m.openid === OPENID)
    const alreadyMember = !!existingMember
    const alreadyConfirmed = !!(existingMember && existingMember.confirmed)

    if (preview) {
      if ((!isRegularTeam && alreadyMember) || (isRegularTeam && alreadyConfirmed)) return { code: -1, msg: '你已在本次赛事名单中', alreadyMember: true }
      const maxMembers = reg.maxTeamMembers || 0
      const confirmedCount = (reg.members || []).filter(m => m.openid && m.confirmed).length
      const emptySlots = reg.members.filter(m => !m.openid).length
      if (!isRegularTeam && emptySlots === 0) return { code: -1, msg: '队伍已满' }
      if (isRegularTeam && maxMembers && confirmedCount >= maxMembers) return { code: -1, msg: '本次赛事名单已满' }
      const postRes = await db.collection('posts').doc(reg.postId).get()
      const post = postRes.data
      return {
        code: 0,
        reg: { teamName: reg.teamName, members: reg.members, postId: reg.postId, registrationType: reg.registrationType, maxTeamMembers: maxMembers },
        postTitle: post.title || post.content?.slice(0, 30) || '赛事',
        eventDate: post.eventDate || '',
        eventLocation: post.eventLocation || ''
      }
    }

    if ((!isRegularTeam && alreadyMember) || (isRegularTeam && alreadyConfirmed)) return { code: -1, msg: '你已在本次赛事名单中' }

    const conflictRes = await db.collection('event_registrations')
      .where({ postId: reg.postId, memberOpenids: OPENID, status: _.in(['assembling', 'pending', 'approved', 'solo_pending']) })
      .limit(1).get()
    if (conflictRes.data.length > 0) return { code: -1, msg: '你已在该赛事的另一支队伍中' }

    const userRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    if (userRes.data.length === 0) return { code: -1, msg: '请先完善个人资料' }
    const user = userRes.data[0]
    const nameKey = normalizeName(user.name)
    const duplicateName = (reg.members || []).some(m => m.openid && m.openid !== OPENID && normalizeName(m.name) === nameKey)
    if (nameKey && duplicateName) return { code: -1, msg: '队员名不能重复' }

    const userMember = {
      openid: OPENID,
      name: user.name || '',
      photoUrl: user.photo || '',
      confirmed: true,
      role: 'member',
      joinedAt: new Date()
    }

    const postRes = await db.collection('posts').doc(reg.postId).get()
    const maxTeamMembers = postRes.data.maxTeamMembers || postRes.data.teamSize || 0
    let newMembers = [...reg.members]
    if (isRegularTeam) {
      if (existingMember) newMembers = newMembers.map(member => member.openid === OPENID ? { ...member, confirmed: true, joinedAt: new Date() } : member)
      else {
        if (maxTeamMembers && newMembers.filter(m => m.openid && m.confirmed).length >= maxTeamMembers) return { code: -1, msg: '本次赛事名单已满' }
        newMembers.push(userMember)
      }
    } else {
      const emptyIdx = newMembers.findIndex(m => !m.openid)
      if (emptyIdx === -1) return { code: -1, msg: '队伍已满' }
      newMembers[emptyIdx] = userMember
    }
    const confirmedCount = newMembers.filter(m => m.openid && m.confirmed).length
    const minTeamSize = postRes.data.minTeamSize || postRes.data.teamSize || 1

    if (isRegularTeam) {
      const teamRes = await db.collection('teams').doc(reg.sourceTeamId).get()
      const team = teamRes.data
      if (!team || team.status === 'deleted') return { code: -1, msg: '常驻球队不存在' }
      const alreadyInTeam = (team.memberOpenids || []).includes(OPENID) || (team.members || []).some(m => m.openid === OPENID)
      if (!alreadyInTeam) {
        const teamSport = sportLabel(team.sport)
        const userSport = sportLabel(user.sport)
        if (teamSport && userSport && teamSport !== userSport) return { code: -1, msg: `该球队是${teamSport}球队，仅允许${teamSport}运动员加入` }
        const myTeamsRes = await db.collection('teams').where({ memberOpenids: OPENID, status: _.neq('deleted') }).limit(4).get().catch(() => ({ data: [] }))
        if ((myTeamsRes.data || []).length >= 3) return { code: -1, msg: '你最多加入 3 支球队' }
        const teamMembers = [...(team.members || []), { openid: OPENID, name: user.name || '', avatar: user.photo || '', score: user.rating || user.currentSeasonScore || user.competitionScore || 0, position: user.position || '', role: 'member', joinedAt: new Date() }]
        await db.collection('teams').doc(team._id).update({ data: { members: teamMembers, memberOpenids: _.push(OPENID), updatedAt: db.serverDate() } })
      }
    }

    await db.collection('event_registrations').doc(reg._id).update({
      data: {
        members: newMembers,
        status: reg.status === 'approved' ? 'approved' : 'assembling',
        memberOpenids: _.push(OPENID),
        memberCount: confirmedCount
      }
    })

    const postTitle = postRes.data.title || postRes.data.content?.slice(0, 20) || '赛事'

    await db.collection('messages').add({
      data: {
        fromOpenid: 'system',
        toOpenid: reg.captainOpenid,
        type: 'text',
        content: `🙌 ${user.name || '新队员'} 通过邀请链接${isRegularTeam ? '加入球队并确认参赛' : '加入了临时队伍'}「${reg.teamName}」${confirmedCount >= minTeamSize && reg.status === 'assembling' ? '，队伍已达到成队人数，可提交审核！' : ''}`,
        createdAt: db.serverDate(),
        read: false
      }
    })

    return { code: 0, msg: `已加入${isRegularTeam ? '球队并进入本次赛事名单' : `队伍「${reg.teamName}」`}`, teamName: reg.teamName, postTitle, readyForReview: confirmedCount >= minTeamSize, isRegularTeam }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
