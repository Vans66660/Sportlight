Page({
  data: {
    teamId: '',
    team: null,
    requests: [],
    loading: true
  },

  onLoad(options) {
    this.setData({ teamId: options.teamId || '' })
  },

  onShow() {
    this.load()
  },

  load() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getTeamManage',
      data: { teamId: this.data.teamId },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) this.setData({ team: result.team, requests: result.requests || [], loading: false })
        else {
          this.setData({ loading: false })
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        }
      },
      fail: () => this.setData({ loading: false })
    })
  },

  editTeam() {
    wx.navigateTo({ url: `/pages/team-edit/team-edit?teamId=${this.data.teamId}` })
  },

  inviteMember() {
    wx.navigateTo({ url: `/pages/friend-search/friend-search?mode=teamInvite&teamId=${this.data.teamId}` })
  },

  onShareAppMessage() {
    const team = this.data.team || {}
    return {
      title: `申请加入「${team.name || '球队'}」`,
      path: `/pages/team-home/team-home?teamId=${this.data.teamId}&invite=1`
    }
  },

  goAthlete(e) {
    const openid = e.currentTarget.dataset.openid
    if (openid) wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
  },

  review(e) {
    const { id, action } = e.currentTarget.dataset
    wx.cloud.callFunction({
      name: 'reviewTeamJoin',
      data: { requestId: id, action },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          wx.showToast({ title: action === 'approve' ? '已通过' : '已拒绝', icon: 'success' })
          this.load()
        } else wx.showToast({ title: result.msg || '处理失败', icon: 'none' })
      }
    })
  },

  removeMember(e) {
    const openid = e.currentTarget.dataset.openid
    const name = e.currentTarget.dataset.name || '该成员'
    wx.showModal({
      title: '移除成员',
      content: `确认将${name}移出球队？`,
      confirmText: '移除',
      confirmColor: '#FF6B1A',
      success: res => {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'removeTeamMember',
          data: { teamId: this.data.teamId, memberOpenid: openid },
          success: callRes => {
            const result = callRes.result || {}
            if (result.code === 0) {
              wx.showToast({ title: '已移除', icon: 'success' })
              this.load()
            } else wx.showToast({ title: result.msg || '移除失败', icon: 'none' })
          }
        })
      }
    })
  },

  transferCaptain(e) {
    const openid = e.currentTarget.dataset.openid
    const name = e.currentTarget.dataset.name || '该成员'
    wx.showModal({
      title: '转让队长',
      content: `确认将队长转让给${name}？转让后你将变为普通队员。`,
      confirmText: '确认转让',
      confirmColor: '#FF6B1A',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '转让中...' })
        wx.cloud.callFunction({
          name: 'transferTeamCaptain',
          data: { teamId: this.data.teamId, newCaptainOpenid: openid },
          success: callRes => {
            wx.hideLoading()
            const result = callRes.result || {}
            if (result.code === 0) {
              wx.showToast({ title: '已转让', icon: 'success' })
              setTimeout(() => wx.navigateBack(), 600)
            } else wx.showToast({ title: result.msg || '转让失败', icon: 'none' })
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络错误', icon: 'none' })
          }
        })
      }
    })
  }
})
