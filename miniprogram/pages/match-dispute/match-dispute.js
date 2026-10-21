Page({
  data: {
    postId: '',
    postTitle: '',
    matches: [],
    loading: true,
    selectedMatch: null,
    reason: '',
    submitting: false
  },

  onLoad(options) {
    const postId = options.postId || ''
    const postTitle = decodeURIComponent(options.title || '')
    this.setData({ postId, postTitle })
    this.loadSchedule(postId)
  },

  loadSchedule(postId) {
    wx.showLoading({ title: '加载赛程...' })
    wx.cloud.callFunction({
      name: 'getEventSchedule',
      data: { postId },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          const schedule = res.result.schedule
          if (schedule && schedule.matches) {
            // 只展示已完成的比赛
            const matches = schedule.matches
              .filter(m => m.status === 'finished')
              .map(m => ({
                ...m,
                label: `${m.group || ''} ${m.round || ''}：${m.teamA || m.homeTeam || ''} ${m.scoreA || 0}-${m.scoreB || 0} ${m.teamB || m.awayTeam || ''}`
              }))
            this.setData({ matches, loading: false })
          } else {
            this.setData({ loading: false })
          }
        } else {
          this.setData({ loading: false })
          wx.showToast({ title: '加载赛程失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ loading: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  selectMatch(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ selectedMatch: index })
  },

  onReasonInput(e) {
    this.setData({ reason: e.detail.value })
  },

  submit() {
    const { postId, matches, selectedMatch, reason, submitting } = this.data
    if (submitting) return
    if (selectedMatch === null) {
      wx.showToast({ title: '请选择有异议的比赛', icon: 'none' })
      return
    }
    if (!reason.trim()) {
      wx.showToast({ title: '请填写反馈原因', icon: 'none' })
      return
    }

    const match = matches[selectedMatch]
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'submitMatchDispute',
      data: {
        postId,
        matchId: match.matchId || match._id || '',
        groupName: match.group || '',
        round: match.round || '',
        teamA: match.teamA || match.homeTeam || '',
        teamB: match.teamB || match.awayTeam || '',
        reason: reason.trim()
      },
      success: (res) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '反馈已提交', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 1500)
        } else {
          wx.showToast({ title: res.result.msg || '提交失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ submitting: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
