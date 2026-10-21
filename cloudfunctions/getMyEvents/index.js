const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function isMissingCollection(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist')
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const [ownerRes, adminRes] = await Promise.all([
      db.collection('posts')
        .where({ openid: OPENID, postType: 'event' })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get(),
      db.collection('eventAdmins')
        .where({ adminOpenid: OPENID, status: 'accepted' })
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get()
        .catch(e => {
          if (isMissingCollection(e)) return { data: [] }
          throw e
        })
    ])

    const adminMap = {}
    const adminPostIds = []
    ;(adminRes.data || []).forEach(item => {
      if (!item.postId) return
      adminMap[item.postId] = item
      adminPostIds.push(item.postId)
    })

    let adminPostRes = { data: [] }
    if (adminPostIds.length > 0) {
      adminPostRes = await db.collection('posts')
        .where({ _id: _.in([...new Set(adminPostIds)].slice(0, 50)), postType: 'event' })
        .limit(50)
        .get()
    }

    const eventMap = {}
    ;(ownerRes.data || []).forEach(p => { eventMap[p._id] = { ...p, adminRole: '', manageType: 'owner' } })
    ;(adminPostRes.data || []).forEach(p => {
      if (!eventMap[p._id]) eventMap[p._id] = { ...p, adminRole: (adminMap[p._id] || {}).role || 'full', manageType: 'collab' }
    })
    const events = Object.values(eventMap).sort((a, b) => {
      const at = new Date(a.createdAt || a.updatedAt || 0).getTime()
      const bt = new Date(b.createdAt || b.updatedAt || 0).getTime()
      return bt - at
    }).slice(0, 80)

    const fileIDs = []
    events.forEach(p => {
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

    const data = events.map(p => ({
      _id: p._id,
      title: p.title || '',
      content: p.content || '',
      sport: p.sport || '',
      eventDate: p.eventDate || '',
      eventLocation: p.eventLocation || '',
      eventStatus: p.eventStatus || 'open',
      statusLabel: statusLabelMap[p.eventStatus || 'open'] || '招募中',
      maxTeams: p.maxTeams || 0,
      registeredTeams: p.registeredTeams || 0,
      pendingCount: p.pendingTeams || 0,
      registrationDeadline: p.registrationDeadline || '',
      entryFee: p.entryFee || 0,
      prizes: p.prizes || [],
      prizeInfo: p.prizeInfo || '',
      banner: urlMap[p.banner] || p.banner || '',
      images: (p.images || []).map(img => urlMap[img] || img),
      settled: p.settled || false,
      settledAmount: p.settledAmount || 0,
      manageType: p.manageType || 'owner',
      adminRole: p.adminRole || '',
      adminRoleLabel: p.manageType === 'collab' ? (p.adminRole === 'score' ? '成绩管理员' : '协作管理员') : '主办方',
      canEditEvent: p.manageType !== 'collab' || p.adminRole === 'full',
      canManageAdmins: p.manageType !== 'collab'
    }))

    return { code: 0, data }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
