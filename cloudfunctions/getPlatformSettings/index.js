const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_SUBSCRIBE_TEMPLATES = {
  team: {
    templateId: 'FP_FE6U6eL2ELj1skG8I9JDpfP9nC1R67MyHgmeJgMI'
  },
  event: {
    templateId: 'hMUrnvn6T2-bsx0pGPx_63hdPWbiIecwDOV7D17sgJY'
  },
  payment: {
    templateId: 'l0eD560SJKTqx5hlQ1TDt4ZUowKAv4m55cHteQnTXDk'
  },
  order: {
    templateId: 'XS3YNclz2a6W5xi4cgHQvpryhVotR92yqS-gTeqoOuI'
  }
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
    statWeights: { points: 0.5, rebounds: 0.5, assists: 0.5, steals: 0.5, blocks: 0.5, turnovers: -1 }
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

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object') return base
  const out = Array.isArray(base) ? base.slice() : { ...base }
  Object.keys(extra).forEach(key => {
    if (extra[key] && typeof extra[key] === 'object' && !Array.isArray(extra[key])) {
      out[key] = deepMerge(out[key] || {}, extra[key])
    } else if (extra[key] !== undefined && extra[key] !== null && extra[key] !== '') {
      out[key] = extra[key]
    }
  })
  return out
}

function mergeSubscribeTemplates(extra = {}) {
  return {
    ...DEFAULT_SUBSCRIBE_TEMPLATES,
    ...extra
  }
}

exports.main = async () => {
  try {
    const res = await db.collection('platformSettings').doc('global').get()
    const data = res.data || {}
    return {
      code: 0,
      data: {
        venueCommissionRate: Number(data.venueCommissionRate) || 8,
        subscribeTemplates: mergeSubscribeTemplates(data.subscribeTemplates || data.importantNoticeTemplates || {}),
        scoreFormula: deepMerge(DEFAULT_SCORE_FORMULA, data.scoreFormula || {})
      }
    }
  } catch (e) {
    return { code: 0, data: { venueCommissionRate: 8, subscribeTemplates: DEFAULT_SUBSCRIBE_TEMPLATES, scoreFormula: DEFAULT_SCORE_FORMULA } }
  }
}
