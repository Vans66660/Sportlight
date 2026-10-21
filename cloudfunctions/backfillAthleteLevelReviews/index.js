const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

function deriveTier(athlete = {}) {
  const levelLabel = String(athlete.levelLabel || '')
  const labelTier = levelLabel.match(/^(S\+?|A\+?|B\+?|C\+?|D\+?)级/)
  if (labelTier && TIER_BASE_SCORE[labelTier[1]] !== undefined) return labelTier[1]

  if (athlete.hasProBackground === true && athlete.proofFile) return 'S'
  const competitiveBackground = athlete.competitiveBackground || athlete.cubalLevel
  if (competitiveBackground === 'levelA' && athlete.proofFile) return 'A'
  if (competitiveBackground === 'levelB' && athlete.proofFile) return 'B'
  if (athlete.hasAmateurLeague === true && athlete.hasTopThree === true && athlete.topThreeCount === 'gt3' && athlete.proofFile) return 'B'
  if (athlete.hasAmateurLeague === true && athlete.hasTopThree === true && athlete.proofFile) return 'C'
  return 'D'
}

function hasProof(athlete = {}) {
  if (Array.isArray(athlete.proofFile)) return athlete.proofFile.length > 0
  return !!String(athlete.proofFile || '').trim()
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

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const { confirm = '', limit = 100 } = event
  const dryRun = confirm !== 'BACKFILL_LEVEL_REVIEWS'

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const res = await db.collection('athletes')
      .where(_.or([
        { levelReviewStatus: _.exists(false) },
        { levelReviewStatus: '' },
        { levelReviewStatus: 'none' }
      ]))
      .limit(Math.min(Number(limit) || 100, 100))
      .get()

    const candidates = []
    const skipped = []

    for (const athlete of res.data || []) {
      const proposedTier = deriveTier(athlete)
      const needsReview = hasProof(athlete) && proposedTier !== 'D'
      if (!needsReview) {
        skipped.push({ _id: athlete._id, name: athlete.name || '', reason: '无需等级审核' })
        if (!dryRun) {
          await db.collection('athletes').doc(athlete._id).update({
            data: {
              proposedTier,
              proposedCompetitionScore: TIER_BASE_SCORE[proposedTier] || 0,
              levelReviewStatus: 'none',
              updatedAt: db.serverDate()
            }
          })
        }
        continue
      }

      const matchScore = await sumLogs(athlete.openid)
      const currentSeasonId = getSeasonId()
      const currentSeasonScore = await sumSeasonLogs(athlete.openid, currentSeasonId)
      const updateData = {
        proposedTier,
        proposedCompetitionScore: TIER_BASE_SCORE[proposedTier] || 0,
        levelReviewStatus: 'pending',
        levelRejectReason: '',
        initialTier: 'D',
        initialCompetitionScore: 0,
        rank: 'D',
        currentTier: 'D',
        competitionScore: matchScore,
        currentSeasonId,
        currentSeasonScore,
        updatedAt: db.serverDate()
      }

      candidates.push({
        _id: athlete._id,
        openid: athlete.openid || '',
        name: athlete.name || athlete.nickname || '',
        sportlightId: athlete.sportlightId || '',
        fromTier: athlete.currentTier || athlete.rank || 'D',
        proposedTier,
        matchScore
      })

      if (!dryRun) {
        await db.collection('athletes').doc(athlete._id).update({ data: updateData })
      }
    }

    return {
      code: 0,
      dryRun,
      scanned: (res.data || []).length,
      matched: candidates.length,
      updated: dryRun ? 0 : candidates.length,
      candidates,
      skippedCount: skipped.length,
      markedNone: dryRun ? 0 : skipped.length
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
