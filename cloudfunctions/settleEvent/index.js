const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const fs = require('fs')
const path = require('path')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MCHID = '1747444613'
const APPID = 'wxe030eaf6a9059fca'
const SERIAL_NO = '2CACD3222614672EA8F2B2366AB29C6A9FA4EBB6'
const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, 'apiclient_key.pem'), 'utf8')
const PLATFORM_EVENT_SETTLEMENT_ENABLED = false

function buildAuth(method, urlPath, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = crypto.randomBytes(16).toString('hex')
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(message)
  const signature = sign.sign({ key: PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, 'base64')
  return `WECHATPAY2-SHA256-RSA2048 mchid="${MCHID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${SERIAL_NO}",signature="${signature}"`
}

function wxpayRequest(method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : ''
    const auth = buildAuth(method, urlPath, body)
    const req = https.request({
      hostname: 'api.mch.weixin.qq.com',
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': auth, 'User-Agent': 'WechatPay-NodeJS' }
    }, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(buf) }) } catch (e) { resolve({ status: res.statusCode, data: buf }) } })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

exports.main = async (event, context) => {
  if (!PLATFORM_EVENT_SETTLEMENT_ENABLED) {
    return { code: -1, msg: '当前版本报名费由主办方自收，无需平台结算' }
  }

  const { OPENID } = cloud.getWXContext()
  const { postId } = event

  if (!postId) return { code: -1, msg: 'postId 缺失' }

  try {
    const postRes = await db.collection('posts').doc(postId).get()
    const post = postRes.data

    if (post.openid !== OPENID) return { code: -1, msg: '无权操作' }
    if (post.settled) return { code: -1, msg: '该赛事已结算' }
    if (!post.entryFee || post.entryFee <= 0) return { code: -1, msg: '免费赛事无需结算' }
    if (post.eventStatus !== 'closed') return { code: -1, msg: '请先录入成绩后再发起结算' }

    const paidRegs = await db.collection('event_registrations')
      .where({ postId, paymentStatus: 'paid' })
      .get()

    if (paidRegs.data.length === 0) return { code: -1, msg: '暂无平台已收款记录' }

    const totalAmount = paidRegs.data.length * (post.entryFee || 0)
    const totalFen = Math.round(totalAmount * 100)

    const batchNo = ('SET' + postId).slice(0, 32)
    const detailNo = ('SETD' + postId).slice(0, 32)

    const ledger = await db.collection('funds_ledger').add({
      data: {
        type: 'event_payout',
        postId,
        bossOpenid: OPENID,
        amount: totalAmount,
        teamCount: paidRegs.data.length,
        wxBatchNo: batchNo,
        status: 'pending',
        createdAt: db.serverDate()
      }
    })

    const result = await wxpayRequest('POST', '/v3/transfer/batches', {
      appid: APPID,
      out_batch_no: batchNo,
      batch_name: '探照灯赛事报名费结算',
      batch_remark: `赛事 ${post.title || postId} 结算`,
      total_amount: totalFen,
      total_num: 1,
      transfer_detail_list: [{
        out_detail_no: detailNo,
        transfer_amount: totalFen,
        transfer_remark: `赛事报名费结算，共${paidRegs.data.length}支队`,
        openid: OPENID
      }]
    })

    if (result.status === 200 || result.status === 202) {
      await Promise.all([
        db.collection('funds_ledger').doc(ledger._id).update({
          data: { status: 'success', wxBatchId: result.data.batch_id || '' }
        }),
        db.collection('posts').doc(postId).update({
          data: { settled: true, settledAt: db.serverDate(), settledAmount: totalAmount }
        })
      ])
      const eventTitle = post.content ? post.content.slice(0, 20) : '赛事'
      const allOpenids = new Set()
      paidRegs.data.forEach(reg => {
        (reg.memberOpenids || [reg.captainOpenid]).forEach(id => { if (id) allOpenids.add(id) })
      })
      await Promise.all([...allOpenids].map(openid =>
        db.collection('messages').add({
          data: {
            fromOpenid: 'system',
            toOpenid: openid,
            type: 'text',
            content: `🏆 赛事「${eventTitle}」已结束并完成结算，感谢参赛！`,
            createdAt: db.serverDate(),
            read: false
          }
        })
      ))

      return { code: 0, msg: `结算成功，¥${totalAmount} 将在1-3个工作日内到账`, amount: totalAmount }
    } else {
      console.error('event transfer failed', result)
      await db.collection('funds_ledger').doc(ledger._id).update({
        data: { status: 'failed', failReason: JSON.stringify(result.data) }
      })
      return { code: -1, msg: '转账失败：' + (result.data.message || JSON.stringify(result.data)) }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
