const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function ensureCollection(name) {
  try { await db.createCollection(name) } catch (e) {}
}

async function getAthlete(openid) {
  const res = await db.collection('athletes').where({ openid }).limit(1).get()
  return res.data[0] || {}
}

async function ensureCanCaptain(openid, editingTeamId) {
  const res = await db.collection('teams')
    .where({ captainOpenid: openid, status: _.neq('deleted') })
    .limit(5)
    .get()
  const other = (res.data || []).find(team => team._id !== editingTeamId)
  return !other
}

async function syncTeamNameRefs(teamId, cleanName) {
  const tasks = [
    db.collection('teamJoinRequests').where({ teamId }).update({ data: { teamName: cleanName } }).catch(() => null),
    db.collection('teamChallenges').where({ homeTeamId: teamId }).update({ data: { homeTeamName: cleanName, updatedAt: new Date() } }).catch(() => null),
    db.collection('teamChallenges').where({ awayTeamId: teamId }).update({ data: { awayTeamName: cleanName, updatedAt: new Date() } }).catch(() => null),
    db.collection('notifications').where({ teamId }).update({ data: { teamName: cleanName } }).catch(() => null),
    db.collection('conversations').where({ teamId, chatKind: 'team_captain' }).update({
      data: {
        teamName: cleanName,
        title: `联系队长 · ${cleanName}`,
        updatedAt: new Date()
      }
    }).catch(() => null)
  ]
  await Promise.all(tasks)
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const {
    teamId = '',
    name = '',
    sport = '',
    logo = '',
    cover = '',
    gallery = [],
    description = '',
    venueIds = [],
    recruitmentStatus = 'open'
  } = event

  const cleanName = String(name || '').trim()
  if (!cleanName) return { code: -1, msg: '请填写球队名称' }
  if (!['足球', '篮球', '羽毛球'].includes(sport)) return { code: -1, msg: '请选择运动类型' }
  if (!Array.isArray(venueIds) || venueIds.length > 3) return { code: -1, msg: '常驻球馆最多选择3个' }

  try {
    await ensureCollection('teams')
    const canCaptain = await ensureCanCaptain(OPENID, teamId)
    if (!canCaptain) return { code: -1, msg: '每个人只能担任一个球队队长' }

    const athlete = await getAthlete(OPENID)
    let venueRes = { data: [] }
    if (venueIds.length > 0) {
      venueRes = await db.collection('venues')
        .where({ _id: _.in(venueIds), status: 'approved' })
        .field({ name: true, city: true, address: true, latitude: true, longitude: true })
        .get()
      if ((venueRes.data || []).length !== venueIds.length) return { code: -1, msg: '常驻球馆必须选择已入驻并通过审核的球馆' }
    }

    const venues = venueIds.map(id => {
      const venue = venueRes.data.find(item => item._id === id) || {}
      return {
        venueId: id,
        name: venue.name || '',
        city: venue.city || '',
        address: venue.address || '',
        latitude: venue.latitude || 0,
        longitude: venue.longitude || 0
      }
    })

    const now = new Date()
    if (teamId) {
      const teamRes = await db.collection('teams').doc(teamId).get()
      const team = teamRes.data || {}
      if (team.captainOpenid !== OPENID) return { code: -1, msg: '只有队长可以编辑球队资料' }
      await db.collection('teams').doc(teamId).update({
        data: {
          name: cleanName,
          sport,
          logo,
          cover,
          gallery: Array.isArray(gallery) ? gallery.slice(0, 9) : [],
          description: String(description || '').slice(0, 300),
          venues,
          venueIds,
          recruitmentStatus: recruitmentStatus === 'closed' ? 'closed' : 'open',
          updatedAt: now
        }
      })
      if ((team.name || '') !== cleanName) {
        await syncTeamNameRefs(teamId, cleanName)
      }
      return { code: 0, teamId }
    }

    const member = {
      openid: OPENID,
      name: athlete.name || athlete.displayName || athlete.nickname || `用户${athlete.sportlightId || ''}`,
      avatar: athlete.photo || '',
      score: athlete.currentSeasonScore || athlete.competitionScore || 0,
      position: athlete.position || '',
      role: 'captain',
      joinedAt: now
    }

    const addRes = await db.collection('teams').add({
      data: {
        name: cleanName,
        sport,
        logo,
        cover,
        gallery: Array.isArray(gallery) ? gallery.slice(0, 9) : [],
        description: String(description || '').slice(0, 300),
        venues,
        venueIds,
        recruitmentStatus: recruitmentStatus === 'closed' ? 'closed' : 'open',
        captainOpenid: OPENID,
        memberOpenids: [OPENID],
        members: [member],
        averageScore: member.score || 0,
        status: 'active',
        recentChallenges: [],
        createdAt: now,
        updatedAt: now
      }
    })
    return { code: 0, teamId: addRes._id }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
