const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const API_V3_KEY = process.env.WXPAY_API_V3_KEY || ''
const APPID = process.env.WXPAY_APPID || 'wxe030eaf6a9059fca'
const MCHID = process.env.WXPAY_MCHID || '1747444613'

function decryptResource(ciphertext, nonce, associatedData) {
  const key = Buffer.from(API_V3_KEY, 'utf8')
  const buf = Buffer.from(ciphertext, 'base64')
  const authTag = buf.slice(-16)
  const data = buf.slice(0, -16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'))
  decipher.setAuthTag(authTag)
  decipher.setAAD(Buffer.from(associatedData || '', 'utf8'))
  return JSON.parse(decipher.update(data, undefined, 'utf8') + decipher.final('utf8'))
}

const OK = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'SUCCESS', message: '成功' }) }
const FAIL = (msg) => ({ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'FAIL', message: msg }) })

exports.main = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' }

  try {
    const notification = JSON.parse(event.body || '{}')
    if (notification.event_type !== 'TRANSACTION.SUCCESS') return OK

    const { ciphertext, nonce, associated_data } = notification.resource
    const transaction = decryptResource(ciphertext, nonce, associated_data)

    const tradeNo = transaction.out_trade_no
    const wxTransactionId = transaction.transaction_id
    if (transaction.trade_state && transaction.trade_state !== 'SUCCESS') return OK
    if (transaction.appid && transaction.appid !== APPID) return FAIL('appid 不匹配')
    if (transaction.mchid && transaction.mchid !== MCHID) return FAIL('mchid 不匹配')

    const tradeRes = await db.collection('event_payment_trades')
      .where({ tradeNo })
      .limit(1).get()
    let trade = tradeRes.data[0]
    let reg

    if (trade) {
      const regDoc = await db.collection('event_registrations').doc(trade.registrationId).get()
      reg = regDoc.data
    } else {
      const regRes = await db.collection('event_registrations')
        .where({ lastTradeNo: tradeNo })
        .limit(1).get()
      if (regRes.data.length === 0) return FAIL('未找到对应报名记录')
      reg = regRes.data[0]
      trade = {
        tradeNo,
        registrationId: reg._id,
        postId: reg.postId,
        captainOpenid: reg.captainOpenid,
        status: 'legacy'
      }
    }
    const registrationId = reg._id

    // 幂等：已处理则直接返回
    if (reg.paymentStatus === 'paid') return OK

    if (reg.status !== 'approved' || reg.paymentStatus !== 'unpaid') {
      if (trade._id) {
        await db.collection('event_payment_trades').doc(trade._id).update({
          data: { status: 'unexpected', wxTransactionId, transaction, updatedAt: db.serverDate() }
        }).catch(e => console.error("eventPaymentNotify: 更新失败", e))
      }
      return OK
    }

    const postRes = await db.collection('posts').doc(reg.postId).get()
    const post = postRes.data
    const expectedAmountFen = trade.amountFen || Math.max(1, Math.round((post.entryFee || 0) * 100))
    const paidAmountFen = transaction.amount && typeof transaction.amount.total === 'number'
      ? transaction.amount.total
      : null
    if (paidAmountFen !== expectedAmountFen) {
      if (trade._id) {
        await db.collection('event_payment_trades').doc(trade._id).update({
          data: {
            status: 'amount_mismatch',
            expectedAmountFen,
            paidAmountFen,
            wxTransactionId,
            transaction,
            updatedAt: db.serverDate()
          }
        }).catch(e => console.error("eventPaymentNotify: 更新失败", e))
      }
      return FAIL('支付金额不匹配')
    }

    await db.collection('event_registrations').doc(registrationId).update({
      data: {
        paymentStatus: 'paid',
        paidAt: db.serverDate(),
        wxTransactionId
      }
    })

    if (trade._id) {
      await db.collection('event_payment_trades').doc(trade._id).update({
        data: {
          status: 'paid',
          wxTransactionId,
          paidAmountFen,
          paidAt: db.serverDate()
        }
      }).catch(e => console.error("eventPaymentNotify: 更新失败", e))
    }

    const newTeamCount = (post.registeredTeams || 0) + 1
    const postUpdate = { registeredTeams: _.inc(1) }
    if (post.maxTeams && newTeamCount >= post.maxTeams) {
      postUpdate.eventStatus = 'full'
    }

    await db.collection('posts').doc(reg.postId).update({ data: postUpdate })

    await db.collection('funds_ledger').add({
      data: {
        type: 'event_payment',
        registrationId,
        postId: reg.postId,
        captainOpenid: reg.captainOpenid,
        bossOpenid: post.openid,
        amount: post.entryFee || 0,
        wxTransactionId,
        status: 'escrowed',
        createdAt: db.serverDate()
      }
    }).catch(e => console.error("eventPaymentNotify: 更新失败", e))

    try {
      await db.collection('messages').add({
        data: {
          fromOpenid: 'system',
          toOpenid: reg.captainOpenid,
          type: 'text',
          content: `✅ 报名费已到账，「${reg.teamName}」参赛资格已确认！请到赛事详情页查看赛务联系二维码。`,
          createdAt: db.serverDate(),
          read: false
        }
      })

      // 通知其他队员
      const memberOnlyOpenids = (reg.memberOpenids || []).filter(id => id !== reg.captainOpenid)
      await Promise.all(memberOnlyOpenids.map(openid =>
        db.collection('messages').add({
          data: {
            fromOpenid: 'system',
            toOpenid: openid,
            type: 'text',
            content: `✅ 队长已完成支付，「${reg.teamName}」参赛资格已正式确认！赛事当天加油！🏆`,
            createdAt: db.serverDate(),
            read: false
          }
        })
      ))
    } catch (e) {}

    return OK
  } catch (e) {
    console.error('eventPaymentNotify error', e)
    return FAIL(e.message)
  }
}
