const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollection(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist')
}

async function canManage(postId, ownerOpenid, openid, isAdmin) {
  if (isAdmin || ownerOpenid === openid) return true
  try {
    const res = await db.collection('eventAdmins').where({ postId, adminOpenid: openid, status: 'accepted' }).limit(1).get()
    return !!(res.data || [])[0]
  } catch (e) {
    if (isMissingCollection(e)) return false
    throw e
  }
}

function makeMatch({ round, group, home, away, sport }) {
  return {
    matchId: `stage2-${group.groupId}-r${round}-${home.teamId}-${away.teamId}`,
    phase: 'second_stage',
    stage: `${group.groupId}_group`,
    round_number: round,
    group_id: group.groupId,
    group_name: group.groupName,
    home_team_id: home.teamId,
    away_team_id: away.teamId,
    home_team_name: home.teamName,
    away_team_name: away.teamName,
    match_time: '', venue: '', status: 'not_started',
    football: { homeScore: null, awayScore: null, events: [] },
    badminton: sport === 'badminton' ? { homeScore: null, awayScore: null, playerStats: [] } : undefined,
    basketball: sport === 'basketball' ? { quarters: [{ home: null, away: null }, { home: null, away: null }, { home: null, away: null }, { home: null, away: null }], homeScore: null, awayScore: null, playerStats: [] } : undefined
  }
}

function roundRobin(teams, group, sport) {
  const list = teams.slice()
  if (list.length % 2) list.push({ teamId: '__bye__', teamName: '轮空' })
  const matches = []
  let rotation = list.slice()
  for (let round = 1; round < list.length; round += 1) {
    for (let i = 0; i < list.length / 2; i += 1) {
      const a = rotation[i], b = rotation[list.length - 1 - i]
      if (a.teamId !== '__bye__' && b.teamId !== '__bye__') matches.push(makeMatch({ round, group, home: (round + i) % 2 ? a : b, away: (round + i) % 2 ? b : a, sport }))
    }
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)]
  }
  return matches
}

function emptyRows(teams) {
  return teams.map((team, index) => ({
    rank: index + 1, teamId: team.teamId, teamName: team.teamName,
    played: 0, win: 0, draw: 0, loss: 0,
    pointsFor: 0, pointsAgainst: 0, diff: 0, points: 0
  }))
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { tournamentId, overwrite = false } = event || {}
  if (!tournamentId) return { code: -1, msg: 'tournamentId 缺失' }
  try {
    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(tournamentId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    if (!post || post.postType !== 'event') return { code: -1, msg: '公开赛不存在' }
    const isAdmin = (userRes.data || []).some(item => item.userType === 'admin')
    if (!await canManage(tournamentId, post.openid, OPENID, isAdmin)) return { code: -1, msg: '无权限生成第二阶段' }
    const ot = post.openTournament || {}
    if (ot.playoffMode !== 'two_stage_split') return { code: -1, msg: '当前赛事不是胜者组/败者组赛制' }
    if ((ot.secondStage || {}).status === 'active' && !overwrite) return { code: -1, msg: '胜者组/败者组赛程已生成' }
    const firstStageMatches = (ot.matches || []).filter(match => match.phase !== 'second_stage')
    const unfinished = firstStageMatches.filter(match => match.status !== 'finished')
    if (unfinished.length) return { code: -1, msg: `还有 ${unfinished.length} 场首阶段小组赛未结束` }
    const advance = Number((ot.secondStage || {}).initialAdvancePerGroup) || 2
    const winnerTeams = [], loserTeams = []
    ;(ot.groups || []).forEach(group => {
      const rows = ((ot.standings || {})[group.groupId] || []).slice().sort((a, b) => a.rank - b.rank)
      rows.forEach(row => (row.rank <= advance ? winnerTeams : loserTeams).push({ teamId: row.teamId, teamName: row.teamName }))
    })
    if (winnerTeams.length < 2 || loserTeams.length < 2) return { code: -1, msg: '胜者组和败者组都至少需要 2 支队伍；请检查首阶段分组和晋级名额' }
    const stage2Groups = [
      { groupId: 'winner', groupName: '胜者组', teamIds: winnerTeams.map(team => team.teamId) },
      { groupId: 'loser', groupName: '败者组', teamIds: loserTeams.map(team => team.teamId) }
    ]
    const matches = firstStageMatches.concat(
      roundRobin(winnerTeams, stage2Groups[0], ot.sport || 'football'),
      roundRobin(loserTeams, stage2Groups[1], ot.sport || 'football')
    )
    ot.matches = matches
    ot.stage2Groups = stage2Groups
    ot.standings = { ...(ot.standings || {}), winner: emptyRows(winnerTeams), loser: emptyRows(loserTeams) }
    ot.secondStage = { ...(ot.secondStage || {}), status: 'active', generatedAt: db.serverDate(), winnerTeamCount: winnerTeams.length, loserTeamCount: loserTeams.length }
    ot.knockoutMatches = []
    ot.knockout = { status: 'pending', brackets: [
      { bracketId: 'winner', name: '胜者组淘汰赛', qualifierRanks: [1, 2], status: 'pending', championTeamId: '', championTeamName: '' },
      { bracketId: 'loser', name: '败者组淘汰赛', qualifierRanks: [1, 2], status: 'pending', championTeamId: '', championTeamName: '' }
    ] }
    ot.updatedAt = db.serverDate()
    await db.collection('posts').doc(tournamentId).update({ data: { openTournament: ot, updatedAt: db.serverDate() } })
    return { code: 0, msg: '胜者组和败者组赛程已生成', openTournament: ot }
  } catch (e) { return { code: -1, msg: e.message || '生成失败' } }
}
