Page({
  data: {
    tabs: ['', '足球', '篮球', '羽毛球'],
    tabLabels: ['全部', '足球', '篮球', '羽毛球'],
    activeSport: '',
    teams: [],
    loading: true
  },

  onLoad() { this.load() },
  onPullDownRefresh() { this.load(true) },

  setSport(e) {
    this.setData({ activeSport: e.currentTarget.dataset.value }, () => this.load(true))
  },

  load(refresh = false) {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getTeamSquare',
      data: { sport: this.data.activeSport },
      success: res => {
        const result = res.result || {}
        this.setData({ teams: result.data || [], loading: false })
        if (refresh) wx.stopPullDownRefresh()
      },
      fail: () => {
        this.setData({ loading: false })
        if (refresh) wx.stopPullDownRefresh()
      }
    })
  },

  goTeam(e) {
    wx.navigateTo({ url: `/pages/team-home/team-home?teamId=${e.currentTarget.dataset.id}` })
  }
})
