const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function maskOpenid(value) {
  const text = String(value || '')
  if (!text) return '未记录'
  if (text.length <= 10) return `${text.slice(0, 3)}***`
  return `${text.slice(0, 6)}...${text.slice(-4)}`
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const input = event || {}
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100)
  const page = Math.max(Number(input.page) || 0, 0)
  const category = String(input.category || 'all')
  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    if (!userRes.data.length || userRes.data[0].userType !== 'admin') return { code: -1, msg: '无权限' }
    const condition = category === 'all' ? {} : { category }
    const res = await db.collection('adminAuditLogs').where(condition).orderBy('createdAt', 'desc').skip(page * limit).limit(limit).get()
    const data = (res.data || []).map(({ adminOpenid, ...item }) => ({
      ...item,
      adminOpenidMasked: maskOpenid(adminOpenid)
    }))
    return { code: 0, data, hasMore: data.length === limit, page }
  } catch (e) {
    return { code: -1, msg: e.message || '操作记录加载失败' }
  }
}
