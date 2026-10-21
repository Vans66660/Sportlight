const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_SHOWCASE = 6

function uniqueIds(value) {
  const seen = new Set()
  return (Array.isArray(value) ? value : [])
    .map(id => String(id || '').trim())
    .filter(id => id && id.length <= 512 && !seen.has(id) && seen.add(id))
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  try {
    if (!OPENID) return { code: -1, msg: '登录状态无效' }
    const ownedRes = await db.collection('playerCards')
      .where({ ownerOpenid: OPENID })
      .limit(100)
      .get()
      .catch(() => ({ data: [] }))
    const ownedCards = ownedRes.data || []
    const sourceIds = [...new Set(ownedCards.map(card => card.sourceId).filter(Boolean))]
    const certifiedSources = new Set()
    for (let index = 0; index < sourceIds.length; index += 20) {
      const sourceRes = await db.collection('posts')
        .where({ _id: _.in(sourceIds.slice(index, index + 20)), platformCertified: true, certificationStatus: 'approved', cardIssuanceEnabled: true })
        .field({ _id: true })
        .get()
        .catch(() => ({ data: [] }))
      ;(sourceRes.data || []).forEach(post => certifiedSources.add(post._id))
    }
    const eligible = ownedCards.filter(card => (
      card.status === 'issued' &&
      card.packStatus === 'stored' &&
      // 历史卡片可能没有 generationStatus，但只要已有卡面即可展示。
      (card.generationStatus === 'generated' || !!(card.frontImage || card.coverImage || card.imageUrl)) &&
      // 卡片发放时已写入认证快照；为兼容早期赛事数据，优先使用实时认证，
      // 查询不到旧赛事时回退到卡片自身的已认证状态。
      (certifiedSources.has(card.sourceId) || card.certificationStatus === 'approved')
    ))
    const eligibleMap = new Map()
    eligible.forEach(card => {
      if (card._id) eligibleMap.set(card._id, card)
      if (card.cardId) eligibleMap.set(card.cardId, card)
    })

    let orderedIds
    if (event && event.action === 'toggle') {
      const cardId = String(event.cardId || '').trim()
      const targetCard = eligibleMap.get(cardId)
      if (!targetCard) return { code: -1, msg: '卡片不存在、尚未生成或当前不可展示' }
      orderedIds = eligible
        .filter(card => card.isShowcased)
        .sort((a, b) => (Number(a.showcaseOrder) || 99) - (Number(b.showcaseOrder) || 99))
        .map(card => card._id)
      const resolvedId = targetCard._id
      const index = orderedIds.indexOf(resolvedId)
      if (index >= 0) orderedIds.splice(index, 1)
      else orderedIds.push(resolvedId)
    } else {
      orderedIds = uniqueIds(
        uniqueIds(event && (event.cardIds || event.orderedCardIds))
          .map(id => (eligibleMap.get(id) || {})._id || id)
      )
    }

    if (orderedIds.length > MAX_SHOWCASE) return { code: -1, msg: '最多展示6张球星卡' }
    const invalidId = orderedIds.find(id => !eligibleMap.has(id))
    if (invalidId) return { code: -1, msg: '展示列表中包含无权操作或不可展示的卡片' }

    const orderMap = new Map(orderedIds.map((id, index) => [id, index + 1]))
    const now = Date.now()
    await Promise.all(ownedCards.map(card => {
      const order = orderMap.get(card._id)
      const nextShowcased = !!order
      if (!!card.isShowcased === nextShowcased &&
          (nextShowcased ? Number(card.showcaseOrder) === order : card.showcaseOrder == null)) {
        return Promise.resolve()
      }
      return db.collection('playerCards').doc(card._id).update({
        data: {
          isShowcased: nextShowcased,
          showcaseOrder: order || null,
          showcaseUpdatedAtMs: now,
          updatedAtMs: now,
          updatedAt: db.serverDate()
        }
      })
    }))

    const showcaseCards = orderedIds.map(id => ({
      ...eligibleMap.get(id),
      isShowcased: true,
      showcaseOrder: orderMap.get(id)
    }))
    return { code: 0, msg: '主页展示已更新', cardIds: orderedIds, showcaseCards }
  } catch (error) {
    console.error('updateMyCardShowcase failed', error)
    return { code: -1, msg: error.message || '更新展示失败' }
  }
}
