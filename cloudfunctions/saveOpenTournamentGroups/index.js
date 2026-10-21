const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function normalizeSport(sport) {
  if (sport === '篮球' || sport === 'basketball') return 'basketball'
  if (sport === '羽毛球' || sport === 'badminton') return 'badminton'
  return 'football'
}

function mapTeam(reg) {
  return {
    teamId: reg._id,
    registrationId: reg._id,
    teamName: reg.teamName || '未命名队伍',
    captainOpenid: reg.captainOpenid || '',
    roster: (reg.members || []).filter(m => m && m.openid).map(m => ({
      openid: m.openid,
      name: m.name || '未命名球员',
      role: m.role || '',
      position: m.position || ''
    }))
  }
}

function isMissingCollection(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist')
}

async function getEventAdmin(postId, openid) {
  try {
    const res = await db.collection('eventAdmins').where({ postId, adminOpenid: openid, status: 'accepted' }).limit(1).get()
    return (res.data || [])[0] || null
  } catch (e) {
    if (isMissingCollection(e)) return null
    throw e
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { tournamentId, groups = [] } = event || {}
  if (!tournamentId) return { code: -1, msg: 'tournamentId 缺失' }
  if (!Array.isArray(groups) || groups.length === 0) return { code: -1, msg: '分组不能为空' }

  try {
    const [postRes, userRes, regsRes] = await Promise.all([
      db.collection('posts').doc(tournamentId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get(),
      db.collection('event_registrations')
        .where({ postId: tournamentId, status: 'approved' })
        .orderBy('approvedAt', 'asc')
        .limit(200)
        .get()
    ])
    const post = postRes.data
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    if (!post || post.postType !== 'event') return { code: -1, msg: '公开赛不存在' }
    const eventAdmin = await getEventAdmin(tournamentId, OPENID)
    if (!isAdmin && post.openid !== OPENID && !eventAdmin) return { code: -1, msg: '无权限保存分组' }

    const teams = regsRes.data.map(mapTeam)
    if (teams.length < 2) return { code: -1, msg: '至少 2 支已确认队伍才能分组' }

    const validTeamIds = new Set(teams.map(team => team.teamId))
    const seen = new Set()
    const cleanGroups = groups.map((group, index) => {
      const groupId = group.groupId || String.fromCharCode(65 + index)
      const teamIds = (group.teamIds || []).filter(teamId => {
        if (!validTeamIds.has(teamId) || seen.has(teamId)) return false
        seen.add(teamId)
        return true
      })
      return {
        groupId,
        groupName: group.groupName || groupId,
        teamIds
      }
    })

    if (cleanGroups.length === 0) return { code: -1, msg: '没有有效分组' }
    if (seen.size !== teams.length) return { code: -1, msg: '仍有队伍未分组，请检查后保存' }

    const prev = post.openTournament || {}
    const playoffMode = post.eventFormat === '双淘汰赛' ? 'split_knockout' : (prev.playoffMode || 'single_knockout')
    const knockout = playoffMode === 'split_knockout'
      ? {
          mode: 'split',
          brackets: (((prev.knockout || {}).brackets) || [
            { bracketId: 'upper', name: '淘汰赛一', qualifierRanks: [1, 2] },
            { bracketId: 'lower', name: '淘汰赛二', qualifierRanks: [3, 4] }
          ]).map((bracket, index) => ({
            bracketId: bracket.bracketId || (index === 0 ? 'upper' : 'lower'),
            name: bracket.name || (index === 0 ? '淘汰赛一' : '淘汰赛二'),
            qualifierRanks: bracket.qualifierRanks || (index === 0 ? [1, 2] : [3, 4]),
            championTeamId: '',
            championTeamName: ''
          }))
        }
      : {}
    const openTournament = {
      ...prev,
      format: 'cup_groups',
      playoffMode,
      sport: normalizeSport(prev.sport || post.sport),
      status: 'grouped',
      groupCount: cleanGroups.length,
      teams,
      groups: cleanGroups,
      matches: [],
      standings: {},
      leaderboards: {},
      knockout,
      knockoutMatches: [],
      groupedAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    await db.collection('posts').doc(tournamentId).update({
      data: { openTournament, updatedAt: db.serverDate() }
    })

    return { code: 0, msg: '分组已保存', openTournament }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
