Page({
  data: {
    loading: true,
    canManage: false,
    activities: [],
    showEditor: false,
    typeOptions: [
      { label: '活动', value: 'activity' },
      { label: '更新公告', value: 'announcement' },
      { label: '公众号转载', value: 'article' },
      { label: '联名合作', value: 'collaboration' }
    ],
    typeIndex: 0,
    form: {
      type: 'activity',
      title: '',
      summary: '',
      content: '',
      cover: '',
      linkUrl: '',
      sourceName: '',
      partnerName: '',
      displayDate: '',
      pinned: false
    },
    uploading: false,
    submitting: false
  },

  onLoad() {
    this.loadActivities()
  },

  onPullDownRefresh() {
    this.loadActivities(() => wx.stopPullDownRefresh())
  },

  loadActivities(done) {
    wx.cloud.callFunction({
      name: 'getActivities',
      data: { includeDrafts: false },
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0) {
          this.setData({
            activities: result.data || [],
            canManage: !!result.canManage,
            loading: false
          })
        } else {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' })
        this.setData({ loading: false })
      },
      complete: () => {
        if (done) done()
      }
    })
  },

  openEditor() {
    this.setData({ showEditor: true })
  },

  closeEditor() {
    if (this.data.submitting) return
    this.setData({ showEditor: false })
  },

  onTypeChange(e) {
    const typeIndex = Number(e.detail.value) || 0
    const type = this.data.typeOptions[typeIndex].value
    this.setData({ typeIndex, 'form.type': type })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onDateChange(e) {
    this.setData({ 'form.displayDate': e.detail.value })
  },

  togglePinned() {
    this.setData({ 'form.pinned': !this.data.form.pinned })
  },

  uploadCover() {
    if (this.data.uploading) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        const ext = (file.tempFilePath.split('.').pop() || 'jpg').toLowerCase()
        this.setData({ uploading: true })
        wx.cloud.uploadFile({
          cloudPath: `activities/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`,
          filePath: file.tempFilePath,
          success: (uploadRes) => {
            this.setData({ 'form.cover': uploadRes.fileID })
          },
          fail: () => wx.showToast({ title: '上传失败', icon: 'none' }),
          complete: () => this.setData({ uploading: false })
        })
      }
    })
  },

  removeCover() {
    this.setData({ 'form.cover': '' })
  },

  submitActivity() {
    if (this.data.submitting) return
    const form = this.data.form
    if (!form.title.trim()) return wx.showToast({ title: '请填写标题', icon: 'none' })
    if (!form.summary.trim() && !form.content.trim()) return wx.showToast({ title: '请填写摘要或正文', icon: 'none' })
    this.setData({ submitting: true })
    wx.cloud.callFunction({
      name: 'saveActivity',
      data: { ...form, status: 'published' },
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0) {
          wx.showToast({ title: '已发布', icon: 'success' })
          this.setData({
            showEditor: false,
            typeIndex: 0,
            form: {
              type: 'activity',
              title: '',
              summary: '',
              content: '',
              cover: '',
              linkUrl: '',
              sourceName: '',
              partnerName: '',
              displayDate: '',
              pinned: false
            }
          })
          this.loadActivities()
        } else {
          wx.showToast({ title: result.msg || '发布失败', icon: 'none' })
        }
      },
      fail: () => wx.showToast({ title: '发布失败', icon: 'none' }),
      complete: () => this.setData({ submitting: false })
    })
  },

  openLink(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' })
    })
  }
})
