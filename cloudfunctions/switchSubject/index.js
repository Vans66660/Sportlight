const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const SUBJECTS = ['athlete', 'boss', 'venue']

function normalizeSubjectTypes(types, activeUserType = '') {
  const list = Array.isArray(types) ? types.slice() : []
  if (SUBJECTS.includes(activeUserType)) list.push(activeUserType)
  return [...new Set(list.filter(type => SUBJECTS.includes(type)))]
}

async function hasSubject(openid, userType) {
  if (userType === 'athlete') {
    const res = await db.collection('athletes').where({ openid }).field({ _id: true }).limit(1).get().catch(() => ({ data: [] }))
    return (res.data || []).length > 0
  }
  if (userType === 'boss') {
    const res = await db.collection('bosses').where({ openid }).field({ _id: true }).limit(1).get().catch(() => ({ data: [] }))
    return (res.data || []).length > 0
  }
  if (userType === 'venue') {
    const res = await db.collection('venues').where({ ownerOpenid: openid }).field({ _id: true }).limit(1).get().catch(() => ({ data: [] }))
    return (res.data || []).length > 0
  }
  return false
}

async function inferSubjectTypes(openid, user) {
  const types = normalizeSubjectTypes(user && user.subjectTypes, user && user.userType)
  const checks = await Promise.all(SUBJECTS.map(type => hasSubject(openid, type)))
  checks.forEach((ok, index) => {
    if (ok) types.push(SUBJECTS[index])
  })
  return normalizeSubjectTypes(types)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userType = String(event.userType || '').trim()
  if (!OPENID) return { code: -1, msg: '无法获取微信身份' }

  // 允许切换到 admin，前提是用户曾经是管理员
  const isSwitchingToAdmin = userType === 'admin'
  if (!isSwitchingToAdmin && !SUBJECTS.includes(userType)) {
    return { code: -1, msg: '无效的主体类型' }
  }

  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    if (!userRes.data.length) return { code: -1, msg: '用户不存在' }

    const user = userRes.data[0]

    // ── 切回管理员 ──
    if (isSwitchingToAdmin) {
      if (!user.isPlatformAdmin) {
        return { code: -1, msg: '你不是管理员' }
      }
      await db.collection('users').where({ openid: OPENID }).update({
        data: {
          userType: 'admin',
          activeUserType: 'admin',
          registered: true,
          updatedAt: db.serverDate()
        }
      })
      return {
        code: 0,
        msg: 'success',
        user: {
          ...user,
          openid: OPENID,
          userType: 'admin',
          activeUserType: 'admin',
          registered: true,
          isPlatformAdmin: true
        }
      }
    }

    // ── 管理员切到 athlete/boss/venue ──
    if (user.isPlatformAdmin || user.userType === 'admin') {
      const hasData = await hasSubject(OPENID, userType)
      const subjectTypes = await inferSubjectTypes(OPENID, user)
      if (!subjectTypes.includes(userType) && !hasData) {
        return {
          code: 2,
          msg: '该主体还没有入驻',
          userType,
          subjectTypes
        }
      }
      await db.collection('users').where({ openid: OPENID }).update({
        data: {
          userType,
          activeUserType: userType,
          registered: true,
          isPlatformAdmin: true,
          subjectTypes: _.addToSet(userType),
          updatedAt: db.serverDate()
        }
      })
      return {
        code: 0,
        msg: 'success',
        user: {
          ...user,
          openid: OPENID,
          userType,
          activeUserType: userType,
          registered: true,
          isPlatformAdmin: true,
          subjectTypes: normalizeSubjectTypes(subjectTypes, userType)
        }
      }
    }

    // ── 普通用户切换 ──
    const subjectTypes = await inferSubjectTypes(OPENID, user)
    if (!subjectTypes.includes(userType)) {
      return {
        code: 2,
        msg: '该主体还没有入驻',
        userType,
        subjectTypes
      }
    }

    await db.collection('users').where({ openid: OPENID }).update({
      data: {
        userType,
        activeUserType: userType,
        registered: true,
        subjectTypes: _.addToSet(userType),
        updatedAt: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: 'success',
      user: {
        ...user,
        openid: OPENID,
        userType,
        activeUserType: userType,
        registered: true,
        subjectTypes: normalizeSubjectTypes(subjectTypes, userType)
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message || '切换失败' }
  }
}
