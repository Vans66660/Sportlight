const DEFAULT_LOCATION = {
  latitude: 31.2304,
  longitude: 121.4737
}

Page({
  data: {
    latitude: DEFAULT_LOCATION.latitude,
    longitude: DEFAULT_LOCATION.longitude,
    markers: [],
    venues: [],
    loading: true,
    selectedVenue: null,
    focusVenueId: '',
    moving: false
  },

  onLoad(options = {}) {
    this.mapCtx = wx.createMapContext('courtMap', this)
    this.setData({ focusVenueId: options.venueId || '' })
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.setData({
          latitude: res.latitude,
          longitude: res.longitude
        })
        this.loadApprovedVenues()
      },
      fail: () => {
        this.loadApprovedVenues()
      }
    })
  },

  loadApprovedVenues(center = {}) {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getCourtMapState',
      data: {
        latitude: Number(center.latitude || this.data.latitude),
        longitude: Number(center.longitude || this.data.longitude),
        radiusKm: 30
      },
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '球馆加载失败', icon: 'none' })
          this.setData({ loading: false, venues: [], markers: [], selectedVenue: null })
          return
        }
        this.updateVenues(result.data || [])
      },
      fail: () => {
        wx.showToast({ title: '球馆加载失败', icon: 'none' })
        this.setData({ loading: false, venues: [], markers: [], selectedVenue: null })
      }
    })
  },

  updateVenues(venues) {
    const colorMap = {
      joinable: { bg: '#19B56B', fg: '#FFFFFF' },
      full: { bg: '#E94B35', fg: '#FFFFFF' },
      empty: { bg: '#1F7AFF', fg: '#FFFFFF' }
    }
    const normalized = venues.map((venue, index) => ({
      ...venue,
      markerId: index + 1,
      distanceText: this.formatDistance(venue.latitude, venue.longitude),
      courtSummary: this.formatCourtSummary(venue)
    }))

    const markers = normalized.map((venue) => ({
      iconPath: '/images/icons/location.png',
      id: venue.markerId,
      title: venue.name,
      latitude: venue.latitude,
      longitude: venue.longitude,
      width: 28,
      height: 28,
      callout: {
        content: `${venue.name}\n${venue.statusLabel || '空场可约'}`,
        color: (colorMap[venue.mapStatus] || colorMap.empty).fg,
        fontSize: 13,
        borderRadius: 8,
        bgColor: (colorMap[venue.mapStatus] || colorMap.empty).bg,
        padding: 8,
        display: 'ALWAYS'
      }
    }))

    const focusVenue = this.data.focusVenueId
      ? normalized.find(venue => venue._id === this.data.focusVenueId)
      : null
    const selectedVenue = focusVenue || normalized[0] || null
    this.setData({
      loading: false,
      venues: normalized,
      markers,
      selectedVenue,
      latitude: selectedVenue ? selectedVenue.latitude : this.data.latitude,
      longitude: selectedVenue ? selectedVenue.longitude : this.data.longitude
    })
  },

  onRegionChange(e) {
    if (e.type === 'begin') {
      this.setData({ moving: true })
      return
    }
    if (e.type !== 'end' || !this.mapCtx) return
    clearTimeout(this.regionTimer)
    this.regionTimer = setTimeout(() => {
      this.mapCtx.getCenterLocation({
        success: (res) => {
          this.setData({ moving: false, latitude: res.latitude, longitude: res.longitude })
          this.loadApprovedVenues({ latitude: res.latitude, longitude: res.longitude })
        },
        fail: () => this.setData({ moving: false })
      })
    }, 280)
  },

  goVenue(e) {
    const venue = this.data.venues.find((item) => item.markerId === e.detail.markerId)
    if (!venue) return
    this.setData({ selectedVenue: venue })
  },

  selectVenue(e) {
    const id = e.currentTarget.dataset.id
    const venue = this.data.venues.find((item) => item._id === id)
    if (!venue) return
    this.setData({
      selectedVenue: venue,
      latitude: venue.latitude,
      longitude: venue.longitude
    })
  },

  openVenue(e) {
    const id = e.currentTarget.dataset.id || (this.data.selectedVenue && this.data.selectedVenue._id)
    const venue = this.data.venues.find((item) => item._id === id) || this.data.selectedVenue
    if (!venue) return
    const title = encodeURIComponent(venue.name || '球场')
    wx.navigateTo({ url: `/pages/venue-match/venue-match?venueId=${venue._id}&title=${title}` })
  },

  navigateVenue(e) {
    const id = e.currentTarget.dataset.id || (this.data.selectedVenue && this.data.selectedVenue._id)
    const venue = this.data.venues.find((item) => item._id === id) || this.data.selectedVenue
    if (!venue || !venue.latitude || !venue.longitude) return wx.showToast({ title: '暂无球馆定位', icon: 'none' })
    wx.openLocation({
      latitude: Number(venue.latitude),
      longitude: Number(venue.longitude),
      name: venue.locationName || venue.name || '球馆位置',
      address: venue.address || ''
    })
  },

  formatDistance(latitude, longitude) {
    const distance = this.getDistance(this.data.latitude, this.data.longitude, latitude, longitude)
    if (!distance) return ''
    return distance >= 1000 ? `${(distance / 1000).toFixed(1)}km` : `${Math.round(distance)}m`
  },

  formatCourtSummary(venue) {
    const courtTypes = venue.courtTypes || []
    const courtCounts = venue.courtCounts || {}
    if (!courtTypes.length) return venue.venueType || '球馆'
    return courtTypes.map(type => `${type}${Number(courtCounts[type]) || 0}块`).join(' · ')
  },

  getDistance(lat1, lng1, lat2, lng2) {
    const toRad = value => value * Math.PI / 180
    const earthRadius = 6378137
    const dLat = toRad(Number(lat2) - Number(lat1))
    const dLng = toRad(Number(lng2) - Number(lng1))
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(Number(lat1))) * Math.cos(toRad(Number(lat2))) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
})
