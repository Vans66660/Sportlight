const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return (res.data || []).some(user => user.userType === 'admin')
}

function dayStr(offset = 0) {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function inRange(dateLike, days) {
  const raw = dateLike && typeof dateLike.toDate === 'function' ? dateLike.toDate() : dateLike
  const time = raw instanceof Date ? raw.getTime() : new Date(raw || 0).getTime()
  return Number.isFinite(time) && Date.now() - time <= days * 86400000
}

async function safeCount(collection, where = null) {
  try {
    const query = where ? db.collection(collection).where(where) : db.collection(collection)
    const res = await query.count()
    return res.total || 0
  } catch (e) {
    return 0
  }
}

async function readAll(collection, fields = {}) {
  const batchSize = 100
  const data = []
  let skip = 0
  while (true) {
    const res = await db.collection(collection).field(fields).skip(skip).limit(batchSize).get().catch(() => ({ data: [] }))
    const list = res.data || []
    data.push(...list)
    if (list.length < batchSize) break
    skip += batchSize
  }
  return data
}

function amountOf(item) {
  if (Number.isFinite(Number(item.amount))) return Number(item.amount)
  if (Number.isFinite(Number(item.amountFen))) return Number(item.amountFen) / 100
  return 0
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    if (!(await ensureAdmin(OPENID))) return { code: -1, msg: '无权限' }

    const today = dayStr()
    const [users, athletes, venues, posts, registrations, bookings, orders, ledger] = await Promise.all([
      safeCount('users'),
      safeCount('athletes'),
      safeCount('venues'),
      safeCount('posts'),
      safeCount('event_registrations'),
      readAll('venueBookings', { date: true, status: true, paymentStatus: true, finishedAt: true, updatedAt: true }),
      safeCount('orders'),
      readAll('funds_ledger', { type: true, amount: true, amountFen: true, status: true, createdAt: true })
    ])

    const bookingList = bookings || []
    const ledgerList = ledger || []
    const incomingTypes = new Set(['payment', 'event_payment', 'solo_game_payment', 'solo_private_booking_payment', 'pro_subscription_payment', 'scout_report_payment'])
    const refundTypes = new Set(['refund', 'solo_game_refund'])
    const paidLedger = ledgerList.filter(item => incomingTypes.has(item.type) && ['success', 'paid', 'escrowed', 'completed'].includes(item.status || ''))
    const refundedLedger = ledgerList.filter(item => refundTypes.has(item.type) && ['success', 'paid', 'refunded', 'completed'].includes(item.status || ''))
    const grossReceipts = paidLedger.reduce((sum, item) => sum + amountOf(item), 0)
    const refunds = refundedLedger.reduce((sum, item) => sum + amountOf(item), 0)
    const todayReceipts = paidLedger.filter(item => inRange(item.createdAt, 1)).reduce((sum, item) => sum + amountOf(item), 0)
    const todayBookings = bookingList.filter(item => item.date === today)
    const recentUsers = await db.collection('users').where({ createdAt: _.gte(new Date(Date.now() - 7 * 86400000)) }).count().catch(() => ({ total: 0 }))

    return {
      code: 0,
      data: {
        cards: [
          { label: '总用户', value: users },
          { label: '运动员', value: athletes },
          { label: '球馆', value: venues },
          { label: '动态/赛事', value: posts },
          { label: '7日新增', value: recentUsers.total || 0 },
          { label: '今日约场', value: todayBookings.length },
          { label: '累计报名', value: registrations },
          { label: '平台收款', value: `¥${Math.round(grossReceipts * 100) / 100}` },
          { label: '累计退款', value: `¥${Math.round(refunds * 100) / 100}` },
          { label: '净收款', value: `¥${Math.round((grossReceipts - refunds) * 100) / 100}` }
        ],
        health: [
          { label: '待支付约场', value: bookingList.filter(item => item.status === 'pending_payment').length },
          { label: '托管中订单', value: bookingList.filter(item => ['paid', 'partial'].includes(item.paymentStatus)).length },
          { label: '近7日完成约场', value: bookingList.filter(item => item.status === 'finished' && inRange(item.finishedAt || item.updatedAt, 7)).length },
          { label: '全部悬赏订单', value: orders },
          { label: '今日平台收款', value: `¥${Math.round(todayReceipts * 100) / 100}` }
        ],
        generatedAt: new Date().toISOString(),
        financeSource: 'funds_ledger'
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
