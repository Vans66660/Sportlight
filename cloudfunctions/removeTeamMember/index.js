const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureCollection(name) {
  try { await db.createCollection(name) } catch (e) {}
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { teamId, memberOpenid } = event
  if (!teamId || !memberOpenid) return { code: -1, msg: '参数错误' }
  try {
    const teamRes = await db.collection('teams').doc(teamId).get()
    const team = teamRes.data || {}
    if (team.captainOpenid !== OPENID) return { code: -1, msg: '只有队长可以移除成员' }
    if (memberOpenid === OPENID) return { code: -1, msg: '不能移除队长' }
    const members = (team.members || []).filter(m => m.openid !== memberOpenid)
    const memberOpenids = (team.memberOpenids || []).filter(id => id !== memberOpenid)
    const averageScore = members.length ? Math.round(members.reduce((sum, m) => sum + Number(m.score || 0), 0) / members.length) : 0
    await db.collection('teams').doc(teamId).update({ data: { members, memberOpenids, averageScore, updatedAt: db.serverDate() } })
    await ensureCollection('notifications')
    await db.collection('notifications').add({
      data: {
        toOpenid: memberOpenid,
        type: 'team_member_removed',
        teamId,
        teamName: team.name || '',
        content: `你已被移出「${team.name || '球队'}」`,
        read: false,
        createdAt: db.serverDate()
      }
    })
    return { code: 0 }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
