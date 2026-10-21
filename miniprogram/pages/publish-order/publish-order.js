const security = require('../../utils/security')
const identity = require('../../utils/identity')

Page({
  data: {
    orderType: '',
    sports: ['篮球', '足球', '羽毛球'],
    footballPositions: ['边锋', '中锋', '前腰', '后腰', '边后卫', '中后卫', '门将'],
    basketballPositions: ['控球后卫', '得分后卫', '小前锋', '大前锋', '中锋'],
    badmintonPositions: ['男单', '女单', '男双', '女双', '混双'],
    positionOptions: [],
    sportIndex: 0,
    rankOptions: ['不限', 'D-及以上', 'D及以上', 'D+及以上', 'C-及以上', 'C及以上', 'C+及以上', 'B-及以上', 'B及以上', 'B+及以上', 'A-及以上', 'A及以上', 'A+及以上', 'S-及以上', 'S及以上', 'S+'],
    canPublish: false,
    uploading: 0,
    publishing: false,
    form: {
      sport: '',
      startDate: '',
      endDate: '',
      location: '',
      locationName: '',
      latitude: null,
      longitude: null,
      rankReq: '不限',
      playerRequirements: [],
      price: '',
      mode: 'apply',
      expireDate: '',
      remark: '',
      promoImages: [],
      teamName: '',
    }
  },

  setType(e) {
    const type = e.currentTarget.dataset.type
    if (type !== 'match') {
      wx.showToast({ title: '该类型暂未开放', icon: 'none' })
      return
    }
    this.setData({ orderType: type }, () => {
      this.checkCanPublish()
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value }, () => {
      this.checkCanPublish()
    })
  },

  onSportChange(e) {
    const sport = this.data.sports[e.detail.value]
    this.setData({
      sportIndex: e.detail.value,
      'form.sport': sport,
      'form.playerRequirements': [],
      positionOptions: this.getPositionOptions(sport).map(position => ({ position, selected: false }))
    }, () => { this.checkCanPublish() })
  },

  onStartDateChange(e) {
    const startDate = e.detail.value
    const updates = { 'form.startDate': startDate }
    if (this.data.form.endDate && this.data.form.endDate < startDate) {
      updates['form.endDate'] = ''
    }
    this.setData(updates, () => {
      this.checkCanPublish()
    })
  },

  onEndDateChange(e) {
    this.setData({ 'form.endDate': e.detail.value }, () => {
      this.checkCanPublish()
    })
  },

  onExpireChange(e) {
    this.setData({ 'form.expireDate': e.detail.value })
  },

  setRankReq(e) {
    this.setData({ 'form.rankReq': e.currentTarget.dataset.rank })
  },

  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        const name = res.name || ''
        const address = res.address || ''
        const location = name && address && !address.includes(name)
          ? `${name} · ${address}`
          : (name || address)
        this.setData({
          'form.location': location,
          'form.locationName': name || address,
          'form.latitude': res.latitude,
          'form.longitude': res.longitude
        }, () => this.checkCanPublish())
      },
      fail: (err) => {
        const msg = err && err.errMsg ? err.errMsg : ''
        if (msg.includes('auth deny') || msg.includes('authorize')) {
          wx.showToast({ title: '请授权位置后选择地点', icon: 'none' })
        }
      }
    })
  },

  getPositionOptions(sport) {
    if (sport === '足球') return this.data.footballPositions
    if (sport === '篮球') return this.data.basketballPositions
    if (sport === '羽毛球') return this.data.badmintonPositions
    return []
  },

  isPositionSelected(position) {
    return (this.data.form.playerRequirements || []).some(item => item.position === position)
  },

  toggleRequirement(e) {
    const position = e.currentTarget.dataset.position
    if (!position) return
    const list = [...(this.data.form.playerRequirements || [])]
    const idx = list.findIndex(item => item.position === position)
    if (idx >= 0) {
      list.splice(idx, 1)
    } else {
      list.push({ position, count: 1 })
    }
    const selectedMap = {}
    list.forEach(item => { selectedMap[item.position] = true })
    this.setData({
      'form.playerRequirements': list,
      positionOptions: this.data.positionOptions.map(item => ({
        ...item,
        selected: !!selectedMap[item.position]
      }))
    }, () => this.checkCanPublish())
  },

  onRequirementCountInput(e) {
    const index = e.currentTarget.dataset.index
    const count = Math.max(0, parseInt(e.detail.value, 10) || 0)
    const list = [...(this.data.form.playerRequirements || [])]
    if (!list[index]) return
    list[index] = { ...list[index], count }
    this.setData({ 'form.playerRequirements': list }, () => this.checkCanPublish())
  },

  hasValidRequirements(requirements) {
    return (requirements || []).some(item => item.position && Number(item.count) > 0)
  },

  formatRequirements(requirements) {
    return (requirements || [])
      .filter(item => item.position && Number(item.count) > 0)
      .map(item => `${item.position}${Number(item.count)}人`)
      .join('、')
  },

  setMode(e) {
    this.setData({ 'form.mode': e.currentTarget.dataset.mode }, () => {
      this.checkCanPublish()
    })
  },

  checkCanPublish() {
    const { orderType, form } = this.data
    let can = false
    if (orderType === 'match') {
      can = !!(form.sport && form.startDate && form.endDate && form.location && form.price && this.hasValidRequirements(form.playerRequirements))
    }
    this.setData({ canPublish: can })
  },

  publishOrder() {
    identity.ensureVerified(() => this._doPublishOrder())
  },

  async _doPublishOrder() {
    if (this.data.publishing) return
    if (!this.data.canPublish) {
      wx.showToast({ title: '请先完整填写比赛信息、地点、报酬和球员需求', icon: 'none' })
      return
    }
    if (this.data.uploading > 0) {
      wx.showToast({ title: '图片上传中，请稍候', icon: 'none' })
      return
    }
    const { orderType, form } = this.data

    // 文本内容安全检测
    if (orderType !== 'match') {
      wx.showToast({ title: '该类型暂未开放', icon: 'none' })
      return
    }

    const requirementSummary = this.formatRequirements(form.playerRequirements)
    const textToCheck = [form.remark, requirementSummary, form.location].filter(Boolean).join(' ')
    if (textToCheck) {
      wx.showLoading({ title: '检测中...' })
      let textSafe = false
      try {
        textSafe = await security.checkText(textToCheck)
      } finally {
        wx.hideLoading()
      }
      if (!textSafe) return
    }
  
    wx.showModal({
      title: '确认发布',
      content: `报酬 ¥${form.price}，锁单时触发平台担保支付`,
      confirmText: '确认发布',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (res.confirm) {
          this.setData({ publishing: true })
          wx.showLoading({ title: '发布中...' })
  
          const orderData = {
            type: orderType,
            title: `${form.sport} · ${form.locationName || form.location}`,
            sport: form.sport,
            price: parseInt(form.price) || 0,
            mode: form.mode,
            rankReq: form.rankReq,
            playerRequirements: (form.playerRequirements || []).filter(item => item.position && Number(item.count) > 0),
            skillTags: requirementSummary,
            remark: form.remark,
            expireDate: form.expireDate,
            city: form.locationName || form.location || '全国',
            date: form.startDate || '',
            startDate: form.startDate || '',
            endDate: form.endDate || '',
            dateRange: form.startDate === form.endDate ? form.startDate : `${form.startDate} 至 ${form.endDate}`,
            location: form.location || '',
            locationName: form.locationName || '',
            latitude: form.latitude,
            longitude: form.longitude,
            promoImages: (form.promoImages || []).filter(p => p.startsWith('cloud://')),
            teamName: (form.teamName || '').trim(),
          }
  
          wx.cloud.callFunction({
            name: 'publishOrder',
            data: { orderData },
            success: (res) => {
              wx.hideLoading()
              this.setData({ publishing: false })
              const result = res.result || {}
              if (result.code === 0) {
                wx.showToast({ title: '发布成功', icon: 'success', duration: 900 })
                setTimeout(() => {
                  wx.setStorageSync('bossManageTab', 'orders')
                  wx.switchTab({ url: '/pages/my-orders/my-orders' })
                }, 500)
              } else {
                wx.showToast({ title: result.msg || '发布失败，请重试', icon: 'none' })
              }
            },
            fail: (err) => {
              wx.hideLoading()
              this.setData({ publishing: false })
              wx.showToast({ title: '网络错误，请重试', icon: 'none' })
              console.error(err)
            }
          })
        }
      }
    })
  },
  
  uploadPromoImage() {
    const remaining = 6 - this.data.form.promoImages.length
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      success: async (res) => {
        const tempPaths = await Promise.all(
          res.tempFiles.map(f => security.compressImageForAudit(f.tempFilePath))
        )
        // 先本地预览，逐个上传替换为 cloud:// fileID
        const current = [...this.data.form.promoImages, ...tempPaths]
        this.setData({ 'form.promoImages': current })

        tempPaths.forEach((tempPath, i) => {
          const ext = tempPath.split('.').pop() || 'jpg'
          this.setData({ uploading: this.data.uploading + 1 })
          wx.cloud.uploadFile({
            cloudPath: 'promo/' + Date.now() + '_' + i + '.' + ext,
            filePath: tempPath,
            success: async (uploadRes) => {
              // 图片安全检测
              const safe = await security.checkImage(uploadRes.fileID)
              if (!safe) {
                const images = this.data.form.promoImages.filter(p => p !== tempPath)
                this.setData({ 'form.promoImages': images })
                return
              }
              const images = [...this.data.form.promoImages]
              const pos = images.indexOf(tempPath)
              if (pos !== -1) {
                images[pos] = uploadRes.fileID
                this.setData({ 'form.promoImages': images })
              }
            },
            fail: () => {
              wx.showToast({ title: '图片上传失败', icon: 'none' })
              const images = this.data.form.promoImages.filter(p => p !== tempPath)
              this.setData({ 'form.promoImages': images })
            },
            complete: () => {
              this.setData({ uploading: Math.max(0, this.data.uploading - 1) })
            }
          })
        })
      }
    })
  },

  removePromoImage(e) {
    const idx = e.currentTarget.dataset.index
    const images = [...this.data.form.promoImages]
    images.splice(idx, 1)
    this.setData({ 'form.promoImages': images })
  },

  goBack() {
    wx.navigateBack()
  }
})
