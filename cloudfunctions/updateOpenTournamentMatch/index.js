const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollection(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist')
}

async function getEventAdmin(postId, openid) {
  try {
    const res = await db.collection('eventAdmins')
      .where({ postId, adminOpenid: openid, status: 'accepted' })
      .limit(1)
      .get()
    return (res.data || [])[0] || null
  } catch (e) {
    if (isMissingCollection(e)) return null
    throw e
  }
}

function scoreOf(match, sport) {
  if (sport === 'basketball') {
    return {
      home: Number(match.basketball && match.basketball.homeScore),
      away: Number(match.basketball && match.basketball.awayScore)
    }
  }
  if (sport === 'badminton') {
    return {
      home: Number(match.badminton && match.badminton.homeScore),
      away: Number(match.badminton && match.badminton.awayScore)
    }
  }
  return {
    home: Number(match.football && match.football.homeScore),
    away: Number(match.football && match.football.awayScore)
  }
}

function createRows(teams) {
  return teams.map(team => ({
    rank: 0,
    teamId: team.teamId,
    teamName: team.teamName,
    played: 0,
    win: 0,
    draw: 0,
    loss: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    diff: 0,
    points: 0
  }))
}

function sortRows(rows) {
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.diff !== a.diff) return b.diff - a.diff
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
    return a.teamName.localeCompare(b.teamName, 'zh-Hans-CN')
  })
  rows.forEach((row, index) => { row.rank = index + 1 })
  return rows
}

function recalcStandings(openTournament) {
  const sport = openTournament.sport || 'football'
  const table = {}
  if (openTournament.format === 'cup_groups') {
    ;(openTournament.groups || []).forEach(group => {
      const teams = (openTournament.teams || []).filter(team => (group.teamIds || []).includes(team.teamId))
      table[group.groupId] = createRows(teams)
    })
    ;(openTournament.stage2Groups || []).forEach(group => {
      const teams = (openTournament.teams || []).filter(team => (group.teamIds || []).includes(team.teamId))
      table[group.groupId] = createRows(teams)
    })
  } else {
    table.league = createRows(openTournament.teams || [])
  }

  ;(openTournament.matches || []).forEach(match => {
    if (match.status !== 'finished') return
    const score = scoreOf(match, sport)
    if (!Number.isFinite(score.home) || !Number.isFinite(score.away)) return
    const key = match.group_id || 'league'
    const rows = table[key] || []
    const home = rows.find(row => row.teamId === match.home_team_id)
    const away = rows.find(row => row.teamId === match.away_team_id)
    if (!home || !away) return

    home.played += 1
    away.played += 1
    home.pointsFor += score.home
    home.pointsAgainst += score.away
    away.pointsFor += score.away
    away.pointsAgainst += score.home

    if (score.home > score.away) {
      home.win += 1
      away.loss += 1
      home.points += 3
    } else if (score.away > score.home) {
      away.win += 1
      home.loss += 1
      away.points += 3
    } else {
      home.draw += 1
      away.draw += 1
      home.points += 1
      away.points += 1
    }
    home.diff = home.pointsFor - home.pointsAgainst
    away.diff = away.pointsFor - away.pointsAgainst
  })

  Object.keys(table).forEach(key => { table[key] = sortRows(table[key]) })
  return table
}

function addStat(map, event, field) {
  const id = event.playerOpenid
  if (!id) return
  if (!map[id]) {
    map[id] = { playerOpenid: id, playerName: event.playerName || '未命名球员', teamId: event.teamId, value: 0 }
  }
  map[id].value += field
}

function eventCount(event = {}) {
  const count = Math.floor(Number(event.count) || 1)
  return count > 0 ? count : 1
}

function recalcLeaderboards(openTournament) {
  const statMatches = (openTournament.matches || []).concat(openTournament.knockoutMatches || [])
  if (openTournament.sport === 'basketball') {
    const points = {}
    const rebounds = {}
    const assists = {}
    const turnovers = {}
    statMatches.forEach(match => {
      ;(((match.basketball || {}).playerStats) || []).forEach(stat => {
        addStat(points, stat, Number(stat.points) || 0)
        addStat(rebounds, stat, Number(stat.rebounds) || 0)
        addStat(assists, stat, Number(stat.assists) || 0)
        addStat(turnovers, stat, Number(stat.turnovers) || 0)
      })
    })
    const rank = map => Object.values(map).sort((a, b) => b.value - a.value).slice(0, 50)
    return { basketball: { points: rank(points), rebounds: rank(rebounds), assists: rank(assists), turnovers: rank(turnovers) } }
  }
  if (openTournament.sport === 'badminton') {
    const points = {}
    const winners = {}
    const aces = {}
    const saves = {}
    const errors = {}
    statMatches.forEach(match => {
      ;(((match.badminton || {}).playerStats) || []).forEach(stat => {
        addStat(points, stat, Number(stat.points) || 0)
        addStat(winners, stat, Number(stat.winners) || 0)
        addStat(aces, stat, Number(stat.aces) || 0)
        addStat(saves, stat, Number(stat.saves) || 0)
        addStat(errors, stat, Number(stat.errors) || 0)
      })
    })
    const rank = map => Object.values(map).sort((a, b) => b.value - a.value).slice(0, 50)
    return { badminton: { points: rank(points), winners: rank(winners), aces: rank(aces), saves: rank(saves), errors: rank(errors) } }
  }
  if (openTournament.sport !== 'football') return {}

  const goals = {}
  const assists = {}
  const shots = {}
  const dribbles = {}
  const throughBalls = {}
  const keyPasses = {}
  const tackles = {}
  const saves = {}
  const yellowCards = {}
  const redCards = {}
  statMatches.forEach(match => {
    ;(((match.football || {}).events) || []).forEach(event => {
      const count = eventCount(event)
      if (event.type === 'goal') addStat(goals, event, count)
      if (event.type === 'assist') addStat(assists, event, count)
      if (event.type === 'shot_on_target') addStat(shots, event, count)
      if (event.type === 'successful_dribble') addStat(dribbles, event, count)
      if (event.type === 'through_ball') addStat(throughBalls, event, count)
      if (event.type === 'key_pass') addStat(keyPasses, event, count)
      if (event.type === 'successful_tackle') addStat(tackles, event, count)
      if (event.type === 'save') addStat(saves, event, count)
      if (event.type === 'yellow_card') addStat(yellowCards, event, count)
      if (event.type === 'red_card') addStat(redCards, event, count)
    })
  })
  const rank = map => Object.values(map).sort((a, b) => b.value - a.value).slice(0, 50)
  return {
    football: {
      goals: rank(goals),
      assists: rank(assists),
      shots: rank(shots),
      dribbles: rank(dribbles),
      throughBalls: rank(throughBalls),
      keyPasses: rank(keyPasses),
      tackles: rank(tackles),
      saves: rank(saves),
      yellowCards: rank(yellowCards),
      redCards: rank(redCards)
    }
  }
}

function toNumOrNull(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function roundLabel(count) {
  if (count === 2) return '决赛'
  if (count === 4) return '半决赛'
  if (count === 8) return '1/4决赛'
  if (count === 16) return '1/8决赛'
  return `淘汰赛${count}强`
}

function normalizeKnockoutLabel(label) {
  if (label === '1/16决赛') return '16分之一'
  if (label === '1/8决赛') return '8分之一'
  if (label === '1/4决赛') return '4分之一'
  return label || '淘汰赛'
}

function getScoreWinner(match, sport) {
  if (match.status !== 'finished') return { ok: false, pending: true }
  const score = scoreOf(match, sport)
  if (!Number.isFinite(score.home) || !Number.isFinite(score.away)) return { ok: false, msg: '请先录入比分' }
  if (score.home === score.away) return { ok: false, msg: '淘汰赛必须分出胜负' }
  return {
    ok: true,
    teamId: score.home > score.away ? match.home_team_id : match.away_team_id,
    teamName: score.home > score.away ? match.home_team_name : match.away_team_name
  }
}

function makeKnockoutMatch({ roundIndex, order, home, away, sport, bracketId = '', bracketName = '' }) {
  return {
    matchId: `ko-${bracketId || 'main'}-r${roundIndex}-${order}-${home.teamId}-${away.teamId}`,
    stage: 'knockout',
    bracketId,
    bracketName,
    roundIndex,
    roundLabel: roundLabel(Math.pow(2, Math.ceil(Math.log2(order * 2)))),
    order,
    home_team_id: home.teamId,
    away_team_id: away.teamId,
    home_team_name: home.teamName,
    away_team_name: away.teamName,
    match_time: '',
    venue: '',
    status: 'not_started',
    football: { homeScore: null, awayScore: null, events: [], playerDetails: [] },
    badminton: sport === 'badminton' ? { homeScore: null, awayScore: null, playerStats: [] } : undefined,
    basketball: sport === 'basketball'
      ? {
          quarters: [{ home: null, away: null }, { home: null, away: null }, { home: null, away: null }, { home: null, away: null }],
          homeScore: null,
          awayScore: null,
          playerStats: []
        }
      : undefined,
    winner_team_id: '',
    winner_team_name: ''
  }
}

function emptyScores(sport) {
  if (sport === 'basketball') {
    return {
      basketball: {
        quarters: [{ home: null, away: null }, { home: null, away: null }, { home: null, away: null }, { home: null, away: null }],
        homeScore: null,
        awayScore: null,
        playerStats: []
      }
    }
  }
  if (sport === 'badminton') {
    return {
      badminton: {
        homeScore: null,
        awayScore: null,
        playerStats: []
      }
    }
  }
  return {
    football: {
      homeScore: null,
      awayScore: null,
      events: [],
      playerDetails: []
    }
  }
}

function teamPayload(openTournament, teamId, fallbackName) {
  const team = (openTournament.teams || []).find(item => item.teamId === teamId)
  if (!team && teamId) return { teamId, teamName: fallbackName || '未命名队伍' }
  return team ? { teamId: team.teamId, teamName: team.teamName || team.name || '未命名队伍' } : null
}

function applyMatchPatch(match, patch, sport) {
  const teamChanged = !!(
    patch.home_team_id && patch.home_team_id !== match.home_team_id ||
    patch.away_team_id && patch.away_team_id !== match.away_team_id
  )
  const shouldResetScores = patch.resetScores || (teamChanged && patch.resetOnTeamChange !== false)
  const next = {
    ...match,
    home_team_id: patch.home_team_id || match.home_team_id,
    home_team_name: patch.home_team_name || match.home_team_name,
    away_team_id: patch.away_team_id || match.away_team_id,
    away_team_name: patch.away_team_name || match.away_team_name,
    match_time: patch.match_time || '',
    venue: patch.venue || '',
    status: shouldResetScores ? 'not_started' : (patch.status || 'not_started')
  }
  if (shouldResetScores) {
    Object.assign(next, emptyScores(sport))
    next.lineups = patch.lineups || { home: [], away: [] }
    next.substitutions = Array.isArray(patch.substitutions) ? patch.substitutions : []
    next.winner_team_id = ''
    next.winner_team_name = ''
    return next
  }
  if (sport === 'basketball') {
    const quarters = (patch.basketball && patch.basketball.quarters) || (next.basketball && next.basketball.quarters) || []
    const playerStats = (patch.basketball && patch.basketball.playerStats) || []
    const homeScore = quarters.reduce((sum, q) => sum + (Number(q.home) || 0), 0)
    const awayScore = quarters.reduce((sum, q) => sum + (Number(q.away) || 0), 0)
    next.basketball = { quarters, homeScore, awayScore, playerStats }
  } else if (sport === 'badminton') {
    next.badminton = {
      homeScore: toNumOrNull(patch.badminton && patch.badminton.homeScore),
      awayScore: toNumOrNull(patch.badminton && patch.badminton.awayScore),
      playerStats: (patch.badminton && patch.badminton.playerStats) || []
    }
  } else {
    next.football = {
      homeScore: toNumOrNull(patch.football && patch.football.homeScore),
      awayScore: toNumOrNull(patch.football && patch.football.awayScore),
      events: (patch.football && patch.football.events) || [],
      playerDetails: (patch.football && patch.football.playerDetails) || []
    }
  }
  next.lineups = patch.lineups || match.lineups || { home: [], away: [] }
  next.substitutions = Array.isArray(patch.substitutions) ? patch.substitutions : (match.substitutions || [])
  return next
}

function clearMatchScores(match, sport) {
  return {
    ...match,
    ...emptyScores(sport),
    status: 'not_started',
    winner_team_id: '',
    winner_team_name: ''
  }
}

function matchScopeOk(match, target = {}) {
  if (!target.stage || target.stage === 'all') return true
  if (target.stage === 'group') {
    if (match.stage === 'knockout') return false
    if (target.groupId && target.groupId !== 'all' && match.group_id !== target.groupId) return false
    if (target.roundNumber && target.roundNumber !== 'all' && String(match.round_number) !== String(target.roundNumber)) return false
    return true
  }
  if (target.stage === 'knockout') {
    if (match.stage !== 'knockout') return false
    if (target.roundLabel && target.roundLabel !== 'all' && normalizeKnockoutLabel(match.roundLabel) !== normalizeKnockoutLabel(target.roundLabel)) return false
    return true
  }
  return false
}

function applyBatchSchedule(openTournament, target, patch) {
  let count = 0
  const apply = match => {
    if (!matchScopeOk(match, target)) return match
    count += 1
    return {
      ...match,
      match_time: patch.match_time !== undefined ? patch.match_time : match.match_time,
      venue: patch.venue !== undefined ? patch.venue : match.venue,
      status: patch.status || match.status
    }
  }
  openTournament.matches = (openTournament.matches || []).map(apply)
  openTournament.knockoutMatches = (openTournament.knockoutMatches || []).map(apply)
  return count
}

function swapMatchSlots(openTournament, firstMatchId, secondMatchId) {
  const all = (openTournament.matches || []).concat(openTournament.knockoutMatches || [])
  const first = all.find(match => match.matchId === firstMatchId)
  const second = all.find(match => match.matchId === secondMatchId)
  if (!first || !second) throw new Error('请选择两场有效比赛')
  const firstSlot = { match_time: first.match_time || '', venue: first.venue || '' }
  const secondSlot = { match_time: second.match_time || '', venue: second.venue || '' }
  const swap = match => {
    if (match.matchId === firstMatchId) return { ...match, ...secondSlot }
    if (match.matchId === secondMatchId) return { ...match, ...firstSlot }
    return match
  }
  openTournament.matches = (openTournament.matches || []).map(swap)
  openTournament.knockoutMatches = (openTournament.knockoutMatches || []).map(swap)
}

function resetScoresByScope(openTournament, target) {
  const sport = openTournament.sport || 'football'
  let count = 0
  const reset = match => {
    if (!matchScopeOk(match, target)) return match
    count += 1
    return clearMatchScores(match, sport)
  }
  openTournament.matches = (openTournament.matches || []).map(reset)
  openTournament.knockoutMatches = (openTournament.knockoutMatches || []).map(reset)
  if (!target || !target.stage || target.stage === 'all' || target.stage === 'knockout') {
    openTournament.knockout = { ...(openTournament.knockout || {}), status: 'active' }
    delete openTournament.knockout.championTeamId
    delete openTournament.knockout.championTeamName
    if (Array.isArray(openTournament.knockout.brackets)) {
      openTournament.knockout.brackets = openTournament.knockout.brackets.map(bracket => ({
        ...bracket,
        status: 'active',
        championTeamId: '',
        championTeamName: ''
      }))
    }
  }
  return count
}

async function syncCompetitionScore(data) {
  try {
    const res = await cloud.callFunction({
      name: 'applyCompetitionScoreForMatch',
      data
    })
    const result = res.result || {}
    if (result.code !== 0) {
      return {
        ok: false,
        msg: result.msg || '积分同步失败',
        result
      }
    }
    return {
      ok: true,
      saved: Number(result.saved) || 0,
      affected: Number(result.affected) || 0,
      result
    }
  } catch (e) {
    return {
      ok: false,
      msg: (e && (e.message || e.errMsg)) || '积分同步失败'
    }
  }
}

function invalidateKnockout(openTournament, reason) {
  if (!openTournament.knockoutMatches || !openTournament.knockoutMatches.length) return
  openTournament.knockoutMatches = []
  openTournament.knockout = {
    ...(openTournament.knockout || {}),
    status: 'stale',
    staleReason: reason || '小组赛已调整，请重新生成淘汰赛'
  }
  delete openTournament.knockout.championTeamId
  delete openTournament.knockout.championTeamName
  if (Array.isArray(openTournament.knockout.brackets)) {
    openTournament.knockout.brackets = openTournament.knockout.brackets.map(bracket => ({
      ...bracket,
      status: 'stale',
      championTeamId: '',
      championTeamName: ''
    }))
  }
}

function invalidateSecondStage(openTournament, reason) {
  openTournament.matches = (openTournament.matches || []).filter(match => match.phase !== 'second_stage')
  delete openTournament.stage2Groups
  openTournament.secondStage = { ...(openTournament.secondStage || {}), status: 'pending', staleReason: reason || '首阶段赛果已调整，请重新生成胜者组和败者组' }
  invalidateKnockout(openTournament, reason)
}

function affectsKnockoutQualification(patch) {
  if (patch.affectsQualification !== undefined) return !!patch.affectsQualification
  return !!(
    patch.home_team_id ||
    patch.away_team_id ||
    patch.status ||
    patch.football ||
    patch.badminton ||
    patch.basketball ||
    patch.resetScores
  )
}

function advanceKnockout(openTournament, changedRoundIndex, bracketId = '') {
  const sport = openTournament.sport || 'football'
  let knockoutMatches = openTournament.knockoutMatches || []
  const knockout = openTournament.knockout || {}
  const bracketFilter = match => !bracketId || (match.bracketId || '') === bracketId
  const otherFilter = match => bracketId && (match.bracketId || '') !== bracketId
  const setBracketChampion = winner => {
    if (Array.isArray(knockout.brackets) && bracketId) {
      knockout.brackets = knockout.brackets.map(bracket => (
        bracket.bracketId === bracketId
          ? {
              ...bracket,
              status: 'complete',
              championTeamId: winner ? winner.teamId : '',
              championTeamName: winner ? winner.teamName : ''
            }
          : bracket
      ))
      knockout.status = knockout.brackets.every(bracket => bracket.status === 'complete') ? 'complete' : 'active'
      return
    }
    knockout.status = 'complete'
    knockout.championTeamId = winner ? winner.teamId : ''
    knockout.championTeamName = winner ? winner.teamName : ''
  }

  if (!knockoutMatches.length) return

  if (changedRoundIndex) {
    knockoutMatches = knockoutMatches.filter(match => otherFilter(match) || !match.roundIndex || match.roundIndex <= changedRoundIndex)
    if (Array.isArray(knockout.brackets) && bracketId) {
      knockout.brackets = knockout.brackets.map(bracket => (
        bracket.bracketId === bracketId
          ? { ...bracket, status: 'active', championTeamId: '', championTeamName: '' }
          : bracket
      ))
    } else {
      delete knockout.championTeamId
      delete knockout.championTeamName
    }
    knockout.status = 'active'
  }

  const bracketMatches = knockoutMatches.filter(bracketFilter)
  const roundIndexes = [...new Set(bracketMatches.map(match => match.roundIndex || 1))].sort((a, b) => a - b)
  const currentRoundIndex = roundIndexes[roundIndexes.length - 1]
  const current = bracketMatches
    .filter(match => (match.roundIndex || 1) === currentRoundIndex)
    .sort((a, b) => (a.order || 0) - (b.order || 0))

  const winners = []
  for (const match of current) {
    const winner = getScoreWinner(match, sport)
    if (match.status !== 'finished') {
      knockout.status = 'active'
      openTournament.knockout = knockout
      openTournament.knockoutMatches = knockoutMatches
      return
    }
    if (!winner.ok) throw new Error(winner.msg || '淘汰赛赛果异常')
    match.winner_team_id = winner.teamId
    match.winner_team_name = winner.teamName
    winners.push({ teamId: winner.teamId, teamName: winner.teamName })
  }

  if (winners.length === 1) {
    setBracketChampion(winners[0])
    knockout.completedAt = db.serverDate()
    openTournament.knockout = knockout
    openTournament.knockoutMatches = knockoutMatches
    return
  }

  const nextRoundIndex = currentRoundIndex + 1
  if (knockoutMatches.some(match => bracketFilter(match) && (match.roundIndex || 1) === nextRoundIndex)) {
    openTournament.knockout = knockout
    openTournament.knockoutMatches = knockoutMatches
    return
  }

  const nextRoundLabel = roundLabel(winners.length)
  const nextMatches = []
  for (let i = 0; i < winners.length; i += 2) {
    const match = makeKnockoutMatch({
      roundIndex: nextRoundIndex,
      order: (i / 2) + 1,
      home: winners[i],
      away: winners[i + 1],
      sport,
      bracketId,
      bracketName: current[0] ? current[0].bracketName || '' : ''
    })
    match.roundLabel = nextRoundLabel
    nextMatches.push(match)
  }

  knockout.status = 'active'
  openTournament.knockout = knockout
  openTournament.knockoutMatches = knockoutMatches.concat(nextMatches)
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { tournamentId, matchId, patch = {}, action = 'updateMatch' } = event
  if (!tournamentId) return { code: -1, msg: '参数缺失' }

  try {
    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(tournamentId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    if (!post || post.postType !== 'event') return { code: -1, msg: '公开赛不存在' }
    const eventAdmin = await getEventAdmin(tournamentId, OPENID)
    if (!isAdmin && post.openid !== OPENID && !eventAdmin) return { code: -1, msg: '无权限修改赛果' }

    const openTournament = post.openTournament
    if (!openTournament || !Array.isArray(openTournament.matches)) return { code: -1, msg: '赛程不存在' }

    if (action === 'batchUpdateSchedule') {
      const count = applyBatchSchedule(openTournament, event.target || {}, patch)
      openTournament.updatedAt = db.serverDate()
      await db.collection('posts').doc(tournamentId).update({
        data: { openTournament, updatedAt: db.serverDate() }
      })
      return { code: 0, msg: `已调整 ${count} 场比赛`, openTournament }
    }

    if (action === 'swapMatchSlots') {
      swapMatchSlots(openTournament, event.firstMatchId, event.secondMatchId)
      openTournament.updatedAt = db.serverDate()
      await db.collection('posts').doc(tournamentId).update({
        data: { openTournament, updatedAt: db.serverDate() }
      })
      return { code: 0, msg: '已交换两场比赛时间和场地', openTournament }
    }

    if (action === 'resetScores') {
      const count = resetScoresByScope(openTournament, event.target || { stage: 'all' })
      openTournament.standings = recalcStandings(openTournament)
      openTournament.leaderboards = recalcLeaderboards(openTournament)
      openTournament.updatedAt = db.serverDate()
      await db.collection('posts').doc(tournamentId).update({
        data: { openTournament, updatedAt: db.serverDate() }
      })
      const scoreSync = await syncCompetitionScore({ tournamentId, syncAll: true, recordedByOpenid: OPENID, sport: openTournament.sport })
      let cardSync = { code: -1, skipped: true, msg: '积分未同步，暂未同步卡包' }
      if (scoreSync.ok) {
        const cardRes = await cloud.callFunction({
          name: 'syncMatchCards',
          data: { sourceType: 'open_tournament_match', sourceId: tournamentId, syncAll: true, recordedByOpenid: OPENID }
        }).catch(e => ({ result: { code: -1, msg: e.message || '卡包同步失败' } }))
        cardSync = cardRes.result || cardSync
      }
      return { code: 0, msg: `已清空 ${count} 场比赛赛果`, openTournament, scoreSync, cardSync }
    }

    if (action === 'renameKnockoutBracket' || (!matchId && event.bracketId && event.name)) {
      const bracketId = event.bracketId || ''
      const name = String(event.name || '').trim().slice(0, 20)
      if (!bracketId || !name) return { code: -1, msg: '请填写淘汰赛名称' }
      const knockout = openTournament.knockout || {}
      if (!Array.isArray(knockout.brackets)) return { code: -1, msg: '当前赛制不支持分区命名' }
      knockout.brackets = knockout.brackets.map(bracket => (
        bracket.bracketId === bracketId ? { ...bracket, name } : bracket
      ))
      openTournament.knockout = knockout
      openTournament.knockoutMatches = (openTournament.knockoutMatches || []).map(match => (
        match.bracketId === bracketId ? { ...match, bracketName: name } : match
      ))
      openTournament.updatedAt = db.serverDate()
      await db.collection('posts').doc(tournamentId).update({
        data: { openTournament, updatedAt: db.serverDate() }
      })
      return { code: 0, msg: '淘汰赛名称已更新', openTournament }
    }

    if (!matchId) return { code: -1, msg: '比赛参数缺失' }

    const homeTeam = patch.home_team_id ? teamPayload(openTournament, patch.home_team_id, patch.home_team_name) : null
    const awayTeam = patch.away_team_id ? teamPayload(openTournament, patch.away_team_id, patch.away_team_name) : null
    if (patch.home_team_id && !homeTeam) return { code: -1, msg: '主队不存在' }
    if (patch.away_team_id && !awayTeam) return { code: -1, msg: '客队不存在' }
    if (homeTeam) {
      patch.home_team_id = homeTeam.teamId
      patch.home_team_name = homeTeam.teamName
    }
    if (awayTeam) {
      patch.away_team_id = awayTeam.teamId
      patch.away_team_name = awayTeam.teamName
    }

    let found = false
    let changedKnockoutRound = 0
    let changedKnockoutBracketId = ''
    let groupScheduleChanged = false
    const previousMatch = (openTournament.matches || []).concat(openTournament.knockoutMatches || [])
      .find(item => item.matchId === matchId) || null
    const lockResult = (next, before) => {
      if (next.status !== 'finished') {
        return { ...next, resultLocked: false }
      }
      return {
        ...next,
        resultLocked: true,
        resultRevision: (Number(before && before.resultRevision) || 0) + 1,
        resultLockedBy: OPENID,
        resultLockedAtMs: Date.now()
      }
    }
    openTournament.matches = openTournament.matches.map(match => {
      if (match.matchId !== matchId) return match
      found = true
      const finalHomeId = patch.home_team_id || match.home_team_id
      const finalAwayId = patch.away_team_id || match.away_team_id
      if (finalHomeId === finalAwayId) throw new Error('主客队不能相同')
      groupScheduleChanged = match.phase !== 'second_stage' && affectsKnockoutQualification(patch)
      return lockResult(applyMatchPatch(match, patch, openTournament.sport), match)
    })

    if (!found && Array.isArray(openTournament.knockoutMatches)) {
      openTournament.knockoutMatches = openTournament.knockoutMatches.map(match => {
        if (match.matchId !== matchId) return match
        found = true
        const finalHomeId = patch.home_team_id || match.home_team_id
        const finalAwayId = patch.away_team_id || match.away_team_id
        if (finalHomeId === finalAwayId) throw new Error('主客队不能相同')
        changedKnockoutRound = match.roundIndex || 1
        changedKnockoutBracketId = match.bracketId || ''
        const next = lockResult(applyMatchPatch(match, patch, openTournament.sport), match)
        if (next.status === 'finished') {
          const winner = getScoreWinner(next, openTournament.sport)
          if (!winner.ok) throw new Error(winner.msg || '淘汰赛必须分出胜负')
          next.winner_team_id = winner.teamId
          next.winner_team_name = winner.teamName
        } else {
          next.winner_team_id = ''
          next.winner_team_name = ''
        }
        return next
      })
    }
    if (!found) return { code: -1, msg: '比赛不存在' }

    if (changedKnockoutRound) {
      advanceKnockout(openTournament, changedKnockoutRound, changedKnockoutBracketId)
    }
    if (groupScheduleChanged) {
      if (openTournament.playoffMode === 'two_stage_split') invalidateSecondStage(openTournament, '首阶段赛程或赛果已调整，请重新生成胜者组和败者组')
      else invalidateKnockout(openTournament, '小组赛赛程或赛果已调整，请重新生成淘汰赛')
    } else if (previousMatch && previousMatch.phase === 'second_stage' && affectsKnockoutQualification(patch)) {
      invalidateKnockout(openTournament, '胜者组/败者组赛果已调整，请重新生成淘汰赛')
    }

    openTournament.standings = recalcStandings(openTournament)
    openTournament.leaderboards = recalcLeaderboards(openTournament)
    openTournament.updatedAt = db.serverDate()

    await db.collection('posts').doc(tournamentId).update({
      data: { openTournament, updatedAt: db.serverDate() }
    })

    const updatedMatch = (openTournament.matches || []).concat(openTournament.knockoutMatches || [])
      .find(item => item.matchId === matchId) || null
    const shouldSyncResult = !!(
      (previousMatch && previousMatch.status === 'finished') ||
      (updatedMatch && updatedMatch.status === 'finished')
    )
    if (shouldSyncResult) {
      await db.collection('matchResultAuditLogs').add({
        data: {
          postId: tournamentId,
          matchId,
          sourceType: 'open_tournament_match',
          revision: Number(updatedMatch && updatedMatch.resultRevision) || 1,
          changedByOpenid: OPENID,
          beforeMatch: previousMatch,
          afterMatch: updatedMatch,
          createdAt: db.serverDate()
        }
      }).catch(() => null)
    }

    // Drafts only need the match document updated. Running scoring and card
    // synchronization here makes an ordinary save exceed the default timeout.
    if (!shouldSyncResult) {
      return { code: 0, msg: '草稿已保存', openTournament }
    }

    // 赛果落库和积分/卡片结算拆成两次调用。结算会涉及多名球员和卡片，
    // 若放在同一个请求中，容易让已经保存的赛果被客户端误判为保存超时。
    return {
      code: 0,
      msg: '赛果已保存',
      openTournament,
      needsScoreSync: true,
      syncAll: !!(groupScheduleChanged || changedKnockoutRound)
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
