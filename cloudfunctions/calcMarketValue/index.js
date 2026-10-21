const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

function calcBasketballPricing(athlete = {}) {
  const score = Number(athlete.competitionScore) || 100
  const tier = String(athlete.currentTier || athlete.rank || getBasketballTier(score))
  const guaranteedAppearanceFee = tier === 'S'
    ? BASKETBALL_BASE_PAY.S + Math.max(0, Math.floor((score - 850) / 50)) * 50
    : (BASKETBALL_BASE_PAY[tier] || BASKETBALL_BASE_PAY.D)
  const performanceBonus = BASKETBALL_PERFORMANCE_BONUS[tier] || BASKETBALL_PERFORMANCE_BONUS.D
  return {
    rank: tier,
    guaranteedAppearanceFee,
    performanceBonus,
    marketValue: guaranteedAppearanceFee + performanceBonus,
    basketballPriceOffset: guaranteedAppearanceFee - (BASKETBALL_BASE_PAY[tier] || BASKETBALL_BASE_PAY.D)
  }
}

function normalizeTier(tier) {
  const value = String(tier || '').trim()
  return !value || value === 'F' || value.startsWith('F') ? 'D' : value
}

async function countOfficialSamples(athleteOpenid) {
  try {
    const res = await db.collection('competitionScoreLogs').where({ athleteOpenid }).count()
    return Number(res.total) || 0
  } catch (e) {
    return 0
  }
}

function sampleConfidenceRate(samples) {
  const n = Number(samples) || 0
  if (n >= 10) return 1
  if (n >= 5) return 0.9
  if (n >= 1) return 0.8
  return 0.6
}

exports.main = async (event, context) => {
  const { athleteOpenid } = event
  if (!athleteOpenid) return { code: -1, msg: 'athleteOpenid 缺失' }

  try {
    const athleteRes = await db.collection('athletes')
      .where({ openid: athleteOpenid }).limit(1).get()
    if (!athleteRes.data.length) return { code: -1, msg: '运动员不存在' }

    const athlete = athleteRes.data[0]

    if (athlete.sport === '篮球' && athlete.basketballPricingVersion === 'basketball-bounty-v1') {
      const pricing = calcBasketballPricing(athlete)
      await db.collection('athletes').where({ openid: athleteOpenid }).update({
        data: { ...pricing, updatedAt: db.serverDate() }
      })
      return { code: 0, data: { ...pricing, officialSamples: await countOfficialSamples(athleteOpenid) } }
    }

    // 段位由公开赛积分决定，直接读取
    const rank = normalizeTier(athlete.currentTier || athlete.rank)
    let value = RANK_VALUE[rank] || 0

    // 信誉分加成（职业操守，来自订单评价）
    const reputation = athlete.reputation || 80
    if (reputation >= 95) value = Math.floor(value * 1.15)
    else if (reputation >= 85) value = Math.floor(value * 1.08)
    else if (reputation < 60) value = Math.floor(value * 0.85)
    else if (reputation < 70) value = Math.floor(value * 0.93)

    const officialSamples = await countOfficialSamples(athleteOpenid)
    value = Math.floor(value * sampleConfidenceRate(officialSamples))

    const marketValue = value

    await db.collection('athletes').where({ openid: athleteOpenid }).update({
      data: { rank, marketValue, updatedAt: db.serverDate() }
    })

    return { code: 0, data: { rank, marketValue, officialSamples } }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
