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
    const gameRes = await db.collection('soloGames').doc(gameId).get()
    const game = gameRes.data || {}
    if (!game._id) return { code: -1, msg: '球局不存在' }
    const deadline = new Date(`${game.deadlineDate || game.date} ${game.deadlineTime || '00:00'}`).getTime()
    if (Date.now() >= deadline) return { code: -1, msg: '已过报名截止时间，无法退款' }

    const participant = (game.participants || []).find(p => p.openid === OPENID)
    if (!participant) return { code: -1, msg: '你未报名该球局' }

    // 有支付记录的，走退款流程（由 soloGamePayment 云函数统一处理参与者移除和退款）
    if (participant.tradeNo && participant.paid) {
      const refundRes = await cloud.callFunction({
        name: 'soloGamePayment',
        data: { action: 'refund', gameId }
      })
      if (refundRes.result && refundRes.result.code === 0) {
        return { code: 0, msg: '已取消报名，退款将原路退回' }
      }
      return { code: -1, msg: (refundRes.result && refundRes.result.msg) || '退款发起失败，请联系平台处理' }
    }

    // 未支付的情况，直接移除参与者
    const participants = (game.participants || []).filter(p => p.openid !== OPENID)
    await db.collection('soloGames').doc(gameId).update({
      data: { participants, updatedAt: db.serverDate() }
    })
    await db.collection('venueBookings').where({ sourceId: gameId }).update({
      data: {
        participants,
        status: participants.length >= Number(game.minPlayers || 0) ? (game.paymentMethod === 'private' ? 'locked' : 'formed') : 'open',
        updatedAt: db.serverDate()
      }
    }).catch(() => {})
    return { code: 0, msg: '已取消报名' }
  } catch (e) {
    if (isMissingCollection(e)) return { code: -1, msg: '球局不存在' }
    return { code: -1, msg: e.message }
  }
}
