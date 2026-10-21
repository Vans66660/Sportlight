const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  try {
    const res = await db.collection('venues')
      .where({ status: 'approved' })
      .field({
        name: true,
        venueType: true,
        city: true,
        address: true,
        locationName: true,
        latitude: true,
        longitude: true,
        sports: true,
        courtTypes: true,
        courtCounts: true,
        openingHours: true,
        coverImage: true,
        description: true,
        updatedAt: true
      })
      .limit(100)
      .get()

    const data = (res.data || [])
      .filter(item => Number(item.latitude) && Number(item.longitude))
      .map(item => ({
        _id: item._id,
        name: item.name || '',
        venueType: item.venueType || '',
        city: item.city || '',
        address: item.address || '',
        locationName: item.locationName || '',
        latitude: Number(item.latitude),
        longitude: Number(item.longitude),
        sports: item.sports || [],
        courtTypes: item.courtTypes || [],
        courtCounts: item.courtCounts || {},
        openingHours: item.openingHours || '',
        coverImage: item.coverImage || '',
        description: item.description || ''
      }))

    return { code: 0, data }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
