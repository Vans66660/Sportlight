const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const DAILY_FREE_CONTACT_LIMIT = 3
const DAILY_PRO_CONTACT_LIMIT = 30

function dayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end, key: start.toISOString().slice(0, 10) }
}

function hasActivePro(user = {}) {
  const until = user.scoutProUntil || user.vipUntil || user.proUntil || ''
  if (!until) return false
  const date = new Date(until)
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now()
}

async function countTodayDirectContacts(bossOpenid) {
  const { start, end } = dayRange()
  const res = await db.collection('orders')
    .where({
      bossOpenid,
      directChat: true,
      countedAsDirectContact: true,
      createdAt: _.gte(start).and(_.lt(end))
    })
    .count()
    .catch(() => ({ total: 0 }))
  return Number(res.total) || 0
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { athleteOpenid } = event || {}

  if (!athleteOpenid) return { code: -1, msg: '运动员参数缺失' }
  if (athleteOpenid === OPENID) return { code: -1, msg: '不能和自己发起沟通' }

  try {
    const [bossRes, athleteRes] = await Promise.all([
      db.collection('users').where({ openid: OPENID }).limit(1).get(),
      db.collection('athletes').where({ openid: athleteOpenid }).limit(1).get()
    ])

    if (!bossRes.data.length) return { code: -1, msg: '请先注册老板账号' }
    const boss = bossRes.data[0]
    if (boss.userType !== 'boss' && boss.userType !== 'admin') return { code: -1, msg: '仅主办方可发起沟通' }
    if (!athleteRes.data.length) return { code: -1, msg: '运动员不存在' }
    const athlete = athleteRes.data[0]
    const isAdmin = boss.userType === 'admin'
    const isPro = hasActivePro(boss)
    const proLimit = Number(boss.proDailyContactLimit) || DAILY_PRO_CONTACT_LIMIT
    const contactLimit = isAdmin ? 9999 : (isPro ? proLimit : DAILY_FREE_CONTACT_LIMIT)

    const activeOrderRes = await db.collection('orders')
      .where({
        bossOpenid: OPENID,
        athleteOpenid,
        status: 'locked'
      })
      .limit(1)
      .get()

    const activeOrder = (activeOrderRes.data || []).find(o => !o.directChat)
    if (activeOrder) {
      const orderId = activeOrder._id
      const conversationUpdate = {
        lastMsg: '继续沟通',
        lastMsgTime: db.serverDate(),
        participants: [OPENID, athleteOpenid],
        directChat: true,
        chatKind: 'boss_athlete',
        title: `沟通 · ${athlete.displayName || athlete.nickname || athlete.name || '运动员'}`,
        updatedAt: db.serverDate()
      }
      try {
        await db.collection('conversations').doc(orderId).update({
          data: conversationUpdate
        })
      } catch (_) {
        await db.collection('conversations').doc(orderId).set({
          data: {
            ...conversationUpdate,
            orderId,
            bossOpenid: OPENID,
            athleteOpenid,
            createdAt: db.serverDate()
          }
        })
      }
      return { code: 0, orderId, reusedOrder: true }
    }

    const existing = await db.collection('orders')
      .where({
        bossOpenid: OPENID,
        athleteOpenid,
        directChat: true,
        status: 'open'
      })
      .limit(1)
      .get()

    let orderId = existing.data.length ? existing.data[0]._id : ''
    if (!orderId) {
      const used = await countTodayDirectContacts(OPENID)
      if (used >= contactLimit) {
        return {
          code: -2,
          reason: 'CONTACT_LIMIT_REACHED',
          msg: isPro ? '今日主动沟通额度已用完' : '今日免费沟通次数已用完',
          used,
          limit: contactLimit,
          isPro,
          upgradeRequired: !isPro
        }
      }
      const quota = dayRange()
      const orderRes = await db.collection('orders').add({
        data: {
          type: 'match',
          title: `沟通 · ${athlete.name || '运动员'}`,
          sport: athlete.sport || '',
          price: 0,
          mode: 'direct',
          rankReq: '不限',
          remark: '主办方从球员主页发起的沟通',
          city: athlete.city || '',
          date: '',
          location: '',
          bossOpenid: OPENID,
          athleteOpenid,
          directChat: true,
          countedAsDirectContact: true,
          contactQuotaDate: quota.key,
          contactQuotaUsedAfter: used + 1,
          contactQuotaLimit: contactLimit,
          status: 'open',
          statusLabel: '沟通中',
          paymentStatus: 'unpaid',
          createdAt: db.serverDate(),
          applicants: []
        }
      })
      orderId = orderRes._id
    }

    await db.collection('conversations').doc(orderId).set({
        data: {
          orderId,
          bossOpenid: OPENID,
          athleteOpenid,
          participants: [OPENID, athleteOpenid],
          directChat: true,
          chatKind: 'boss_athlete',
          title: `沟通 · ${athlete.displayName || athlete.nickname || athlete.name || '运动员'}`,
          lastMsg: '已发起沟通',
          lastMsgTime: db.serverDate(),
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })

    return { code: 0, orderId }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
