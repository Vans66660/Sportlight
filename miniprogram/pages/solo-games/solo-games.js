const identity = require('../../utils/identity')

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

Page({
  data: {
    dates: [],
    activeDate: '',
    sortOptions: [
      { key: 'distance', label: '距离排序' },
      { key: 'intensity', label: '强度排序' },
      { key: 'people', label: '人数排序' }
    ],
    sortIndex: 0,
    sortKey: 'distance',
    latitude: 0,
    longitude: 0,
    venueId: '',
    scopedVenue: false,
    games: [],
    loading: true
  },

  onLoad(options) {
    const venueId = options.venueId || ''
    this.setData({ venueId, scopedVenue: !!venueId })
    if (venueId) wx.setNavigationBarTitle({ title: '球馆组局' })
    const dates = []
    const now = new Date()
    for (let i = 0; i < 5; i++) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      const value = formatDate(date)
      dates.push({ value, shortDate: value.slice(5), label: i === 0 ? '今天' : `${date.getMonth() + 1}/${date.getDate()}` })
    }
    this.setData({ dates, activeDate: dates[0].value })
    wx.getLocation({
      type: 'gcj02',
      success: res => this.setData({ latitude: res.latitude, longitude: res.longitude }, () => this.loadGames()),
      fail: () => this.loadGames()
    })
  },

  onShow() {
    if (this.data.activeDate) this.loadGames(false)
  },

  switchDate(e) {
    this.setData({ activeDate: e.currentTarget.dataset.date }, () => this.loadGames())
  },

  onSortChange(e) {
    const sortIndex = Number(e.detail.value)
    this.setData({
      sortIndex,
      sortKey: this.data.sortOptions[sortIndex].key
    }, () => this.loadGames())
  },

  loadGames(showLoading = true) {
    if (showLoading) this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getSoloGames',
      data: {
        date: this.data.activeDate,
        sort: this.data.sortKey,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        venueId: this.data.venueId
      },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          const games = (result.data || []).map(item => ({
            ...item,
            creatorInitial: (item.creatorName || '球员').slice(0, 1)
          }))
          this.setData({ games, loading: false })
        }
        else {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  goCreate() {
    identity.ensureVerified(() => {
      const venueParam = this.data.venueId ? `&venueId=${this.data.venueId}` : ''
      wx.navigateTo({ url: `/pages/solo-game-create/solo-game-create?date=${this.data.activeDate}${venueParam}` })
    })
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/solo-game-detail/solo-game-detail?gameId=${e.currentTarget.dataset.id}` })
  }
})
