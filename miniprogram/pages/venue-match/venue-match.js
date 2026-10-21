Page({
  data: {
    loading: true,
    venueId: '',
    venue: {},
    pricingRules: [],
    courtRows: []
  },

  onLoad(options) {
    const venueId = options.venueId || ''
    const title = decodeURIComponent(options.title || '场馆约场')
    this.setData({ venueId })
    wx.setNavigationBarTitle({ title })
    if (!venueId) {
      this.setData({ loading: false, venue: { name: title } })
      return
    }
    this.loadVenue(venueId)
  },

  loadVenue(venueId) {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getPublicVenueDetail',
      data: { venueId },
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '球馆加载失败', icon: 'none' })
          this.setData({ loading: false })
          return
        }
        this.hydrateVenue(result.data || {})
      },
      fail: () => {
        wx.showToast({ title: '球馆加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  hydrateVenue(venue) {
    const courtTypes = venue.courtTypes || []
    const courtCounts = venue.courtCounts || {}
    const pricingRules = venue.pricingRules || []
    const courtRows = courtTypes.map(type => {
      const rule = pricingRules.find(item => item.courtType === type) || {}
      return {
        courtType: type,
        count: Number(courtCounts[type]) || 0,
        casualPricePerPerson: Number(rule.casualPricePerPerson) || 0,
        privatePricePerHour: Number(rule.privatePricePerHour) || 0,
        casualDurationMode: rule.casualDurationMode || 'unlimited',
        casualDurationMinutes: Number(rule.casualDurationMinutes) || 0
      }
    })

    this.setData({
      loading: false,
      venue: {
        ...venue,
        galleryImages: venue.galleryImages || [],
        sports: venue.sports || []
      },
      pricingRules,
      courtRows
    })
  },

  previewCover() {
    const venue = this.data.venue || {}
    const cover = venue.coverImage
    if (!cover) return
    wx.previewImage({
      current: cover,
      urls: [cover].concat(venue.galleryImages || []).filter(Boolean)
    })
  },

  openLocation() {
    const venue = this.data.venue || {}
    const latitude = Number(venue.latitude)
    const longitude = Number(venue.longitude)
    if (!latitude || !longitude) return wx.showToast({ title: '暂无球馆定位', icon: 'none' })
    wx.openLocation({
      latitude,
      longitude,
      name: venue.locationName || venue.name || '球馆位置',
      address: venue.address || ''
    })
  },

  goMapNavigation() {
    const venue = this.data.venue || {}
    const venueId = this.data.venueId || venue._id || ''
    const latitude = Number(venue.latitude)
    const longitude = Number(venue.longitude)
    if (!venueId || !latitude || !longitude) return wx.showToast({ title: '暂无球馆定位', icon: 'none' })
    wx.navigateTo({ url: `/pages/court-map/court-map?venueId=${venueId}&focus=1` })
  },

  goVenueSoloGames() {
    const venueId = this.data.venueId || ''
    wx.navigateTo({ url: `/pages/solo-games/solo-games?venueId=${venueId}` })
  },

  goPrivateBooking() {
    wx.showToast({ title: '包场入口已预留', icon: 'none' })
  }
})
