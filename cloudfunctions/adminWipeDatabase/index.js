const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 要清空的集合列表（共12个）。users 放最后，避免中途失败时先删掉管理员记录。
const COLLECTIONS = [
  'athletes', 'posts', 'comments', 'orders',
  'messages', 'conversations', 'notifications', 'funds_ledger',
  'event_registrations', 'eventResults', 'event_payment_trades', 'users'
]

const WIPE_PHRASE = '清空Sportlight全部数据'

// 检查调用者是否为管理员
async function ensureAdmin(openid) {
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true })
    .limit(1)
    .get()
  const user = res.data[0]
  return user && user.userType === 'admin'
}

// 统计集合当前有多少条数据
async function countCollection(name) {
  try {
    const res = await db.collection(name).count()
    return res.total || 0
  } catch (e) {
    return { error: e.message }
  }
}

// 并发清空一个集合，每批100条，循环直到清空
async function wipeCollection(name) {
  let totalDeleted = 0
  let errors = []
  const MAX_LOOP = 200

  for (let i = 0; i < MAX_LOOP; i++) {
    try {
      const res = await db.collection(name).limit(100).get()
      if (res.data.length === 0) break

      // 并发删除整批（关键：不再逐条 await，速度快很多）
      const results = await Promise.allSettled(
        res.data.map(doc =>
          db.collection(name).doc(doc._id).remove()
        )
      )
      let batchDeleted = 0
      for (const r of results) {
        if (r.status === 'fulfilled') batchDeleted++
        else errors.push({ error: r.reason ? r.reason.message : 'unknown' })
      }
      totalDeleted += batchDeleted
      if (res.data.length < 100) break
    } catch (e) {
      errors.push({ batch: i, error: e.message })
      break
    }
  }
  return { deleted: totalDeleted, errors }
}

// 云函数入口
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  // 必须通过小程序端调用，才能获取 openid
  if (!OPENID) {
    return { code: -1, msg: '无法识别调用者，请从小程序端登录后调用' }
  }

  const { confirm, phrase } = event || {}

  // 安全口令校验，防止误触
  if (confirm !== 'NUCLEAR_WIPE') {
    return {
      code: -1,
      msg: '缺少确认口令。需在小程序传 confirm: "NUCLEAR_WIPE" 才能执行。\n⚠️ 此操作会清空全部数据，不可撤销！'
    }
  }
  if (phrase !== WIPE_PHRASE) {
    return { code: -1, msg: `确认短语错误。请输入：${WIPE_PHRASE}` }
  }

  try {
    // 权限校验
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '仅管理员可执行此操作' }

    // 先统计各集合数据量
    const before = {}
    for (const name of COLLECTIONS) {
      before[name] = await countCollection(name)
    }

    // 执行清空
    const results = {}
    for (const name of COLLECTIONS) {
      results[name] = await wipeCollection(name)
    }

    const totalDeleted = Object.values(results).reduce((sum, r) =>
      sum + (r.deleted || 0), 0)

    return {
      code: 0,
      msg: `数据库已清空。共删除 ${totalDeleted} 条记录。`,
      before,
      results,
      totalDeleted
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
