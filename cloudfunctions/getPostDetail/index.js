const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function getEndOfDay(dateStr) {
  if (!dateStr) return null
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return null
  date.setHours(23, 59, 59, 999)
  return date
}

function isMissingCollection(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist')
}

async function getAcceptedEventAdmin(postId, openid) {
  if (!postId || !openid) return null
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

async function canViewPost(post, openid) {
  if (!post || post.postType === 'event' || post.openid === openid) return true
  const visibility = post.visibility || 'public'
  if (visibility === 'private') return false
  if (visibility !== 'friends') return true
  const res = await db.collection('friends')
    .where({ userOpenid: openid, friendOpenid: post.openid, status: 'active' })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))
  return (res.data || []).length > 0
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId } = event

  try {
    const postRes = await db.collection('posts').doc(postId).get()
    const p = postRes.data
    if (!(await canViewPost(p, OPENID))) return { code: -1, msg: '该动态不可见' }

    const isEvent = p.postType === 'event'

    // 并行查评论 + 我的报名
    const [commentsRes, myRegRes, captainTeamRes, userRes] = await Promise.all([
      db.collection('comments').where({ postId }).orderBy('createdAt', 'asc').limit(100).get().catch(() => ({ data: [] })),
      isEvent
        ? db.collection('event_registrations').where({ postId, memberOpenids: OPENID }).limit(5).get().catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      isEvent
        ? db.collection('teams').where({ captainOpenid: OPENID, status: db.command.neq('deleted') }).limit(1).get().catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get().catch(() => ({ data: [] }))
    ])

    let myRegistration = null
    if (myRegRes.data.length > 0) {
      const statusPriority = { approved: 5, pending: 4, assembling: 3, solo_pending: 2, expired: 1, assigned: 0 }
      myRegistration = myRegRes.data.sort((a, b) => {
        const ap = statusPriority[a.status] || 0
        const bp = statusPriority[b.status] || 0
        if (ap !== bp) return bp - ap
        const at = a.updatedAt || a.assignedAt || a.createdAt ? new Date(a.updatedAt || a.assignedAt || a.createdAt).getTime() : 0
        const bt = b.updatedAt || b.assignedAt || b.createdAt ? new Date(b.updatedAt || b.assignedAt || b.createdAt).getTime() : 0
        return bt - at
      })[0]
    }

    // 统一收集所有 cloud:// 文件 ID（含队员头像）
    const fileIDs = []
    const rawPhoto = p.authorPhoto || p.athletePhoto || ''
    if (rawPhoto.startsWith('cloud://')) fileIDs.push(rawPhoto)
    ;(p.images || []).forEach(img => { if (img && img.startsWith('cloud://')) fileIDs.push(img) })
    commentsRes.data.forEach(c => {
      if (c.authorPhoto && c.authorPhoto.startsWith('cloud://')) fileIDs.push(c.authorPhoto)
    })
    if (myRegistration) {
      ;(myRegistration.members || []).forEach(m => {
        if (m.photoUrl && m.photoUrl.startsWith('cloud://')) fileIDs.push(m.photoUrl)
      })
    }
    const eventAdmin = isEvent ? await getAcceptedEventAdmin(postId, OPENID) : null
    const isAdmin = (userRes.data || []).some(user => user.userType === 'admin')
    const canManageEvent = isEvent && (isAdmin || p.openid === OPENID || !!eventAdmin)
    const canViewCaptainGroupQr = isEvent && myRegistration &&
      myRegistration.captainOpenid === OPENID &&
      myRegistration.status === 'approved' &&
      ['paid', 'free', 'offline', 'unpaid'].includes(myRegistration.paymentStatus)
    if ((canViewCaptainGroupQr || canManageEvent) && p.captainGroupQr && p.captainGroupQr.startsWith('cloud://')) {
      fileIDs.push(p.captainGroupQr)
    }

    let urlMap = {}
    if (fileIDs.length > 0) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: [...new Set(fileIDs)] })
        tempRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
      } catch (e) {}
    }

    // 截止日期已过时在前端侧覆盖状态，无需等数据库字段更新
    const now = new Date()
    const registrationDeadline = isEvent ? getEndOfDay(p.registrationDeadline) : null
    const deadlinePassed = !!registrationDeadline && registrationDeadline < now
    const fullByCount = !!(p.maxTeams && (p.registeredTeams || 0) >= p.maxTeams)
    const rawEventStatus = p.eventStatus || 'open'
    const effectiveEventStatus = deadlinePassed && rawEventStatus === 'open'
      ? 'closed'
      : (fullByCount && rawEventStatus === 'open' ? 'full' : rawEventStatus)
    const paymentExpired = false
    const captainTeamRaw = (captainTeamRes.data || [])[0] || null
    const captainRegularTeam = captainTeamRaw && (!p.sport || !captainTeamRaw.sport || captainTeamRaw.sport === p.sport) ? {
      teamId: captainTeamRaw._id,
      name: captainTeamRaw.name || '',
      logo: captainTeamRaw.logo || '',
      sport: captainTeamRaw.sport || '',
      memberCount: (captainTeamRaw.memberOpenids || []).length || (captainTeamRaw.members || []).length || 0
    } : null

    const post = {
      ...p,
      captainGroupQr: canManageEvent ? (p.captainGroupQr || '') : '',
      captainGroupQrUrl: canViewCaptainGroupQr ? (urlMap[p.captainGroupQr] || p.captainGroupQr || '') : '',
      canViewCaptainGroupQr,
      eventStatus: effectiveEventStatus,
      registrationMode: p.registrationMode || 'team',
      minTeamSize: p.minTeamSize || p.teamSize || 5,
      maxTeamMembers: p.maxTeamMembers || 0,
      authorType: p.authorType || 'athlete',
      authorName: p.authorName || p.athleteName || '',
      authorPhotoUrl: urlMap[rawPhoto] || rawPhoto,
      imageUrls: (p.images || []).map(img => urlMap[img] || img),
      liked: (p.likedBy || []).includes(OPENID),
      isAuthor: p.openid === OPENID,
      canManageEvent,
      eventAdminRole: eventAdmin ? (eventAdmin.role || 'full') : '',
      canEditEvent: isAdmin || p.openid === OPENID || (eventAdmin && eventAdmin.role === 'full'),
      isAssembling: isEvent && myRegistration && myRegistration.status === 'assembling',
      isPending: isEvent && myRegistration && myRegistration.status === 'pending',
      isSoloPending: isEvent && myRegistration && myRegistration.status === 'solo_pending',
      // 参赛资格以审核通过为准；收款状态单独展示，不能因线下收款字段缺失而把已参赛用户显示成“名额已满”。
      isRegistered: isEvent && myRegistration && myRegistration.status === 'approved',
      awaitingPayment: false,
      isExpired: isEvent && myRegistration && (myRegistration.status === 'expired' || paymentExpired),
      myRegistrationId: myRegistration ? myRegistration._id : '',
      myTeamName: myRegistration ? myRegistration.teamName : '',
      isTeamCaptain: myRegistration ? myRegistration.captainOpenid === OPENID : false,
      canCancelRegistration: isEvent && myRegistration && ['solo_pending', 'assembling', 'pending', 'approved'].includes(myRegistration.status),
      cancelActionText: myRegistration && myRegistration.captainOpenid !== OPENID ? '退出参赛' : (myRegistration && myRegistration.paymentStatus === 'paid' ? '申请取消' : '取消报名'),
      myInviteCode: myRegistration ? (myRegistration.inviteCode || '') : '',
      myConfirmedCount: myRegistration ? (myRegistration.members || []).filter(m => m.openid && m.confirmed).length : 0,
      canSubmitReview: isEvent && myRegistration &&
        myRegistration.status === 'assembling' &&
        myRegistration.captainOpenid === OPENID &&
        (myRegistration.members || []).filter(m => m.openid && m.confirmed).length >= (p.minTeamSize || p.teamSize || 5),
      canRegisterRegularTeam: isEvent && !!captainRegularTeam,
      captainRegularTeam,
      myMembers: myRegistration ? (myRegistration.members || []).map(m => ({
        ...m,
        photoUrl: urlMap[m.photoUrl] || m.photoUrl || ''
      })) : [],
      pendingCount: isEvent && canManageEvent ? (p.pendingTeams || 0) : 0
    }

    const comments = commentsRes.data.map(c => ({
      _id: c._id,
      openid: c.openid,
      authorName: c.authorName || '',
      authorPhotoUrl: urlMap[c.authorPhoto] || c.authorPhoto || '',
      content: c.content,
      createdAt: c.createdAt
    }))

    let eventResults = []
    if (p.postType === 'event' && p.eventStatus === 'closed') {
      try {
        const erRes = await db.collection('eventResults').where({ postId }).get()
        if (erRes.data.length > 0) {
          const doc = erRes.data[0]
          eventResults = (doc.results || [])
            .filter(r => r.attended !== false)
            .sort((a, b) => {
              if (a.rank === null && b.rank === null) return 0
              if (a.rank === null) return 1
              if (b.rank === null) return -1
              return a.rank - b.rank
            })
        }
      } catch (e) {}
    }

    return { code: 0, post, comments, eventResults }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
