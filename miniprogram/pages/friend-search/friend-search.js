Page({
  data: {
    mode: 'friend',
    teamId: '',
    keyword: '',
    results: [],
    searched: false,
    loading: false
  },

  onLoad(options) {
    const mode = options.mode === 'teamInvite' ? 'teamInvite' : 'friend'
    this.setData({
      mode,
      teamId: options.teamId || ''
    })
    wx.setNavigationBarTitle({ title: mode === 'teamInvite' ? '邀请队员' : '添加好友' })
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  search() {
    const keyword = String(this.data.keyword || '').trim()
    if (!keyword) {
      wx.showToast({ title: '请输入搜索内容', icon: 'none' })
      return
    }
    this.setData({ loading: true, searched: true })
    wx.cloud.callFunction({
      name: 'searchSocialUsers',
      data: { keyword, teamId: this.data.mode === 'teamInvite' ? this.data.teamId : '' },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) this.setData({ results: result.data || [], loading: false })
        else {
          this.setData({ loading: false })
          wx.showToast({ title: result.msg || '搜索失败', icon: 'none' })
        }
      },
      fail: () => {
        this.setData({ loading: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  goProfile(e) {
    const openid = e.currentTarget.dataset.openid
    if (openid) wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
  },

  sendFriend(e) {
    const index = e.currentTarget.dataset.index
    const user = this.data.results[index]
    if (!user || user.friendStatus !== 'none') return
    wx.showModal({
      title: '好友申请',
      editable: true,
      placeholderText: `向 ${user.displayName || '对方'} 说句话`,
      confirmText: '发送',
      confirmColor: '#FF6B1A',
      success: res => {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'sendFriendRequest',
          data: { toOpenid: user.openid, message: res.content || '' },
          success: callRes => {
            const result = callRes.result || {}
            if (result.code === 0) {
              this.setData({ [`results[${index}].friendStatus`]: 'pending_sent' })
              wx.showToast({ title: '已发送', icon: 'success' })
            } else wx.showToast({ title: result.msg || '发送失败', icon: 'none' })
          }
        })
      }
    })
  },

  inviteTeam(e) {
    const index = e.currentTarget.dataset.index
    const user = this.data.results[index]
    if (!user || user.inTeam || user.teamInviteStatus === 'pending') return
    wx.cloud.callFunction({
      name: 'sendTeamInvite',
      data: { teamId: this.data.teamId, toOpenid: user.openid },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          this.setData({ [`results[${index}].teamInviteStatus`]: 'pending' })
          wx.showToast({ title: '已邀请', icon: 'success' })
        } else wx.showToast({ title: result.msg || '邀请失败', icon: 'none' })
      },
      fail: () => wx.showToast({ title: '网络错误', icon: 'none' })
    })
  },

  startChat(e) {
    const index = e.currentTarget.dataset.index
    const user = this.data.results[index]
    if (!user || user.friendStatus !== 'friends') return
    wx.cloud.callFunction({
      name: 'startFriendChat',
      data: { friendOpenid: user.openid },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          wx.navigateTo({ url: `/pages/chat/chat?orderId=${result.orderId}&title=${encodeURIComponent(result.title || user.displayName || '好友聊天')}&chatKind=direct` })
        } else wx.showToast({ title: result.msg || '进入失败', icon: 'none' })
      }
    })
  }
})
