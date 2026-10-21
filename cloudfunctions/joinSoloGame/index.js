const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
  const { gameId } = event || {}
  if (!gameId) return { code: -1, msg: '缺少球局ID' }

  try {
    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    const athlete = athleteRes.data[0] || {}
    const participant = {
      openid: OPENID,
      name: athlete.name || '球员',
      avatar: athlete.photo || '',
      competitionScore: Number(athlete.competitionScore) || 0,
      joinedAt: db.serverDate(),
      paid: true
    }

    return await db.runTransaction(async transaction => {
      const gameRes = await transaction.collection('soloGames').doc(gameId).get()
      const game = gameRes.data || {}
      if (!game._id || game.status === 'cancelled') return { code: -1, msg: '球局不可报名' }
      if (game.paymentMethod === 'private' && game.status !== 'privateBooked') return { code: -1, msg: '包场支付完成后才能上车' }
      if (game.paymentMethod === 'aa') return { code: -1, msg: 'AA预交球局请先支付后报名' }
      if (deadlineMs(game) <= Date.now()) return { code: -1, msg: '已过报名截止时间' }

      const participants = game.participants || []
      if (participants.some(p => p.openid === OPENID)) return { code: -1, msg: '你已报名' }
      if (participants.length >= Number(game.maxPlayers || 0)) return { code: -1, msg: '人数已满' }

      await transaction.collection('soloGames').doc(gameId).update({
        data: { participants: _.push(participant), updatedAt: db.serverDate() }
      })
      await transaction.collection('venueBookings').where({ sourceId: gameId }).update({
        data: {
          participants: _.push(participant),
          status: participants.length + 1 >= Number(game.minPlayers || 0) ? (game.paymentMethod === 'private' ? 'locked' : 'formed') : 'open',
          updatedAt: db.serverDate()
        }
      }).catch(() => {})
      return { code: 0, msg: '报名成功' }
    })
  } catch (e) {
    if (isMissingCollection(e)) return { code: -1, msg: '球局不存在' }
    return { code: -1, msg: e.message }
  }
}
