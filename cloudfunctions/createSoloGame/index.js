const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollection(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

async function ensureSoloGamesCollection() {
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection('soloGames')
  } catch (err) {
    if (!String((err && (err.message || err.errMsg)) || '').includes('exist')) throw err
  }
}

async function ensureVenueBookingsCollection() {
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection('venueBookings')
  } catch (err) {
    if (!String((err && (err.message || err.errMsg)) || '').includes('exist')) throw err
  }
}

function overlap(aStart, aEnd, bStart, bEnd) {
  return String(aStart) < String(bEnd) && String(bStart) < String(aEnd)
}

function durationHours(startTime, endTime) {
  const [sh, sm] = String(startTime || '00:00').split(':').map(Number)
  const [eh, em] = String(endTime || '00:00').split(':').map(Number)
  const minutes = (eh * 60 + em) - (sh * 60 + sm)
  return Math.max(0, minutes / 60)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const data = event || {}
  const required = ['date', 'startTime', 'endTime', 'venueId', 'courtId', 'sport', 'minPlayers', 'maxPlayers', 'deadlineDate', 'deadlineTime', 'paymentMethod']
  for (const key of required) if (!data[key]) return { code: -1, msg: '请完善组局信息' }
  const minPlayers = Number(data.minPlayers)
  const maxPlayers = Number(data.maxPlayers)
  if (!minPlayers || !maxPlayers || minPlayers > maxPlayers) return { code: -1, msg: '人数设置不正确' }
  if (data.sport === '其他' && !String(data.customSport || '').trim()) return { code: -1, msg: '请填写活动种类' }
  const startAt = new Date(`${data.date} ${data.startTime}`).getTime()
  const deadlineAt = new Date(`${data.deadlineDate} ${data.deadlineTime}`).getTime()
  const minDeadline = startAt - 2 * 60 * 60 * 1000
  const maxDeadline = startAt - 30 * 60 * 1000
  if (!Number.isFinite(startAt) || !Number.isFinite(deadlineAt) || deadlineAt < minDeadline || deadlineAt > maxDeadline) {
    return { code: -1, msg: '报名截止需在开场前2小时到30分钟之间' }
  }

  try {
    const [athleteRes, venueRes] = await Promise.all([
      db.collection('athletes').where({ openid: OPENID }).limit(1).get(),
      db.collection('venues').doc(data.venueId).get()
    ])
    const athlete = athleteRes.data[0] || {}
    const venue = venueRes.data || {}
    if (!venue._id || venue.status !== 'approved') return { code: -1, msg: '球馆不可用' }
    const courtType = String(data.courtType || '')
    const pricingRule = (venue.pricingRules || []).find(rule => rule.courtType === courtType) || {}
    const aaPricePerPerson = Number(pricingRule.casualPricePerPerson) || 0
    const privatePricePerHour = Number(pricingRule.privatePricePerHour) || 0
    if (data.paymentMethod === 'aa' && aaPricePerPerson <= 0) return { code: -1, msg: '该场地未配置散客价格，暂不能选择AA预交' }
    if (data.paymentMethod === 'private' && privatePricePerHour <= 0) return { code: -1, msg: '该场地未配置包场价格，暂不能选择包场' }
    let conflictRes = { data: [] }
    let bookingConflictRes = { data: [] }
    try {
      conflictRes = await db.collection('soloGames')
        .where({
          date: String(data.date),
          venueId: venue._id,
          courtId: String(data.courtId),
          status: db.command.neq('cancelled')
        })
        .limit(50)
        .get()
    } catch (err) {
      if (!isMissingCollection(err)) throw err
      await ensureSoloGamesCollection()
    }
    try {
      bookingConflictRes = await db.collection('venueBookings')
        .where({
          date: String(data.date),
          venueId: venue._id,
          courtId: String(data.courtId),
          status: db.command.nin(['cancelled', 'refunded'])
        })
        .limit(50)
        .get()
    } catch (err) {
      if (!isMissingCollection(err)) throw err
      await ensureVenueBookingsCollection()
    }
    const hasConflict = (conflictRes.data || []).some(game => overlap(data.startTime, data.endTime, game.startTime, game.endTime)) ||
      (bookingConflictRes.data || []).some(booking => overlap(data.startTime, data.endTime, booking.startTime, booking.endTime))
    if (hasConflict) return { code: -1, msg: '该场地时段已被预约' }

    const isPrivate = data.paymentMethod === 'private'
    const privateAmount = Math.round(privatePricePerHour * durationHours(data.startTime, data.endTime) * 100) / 100
    const gameData = {
      creatorOpenid: OPENID,
      creatorName: athlete.name || '发起人',
      creatorAvatar: athlete.photo || '',
      creatorScore: Number(athlete.competitionScore) || 0,
      sport: data.sport === '其他' ? String(data.customSport || '其他') : String(data.sport),
      notice: String(data.notice || '').slice(0, 300),
      date: String(data.date),
      startTime: String(data.startTime),
      endTime: String(data.endTime),
      deadlineDate: String(data.deadlineDate),
      deadlineTime: String(data.deadlineTime),
      venueId: venue._id,
      venueName: venue.name || '',
      venueAddress: venue.address || '',
      venueLatitude: Number(venue.latitude) || 0,
      venueLongitude: Number(venue.longitude) || 0,
      courtId: String(data.courtId),
      courtName: String(data.courtName || data.courtId),
      courtType,
      aaPricePerPerson,
      privatePricePerHour,
      privateAmount,
      pricePerPerson: data.paymentMethod === 'aa' ? aaPricePerPerson : 0,
      minPlayers,
      maxPlayers,
      paymentMethod: String(data.paymentMethod),
      status: isPrivate ? 'privatePendingPayment' : 'open',
      hiddenFromSoloList: isPrivate,
      participants: [{
        openid: OPENID,
        name: athlete.name || '发起人',
        avatar: athlete.photo || '',
        competitionScore: Number(athlete.competitionScore) || 0,
        joinedAt: db.serverDate(),
        paid: data.paymentMethod === 'aa',
        paymentStatus: data.paymentMethod === 'aa' ? 'host_included' : (data.paymentMethod === 'free' ? 'free' : 'pending_private_payment')
      }],
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
    await ensureSoloGamesCollection()
    await ensureVenueBookingsCollection()
    const addRes = await db.collection('soloGames').add({ data: gameData })
    await db.collection('venueBookings').add({
      data: {
        venueId: venue._id,
        venueName: venue.name || '',
        venueAddress: venue.address || '',
        venueLatitude: Number(venue.latitude) || 0,
        venueLongitude: Number(venue.longitude) || 0,
        courtId: String(data.courtId),
        courtName: String(data.courtName || data.courtId),
        courtType,
        date: String(data.date),
        startTime: String(data.startTime),
        endTime: String(data.endTime),
        deadlineDate: String(data.deadlineDate),
        deadlineTime: String(data.deadlineTime),
        sourceType: isPrivate ? 'private_booking' : 'solo_game',
        sourceId: addRes._id,
        paymentMethod: String(data.paymentMethod),
        paymentStatus: isPrivate ? 'pending' : (data.paymentMethod === 'aa' ? 'partial' : 'free'),
        status: isPrivate ? 'pending_payment' : 'open',
        creatorOpenid: OPENID,
        creatorName: athlete.name || '发起人',
        participants: gameData.participants,
        minPlayers,
        maxPlayers,
        pricePerPerson: gameData.pricePerPerson,
        privatePricePerHour,
        amount: isPrivate ? privateAmount : 0,
        amountFen: isPrivate ? Math.round(privateAmount * 100) : 0,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    return { code: 0, gameId: addRes._id, bookingSuccess: false, requiresPayment: isPrivate }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
