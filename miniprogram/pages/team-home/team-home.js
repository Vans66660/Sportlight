const { requestImportantNotice, TEMPLATE_TYPES } = require('../../utils/subscribe-notice')

Page({
  data: {
    teamId: '',
    team: null,
    loading: true,
    inviteMode: false
  },

  onLoad(options) {
    this.setData({ teamId: options.teamId || options.id || '', inviteMode: options.invite === '1' })
  },

  onShow() {
    this.load()
  },

  load() {
    if (!this.data.teamId) return
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getTeamDetail',
      data: { teamId: this.data.teamId },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) this.setData({ team: result.data, loading: false })
        else {
          this.setData({ loading: false })
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        }
      },
      fail: () => this.setData({ loading: false })
    })
  },

  previewGallery(e) {
    const urls = this.data.team.gallery || []
    wx.previewImage({ urls, current: urls[e.currentTarget.dataset.index] })
  },

  goAthlete(e) {
    const openid = e.currentTarget.dataset.openid
    if (openid) wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
  },

  applyJoin() {
    wx.showModal({
      title: '申请加入',
      editable: true,
      placeholderText: '写一句申请理由，队长会看到',
      confirmText: '提交',
      confirmColor: '#FF6B1A',
      success: res => {
        if (!res.confirm) return
        requestImportantNotice([TEMPLATE_TYPES.team])
        wx.showLoading({ title: '提交中...' })
        wx.cloud.callFunction({
          name: 'applyJoinTeam',
          data: { teamId: this.data.teamId, reason: res.content || '', fromInvite: this.data.inviteMode },
          success: callRes => {
            wx.hideLoading()
            const result = callRes.result || {}
            if (result.code === 0) {
              wx.showToast({ title: '已提交', icon: 'success' })
              this.load()
            } else wx.showToast({ title: result.msg || '提交失败', icon: 'none' })
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '提交失败', icon: 'none' })
          }
        })
      }
    })
  },

  goManage() {
    wx.navigateTo({ url: `/pages/team-manage/team-manage?teamId=${this.data.teamId}` })
  },

  goChallenge() {
    const team = this.data.team || {}
    if (!team.isCaptain && !team.canChallenge) return wx.showToast({ title: '只有队长可以发起约战', icon: 'none' })
    const target = team.isCaptain ? '' : `&targetTeamId=${this.data.teamId}`
    const fromTeam = team.isCaptain ? this.data.teamId : team.myCaptainTeamId
    wx.navigateTo({ url: `/pages/team-challenge-create/team-challenge-create?teamId=${fromTeam}${target}` })
  },

  contactCaptain() {
    wx.showLoading({ title: '打开聊天...' })
    wx.cloud.callFunction({
      name: 'startTeamCaptainChat',
      data: { teamId: this.data.teamId },
      success: res => {
        wx.hideLoading()
        const result = res.result || {}
        if (result.code === 0) {
          wx.navigateTo({ url: `/pages/chat/chat?orderId=${result.orderId}&chatKind=direct&title=${encodeURIComponent(result.title || '联系队长')}` })
        } else {
          wx.showToast({ title: result.msg || '暂无法联系', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '暂无法联系', icon: 'none' })
      }
    })
  },

  goChallengeDetail(e) {
    wx.navigateTo({ url: `/pages/team-challenge-detail/team-challenge-detail?challengeId=${e.currentTarget.dataset.id}` })
  }
})
