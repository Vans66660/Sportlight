Page({
  data: {
    teams: [],
    hasTeam: false
  },

  onShow() {
    wx.cloud.callFunction({
      name: 'getMyTeams',
      success: res => {
        const teams = ((res.result || {}).data) || []
        this.setData({ teams, hasTeam: teams.length > 0 })
      }
    })
  },

  goMyTeams() { wx.navigateTo({ url: '/pages/my-teams/my-teams' }) },
  goSquare() { wx.navigateTo({ url: '/pages/team-square/team-square' }) },
  goChallengePlaza() { wx.navigateTo({ url: '/pages/team-challenges/team-challenges' }) }
})
