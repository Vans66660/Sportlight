const security = require('../../utils/security')
const { ORANGE_FIELD_BASE, COMPOSITION_PRESETS } = require('../../config/card-layouts')

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function touchDistance(touches) {
  if (!touches || touches.length < 2) return 0
  const dx = touches[0].clientX - touches[1].clientX
  const dy = touches[0].clientY - touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

Page({
  data: {
    originalFileID: '',
    cutoutFileID: '',
    compositionMode: 'half',
    processing: false,
    saving: false,
    hasResult: false,
    playerScale: COMPOSITION_PRESETS.half.scale.default,
    scaleMin: COMPOSITION_PRESETS.half.scale.min,
    scaleMax: COMPOSITION_PRESETS.half.scale.max,
    scalePercent: Math.round(COMPOSITION_PRESETS.half.scale.default * 100),
    translateX: 0,
    translateY: 0,
    portraitId: '',
    portraits: [],
    portraitUploadQuota: { remaining: 0, label: '' },
    currentPortrait: null,
    playerViewportStyle: '',
    playerLayerStyle: '',
    templateFrontSrc: ORANGE_FIELD_BASE.assets.front
  },

  onLoad(options = {}) {
    this.requestedPortraitId = options.portraitId || ''
    this.stageRect = null
    this.gesture = null
    this.didShow = false
    this.loadExisting()
    const viewport = ORANGE_FIELD_BASE.front.playerViewport
    this.setData({
      playerViewportStyle: [
        `left:${viewport.x * 100}%`,
        `top:${viewport.y * 100}%`,
        `width:${viewport.width * 100}%`,
        `height:${viewport.height * 100}%`
      ].join(';')
    })
  },

  onShow() {
    if (this.didShow) this.loadExisting()
    this.didShow = true
  },

  onReady() {
    this.measureStage()
  },

  measureStage(callback) {
    wx.createSelectorQuery().in(this).select('#cardStage').boundingClientRect(rect => {
      if (rect) this.stageRect = rect
      if (typeof callback === 'function') callback(rect)
    }).exec()
  },

  presetFor(mode = this.data.compositionMode) {
    return COMPOSITION_PRESETS[mode === 'full' ? 'full' : 'half']
  },

  layerStyle(mode = this.data.compositionMode) {
    const preset = this.presetFor(mode)
    const layer = preset.layer
    const viewport = ORANGE_FIELD_BASE.front.playerViewport
    return [
      `left:${(layer.x - viewport.x) / viewport.width * 100}%`,
      `top:${(layer.y - viewport.y) / viewport.height * 100}%`,
      `width:${layer.width / viewport.width * 100}%`,
      `height:${layer.height / viewport.height * 100}%`
    ].join(';')
  },

  layoutData(mode, scale, offsetX, offsetY) {
    const preset = this.presetFor(mode)
    const rect = this.stageRect
    const width = (rect && rect.width) || 1
    const height = (rect && rect.height) || 1
    const normalizedX = Number.isFinite(Number(offsetX)) ? Number(offsetX) : preset.offset.defaultX
    const normalizedY = Number.isFinite(Number(offsetY)) ? Number(offsetY) : preset.offset.defaultY
    const nextScale = clamp(Number(scale) || preset.scale.default, preset.scale.min, preset.scale.max)
    return {
      playerScale: nextScale,
      scaleMin: preset.scale.min,
      scaleMax: preset.scale.max,
      scalePercent: Math.round(nextScale * 100),
      translateX: normalizedX * width,
      translateY: normalizedY * height,
      playerLayerStyle: this.layerStyle(mode)
    }
  },

  loadExisting() {
    wx.cloud.callFunction({
      name: 'getMyCards',
      success: res => {
        const result = res.result || {}
        const portraits = (result.cardPortraits || (result.cardPortrait ? [result.cardPortrait] : [])).slice(0, 3)
        const portrait = portraits.find(item => (item.portraitId || item._id) === this.requestedPortraitId) ||
          result.activeCardPortrait || result.cardPortrait || (!this.requestedPortraitId ? portraits[0] : null)
        const quota = result.portraitUploadQuota || result.cardPortraitQuota || { remaining: 0 }
        const activeId = result.activeCardPortraitId ||
          (result.activeCardPortrait && (result.activeCardPortrait.portraitId || result.activeCardPortrait._id)) || ''
        const quotaView = {
          ...quota,
          label: quota.label || (quota.starterRemaining > 0
            ? `新手赠送剩余 ${quota.remaining} 次`
            : (quota.remaining > 0 ? '本月可上传 1 次' : '本月次数已用完'))
        }
        this.setData({
          portraits,
          portraitUploadQuota: quotaView,
          portraitId: portrait ? (portrait.portraitId || portrait._id || '') : '',
          currentPortrait: portrait ? { ...portrait, isActive: (portrait.portraitId || portrait._id) === activeId } : null
        })
        if (!portrait) return
        const mode = portrait.compositionMode === 'full' ? 'full' : 'half'
        this.measureStage(() => {
          this.setData({
            originalFileID: portrait.originalFileID || '',
            cutoutFileID: portrait.cutoutFileID || '',
            compositionMode: mode,
            hasResult: !!portrait.cutoutFileID,
            ...this.layoutData(mode, portrait.scale, portrait.offsetX, portrait.offsetY)
          })
        })
      }
    })
  },

  selectMode(e) {
    if (this.data.processing) return
    const mode = e.currentTarget.dataset.mode === 'full' ? 'full' : 'half'
    const preset = this.presetFor(mode)
    this.setData({
      compositionMode: mode,
      ...this.layoutData(mode, preset.scale.default, preset.offset.defaultX, preset.offset.defaultY)
    })
  },

  resetLayout() {
    const preset = this.presetFor()
    this.setData(this.layoutData(
      this.data.compositionMode,
      preset.scale.default,
      preset.offset.defaultX,
      preset.offset.defaultY
    ))
  },

  openCutoutEditor() {
    if (!this.data.cutoutFileID || this.data.processing || this.data.saving) return
    wx.navigateTo({ url: `/pages/card-cutout-editor/card-cutout-editor?portraitId=${encodeURIComponent(this.data.portraitId)}` })
  },

  selectPortrait(e) {
    if (this.data.processing || this.data.saving) return
    this.requestedPortraitId = e.currentTarget.dataset.id || ''
    this.setData({
      portraitId: this.requestedPortraitId,
      originalFileID: '',
      cutoutFileID: '',
      hasResult: false,
      currentPortrait: null
    })
    if (!this.requestedPortraitId) return
    this.loadExisting()
  },

  setActivePortrait() {
    if (!this.data.portraitId || this.data.saving) return
    this.setData({ saving: true })
    wx.cloud.callFunction({
      name: 'segmentCardPortrait',
      data: { action: 'selectActive', portraitId: this.data.portraitId },
      success: res => {
        const result = res.result || {}
        if (result.code !== 0) return wx.showToast({ title: result.msg || '切换失败', icon: 'none' })
        wx.showToast({ title: '已设为当前形象', icon: 'success' })
        this.requestedPortraitId = this.data.portraitId
        this.loadExisting()
      },
      fail: () => wx.showToast({ title: '切换失败，请重试', icon: 'none' }),
      complete: () => this.setData({ saving: false })
    })
  },

  deletePortrait() {
    if (!this.data.portraitId || this.data.processing || this.data.saving) return
    wx.showModal({
      title: '删除这个球星形象？',
      content: '删除后不会返还已经使用的上传机会。已经生成的卡片不受影响。',
      confirmText: '删除',
      confirmColor: '#E5482D',
      success: modal => {
        if (!modal.confirm) return
        this.setData({ saving: true })
        wx.cloud.callFunction({
          name: 'segmentCardPortrait',
          data: { action: 'deletePortrait', portraitId: this.data.portraitId },
          success: res => {
            const result = res.result || {}
            if (result.code !== 0) return wx.showToast({ title: result.msg || '删除失败', icon: 'none' })
            this.requestedPortraitId = ''
            this.setData({
              portraitId: '',
              currentPortrait: null,
              originalFileID: '',
              cutoutFileID: '',
              hasResult: false
            })
            wx.showToast({ title: '形象已删除', icon: 'success' })
            this.loadExisting()
          },
          fail: () => wx.showToast({ title: '删除失败，请重试', icon: 'none' }),
          complete: () => this.setData({ saving: false })
        })
      }
    })
  },

  handleScaleChange(e) {
    const preset = this.presetFor()
    const playerScale = clamp(Number(e.detail.value), preset.scale.min, preset.scale.max)
    this.setData({ playerScale, scalePercent: Math.round(playerScale * 100) })
  },

  handleTouchStart(e) {
    if (!this.data.hasResult || this.data.processing || this.data.saving) return
    const touches = e.touches || []
    if (touches.length >= 2) {
      this.gesture = {
        type: 'pinch',
        distance: touchDistance(touches),
        scale: this.data.playerScale
      }
      return
    }
    if (touches.length === 1) {
      this.gesture = {
        type: 'drag',
        x: touches[0].clientX,
        y: touches[0].clientY,
        translateX: this.data.translateX,
        translateY: this.data.translateY
      }
    }
  },

  handleTouchMove(e) {
    if (!this.gesture || !this.data.hasResult) return
    const touches = e.touches || []
    const preset = this.presetFor()
    if (touches.length >= 2) {
      if (this.gesture.type !== 'pinch') {
        this.gesture = {
          type: 'pinch',
          distance: touchDistance(touches),
          scale: this.data.playerScale
        }
      }
      const distance = touchDistance(touches)
      const ratio = this.gesture.distance ? distance / this.gesture.distance : 1
      const playerScale = clamp(this.gesture.scale * ratio, preset.scale.min, preset.scale.max)
      this.setData({ playerScale, scalePercent: Math.round(playerScale * 100) })
      return
    }
    if (touches.length === 1 && this.gesture.type === 'drag') {
      const rect = this.stageRect || { width: 1, height: 1 }
      const minX = preset.offset.minX * rect.width
      const maxX = preset.offset.maxX * rect.width
      const minY = preset.offset.minY * rect.height
      const maxY = preset.offset.maxY * rect.height
      const translateX = clamp(
        this.gesture.translateX + touches[0].clientX - this.gesture.x,
        minX,
        maxX
      )
      const translateY = clamp(
        this.gesture.translateY + touches[0].clientY - this.gesture.y,
        minY,
        maxY
      )
      this.setData({ translateX, translateY })
    }
  },

  handleTouchEnd(e) {
    const touches = e.touches || []
    if (!touches.length) {
      this.gesture = null
      return
    }
    if (touches.length === 1) {
      this.gesture = {
        type: 'drag',
        x: touches[0].clientX,
        y: touches[0].clientY,
        translateX: this.data.translateX,
        translateY: this.data.translateY
      }
    }
  },

  resizePhotoForSegmentation(filePath, info) {
    const width = Number(info && info.width) || 0
    const height = Number(info && info.height) || 0
    if (width < 2000 && height < 2000) return Promise.resolve(filePath)

    const maxEdge = 1980
    const ratio = Math.min(maxEdge / width, maxEdge / height)
    const targetWidth = Math.max(1, Math.round(width * ratio))
    const targetHeight = Math.max(1, Math.round(height * ratio))

    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#portraitResizeCanvas')
        .fields({ node: true, size: true })
        .exec(result => {
          const canvas = result && result[0] && result[0].node
          if (!canvas) return reject(new Error('resize canvas unavailable'))
          canvas.width = targetWidth
          canvas.height = targetHeight
          const ctx = canvas.getContext('2d')
          const image = canvas.createImage()
          image.onload = () => {
            ctx.clearRect(0, 0, targetWidth, targetHeight)
            ctx.drawImage(image, 0, 0, targetWidth, targetHeight)
            wx.canvasToTempFilePath({
              canvas,
              x: 0,
              y: 0,
              width: targetWidth,
              height: targetHeight,
              destWidth: targetWidth,
              destHeight: targetHeight,
              fileType: 'jpg',
              quality: 0.92,
              success: output => resolve(output.tempFilePath),
              fail: reject
            }, this)
          }
          image.onerror = reject
          image.src = filePath
        })
    })
  },

  choosePhoto() {
    if (this.data.processing) return
    if (!Number(this.data.portraitUploadQuota.remaining)) {
      wx.showModal({
        title: '本月上传次数已用完',
        content: '首次赠送3次上传机会，之后每个自然月可上传1次，未使用次数不累计。',
        showCancel: false
      })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async res => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        try {
          const info = await new Promise((resolve, reject) => {
            wx.getImageInfo({ src: file.tempFilePath, success: resolve, fail: reject })
          })
          this.setData({ processing: true })
          const needsResize = info.width >= 2000 || info.height >= 2000
          wx.showLoading({ title: needsResize ? '正在优化照片...' : '上传照片...' })
          const resized = await this.resizePhotoForSegmentation(file.tempFilePath, info)
          const compressed = await security.compressImageForAudit(resized)
          const ext = needsResize ? 'jpg' : ((compressed.match(/\.(png|jpe?g)$/i) || [])[1] || 'jpg')
          const upload = await wx.cloud.uploadFile({
            cloudPath: `card-portraits/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`,
            filePath: compressed
          })
          const safe = await security.checkImage(upload.fileID)
          if (!safe) {
            wx.hideLoading()
            this.setData({ processing: false })
            return
          }
          wx.showLoading({ title: '正在自动抠图...' })
          wx.cloud.callFunction({
            name: 'segmentCardPortrait',
            data: {
              fileID: upload.fileID,
              compositionMode: this.data.compositionMode,
              portraitId: this.data.portraitId || undefined,
              replacePortraitId: this.data.portraitId || undefined
            },
            success: callRes => {
              wx.hideLoading()
              const result = callRes.result || {}
              if (result.code !== 0) {
                wx.showModal({ title: '抠图未完成', content: result.msg || '请更换照片重试', showCancel: false })
                return
              }
              const portrait = result.data || {}
              const mode = portrait.compositionMode === 'full' ? 'full' : 'half'
              this.measureStage(() => {
                this.setData({
                  originalFileID: portrait.originalFileID,
                  cutoutFileID: portrait.cutoutFileID,
                  portraitId: portrait.portraitId || portrait._id || this.data.portraitId,
                  currentPortrait: portrait,
                  compositionMode: mode,
                  hasResult: true,
                  ...this.layoutData(mode, portrait.scale, portrait.offsetX, portrait.offsetY)
                })
              })
              this.requestedPortraitId = portrait.portraitId || portrait._id || this.data.portraitId
              wx.showToast({ title: '抠图完成', icon: 'success' })
              setTimeout(() => this.loadExisting(), 300)
            },
            fail: error => {
              console.error('segmentCardPortrait call failed', error)
              wx.hideLoading()
              wx.showToast({ title: '抠图服务调用失败', icon: 'none' })
            },
            complete: () => this.setData({ processing: false })
          })
        } catch (error) {
          wx.hideLoading()
          this.setData({ processing: false })
          wx.showToast({ title: '照片处理失败', icon: 'none' })
        }
      }
    })
  },

  finish() {
    if (!this.data.hasResult) return wx.showToast({ title: '请先上传照片', icon: 'none' })
    const rect = this.stageRect
    if (!rect || !rect.width || !rect.height) {
      return this.measureStage(measured => {
        if (measured && measured.width && measured.height) {
          this.finish()
        } else {
          wx.showToast({ title: '卡面尚未准备好，请重试', icon: 'none' })
        }
      })
    }
    this.setData({ saving: true })
    wx.cloud.callFunction({
      name: 'segmentCardPortrait',
      data: {
        action: 'saveLayout',
        portraitId: this.data.portraitId,
        compositionMode: this.data.compositionMode,
        scale: this.data.playerScale,
        offsetX: this.data.translateX / rect.width,
        offsetY: this.data.translateY / rect.height
      },
      success: res => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showModal({ title: '保存失败', content: result.msg || '请稍后重试', showCancel: false })
          return
        }
        wx.showToast({ title: '人物位置已保存', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 450)
      },
      fail: error => {
        console.error('save portrait layout failed', error)
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      },
      complete: () => this.setData({ saving: false })
    })
  }
})
