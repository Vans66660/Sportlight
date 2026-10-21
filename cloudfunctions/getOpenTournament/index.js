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

function ensureSportMatchFields(match, sport) {
  if (sport !== 'badminton') return match
  return {
    ...match,
    badminton: match.badminton || { homeScore: null, awayScore: null, playerStats: [] }
  }
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { tournamentId } = event
  if (!tournamentId) return { code: -1, msg: 'tournamentId 缺失' }

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
    if (!post || post.postType !== 'event') return { code: -1, msg: '公开赛不存在' }

    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    const eventAdmin = await getEventAdmin(tournamentId, OPENID)
    const canManage = isAdmin || post.openid === OPENID || !!eventAdmin
    const approvedTeams = regsRes.data.map(mapTeam)
    const matchRules = {
      teamSize: post.teamSize || 5,
      teamSizeLabel: post.teamSizeLabel || '',
      matchDuration: post.matchDuration || (post.sport === '篮球' ? 40 : (post.sport === '羽毛球' ? 60 : 90)),
      halfDuration: post.halfDuration || (post.sport === '篮球' ? 20 : (post.sport === '羽毛球' ? 30 : 45)),
      ...(((post.openTournament || {}).matchRules) || {})
    }
    const openTournament = post.openTournament || {
      format: '',
      sport: normalizeSport(post.sport),
      status: 'draft',
      matchRules,
      teams: approvedTeams,
      groups: [],
      matches: [],
      standings: {},
      leaderboards: {}
    }
    const sport = normalizeSport(openTournament.sport || post.sport)
    openTournament.matches = (openTournament.matches || []).map(match => ensureSportMatchFields(match, sport))
    openTournament.knockoutMatches = (openTournament.knockoutMatches || []).map(match => ensureSportMatchFields(match, sport))

    return {
      code: 0,
      canManage,
      tournament: {
        _id: post._id,
        title: post.title || post.content || '公开赛',
        organizerOpenid: post.openid,
        platformCertified: post.platformCertified === true && post.certificationStatus === 'approved' && post.cardIssuanceEnabled === true,
        certificationStatus: post.certificationStatus || 'unverified',
        sport,
        eventDate: post.eventDate || '',
        eventLocation: post.eventLocation || '',
        teamSize: post.teamSize || 5,
        teamSizeLabel: post.teamSizeLabel || '',
        matchDuration: matchRules.matchDuration,
        halfDuration: matchRules.halfDuration,
        eventFormat: post.eventFormat || '',
        openTournament: {
          ...openTournament,
          matchRules: {
            ...matchRules,
            ...((openTournament && openTournament.matchRules) || {})
          },
          teams: openTournament.teams && openTournament.teams.length ? openTournament.teams : approvedTeams
        }
      },
      approvedTeams
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
