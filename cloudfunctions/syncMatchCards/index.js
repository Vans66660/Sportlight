const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_')
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key])
      return result
    }, {})
  }
  return value === undefined ? null : value
}

function renderInputFingerprint(input) {
  return JSON.stringify(stableValue({
    appearanceType: input.appearanceType || 'appearance',
    playerSnapshot: input.playerSnapshot || {},
    matchSnapshot: input.matchSnapshot || {},
    statsSnapshot: input.statsSnapshot || {},
    scoreSnapshot: input.scoreSnapshot || {}
  }))
}

function isCardCertified(post) {
  return !!(post &&
    post.platformCertified === true &&
    post.certificationStatus === 'approved' &&
    post.cardIssuanceEnabled === true)
}

async function canSyncCards(post, openid) {
  if (!post || !openid) return false
  if (post.openid === openid) return true
  const [userRes, eventAdminRes] = await Promise.all([
    db.collection('users').where({ openid }).field({ userType: true }).limit(1).get().catch(() => ({ data: [] })),
    db.collection('eventAdmins').where({ postId: post._id, adminOpenid: openid, status: 'accepted' }).limit(1).get().catch(() => ({ data: [] }))
  ])
  return !!(
    ((userRes.data || [])[0] || {}).userType === 'admin' ||
    (eventAdminRes.data || []).length
  )
}

function scoreOf(match, sport) {
  const data = sport === 'basketball' ? match.basketball : sport === 'badminton' ? match.badminton : match.football
  return { home: Number(data && data.homeScore) || 0, away: Number(data && data.awayScore) || 0 }
}

async function profileMaps(openids) {
  if (!openids.length) return { athletes: {}, users: {} }
  const [athleteRes, userRes] = await Promise.all([
    db.collection('athletes').where({ openid: _.in(openids) }).get(),
    db.collection('users').where({ openid: _.in(openids) }).get()
  ])
  const athletes = {}
  const users = {}
  ;(athleteRes.data || []).forEach(item => { athletes[item.openid] = item })
  ;(userRes.data || []).forEach(item => { users[item.openid] = item })
  return { athletes, users }
}

async function existingBySource(sourceType, sourceId, matchId = '') {
  try {
    const res = await db.collection('playerCards').where({ sourceId }).limit(100).get()
    return (res.data || []).filter(card => card.sourceType === sourceType && (!matchId || card.matchId === matchId))
  } catch (e) {
    return []
  }
}

async function withdrawSourceCards(sourceType, sourceId, matchId = '', reason = 'event_not_certified') {
  const existing = await existingBySource(sourceType, sourceId, matchId)
  let withdrawn = 0
  for (const card of existing) {
    if (card.status === 'withdrawn' && card.withdrawReason === reason) continue
    await db.collection('playerCards').doc(card._id).update({
      data: {
        status: 'withdrawn',
        eligibilityStatus: 'withdrawn',
        packStatus: 'removed',
        isShowcased: false,
        shareEnabled: false,
        certificationStatus: 'revoked',
        withdrawReason: reason,
        withdrawnAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    withdrawn += 1
  }
  return withdrawn
}

async function upsertCard({ sourceType, sourceId, matchId = '', player, athlete, user, matchSnapshot, statsSnapshot, scoreSnapshot, recordedByOpenid }) {
  // The card writer itself enforces certification. Front-end flags and caller
  // permissions are not trusted, so direct invocation cannot bypass this gate.
  const latestPostRes = await db.collection('posts').doc(sourceId).get().catch(() => ({ data: null }))
  if (!isCardCertified(latestPostRes.data)) {
    const error = new Error('比赛尚未获得Sportlight平台认证，不能发卡')
    error.code = 'EVENT_NOT_CERTIFIED'
    throw error
  }
  const sourceKey = `${sourceType}_${sourceId}_${matchId || 'event'}_${player.openid}`
  const cardId = `SL_${safeId(sourceKey)}`
  const oldRes = await db.collection('playerCards').doc(cardId).get().catch(() => ({ data: null }))
  const hasOld = !!oldRes.data
  const old = oldRes.data || {}
  const hadRender = !!(old.frontImage || old.backImage || old.coverImage || old.generationStatus === 'generated')
  const now = Date.now()
  const status = 'issued'
  // 已生成卡片是不可变的收藏品。赛事重新同步只恢复其发放与认证状态，
  // 不再改写卡面使用的球员、比赛和数据快照。
  if (hadRender) {
    await db.collection('playerCards').doc(cardId).update({
      data: {
        status: 'issued',
        eligibilityStatus: 'issued',
        packStatus: 'stored',
        certificationStatus: 'approved',
        certificationVersion: Number(latestPostRes.data.certificationVersion) || 1,
        certifiedAt: latestPostRes.data.certifiedAt || old.certifiedAt || null,
        withdrawReason: _.remove(),
        withdrawnAt: _.remove(),
        updatedAtMs: now,
        updatedAt: db.serverDate()
      }
    })
    return status
  }
  const appearanceType = player.appearanceType || 'appearance'
  const playerSnapshot = {
    name: player.name || athlete.name || '',
    sportlightId: athlete.sportlightId || user.sportlightId || '',
    photo: athlete.photo || '',
    position: athlete.position || '',
    teamId: player.teamId || '',
    teamName: player.teamName || ''
  }
  const normalizedStats = statsSnapshot || {}
  const normalizedScore = scoreSnapshot || {}
  const nextRenderInput = {
    appearanceType,
    playerSnapshot,
    matchSnapshot,
    statsSnapshot: normalizedStats,
    scoreSnapshot: normalizedScore
  }
  const renderInputChanged = !hasOld ||
    renderInputFingerprint(old) !== renderInputFingerprint(nextRenderInput)
  const invalidateRender = hadRender && renderInputChanged
  const data = {
    cardId,
    sourceKey,
    sourceType,
    sourceId,
    matchId,
    ownerOpenid: player.openid,
    playerId: athlete._id || '',
    cardType: 'match_base',
    status,
    eligibilityStatus: status,
    packStatus: 'stored',
    appearanceType,
    playerSnapshot,
    matchSnapshot,
    statsSnapshot: normalizedStats,
    scoreSnapshot: normalizedScore,
    generationStatus: hadRender
      ? (invalidateRender ? 'stale' : (old.generationStatus || 'generated'))
      : 'pending_design',
    frontImage: old.frontImage || '',
    backImage: old.backImage || '',
    coverImage: old.coverImage || old.frontImage || '',
    portraitId: old.portraitId || '',
    generatedAtMs: Number(old.generatedAtMs) || 0,
    generatedAt: old.generatedAt || null,
    shareCode: old.shareCode || '',
    sharedAtMs: Number(old.sharedAtMs) || 0,
    sharedAt: old.sharedAt || null,
    isShowcased: invalidateRender ? false : !!old.isShowcased,
    showcaseOrder: invalidateRender ? null : (old.showcaseOrder || null),
    shareEnabled: invalidateRender ? false : !!old.shareEnabled,
    seen: !!old.seen,
    recordedByOpenid: recordedByOpenid || '',
    certificationStatus: 'approved',
    certificationVersion: Number(latestPostRes.data.certificationVersion) || 1,
    certifiedAt: latestPostRes.data.certifiedAt || null,
    issuedAtMs: old.issuedAtMs || now,
    issuedAt: old.issuedAt || db.serverDate(),
    updatedAtMs: now,
    updatedAt: db.serverDate()
  }
  // Object-valued render fields must be omitted when they do not exist.
  // Persisting null prevents later nested metadata updates in Cloud Database.
  if (old.frontImageMeta && typeof old.frontImageMeta === 'object') {
    data.frontImageMeta = old.frontImageMeta
  }
  if (old.backImageMeta && typeof old.backImageMeta === 'object') {
    data.backImageMeta = old.backImageMeta
  }
  if (old.generationMetadata && typeof old.generationMetadata === 'object') {
    data.generationMetadata = old.generationMetadata
  }
  if (old.portraitSnapshot && typeof old.portraitSnapshot === 'object') {
    data.portraitSnapshot = old.portraitSnapshot
  }
  if (!old.createdAtMs) {
    data.createdAtMs = now
    data.createdAt = db.serverDate()
  }
  await db.collection('playerCards').doc(cardId).set({ data })
  // Close the revoke/write race: if certification changed while this card was
  // being assembled, immediately withdraw the just-written stale card. If the
  // revoke happens after this read, the revocation function will see this card.
  const certificationAfterWrite = await db.collection('posts').doc(sourceId).get().catch(() => ({ data: null }))
  const latest = certificationAfterWrite.data
  if (!isCardCertified(latest) || Number(latest.certificationVersion || 1) !== Number(data.certificationVersion)) {
    await db.collection('playerCards').doc(cardId).update({
      data: {
        status: 'withdrawn',
        eligibilityStatus: 'withdrawn',
        packStatus: 'removed',
        isShowcased: false,
        shareEnabled: false,
        certificationStatus: 'revoked',
        withdrawReason: 'certification_changed_during_issuance',
        withdrawnAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    const error = new Error('赛事认证状态已变化，本次发卡已取消')
    error.code = 'EVENT_NOT_CERTIFIED'
    throw error
  }
  return status
}

async function syncEvent(postId, recordedByOpenid) {
  const [postRes, resultRes] = await Promise.all([
    db.collection('posts').doc(postId).get(),
    db.collection('eventResults').where({ postId }).limit(1).get()
  ])
  const post = postRes.data || {}
  if (!isCardCertified(post)) {
    const withdrawn = await withdrawSourceCards('event_result', postId)
    return { issued: 0, pending: 0, withdrawn, skipped: true, reason: 'event_not_certified' }
  }
  const resultDoc = (resultRes.data || [])[0]
  if (!resultDoc) return { issued: 0, pending: 0, withdrawn: 0 }
  const attended = (resultDoc.results || []).filter(item => item.attended !== false && item.openid)
  const openids = [...new Set(attended.map(item => item.openid))]
  const maps = await profileMaps(openids)
  const existing = await existingBySource('event_result', postId)
  const activeSet = new Set(openids)
  let withdrawn = 0
  for (const card of existing) {
    if (!activeSet.has(card.ownerOpenid) && card.status !== 'withdrawn') {
      await db.collection('playerCards').doc(card._id).update({ data: { status: 'withdrawn', packStatus: 'removed', isShowcased: false, updatedAt: db.serverDate() } })
      withdrawn += 1
    }
  }
  let issued = 0
  let pending = 0
  for (const item of attended) {
    const athlete = maps.athletes[item.openid] || {}
    const before = Number(athlete.competitionScore || 0)
    const status = await upsertCard({
      sourceType: 'event_result', sourceId: postId, player: item, athlete, user: maps.users[item.openid] || {},
      recordedByOpenid,
      matchSnapshot: {
        eventTitle: resultDoc.eventTitle || post.title || post.content || '赛事',
        eventDate: resultDoc.eventDate || post.eventDate || '',
        sport: resultDoc.sport || post.sport || '',
        postId,
        organizerName: post.authorName || '赛事主办方',
        organizerAvatar: post.authorPhoto || post.logo || ''
      },
      statsSnapshot: item.stats || {},
      scoreSnapshot: { currentScore: before, rank: item.rank ?? null, eventScore: item.score ?? null }
    })
    if (status === 'issued') issued += 1
    else pending += 1
  }
  return { issued, pending, withdrawn }
}

async function syncTournamentMatch(tournamentId, matchId, recordedByOpenid) {
  const postRes = await db.collection('posts').doc(tournamentId).get()
  const post = postRes.data || {}
  if (!isCardCertified(post)) {
    const withdrawn = await withdrawSourceCards('open_tournament_match', tournamentId, matchId)
    return { issued: 0, pending: 0, withdrawn, skipped: true, reason: 'event_not_certified' }
  }
  const openTournament = post.openTournament || {}
  const matches = (openTournament.matches || []).concat(openTournament.knockoutMatches || [])
  const match = matches.find(item => item.matchId === matchId)
  if (!match) throw new Error('比赛不存在')
  const existing = await existingBySource('open_tournament_match', tournamentId, matchId)
  if (match.status !== 'finished') {
    await Promise.all(existing.map(card => db.collection('playerCards').doc(card._id).update({ data: { status: 'withdrawn', packStatus: 'removed', isShowcased: false, updatedAt: db.serverDate() } })))
    return { issued: 0, pending: 0, withdrawn: existing.length }
  }
  const sport = openTournament.sport || post.sport || 'football'
  const logsRes = await db.collection('competitionScoreLogs').where({ postId: tournamentId, matchId }).limit(100).get()
  let logs = logsRes.data || []
  const appearanceMap = {}
  if (sport === 'football' || sport === '足球') {
    const lineups = match.lineups || {}
    ;(lineups.home || []).concat(lineups.away || []).forEach(player => {
      const openid = player.openid || player.playerOpenid
      if (openid) appearanceMap[openid] = 'starter'
    })
    ;(match.substitutions || []).forEach(sub => {
      if (sub.inOpenid) appearanceMap[sub.inOpenid] = 'substitute'
      if (sub.outOpenid && !appearanceMap[sub.outOpenid]) appearanceMap[sub.outOpenid] = 'starter'
    })
    // 没有明确首发或替补记录时，不使用整队大名单兜底发卡。
    logs = logs.filter(log => appearanceMap[log.athleteOpenid])
  }
  const openids = [...new Set(logs.map(log => log.athleteOpenid).filter(Boolean))]
  const maps = await profileMaps(openids)
  const activeSet = new Set(openids)
  let withdrawn = 0
  for (const card of existing) {
    if (!activeSet.has(card.ownerOpenid) && card.status !== 'withdrawn') {
      await db.collection('playerCards').doc(card._id).update({ data: { status: 'withdrawn', packStatus: 'removed', isShowcased: false, updatedAt: db.serverDate() } })
      withdrawn += 1
    }
  }
  const score = scoreOf(match, sport)
  let issued = 0
  let pending = 0
  for (const log of logs) {
    const athlete = maps.athletes[log.athleteOpenid] || {}
    const isHome = log.teamId === match.home_team_id
    const status = await upsertCard({
      sourceType: 'open_tournament_match', sourceId: tournamentId, matchId, recordedByOpenid,
      player: { openid: log.athleteOpenid, name: log.athleteName, teamId: log.teamId, teamName: log.teamName, appearanceType: appearanceMap[log.athleteOpenid] || 'appearance' },
      athlete, user: maps.users[log.athleteOpenid] || {},
      matchSnapshot: {
        eventTitle: log.eventTitle || post.title || post.content || '公开赛', matchTitle: log.matchTitle || '', matchTime: log.matchTime || match.match_time || '',
        sport, postId: tournamentId, matchId, homeTeamId: match.home_team_id, homeTeamName: match.home_team_name,
        awayTeamId: match.away_team_id, awayTeamName: match.away_team_name, homeScore: score.home, awayScore: score.away,
        opponentTeamId: log.opponentTeamId || '', opponentTeamName: log.opponentTeamName || '', result: log.result || '',
        organizerName: post.authorName || '赛事主办方',
        organizerAvatar: post.authorPhoto || post.logo || ''
      },
      statsSnapshot: log.footballStats || log.basketballStats || log.badmintonStats || {},
      scoreSnapshot: { delta: Number(log.delta) || 0, resultScore: Number(log.visibleResultScore) || 0, personalScore: Number(log.visiblePersonalScore) || 0, preMatchScore: Number(log.preMatchScore) || 0, preMatchTier: log.preMatchTier || '', side: isHome ? 'home' : 'away' }
    })
    if (status === 'issued') issued += 1
    else pending += 1
  }
  return { issued, pending, withdrawn }
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  try {
    const sourceId = event.sourceId || event.postId || event.tournamentId
    if (!sourceId) return { code: -1, msg: '缺少赛事ID' }
    const sourcePostRes = await db.collection('posts').doc(sourceId).get().catch(() => ({ data: null }))
    const sourcePost = sourcePostRes.data
    if (!sourcePost || !await canSyncCards(sourcePost, OPENID)) {
      return { code: -1, msg: '无权同步该赛事的认证卡' }
    }
    if (event.sourceType === 'event_result') {
      return { code: 0, ...(await syncEvent(event.sourceId || event.postId, event.recordedByOpenid || '')) }
    }
    if (event.sourceType === 'open_tournament_match') {
      if (event.syncAll) {
        const postRes = await db.collection('posts').doc(event.sourceId || event.tournamentId).get()
        const tournament = (postRes.data || {}).openTournament || {}
        const matches = (tournament.matches || []).concat(tournament.knockoutMatches || [])
        const totals = { issued: 0, pending: 0, withdrawn: 0 }
        for (const match of matches) {
          const result = await syncTournamentMatch(event.sourceId || event.tournamentId, match.matchId, event.recordedByOpenid || '')
          Object.keys(totals).forEach(key => { totals[key] += Number(result[key]) || 0 })
        }
        return { code: 0, ...totals }
      }
      return { code: 0, ...(await syncTournamentMatch(event.sourceId || event.tournamentId, event.matchId, event.recordedByOpenid || '')) }
    }
    return { code: -1, msg: '不支持的发卡来源' }
  } catch (e) {
    if (e && e.code === 'EVENT_NOT_CERTIFIED') {
      return { code: 0, issued: 0, pending: 0, withdrawn: 0, skipped: true, reason: 'event_not_certified', msg: e.message }
    }
    return { code: -1, msg: e.message }
  }
}
