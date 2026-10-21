function todayStr(offset = 0) {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const identity = require('../../utils/identity')
const { requestImportantNotice, TEMPLATE_TYPES } = require('../../utils/subscribe-notice')

Page({
  data: {
    teamId: '',
    targetTeamId: '',
    team: null,
    venues: [],
    selectedVenue: null,
    form: {
      date: '',
      time: '19:00',
      spec: '',
      paymentMethod: 'aa',
      opponentRequirement: '不限',
      description: ''
    },
    specOptions: [],
    paymentOptions: [
      { key: 'aa', label: 'AA' },
      { key: 'host', label: '我方承担' }
    ],
    requirementOptions: ['不限', '积分接近', '友谊局', '高强度']
  },

  onLoad(options) {
    this.setData({
      teamId: options.teamId || '',
      targetTeamId: options.targetTeamId || '',
      'form.date': todayStr()
    })
    this.loadTeam()
    this.loadVenues()
  },

  loadTeam() {
    wx.cloud.callFunction({
      name: 'getTeamDetail',
      data: { teamId: this.data.teamId },
      success: res => {
        const team = ((res.result || {}).data) || null
        if (!team || !team.isCaptain) {
          wx.showToast({ title: '只有队长可以发起约战', icon: 'none' })
          return
        }
        const specOptions = team.sport === '篮球'
          ? ['3v3', '5v5']
          : (team.sport === '羽毛球' ? ['单打', '双打', '混双', '团体赛'] : ['5v5', '7v7', '8v8', '9v9', '11v11'])
        this.setData({ team, specOptions, 'form.spec': specOptions[0] })
      }
    })
  },

  loadVenues() {
    wx.cloud.callFunction({
      name: 'getApprovedVenues',
      success: res => this.setData({ venues: ((res.result || {}).data) || [] })
    })
  },

  onInput(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }) },
  onDate(e) { this.setData({ 'form.date': e.detail.value }) },
  onTime(e) { this.setData({ 'form.time': e.detail.value }) },
  setSpec(e) { this.setData({ 'form.spec': e.currentTarget.dataset.value }) },
  setPayment(e) { this.setData({ 'form.paymentMethod': e.currentTarget.dataset.value }) },
  setReq(e) { this.setData({ 'form.opponentRequirement': e.currentTarget.dataset.value }) },
  selectVenue(e) {
    const venue = this.data.venues.find(item => item._id === e.currentTarget.dataset.id)
    this.setData({ selectedVenue: venue || null })
  },

  submit() {
    identity.ensureVerified(() => this._doSubmit())
  },

  _doSubmit() {
    const { team, form, selectedVenue, targetTeamId } = this.data
    if (!team) return wx.showToast({ title: '球队信息未加载', icon: 'none' })
    if (!selectedVenue) return wx.showToast({ title: '请选择球馆', icon: 'none' })
    requestImportantNotice([TEMPLATE_TYPES.team])
    wx.showLoading({ title: '发布中...' })
    wx.cloud.callFunction({
      name: 'createTeamChallenge',
      data: {
        teamId: team._id,
        targetTeamId,
        ...form,
        venueId: selectedVenue._id,
        venueName: selectedVenue.name
      },
      success: res => {
        wx.hideLoading()
        const result = res.result || {}
        if (result.code === 0) wx.redirectTo({ url: `/pages/team-challenge-detail/team-challenge-detail?challengeId=${result.challengeId}` })
        else wx.showToast({ title: result.msg || '发布失败', icon: 'none' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '发布失败', icon: 'none' })
      }
    })
  }
})
