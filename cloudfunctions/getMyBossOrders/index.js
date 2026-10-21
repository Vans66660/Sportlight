const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

async function getBossProfile(openid) {
  const [userRes, bossRes] = await Promise.all([
    db.collection('users').where({ openid }).field({ name: true, displayName: true, logo: true }).limit(1).get(),
    db.collection('bosses').where({ openid }).field({ name: true, displayName: true, logo: true }).limit(1).get().catch(() => ({ data: [] }))
  ])
  return {
    ...((userRes.data || [])[0] || {}),
    ...((bossRes.data || [])[0] || {})
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  try {
    const result = await db.collection('orders')
      .where({ bossOpenid: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()

    const orders = (result.data || []).filter(isRealOrder)
    if (orders.length === 0) return { code: 0, data: [] }

    // 获取老板自己的 logo
    const boss = await getBossProfile(OPENID)
    const rawLogo = boss.logo || ''

    let bossLogo = rawLogo
    if (rawLogo.startsWith('cloud://')) {
      const tempRes = await cloud.getTempFileURL({ fileList: [rawLogo] })
      bossLogo = tempRes.fileList[0].tempFileURL || rawLogo
    }

    const enriched = orders.map(o => ({
      ...o,
      bossLogo,
      bossName: boss.displayName || boss.name || ''
    }))

    return { code: 0, data: enriched }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
