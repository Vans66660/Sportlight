const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, matchId, groupName, round, teamA, teamB, reason } = event

  if (!postId || !matchId) return { code: -1, msg: '参数不完整' }

  try {
    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    const athlete = athleteRes.data[0] || {}
    const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    const user = userRes.data[0] || {}

    const data = {
      postId,
      matchId,
      groupName: groupName || '',
      round: round || '',
      teamA: teamA || '',
      teamB: teamB || '',
      reason: (reason || '').trim().slice(0, 500),
      athleteOpenid: OPENID,
      athleteName: athlete.name || user.name || '未命名球员',
      athleteSportlightId: athlete.sportlightId || user.sportlightId || '',
      status: 'pending',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    await db.collection('matchDisputes').add({ data })

    return { code: 0, msg: '反馈已提交' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
