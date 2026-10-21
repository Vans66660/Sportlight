Page({
  data: {
    cardId: '',
    card: null,
    side: 'front',
    loading: true,
    retrying: false,
    preparingShare: false,
    shareReady: false,
    shareCode: '',
    shareImageUrl: ''
  },

  onLoad(options) {
    this.setData({ cardId: decodeURIComponent(options.id || '') })
    this.didShow = false
    this.loadCard()
  },

  onShow() {
    if (this.didShow) this.loadCard()
    this.didShow = true
  },

  loadCard() {
    wx.cloud.callFunction({
      name: 'getMyCards',
      success: res => {
        const result = res.result || {}
        if (result.code !== 0) {
          this.setData({ card: null, loading: false })
          wx.showToast({ title: result.msg || '卡片加载失败', icon: 'none' })
          return
        }
        const cards = result.cards || []
        const card = cards.find(item => item._id === this.data.cardId || item.cardId === this.data.cardId)
        this.setData({
          card: card || null,
          loading: false,
          shareReady: false,
          shareCode: '',
          shareImageUrl: ''
        })
        if (!card) wx.showToast({ title: '卡片不存在或已失效', icon: 'none' })
      },
      fail: () => {
        this.setData({ loading: false })
        wx.showToast({ title: '卡片加载失败', icon: 'none' })
      }
    })
  },

  flipCard() {
    this.setData({ side: this.data.side === 'front' ? 'back' : 'front' })
  },

  previewImage() {
    const card = this.data.card || {}
    const current = this.data.side === 'front'
      ? (card.frontImage || card.coverImage || card.imageUrl)
      : (card.backImage || card.frontImage || card.coverImage || card.imageUrl)
    const urls = [card.frontImage || card.coverImage || card.imageUrl, card.backImage].filter(Boolean)
    if (current) wx.previewImage({ current, urls: [...new Set(urls)] })
  },

  retryGeneration() {
    if (this.data.retrying || !this.data.cardId) return
    wx.navigateTo({ url: `/pages/card-generator/card-generator?cardId=${encodeURIComponent(this.data.cardId)}` })
  },

  prepareShare() {
    const card = this.data.card || {}
    if (!card.frontImage || card.generationStatus !== 'generated') {
      wx.showToast({ title: '请先生成完整卡片', icon: 'none' })
      return
    }
    if (this.data.preparingShare) return
    this.setData({ preparingShare: true })
    wx.showLoading({ title: '正在准备分享…' })
    wx.cloud.callFunction({
      name: 'sharePlayerCard',
      data: { action: 'create', cardId: card._id || card.cardId },
      success: res => {
        const result = res.result || {}
        if (result.code !== 0 || !result.shareCode) {
          wx.showToast({ title: result.msg || '分享准备失败', icon: 'none' })
          return
        }
        this.setData({ shareCode: result.shareCode, shareReady: true })
        wx.cloud.getTempFileURL({
          fileList: [card.frontImage],
          success: urlRes => {
            const item = urlRes.fileList && urlRes.fileList[0]
            if (item && item.tempFileURL) this.setData({ shareImageUrl: item.tempFileURL })
          }
        })
        wx.showToast({ title: '现在可以分享了', icon: 'success' })
      },
      fail: () => wx.showToast({ title: '分享准备失败', icon: 'none' }),
      complete: () => {
        wx.hideLoading()
        this.setData({ preparingShare: false })
      }
    })
  },

  shareTitle() {
    const card = this.data.card || {}
    const player = card.playerSnapshot || {}
    const match = card.matchSnapshot || {}
    return `${player.name || '我的'}${match.eventTitle || '认证比赛'}球星卡`
  },

  onShareAppMessage() {
    if (!this.data.shareCode) return { title: 'Sportlight 球星卡' }
    return {
      title: this.shareTitle(),
      path: `/pages/shared-card/shared-card?code=${encodeURIComponent(this.data.shareCode)}`,
      imageUrl: this.data.shareImageUrl || ((this.data.card || {}).frontImage || '')
    }
  },

  onShareTimeline() {
    if (!this.data.shareCode) return { title: 'Sportlight 球星卡' }
    return {
      title: this.shareTitle(),
      query: `code=${encodeURIComponent(this.data.shareCode)}`,
      imageUrl: this.data.shareImageUrl || ((this.data.card || {}).frontImage || '')
    }
  }
})
