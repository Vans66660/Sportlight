Page({
  data: {
    sports: ['篮球', '足球', '羽毛球', '乒乓球', '游泳', '田径', '格斗/MMA', '拳击', '电竞', '其他'],
    sportIndex: 0,
    form: {
      photo: '',
      name: '',
      sport: '',
      position: '',
      city: '',
      affiliation: '',
      acceptMatch: true,
      acceptAd: false,
      matchPrice: 0,
      adPrice: 0
    }
  },

  onLoad(options) {
    const form = wx.getStorageSync('editProfileForm')
    if (form) {
      this.setData({
        form: {
          ...form,
          acceptAd: false,
          adPrice: 0,
          socials: []
        }
      })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onCityChange(e) {
    this.setData({ 'form.city': e.detail.value[1] })
  },

  onSportChange(e) {
    const index = e.detail.value
    this.setData({
      sportIndex: index,
      'form.sport': this.data.sports[index]
    })
  },

  toggleType(e) {
    const type = e.currentTarget.dataset.type
    this.setData({ [`form.${type}`]: !this.data.form[type] })
  },

  changePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath
        const cloudPath = `athletes/${Date.now()}.jpg`
        wx.showLoading({ title: '上传中...' })
        wx.cloud.uploadFile({
          cloudPath,
          filePath: tempPath,
          success: (uploadRes) => {
            wx.hideLoading()
            this.setData({ 'form.photo': uploadRes.fileID })
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '上传失败', icon: 'none' })
          }
        })
      }
    })
  },

  saveProfile() {
    const profileData = {
      ...this.data.form,
      acceptAd: false,
      adPrice: 0,
      socials: []
    }
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'updateProfile',
      data: { profileData },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          wx.showToast({ title: '保存成功', icon: 'success' })
          setTimeout(() => {
            wx.navigateBack()
          }, 1500)
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
