function distance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 999999999
  const toRad = value => value * Math.PI / 180
  const dLat = toRad(Number(lat2) - Number(lat1))
  const dLng = toRad(Number(lng2) - Number(lng1))
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(Number(lat1))) * Math.cos(toRad(Number(lat2))) * Math.sin(dLng / 2) ** 2
  return 6378137 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

Page({
  data: {
    latitude: 0,
    longitude: 0,
    venues: [],
    loading: true
  },

  onLoad() {
    wx.getLocation({
      type: 'gcj02',
      success: res => this.setData({ latitude: res.latitude, longitude: res.longitude }, () => this.loadVenues()),
      fail: () => this.loadVenues()
    })
  },

  loadVenues() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getApprovedVenues',
      success: res => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
          return
        }
        const venues = (result.data || []).map(item => {
          const meters = distance(this.data.latitude, this.data.longitude, item.latitude, item.longitude)
          return {
            ...item,
            distanceMeters: meters,
            distanceText: meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters)}m`,
            courtSummary: (item.courtTypes || []).map(type => `${type}${Number((item.courtCounts || {})[type]) || 0}块`).join(' · ')
          }
        }).filter(item => item.distanceMeters <= 30000).sort((a, b) => a.distanceMeters - b.distanceMeters)
        this.setData({ venues, loading: false })
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  selectVenue(e) {
    const venue = this.data.venues.find(item => item._id === e.currentTarget.dataset.id)
    if (!venue) return
    wx.setStorageSync('soloSelectedVenue', venue)
    wx.navigateBack()
  },

  openVenue(e) {
    const venue = this.data.venues.find(item => item._id === e.currentTarget.dataset.id)
    if (!venue) return
    wx.navigateTo({ url: `/pages/venue-match/venue-match?venueId=${venue._id}&title=${encodeURIComponent(venue.name || '球馆')}` })
  }
})
