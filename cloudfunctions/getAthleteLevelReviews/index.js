const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureAdmin(openid) {
  const res = await db.collection('users').where({ openid }).field({ userType: true }).limit(1).get()
  return res.data.length > 0 && res.data[0].userType === 'admin'
}

function statusLabel(status) {
  return status === 'approved' ? '已通过'
    : status === 'rejected' ? '已驳回'
      : status === 'pending' ? '待审核'
        : '无需审核'
}

function formatProofFiles(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean)
}

function yesNo(value) {
  if (value === true) return '是'
  if (value === false) return '否'
  return '未记录'
}

function mapValue(value, map) {
  return map[value] || value || '未记录'
}

function buildPhysicalItems(athlete = {}) {
  const items = []
  if (athlete.age) items.push({ label: '年龄', value: `${athlete.age}岁` })
  if (athlete.height) items.push({ label: '身高', value: `${athlete.height}cm` })
  if (athlete.weight) items.push({ label: '体重', value: `${athlete.weight}kg` })
  if (athlete.wingspan) items.push({ label: '臂展', value: `${athlete.wingspan}cm` })
  if (athlete.preferredFoot) items.push({ label: '惯用脚', value: mapValue(athlete.preferredFoot, { left: '左脚', right: '右脚', both: '双脚' }) })
  if (athlete.preferredHand) items.push({ label: '惯用手', value: mapValue(athlete.preferredHand, { left: '左手', right: '右手', both: '双手' }) })
  return items
}

function buildExperienceItems(athlete = {}) {
  const competitiveBackground = athlete.competitiveBackground || athlete.cubalLevel
  const isFootball = athlete.sport === '足球'
  const backgroundLabels = isFootball
    ? { levelA: '职业梯队/青训经历', levelB: '校队/高水平青少年赛事', none: '无' }
    : { levelA: 'CUBAL一级/省BA', levelB: 'CUBAL二级', none: '无' }
  return [
    { label: '是否受过专业训练', value: yesNo(athlete.trainedProfessionally) },
    { label: '是否有职业背景', value: yesNo(athlete.hasProBackground) },
    { label: isFootball ? '足球竞技经历' : 'CUBAL / 省BA经历', value: mapValue(competitiveBackground, backgroundLabels) },
    { label: '是否参加业余联赛', value: yesNo(athlete.hasAmateurLeague) },
    { label: '是否获得前三', value: yesNo(athlete.hasTopThree) },
    { label: '前三次数', value: mapValue(athlete.topThreeCount, { gt3: '三次以上', lte3: '三次及以下' }) },
    { label: '球龄', value: mapValue(athlete.playYears, { lt1: '小于1年', '1to3': '1-3年', '3to5': '3-5年', gt5: '5年以上' }) }
  ].filter(item => item.value !== '未记录')
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()

  try {
    const isAdmin = await ensureAdmin(OPENID)
    if (!isAdmin) return { code: -1, msg: '无权限' }

    const limit = Math.min(Math.max(Number(event.limit) || 30, 1), 50)
    const page = Math.max(Number(event.page) || 0, 0)
    const initialRes = await db.collection('athletes')
      .where({
        levelReviewStatus: db.command.in(['pending', 'approved', 'rejected'])
      })
      .orderBy('levelReviewCreatedAt', 'desc')
      .skip(page * limit)
      .limit(limit)
      .get()

    const sPromotionRes = await db.collection('athletes')
      .where({ sPromotionReviewStatus: 'pending' })
      .skip(page * limit)
      .limit(limit)
      .get()
      .catch(() => ({ data: [] }))

    const athleteMap = {}
    ;[...(initialRes.data || []), ...(sPromotionRes.data || [])].forEach(item => { athleteMap[item._id] = item })
    const reviewedAthletes = Object.values(athleteMap)
      .sort((a, b) => new Date(b.sPromotionReviewCreatedAt || b.levelReviewCreatedAt || 0) - new Date(a.sPromotionReviewCreatedAt || a.levelReviewCreatedAt || 0))
      .slice(0, limit)

    const data = reviewedAthletes.map(athlete => {
      const proofFiles = formatProofFiles(athlete.proofFile)
      const isSPromotionReview = athlete.sPromotionReviewStatus === 'pending'
      return {
        _id: athlete._id,
        openid: athlete.openid || '',
        sportlightId: athlete.sportlightId || '',
        name: athlete.name || athlete.nickname || '未命名球员',
        nickname: athlete.nickname || '',
        sport: athlete.sport || '',
        position: athlete.position || '',
        secondaryPosition: athlete.secondaryPosition || '',
        city: athlete.city || '',
        affiliation: athlete.affiliation || '',
        age: athlete.age || '',
        height: athlete.height || '',
        weight: athlete.weight || '',
        wingspan: athlete.wingspan || '',
        preferredFoot: athlete.preferredFoot || '',
        preferredHand: athlete.preferredHand || '',
        description: athlete.description || '',
        careerLabel: athlete.careerLabel || '',
        levelLabel: athlete.levelLabel || '',
        proposedTier: isSPromotionReview ? 'S' : (athlete.proposedTier || athlete.initialTier || 'D'),
        currentTier: athlete.currentTier || athlete.rank || 'D',
        competitionScore: athlete.competitionScore || 0,
        proofFiles,
        hasProof: proofFiles.length > 0,
        trainedProfessionally: athlete.trainedProfessionally,
        hasProBackground: athlete.hasProBackground,
        hasAmateurLeague: athlete.hasAmateurLeague,
        hasTopThree: athlete.hasTopThree,
        topThreeCount: athlete.topThreeCount || '',
        playYears: athlete.playYears || '',
        competitiveBackground: athlete.competitiveBackground || athlete.cubalLevel || '',
        physicalItems: buildPhysicalItems(athlete),
        experienceItems: buildExperienceItems(athlete),
        certName: athlete.certName || '',
        certFiles: athlete.certFiles || [],
        videoName: athlete.videoName || '',
        videoFile: athlete.videoFile || '',
        levelReviewSource: athlete.levelReviewSource || '',
        levelReviewNote: athlete.levelReviewNote || '',
        levelReviewProofs: athlete.levelReviewProofs || [],
        levelReviewStatus: isSPromotionReview ? 'pending' : (athlete.levelReviewStatus || 'none'),
        statusLabel: isSPromotionReview ? 'S级晋升待审核' : statusLabel(athlete.levelReviewStatus || 'none'),
        levelReviewType: isSPromotionReview ? 'basketball_s_promotion' : 'initial',
        levelRejectReason: isSPromotionReview ? (athlete.sPromotionRejectReason || '') : (athlete.levelRejectReason || ''),
        reviewedAt: isSPromotionReview ? (athlete.sPromotionReviewedAt || null) : (athlete.levelReviewedAt || null),
        reviewedBy: isSPromotionReview ? (athlete.sPromotionReviewedBy || '') : (athlete.levelReviewedBy || '')
      }
    })

    return { code: 0, data, page, hasMore: (initialRes.data || []).length === limit || (sPromotionRes.data || []).length === limit }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
