const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureCollection(name) { try { await db.createCollection(name) } catch (e) {} }
function display(a) { return a.displayName || a.nickname || a.name || `用户${a.sportlightId || ''}` }
function sportLabel(sport) {
  if (sport === 'football') return '足球'
  if (sport === 'basketball') return '篮球'
  if (sport === 'badminton') return '羽毛球'
  return sport || ''
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const teamId = String((event && event.teamId) || '')
  const toOpenid = String((event && event.toOpenid) || '')
  if (!teamId || !toOpenid) return { code: -1, msg: '参数缺失' }
  try {
    await Promise.all(['teamInvites', 'notifications'].map(ensureCollection))
    const [teamRes, targetRes, captainRes] = await Promise.all([
      db.collection('teams').doc(teamId).get(),
      db.collection('athletes').where({ openid: toOpenid }).limit(1).get(),
      db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    ])
    const team = teamRes.data || {}
    if (team.captainOpenid !== OPENID) return { code: -1, msg: '只有队长可以邀请队员' }
    if ((team.memberOpenids || []).includes(toOpenid)) return { code: -1, msg: '该球员已在球队中' }
    const target = targetRes.data[0] || {}
    if (!target.openid) return { code: -1, msg: '球员不存在' }
    const teamSport = sportLabel(team.sport)
    const targetSport = sportLabel(target.sport)
    if (teamSport && targetSport && teamSport !== targetSport) return { code: -1, msg: `该球队是${teamSport}球队，仅可邀请${teamSport}运动员` }
    const pending = await db.collection('teamInvites').where({ teamId, toOpenid, status: 'pending' }).limit(1).get()
    if (pending.data.length) return { code: -1, msg: '已邀请，等待对方同意' }
    const captain = captainRes.data[0] || {}
    const addRes = await db.collection('teamInvites').add({
      data: {
        teamId,
        teamName: team.name || '',
        teamLogo: team.logo || '',
        fromOpenid: OPENID,
        fromName: display(captain),
        toOpenid,
        toName: display(target),
        toSportlightId: target.sportlightId || '',
        status: 'pending',
        createdAt: db.serverDate()
      }
    })
    await db.collection('notifications').add({
      data: {
        toOpenid,
        type: 'team_member_invite',
        inviteId: addRes._id,
        teamId,
        teamName: team.name || '',
        captainName: display(captain),
        content: `${display(captain)} 邀请你加入「${team.name || '球队'}」`,
        read: false,
        createdAt: db.serverDate()
      }
    })
    return { code: 0, inviteId: addRes._id }
  } catch (e) { return { code: -1, msg: e.message } }
}
