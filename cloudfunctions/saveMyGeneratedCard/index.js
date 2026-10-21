const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const ALLOWED_STATUSES = new Set(['generated', 'ready'])

function text(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

function isCardRenderFile(fileID) {
  return fileID.startsWith('cloud://') &&
    (fileID.includes('/card-renders/') || fileID.includes('/player-cards/'))
}

function imageType(buffer) {
  if (!buffer || buffer.length < 12) return ''
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return ''
}

function portraitsFor(athlete) {
  let portraits = Array.isArray(athlete && athlete.cardPortraits)
    ? athlete.cardPortraits.filter(item => item && item.cutoutFileID).slice(0, 3)
    : []
  if (!portraits.length && athlete && athlete.cardPortrait && athlete.cardPortrait.cutoutFileID) {
    portraits = [{ ...athlete.cardPortrait, portraitId: athlete.cardPortrait.portraitId || 'legacy_portrait_1' }]
  }
  return portraits.map((item, index) => ({
    ...item,
    portraitId: item.portraitId || `legacy_portrait_${index + 1}`
  }))
}

async function validateImage(fileID, label, expectedCardPath) {
  if (!isCardRenderFile(fileID)) throw new Error(`${label}存储位置无效`)
  if (expectedCardPath && !fileID.includes(`/player-cards/${expectedCardPath}/`)) {
    throw new Error(`${label}不属于当前卡片`)
  }
  const result = await cloud.downloadFile({ fileID })
  const buffer = result.fileContent
  if (!buffer || !buffer.length) throw new Error(`${label}读取失败`)
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`${label}不能超过15MB`)
  const format = imageType(buffer)
  if (!format) throw new Error(`${label}仅支持PNG、JPG或WebP`)
  return { fileID, format, bytes: buffer.length }
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  try {
    let cardId = text(event && event.cardId, 512)
    const frontImage = text(event && event.frontImage, 1024)
    const backImage = text(event && event.backImage, 1024)
    if (!OPENID) return { code: -1, msg: '登录状态无效' }
    if (!cardId) return { code: -1, msg: '缺少卡片ID' }
    if (!frontImage || !backImage) return { code: -1, msg: '请同时生成卡片正面和背面' }

    // 新版卡片的 cardId 与文档 ID 一致；早期卡片可能使用自动生成的
    // 文档 ID。先按文档 ID 读取，再按业务卡号回退，避免生成页能打开、
    // 保存时却被错误判定为“不存在或无权限”。
    let cardRes = await db.collection('playerCards').doc(cardId).get().catch(() => ({ data: null }))
    let card = cardRes.data
    if (!card || card.ownerOpenid !== OPENID) {
      const fallbackRes = await db.collection('playerCards')
        .where({ cardId, ownerOpenid: OPENID })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
      card = (fallbackRes.data || [])[0] || null
      if (card && card._id) cardId = card._id
    }
    if (!card || card.ownerOpenid !== OPENID) return { code: -1, msg: '卡片不存在或无权操作' }
    if (card.status !== 'issued' || card.packStatus !== 'stored') {
      return { code: -1, msg: '只有已发放并存入卡包的卡片可以生成' }
    }
    if (card.frontImage || card.backImage || card.generationStatus === 'generated') {
      return { code: -1, msg: '该球星卡已经生成并锁定，不能重新设计或覆盖' }
    }
    const sourceRes = await db.collection('posts').doc(card.sourceId || '').get().catch(() => ({ data: null }))
    if (!sourceRes.data || sourceRes.data.platformCertified !== true ||
        sourceRes.data.certificationStatus !== 'approved' || sourceRes.data.cardIssuanceEnabled !== true) {
      return { code: -1, msg: '赛事尚未认证或认证已取消，不能生成卡片' }
    }
    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    const athlete = (athleteRes.data || [])[0] || {}
    const portraits = portraitsFor(athlete)
    const requestedPortraitId = text(event && event.portraitId, 100)
    const selectedPortrait = portraits.find(item => item.portraitId === requestedPortraitId) ||
      portraits.find(item => item.portraitId === athlete.activeCardPortraitId) ||
      portraits[0]
    if (!selectedPortrait) return { code: -1, msg: '没有找到可用于生成卡片的球星形象' }
    if (requestedPortraitId && selectedPortrait.portraitId !== requestedPortraitId) {
      return { code: -1, msg: '选择的球星形象不存在或不属于当前账号' }
    }

    const expectedCardPath = String(card.cardId || card._id || '').replace(/[^a-zA-Z0-9_-]/g, '_')
    const [front, back] = await Promise.all([
      validateImage(frontImage, '卡片正面', expectedCardPath),
      validateImage(backImage, '卡片背面', expectedCardPath)
    ])
    const requestedStatus = text(event.generationStatus, 24)
    const generationStatus = ALLOWED_STATUSES.has(requestedStatus) ? requestedStatus : 'generated'
    const template = event && event.template && typeof event.template === 'object' ? event.template : {}
    const metadata = {
      templateId: text(template.templateId || event.templateId, 80),
      templateName: text(template.templateName || event.templateName, 80),
      templateVersion: Math.max(1, Math.min(9999, Math.floor(Number(template.templateVersion || event.templateVersion) || 1))),
      compositionMode: (template.compositionMode || event.compositionMode) === 'full' ? 'full' : 'half',
      rendererVersion: text(template.rendererVersion || event.rendererVersion, 40),
      generatedAtMs: Date.now()
    }
    const now = Date.now()
    const previousRenderFiles = [card.frontImage, card.backImage]
      .filter(fileID => fileID && fileID !== frontImage && fileID !== backImage && isCardRenderFile(fileID))
    // Older cards (and an earlier syncMatchCards version) may contain
    // frontImageMeta/backImageMeta as null. Cloud Database expands nested
    // object updates into paths such as backImageMeta.bytes; such a write
    // fails when the parent currently equals null. Remove only the invalid
    // legacy parents before writing the new metadata objects.
    const legacyMetaCleanup = {}
    if (!card.frontImageMeta || typeof card.frontImageMeta !== 'object') {
      legacyMetaCleanup.frontImageMeta = _.remove()
    }
    if (!card.backImageMeta || typeof card.backImageMeta !== 'object') {
      legacyMetaCleanup.backImageMeta = _.remove()
    }
    if (!card.generationMetadata || typeof card.generationMetadata !== 'object') {
      legacyMetaCleanup.generationMetadata = _.remove()
    }
    if (!card.portraitSnapshot || typeof card.portraitSnapshot !== 'object') {
      legacyMetaCleanup.portraitSnapshot = _.remove()
    }
    if (Object.keys(legacyMetaCleanup).length) {
      await db.collection('playerCards').doc(cardId).update({ data: legacyMetaCleanup })
    }
    await db.collection('playerCards').doc(cardId).update({
      data: {
        frontImage,
        backImage,
        coverImage: frontImage,
        frontImageMeta: { format: front.format, bytes: front.bytes },
        backImageMeta: { format: back.format, bytes: back.bytes },
        generationStatus,
        generationMetadata: metadata,
        portraitId: selectedPortrait.portraitId,
        portraitSnapshot: {
          portraitId: selectedPortrait.portraitId,
          cutoutFileID: selectedPortrait.cutoutFileID,
          compositionMode: selectedPortrait.compositionMode === 'full' ? 'full' : 'half',
          scale: Number(selectedPortrait.scale) || 1,
          offsetX: Number(selectedPortrait.offsetX) || 0,
          offsetY: Number(selectedPortrait.offsetY) || 0,
          capturedAtMs: now
        },
        generatedAtMs: now,
        generatedAt: db.serverDate(),
        updatedAtMs: now,
        updatedAt: db.serverDate()
      }
    })
    if (previousRenderFiles.length) {
      await cloud.deleteFile({ fileList: [...new Set(previousRenderFiles)] }).catch(error => {
        console.warn('old card render cleanup failed', error)
      })
    }
    return {
      code: 0,
      msg: '球星卡成品已保存',
      data: {
        cardId, frontImage, backImage, generationStatus,
        generationMetadata: metadata,
        portraitId: selectedPortrait.portraitId
      }
    }
  } catch (error) {
    console.error('saveMyGeneratedCard failed', error)
    return { code: -1, msg: error.message || '保存球星卡失败' }
  }
}
