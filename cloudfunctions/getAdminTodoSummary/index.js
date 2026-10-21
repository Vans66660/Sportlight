const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return !!((res.data || [])[0] && res.data[0].userType === 'admin')
}

async function count(collection, condition) {
  return db.collection(collection).where(condition).count().then(res => res.total || 0).catch(() => 0)
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!await ensureAdmin(OPENID)) return { code: -1, msg: '无权限' }

  try {
    const [venues, levels, reports, disputes, eventRegistrations] = await Promise.all([
      count('venues', { status: 'pending' }),
      count('athletes', { levelReviewStatus: 'pending' }),
      count('reports', { status: 'pending' }),
      count('matchDisputes', { status: 'pending' }),
      count('event_registrations', { status: 'pending' })
    ])
    return {
      code: 0,
      data: {
        venues,
        levels,
        reports,
        disputes,
        eventRegistrations,
        total: venues + levels + reports + disputes + eventRegistrations
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message || '待办加载失败' }
  }
}
