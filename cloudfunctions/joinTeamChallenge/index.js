const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { challengeId, join = true } = event
  if (!challengeId) return { code: -1, msg: '缺少约战ID' }
  try {
    const res = await db.collection('teamChallenges').doc(challengeId).get()
    const challenge = res.data || {}
    if (challenge.status !== 'matched') return { code: -1, msg: '约战未达成，暂不能确认参战' }
    const teamId = (challenge.teamIds || []).find(id => {
      const members = id === challenge.homeTeamId ? challenge.homeMembers : challenge.awayMembers
      return (members || []).some(m => m.openid === OPENID)
    })
    if (!teamId) return { code: -1, msg: '你不是本场约战双方队员' }
    const memberSource = teamId === challenge.homeTeamId ? challenge.homeMembers : challenge.awayMembers
    const member = (memberSource || []).find(m => m.openid === OPENID) || {}
    const participants = (challenge.participants || []).filter(p => p.openid !== OPENID)
    if (join) {
      participants.push({
        openid: OPENID,
        teamId,
        teamName: teamId === challenge.homeTeamId ? challenge.homeTeamName : challenge.awayTeamName,
        name: member.name || '队员',
        avatar: member.avatar || '',
        score: member.score || 0,
        joinedAt: new Date()
      })
    }
    await db.collection('teamChallenges').doc(challengeId).update({ data: { participants, updatedAt: new Date() } })
    return { code: 0 }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
