const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

const TIER_BASE_SCORE = {
  'S+': 1200,
  S: 1040,
  'A+': 880,
  A: 720,
  'B+': 560,
  B: 400,
  'C+': 300,
  C: 200,
  'D+': 100,
  D: 0
}

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return res.data.length > 0 && res.data[0].userType === 'admin'
}

function normalizeTier(tier) {
  const value = String(tier || '').trim().toUpperCase()
  return TIER_BASE_SCORE[value] !== undefined ? value : ''
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const { athleteOpenid = '', tier = '', note = '' } = event
  const proposedTier = normalizeTier(tier)

  if (!athleteOpenid) return { code: -1, msg: '缺少球员openid' }
  if (!proposedTier || proposedTier === 'D') return { code: -1, msg: '请选择 S/A/B/C 级' }

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const athleteRes = await db.collection('athletes').where({ openid: athleteOpenid }).limit(1).get()
    const athlete = athleteRes.data[0] || {}
    if (!athlete._id) return { code: -1, msg: '球员不存在' }

    await db.collection('athletes').doc(athlete._id).update({
      data: {
        proposedTier,
        proposedCompetitionScore: TIER_BASE_SCORE[proposedTier] || 0,
        levelReviewStatus: 'pending',
        levelRejectReason: '',
        levelReviewSource: 'admin_manual',
        levelReviewNote: String(note || '').trim(),
        levelReviewCreatedBy: OPENID,
        levelReviewCreatedAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })

    await writeAudit({
      adminOpenid: OPENID,
      action: 'athlete_level_review_created',
      category: 'review',
      targetType: 'athlete',
      targetId: athlete._id,
      targetName: athlete.name || athlete.nickname || '',
      detail: { proposedTier, note: String(note || '').trim().slice(0, 300) }
    })

    return { code: 0, msg: 'success' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
