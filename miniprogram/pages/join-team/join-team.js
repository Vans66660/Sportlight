const identity = require('../../utils/identity')

Page({
  data: {
    loading: true,
    error: '',
    reg: null,
    postTitle: '',
    eventDate: '',
    eventLocation: '',
    filledCount: 0,
    joining: false,
    joined: false,
    teamName: '',
    isRegularTeam: false
  },

  onLoad(options) {
    this.inviteCode = options.code || ''
    if (!this.inviteCode) {
      this.setData({ loading: false, error: '邀请链接无效' })
      return
    }
    wx.cloud.callFunction({
      name: 'joinTeam',
      data: { inviteCode: this.inviteCode, preview: true },
      success: (r) => {
        const res = r.result
        if (res.code === 0) {
          const filledCount = (res.reg.members || []).filter(m => m.openid).length
          this.setData({
            loading: false,
            reg: res.reg,
            postTitle: res.postTitle,
            eventDate: res.eventDate || '',
            eventLocation: res.eventLocation || '',
            filledCount,
            isRegularTeam: res.reg.registrationType === 'regular_team'
          })
          wx.setNavigationBarTitle({ title: `加入「${res.reg.teamName}」` })
        } else if (res.alreadyMember) {
          this.setData({ loading: false, error: '你已经在这支队伍中了' })
        } else {
          this.setData({ loading: false, error: res.msg || '邀请链接已失效' })
        }
      },
      fail: () => {
        this.setData({ loading: false, error: '网络错误，请重试' })
      }
    })
  },

  joinTeam() {
    identity.ensureVerified(() => this._doJoinTeam())
  },

  _doJoinTeam() {
    if (this.data.joining) return
    this.setData({ joining: true })
    wx.cloud.callFunction({
      name: 'joinTeam',
      data: { inviteCode: this.inviteCode },
      success: (r) => {
        this.setData({ joining: false })
        const res = r.result
        if (res.code === 0) {
          this.setData({ joined: true, teamName: res.teamName, isRegularTeam: !!res.isRegularTeam })
        } else {
          wx.showToast({ title: res.msg || '加入失败', icon: 'none' })
        }
      },
      fail: () => {
        this.setData({ joining: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  goBack() {
    wx.switchTab({ url: '/pages/market/market' })
  },

  goAthleteProfile(e) {
    const { openid } = e.currentTarget.dataset
    if (!openid) return
    wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
  }
})
