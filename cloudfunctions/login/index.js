// cloudfunctions/login/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { ensureSportlightId, nextSportlightId } = require('./sportlight-id')

function normalizeSubjectTypes(types, activeUserType = '') {
  const allow = ['athlete', 'boss', 'venue']
  const list = Array.isArray(types) ? types.slice() : []
  if (allow.includes(activeUserType)) list.push(activeUserType)
  return [...new Set(list.filter(type => allow.includes(type)))]
}

async function inferSubjectTypes(openid, user) {
  const base = normalizeSubjectTypes(user && user.subjectTypes, user && user.userType)
  const [athleteRes, bossRes, venueRes] = await Promise.all([
    db.collection('athletes').where({ openid }).field({ _id: true }).limit(1).get().catch(() => ({ data: [] })),
    db.collection('bosses').where({ openid }).field({ _id: true }).limit(1).get().catch(() => ({ data: [] })),
    db.collection('venues').where({ ownerOpenid: openid }).field({ _id: true }).limit(1).get().catch(() => ({ data: [] }))
  ])
  if ((athleteRes.data || []).length) base.push('athlete')
  if ((bossRes.data || []).length) base.push('boss')
  if ((venueRes.data || []).length) base.push('venue')
  return normalizeSubjectTypes(base)
}

exports.main = async (event, context) => {
  let OPENID = ''
  let UNIONID = ''
  let APPID = ''

  // 路径一：从云函数调用上下文获取（标准方式）
  const wxContext = cloud.getWXContext()
  OPENID = wxContext.OPENID || ''
  APPID = wxContext.APPID || ''
  UNIONID = wxContext.UNIONID || ''

  // 路径二：如果上下文没有 openid，用 wx.login() 的 code 兜底
  if (!OPENID && event.code) {
    try {
      const sessionRes = await cloud.openapi.auth.code2Session({ code: event.code })
      if (sessionRes && sessionRes.openid) {
        OPENID = sessionRes.openid
        UNIONID = sessionRes.unionid || ''
      }
    } catch (e) {
      console.error('code2Session 失败:', e.message)
    }
  }

  if (!OPENID) {
    return { code: -2, msg: '无法获取微信身份，请确保在真机或开发者工具中测试' }
  }

  // 尝试查找已有用户（如果 users 集合查询失败则走创建路径）
  try {
    const userResult = await db.collection('users')
      .where({ openid: OPENID })
      .limit(1)
      .get()

    if (userResult.data.length > 0) {
      const user = userResult.data[0]
      const sportlightId = await ensureSportlightId(OPENID, user)
      const subjectTypes = await inferSubjectTypes(OPENID, user)
      const storedName = String(user.name || '').trim()
      const isAdmin = user.userType === 'admin'
      const inferredUserType = subjectTypes.includes(user.userType) || isAdmin
        ? (user.userType || '')
        : (subjectTypes[0] || '')
      const isRegistered = isAdmin || !!(storedName && inferredUserType)
      const activeUserType = isRegistered ? inferredUserType : ''
      if (subjectTypes.length || activeUserType !== user.userType || isRegistered !== !!user.registered) {
        await db.collection('users').where({ openid: OPENID }).update({
          data: {
            subjectTypes,
            userType: activeUserType,
            registered: isRegistered,
            updatedAt: db.serverDate()
          }
        }).catch(() => null)
      }
      return {
        code: 0,
        msg: 'exists',
        user: {
          _id: user._id,
          openid: OPENID,
          unionid: UNIONID || user.unionid || '',
          registered: isRegistered,
          userType: activeUserType,
          subjectTypes,
          activeUserType,
          isPlatformAdmin: !!user.isPlatformAdmin,
          activityAdmin: !!(user.activityAdmin || ((user.permissions || {}).activityAdmin)),
          name: storedName,
          sportlightId,
          nickname: user.nickname || '',
          displayName: user.nickname || (user.displayName && user.displayName !== user.name ? user.displayName : '') || `用户${sportlightId}`,
          nickName: user.nickName || '',
          phoneVerified: user.phoneVerified || false,
          gender: user.gender || 0,
          city: user.city || '',
          createdAt: user.createdAt || null
        }
      }
    }
  } catch (e) {
    // 查询失败（可能数据库触发器报错等），记录日志后当作新用户处理
    console.error('查询用户失败，当作新用户处理:', e.message)
  }

  // 新用户
  const newUser = {
    openid: OPENID,
    sportlightId: await nextSportlightId(OPENID),
    unionid: UNIONID || '',
    appid: APPID || '',
    userType: '',
    subjectTypes: [],
    registered: false,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
    nickName: '',
    nickname: '',
    displayName: '',
    phone: '',
    gender: 0
  }

  try {
    const addResult = await db.collection('users').add({ data: newUser })
    return {
      code: 0,
      msg: 'new',
      user: {
        _id: addResult._id,
        ...newUser
      }
    }
  } catch (e) {
    console.error('创建用户失败:', e)
    return {
      code: -1,
      msg: e.message || '服务器错误，请稍后重试'
    }
  }
}
