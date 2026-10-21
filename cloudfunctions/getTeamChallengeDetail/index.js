const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { challengeId } = event
  if (!challengeId) return { code: -1, msg: '缺少约战ID' }
  try {
    const res = await db.collection('teamChallenges').doc(challengeId).get()
    const challenge = res.data || {}
    if (!challenge._id) return { code: -1, msg: '约战不存在' }
    const myTeamsRes = await db.collection('teams').where({ memberOpenids: OPENID, status: _.neq('deleted') }).limit(5).get()
    const myTeams = myTeamsRes.data || []
    const captainTeams = myTeams.filter(team => team.captainOpenid === OPENID)
    const myTeamIds = myTeams.map(team => team._id)
    const isCreator = challenge.creatorOpenid === OPENID
    const isHomeCaptain = challenge.homeTeamId && captainTeams.some(team => team._id === challenge.homeTeamId)
    const isAwayCaptain = challenge.awayTeamId && captainTeams.some(team => team._id === challenge.awayTeamId)
    const isMember = (challenge.teamIds || []).some(id => myTeamIds.includes(id))
    const hasJoined = (challenge.participants || []).some(p => p.openid === OPENID)
    const canJoinBattle = challenge.status === 'matched' && isMember && !hasJoined
    const canDeclineBattle = challenge.status === 'matched' && isMember && hasJoined
    const canApply = challenge.status === 'open' && captainTeams.some(team => team._id !== challenge.homeTeamId)
    const canRespondDirect = challenge.status === 'invited' && isAwayCaptain
    const canConfirmApplication = challenge.status === 'pending_confirm' && isHomeCaptain
    return {
      code: 0,
      data: {
        ...challenge,
        isCreator,
        isHomeCaptain,
        isAwayCaptain,
        isMember,
        hasJoined,
        canJoinBattle,
        canDeclineBattle,
        canApply,
        canRespondDirect,
        canConfirmApplication,
        myCaptainTeams: captainTeams.map(team => ({ _id: team._id, name: team.name, logo: team.logo, averageScore: team.averageScore || 0 }))
      }
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
