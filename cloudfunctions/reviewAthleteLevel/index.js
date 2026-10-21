const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function writeAudit(data) {
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

const BASKETBALL_TIER_BASE_SCORE = { S: 850, A: 650, B: 500, C: 300, D: 100 }

function basketballPricing(score, tier) {
  const baseByTier = { S: 1980, A: 660, B: 320, C: 198, D: 128 }
  const bonusByTier = { S: 1020, A: 420, B: 380, C: 220, D: 122 }
  const guaranteedAppearanceFee = tier === 'S'
    ? baseByTier.S + Math.max(0, Math.floor((Number(score) - 850) / 50)) * 50
    : (baseByTier[tier] || baseByTier.D)
  const performanceBonus = bonusByTier[tier] || bonusByTier.D
  return { guaranteedAppearanceFee, performanceBonus, marketValue: guaranteedAppearanceFee + performanceBonus, basketballPriceOffset: guaranteedAppearanceFee - (baseByTier[tier] || baseByTier.D) }
}

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return res.data.length > 0 && res.data[0].userType === 'admin'
}

async function sumLogs(openid) {
  let all = []
  let skip = 0
  while (true) {
    const res = await db.collection('competitionScoreLogs').where({ athleteOpenid: openid }).skip(skip).limit(100).get().catch(() => ({ data: [] }))
    all = all.concat(res.data || [])
    if (!res.data || res.data.length < 100) break
    skip += 100
  }
  return all.reduce((sum, log) => sum + (Number(log.delta) || 0), 0)
}

function getSeasonId(value = Date.now()) {
  const raw = value ? String(value).replace(/-/g, '/') : ''
  const d = raw ? new Date(raw) : new Date()
  const valid = !Number.isNaN(d.getTime())
  const base = valid ? d : new Date()
  return `${base.getFullYear()}-${base.getMonth() < 6 ? 'H1' : 'H2'}`
}

function resolveLogSeasonId(log = {}) {
  return String(log.seasonId || getSeasonId(log.matchTime || log.createdAtMs || log.createdAt))
}

function isSeasonMatch(log, seasonId) {
  const target = String(seasonId || getSeasonId())
  const actual = resolveLogSeasonId(log)
  if (/^\d{4}$/.test(target)) return actual === target || actual.startsWith(`${target}-`)
  return actual === target
}

async function sumSeasonLogs(openid, seasonId) {
  let all = []
  let skip = 0
  while (true) {
    const res = await db.collection('competitionScoreLogs').where({ athleteOpenid: openid }).skip(skip).limit(100).get().catch(() => ({ data: [] }))
    all = all.concat(res.data || [])
    if (!res.data || res.data.length < 100) break
    skip += 100
  }
  return all
    .filter(log => isSeasonMatch(log, seasonId))
    .reduce((sum, log) => sum + (Number(log.delta) || 0), 0)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { athleteId, action, reason = '' } = event || {}

  if (!athleteId) return { code: -1, msg: '缺少运动员ID' }
  if (!['approve', 'reject'].includes(action)) return { code: -1, msg: '无效的审核动作' }

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const athleteRes = await db.collection('athletes').doc(athleteId).get()
    const athlete = athleteRes.data || {}
    if (!athlete._id) return { code: -1, msg: '运动员不存在' }

    const isBasketball = athlete.sport === '篮球' && athlete.basketballPricingVersion === 'basketball-bounty-v1'
    const isSPromotionReview = isBasketball && athlete.sPromotionReviewStatus === 'pending'
    if (isSPromotionReview) {
      const nextTier = action === 'approve' ? 'S' : 'A'
      const pricing = basketballPricing(athlete.competitionScore, nextTier)
      await db.collection('athletes').doc(athleteId).update({
        data: {
          currentTier: nextTier,
          rank: nextTier,
          sPromotionReviewStatus: action === 'approve' ? 'approved' : 'rejected',
          sPromotionReviewedAt: db.serverDate(),
          sPromotionReviewedBy: OPENID,
          sPromotionRejectReason: action === 'reject' ? String(reason || '').trim() : '',
          ...pricing,
          updatedAt: db.serverDate()
        }
      })
      await writeAudit({ adminOpenid: OPENID, action: 'basketball_s_promotion_review', category: 'review', targetType: 'athlete', targetId: athleteId, targetName: athlete.name || athlete.openid || '', detail: { action, fromTier: athlete.currentTier || '', toTier: nextTier, reason: String(reason || '').trim() } })
      return { code: 0, msg: 'success' }
    }

    const proposedTier = athlete.proposedTier || athlete.initialTier || 'D'
    const approvedBase = isBasketball
      ? (Number(athlete.basketballRecommendedScore) || Number(athlete.proposedCompetitionScore) || BASKETBALL_TIER_BASE_SCORE.D)
      : (TIER_BASE_SCORE[proposedTier] || 0)
    const matchScore = await sumLogs(athlete.openid)
    const currentSeasonId = getSeasonId()
    const currentSeasonScore = await sumSeasonLogs(athlete.openid, currentSeasonId)
    const nextTier = action === 'approve' ? proposedTier : 'D'
    const nextBaseScore = action === 'approve' ? approvedBase : (isBasketball ? BASKETBALL_TIER_BASE_SCORE.D : 0)
    const nextTotalScore = nextBaseScore + matchScore

    const updateData = {
      levelReviewStatus: action === 'approve' ? 'approved' : 'rejected',
      levelReviewedAt: db.serverDate(),
      levelReviewedBy: OPENID,
      levelRejectReason: action === 'reject' ? String(reason || '').trim() : '',
      initialTier: nextTier,
      initialCompetitionScore: nextBaseScore,
      currentTier: nextTier,
      rank: nextTier,
      competitionScore: nextTotalScore,
      currentSeasonId,
      currentSeasonScore,
      updatedAt: db.serverDate()
    }
    if (isBasketball) {
      const shouldStartSPromotionReview = action === 'approve' && athlete.basketballRequiresSPromotionReview === true
      Object.assign(updateData, {
        basketballBountyEligible: action === 'approve',
        athleteLevelCertVerified: action === 'approve' && !!athlete.athleteLevelCertFile && !!athlete.athleteLevelCertLevel,
        sPromotionReviewStatus: shouldStartSPromotionReview ? 'pending' : (nextTier === 'S' && action === 'approve' ? 'approved' : 'none'),
        sPromotionReviewCreatedAt: shouldStartSPromotionReview ? db.serverDate() : null,
        ...basketballPricing(nextTotalScore, nextTier)
      })
    }

    await db.collection('athletes').doc(athleteId).update({ data: updateData })
    await writeAudit({ adminOpenid: OPENID, action: 'athlete_level_review', category: 'review', targetType: 'athlete', targetId: athleteId, targetName: athlete.name || athlete.openid || '', detail: { action, fromTier: athlete.currentTier || '', proposedTier, toTier: nextTier, reason: String(reason || '').trim() } })
    await cloud.callFunction({ name: 'calcMarketValue', data: { athleteOpenid: athlete.openid } }).catch(() => null)

    return { code: 0, msg: 'success' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
