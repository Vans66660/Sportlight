const app = getApp()
const security = require('../../utils/security')
const identity = require('../../utils/identity')

Page({
  data: {
    content: '',
    userAvatar: '',
    statusBarHeight: 0,
    images: [],
    visibility: 'public',
    visibilityOptions: [
      { key: 'public', label: '公开' },
      { key: 'friends', label: '好友可见' },
      { key: 'private', label: '仅自己' }
    ],
    uploading: false,
    submitting: false,
    canSubmit: false
  },

  onLoad() {
    const systemInfo = wx.getSystemInfoSync()
    const userAvatar = app.globalData.userPhoto
      || wx.getStorageSync('userPhoto')
      || wx.getStorageSync('avatarUrl')
      || ''
    this.setData({ statusBarHeight: systemInfo.statusBarHeight, userAvatar })
  },

  goBack() {
    wx.navigateBack()
  },

  onContentInput(e) {
    this.setData({
      content: e.detail.value,
      canSubmit: this.canSubmit(e.detail.value, this.data.uploading, this.data.submitting)
    })
  },

  setVisibility(e) {
    this.setData({ visibility: e.currentTarget.dataset.key })
  },

  addImage() {
    const remain = 9 - this.data.images.length
    if (remain <= 0 || this.data.uploading) return
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        this.setData({ uploading: true, canSubmit: false })
        const compressedFiles = await Promise.all(
          res.tempFiles.map(f => security.compressImageForAudit(f.tempFilePath))
        )
        const uploads = compressedFiles.map(filePath =>
          wx.cloud.uploadFile({
            cloudPath: `posts/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
            filePath
          })
        )
        Promise.all(uploads).then(async results => {
          const fileIDs = results.map(r => r.fileID)
          // 图片安全检测
          const safe = await security.checkImages(fileIDs)
          const validIDs = safe ? fileIDs : []
          this.setData({
            images: [...this.data.images, ...validIDs],
            uploading: false,
            canSubmit: this.canSubmit(this.data.content, false, this.data.submitting)
          })
        }).catch(() => {
          this.setData({
            uploading: false,
            canSubmit: this.canSubmit(this.data.content, false, this.data.submitting)
          })
          wx.showToast({ title: '上传失败', icon: 'none' })
        })
      }
    })
  },

  removeImage(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ images: this.data.images.filter((_, i) => i !== index) })
  },

  canSubmit(content, uploading, submitting) {
    return !!(content && content.trim()) && !uploading && !submitting
  },

  submit() {
    identity.ensureVerified(() => this._doSubmit())
  },

  async _doSubmit() {
    const { content, images, uploading, submitting, visibility } = this.data
    if (!content.trim()) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }
    if (uploading || submitting) return

    this.setData({ submitting: true, canSubmit: false })
    wx.showLoading({ title: '发布中...' })
    wx.cloud.callFunction({
      name: 'publishPost',
      data: { content: content.trim(), images, postType: 'normal', visibility },
      success: (res) => {
        wx.hideLoading()
        this.setData({
          submitting: false,
          canSubmit: this.canSubmit(this.data.content, this.data.uploading, false)
        })
        if (res.result.code === 0) {
          wx.showToast({ title: '发布成功', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 800)
        } else {
          wx.showToast({ title: res.result.msg || '发布失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({
          submitting: false,
          canSubmit: this.canSubmit(this.data.content, this.data.uploading, false)
        })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  }
})
