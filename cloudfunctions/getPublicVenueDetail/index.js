const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { venueId } = event || {}
  if (!venueId) return { code: -1, msg: '缺少球馆ID' }

  try {
    const res = await db.collection('venues').doc(venueId).get()
    const venue = res.data || {}
    if (!venue._id || venue.status !== 'approved') {
      return { code: -1, msg: '球馆不存在或暂未通过审核' }
    }

    return {
      code: 0,
      data: {
        _id: venue._id,
        name: venue.name || '',
        venueType: venue.venueType || '',
        city: venue.city || '',
        address: venue.address || '',
        locationName: venue.locationName || '',
        latitude: Number(venue.latitude) || 0,
        longitude: Number(venue.longitude) || 0,
        sports: venue.sports || [],
        courtTypes: venue.courtTypes || [],
        courtCounts: venue.courtCounts || {},
        openingStart: venue.openingStart || '',
        openingEnd: venue.openingEnd || '',
        openingHours: venue.openingHours || '',
        coverImage: venue.coverImage || '',
        galleryImages: venue.galleryImages || [],
        description: venue.description || '',
        pricingRules: venue.pricingRules || []
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
