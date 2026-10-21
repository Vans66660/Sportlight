Page({
  data: {
    challenges: [],
    myCaptainTeam: null,
    loading: true
  },

  onLoad() { this.loadMine(); this.load() },
  onPullDownRefresh() { this.load(true) },

  loadMine() {
    wx.cloud.callFunction({
      name: 'getMyTeams',
      success: res => {
        const leader = ((res.result || {}).leaderTeams || [])[0] || null
        this.setData({ myCaptainTeam: leader })
      }
    })
  },

  load(refresh = false) {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getTeamChallengeList',
      data: { mode: 'public' },
      success: res => {
        this.setData({ challenges: ((res.result || {}).data) || [], loading: false })
        if (refresh) wx.stopPullDownRefresh()
      },
      fail: () => {
        this.setData({ loading: false })
        if (refresh) wx.stopPullDownRefresh()
      }
    })
  },

  create() {
    if (!this.data.myCaptainTeam) return wx.showToast({ title: '只有队长可以发起约战', icon: 'none' })
    wx.navigateTo({ url: `/pages/team-challenge-create/team-challenge-create?teamId=${this.data.myCaptainTeam._id}` })
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/team-challenge-detail/team-challenge-detail?challengeId=${e.currentTarget.dataset.id}` })
  }
})
