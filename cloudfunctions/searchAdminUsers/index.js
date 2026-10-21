const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function isAdmin(openid) {
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true })
    .limit(1)
    .get()
  return !!(res.data.length && res.data[0].userType === 'admin')
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatDate(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function maskPhone(phone) {
  const value = String(phone || '')
  return value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : ''
}

function maskOpenid(openid) {
  const value = String(openid || '')
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-6)}` : value
}

async function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const keyword = String((event && event.keyword) || '').trim()

  if (!await isAdmin(OPENID)) return { code: -1, msg: '无权限' }
  if (!keyword) return { code: 0, data: [] }

  try {
    const regex = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
    const userFields = {
      openid: true,
      name: true,
      nickname: true,
      displayName: true,
      userType: true,
      activityAdmin: true,
      permissions: true,
      registered: true,
      phone: true,
      purePhoneNumber: true,
      phoneVerified: true,
      realNameVerified: true,
      realNameStatus: true,
      sportlightId: true,
      createdAt: true,
      updatedAt: true
    }

    const userQueries = [
      db.collection('users').where({ phone: keyword }).field(userFields).limit(20).get(),
      db.collection('users').where({ purePhoneNumber: keyword }).field(userFields).limit(20).get(),
      db.collection('users').where({ openid: keyword }).field(userFields).limit(20).get(),
      db.collection('users').where({ sportlightId: keyword }).field(userFields).limit(20).get(),
      db.collection('users').where({ name: regex }).field(userFields).limit(20).get(),
      db.collection('users').where({ nickname: regex }).field(userFields).limit(20).get(),
      db.collection('users').where({ displayName: regex }).field(userFields).limit(20).get()
    ]

    const userResults = await Promise.all(userQueries.map(p => p.catch(() => ({ data: [] }))))
    const userMap = {}
    userResults.forEach(res => {
      ;(res.data || []).forEach(user => {
        if (user.openid) userMap[user.openid] = { ...(userMap[user.openid] || {}), ...user }
      })
    })

    const openids = Object.keys(userMap).slice(0, 50)
    let athleteMap = {}
    if (openids.length > 0) {
      const athleteRes = await db.collection('athletes')
        .where({ openid: _.in(openids) })
        .field({
          openid: true,
          name: true,
          nickname: true,
          displayName: true,
          sportlightId: true,
          sport: true,
          city: true,
          currentTier: true,
          levelReviewStatus: true,
          proposedTier: true,
          competitionScore: true,
          phoneVerified: true
        })
        .limit(100)
        .get()
      ;(athleteRes.data || []).forEach(athlete => { athleteMap[athlete.openid] = athlete })
    }

    const data = openids.map(openid => {
      const user = userMap[openid] || {}
      const athlete = athleteMap[openid] || {}
      const name = user.name || user.displayName || user.nickname || athlete.name || athlete.displayName || athlete.nickname || ''
      const userType = user.userType || (athlete.openid ? 'athlete' : '')
      const activityAdmin = !!(user.activityAdmin || ((user.permissions || {}).activityAdmin))
      return {
        openid,
        openidMasked: maskOpenid(openid),
        userId: user._id || '',
        name,
        userType,
        activityAdmin,
        roleLabel: userType === 'admin' ? '管理员' : userType === 'boss' ? '老板' : userType === 'athlete' ? '运动员' : '未选择',
        registered: !!user.registered,
        registeredLabel: user.registered ? '已注册' : '未完成注册',
        phoneMasked: maskPhone(user.phone || user.purePhoneNumber || ''),
        phoneVerified: !!(user.phoneVerified || athlete.phoneVerified),
        realNameVerified: !!user.realNameVerified,
        realNameStatus: user.realNameStatus || '',
        sportlightId: user.sportlightId || athlete.sportlightId || '',
        sport: athlete.sport || '',
        city: athlete.city || user.city || '',
        tier: athlete.currentTier || '',
        levelReviewStatus: athlete.levelReviewStatus || 'none',
        proposedTier: athlete.proposedTier || '',
        competitionScore: athlete.competitionScore || 0,
        createdAtLabel: formatDate(user.createdAt),
        updatedAtLabel: formatDate(user.updatedAt)
      }
    })

    await writeAudit({
      adminOpenid: OPENID,
      action: 'admin_user_search',
      category: 'account',
      targetType: 'user_search',
      targetId: '',
      targetName: '',
      detail: { keywordType: /^SL\d+$/i.test(keyword) ? 'sportlight_id' : (/^1\d{10}$/.test(keyword) ? 'phone' : 'general'), resultCount: data.length }
    })

    return { code: 0, data }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
