Page({
  data: {
    title: '约场'
  },

  onLoad(options) {
    const title = decodeURIComponent(options.title || '约场')
    this.setData({ title })
    wx.setNavigationBarTitle({ title })
  }
})
