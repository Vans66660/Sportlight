const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

async function ensureAdmin(openid) {
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true })
    .limit(1)
    .get()
  const user = res.data[0]
  return user && user.userType === 'admin'
}

async function getTargetUser({ userId, openid }) {
  if (userId) {
    const res = await db.collection('users').doc(userId).get()
    return res.data || null
  }

  if (openid) {
    const res = await db.collection('users')
      .where({ openid })
      .limit(1)
      .get()
    return res.data[0] || null
  }

  return null
}

async function removeWhere(collection, condition) {
  try {
    const res = await db.collection(collection).where(condition).remove()
    return res.stats ? res.stats.removed : 0
  } catch (e) {
    return { error: e.message }
  }
}

async function removeDoc(collection, id) {
  try {
    const res = await db.collection(collection).doc(id).remove()
    return res.stats ? res.stats.removed : 0
  } catch (e) {
    return { error: e.message }
  }
}

function clearMember(member, openid) {
  if (!member || member.openid !== openid) return member
  return {
    openid: null,
    name: '',
    photoUrl: '',
    confirmed: false,
    role: member.role || 'member'
  }
}

async function cleanEventRegistrations(openid) {
  const deleted = []
  const updated = []
  const errors = []

  try {
    const ownedRes = await db.collection('event_registrations')
      .where(_.or([
        { openid },
        { athleteOpenid: openid },
        { captainOpenid: openid }
      ]))
      .limit(100)
      .get()

    for (const reg of ownedRes.data) {
      const result = await removeDoc('event_registrations', reg._id)
      if (typeof result === 'number') deleted.push(reg._id)
      else errors.push({ id: reg._id, error: result.error })
    }

    const memberRes = await db.collection('event_registrations')
      .where({ members: _.elemMatch({ openid }) })
      .limit(100)
      .get()

    for (const reg of memberRes.data) {
      if (deleted.includes(reg._id)) continue
      const members = (reg.members || []).map(member => clearMember(member, openid))
      const confirmedCount = members.filter(member => member && member.openid && member.confirmed).length
      await db.collection('event_registrations').doc(reg._id).update({
        data: {
          members,
          confirmedCount,
          updatedAt: db.serverDate()
        }
      })
      updated.push(reg._id)
    }
  } catch (e) {
    errors.push({ error: e.message })
  }

  return { deleted: deleted.length, updated: updated.length, errors }
}

async function cleanEventResults(openid) {
  const updated = []
  const deleted = []
  const errors = []

  try {
    const res = await db.collection('eventResults')
      .where({ results: _.elemMatch({ openid }) })
      .limit(100)
      .get()

    for (const doc of res.data) {
      const results = (doc.results || []).filter(result => result.openid !== openid)
      if (results.length === 0) {
        const result = await removeDoc('eventResults', doc._id)
        if (typeof result === 'number') deleted.push(doc._id)
        else errors.push({ id: doc._id, error: result.error })
      } else {
        await db.collection('eventResults').doc(doc._id).update({
          data: {
            results,
            updatedAt: db.serverDate()
          }
        })
        updated.push(doc._id)
      }
    }
  } catch (e) {
    errors.push({ error: e.message })
  }

  return { deleted: deleted.length, updated: updated.length, errors }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { userId, openid, confirm } = event

  if (!OPENID) {
    return { code: -1, msg: '无法识别调用者 OPENID，请从小程序端调用，不要直接用云函数测试面板执行硬删除' }
  }

  if (confirm !== 'HARD_DELETE') {
    return { code: -1, msg: '缺少硬删除确认参数 confirm=HARD_DELETE' }
  }

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '仅管理员可硬删除账号' }

    const target = await getTargetUser({ userId, openid })
    if (!target) return { code: -1, msg: '目标用户不存在' }

    const targetOpenid = target.openid
    const targetUserId = target._id
    if (!targetOpenid) return { code: -1, msg: '目标用户缺少 openid，无法安全清理关联数据' }
    if (targetOpenid === OPENID) return { code: -1, msg: '不能通过此函数硬删除当前管理员账号' }

    const summary = {
      targetUserId,
      targetOpenid,
      users: 0,
      bosses: 0,
      athletes: 0,
      posts: 0,
      comments: 0,
      orders: 0,
      messages: 0,
      conversations: 0,
      notifications: 0,
      fundsLedger: 0,
      eventRegistrations: null,
      eventResults: null
    }

    summary.bosses = await removeWhere('bosses', { openid: targetOpenid })
    summary.athletes = await removeWhere('athletes', { openid: targetOpenid })
    summary.posts = await removeWhere('posts', { openid: targetOpenid })
    summary.comments = await removeWhere('comments', { openid: targetOpenid })
    summary.orders = await removeWhere('orders', _.or([
      { bossOpenid: targetOpenid },
      { athleteOpenid: targetOpenid },
      { pendingAthleteOpenid: targetOpenid },
      { applicants: targetOpenid }
    ]))
    summary.messages = await removeWhere('messages', _.or([
      { fromOpenid: targetOpenid },
      { toOpenid: targetOpenid }
    ]))
    summary.conversations = await removeWhere('conversations', _.or([
      { bossOpenid: targetOpenid },
      { athleteOpenid: targetOpenid }
    ]))
    summary.notifications = await removeWhere('notifications', _.or([
      { fromOpenid: targetOpenid },
      { toOpenid: targetOpenid },
      { openid: targetOpenid }
    ]))
    summary.fundsLedger = await removeWhere('funds_ledger', _.or([
      { bossOpenid: targetOpenid },
      { athleteOpenid: targetOpenid },
      { 'payer.openid': targetOpenid }
    ]))
    summary.eventRegistrations = await cleanEventRegistrations(targetOpenid)
    summary.eventResults = await cleanEventResults(targetOpenid)
    summary.users = await removeDoc('users', targetUserId)

    await writeAudit({
      adminOpenid: OPENID,
      action: 'user_hard_delete',
      category: 'account',
      targetType: 'user',
      targetId: targetUserId,
      targetName: target.name || target.nickname || '',
      detail: {
        deletedCollections: {
          users: summary.users,
          athletes: summary.athletes,
          bosses: summary.bosses,
          posts: summary.posts,
          orders: summary.orders,
          messages: summary.messages
        }
      }
    })

    return {
      code: 0,
      msg: '账号已硬删除',
      summary
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
