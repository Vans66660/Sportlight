const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function getApplicationState(order, openid) {
  if (order.athleteOpenid === openid || order.pendingAthleteOpenid === openid) {
    return { status: 'approved', text: '报名已通过' }
  }
  if (Array.isArray(order.rejectedApplicants) && order.rejectedApplicants.includes(openid)) {
    return { status: 'rejected', text: '报名未通过' }
  }
  if (Array.isArray(order.applicants) && order.applicants.includes(openid)) {
    return { status: 'pending', text: '审核中' }
  }
  return { status: 'none', text: '' }
}

function isRealOrder(order) {
  return !(
    order.directChat ||
    order.teamCaptainChat ||
    order.chatKind ||
    order.mode === 'direct' ||
    order.mode === 'team_contact' ||
    order.type === 'team_contact'
  )
}

async function getBossProfiles(openids) {
  const ids = [...new Set((openids || []).filter(Boolean))]
  if (!ids.length) return {}

  const [userRes, bossRes] = await Promise.all([
    db.collection('users')
      .where({ openid: _.in(ids) })
      .field({ openid: true, name: true, displayName: true, logo: true })
      .get(),
    db.collection('bosses')
      .where({ openid: _.in(ids) })
      .field({ openid: true, name: true, displayName: true, logo: true })
      .get()
      .catch(() => ({ data: [] }))
  ])

  const map = {}
  ;(userRes.data || []).forEach(u => { map[u.openid] = u })
  ;(bossRes.data || []).forEach(b => { map[b.openid] = { ...(map[b.openid] || {}), ...b } })
  return map
}

exports.main = async (event, context) => {
  const { sport, page = 0, pageSize = 20 } = event
  const { OPENID } = cloud.getWXContext()

  try {
    const condition = { status: 'open', type: 'match' }
    if (sport && sport !== '全部') {
      condition.sport = sport
    }

    const result = await db.collection('orders')
      .where(condition)
      .skip(page * pageSize)
      .limit(pageSize)
      .orderBy('createdAt', 'desc')
      .get()

    const orders = (result.data || []).filter(isRealOrder)
    if (orders.length === 0) return { code: 0, data: [] }

    // 拼入老板 logo 和名称
    const bossOpenids = [...new Set(orders.map(o => o.bossOpenid).filter(Boolean))]
    const bossMap = await getBossProfiles(bossOpenids)

    // 收集所有 cloud:// logo fileID，转成临时链接（云函数有权限访问）
    const logoFileIDs = Object.values(bossMap)
      .map(u => u.logo)
      .filter(l => l && l.startsWith('cloud://'))

    const tempUrlMap = {}
    if (logoFileIDs.length > 0) {
      const tempRes = await cloud.getTempFileURL({ fileList: logoFileIDs })
      tempRes.fileList.forEach(f => { tempUrlMap[f.fileID] = f.tempFileURL })
    }

    const enriched = orders.map(o => {
      const boss = bossMap[o.bossOpenid]
      const rawLogo = (boss && boss.logo) || ''
      const application = getApplicationState(o, OPENID)
      return {
        ...o,
        bossLogo: tempUrlMap[rawLogo] || rawLogo,
        bossName: (boss && (boss.displayName || boss.name)) || '',
        isApplied: application.status !== 'none',
        applicationStatus: application.status,
        applicationStatusText: application.text
      }
    })

    return { code: 0, data: enriched }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
