Page({
  data: { cards: [], selected: [], displayCards: [], loading: true, saving: false },

  refreshDisplay(cards, selected) {
    this.setData({
      cards,
      selected,
      displayCards: cards.map(card => {
        const id = card._id || card.cardId
        return { ...card, viewId: id, selectedOrder: selected.indexOf(id) + 1 }
      })
    })
  },

  onLoad() {
    wx.showLoading({ title: '加载卡片...' })
    wx.cloud.callFunction({
      name: 'getMyCards',
      success: res => {
        const cards = (res.result && res.result.cards) || []
        const selected = cards.filter(card => card.isShowcased)
          .sort((a, b) => (a.showcaseOrder || 99) - (b.showcaseOrder || 99))
          .map(card => card._id || card.cardId)
          .slice(0, 6)
        this.refreshDisplay(cards, selected)
        this.setData({ loading: false })
      },
      fail: () => {
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      },
      complete: () => wx.hideLoading()
    })
  },

  toggleCard(e) {
    const id = e.currentTarget.dataset.id
    const selected = [...this.data.selected]
    const index = selected.indexOf(id)
    if (index >= 0) selected.splice(index, 1)
    else if (selected.length >= 6) {
      wx.showToast({ title: '最多展示6张卡片', icon: 'none' })
      return
    } else selected.push(id)
    this.refreshDisplay(this.data.cards, selected)
  },

  move(e) {
    const id = e.currentTarget.dataset.id
    const direction = Number(e.currentTarget.dataset.direction)
    const selected = [...this.data.selected]
    const from = selected.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= selected.length) return
    ;[selected[from], selected[to]] = [selected[to], selected[from]]
    this.refreshDisplay(this.data.cards, selected)
  },

  save() {
    if (this.data.saving) return
    this.setData({ saving: true })
    wx.showLoading({ title: '保存展柜...' })
    wx.cloud.callFunction({
      name: 'updateMyCardShowcase',
      data: { cardIds: this.data.selected },
      success: res => {
        const result = res.result || {}
        if (result.code !== undefined && result.code !== 0) {
          wx.showToast({ title: result.msg || '保存失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '展柜已更新', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 500)
      },
      fail: err => wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }),
      complete: () => {
        wx.hideLoading()
        this.setData({ saving: false })
      }
    })
  }
})
