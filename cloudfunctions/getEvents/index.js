const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function getEndOfDay(dateStr) {
  if (!dateStr) return null
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return null
  date.setHours(23, 59, 59, 999)
  return date
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { page = 0, limit = 15, sport = '' } = event

  try {
    const query = {
      postType: 'event',
      eventStatus: _.in(['open', 'full'])
    }
    if (sport) query.sport = sport

    const res = await db.collection('posts')
      .where(query)
      .orderBy('createdAt', 'desc')
      .skip(page * limit)
      .limit(limit)
      .get()

    const posts = res.data
    const postIds = posts.map(p => p._id)

    let myRegMap = {}
    if (postIds.length > 0) {
      try {
        const regRes = await db.collection('event_registrations')
          .where({
            postId: _.in(postIds),
            memberOpenids: OPENID,
            status: _.in(['assembling', 'pending', 'approved', 'solo_pending'])
          })
          .limit(100)
          .get()
        regRes.data.forEach(r => {
          const current = myRegMap[r.postId]
          const currentTime = current && current.createdAt ? new Date(current.createdAt).getTime() : 0
          const nextTime = r.createdAt ? new Date(r.createdAt).getTime() : 0
          if (!current || nextTime >= currentTime) myRegMap[r.postId] = r
        })
      } catch (e) {}
    }

    const fileIDs = []
    posts.forEach(p => {
      if (p.authorPhoto && p.authorPhoto.startsWith('cloud://')) fileIDs.push(p.authorPhoto)
      if (p.banner && p.banner.startsWith('cloud://')) fileIDs.push(p.banner)
      ;(p.images || []).forEach(img => { if (img && img.startsWith('cloud://')) fileIDs.push(img) })
    })

    let urlMap = {}
    if (fileIDs.length > 0) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: [...new Set(fileIDs)] })
        tempRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
      } catch (e) {}
    }

    const statusLabelMap = { open: '招募中', full: '名额已满', closed: '已截止' }
    const now = new Date()

    const data = posts.map(p => {
      const myReg = myRegMap[p._id]
      const maxTeams = p.maxTeams || 0
      const registeredTeams = p.registeredTeams || 0
      const registrationDeadline = getEndOfDay(p.registrationDeadline)
      const deadlinePassed = !!registrationDeadline && registrationDeadline < now
      const eventStatus = (deadlinePassed && (p.eventStatus || 'open') === 'open') ? 'closed' : (p.eventStatus || 'open')
      const awaitingPayment = false
      const paymentExpired = false
      return {
        _id: p._id,
        openid: p.openid,
        authorName: p.authorName || '',
        authorPhotoUrl: urlMap[p.authorPhoto] || p.authorPhoto || '',
        authorType: p.authorType || 'boss',
        title: p.title || '',
        content: p.content || '',
        sport: p.sport || '',
        eventDate: p.eventDate || '',
        eventLocation: p.eventLocation || '',
        registrationMode: p.registrationMode || 'team',
        teamSize: p.teamSize || 5,
        teamSizeLabel: p.teamSizeLabel || '',
        maxTeams,
        registeredTeams,
        pendingTeams: p.pendingTeams || 0,
        teamsLeft: maxTeams ? Math.max(0, maxTeams - registeredTeams) : null,
        registrationDeadline: p.registrationDeadline || '',
        entryFee: p.entryFee || 0,
        prizes: p.prizes || [],
        prizeInfo: p.prizeInfo || '',
        approvalType: 'manual',
        eventStatus,
        statusLabel: statusLabelMap[eventStatus] || '招募中',
        banner: urlMap[p.banner] || p.banner || '',
        images: (p.images || []).map(img => urlMap[img] || img),
        teamsPercent: maxTeams ? Math.min(100, Math.round(registeredTeams / maxTeams * 100)) : 0,
        isAssembling: !!myReg && myReg.status === 'assembling',
        isPending: !!myReg && myReg.status === 'pending',
        isSoloPending: !!myReg && myReg.status === 'solo_pending',
        awaitingPayment,
        isRegistered: !!myReg && myReg.status === 'approved' && ['paid', 'free', 'offline', 'unpaid'].includes(myReg.paymentStatus),
        isExpired: !!myReg && (myReg.status === 'expired' || paymentExpired),
        isAuthor: p.openid === OPENID,
        platformCertified: p.certificationStatus === 'approved' && p.cardIssuanceEnabled === true,
        certificationStatus: p.certificationStatus || 'unverified',
        createdAt: p.createdAt
      }
    })

    return { code: 0, data, hasMore: posts.length === limit }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
