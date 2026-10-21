const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function chooseGroupCount(teamCount) {
  if (teamCount >= 16) return Math.ceil(teamCount / 5)
  if (teamCount >= 8) return 2
  return 1
}

function buildGroups(teams, groupCount) {
  const groups = Array.from({ length: groupCount }, (_, index) => ({
    name: String.fromCharCode(65 + index),
    teams: []
  }))
  teams.forEach((team, index) => {
    groups[index % groupCount].teams.push(team)
  })
  return groups
}

function buildRoundRobinMatches(groups) {
  const matches = []
  groups.forEach(group => {
    let order = 1
    const teams = group.teams || []
    for (let i = 0; i < teams.length; i += 1) {
      for (let j = i + 1; j < teams.length; j += 1) {
        matches.push({
          matchId: `${group.name}-${order}`,
          stage: 'group',
          groupName: group.name,
          round: order,
          teamAId: teams[i].registrationId,
          teamAName: teams[i].teamName,
          teamBId: teams[j].registrationId,
          teamBName: teams[j].teamName,
          scoreA: null,
          scoreB: null,
          winnerTeamId: '',
          courtName: '',
          matchTime: '',
          status: 'pending'
        })
        order += 1
      }
    }
  })
  return matches
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, groupCount, advancePerGroup = 2, overwrite = false } = event

  if (!postId) return { code: -1, msg: 'postId 缺失' }

  try {
    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }
    if (post.openid !== OPENID && !isAdmin) return { code: -1, msg: '无权限' }
    if (post.eventSchedule && post.eventSchedule.matches && post.eventSchedule.matches.length > 0 && !overwrite) {
      return { code: -1, msg: '赛程已生成，如需重排请确认覆盖' }
    }

    const regsRes = await db.collection('event_registrations')
      .where({ postId, status: 'approved', paymentStatus: _.in(['paid', 'free', 'offline', 'unpaid']) })
      .orderBy('approvedAt', 'asc')
      .limit(200)
      .get()

    const teams = regsRes.data.map(reg => ({
      registrationId: reg._id,
      teamName: reg.teamName || '未命名队伍',
      captainOpenid: reg.captainOpenid || '',
      memberCount: reg.memberCount || (reg.members || []).filter(m => m.openid).length
    }))

    if (teams.length < 2) return { code: -1, msg: '至少 2 支已确认参赛队伍才能生成赛程' }

    const safeGroupCount = Math.max(1, Math.min(Number(groupCount) || chooseGroupCount(teams.length), teams.length))
    const safeAdvance = Math.max(1, Number(advancePerGroup) || 2)
    const groups = buildGroups(teams, safeGroupCount)
    const matches = buildRoundRobinMatches(groups)
    const schedule = {
      format: 'group_knockout',
      status: 'active',
      groupCount: safeGroupCount,
      advancePerGroup: safeAdvance,
      generatedTeamCount: teams.length,
      groups,
      matches,
      knockoutMatches: [],
      createdBy: OPENID,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    await db.collection('posts').doc(postId).update({
      data: { eventSchedule: schedule }
    })

    return { code: 0, msg: '赛程已生成', schedule }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
