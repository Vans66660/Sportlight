const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId } = event

  try {
    const postRes = await db.collection('posts').doc(postId).get()
    const post = postRes.data

    if (post.openid !== OPENID) {
      return { code: -1, msg: '无权删除' }
    }

    if (post.postType === 'event') {
      const [effectiveRegs, resultRes, ledgerRes] = await Promise.all([
        db.collection('event_registrations')
          .where({ postId, status: 'approved', paymentStatus: _.in(['paid', 'free', 'offline', 'unpaid']) })
          .limit(1)
          .get(),
        db.collection('eventResults').where({ postId }).limit(1).get(),
        db.collection('funds_ledger').where({ postId }).limit(1).get()
      ])

      if (effectiveRegs.data.length > 0 || resultRes.data.length > 0 || ledgerRes.data.length > 0) {
        return { code: -1, msg: '该赛事已有确认报名或资金记录，不能直接删除，请改为关闭赛事' }
      }

      await Promise.all([
        db.collection('event_registrations').where({ postId }).remove(),
        db.collection('eventResults').where({ postId }).remove(),
        db.collection('notifications').where({ postId }).remove()
      ])
    }

    await Promise.all([
      db.collection('posts').doc(postId).remove(),
      db.collection('comments').where({ postId }).remove()
    ])

    return { code: 0 }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
