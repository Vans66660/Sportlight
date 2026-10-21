const crypto = require('crypto')
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function safeText(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength)
}

function publicCard(card) {
  const player = card.playerSnapshot || {}
  const match = card.matchSnapshot || {}
  return {
    cardId: card.cardId || card._id,
    cardType: card.cardType || 'match_base',
    frontImage: card.frontImage || '',
    backImage: card.backImage || '',
    playerSnapshot: {
      name: safeText(player.name, 40),
      position: safeText(player.position, 30),
      teamName: safeText(player.teamName, 60)
    },
    matchSnapshot: {
      eventTitle: safeText(match.eventTitle || match.title, 80),
      eventDate: safeText(match.eventDate || match.date || match.matchTime, 40),
      homeTeamName: safeText(match.homeTeamName, 60),
      awayTeamName: safeText(match.awayTeamName, 60),
      homeScore: Number.isFinite(Number(match.homeScore)) ? Number(match.homeScore) : null,
      awayScore: Number.isFinite(Number(match.awayScore)) ? Number(match.awayScore) : null
    },
    generatedAtMs: Number(card.generatedAtMs) || 0
  }
}

async function sourceIsCertified(card) {
  if (!card || !card.sourceId) return false
  const result = await db.collection('posts').doc(card.sourceId).get().catch(() => ({ data: null }))
  const post = result.data
  return !!(post && post.platformCertified === true &&
    post.certificationStatus === 'approved' && post.cardIssuanceEnabled === true)
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const action = safeText(event && event.action, 20)
  try {
    if (action === 'create') {
      const cardId = safeText(event && event.cardId, 160)
      if (!OPENID || !cardId) return { code: -1, msg: '登录状态或卡片参数无效' }
      const result = await db.collection('playerCards').doc(cardId).get().catch(() => ({ data: null }))
      const card = result.data
      if (!card || card.ownerOpenid !== OPENID) return { code: -1, msg: '卡片不存在或无权分享' }
      if (!await sourceIsCertified(card)) return { code: -1, msg: '赛事尚未认证或认证已取消，不能分享该卡片' }
      if (card.status !== 'issued' || card.packStatus !== 'stored' || card.generationStatus !== 'generated' || !card.frontImage) {
        return { code: -1, msg: '请先完成卡片生成，再进行分享' }
      }
      const shareCode = card.shareCode || crypto.randomBytes(18).toString('hex')
      const now = Date.now()
      await db.collection('playerCards').doc(card._id).update({
        data: {
          shareCode,
          shareEnabled: true,
          sharedAtMs: now,
          sharedAt: db.serverDate(),
          updatedAtMs: now,
          updatedAt: db.serverDate()
        }
      })
      return { code: 0, msg: '分享链接已准备好', shareCode, card: publicCard(card) }
    }

    if (action === 'read') {
      const shareCode = safeText(event && event.shareCode, 80)
      if (!shareCode) return { code: -1, msg: '分享链接无效' }
      const result = await db.collection('playerCards').where({ shareCode }).limit(1).get()
      const card = (result.data || [])[0]
      if (!card || !card.shareEnabled || card.status !== 'issued' || card.packStatus !== 'stored' ||
          card.generationStatus !== 'generated' || !card.frontImage) {
        return { code: -1, msg: '这张卡片已停止分享或不存在' }
      }
      if (!await sourceIsCertified(card)) return { code: -1, msg: '这张卡片对应赛事的认证已取消' }
      return { code: 0, card: publicCard(card) }
    }

    if (action === 'disable') {
      const cardId = safeText(event && event.cardId, 160)
      const result = await db.collection('playerCards').doc(cardId).get().catch(() => ({ data: null }))
      const card = result.data
      if (!card || card.ownerOpenid !== OPENID) return { code: -1, msg: '卡片不存在或无权操作' }
      await db.collection('playerCards').doc(card._id).update({
        data: { shareEnabled: false, updatedAtMs: Date.now(), updatedAt: db.serverDate() }
      })
      return { code: 0, msg: '已停止分享' }
    }

    return { code: -1, msg: '不支持的分享操作' }
  } catch (error) {
    console.error('sharePlayerCard failed', error)
    return { code: -1, msg: error.message || '卡片分享服务异常' }
  }
}
