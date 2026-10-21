const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const SPORT_CLASS_MAP = { '篮球': 'basketball', '足球': 'football', '羽毛球': 'badminton', '格斗': 'fight', '电竞': 'esport', '游泳': 'swim' }
const SPORT_ICON_MAP  = { '篮球': '🏀', '足球': '⚽', '羽毛球': '🏸', '格斗': '🥊', '电竞': '🎮', '游泳': '🏊' }
const FALLBACK_CLASSES = ['basketball', 'football', 'badminton', 'fight', 'esport', 'swim']

function isCollectionMissing(e) {
  const msg = String((e && (e.errMsg || e.message)) || e || '')
  return msg.includes('-502005') || msg.includes('collection not exist') || msg.includes('collection not exists')
}

function matchDate(match, post) {
  const raw = match.match_time || ''
  const m = String(raw).match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/)
  return m ? m[1].replace(/\//g, '-') : (post.eventDate || '')
}

function matchLocation(match, post) {
  return match.venue || post.eventLocation || ''
}

function isRealOrder(order) {
  return !(
    order.directChat ||
    order.teamCaptainChat ||
    order.chatKind ||
    order.mode === 'direct' ||
    order.mode === 'team_contact' ||
    order.type === 'team_contact'
  )
}

async function getBossProfiles(openids) {
  const ids = [...new Set((openids || []).filter(Boolean))]
  if (!ids.length) return {}

  const [userRes, bossRes] = await Promise.all([
    db.collection('users').where({ openid: _.in(ids) }).field({ openid: true, name: true, displayName: true }).get(),
    db.collection('bosses').where({ openid: _.in(ids) }).field({ openid: true, name: true, displayName: true }).get().catch(() => ({ data: [] }))
  ])
  const map = {}
  ;(userRes.data || []).forEach(u => { map[u.openid] = u })
  ;(bossRes.data || []).forEach(b => { map[b.openid] = { ...(map[b.openid] || {}), ...b } })
  return map
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  try {
    const bookingPromise = db.collection('venueBookings')
      .where(_.or([
        { creatorOpenid: OPENID },
        { participants: _.elemMatch({ openid: OPENID }) }
      ]))
      .limit(80)
      .get()
      .catch(e => {
        if (isCollectionMissing(e)) return { data: [] }
        throw e
      })

    const challengePromise = db.collection('teamChallenges')
      .where({ participants: _.elemMatch({ openid: OPENID }), status: _.in(['matched', 'completed', 'cancelled', 'rejected']) })
      .orderBy('date', 'asc')
      .limit(50)
      .get()
      .catch(e => {
        if (isCollectionMissing(e)) return { data: [] }
        throw e
      })

    const [lockedRes, appliedRes, regRes, challengeRes, bookingRes] = await Promise.all([
      db.collection('orders')
        .where({ athleteOpenid: OPENID, status: _.in(['locked', 'done', 'cancelled']) })
        .orderBy('createdAt', 'desc').limit(50).get(),
      db.collection('orders')
        .where({ applicants: _.all([OPENID]), status: _.in(['open', 'cancelled']) })
        .orderBy('createdAt', 'desc').limit(30).get(),
      db.collection('event_registrations')
        .where({ memberOpenids: OPENID, status: _.in(['assembling', 'pending', 'approved', 'solo_pending', 'cancelled', 'rejected']) })
        .limit(50).get(),
      challengePromise,
      bookingPromise
    ])

    const allOrders = [...lockedRes.data, ...appliedRes.data].filter(isRealOrder)
    const bossOpenids = [...new Set(allOrders.map(o => o.bossOpenid).filter(Boolean))]
    let bossMap = {}
    if (bossOpenids.length > 0) {
      bossMap = await getBossProfiles(bossOpenids)
    }

    const orders = allOrders.map(o => ({
      _id: o._id,
      itemType: 'order',
      title: o.title || '',
      type: o.type || 'match',
      status: o.status,
      statusLabel: { locked: '进行中', done: '已完成', open: '招募中', cancelled: '已取消' }[o.status] || o.status,
      price: o.price || 0,
      date: o.date || '',
      location: o.location || o.city || '',
      bossName: bossMap[o.bossOpenid] ? (bossMap[o.bossOpenid].displayName || bossMap[o.bossOpenid].name || '') : ''
    }))

    const venueBookings = (bookingRes.data || []).map(booking => {
      const isPrivate = booking.paymentMethod === 'private' || booking.sourceType === 'private_booking'
      const participantCount = (booking.participants || []).length
      const status = booking.status || 'open'
      const statusLabel = status === 'pending_payment' ? '待支付'
        : status === 'formed' ? '已成局'
        : status === 'locked' ? (isPrivate ? '包场成功' : '已锁场')
        : status === 'in_progress' ? '进行中'
        : status === 'awaiting_confirm' ? '待确认完成'
        : status === 'finished' ? '已完成'
        : status === 'cancelled' ? '已取消'
        : '招募中'
      return {
        _id: booking.sourceId || booking._id,
        bookingId: booking._id,
        itemType: 'venueBooking',
        title: `${isPrivate ? '包场' : '散客组局'} · ${booking.venueName || '球馆'}`,
        date: booking.date || '',
        time: `${booking.startTime || ''}-${booking.endTime || ''}`,
        location: booking.venueName || booking.venueAddress || '',
        sport: booking.courtType || '',
        sportIcon: isPrivate ? '🏟' : '⚡',
        status,
        statusLabel,
        paymentMethod: booking.paymentMethod || '',
        paymentStatus: booking.paymentStatus || '',
        participantCount,
        minPlayers: Number(booking.minPlayers) || 0,
        maxPlayers: Number(booking.maxPlayers) || 0,
        amount: Number(booking.amount) || 0,
        courtName: booking.courtName || ''
      }
    })

    let events = []
    const regs = regRes.data.sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bt - at
    })
    if (regs.length > 0) {
      const postIds = [...new Set(regs.map(r => r.postId))]
      const postRes = await db.collection('posts')
        .where({ _id: _.in(postIds) })
        .field({ _id: true, title: true, content: true, eventDate: true, eventLocation: true, banner: true, teamSize: true, teamSizeLabel: true, maxTeams: true, registeredTeams: true, entryFee: true, sport: true, openTournament: true })
        .get()
      const postMap = {}
      postRes.data.forEach(p => { postMap[p._id] = p })

      const registrationTeamIds = regs.map(r => r._id)
      const matchItems = []

      postRes.data.forEach(post => {
        const ot = post.openTournament || {}
        ;(ot.matches || []).forEach(match => {
          if (!registrationTeamIds.includes(match.home_team_id) && !registrationTeamIds.includes(match.away_team_id)) return
          const isHome = registrationTeamIds.includes(match.home_team_id)
          const myTeamName = isHome ? match.home_team_name : match.away_team_name
          const opponentName = isHome ? match.away_team_name : match.home_team_name
          const sport = post.sport || ''
          const colorClass = SPORT_CLASS_MAP[sport] || FALLBACK_CLASSES[(post._id || '').charCodeAt((post._id || '').length - 1) % 6] || 'basketball'
          matchItems.push({
            _id: `${post._id}_${match.matchId}`,
            postId: post._id,
            matchId: match.matchId,
            itemType: 'eventMatch',
            title: `${myTeamName || '我的队伍'} VS ${opponentName || '对手'}`,
            eventTitle: post.title || post.content || '公开赛',
            date: matchDate(match, post),
            location: matchLocation(match, post),
            banner: post.banner || '',
            sport,
            colorClass,
            sportIcon: SPORT_ICON_MAP[sport] || '🏆',
            status: match.status || 'not_started',
            statusLabel: match.status === 'finished' ? '已结束' : match.status === 'in_progress' ? '进行中' : '未开始',
            groupRoundLabel: `${match.group_name ? match.group_name + '组 · ' : ''}第${match.round_number}轮`,
            teamName: myTeamName,
            opponentName
          })
        })
      })

      events = regs.map(r => {
        const p = postMap[r.postId] || {}
        const sport = p.sport || ''
        const colorClass = SPORT_CLASS_MAP[sport] || FALLBACK_CLASSES[(r.postId || '').charCodeAt((r.postId || '').length - 1) % 6] || 'basketball'
        const sportIcon = SPORT_ICON_MAP[sport] || '🏆'

        const isCaptain = r.captainOpenid === OPENID
        let status, statusLabel
        if (r.status === 'cancelled' || r.status === 'rejected') {
          status = r.status; statusLabel = r.status === 'rejected' ? '已驳回' : '已取消'
        } else if (r.status === 'solo_pending') {
          status = 'solo'; statusLabel = '散客池中'
        } else if (r.status === 'assembling') {
          status = 'assembling'; statusLabel = '组队中'
        } else if (r.status === 'pending') {
          status = 'pending'; statusLabel = '审核中'
        } else if (r.paymentStatus === 'unpaid') {
          status = 'registered'; statusLabel = '已通过 · 主办方自收'
        } else {
          status = 'registered'; statusLabel = '已报名 ✓'
        }

        return {
          _id: r.postId,
          registrationId: r._id,
          itemType: 'event',
          title: p.title || p.content || '',
          date: p.eventDate || '',
          location: p.eventLocation || '',
          banner: p.banner || '',
          teamSize: p.teamSize || 0,
          teamSizeLabel: p.teamSizeLabel || '',
          maxTeams: p.maxTeams || 0,
          registeredTeams: p.registeredTeams || 0,
          entryFee: p.entryFee != null ? p.entryFee : -1,
          sport,
          colorClass,
          sportIcon,
          status,
          statusLabel,
          teamName: r.teamName || '',
          isCaptain: r.captainOpenid === OPENID
        }
      }).concat(matchItems)
    }

    const teamChallenges = (challengeRes.data || []).map(challenge => {
      const participant = (challenge.participants || []).find(p => p.openid === OPENID) || {}
      return {
        _id: challenge._id,
        itemType: 'teamChallenge',
        title: `${challenge.homeTeamName || '主队'} VS ${challenge.awayTeamName || '客队'}`,
        date: challenge.date || '',
        time: challenge.time || '',
        location: challenge.venueName || '',
        sport: challenge.sport || '',
        sportIcon: SPORT_ICON_MAP[challenge.sport] || '⚔️',
        spec: challenge.spec || '',
        status: challenge.status,
        statusLabel: challenge.status === 'completed' ? '已完成' : challenge.status === 'cancelled' ? '已取消' : challenge.status === 'rejected' ? '已驳回' : '已达成',
        paymentMethod: challenge.paymentMethod || '',
        teamName: participant.teamName || '',
        homeTeamName: challenge.homeTeamName || '',
        awayTeamName: challenge.awayTeamName || '',
        homeTeamLogo: challenge.homeTeamLogo || '',
        awayTeamLogo: challenge.awayTeamLogo || '',
        participants: challenge.participants || []
      }
    })

    return { code: 0, orders, events: events.concat(teamChallenges, venueBookings) }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
