Page({
  data: {
    cards: [],
    visibleCards: [],
    showcaseCards: [],
    cardPortrait: null,
    cardPortraits: [],
    activeCardPortrait: null,
    portraitUploadQuota: { remaining: 0, label: '' },
    activeTab: 'all',
    loading: true
  },

  onLoad() {
    this.loadCards()
  },

  onShow() {
    if (!this.data.loading) this.loadCards(false)
  },

  loadCards(showLoading = true) {
    if (showLoading) wx.showLoading({ title: '打开卡包...' })
    wx.cloud.callFunction({
      name: 'getMyCards',
      success: res => {
        const result = res.result || {}
        const cards = result.cards || []
        const showcaseCards = (result.showcaseCards || []).slice(0, 6)
        const rawPortraits = (result.cardPortraits || (result.cardPortrait ? [result.cardPortrait] : [])).slice(0, 3)
        const activePortraitId = result.activeCardPortraitId ||
          (result.activeCardPortrait && (result.activeCardPortrait.portraitId || result.activeCardPortrait._id)) || ''
        const cardPortraits = rawPortraits.map(item => ({
          ...item,
          isActive: (item.portraitId || item._id) === activePortraitId
        }))
        const activeCardPortrait = result.activeCardPortrait ||
          cardPortraits.find(item => item.isActive) || result.cardPortrait || cardPortraits[0] || null
        const quota = result.portraitUploadQuota || result.cardPortraitQuota || { remaining: 0 }
        const quotaView = {
          ...quota,
          label: quota.label || (quota.starterRemaining > 0
            ? `新手赠送剩余 ${quota.remaining} 次`
            : (quota.remaining > 0 ? '本月可上传 1 次' : '本月次数已用完'))
        }
        this.setData({
          cards,
          visibleCards: this.filterCards(cards, this.data.activeTab),
          showcaseCards,
          cardPortrait: activeCardPortrait,
          cardPortraits,
          activeCardPortrait,
          portraitUploadQuota: quotaView,
          loading: false
        })
        if (cards.some(card => !card.seen)) {
          wx.cloud.callFunction({ name: 'markMyCardsSeen' }).catch(() => {})
        }
      },
      fail: () => {
        this.setData({ loading: false })
        wx.showToast({ title: '卡包加载失败', icon: 'none' })
      },
      complete: () => {
        if (showLoading) wx.hideLoading()
      }
    })
  },

  goCardImageSetup() {
    wx.navigateTo({ url: '/pages/card-image-setup/card-image-setup' })
  },

  goPortraitSlot(e) {
    const portraitId = e.currentTarget.dataset.id || ''
    wx.navigateTo({ url: `/pages/card-image-setup/card-image-setup${portraitId ? `?portraitId=${encodeURIComponent(portraitId)}` : ''}` })
  },

  switchTab(e) {
    const activeTab = e.currentTarget.dataset.tab
    this.setData({ activeTab, visibleCards: this.filterCards(this.data.cards, activeTab) })
  },

  filterCards(cards, tab) {
    if (tab === 'match') return cards.filter(card => card.cardType === 'match_base')
    if (tab === 'special') return cards.filter(card => card.cardType !== 'match_base')
    return cards
  },

  goCardDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${encodeURIComponent(id)}` })
  },

  manageShowcase() {
    if (!this.data.cards.length) {
      wx.showToast({ title: '获得球星卡后即可设置展示', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/card-showcase/card-showcase' })
  }
})
