function todayStr(offset = 0) {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const identity = require('../../utils/identity')

Page({
  data: {
    form: {
      date: '',
      startTime: '18:00',
      endTime: '20:00',
      sport: '足球',
      customSport: '',
      notice: '',
      minPlayers: '',
      maxPlayers: '',
      deadlineDate: '',
      deadlineTime: '',
      paymentMethod: 'aa'
    },
    sportOptions: ['足球', '篮球', '羽毛球', '其他'],
    paymentOptions: [{ key: 'aa', label: 'AA预交' }, { key: 'free', label: '免费局' }, { key: 'private', label: '包场' }],
    allVenues: [],
    venues: [],
    selectedVenue: null,
    selectedCourt: null,
    loadingOptions: false
  },

  onLoad(options) {
    const date = options.date || todayStr()
    const presetVenueId = options.venueId || ''
    this.setData({
      'form.date': date,
      'form.deadlineDate': date,
      'form.deadlineTime': '17:30',
      presetVenueId
    }, () => this.loadOptions())
  },

  onShow() {
    const venue = wx.getStorageSync('soloSelectedVenue')
    if (venue && venue._id) {
      wx.removeStorageSync('soloSelectedVenue')
      this.applySelectedVenue(venue._id)
    }
  },

  onDateChange(e) { this.setData({ 'form.date': e.detail.value, 'form.deadlineDate': e.detail.value, selectedVenue: null, selectedCourt: null }, () => this.loadOptions()) },
  onStartChange(e) { this.setData({ 'form.startTime': e.detail.value, selectedVenue: null, selectedCourt: null }, () => this.loadOptions()) },
  onEndChange(e) { this.setData({ 'form.endTime': e.detail.value, selectedVenue: null, selectedCourt: null }, () => this.loadOptions()) },
  onDeadlineDateChange(e) { this.setData({ 'form.deadlineDate': e.detail.value }) },
  onDeadlineTimeChange(e) { this.setData({ 'form.deadlineTime': e.detail.value }) },
  onInput(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }) },
  setSport(e) { this.setData({ 'form.sport': e.currentTarget.dataset.value }) },
  setPayment(e) { this.setData({ 'form.paymentMethod': e.currentTarget.dataset.value }) },

  loadOptions() {
    this.setData({ loadingOptions: true })
    wx.cloud.callFunction({
      name: 'getSoloCreateOptions',
      data: {
        date: this.data.form.date,
        startTime: this.data.form.startTime,
        endTime: this.data.form.endTime
      },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          const venues = result.data || []
          this.setData({ venues, allVenues: venues, loadingOptions: false }, () => {
            if (this.data.presetVenueId && !this.data.selectedVenue) this.applySelectedVenue(this.data.presetVenueId)
          })
        }
        else {
          wx.showToast({ title: result.msg || '加载球场失败', icon: 'none' })
          this.setData({ loadingOptions: false })
        }
      },
      fail: () => {
        wx.showToast({ title: '加载球场失败', icon: 'none' })
        this.setData({ loadingOptions: false })
      }
    })
  },

  selectVenue(e) {
    const venue = this.data.venues.find(item => item._id === e.currentTarget.dataset.id)
    if (!venue) return
    this.setData({ selectedVenue: venue, selectedCourt: null })
  },

  applySelectedVenue(venueId) {
    const venue = this.data.venues.find(item => item._id === venueId)
    if (!venue) {
      this.setData({ presetVenueId: venueId })
      return
    }
    this.setData({ selectedVenue: venue, selectedCourt: null, presetVenueId: venueId })
  },

  goVenueSelect() {
    wx.navigateTo({ url: '/pages/venue-select/venue-select' })
  },

  selectCourt(e) {
    const venue = this.data.selectedVenue
    if (!venue) return
    const court = (venue.courts || []).find(item => item.courtId === e.currentTarget.dataset.id)
    if (!court || court.disabled) return
    this.setData({ selectedCourt: court })
  },

  submit() {
    identity.ensureVerified(() => this._doSubmit())
  },

  _doSubmit() {
    const { form, selectedVenue, selectedCourt } = this.data
    if (!selectedVenue || !selectedCourt) return wx.showToast({ title: '请选择可用场地', icon: 'none' })
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'createSoloGame',
      data: { ...form, venueId: selectedVenue._id, courtId: selectedCourt.courtId, courtName: selectedCourt.courtName, courtType: selectedCourt.courtType },
      success: res => {
        wx.hideLoading()
        const result = res.result || {}
        if (result.code === 0) {
          if (result.requiresPayment) wx.showToast({ title: '请支付包场费', icon: 'none' })
          setTimeout(() => wx.redirectTo({ url: `/pages/solo-game-detail/solo-game-detail?gameId=${result.gameId}` }), result.requiresPayment ? 700 : 0)
        }
        else wx.showToast({ title: result.msg || '创建失败', icon: 'none' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '创建失败', icon: 'none' })
      }
    })
  }
})
