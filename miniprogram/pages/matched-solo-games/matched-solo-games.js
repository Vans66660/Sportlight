Page({
  data: {
    latitude: 0,
    longitude: 0,
    myScore: 0,
    mySport: '',
    radiusKm: 30,
    games: [],
    loading: true
  },

  onLoad() {
    wx.getLocation({
      type: 'gcj02',
      success: res => this.setData({ latitude: res.latitude, longitude: res.longitude }, () => this.loadGames()),
      fail: () => this.loadGames()
    })
  },

  onPullDownRefresh() {
    this.loadGames(false, true)
  },

  loadGames(showLoading = true, refreshing = false) {
    if (showLoading) this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getMatchedSoloGames',
      data: {
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        radiusKm: this.data.radiusKm,
        limit: 5
      },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          const games = (result.data || []).map(item => ({
            ...item,
            creatorInitial: (item.creatorName || '球员').slice(0, 1),
            scoreDiffText: item.avgScore >= item.myScore ? `+${item.scoreDiff}` : `-${item.scoreDiff}`
          }))
          this.setData({
            games,
            myScore: result.myScore || 0,
            mySport: result.mySport || '',
            radiusKm: result.radiusKm || this.data.radiusKm,
            loading: false
          })
        } else {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
        if (refreshing) wx.stopPullDownRefresh()
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' })
        this.setData({ loading: false })
        if (refreshing) wx.stopPullDownRefresh()
      }
    })
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/solo-game-detail/solo-game-detail?gameId=${e.currentTarget.dataset.id}` })
  },

  goSoloGames() {
    wx.navigateTo({ url: '/pages/solo-games/solo-games' })
  }
})
