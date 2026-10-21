Page({
  data: {
    postId: '',
    postContent: '',
    eventDate: '',
    sport: '',
    registrants: [],
    hasExisting: false,
    loading: true
  },

  onLoad(options) {
    this.setData({ postId: options.postId || '' })
    this.loadRegistrants()
  },

  loadRegistrants() {
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getEventRegistrants',
      data: { postId: this.data.postId },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          const individuals = []
          if (!res.result.post || !res.result.post.canRecord) {
            wx.showToast({ title: '成绩由 Sportlight 平台录入', icon: 'none' })
            setTimeout(() => wx.navigateBack(), 600)
            return
          }
          ;(res.result.confirmed || []).forEach(team => {
            if (!['paid', 'free', 'offline', 'unpaid'].includes(team.paymentStatus)) return
            ;(team.members || []).forEach(m => {
              if (m.openid && m.confirmed) {
                individuals.push({
                  openid: m.openid,
                  name: m.name || '',
                  photo: m.photoUrl || '',
                  teamName: team.teamName || '',
                  attended: true,
                  rank: null,
                  score: null,
                  notes: '',
                  stats: {}
                })
              }
            })
          })
          this.setData({
            registrants: individuals,
            postContent: res.result.post.content,
            eventDate: res.result.post.eventDate,
            sport: res.result.post.sport,
            hasExisting: res.result.post.hasExisting || false,
            loading: false
          })
        } else {
          wx.showToast({ title: res.result.msg, icon: 'none' })
          wx.navigateBack()
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '加载失败', icon: 'none' })
        wx.navigateBack()
      }
    })
  },

  onInput(e) {
    const { index, field } = e.currentTarget.dataset
    const value = e.detail.value
    this.setData({ [`registrants[${index}].${field}`]: value })
  },

  toggleAttended(e) {
    const { index } = e.currentTarget.dataset
    const current = this.data.registrants[index].attended
    this.setData({ [`registrants[${index}].attended`]: !current })
  },

  goBack() {
    wx.navigateBack()
  },

  submit() {
    const { registrants, postId } = this.data
    if (registrants.length === 0) {
      wx.showToast({ title: '暂无参赛者', icon: 'none' })
      return
    }
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'submitEventResults',
      data: { postId, results: registrants },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          wx.showToast({ title: '成绩已录入 ✓', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 1200)
        } else {
          wx.showToast({ title: res.result.msg, icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  }
})
