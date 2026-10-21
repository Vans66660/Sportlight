const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function resultText(result) {
  if (result === 'win') return '胜'
  if (result === 'draw') return '平'
  if (result === 'loss') return '负'
  return '未知'
}

function sportText(sport) {
  if (sport === 'basketball') return '篮球'
  if (sport === 'badminton') return '羽毛球'
  if (sport === '篮球' || sport === '羽毛球' || sport === '足球') return sport
  return '足球'
}

function compactStats(stats = {}) {
  const value = (...keys) => {
    for (const key of keys) {
      if (stats[key] !== '' && stats[key] !== null && stats[key] !== undefined) return num(stats[key])
    }
    return 0
  }
  return {
    goals: value('goals', 'goal'),
    assists: value('assists', 'assist'),
    shotsOnTarget: value('shotsOnTarget', 'shots', 'shot_on_target'),
    successfulDribbles: value('successfulDribbles', 'dribbles', 'successful_dribble'),
    throughBalls: value('throughBalls', 'throughBall', 'through_ball'),
    keyPasses: value('keyPasses', 'keyPass', 'key_pass'),
    successfulTackles: value('successfulTackles', 'tackles', 'successful_tackle'),
    saves: value('saves', 'save', 'keeperSaves'),
    yellowCards: value('yellowCards', 'yellowCard', 'yellow_card'),
    redCards: value('redCards', 'redCard', 'red_card')
  }
}

function compactBadmintonStats(stats = {}) {
  return {
    points: num(stats.points),
    winners: num(stats.winners),
    aces: num(stats.aces),
    saves: num(stats.saves),
    errors: num(stats.errors)
  }
}

function compactBasketballStats(stats = {}) {
  return {
    points: num(stats.points),
    rebounds: num(stats.rebounds),
    assists: num(stats.assists),
    steals: num(stats.steals),
    blocks: num(stats.blocks),
    turnovers: num(stats.turnovers)
  }
}

function displayStatsFor(item) {
  if (item.sport === '篮球') {
    return [
      { label: '得分', value: item.basketballStats.points },
      { label: '篮板', value: item.basketballStats.rebounds },
      { label: '助攻', value: item.basketballStats.assists },
      { label: '抢断', value: item.basketballStats.steals },
      { label: '盖帽', value: item.basketballStats.blocks },
      { label: '失误', value: item.basketballStats.turnovers }
    ]
  }
  if (item.sport === '羽毛球') {
    return [
      { label: '得分', value: item.badmintonStats.points },
      { label: '制胜分', value: item.badmintonStats.winners },
      { label: '发球得分', value: item.badmintonStats.aces },
      { label: '救球', value: item.badmintonStats.saves },
      { label: '失误', value: item.badmintonStats.errors }
    ]
  }
  return [
    { label: '进球', value: item.footballStats.goals },
    { label: '助攻', value: item.footballStats.assists },
    { label: '射正', value: item.footballStats.shotsOnTarget },
    { label: '抢断', value: item.footballStats.successfulTackles },
    { label: '成功过人', value: item.footballStats.successfulDribbles },
    { label: '关键直塞', value: item.footballStats.throughBalls },
    { label: '关键传球', value: item.footballStats.keyPasses },
    { label: '扑救', value: item.footballStats.saves },
    { label: '黄牌', value: item.footballStats.yellowCards },
    { label: '红牌', value: item.footballStats.redCards }
  ]
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const athleteOpenid = (event && event.openid) || OPENID
  if (!athleteOpenid) return { code: -1, msg: 'openid 缺失' }

  try {
    const athleteRes = await db.collection('athletes')
      .where({ openid: athleteOpenid })
      .field({ sport: true })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    const profileSportRaw = ((athleteRes.data || [])[0] || {}).sport || ''
    const profileSport = profileSportRaw ? sportText(profileSportRaw) : ''

    const res = await db.collection('competitionScoreLogs')
      .where({ athleteOpenid })
      .orderBy('createdAtMs', 'desc')
      .limit(100)
      .get()

    const matches = (res.data || []).map(log => {
      const footballStats = compactStats(log.footballStats || {})
      const badmintonStats = compactBadmintonStats(log.badmintonStats || {})
      const basketballStats = compactBasketballStats(log.basketballStats || {})
      const delta = Math.round(num(log.delta))
      const item = {
        _id: log._id,
        postId: log.postId || '',
        matchId: log.matchId || '',
        eventTitle: log.eventTitle || '公开赛',
        matchTitle: log.matchTitle || '',
        matchTime: log.matchTime || '',
        sport: sportText(log.sport),
        result: log.result || '',
        resultText: resultText(log.result),
        teamName: log.teamName || '',
        opponentTeamName: log.opponentTeamName || '',
        resultScore: Math.round(num(log.visibleResultScore)),
        personalScore: Math.round(num(log.visiblePersonalScore)),
        delta,
        deltaText: `${delta >= 0 ? '+' : ''}${delta}`,
        footballStats,
        basketballStats,
        badmintonStats
      }
      item.displayStats = displayStatsFor(item)
      return item
    })

    const summary = matches.reduce((acc, item) => {
      acc.participations += 1
      if (item.result === 'win') acc.wins += 1
      acc.goals += item.footballStats.goals
      acc.assists += item.footballStats.assists
      acc.shotsOnTarget += item.footballStats.shotsOnTarget
      acc.successfulDribbles += item.footballStats.successfulDribbles
      acc.throughBalls += item.footballStats.throughBalls
      acc.keyPasses += item.footballStats.keyPasses
      acc.successfulTackles += item.footballStats.successfulTackles
      acc.saves += item.footballStats.saves
      acc.yellowCards += item.footballStats.yellowCards
      acc.redCards += item.footballStats.redCards
      acc.badmintonPoints += item.badmintonStats.points
      acc.badmintonWinners += item.badmintonStats.winners
      acc.badmintonAces += item.badmintonStats.aces
      acc.basketballPoints += item.basketballStats.points
      acc.basketballRebounds += item.basketballStats.rebounds
      acc.basketballAssists += item.basketballStats.assists
      acc.basketballSteals += item.basketballStats.steals
      acc.basketballBlocks += item.basketballStats.blocks
      acc.basketballTurnovers += item.basketballStats.turnovers
      return acc
    }, {
      participations: 0,
      wins: 0,
      goals: 0,
      assists: 0,
      shotsOnTarget: 0,
      successfulDribbles: 0,
      throughBalls: 0,
      keyPasses: 0,
      successfulTackles: 0,
      saves: 0,
      yellowCards: 0,
      redCards: 0,
      badmintonPoints: 0,
      badmintonWinners: 0,
      badmintonAces: 0,
      basketballPoints: 0,
      basketballRebounds: 0,
      basketballAssists: 0,
      basketballSteals: 0,
      basketballBlocks: 0,
      basketballTurnovers: 0
    })
    const sport = profileSport || (matches[0] && matches[0].sport) || '足球'
    summary.winRateLabel = summary.participations > 0 ? `${Math.round((summary.wins / summary.participations) * 100)}%` : '0%'

    return { code: 0, data: { sport, matches, summary } }
  } catch (e) {
    const msg = e && (e.message || e.errMsg || '')
    if (msg.includes('collection not exists') || msg.includes('DATABASE_COLLECTION_NOT_EXIST')) {
      return { code: 0, data: { sport: '足球', matches: [], summary: { participations: 0, wins: 0, goals: 0, assists: 0, badmintonPoints: 0, badmintonWinners: 0, winRateLabel: '0%' } } }
    }
    return { code: -1, msg: e.message }
  }
}
