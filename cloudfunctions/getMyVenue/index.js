const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollection(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

function parseTimeMs(date, time) {
  const value = new Date(`${date || ''} ${time || '00:00'}`).getTime()
  return Number.isFinite(value) ? value : 0
}

function todayStr(offset = 0) {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildAnalytics(bookings) {
  const windows = [7, 30, 90]
  const result = {}
  windows.forEach(days => {
    const labels = []
    const income = []
    const privateOrders = []
    const casualFormed = []
    for (let i = days - 1; i >= 0; i--) {
      const date = todayStr(-i)
      const dayBookings = bookings.filter(item => item.date === date && item.status !== 'cancelled')
      labels.push(date.slice(5))
      income.push(Math.round(dayBookings.reduce((sum, item) => sum + (Number(item.amount) || Number(item.paidAmount) || 0), 0) * 100) / 100)
      privateOrders.push(dayBookings.filter(item => item.sourceType === 'private_booking' || item.paymentMethod === 'private').length)
      casualFormed.push(dayBookings.filter(item => {
        const count = (item.participants || []).length
        return (item.sourceType === 'solo_game' || item.paymentMethod !== 'private') && count >= Number(item.minPlayers || 0)
      }).length)
    }
    const arrivalDistribution = [8, 10, 12, 14, 16, 18, 20, 22].map(hour => {
      const start = String(hour).padStart(2, '0')
      return bookings.filter(item => String(item.startTime || '').startsWith(start) && item.status !== 'cancelled').length
    })
    result[String(days)] = { labels, income, privateOrders, casualFormed, arrivalDistribution }
  })
  return result
}

function settlementStatus(item) {
  if (item.status === 'cancelled') return '已取消'
  if (item.paymentStatus === 'refunded') return '已退款'
  if (item.status === 'finished') return '待结算'
  if (item.paymentStatus === 'paid' || item.paymentStatus === 'partial') return '托管中'
  if (item.paymentStatus === 'pending') return '待支付'
  return '未支付'
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()

  try {
    const res = await db.collection('venues')
      .where({ ownerOpenid: OPENID })
      .limit(1)
      .get()

    if (!res.data.length) return { code: -1, msg: '未找到球馆资料' }
    const venue = res.data[0]
    let games = []
    let bookings = []
    try {
      const bookingRes = await db.collection('venueBookings')
        .where({ venueId: venue._id })
        .limit(300)
        .get()
      bookings = bookingRes.data || []
    } catch (err) {
      if (!isMissingCollection(err)) throw err
    }
    try {
      const gameRes = await db.collection('soloGames')
        .where({ venueId: venue._id })
        .limit(100)
        .get()
      games = (gameRes.data || []).map(game => ({
        _id: game._id,
        type: game.paymentMethod === 'private' ? '包场' : '散客组局',
        title: `${game.sport || '运动'} · ${game.courtName || game.courtId || ''}`,
        date: game.date || '',
        time: `${game.startTime || ''}-${game.endTime || ''}`,
        courtName: game.courtName || '',
        creatorName: game.creatorName || '',
        participantCount: (game.participants || []).length,
        minPlayers: Number(game.minPlayers) || 0,
        maxPlayers: Number(game.maxPlayers) || 0,
        status: game.status || 'open'
      }))
    } catch (err) {
      if (!isMissingCollection(err)) throw err
    }
    const bookingGames = bookings.map(booking => ({
      _id: booking.sourceId || booking._id,
      bookingId: booking._id,
      type: booking.paymentMethod === 'private' || booking.sourceType === 'private_booking' ? '包场' : '散客组局',
      title: `${booking.courtType || '场地'} · ${booking.courtName || booking.courtId || ''}`,
      date: booking.date || '',
      time: `${booking.startTime || ''}-${booking.endTime || ''}`,
      courtName: booking.courtName || '',
      creatorName: booking.creatorName || '',
      participantCount: (booking.participants || []).length,
      minPlayers: Number(booking.minPlayers) || 0,
      maxPlayers: Number(booking.maxPlayers) || 0,
      status: booking.status === 'pending_payment' ? 'open' : (booking.status || 'open'),
      paymentStatus: booking.paymentStatus || ''
    }))
    const legacyOnly = games.filter(game => !bookingGames.some(item => item._id === game._id))
    const venueGames = bookingGames.concat(legacyOnly).sort((a, b) => parseTimeMs(a.date, a.time.split('-')[0]) - parseTimeMs(b.date, b.time.split('-')[0]))
    const today = todayStr()
    const todayBookings = bookings.filter(item => item.date === today && item.status !== 'cancelled')
    const dashboard = {
      todayIncome: Math.round(todayBookings.reduce((sum, item) => sum + (Number(item.amount) || Number(item.paidAmount) || 0), 0) * 100) / 100,
      todayOrders: todayBookings.length,
      privateOrders: todayBookings.filter(item => item.sourceType === 'private_booking' || item.paymentMethod === 'private').length,
      casualFormed: todayBookings.filter(item => (item.participants || []).length >= Number(item.minPlayers || 0) && item.paymentMethod !== 'private').length
    }
    const feeRate = Number(venue.platformFeeRate || 8)
    const settlementOrders = bookings
      .slice()
      .sort((a, b) => parseTimeMs(b.date, b.startTime) - parseTimeMs(a.date, a.startTime))
      .slice(0, 100)
      .map(item => {
        const gross = Number(item.amount) || Number(item.paidAmount) || 0
        const platformFee = Math.round(gross * feeRate) / 100
        const venueReceivable = Math.max(0, Math.round((gross - platformFee) * 100) / 100)
        return {
          _id: item._id,
          sourceId: item.sourceId || '',
          title: `${item.paymentMethod === 'private' ? '包场' : '散客'} · ${item.courtName || item.courtId || ''}`,
          date: item.date || '',
          time: `${item.startTime || ''}-${item.endTime || ''}`,
          participantCount: (item.participants || []).length,
          gross,
          platformFee,
          venueReceivable,
          status: item.status || '',
          paymentStatus: item.paymentStatus || '',
          statusLabel: settlementStatus(item)
        }
      })
    const payableSettlementOrders = settlementOrders.filter(item =>
      !['cancelled', 'refunded'].includes(item.status) &&
      !['refunded', 'refund_pending'].includes(item.paymentStatus)
    )
    const settlementSummary = payableSettlementOrders.reduce((sum, item) => ({
      gross: Math.round((sum.gross + item.gross) * 100) / 100,
      platformFee: Math.round((sum.platformFee + item.platformFee) * 100) / 100,
      venueReceivable: Math.round((sum.venueReceivable + item.venueReceivable) * 100) / 100,
      orderCount: sum.orderCount + (item.gross > 0 ? 1 : 0)
    }), { gross: 0, platformFee: 0, venueReceivable: 0, orderCount: 0 })
    const refundRequests = settlementOrders
      .filter(item => item.paymentStatus === 'refund_pending' || item.status === 'refund_pending')
      .map(item => ({ title: item.title, meta: `${item.date} ${item.time} · ¥${item.gross}` }))
    return { code: 0, data: { ...venue, venueGames, venueBookings: bookings, dashboard, analyticsData: buildAnalytics(bookings), settlementOrders, settlementSummary, refundRequests } }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
