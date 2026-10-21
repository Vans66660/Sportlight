const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

async function ensureAdmin(openid) {
  const userRes = await db.collection('users')
    .where({ openid })
    .field({ userType: true })
    .limit(1)
    .get()
  return userRes.data.length > 0 && userRes.data[0].userType === 'admin'
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { venueId, action, reason } = event || {}

  if (!venueId) return { code: -1, msg: '缺少球馆ID' }
  if (!['approve', 'reject'].includes(action)) return { code: -1, msg: '无效的审核动作' }

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const venueRes = await db.collection('venues').doc(venueId).get()
    const venue = venueRes.data || {}
    if (!venue._id) return { code: -1, msg: '球馆不存在' }

    const nextStatus = action === 'approve' ? 'approved' : 'rejected'
    const reviewData = {
      status: nextStatus,
      reviewedAt: db.serverDate(),
      reviewedBy: OPENID,
      updatedAt: db.serverDate()
    }
    if (action === 'reject') reviewData.rejectReason = String(reason || '').trim()
    if (action === 'approve') reviewData.rejectReason = ''

    await db.collection('venues').doc(venueId).update({ data: reviewData })
    await writeAudit({ adminOpenid: OPENID, action: 'venue_review', category: 'review', targetType: 'venue', targetId: venueId, targetName: venue.name || '', detail: { fromStatus: venue.status || 'pending', toStatus: nextStatus, reason: String(reason || '').trim() } })

    if (venue.ownerOpenid) {
      await db.collection('users')
        .where({ openid: venue.ownerOpenid })
        .update({
          data: {
            venueStatus: nextStatus,
            venueRejectReason: action === 'reject' ? String(reason || '').trim() : '',
            updatedAt: db.serverDate()
          }
        })
    }

    return { code: 0, msg: 'success' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
