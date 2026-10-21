const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 修改这里设置你的访问密钥
const API_KEY = 'sp-admin-2026'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8'
}

function resp(statusCode, data) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(data) }
}

function normalizeTier(tier) {
  const value = String(tier || '').trim()
  return !value || value === 'F' || value.startsWith('F') ? 'D' : value
}

// ── 查所有球员 ──
async function queryAthletes() {
  let all = []
  let skip = 0
  while (true) {
    const res = await db.collection('athletes').skip(skip).limit(100).get()
    all = all.concat(res.data)
    if (res.data.length < 100) break
    skip += 100
  }
  return all.map(a => ({
    openid: a.openid,
    name: a.name || '',
    sport: a.sport || '',
    position: a.position || '',
    city: a.city || '',
    currentTier: normalizeTier(a.currentTier || a.rank),
    competitionScore: a.competitionScore || 0,
    currentSeasonScore: a.currentSeasonScore || 0,
    marketValue: a.marketValue || 0,
    reputation: a.reputation || 80,
    acceptMatch: a.acceptMatch || false,
    acceptAd: false,
    matchPrice: a.matchPrice || 0,
    adPrice: 0,
    tags: a.tags || []
  }))
}

// ── 查近期赛事成绩 ──
async function queryEvents(limit = 50) {
  const res = await db.collection('eventResults')
    .orderBy('submittedAt', 'desc')
    .limit(limit)
    .get()
  return res.data.map(doc => ({
    postId: doc.postId,
    eventTitle: doc.eventTitle || '',
    eventDate: doc.eventDate || '',
    sport: doc.sport || '',
    submittedAt: doc.submittedAt,
    players: (doc.results || []).map(r => ({
      openid: r.openid,
      name: r.name || '',
      rank: r.rank,
      score: r.score,
      attended: r.attended !== false,
      stats: r.stats || {}
    }))
  }))
}

// ── 收入查询 ──
async function queryIncome(openid) {
  const condition = { status: 'done' }
  if (openid) condition.athleteOpenid = openid

  let all = []
  let skip = 0
  while (true) {
    const res = await db.collection('orders').where(condition).skip(skip).limit(100).get()
    all = all.concat(res.data)
    if (res.data.length < 100) break
    skip += 100
  }

  if (openid) {
    // 单个球员明细
    const matchOrders = all.filter(o => o.type !== 'ad')
    const totalIncome = matchOrders.reduce((s, o) => s + (o.price || 0), 0)
    const matchIncome = totalIncome
    const adIncome = 0
    const orders = matchOrders.map(o => ({
      orderId: o._id,
      title: o.title || '',
      type: o.type || '',
      price: o.price || 0,
      completedAt: o.completedAt || null
    })).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    return { openid, totalIncome, matchIncome, adIncome, orderCount: all.length, orders }
  }

  // 所有球员汇总
  const incomeMap = {}
  all.filter(o => o.type !== 'ad').forEach(o => {
    const id = o.athleteOpenid
    if (!incomeMap[id]) incomeMap[id] = { openid: id, totalIncome: 0, matchIncome: 0, adIncome: 0, orderCount: 0 }
    incomeMap[id].totalIncome += o.price || 0
    incomeMap[id].orderCount++
    incomeMap[id].matchIncome += o.price || 0
  })

  // 关联球员姓名
  const athletes = await queryAthletes()
  const nameMap = {}
  athletes.forEach(a => { nameMap[a.openid] = a.name })

  return Object.values(incomeMap)
    .map(r => ({ ...r, name: nameMap[r.openid] || '未知' }))
    .sort((a, b) => b.totalIncome - a.totalIncome)
}

// ── 汇总统计 ──
async function querySummary() {
  const [athletesRes, eventsRes] = await Promise.all([
    db.collection('athletes').count(),
    db.collection('eventResults').count()
  ])

  // 按段位分布统计
  const athletes = await queryAthletes()
  const tierCount = {}
  const sportCount = {}
  athletes.forEach(a => {
    const t = normalizeTier(a.currentTier)
    tierCount[t] = (tierCount[t] || 0) + 1
    const s = a.sport || '未知'
    sportCount[s] = (sportCount[s] || 0) + 1
  })

  const top10 = [...athletes]
    .sort((a, b) => b.competitionScore - a.competitionScore)
    .slice(0, 10)
    .map(a => ({ name: a.name, sport: a.sport, tier: normalizeTier(a.currentTier), score: a.competitionScore, marketValue: a.marketValue }))

  return {
    totalAthletes: athletesRes.total,
    totalEvents: eventsRes.total,
    tierDistribution: tierCount,
    sportDistribution: sportCount,
    top10ByScore: top10
  }
}

exports.main = async (event, context) => {
  // HTTP 触发器入口
  const method = event.httpMethod || ''
  if (method === 'OPTIONS') return resp(200, {})

  const params = event.queryStringParameters || {}
  const key = params.key || (event.headers || {})['x-api-key'] || ''

  if (key !== API_KEY) {
    return resp(401, { error: 'Unauthorized' })
  }

  const type = params.type || 'summary'

  try {
    if (type === 'athletes') {
      const data = await queryAthletes()
      return resp(200, { type, count: data.length, data })
    }
    if (type === 'events') {
      const limit = Math.min(parseInt(params.limit) || 50, 200)
      const data = await queryEvents(limit)
      return resp(200, { type, count: data.length, data })
    }
    if (type === 'summary') {
      const data = await querySummary()
      return resp(200, { type, data })
    }
    if (type === 'income') {
      const data = await queryIncome(params.openid || '')
      return resp(200, { type, data })
    }
    if (type === 'delete') {
      const { collection, id } = params
      const allowed = ['orders', 'posts', 'eventResults', 'messages']
      if (!collection || !allowed.includes(collection)) {
        return resp(400, { error: '非法集合，可选: ' + allowed.join('/') })
      }
      if (!id) return resp(400, { error: '缺少 id 参数' })
      await db.collection(collection).doc(id).remove()
      return resp(200, { ok: true, deleted: { collection, id } })
    }
    return resp(400, { error: 'type 参数无效，可选: summary / athletes / events / income / delete' })
  } catch (e) {
    return resp(500, { error: e.message })
  }
}
