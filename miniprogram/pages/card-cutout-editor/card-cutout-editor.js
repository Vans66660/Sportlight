function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({ src, success: resolve, fail: reject })
  })
}

function downloadCloudFile(fileID) {
  return wx.cloud.downloadFile({ fileID }).then(res => res.tempFilePath)
}

function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

function distance(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

Page({
  data: {
    loading: true,
    saving: false,
    ready: false,
    drawing: false,
    showOriginal: false,
    tool: 'move',
    brushSize: 24,
    brushes: [
      { label: '细', size: 12, preview: 12 },
      { label: '中', size: 24, preview: 19 },
      { label: '粗', size: 40, preview: 27 }
    ],
    canUndo: false,
    canRedo: false,
    canvasHeight: 520,
    canvasDisplayHeight: 520,
    canvasWidthPercent: 100,
    zoom: 1,
    zoomPercent: 100,
    magnifierVisible: false,
    originalTempPath: ''
  },

  onLoad(options) {
    this.operations = []
    this.redoOperations = []
    this.currentOperation = null
    this.portraitId = decodeURIComponent((options && options.portraitId) || '')
    this.loadPortrait()
  },

  async loadPortrait() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getMyCards' })
      const result = res.result || {}
      const portraits = Array.isArray(result.cardPortraits) ? result.cardPortraits : []
      const portrait = (
        (this.portraitId && portraits.find(item => (
          String(item.portraitId || item._id || '') === this.portraitId
        ))) ||
        (!this.portraitId && result.activeCardPortrait) ||
        (!this.portraitId && result.cardPortrait) ||
        {}
      )
      if (!portrait.originalFileID || !portrait.cutoutFileID) {
        wx.showModal({
          title: '暂无人物素材',
          content: '请先上传照片并完成自动抠图。',
          showCancel: false,
          success: () => wx.navigateBack()
        })
        return
      }
      this.portrait = portrait
      this.portraitId = String(portrait.portraitId || portrait._id || this.portraitId || '')
      const autoFileID = portrait.autoCutoutFileID || portrait.cutoutFileID
      const [originalPath, cutoutPath, autoPath] = await Promise.all([
        downloadCloudFile(portrait.originalFileID),
        downloadCloudFile(portrait.cutoutFileID),
        autoFileID === portrait.cutoutFileID ? Promise.resolve(null) : downloadCloudFile(autoFileID)
      ])
      const info = await getImageInfo(cutoutPath)
      this.originalPath = originalPath
      this.cutoutPath = cutoutPath
      this.autoPath = autoPath || cutoutPath
      this.sourceWidth = info.width
      this.sourceHeight = info.height
      this.setData({ originalTempPath: originalPath })

      wx.createSelectorQuery().in(this).select('.checkerboard').boundingClientRect(rect => {
        const displayWidth = (rect && rect.width) || (wx.getSystemInfoSync().windowWidth - 36)
        const canvasHeight = displayWidth * info.height / info.width
        this.setData({ canvasHeight, canvasDisplayHeight: canvasHeight }, () => this.initCanvas())
      }).exec()
    } catch (error) {
      console.error('load cutout editor failed', error)
      this.setData({ loading: false })
      wx.showModal({ title: '加载失败', content: '人物素材暂时无法读取，请稍后重试。', showCancel: false })
    }
  },

  initCanvas() {
    wx.createSelectorQuery().in(this).select('#editorCanvas').fields({ node: true, size: true }).exec(async result => {
      const field = result && result[0]
      if (!field || !field.node) {
        this.setData({ loading: false })
        wx.showToast({ title: '画布初始化失败', icon: 'none' })
        return
      }
      try {
        const canvas = field.node
        const maxSide = 1400
        const ratio = Math.min(1, maxSide / Math.max(this.sourceWidth, this.sourceHeight))
        canvas.width = Math.max(1, Math.round(this.sourceWidth * ratio))
        canvas.height = Math.max(1, Math.round(this.sourceHeight * ratio))
        this.canvas = canvas
        this.ctx = canvas.getContext('2d')
        this.workWidth = canvas.width
        this.workHeight = canvas.height
        const [originalImage, cutoutImage, autoImage] = await Promise.all([
          loadCanvasImage(canvas, this.originalPath),
          loadCanvasImage(canvas, this.cutoutPath),
          loadCanvasImage(canvas, this.autoPath)
        ])
        this.originalImage = originalImage
        this.baseCutoutImage = cutoutImage
        this.autoCutoutImage = autoImage
        this.renderOperations()
        this.measureCanvas()
        this.initMagnifier()
        this.setData({ loading: false, ready: true })
      } catch (error) {
        console.error('init editor canvas failed', error)
        this.setData({ loading: false })
        wx.showToast({ title: '人物图片加载失败', icon: 'none' })
      }
    })
  },

  measureCanvas() {
    wx.createSelectorQuery().in(this).select('#editorCanvas').boundingClientRect(rect => {
      if (rect) this.canvasRect = rect
    }).exec()
  },

  initMagnifier() {
    wx.createSelectorQuery().in(this).select('#magnifierCanvas').fields({ node: true, size: true }).exec(result => {
      const field = result && result[0]
      if (!field || !field.node) return
      this.magnifierCanvas = field.node
      this.magnifierCanvas.width = 220
      this.magnifierCanvas.height = 220
      this.magnifierCtx = this.magnifierCanvas.getContext('2d')
    })
  },

  canvasPoint(touch) {
    const rect = this.canvasRect
    if (!rect || !rect.width || !rect.height) return null
    return {
      x: (touch.clientX - rect.left) * this.workWidth / rect.width,
      y: (touch.clientY - rect.top) * this.workHeight / rect.height
    }
  },

  selectTool(e) {
    if (!this.data.ready || this.data.saving) return
    const requested = e.currentTarget.dataset.tool
    const tool = ['move', 'erase', 'restore'].includes(requested) ? requested : 'move'
    this.setData({ tool, magnifierVisible: false })
  },

  changeZoom(e) {
    if (!this.data.ready || this.data.saving) return
    const zoom = Math.min(3, Math.max(1, Number(e.detail.value) || 1))
    this.setData({
      zoom,
      zoomPercent: Math.round(zoom * 100),
      canvasWidthPercent: zoom * 100,
      canvasDisplayHeight: this.data.canvasHeight * zoom
    }, () => this.measureCanvas())
  },

  selectBrush(e) {
    if (!this.data.ready || this.data.saving) return
    this.setData({ brushSize: Number(e.currentTarget.dataset.size) || 24 })
  },

  startStroke(e) {
    if (!this.data.ready || this.data.saving || this.data.tool === 'move' || (e.touches || []).length !== 1) return
    const point = this.canvasPoint(e.touches[0])
    if (!point) return
    this.currentOperation = {
      tool: this.data.tool,
      size: this.data.brushSize,
      points: [point]
    }
    this.applyPoint(this.currentOperation, point)
    this.updateMagnifier(point, this.currentOperation)
    this.setData({ drawing: true, magnifierVisible: true })
  },

  moveStroke(e) {
    if (!this.currentOperation || (e.touches || []).length !== 1) return
    const point = this.canvasPoint(e.touches[0])
    if (!point) return
    const points = this.currentOperation.points
    const previous = points[points.length - 1]
    if (distance(previous, point) < 2) return
    points.push(point)
    this.applySegment(this.currentOperation, previous, point)
    this.updateMagnifier(point, this.currentOperation)
  },

  endStroke() {
    if (!this.currentOperation) return
    this.operations.push(this.currentOperation)
    this.currentOperation = null
    this.redoOperations = []
    this.updateHistory()
    this.setData({ drawing: false, magnifierVisible: false })
  },

  updateMagnifier(point, operation) {
    const ctx = this.magnifierCtx
    if (!ctx || !this.canvas) return
    const lensSize = 220
    const sampleSize = Math.max(42, this.internalRadius(operation) * 5)
    const sourceX = Math.max(0, Math.min(this.workWidth - sampleSize, point.x - sampleSize / 2))
    const sourceY = Math.max(0, Math.min(this.workHeight - sampleSize, point.y - sampleSize / 2))
    ctx.clearRect(0, 0, lensSize, lensSize)
    ctx.fillStyle = '#e2e6ea'
    ctx.fillRect(0, 0, lensSize, lensSize)
    ctx.drawImage(
      this.canvas,
      sourceX,
      sourceY,
      sampleSize,
      sampleSize,
      0,
      0,
      lensSize,
      lensSize
    )
    const brushDiameter = Math.max(18, Math.min(150, this.internalRadius(operation) * 2 * lensSize / sampleSize))
    const lensX = (point.x - sourceX) * lensSize / sampleSize
    const lensY = (point.y - sourceY) * lensSize / sampleSize
    ctx.save()
    ctx.strokeStyle = operation.tool === 'restore' ? '#27c27c' : '#ff641e'
    ctx.lineWidth = 4
    ctx.setLineDash([9, 6])
    ctx.beginPath()
    ctx.arc(lensX, lensY, brushDiameter / 2, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  },

  internalRadius(operation) {
    const rect = this.canvasRect || { width: this.workWidth }
    return operation.size * this.workWidth / Math.max(1, rect.width) / 2
  },

  applyPoint(operation, point) {
    const radius = this.internalRadius(operation)
    if (operation.tool === 'restore') {
      this.restoreCircle(point.x, point.y, radius)
      return
    }
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  },

  applySegment(operation, start, end) {
    const radius = this.internalRadius(operation)
    if (operation.tool === 'erase') {
      const ctx = this.ctx
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineWidth = radius * 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
      ctx.restore()
      return
    }
    const length = distance(start, end)
    const steps = Math.max(1, Math.ceil(length / Math.max(2, radius * 0.55)))
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps
      this.restoreCircle(
        start.x + (end.x - start.x) * t,
        start.y + (end.y - start.y) * t,
        radius
      )
    }
  },

  restoreCircle(x, y, radius) {
    const ctx = this.ctx
    const left = Math.max(0, x - radius)
    const top = Math.max(0, y - radius)
    const width = Math.min(this.workWidth - left, radius * 2)
    const height = Math.min(this.workHeight - top, radius * 2)
    const sourceX = left * this.sourceWidth / this.workWidth
    const sourceY = top * this.sourceHeight / this.workHeight
    const sourceWidth = width * this.sourceWidth / this.workWidth
    const sourceHeight = height * this.sourceHeight / this.workHeight
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(
      this.originalImage,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      left,
      top,
      width,
      height
    )
    ctx.restore()
  },

  renderOperations() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.workWidth, this.workHeight)
    ctx.drawImage(this.baseCutoutImage, 0, 0, this.workWidth, this.workHeight)
    this.operations.forEach(operation => {
      const points = operation.points || []
      if (!points.length) return
      this.applyPoint(operation, points[0])
      for (let index = 1; index < points.length; index += 1) {
        this.applySegment(operation, points[index - 1], points[index])
      }
    })
  },

  updateHistory() {
    this.setData({
      canUndo: this.operations.length > 0,
      canRedo: this.redoOperations.length > 0
    })
  },

  undo() {
    if (!this.operations.length || this.data.saving) return
    this.redoOperations.push(this.operations.pop())
    this.renderOperations()
    this.updateHistory()
  },

  redo() {
    if (!this.redoOperations.length || this.data.saving) return
    this.operations.push(this.redoOperations.pop())
    this.renderOperations()
    this.updateHistory()
  },

  resetToAuto() {
    if (!this.data.ready || this.data.saving) return
    wx.showModal({
      title: '恢复自动抠图',
      content: '将清除本次精修，并恢复腾讯云最初生成的人物图。',
      success: res => {
        if (!res.confirm) return
        this.baseCutoutImage = this.autoCutoutImage
        this.operations = []
        this.redoOperations = []
        this.renderOperations()
        this.updateHistory()
      }
    })
  },

  showOriginal() {
    if (this.data.ready) this.setData({ showOriginal: true })
  },

  hideOriginal() {
    if (this.data.showOriginal) this.setData({ showOriginal: false })
  },

  saveCutout() {
    if (!this.data.ready || this.data.saving) return
    this.setData({ saving: true })
    wx.canvasToTempFilePath({
      canvas: this.canvas,
      fileType: 'png',
      quality: 1,
      success: async result => {
        try {
          const upload = await wx.cloud.uploadFile({
            cloudPath: `card-portraits/manual/${Date.now()}_${Math.random().toString(16).slice(2)}.png`,
            filePath: result.tempFilePath
          })
          const save = await wx.cloud.callFunction({
            name: 'segmentCardPortrait',
            data: {
              action: 'saveManualCutout',
              portraitId: this.portraitId,
              cutoutFileID: upload.fileID
            }
          })
          const response = save.result || {}
          if (response.code !== 0) throw new Error(response.msg || '保存失败')
          wx.showToast({ title: '精修结果已保存', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 450)
        } catch (error) {
          console.error('save manual cutout failed', error)
          wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' })
        }
      },
      fail: error => {
        console.error('export manual cutout failed', error)
        wx.showToast({ title: '导出精修图片失败', icon: 'none' })
      },
      complete: () => this.setData({ saving: false })
    }, this)
  }
})
