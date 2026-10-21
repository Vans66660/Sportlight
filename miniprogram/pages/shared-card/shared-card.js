Page({
  data: {
    shareCode: '',
    card: null,
    side: 'front',
    loading: true,
    errorMessage: '',
    shareImageUrl: ''
  },

  onLoad(options) {
    const shareCode = decodeURIComponent(options.code || '')
    this.setData({ shareCode })
    this.loadSharedCard()
  },

  loadSharedCard() {
    if (!this.data.shareCode) {
      this.setData({ loading: false, errorMessage: '分享链接缺少卡片信息' })
      return
    }
    wx.cloud.callFunction({
      name: 'sharePlayerCard',
      data: { action: 'read', shareCode: this.data.shareCode },
      success: res => {
        const result = res.result || {}
        if (result.code !== 0 || !result.card) {
          this.setData({ loading: false, errorMessage: result.msg || '这张卡片暂时无法查看' })
          return
        }
        this.setData({ card: result.card, loading: false })
        this.prepareShareImage(result.card.frontImage)
      },
      fail: () => this.setData({ loading: false, errorMessage: '卡片加载失败，请稍后再试' })
    })
  },

  prepareShareImage(fileID) {
    if (!fileID || !String(fileID).startsWith('cloud://')) return
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: res => {
        const item = res.fileList && res.fileList[0]
        if (item && item.tempFileURL) this.setData({ shareImageUrl: item.tempFileURL })
      }
    })
  },

  flipCard() {
    this.setData({ side: this.data.side === 'front' ? 'back' : 'front' })
  },

  previewImage() {
    const card = this.data.card || {}
    const current = this.data.side === 'back' && card.backImage ? card.backImage : card.frontImage
    const urls = [card.frontImage, card.backImage].filter(Boolean)
    if (current) wx.previewImage({ current, urls })
  },

  shareTitle() {
    const card = this.data.card || {}
    const player = card.playerSnapshot || {}
    const match = card.matchSnapshot || {}
    return `${player.name || '一名球员'}的${match.eventTitle || '认证比赛'}球星卡`
  },

  onShareAppMessage() {
    return {
      title: this.shareTitle(),
      path: `/pages/shared-card/shared-card?code=${encodeURIComponent(this.data.shareCode)}`,
      imageUrl: this.data.shareImageUrl || ((this.data.card || {}).frontImage || '')
    }
  },

  onShareTimeline() {
    return {
      title: this.shareTitle(),
      query: `code=${encodeURIComponent(this.data.shareCode)}`,
      imageUrl: this.data.shareImageUrl || ((this.data.card || {}).frontImage || '')
    }
  }
})
