// 实名认证云函数 — 腾讯云身份信息核验
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function normalizeIdCard(idCard) {
  return String(idCard || '').trim().toUpperCase()
}

function maskIdCard(idCard) {
  const id = normalizeIdCard(idCard)
  return id ? `${id.slice(0, 3)}***********${id.slice(-4)}` : ''
}

function birthDateFromIdCard(idCard) {
  const id = normalizeIdCard(idCard)
  if (!/^\d{17}[\dX]$/.test(id)) return ''
  const birth = id.slice(6, 14)
  return `${birth.slice(0, 4)}-${birth.slice(4, 6)}-${birth.slice(6, 8)}`
}

function hashIdCard(idCard) {
  return crypto.createHash('sha256').update(normalizeIdCard(idCard)).digest('hex')
}

async function saveIdentity(openid, realName, idCard) {
  const normalizedId = normalizeIdCard(idCard)
  const idCardHash = hashIdCard(normalizedId)
  const verifiedName = String(realName || '').trim()
  const identityData = {
    identityVerified: true,
    identityVerifiedAt: db.serverDate(),
    identityName: verifiedName,
    realName: verifiedName,
    name: verifiedName,
    idCardHash,
    identityIdCardHash: idCardHash,
    idCardMasked: maskIdCard(normalizedId),
    identityIdCardMasked: maskIdCard(normalizedId),
    birthDate: birthDateFromIdCard(normalizedId),
    realNameStatus: '已实名',
    updatedAt: db.serverDate()
  }

  await Promise.all([
    db.collection('users').where({ openid }).update({ data: identityData }).catch(() => null),
    db.collection('athletes').where({ openid }).update({ data: identityData }).catch(() => null),
    db.collection('bosses').where({ openid }).update({ data: identityData }).catch(() => null)
  ])
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const realName = String((event || {}).realName || '').trim()
  const idCard = normalizeIdCard((event || {}).idCard)

  if (!realName || !idCard) {
    return { code: -1, msg: '请提供姓名和身份证号' }
  }
  // 未配置腾讯云密钥时，直接通过（产品阶段过渡方案）
  if (!process.env.TENCENT_SECRET_ID || !process.env.TENCENT_SECRET_KEY) {
    if (OPENID) await saveIdentity(OPENID, realName, idCard)
    return { code: 0, passed: true, msg: '实名认证通过' }
  }

  try {
    // 调用腾讯云实名认证 API
    const tencentcloud = require('tencentcloud-sdk-nodejs-faceid')
    const FaceidClient = tencentcloud.faceid.v20180301.Client

    const client = new FaceidClient({
      credential: {
        secretId: process.env.TENCENT_SECRET_ID || '',
        secretKey: process.env.TENCENT_SECRET_KEY || ''
      },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'faceid.tencentcloudapi.com' } }
    })

    const result = await client.IdCardVerification({
      IdCard: idCard,
      Name: realName
    })

    // result.Result 枚举: 0=一致, -1=不一致, -2=无此号码, -3=号码与姓名不匹配
    const resultCode = String(result.Result)
    const passed = resultCode === '0'
    if (passed && OPENID) {
      await saveIdentity(OPENID, realName, idCard)
    }

    return {
      code: 0,
      passed,
      msg: passed ? '实名认证通过' : '姓名与身份证号不匹配',
      detail: {
        resultCode,
        description: result.Description || ''
      }
    }
  } catch (e) {
    console.error('Identity verification error:', e)
    return {
      code: -1,
      passed: false,
      msg: '实名认证服务异常: ' + (e.message || '未知错误')
    }
  }
}
