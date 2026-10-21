const DEFAULT_LOCATION = {
  latitude: 31.2304,
  longitude: 121.4737
}

Page({
  data: {
    latitude: DEFAULT_LOCATION.latitude,
    longitude: DEFAULT_LOCATION.longitude,
    previewMarkers: []
  },

  onLoad() {
    this.setPreviewLocation(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude)
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.setPreviewLocation(res.latitude, res.longitude)
      }
    })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const tabBar = this.getTabBar()
      if (typeof tabBar.syncRole === 'function') tabBar.syncRole({ selected: 2 })
      else tabBar.setData({ selected: 2 })
    }
  },

  setPreviewLocation(latitude, longitude) {
    this.setData({
      latitude,
      longitude,
      previewMarkers: [
        {
          id: 1,
          latitude,
          longitude,
          width: 28,
          height: 28,
          callout: {
            content: '当前位置',
            color: '#FFFFFF',
            fontSize: 12,
            borderRadius: 6,
            bgColor: '#FF6B1A',
            padding: 6,
            display: 'ALWAYS'
          }
        }
      ]
    })
  },

  goCourtMap() {
    wx.navigateTo({ url: '/pages/court-map/court-map' })
  },

  goSoloGames() {
    wx.navigateTo({ url: '/pages/solo-games/solo-games' })
  },

  goMatchedSoloGames() {
    wx.navigateTo({ url: '/pages/matched-solo-games/matched-solo-games' })
  },

  goTeamMatch() {
    wx.navigateTo({ url: '/pages/team-match/team-match' })
  },

  goPlaceholder(e) {
    const title = encodeURIComponent(e.currentTarget.dataset.title || '约场')
    wx.navigateTo({ url: `/pages/match-placeholder/match-placeholder?title=${title}` })
  }
})
