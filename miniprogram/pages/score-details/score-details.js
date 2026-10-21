Page({
  data: {
    openid: '',
    loading: true,
    logs: []
  },

  onLoad(options) {
    this.setData({ openid: options.openid || '' })
    this.loadLogs()
  },

  loadLogs() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getAthleteScoreLogs',
      data: { openid: this.data.openid },
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0) {
          this.setData({ logs: result.data || [], loading: false })
        } else {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: () => {
        wx.showToast({ title: '云函数调用失败', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  }
})
