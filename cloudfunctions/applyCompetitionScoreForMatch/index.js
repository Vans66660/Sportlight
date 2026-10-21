const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

const TIER_THRESHOLDS = [
  ['S+', 1200], ['S', 1040],
  ['A+', 880], ['A', 720],
  ['B+', 560], ['B', 400],
  ['C+', 300], ['C', 200],
  ['D+', 100], ['D', 0]
]

const DEFAULT_FORMULA = {
  version: '2026-07-open-match-v1',
  intensityMin: 0.5,
  intensityMax: 1.5,
  tierCoefficients: {
    'S+': 1.8, S: 1.6,
    'A+': 1.4, A: 1.2,
    'B+': 1.0, B: 0.8,
    'C+': 0.6, C: 0.4,
    'D+': 0.2, D: 0
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
    detailCaps: {
      matchDeltaMin: -25,
      matchDeltaMax: 35
    },
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

function calcBasketballPricing(athlete = {}, tier) {
  const score = Number(athlete.competitionScore) || 100
  const activeTier = tier || athlete.currentTier || getBasketballTier(score)
  const guaranteedAppearanceFee = activeTier === 'S'
    ? BASKETBALL_BASE_PAY.S + Math.max(0, Math.floor((score - 850) / 50)) * 50
    : (BASKETBALL_BASE_PAY[activeTier] || BASKETBALL_BASE_PAY.D)
  const performanceBonus = BASKETBALL_PERFORMANCE_BONUS[activeTier] || BASKETBALL_PERFORMANCE_BONUS.D
  return {
    guaranteedAppearanceFee,
    performanceBonus,
    marketValue: guaranteedAppearanceFee + performanceBonus,
    basketballPriceOffset: guaranteedAppearanceFee - (BASKETBALL_BASE_PAY[activeTier] || BASKETBALL_BASE_PAY.D)
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

async function getFormula() {
  try {
    const res = await db.collection('platformSettings').doc('global').get()
    return deepMerge(DEFAULT_FORMULA, (res.data || {}).scoreFormula || {})
  } catch (e) {
    return DEFAULT_FORMULA
  }
}

function getTier(score) {
  const n = Number(score) || 0
  for (const [tier, threshold] of TIER_THRESHOLDS) {
    if (n >= threshold) return tier
  }
  return 'D'
}

function normSport(sport = '') {
  if (sport === 'basketball' || sport === '篮球') return 'basketball'
  if (sport === 'badminton' || sport === '羽毛球') return 'badminton'
  return 'football'
}

function getSeasonId(value) {
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

function scoreOf(match, sport) {
  if (sport === 'basketball') {
    return {
      home: Number((match.basketball || {}).homeScore),
      away: Number((match.basketball || {}).awayScore)
    }
  }
  if (sport === 'badminton') {
    return {
      home: Number((match.badminton || {}).homeScore),
      away: Number((match.badminton || {}).awayScore)
    }
  }
  return {
    home: Number((match.football || {}).homeScore),
    away: Number((match.football || {}).awayScore)
  }
}

function resultFor(teamSide, score) {
  if (score.home === score.away) return 'draw'
  const homeWin = score.home > score.away
  return teamSide === 'home'
    ? (homeWin ? 'win' : 'loss')
    : (homeWin ? 'loss' : 'win')
}

function getTeam(openTournament, teamId, fallbackName) {
  return (openTournament.teams || []).find(team => team.teamId === teamId) || {
    teamId,
    teamName: fallbackName || '未命名队伍',
    roster: []
  }
}

function playerName(player = {}) {
  return player.name || player.playerName || player.nickName || '未命名球员'
}

function rosterPlayer(team, openid) {
  return ((team || {}).roster || []).find(p => (p.openid || p.playerOpenid) === openid) || {}
}

function addParticipant(list, participant, minutes) {
  const openid = participant.openid || participant.playerOpenid
  if (!openid) return
  const existing = list.find(item => item.openid === openid)
  if (existing) {
    if (Number.isFinite(minutes) && minutes > 0) {
      existing.minutes = Math.max(Number(existing.minutes) || 0, minutes)
    }
    return
  }
  list.push({
    ...participant,
    openid,
    name: participant.name || participant.playerName || '未命名球员',
    minutes
  })
}

function collectFootballPlayers(match, openTournament, home, away, sport) {
  const lineups = match.lineups || {}
  // 当前赛事仅维护实际出场人员，不统计换人；每位已选球员默认全额出场。
  const homeParticipants = (lineups.home || []).filter(p => p.openid || p.playerOpenid)
  const awayParticipants = (lineups.away || []).filter(p => p.openid || p.playerOpenid)
  const hasConfirmedParticipants = homeParticipants.length || awayParticipants.length
  if (!hasConfirmedParticipants) {
    return [
      ...(home.roster || []).map(p => ({ ...p, openid: p.openid || p.playerOpenid, name: playerName(p), teamId: home.teamId, teamName: home.teamName, side: 'home' })),
      ...(away.roster || []).map(p => ({ ...p, openid: p.openid || p.playerOpenid, name: playerName(p), teamId: away.teamId, teamName: away.teamName, side: 'away' }))
    ].filter(p => p.openid)
  }

  const duration = standardMinutes(openTournament, sport)
  const players = []
  homeParticipants.forEach(p => {
    const openid = p.openid || p.playerOpenid
    const roster = rosterPlayer(home, openid)
    addParticipant(players, { ...roster, ...p, teamId: home.teamId, teamName: home.teamName, side: 'home' }, duration)
  })
  awayParticipants.forEach(p => {
    const openid = p.openid || p.playerOpenid
    const roster = rosterPlayer(away, openid)
    addParticipant(players, { ...roster, ...p, teamId: away.teamId, teamName: away.teamName, side: 'away' }, duration)
  })
  return players
}

function collectPlayers(match, openTournament, sport) {
  const home = getTeam(openTournament, match.home_team_id, match.home_team_name)
  const away = getTeam(openTournament, match.away_team_id, match.away_team_name)
  if (sport === 'basketball') {
    const stats = ((match.basketball || {}).playerStats || []).filter(s => s.playerOpenid)
    if (stats.length) {
      return stats.map(s => ({
        openid: s.playerOpenid,
        name: s.playerName || '未命名球员',
        teamId: s.teamId,
        teamName: s.teamId === home.teamId ? home.teamName : away.teamName,
        side: s.teamId === home.teamId ? 'home' : 'away',
        stats: s
      }))
    }
  }
  if (sport === 'badminton') {
    const stats = ((match.badminton || {}).playerStats || []).filter(s => s.playerOpenid)
    if (stats.length) {
      return stats.map(s => ({
        openid: s.playerOpenid,
        name: s.playerName || '未命名球员',
        teamId: s.teamId,
        teamName: s.teamId === home.teamId ? home.teamName : away.teamName,
        side: s.teamId === home.teamId ? 'home' : 'away',
        stats: s
      }))
    }
  }
  return collectFootballPlayers(match, openTournament, home, away, sport)
}

async function getAthleteMap(openids) {
  const map = {}
  const ids = [...new Set(openids.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 20) {
    const part = ids.slice(i, i + 20)
    const res = await db.collection('athletes').where({ openid: _.in(part) }).get()
    ;(res.data || []).forEach(a => { map[a.openid] = a })
  }
  return map
}

function tierCoeff(athlete, formula) {
  const tier = (athlete && athlete.currentTier) || getTier((athlete && athlete.competitionScore) || 0)
  return Number((formula.tierCoefficients || {})[tier]) || 0
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function eventCount(event = {}) {
  const count = Math.floor(Number(event.count) || 1)
  return count > 0 ? count : 1
}

function bucketScore(map, count) {
  const n = Number(count) || 0
  if (map[String(n)] !== undefined) return Number(map[String(n)]) || 0
  if (n >= 5 && map['5+'] !== undefined) return Number(map['5+']) || 0
  if (n >= 4 && map['4+'] !== undefined) return Number(map['4+']) || 0
  return 0
}

function combinePosition(main, secondary, formula) {
  const weights = (formula.football || {}).positionWeights || {}
  const primary = weights[main] || weights['后腰'] || { attack: 0.5, defense: 0.75, opportunity: 0.65 }
  const sub = secondary ? (weights[secondary] || primary) : primary
  const subRate = secondary ? 0.3 : 0
  const mainRate = 1 - subRate
  return {
    attack: primary.attack * mainRate + sub.attack * subRate,
    defense: primary.defense * mainRate + sub.defense * subRate,
    opportunity: primary.opportunity * mainRate + sub.opportunity * subRate
  }
}

function basketballPersonal(stats, formula) {
  const w = ((formula.basketball || {}).statWeights) || {}
  return num(stats.points) * num(w.points)
    + num(stats.rebounds) * num(w.rebounds)
    + num(stats.assists) * num(w.assists)
    + num(stats.steals) * num(w.steals)
    + num(stats.blocks) * num(w.blocks)
    + num(stats.turnovers) * num(w.turnovers)
}

function basketballEventTotals(stats = {}) {
  return {
    points: num(stats.points),
    rebounds: num(stats.rebounds),
    assists: num(stats.assists),
    steals: num(stats.steals),
    blocks: num(stats.blocks),
    turnovers: num(stats.turnovers)
  }
}

function badmintonPersonal(stats, formula) {
  const w = ((formula.badminton || {}).statWeights) || {}
  return num(stats.points) * num(w.points)
    + num(stats.winners) * num(w.winners)
    + num(stats.aces) * num(w.aces)
    + num(stats.saves) * num(w.saves)
    + num(stats.errors) * num(w.errors)
}

function badmintonEventTotals(stats = {}) {
  return {
    points: num(stats.points),
    winners: num(stats.winners),
    aces: num(stats.aces),
    saves: num(stats.saves),
    errors: num(stats.errors)
  }
}

function footballEventScore(player, match, formula) {
  const w = ((formula.football || {}).eventWeights) || {}
  return (((match.football || {}).events) || [])
    .filter(ev => ev.playerOpenid === player.openid)
    .reduce((sum, ev) => sum + num(w[ev.type]) * eventCount(ev), 0)
}

function footballEventTotals(player, match) {
  const totals = {
    goals: 0,
    assists: 0,
    shotsOnTarget: 0,
    successfulDribbles: 0,
    throughBalls: 0,
    keyPasses: 0,
    successfulTackles: 0,
    saves: 0,
    yellowCards: 0,
    redCards: 0
  }
  ;(((match || {}).football || {}).events || [])
    .filter(ev => (ev.playerOpenid || ev.openid) === player.openid)
    .forEach(ev => {
      const count = eventCount(ev)
      if (ev.type === 'goal') totals.goals += count
      if (ev.type === 'assist') totals.assists += count
      if (ev.type === 'shot_on_target') totals.shotsOnTarget += count
      if (ev.type === 'successful_dribble') totals.successfulDribbles += count
      if (ev.type === 'through_ball') totals.throughBalls += count
      if (ev.type === 'key_pass') totals.keyPasses += count
      if (ev.type === 'successful_tackle') totals.successfulTackles += count
      if (ev.type === 'save') totals.saves += count
      if (ev.type === 'yellow_card') totals.yellowCards += count
      if (ev.type === 'red_card') totals.redCards += count
    })
  return totals
}

function footballPersonal(player, athlete, match, score, formula) {
  const goalsFor = player.side === 'home' ? score.home : score.away
  const goalsAgainst = player.side === 'home' ? score.away : score.home
  const f = formula.football || {}
  const attackScore = bucketScore(f.teamAttackByGoals || {}, goalsFor)
  const defenseScore = bucketScore(f.teamDefenseByAgainst || {}, goalsAgainst)
  const pos = combinePosition((athlete || {}).position || player.position || '后腰', (athlete || {}).secondaryPosition || '', formula)
  const eventScore = footballEventScore(player, match, formula)
  const balance = 1 + (1 - num(pos.opportunity)) * num(f.balanceScale)
  return (attackScore * num(pos.attack) + defenseScore * num(pos.defense) + eventScore) * balance
}

function standardMinutes(openTournament, sport) {
  const rules = openTournament.matchRules || {}
  return Number(rules.matchDuration) || (sport === 'basketball' ? 40 : (sport === 'badminton' ? 60 : 90))
}

function playerMinutesRatio(player, match, openTournament, sport) {
  const minutes = Number(player.minutes || (player.stats && player.stats.minutes))
  if (!Number.isFinite(minutes) || minutes <= 0) return 1
  return clamp(minutes / standardMinutes(openTournament, sport), 0.15, 1)
}

function buildMatchTitle(match) {
  const stage = match.stage === 'knockout' ? (match.roundLabel || '淘汰赛') : (match.group_name || `第${match.round_number || '-'}轮`)
  return `${stage} · ${match.home_team_name || '主队'} vs ${match.away_team_name || '客队'}`
}

function computeLogs({ post, match, formula, recordedByOpenid = '', previousLogMap = {} }) {
  const openTournament = post.openTournament || {}
  const sport = normSport(openTournament.sport || post.sport)
  if (match.status !== 'finished') return []
  const score = scoreOf(match, sport)
  if (!Number.isFinite(score.home) || !Number.isFinite(score.away)) return []

  const players = collectPlayers(match, openTournament, sport)
  const openids = [...new Set(players.map(p => p.openid).filter(Boolean))]
  const now = Date.now()
  const matchTime = match.match_time || post.eventDate || ''
  const seasonId = openTournament.seasonId || post.seasonId || getSeasonId(matchTime || now)
  return getAthleteMap(openids).then(athleteMap => {
    const avgTier = players.length
      ? players.reduce((sum, p) => sum + tierCoeff(athleteMap[p.openid], formula), 0) / players.length
      : 0
    const seen = {}
    return players.filter(p => {
      if (seen[p.openid]) return false
      seen[p.openid] = true
      return true
    }).map(player => {
      const athlete = athleteMap[player.openid] || {}
      const scoreKey = `${post._id}_${match.matchId}_${player.openid}`
      const previousLog = previousLogMap[scoreKey.replace(/[^\w-]/g, '_')] || previousLogMap[scoreKey] || {}
      const snapshotScore = Number.isFinite(Number(previousLog.preMatchScore))
        ? Number(previousLog.preMatchScore)
        : Number(athlete.competitionScore || athlete.initialCompetitionScore || 0)
      const snapshotTier = previousLog.preMatchTier || athlete.currentTier || athlete.rank || getTier(snapshotScore)
      const playerCoeff = tierCoeff(athlete, formula)
      const intensity = clamp(1 - (playerCoeff - avgTier), Number(formula.intensityMin) || 0.5, Number(formula.intensityMax) || 1.5)
      const result = resultFor(player.side, score)
      const resultBase = sport === 'basketball'
        ? Number(((formula.basketball || {}).resultBase || {})[result === 'win' ? 'win' : 'loss']) || 0
        : (sport === 'badminton'
          ? Number(((formula.badminton || {}).resultBase || {})[result === 'win' ? 'win' : 'loss']) || 0
          : Number(((formula.football || {}).resultBase || {})[result]) || 0)
      const personalRaw = sport === 'basketball'
        ? basketballPersonal(player.stats || {}, formula)
        : (sport === 'badminton'
          ? badmintonPersonal(player.stats || {}, formula)
          : footballPersonal(player, athlete, match, score, formula))
      const resultFactor = Number((formula.resultPerformanceFactor || {})[result]) || 1
      const minutesRatio = playerMinutesRatio(player, match, openTournament, sport)
      const visibleResultScore = Math.round(resultBase * intensity * minutesRatio)
      const visiblePersonalScore = Math.round(personalRaw * resultFactor * intensity * minutesRatio)
      const caps = sport === 'basketball'
        ? ((formula.basketball || {}).detailCaps || {})
        : (sport === 'badminton' ? ((formula.badminton || {}).detailCaps || {}) : ((formula.football || {}).detailCaps || {}))
      const delta = Math.round(clamp(
        visibleResultScore + visiblePersonalScore,
        Number(caps.matchDeltaMin) || -25,
        Number(caps.matchDeltaMax) || 35
      ))
      const teamId = player.teamId
      const isHome = teamId === match.home_team_id
      const footballStats = sport === 'football' ? footballEventTotals(player, match) : null
      const basketballStats = sport === 'basketball' ? basketballEventTotals(player.stats || {}) : null
      const badmintonStats = sport === 'badminton' ? badmintonEventTotals(player.stats || {}) : null
      return {
        scoreKey,
        postId: post._id,
        matchId: match.matchId,
        seasonId,
        athleteOpenid: player.openid,
        athleteName: player.name || athlete.name || '未命名球员',
        sport,
        eventTitle: post.title || post.content || '公开赛',
        matchTitle: buildMatchTitle(match),
        matchTime: match.match_time || post.eventDate || '',
        teamId,
        teamName: player.teamName || '',
        opponentTeamId: isHome ? match.away_team_id : match.home_team_id,
        opponentTeamName: isHome ? match.away_team_name : match.home_team_name,
        result,
        visibleResultScore,
        visiblePersonalScore,
        footballStats,
        basketballStats,
        badmintonStats,
        delta,
        formulaVersion: formula.version,
        preMatchScore: snapshotScore,
        preMatchTier: snapshotTier,
        recordedByOpenid: recordedByOpenid || previousLog.recordedByOpenid || '',
        recordedAtMs: now,
        recordedAt: db.serverDate(),
        createdAtMs: previousLog.createdAtMs || now,
        updatedAt: db.serverDate()
      }
    })
  })
}

async function removeLogs(query) {
  try {
    const res = await db.collection('competitionScoreLogs').where(query).get()
    await Promise.all((res.data || []).map(doc => db.collection('competitionScoreLogs').doc(doc._id).remove()))
    return res.data || []
  } catch (e) {
    return []
  }
}

async function saveLogs(logs) {
  for (const log of logs) {
    await db.collection('competitionScoreLogs').doc(log.scoreKey.replace(/[^\w-]/g, '_')).set({ data: log })
  }
}

async function sumLogs(openid) {
  // 使用数据库聚合代替全量拉到内存计算
  try {
    const res = await db.collection('competitionScoreLogs')
      .aggregate()
      .match({ athleteOpenid: openid })
      .group({ _id: null, total: $.sum('$delta') })
      .end()
    const result = (res.list || [])[0] || {}
    return Number(result.total) || 0
  } catch (e) {
    // 聚合不可用时降级为分页拉取
    let all = []
    let skip = 0
    while (true) {
      const res = await db.collection('competitionScoreLogs').where({ athleteOpenid: openid }).skip(skip).limit(100).get()
      all = all.concat(res.data || [])
      if (!res.data || res.data.length < 100) break
      skip += 100
    }
    return all.reduce((sum, log) => sum + (Number(log.delta) || 0), 0)
  }
}

async function logCount(openid) {
  try {
    const res = await db.collection('competitionScoreLogs').where({ athleteOpenid: openid }).count()
    return Number(res.total) || 0
  } catch (e) {
    return 0
  }
}

async function sumSeasonLogs(openid, seasonId) {
  if (!seasonId) return 0
  let total = 0
  // 优先聚合已有 seasonId 的记录
  try {
    const res = await db.collection('competitionScoreLogs')
      .aggregate()
      .match({ athleteOpenid: openid, seasonId })
      .group({ _id: null, total: $.sum('$delta') })
      .end()
    total += Number((res.list || [])[0]?.total) || 0
  } catch (e) {
    // fallthrough: 聚合失败时走下面的全量兜底
  }

  // 兼容没有 seasonId 的历史记录（只有一次查询，不会分页循环）
  let legacyTotal = 0
  try {
    const legacyRes = await db.collection('competitionScoreLogs')
      .where({ athleteOpenid: openid, seasonId: _.exists(false) })
      .limit(100)
      .get()
    legacyTotal = (legacyRes.data || [])
      .filter(log => getSeasonId(log.matchTime || log.createdAtMs) === seasonId)
      .reduce((sum, log) => sum + (Number(log.delta) || 0), 0)
  } catch (e) {
    // 聚合失败 + 历史查询也失败时的兜底
    let all = []
    let skip = 0
    while (true) {
      const res = await db.collection('competitionScoreLogs').where({ athleteOpenid: openid }).skip(skip).limit(100).get()
      all = all.concat(res.data || [])
      if (!res.data || res.data.length < 100) break
      skip += 100
    }
    legacyTotal = all
      .filter(log => (log.seasonId || getSeasonId(log.matchTime || log.createdAtMs)) === seasonId)
      .reduce((sum, log) => sum + (Number(log.delta) || 0), 0)
  }

  return total + legacyTotal
}

async function updateMarketValue(athlete = {}, rank, sampleCount) {
  try {
    if (athlete.sport === '篮球' && athlete.basketballPricingVersion === 'basketball-bounty-v1') {
      return calcBasketballPricing(athlete, rank).marketValue
    }
    let value = RANK_VALUE[rank] || 0
    const reputation = athlete.reputation || 80
    if (reputation >= 95) value = Math.floor(value * 1.15)
    else if (reputation >= 85) value = Math.floor(value * 1.08)
    else if (reputation < 60) value = Math.floor(value * 0.85)
    else if (reputation < 70) value = Math.floor(value * 0.93)
    const samples = Number.isFinite(sampleCount) ? sampleCount : await logCount(athlete.openid)
    const sampleRate = samples >= 10 ? 1 : (samples >= 5 ? 0.9 : (samples >= 1 ? 0.8 : 0.6))
    value = Math.floor(value * sampleRate)
    return value
  } catch (e) {
    return RANK_VALUE[rank] || 0
  }
}

async function recalcAthletes(openids) {
  const ids = [...new Set(openids.filter(Boolean))]
  const currentSeasonId = getSeasonId()
  const recalcOne = async openid => {
    const athleteRes = await db.collection('athletes').where({ openid }).limit(1).get()
    const athlete = athleteRes.data[0] || {}
    const initialCompetitionScore = Number(athlete.initialCompetitionScore) || 0
    const [scoreDelta, currentSeasonScore, samples] = await Promise.all([
      sumLogs(openid),
      sumSeasonLogs(openid, currentSeasonId),
      logCount(openid)
    ])
    const totalScore = initialCompetitionScore + scoreDelta
    const isBasketball = athlete.sport === '篮球' && athlete.basketballPricingVersion === 'basketball-bounty-v1'
    let tier = getTier(totalScore)
    const basketballUpdates = {}
    if (isBasketball) {
      const scoreTier = getBasketballTier(totalScore)
      const hasApprovedS = athlete.currentTier === 'S' && athlete.sPromotionReviewStatus === 'approved'
      if (scoreTier === 'S') {
        // A 升 S 必须经过人工审核；已认证 S 在积分达标时可维持 S。
        tier = hasApprovedS ? 'S' : 'A'
        if (!hasApprovedS && athlete.levelReviewStatus === 'approved' && athlete.sPromotionReviewStatus !== 'pending') {
          basketballUpdates.sPromotionReviewStatus = 'pending'
          basketballUpdates.sPromotionReviewCreatedAt = db.serverDate()
          basketballUpdates.sPromotionRejectReason = ''
        }
      } else {
        tier = scoreTier
        if (athlete.currentTier === 'S' && scoreTier !== 'S') {
          basketballUpdates.sPromotionReviewStatus = 'demoted'
        }
      }
    }
    const pricing = isBasketball ? calcBasketballPricing({ ...athlete, competitionScore: totalScore }, tier) : {}
    const marketValue = isBasketball ? pricing.marketValue : await updateMarketValue({ ...athlete, openid, competitionScore: totalScore }, tier, samples)
    await db.collection('athletes').where({ openid }).update({
      data: {
        currentTier: tier,
        rank: tier,
        competitionScore: totalScore,
        currentSeasonScore,
        currentSeasonId,
        marketValue,
        ...pricing,
        ...basketballUpdates,
        updatedAt: db.serverDate()
      }
    })
  }

  // Two teams can contain dozens of players. A small concurrency pool avoids
  // both the previous serial timeout and excessive pressure on the database.
  const batchSize = 4
  for (let index = 0; index < ids.length; index += batchSize) {
    await Promise.all(ids.slice(index, index + batchSize).map(recalcOne))
  }
}

function allMatches(openTournament) {
  return (openTournament.matches || []).concat(openTournament.knockoutMatches || [])
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { tournamentId, matchId, syncAll = false, recordedByOpenid = '' } = event || {}
  if (!tournamentId) return { code: -1, msg: 'tournamentId 缺失' }

  try {
    const postRes = await db.collection('posts').doc(tournamentId).get()
    const post = postRes.data
    if (!post || !post.openTournament) return { code: -1, msg: '公开赛不存在' }
    post._id = post._id || tournamentId
    const formula = await getFormula()
    const matches = allMatches(post.openTournament)
    const targets = syncAll ? matches : matches.filter(m => m.matchId === matchId)
    if (!targets.length) return { code: -1, msg: '比赛不存在' }

    const affected = []
    const previousLogMap = {}
    let saved = 0
    if (syncAll) {
      const oldLogs = await removeLogs({ postId: tournamentId })
      oldLogs.forEach(log => affected.push(log.athleteOpenid))
      oldLogs.forEach(log => {
        const key = (log.scoreKey || log._id || '').replace(/[^\w-]/g, '_')
        if (key) previousLogMap[key] = log
      })
    }
    for (const match of targets) {
      if (!syncAll) {
        const oldLogs = await removeLogs({ postId: tournamentId, matchId: match.matchId })
        oldLogs.forEach(log => affected.push(log.athleteOpenid))
        oldLogs.forEach(log => {
          const key = (log.scoreKey || log._id || '').replace(/[^\w-]/g, '_')
          if (key) previousLogMap[key] = log
        })
      }
      const logs = await computeLogs({
        post,
        match,
        formula,
        recordedByOpenid: recordedByOpenid || OPENID || '',
        previousLogMap
      })
      logs.forEach(log => affected.push(log.athleteOpenid))
      await saveLogs(logs)
      saved += logs.length
    }
    await recalcAthletes(affected)
    return { code: 0, saved, affected: [...new Set(affected)].length }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
