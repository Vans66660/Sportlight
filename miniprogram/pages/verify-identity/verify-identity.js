Page({
  data: {
    realName: '',
    idCard: '',
    loading: false
  },

  onInput(e) {
    const f = e.currentTarget.dataset.field
    const val = f === 'idCard' ? e.detail.value.toUpperCase() : e.detail.value
    this.setData({ [f]: val })
  },

  submit() {
    const { realName, idCard, loading } = this.data
    if (loading) return
    if (!realName || !idCard) return wx.showToast({ title: '请填写完整', icon: 'none' })
    if (idCard.length !== 18) return wx.showToast({ title: '身份证号应为18位', icon: 'none' })

    this.setData({ loading: true })
    wx.showLoading({ title: '核验中...' })
    wx.cloud.callFunction({
      name: 'verifyIdentity',
      data: { realName: realName.trim(), idCard },
      success: (res) => {
        wx.hideLoading()
        this.setData({ loading: false })
        if (res.result && res.result.passed) {
          wx.setStorageSync('_identityVerified', '1')
          wx.setStorageSync('_pendingRealName', realName.trim())
          wx.setStorageSync('_pendingIdCard', idCard)
          wx.showToast({ title: '实名认证成功', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 1500)
        } else {
          wx.showToast({ title: res.result.msg || '姓名与身份证不匹配', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ loading: false })
        wx.showToast({ title: '核验失败，请稍后重试', icon: 'none' })
      }
    })
  }
})
