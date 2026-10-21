const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
    basketball: sport === 'basketball'
      ? {
          quarters: [{ home: null, away: null }, { home: null, away: null }, { home: null, away: null }, { home: null, away: null }],
          homeScore: null,
          awayScore: null,
          playerStats: []
        }
      : undefined,
    winner_team_id: ''
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { tournamentId, advancePerGroup = 2, overwrite = false, mode = '' } = event || {}
  if (!tournamentId) return { code: -1, msg: 'tournamentId 缺失' }

  try {
    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(tournamentId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    if (!post || post.postType !== 'event') return { code: -1, msg: '公开赛不存在' }
    const eventAdmin = await getEventAdmin(tournamentId, OPENID)
    if (!isAdmin && post.openid !== OPENID && !eventAdmin) return { code: -1, msg: '无权限生成淘汰赛' }

    const ot = post.openTournament || {}
    if (ot.format !== 'cup_groups') return { code: -1, msg: '只有小组赛可生成淘汰赛' }
    if (ot.knockoutMatches && ot.knockoutMatches.length && !overwrite) {
      return { code: -1, msg: '淘汰赛已存在，如需重排请确认覆盖' }
    }

    const groupMatches = (ot.matches || []).filter(match => match.group_id)
    const unfinished = groupMatches.filter(match => match.status !== 'finished')
    if (unfinished.length > 0) return { code: -1, msg: `还有 ${unfinished.length} 场小组赛未结束` }

    const groups = ot.groups || []
    const standings = ot.standings || {}
    const n = Math.max(1, Math.min(Number(advancePerGroup) || 2, 4))
    const isSplit = mode === 'split_knockout' || ot.playoffMode === 'split_knockout' || ((ot.knockout || {}).mode === 'split')
    const isTwoStageSplit = ot.playoffMode === 'two_stage_split'

    const buildMatchesForRanks = (rankStart, rankEnd, bracketId = '', bracketName = '') => {
      const qualifiers = []
      groups.forEach(group => {
        const rows = (standings[group.groupId] || []).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999))
        rows
          .filter(row => (row.rank || 999) >= rankStart && (row.rank || 999) <= rankEnd)
          .forEach(row => {
            qualifiers.push({
              teamId: row.teamId,
              teamName: row.teamName,
              groupId: group.groupId,
              groupName: group.groupName,
              rank: row.rank
            })
          })
      })

      if (qualifiers.length < 2) return { code: -1, msg: `${bracketName || '淘汰赛'}晋级队伍不足` }
      if (qualifiers.length % 2 !== 0) return { code: -1, msg: `${bracketName || '淘汰赛'}晋级队伍数量需为偶数` }

      const seeded = qualifiers.sort((a, b) => {
        if ((a.rank || 99) !== (b.rank || 99)) return (a.rank || 99) - (b.rank || 99)
        return String(a.groupId).localeCompare(String(b.groupId))
      })
      const firstHalf = seeded.slice(0, seeded.length / 2)
      const secondHalf = seeded.slice(seeded.length / 2).reverse()
      const roundLabel = roundName(seeded.length)
      return {
        code: 0,
        qualifierCount: qualifiers.length,
        matches: firstHalf.map((home, index) => makeKnockoutMatch({
          roundIndex: 1,
          order: index + 1,
          roundLabel,
          home,
          away: secondHalf[index],
          sport: ot.sport || 'football',
          bracketId,
          bracketName
        }))
      }
    }

    if (isTwoStageSplit) {
      if ((ot.secondStage || {}).status !== 'active') return { code: -1, msg: '请先生成胜者组和败者组赛程' }
      const secondStageMatches = (ot.matches || []).filter(match => match.phase === 'second_stage')
      const pending = secondStageMatches.filter(match => match.status !== 'finished')
      if (pending.length) return { code: -1, msg: `还有 ${pending.length} 场胜者组/败者组比赛未结束` }
      const groupsById = new Map((ot.stage2Groups || []).map(group => [group.groupId, group]))
      const brackets = [
        { bracketId: 'winner', name: '胜者组淘汰赛', groupId: 'winner' },
        { bracketId: 'loser', name: '败者组淘汰赛', groupId: 'loser' }
      ]
      let knockoutMatches = []
      for (const bracket of brackets) {
        const group = groupsById.get(bracket.groupId)
        const rows = ((ot.standings || {})[bracket.groupId] || []).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999))
        if (!group || rows.length < 2) return { code: -1, msg: `${bracket.name}晋级队伍不足` }
        const qualifiers = rows.slice(0, 2).map(row => ({ teamId: row.teamId, teamName: row.teamName }))
        const built = [makeKnockoutMatch({ roundIndex: 1, order: 1, roundLabel: '决赛', home: qualifiers[0], away: qualifiers[1], sport: ot.sport || 'football', bracketId: bracket.bracketId, bracketName: bracket.name })]
        knockoutMatches = knockoutMatches.concat(built)
        bracket.qualifierCount = qualifiers.length
        bracket.qualifierRanks = [1, 2]
        bracket.status = 'draft'
        bracket.championTeamId = ''
        bracket.championTeamName = ''
      }
      ot.knockout = { mode: 'two_stage_split', status: 'draft', brackets, generatedAt: db.serverDate() }
      ot.knockoutMatches = knockoutMatches
      ot.updatedAt = db.serverDate()
      await db.collection('posts').doc(tournamentId).update({ data: { openTournament: ot, updatedAt: db.serverDate() } })
      return { code: 0, msg: '胜者组和败者组淘汰赛已生成', knockoutMatches }
    }

    if (isSplit) {
      const saved = ((ot.knockout || {}).brackets) || []
      const brackets = [
        { bracketId: 'upper', name: (saved.find(b => b.bracketId === 'upper') || {}).name || '淘汰赛一', qualifierRanks: [1, 2] },
        { bracketId: 'lower', name: (saved.find(b => b.bracketId === 'lower') || {}).name || '淘汰赛二', qualifierRanks: [3, 4] }
      ]
      let knockoutMatches = []
      for (const bracket of brackets) {
        const built = buildMatchesForRanks(bracket.qualifierRanks[0], bracket.qualifierRanks[1], bracket.bracketId, bracket.name)
        if (built.code !== 0) return built
        bracket.qualifierCount = built.qualifierCount
        bracket.status = 'draft'
        bracket.championTeamId = ''
        bracket.championTeamName = ''
        knockoutMatches = knockoutMatches.concat(built.matches)
      }
      ot.knockout = {
        mode: 'split',
        status: 'draft',
        brackets,
        generatedAt: db.serverDate()
      }
      ot.playoffMode = 'split_knockout'
      ot.knockoutMatches = knockoutMatches
      ot.updatedAt = db.serverDate()

      await db.collection('posts').doc(tournamentId).update({ data: { openTournament: ot, updatedAt: db.serverDate() } })
      return { code: 0, msg: '双淘汰赛已生成', knockoutMatches }
    }

    const qualifiers = []
    groups.forEach(group => {
      const rows = (standings[group.groupId] || []).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999))
      rows.slice(0, n).forEach(row => {
        qualifiers.push({
          teamId: row.teamId,
          teamName: row.teamName,
          groupId: group.groupId,
          groupName: group.groupName,
          rank: row.rank
        })
      })
    })

    if (qualifiers.length < 2) return { code: -1, msg: '晋级队伍不足' }
    if (qualifiers.length % 2 !== 0) return { code: -1, msg: '晋级队伍数量需为偶数' }

    const seeded = qualifiers.sort((a, b) => {
      if ((a.rank || 99) !== (b.rank || 99)) return (a.rank || 99) - (b.rank || 99)
      return String(a.groupId).localeCompare(String(b.groupId))
    })
    const firstHalf = seeded.slice(0, seeded.length / 2)
    const secondHalf = seeded.slice(seeded.length / 2).reverse()
    const roundLabel = roundName(seeded.length)
    const knockoutMatches = firstHalf.map((home, index) => makeKnockoutMatch({
      roundIndex: 1,
      order: index + 1,
      roundLabel,
      home,
      away: secondHalf[index],
      sport: ot.sport || 'football'
    }))

    ot.knockout = {
      status: 'draft',
      advancePerGroup: n,
      qualifierCount: qualifiers.length,
      generatedAt: db.serverDate()
    }
    ot.knockoutMatches = knockoutMatches
    ot.updatedAt = db.serverDate()

    await db.collection('posts').doc(tournamentId).update({ data: { openTournament: ot, updatedAt: db.serverDate() } })
    return { code: 0, msg: '淘汰赛已生成', knockoutMatches }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
