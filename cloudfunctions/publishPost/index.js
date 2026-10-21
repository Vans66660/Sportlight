const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function checkTextSafe(content) {
  const result = await cloud.openapi.security.msgSecCheck({
    content: String(content || '').slice(0, 500000)
  })
  const errCode = result.errCode !== undefined ? result.errCode : result.errcode
  if (errCode === 0) return true
  if (errCode === 87014) return false
  throw new Error('内容审核服务异常')
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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { content, title = '', images = [], type = 'general', postType = 'normal', eventData = {}, banner = '', captainGroupQr = '', visibility = 'public' } = event

  if (!content || !content.trim()) return { code: -1, msg: '内容不能为空' }
  if (postType === 'event' && !captainGroupQr) return { code: -1, msg: '请上传赛务联系二维码' }

  // 服务端文本内容安全检测
  try {
    const checkText = (title ? title + ' ' : '') + content.trim()
    const safe = await checkTextSafe(checkText)
    if (!safe) {
      return { code: -1, msg: '内容含有违规信息，请修改后重试' }
    }
  } catch (e) {
    console.warn('服务端文本安全检测异常:', e.message)
    return { code: -1, msg: '内容审核暂不可用，请稍后重试' }
  }

  try {
    let authorName = '', authorPhoto = '', authorType = '', authorId = ''

    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    if (athleteRes.data.length > 0) {
      const athlete = athleteRes.data[0]
      authorName = athlete.name || ''
      authorPhoto = athlete.photo || ''
      authorType = 'athlete'
      authorId = athlete._id
    } else {
      const [userRes, bossRes] = await Promise.all([
        db.collection('users').where({ openid: OPENID }).limit(1).get(),
        db.collection('bosses').where({ openid: OPENID }).limit(1).get().catch(() => ({ data: [] }))
      ])
      if (userRes.data.length === 0) return { code: -1, msg: '请先注册' }
      const boss = { ...userRes.data[0], ...((bossRes.data || [])[0] || {}) }
      authorName = boss.displayName || boss.name || ''
      authorPhoto = boss.logo || boss.avatarUrl || ''
      authorType = 'boss'
      authorId = boss._id
    }

    const docData = {
      openid: OPENID,
      authorId,
      authorName,
      authorPhoto,
      authorType,
      athleteName: authorType === 'athlete' ? authorName : '',
      athletePhoto: authorType === 'athlete' ? authorPhoto : '',
      postType,
      content: content.trim(),
      images: images.slice(0, 4),
      type: postType === 'event' ? 'event' : type,
      visibility: postType === 'event' ? 'public' : (['public', 'friends', 'private'].includes(visibility) ? visibility : 'public'),
      likesCount: 0,
      likedBy: [],
      createdAt: db.serverDate()
    }

    if (postType === 'event') {
      docData.title = title.trim()
      docData.banner = banner
      docData.captainGroupQr = captainGroupQr
      docData.captainGroupQrUpdatedAt = db.serverDate()
      docData.sport = eventData.sport || ''
      docData.eventStartDate = eventData.startDate || eventData.date || ''
      docData.eventEndDate = eventData.endDate || eventData.startDate || eventData.date || ''
      docData.eventDate = eventData.date || formatEventDateRange(docData.eventStartDate, docData.eventEndDate)
      if (!docData.eventStartDate) return { code: -1, msg: '请选择比赛开始日期' }
      if (!docData.eventEndDate) return { code: -1, msg: '请选择比赛结束日期' }
      if (dateMs(docData.eventEndDate) < dateMs(docData.eventStartDate)) return { code: -1, msg: '比赛结束日期不能早于开始日期' }
      if (eventData.registrationDeadline && dateMs(eventData.registrationDeadline) >= dateMs(docData.eventStartDate)) {
        return { code: -1, msg: '报名截止日期必须早于比赛开始日期' }
      }
      docData.eventLocation = eventData.location || ''
      docData.eventFormat = eventData.format || ''
      docData.basketballConfig = eventData.sport === '篮球' ? (eventData.basketballConfig || {}) : null
      docData.registrationMode = eventData.registrationMode || 'both'
      docData.teamSize = eventData.teamSize ? parseInt(eventData.teamSize) : 5
      docData.minTeamSize = docData.teamSize
      docData.matchDuration = eventData.matchDuration ? parseInt(eventData.matchDuration) : (docData.sport === '篮球' ? 40 : (docData.sport === '羽毛球' ? 60 : 90))
      docData.halfDuration = eventData.halfDuration ? parseInt(eventData.halfDuration) : (docData.sport === '篮球' ? 20 : (docData.sport === '羽毛球' ? 30 : 45))
      docData.maxTeamMembers = eventData.maxTeamMembers ? parseInt(eventData.maxTeamMembers) : 0
      docData.teamSizeLabel = eventData.teamSizeLabel || ''
      docData.maxTeams = eventData.maxTeams ? parseInt(eventData.maxTeams) : 0
      docData.registeredTeams = 0
      docData.pendingTeams = 0
      docData.registrationDeadline = eventData.registrationDeadline || ''
      docData.entryFee = eventData.entryFee ? parseInt(eventData.entryFee) : 0
      docData.prizes = eventData.prizes || []
      docData.approvalType = 'manual'
      docData.eventStatus = 'open'
    }

    const res = await db.collection('posts').add({ data: docData })
    return { code: 0, id: res._id }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
