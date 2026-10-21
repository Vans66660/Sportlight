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

function chunk(list, size = 20) {
  const chunks = []
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size))
  return chunks
}

function cleanProfileName(...names) {
  for (const raw of names) {
    const name = String(raw || '').trim()
    if (!name) continue
    if (/^用户SL\d+$/i.test(name)) continue
    return name
  }
  return ''
}

async function getMemberProfileMap(registrations) {
  const openids = []
  ;(registrations || []).forEach(reg => {
    ;(reg.members || []).forEach(member => {
      if (member && member.openid) openids.push(member.openid)
    })
  })
  const ids = [...new Set(openids)]
  if (!ids.length) return {}

  const profileMap = {}
  for (const group of chunk(ids)) {
    const [athleteRes, userRes] = await Promise.all([
      db.collection('athletes')
        .where({ openid: _.in(group) })
        .field({ openid: true, name: true, nickname: true, displayName: true, photo: true })
        .get()
        .catch(() => ({ data: [] })),
      db.collection('users')
        .where({ openid: _.in(group) })
        .field({ openid: true, name: true, nickname: true, displayName: true, photo: true })
        .get()
        .catch(() => ({ data: [] }))
    ])
    ;(userRes.data || []).forEach(user => {
      profileMap[user.openid] = {
        name: cleanProfileName(user.name, user.nickname, user.displayName),
        photoUrl: user.photo || ''
      }
    })
    ;(athleteRes.data || []).forEach(athlete => {
      const existing = profileMap[athlete.openid] || {}
      profileMap[athlete.openid] = {
        ...existing,
        name: cleanProfileName(athlete.name, athlete.nickname, athlete.displayName, existing.name),
        photoUrl: athlete.photo || existing.photoUrl || ''
      }
    })
  }
  return profileMap
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId } = event

  try {
    const [postRes, userRes, myTeamRes] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get(),
      db.collection('event_registrations')
        .where({ postId, captainOpenid: OPENID, status: db.command.in(['assembling', 'pending', 'approved']) })
        .limit(20)
        .get()
    ])
    const post = postRes.data
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    const eventAdmin = await getEventAdmin(postId, OPENID)
    const isOwner = post.openid === OPENID
    const isCaptain = myTeamRes.data.length > 0

    if (!isOwner && !isAdmin && !eventAdmin && !isCaptain) return { code: -1, msg: '无权限' }

    const regsRes = await db.collection('event_registrations')
      .where({ postId })
      .orderBy('createdAt', 'asc')
      .limit(200)
      .get()

    const profileMap = await getMemberProfileMap(regsRes.data)

    const enrichedRegs = regsRes.data.map(reg => ({
      ...reg,
      members: (reg.members || []).map(member => {
        if (!member || !member.openid) return member
        const profile = profileMap[member.openid] || {}
        return {
          ...member,
          name: member.name || profile.name || '',
          photoUrl: member.photoUrl || profile.photoUrl || ''
        }
      })
    }))

    // 收集所有 cloud:// 头像
    const fileIDs = []
    enrichedRegs.forEach(r => {
      ;(r.members || []).forEach(m => {
        if (m.photoUrl && m.photoUrl.startsWith('cloud://')) fileIDs.push(m.photoUrl)
      })
    })
    let urlMap = {}
    if (fileIDs.length > 0) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: [...new Set(fileIDs)] })
        tempRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
      } catch (e) {}
    }

    const mapReg = r => ({
      ...r,
      members: (r.members || []).map(m => ({
        ...m,
        photoUrl: urlMap[m.photoUrl] || m.photoUrl || ''
      }))
    })

    const canManage = isOwner || isAdmin || !!eventAdmin
    const canApprove = isOwner || isAdmin || (eventAdmin && eventAdmin.role === 'full')
    const canRecord = isAdmin || !!eventAdmin
    const myTeamIds = myTeamRes.data.map(t => t._id)
    const visibleTeam = r => canManage || myTeamIds.includes(r._id)

    const assembling = enrichedRegs.filter(r => r.status === 'assembling' && visibleTeam(r)).map(mapReg)
    const pending = enrichedRegs.filter(r => r.status === 'pending' && visibleTeam(r)).map(mapReg)
    const approved = enrichedRegs.filter(r => r.status === 'approved' && visibleTeam(r)).map(mapReg)
    const solo = enrichedRegs.filter(r => r.status === 'solo_pending').map(mapReg)

    let hasExisting = false
    try {
      const existRes = await db.collection('eventResults').where({ postId }).limit(1).get()
      hasExisting = existRes.data.length > 0
    } catch (e) {}

    return {
      code: 0,
      assembling,
      pending,
      solo,
      confirmed: approved,
      post: {
        title: post.title || '',
        content: post.content ? post.content.slice(0, 40) : '',
        eventDate: post.eventDate || '',
        sport: post.sport || '',
        registrationMode: post.registrationMode || 'team',
        teamSize: post.teamSize || 5,
        minTeamSize: post.minTeamSize || post.teamSize || 5,
        maxTeamMembers: post.maxTeamMembers || 0,
        teamSizeLabel: post.teamSizeLabel || '',
        maxTeams: post.maxTeams || 0,
        entryFee: post.entryFee || 0,
        hasExisting,
        canManage,
        canApprove,
        canRecord,
        isCaptain
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
