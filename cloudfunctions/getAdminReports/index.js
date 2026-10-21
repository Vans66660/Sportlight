const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return res.data.length > 0 && res.data[0].userType === 'admin'
}

function isMissingCollection(err) {
  const msg = String((err && (err.message || err.errMsg)) || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const limit = Math.min(Math.max(Number(event.limit) || 30, 1), 50)
    const page = Math.max(Number(event.page) || 0, 0)
    let reportRes = { data: [] }
    try {
      reportRes = await db.collection('reports').orderBy('createdAt', 'desc').skip(page * limit).limit(limit).get()
    } catch (err) {
      if (!isMissingCollection(err)) throw err
    }

    const openids = []
    reportRes.data.forEach(report => {
      if (report.reporterOpenid) openids.push(report.reporterOpenid)
      if (report.targetOpenid) openids.push(report.targetOpenid)
    })

    let userMap = {}
    const uniqueOpenids = [...new Set(openids)]
    if (uniqueOpenids.length) {
      const [userRes, athleteRes] = await Promise.all([
        db.collection('users').where({ openid: db.command.in(uniqueOpenids) }).field({ openid: true, name: true, userType: true }).get(),
        db.collection('athletes').where({ openid: db.command.in(uniqueOpenids) }).field({ openid: true, name: true, photo: true, reputation: true }).get()
      ])
      userRes.data.forEach(user => { userMap[user.openid] = { name: user.name || '', userType: user.userType || '' } })
      athleteRes.data.forEach(athlete => {
        userMap[athlete.openid] = {
          ...(userMap[athlete.openid] || {}),
          name: athlete.name || (userMap[athlete.openid] && userMap[athlete.openid].name) || '',
          photo: athlete.photo || '',
          reputation: athlete.reputation || 80
        }
      })
    }

    const statusLabelMap = { pending: '待审核', warned: '已警告', deducted: '已扣分', rejected: '已驳回' }
    const data = reportRes.data.map(report => ({
      ...report,
      reporterName: (userMap[report.reporterOpenid] && userMap[report.reporterOpenid].name) || '未知用户',
      targetName: (userMap[report.targetOpenid] && userMap[report.targetOpenid].name) || '未知对象',
      targetPhoto: (userMap[report.targetOpenid] && userMap[report.targetOpenid].photo) || '',
      targetReputation: (userMap[report.targetOpenid] && userMap[report.targetOpenid].reputation) || '',
      statusLabel: statusLabelMap[report.status || 'pending'] || '待审核'
    }))

    return { code: 0, data, page, hasMore: reportRes.data.length === limit }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
