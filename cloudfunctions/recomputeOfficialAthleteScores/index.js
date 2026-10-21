const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

const RANK_VALUE = {
  D: 800, 'D+': 1200,
  C: 3000, 'C+': 4500,
  B: 9000, 'B+': 13000,
  A: 26000, 'A+': 38000,
  S: 80000, 'S+': 120000
}

const BASKETBALL_BASE_PAY = { S: 1980, A: 660, B: 320, C: 198, D: 128 }
const BASKETBALL_PERFORMANCE_BONUS = { S: 1020, A: 420, B: 380, C: 220, D: 122 }

function getBasketballTier(score) {
  const value = Number(score) || 0
  if (value >= 850) return 'S'
  if (value >= 650) return 'A'
  if (value >= 500) return 'B'
  if (value >= 300) return 'C'
  return 'D'
}

function calcBasketballPricing(score, tier) {
  const guaranteedAppearanceFee = tier === 'S'
    ? BASKETBALL_BASE_PAY.S + Math.max(0, Math.floor(((Number(score) || 850) - 850) / 50)) * 50
    : (BASKETBALL_BASE_PAY[tier] || BASKETBALL_BASE_PAY.D)
  const performanceBonus = BASKETBALL_PERFORMANCE_BONUS[tier] || BASKETBALL_PERFORMANCE_BONUS.D
  return { guaranteedAppearanceFee, performanceBonus, marketValue: guaranteedAppearanceFee + performanceBonus, basketballPriceOffset: guaranteedAppearanceFee - (BASKETBALL_BASE_PAY[tier] || BASKETBALL_BASE_PAY.D) }
}

const CONFIRM_TEXT = 'RECOMPUTE_OFFICIAL_ATHLETE_SCORES'

async function ensureAdmin(openid) {
  if (!openid) return false
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return res.data.length > 0 && res.data[0].userType === 'admin'
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

function getTier(score) {
  const value = Number(score) || 0
  if (value >= TIER_BASE_SCORE['S+']) return 'S+'
  if (value >= TIER_BASE_SCORE.S) return 'S'
  if (value >= TIER_BASE_SCORE['A+']) return 'A+'
  if (value >= TIER_BASE_SCORE.A) return 'A'
  if (value >= TIER_BASE_SCORE['B+']) return 'B+'
  if (value >= TIER_BASE_SCORE.B) return 'B'
  if (value >= TIER_BASE_SCORE['C+']) return 'C+'
  if (value >= TIER_BASE_SCORE.C) return 'C'
  if (value >= TIER_BASE_SCORE['D+']) return 'D+'
  return 'D'
}

function sampleConfidenceRate(samples) {
  const n = Number(samples) || 0
  if (n >= 10) return 1
  if (n >= 5) return 0.9
  if (n >= 1) return 0.8
  return 0.6
}

function calcMarketValue({ tier, reputation = 80, officialSamples = 0 }) {
  let value = RANK_VALUE[tier] || 0
  const rep = Number(reputation) || 80
  if (rep >= 95) value = Math.floor(value * 1.15)
  else if (rep >= 85) value = Math.floor(value * 1.08)
  else if (rep < 60) value = Math.floor(value * 0.85)
  else if (rep < 70) value = Math.floor(value * 0.93)
  return Math.floor(value * sampleConfidenceRate(officialSamples))
}

async function fetchOfficialLogs(openid) {
  let all = []
  let skip = 0
  while (true) {
    const res = await db.collection('competitionScoreLogs')
      .where({ athleteOpenid: openid })
      .skip(skip)
      .limit(100)
      .get()
      .catch(() => ({ data: [] }))
    all = all.concat(res.data || [])
    if (!res.data || res.data.length < 100) break
    skip += 100
  }
  return all
}

function computeAthleteScores(athlete, logs, seasonId) {
  const initialCompetitionScore = Number(athlete.initialCompetitionScore) || 0
  const officialScore = logs.reduce((sum, log) => sum + (Number(log.delta) || 0), 0)
  const currentSeasonScore = logs
    .filter(log => isSeasonMatch(log, seasonId))
    .reduce((sum, log) => sum + (Number(log.delta) || 0), 0)
  const competitionScore = initialCompetitionScore + officialScore
  const isBasketball = athlete.sport === '篮球' && athlete.basketballPricingVersion === 'basketball-bounty-v1'
  const scoreTier = isBasketball ? getBasketballTier(competitionScore) : getTier(competitionScore)
  // 重算不能绕开 A 升 S 的人工审核。
  const currentTier = isBasketball && scoreTier === 'S' && !(athlete.currentTier === 'S' && athlete.sPromotionReviewStatus === 'approved')
    ? 'A'
    : scoreTier
  const officialSamples = logs.length
  const pricing = isBasketball ? calcBasketballPricing(competitionScore, currentTier) : null
  const marketValue = pricing ? pricing.marketValue : calcMarketValue({
    tier: currentTier,
    reputation: athlete.reputation,
    officialSamples
  })

  return {
    initialCompetitionScore,
    officialScore,
    competitionScore,
    currentSeasonId: String(seasonId || getSeasonId()),
    currentSeasonScore,
    currentTier,
    rank: currentTier,
    marketValue,
    ...(pricing || {}),
    officialSamples
  }
}

async function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const {
    adminOpenid = '',
    confirm = '',
    seasonId = getSeasonId(),
    batchSize = 20,
    startSkip = 0,
    maxAthletes = batchSize
  } = event
  // 云端测试没有微信登录态，允许显式传 adminOpenid；真实小程序调用时只认 OPENID。
  const operatorOpenid = OPENID || String(adminOpenid || '').trim()
  const dryRun = confirm !== CONFIRM_TEXT
  const pageSize = Math.max(1, Math.min(Number(batchSize) || 100, 100))
  const max = Math.max(0, Number(maxAthletes) || 0)

  try {
    const isAdmin = await ensureAdmin(operatorOpenid)
    if (!isAdmin) return { code: -1, msg: operatorOpenid ? '无权限' : '云端测试缺少 adminOpenid' }

    const start = Math.max(0, Number(startSkip) || 0)
    let skip = start
    let scanned = 0
    let updated = 0
    let skipped = 0
    const failures = []
    const preview = []

    while (true) {
      if (max > 0 && scanned >= max) break
      const limit = max > 0 ? Math.min(pageSize, max - scanned) : pageSize
      const res = await db.collection('athletes').skip(skip).limit(limit).get()
      const athletes = res.data || []
      if (!athletes.length) break

      for (const athlete of athletes) {
        scanned += 1
        if (!athlete.openid) {
          skipped += 1
          failures.push({ _id: athlete._id || '', name: athlete.name || '', reason: '缺少 openid，已跳过' })
          continue
        }

        try {
          const logs = await fetchOfficialLogs(athlete.openid)
          const computed = computeAthleteScores(athlete, logs, String(seasonId || getSeasonId()))
          const updateData = {
            competitionScore: computed.competitionScore,
            currentSeasonId: computed.currentSeasonId,
            currentSeasonScore: computed.currentSeasonScore,
            currentTier: computed.currentTier,
            rank: computed.rank,
            marketValue: computed.marketValue,
            officialScore: computed.officialScore,
            officialScoreSamples: computed.officialSamples,
            updatedAt: db.serverDate()
          }

          if (!dryRun) {
            await db.collection('athletes').doc(athlete._id).update({ data: updateData })
          }
          updated += 1

          if (preview.length < 30) {
            preview.push({
              _id: athlete._id,
              openid: athlete.openid,
              name: athlete.name || athlete.nickname || '',
              from: {
                competitionScore: Number(athlete.competitionScore) || 0,
                currentSeasonScore: Number(athlete.currentSeasonScore) || 0,
                currentTier: athlete.currentTier || athlete.rank || '',
                marketValue: Number(athlete.marketValue) || 0
              },
              to: computed
            })
          }
        } catch (e) {
          failures.push({
            _id: athlete._id || '',
            openid: athlete.openid || '',
            name: athlete.name || athlete.nickname || '',
            reason: e.message || String(e)
          })
        }
      }

      skip += athletes.length
      if (athletes.length < limit) break
    }

    if (!dryRun) {
      await writeAudit({
        adminOpenid: OPENID,
        operatorOpenid,
        action: 'recompute_official_athlete_scores',
        category: 'settings',
        targetType: 'athletes',
        targetId: '',
        detail: { seasonId: String(seasonId || getSeasonId()), scanned, updated, skipped, failureCount: failures.length }
      })
    }

    return {
      code: 0,
      dryRun,
      confirmRequired: dryRun ? CONFIRM_TEXT : '',
      seasonId: String(seasonId || getSeasonId()),
      scanned,
      updated: dryRun ? 0 : updated,
      wouldUpdate: dryRun ? updated : 0,
      skipped,
      failed: failures.length,
      failures,
      preview,
      nextSkip: skip,
      hasMore: max > 0 ? scanned >= max : false,
      msg: dryRun
        ? `预览完成；确认写入请传 confirm=${CONFIRM_TEXT}`
        : '官方积分重算完成'
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
