const security = require('../../utils/security')

Page({
  data: {
    sports: ['篮球', '足球', '羽毛球'],
    sportIndex: 0,
    honorInput: '',
    currentTier: '',
    tierClass: 'tier-D',
    levelReviewStatus: '',

    showLevelPicker: false,
    tierOptions: ['D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+'],
    selectedTier: '',
    levelNote: '',
    levelProofs: [],
    levelUploading: 0,
    submittingLevel: false,
    form: {
      photo: '',
      name: '',
      nickname: '',
      gender: '',
      sport: '',
      position: '',
      height: '',
      weight: '',
      wingspan: '',
      preferredFoot: '',
      preferredHand: '',
      city: '',
      phone: '',
      phoneVerified: false,
      affiliation: '',
      acceptMatch: true,
      matchPrice: 0,
      videoUploaded: false,
      videoName: '',
      videoFile: '',
      certUploaded: false,
      certName: '',
      certFiles: [],
      honors: []
    }
  },

  onLoad(options) {
    const form = wx.getStorageSync('editProfileForm')
    if (form) {
      this.applyProfile(form)
    }
    this.loadProfile()
  },

  applyProfile(profile) {
    const nextForm = {
      ...this.data.form,
      ...(profile || {}),
      acceptAd: false,
      adPrice: 0,
      socials: []
    }
    const sportIndex = Math.max(0, this.data.sports.indexOf(nextForm.sport))
    this.setData({ form: nextForm, sportIndex })
  },

  loadProfile() {
    wx.cloud.callFunction({
      name: 'getMyProfile',
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0 && result.profile) {
          this.applyProfile(result.profile)
          wx.setStorageSync('editProfileForm', result.profile)
          this.setData({
            currentTier: result.profile.currentTier || result.profile.rank || 'D',
            levelReviewStatus: result.profile.levelReviewStatus || 'none',
            tierClass: 'tier-' + (result.profile.currentTier || result.profile.rank || 'D').replace('+', 'plus')
          })
        }
      }
    })
  },

  openLevelPicker() {
    if (this.data.levelReviewStatus === 'pending') {
      wx.showToast({ title: '已有审核在处理中', icon: 'none' })
      return
    }
    this.setData({ showLevelPicker: true, selectedTier: '', levelNote: '', levelProofs: [] })
  },

  closeLevelPicker() {
    this.setData({ showLevelPicker: false })
  },

  selectTier(e) {
    this.setData({ selectedTier: e.currentTarget.dataset.tier })
  },

  onLevelNoteInput(e) {
    this.setData({ levelNote: e.detail.value })
  },

  uploadLevelProof() {
    const remaining = 6 - (this.data.levelProofs || []).length
    if (remaining <= 0) {
      wx.showToast({ title: '最多上传6张', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        const tempPaths = []
        for (const f of res.tempFiles) {
          const compressed = await security.compressImageForAudit(f.tempFilePath)
          tempPaths.push(compressed)
        }
        const proofs = [...this.data.levelProofs, ...tempPaths]
        this.setData({ levelProofs: proofs })

        for (let i = 0; i < tempPaths.length; i++) {
          const tempPath = tempPaths[i]
          const ext = (tempPath.split('.').pop() || 'jpg').toLowerCase()
          this.setData({ levelUploading: this.data.levelUploading + 1 })
          wx.cloud.uploadFile({
            cloudPath: `level-reviews/${Date.now()}_${i}.${ext}`,
            filePath: tempPath,
            success: (uploadRes) => {
              const images = [...this.data.levelProofs]
              const pos = images.indexOf(tempPath)
              if (pos !== -1) images[pos] = uploadRes.fileID
              this.setData({ levelProofs: images })
            },
            fail: () => {
              wx.showToast({ title: '图片上传失败', icon: 'none' })
              const images = this.data.levelProofs.filter(p => p !== tempPath)
              this.setData({ levelProofs: images })
            },
            complete: () => {
              this.setData({ levelUploading: Math.max(0, this.data.levelUploading - 1) })
            }
          })
        }
      }
    })
  },

  removeLevelProof(e) {
    const idx = e.currentTarget.dataset.index
    const proofs = [...this.data.levelProofs]
    proofs.splice(idx, 1)
    this.setData({ levelProofs: proofs })
  },

  submitLevelReview() {
    const { selectedTier, submittingLevel, levelNote } = this.data
    if (submittingLevel) return
    if (!selectedTier) {
      wx.showToast({ title: '请选择目标段位', icon: 'none' })
      return
    }
    if (this.data.levelUploading > 0) {
      wx.showToast({ title: '图片上传中，请稍候', icon: 'none' })
      return
    }
    const proofImages = (this.data.levelProofs || []).filter(p => String(p).startsWith('cloud://'))
    this.setData({ submittingLevel: true })
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'submitLevelReview',
      data: { proposedTier: selectedTier, note: levelNote, proofImages },
      success: (res) => {
        wx.hideLoading()
        this.setData({ submittingLevel: false })
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '已提交审核申请', icon: 'success' })
          this.setData({ showLevelPicker: false, levelReviewStatus: 'pending' })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '提交失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ submittingLevel: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  fileName(path, fallback) {
    const text = String(path || '')
    const name = text.split('/').pop()
    return name || fallback
  },

  onCityChange(e) {
    this.setData({ 'form.city': e.detail.value[1] })
  },

  setGender(e) {
    this.setData({ 'form.gender': e.currentTarget.dataset.val })
  },

  setFoot(e) {
    this.setData({ 'form.preferredFoot': e.currentTarget.dataset.val })
  },

  setHand(e) {
    this.setData({ 'form.preferredHand': e.currentTarget.dataset.val })
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
        wx.cropImage({
          src: tempPath,
          cropScale: '3:4',
          success: async (cropRes) => {
            const filePath = await security.compressImageForAudit(cropRes.tempFilePath)
            wx.showLoading({ title: '上传中...' })
            const cloudPath = `athletes/${Date.now()}.jpg`
            wx.cloud.uploadFile({
              cloudPath,
              filePath,
              success: async (uploadRes) => {
                wx.hideLoading()
                // 图片安全检测
                const safe = await security.checkImage(uploadRes.fileID)
                if (!safe) return
                this.setData({ 'form.photo': uploadRes.fileID })
              },
              fail: () => {
                wx.hideLoading()
                wx.showToast({ title: '上传失败', icon: 'none' })
              }
            })
          }
        })
      }
    })
  },

  uploadVideoProof() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        const upload = (filePath) => {
          const ext = (filePath.split('.').pop() || 'mp4').toLowerCase()
          wx.showLoading({ title: '上传中...' })
          wx.cloud.uploadFile({
            cloudPath: `athlete-proofs/videos/${Date.now()}.${ext}`,
            filePath,
            success: (uploadRes) => {
              wx.hideLoading()
              this.setData({
                'form.videoUploaded': true,
                'form.videoName': this.fileName(file.tempFilePath, '比赛/训练视频'),
                'form.videoFile': uploadRes.fileID
              })
              wx.showToast({ title: '视频已上传', icon: 'success' })
            },
            fail: () => {
              wx.hideLoading()
              wx.showToast({ title: '上传失败', icon: 'none' })
            }
          })
        }
        wx.compressVideo({
          src: file.tempFilePath,
          quality: 'medium',
          success: (compressRes) => upload(compressRes.tempFilePath),
          fail: () => upload(file.tempFilePath)
        })
      }
    })
  },

  uploadCertProof() {
    wx.chooseMedia({
      count: 3,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        wx.showLoading({ title: '上传中...' })
        try {
          const uploads = []
          for (let i = 0; i < res.tempFiles.length; i++) {
            const compressed = await security.compressImageForAudit(res.tempFiles[i].tempFilePath)
            const ext = (compressed.split('.').pop() || 'jpg').toLowerCase()
            const up = await wx.cloud.uploadFile({
              cloudPath: `athlete-proofs/certs/${Date.now()}_${i}.${ext}`,
              filePath: compressed
            })
            const safe = await security.checkImage(up.fileID)
            if (safe) uploads.push(up.fileID)
          }
          wx.hideLoading()
          if (!uploads.length) return
          this.setData({
            'form.certUploaded': true,
            'form.certName': uploads.length > 1 ? `已上传${uploads.length}张` : '已上传证书/成绩',
            'form.certFiles': uploads
          })
          wx.showToast({ title: '资料已上传', icon: 'success' })
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },

  saveProfile() {
    const form = this.data.form
    if (form.sport === '篮球' && !(form.height && form.weight && form.wingspan && form.preferredHand)) {
      wx.showToast({ title: '请完善篮球体测信息', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中...' })
    const profileData = {
      ...this.data.form,
      acceptAd: false,
      adPrice: 0,
      socials: []
    }
    wx.cloud.callFunction({
      name: 'updateProfile',
      data: { profileData },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          wx.setStorageSync('editProfileForm', profileData)
          wx.showToast({ title: '保存成功', icon: 'success' })
          setTimeout(() => {
            wx.navigateBack()
          }, 1500)
        } else {
          wx.showToast({ title: res.result.msg || '保存失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  onHonorInput(e) {
    this.setData({ honorInput: e.detail.value })
  },

  addHonor() {
    const text = this.data.honorInput.trim()
    if (!text) return
    if (this.data.form.honors.length >= 10) {
      wx.showToast({ title: '最多添加10条', icon: 'none' })
      return
    }
    const honors = [...this.data.form.honors, text]
    this.setData({ 'form.honors': honors, honorInput: '' })
  },

  removeHonor(e) {
    const idx = e.currentTarget.dataset.index
    const honors = [...this.data.form.honors]
    honors.splice(idx, 1)
    this.setData({ 'form.honors': honors })
  },

  goAccountSettings() {
    wx.navigateTo({ url: '/pages/account-settings/account-settings' })
  },

  goBack() {
    wx.navigateBack()
  }
})
