const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function hash(str) {
  return String(str || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
}

function pick(list, seed, fallback = null) {
  if (!list || list.length === 0) return fallback
  return list[Math.abs(seed) % list.length]
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
  return (teams || []).map(team => ({
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

function recalcLeaderboards(openTournament) {
  const statMatches = (openTournament.matches || []).concat(openTournament.knockoutMatches || [])
  if (openTournament.sport === 'basketball') {
    const points = {}
    const rebounds = {}
    const assists = {}
    statMatches.forEach(match => {
      ;(((match.basketball || {}).playerStats) || []).forEach(stat => {
        addStat(points, stat, Number(stat.points) || 0)
        addStat(rebounds, stat, Number(stat.rebounds) || 0)
        addStat(assists, stat, Number(stat.assists) || 0)
      })
    })
    const rank = map => Object.values(map).sort((a, b) => b.value - a.value).slice(0, 50)
    return { basketball: { points: rank(points), rebounds: rank(rebounds), assists: rank(assists) } }
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
  const cards = {}
  statMatches.forEach(match => {
    ;(((match.football || {}).events) || []).forEach(event => {
      if (event.type === 'goal') addStat(goals, event, 1)
      if (event.type === 'assist') addStat(assists, event, 1)
      if (event.type === 'yellow_card' || event.type === 'red_card') addStat(cards, event, event.type === 'red_card' ? 2 : 1)
    })
  })
  const rank = map => Object.values(map).sort((a, b) => b.value - a.value).slice(0, 50)
  return { football: { goals: rank(goals), assists: rank(assists), cards: rank(cards) } }
}

function getTeam(openTournament, teamId, teamName) {
  return (openTournament.teams || []).find(team => team.teamId === teamId) || { teamId, teamName, roster: [] }
}

function makeFootballEvents(match, openTournament, homeScore, awayScore, seed) {
  const home = getTeam(openTournament, match.home_team_id, match.home_team_name)
  const away = getTeam(openTournament, match.away_team_id, match.away_team_name)
  const events = []

  const addGoal = (team, minuteSeed) => {
    const roster = team.roster || []
    const scorer = pick(roster, minuteSeed, { openid: `${team.teamId}_p1`, name: `${team.teamName}球员` })
    const assister = pick(roster.filter(p => p.openid !== scorer.openid), minuteSeed + 3, null)
    events.push({
      type: 'goal',
      typeLabel: '进球',
      teamId: team.teamId,
      teamName: team.teamName,
      playerOpenid: scorer.openid,
      playerName: scorer.name,
      minute: 8 + ((minuteSeed * 7) % 82)
    })
    if (assister) {
      events.push({
        type: 'assist',
        typeLabel: '助攻',
        teamId: team.teamId,
        teamName: team.teamName,
        playerOpenid: assister.openid,
        playerName: assister.name,
        minute: 8 + ((minuteSeed * 7) % 82)
      })
    }
  }

  for (let i = 0; i < homeScore; i += 1) addGoal(home, seed + i + 1)
  for (let i = 0; i < awayScore; i += 1) addGoal(away, seed + i + 11)

  ;[home, away].forEach((team, index) => {
    const roster = team.roster || []
    const player = pick(roster, seed + index + 21, null)
    if (player && (seed + index) % 3 === 0) {
      events.push({
        type: 'yellow_card',
        typeLabel: '黄牌',
        teamId: team.teamId,
        teamName: team.teamName,
        playerOpenid: player.openid,
        playerName: player.name,
        minute: 30 + ((seed + index * 9) % 50)
      })
    }
  })

  return events.sort((a, b) => a.minute - b.minute)
}

function simulateFootballMatch(match, openTournament, forceWinner = false) {
  const seed = hash(match.matchId)
  let homeScore = seed % 5
  let awayScore = Math.floor(seed / 3) % 5
  if (forceWinner && homeScore === awayScore) homeScore += 1
  return {
    ...match,
    status: 'finished',
    football: {
      homeScore,
      awayScore,
      events: makeFootballEvents(match, openTournament, homeScore, awayScore, seed)
    }
  }
}

function splitQuarterTotal(total, seed) {
  const q1 = Math.max(8, Math.floor(total * 0.24) + (seed % 5) - 2)
  const q2 = Math.max(8, Math.floor(total * 0.25) + (seed % 3) - 1)
  const q3 = Math.max(8, Math.floor(total * 0.24) + (seed % 4) - 1)
  const q4 = Math.max(0, total - q1 - q2 - q3)
  return [q1, q2, q3, q4]
}

function makeBasketballStats(match, openTournament, homeScore, awayScore, seed) {
  const teams = [
    getTeam(openTournament, match.home_team_id, match.home_team_name),
    getTeam(openTournament, match.away_team_id, match.away_team_name)
  ]
  const totals = [homeScore, awayScore]
  const stats = []
  teams.forEach((team, teamIndex) => {
    const roster = (team.roster || []).slice(0, 8)
    const total = totals[teamIndex]
    roster.forEach((player, index) => {
      const weight = Math.max(1, roster.length - index)
      stats.push({
        teamId: team.teamId,
        playerOpenid: player.openid,
        playerName: player.name,
        points: Math.max(0, Math.round(total * weight / (roster.length * 4)) + ((seed + index) % 7)),
        rebounds: 1 + ((seed + index * 2) % 11),
        assists: (seed + index * 3) % 8
      })
    })
  })
  return stats
}

function simulateBasketballMatch(match, openTournament, forceWinner = false) {
  const seed = hash(match.matchId)
  let homeScore = 58 + (seed % 42)
  let awayScore = 56 + (Math.floor(seed / 5) % 42)
  if (forceWinner && homeScore === awayScore) homeScore += 1
  const homeQuarters = splitQuarterTotal(homeScore, seed)
  const awayQuarters = splitQuarterTotal(awayScore, seed + 17)
  return {
    ...match,
    status: 'finished',
    basketball: {
      quarters: homeQuarters.map((home, index) => ({ home, away: awayQuarters[index] })),
      homeScore,
      awayScore,
      playerStats: makeBasketballStats(match, openTournament, homeScore, awayScore, seed)
    }
  }
}

function simulateBadmintonMatch(match, forceWinner = false) {
  const seed = hash(match.matchId)
  let homeScore = seed % 3
  let awayScore = Math.floor(seed / 5) % 3
  if (forceWinner && homeScore === awayScore) homeScore = Math.min(2, homeScore + 1)
  return {
    ...match,
    status: 'finished',
    badminton: {
      homeScore,
      awayScore,
      playerStats: []
    }
  }
}

function simulateMatch(match, openTournament, forceWinner = false) {
  if ((openTournament.sport || 'football') === 'basketball') {
    return simulateBasketballMatch(match, openTournament, forceWinner)
  }
  if (openTournament.sport === 'badminton') {
    return simulateBadmintonMatch(match, forceWinner)
  }
  return simulateFootballMatch(match, openTournament, forceWinner)
}

function roundName(count) {
  if (count === 2) return '决赛'
  if (count === 4) return '半决赛'
  if (count === 8) return '1/4决赛'
  if (count === 16) return '1/8决赛'
  return `淘汰赛${count}强`
}

function makeKnockoutMatch({ roundIndex, order, roundLabel, home, away, sport, bracketId = '', bracketName = '' }) {
  return {
    matchId: `ko-${bracketId || 'main'}-r${roundIndex}-${order}-${home.teamId}-${away.teamId}`,
    stage: 'knockout',
    bracketId,
    bracketName,
    roundIndex,
    roundLabel,
    order,
    home_team_id: home.teamId,
    away_team_id: away.teamId,
    home_team_name: home.teamName,
    away_team_name: away.teamName,
    match_time: '',
    venue: '',
    status: 'not_started',
    football: { homeScore: null, awayScore: null, events: [] },
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

function winnerOf(match, sport) {
  const score = scoreOf(match, sport)
  if (score.home >= score.away) {
    return { teamId: match.home_team_id, teamName: match.home_team_name }
  }
  return { teamId: match.away_team_id, teamName: match.away_team_name }
}

function buildFirstKnockout(openTournament, advancePerGroup) {
  if (openTournament.format !== 'cup_groups') return []
  const standings = openTournament.standings || {}
  const qualifiers = []
  ;(openTournament.groups || []).forEach(group => {
    const rows = (standings[group.groupId] || []).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999))
    rows.slice(0, advancePerGroup).forEach(row => {
      qualifiers.push({ teamId: row.teamId, teamName: row.teamName, groupId: group.groupId, rank: row.rank })
    })
  })
  if (qualifiers.length < 2) return []

  const seeded = qualifiers.sort((a, b) => {
    if ((a.rank || 99) !== (b.rank || 99)) return (a.rank || 99) - (b.rank || 99)
    return String(a.groupId).localeCompare(String(b.groupId))
  })
  const bracketSize = Math.pow(2, Math.floor(Math.log2(seeded.length)))
  if (bracketSize < 2) return []
  const bracketTeams = seeded.slice(0, bracketSize)
  const firstHalf = bracketTeams.slice(0, bracketTeams.length / 2)
  const secondHalf = bracketTeams.slice(bracketTeams.length / 2).reverse()
  const roundLabel = roundName(bracketTeams.length)
  return firstHalf.map((home, index) => makeKnockoutMatch({
    roundIndex: 1,
    order: index + 1,
    roundLabel,
    home,
    away: secondHalf[index],
    sport: openTournament.sport || 'football'
  }))
}

function buildSplitFirstKnockouts(openTournament) {
  if (openTournament.format !== 'cup_groups') return []
  const standings = openTournament.standings || {}
  const saved = ((openTournament.knockout || {}).brackets) || []
  const brackets = [
    { bracketId: 'upper', name: (saved.find(b => b.bracketId === 'upper') || {}).name || '淘汰赛一', qualifierRanks: [1, 2] },
    { bracketId: 'lower', name: (saved.find(b => b.bracketId === 'lower') || {}).name || '淘汰赛二', qualifierRanks: [3, 4] }
  ]
  return brackets.map(bracket => {
    const qualifiers = []
    ;(openTournament.groups || []).forEach(group => {
      const rows = (standings[group.groupId] || []).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999))
      rows
        .filter(row => (row.rank || 999) >= bracket.qualifierRanks[0] && (row.rank || 999) <= bracket.qualifierRanks[1])
        .forEach(row => qualifiers.push({ teamId: row.teamId, teamName: row.teamName, groupId: group.groupId, rank: row.rank }))
    })
    const seeded = qualifiers.sort((a, b) => {
      if ((a.rank || 99) !== (b.rank || 99)) return (a.rank || 99) - (b.rank || 99)
      return String(a.groupId).localeCompare(String(b.groupId))
    })
    if (seeded.length < 2 || seeded.length % 2 !== 0) return { ...bracket, matches: [] }
    const firstHalf = seeded.slice(0, seeded.length / 2)
    const secondHalf = seeded.slice(seeded.length / 2).reverse()
    const roundLabel = roundName(seeded.length)
    return {
      ...bracket,
      matches: firstHalf.map((home, index) => makeKnockoutMatch({
        roundIndex: 1,
        order: index + 1,
        roundLabel,
        home,
        away: secondHalf[index],
        sport: openTournament.sport || 'football',
        bracketId: bracket.bracketId,
        bracketName: bracket.name
      }))
    }
  })
}

function simulateKnockout(openTournament, firstRoundMatches, bracketMeta = null) {
  const sport = openTournament.sport || 'football'
  const all = []
  let roundIndex = 1
  let current = firstRoundMatches.slice()

  while (current.length > 0) {
    const finished = current.map(match => {
      const next = simulateMatch(match, openTournament, true)
      const winner = winnerOf(next, sport)
      next.winner_team_id = winner.teamId
      next.winner_team_name = winner.teamName
      return next
    })
    all.push(...finished)
    const winners = finished.map(match => ({ teamId: match.winner_team_id, teamName: match.winner_team_name }))
    if (winners.length <= 1) {
      openTournament.knockout = {
        ...(openTournament.knockout || {}),
        status: 'complete',
        completedAt: db.serverDate()
      }
      if (bracketMeta) {
        const existing = openTournament.knockout.brackets || []
        const updated = {
          bracketId: bracketMeta.bracketId,
          name: bracketMeta.name,
          qualifierRanks: bracketMeta.qualifierRanks,
          status: 'complete',
          championTeamId: winners[0] ? winners[0].teamId : '',
          championTeamName: winners[0] ? winners[0].teamName : ''
        }
        openTournament.knockout.mode = 'split'
        openTournament.knockout.brackets = existing.length
          ? existing.map(bracket => bracket.bracketId === updated.bracketId ? { ...bracket, ...updated } : bracket)
          : [updated]
      } else {
        openTournament.knockout.championTeamId = winners[0] ? winners[0].teamId : ''
        openTournament.knockout.championTeamName = winners[0] ? winners[0].teamName : ''
      }
      break
    }
    roundIndex += 1
    const roundLabel = roundName(winners.length)
    current = []
    for (let i = 0; i < winners.length; i += 2) {
      current.push(makeKnockoutMatch({
        roundIndex,
        order: (i / 2) + 1,
        roundLabel,
        home: winners[i],
        away: winners[i + 1],
        sport,
        bracketId: bracketMeta ? bracketMeta.bracketId : '',
        bracketName: bracketMeta ? bracketMeta.name : ''
      }))
    }
  }

  return all
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { tournamentId, advancePerGroup = 2, includeKnockout = true, mode = '' } = event || {}
  if (!tournamentId) return { code: -1, msg: 'tournamentId 缺失' }

  try {
    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(tournamentId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    if (!post || post.postType !== 'event') return { code: -1, msg: '公开赛不存在' }
    if (!isAdmin && post.openid !== OPENID) return { code: -1, msg: '无权限模拟赛果' }

    const openTournament = post.openTournament || {}
    if (!Array.isArray(openTournament.matches) || openTournament.matches.length === 0) {
      return { code: -1, msg: '请先生成赛程' }
    }

    openTournament.matches = openTournament.matches.map(match => simulateMatch(match, openTournament, false))
    openTournament.standings = recalcStandings(openTournament)

    if (includeKnockout && openTournament.format === 'cup_groups') {
      const hasSplitMatches = (openTournament.knockoutMatches || []).some(match => match.bracketId)
      const shouldSimulateSplit = mode === 'split_knockout' ||
        openTournament.playoffMode === 'split_knockout' ||
        ((openTournament.knockout || {}).mode === 'split') ||
        hasSplitMatches
      if (shouldSimulateSplit) {
        openTournament.playoffMode = 'split_knockout'
        const split = buildSplitFirstKnockouts(openTournament)
        let allKnockout = []
        openTournament.knockout = {
          ...(openTournament.knockout || {}),
          mode: 'split',
          status: 'active',
          brackets: split.map(item => ({
            bracketId: item.bracketId,
            name: item.name,
            qualifierRanks: item.qualifierRanks,
            status: 'draft',
            championTeamId: '',
            championTeamName: ''
          }))
        }
        split.forEach(item => {
          if (item.matches.length > 0) {
            allKnockout = allKnockout.concat(simulateKnockout(openTournament, item.matches, item))
          }
        })
        openTournament.knockoutMatches = allKnockout
        if ((openTournament.knockout.brackets || []).every(bracket => bracket.status === 'complete')) {
          openTournament.knockout.status = 'complete'
        }
      } else {
      const firstRound = buildFirstKnockout(openTournament, Math.max(1, Math.min(Number(advancePerGroup) || 2, 4)))
      if (firstRound.length > 0) {
        openTournament.knockoutMatches = simulateKnockout(openTournament, firstRound)
      }
      }
    } else if (Array.isArray(openTournament.knockoutMatches) && openTournament.knockoutMatches.length > 0) {
      openTournament.knockoutMatches = openTournament.knockoutMatches.map(match => simulateMatch(match, openTournament, true))
    }

    openTournament.leaderboards = recalcLeaderboards(openTournament)
    openTournament.status = openTournament.knockout && openTournament.knockout.status === 'complete' ? 'complete' : 'results_simulated'
    openTournament.updatedAt = db.serverDate()

    await db.collection('posts').doc(tournamentId).update({
      data: { openTournament, updatedAt: db.serverDate() }
    })

    return {
      code: 0,
      msg: '模拟赛果已生成',
      matchCount: openTournament.matches.length,
      knockoutCount: (openTournament.knockoutMatches || []).length,
      champion: openTournament.knockout ? openTournament.knockout.championTeamName || '' : '',
      openTournament
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
