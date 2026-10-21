const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

const DEFAULT_SCORE_FORMULA = {
  version: '2026-07-open-match-v1',
  intensityMin: 0.5,
  intensityMax: 1.5,
  tierCoefficients: {
    'S+': 1.8, S: 1.6, 'A+': 1.4, A: 1.2, 'B+': 1.0, B: 0.8, 'C+': 0.6, C: 0.4, 'D+': 0.2, D: 0
  },
  resultPerformanceFactor: { win: 1, draw: 0.75, loss: 0.45 },
  basketball: {
    resultBase: { win: 6, loss: -8 },
    statWeights: { points: 0.5, rebounds: 0.5, assists: 0.5, steals: 0.5, blocks: 0.5, turnovers: -1 },
    detailCaps: { matchDeltaMin: -25, matchDeltaMax: 35 }
  },
  badminton: {
    resultBase: { win: 7, loss: -7 },
    statWeights: { points: 0.35, winners: 1.1, aces: 1.4, saves: 0.5, errors: -0.8 },
    detailCaps: { matchDeltaMin: -22, matchDeltaMax: 32 }
  },
  football: {
    resultBase: { win: 8, draw: 1, loss: -8 },
    teamAttackByGoals: { '0': -1, '1': 1, '2': 2.5, '3': 4, '4+': 5 },
    teamDefenseByAgainst: { '0': 10, '1': 6, '2': 1, '3': -5, '4': -9, '5+': -14 },
    eventWeights: {
      goal: 5,
      assist: 3.5,
      shot_on_target: 1.2,
      successful_dribble: 1,
      through_ball: 1.8,
      key_pass: 1.5,
      successful_tackle: 1.2,
      save: 1.5,
      yellow_card: -1.5,
      red_card: -6
    },
    detailWeights: {
      keyPasses: 0.8, throughBalls: 0.5, keyThroughBalls: 1, shotsOnTarget: 0.4, bigChanceMissed: -1.5,
      dribbles: 0.5, foulsWon: 0.3, longPasses: 0.3, crosses: 0.4,
      tackles: 0.6, interceptions: 0.5, clearances: 0.3, blocks: 0.8, aerialsWon: 0.3, dribbledPast: -0.6, errorToGoal: -3,
      fouls: -0.2, offsides: -0.3,
      keeperSaves: 0.8, keeperBigSaves: 2, keeperSweeper: 0.5, keeperError: -4
    },
    detailCaps: { attack: 8, organize: 7, defense: 9, discipline: 5, goalkeeper: 8, detailTotalMin: -10, detailTotalMax: 14, matchDeltaMin: -25, matchDeltaMax: 35 },
    balanceScale: 0.12,
    positionWeights: {
      '边锋': { attack: 0.9, defense: 0.25, opportunity: 0.9 },
      '中锋': { attack: 1, defense: 0.15, opportunity: 1 },
      '前腰': { attack: 0.8, defense: 0.35, opportunity: 0.85 },
      '后腰': { attack: 0.5, defense: 0.75, opportunity: 0.65 },
      '边后卫': { attack: 0.4, defense: 0.9, opportunity: 0.55 },
      '中后卫': { attack: 0.25, defense: 1.05, opportunity: 0.4 },
      '门将': { attack: 0.05, defense: 1.25, opportunity: 0.25 }
    }
  }
}

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return res.data.length > 0 && res.data[0].userType === 'admin'
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const rate = Number(event && event.venueCommissionRate)
  if (!Number.isFinite(rate) || rate < 0 || rate > 50) return { code: -1, msg: '抽成比例需在0-50之间' }

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const updateData = {
      venueCommissionRate: Math.round(rate * 100) / 100,
      updatedAt: db.serverDate(),
      updatedBy: OPENID
    }
    if (event && event.scoreFormula) {
      updateData.scoreFormula = sanitizeScoreFormula(event.scoreFormula)
    }
    if (event && event.subscribeTemplates && typeof event.subscribeTemplates === 'object') {
      updateData.subscribeTemplates = sanitizeSubscribeTemplates(event.subscribeTemplates)
    }
    const previousRes = await db.collection('platformSettings').doc('global').get().catch(() => ({ data: null }))
    const previous = previousRes.data || {}
    await db.collection('platformSettings').doc('global').set({ data: updateData })
    await writeAudit({
      adminOpenid: OPENID,
      action: 'platform_settings_update',
      category: 'settings',
      targetType: 'platformSettings',
      targetId: 'global',
      targetName: '平台全局设置',
      detail: {
        venueCommissionRate: { from: previous.venueCommissionRate, to: updateData.venueCommissionRate },
        scoreFormulaUpdated: !!updateData.scoreFormula,
        subscribeTemplatesUpdated: !!updateData.subscribeTemplates
      }
    })
    return { code: 0, msg: 'success' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}

function sanitizeSubscribeTemplates(input) {
  const allowed = ['order', 'payment', 'event', 'team', 'default']
  const output = {}
  allowed.forEach(key => {
    const value = input[key]
    if (!value) return
    if (typeof value === 'string') {
      output[key] = value.trim()
      return
    }
    if (typeof value !== 'object') return
    const templateId = String(value.templateId || '').trim()
    if (!templateId) return
    output[key] = {
      templateId,
      page: String(value.page || '').trim(),
      miniprogramState: ['developer', 'trial', 'formal'].includes(value.miniprogramState) ? value.miniprogramState : 'formal',
      lang: value.lang || 'zh_CN'
    }
  })
  return output
}

function sanitizeScoreFormula(input) {
  const source = input || {}
  const out = JSON.parse(JSON.stringify(DEFAULT_SCORE_FORMULA))
  const setNum = (path, min, max) => {
    let src = source
    let dst = out
    for (let i = 0; i < path.length - 1; i++) {
      src = src && src[path[i]]
      dst = dst[path[i]]
    }
    const key = path[path.length - 1]
    const n = Number(src && src[key])
    if (Number.isFinite(n) && n >= min && n <= max) dst[key] = Math.round(n * 100) / 100
  }
  setNum(['intensityMin'], 0.1, 2)
  setNum(['intensityMax'], 0.1, 2)
  Object.keys(out.tierCoefficients).forEach(k => setNum(['tierCoefficients', k], -5, 5))
  Object.keys(out.resultPerformanceFactor).forEach(k => setNum(['resultPerformanceFactor', k], 0, 2))
  Object.keys(out.basketball.resultBase).forEach(k => setNum(['basketball', 'resultBase', k], -50, 50))
  Object.keys(out.basketball.statWeights).forEach(k => setNum(['basketball', 'statWeights', k], -10, 10))
  Object.keys(out.basketball.detailCaps).forEach(k => setNum(['basketball', 'detailCaps', k], -100, 100))
  Object.keys(out.badminton.resultBase).forEach(k => setNum(['badminton', 'resultBase', k], -50, 50))
  Object.keys(out.badminton.statWeights).forEach(k => setNum(['badminton', 'statWeights', k], -10, 10))
  Object.keys(out.badminton.detailCaps).forEach(k => setNum(['badminton', 'detailCaps', k], -100, 100))
  Object.keys(out.football.resultBase).forEach(k => setNum(['football', 'resultBase', k], -50, 50))
  Object.keys(out.football.teamAttackByGoals).forEach(k => setNum(['football', 'teamAttackByGoals', k], -50, 50))
  Object.keys(out.football.teamDefenseByAgainst).forEach(k => setNum(['football', 'teamDefenseByAgainst', k], -50, 50))
  Object.keys(out.football.eventWeights).forEach(k => setNum(['football', 'eventWeights', k], -50, 50))
  Object.keys(out.football.detailWeights).forEach(k => setNum(['football', 'detailWeights', k], -20, 20))
  Object.keys(out.football.detailCaps).forEach(k => setNum(['football', 'detailCaps', k], -100, 100))
  setNum(['football', 'balanceScale'], 0, 1)
  Object.keys(out.football.positionWeights).forEach(pos => {
    setNum(['football', 'positionWeights', pos, 'attack'], 0, 3)
    setNum(['football', 'positionWeights', pos, 'defense'], 0, 3)
    setNum(['football', 'positionWeights', pos, 'opportunity'], 0, 1)
  })
  if (out.intensityMin > out.intensityMax) {
    const tmp = out.intensityMin
    out.intensityMin = out.intensityMax
    out.intensityMax = tmp
  }
  return out
}
