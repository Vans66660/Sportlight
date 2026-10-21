const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  try {
    const userRes = await db.collection('users')
      .where({ openid: OPENID })
      .field({ userType: true })
      .limit(1).get()

    if (!userRes.data.length || userRes.data[0].userType !== 'admin') {
      return { code: -1, msg: '无权限' }
    }

    const res = await db.collection('posts')
      .where({ postType: 'event' })
      .orderBy('eventDate', 'desc')
      .limit(100)
      .get()

    const statusLabelMap = { open: '招募中', full: '名额已满', closed: '已截止' }

    const data = res.data.map(p => ({
      _id: p._id,
      title: p.title || '',
      content: p.content ? p.content.slice(0, 40) : '',
      sport: p.sport || '',
      eventDate: p.eventDate || '',
      eventLocation: p.eventLocation || '',
      eventStatus: p.eventStatus || 'open',
      statusLabel: statusLabelMap[p.eventStatus || 'open'] || '招募中',
      maxTeams: p.maxTeams || 0,
      registeredTeams: p.registeredTeams || 0,
      pendingCount: p.pendingTeams || 0,
      authorName: p.authorName || '',
      platformCertified: p.platformCertified === true && p.certificationStatus === 'approved' && p.cardIssuanceEnabled === true,
      certificationStatus: p.certificationStatus === 'approved' && p.cardIssuanceEnabled === true ? 'approved' : 'unverified',
      certificationLabel: p.certificationStatus === 'approved' && p.cardIssuanceEnabled === true
        ? 'Sportlight 官方认证'
        : '未认证',
      cardIssuanceEnabled: p.cardIssuanceEnabled === true,
      certifiedAt: p.certifiedAt || null,
      certifiedByName: p.certifiedByName || '',
      certificationVersion: Number(p.certificationVersion) || 0,
    }))

    return { code: 0, data }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
