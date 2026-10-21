const { requestImportantNotice, TEMPLATE_TYPES } = require('../../utils/subscribe-notice')

Page({
  data: {
    challengeId: '',
    challenge: null,
    loading: true
  },

  onLoad(options) {
    this.setData({ challengeId: options.challengeId || '' })
  },

  onShow() {
    this.load()
  },

  load() {
    if (!this.data.challengeId) return
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getTeamChallengeDetail',
      data: { challengeId: this.data.challengeId },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) this.setData({ challenge: result.data, loading: false })
        else {
          this.setData({ loading: false })
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        }
      },
      fail: () => this.setData({ loading: false })
    })
  },

  goTeam(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/team-home/team-home?teamId=${id}` })
  },

  goAthlete(e) {
    const openid = e.currentTarget.dataset.openid
    if (openid) wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
  },

  applyBattle() {
    const team = (this.data.challenge.myCaptainTeams || [])[0]
    if (team) {
      this._doApplyBattle(team._id)
      return
    }
    // myCaptainTeams 未返回，自动查询用户球队
    wx.showLoading({ title: '查询中...' })
    wx.cloud.callFunction({
      name: 'getMyTeams',
      success: res => {
        wx.hideLoading()
        const teams = (res.result && res.result.teams) || []
        const captainTeam = teams.find(t => t.captainOpenid === (getApp().globalData.openid || ''))
        if (captainTeam) {
          this._doApplyBattle(captainTeam._id)
        } else {
          wx.showToast({ title: '只有队长可以应战，请先创建球队', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '查询失败，请重试', icon: 'none' })
      }
    })
  },

  _doApplyBattle(teamId) {
    requestImportantNotice([TEMPLATE_TYPES.team])
    wx.cloud.callFunction({
      name: 'applyTeamChallenge',
      data: { challengeId: this.data.challengeId, teamId },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          wx.showToast({ title: '已申请应战', icon: 'success' })
          this.load()
        } else wx.showToast({ title: result.msg || '应战失败', icon: 'none' })
      }
    })
  },

  respondDirect(e) {
    this.respond(e.currentTarget.dataset.action)
  },

  confirmApplication(e) {
    this.respond(e.currentTarget.dataset.action, e.currentTarget.dataset.teamid)
  },

  respond(action, teamId = '') {
    requestImportantNotice([TEMPLATE_TYPES.team])
    wx.cloud.callFunction({
      name: 'respondTeamChallenge',
      data: { challengeId: this.data.challengeId, action, teamId },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          wx.showToast({ title: action === 'accept' ? '约战达成' : '已处理', icon: 'success' })
          this.load()
        } else wx.showToast({ title: result.msg || '处理失败', icon: 'none' })
      }
    })
  },

  joinBattle() {
    this.setJoin(true)
  },

  declineBattle() {
    this.setJoin(false)
  },

  setJoin(join) {
    wx.cloud.callFunction({
      name: 'joinTeamChallenge',
      data: { challengeId: this.data.challengeId, join },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          wx.showToast({ title: join ? '已确认参战' : '已选择下次再说', icon: 'success' })
          this.load()
        } else wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
      }
    })
  },

  shareChallenge() {
    wx.showShareMenu({ withShareTicket: true })
  },

  onShareAppMessage() {
    const c = this.data.challenge || {}
    return {
      title: `${c.homeTeamName || '球队'} VS ${c.awayTeamName || '待定'} 约战`,
      path: `/pages/team-challenge-detail/team-challenge-detail?challengeId=${this.data.challengeId}`
    }
  }
})
