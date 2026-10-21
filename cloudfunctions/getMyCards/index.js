const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_PORTRAITS = 3
const STARTER_UPLOADS = 3

function chinaMonthKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now)
  const values = {}
  parts.forEach(part => { values[part.type] = part.value })
  return `${values.year}-${values.month}`
}

function portraitState(athlete) {
  let portraits = Array.isArray(athlete.cardPortraits)
    ? athlete.cardPortraits.filter(item => item && item.cutoutFileID).slice(0, MAX_PORTRAITS)
    : []
  if (!portraits.length && athlete.cardPortrait && athlete.cardPortrait.cutoutFileID) {
    portraits = [{ ...athlete.cardPortrait, portraitId: athlete.cardPortrait.portraitId || 'legacy_portrait_1' }]
  }
  portraits = portraits.map((item, index) => ({ ...item, portraitId: item.portraitId || `legacy_portrait_${index + 1}` }))
  const activePortraitId = portraits.some(item => item.portraitId === athlete.activeCardPortraitId)
    ? athlete.activeCardPortraitId
    : ((portraits[0] && portraits[0].portraitId) || '')
  const recordedCount = Number(athlete.cardPortraitUploadCount)
  const uploadCount = Number.isFinite(recordedCount) ? Math.max(0, recordedCount) : portraits.length
  const monthKey = chinaMonthKey()
  const starterRemaining = Math.max(0, STARTER_UPLOADS - uploadCount)
  const monthlyAvailable = starterRemaining === 0 && athlete.cardPortraitMonthlyUploadKey !== monthKey
  return {
    portraits,
    activePortraitId,
    activePortrait: portraits.find(item => item.portraitId === activePortraitId) || null,
    quota: {
      starterRemaining,
      monthlyAvailable,
      remaining: starterRemaining > 0 ? starterRemaining : (monthlyAvailable ? 1 : 0),
      monthKey,
      maxPortraits: MAX_PORTRAITS
    }
  }
}

async function attachOrganizerBadges(cards) {
  const sourceIds = [...new Set((cards || [])
    .filter(card => !(card.matchSnapshot || {}).organizerAvatar)
    .map(card => card.sourceId || (card.matchSnapshot || {}).postId)
    .filter(Boolean))]
  if (!sourceIds.length) return cards
  const posts = []
  for (let index = 0; index < sourceIds.length; index += 20) {
    const result = await db.collection('posts').where({ _id: _.in(sourceIds.slice(index, index + 20)) }).get().catch(() => ({ data: [] }))
    posts.push(...(result.data || []))
  }
  const postMap = {}
  posts.forEach(post => { postMap[post._id] = post })
  const organizerOpenids = [...new Set(posts.map(post => post.openid).filter(Boolean))]
  const [usersRes, bossesRes] = organizerOpenids.length
    ? await Promise.all([
      db.collection('users').where({ openid: _.in(organizerOpenids) }).field({ openid: true, logo: true, avatarUrl: true, photo: true }).get().catch(() => ({ data: [] })),
      db.collection('bosses').where({ openid: _.in(organizerOpenids) }).field({ openid: true, logo: true, avatarUrl: true, photo: true }).get().catch(() => ({ data: [] }))
    ])
    : [{ data: [] }, { data: [] }]
  const profileMap = {}
  ;[...(usersRes.data || []), ...(bossesRes.data || [])].forEach(profile => {
    const avatar = profile.logo || profile.avatarUrl || profile.photo || ''
    if (avatar) profileMap[profile.openid] = avatar
  })
  return cards.map(card => {
    const snapshot = card.matchSnapshot || {}
    const post = postMap[card.sourceId || snapshot.postId]
    if (!post || snapshot.organizerAvatar) return card
    return {
      ...card,
      matchSnapshot: {
        ...snapshot,
        organizerName: snapshot.organizerName || post.authorName || '赛事主办方',
        organizerAvatar: post.authorPhoto || post.authorPhotoUrl || post.logo || profileMap[post.openid] || ''
      }
    }
  })
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    const [athleteRes, userRes] = await Promise.all([
      db.collection('athletes').where({ openid: OPENID }).limit(1).get(),
      db.collection('users').where({ openid: OPENID }).limit(1).get()
    ])
    const athlete = (athleteRes.data || [])[0] || {}
    const user = (userRes.data || [])[0] || {}
    const portrait = portraitState(athlete)
    const res = await db.collection('playerCards').where({ ownerOpenid: OPENID }).limit(100).get().catch(() => ({ data: [] }))
    const allCards = res.data || []
    const sourceIds = [...new Set(allCards.map(card => card.sourceId).filter(Boolean))]
    const certifiedSources = new Set()
    for (let index = 0; index < sourceIds.length; index += 20) {
      const sourceRes = await db.collection('posts')
        .where({ _id: _.in(sourceIds.slice(index, index + 20)), platformCertified: true, certificationStatus: 'approved', cardIssuanceEnabled: true })
        .field({ _id: true })
        .get()
        .catch(() => ({ data: [] }))
      ;(sourceRes.data || []).forEach(post => certifiedSources.add(post._id))
    }
    const invalidCards = allCards.filter(card => !certifiedSources.has(card.sourceId))
    await Promise.all(invalidCards.map(card => db.collection('playerCards').doc(card._id).update({
      data: {
        status: 'withdrawn',
        eligibilityStatus: 'withdrawn',
        packStatus: 'removed',
        isShowcased: false,
        shareEnabled: false,
        certificationStatus: 'revoked',
        withdrawReason: 'event_not_certified',
        updatedAt: db.serverDate()
      }
    })))
    const eligibleCards = allCards.filter(card => certifiedSources.has(card.sourceId))
    // 历史版本曾把未实名球员的卡片暂存为 awaiting_identity。
    // 现在认证赛事的实际出场球员无论是否实名都直接获得卡片。
    const waitingCards = eligibleCards.filter(card => card.status === 'awaiting_identity')
    await Promise.all(waitingCards.map(card => db.collection('playerCards').doc(card._id).update({
      data: { status: 'issued', eligibilityStatus: 'issued', packStatus: 'stored', issuedAtMs: Date.now(), issuedAt: db.serverDate(), updatedAt: db.serverDate() }
    })))
    const rawCards = eligibleCards
      .map(card => card.status === 'awaiting_identity'
        ? { ...card, status: 'issued', packStatus: 'stored' }
        : card)
      .filter(card => card.status === 'issued' && card.packStatus === 'stored')
      .sort((a, b) => (b.issuedAtMs || 0) - (a.issuedAtMs || 0))
    const cards = await attachOrganizerBadges(rawCards)
    return {
      code: 0,
      cards,
      showcaseCards: cards.filter(card => card.isShowcased && card.generationStatus === 'generated').sort((a, b) => (a.showcaseOrder || 99) - (b.showcaseOrder || 99)).slice(0, 6),
      unseenCount: cards.filter(card => !card.seen).length,
      // cardPortrait remains for clients that have not upgraded yet.
      cardPortrait: portrait.activePortrait,
      cardPortraits: portrait.portraits,
      activeCardPortrait: portrait.activePortrait,
      activeCardPortraitId: portrait.activePortraitId,
      cardPortraitQuota: portrait.quota
    }
  } catch (e) {
    return { code: -1, msg: e.message, cards: [], showcaseCards: [], unseenCount: 0 }
  }
}
