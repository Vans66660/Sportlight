const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollection(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = value => Number(value) * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6378137 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function deadlineMs(game) {
  const value = new Date(`${game.deadlineDate || game.date || ''} ${game.deadlineTime || game.startTime || '00:00'}`).getTime()
  return Number.isFinite(value) ? value : 0
}

function isJoinable(game) {
  const count = (game.participants || []).length
  return !game.hiddenFromSoloList &&
    game.paymentMethod !== 'private' &&
    !['cancelled', 'finished', 'privateBooked', 'privatePendingPayment'].includes(game.status) &&
    deadlineMs(game) > Date.now() &&
    count < Number(game.maxPlayers || 0)
}

exports.main = async (event = {}) => {
  const latitude = Number(event.latitude)
  const longitude = Number(event.longitude)
  const radiusKm = Math.min(Math.max(Number(event.radiusKm) || 30, 1), 100)

  try {
    const venueRes = await db.collection('venues')
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
        description: true
      })
      .limit(200)
      .get()

    let soloGames = []
    let bookings = []
    try {
      const gameRes = await db.collection('soloGames')
        .where({ status: db.command.nin(['cancelled', 'finished']) })
        .limit(300)
        .get()
      soloGames = gameRes.data || []
    } catch (err) {
      if (!isMissingCollection(err)) throw err
    }
    try {
      const bookingRes = await db.collection('venueBookings')
        .where({ status: db.command.nin(['cancelled', 'finished', 'refunded']) })
        .limit(300)
        .get()
      bookings = bookingRes.data || []
    } catch (err) {
      if (!isMissingCollection(err)) throw err
    }

    const venues = (venueRes.data || [])
      .filter(item => Number(item.latitude) && Number(item.longitude))
      .map(item => {
        const distance = Number.isFinite(latitude) && Number.isFinite(longitude)
          ? distanceMeters(latitude, longitude, Number(item.latitude), Number(item.longitude))
          : 0
        const venueGames = soloGames.filter(game => game.venueId === item._id)
        const venueBookings = bookings.filter(booking => booking.venueId === item._id)
        const hasJoinable = venueGames.some(isJoinable)
        const hasClosed = venueGames.some(game => !isJoinable(game)) || venueBookings.some(booking => ['locked', 'pending_payment', 'formed', 'in_progress', 'awaiting_confirm'].includes(booking.status))
        const mapStatus = hasJoinable ? 'joinable' : (hasClosed ? 'full' : 'empty')
        return {
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
          description: item.description || '',
          distance,
          mapStatus,
          statusLabel: mapStatus === 'joinable' ? '有局正在拼' : (mapStatus === 'full' ? '已满/已约' : '空场可约'),
          activeGameCount: venueGames.filter(isJoinable).length
        }
      })
      .filter(item => !Number.isFinite(latitude) || !Number.isFinite(longitude) || item.distance <= radiusKm * 1000)
      .sort((a, b) => a.distance - b.distance)

    return { code: 0, data: venues }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
