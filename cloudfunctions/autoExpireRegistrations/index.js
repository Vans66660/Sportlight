const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async () => {
  const now = new Date()

  try {
    const expired = []

    // 过期未确认的队员邀请（24小时）
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000)
    const assemblingRes = await db.collection('event_registrations')
      .where({ status: 'assembling' })
      .limit(50).get()

    for (const reg of assemblingRes.data) {
      const expiredMembers = reg.members.filter(
        m => m.openid && !m.confirmed && m.invitedAt && new Date(m.invitedAt) < twentyFourHoursAgo
      )
      if (expiredMembers.length === 0) continue

      const expiredNames = expiredMembers.map(m => m.name).filter(Boolean)
      const expiredOpenids = expiredMembers.map(m => m.openid)
      const newMembers = reg.members.map(m => {
        if (m.openid && !m.confirmed && m.invitedAt && new Date(m.invitedAt) < twentyFourHoursAgo) {
          return { openid: null, name: '', photoUrl: '', confirmed: false, role: 'member' }
        }
        return m
      })

      try {
        await db.collection('event_registrations').doc(reg._id).update({
          data: {
            members: newMembers,
            memberOpenids: _.pullAll(expiredOpenids)
          }
        })
        await db.collection('messages').add({
          data: {
            fromOpenid: 'system',
            toOpenid: reg.captainOpenid,
            type: 'text',
            content: `⏰ 队员${expiredNames.length > 0 ? ' ' + expiredNames.join('、') : ''}未在 24 小时内确认，对应槽位已释放，请重新邀请`,
            createdAt: db.serverDate(),
            read: false
          }
        })
      } catch (e) {}
    }

    // assembling 超过 72 小时未满员，自动解散
    const seventyTwoHoursAgo = new Date(now - 72 * 60 * 60 * 1000)
    const staleAssemblingRes = await db.collection('event_registrations')
      .where({ status: 'assembling', createdAt: _.lt(seventyTwoHoursAgo) })
      .limit(50).get()

    for (const reg of staleAssemblingRes.data) {
      try {
        await db.collection('event_registrations').doc(reg._id).update({
          data: { status: 'expired', expiredAt: db.serverDate() }
        })
        await db.collection('messages').add({
          data: {
            fromOpenid: 'system',
            toOpenid: reg.captainOpenid,
            type: 'text',
            content: `⏰ 队伍「${reg.teamName}」超过 72 小时未完成组队，报名已自动取消。如仍有意参赛，请重新提交报名。`,
            createdAt: db.serverDate(),
            read: false
          }
        })
        const memberOnlyOpenids = (reg.memberOpenids || []).filter(id => id !== reg.captainOpenid)
        await Promise.all(memberOnlyOpenids.map(openid =>
          db.collection('messages').add({
            data: {
              fromOpenid: 'system',
              toOpenid: openid,
              type: 'text',
              content: `⏰ 队伍「${reg.teamName}」超过 72 小时未完成组队，报名已自动取消。`,
              createdAt: db.serverDate(),
              read: false
            }
          })
        ))
      } catch (e) {}
    }

    return { code: 0, expired: expired.length }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
