const security = require('../../utils/security')
const identity = require('../../utils/identity')

Page({
  data: {
    editMode: false,
    postId: '',
    banner: '',
    bannerUploading: false,
    captainGroupQr: '',
    qrUploading: false,
    title: '',
    content: '',
    sport: '',
    sports: ['篮球', '足球', '羽毛球'],
    eventData: {
      date: '',
      startDate: '',
      endDate: '',
      location: '',
      format: '',
      registrationMode: 'both',
      teamSize: '',
      teamSizeLabel: '',
      customTeamSize: '',
      matchDuration: '90',
      halfDuration: '45',
      maxTeamMembers: '',
      maxTeams: '',
      registrationDeadline: '',
      entryFee: '',
      basketballConfig: {
        matchStructure: '4节',
        periodLength: '10分钟',
        overtime: '5分钟',
        courtType: '全场',
        foulRule: '满5犯离场',
        timeoutRule: '每队2次',
        requireJerseyNumber: true,
        stats: {
          points: true,
          rebounds: true,
          assists: true,
          turnovers: true
        }
      }
    },
    baseFormats: ['小组赛 + 淘汰赛', '双淘汰赛', '单败淘汰赛', '双败淘汰赛', '循环赛', '积分排名赛', '其他'],
    formats: ['小组赛 + 淘汰赛', '双淘汰赛', '单败淘汰赛', '双败淘汰赛', '循环赛', '积分排名赛', '其他'],
    basketballStructures: ['4节', '上下半场', '单节限时'],
    basketballPeriodLengths: ['8分钟', '10分钟', '12分钟'],
    basketballOvertimes: ['无加时', '3分钟', '5分钟'],
    basketballCourtTypes: ['全场', '半场'],
    basketballFoulRules: ['满5犯离场', '满6犯离场', '不限制'],
    basketballTimeoutRules: ['每队1次', '每队2次', '按国际篮联规则'],
    teamSizeOptions: [],
    prizes: [
      { medal: '/images/icons/medal-gold.png', label: '冠军', amount: '' },
      { medal: '/images/icons/medal-silver.png', label: '亚军', amount: '' },
      { medal: '/images/icons/medal-bronze.png', label: '季军', amount: '' }
    ],
    customPrizes: [],
    images: [],
    imagesUploading: false,
    submitting: false
  },

  getDefaultBasketballConfig() {
    return {
      matchStructure: '4节',
      periodLength: '10分钟',
      overtime: '5分钟',
      courtType: '全场',
      foulRule: '满5犯离场',
      timeoutRule: '每队2次',
      requireJerseyNumber: true,
      stats: {
        points: true,
        rebounds: true,
        assists: true,
        turnovers: true
      }
    }
  },

  normalizeBasketballConfig(config = {}) {
    const defaults = this.getDefaultBasketballConfig()
    return {
      ...defaults,
      ...config,
      stats: {
        ...defaults.stats,
        ...(config.stats || {})
      },
      requireJerseyNumber: config.requireJerseyNumber !== undefined ? !!config.requireJerseyNumber : defaults.requireJerseyNumber
    }
  },

  splitEventDateRange(eventDate = '') {
    const text = String(eventDate || '')
    const matches = text.match(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/g) || []
    const normalize = value => value ? value.replace(/\//g, '-') : ''
    return {
      startDate: normalize(matches[0]) || text,
      endDate: normalize(matches[1]) || normalize(matches[0]) || text
    }
  },

  onLoad(options) {
    if (options && options.postId) {
      this.postId = options.postId
      this.setData({ editMode: true, postId: options.postId })
      wx.setNavigationBarTitle({ title: '编辑赛事' })
      this.loadEvent(options.postId)
    }
  },

  loadEvent(postId) {
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getPostDetail',
      data: { postId },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code !== 0) {
          wx.showToast({ title: res.result.msg || '加载失败', icon: 'none' })
          return
        }
        const post = res.result.post || {}
        const sport = post.sport || ''
        const prizes = [
          { medal: '/images/icons/medal-gold.png', label: '冠军', amount: '' },
          { medal: '/images/icons/medal-silver.png', label: '亚军', amount: '' },
          { medal: '/images/icons/medal-bronze.png', label: '季军', amount: '' }
        ]
        const customPrizes = []
        ;(post.prizes || []).forEach(p => {
          const idx = prizes.findIndex(item => item.label === p.label)
          if (idx >= 0) prizes[idx].amount = p.amount
          else customPrizes.push({ label: p.label || '', amount: p.amount || '' })
        })
        const legacyDateRange = this.splitEventDateRange(post.eventDate || '')
        const teamSizeOptions = this.getTeamSizeOptions(sport)
        const teamSizeValue = Number(post.teamSize) || ''
        const isPresetTeamSize = teamSizeOptions.some(item => Number(item.value) === teamSizeValue)
        const customTeamSize = (sport === '足球' || sport === '羽毛球') && teamSizeValue && !isPresetTeamSize ? String(teamSizeValue) : ''
        this.setData({
          banner: post.banner || '',
          captainGroupQr: post.captainGroupQr || '',
          title: post.title || '',
          content: post.content || '',
          sport,
          formats: this.getFormatOptions(sport),
          teamSizeOptions,
          eventData: {
            date: post.eventDate || '',
            startDate: post.eventStartDate || legacyDateRange.startDate || '',
            endDate: post.eventEndDate || post.eventStartDate || legacyDateRange.endDate || '',
            location: post.eventLocation || '',
            format: post.eventFormat || '',
            registrationMode: post.registrationMode || 'both',
            teamSize: teamSizeValue,
            teamSizeLabel: customTeamSize ? `${teamSizeValue}人制` : (post.teamSizeLabel || ''),
            customTeamSize,
            matchDuration: post.matchDuration || '',
            halfDuration: post.halfDuration || '',
            maxTeamMembers: post.maxTeamMembers || '',
            maxTeams: post.maxTeams || '',
            registrationDeadline: post.registrationDeadline || '',
            entryFee: post.entryFee || '',
            basketballConfig: this.normalizeBasketballConfig(post.basketballConfig || {})
          },
          prizes,
          customPrizes,
          images: post.images || []
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  uploadBanner() {
    if (this.data.bannerUploading) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        const filePath = await security.compressImageForAudit(res.tempFiles[0].tempFilePath)
        this.setData({ bannerUploading: true })
        wx.cloud.uploadFile({
          cloudPath: `banners/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
          filePath,
          success: async (r) => {
            // 图片安全检测
            const safe = await security.checkImage(r.fileID)
            this.setData({ banner: safe ? r.fileID : '', bannerUploading: false })
          },
          fail: () => {
            this.setData({ bannerUploading: false })
            wx.showToast({ title: '上传失败', icon: 'none' })
          }
        })
      }
    })
  },

  removeBanner() {
    this.setData({ banner: '' })
  },

  uploadCaptainGroupQr() {
    if (this.data.qrUploading) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        const filePath = await security.compressImageForAudit(res.tempFiles[0].tempFilePath)
        this.setData({ qrUploading: true })
        wx.cloud.uploadFile({
          cloudPath: `posts/captain_qr_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
          filePath,
          success: async (r) => {
            const safe = await security.checkImage(r.fileID)
            this.setData({ captainGroupQr: safe ? r.fileID : '', qrUploading: false })
          },
          fail: (err) => {
            console.error('赛务联系二维码上传失败', err)
            this.setData({ qrUploading: false })
            wx.showToast({ title: '上传失败', icon: 'none' })
          }
        })
      }
    })
  },

  removeCaptainGroupQr() {
    this.setData({ captainGroupQr: '' })
  },

  selectSport(e) {
    const sport = e.currentTarget.dataset.sport
    this.setData({
      sport,
      formats: this.getFormatOptions(sport),
      teamSizeOptions: this.getTeamSizeOptions(sport),
      'eventData.format': '',
      'eventData.teamSize': '',
      'eventData.teamSizeLabel': '',
      'eventData.customTeamSize': '',
      'eventData.matchDuration': sport === '篮球' ? '40' : (sport === '羽毛球' ? '60' : '90'),
      'eventData.halfDuration': sport === '篮球' ? '20' : (sport === '羽毛球' ? '30' : '45'),
      'eventData.basketballConfig': this.normalizeBasketballConfig(this.data.eventData.basketballConfig)
    })
  },

  selectFormat(e) {
    const format = e.currentTarget.dataset.format
    this.setData({ 'eventData.format': format })
  },

  getFormatOptions(sport) {
    const base = this.data.baseFormats || ['小组赛 + 淘汰赛', '双淘汰赛', '单败淘汰赛', '双败淘汰赛', '循环赛', '积分排名赛', '其他']
    return base
  },

  getTeamSizeOptions(sport) {
    const map = {
      '篮球': [
        { label: '三人制', value: 3 },
        { label: '五人制', value: 5 }
      ],
      '足球': [
        { label: '三人制', value: 3 },
        { label: '五人制', value: 5 },
        { label: '七人制', value: 7 },
        { label: '八人制', value: 8 },
        { label: '九人制', value: 9 },
        { label: '十一人制', value: 11 },
        { label: '自定义人制', value: 'custom' }
      ],
      '羽毛球': [
        { label: '单打', value: 1 },
        { label: '双打', value: 2 },
        { label: '团体赛', value: 4 },
        { label: '自定义人制', value: 'custom' }
      ]
    }
    return map[sport] || []
  },

  selectTeamSize(e) {
    const { value, label } = e.currentTarget.dataset
    if (value === 'custom') {
      this.setData({
        'eventData.teamSize': '',
        'eventData.teamSizeLabel': '自定义人制',
        'eventData.customTeamSize': ''
      })
      return
    }
    const next = {
      'eventData.teamSize': value,
      'eventData.teamSizeLabel': label,
      'eventData.customTeamSize': ''
    }
    if (this.data.sport === '篮球' && Number(value) === 3) {
      next['eventData.basketballConfig.courtType'] = '半场'
    }
    this.setData(next)
  },

  onCustomTeamSizeInput(e) {
    const value = String(e.detail.value || '').replace(/[^\d]/g, '')
    const n = parseInt(value)
    this.setData({
      'eventData.customTeamSize': value,
      'eventData.teamSize': n > 0 ? n : '',
      'eventData.teamSizeLabel': n > 0 ? `${n}人制` : '自定义人制'
    })
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onEventInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`eventData.${field}`]: e.detail.value })
  },

  selectBasketballOption(e) {
    const { field, value } = e.currentTarget.dataset
    this.setData({ [`eventData.basketballConfig.${field}`]: value })
  },

  toggleBasketballJersey() {
    this.setData({
      'eventData.basketballConfig.requireJerseyNumber': !this.data.eventData.basketballConfig.requireJerseyNumber
    })
  },

  toggleBasketballStat(e) {
    const key = e.currentTarget.dataset.key
    const current = this.data.eventData.basketballConfig.stats[key]
    this.setData({ [`eventData.basketballConfig.stats.${key}`]: !current })
  },

  formatEventDateRange(startDate, endDate) {
    if (!startDate) return ''
    if (!endDate || endDate === startDate) return startDate
    return `${startDate} 至 ${endDate}`
  },

  onStartDateChange(e) {
    const startDate = e.detail.value
    const next = {
      'eventData.startDate': startDate,
      'eventData.date': this.formatEventDateRange(startDate, this.data.eventData.endDate)
    }
    if (!this.data.eventData.endDate || new Date(this.data.eventData.endDate) < new Date(startDate)) {
      next['eventData.endDate'] = startDate
      next['eventData.date'] = this.formatEventDateRange(startDate, startDate)
    }
    this.setData(next)
  },

  onEndDateChange(e) {
    const endDate = e.detail.value
    this.setData({
      'eventData.endDate': endDate,
      'eventData.date': this.formatEventDateRange(this.data.eventData.startDate, endDate)
    })
  },

  onDeadlineChange(e) {
    this.setData({ 'eventData.registrationDeadline': e.detail.value })
  },

  pickImages() {
    const remaining = 4 - this.data.images.length
    if (remaining <= 0 || this.data.imagesUploading) return
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        this.setData({ imagesUploading: true })
        const compressedFiles = await Promise.all(
          res.tempFiles.map(f => security.compressImageForAudit(f.tempFilePath))
        )
        const uploads = compressedFiles.map(filePath =>
          new Promise((resolve, reject) => {
            wx.cloud.uploadFile({
              cloudPath: `posts/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
              filePath,
              success: r => resolve(r.fileID),
              fail: reject
            })
          })
        )
        Promise.all(uploads)
          .then(async ids => {
            // 图片安全检测
            const safe = await security.checkImages(ids)
            this.setData({ images: [...this.data.images, ...(safe ? ids : [])], imagesUploading: false })
          })
          .catch(() => {
            this.setData({ imagesUploading: false })
            wx.showToast({ title: '上传失败', icon: 'none' })
          })
      }
    })
  },

  removeImage(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ images: this.data.images.filter((_, i) => i !== index) })
  },

  onPrizeInput(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ [`prizes[${index}].amount`]: e.detail.value })
  },

  onCustomLabel(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ [`customPrizes[${index}].label`]: e.detail.value })
  },

  onCustomAmount(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ [`customPrizes[${index}].amount`]: e.detail.value })
  },

  addCustomPrize() {
    const customPrizes = [...this.data.customPrizes, { label: '', amount: '' }]
    this.setData({ customPrizes })
  },

  removeCustomPrize(e) {
    const index = e.currentTarget.dataset.index
    const customPrizes = this.data.customPrizes.filter((_, i) => i !== index)
    this.setData({ customPrizes })
  },

  submit() {
    identity.ensureVerified(() => this._doSubmit())
  },

  async _doSubmit() {
    const { banner, captainGroupQr, title, content, sport, eventData, prizes, customPrizes, images, submitting } = this.data
    if (!banner) return wx.showToast({ title: '请上传赛事横幅', icon: 'none' })
    if (!captainGroupQr) return wx.showToast({ title: '请上传赛务联系二维码', icon: 'none' })
    if (!title.trim()) return wx.showToast({ title: '请填写赛事名称', icon: 'none' })
    if (!content.trim()) return wx.showToast({ title: '请填写赛事介绍', icon: 'none' })
    if (!sport) return wx.showToast({ title: '请选择运动项目', icon: 'none' })
    if (!eventData.startDate) return wx.showToast({ title: '请选择比赛开始日期', icon: 'none' })
    if (!eventData.endDate) return wx.showToast({ title: '请选择比赛结束日期', icon: 'none' })
    if (!eventData.location) return wx.showToast({ title: '请填写比赛地点', icon: 'none' })
    if (!eventData.format) return wx.showToast({ title: '请选择赛制', icon: 'none' })
    if (!eventData.matchDuration || parseInt(eventData.matchDuration) <= 0) return wx.showToast({ title: '请填写比赛总时间', icon: 'none' })
    if (!eventData.halfDuration || parseInt(eventData.halfDuration) <= 0) return wx.showToast({ title: '请填写半场时间', icon: 'none' })
    if (parseInt(eventData.halfDuration) > parseInt(eventData.matchDuration)) return wx.showToast({ title: '半场时间不能大于总时间', icon: 'none' })
    if (!eventData.registrationDeadline) return wx.showToast({ title: '请选择报名截止日期', icon: 'none' })

    // 时间逻辑校验
    const now = new Date()
    const startDate = new Date(eventData.startDate)
    const endDate = new Date(eventData.endDate)
    const deadlineDate = new Date(eventData.registrationDeadline)
    if (deadlineDate <= now) return wx.showToast({ title: '报名截止时间必须晚于当前时间', icon: 'none' })
    if (endDate < startDate) return wx.showToast({ title: '比赛结束日期不能早于开始日期', icon: 'none' })
    if (startDate <= deadlineDate) return wx.showToast({ title: '报名截止日期必须早于比赛开始日期', icon: 'none' })

    if (sport === '篮球') {
      const stats = eventData.basketballConfig && eventData.basketballConfig.stats
      if (!stats || (!stats.points && !stats.rebounds && !stats.assists && !stats.turnovers)) {
        return wx.showToast({ title: '请至少保留一项篮球统计', icon: 'none' })
      }
    }
    if (submitting) return

    // 文本内容安全检测
    wx.showLoading({ title: '检测中...' })
    const textSafe = await security.checkText(title + ' ' + content)
    if (!textSafe) {
      wx.hideLoading()
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: this.data.editMode ? '保存中...' : '发布中...' })

    const allPrizes = [
      ...prizes.filter(p => p.amount),
      ...customPrizes.filter(p => p.label || p.amount)
    ]

    const payload = {
      content,
      title,
      banner,
      captainGroupQr,
      images,
      eventData: {
        ...eventData,
        date: this.formatEventDateRange(eventData.startDate, eventData.endDate),
        registrationMode: 'both',
        sport,
        basketballConfig: sport === '篮球' ? this.normalizeBasketballConfig(eventData.basketballConfig) : null,
        prizes: allPrizes
      }
    }

    wx.cloud.callFunction({
      name: this.data.editMode ? 'updateEventPost' : 'publishPost',
      data: this.data.editMode
        ? { ...payload, postId: this.data.postId }
        : { ...payload, postType: 'event' },
      success: (res) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        if (res.result.code === 0) {
          if (this.data.editMode) {
            wx.showToast({ title: '已保存', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 800)
            return
          }
          wx.showToast({ title: '赛事发布成功', icon: 'success', duration: 900 })
          setTimeout(() => {
            wx.setStorageSync('bossManageTab', 'events')
            wx.switchTab({ url: '/pages/my-orders/my-orders' })
          }, 500)
        } else {
          wx.showToast({ title: res.result.msg || '发布失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ submitting: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  }
})
