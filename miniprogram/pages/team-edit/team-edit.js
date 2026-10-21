const identity = require('../../utils/identity')

Page({
  data: {
    teamId: '',
    form: {
      name: '',
      sport: '足球',
      logo: '',
      cover: '',
      gallery: [],
      description: '',
      recruitmentStatus: 'open'
    },
    sportOptions: ['足球', '篮球', '羽毛球'],
    venues: [],
    selectedVenueIds: [],
    loadingVenues: true
  },

  onLoad(options) {
    this.setData({ teamId: options.teamId || '' })
    this.loadVenues()
    if (options.teamId) this.loadTeam(options.teamId)
  },

  loadTeam(teamId) {
    wx.cloud.callFunction({
      name: 'getTeamDetail',
      data: { teamId },
      success: res => {
        const team = ((res.result || {}).data) || {}
        this.setData({
          form: {
            name: team.name || '',
            sport: team.sport || '足球',
            logo: team.logo || '',
            cover: team.cover || '',
            gallery: team.gallery || [],
            description: team.description || '',
            recruitmentStatus: team.recruitmentStatus || 'open'
          },
          selectedVenueIds: team.venueIds || (team.venues || []).map(v => v.venueId)
        }, () => this.syncVenueSelected())
      }
    })
  },

  loadVenues() {
    wx.cloud.callFunction({
      name: 'getApprovedVenues',
      success: res => {
        const venues = ((res.result || {}).data || []).map(item => ({ ...item, selected: false }))
        this.setData({ venues, loadingVenues: false }, () => this.syncVenueSelected())
      },
      fail: () => this.setData({ loadingVenues: false })
    })
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value })
  },

  setSport(e) {
    this.setData({ 'form.sport': e.currentTarget.dataset.value })
  },

  setRecruit(e) {
    this.setData({ 'form.recruitmentStatus': e.currentTarget.dataset.value })
  },

  chooseLogo() {
    this.chooseAndUpload('logo', 1)
  },

  chooseCover() {
    this.chooseAndUpload('cover', 1)
  },

  chooseGallery() {
    const remain = 9 - (this.data.form.gallery || []).length
    if (remain <= 0) return wx.showToast({ title: '相册最多9张', icon: 'none' })
    this.chooseAndUpload('gallery', remain)
  },

  chooseAndUpload(field, count) {
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      success: res => {
        wx.showLoading({ title: '上传中...' })
        const uploads = (res.tempFiles || []).map(file => {
          const ext = (file.tempFilePath.match(/\.\w+$/) || ['.jpg'])[0]
          return wx.cloud.uploadFile({ cloudPath: `teams/${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`, filePath: file.tempFilePath })
        })
        Promise.all(uploads).then(files => {
          wx.hideLoading()
          const ids = files.map(item => item.fileID)
          if (field === 'gallery') this.setData({ 'form.gallery': [...this.data.form.gallery, ...ids].slice(0, 9) })
          else this.setData({ [`form.${field}`]: ids[0] || '' })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '上传失败', icon: 'none' })
        })
      }
    })
  },

  removeGallery(e) {
    const gallery = [...this.data.form.gallery]
    gallery.splice(e.currentTarget.dataset.index, 1)
    this.setData({ 'form.gallery': gallery })
  },

  toggleVenue(e) {
    const id = e.currentTarget.dataset.id
    const selected = [...this.data.selectedVenueIds]
    const index = selected.indexOf(id)
    if (index >= 0) selected.splice(index, 1)
    else {
      if (selected.length >= 3) return wx.showToast({ title: '最多选择3个常驻球馆', icon: 'none' })
      selected.push(id)
    }
    this.setData({ selectedVenueIds: selected }, () => this.syncVenueSelected())
  },

  syncVenueSelected() {
    const selected = this.data.selectedVenueIds || []
    this.setData({
      venues: (this.data.venues || []).map(item => ({ ...item, selected: selected.includes(item._id) }))
    })
  },

  submit() {
    identity.ensureVerified(() => this._doSubmit())
  },

  _doSubmit() {
    const { form, selectedVenueIds, teamId } = this.data
    if (!form.name.trim()) return wx.showToast({ title: '请填写球队名称', icon: 'none' })
    if (!form.logo) return wx.showToast({ title: '请上传队徽', icon: 'none' })
    if (!form.cover) return wx.showToast({ title: '请上传封面照', icon: 'none' })
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'saveTeam',
      data: { teamId, ...form, venueIds: selectedVenueIds },
      success: res => {
        wx.hideLoading()
        const result = res.result || {}
        if (result.code === 0) {
          wx.showToast({ title: '已保存', icon: 'success' })
          setTimeout(() => wx.redirectTo({ url: `/pages/team-home/team-home?teamId=${result.teamId || teamId}` }), 500)
        } else wx.showToast({ title: result.msg || '保存失败', icon: 'none' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
  }
})
