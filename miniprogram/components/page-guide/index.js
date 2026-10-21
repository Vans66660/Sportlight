Component({
  properties: {
    guideKey: { type: String, value: '' },
    title: { type: String, value: '使用提示' },
    content: { type: String, value: '' }
  },

  data: {
    visible: false
  },

  lifetimes: {
    attached() {
      this.syncVisibility()
    }
  },

  observers: {
    guideKey() {
      this.syncVisibility()
    }
  },

  methods: {
    syncVisibility() {
      const guideKey = this.data.guideKey
      if (!guideKey) return
      this.setData({ visible: !wx.getStorageSync(`pageGuideSeen:${guideKey}`) })
    },

    dismiss() {
      const guideKey = this.data.guideKey
      if (guideKey) wx.setStorageSync(`pageGuideSeen:${guideKey}`, true)
      this.setData({ visible: false })
    }
  }
})
