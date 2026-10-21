const app = getApp()
const security = require('../../utils/security')

Page({
  data: {
    bossTypes: [
      { key: 'personal', label: '个人' },
      { key: 'company',  label: '企业' },
      { key: 'club',     label: '俱乐部' }
    ],
    form: {
      logo: '',
      name: '',
      bossType: '',
      city: '',
      phone: '',
      phoneVerified: false,
      description: '',
      realName: '',
      idCard: '',
      receiveMethod: '',
      wxpayBound: false,
      companyName: '',
      creditCode: '',
      license: '',
      legalType: '',
      legalName: '',
      legalIdCard: '',
      agentName: '',
      agentIdCard: '',
      authLetter: '',
      clubType: '',
      clubLogo: ''
    }
  },

  onLoad() {
    wx.cloud.callFunction({
      name: 'getMyProfile',
      success: (res) => {
        if (res.result.code === 0 && res.result.profile) {
          const p = res.result.profile
          this.setData({ form: { ...this.data.form, ...p } })
        }
      }
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onCityChange(e) {
    this.setData({ 'form.city': e.detail.value[1] })
  },

  goAccountSettings() {
    wx.navigateTo({ url: '/pages/account-settings/account-settings' })
  },

  changeLogo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath
        wx.cropImage({
          src: tempPath,
          cropScale: '1:1',
          success: async (cropRes) => {
            const filePath = await security.compressImageForAudit(cropRes.tempFilePath)
            wx.showLoading({ title: '上传中...' })
            wx.cloud.uploadFile({
              cloudPath: 'bosses/' + Date.now() + '.jpg',
              filePath,
              success: async (uploadRes) => {
                wx.hideLoading()
                // 图片安全检测
                const safe = await security.checkImage(uploadRes.fileID)
                if (!safe) return
                this.setData({ 'form.logo': uploadRes.fileID })
              },
              fail: () => {
                wx.hideLoading()
                wx.showToast({ title: '上传失败，请重试', icon: 'none' })
              }
            })
          }
        })
      }
    })
  },

  save() {
    const { name, city } = this.data.form
    if (!name || !city) {
      wx.showToast({ title: '请填写名称和城市', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'saveUser',
      data: {
        userType: 'boss',
        profileData: {
          logo: this.data.form.logo,
          name: this.data.form.name,
          displayName: this.data.form.name,
          city: this.data.form.city,
          description: this.data.form.description
        }
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          wx.showToast({ title: '保存成功', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 1500)
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
