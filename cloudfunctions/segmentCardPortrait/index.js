const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_BASE64_BYTES = 5 * 1024 * 1024
const MAX_PORTRAITS = 3
const STARTER_UPLOADS = 3

function chinaMonthKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now)
  const values = {}
  parts.forEach(part => { values[part.type] = part.value })
  return `${values.year}-${values.month}`
}

function portraitId() {
  return `portrait_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function normalizePortraitState(athlete) {
  let portraits = Array.isArray(athlete.cardPortraits)
    ? athlete.cardPortraits.filter(item => item && item.cutoutFileID).slice(0, MAX_PORTRAITS)
    : []
  if (!portraits.length && athlete.cardPortrait && athlete.cardPortrait.cutoutFileID) {
    portraits = [{ ...athlete.cardPortrait, portraitId: athlete.cardPortrait.portraitId || 'legacy_portrait_1' }]
  }
  portraits = portraits.map((item, index) => ({
    ...item,
    portraitId: item.portraitId || `legacy_portrait_${index + 1}`
  }))
  const activeId = portraits.some(item => item.portraitId === athlete.activeCardPortraitId)
    ? athlete.activeCardPortraitId
    : (portraits[0] && portraits[0].portraitId) || ''
  const recordedCount = Number(athlete.cardPortraitUploadCount)
  // A legacy portrait represents one successful historical upload.
  const uploadCount = Number.isFinite(recordedCount)
    ? Math.max(0, recordedCount)
    : portraits.length
  return { portraits, activeId, uploadCount }
}

function quotaFor(athlete, now = new Date()) {
  const state = normalizePortraitState(athlete)
  const monthKey = chinaMonthKey(now)
  const starterRemaining = Math.max(0, STARTER_UPLOADS - state.uploadCount)
  const monthlyAvailable = starterRemaining === 0 && athlete.cardPortraitMonthlyUploadKey !== monthKey
  return {
    starterRemaining,
    monthlyAvailable,
    remaining: starterRemaining > 0 ? starterRemaining : (monthlyAvailable ? 1 : 0),
    monthKey,
    nextRefreshMonth: starterRemaining > 0 ? '' : monthKey,
    maxPortraits: MAX_PORTRAITS
  }
}

function findPortrait(state, requestedId) {
  const id = String(requestedId || state.activeId || '')
  return state.portraits.find(item => item.portraitId === id)
}

function publicData(athlete) {
  const state = normalizePortraitState(athlete)
  return {
    portraits: state.portraits,
    activePortraitId: state.activeId,
    activePortrait: findPortrait(state, state.activeId) || null,
    quota: quotaFor(athlete)
  }
}

function errorMessage(error) {
  const code = String((error && (error.code || error.Code)) || '')
  if (code.includes('NoPortrait')) return '没有识别到清晰的单人形象，请更换照片'
  if (code.includes('ImageSizeExceed')) return '照片尺寸过大，请上传小于2000×2000的照片'
  if (code.includes('ImageDecodeFailed')) return '照片格式无法识别，请使用JPG或PNG'
  if (code.includes('AuthFailure')) return '腾讯云抠图服务尚未正确配置'
  return (error && (error.message || error.errMsg)) || '自动抠图失败'
}

async function updatePortrait(athlete, event, mutator, successMessage) {
  const state = normalizePortraitState(athlete)
  const current = findPortrait(state, event && event.portraitId)
  if (!current) return { code: -1, msg: '没有找到要操作的球星形象' }
  const next = await mutator(current)
  const portraits = state.portraits.map(item => item.portraitId === current.portraitId ? next : item)
  await db.collection('athletes').doc(athlete._id).update({
    data: {
      cardPortraits: portraits,
      activeCardPortraitId: state.activeId,
      // Keep the legacy field synchronized for old clients.
      cardPortrait: portraits.find(item => item.portraitId === state.activeId) || portraits[0] || null,
      updatedAt: db.serverDate()
    }
  })
  return { code: 0, msg: successMessage, data: next, portraitId: next.portraitId }
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const fileID = String((event && event.fileID) || '')
  const action = String((event && event.action) || 'upload')
  const compositionMode = event && event.compositionMode === 'full' ? 'full' : 'half'

  try {
    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    const athlete = (athleteRes.data || [])[0]
    if (!athlete) return { code: -1, msg: '只有已注册运动员可以设置球星形象' }

    if (action === 'getState') {
      return { code: 0, data: publicData(athlete) }
    }

    if (action === 'selectActive') {
      const state = normalizePortraitState(athlete)
      const selected = findPortrait(state, event.portraitId)
      if (!selected) return { code: -1, msg: '没有找到要使用的球星形象' }
      await db.collection('athletes').doc(athlete._id).update({
        data: {
          activeCardPortraitId: selected.portraitId,
          cardPortrait: selected,
          cardPortraits: state.portraits,
          updatedAt: db.serverDate()
        }
      })
      return { code: 0, msg: '已切换球星形象', data: selected, portraitId: selected.portraitId }
    }

    if (action === 'deletePortrait') {
      const state = normalizePortraitState(athlete)
      const current = findPortrait(state, event.portraitId)
      if (!current) return { code: -1, msg: '没有找到要删除的球星形象' }
      const portraits = state.portraits.filter(item => item.portraitId !== current.portraitId)
      const activeId = state.activeId === current.portraitId
        ? ((portraits[0] && portraits[0].portraitId) || '')
        : state.activeId
      const active = portraits.find(item => item.portraitId === activeId) || null
      await db.collection('athletes').doc(athlete._id).update({
        data: {
          cardPortraits: portraits,
          activeCardPortraitId: activeId,
          cardPortrait: active,
          updatedAt: db.serverDate()
        }
      })
      // Deleting a saved image never refunds an upload opportunity.
      return { code: 0, msg: '球星形象已删除', data: { portraits, activePortraitId: activeId } }
    }

    if (action === 'saveLayout') {
      return updatePortrait(athlete, event, async current => {
        const scale = Math.min(1.8, Math.max(0.7, Number(event.scale) || (compositionMode === 'full' ? 1 : 1.18)))
        const offsetX = Math.min(0.3, Math.max(-0.3, Number(event.offsetX) || 0))
        const offsetY = Math.min(0.3, Math.max(-0.3, Number(event.offsetY) || 0))
        const timestamp = Date.now()
        return {
          ...current, compositionMode, scale, offsetX, offsetY,
          layoutStatus: 'ready', updatedAtMs: timestamp
        }
      }, '人物位置已保存')
    }

    if (action === 'saveManualCutout') {
      return updatePortrait(athlete, event, async current => {
        const cutoutFileID = String(event.cutoutFileID || '')
        if (!current.originalFileID || !current.cutoutFileID) throw new Error('请先上传照片并完成自动抠图')
        if (!cutoutFileID.startsWith('cloud://')) throw new Error('精修图片地址无效')
        if (!cutoutFileID.includes('card-portraits/manual/')) throw new Error('精修图片存储位置无效')
        const manualFile = await cloud.downloadFile({ fileID: cutoutFileID })
        const buffer = manualFile.fileContent
        const isPng = buffer && buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 &&
          buffer[2] === 0x4e && buffer[3] === 0x47
        if (!isPng || buffer.length > 10 * 1024 * 1024) throw new Error('精修图片格式或大小不符合要求')
        const timestamp = Date.now()
        return {
          ...current, cutoutFileID, manualCutoutFileID: cutoutFileID,
          manualEdited: true, manualEditedAtMs: timestamp,
          layoutStatus: 'ready', updatedAtMs: timestamp
        }
      }, '精修结果已保存')
    }

    if (!fileID.startsWith('cloud://')) return { code: -1, msg: '照片地址无效' }
    const beforeQuota = quotaFor(athlete)
    if (beforeQuota.remaining < 1) return { code: -1, msg: '本月上传机会已使用，请下个月再试', data: { quota: beforeQuota } }
    const beforeState = normalizePortraitState(athlete)
    const replacing = findPortrait(beforeState, event && event.portraitId)
    if (!replacing && beforeState.portraits.length >= MAX_PORTRAITS) {
      return { code: -1, msg: '最多保存3个球星形象，请选择一个已有形象进行替换' }
    }
    if (!process.env.TENCENT_SECRET_ID || !process.env.TENCENT_SECRET_KEY) {
      return { code: -1, msg: '请先配置腾讯云人像分割密钥' }
    }

    const download = await cloud.downloadFile({ fileID })
    const buffer = download.fileContent
    if (!buffer || !buffer.length) return { code: -1, msg: '照片读取失败，请重新上传' }
    const base64 = buffer.toString('base64')
    if (Buffer.byteLength(base64) > MAX_BASE64_BYTES) return { code: -1, msg: '照片过大，请压缩后重试' }

    const tencentcloud = require('tencentcloud-sdk-nodejs-bda')
    const BdaClient = tencentcloud.bda.v20200324.Client
    const client = new BdaClient({
      credential: { secretId: process.env.TENCENT_SECRET_ID, secretKey: process.env.TENCENT_SECRET_KEY },
      region: process.env.TENCENT_BDA_REGION || 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'bda.tencentcloudapi.com' } }
    })
    const result = await client.SegmentPortraitPic({ Image: base64, RspImgType: 'base64', Scene: 'GEN' })
    if (!result || result.HasForeground === false || !result.ResultImage) {
      return { code: -1, msg: '没有识别到完整人物，请更换一张单人照片' }
    }
    const cutoutBuffer = Buffer.from(result.ResultImage, 'base64')
    if (!cutoutBuffer.length) return { code: -1, msg: '抠图结果为空，请重新尝试' }
    const timestamp = Date.now()
    const newPortraitId = (replacing && replacing.portraitId) || portraitId()
    const cloudPath = `card-portraits/${OPENID}/${newPortraitId}/${timestamp}_cutout.png`
    const upload = await cloud.uploadFile({ cloudPath, fileContent: cutoutBuffer })
    const profile = {
      portraitId: newPortraitId,
      originalFileID: fileID,
      cutoutFileID: upload.fileID,
      autoCutoutFileID: upload.fileID,
      compositionMode,
      scale: compositionMode === 'full' ? 1 : 1.18,
      offsetX: compositionMode === 'full' ? 0.045 : 0.025,
      offsetY: 0,
      segmentationProvider: 'tencent_bda',
      segmentationStatus: 'ready',
      createdAtMs: (replacing && replacing.createdAtMs) || timestamp,
      updatedAtMs: timestamp
    }

    // Consume only after Tencent segmentation and cloud upload both succeed.
    const transaction = await db.runTransaction(async tx => {
      const latestRes = await tx.collection('athletes').doc(athlete._id).get()
      const latest = latestRes.data
      const state = normalizePortraitState(latest)
      const quota = quotaFor(latest)
      if (quota.remaining < 1) throw new Error('本月上传机会已使用，请下个月再试')
      const target = findPortrait(state, event && event.portraitId)
      if (!target && state.portraits.length >= MAX_PORTRAITS) throw new Error('最多保存3个球星形象，请选择一个已有形象进行替换')
      const id = (target && target.portraitId) || newPortraitId
      const savedProfile = { ...profile, portraitId: id }
      const portraits = target
        ? state.portraits.map(item => item.portraitId === target.portraitId ? savedProfile : item)
        : [...state.portraits, savedProfile]
      const activeId = state.activeId || id
      const uploadCount = state.uploadCount + 1
      const update = {
        cardPortraits: portraits,
        activeCardPortraitId: activeId,
        cardPortrait: portraits.find(item => item.portraitId === activeId) || savedProfile,
        cardPortraitUploadCount: uploadCount,
        updatedAt: db.serverDate()
      }
      // The third starter upload closes the current month's allowance. The
      // recurring allowance begins on the next China-calendar month.
      if (uploadCount >= STARTER_UPLOADS) update.cardPortraitMonthlyUploadKey = quota.monthKey
      await tx.collection('athletes').doc(athlete._id).update({ data: update })
      return { savedProfile, portraits, activeId, quota: quotaFor({ ...latest, ...update }) }
    })

    return {
      code: 0,
      msg: replacing ? '球星形象已替换' : '自动抠图完成',
      data: transaction.savedProfile,
      portraitId: transaction.savedProfile.portraitId,
      portraits: transaction.portraits,
      activePortraitId: transaction.activeId,
      quota: transaction.quota,
      requestId: result.RequestId || ''
    }
  } catch (error) {
    console.error('segmentCardPortrait failed', error)
    return { code: -1, msg: errorMessage(error) }
  }
}
