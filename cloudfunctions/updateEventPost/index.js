const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function toInt(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? fallback : n
}

function formatEventDateRange(startDate, endDate) {
  if (!startDate) return ''
  if (!endDate || endDate === startDate) return startDate
  return `${startDate} 至 ${endDate}`
}

function dateMs(date) {
  const time = new Date(date).getTime()
  return Number.isFinite(time) ? time : 0
}

async function checkTextSafe(content) {
  const result = await cloud.openapi.security.msgSecCheck({
    content: String(content || '').slice(0, 500000)
  })
  const errCode = result.errCode !== undefined ? result.errCode : result.errcode
  if (errCode === 0) return true
  if (errCode === 87014) return false
  throw new Error('内容审核服务异常')
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { postId, content, title = '', images = [], eventData = {}, banner = '', captainGroupQr = '' } = event

  if (!postId) return { code: -1, msg: 'postId 缺失' }
  if (!content || !content.trim()) return { code: -1, msg: '内容不能为空' }
  if (!title || !title.trim()) return { code: -1, msg: '赛事名称不能为空' }
  if (!captainGroupQr) return { code: -1, msg: '请上传赛务联系二维码' }

  try {
    const safe = await checkTextSafe(`${title} ${content}`)
    if (!safe) return { code: -1, msg: '内容含有违规信息，请修改后重试' }

    const postRes = await db.collection('posts').doc(postId).get()
    const post = postRes.data
    if (!post || post.postType !== 'event') return { code: -1, msg: '赛事不存在' }
    const eventAdmin = await getEventAdmin(postId, OPENID)
    if (post.openid !== OPENID && (!eventAdmin || eventAdmin.role !== 'full')) return { code: -1, msg: '无权限' }
    if (post.eventStatus === 'closed') return { code: -1, msg: '已截止赛事不能编辑' }

    const regsRes = await db.collection('event_registrations')
      .where({ postId, status: _.in(['assembling', 'pending', 'approved', 'solo_pending']) })
      .limit(200)
      .get()
    const hasRegistrations = regsRes.data.length > 0
    const confirmedTeamCount = post.registeredTeams || 0
    const maxCurrentMembers = regsRes.data.reduce((max, r) => {
      const count = (r.members || []).filter(m => m && m.openid && m.confirmed).length
      return Math.max(max, count)
    }, 0)

    const teamSize = toInt(eventData.teamSize, post.teamSize || 5)
    const entryFee = toInt(eventData.entryFee, post.entryFee || 0)
    const matchDuration = toInt(eventData.matchDuration, post.matchDuration || (eventData.sport === '篮球' ? 40 : (eventData.sport === '羽毛球' ? 60 : 90)))
    const halfDuration = toInt(eventData.halfDuration, post.halfDuration || (eventData.sport === '篮球' ? 20 : (eventData.sport === '羽毛球' ? 30 : 45)))
    const maxTeamMembers = toInt(eventData.maxTeamMembers, 0)
    const maxTeams = toInt(eventData.maxTeams, 0)
    const eventStartDate = eventData.startDate || eventData.date || ''
    const eventEndDate = eventData.endDate || eventStartDate

    if (hasRegistrations && teamSize !== (post.teamSize || 5)) {
      return { code: -1, msg: '已有报名后不能修改成队人数' }
    }
    if (hasRegistrations && entryFee !== (post.entryFee || 0)) {
      return { code: -1, msg: '已有报名后不能修改报名费' }
    }
    if (maxTeamMembers && maxTeamMembers < teamSize) {
      return { code: -1, msg: '队伍人数上限不能小于成队人数' }
    }
    if (maxTeamMembers && maxCurrentMembers > maxTeamMembers) {
      return { code: -1, msg: `队伍人数上限不能低于当前最大队伍人数 ${maxCurrentMembers}` }
    }
    if (matchDuration <= 0 || halfDuration <= 0 || halfDuration > matchDuration) {
      return { code: -1, msg: '比赛时间设置不正确' }
    }
    if (maxTeams && confirmedTeamCount > maxTeams) {
      return { code: -1, msg: `参赛队数上限不能低于已确认队伍数 ${confirmedTeamCount}` }
    }
    if (!eventStartDate) return { code: -1, msg: '请选择比赛开始日期' }
    if (!eventEndDate) return { code: -1, msg: '请选择比赛结束日期' }
    if (dateMs(eventEndDate) < dateMs(eventStartDate)) return { code: -1, msg: '比赛结束日期不能早于开始日期' }
    if (eventData.registrationDeadline && dateMs(eventData.registrationDeadline) >= dateMs(eventStartDate)) {
      return { code: -1, msg: '报名截止日期必须早于比赛开始日期' }
    }

    const updateData = {
      title: title.trim(),
      banner,
      captainGroupQr,
      captainGroupQrUpdatedAt: captainGroupQr !== post.captainGroupQr ? db.serverDate() : (post.captainGroupQrUpdatedAt || db.serverDate()),
      content: content.trim(),
      images: images.slice(0, 4),
      sport: eventData.sport || post.sport || '',
      eventStartDate,
      eventEndDate,
      eventDate: eventData.date || formatEventDateRange(eventStartDate, eventEndDate),
      eventLocation: eventData.location || '',
      eventFormat: eventData.format || '',
      basketballConfig: eventData.sport === '篮球' ? (eventData.basketballConfig || {}) : null,
      registrationMode: eventData.registrationMode || post.registrationMode || 'both',
      teamSize,
      minTeamSize: teamSize,
      matchDuration,
      halfDuration,
      maxTeamMembers,
      teamSizeLabel: eventData.teamSizeLabel || '',
      maxTeams,
      registrationDeadline: eventData.registrationDeadline || '',
      entryFee,
      prizes: eventData.prizes || [],
      updatedAt: db.serverDate()
    }

    if ((post.eventStatus || 'open') === 'full' && (!maxTeams || (post.registeredTeams || 0) < maxTeams)) {
      updateData.eventStatus = 'open'
    }
    if (maxTeams && (post.registeredTeams || 0) >= maxTeams) {
      updateData.eventStatus = 'full'
    }
    if (post.openTournament) {
      updateData.openTournament = {
        ...post.openTournament,
        matchRules: {
          ...((post.openTournament && post.openTournament.matchRules) || {}),
          teamSize,
          matchDuration,
          halfDuration
        }
      }
    }

    await db.collection('posts').doc(postId).update({ data: updateData })
    return { code: 0, msg: '赛事已更新' }
  } catch (e) {
    if (e.message === '内容审核服务异常') {
      return { code: -1, msg: '内容审核暂不可用，请稍后重试' }
    }
    return { code: -1, msg: e.message }
  }
}
