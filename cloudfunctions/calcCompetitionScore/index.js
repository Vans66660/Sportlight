const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 历史兼容函数：旧 eventResults 成绩展示仍可保留，但官方积分请使用 competitionScoreLogs 链路。

function getSeasonId(date) {
  const d = date ? new Date(date) : new Date()
  const year = isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear()
  const month = isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth()
  return `${year}-${month < 6 ? 'H1' : 'H2'}`
}

function getPrevSeasonId(seasonId) {
  const [year, half] = seasonId.split('-')
  return half === 'H1' ? `${parseInt(year) - 1}-H2` : `${year}-H1`
}

function calcPoints(rank, totalAttended) {
  const base = !rank ? 10
    : rank === 1 ? 100
    : rank === 2 ? 70
    : rank === 3 ? 50
    : rank <= 6  ? 30 : 10
  const mult = totalAttended <= 5  ? 1.0
    : totalAttended <= 15 ? 1.3
    : totalAttended <= 30 ? 1.6 : 2.0
  return Math.round(base * mult)
}

function calcStatScore(stats, sport) {
  if (!stats) return 0
  const value = (...keys) => {
    for (const key of keys) {
      if (stats[key] !== '' && stats[key] !== null && stats[key] !== undefined) return Number(stats[key]) || 0
    }
    return 0
  }
  if (sport === '篮球' || sport === 'basketball') {
    return value('points', 'pts')
      + value('rebounds', 'reb') * 0.5
      + value('assists', 'ast') * 0.75
      + value('steals', 'stl')
      + value('blocks', 'blk')
      - value('turnovers', 'to') * 0.5
  }
  if (sport === '足球' || sport === 'football') {
    return value('goals', 'goal') * 5
      + value('assists', 'assist') * 3.5
      + value('shotsOnTarget', 'shots', 'shot_on_target') * 1.2
      + value('successfulDribbles', 'dribbles', 'successful_dribble')
      + value('throughBalls', 'throughBall', 'through_ball') * 1.8
      + value('keyPasses', 'keyPass', 'key_pass') * 1.5
      + value('successfulTackles', 'tackles', 'successful_tackle') * 1.2
      + value('saves', 'save', 'keeperSaves') * 1.5
      - value('yellowCards', 'yellowCard', 'yellow_card') * 1.5
      - value('redCards', 'redCard', 'red_card') * 6
  }
  if (sport === '羽毛球' || sport === 'badminton') {
    return (Number(stats.points) || 0) * 0.7
      + (Number(stats.winners) || 0) * 1.2
      + (Number(stats.aces) || 0) * 1.5
      + (Number(stats.saves) || 0) * 0.6
      - (Number(stats.errors) || 0) * 0.8
  }
  return 0
}

function getPerfBonus(myStats, allResults, sport, athleteOpenid) {
  if (!sport || !myStats) return 0
  const scores = (allResults || [])
    .filter(r => r.openid !== athleteOpenid && r.attended !== false && r.stats)
    .map(r => calcStatScore(r.stats, sport))
  if (scores.length === 0) return 0
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  if (avg <= 0) return 0
  const ratio = calcStatScore(myStats, sport) / avg
  return Math.min(Math.max((ratio - 1) * 0.25, 0), 0.25)
}

const TIER_THRESHOLDS = [
  ['S+', 1200], ['S', 1040],
  ['A+', 880],  ['A', 720],
  ['B+', 560],  ['B', 400],
  ['C+', 300],  ['C', 200],
  ['D+', 100],  ['D', 0]
]

function getTier(score) {
  for (const [tier, threshold] of TIER_THRESHOLDS) {
    if (score >= threshold) return tier
  }
  return 'D'
}

exports.main = async (event, context) => {
  const { athleteOpenid } = event

  try {
    const athleteRes = await db.collection('athletes')
      .where({ openid: athleteOpenid }).limit(1).get()
    if (!athleteRes.data.length) return { code: -1, msg: '运动员不存在' }
    const athlete = athleteRes.data[0] || {}
    const initialCompetitionScore = Number(athlete.initialCompetitionScore) || 0

    // 查询所有含该球员的成绩记录
    let allDocs = []
    try {
      const res = await db.collection('eventResults')
        .where({ results: db.command.elemMatch({ openid: athleteOpenid }) })
        .orderBy('submittedAt', 'desc')
        .limit(200).get()
      allDocs = res.data
    } catch (e) {}

    const currentSeason = getSeasonId()
    const prevSeason = getPrevSeasonId(currentSeason)

    let currentPts = 0
    let prevPts = 0

    for (const doc of allDocs) {
      const athleteResult = (doc.results || []).find(r => r.openid === athleteOpenid)
      if (!athleteResult || athleteResult.attended === false) continue

      const season = getSeasonId(doc.submittedAt || null)
      const totalAttended = (doc.results || []).filter(r => r.attended !== false).length
      const bonus = getPerfBonus(athleteResult.stats, doc.results, doc.sport, athleteOpenid)
      const pts = Math.round(calcPoints(athleteResult.rank, totalAttended) * (1 + bonus))

      if (season === currentSeason) currentPts += pts
      else if (season === prevSeason) prevPts += pts
    }

    // 当前赛季 + 上赛季70%继承
    const totalScore = initialCompetitionScore + currentPts + Math.round(prevPts * 0.7)
    const tier = getTier(totalScore)

    await db.collection('athletes').where({ openid: athleteOpenid }).update({
      data: { currentTier: tier, competitionScore: totalScore, currentSeasonScore: initialCompetitionScore + currentPts }
    })

    await cloud.callFunction({ name: 'calcMarketValue', data: { athleteOpenid } })

    return { code: 0, tier, totalScore }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
