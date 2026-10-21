const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isMissingCollection(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist')
}

async function getEventAdmin(postId, openid) {
  try {
    const res = await db.collection('eventAdmins')
      .where({ postId, adminOpenid: openid, status: 'accepted' })
      .limit(1)
      .get()
    return (res.data || [])[0] || null
  } catch (e) {
    if (isMissingCollection(e)) return null
    throw e
  }
}

function makeStandings(schedule) {
  const tableMap = {}
  ;(schedule.groups || []).forEach(group => {
    tableMap[group.name] = (group.teams || []).map(team => ({
      teamId: team.registrationId,
      teamName: team.teamName,
      played: 0,
      win: 0,
      loss: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      diff: 0,
      points: 0
    }))
  })
  ;(schedule.matches || []).forEach(match => {
    if (match.status !== 'finished') return
    const scoreA = Number(match.scoreA)
    const scoreB = Number(match.scoreB)
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) return
    const rows = tableMap[match.groupName] || []
    const teamA = rows.find(row => row.teamId === match.teamAId)
    const teamB = rows.find(row => row.teamId === match.teamBId)
    if (!teamA || !teamB) return
    teamA.played += 1
    teamB.played += 1
    teamA.pointsFor += scoreA
    teamA.pointsAgainst += scoreB
    teamB.pointsFor += scoreB
    teamB.pointsAgainst += scoreA
    if (scoreA > scoreB) {
      teamA.win += 1
      teamA.points += 2
      teamB.loss += 1
    } else if (scoreB > scoreA) {
      teamB.win += 1
      teamB.points += 2
      teamA.loss += 1
    } else {
      teamA.points += 1
      teamB.points += 1
    }
    teamA.diff = teamA.pointsFor - teamA.pointsAgainst
    teamB.diff = teamB.pointsFor - teamB.pointsAgainst
  })

  Object.keys(tableMap).forEach(groupName => {
    tableMap[groupName].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      if (b.diff !== a.diff) return b.diff - a.diff
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
      return a.teamName.localeCompare(b.teamName, 'zh-Hans-CN')
    })
    tableMap[groupName].forEach((row, index) => { row.rank = index + 1 })
  })
  return tableMap
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId } = event

  if (!postId) return { code: -1, msg: 'postId 缺失' }

  try {
    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    const eventAdmin = await getEventAdmin(postId, OPENID)
    const schedule = post.eventSchedule || null
    return {
      code: 0,
      post: {
        title: post.title || '',
        content: post.content || '',
        eventDate: post.eventDate || '',
        sport: post.sport || '',
        eventLocation: post.eventLocation || '',
        canManage: post.openid === OPENID || isAdmin || !!eventAdmin,
        canRecord: post.openid === OPENID || isAdmin || !!eventAdmin
      },
      schedule,
      standings: schedule ? makeStandings(schedule) : {}
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
