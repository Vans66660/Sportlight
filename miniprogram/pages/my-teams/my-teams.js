const identity = require('../../utils/identity')

Page({
  data: {
    loading: true,
    leaderTeams: [],
    joinedTeams: [],
    canCreate: true
  },

  onShow() {
    this.load()
  },

  load() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getMyTeams',
      success: res => {
        const result = res.result || {}
        this.setData({
          leaderTeams: result.leaderTeams || [],
          joinedTeams: result.joinedTeams || [],
          canCreate: result.canCreate !== false,
          loading: false
        })
      },
      fail: () => this.setData({ loading: false })
    })
  },

  createTeam() {
    identity.ensureVerified(() => {
      if (!this.data.canCreate) return wx.showToast({ title: '每人只能当一个队长', icon: 'none' })
      wx.navigateTo({ url: '/pages/team-edit/team-edit' })
    })
  },

  goSquare() {
    wx.navigateTo({ url: '/pages/team-square/team-square' })
  },

  goTeam(e) {
    wx.navigateTo({ url: `/pages/team-home/team-home?teamId=${e.currentTarget.dataset.id}` })
  },

  goManage(e) {
    wx.navigateTo({ url: `/pages/team-manage/team-manage?teamId=${e.currentTarget.dataset.id}` })
  }
})
