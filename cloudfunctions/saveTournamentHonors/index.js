const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function normalizeAwards(awards = []) {
  return (Array.isArray(awards) ? awards : [])
    .map((item, index) => ({
      rank: item.rank || String(index + 1),
      label: String(item.label || '').trim(),
      teamId: String(item.teamId || '').trim(),
      teamName: String(item.teamName || '').trim()
    }))
    .filter(item => item.label && item.teamId)
}

function safeDocId(text) {
  return String(text || '').replace(/[^\w-]/g, '_').slice(0, 180)
}

function rosterOfTeam(openTournament, teamId) {
  const team = (openTournament.teams || []).find(item => item.teamId === teamId || item.registrationId === teamId)
  return team ? (team.roster || team.members || []) : []
}

async function removeOldHonors(postId) {
  while (true) {
    const res = await db.collection('athleteHonors').where({ postId }).limit(100).get()
    const list = res.data || []
    if (!list.length) break
    await Promise.all(list.map(item => db.collection('athleteHonors').doc(item._id).remove()))
    if (list.length < 100) break
  }
}

async function ensureHonorCollection() {
  try {
    await db.createCollection('athleteHonors')
  } catch (e) {}
}

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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { tournamentId } = event || {}
  const awards = normalizeAwards(event && event.awards)
  if (!tournamentId) return { code: -1, msg: 'tournamentId 缺失' }

  try {
    const [postRes, userRes] = await Promise.all([
      db.collection('posts').doc(tournamentId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get()
    ])
    const post = postRes.data
    if (!post || !post.openTournament) return { code: -1, msg: '公开赛不存在' }
    const isAdmin = (userRes.data || []).some(user => user.userType === 'admin')
    const eventAdmin = await getEventAdmin(tournamentId, OPENID)
    if (!isAdmin && post.openid !== OPENID && !eventAdmin) return { code: -1, msg: '无权限编辑赛事名次' }
    await ensureHonorCollection()

    const openTournament = post.openTournament || {}
    openTournament.honorAwards = awards
    openTournament.updatedAt = db.serverDate()

    await db.collection('posts').doc(tournamentId).update({
      data: {
        openTournament,
        updatedAt: db.serverDate()
      }
    })

    await removeOldHonors(tournamentId)

    let saved = 0
    const now = Date.now()
    for (const award of awards) {
      const roster = rosterOfTeam(openTournament, award.teamId)
      for (const player of roster) {
        const athleteOpenid = player.openid || player.playerOpenid
        if (!athleteOpenid) continue
        const honor = {
          postId: tournamentId,
          eventTitle: post.title || post.content || '公开赛',
          eventDate: post.eventDate || '',
          sport: openTournament.sport || post.sport || '',
          rank: award.rank,
          label: award.label,
          teamId: award.teamId,
          teamName: award.teamName,
          athleteOpenid,
          athleteName: player.name || player.playerName || '',
          createdAtMs: now,
          updatedAt: db.serverDate()
        }
        await db.collection('athleteHonors')
          .doc(safeDocId(`${tournamentId}_${award.rank}_${athleteOpenid}`))
          .set({ data: honor })
        saved += 1
      }
    }

    return { code: 0, msg: '名次与荣誉已保存', awards, saved }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
