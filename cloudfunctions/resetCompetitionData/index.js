const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  try {
    // ── 1. 重置所有球员竞技字段 ──
    const athleteRes = await db.collection('athletes').limit(100).get()
    let athletesReset = 0
    for (const athlete of athleteRes.data) {
      await db.collection('athletes').doc(athlete._id).update({
        data: {
          currentTier: 'D',
          rank: 'D',
          competitionScore: 0,
          currentSeasonScore: 0,
          marketValue: 0
        }
      })
      athletesReset++
    }

    // ── 2. 清空 eventResults 集合 ──
    let resultsDeleted = 0
    try {
      let hasMore = true
      while (hasMore) {
        const batch = await db.collection('eventResults').limit(20).get()
        if (batch.data.length === 0) { hasMore = false; break }
        for (const doc of batch.data) {
          await db.collection('eventResults').doc(doc._id).remove()
          resultsDeleted++
        }
      }
    } catch (e) {}

    // ── 3. 把已关闭赛事状态改回 open ──
    let eventsReset = 0
    try {
      const closedEvents = await db.collection('posts')
        .where({ postType: 'event', eventStatus: 'closed' })
        .limit(50).get()
      for (const post of closedEvents.data) {
        await db.collection('posts').doc(post._id).update({
          data: { eventStatus: 'open' }
        })
        eventsReset++
      }
    } catch (e) {}

    return {
      code: 0,
      msg: '清理完成',
      athletesReset,
      resultsDeleted,
      eventsReset
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
