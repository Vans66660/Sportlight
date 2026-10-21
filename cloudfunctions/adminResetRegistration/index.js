const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function ensureAdmin(openid) {
  if (!openid) return false
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true })
    .limit(1)
    .get()
  const user = res.data[0]
  return user && user.userType === 'admin'
}

async function getTargetUser({ userId, openid, athleteId }) {
  if (userId) {
    const res = await db.collection('users').doc(userId).get()
    return res.data || null
  }

  if (athleteId) {
    const athleteRes = await db.collection('athletes').doc(athleteId).get()
    const athlete = athleteRes.data || null
    if (!athlete || !athlete.openid) return null

    const userRes = await db.collection('users')
      .where({ openid: athlete.openid })
      .limit(1)
      .get()
    return userRes.data[0] || null
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { userId, openid, athleteId, confirm } = event

  if (!OPENID) {
    return { code: -1, msg: '无法识别调用者 OPENID，请从小程序端调用' }
  }

  if (confirm !== 'RESET_REGISTRATION') {
    return { code: -1, msg: '缺少重置确认参数 confirm=RESET_REGISTRATION' }
  }

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '仅管理员可重置用户注册状态' }

    const target = await getTargetUser({ userId, openid, athleteId })
    if (!target) return { code: -1, msg: '目标用户不存在' }
    if (!target.openid) return { code: -1, msg: '目标用户缺少 openid' }
    if (target.openid === OPENID) return { code: -1, msg: '不能重置当前管理员账号' }

    const userUpdate = {
      registered: false,
      userType: '',
      name: '',
      bossType: '',
      companyName: '',
      clubType: '',
      clubLogo: '',
      description: '',
      wechatVerified: false,
      updatedAt: db.serverDate()
    }

    await db.collection('users').doc(target._id).update({ data: userUpdate })

    const athleteRes = await db.collection('athletes')
      .where({ openid: target.openid })
      .remove()

    await db.collection('notifications')
      .where(_.or([
        { toOpenid: target.openid, type: _.in(['team_invite', 'solo_team_invite']) },
        { fromOpenid: target.openid, type: _.in(['team_invite', 'solo_team_invite']) }
      ]))
      .remove()

    return {
      code: 0,
      msg: '已重置为未注册状态',
      data: {
        userId: target._id,
        openid: target.openid,
        removedAthleteProfiles: athleteRes.stats ? athleteRes.stats.removed : 0
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
