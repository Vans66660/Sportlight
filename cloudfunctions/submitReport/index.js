const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function checkTextSafe(content) {
  const text = String(content || '').trim()
  if (!text) return true
  const result = await cloud.openapi.security.msgSecCheck({ content: text.slice(0, 500000) })
  const errCode = result.errCode !== undefined ? result.errCode : result.errcode
  if (errCode === 0) return true
  if (errCode === 87014) return false
  throw new Error('内容审核服务异常')
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { targetType = 'athlete', targetOpenid = '', targetId = '', reason = '', scene = '' } = event || {}
  const trimmed = String(reason || '').trim().slice(0, 300)

  if (!targetOpenid && !targetId) return { code: -1, msg: '举报对象缺失' }
  if (!trimmed) return { code: -1, msg: '请填写举报原因' }
  if (targetOpenid && targetOpenid === OPENID) return { code: -1, msg: '不能举报自己' }

  try {
    const safe = await checkTextSafe(trimmed)
    if (!safe) return { code: -1, msg: '举报内容含有不适宜信息，请修改后重试' }

    const duplicate = await db.collection('reports')
      .where({
        reporterOpenid: OPENID,
        targetType,
        targetOpenid,
        targetId,
        status: 'pending'
      })
      .limit(1)
      .get()
    if (duplicate.data.length > 0) return { code: 0, msg: '已收到举报，请勿重复提交' }

    await db.collection('reports').add({
      data: {
        reporterOpenid: OPENID,
        targetType,
        targetOpenid,
        targetId,
        reason: trimmed,
        scene,
        status: 'pending',
        createdAt: db.serverDate()
      }
    })

    return { code: 0, msg: '举报已提交' }
  } catch (e) {
    if (e.message === '内容审核服务异常') return { code: -1, msg: '内容审核暂不可用，请稍后重试' }
    return { code: -1, msg: e.message }
  }
}
