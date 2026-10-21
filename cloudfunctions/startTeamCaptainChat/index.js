const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function chatIdFor(teamId, a, b) {
  return `teamchat_${teamId}_${[a, b].sort().join('_')}`.replace(/[^\w-]/g, '_').slice(0, 180)
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { teamId } = event || {}
  if (!teamId) return { code: -1, msg: '缺少球队ID' }

  try {
    const teamRes = await db.collection('teams').doc(teamId).get()
    const team = teamRes.data || {}
    const captainOpenid = team.captainOpenid || ''
    if (!captainOpenid) return { code: -1, msg: '球队队长不存在' }
    if (captainOpenid === OPENID) return { code: -1, msg: '你就是该球队队长' }

    const [meRes, captainRes] = await Promise.all([
      db.collection('users').where({ openid: OPENID }).limit(1).get(),
      db.collection('athletes').where({ openid: captainOpenid }).limit(1).get()
    ])
    if (!meRes.data.length) return { code: -1, msg: '请先登录注册' }
    const captain = captainRes.data[0] || {}

    const chatId = chatIdFor(teamId, OPENID, captainOpenid)
    await db.collection('conversations').doc(chatId).set({
      data: {
        orderId: chatId,
        bossOpenid: OPENID,
        athleteOpenid: captainOpenid,
        participants: [OPENID, captainOpenid],
        chatKind: 'team_captain',
        directChat: true,
        teamCaptainChat: true,
        teamId,
        teamName: team.name || '',
        title: `联系队长 · ${team.name || '球队'}`,
        lastMsg: '已打开队长沟通',
        lastMsgTime: db.serverDate(),
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })

    return { code: 0, orderId: chatId, chatKind: 'direct', title: `联系队长 · ${team.name || captain.name || '球队'}` }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
