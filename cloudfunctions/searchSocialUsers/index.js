const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function isCollectionMissing(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

async function safeGet(promise, fallback = { data: [] }) {
  try { return await promise } catch (e) { if (isCollectionMissing(e)) return fallback; throw e }
}

function normalizeTier(tier) {
  const value = String(tier || '').trim()
  return !value || value === 'F' || value.startsWith('F') ? 'D' : value
}

function publicUser(a, friendMap, requestMap, teamMemberSet, inviteMap) {
  const displayName = a.nickname || (a.displayName && a.displayName !== a.name ? a.displayName : '') || `用户${a.sportlightId || ''}`
  return {
    openid: a.openid,
    sportlightId: a.sportlightId || '',
    displayName,
    nickname: a.nickname || '',
    realName: a.name || '',
    avatar: a.photo || a.logo || a.avatarUrl || '',
    userType: a.userType || 'athlete',
    sport: a.sport || '',
    tier: normalizeTier(a.currentTier || a.rank),
    score: a.currentSeasonScore || a.competitionScore || 0,
    friendStatus: friendMap[a.openid] ? 'friends' : (requestMap[a.openid] || 'none'),
    inTeam: teamMemberSet ? teamMemberSet.has(a.openid) : false,
    teamInviteStatus: inviteMap[a.openid] || 'none'
  }
}

async function toTempURLs(urls) {
  const cloudUrls = urls.filter(url => url && url.startsWith('cloud://'))
  if (!cloudUrls.length) return {}
  try {
    const res = await cloud.getTempFileURL({ fileList: cloudUrls })
    const map = {}
    res.fileList.forEach(item => { if (item.tempFileURL) map[item.fileID] = item.tempFileURL })
    return map
  } catch (e) {
    return {}
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const keyword = String((event && event.keyword) || '').trim()
  const teamId = String((event && event.teamId) || '')
  if (!keyword) return { code: 0, data: [] }

  try {
    const upperKeyword = keyword.toUpperCase()
    const exactId = upperKeyword.startsWith('SL') ? upperKeyword : `SL${upperKeyword}`
    const regex = db.RegExp({ regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
    const queries = [
      db.collection('athletes').where({ sportlightId: exactId }).limit(20).get(),
      db.collection('athletes').where({ sportlightId: upperKeyword }).limit(20).get(),
      db.collection('athletes').where({ nickname: regex }).limit(20).get(),
      db.collection('athletes').where({ name: regex }).limit(20).get(),
      db.collection('users').where({ sportlightId: exactId }).limit(20).get(),
      db.collection('users').where({ sportlightId: upperKeyword }).limit(20).get(),
      db.collection('users').where({ nickname: regex }).limit(20).get(),
      db.collection('users').where({ name: regex }).limit(20).get()
    ]
    const results = await Promise.all(queries.map(q => safeGet(q)))
    const map = {}
    results.forEach(res => (res.data || []).forEach(item => {
      if (!item.openid || item.openid === OPENID) return
      const existing = map[item.openid]
      if (!existing || existing.userType !== 'athlete' || item.sport || item.currentTier || item.competitionScore) {
        map[item.openid] = item
      }
    }))
    const list = Object.values(map).filter(item => !teamId || item.userType === 'athlete').slice(0, 30)
    const openids = list.map(a => a.openid)
    if (!openids.length) return { code: 0, data: [] }

    const [friendRes, sentReqRes, recvReqRes, teamRes, inviteRes] = await Promise.all([
      safeGet(db.collection('friends').where({ userOpenid: OPENID, friendOpenid: _.in(openids), status: 'active' }).get()),
      safeGet(db.collection('friendRequests').where({ fromOpenid: OPENID, toOpenid: _.in(openids), status: 'pending' }).get()),
      safeGet(db.collection('friendRequests').where({ toOpenid: OPENID, fromOpenid: _.in(openids), status: 'pending' }).get()),
      teamId ? safeGet(db.collection('teams').doc(teamId).get(), { data: null }) : Promise.resolve({ data: null }),
      teamId ? safeGet(db.collection('teamInvites').where({ teamId, toOpenid: _.in(openids), status: 'pending' }).get()) : Promise.resolve({ data: [] })
    ])

    const friendMap = {}
    ;(friendRes.data || []).forEach(item => { friendMap[item.friendOpenid] = true })
    const requestMap = {}
    ;(sentReqRes.data || []).forEach(item => { requestMap[item.toOpenid] = 'pending_sent' })
    ;(recvReqRes.data || []).forEach(item => { requestMap[item.fromOpenid] = 'pending_received' })
    const teamMemberSet = teamRes.data ? new Set(teamRes.data.memberOpenids || []) : null
    const inviteMap = {}
    ;(inviteRes.data || []).forEach(item => { inviteMap[item.toOpenid] = 'pending' })

    const tempMap = await toTempURLs(list.map(a => a.photo || ''))
    return {
      code: 0,
      data: list.map(a => {
        const item = publicUser(a, friendMap, requestMap, teamMemberSet, inviteMap)
        item.avatar = tempMap[item.avatar] || item.avatar || ''
        return item
      })
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
