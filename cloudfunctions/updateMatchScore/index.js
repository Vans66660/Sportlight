const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollection(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist')
}

async function getEventAdmin(postId, openid) {
  try {
    const res = await db.collection('eventAdmins')
      .where({ postId, adminOpenid: openid, status: 'accepted' })
      .limit(1)
      .get()
    return (res.data || [])[0] || null
  } catch (e) {
    if (isMissingCollection(e)) return null
    throw e
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, matchId, scoreA, scoreB } = event

  if (!postId || !matchId) return { code: -1, msg: '参数缺失' }

  const a = Number(scoreA)
  const b = Number(scoreB)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) {
    return { code: -1, msg: '请输入有效比分' }
  }

  try {
    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }
    const eventAdmin = await getEventAdmin(postId, OPENID)
    if (!isAdmin && post.openid !== OPENID && !eventAdmin) return { code: -1, msg: '无权限录入比分' }

    const schedule = post.eventSchedule
    if (!schedule || !Array.isArray(schedule.matches)) return { code: -1, msg: '赛程不存在' }
    let found = false
    const matches = schedule.matches.map(match => {
      if (match.matchId !== matchId) return match
      found = true
      return {
        ...match,
        scoreA: a,
        scoreB: b,
        winnerTeamId: a === b ? '' : (a > b ? match.teamAId : match.teamBId),
        status: 'finished',
        scoreSource: 'platform',
        verificationLevel: 'platform_verified',
        recordedByOpenid: OPENID,
        recordedByRole: 'admin',
        updatedAt: db.serverDate()
      }
    })
    if (!found) return { code: -1, msg: '比赛不存在' }

    await db.collection('posts').doc(postId).update({
      data: {
        'eventSchedule.matches': matches,
        'eventSchedule.updatedAt': db.serverDate()
      }
    })

    return { code: 0, msg: '比分已保存' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
