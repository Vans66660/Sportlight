const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function getAdmin(openid) {
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true, name: true, nickname: true })
    .limit(1)
    .get()
  const user = (res.data || [])[0]
  return user && user.userType === 'admin' ? user : null
}

async function writeAudit(data) {
  return db.collection('adminAuditLogs')
    .add({ data: { ...data, createdAt: db.serverDate() } })
    .catch(() => null)
}

async function withdrawCards(postId, reason) {
  let withdrawn = 0
  let offset = 0
  const batchSize = 100
  while (true) {
    const res = await db.collection('playerCards')
      .where({ sourceId: postId })
      .skip(offset)
      .limit(batchSize)
      .get()
      .catch(() => ({ data: [] }))
    const cards = (res.data || []).filter(card => (
      card.sourceType === 'event_result' || card.sourceType === 'open_tournament_match'
    ))
    for (const card of cards) {
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
    if ((res.data || []).length < batchSize) break
    offset += batchSize
  }
  return withdrawn
}

async function syncCertifiedEvent(post, postId, adminOpenid) {
  const sourceType = post.openTournament ? 'open_tournament_match' : 'event_result'
  const data = { sourceType, sourceId: postId, recordedByOpenid: adminOpenid }
  if (sourceType === 'open_tournament_match') data.syncAll = true
  const res = await cloud.callFunction({ name: 'syncMatchCards', data })
    .catch(e => ({ result: { code: -1, msg: e.message || '补发卡片失败' } }))
  return res.result || { code: -1, msg: '补发卡片失败' }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const postId = String(event.postId || '').trim()
  const action = String(event.action || '').trim()
  const note = String(event.note || '').trim().slice(0, 300)

  if (!postId) return { code: -1, msg: '缺少赛事ID' }
  if (!['certify', 'cancel'].includes(action)) return { code: -1, msg: '无效操作' }

  try {
    const admin = await getAdmin(OPENID)
    if (!admin) return { code: -1, msg: '仅平台管理员可认证比赛' }

    const postRes = await db.collection('posts').doc(postId).get()
    const post = postRes.data
    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }

    const certified = action === 'certify'
    const previousStatus = post.certificationStatus || 'unverified'
    const certificationVersion = (Number(post.certificationVersion) || 0) + 1
    const patch = certified
      ? {
          platformCertified: true,
          certificationStatus: 'approved',
          cardIssuanceEnabled: true,
          certificationVersion,
          certifiedBy: OPENID,
          certifiedByName: admin.name || admin.nickname || '',
          certifiedAt: db.serverDate(),
          certificationNote: note,
          certificationCancelledBy: _.remove(),
          certificationCancelledAt: _.remove(),
          certificationCancelReason: _.remove(),
          updatedAt: db.serverDate()
        }
      : {
          platformCertified: false,
          certificationStatus: 'unverified',
          cardIssuanceEnabled: false,
          certificationVersion,
          certificationCancelledBy: OPENID,
          certificationCancelledAt: db.serverDate(),
          certificationCancelReason: note,
          updatedAt: db.serverDate()
        }

    await db.collection('posts').doc(postId).update({ data: patch })
    const cardSync = certified
      ? await syncCertifiedEvent(post, postId, OPENID)
      : { code: 0, issued: 0, pending: 0, withdrawn: await withdrawCards(postId, 'event_certification_revoked') }

    await writeAudit({
      adminOpenid: OPENID,
      adminName: admin.name || admin.nickname || '',
      action: certified ? 'event_certify' : 'event_certification_cancel',
      category: 'review',
      targetType: 'event',
      targetId: postId,
      targetName: String(post.title || post.content || '赛事').slice(0, 80),
      detail: {
        previousStatus,
        nextStatus: certified ? 'approved' : 'unverified',
        platformCertified: certified,
        cardIssuanceEnabled: certified,
        certificationVersion,
        note,
        cardSync
      }
    })

    return {
      code: 0,
      msg: certified ? '赛事已认证' : '已取消赛事认证',
      data: {
        postId,
        platformCertified: certified,
        certificationStatus: certified ? 'approved' : 'unverified',
        cardIssuanceEnabled: certified,
        certificationVersion,
        cardSync
      },
      cardSync
    }
  } catch (e) {
    return { code: -1, msg: e.message || '操作失败' }
  }
}
