const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return res.data.length > 0 && res.data[0].userType === 'admin'
}

function clamp(value) {
  return Math.max(0, Math.min(100, value))
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { reportId, action, deductPoints = 0, note = '' } = event || {}
  if (!reportId) return { code: -1, msg: '缺少举报ID' }
  if (!['warn', 'deduct', 'reject'].includes(action)) return { code: -1, msg: '处理动作无效' }

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const reportRes = await db.collection('reports').doc(reportId).get()
    const report = reportRes.data || {}
    if (!report._id) return { code: -1, msg: '举报不存在' }
    if ((report.status || 'pending') !== 'pending') return { code: -1, msg: '该举报已处理' }

    let status = action === 'reject' ? 'rejected' : (action === 'warn' ? 'warned' : 'deducted')
    let finalReputation = null
    const points = Math.max(0, Math.round(Number(deductPoints) || 0))

    if (action === 'deduct') {
      if (points <= 0 || points > 100) return { code: -1, msg: '扣除分数需在1-100之间' }
      const athleteRes = await db.collection('athletes').where({ openid: report.targetOpenid }).limit(1).get()
      const athlete = athleteRes.data[0] || {}
      if (!athlete._id) return { code: -1, msg: '未找到被举报球员' }
      finalReputation = clamp((athlete.reputation || 80) - points)
      await db.collection('athletes').doc(athlete._id).update({
        data: {
          reputation: finalReputation,
          updatedAt: db.serverDate()
        }
      })
    }

    await db.collection('reports').doc(reportId).update({
      data: {
        status,
        action,
        deductPoints: action === 'deduct' ? points : 0,
        finalReputation,
        adminNote: String(note || '').slice(0, 300),
        reviewedBy: OPENID,
        reviewedAt: db.serverDate()
      }
    })
    await writeAudit({ adminOpenid: OPENID, action: 'report_review', category: 'review', targetType: 'report', targetId: reportId, targetName: report.targetName || report.targetOpenid || '', detail: { action, deductPoints: action === 'deduct' ? points : 0, finalReputation, note: String(note || '').slice(0, 300) } })

    if (report.targetOpenid && action !== 'reject') {
      const content = action === 'warn'
        ? `你的账号收到一次平台警告。原因：${report.reason || '违反平台规则'}`
        : `你的账号因举报审核成立被扣除 ${points} 点信誉分，当前信誉分 ${finalReputation}。原因：${report.reason || '违反平台规则'}`
      await db.collection('notifications').add({
        data: {
          fromOpenid: 'system',
          toOpenid: report.targetOpenid,
          type: action === 'warn' ? 'report_warning' : 'reputation_deducted',
          content,
          reportId,
          deductPoints: action === 'deduct' ? points : 0,
          finalReputation,
          createdAt: db.serverDate(),
          read: false
        }
      })
    }

    return { code: 0, msg: '处理完成' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
