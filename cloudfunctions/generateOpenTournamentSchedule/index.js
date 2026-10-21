const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function normalizeSport(sport) {
  if (sport === '篮球' || sport === 'basketball') return 'basketball'
  if (sport === '羽毛球' || sport === 'badminton') return 'badminton'
  return 'football'
}

function defaultMatchDuration(sport) {
  if (sport === 'basketball') return 40
  if (sport === 'badminton') return 60
  return 90
}

function defaultHalfDuration(sport) {
  if (sport === 'basketball') return 20
  if (sport === 'badminton') return 30
  return 45
}

function emptyLeaderboards(sport) {
  if (sport === 'basketball') return { basketball: { points: [], rebounds: [], assists: [], turnovers: [] } }
  if (sport === 'football') return { football: { goals: [], assists: [], cards: [] } }
  if (sport === 'badminton') return { badminton: { points: [], winners: [], aces: [], saves: [], errors: [] } }
  return {}
}

function mapTeam(reg) {
  return {
    teamId: reg._id,
    registrationId: reg._id,
    teamName: reg.teamName || '未命名队伍',
    captainOpenid: reg.captainOpenid || '',
    roster: (reg.members || []).filter(m => m && m.openid).map(m => ({
      openid: m.openid,
      name: m.name || '未命名球员',
      role: m.role || '',
      position: m.position || ''
    }))
  }
}

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

function makeMatch({ round, group, home, away, leg = 1 }) {
  return {
    matchId: `${group ? group.groupId : 'league'}-r${round}-${home.teamId}-${away.teamId}-l${leg}`,
    round_number: round,
    group_id: group ? group.groupId : null,
    group_name: group ? group.groupName : '',
    home_team_id: home.teamId,
    away_team_id: away.teamId,
    home_team_name: home.teamName,
    away_team_name: away.teamName,
    match_time: '',
    venue: '',
    status: 'not_started',
    football: { homeScore: null, awayScore: null, events: [] },
    badminton: { homeScore: null, awayScore: null, playerStats: [] },
    basketball: {
      quarters: [{ home: null, away: null }, { home: null, away: null }, { home: null, away: null }, { home: null, away: null }],
      homeScore: null,
      awayScore: null,
      playerStats: []
    }
  }
}

function roundRobin(teams, isDoubleLoop, group = null) {
  const list = teams.slice()
  if (list.length % 2 === 1) list.push({ teamId: '__bye__', teamName: '轮空' })
  const n = list.length
  const rounds = n - 1
  const half = n / 2
  const matches = []
  let rotation = list.slice()

  for (let round = 1; round <= rounds; round += 1) {
    for (let i = 0; i < half; i += 1) {
      const a = rotation[i]
      const b = rotation[n - 1 - i]
      if (a.teamId !== '__bye__' && b.teamId !== '__bye__') {
        const homeFirst = (round + i) % 2 === 0
        matches.push(makeMatch({
          round,
          group,
          home: homeFirst ? a : b,
          away: homeFirst ? b : a
        }))
      }
    }
    rotation = [rotation[0], rotation[n - 1], ...rotation.slice(1, n - 1)]
  }

  if (!isDoubleLoop) return matches
  return matches.concat(matches.map(match => makeMatch({
    round: match.round_number + rounds,
    group,
    home: { teamId: match.away_team_id, teamName: match.away_team_name },
    away: { teamId: match.home_team_id, teamName: match.home_team_name },
    leg: 2
  })))
}

function buildGroups(teams, groupCount) {
  const safeCount = Math.max(1, Number(groupCount) || 2)
  const groups = Array.from({ length: safeCount }, (_, index) => ({
    groupId: String.fromCharCode(65 + index),
    groupName: String.fromCharCode(65 + index),
    teamIds: []
  }))
  teams.forEach((team, index) => {
    groups[index % safeCount].teamIds.push(team.teamId)
  })
  return groups
}

function useSavedGroups(post, teams, groupCount) {
  const prev = post.openTournament || {}
  const savedGroups = prev.groups || []
  if (!savedGroups.length) return null
  if (Number(groupCount) && savedGroups.length !== Number(groupCount)) return null
  const validTeamIds = new Set(teams.map(team => team.teamId))
  const seen = new Set()
  const groups = savedGroups.map(group => ({
    groupId: group.groupId,
    groupName: group.groupName || group.groupId,
    teamIds: (group.teamIds || []).filter(teamId => {
      if (!validTeamIds.has(teamId) || seen.has(teamId)) return false
      seen.add(teamId)
      return true
    })
  }))
  return groups.length === Number(groupCount) && seen.size === teams.length ? groups : null
}

function emptyStanding(teams, key = 'league') {
  return {
    [key]: teams.map((team, index) => ({
      rank: index + 1,
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
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { tournamentId, format = 'league', isDoubleLoop = false, groupCount = 2, overwrite = false, playoffMode: requestedPlayoffMode = '' } = event
  if (!tournamentId) return { code: -1, msg: 'tournamentId 缺失' }

  try {
    const [postRes, userRes, regsRes] = await Promise.all([
      db.collection('posts').doc(tournamentId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get(),
      db.collection('event_registrations').where({ postId: tournamentId, status: 'approved' }).orderBy('approvedAt', 'asc').limit(200).get()
    ])
    const post = postRes.data
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    if (!post || post.postType !== 'event') return { code: -1, msg: '公开赛不存在' }
    const eventAdmin = await getEventAdmin(tournamentId, OPENID)
    if (!isAdmin && post.openid !== OPENID && !eventAdmin) return { code: -1, msg: '无权限生成赛程' }

    const existingMatches = post.openTournament && post.openTournament.matches
    if (existingMatches && existingMatches.length && !overwrite) {
      return { code: -1, msg: '赛程已存在，如需重排请确认覆盖' }
    }

    const teams = regsRes.data.map(mapTeam)
    if (teams.length < 2) return { code: -1, msg: '至少 2 支已通过审核队伍才能生成赛程' }

    const sport = normalizeSport(post.sport)
    const playoffMode = requestedPlayoffMode === 'two_stage_split'
      ? 'two_stage_split'
      : (post.eventFormat === '双淘汰赛' ? 'split_knockout' : 'single_knockout')
    const knockoutBrackets = playoffMode === 'split_knockout'
      ? [
          { bracketId: 'upper', name: '淘汰赛一', qualifierRanks: [1, 2], championTeamId: '', championTeamName: '' },
          { bracketId: 'lower', name: '淘汰赛二', qualifierRanks: [3, 4], championTeamId: '', championTeamName: '' }
        ]
      : []
    let groups = []
    let matches = []
    let standings = {}

    if (format === 'cup_groups') {
      groups = useSavedGroups(post, teams, groupCount) || buildGroups(teams, groupCount)
      groups.forEach(group => {
        const groupTeams = teams.filter(team => group.teamIds.includes(team.teamId))
        matches = matches.concat(roundRobin(groupTeams, false, group))
        standings = { ...standings, ...emptyStanding(groupTeams, group.groupId) }
      })
    } else {
      matches = roundRobin(teams, !!isDoubleLoop, null)
      standings = emptyStanding(teams, 'league')
    }

    const openTournament = {
      format,
      playoffMode,
      sport,
      status: 'active',
      matchRules: {
        teamSize: post.teamSize || 5,
        teamSizeLabel: post.teamSizeLabel || '',
        matchDuration: post.matchDuration || defaultMatchDuration(sport),
        halfDuration: post.halfDuration || defaultHalfDuration(sport),
        ...(((post.openTournament || {}).matchRules) || {})
      },
      isDoubleLoop: !!isDoubleLoop,
      groupCount: groups.length,
      teams,
      groups,
      knockout: playoffMode === 'split_knockout' ? { mode: 'split', brackets: knockoutBrackets } : {},
      secondStage: playoffMode === 'two_stage_split' ? {
        status: 'pending',
        initialAdvancePerGroup: 2,
        advancePerStageGroup: 2,
        description: '首阶段每组前 2 名进入胜者组，其余队伍进入败者组；两个组各取前 2 名进入独立淘汰赛。'
      } : {},
      knockoutMatches: [],
      matches,
      standings,
      leaderboards: emptyLeaderboards(sport),
      updatedAt: db.serverDate()
    }

    await db.collection('posts').doc(tournamentId).update({ data: { openTournament, updatedAt: db.serverDate() } })
    return { code: 0, msg: '赛程已生成', openTournament }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
