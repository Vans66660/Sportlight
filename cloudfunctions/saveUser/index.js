const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const TIER_BASE_SCORE = {
  'S+': 1200,
  S: 1040,
  'A+': 880,
  A: 720,
  'B+': 560,
  B: 400,
  'C+': 300,
  C: 200,
  'D+': 100,
  D: 0
}

// 篮球赏金令独立使用五档模型，不影响足球、羽毛球原有的十档竞技体系。
const BASKETBALL_TIER_BASE_SCORE = { S: 850, A: 650, B: 500, C: 300, D: 100 }

function getBasketballTier(score) {
  const value = Number(score) || 0
  if (value >= BASKETBALL_TIER_BASE_SCORE.S) return 'S'
  if (value >= BASKETBALL_TIER_BASE_SCORE.A) return 'A'
  if (value >= BASKETBALL_TIER_BASE_SCORE.B) return 'B'
  if (value >= BASKETBALL_TIER_BASE_SCORE.C) return 'C'
  return 'D'
}

function basketballResumeScore(profileData = {}) {
  if (profileData.hasProBackground === true && profileData.proofFile) return 800
  if (profileData.competitiveBackground === 'levelA' && profileData.proofFile) return 650
  if (profileData.competitiveBackground === 'levelB' && profileData.proofFile) return 500
  if (profileData.hasAmateurLeague === true && profileData.hasTopThree === true && profileData.proofFile) {
    return profileData.topThreeCount === 'gt3' ? 500 : 300
  }
  return 100
}

function basketballPhysicalScore(profileData = {}) {
  const position = String(profileData.position || '')
  const height = Number(profileData.height) || 0
  const positionScore = ['中锋', '大前锋'].includes(position) ? 100 : (position === '小前锋' ? 50 : 0)
  const heightScore = height >= 195 ? 100 : (height >= 190 ? 60 : (height >= 185 ? 30 : 0))
  return Math.min(200, positionScore + heightScore)
}

function getBasketballInitialAssessment(profileData = {}) {
  const resumeScore = basketballResumeScore(profileData)
  const physicalScore = basketballPhysicalScore(profileData)
  const recommendedScore = Math.min(1000, resumeScore + physicalScore)
  return {
    resumeScore,
    physicalScore,
    recommendedScore,
    recommendedTier: getBasketballTier(recommendedScore)
  }
}

function deriveInitialTier(profileData = {}) {
  const levelLabel = String(profileData.levelLabel || '')
  const labelTier = levelLabel.match(/^(S\+?|A\+?|B\+?|C\+?|D\+?)级/)
  if (labelTier && TIER_BASE_SCORE[labelTier[1]] !== undefined) return labelTier[1]

  if (profileData.hasProBackground === true && profileData.proofFile) return 'S'
  const competitiveBackground = profileData.competitiveBackground || profileData.cubalLevel
  if (competitiveBackground === 'levelA' && profileData.proofFile) return 'A'
  if (competitiveBackground === 'levelB' && profileData.proofFile) return 'B'
  if (profileData.hasAmateurLeague === true && profileData.hasTopThree === true && profileData.topThreeCount === 'gt3' && profileData.proofFile) return 'B'
  if (profileData.hasAmateurLeague === true && profileData.hasTopThree === true && profileData.proofFile) return 'C'
  return 'D'
}

function needsLevelReview(profileData = {}, tier = 'D') {
  return !!profileData.proofFile && tier !== 'D'
}

async function hasCompetitionRecords(openid) {
  const [logRes, resultRes] = await Promise.all([
    db.collection('competitionScoreLogs')
      .where({ athleteOpenid: openid })
      .limit(1)
      .get()
      .catch(() => ({ data: [] })),
    db.collection('eventResults')
      .where({ results: _.elemMatch({ openid }) })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
  ])
  return (logRes.data || []).length > 0 || (resultRes.data || []).length > 0
}

const sid = require('./sportlight-id')
const { ensureCollection, ensureSportlightId, normalizeSportlightId } = sid

function normalizeNickname(value, fallbackName, sportlightId) {
  const text = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24)
  return text || `用户${sportlightId || ''}`
}

function normalizeAthletePublicName(value, sportlightId) {
  const text = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24)
  return text || `用户${sportlightId || ''}`
}

function normalizeFileList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean)
}

function isValidRealName(name) {
  // 覆盖扩展汉字、繁体字和少数民族姓名中的“·”，与小程序端保持一致。
  return /^[\u3400-\u9FFF\uF900-\uFAFFA-Za-z·\s]{2,30}$/u.test(String(name || '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim())
}

function normalizeIdCard(idCard) {
  return String(idCard || '').trim().toUpperCase()
}

function isValidIdCard(idCard) {
  const id = normalizeIdCard(idCard)
  if (!/^\d{17}[\dX]$/.test(id)) return false

  const birth = id.slice(6, 14)
  const year = Number(birth.slice(0, 4))
  const month = Number(birth.slice(4, 6))
  const day = Number(birth.slice(6, 8))
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return false

  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const sum = weights.reduce((total, weight, index) => total + Number(id[index]) * weight, 0)
  return checks[sum % 11] === id[17]
}

function maskIdCard(idCard) {
  const id = normalizeIdCard(idCard)
  return id ? `${id.slice(0, 3)}***********${id.slice(-4)}` : ''
}

function birthDateFromIdCard(idCard) {
  const id = normalizeIdCard(idCard)
  if (!/^\d{17}[\dX]$/.test(id)) return ''
  const birth = id.slice(6, 14)
  return `${birth.slice(0, 4)}-${birth.slice(4, 6)}-${birth.slice(6, 8)}`
}

function normalizeBirthDate(value) {
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  const date = new Date(text.replace(/-/g, '/'))
  if (Number.isNaN(date.getTime())) return ''
  const [year, month, day] = text.split('-').map(Number)
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return ''
  if (date > new Date()) return ''
  return text
}

function calcAgeFromBirthDate(birthDate) {
  const normalized = normalizeBirthDate(birthDate)
  if (!normalized) return ''
  const birth = new Date(normalized.replace(/-/g, '/'))
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const hadBirthday = today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate())
  if (!hadBirthday) age -= 1
  return age >= 0 ? String(age) : ''
}

function hashIdCard(idCard) {
  return crypto.createHash('sha256').update(normalizeIdCard(idCard)).digest('hex')
}

async function getBossProfile(openid) {
  const res = await db.collection('bosses').where({ openid }).limit(1).get().catch(() => ({ data: [] }))
  return (res.data || [])[0] || {}
}

async function upsertBossProfile(openid, bossData) {
  await ensureCollection('bosses')
  const data = {
    ...bossData,
    openid,
    userType: 'boss',
    updatedAt: db.serverDate()
  }
  const res = await db.collection('bosses').where({ openid }).update({ data })
  if (!res.stats || res.stats.updated === 0) {
    await db.collection('bosses').add({
      data: {
        ...data,
        createdAt: db.serverDate()
      }
    })
  }
}

function normalizeText(text) {
  return String(text || '').trim().replace(/\s+/g, '')
}

function normalizeCreditCode(code) {
  return String(code || '').trim().toUpperCase()
}

function isValidCreditCode(code) {
  return /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(normalizeCreditCode(code))
}

async function verifyLicenseInfo(licenseFileID, companyName, creditCode) {
  const res = await cloud.callFunction({
    name: 'ocrLicense',
    data: { fileID: licenseFileID }
  })
  const result = res.result || {}
  if (result.code !== 0) {
    return { passed: false, msg: result.msg || '营业执照识别失败' }
  }
  const data = result.data || {}
  const ocrCompanyName = data.companyName || ''
  const ocrCreditCode = normalizeCreditCode(data.creditCode)
  if (!ocrCompanyName || !ocrCreditCode) {
    return { passed: false, msg: '营业执照信息识别不完整' }
  }
  if (normalizeText(companyName) !== normalizeText(ocrCompanyName)) {
    return { passed: false, msg: '企业名称需与营业执照一致' }
  }
  if (normalizeCreditCode(creditCode) !== ocrCreditCode) {
    return { passed: false, msg: '统一社会信用代码需与营业执照一致' }
  }
  return {
    passed: true,
    data: {
      ocrCompanyName,
      ocrCreditCode,
      ocrLegalPerson: data.legalPerson || '',
      ocrAddress: data.address || '',
      ocrBusiness: data.business || '',
      ocrPeriod: data.period || ''
    }
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { userType } = event
  const profileData = event.profileData || {}

  if (!['athlete', 'boss', 'venue'].includes(userType)) {
    return { code: -1, msg: '无效的用户类型' }
  }
  try {
    const currentUserRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    const currentUser = currentUserRes.data[0] || {}
    const sportlightId = await ensureSportlightId(OPENID, currentUser)
    if (!currentUser.phoneVerified && !profileData.phoneVerified) {
      return { code: -1, msg: '请先绑定手机号' }
    }

    if (userType === 'boss' && currentUser.registered && currentUser.userType === 'boss') {
      const currentBoss = await getBossProfile(OPENID)
      const bossProfileData = {
        sportlightId,
        name: profileData.name || currentBoss.name || currentUser.name || '',
        displayName: profileData.displayName || profileData.name || currentBoss.displayName || currentUser.displayName || currentUser.name || '',
        logo: profileData.logo || currentBoss.logo || currentUser.logo || '',
        bossType: profileData.bossType || currentBoss.bossType || currentUser.bossType || '',
        city: profileData.city || currentBoss.city || currentUser.city || '',
        description: profileData.description || '',
        phone: currentUser.phone || currentBoss.phone || '',
        purePhoneNumber: currentUser.purePhoneNumber || currentBoss.purePhoneNumber || currentUser.phone || '',
        countryCode: currentUser.countryCode || currentBoss.countryCode || '',
        phoneVerified: true,
        updatedAt: db.serverDate()
      }
      await Promise.all([
        db.collection('users').where({ openid: OPENID }).update({
          data: {
            ...bossProfileData,
            userType,
            activeUserType: userType,
            registered: true,
            subjectTypes: _.addToSet(userType)
          }
        }),
        upsertBossProfile(OPENID, bossProfileData)
      ])
      return { code: 0, msg: 'success' }
    }

    const phoneData = {
      phone: currentUser.phone || '',
      purePhoneNumber: currentUser.purePhoneNumber || currentUser.phone || '',
      countryCode: currentUser.countryCode || '',
      phoneVerified: true
    }

    let athleteIdentityData = null
    let bossIdentityData = null
    let bossLicenseData = null
    const athleteBirthDate = userType === 'athlete'
      ? normalizeBirthDate(profileData.birthDate) || ''
      : ''
    const athleteAge = athleteBirthDate
      ? calcAgeFromBirthDate(athleteBirthDate)
      : (profileData.age || '')
    if (userType === 'athlete') {
      const idCard = normalizeIdCard(profileData.idCard)
      // 兼容新旧客户端：旧端只传 name，新端同时传 name 和 realName。
      const realName = String(profileData.realName || profileData.name || '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim()
      const hasIdentityInput = !!idCard

      if (!isValidRealName(realName)) {
        return { code: -1, msg: '请填写真实姓名' }
      }

      if (hasIdentityInput) {
        if (!isValidRealName(realName) || !isValidIdCard(idCard)) {
          return { code: -1, msg: '请填写有效的实名信息' }
        }

        const idCardHash = hashIdCard(idCard)
        athleteIdentityData = {
          idCardHash,
          idCardMasked: maskIdCard(idCard),
          birthDate: birthDateFromIdCard(idCard),
          identityVerified: false
        }
      }
    }

    if (userType === 'boss') {
      const bossType = profileData.bossType || ''
      if (!['personal', 'company', 'club'].includes(bossType)) {
        return { code: -1, msg: '请选择主办方主体类型' }
      }

      if (bossType === 'company') {
        if (!profileData.companyName || !isValidCreditCode(profileData.creditCode) || !profileData.license) {
          return { code: -1, msg: '请完善企业资质信息' }
        }

        const license = await verifyLicenseInfo(profileData.license, profileData.companyName, profileData.creditCode)
        if (!license.passed) {
          return { code: -1, msg: license.msg || '营业执照信息校验未通过' }
        }
        bossLicenseData = {
          licenseVerified: true,
          licenseVerifiedAt: db.serverDate(),
          companyName: license.data.ocrCompanyName,
          creditCode: license.data.ocrCreditCode,
          legalName: license.data.ocrLegalPerson,
          ...license.data
        }
      } else if (bossType === 'personal' || (bossType === 'club' && profileData.clubType === 'grassroots')) {
        if (bossType === 'personal') {
          if (!profileData.name) {
            return { code: -1, msg: '请完善个人主体信息' }
          }
        }
        const clubDisplayName = profileData.displayName || profileData.name
        if (bossType === 'club' && (!clubDisplayName || !profileData.clubLogo)) {
          return { code: -1, msg: '请完善俱乐部信息' }
        }
      } else if (bossType === 'club') {
        const clubDisplayName = profileData.displayName || profileData.name
        if (profileData.clubType !== 'registered' || !clubDisplayName || !profileData.license || !profileData.clubLogo) {
          return { code: -1, msg: '请完善俱乐部资质信息' }
        }
      }
    }

    if (userType === 'venue') {
      if (!profileData.name || !profileData.venueType) {
        return { code: -1, msg: '请完善球馆基础信息' }
      }
      if (!profileData.address || !profileData.latitude || !profileData.longitude) {
        return { code: -1, msg: '请在地图上选择球馆位置' }
      }
      if (!Array.isArray(profileData.sports) || profileData.sports.length === 0) {
        return { code: -1, msg: '请选择支持运动' }
      }
      if (!Array.isArray(profileData.courtTypes) || profileData.courtTypes.length === 0) {
        return { code: -1, msg: '请选择场地规格' }
      }
      const courtCounts = profileData.courtCounts || {}
      const courtCountsOk = Array.isArray(profileData.courtTypes) &&
        profileData.courtTypes.every(type => Number(courtCounts[type]) > 0)
      if (!courtCountsOk || !profileData.openingStart || !profileData.openingEnd || !profileData.coverImage) {
        return { code: -1, msg: '请完善场地信息和主页展示照片' }
      }
      if (!profileData.operatorName) {
        return { code: -1, msg: '请填写运营者姓名' }
      }
    }

    const publicNickname = userType === 'athlete'
      ? normalizeAthletePublicName(profileData.nickname, sportlightId)
      : normalizeNickname(profileData.nickname, profileData.name, sportlightId)

    // 更新用户基本信息
    await db.collection('users')
      .where({ openid: OPENID })
      .update({
        data: {
          userType,
          activeUserType: userType,
          registered: true,
          subjectTypes: _.addToSet(userType),
          name: profileData.name || '',
          sportlightId,
          nickname: publicNickname,
          displayName: publicNickname,
          gender: profileData.gender || '',
          city: profileData.city || '',
          affiliation: profileData.affiliation || '',
          sport: profileData.sport || '',
          position: profileData.position || '',
          photo: profileData.photo || '',
          birthDate: athleteBirthDate,
          age: athleteAge,
          ...(athleteIdentityData || {}),
          ...phoneData,
          updatedAt: db.serverDate()
        }
      })

    if (userType === 'athlete') {
      const existing = await db.collection('athletes')
        .where({ openid: OPENID })
        .get()
      const existingAthlete = existing.data[0] || {}
      const athleteLevelCertFiles = normalizeFileList(profileData.athleteLevelCertFiles || profileData.athleteLevelCertFile)

      const athleteData = {
        openid: OPENID,
        sportlightId,
        name: profileData.name || '',
        nickname: publicNickname,
        displayName: publicNickname,
        description: profileData.description || '',
        gender: profileData.gender || '',
        city: profileData.city || '',
        affiliation: profileData.affiliation || '',
        sport: profileData.sport || '',
        position: profileData.position || '',
        secondaryPosition: profileData.secondaryPosition || '',
        birthDate: athleteBirthDate,
        age: athleteAge,
        height: profileData.height || '',
        weight: profileData.weight || '',
        wingspan: profileData.wingspan || '',
        preferredFoot: profileData.preferredFoot || '',
        preferredHand: profileData.preferredHand || '',
        acceptMatch: profileData.acceptMatch || false,
        acceptAd: false,
        matchPrice: profileData.matchPrice || 0,
        adPrice: 0,
        photo: profileData.photo || '',
        videoUploaded: profileData.videoUploaded || false,
        videoName: profileData.videoName || '',
        videoFile: profileData.videoFile || '',
        certUploaded: profileData.certUploaded || false,
        certName: profileData.certName || '',
        certFiles: profileData.certFiles || [],
        phoneVerified: phoneData.phoneVerified,
        trainedProfessionally: profileData.trainedProfessionally,
        hasProBackground: profileData.hasProBackground,
        proofFile: profileData.proofFile || '',
        isStudent: profileData.isStudent === true,
        studentProofFile: profileData.studentProofFile || '',
        studentProofFiles: normalizeFileList(profileData.studentProofFiles || profileData.studentProofFile),
        studentVerified: existingAthlete.studentVerified === true && profileData.isStudent === true,
        athleteLevelCertFile: profileData.athleteLevelCertFile || '',
        athleteLevelCertFiles,
        hasAthleteLevelCert: athleteLevelCertFiles.length > 0,
        athleteLevelCertLevel: String(profileData.athleteLevelCertLevel || '').trim().slice(0, 20),
        athleteLevelCertVerified: existingAthlete.athleteLevelCertVerified === true && profileData.athleteLevelCertFile === existingAthlete.athleteLevelCertFile,
        hasAmateurLeague: profileData.hasAmateurLeague,
        hasTopThree: profileData.hasTopThree,
        topThreeCount: profileData.topThreeCount || '',
        playYears: profileData.playYears || '',
        competitiveBackground: profileData.competitiveBackground || profileData.cubalLevel || '',
        careerLabel: profileData.careerLabel || '',
        levelLabel: profileData.levelLabel || '',
        ...athleteIdentityData,
        socials: [],
        updatedAt: db.serverDate()
      }

      const isBasketball = profileData.sport === '篮球'
      const basketballAssessment = isBasketball ? getBasketballInitialAssessment(profileData) : null
      const initialTier = isBasketball ? basketballAssessment.recommendedTier : deriveInitialTier(profileData)
      const initialCompetitionScore = isBasketball ? basketballAssessment.recommendedScore : (TIER_BASE_SCORE[initialTier] || 0)
      // CBA/NBA/国家队等 S 级硬履历可直接由首次审核确认；A 级履历叠加身体分达到 S 门槛时，先按 A 级入驻，再单独审核 S 级晋升。
      const basketballRequiresSPromotionReview = isBasketball && initialTier === 'S' && basketballAssessment.resumeScore < 800
      const reviewTier = basketballRequiresSPromotionReview ? 'A' : initialTier
      // 篮球球员的推荐档位都需审核后才可接赏金令；其他项目保持原有逻辑。
      const levelReviewPending = isBasketball || needsLevelReview(profileData, initialTier)
      const activeInitialTier = levelReviewPending ? 'D' : initialTier
      const activeInitialCompetitionScore = levelReviewPending ? (isBasketball ? BASKETBALL_TIER_BASE_SCORE.D : 0) : initialCompetitionScore
      athleteData.levelReviewStatus = levelReviewPending ? 'pending' : 'none'
      athleteData.levelRejectReason = ''
      if (isBasketball) {
        athleteData.basketballPricingVersion = 'basketball-bounty-v1'
        athleteData.basketballRecommendedTier = basketballAssessment.recommendedTier
        athleteData.basketballRecommendedScore = basketballAssessment.recommendedScore
        athleteData.basketballResumeScore = basketballAssessment.resumeScore
        athleteData.basketballPhysicalScore = basketballAssessment.physicalScore
        athleteData.basketballBountyEligible = false
        athleteData.basketballRequiresSPromotionReview = basketballRequiresSPromotionReview
        athleteData.sPromotionReviewStatus = 'none'
      }

      if (existing.data.length > 0) {
        athleteData.proposedTier = reviewTier
        athleteData.proposedCompetitionScore = initialCompetitionScore
        athleteData.levelReviewStatus = levelReviewPending ? 'pending' : 'none'
        athleteData.levelRejectReason = ''
        if (levelReviewPending) athleteData.levelReviewCreatedAt = db.serverDate()
        athleteData.initialTier = activeInitialTier
        athleteData.initialCompetitionScore = activeInitialCompetitionScore
        const hasRecords = await hasCompetitionRecords(OPENID)
        const canResetInitialTier = !hasRecords && (
          !existingAthlete.competitionScore ||
          existingAthlete.competitionScore === existingAthlete.initialCompetitionScore
        )
        if (canResetInitialTier) {
          athleteData.rank = activeInitialTier
          athleteData.currentTier = activeInitialTier
          athleteData.competitionScore = activeInitialCompetitionScore
          athleteData.currentSeasonScore = 0
        }
        await db.collection('athletes')
          .where({ openid: OPENID })
          .update({ data: athleteData })
      } else {
        // 新运动员按注册评估给初始段位；后续赛事积分在该基础分上叠加。
        athleteData.proposedTier = reviewTier
        athleteData.proposedCompetitionScore = initialCompetitionScore
        athleteData.levelReviewCreatedAt = levelReviewPending ? db.serverDate() : null
        athleteData.initialTier = activeInitialTier
        athleteData.initialCompetitionScore = activeInitialCompetitionScore
        athleteData.rank = activeInitialTier
        athleteData.currentTier = activeInitialTier
        athleteData.competitionScore = activeInitialCompetitionScore
        athleteData.currentSeasonScore = 0
        athleteData.orderCount = 0
        athleteData.rating = 0
        athleteData.reputation = 80
        athleteData.avgPrice = 0
        athleteData.marketValue = 0
        athleteData.createdAt = db.serverDate()
        await db.collection('athletes').add({ data: athleteData })
      }
    }

    if (userType === 'boss') {
      const has = key => Object.prototype.hasOwnProperty.call(profileData || {}, key)
      const bossData = {
        sportlightId,
        name: profileData.name || '',
        displayName: profileData.displayName || profileData.name || '',
        logo: profileData.logo || '',
        bossType: profileData.bossType || '',
        city: profileData.city || '',
        phone: phoneData.phone,
        purePhoneNumber: phoneData.purePhoneNumber,
        countryCode: phoneData.countryCode,
        description: profileData.description || '',
        wechatVerified: profileData.wechatVerified || false,
        phoneVerified: phoneData.phoneVerified,
        ...(bossIdentityData || {}),
        updatedAt: db.serverDate()
      }

      const certificationFields = [
        'realName', 'idCard',
        'receiveMethod', 'wxpayBound',
        'companyName', 'creditCode', 'license',
        'legalType', 'legalName', 'legalIdCard',
        'agentName', 'agentIdCard', 'authLetter',
        'clubType', 'clubLogo', 'displayName'
      ]
      certificationFields.forEach(key => {
        if (has(key)) bossData[key] = profileData[key]
      })
      if (bossLicenseData) Object.assign(bossData, bossLicenseData)

      await Promise.all([
        db.collection('users')
          .where({ openid: OPENID })
          .update({
            data: {
              ...bossData,
              userType: 'boss',
              activeUserType: 'boss',
              registered: true,
              subjectTypes: _.addToSet('boss')
            }
          }),
        upsertBossProfile(OPENID, bossData)
      ])
    }

    if (userType === 'venue') {
      const venueData = {
        ownerOpenid: OPENID,
        name: profileData.name || '',
        venueType: profileData.venueType || '',
        city: profileData.city || '',
        address: profileData.address || '',
        locationName: profileData.locationName || '',
        latitude: Number(profileData.latitude),
        longitude: Number(profileData.longitude),
        sports: profileData.sports || [],
        courtTypes: profileData.courtTypes || [],
        courtCounts: profileData.courtCounts || {},
        openingStart: profileData.openingStart || '',
        openingEnd: profileData.openingEnd || '',
        openingHours: profileData.openingStart && profileData.openingEnd
          ? `${profileData.openingStart}-${profileData.openingEnd}`
          : '',
        coverImage: profileData.coverImage || '',
        galleryImages: profileData.galleryImages || [],
        operatorName: profileData.operatorName || '',
        phone: phoneData.phone,
        purePhoneNumber: phoneData.purePhoneNumber,
        countryCode: phoneData.countryCode,
        phoneVerified: phoneData.phoneVerified,
        licenseImages: profileData.licenseImages || [],
        description: profileData.description || '',
        status: 'pending',
        updatedAt: db.serverDate()
      }

      const existingVenue = await db.collection('venues')
        .where({ ownerOpenid: OPENID })
        .limit(1)
        .get()

      let venueId = ''
      if (existingVenue.data.length > 0) {
        venueId = existingVenue.data[0]._id
        await db.collection('venues')
          .doc(venueId)
          .update({ data: venueData })
      } else {
        venueData.createdAt = db.serverDate()
        const addRes = await db.collection('venues').add({ data: venueData })
        venueId = addRes._id
      }

      await db.collection('users')
        .where({ openid: OPENID })
        .update({
          data: {
            name: profileData.name || '',
            userType: 'venue',
            activeUserType: 'venue',
            registered: true,
            subjectTypes: _.addToSet('venue'),
            venueId,
            venueStatus: 'pending',
            venueName: profileData.name || '',
            venueCoverImage: profileData.coverImage || '',
            updatedAt: db.serverDate()
          }
        })
    }

    return { code: 0, msg: 'success' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
