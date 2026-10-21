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
  return { nextTier, progress, scoreNeeded: Math.max(0, nextThreshold - score) }
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

function normalizeSubjectTypes(types, activeUserType = '') {
  const allow = ['athlete', 'boss', 'venue']
  const list = Array.isArray(types) ? types.slice() : []
  if (allow.includes(activeUserType)) list.push(activeUserType)
  return [...new Set(list.filter(type => allow.includes(type)))]
}

function hasVerifiedIdentity(...profiles) {
  return profiles.some(profile => {
    if (!profile) return false
    return !!(
      profile.identityVerified ||
      profile.realNameVerified ||
      profile.idCardHash ||
      profile.identityIdCardHash ||
      profile.idCardMasked ||
      profile.identityIdCardMasked
    )
  })
}

async function inferSubjectTypes(openid, user) {
  const base = normalizeSubjectTypes(user && user.subjectTypes, user && user.userType)
  const [athleteRes, bossRes, venueRes] = await Promise.all([
    db.collection('athletes').where({ openid }).field({ _id: true }).limit(1).get().catch(() => ({ data: [] })),
    db.collection('bosses').where({ openid }).field({ _id: true }).limit(1).get().catch(() => ({ data: [] })),
    db.collection('venues').where({ ownerOpenid: openid }).field({ _id: true }).limit(1).get().catch(() => ({ data: [] }))
  ])
  if ((athleteRes.data || []).length) base.push('athlete')
  if ((bossRes.data || []).length) base.push('boss')
  if ((venueRes.data || []).length) base.push('venue')
  return normalizeSubjectTypes(base)
}

async function getBossProfile(openid, fallback = {}) {
  const res = await db.collection('bosses').where({ openid }).limit(1).get().catch(() => ({ data: [] }))
  return {
    ...(fallback || {}),
    ...((res.data || [])[0] || {})
  }
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

async function getCardSummary(openid) {
  try {
    const res = await db.collection('playerCards').where({ ownerOpenid: openid }).limit(100).get()
    const cards = (res.data || []).filter(card => card.status === 'issued' && card.packStatus === 'stored')
    const showcaseCards = cards
      .filter(card => card.isShowcased)
      .sort((a, b) => (a.showcaseOrder || 99) - (b.showcaseOrder || 99))
      .slice(0, 6)
    return { cardCount: cards.length, showcaseCards, unseenCardCount: cards.filter(card => !card.seen).length }
  } catch (e) {
    return { cardCount: 0, showcaseCards: [], unseenCardCount: 0 }
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
      pushStat(stats, '射正', sumField(list, log => (log.footballStats || {}).shotsOnTarget))
      pushStat(stats, '成功过人', sumField(list, log => (log.footballStats || {}).successfulDribbles))
      pushStat(stats, '关键直塞', sumField(list, log => (log.footballStats || {}).throughBalls))
      pushStat(stats, '关键传球', sumField(list, log => (log.footballStats || {}).keyPasses))
      pushStat(stats, '成功抢断', sumField(list, log => (log.footballStats || {}).successfulTackles))
      pushStat(stats, '扑救', sumField(list, log => (log.footballStats || {}).saves))
      pushStat(stats, '黄牌', sumField(list, log => (log.footballStats || {}).yellowCards))
      pushStat(stats, '红牌', sumField(list, log => (log.footballStats || {}).redCards))
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

  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    if (userRes.data.length === 0) return { code: -1, msg: '用户不存在' }

    const user = userRes.data[0]
    const subjectTypes = await inferSubjectTypes(OPENID, user)

    if (user.userType === 'athlete') {
      const athleteRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()

      if (athleteRes.data.length > 0) {
        const athlete = athleteRes.data[0]

        // 实时查询已完成的订单与系统内完成场次
        const [ordersRes, careerTotals, completedSoloGameCount, eventHonors, tournamentBadges] = await Promise.all([
          db.collection('orders')
            .where({ athleteOpenid: OPENID, status: 'done' })
            .orderBy('completedAt', 'desc')
            .limit(50)
            .get(),
          getFormalCareerTotals(OPENID),
          countCompletedSoloGames(OPENID),
          getEventHonors(OPENID),
          getTournamentBadges(OPENID)
        ])
        const orders = ordersRes.data
        const matchParticipationCount = careerTotals.matchParticipationCount
        const totalGameCount = matchParticipationCount + completedSoloGameCount

        // 从订单实时计算统计数据
        const orderCount = orders.length
        const totalAmount = orders.reduce((sum, o) => sum + (o.price || 0), 0)
        const avgPrice = orderCount > 0 ? Math.floor(totalAmount / orderCount) : 0

        // 本月收入
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const monthIncome = orders
          .filter(o => o.completedAt && new Date(o.completedAt) >= monthStart)
          .reduce((sum, o) => sum + (o.price || 0), 0)

        // 近期合作（最近5条），附带老板 logo
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

        // 竞技体系：从 athlete 文档读取，由公开赛单场积分日志维护
        const rank = normalizeTier(athlete.currentTier || athlete.rank)
        const isBasketballBounty = athlete.sport === '篮球' && athlete.basketballPricingVersion === 'basketball-bounty-v1'
        const competitionScore = athlete.competitionScore || 0
        const currentSeasonScore = athlete.currentSeasonScore || 0
        const { nextTier, progress, scoreNeeded } = calcTierProgress(rank, competitionScore)

        // 赛事历史
        let eventHistory = []
        try {
          const eventsRes = await db.collection('eventResults')
            .where({ results: db.command.elemMatch({ openid: OPENID }) })
            .orderBy('submittedAt', 'desc')
            .limit(20)
            .get()
          eventHistory = eventsRes.data.map(doc => {
            const myResult = (doc.results || []).find(r => r.openid === OPENID) || {}
            return {
              postId: doc.postId || '',
              eventTitle: doc.eventTitle || '',
              eventDate: doc.eventDate || '',
              sport: doc.sport || '',
              rank: myResult.rank ?? null,
              score: myResult.score ?? null,
              notes: myResult.notes || '',
              attended: myResult.attended !== false
            }
          }).filter(e => e.attended)
        } catch (e) {}

        const identityVerified = hasVerifiedIdentity(athlete, user)
        const cardSummary = await getCardSummary(OPENID)

        return {
          code: 0,
          userType: 'athlete',
          subjectTypes,
          profile: {
            name: athlete.identityName || athlete.name,
            nickname: athlete.nickname || user.nickname || '',
            displayName: athlete.nickname || user.nickname || (athlete.displayName && athlete.displayName !== athlete.name ? athlete.displayName : '') || (user.displayName && user.displayName !== user.name ? user.displayName : '') || `用户${athlete.sportlightId || user.sportlightId || ''}`,
            sportlightId: athlete.sportlightId || user.sportlightId || '',
            joinedDateLabel: formatYMD(athlete.createdAt || user.createdAt),
            photo: athlete.photo,
            rank,
            rankLabel: athlete.levelReviewStatus === 'pending' && isBasketballBounty ? `${athlete.basketballRecommendedTier || athlete.proposedTier || 'D'}级待验证` : rank,
            levelReviewStatus: athlete.levelReviewStatus || 'none',
            nextTier,
            progress,
            scoreNeeded,
            competitionScore,
            currentSeasonScore,
            sport: athlete.sport,
            position: athlete.position,
            secondaryPosition: athlete.secondaryPosition || '',
            gender: athlete.gender || '',
            age: calcAge(athlete.birthDate, athlete.age),
            birthDate: athlete.birthDate || '',
            height: athlete.height || '',
            weight: athlete.weight || '',
            wingspan: athlete.wingspan || '',
            preferredFoot: athlete.preferredFoot || '',
            preferredHand: athlete.preferredHand || '',
            city: athlete.city,
            affiliation: athlete.affiliation,
            description: athlete.description || '',
            isStudent: athlete.isStudent === true,
            studentVerified: athlete.studentVerified === true,
            hasStudentProof: !!athlete.studentProofFile || (Array.isArray(athlete.studentProofFiles) && athlete.studentProofFiles.length > 0),
            hasAthleteLevelCert: athlete.hasAthleteLevelCert === true || !!athlete.athleteLevelCertFile || (Array.isArray(athlete.athleteLevelCertFiles) && athlete.athleteLevelCertFiles.length > 0),
            athleteLevelCertLevel: athlete.athleteLevelCertLevel || '',
            athleteLevelCertVerified: athlete.athleteLevelCertVerified === true,
            athleteLevelCertFile: athlete.athleteLevelCertFile || '',
            athleteLevelCertFiles: Array.isArray(athlete.athleteLevelCertFiles) ? athlete.athleteLevelCertFiles : (athlete.athleteLevelCertFile ? [athlete.athleteLevelCertFile] : []),
            orderCount,
            matchParticipationCount,
            completedSoloGameCount,
            totalGameCount,
            eventCount: matchParticipationCount,
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
            avgPrice,
            monthIncome,
            marketValue: athlete.marketValue || 0,
            basketballBountyEligible: athlete.basketballBountyEligible === true,
            basketballRecommendedTier: athlete.basketballRecommendedTier || '',
            basketballRecommendedScore: athlete.basketballRecommendedScore || 0,
            guaranteedAppearanceFee: athlete.guaranteedAppearanceFee || 0,
            performanceBonus: athlete.performanceBonus || 0,
            sPromotionReviewStatus: athlete.sPromotionReviewStatus || 'none',
            reputation: athlete.reputation || 80,
            acceptMatch: athlete.acceptMatch,
            acceptAd: false,
            matchPrice: athlete.matchPrice || 0,
            adPrice: 0,
            phone: user.phone || '',
            phoneVerified: !!(user.phoneVerified || athlete.phoneVerified),
            identityVerified,
            realNameVerified: identityVerified,
            realNameStatus: identityVerified ? '已实名' : '',
            cardCount: cardSummary.cardCount,
            showcaseCards: cardSummary.showcaseCards,
            unseenCardCount: cardSummary.unseenCardCount,
            socials: [],
            videoUploaded: athlete.videoUploaded || false,
            videoName: athlete.videoName || '',
            videoFile: athlete.videoFile || '',
            certUploaded: athlete.certUploaded || false,
            certName: athlete.certName || '',
            certFiles: athlete.certFiles || [],
            honors: eventHonors,
            tournamentBadges,
            highlights: athlete.highlights || [],
            deals,
            eventHistory
          }
        }
      }
    }

    if (user.userType === 'boss') {
      const boss = await getBossProfile(OPENID, user)
      const [ordersRes, postsRes] = await Promise.all([
        db.collection('orders').where({ bossOpenid: OPENID }).orderBy('createdAt', 'desc').limit(20).get(),
        db.collection('posts').where({ openid: OPENID }).orderBy('createdAt', 'desc').limit(3).get()
      ])
      const recentPosts = postsRes.data.map(p => ({
        _id: p._id,
        type: p.type || 'general',
        content: p.content || '',
        createdAt: p.createdAt,
        likesCount: p.likesCount || 0
      }))

      const identityVerified = hasVerifiedIdentity(boss, user)

      return {
        code: 0,
        userType: 'boss',
        subjectTypes,
        profile: {
          name: boss.name || '老板',
          displayName: boss.displayName || boss.name || '',
          sportlightId: boss.sportlightId || user.sportlightId || '',
          logo: boss.logo || '',
          bossType: boss.bossType || '',
          city: boss.city || '',
          phone: boss.phone || user.phone || '',
          description: boss.description || '',
          wechatVerified: boss.wechatVerified || false,
          phoneVerified: boss.phoneVerified || user.phoneVerified || false,
          identityVerified,
          realNameVerified: identityVerified,
          realNameStatus: identityVerified ? '已实名' : '',
          realName: boss.realName || '',
          idCard: boss.idCard || '',
          receiveMethod: boss.receiveMethod || '',
          wxpayBound: boss.wxpayBound || false,
          companyName: boss.companyName || '',
          creditCode: boss.creditCode || '',
          license: boss.license || '',
          legalType: boss.legalType || '',
          legalName: boss.legalName || '',
          legalIdCard: boss.legalIdCard || '',
          agentName: boss.agentName || '',
          agentIdCard: boss.agentIdCard || '',
          authLetter: boss.authLetter || '',
          clubType: boss.clubType || '',
          clubLogo: boss.clubLogo || '',
          orderCount: (ordersRes.data || []).filter(o => !o.teamCaptainChat && o.type !== 'team_contact' && o.mode !== 'team_contact').length,
          recentPosts
        }
      }
    }

    if (user.userType === 'venue') {
      const venueRes = await db.collection('venues').where({ ownerOpenid: OPENID }).limit(1).get().catch(() => ({ data: [] }))
      const venue = (venueRes.data || [])[0] || {}
      return {
        code: 0,
        userType: 'venue',
        subjectTypes,
        profile: {
          name: venue.name || user.name || '球馆',
          logo: venue.coverImage || user.logo || '',
          city: venue.city || user.city || '',
          phone: user.phone || '',
          phoneVerified: !!user.phoneVerified,
          description: venue.description || user.description || '',
          venueId: venue._id || '',
          status: venue.status || user.venueStatus || '',
          address: venue.address || '',
          locationName: venue.locationName || '',
          sportlightId: user.sportlightId || ''
        }
      }
    }

    return { code: 0, userType: '', subjectTypes, profile: {} }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
