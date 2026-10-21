const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function ensureAdmin(openid) {
  const res = await db.collection('users')
    .where({ openid })
    .field({ userType: true })
    .limit(1)
    .get()
  const user = res.data[0]
  return user && user.userType === 'admin'
}

async function removeWhere(collection, condition) {
  try {
    const res = await db.collection(collection).where(condition).remove()
    return res.stats ? res.stats.removed : 0
  } catch (e) {
    return { error: e.message }
  }
}

async function removeDoc(collection, id) {
  try {
    const res = await db.collection(collection).doc(id).remove()
    return res.stats ? res.stats.removed : 0
  } catch (e) {
    return { error: e.message }
  }
}

async function getEventMatches(title, limit) {
  const res = await db.collection('posts')
    .where(_.and([
      { postType: 'event' },
      _.or([
        { title },
        { content: title }
      ])
    ]))
    .limit(100)
    .get()

  return (res.data || [])
    .filter(post => (post.title || post.content || '') === title)
    .slice(0, limit)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const title = String((event && event.title) || '').trim()
  const limit = Math.max(1, Math.min(20, Number(event && event.limit) || 4))
  const confirm = event && event.confirm
  const dryRun = event && event.dryRun !== false

  if (!title) return { code: -1, msg: '缺少公开赛名称 title' }

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const matches = await getEventMatches(title, limit)
    const preview = matches.map(post => ({
      postId: post._id,
      title: post.title || '',
      content: post.content || '',
      sport: post.sport || '',
      eventDate: post.eventDate || '',
      eventLocation: post.eventLocation || '',
      authorName: post.authorName || '',
      registeredTeams: post.registeredTeams || 0,
      eventStatus: post.eventStatus || ''
    }))

    if (dryRun || confirm !== 'DELETE_EVENTS') {
      return {
        code: 0,
        dryRun: true,
        msg: `已找到 ${preview.length} 个名称为「${title}」的公开赛。确认删除时传 confirm=DELETE_EVENTS 且 dryRun=false。`,
        data: preview
      }
    }

    const postIds = matches.map(post => post._id)
    const summary = {
      title,
      targetCount: postIds.length,
      postIds,
      posts: 0,
      eventRegistrations: 0,
      eventResults: 0,
      notifications: 0,
      comments: 0,
      competitionScoreLogs: 0,
      fundsLedger: 0
    }

    for (const postId of postIds) {
      summary.eventRegistrations += await removeWhere('event_registrations', { postId })
      summary.eventResults += await removeWhere('eventResults', { postId })
      summary.notifications += await removeWhere('notifications', { postId })
      summary.comments += await removeWhere('comments', { postId })
      summary.competitionScoreLogs += await removeWhere('competitionScoreLogs', { postId })
      summary.fundsLedger += await removeWhere('funds_ledger', { postId })
      summary.posts += await removeDoc('posts', postId)
    }

    return { code: 0, msg: `已删除 ${summary.posts} 个公开赛`, summary }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
