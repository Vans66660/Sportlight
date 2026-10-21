const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const payload = event || {}

  try {
    const venueRes = await db.collection('venues')
      .where({ ownerOpenid: OPENID })
      .limit(1)
      .get()

    if (!venueRes.data.length) return { code: -1, msg: '未找到球馆资料' }
    const venue = venueRes.data[0]

    const data = { updatedAt: db.serverDate() }

    if (Array.isArray(payload.pricingRules)) {
      data.pricingRules = payload.pricingRules.map(rule => ({
        courtType: String(rule.courtType || ''),
        casualPricePerPerson: Number(rule.casualPricePerPerson) || 0,
        casualDurationMode: String(rule.casualDurationMode || 'unlimited'),
        casualDurationMinutes: Number(rule.casualDurationMinutes) || 0,
        privatePricePerHour: Number(rule.privatePricePerHour) || 0
      })).filter(rule => rule.courtType)
    }

    const schedulePayload = Array.isArray(payload.scheduleTemplate)
      ? payload.scheduleTemplate
      : (Array.isArray(payload.workbenchSchedule) ? payload.workbenchSchedule : null)
    if (schedulePayload) {
      data.scheduleTemplate = schedulePayload.map(slot => ({
        date: String(slot.date || ''),
        courtId: String(slot.courtId || ''),
        courtName: String(slot.courtName || ''),
        courtType: String(slot.courtType || ''),
        startTime: String(slot.startTime || ''),
        endTime: String(slot.endTime || ''),
        status: ['available', 'locked', 'booked'].includes(slot.status) ? slot.status : 'available'
      })).filter(slot => slot.courtId && slot.startTime && slot.endTime)
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
      data.description = String(payload.description || '').slice(0, 300)
    }
    if (Array.isArray(payload.galleryImages)) {
      data.galleryImages = payload.galleryImages
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 9)
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'openingStart')) {
      data.openingStart = String(payload.openingStart || '')
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'openingEnd')) {
      data.openingEnd = String(payload.openingEnd || '')
    }
    if (data.openingStart || data.openingEnd) {
      const start = data.openingStart || venue.openingStart || ''
      const end = data.openingEnd || venue.openingEnd || ''
      data.openingHours = start && end ? `${start}-${end}` : (venue.openingHours || '')
    }

    await db.collection('venues').doc(venue._id).update({ data })
    return { code: 0, msg: 'success' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
