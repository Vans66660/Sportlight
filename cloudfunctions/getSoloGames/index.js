const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function distance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 999999999
  const toRad = value => value * Math.PI / 180
  const dLat = toRad(Number(lat2) - Number(lat1))
  const dLng = toRad(Number(lng2) - Number(lng1))
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(Number(lat1))) * Math.cos(toRad(Number(lat2))) * Math.sin(dLng / 2) ** 2
  return 6378137 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isMissingCollection(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

function deadlineMs(game) {
  const value = new Date(`${game.deadlineDate || game.date || ''} ${game.deadlineTime || game.startTime || '00:00'}`).getTime()
  return Number.isFinite(value) ? value : 0
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const date = String(event.date || '')
  const sort = String(event.sort || 'distance')
  const latitude = Number(event.latitude) || 0
  const longitude = Number(event.longitude) || 0
  const venueId = String(event.venueId || '')

  try {
    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).field({ competitionScore: true }).limit(1).get()
    const myScore = Number((athleteRes.data[0] || {}).competitionScore) || 0
    const where = { status: _.neq('cancelled') }
    if (date) where.date = date
    if (venueId) where.venueId = venueId
    let res = { data: [] }
    try {
      res = await db.collection('soloGames').where(where).limit(100).get()
    } catch (err) {
      if (!isMissingCollection(err)) throw err
    }
    const now = Date.now()
    let games = (res.data || []).filter(game => {
      const participantCount = (game.participants || []).length
      const maxPlayers = Number(game.maxPlayers) || 0
      if (game.hiddenFromSoloList || game.paymentMethod === 'private' || game.status === 'privateBooked') return false
      if (deadlineMs(game) <= now) return false
      if (maxPlayers && participantCount >= maxPlayers) return false
      return true
    }).map(game => {
      const participantCount = (game.participants || []).length
      const avgScore = participantCount
        ? Math.round((game.participants || []).reduce((sum, p) => sum + (Number(p.competitionScore) || 0), 0) / participantCount)
        : Number(game.creatorScore) || 0
      const d = distance(latitude, longitude, game.venueLatitude, game.venueLongitude)
      return {
        _id: game._id,
        title: game.title || `${game.sport || '运动'}散客组局`,
        creatorName: game.creatorName || '发起人',
        creatorAvatar: game.creatorAvatar || '',
        sport: game.sport || '',
        date: game.date || '',
        startTime: game.startTime || '',
        endTime: game.endTime || '',
        venueName: game.venueName || '',
        courtName: game.courtName || '',
        avgScore,
        distanceMeters: d,
        distanceText: d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`,
        minPlayers: Number(game.minPlayers) || 0,
        maxPlayers: Number(game.maxPlayers) || 0,
        participantCount,
        formed: participantCount >= Number(game.minPlayers || 0),
        intensityDiff: Math.abs(avgScore - myScore),
        vacancy: Math.max(0, Number(game.maxPlayers || 0) - participantCount)
      }
    }).filter(game => venueId || game.distanceMeters <= 30000)

    if (sort === 'intensity') games.sort((a, b) => a.intensityDiff - b.intensityDiff)
    else if (sort === 'people') games.sort((a, b) => a.vacancy - b.vacancy)
    else games.sort((a, b) => a.distanceMeters - b.distanceMeters)

    return { code: 0, data: games, myScore }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
