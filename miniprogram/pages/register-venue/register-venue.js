const security = require('../../utils/security')

Page({
  data: {
    step: 1,
    canNext1: false,
    canNext2: false,
    canSubmit: false,
    venueTypes: ['篮球馆', '足球场', '羽毛球馆', '综合场馆'],
    sportOptions: [
      { label: '篮球', selected: false },
      { label: '足球', selected: false },
      { label: '羽毛球', selected: false }
    ],
    courtTypeOptions: [
      { label: '篮球全场', selected: false, count: '' },
      { label: '篮球半场', selected: false, count: '' },
      { label: '足球5人制', selected: false, count: '' },
      { label: '足球7人制', selected: false, count: '' },
      { label: '足球11人制', selected: false, count: '' },
      { label: '羽毛球场', selected: false, count: '' }
    ],
    form: {
      name: '',
      venueType: '',
      city: '',
      address: '',
      latitude: '',
      longitude: '',
      locationName: '',
      sports: [],
      courtTypes: [],
      courtCounts: {},
      openingStart: '',
      openingEnd: '',
      coverImage: '',
      galleryImages: [],
      operatorName: '',
      phone: '',
      purePhoneNumber: '',
      countryCode: '',
      phoneVerified: false,
      licenseImages: [],
      description: ''
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    const value = field === 'name' ? String(e.detail.value || '').trimStart() : e.detail.value
    this.setData({ [`form.${field}`]: value }, () => this.checkAll())
  },

  setVenueType(e) {
    this.setData({ 'form.venueType': e.currentTarget.dataset.value }, () => this.checkAll())
  },

  toggleSport(e) {
    const value = e.currentTarget.dataset.value
    const sportOptions = this.data.sportOptions.map(item => (
      item.label === value ? { ...item, selected: !item.selected } : item
    ))
    const sports = sportOptions.filter(item => item.selected).map(item => item.label)
    this.setData({ sportOptions, 'form.sports': sports }, () => this.checkAll())
  },

  toggleCourtType(e) {
    const value = e.currentTarget.dataset.value
    const courtTypeOptions = this.data.courtTypeOptions.map(item => (
      item.label === value ? { ...item, selected: !item.selected, count: item.selected ? '' : item.count } : item
    ))
    const courtTypes = courtTypeOptions.filter(item => item.selected).map(item => item.label)
    const courtCounts = {}
    courtTypeOptions.forEach(item => {
      if (item.selected && item.count) courtCounts[item.label] = item.count
    })
    this.setData({ courtTypeOptions, 'form.courtTypes': courtTypes, 'form.courtCounts': courtCounts }, () => this.checkAll())
  },

  onCourtCountInput(e) {
    const type = e.currentTarget.dataset.type
    const value = e.detail.value
    const courtTypeOptions = this.data.courtTypeOptions.map(item => (
      item.label === type ? { ...item, count: value } : item
    ))
    this.setData({ courtTypeOptions, [`form.courtCounts.${type}`]: value }, () => this.checkAll())
  },

  onOpeningStartChange(e) {
    this.setData({ 'form.openingStart': e.detail.value }, () => this.checkAll())
  },

  onOpeningEndChange(e) {
    this.setData({ 'form.openingEnd': e.detail.value }, () => this.checkAll())
  },

  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          'form.address': res.address || res.name || this.data.form.address,
          'form.locationName': res.name || '',
          'form.latitude': res.latitude,
          'form.longitude': res.longitude
        }, () => this.checkAll())
      },
      fail: () => {
        wx.showToast({ title: '请在地图上选择球馆位置', icon: 'none' })
      }
    })
  },

  async uploadImage(folder, field, maxCount) {
    const current = this.data.form[field] || []
    const count = field === 'coverImage' ? 1 : Math.max(1, maxCount - current.length)
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      success: async (res) => {
        wx.showLoading({ title: '上传中...' })
        try {
          const uploads = []
          for (let i = 0; i < res.tempFiles.length; i++) {
            const compressed = await security.compressImageForAudit(res.tempFiles[i].tempFilePath)
            const ext = (compressed.split('.').pop() || 'jpg').toLowerCase()
            const up = await wx.cloud.uploadFile({
              cloudPath: `${folder}/${Date.now()}_${i}.${ext}`,
              filePath: compressed
            })
            const safe = await security.checkImage(up.fileID)
            if (safe) uploads.push(up.fileID)
          }
          wx.hideLoading()
          if (field === 'coverImage') {
            this.setData({ 'form.coverImage': uploads[0] || '' }, () => this.checkAll())
          } else {
            this.setData({ [`form.${field}`]: current.concat(uploads).slice(0, maxCount) }, () => this.checkAll())
          }
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },

  uploadCover() {
    this.uploadImage('venues/covers', 'coverImage', 1)
  },

  uploadGallery() {
    this.uploadImage('venues/gallery', 'galleryImages', 9)
  },

  uploadLicense() {
    this.uploadImage('venues/licenses', 'licenseImages', 3)
  },

  removeGallery(e) {
    const index = e.currentTarget.dataset.index
    const galleryImages = this.data.form.galleryImages.filter((_, i) => i !== index)
    this.setData({ 'form.galleryImages': galleryImages }, () => this.checkAll())
  },

  removeLicense(e) {
    const index = e.currentTarget.dataset.index
    const licenseImages = this.data.form.licenseImages.filter((_, i) => i !== index)
    this.setData({ 'form.licenseImages': licenseImages }, () => this.checkAll())
  },

  bindPhone(e) {
    const { errMsg, code } = e.detail || {}
    if (!errMsg || !errMsg.includes('ok')) return wx.showToast({ title: '请完成手机号验证', icon: 'none' })
    if (!code) return wx.showToast({ title: '版本不支持', icon: 'none' })
    wx.showLoading({ title: '绑定中...' })
    wx.cloud.callFunction({
      name: 'bindPhone',
      data: { code },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          this.setData({
            'form.phone': res.result.phone || '',
            'form.purePhoneNumber': res.result.purePhoneNumber || '',
            'form.countryCode': res.result.countryCode || '',
            'form.phoneVerified': true
          }, () => this.checkAll())
          wx.showToast({ title: '已绑定', icon: 'success' })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '绑定失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  checkAll() {
    const f = this.data.form
    const canNext1 = !!(String(f.name || '').trim() && f.venueType && f.address && f.latitude && f.longitude)
    const courtCountsOk = f.courtTypes.length > 0 && f.courtTypes.every(type => Number(f.courtCounts[type]) > 0)
    const canNext2 = !!(f.sports.length && courtCountsOk && f.openingStart && f.openingEnd && f.coverImage)
    const canSubmit = !!(canNext1 && canNext2 && f.operatorName && f.phoneVerified)
    this.setData({ canNext1, canNext2, canSubmit })
  },

  nextStep() {
    const { step, canNext1, canNext2 } = this.data
    if (step === 1 && !canNext1) return
    if (step === 2 && !canNext2) return
    this.setData({ step: step + 1 })
  },

  prevStep() {
    this.setData({ step: Math.max(1, this.data.step - 1) })
  },

  finish() {
    if (!this.data.canSubmit) return
    const f = this.data.form
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'saveUser',
      data: {
        userType: 'venue',
        profileData: {
          ...f
        }
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          const app = getApp()
          if (typeof app.completeRegistration === 'function') {
            app.completeRegistration('venue')
          }
          wx.redirectTo({ url: '/pages/venue-manage/venue-manage' })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '提交失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  goBack() {
    if (this.data.step > 1) {
      this.prevStep()
      return
    }
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/market/market' })
    }
  }
})
