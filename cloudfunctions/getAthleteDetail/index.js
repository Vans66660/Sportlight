const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const TIER_THRESHOLDS = [
  ['S+', 1200], ['S', 1040],
  ['A+', 880],  ['A', 720],
  ['B+', 560],  ['B', 400],
  ['C+', 300],  ['C', 200],
  ['D+', 100],  ['D', 0]
]

function calcTierProgress(tier, score) {
  const idx = TIER_THRESHOLDS.findIndex(([t]) => t === tier)
  if (idx <= 0) return { nextTier: null, progress: 100, scoreNeeded: 0 }

  const currentThreshold = TIER_THRESHOLDS[idx][1]
  const nextTier = TIER_THRESHOLDS[idx - 1][0]
  const nextThreshold = TIER_THRESHOLDS[idx - 1][1]
  const range = nextThreshold - currentThreshold

  const progress = range > 0
    ? Math.max(0, Math.min(100, Math.round(((score - currentThreshold) / range) * 100)))
    : 100
  const scoreNeeded = Math.max(0, nextThreshold - score)

  return { nextTier, progress, scoreNeeded }
}

function calcAge(birthDate, fallbackAge) {
  if (!birthDate) return fallbackAge || ''
  const birth = new Date(String(birthDate).replace(/-/g, '/'))
  if (Number.isNaN(birth.getTime())) return fallbackAge || ''
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const hasHadBirthday = today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate())
  if (!hasHadBirthday) age -= 1
  return age >= 0 ? age : (fallbackAge || '')
}

function normalizeTier(tier) {
  const value = String(tier || '').trim()
  return !value || value === 'F' || value.startsWith('F') ? 'D' : value
}

async function getBossProfiles(openids) {
  const ids = [...new Set((openids || []).filter(Boolean))]
  if (!ids.length) return {}

  const [userRes, bossRes] = await Promise.all([
    db.collection('users').where({ openid: db.command.in(ids) }).field({ openid: true, name: true, displayName: true, logo: true }).get(),
    db.collection('bosses').where({ openid: db.command.in(ids) }).field({ openid: true, name: true, displayName: true, logo: true }).get().catch(() => ({ data: [] }))
  ])
  const map = {}
  ;(userRes.data || []).forEach(u => { map[u.openid] = u })
  ;(bossRes.data || []).forEach(b => { map[b.openid] = { ...(map[b.openid] || {}), ...b } })
  return map
}

function buildStatsStr(stats, sport) {
  if (!stats) return ''
  const parts = []
  const value = (...keys) => {
    for (const key of keys) {
      if (stats[key] !== '' && stats[key] !== null && stats[key] !== undefined) return stats[key]
    }
    return null
  }
  if (sport === '篮球') {
    const fields = [[value('points', 'pts'),'分'],[value('rebounds', 'reb'),'板'],[value('assists', 'ast'),'助'],[value('steals', 'stl'),'断'],[value('blocks', 'blk'),'帽']]
    fields.forEach(([v, u]) => { if (v !== '' && v !== null && v !== undefined) parts.push(`${v}${u}`) })
  } else if (sport === '足球') {
    const fields = [
      [value('goals', 'goal'), '球'],
      [value('assists', 'assist'), '助'],
      [value('shotsOnTarget', 'shots', 'shot_on_target'), '射正'],
      [value('successfulDribbles', 'dribbles', 'successful_dribble'), '过人'],
      [value('throughBalls', 'throughBall', 'through_ball'), '直塞'],
      [value('keyPasses', 'keyPass', 'key_pass'), '关键传球'],
      [value('successfulTackles', 'tackles', 'successful_tackle'), '抢断'],
      [value('saves', 'save', 'keeperSaves'), '扑救'],
      [value('yellowCards', 'yellowCard', 'yellow_card'), '黄牌'],
      [value('redCards', 'redCard', 'red_card'), '红牌']
    ]
    fields.forEach(([v, u]) => { if (v !== '' && v !== null && v !== undefined && Number(v) > 0) parts.push(`${v}${u}`) })
  } else if (sport === '羽毛球') {
    if (stats.points !== '' && stats.points != null) parts.push(`${stats.points}分`)
    if (stats.winners !== '' && stats.winners != null) parts.push(`${stats.winners}制胜`)
    if (stats.aces !== '' && stats.aces != null) parts.push(`${stats.aces}发球`)
    if (stats.errors !== '' && stats.errors != null) parts.push(`${stats.errors}误`)
  }
  return parts.join(' · ')
}

function calcCareerStats(history, sport) {
  const withStats = history.filter(e =>
    e.stats && typeof e.stats === 'object' &&
    Object.values(e.stats).some(v => v !== '' && v !== null && v !== undefined && Number(v) > 0)
  )
  const n = withStats.length
  if (n === 0) return null
  const r1 = v => Math.round(v * 10) / 10

  if (sport === '篮球') {
    let pts = 0, reb = 0, ast = 0, stl = 0, blk = 0
    withStats.forEach(e => {
      pts += Number(e.stats.points ?? e.stats.pts) || 0; reb += Number(e.stats.rebounds ?? e.stats.reb) || 0
      ast += Number(e.stats.assists ?? e.stats.ast) || 0; stl += Number(e.stats.steals ?? e.stats.stl) || 0
      blk += Number(e.stats.blocks ?? e.stats.blk) || 0
    })
    return { sport, games: n, avgPts: r1(pts/n), avgReb: r1(reb/n), avgAst: r1(ast/n), avgStl: r1(stl/n), avgBlk: r1(blk/n) }
  }

  if (sport === '足球') {
    const totals = { goals: 0, assists: 0, shotsOnTarget: 0, successfulDribbles: 0, throughBalls: 0, keyPasses: 0, successfulTackles: 0, saves: 0, yellowCards: 0, redCards: 0 }
    const number = (stats, ...keys) => {
      for (const key of keys) {
        if (stats[key] !== '' && stats[key] !== null && stats[key] !== undefined) return Number(stats[key]) || 0
      }
      return 0
    }
    withStats.forEach(e => {
      const stats = e.stats || {}
      totals.goals += number(stats, 'goals', 'goal')
      totals.assists += number(stats, 'assists', 'assist')
      totals.shotsOnTarget += number(stats, 'shotsOnTarget', 'shots', 'shot_on_target')
      totals.successfulDribbles += number(stats, 'successfulDribbles', 'dribbles', 'successful_dribble')
      totals.throughBalls += number(stats, 'throughBalls', 'throughBall', 'through_ball')
      totals.keyPasses += number(stats, 'keyPasses', 'keyPass', 'key_pass')
      totals.successfulTackles += number(stats, 'successfulTackles', 'tackles', 'successful_tackle')
      totals.saves += number(stats, 'saves', 'save', 'keeperSaves')
      totals.yellowCards += number(stats, 'yellowCards', 'yellowCard', 'yellow_card')
      totals.redCards += number(stats, 'redCards', 'redCard', 'red_card')
    })
    return {
      sport,
      games: n,
      totalGoals: totals.goals,
      totalAssists: totals.assists,
      avgGoals: r1(totals.goals / n),
      avgAssists: r1(totals.assists / n),
      avgShotsOnTarget: r1(totals.shotsOnTarget / n),
      avgSuccessfulDribbles: r1(totals.successfulDribbles / n),
      avgThroughBalls: r1(totals.throughBalls / n),
      avgKeyPasses: r1(totals.keyPasses / n),
      avgSuccessfulTackles: r1(totals.successfulTackles / n),
      avgSaves: r1(totals.saves / n),
      totalYellowCards: totals.yellowCards,
      totalRedCards: totals.redCards
    }
  }
  if (sport === '羽毛球') {
    let points = 0, winners = 0, aces = 0, saves = 0, errors = 0
    withStats.forEach(e => {
      points += Number(e.stats.points) || 0
      winners += Number(e.stats.winners) || 0
      aces += Number(e.stats.aces) || 0
      saves += Number(e.stats.saves) || 0
      errors += Number(e.stats.errors) || 0
    })
    return {
      sport,
      games: n,
      avgPoints: r1(points / n),
      avgWinners: r1(winners / n),
      avgAces: r1(aces / n),
      avgSaves: r1(saves / n),
      avgErrors: r1(errors / n)
    }
  }
  return null
}

async function countMatchParticipations(openid) {
  try {
    const res = await db.collection('competitionScoreLogs').where({ athleteOpenid: openid }).count()
    return res.total || 0
  } catch (e) {
    return 0
  }
}

async function countCompletedSoloGames(openid) {
  try {
    const res = await db.collection('soloGames')
      .where({
        participants: db.command.elemMatch({ openid }),
        status: db.command.in(['finished', 'completed', 'done'])
      })
      .count()
    return res.total || 0
  } catch (e) {
    return 0
  }
}

async function getPublicCardSummary(openid) {
  try {
    const res = await db.collection('playerCards').where({ ownerOpenid: openid }).limit(100).get()
    const cards = (res.data || []).filter(card => card.status === 'issued' && card.packStatus === 'stored')
    return {
      cardCount: cards.length,
      showcaseCards: cards.filter(card => card.isShowcased).sort((a, b) => (a.showcaseOrder || 99) - (b.showcaseOrder || 99)).slice(0, 6)
    }
  } catch (e) {
    return { cardCount: 0, showcaseCards: [] }
  }
}

function footballStatsFromMatch(match, openid) {
  const stats = { goals: 0, assists: 0 }
  ;(((match || {}).football || {}).events || []).forEach(ev => {
    if ((ev.playerOpenid || ev.openid) !== openid) return
    if (ev.type === 'goal') stats.goals += 1
    if (ev.type === 'assist') stats.assists += 1
  })
  return stats
}

async function getFormalCareerTotals(openid) {
  const totals = {
    matchParticipationCount: 0,
    formalWinCount: 0,
    totalGoals: 0,
    totalAssists: 0,
    totalBasketballPoints: 0,
    totalBasketballRebounds: 0,
    totalBasketballAssists: 0,
    totalBadmintonPoints: 0,
    totalBadmintonWinners: 0,
    totalBadmintonAces: 0
  }
  try {
    let logs = []
    let skip = 0
    while (true) {
      const res = await db.collection('competitionScoreLogs')
        .where({ athleteOpenid: openid })
        .skip(skip)
        .limit(100)
        .get()
      logs = logs.concat(res.data || [])
      if (!res.data || res.data.length < 100 || logs.length >= 500) break
      skip += 100
    }
    totals.matchParticipationCount = logs.length
    totals.formalWinCount = logs.filter(log => log.result === 'win').length

    const missing = []
    logs.forEach(log => {
      if (log.footballStats) {
        totals.totalGoals += Number(log.footballStats.goals) || 0
        totals.totalAssists += Number(log.footballStats.assists) || 0
      } else if (log.sport === 'football' && log.postId && log.matchId) {
        missing.push(log)
      }
      if (log.basketballStats) {
        totals.totalBasketballPoints += Number(log.basketballStats.points) || 0
        totals.totalBasketballRebounds += Number(log.basketballStats.rebounds) || 0
        totals.totalBasketballAssists += Number(log.basketballStats.assists) || 0
      }
      if (log.badmintonStats) {
        totals.totalBadmintonPoints += Number(log.badmintonStats.points) || 0
        totals.totalBadmintonWinners += Number(log.badmintonStats.winners) || 0
        totals.totalBadmintonAces += Number(log.badmintonStats.aces) || 0
      }
    })

    const postIds = [...new Set(missing.map(log => log.postId).filter(Boolean))]
    const postMap = {}
    for (let i = 0; i < postIds.length; i += 20) {
      const ids = postIds.slice(i, i + 20)
      const res = await db.collection('posts')
        .where({ _id: db.command.in(ids) })
        .field({ openTournament: true })
        .get()
      ;(res.data || []).forEach(post => { postMap[post._id] = post })
    }
    missing.forEach(log => {
      const ot = (postMap[log.postId] || {}).openTournament || {}
      const match = ((ot.matches || []).concat(ot.knockoutMatches || [])).find(item => item.matchId === log.matchId)
      const stats = footballStatsFromMatch(match, openid)
      totals.totalGoals += stats.goals
      totals.totalAssists += stats.assists
    })
  } catch (e) {}
  return totals
}

function winRateLabel(wins, games) {
  const total = Number(games) || 0
  if (total <= 0) return '0%'
  return `${Math.round(((Number(wins) || 0) / total) * 100)}%`
}

async function getViewerType(openid) {
  if (!openid) return ''
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get().catch(() => ({ data: [] }))
  return ((res.data || [])[0] || {}).userType || ''
}

async function hasScoutReportUnlocked(bossOpenid, athleteOpenid) {
  if (!bossOpenid || !athleteOpenid || bossOpenid === athleteOpenid) return false
  const unlockId = `${bossOpenid}_${athleteOpenid}`.replace(/[^\w-]/g, '_')
  const res = await db.collection('scout_report_unlocks').doc(unlockId).get().catch(() => ({ data: null }))
  return !!(res.data && res.data.status === 'unlocked')
}

function pct(numerator, denominator) {
  const d = Number(denominator) || 0
  if (d <= 0) return '暂无'
  return `${Math.round(((Number(numerator) || 0) / d) * 100)}%`
}

function buildScoutReport({ athlete, rank, competitionScore, currentSeasonScore, careerTotals, careerStats, unlocked }) {
  const games = Number(careerTotals.matchParticipationCount) || 0
  const wins = Number(careerTotals.formalWinCount) || 0
  const goals = Number(careerTotals.totalGoals) || 0
  const assists = Number(careerTotals.totalAssists) || 0
  const reputation = Number(athlete.reputation) || 80
  const yellowCards = Number((careerStats || {}).totalYellowCards) || 0
  const redCards = Number((careerStats || {}).totalRedCards) || 0
  const strengths = []
  const risks = []

  if (currentSeasonScore >= 400) strengths.push('当季积分稳定，具备较高正式赛参考价值')
  if (goals + assists >= 5) strengths.push('进攻参与度较高，适合需要即战力的比赛')
  if (wins >= 3) strengths.push('已有多场正式胜场记录')
  if (reputation >= 90) strengths.push('信誉优秀，合作风险低')
  if (!strengths.length) strengths.push(games > 0 ? '已有正式比赛样本，可继续观察近期表现' : '正式比赛样本较少，建议先沟通确认状态')

  if (games < 3) risks.push('正式比赛样本较少，数据稳定性不足')
  if (reputation < 75) risks.push('信誉分偏低，建议确认履约记录')
  if (redCards > 0 || yellowCards >= 3) risks.push('纪律记录需关注，建议确认比赛强度和判罚背景')
  if (!risks.length) risks.push('暂无明显数据风险')

  const role = athlete.position ? `${athlete.sport || '运动'} · ${athlete.position}` : (athlete.sport || '运动员')
  return {
    visible: true,
    unlocked,
    price: 6.9,
    title: '球探报告',
    preview: [
      { label: '正式样本', value: `${games} 场` },
      { label: '胜率', value: pct(wins, games) },
      { label: '进攻参与', value: `${goals + assists}` }
    ],
    metrics: unlocked ? [
      { label: '定位', value: role },
      { label: '当季积分', value: String(currentSeasonScore || 0) },
      { label: '总积分', value: String(competitionScore || 0) },
      { label: '等级', value: rank || 'D' },
      { label: '正式参赛', value: `${games} 场` },
      { label: '正式胜场', value: `${wins} 场` },
      { label: '胜率', value: pct(wins, games) },
      { label: '进球/助攻', value: `${goals}/${assists}` },
      { label: '信誉', value: String(reputation) },
      { label: '纪律', value: `${yellowCards} 黄 / ${redCards} 红` }
    ] : [],
    strengths: unlocked ? strengths : strengths.slice(0, 1),
    risks: unlocked ? risks : ['解锁后查看样本风险、纪律风险和合作建议'],
    suggestion: unlocked
      ? `${athlete.displayName || athlete.nickname || athlete.name || '该球员'}适合优先用于${athlete.position || '对应位置'}补强。建议结合最近比赛数据与报价沟通后再确认合作。`
      : '解锁后可查看完整球探判断、风险提示和合作建议。'
  }
}

async function getEventHonors(openid) {
  try {
    const res = await db.collection('athleteHonors')
      .where({ athleteOpenid: openid })
      .limit(50)
      .get()
    return (res.data || [])
      .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
      .map(item => `${item.eventTitle || '公开赛'} · ${item.label || item.rank || '荣誉'}`)
  } catch (e) {
    return []
  }
}

function formatYMD(value) {
  if (!value) return ''
  const raw = value.$date || value
  const date = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`
}

function sumField(list, getter) {
  return list.reduce((sum, item) => sum + (Number(getter(item)) || 0), 0)
}

function pushStat(stats, label, value, options = {}) {
  const n = Number(value) || 0
  if (!options.always && n === 0) return
  stats.push({ label, value: options.signed && n > 0 ? `+${n}` : String(n) })
}

async function getOrganizerMap(openids) {
  const ids = [...new Set((openids || []).filter(Boolean))]
  if (!ids.length) return {}
  const [userRes, bossRes] = await Promise.all([
    db.collection('users').where({ openid: db.command.in(ids) }).field({ openid: true, name: true, displayName: true, logo: true, avatarUrl: true, photo: true }).get().catch(() => ({ data: [] })),
    db.collection('bosses').where({ openid: db.command.in(ids) }).field({ openid: true, name: true, displayName: true, logo: true, avatarUrl: true }).get().catch(() => ({ data: [] }))
  ])
  const map = {}
  ;(userRes.data || []).forEach(item => { map[item.openid] = item })
  ;(bossRes.data || []).forEach(item => { map[item.openid] = { ...(map[item.openid] || {}), ...item } })
  const fileIDs = Object.values(map)
    .map(item => item.logo || item.avatarUrl || item.photo || '')
    .filter(url => url && url.startsWith('cloud://'))
  const tempMap = {}
  if (fileIDs.length) {
    try {
      const tempRes = await cloud.getTempFileURL({ fileList: [...new Set(fileIDs)] })
      ;(tempRes.fileList || []).forEach(file => { if (file.tempFileURL) tempMap[file.fileID] = file.tempFileURL })
    } catch (e) {}
  }
  Object.keys(map).forEach(openid => {
    const item = map[openid] || {}
    const logo = item.logo || item.avatarUrl || item.photo || ''
    map[openid] = {
      name: item.displayName || item.name || '',
      logo: tempMap[logo] || logo || ''
    }
  })
  return map
}

function collectMatchStatsFromPost(post, logs, openid) {
  const totals = { goals: 0, assists: 0, points: 0, rebounds: 0, basketballAssists: 0, steals: 0, blocks: 0, turnovers: 0 }
  const ot = (post || {}).openTournament || {}
  const matches = (ot.matches || []).concat(ot.knockoutMatches || [])
  logs.forEach(log => {
    const match = matches.find(item => item.matchId === log.matchId)
    const football = footballStatsFromMatch(match, openid)
    totals.goals += football.goals
    totals.assists += football.assists
    const basketball = ((((match || {}).basketball || {}).playerStats) || [])
      .find(item => (item.playerOpenid || item.openid) === openid) || {}
    totals.points += Number(basketball.points) || 0
    totals.rebounds += Number(basketball.rebounds) || 0
    totals.basketballAssists += Number(basketball.assists) || 0
    totals.steals += Number(basketball.steals) || 0
    totals.blocks += Number(basketball.blocks) || 0
    totals.turnovers += Number(basketball.turnovers) || 0
  })
  return totals
}

async function getTournamentBadges(openid) {
  try {
    const logsRes = await db.collection('competitionScoreLogs')
      .where({ athleteOpenid: openid })
      .limit(500)
      .get()
    const logs = logsRes.data || []
    if (!logs.length) return []
    const postIds = [...new Set(logs.map(log => log.postId).filter(Boolean))]
    const postMap = {}
    for (let i = 0; i < postIds.length; i += 20) {
      const ids = postIds.slice(i, i + 20)
      const res = await db.collection('posts')
        .where({ _id: db.command.in(ids) })
        .field({ _id: true, title: true, content: true, openid: true, sport: true, eventDate: true, openTournament: true })
        .get()
      ;(res.data || []).forEach(post => { postMap[post._id] = post })
    }
    const honorsRes = await db.collection('athleteHonors')
      .where({ athleteOpenid: openid, postId: db.command.in(postIds) })
      .limit(100)
      .get()
      .catch(() => ({ data: [] }))
    const honorMap = {}
    ;(honorsRes.data || []).forEach(item => { honorMap[item.postId] = item })
    const organizerMap = await getOrganizerMap(Object.values(postMap).map(post => post.openid).filter(Boolean))
    const grouped = {}
    logs.forEach(log => {
      if (!log.postId) return
      if (!grouped[log.postId]) grouped[log.postId] = []
      grouped[log.postId].push(log)
    })
    return Object.keys(grouped).map(postId => {
      const post = postMap[postId] || {}
      const list = grouped[postId] || []
      const organizer = organizerMap[post.openid] || {}
      const fallbackStats = collectMatchStatsFromPost(post, list, openid)
      const goals = sumField(list, log => (log.footballStats || {}).goals) || fallbackStats.goals
      const assists = sumField(list, log => (log.footballStats || {}).assists) || fallbackStats.assists
      const stats = []
      pushStat(stats, '参赛场次', list.length, { always: true })
      pushStat(stats, '胜场数', list.filter(log => log.result === 'win').length, { always: true })
      pushStat(stats, '进球', goals)
      pushStat(stats, '助攻', assists)
      pushStat(stats, '得分', sumField(list, log => (log.basketballStats || {}).points) || fallbackStats.points)
      pushStat(stats, '篮板', sumField(list, log => (log.basketballStats || {}).rebounds) || fallbackStats.rebounds)
      pushStat(stats, '篮球助攻', sumField(list, log => (log.basketballStats || {}).assists) || fallbackStats.basketballAssists)
      pushStat(stats, '抢断', sumField(list, log => (log.basketballStats || {}).steals) || fallbackStats.steals)
      pushStat(stats, '盖帽', sumField(list, log => (log.basketballStats || {}).blocks) || fallbackStats.blocks)
      pushStat(stats, '失误', sumField(list, log => (log.basketballStats || {}).turnovers) || fallbackStats.turnovers)
      pushStat(stats, '比赛胜负分', sumField(list, log => log.visibleResultScore), { signed: true })
      pushStat(stats, '个人表现分', sumField(list, log => log.visiblePersonalScore), { signed: true })
      pushStat(stats, '积分变化', sumField(list, log => log.delta), { signed: true })
      const honor = honorMap[postId] || {}
      return {
        postId,
        eventTitle: post.title || post.content || '公开赛',
        eventDate: post.eventDate || '',
        sport: post.sport || ((post.openTournament || {}).sport) || '',
        organizerName: organizer.name || '主办方',
        organizerAvatar: organizer.logo || '/images/logo.png',
        badgeTitle: `${post.title || post.content || '赛事'}纪念徽章`,
        rankLabel: honor.label || '',
        stats,
        latestAt: Math.max(...list.map(log => Number(log.createdAtMs || 0)).filter(Boolean), 0)
      }
    }).sort((a, b) => Number(b.latestAt || 0) - Number(a.latestAt || 0))
  } catch (e) {
    return []
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { athleteId, openid } = event

  try {
    let athlete = null

    if (athleteId) {
      const res = await db.collection('athletes').doc(athleteId).get()
      athlete = res.data
    } else if (openid) {
      const res = await db.collection('athletes').where({ openid }).limit(1).get()
      if (res.data.length > 0) {
        athlete = res.data[0]
      } else {
        const userRes = await db.collection('users').where({ openid }).limit(1).get()
        if (userRes.data.length > 0) {
          const u = userRes.data[0]
          athlete = {
            openid: u.openid,
            name: u.nickName || u.name || '运动员',
            photo: u.avatarUrl || u.photo || '',
            sport: '', position: '', city: '', affiliation: '',
            acceptMatch: false, acceptAd: false,
            matchPrice: 0, adPrice: 0,
            tags: [], highlights: [], socials: []
          }
        }
      }
    }

    if (!athlete) return { code: -1, msg: '未找到运动员' }

    const athleteOpenid = athlete.openid
    const viewerType = await getViewerType(OPENID)

    // ── 竞技数据（新体系）──
    const rank = normalizeTier(athlete.currentTier || athlete.rank)
    const levelReviewStatus = athlete.levelReviewStatus || 'none'
    const isLevelPending = levelReviewStatus === 'pending'
    const isBasketballBounty = athlete.sport === '篮球' && athlete.basketballPricingVersion === 'basketball-bounty-v1'
    const pendingBasketballTier = athlete.basketballRecommendedTier || athlete.proposedTier || 'D'
    const competitionScore = athlete.competitionScore || 0
    const currentSeasonScore = athlete.currentSeasonScore || 0
    const { nextTier, progress, scoreNeeded } = calcTierProgress(rank, competitionScore)

    // ── 赛事历史（修复 elemMatch bug）──
    let eventHistory = []
    try {
      const eventsRes = await db.collection('eventResults')
        .where({ results: db.command.elemMatch({ openid: athleteOpenid }) })
        .orderBy('submittedAt', 'desc')
        .limit(20)
        .get()

      eventHistory = eventsRes.data.map(doc => {
        const myResult = (doc.results || []).find(r => r.openid === athleteOpenid) || {}
        const sport = doc.sport || ''
        const stats = myResult.stats || null
        return {
          postId: doc.postId || '',
          eventTitle: doc.eventTitle || '',
          eventDate: doc.eventDate || '',
          sport,
          rank: myResult.rank ?? null,
          score: myResult.score ?? null,
          notes: myResult.notes || '',
          attended: myResult.attended !== false,
          stats,
          statsStr: buildStatsStr(stats, sport)
        }
      }).filter(e => e.attended)
    } catch (e) {}

    const [careerTotals, completedSoloGameCount, eventHonors, tournamentBadges, cardSummary] = await Promise.all([
      getFormalCareerTotals(athleteOpenid),
      countCompletedSoloGames(athleteOpenid),
      getEventHonors(athleteOpenid),
      getTournamentBadges(athleteOpenid),
      getPublicCardSummary(athleteOpenid)
    ])
    const matchParticipationCount = careerTotals.matchParticipationCount
    const eventCount = matchParticipationCount
    const totalGameCount = matchParticipationCount + completedSoloGameCount
    const careerStats = calcCareerStats(eventHistory, athlete.sport || '')
    const scoutVisible = (viewerType === 'boss' || viewerType === 'admin') && athleteOpenid !== OPENID
    const scoutUnlocked = scoutVisible ? await hasScoutReportUnlocked(OPENID, athleteOpenid) : false
    const scoutReport = scoutVisible
      ? buildScoutReport({
          athlete,
          rank,
          competitionScore,
          currentSeasonScore,
          careerTotals,
          careerStats,
          unlocked: scoutUnlocked
        })
      : { visible: false, unlocked: false }

    // ── 商业数据（赏金联赛，仅展示用）──
    const [ordersRes, postsRes] = await Promise.all([
      db.collection('orders').where({ athleteOpenid, status: 'done' }).orderBy('completedAt', 'desc').limit(50).get(),
      db.collection('posts').where({ openid: athleteOpenid }).orderBy('createdAt', 'desc').limit(10).get()
    ])
    const orders = ordersRes.data
    let recentPosts = postsRes.data.map(p => ({
      _id: p._id,
      type: p.type || 'general',
      content: p.content || '',
      createdAt: p.createdAt,
      visibility: p.visibility || 'public',
      likesCount: p.likesCount || 0
    }))
    const orderCount = orders.length

    const recentOrders = orders.slice(0, 5)
    const bossOpenids = [...new Set(recentOrders.map(o => o.bossOpenid).filter(Boolean))]
    let bossMap = {}
    if (bossOpenids.length > 0) {
      bossMap = await getBossProfiles(bossOpenids)
      const logoFileIDs = Object.values(bossMap).map(u => u.logo).filter(l => l && l.startsWith('cloud://'))
      let tempUrlMap = {}
      if (logoFileIDs.length > 0) {
        try {
          const tempRes = await cloud.getTempFileURL({ fileList: logoFileIDs })
          tempRes.fileList.forEach(f => { if (f.tempFileURL) tempUrlMap[f.fileID] = f.tempFileURL })
        } catch (e) {}
      }
      Object.values(bossMap).forEach(u => {
        bossMap[u.openid] = {
          name: u.displayName || u.name || '',
          logo: tempUrlMap[u.logo] || u.logo || ''
        }
      })
    }

    const deals = recentOrders.map(o => {
      const boss = bossMap[o.bossOpenid] || {}
      return {
        _id: o._id,
        type: o.type || 'match',
        typeLabel: '比赛出战',
        title: o.title || '',
        date: o.completedAt ? new Date(o.completedAt).toLocaleDateString('zh-CN') : '',
        bossLogo: boss.logo || '',
        bossInitial: boss.name ? boss.name[0] : '?'
      }
    })

    // ── 头像转链接 ──
    let photo = athlete.photo || ''
    if (photo.startsWith('cloud://')) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: [photo] })
        photo = tempRes.fileList[0].tempFileURL || photo
      } catch (e) {}
    }

    const reputation = athlete.reputation || 80
    const reputationLevel = reputation >= 90 ? 'great' : reputation >= 75 ? 'good' : reputation >= 60 ? 'ok' : 'bad'
    const publicDisplayName = athlete.nickname || (athlete.displayName && athlete.displayName !== athlete.name ? athlete.displayName : '') || `用户${athlete.sportlightId || ''}`
    let friendStatus = athleteOpenid === OPENID ? 'self' : 'none'
    if (athleteOpenid !== OPENID) {
      try {
        const friendRes = await db.collection('friends')
          .where({ userOpenid: OPENID, friendOpenid: athleteOpenid, status: 'active' })
          .limit(1)
          .get()
        if (friendRes.data.length) friendStatus = 'friends'
      } catch (e) {}
      if (friendStatus === 'none') {
        try {
          const [sentReq, recvReq] = await Promise.all([
            db.collection('friendRequests').where({ fromOpenid: OPENID, toOpenid: athleteOpenid, status: 'pending' }).limit(1).get(),
            db.collection('friendRequests').where({ toOpenid: OPENID, fromOpenid: athleteOpenid, status: 'pending' }).limit(1).get()
          ])
          if (sentReq.data.length) friendStatus = 'pending_sent'
          else if (recvReq.data.length) friendStatus = 'pending_received'
        } catch (e) {}
      }
    }
    recentPosts = recentPosts.filter(p => {
      const visibility = p.visibility || 'public'
      if (athleteOpenid === OPENID) return true
      if (visibility === 'private') return false
      if (visibility === 'friends') return friendStatus === 'friends'
      return true
    }).slice(0, 3)

    return {
      code: 0,
      data: {
        openid: athleteOpenid,
        name: athlete.name || '',
        nickname: athlete.nickname || '',
        displayName: publicDisplayName,
        sportlightId: athlete.sportlightId || '',
        joinedDateLabel: formatYMD(athlete.createdAt),
        friendStatus,
        viewerType,
        photo,
        sport: athlete.sport || '',
        position: athlete.position || '',
        age: calcAge(athlete.birthDate, athlete.age),
        birthDate: athlete.birthDate || '',
        city: athlete.city || '',
        affiliation: athlete.affiliation || '',
        isStudent: athlete.isStudent === true,
        studentVerified: athlete.studentVerified === true,
        hasStudentProof: !!athlete.studentProofFile || (Array.isArray(athlete.studentProofFiles) && athlete.studentProofFiles.length > 0),
        hasAthleteLevelCert: athlete.hasAthleteLevelCert === true || !!athlete.athleteLevelCertFile || (Array.isArray(athlete.athleteLevelCertFiles) && athlete.athleteLevelCertFiles.length > 0),
        athleteLevelCertLevel: athlete.athleteLevelCertLevel || '',
        athleteLevelCertVerified: athlete.athleteLevelCertVerified === true,
        athleteLevelCertFile: athlete.athleteLevelCertFile || '',
        athleteLevelCertFiles: Array.isArray(athlete.athleteLevelCertFiles) ? athlete.athleteLevelCertFiles : (athlete.athleteLevelCertFile ? [athlete.athleteLevelCertFile] : []),
        // 竞技体系
        rank,
        rankLabel: isLevelPending ? (isBasketballBounty ? `${pendingBasketballTier}级待验证` : '审核中') : rank,
        rankStatusClass: isLevelPending ? 'pending' : (rank[0] || 'D'),
        levelReviewStatus,
        proposedTier: athlete.proposedTier || '',
        basketballBountyEligible: athlete.basketballBountyEligible === true,
        basketballRecommendedTier: athlete.basketballRecommendedTier || '',
        basketballRecommendedScore: athlete.basketballRecommendedScore || 0,
        guaranteedAppearanceFee: athlete.guaranteedAppearanceFee || 0,
        performanceBonus: athlete.performanceBonus || 0,
        sPromotionReviewStatus: athlete.sPromotionReviewStatus || 'none',
        nextTier,
        progress,
        scoreNeeded,
        competitionScore,
        currentSeasonScore,
        eventCount,
        matchParticipationCount,
        completedSoloGameCount,
        totalGameCount,
        formalWinCount: careerTotals.formalWinCount,
        totalGoals: careerTotals.totalGoals,
        totalAssists: careerTotals.totalAssists,
        totalBasketballPoints: careerTotals.totalBasketballPoints,
        totalBasketballRebounds: careerTotals.totalBasketballRebounds,
        totalBasketballAssists: careerTotals.totalBasketballAssists,
        totalBadmintonPoints: careerTotals.totalBadmintonPoints,
        totalBadmintonWinners: careerTotals.totalBadmintonWinners,
        totalBadmintonAces: careerTotals.totalBadmintonAces,
        winRateLabel: winRateLabel(careerTotals.formalWinCount, matchParticipationCount),
        // 商业体系
        marketValue: athlete.marketValue || 0,
        orderCount,
        rating: athlete.rating || 0,
        reputation,
        reputationLevel,
        // 个人信息
        acceptMatch: athlete.acceptMatch || false,
        acceptAd: false,
        matchPrice: athlete.matchPrice || 0,
        adPrice: 0,
        tags: athlete.tags || [],
        honors: eventHonors,
        tournamentBadges,
        cardCount: cardSummary.cardCount,
        showcaseCards: cardSummary.showcaseCards,
        highlights: athlete.highlights || [],
        socials: [],
        deals,
        recentPosts,
        eventHistory,
        careerStats,
        scoutReport
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
