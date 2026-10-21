const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const SEED_TAG = 'sportlight-football-demo-v2-24-teams'

const TEAM_NAMES = [
  '北京国安草根队',
  '朝阳飞鹰队',
  '望京星期三',
  '海淀闪电',
  '丰台铁卫',
  '通州远航',
  '西城红墙',
  '东城猎风',
  '石景山矿工',
  '昌平北极星',
  '顺义空港',
  '大兴火箭',
  '房山山鹰',
  '门头沟山谷',
  '怀柔雁栖',
  '密云水库',
  '延庆长城',
  '亦庄引擎',
  '奥森夜跑',
  '工体老友',
  '五棵松热浪',
  '中关村代码队',
  '亮马桥浪潮',
  '三里屯星期六'
]

const POSITIONS = ['前锋', '中场', '后卫', '边锋', '门将']

function getTier(score) {
  if (score >= 1800) return 'S'
  if (score >= 1600) return 'A'
  if (score >= 1400) return 'B'
  if (score >= 1200) return 'C'
  if (score >= 1000) return 'D'
  return 'D'
}

function makePlayer(teamIndex, memberIndex) {
  const openid = `demo24_team_${String(teamIndex + 1).padStart(2, '0')}_p${memberIndex + 1}`
  const rating = 980 + teamIndex * 18 + memberIndex * 22
  return {
    openid,
    name: `${TEAM_NAMES[teamIndex]}${memberIndex === 0 ? '队长' : `球员${memberIndex + 1}`}`,
    position: POSITIONS[memberIndex % POSITIONS.length],
    rating
  }
}

const teamDefs = TEAM_NAMES.map((name, teamIndex) => {
  const members = Array.from({ length: 5 }, (_, memberIndex) => makePlayer(teamIndex, memberIndex))
  return {
    name,
    captain: members[0].openid,
    members
  }
})

function makeMembers(team) {
  return team.members.map((player, index) => ({
    openid: player.openid,
    name: player.name,
    photoUrl: '',
    confirmed: true,
    role: index === 0 ? 'captain' : 'member',
    position: player.position
  }))
}

async function ensureAdmin(openid) {
  const userRes = await db.collection('users')
    .where({ openid })
    .field({ userType: true, name: true, logo: true })
    .limit(1)
    .get()
  const user = userRes.data[0]
  if (!user || user.userType !== 'admin') {
    throw new Error('仅平台管理员可生成测试数据')
  }
  return user
}

async function ensureAthletes() {
  for (const team of teamDefs) {
    for (const player of team.members) {
      const athleteData = {
        openid: player.openid,
        name: player.name,
        gender: '男',
        city: '北京',
        affiliation: team.name,
        sport: '足球',
        position: player.position,
        acceptMatch: true,
        acceptAd: false,
        matchPrice: 0,
        adPrice: 0,
        photo: '',
        currentTier: getTier(player.rating),
        competitionScore: player.rating,
        currentSeasonScore: player.rating,
        rank: getTier(player.rating),
        rating: player.rating,
        reputation: 80,
        marketValue: 0,
        socials: [],
        honors: [],
        highlights: [],
        seedTag: SEED_TAG,
        updatedAt: db.serverDate()
      }

      const existing = await db.collection('athletes').where({ openid: player.openid }).limit(1).get()
      if (existing.data.length) {
        await db.collection('athletes').doc(existing.data[0]._id).update({ data: athleteData })
      } else {
        await db.collection('athletes').add({ data: { ...athleteData, createdAt: db.serverDate() } })
      }

      const userData = {
        openid: player.openid,
        userType: 'athlete',
        registered: true,
        name: player.name,
        nickName: player.name,
        phone: '',
        sport: '足球',
        seedTag: SEED_TAG,
        updatedAt: db.serverDate()
      }
      const userExisting = await db.collection('users').where({ openid: player.openid }).limit(1).get()
      if (userExisting.data.length) {
        await db.collection('users').doc(userExisting.data[0]._id).update({ data: userData })
      } else {
        await db.collection('users').add({ data: { ...userData, createdAt: db.serverDate() } })
      }
    }
  }
}

async function ensurePost(openid, adminUser) {
  const postData = {
    openid,
    authorId: '',
    authorName: adminUser.name || 'Sportlight 平台',
    authorPhoto: adminUser.logo || '',
    authorType: 'boss',
    postType: 'event',
    type: 'event',
    title: 'Sportlight 24队足球赛程演示',
    content: '24支队伍赛程演示：6个小组，每组4队，小组循环赛，部分比分已预填用于查看积分榜。',
    images: [],
    banner: '',
    captainGroupQr: 'demo-event-contact-qr',
    sport: '足球',
    eventDate: '2026-07-20',
    eventLocation: '北京 · Sportlight 测试球场',
    eventFormat: '小组赛 + 淘汰赛',
    registrationMode: 'team',
    teamSize: 5,
    minTeamSize: 5,
    maxTeamMembers: 5,
    teamSizeLabel: '五人制',
    maxTeams: 24,
    registeredTeams: 24,
    pendingTeams: 0,
    registrationDeadline: '2026-07-19',
    entryFee: 0,
    prizes: [
      { label: '冠军', amount: 3000, medal: '🥇' },
      { label: '亚军', amount: 1500, medal: '🥈' },
      { label: '季军', amount: 800, medal: '🥉' }
    ],
    approvalType: 'manual',
    eventStatus: 'open',
    likesCount: 0,
    likedBy: [],
    seedTag: SEED_TAG,
    updatedAt: db.serverDate()
  }

  const existing = await db.collection('posts').where({ seedTag: SEED_TAG, postType: 'event' }).limit(1).get()
  if (existing.data.length) {
    await db.collection('posts').doc(existing.data[0]._id).update({ data: postData })
    return existing.data[0]._id
  }

  const addRes = await db.collection('posts').add({
    data: { ...postData, createdAt: db.serverDate() }
  })
  return addRes._id
}

async function ensureRegistrations(postId) {
  const regIds = []

  for (const team of teamDefs) {
    const memberOpenids = team.members.map(player => player.openid)
    const regData = {
      postId,
      registrationType: 'team',
      captainOpenid: team.captain,
      teamName: team.name,
      teamNameKey: team.name.toLowerCase(),
      members: makeMembers(team),
      memberOpenids,
      memberCount: memberOpenids.length,
      inviteCode: `demo24-${team.captain}`,
      status: 'approved',
      paymentStatus: 'free',
      approvedAt: db.serverDate(),
      seedTag: SEED_TAG,
      updatedAt: db.serverDate()
    }

    const existing = await db.collection('event_registrations')
      .where({ postId, teamName: team.name, seedTag: SEED_TAG })
      .limit(1)
      .get()

    if (existing.data.length) {
      await db.collection('event_registrations').doc(existing.data[0]._id).update({ data: regData })
      regIds.push(existing.data[0]._id)
    } else {
      const addRes = await db.collection('event_registrations').add({
        data: { ...regData, createdAt: db.serverDate() }
      })
      regIds.push(addRes._id)
    }
  }

  return regIds
}

function buildGroups(regIds) {
  const groupCount = 6
  return Array.from({ length: groupCount }, (_, groupIndex) => ({
    name: String.fromCharCode(65 + groupIndex),
    teams: regIds.slice(groupIndex * 4, groupIndex * 4 + 4).map((registrationId, index) => {
      const team = teamDefs[groupIndex * 4 + index]
      return {
        registrationId,
        teamName: team.name,
        captainOpenid: team.captain,
        memberCount: team.members.length
      }
    })
  }))
}

function demoScore(groupIndex, matchOrder) {
  const scoreSeeds = [
    [[2, 1], [0, 0], [3, 2]],
    [[1, 0], [2, 2], [0, 1]],
    [[4, 2], [1, 1], [2, 0]],
    [[0, 2], [3, 1], [1, 0]],
    [[2, 2], [1, 3], [2, 0]],
    [[1, 1], [0, 2], [3, 3]]
  ]
  return (scoreSeeds[groupIndex] || [])[matchOrder - 1] || null
}

function buildMatches(groups) {
  const matches = []
  groups.forEach((group, groupIndex) => {
    const teams = group.teams || []
    let order = 1
    for (let i = 0; i < teams.length; i += 1) {
      for (let j = i + 1; j < teams.length; j += 1) {
        const score = demoScore(groupIndex, order)
        const scoreA = score ? score[0] : null
        const scoreB = score ? score[1] : null
        matches.push({
          matchId: `${group.name}-${order}`,
          stage: 'group',
          groupName: group.name,
          round: order,
          teamAId: teams[i].registrationId,
          teamAName: teams[i].teamName,
          teamBId: teams[j].registrationId,
          teamBName: teams[j].teamName,
          scoreA,
          scoreB,
          winnerTeamId: score && scoreA !== scoreB ? (scoreA > scoreB ? teams[i].registrationId : teams[j].registrationId) : '',
          courtName: `${group.name}组场地`,
          matchTime: `2026-07-20 ${String(9 + groupIndex).padStart(2, '0')}:${order % 2 ? '00' : '30'}`,
          status: score ? 'finished' : 'pending',
          scoreSource: score ? 'platform' : '',
          verificationLevel: score ? 'platform_verified' : '',
          seedTag: SEED_TAG
        })
        order += 1
      }
    }
  })
  return matches
}

async function ensureSchedule(postId, regIds) {
  const groups = buildGroups(regIds)
  const matches = buildMatches(groups)

  await db.collection('posts').doc(postId).update({
    data: {
      eventSchedule: {
        format: 'group_knockout',
        status: 'active',
        groupCount: groups.length,
        advancePerGroup: 2,
        generatedTeamCount: regIds.length,
        groups,
        matches,
        knockoutMatches: [],
        createdBy: 'seedDemoFootballData',
        seedTag: SEED_TAG,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      },
      updatedAt: db.serverDate()
    }
  })
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { withPlayers = false, withRegistrations = false } = event || {}

  try {
    const adminUser = await ensureAdmin(OPENID)
    if (withPlayers) {
      await ensureAthletes()
    }
    const postId = await ensurePost(OPENID, adminUser)
    const regIds = withRegistrations
      ? await ensureRegistrations(postId)
      : teamDefs.map((_, index) => `demo24_reg_${String(index + 1).padStart(2, '0')}`)
    await ensureSchedule(postId, regIds)

    return {
      code: 0,
      msg: '24队足球测试赛程已生成',
      postId,
      teams: teamDefs.map(t => t.name),
      teamCount: teamDefs.length,
      matchCount: 36,
      playersGenerated: withPlayers ? teamDefs.length * 5 : 0,
      registrationsGenerated: withRegistrations ? teamDefs.length : 0
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
