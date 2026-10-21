const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

function buildDefaultSlots(start = '10:00', end = '22:00') {
  const startHour = Number(String(start).split(':')[0]) || 10
  const endHour = Number(String(end).split(':')[0]) || 22
  const slots = []
  for (let hour = startHour; hour < endHour; hour += 2) {
    slots.push({ startTime: `${String(hour).padStart(2, '0')}:00`, endTime: `${String(Math.min(hour + 2, endHour)).padStart(2, '0')}:00`, status: 'available' })
  }
  return slots
}

function isMissingCollection(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

exports.main = async (event) => {
  const date = String(event.date || '')
  const startTime = String(event.startTime || '')
  const endTime = String(event.endTime || '')
  if (!date || !startTime || !endTime) return { code: -1, msg: '请选择日期和时间' }

  try {
    const venueRes = await db.collection('venues').where({ status: 'approved' }).limit(100).get()
    let gameRes = { data: [] }
    let bookingRes = { data: [] }
    try {
      gameRes = await db.collection('soloGames').where({ date, status: db.command.neq('cancelled') }).limit(100).get()
    } catch (err) {
      if (!isMissingCollection(err)) throw err
    }
    try {
      bookingRes = await db.collection('venueBookings').where({
        date,
        status: db.command.nin(['cancelled', 'refunded'])
      }).limit(200).get()
    } catch (err) {
      if (!isMissingCollection(err)) throw err
    }
    const games = gameRes.data || []
    const bookings = bookingRes.data || []
    const venues = (venueRes.data || []).map(venue => {
      const courtTypes = venue.courtTypes || []
      const courtCounts = venue.courtCounts || {}
      const template = venue.scheduleTemplate || []
      const courts = []
      courtTypes.forEach(type => {
        const count = Number(courtCounts[type]) || 0
        for (let i = 1; i <= count; i++) {
          const courtId = `${type}_${i}`
          const courtName = `${type}${i}`
          const slots = template.filter(slot => slot.courtId === courtId)
          const source = slots.length ? slots : buildDefaultSlots(venue.openingStart, venue.openingEnd)
          const availableByTemplate = source.some(slot => slot.status === 'available' && slot.startTime <= startTime && slot.endTime >= endTime)
          const lockedByTemplate = source.some(slot => slot.status !== 'available' && overlap(startTime, endTime, slot.startTime, slot.endTime))
          const bookedByGame = games.some(game => game.venueId === venue._id && game.courtId === courtId && overlap(startTime, endTime, game.startTime, game.endTime))
          const bookedByBooking = bookings.some(booking => booking.venueId === venue._id && booking.courtId === courtId && overlap(startTime, endTime, booking.startTime, booking.endTime))
          const disabled = !availableByTemplate || lockedByTemplate || bookedByGame || bookedByBooking
          courts.push({
            courtId,
            courtName,
            courtType: type,
            disabled,
            statusLabel: (bookedByGame || bookedByBooking) ? '已有预约' : (lockedByTemplate ? '锁定' : (availableByTemplate ? '可选' : '非营业'))
          })
        }
      })
      courts.sort((a, b) => Number(a.disabled) - Number(b.disabled))
      return {
        _id: venue._id,
        name: venue.name || '',
        address: venue.address || '',
        latitude: Number(venue.latitude) || 0,
        longitude: Number(venue.longitude) || 0,
        courts
      }
    })
    return { code: 0, data: venues }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
