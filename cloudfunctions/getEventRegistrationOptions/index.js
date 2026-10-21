const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { postId } = event
  if (!postId) return { code: -1, msg: '赛事不存在' }
  try {
    const [postRes, teamsRes] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('teams').where({ captainOpenid: OPENID, status: db.command.neq('deleted') }).limit(10).get()
    ])
    const post = postRes.data
    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }
    if (post.eventStatus === 'closed' || post.eventStatus === 'full') return { code: -1, msg: '当前赛事无法报名' }
    if (post.registrationDeadline) {
      const deadline = new Date(post.registrationDeadline)
      deadline.setHours(23, 59, 59, 999)
      if (Date.now() > deadline.getTime()) return { code: -1, msg: '报名已截止' }
    }
    const teams = (teamsRes.data || []).filter(team => !post.sport || !team.sport || team.sport === post.sport).map(team => ({
      _id: team._id,
      name: team.name || '未命名球队',
      logo: team.logo || '',
      sport: team.sport || '',
      captainOpenid: team.captainOpenid,
      members: (team.members || []).filter(member => member && member.openid).map(member => ({ openid: member.openid, name: member.name || '', avatar: member.avatar || '', role: member.role || '' }))
    }))
    return { code: 0, post: { title: post.title || post.content?.slice(0, 30) || '赛事', sport: post.sport || '', registrationMode: post.registrationMode || 'team', registrationDeadline: post.registrationDeadline || '', minTeamSize: post.minTeamSize || post.teamSize || 1, maxTeamMembers: post.maxTeamMembers || post.teamSize || 0, teamSize: post.teamSize || 0 }, teams }
  } catch (e) { return { code: -1, msg: e.message } }
}
