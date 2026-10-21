const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const crypto = require('crypto')

async function sendImportantNotification(data, fallback) {
  try {
    return await cloud.callFunction({
      name: 'sendImportantNotice',
      data: {
        internalChannel: 'notification',
        category: 'team',
        priority: 'urgent',
        actionRequired: true,
        externalPush: true,
        templateType: 'team',
        ...data
      }
    })
  } catch (e) {
    return fallback ? fallback() : null
  }
}

function isPaymentExpired(reg) {
  return reg.status === 'approved' &&
    reg.paymentStatus === 'unpaid' &&
    reg.paymentDeadline &&
    new Date(reg.paymentDeadline) <= new Date()
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, '').toLowerCase()
}

async function checkReputation(openids) {
  const ids = [...new Set((openids || []).filter(Boolean))]
  if (!ids.length) return { ok: true }
  const res = await db.collection('athletes')
    .where({ openid: _.in(ids) })
    .field({ openid: true, name: true, reputation: true })
    .get()
  const low = res.data.find(item => (item.reputation || 80) < 60)
  if (low) return { ok: false, msg: `${low.name || '队员'}信誉分低于60，暂不能参加该项目` }
  return { ok: true }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, teamName, slots, registrationType = 'team', sourceTeamId = '', memberOpenids = [] } = event
  // slots: [{openid, name, photoUrl}] 长度为 teamSize-1，openid 可为 null（空槽）

  if (!['team', 'solo', 'regular_team'].includes(registrationType)) return { code: -1, msg: '报名类型无效' }
  if (registrationType === 'team' && (!teamName || !teamName.trim())) return { code: -1, msg: '请填写队名' }
  if (registrationType === 'regular_team' && !sourceTeamId) return { code: -1, msg: '缺少球队信息' }

  try {
    const postRes = await db.collection('posts').doc(postId).get()
    const post = postRes.data

    if (post.postType !== 'event') return { code: -1, msg: '不是赛事帖' }
    if (post.eventStatus === 'full') return { code: -1, msg: '名额已满' }
    if (post.eventStatus === 'closed') return { code: -1, msg: '报名已关闭' }
    const registrationMode = post.registrationMode || 'team'
    if (registrationType === 'solo' && registrationMode === 'team') return { code: -1, msg: '该赛事仅支持队伍报名' }
    if ((registrationType === 'team' || registrationType === 'regular_team') && registrationMode === 'solo') return { code: -1, msg: '该赛事仅支持散客报名' }

    if (post.registrationDeadline) {
      const deadline = new Date(post.registrationDeadline)
      deadline.setHours(23, 59, 59)
      if (new Date() > deadline) return { code: -1, msg: '报名已截止' }
    }

    const existingRes = await db.collection('event_registrations')
      .where({ postId, memberOpenids: OPENID, status: _.in(['assembling', 'pending', 'approved', 'solo_pending']) })
      .limit(20).get()
    const activeExisting = []
    for (const reg of existingRes.data) {
      if (isPaymentExpired(reg)) {
        await db.collection('event_registrations').doc(reg._id).update({
          data: { status: 'expired', expiredAt: db.serverDate() }
        }).catch(() => {})
      } else {
        activeExisting.push(reg)
      }
    }
    if (activeExisting.length > 0) return { code: -1, msg: '你已报名该赛事' }

    const captainRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    const captain = captainRes.data[0] || {}
    if (captainRes.data.length === 0) return { code: -1, msg: '请先完善个人资料' }
    if ((captain.reputation || 80) < 60) return { code: -1, msg: '你的信誉分低于60，暂不能参加该项目' }

    const inviteCode = crypto.randomBytes(6).toString('hex')
    const now = new Date()

    const members = [
      { openid: OPENID, name: captain.name || '', photoUrl: captain.photo || '', confirmed: true, role: 'captain' }
    ]
    const invitedOpenids = []

    if (registrationType === 'solo') {
      const addRes = await db.collection('event_registrations').add({
        data: {
          postId,
          registrationType: 'solo',
          athleteOpenid: OPENID,
          captainOpenid: OPENID,
          teamName: '',
          members: [{ openid: OPENID, name: captain.name || '', photoUrl: captain.photo || '', confirmed: true, role: 'solo' }],
          memberOpenids: [OPENID],
          memberCount: 1,
          status: 'solo_pending',
          paymentStatus: 'unpaid',
          createdAt: db.serverDate()
        }
      })
      return { code: 0, msg: '已进入散客池，等待队长邀请', registrationId: addRes._id }
    }

    if (registrationType === 'regular_team') {
      const teamRes = await db.collection('teams').doc(sourceTeamId).get()
      const team = teamRes.data || {}
      if (!team._id && !team.name) return { code: -1, msg: '球队不存在' }
      if (team.captainOpenid !== OPENID) return { code: -1, msg: '只有队长可以代表球队报名' }
      if (post.sport && team.sport && post.sport !== team.sport) return { code: -1, msg: '球队运动类型与赛事不匹配' }

      const cleanRegularTeamName = String(team.name || '').trim()
      const regularTeamNameKey = normalizeName(cleanRegularTeamName)
      const sameRegularRes = await db.collection('event_registrations')
        .where({
          postId,
          status: _.in(['assembling', 'pending', 'approved'])
        })
        .limit(200)
        .get()
      if (sameRegularRes.data.some(r => normalizeName(r.teamName) === regularTeamNameKey || r.sourceTeamId === sourceTeamId)) {
        return { code: -1, msg: '该球队已报名该赛事' }
      }

      const teamMembers = Array.isArray(team.members) ? team.members.filter(m => m && m.openid) : []
      const requestedOpenids = [...new Set((memberOpenids || []).filter(Boolean))]
      const teamMemberIds = new Set(teamMembers.map(member => member.openid))
      if (requestedOpenids.some(id => !teamMemberIds.has(id))) return { code: -1, msg: '参赛名单中包含非本队成员' }
      if (!requestedOpenids.includes(OPENID)) requestedOpenids.unshift(OPENID)
      const maxTeamMembers = post.maxTeamMembers || post.teamSize || 0
      if (maxTeamMembers && requestedOpenids.length > maxTeamMembers) return { code: -1, msg: `本次最多选择 ${maxTeamMembers} 人` }
      const regularMembers = teamMembers.filter(member => requestedOpenids.includes(member.openid)).map(member => ({
        openid: member.openid,
        name: member.name || '',
        photoUrl: member.avatar || '',
        confirmed: member.openid === OPENID,
        role: member.openid === OPENID ? 'captain' : 'member',
        teamRole: member.role || ''
      }))
      if (!regularMembers.some(m => m.openid === OPENID)) {
        regularMembers.unshift({ openid: OPENID, name: captain.name || '', photoUrl: captain.photo || '', confirmed: true, role: 'captain' })
      }
      const invitedOpenidsRegular = regularMembers.map(m => m.openid).filter(id => id && id !== OPENID)
      const addRes = await db.collection('event_registrations').add({
        data: {
          postId,
          registrationType: 'regular_team',
          teamSource: 'regular',
          sourceTeamId,
          captainOpenid: OPENID,
          teamName: cleanRegularTeamName,
          teamNameKey: regularTeamNameKey,
          teamLogo: team.logo || '',
          teamSnapshot: {
            teamId: sourceTeamId,
            name: cleanRegularTeamName,
            logo: team.logo || '',
            cover: team.cover || '',
            sport: team.sport || '',
            description: team.description || '',
            averageScore: team.averageScore || 0,
            captainOpenid: OPENID
          },
          members: regularMembers,
          memberOpenids: [OPENID],
          invitedMemberOpenids: invitedOpenidsRegular,
          memberCount: 1,
          maxTeamMembers: post.maxTeamMembers || post.teamSize || 0,
          inviteCode,
          status: 'assembling',
          paymentStatus: post.entryFee > 0 ? 'pending_deadline' : 'free',
          paymentPlan: post.entryFee > 0 ? 'aa_after_deadline' : 'free',
          paymentNote: post.entryFee > 0 ? '报名截止后由已确认参赛队员统一 AA 缴费' : '',
          createdAt: db.serverDate()
        }
      })
      const registrationId = addRes._id

      const postTitle = post.title || post.content?.slice(0, 20) || '赛事'
      await Promise.all(invitedOpenidsRegular.map(openid =>
        sendImportantNotification({
          fromOpenid: OPENID,
          toOpenid: openid,
          noticeType: 'regular_team_event_invite',
          notificationType: 'regular_team_event_invite',
          title: '球队参赛确认',
          content: `你的球队「${cleanRegularTeamName}」正在组队报名「${postTitle}」，请确认是否参赛`,
          registrationId,
          postId,
          sourceTeamId,
          captainName: captain.name || '',
          teamName: cleanRegularTeamName,
          responded: false,
          page: '/pages/notifications/notifications'
        }, () => db.collection('notifications').add({
          data: { fromOpenid: OPENID, toOpenid: openid, type: 'regular_team_event_invite', content: `你的球队「${cleanRegularTeamName}」正在组队报名「${postTitle}」，请确认是否参赛`, registrationId, postId, sourceTeamId, captainName: captain.name || '', teamName: cleanRegularTeamName, createdAt: db.serverDate(), read: false, responded: false }
        }))
      ))

      return { code: 0, msg: '已创建球队报名，等待队员确认后提交审核', registrationId, inviteCode }
    }

    const cleanTeamName = teamName.trim()
    const sameTeamRes = await db.collection('event_registrations')
      .where({
        postId,
        status: _.in(['assembling', 'pending', 'approved'])
      })
      .limit(200)
      .get()
    const teamNameKey = normalizeName(cleanTeamName)
    if (sameTeamRes.data.some(r => normalizeName(r.teamName) === teamNameKey)) {
      return { code: -1, msg: '队名已存在，请换一个队名' }
    }

    const seenOpenids = { [OPENID]: true }
    const seenNames = {}
    const captainNameKey = normalizeName(captain.name)
    if (captainNameKey) seenNames[captainNameKey] = true

    ;(slots || []).forEach(s => {
      if (s && s.openid) {
        const nameKey = normalizeName(s.name)
        if (seenOpenids[s.openid] || (nameKey && seenNames[nameKey])) {
          throw new Error('队员不能重复')
        }
        seenOpenids[s.openid] = true
        if (nameKey) seenNames[nameKey] = true
        members.push({ openid: s.openid, name: s.name || '', photoUrl: s.photoUrl || '', confirmed: false, role: 'member', invitedAt: now })
        invitedOpenids.push(s.openid)
      } else {
        members.push({ openid: null, name: '', photoUrl: '', confirmed: false, role: 'member' })
      }
    })

    const repCheck = await checkReputation(members.map(item => item.openid))
    if (!repCheck.ok) return { code: -1, msg: repCheck.msg }

    const addRes = await db.collection('event_registrations').add({
      data: {
        postId,
        registrationType: 'team',
        captainOpenid: OPENID,
        teamName: cleanTeamName,
        teamNameKey,
        members,
        memberOpenids: [OPENID],
        memberCount: 1,
        maxTeamMembers: post.maxTeamMembers || post.teamSize || 0,
        inviteCode,
        status: 'assembling',
        paymentStatus: post.entryFee > 0 ? 'pending_deadline' : 'free',
        paymentPlan: post.entryFee > 0 ? 'aa_after_deadline' : 'free',
        paymentNote: post.entryFee > 0 ? '报名截止后由已确认参赛队员统一 AA 缴费' : '',
        createdAt: db.serverDate()
      }
    })

    const registrationId = addRes._id

    // pendingTeams 在队伍全员到位（assembling→pending）时才加，这里不加

    const postTitle = post.title || post.content?.slice(0, 20) || '赛事'
    await Promise.all(invitedOpenids.map(openid =>
      sendImportantNotification({
        fromOpenid: OPENID,
        toOpenid: openid,
        noticeType: 'team_invite',
        notificationType: 'team_invite',
        title: '队伍邀请',
        content: `「${cleanTeamName}」· ${postTitle}`,
        registrationId,
        postId,
        captainName: captain.name || '',
        teamName: cleanTeamName,
        responded: false,
        page: '/pages/notifications/notifications'
      }, () => db.collection('notifications').add({
        data: { fromOpenid: OPENID, toOpenid: openid, type: 'team_invite', content: `「${cleanTeamName}」· ${postTitle}`, registrationId, postId, captainName: captain.name || '', teamName: cleanTeamName, createdAt: db.serverDate(), read: false, responded: false }
      }))
    ))

    return { code: 0, msg: '报名已提交，邀请队友后等待审核', inviteCode, registrationId }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
