const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { gameId } = event || {}
  if (!gameId) return { code: -1, msg: '缺少球局ID' }

  try {
    const gameRes = await db.collection('soloGames').doc(gameId).get()
    const game = gameRes.data || {}
    if (!game._id) return { code: -1, msg: '球局不存在' }
    if (game.status === 'finished') return { code: -1, msg: '球局已完成' }

    const venueRes = await db.collection('venues').doc(game.venueId).get()
    const venue = venueRes.data || {}
    if (venue.ownerOpenid !== OPENID) return { code: -1, msg: '无权操作该球馆球局' }

    const participants = game.participants || []
    const openids = [...new Set(participants.map(item => item.openid).filter(Boolean))]
    if (openids.length) {
      const athleteRes = await db.collection('athletes').where({ openid: db.command.in(openids) }).field({ openid: true, reputation: true }).get()
      await Promise.all(athleteRes.data.map(athlete =>
        db.collection('athletes').doc(athlete._id).update({
          data: {
            reputation: Math.min(100, (athlete.reputation || 80) + 1),
            updatedAt: db.serverDate()
          }
        })
      ))
      await Promise.all(openids.map(openid => db.collection('notifications').add({
        data: {
          fromOpenid: 'system',
          toOpenid: openid,
          type: 'venue_game_completed',
          content: `你在「${venue.name || '球馆'}」完成了一次约场，信誉分 +1。`,
          gameId,
          createdAt: db.serverDate(),
          read: false
        }
      })))
    }

    await db.collection('soloGames').doc(gameId).update({
      data: {
        status: 'finished',
        finishedAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    await db.collection('venueBookings').where({ sourceId: gameId }).update({
      data: {
        status: 'finished',
        finishedAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    }).catch(() => {})

    return { code: 0, msg: '已完成' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
