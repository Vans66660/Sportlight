const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const TIER_BASE_SCORE = {
  'S+': 1200, S: 1040,
  'A+': 880,  A: 720,
  'B+': 560,  B: 400,
  'C+': 300,  C: 200,
  'D+': 100,  D: 0
}

function normalizeTier(tier) {
  const value = String(tier || '').trim().toUpperCase()
  return TIER_BASE_SCORE[value] !== undefined ? value : ''
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const { proposedTier = '', note = '', proofImages = [] } = event
  const tier = normalizeTier(proposedTier)

  if (!tier || tier === 'D') return { code: -1, msg: '请选择 D+ 及以上段位' }

  try {
    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    const athlete = athleteRes.data[0] || {}
    if (!athlete._id) return { code: -1, msg: '请先完成运动员注册' }

    if (athlete.levelReviewStatus === 'pending') return { code: -1, msg: '已有段位审核正在处理中，请等待审核结果' }

    const currentTier = athlete.currentTier || athlete.rank || 'D'
    if (TIER_BASE_SCORE[tier] <= TIER_BASE_SCORE[currentTier]) {
      return { code: -1, msg: `你当前的段位已是 ${currentTier}，只能申请更高段位` }
    }

    await db.collection('athletes').doc(athlete._id).update({
      data: {
        proposedTier: tier,
        proposedCompetitionScore: TIER_BASE_SCORE[tier] || 0,
        levelReviewStatus: 'pending',
        levelRejectReason: '',
        levelReviewSource: 'athlete_self',
        levelReviewNote: String(note || '').trim(),
        levelReviewProofs: Array.isArray(proofImages) ? proofImages.filter(p => p && String(p).startsWith('cloud://')) : [],
        levelReviewCreatedAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })

    return { code: 0, msg: '已提交段位审核申请，请等待管理员审核' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
