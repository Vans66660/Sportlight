const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function firstNumber(stats, keys) {
  for (const key of keys) {
    if (stats[key] !== '' && stats[key] !== null && stats[key] !== undefined) return num(stats[key])
  }
  return 0
}

function normalizeStats(stats = {}, sport = '') {
  if (sport === '足球' || sport === 'football') {
    return {
      goals: firstNumber(stats, ['goals', 'goal']),
      assists: firstNumber(stats, ['assists', 'assist']),
      shotsOnTarget: firstNumber(stats, ['shotsOnTarget', 'shots', 'shot_on_target']),
      successfulDribbles: firstNumber(stats, ['successfulDribbles', 'dribbles', 'successful_dribble']),
      throughBalls: firstNumber(stats, ['throughBalls', 'throughBall', 'through_ball']),
      keyPasses: firstNumber(stats, ['keyPasses', 'keyPass', 'key_pass']),
      successfulTackles: firstNumber(stats, ['successfulTackles', 'tackles', 'successful_tackle']),
      saves: firstNumber(stats, ['saves', 'save', 'keeperSaves']),
      yellowCards: firstNumber(stats, ['yellowCards', 'yellowCard', 'yellow_card']),
      redCards: firstNumber(stats, ['redCards', 'redCard', 'red_card'])
    }
  }
  if (sport === '篮球' || sport === 'basketball') {
    return {
      points: firstNumber(stats, ['points', 'pts']),
      rebounds: firstNumber(stats, ['rebounds', 'reb']),
      assists: firstNumber(stats, ['assists', 'ast']),
      steals: firstNumber(stats, ['steals', 'stl']),
      blocks: firstNumber(stats, ['blocks', 'blk']),
      turnovers: firstNumber(stats, ['turnovers', 'to'])
    }
  }
  if (sport === '羽毛球' || sport === 'badminton') {
    return {
      points: firstNumber(stats, ['points']),
      winners: firstNumber(stats, ['winners']),
      aces: firstNumber(stats, ['aces']),
      saves: firstNumber(stats, ['saves']),
      errors: firstNumber(stats, ['errors'])
    }
  }
  return stats && typeof stats === 'object' ? stats : {}
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, results } = event

  try {
    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    const eventAdmin = await getEventAdmin(postId, OPENID)

    if (!isAdmin && post.openid !== OPENID && !eventAdmin) return { code: -1, msg: '无权限录入成绩' }

    const validRegs = await db.collection('event_registrations')
      .where({ postId, status: 'approved', paymentStatus: _.in(['paid', 'free', 'offline', 'unpaid']) })
      .limit(200)
      .get()
    const validOpenids = {}
    validRegs.data.forEach(reg => {
      ;(reg.members || []).forEach(m => {
        if (m.openid && m.confirmed) validOpenids[m.openid] = true
      })
    })

    const sport = post.sport || ''
    const cleanResults = (results || []).filter(r => validOpenids[r.openid]).map(r => ({
      openid: r.openid,
      name: r.name || '',
      rank: r.rank !== '' && r.rank !== undefined ? Number(r.rank) : null,
      score: r.score !== '' && r.score !== undefined ? Number(r.score) : null,
      notes: r.notes || '',
      attended: r.attended !== false,
      stats: normalizeStats(r.stats, sport)
    }))
    if (cleanResults.length === 0) return { code: -1, msg: '暂无已确认参赛者' }

    let existing = { data: [] }
    try {
      existing = await db.collection('eventResults').where({ postId }).get()
    } catch (e) {}

    if (existing.data.length > 0) {
      const previous = existing.data[0]
      const revision = (Number(previous.resultRevision) || 1) + 1
      await db.collection('matchResultAuditLogs').add({
        data: {
          postId,
          sourceType: 'event_result',
          resultId: previous._id,
          revision,
          changedByOpenid: OPENID,
          changedByRole: isAdmin ? 'admin' : (eventAdmin ? 'event_admin' : 'organizer'),
          beforeResults: previous.results || [],
          afterResults: cleanResults,
          createdAt: db.serverDate()
        }
      }).catch(() => null)
      await db.collection('eventResults').doc(existing.data[0]._id).update({
        data: {
          results: cleanResults,
          resultLocked: true,
          resultRevision: revision,
          resultLockedBy: OPENID,
          resultLockedAt: db.serverDate(),
          scoreSource: 'platform',
          verificationLevel: 'platform_verified',
          recordedByOpenid: OPENID,
          recordedByRole: 'admin',
          recordedByEventAdminRole: eventAdmin ? (eventAdmin.role || 'full') : '',
          updatedAt: db.serverDate()
        }
      })
    } else {
      await db.collection('eventResults').add({
        data: {
          postId,
          authorOpenid: OPENID,
          eventTitle: post.content ? post.content.slice(0, 50) : '',
          eventDate: post.eventDate || '',
          sport: post.sport || '',
          results: cleanResults,
          resultLocked: true,
          resultRevision: 1,
          resultLockedBy: OPENID,
          resultLockedAt: db.serverDate(),
          scoreSource: 'platform',
          verificationLevel: 'platform_verified',
          recordedByOpenid: OPENID,
          recordedByRole: 'admin',
          recordedByEventAdminRole: eventAdmin ? (eventAdmin.role || 'full') : '',
          submittedAt: db.serverDate()
        }
      })
    }

    await db.collection('posts').doc(postId).update({
      data: { eventStatus: 'closed' }
    })

    // 为每位出席球员并行重算竞技积分和段位
    const attended = cleanResults.filter(r => r.attended !== false && r.openid)
    await Promise.all(attended.map(r =>
      cloud.callFunction({ name: 'calcCompetitionScore', data: { athleteOpenid: r.openid } })
    ))

    // 积分完成后同步认证比赛卡记录；卡面图片生成在后续流程中补充。
    const cardSyncRes = await cloud.callFunction({
      name: 'syncMatchCards',
      data: { sourceType: 'event_result', sourceId: postId, recordedByOpenid: OPENID }
    }).catch(e => ({ result: { code: -1, msg: e.message || '发卡同步失败' } }))

    return {
      code: 0,
      msg: '成绩已录入',
      cardSync: cardSyncRes.result || {},
      scoreSync: {
        ok: true,
        skipped: true,
        msg: '历史成绩已保存；官方积分仅由公开赛单场赛果同步'
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
