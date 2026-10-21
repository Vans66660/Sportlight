Page({
  data: {
    postId: '',
    post: null,
    canManage: false,
    canRecord: false,
    schedule: null,
    groups: [],
    matchesByGroup: [],
    standingsList: [],
    loading: true,
    scoreModal: {
      show: false,
      match: null,
      scoreA: '',
      scoreB: ''
    }
  },

  onLoad(options) {
    this.setData({ postId: options.postId || '' })
    this.load()
  },

  load() {
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getEventSchedule',
      data: { postId: this.data.postId },
      success: (res) => {
        wx.hideLoading()
        if (!res.result || res.result.code !== 0) {
          wx.showToast({ title: (res.result && res.result.msg) || '加载失败', icon: 'none' })
          this.setData({ loading: false })
          return
        }
        const schedule = res.result.schedule || null
        this.setData({
          post: res.result.post,
          canManage: !!(res.result.post && res.result.post.canManage),
          canRecord: !!(res.result.post && res.result.post.canRecord),
          schedule,
          groups: schedule ? (schedule.groups || []) : [],
          matchesByGroup: schedule ? this.buildMatchesByGroup(schedule) : [],
          standingsList: this.buildStandingsList(res.result.standings || {}),
          loading: false
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  buildMatchesByGroup(schedule) {
    const groups = schedule.groups || []
    return groups.map(group => ({
      groupName: group.name,
      matches: (schedule.matches || []).filter(match => match.groupName === group.name)
    }))
  },

  buildStandingsList(standings) {
    return Object.keys(standings).sort().map(groupName => ({
      groupName,
      rows: standings[groupName] || []
    }))
  },

  goBack() {
    wx.navigateBack()
  },

  generateSchedule() {
    wx.showModal({
      title: '生成赛程',
      content: '将按已确认参赛队伍自动分组并生成小组循环赛。已有赛程会被保留。',
      confirmText: '生成',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '生成中...' })
        wx.cloud.callFunction({
          name: 'generateEventSchedule',
          data: { postId: this.data.postId },
          success: (r) => {
            wx.hideLoading()
            if (r.result && r.result.code === 0) {
              wx.showToast({ title: '赛程已生成', icon: 'success' })
              this.load()
            } else {
              wx.showToast({ title: (r.result && r.result.msg) || '生成失败', icon: 'none' })
            }
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络错误', icon: 'none' })
          }
        })
      }
    })
  },

  openScoreModal(e) {
    if (!this.data.canRecord) return
    const { group, index } = e.currentTarget.dataset
    const groupBlock = this.data.matchesByGroup[group]
    if (!groupBlock) return
    const match = groupBlock.matches[index]
    if (!match) return
    this.setData({
      scoreModal: {
        show: true,
        match,
        scoreA: match.scoreA === null || match.scoreA === undefined ? '' : String(match.scoreA),
        scoreB: match.scoreB === null || match.scoreB === undefined ? '' : String(match.scoreB)
      }
    })
  },

  closeScoreModal() {
    this.setData({
      'scoreModal.show': false,
      'scoreModal.match': null,
      'scoreModal.scoreA': '',
      'scoreModal.scoreB': ''
    })
  },

  onScoreInput(e) {
    const { side } = e.currentTarget.dataset
    this.setData({ [`scoreModal.${side}`]: e.detail.value })
  },

  saveScore() {
    const { match, scoreA, scoreB } = this.data.scoreModal
    if (!match) return
    if (scoreA === '' || scoreB === '') {
      wx.showToast({ title: '请填写双方比分', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'updateMatchScore',
      data: {
        postId: this.data.postId,
        matchId: match.matchId,
        scoreA,
        scoreB
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '已保存', icon: 'success' })
          this.closeScoreModal()
          this.load()
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  }
})
