const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const SEED_TAG = 'sportlight-virtual-registration-v1'

function pad(num) {
  return String(num).padStart(2, '0')
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, '').toLowerCase()
}

function makeMembers(postId, teamNo, teamSize) {
  return Array.from({ length: teamSize }, (_, index) => {
    const playerNo = index + 1
    return {
      openid: `virtual_${postId}_${pad(teamNo)}_${pad(playerNo)}`,
      name: `虚拟球员${pad(teamNo)}-${playerNo}`,
      photoUrl: '',
      confirmed: true,
      role: index === 0 ? 'captain' : 'member',
      position: ''
    }
  })
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, count = 8 } = event || {}
  if (!postId) return { code: -1, msg: 'postId 缺失' }

  try {
    const [postRes, userRes, existingSeedRes, activeRes] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('users').where({ openid: OPENID }).field({ userType: true }).limit(1).get(),
      db.collection('event_registrations').where({ postId, seedTag: SEED_TAG }).limit(50).get(),
      db.collection('event_registrations')
        .where({ postId, status: _.in(['assembling', 'pending', 'approved']) })
        .limit(200)
        .get()
    ])

    const post = postRes.data
    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }
    const isAdmin = userRes.data.length > 0 && userRes.data[0].userType === 'admin'
    if (!isAdmin && post.openid !== OPENID) return { code: -1, msg: '仅主办方可添加机器人队伍' }

    const maxTeams = Number(post.maxTeams || 0)
    const activeCount = activeRes.data.length
    const confirmedCount = activeRes.data.filter(reg => reg.status === 'approved').length
    const targetCount = maxTeams > 0
      ? maxTeams
      : Math.max(2, Math.min(Number(count) || 8, 24))
    const remainingSlots = maxTeams > 0 ? Math.max(0, maxTeams - activeCount) : 24
    const neededForTarget = Math.max(0, targetCount - activeCount)
    const neededForSchedule = Math.max(0, 2 - confirmedCount)
    const addCount = Math.min(remainingSlots, Math.max(neededForTarget, neededForSchedule))

    if (addCount === 0) {
      if (confirmedCount < 2) {
        return { code: -1, msg: '赛事名额已满，但已确认队伍不足 2 支，请先通过或清理待审核队伍' }
      }
      return { code: 0, msg: `当前已有 ${confirmedCount} 支已确认队伍，可以生成赛程`, added: 0, total: existingSeedRes.data.length }
    }
    if (confirmedCount + addCount < 2) {
      return { code: -1, msg: '剩余名额不足以补到 2 支已确认队伍，请先通过或清理待审核队伍' }
    }

    const existingSeedCount = existingSeedRes.data.length
    const usedNames = {}
    activeRes.data.forEach(reg => { usedNames[normalizeName(reg.teamName)] = true })
    const teamSize = Math.max(1, Number(post.teamSize || post.minTeamSize || 5))
    const docs = []
    let teamNo = existingSeedCount + 1

    while (docs.length < addCount && teamNo <= 99) {
      const teamName = `虚拟测试队${pad(teamNo)}`
      const key = normalizeName(teamName)
      if (!usedNames[key]) {
        const members = makeMembers(postId, teamNo, teamSize)
        docs.push({
          postId,
          registrationType: 'team',
          captainOpenid: members[0].openid,
          teamName,
          teamNameKey: key,
          members,
          memberOpenids: members.map(m => m.openid),
          memberCount: members.length,
          inviteCode: `virtual-${postId}-${pad(teamNo)}`,
          status: 'approved',
          paymentStatus: post.entryFee > 0 ? 'offline' : 'free',
          approvedAt: db.serverDate(),
          seedTag: SEED_TAG,
          createdAt: db.serverDate()
        })
        usedNames[key] = true
      }
      teamNo += 1
    }
    if (docs.length === 0) {
      return { code: -1, msg: '暂无可添加的机器人队伍，请稍后重试' }
    }

    await Promise.all(docs.map(doc => db.collection('event_registrations').add({ data: doc })))

    const newRegisteredTeams = (post.registeredTeams || 0) + docs.length
    const postUpdate = {
      registeredTeams: _.inc(docs.length),
      updatedAt: db.serverDate()
    }
    if (maxTeams > 0 && newRegisteredTeams >= maxTeams) {
      postUpdate.eventStatus = 'full'
    }
    await db.collection('posts').doc(postId).update({
      data: postUpdate
    })

    return {
      code: 0,
      msg: `已添加 ${docs.length} 支机器人队伍，当前可生成赛程`,
      added: docs.length,
      total: existingSeedCount + docs.length
    }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
