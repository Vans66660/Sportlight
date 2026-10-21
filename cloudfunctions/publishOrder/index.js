const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function checkTextSafe(content) {
  const text = String(content || '').trim()
  if (!text) return true
  const result = await cloud.openapi.security.msgSecCheck({
    content: text.slice(0, 500000)
  })
  const errCode = result.errCode !== undefined ? result.errCode : result.errcode
  if (errCode === 0) return true
  if (errCode === 87014) return false
  throw new Error('内容审核服务异常')
}

function normalizeRequirements(requirements = []) {
  return (Array.isArray(requirements) ? requirements : [])
    .map(item => ({
      position: String(item.position || '').trim(),
      count: Math.max(0, parseInt(item.count, 10) || 0)
    }))
    .filter(item => item.position && item.count > 0)
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { orderData } = event

  try {
    if (!orderData || orderData.type !== 'match') {
      return { code: -1, msg: '当前仅开放参赛雇佣需求' }
    }
    if (!['篮球', '足球', '羽毛球'].includes(orderData.sport)) {
      return { code: -1, msg: '当前仅支持篮球、足球和羽毛球赏金令' }
    }

    const playerRequirements = normalizeRequirements(orderData.playerRequirements)
    if (playerRequirements.length === 0) {
      return { code: -1, msg: '请填写球员需求' }
    }
    const requirementSummary = playerRequirements.map(item => `${item.position}${item.count}人`).join('、')

    const textToCheck = [
      orderData && orderData.title,
      orderData && orderData.remark,
      requirementSummary
    ].filter(Boolean).join(' ')
    const safe = await checkTextSafe(textToCheck)
    if (!safe) return { code: -1, msg: '内容含有违规信息，请修改后重试' }

    const order = {
      ...orderData,
      playerRequirements,
      skillTags: requirementSummary,
      bossOpenid: OPENID,
      status: 'open',
      statusLabel: '招募中',
      paymentStatus: 'unpaid', // unpaid → escrowed → released | refunded
      createdAt: db.serverDate(),
      applicants: [],
      athleteOpenid: ''
    }

    const result = await db.collection('orders').add({ data: order })

    return { code: 0, orderId: result._id }
  } catch (e) {
    if (e.message === '内容审核服务异常') {
      return { code: -1, msg: '内容审核暂不可用，请稍后重试' }
    }
    return { code: -1, msg: e.message }
  }
}
