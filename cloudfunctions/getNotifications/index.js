const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { markRead = false } = event

  try {
    const res = await db.collection('notifications')
      .where({ toOpenid: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()

    const unreadCount = res.data.filter(n => !n.read).length

    if (markRead && unreadCount > 0) {
      await db.collection('notifications')
        .where({ toOpenid: OPENID, read: false })
        .update({ data: { read: true } })
    }

    const data = res.data.map(n => {
      let label = '系统通知'
      if (n.type === 'like') label = `${n.fromName || '有人'} 赞了你的动态 ❤️`
      else if (n.type === 'comment') label = `${n.fromName || '有人'} 评论了你 💬`
      else if (n.type === 'event_approved') label = '报名已通过 ✅'
      else if (n.type === 'event_approved_pay') label = `报名已通过，报名费 ¥${n.entryFee || ''} 由主办方自收`
      else if (n.type === 'event_rejected') label = '报名未通过 ❌'
      else if (n.type === 'event_registration_cancelled') label = '赛事报名已取消'
      else if (n.type === 'event_cancel_requested') label = '报名取消申请'
      else if (n.type === 'team_invite') label = `${n.captainName || '队长'} 邀请你参赛 🏆`
      else if (n.type === 'regular_team_event_invite') label = '球队赛事参赛确认'
      else if (n.type === 'solo_team_invite') label = `${n.captainName || '队长'} 邀请你加入队伍 🏆`
      else if (n.type === 'report_warning') label = '平台警告'
      else if (n.type === 'reputation_deducted') label = `信誉分扣除 ${n.deductPoints || ''}`
      else if (n.type === 'venue_game_completed') label = '约场完成，信誉分 +1'
      else if (n.type === 'team_join_request') label = '新的入队申请'
      else if (n.type === 'team_join_approved') label = '入队申请已通过'
      else if (n.type === 'team_join_rejected') label = '入队申请未通过'
      else if (n.type === 'team_challenge_invite') label = '球队约战邀请'
      else if (n.type === 'team_challenge_apply') label = '球队应战申请'
      else if (n.type === 'team_challenge_matched') label = '球队约战已达成'
      else if (n.type === 'friend_request') label = '新的好友申请'
      else if (n.type === 'friend_approved') label = '好友申请已通过'
      else if (n.type === 'team_member_invite') label = '球队入队邀请'
      else if (n.type === 'team_member_invite_accepted') label = '队员已接受邀请'
      else if (n.type === 'team_member_removed') label = '你已被移出球队'
      else if (n.type === 'team_captain_received') label = '你已成为队长'
      else if (n.type === 'team_captain_transferred') label = '球队队长已变更'
      else if (n.type === 'event_admin_invite') label = '赛事管理员邀请'
      else if (n.type === 'event_admin_accepted') label = '管理员邀请已接受'
      else if (n.type === 'event_admin_declined') label = '管理员邀请已拒绝'
      else if (n.type === 'event_admin_removed') label = '赛事管理员权限已移除'
      return { ...n, label, read: markRead ? true : n.read }
    })

    return { code: 0, data, unreadCount }
  } catch (e) {
    return { code: 0, data: [], unreadCount: 0 }
  }
}
