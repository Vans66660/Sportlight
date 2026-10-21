const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function getAthlete(openid) {
  const res = await db.collection('athletes').where({ openid }).limit(1).get()
  return res.data[0] || {}
}

function display(member, athlete) {
  return (member && member.name) || athlete.displayName || athlete.nickname || athlete.name || `用户${athlete.sportlightId || ''}`
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { teamId, newCaptainOpenid } = event || {}
  if (!teamId || !newCaptainOpenid) return { code: -1, msg: '参数缺失' }
  if (newCaptainOpenid === OPENID) return { code: -1, msg: '你已经是队长' }

  try {
    const teamRes = await db.collection('teams').doc(teamId).get()
    const team = teamRes.data || {}
    if (team.captainOpenid !== OPENID) return { code: -1, msg: '只有队长可以转让队长' }
    if (!(team.memberOpenids || []).includes(newCaptainOpenid)) return { code: -1, msg: '只能转让给队内成员' }

    const otherCaptainRes = await db.collection('teams')
      .where({ captainOpenid: newCaptainOpenid, status: _.neq('deleted') })
      .limit(5)
      .get()
    const otherCaptainTeam = (otherCaptainRes.data || []).find(item => item._id !== teamId)
    if (otherCaptainTeam) return { code: -1, msg: '该成员已经是另一支球队队长' }

    const [oldAthlete, newAthlete] = await Promise.all([
      getAthlete(OPENID),
      getAthlete(newCaptainOpenid)
    ])
    const members = (team.members || []).map(member => {
      if (member.openid === OPENID) return { ...member, role: 'member' }
      if (member.openid === newCaptainOpenid) return { ...member, role: 'captain' }
      return member
    })
    const newMember = members.find(item => item.openid === newCaptainOpenid) || {}
    const oldName = display((team.members || []).find(item => item.openid === OPENID), oldAthlete)
    const newName = display(newMember, newAthlete)

    await db.collection('teams').doc(teamId).update({
      data: {
        captainOpenid: newCaptainOpenid,
        members,
        updatedAt: db.serverDate()
      }
    })

    await Promise.all([
      db.collection('teamJoinRequests').where({ teamId, status: 'pending' }).update({ data: { captainOpenid: newCaptainOpenid } }).catch(() => null),
      db.collection('teamInvites').where({ teamId, status: 'pending' }).update({ data: { fromOpenid: newCaptainOpenid, fromName: newName } }).catch(() => null),
      db.collection('conversations').where({ teamId, chatKind: 'team_captain' }).update({
        data: {
          athleteOpenid: newCaptainOpenid,
          participants: _.push(newCaptainOpenid),
          updatedAt: db.serverDate()
        }
      }).catch(() => null)
    ])

    const content = `${oldName} 已将「${team.name || '球队'}」队长转让给 ${newName}`
    const noticeTasks = (team.memberOpenids || []).filter(Boolean).map(openid =>
      db.collection('notifications').add({
        data: {
          toOpenid: openid,
          type: openid === newCaptainOpenid ? 'team_captain_received' : 'team_captain_transferred',
          teamId,
          teamName: team.name || '',
          content,
          read: false,
          createdAt: db.serverDate()
        }
      }).catch(() => null)
    )
    await Promise.all(noticeTasks)

    return { code: 0, msg: '队长已转让' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
