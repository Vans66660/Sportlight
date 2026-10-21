const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function writeAudit(data) {
  return db.collection('adminAuditLogs').add({ data: { ...data, createdAt: db.serverDate() } }).catch(() => null)
}

async function ensureAdmin(openid) {
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true })
    .limit(1)
    .get()
  return !!(res.data.length && res.data[0].userType === 'admin')
}

async function removeWhere(collection, condition) {
  try {
    const res = await db.collection(collection).where(condition).remove()
    return res.stats ? res.stats.removed : 0
  } catch (e) {
    return 0
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const postId = String((event || {}).postId || '').trim()
  const confirm = (event || {}).confirm

  if (!postId) return { code: -1, msg: '缺少帖子ID' }
  if (confirm !== 'DELETE_POST') return { code: -1, msg: '缺少确认参数' }

  try {
    if (!await ensureAdmin(OPENID)) return { code: -1, msg: '无权限' }

    const postRes = await db.collection('posts').doc(postId).get()
    const post = postRes.data
    if (!post) return { code: -1, msg: '帖子不存在' }

    if (post.postType === 'event') {
      const [effectiveRegs, resultRes, ledgerRes] = await Promise.all([
        db.collection('event_registrations')
          .where({ postId, status: 'approved', paymentStatus: _.in(['paid', 'free', 'offline', 'unpaid']) })
          .limit(1)
          .get(),
        db.collection('eventResults').where({ postId }).limit(1).get(),
        db.collection('funds_ledger').where({ postId }).limit(1).get()
      ])

      if ((effectiveRegs.data || []).length || (resultRes.data || []).length || (ledgerRes.data || []).length) {
        return { code: -1, msg: '该赛事已有确认报名或资金记录，不能直接删除' }
      }

      await Promise.all([
        removeWhere('event_registrations', { postId }),
        removeWhere('eventResults', { postId }),
        removeWhere('notifications', { postId })
      ])
    }

    // 保留原帖快照，供管理员在保留期内恢复，避免误删不可逆。
    const postSnapshot = { ...post }
    delete postSnapshot._id
    await db.collection('deletedPosts').doc(postId).set({
      data: {
        postId,
        post: postSnapshot,
        deletedBy: OPENID,
        deletedAt: db.serverDate(),
        restoreUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    })

    await Promise.all([
      db.collection('posts').doc(postId).remove(),
      removeWhere('comments', { postId }),
      removeWhere('reports', { targetId: postId }),
      removeWhere('reports', { postId })
    ])
    await writeAudit({ adminOpenid: OPENID, action: 'post_delete', category: 'content', targetType: 'post', targetId: postId, targetName: String(post.content || post.title || '').slice(0, 80), detail: { postType: post.postType || '', authorOpenid: post.authorOpenid || post.openid || '', restoreUntil: '30天内可恢复' } })

    return { code: 0, msg: '已删除' }
  } catch (e) {
    return { code: -1, msg: e.message || '删除失败' }
  }
}
