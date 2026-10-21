const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollection(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { gameId } = event || {}
  if (!gameId) return { code: -1, msg: '缺少球局ID' }
  try {
    const res = await db.collection('soloGames').doc(gameId).get()
    const game = res.data || {}
    if (!game._id) return { code: -1, msg: '球局不存在' }
    const participants = game.participants || []
    const currentParticipant = participants.find(p => p.openid === OPENID) || null
    const participantCount = participants.length
    const avgScore = participantCount ? Math.round(participants.reduce((sum, p) => sum + (Number(p.competitionScore) || 0), 0) / participantCount) : Number(game.creatorScore) || 0
    return {
      code: 0,
      data: {
        ...game,
        participantCount,
        avgScore,
        formed: participantCount >= Number(game.minPlayers || 0),
        joined: !!currentParticipant,
        isCreator: game.creatorOpenid === OPENID,
        isPrivateBooking: game.paymentMethod === 'private' || game.status === 'privateBooked' || game.status === 'privatePendingPayment',
        privatePaid: game.paymentMethod !== 'private' || game.status === 'privateBooked' || game.privatePaymentStatus === 'paid',
        needsPrivatePayment: game.paymentMethod === 'private' && game.creatorOpenid === OPENID && game.status !== 'privateBooked',
        currentParticipant,
        canRefund: Date.now() < new Date(`${game.deadlineDate || game.date} ${game.deadlineTime || '00:00'}`).getTime()
      }
    }
  } catch (e) {
    if (isMissingCollection(e)) return { code: -1, msg: '球局不存在' }
    return { code: -1, msg: e.message }
  }
}
