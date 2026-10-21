const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureCollection(name) {
  try { await db.createCollection(name) } catch (e) {}
}

async function assertAdmin(openid) {
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true, isAdmin: true, role: true })
    .limit(1)
    .get()
  const user = (res.data || [])[0] || {}
  if (!(user.userType === 'admin' || user.isAdmin === true || user.role === 'admin')) {
    throw new Error('无管理员权限')
  }
}

function pickBossData(user) {
  const fields = [
    'openid', 'sportlightId', 'userType',
    'name', 'displayName', 'nickname', 'logo', 'avatarUrl',
    'bossType', 'city', 'phone', 'purePhoneNumber', 'countryCode',
    'description', 'wechatVerified', 'phoneVerified',
    'identityVerified', 'identityVerifiedAt', 'identityName',
    'identityIdCardHash', 'identityIdCardMasked',
    'realName', 'idCard', 'receiveMethod', 'wxpayBound',
    'companyName', 'creditCode', 'license', 'licenseVerified',
    'licenseVerifiedAt', 'legalType', 'legalName', 'legalIdCard',
    'agentName', 'agentIdCard', 'authLetter',
    'clubType', 'clubLogo',
    'ocrCompanyName', 'ocrCreditCode', 'ocrLegalPerson',
    'ocrAddress', 'ocrBusiness', 'ocrPeriod'
  ]
  const data = {}
  fields.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(user, key)) data[key] = user[key]
  })
  data.openid = user.openid
  data.userType = 'boss'
  data.updatedAt = db.serverDate()
  return data
}

async function upsertBoss(user) {
  const data = pickBossData(user)
  const res = await db.collection('bosses').where({ openid: user.openid }).update({ data })
  if (!res.stats || res.stats.updated === 0) {
    await db.collection('bosses').add({
      data: {
        ...data,
        createdAt: user.createdAt || db.serverDate()
      }
    })
    return 'created'
  }
  return 'updated'
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  try {
    await assertAdmin(OPENID)
    await ensureCollection('bosses')

    let skip = 0
    let created = 0
    let updated = 0
    while (true) {
      const res = await db.collection('users')
        .where({ userType: 'boss' })
        .skip(skip)
        .limit(100)
        .get()
      const users = res.data || []
      if (!users.length) break

      for (const user of users) {
        if (!user.openid) continue
        const action = await upsertBoss(user)
        if (action === 'created') created++
        else updated++
      }

      if (users.length < 100) break
      skip += 100
    }

    return { code: 0, data: { created, updated, total: created + updated } }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
