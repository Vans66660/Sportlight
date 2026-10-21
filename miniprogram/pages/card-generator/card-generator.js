const CANVAS = { width: 630, height: 880 }
const {
  ORANGE_FIELD_BASE,
  getPortraitDrawRect,
  getPlayerViewport
} = require('../../config/card-layouts')

const STAT_LABELS = {
  goals: '进球', goal: '进球', assists: '助攻', assist: '助攻',
  saves: '扑救', save: '扑救', keySaves: '扑救',
  tackles: '抢断', tackle: '抢断', interceptions: '拦截', interception: '拦截',
  clearances: '解围', clearance: '解围', keyPasses: '关键传球', keyPass: '关键传球',
  successfulDribbles: '成功过人', dribbles: '成功过人', shots: '射门',
  fouls: '犯规', errors: '失误', error: '失误', yellowCards: '黄牌', redCards: '红牌'
}

function localAsset(path) {
  // Copy package assets into USER_DATA_PATH first. iOS may produce a package
  // URL from getImageInfo that <image> accepts but CanvasImage rejects.
  const source = String(path || '')
  if (!source.startsWith('/')) {
    return new Promise((resolve, reject) => wx.getImageInfo({
      src: source,
      success: res => resolve(res.path || source),
      fail: reject
    }))
  }
  const fs = wx.getFileSystemManager()
  const fileName = source.split('/').pop() || `card-${Date.now()}.jpg`
  const target = `${wx.env.USER_DATA_PATH}/${fileName}`
  return new Promise(resolve => {
    fs.readFile({
      filePath: source,
      success: readResult => {
        fs.writeFile({
          filePath: target,
          data: readResult.data,
          success: () => resolve(target),
          fail: () => resolve(source)
        })
      },
      fail: () => resolve(source)
    })
  })
}

function imageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({ src, success: resolve, fail: reject })
  })
}

function cloudAsset(fileID) {
  if (!fileID) return Promise.resolve('')
  if (!String(fileID).startsWith('cloud://')) {
    if (/^https?:\/\//i.test(String(fileID))) {
      return imageInfo(fileID).then(result => result.path || fileID).catch(() => fileID)
    }
    return Promise.resolve(fileID)
  }
  return wx.cloud.downloadFile({ fileID }).then(res => {
    return new Promise((resolve, reject) => {
      wx.compressImage({ src: res.tempFilePath, destWidth: 800, quality: 80, success: r => resolve(r.tempFilePath), fail: () => resolve(res.tempFilePath) })
    })
  })
}

function imageFor(canvas, src) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage()
    let done = false
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout')) } }, 120000)
    image.onload = () => { if (!done) { done = true; clearTimeout(timer); resolve(image) } }
    image.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('load_failed')) } }
    image.src = src
  })
}

function optionalImageFor(canvas, src) {
  if (!src) return Promise.resolve(null)
  return imageFor(canvas, src).catch(() => null)
}

function fitText(ctx, text, maxWidth, startSize, minSize) {
  let size = startSize
  while (size > minSize) {
    ctx.font = `800 ${size}px sans-serif`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 2
  }
  return size
}

function ellipsizeText(ctx, value, maxWidth) {
  const text = String(value || '')
  if (ctx.measureText(text).width <= maxWidth) return text
  let output = text
  while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) {
    output = output.slice(0, -1)
  }
  return `${output}…`
}

function styleRect(rect, width, height) {
  return [
    `left:${rect.x / width * 100}%`,
    `top:${rect.y / height * 100}%`,
    `width:${rect.width / width * 100}%`,
    `height:${rect.height / height * 100}%`
  ].join(';')
}

function drawCroppedImage(ctx, image, sourceBounds, drawRect, viewport) {
  const left = Math.max(drawRect.x, viewport.x)
  const top = Math.max(drawRect.y, viewport.y)
  const right = Math.min(drawRect.x + drawRect.width, viewport.x + viewport.width)
  const bottom = Math.min(drawRect.y + drawRect.height, viewport.y + viewport.height)
  if (right <= left || bottom <= top) return
  const sx = sourceBounds.x + (left - drawRect.x) / drawRect.width * sourceBounds.width
  const sy = sourceBounds.y + (top - drawRect.y) / drawRect.height * sourceBounds.height
  const sw = (right - left) / drawRect.width * sourceBounds.width
  const sh = (bottom - top) / drawRect.height * sourceBounds.height
  // Nine-argument drawImage performs a real source crop. This is more reliable
  // than ctx.clip() on real-device WeChat Canvas implementations.
  ctx.drawImage(image, sx, sy, sw, sh, left, top, right - left, bottom - top)
}

function drawCircularBadge(ctx, image, centerX, centerY, radius) {
  if (!image) return
  ctx.save()
  ctx.shadowColor = 'rgba(17,45,77,.20)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 3
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius + 4, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
  ctx.clip()
  const sourceWidth = Math.max(1, Number(image.width) || radius * 2)
  const sourceHeight = Math.max(1, Number(image.height) || radius * 2)
  const side = Math.min(sourceWidth, sourceHeight)
  const sourceX = (sourceWidth - side) / 2
  const sourceY = (sourceHeight - side) / 2
  ctx.drawImage(image, sourceX, sourceY, side, side, centerX - radius, centerY - radius, radius * 2, radius * 2)
  ctx.restore()
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius + 4, 0, Math.PI * 2)
  ctx.strokeStyle = '#D5A548'
  ctx.lineWidth = 2
  ctx.stroke()
}

async function alphaContentBounds(canvas, imagePath, imageSize) {
  const sourceWidth = Math.max(1, Number(imageSize && imageSize.width) || 1)
  const sourceHeight = Math.max(1, Number(imageSize && imageSize.height) || 1)
  const fallback = { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
  try {
    const image = await imageFor(canvas, imagePath)
    const maxScan = 420
    const ratio = Math.min(maxScan / sourceWidth, maxScan / sourceHeight, 1)
    const scanWidth = Math.max(1, Math.round(sourceWidth * ratio))
    const scanHeight = Math.max(1, Math.round(sourceHeight * ratio))
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, CANVAS.width, CANVAS.height)
    ctx.drawImage(image, 0, 0, scanWidth, scanHeight)
    const pixels = ctx.getImageData(0, 0, scanWidth, scanHeight).data
    let minX = scanWidth
    let minY = scanHeight
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < scanHeight; y += 1) {
      for (let x = 0; x < scanWidth; x += 1) {
        if (pixels[(y * scanWidth + x) * 4 + 3] < 12) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX < minX || maxY < minY) return fallback
    const paddingX = Math.max(2, Math.round((maxX - minX + 1) * 0.025))
    const paddingY = Math.max(2, Math.round((maxY - minY + 1) * 0.018))
    minX = Math.max(0, minX - paddingX)
    minY = Math.max(0, minY - paddingY)
    maxX = Math.min(scanWidth - 1, maxX + paddingX)
    maxY = Math.min(scanHeight - 1, maxY + paddingY)
    return {
      x: minX / ratio,
      y: minY / ratio,
      width: (maxX - minX + 1) / ratio,
      height: (maxY - minY + 1) / ratio
    }
  } catch (error) {
    console.warn('alpha bounds scan failed, using full portrait canvas', error)
    return fallback
  }
}

function fullImageRectForContent(drawRect, sourceBounds, sourceWidth, sourceHeight) {
  const width = drawRect.width * sourceWidth / sourceBounds.width
  const height = drawRect.height * sourceHeight / sourceBounds.height
  return {
    x: drawRect.x - sourceBounds.x / sourceWidth * width,
    y: drawRect.y - sourceBounds.y / sourceHeight * height,
    width,
    height
  }
}

function dateText(value) {
  if (!value) return '比赛日期待补充'
  const raw = String(value)
  const parsed = new Date(raw.replace(/-/g, '/'))
  if (Number.isNaN(parsed.getTime())) return raw
  return `${parsed.getFullYear()}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${String(parsed.getDate()).padStart(2, '0')}`
}

function canvasTempFile(canvas, options = {}) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: options.fileType || 'png',
      quality: options.quality || 1,
      destWidth: options.width || canvas.width,
      destHeight: options.height || canvas.height,
      success: result => resolve(result.tempFilePath),
      fail: reject
    })
  })
}

async function removeConnectedWhiteBackground(canvas, imagePath, imageSize) {
  const sourceWidth = Math.max(1, Number(imageSize && imageSize.width) || 1)
  const sourceHeight = Math.max(1, Number(imageSize && imageSize.height) || 1)
  const ratio = Math.min(700 / sourceWidth, 880 / sourceHeight, 1)
  const width = Math.max(1, Math.round(sourceWidth * ratio))
  const height = Math.max(1, Math.round(sourceHeight * ratio))
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const image = await imageFor(canvas, imagePath)
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  const pixels = imageData.data
  const total = width * height
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  const isBackground = index => {
    const offset = index * 4
    const r = pixels[offset]
    const g = pixels[offset + 1]
    const b = pixels[offset + 2]
    const a = pixels[offset + 3]
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    const connectedWhite = a > 235 && r > 235 && g > 235 && b > 235 && chroma < 18
    const connectedBlack = a > 235 && r < 24 && g < 24 && b < 24 && chroma < 14
    return a < 12 || connectedWhite || connectedBlack
  }
  const enqueue = index => {
    if (index < 0 || index >= total || visited[index] || !isBackground(index)) return
    visited[index] = 1
    queue[tail++] = index
  }
  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) enqueue(index - 1)
    if (x + 1 < width) enqueue(index + 1)
    if (y > 0) enqueue(index - width)
    if (y + 1 < height) enqueue(index + width)
  }
  if (!tail) return { path: imagePath, info: imageSize }
  for (let index = 0; index < total; index += 1) {
    if (visited[index]) pixels[index * 4 + 3] = 0
  }
  ctx.putImageData(imageData, 0, 0)
  const path = await canvasTempFile(canvas, { fileType: 'png', width, height })
  return { path, info: { width, height } }
}

Page({
  data: {
    cardId: '',
    card: {},
    playerName: '',
    portrait: null,
    portraits: [],
    selectedPortraitId: '',
    loading: true,
    rendering: false,
    saving: false,
    generated: false,
    activeSide: 'front',
    errorMessage: '',
    progress: 0,
    progressText: '',
    needsPortrait: false,
    hasExistingRender: false,
    needsRegeneration: false,
    frontTemplateSrc: ORANGE_FIELD_BASE.assets.front,
    backTemplateSrc: ORANGE_FIELD_BASE.assets.back,
    portraitPreviewSrc: '',
    portraitPreviewStyle: '',
    playerViewportStyle: '',
    previewTeam: '',
    previewPosition: '',
    previewEvent: '',
    previewMatch: '',
    previewDate: '',
    previewStats: [],
    previewCardId: '',
    layoutScale: 1,
    layoutScaleMin: 0.78,
    layoutScaleMax: 1.58,
    layoutScalePercent: 100,
    layoutOffsetXPercent: 0,
    layoutOffsetYPercent: 0,
    layoutDirty: false,
    previewWarning: ''
  },

  onLoad(options) {
    this.setData({ cardId: decodeURIComponent(options.cardId || '') })
  },

  onReady() {
    this.canvasReady = true
    this.loadCard()
  },

  loadCard() {
    if (!this.canvasReady || !this.data.cardId) {
      if (this.canvasReady) this.setData({ loading: false, errorMessage: '没有找到要生成的比赛卡' })
      return
    }
    this.setData({ loading: true, errorMessage: '' })
    wx.cloud.callFunction({
      name: 'getMyCards',
      success: res => {
        const result = res.result || {}
        if (result.code !== 0) {
          this.setData({
            loading: false,
            errorMessage: result.msg || '读取球星卡失败，请稍后重试'
          })
          return
        }
        const card = (result.cards || []).find(item => item._id === this.data.cardId || item.cardId === this.data.cardId)
        if (!card) {
          this.setData({
            loading: false,
            errorMessage: '未找到可生成的卡片。请确认使用原账号登录，且该赛事仍保持平台认证。'
          })
          return
        }
        if (card.frontImage || card.backImage || card.generationStatus === 'generated') {
          this.setData({
            card,
            loading: false,
            errorMessage: '这张球星卡已经生成并锁定，不能重新设计或覆盖'
          })
          return
        }
        const playerName = (card.playerSnapshot && card.playerSnapshot.name) || 'SPORTLIGHT 球员'
        const portraits = this.availablePortraits(result)
        const savedPortraitId = String(
          card.portraitId ||
          (card.portraitSnapshot && card.portraitSnapshot.portraitId) ||
          ''
        )
        const portrait = (
          portraits.find(item => this.portraitKey(item) === savedPortraitId) ||
          this.matchPortrait(portraits, card.portraitSnapshot) ||
          this.matchPortrait(portraits, result.activeCardPortrait) ||
          portraits[0] ||
          null
        )
        this.setData({
          card,
          portraits,
          portrait,
          selectedPortraitId: this.portraitKey(portrait),
          playerName,
          generated: card.generationStatus === 'generated' && !!(card.frontImage || card.coverImage),
          hasExistingRender: !!(card.frontImage || card.coverImage),
          needsRegeneration: card.generationStatus === 'stale',
          needsPortrait: !portrait,
          loading: false,
          ...this.layoutControlData(portrait),
          portraitPreviewSrc: portrait ? portrait.cutoutFileID : '',
          portraitPreviewStyle: 'left:0;top:0;width:100%;height:100%',
          playerViewportStyle: styleRect(getPlayerViewport(CANVAS.width, CANVAS.height), CANVAS.width, CANVAS.height),
          ...this.previewTextData(card, playerName)
        }, () => {
          if (!portrait) return
          setTimeout(() => this.prepareLivePreview(), 120)
        })
      },
      fail: error => {
        console.error('load card failed', error)
        this.setData({ loading: false, errorMessage: '读取球星卡失败，请检查网络后重试' })
      }
    })
  },

  portraitKey(portrait) {
    return portrait ? String(portrait._portraitId || portrait.portraitId || portrait._id || '') : ''
  },

  matchPortrait(portraits, target) {
    if (!target) return null
    const targetKey = this.portraitKey(target)
    if (targetKey) return portraits.find(item => this.portraitKey(item) === targetKey) || null
    return portraits.find(item => item.cutoutFileID && item.cutoutFileID === target.cutoutFileID) || null
  },

  availablePortraits(result) {
    const supplied = Array.isArray(result.cardPortraits) ? result.cardPortraits : []
    const legacy = result.activeCardPortrait || result.cardPortrait
    const portraits = supplied.slice(0, 3)
    if (!portraits.length && legacy) portraits.push(legacy)
    return portraits
      .filter(item => item && item.cutoutFileID)
      .map((item, index) => ({
        ...item,
        _portraitId: String(item.portraitId || item._id || ''),
        _portraitLabel: item.name || item.label || `形象 ${index + 1}`
      }))
  },

  selectPortrait(e) {
    if (this.data.rendering || this.data.saving) return
    const portraitId = String(e.currentTarget.dataset.portraitId || '')
    const portrait = this.data.portraits.find(item => this.portraitKey(item) === portraitId)
    if (!portrait || portrait === this.data.portrait) return
    this.setData({
      portrait,
      selectedPortraitId: portraitId,
      layoutDirty: false,
      ...this.layoutControlData(portrait)
    }, () => {
      this.renderBoth().catch(error => {
        console.error('portrait preview failed', error)
        this.setData({ rendering: false })
      })
    })
  },

  switchSide(e) {
    this.setData({ activeSide: e.currentTarget.dataset.side === 'back' ? 'back' : 'front' })
  },

  previewTextData(card, playerName) {
    const snapshot = card.playerSnapshot || {}
    const match = card.matchSnapshot || {}
    const score = card.scoreSnapshot || {}
    const home = match.homeTeamName || snapshot.teamName || '参赛球队'
    const away = match.awayTeamName || match.opponentTeamName || '对手球队'
    const hasScore = match.homeScore !== undefined && match.homeScore !== null &&
      match.awayScore !== undefined && match.awayScore !== null
    const stats = this.bestStatsFor(card)
    const fallback = [
      { label: '比赛积分', value: Number(score.delta) || Number(score.eventScore) || 0 },
      { label: '比赛结果', value: this.matchResultText(card) },
      { label: '出场身份', value: card.appearanceType === 'substitute' ? '替补' : '首发' }
    ]
    const rawId = String(card.cardId || card._id || '')
    return {
      playerName,
      previewTeam: snapshot.teamName || 'SPORTLIGHT',
      previewPosition: snapshot.position || '球员',
      previewEvent: match.eventTitle || '认证比赛',
      previewMatch: hasScore
        ? `${home}  ${match.homeScore} : ${match.awayScore}  ${away}`
        : `${home}  VS  ${away}`,
      previewDate: dateText(match.matchTime || match.eventDate),
      previewStats: stats.concat(fallback).slice(0, 3),
      previewCardId: rawId.length > 14 ? `SL · ${rawId.slice(-10)}` : rawId
    }
  },

  matchResultText(card) {
    const match = (card && card.matchSnapshot) || {}
    const homeScore = Number(match.homeScore)
    const awayScore = Number(match.awayScore)
    if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
      if (homeScore === awayScore) return '平'
      const teamName = String(((card.playerSnapshot || {}).teamName) || '')
      const isAway = teamName && teamName === String(match.awayTeamName || '')
      const won = isAway ? awayScore > homeScore : homeScore > awayScore
      return won ? '胜' : '负'
    }
    const raw = String(match.result || '').trim().toUpperCase()
    if (['W', 'WIN', 'WON', '胜'].includes(raw)) return '胜'
    if (['D', 'DRAW', '平'].includes(raw)) return '平'
    if (['L', 'LOSS', 'LOSE', 'LOST', '负'].includes(raw)) return '负'
    return '已完赛'
  },

  layoutControlData(portrait) {
    if (!portrait) return {}
    const mode = portrait.compositionMode === 'full' ? 'full' : 'half'
    const preset = require('../../config/card-layouts').COMPOSITION_PRESETS[mode]
    const scale = Number(portrait.scale) || preset.scale.default
    const offsetX = Number(portrait.offsetX) || 0
    const offsetY = Number(portrait.offsetY) || 0
    return {
      layoutScale: scale,
      layoutScaleMin: preset.scale.min,
      layoutScaleMax: preset.scale.max,
      layoutScalePercent: Math.round(scale * 100),
      layoutOffsetXPercent: Math.round(offsetX * 100),
      layoutOffsetYPercent: Math.round(offsetY * 100)
    }
  },

  updatePortraitPreview() {
    const portrait = this.data.portrait
    const contentBounds = this.portraitContentBounds
    const imageSize = this.portraitImageSize
    if (!portrait || !contentBounds || !imageSize) return
    const viewport = getPlayerViewport(CANVAS.width, CANVAS.height)
    const drawRect = getPortraitDrawRect({
      canvasWidth: CANVAS.width,
      canvasHeight: CANVAS.height,
      sourceWidth: contentBounds.width,
      sourceHeight: contentBounds.height,
      compositionMode: portrait.compositionMode,
      scale: portrait.scale,
      offsetX: portrait.offsetX,
      offsetY: portrait.offsetY
    })
    const fullRect = fullImageRectForContent(drawRect, contentBounds, imageSize.width, imageSize.height)
    this.setData({
      portraitPreviewStyle: styleRect({
        x: fullRect.x - viewport.x,
        y: fullRect.y - viewport.y,
        width: fullRect.width,
        height: fullRect.height
      }, viewport.width, viewport.height),
      playerViewportStyle: styleRect(viewport, CANVAS.width, CANVAS.height)
    })
  },

  changeLayoutScale(e) {
    const scale = Number(e.detail.value)
    this.frontCanvas = null
    this.setData({
      portrait: { ...this.data.portrait, scale },
      layoutScale: scale,
      layoutScalePercent: Math.round(scale * 100),
      layoutDirty: true
    }, () => this.updatePortraitPreview())
  },

  changeLayoutX(e) {
    const value = Number(e.detail.value)
    this.frontCanvas = null
    this.setData({
      portrait: { ...this.data.portrait, offsetX: value / 100 },
      layoutOffsetXPercent: value,
      layoutDirty: true
    }, () => this.updatePortraitPreview())
  },

  changeLayoutY(e) {
    const value = Number(e.detail.value)
    this.frontCanvas = null
    this.setData({
      portrait: { ...this.data.portrait, offsetY: value / 100 },
      layoutOffsetYPercent: value,
      layoutDirty: true
    }, () => this.updatePortraitPreview())
  },

  async persistSelectedLayout() {
    if (!this.data.layoutDirty) return
    const portrait = this.data.portrait || {}
    const response = await wx.cloud.callFunction({
      name: 'segmentCardPortrait',
      data: {
        action: 'saveLayout',
        portraitId: this.portraitKey(portrait),
        compositionMode: portrait.compositionMode === 'full' ? 'full' : 'half',
        scale: Number(portrait.scale) || 1,
        offsetX: Number(portrait.offsetX) || 0,
        offsetY: Number(portrait.offsetY) || 0
      }
    })
    const result = response.result || {}
    if (result.code !== 0) throw new Error(result.msg || '人物位置保存失败')
    this.setData({ layoutDirty: false })
  },

  goPortraitSetup() {
    wx.navigateTo({ url: '/pages/card-image-setup/card-image-setup' })
  },

  prepareLivePreview() {
    this.renderBoth().catch(error => {
      console.error('initial card preview failed', error)
      const detail = (error && (error.errMsg || error.message)) || '未知错误'
      this.setData({
        rendering: false,
        previewWarning: `高清预览暂未完成：${detail}`
      })
    })
  },

  retryPreview() {
    this.setData({ previewWarning: '' })
    setTimeout(() => this.prepareLivePreview(), 80)
  },

  canvasNode(id, attempts = 4) {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().in(this).select(id).fields({ node: true, size: true }).exec(res => {
        const item = res && res[0]
        if (!item || !item.node) {
          if (attempts > 1) {
            setTimeout(() => {
              this.canvasNode(id, attempts - 1).then(resolve).catch(reject)
            }, 120)
            return
          }
          reject(new Error(`画布 ${id} 尚未就绪`))
          return
        }
        item.node.width = CANVAS.width
        item.node.height = CANVAS.height
        resolve(item.node)
      })
    })
  },

  setProgress(pct, text) {
    this.setData({ progress: pct, progressText: text })
  },

  async renderBoth() {
    if (!this.data.portrait || !this.data.portrait.cutoutFileID) {
      wx.showModal({ title: '提示', content: '请先在卡包中上传并精修球星卡形象', showCancel: false })
      throw new Error('NO_PORTRAIT')
    }
    const renderToken = `${Date.now()}_${Math.random()}`
    this.renderToken = renderToken
    this.setData({ rendering: true, progress: 0, progressText: '准备渲染…', errorMessage: '' })
    const organizerAvatar = ((this.data.card.matchSnapshot || {}).organizerAvatar) || ''

    this.setProgress(5, '获取画布…')
    const frontCanvas = await this.canvasNode('#frontCanvas')
    const backCanvas = await this.canvasNode('#backCanvas')

    this.setProgress(15, '加载卡面底图…')
    const frontPath = await localAsset(ORANGE_FIELD_BASE.assets.front)
    const backPath = await localAsset(ORANGE_FIELD_BASE.assets.back)

    this.setProgress(30, '下载肖像素材…')
    let portraitPath = await cloudAsset(this.data.portrait.cutoutFileID)
    let portraitInfo = await imageInfo(portraitPath).catch(() => null)
    this.setProgress(36, '检查并清除肖像背景…')
    const transparentPortrait = await removeConnectedWhiteBackground(frontCanvas, portraitPath, portraitInfo)
    portraitPath = transparentPortrait.path
    portraitInfo = transparentPortrait.info
    frontCanvas.width = CANVAS.width
    frontCanvas.height = CANVAS.height
    const sourceWidth = Math.max(1, Number(portraitInfo && portraitInfo.width) || 1)
    const sourceHeight = Math.max(1, Number(portraitInfo && portraitInfo.height) || 1)
    this.setProgress(40, '识别人物真实边界…')
    const contentBounds = await alphaContentBounds(frontCanvas, portraitPath, portraitInfo)
    this.portraitContentBounds = contentBounds
    this.portraitImageSize = { width: sourceWidth, height: sourceHeight }
    const previewDrawRect = getPortraitDrawRect({
      canvasWidth: CANVAS.width,
      canvasHeight: CANVAS.height,
      sourceWidth: contentBounds.width,
      sourceHeight: contentBounds.height,
      compositionMode: this.data.portrait.compositionMode,
      scale: this.data.portrait.scale,
      offsetX: this.data.portrait.offsetX,
      offsetY: this.data.portrait.offsetY
    })
    const previewViewport = getPlayerViewport(CANVAS.width, CANVAS.height)
    const previewFullImageRect = fullImageRectForContent(
      previewDrawRect,
      contentBounds,
      sourceWidth,
      sourceHeight
    )
    this.setData({
      portraitPreviewSrc: portraitPath,
      portraitPreviewStyle: styleRect({
        x: previewFullImageRect.x - previewViewport.x,
        y: previewFullImageRect.y - previewViewport.y,
        width: previewFullImageRect.width,
        height: previewFullImageRect.height
      }, previewViewport.width, previewViewport.height),
      playerViewportStyle: styleRect(previewViewport, CANVAS.width, CANVAS.height)
    })
    if (this.renderToken !== renderToken) return
    let organizerPath = null
    if (organizerAvatar) {
      this.setProgress(35, '加载主办方标识…')
      try { organizerPath = await cloudAsset(organizerAvatar) } catch (e) { organizerPath = null }
    }

    this.setProgress(50, '渲染正面卡面…')
    try {
      await this.drawFront(frontCanvas, frontPath, portraitPath, portraitInfo, contentBounds)
    } catch (e) {
      console.error('STEP:drawFront', e)
      throw new Error(`正面卡面渲染失败：${(e && (e.errMsg || e.message)) || '未知错误'}`)
    }
    if (this.renderToken !== renderToken) return

    this.setProgress(65, '渲染背面卡面…')
    try {
      await this.drawBack(backCanvas, backPath, organizerPath)
    } catch (e) {
      console.error('STEP:drawBack', e)
      throw new Error(`背面卡面渲染失败：${(e && (e.errMsg || e.message)) || '未知错误'}`)
    }
    if (this.renderToken !== renderToken) return

    this.frontCanvas = frontCanvas
    this.backCanvas = backCanvas
    this.setData({ rendering: false, progress: 70, progressText: '渲染完成' })
  },

  async drawFront(canvas, backgroundPath, portraitPath, portraitInfo, contentBounds) {
    const ctx = canvas.getContext('2d')
    this.setProgress(52, '加载背景图到画布…')
    const background = await imageFor(canvas, backgroundPath)
    ctx.clearRect(0, 0, CANVAS.width, CANVAS.height)
    ctx.drawImage(background, 0, 0, CANVAS.width, CANVAS.height)

    this.setProgress(55, '加载肖像到画布…')
    const portrait = await imageFor(canvas, portraitPath)
    this.setProgress(60, '合成肖像位置…')
    const profile = this.data.portrait || {}
    const drawRect = getPortraitDrawRect({
      canvasWidth: CANVAS.width,
      canvasHeight: CANVAS.height,
      sourceWidth: contentBounds.width,
      sourceHeight: contentBounds.height,
      compositionMode: profile.compositionMode,
      scale: profile.scale,
      offsetX: profile.offsetX,
      offsetY: profile.offsetY
    })
    const viewport = getPlayerViewport(CANVAS.width, CANVAS.height)
    drawCroppedImage(ctx, portrait, contentBounds, drawRect, viewport)

    const snapshot = this.data.card.playerSnapshot || {}
    const frontLayout = ORANGE_FIELD_BASE.front
    const team = snapshot.teamName || 'SPORTLIGHT'
    const name = this.data.playerName
    const position = snapshot.position || '球员'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#B58A3A'
    ctx.font = '700 14px "Songti SC", "STSong", serif'
    ctx.fillText(ellipsizeText(ctx, team, 310), CANVAS.width * frontLayout.teamName.x, CANVAS.height * frontLayout.teamName.y)
    const nameSize = fitText(ctx, name, 300, 29, 20)
    ctx.font = `900 ${nameSize}px "Songti SC", "STSong", serif`
    ctx.fillStyle = '#112D4D'
    ctx.fillText(ellipsizeText(ctx, name, 300), CANVAS.width * frontLayout.displayName.x, CANVAS.height * frontLayout.displayName.y)
    ctx.font = '700 11px "PingFang SC", sans-serif'
    ctx.fillStyle = '#F46B22'
    ctx.fillText(ellipsizeText(ctx, position, 180), CANVAS.width * frontLayout.primaryPosition.x, CANVAS.height * frontLayout.primaryPosition.y)
  },

  bestStatsFor(card) {
    const stats = (card && card.statsSnapshot) || {}
    const items = Object.keys(stats).map(key => ({
      key,
      label: STAT_LABELS[key] || key,
      value: Number(stats[key])
    })).filter(item => Number.isFinite(item.value) && item.value > 0 && STAT_LABELS[item.key])
    items.sort((a, b) => b.value - a.value)
    const unique = []
    items.forEach(item => {
      if (!unique.some(existing => existing.label === item.label)) unique.push(item)
    })
    return unique.slice(0, 3)
  },

  bestStats() {
    return this.bestStatsFor(this.data.card)
  },

  async drawBack(canvas, backgroundPath, organizerPath) {
    const ctx = canvas.getContext('2d')
    const background = await imageFor(canvas, backgroundPath)
    const card = this.data.card
    const match = card.matchSnapshot || {}
    const score = card.scoreSnapshot || {}
    ctx.clearRect(0, 0, CANVAS.width, CANVAS.height)
    ctx.drawImage(background, 0, 0, CANVAS.width, CANVAS.height)
    if (organizerPath) {
      const organizer = await imageFor(canvas, organizerPath).catch(() => null)
      drawCircularBadge(ctx, organizer, 523, 112, 25)
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const eventName = match.eventTitle || '认证比赛'
    const eventSize = fitText(ctx, eventName, 440, 25, 17)
    ctx.fillStyle = '#173451'
    ctx.font = `900 ${eventSize}px "Songti SC", "STSong", serif`
    ctx.fillText(ellipsizeText(ctx, eventName, 390), 315, 382)

    const home = match.homeTeamName || (card.playerSnapshot || {}).teamName || '参赛球队'
    const away = match.awayTeamName || match.opponentTeamName || '对手球队'
    const hasMatchScore = match.homeScore !== undefined && match.awayScore !== undefined
    const summary = hasMatchScore ? `${home}  ${match.homeScore} : ${match.awayScore}  ${away}` : `${home}  VS  ${away}`
    const summarySize = fitText(ctx, summary, 430, 20, 14)
    ctx.font = `700 ${summarySize}px "PingFang SC", sans-serif`
    ctx.fillStyle = '#173451'
    ctx.fillText(ellipsizeText(ctx, summary, 390), 315, 421)
    ctx.font = '500 13px "PingFang SC", sans-serif'
    ctx.fillStyle = '#7A8490'
    ctx.fillText(ellipsizeText(ctx, dateText(match.matchTime || match.eventDate), 250), 315, 454)

    const stats = this.bestStats()
    const fallback = [
      { label: '比赛积分', value: Number(score.delta) || Number(score.eventScore) || 0 },
      { label: '比赛结果', value: this.matchResultText(card) },
      { label: '出场身份', value: card.appearanceType === 'substitute' ? '替补' : '首发' }
    ]
    const display = stats.concat(fallback).slice(0, 3)
    const xs = [205, 315, 425]
    display.forEach((item, index) => {
      ctx.fillStyle = '#F0641E'
      ctx.font = '900 27px "DIN Alternate", "Arial Narrow", sans-serif'
      ctx.fillText(ellipsizeText(ctx, String(item.value), 82), xs[index], 558)
      ctx.fillStyle = '#526173'
      ctx.font = '600 12px "PingFang SC", sans-serif'
      ctx.fillText(ellipsizeText(ctx, item.label, 82), xs[index], 592)
    })

    ctx.fillStyle = '#173451'
    ctx.font = '600 12px "DIN Alternate", monospace'
    const rawCardId = String(card.cardId || card._id || '')
    const displayCardId = rawCardId.length > 14 ? `SL · ${rawCardId.slice(-10)}` : rawCardId
    ctx.fillText(displayCardId, 315, 735)
  },

  exportCanvas(canvas) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'jpg',
        quality: 0.94,
        destWidth: 1260,
        destHeight: 1760,
        success: res => resolve(res.tempFilePath),
        fail: reject
      }, this)
    })
  },

  async generateAndSave() {
    if (this.data.saving) return
    try {
      this.setData({ saving: true })
      this.setProgress(0, '准备生成…')

      if (!this.data.portrait || !this.data.portrait.cutoutFileID) {
        wx.showModal({ title: '提示', content: '请先在卡包中上传并精修球星卡形象', showCancel: false })
        throw new Error('NO_PORTRAIT')
      }

      const card = this.data.card
      if (card.frontImage || card.backImage || card.generationStatus === 'generated') {
        throw new Error('这张球星卡已经生成并锁定，不能重新设计或覆盖')
      }
      this.setProgress(3, '保存人物位置…')
      await this.persistSelectedLayout()
      this.setProgress(8, '按当前预览生成高清卡面…')
      await this.renderBoth()
      this.setProgress(72, '导出正面高清图…')
      const frontTempPath = await this.exportCanvas(this.frontCanvas)
      this.setProgress(78, '导出背面高清图…')
      const backTempPath = await this.exportCanvas(this.backCanvas)
      const safeCardId = String(card.cardId || card._id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_')
      const stamp = Date.now()
      this.setProgress(84, '上传正面卡面…')
      const frontUpload = await wx.cloud.uploadFile({
        cloudPath: `player-cards/${safeCardId}/front-${stamp}.jpg`,
        filePath: frontTempPath
      })
      this.setProgress(90, '上传背面卡面…')
      const backUpload = await wx.cloud.uploadFile({
        cloudPath: `player-cards/${safeCardId}/back-${stamp}.jpg`,
        filePath: backTempPath
      })
      const frontImage = frontUpload.fileID
      const backImage = backUpload.fileID

      this.setProgress(94, '保存卡片…')
      const saveRes = await wx.cloud.callFunction({
        name: 'saveMyGeneratedCard',
        data: {
          cardId: card._id || card.cardId,
          frontImage,
          backImage,
          templateId: ORANGE_FIELD_BASE.templateId,
          templateName: ORANGE_FIELD_BASE.templateName,
          templateVersion: ORANGE_FIELD_BASE.templateVersion,
          compositionMode: this.data.portrait.compositionMode === 'full' ? 'full' : 'half',
          rendererVersion: 'client-canvas-v3',
          portraitId: this.portraitKey(this.data.portrait),
          portraitSnapshot: {
            portraitId: this.portraitKey(this.data.portrait),
            cutoutFileID: this.data.portrait.cutoutFileID,
            compositionMode: this.data.portrait.compositionMode || 'full',
            scale: Number(this.data.portrait.scale) || 1,
            offsetX: Number(this.data.portrait.offsetX) || 0,
            offsetY: Number(this.data.portrait.offsetY) || 0
          }
        }
      })
      const saveResult = saveRes.result || {}
      if (saveResult.code !== 0) throw new Error(saveResult.msg || '保存失败')

      this.setProgress(100, '生成完成！')
      wx.hideLoading()
      this.setData({
        generated: true,
        card: { ...card, frontImage, backImage, coverImage: frontImage, generationStatus: 'generated' }
      })
      wx.showModal({
        title: '比赛卡已生成',
        content: '卡面已合成并存入卡包。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    } catch (error) {
      console.error('generate card failed', error)
      wx.hideLoading()
      const errMsg = (error && (error.errMsg || error.message || String(error))) || '生成失败'
      wx.showModal({ title: '生成失败', content: errMsg, showCancel: false })
    } finally {
      this.setData({ saving: false })
    }
  }
})
