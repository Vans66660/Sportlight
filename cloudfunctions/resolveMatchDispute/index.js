const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { disputeId } = event
  if (!disputeId) return { code: -1, msg: '缺少 disputeId' }
  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    if (!userRes.data.length || userRes.data[0].userType !== 'admin') {
      return { code: -1, msg: '无权访问' }
    }
    const disputeRes = await db.collection('matchDisputes').doc(disputeId).get()
    const dispute = disputeRes.data || {}
    await db.collection('matchDisputes').doc(disputeId).update({
      data: { status: 'resolved', resolvedBy: OPENID, resolvedAt: db.serverDate(), updatedAt: db.serverDate() }
    })
    await writeAudit({ adminOpenid: OPENID, action: 'match_dispute_resolve', category: 'review', targetType: 'matchDispute', targetId: disputeId, targetName: dispute.athleteName || dispute.athleteOpenid || '', detail: { reason: dispute.reason || '', match: [dispute.teamA, dispute.teamB].filter(Boolean).join(' vs ') } })
    return { code: 0, msg: '已处理' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
