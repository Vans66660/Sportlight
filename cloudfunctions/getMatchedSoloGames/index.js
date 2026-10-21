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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function startTimeMs(game) {
  const value = new Date(`${game.date || ''} ${game.startTime || '00:00'}`).getTime()
  return Number.isFinite(value) ? value : 0
}

function deadlineMs(game) {
  const value = new Date(`${game.deadlineDate || game.date || ''} ${game.deadlineTime || game.startTime || '00:00'}`).getTime()
  return Number.isFinite(value) ? value : 0
}

function recommendReasons(game, scoreDiff, distanceKm) {
  const reasons = []
  if (distanceKm <= 5) reasons.push('距离近')
  else if (distanceKm <= 15) reasons.push('距离适中')
  if (scoreDiff <= 150) reasons.push('强度接近')
  else if (scoreDiff <= 400) reasons.push('强度可接受')
  if (game.formed) reasons.push('已成局')
  else if ((game.minPlayers || 0) - (game.participantCount || 0) <= 1) reasons.push('差1人发车')
  if (!reasons.length) reasons.push('综合匹配')
  return reasons.slice(0, 3).join(' · ')
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const latitude = Number(event.latitude) || 0
  const longitude = Number(event.longitude) || 0
  const radiusKm = Number(event.radiusKm) || 30
  const limit = Math.min(Number(event.limit) || 5, 10)

  try {
    const athleteRes = await db.collection('athletes')
      .where({ openid: OPENID })
      .field({ competitionScore: true, currentSeasonScore: true, sport: true })
      .limit(1)
      .get()
    const athlete = athleteRes.data[0] || {}
    const myScore = Number(athlete.competitionScore || athlete.currentSeasonScore) || 0
    const mySport = athlete.sport || ''

    let res = { data: [] }
    try {
      res = await db.collection('soloGames')
        .where({ status: _.neq('cancelled') })
        .limit(100)
        .get()
    } catch (err) {
      if (!isMissingCollection(err)) throw err
    }

    const now = Date.now()
    const games = (res.data || [])
      .filter(game => game.paymentMethod !== 'private' && game.status !== 'privateBooked')
      .filter(game => !mySport || !game.sport || game.sport === mySport)
      .map(game => {
        const participantCount = (game.participants || []).length
        const maxPlayers = Number(game.maxPlayers) || 0
        const minPlayers = Number(game.minPlayers) || 0
        const avgScore = participantCount
          ? Math.round((game.participants || []).reduce((sum, p) => sum + (Number(p.competitionScore) || 0), 0) / participantCount)
          : Number(game.creatorScore) || 0
        const meters = distance(latitude, longitude, game.venueLatitude, game.venueLongitude)
        const distanceKm = meters / 1000
        const scoreDiff = Math.abs(avgScore - myScore)
        const formed = participantCount >= minPlayers
        const vacancy = Math.max(0, maxPlayers - participantCount)
        const hoursUntilStart = (startTimeMs(game) - now) / 3600000
        const timePenalty = hoursUntilStart <= 48 ? 0 : hoursUntilStart <= 72 ? 5 : 10
        const distancePenalty = Math.min(35, (distanceKm / radiusKm) * 35)
        const scorePenalty = Math.min(35, (scoreDiff / 1000) * 35)
        const formedBonus = formed ? 12 : (minPlayers - participantCount <= 1 ? 8 : minPlayers - participantCount <= 2 ? 4 : 0)
        const vacancyBonus = vacancy >= 1 && vacancy <= 3 ? 6 : vacancy <= 6 ? 3 : 0
        const matchScore = Math.round(clamp(100 - distancePenalty - scorePenalty - timePenalty + formedBonus + vacancyBonus, 0, 100))

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
          myScore,
          scoreDiff,
          matchScore,
          recommendReason: recommendReasons({ formed, minPlayers, participantCount }, scoreDiff, distanceKm),
          distanceMeters: meters,
          distanceText: meters >= 1000 ? `${distanceKm.toFixed(1)}km` : `${Math.round(meters)}m`,
          minPlayers,
          maxPlayers,
          participantCount,
          formed,
          vacancy,
          deadlineAt: deadlineMs(game)
        }
      })
      .filter(game => game.deadlineAt > now && game.vacancy > 0 && game.distanceMeters <= radiusKm * 1000)
      .sort((a, b) => b.matchScore - a.matchScore || a.distanceMeters - b.distanceMeters)
      .slice(0, limit)

    return { code: 0, data: games, myScore, mySport, radiusKm }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
