const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureAdmin(openid) {
  const userRes = await db.collection('users')
    .where({ openid })
    .field({ userType: true })
    .limit(1)
    .get()
  return userRes.data.length > 0 && userRes.data[0].userType === 'admin'
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const limit = Math.min(Math.max(Number(event.limit) || 30, 1), 50)
    const page = Math.max(Number(event.page) || 0, 0)
    const res = await db.collection('venues')
      .orderBy('updatedAt', 'desc')
      .skip(page * limit)
      .limit(limit)
      .get()

    const statusLabelMap = {
      pending: '待审核',
      approved: '已通过',
      rejected: '已驳回'
    }

    const data = res.data.map(item => ({
      _id: item._id,
      ownerOpenid: item.ownerOpenid || '',
      name: item.name || '',
      venueType: item.venueType || '',
      city: item.city || '',
      address: item.address || '',
      locationName: item.locationName || '',
      latitude: item.latitude || '',
      longitude: item.longitude || '',
      sports: item.sports || [],
      courtTypes: item.courtTypes || [],
      courtCounts: item.courtCounts || {},
      openingHours: item.openingHours || '',
      coverImage: item.coverImage || '',
      galleryImages: item.galleryImages || [],
      operatorName: item.operatorName || '',
      phone: item.phone || '',
      licenseImages: item.licenseImages || [],
      description: item.description || '',
      status: item.status || 'pending',
      statusLabel: statusLabelMap[item.status || 'pending'] || '待审核',
      rejectReason: item.rejectReason || ''
    }))

    return { code: 0, data, page, hasMore: res.data.length === limit }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
