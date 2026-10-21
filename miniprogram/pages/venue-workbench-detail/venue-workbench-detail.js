const security = require('../../utils/security')

const DEFAULT_FEE_RATE = 8

Page({
  data: {
    loading: true,
    activePanel: 'dashboard',
    pageTitle: '数据仪表盘',
    guideKey: '',
    guideTitle: '使用提示',
    guideText: '',
    venue: {},
    platformFeeRate: DEFAULT_FEE_RATE,
    pricingRules: [],
    courtUnits: [],
    scheduleSlots: [],
    rangeTabs: [{ key: '7', label: '7天' }, { key: '30', label: '30天' }, { key: '90', label: '90天' }],
    activeRange: '7',
    analyticsTabs: [
      { key: 'income', label: '收入' },
      { key: 'privateOrders', label: '包场数' },
      { key: 'casualFormed', label: '散客成局' },
      { key: 'arrivalDistribution', label: '到场时间' }
    ],
    activeAnalytics: 'income',
    analyticsData: {
      7: {
        income: [520, 860, 430, 1200, 980, 1480, 1660],
        privateOrders: [1, 2, 1, 3, 2, 4, 4],
        casualFormed: [0, 1, 1, 2, 1, 3, 2],
        arrivalDistribution: [8, 10, 16, 28, 36, 24, 12]
      },
      30: {
        income: [3200, 4200, 3800, 5200, 6100, 5700, 6900],
        privateOrders: [8, 10, 9, 14, 16, 15, 18],
        casualFormed: [4, 6, 5, 8, 10, 9, 12],
        arrivalDistribution: [36, 42, 58, 86, 104, 78, 48]
      },
      90: {
        income: [9800, 12600, 14200, 15800, 17200, 18800, 21500],
        privateOrders: [26, 32, 35, 39, 42, 46, 52],
        casualFormed: [12, 18, 22, 24, 28, 31, 36],
        arrivalDistribution: [110, 138, 176, 248, 312, 236, 148]
      }
    },
    gameTabs: [{ key: 'reserved', label: '预约中' }, { key: 'active', label: '进行中' }, { key: 'finished', label: '已结束' }],
    activeGameTab: 'reserved',
    pageDraft: { description: '', openingStart: '', openingEnd: '', galleryImages: [] },
    venueGames: [],
    visibleVenueGames: [],
    placeholderGames: [{ title: '暂无球局', meta: '散客组局和包场成功后会同步到这里' }],
    placeholderOrders: [{ title: '暂无订单', meta: '支付接入后展示散客支付、包场支付和结算状态' }],
    refundRequests: [{ title: '暂无退款申请', meta: '用户发起退款后，会在这里集中处理和记录' }],
    settlementOrders: [],
    settlementSummary: { gross: 0, platformFee: 0, venueReceivable: 0, orderCount: 0 }
  },

  onLoad(options) {
    const activePanel = options.panel || 'dashboard'
    const titleMap = { dashboard: '数据仪表盘', pricing: '价格设置', games: '球局管理', schedule: '场地排班', homepage: '球馆主页', orders: '订单/结算' }
    const guideMap = {
      dashboard: '可切换 7、30、90 天查看收入、包场数、散客成局数与到场时间分布。',
      pricing: '每种场地规格需分别设置散客价和包场价；散客价还可设置对应使用时长。',
      games: '这里统一查看预约中、进行中和近 7 天已结束的包场、散客局与球队约战。',
      schedule: '点击时段可切换可约或锁定；已被预约的时段会锁定，不能重新开放。',
      homepage: '封面、介绍、相册和定位会展示给运动员，保存后会同步更新球馆主页。',
      orders: '订单会按散客、包场和退款状态归集，完成支付后可在这里核对与结算。'
    }
    this.setData({
      activePanel,
      pageTitle: titleMap[activePanel] || '球馆管理',
      guideKey: `venue-workbench:${activePanel}`,
      guideTitle: titleMap[activePanel] || '球馆管理',
      guideText: guideMap[activePanel] || ''
    })
    wx.setNavigationBarTitle({ title: titleMap[activePanel] || '球馆管理' })
    this.loadVenue()
  },

  loadVenue() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getMyVenue',
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
          return
        }
        this.hydrateVenue(result.data || {})
      },
      fail: () => {
        wx.showToast({ title: '球馆资料加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  hydrateVenue(venue) {
    venue.galleryImages = venue.galleryImages || []
    const courtTypes = venue.courtTypes || []
    const courtCounts = venue.courtCounts || {}
    const savedRules = venue.pricingRules || []
    const pricingRules = courtTypes.map(type => {
      const saved = savedRules.find(rule => rule.courtType === type) || {}
      return {
        courtType: type,
        count: Number(courtCounts[type]) || 0,
        casualPricePerPerson: saved.casualPricePerPerson || '',
        casualDurationMode: saved.casualDurationMode || 'unlimited',
        casualDurationMinutes: saved.casualDurationMinutes || '',
        privatePricePerHour: saved.privatePricePerHour || ''
      }
    })
    const courtUnits = []
    courtTypes.forEach(type => {
      const count = Number(courtCounts[type]) || 0
      for (let i = 1; i <= count; i++) courtUnits.push({ id: `${type}_${i}`, name: `${type}${i}`, courtType: type })
    })
    const feeRate = Number(venue.platformFeeRate || DEFAULT_FEE_RATE)
    const analyticsData = venue.analyticsData || this.data.analyticsData
    this.setData({
      loading: false,
      venue,
      venueGames: venue.venueGames || [],
      visibleVenueGames: this.filterVenueGames(venue.venueGames || [], this.data.activeGameTab),
      analyticsData,
      settlementOrders: venue.settlementOrders || [],
      settlementSummary: venue.settlementSummary || { gross: 0, platformFee: 0, venueReceivable: 0, orderCount: 0 },
      refundRequests: (venue.refundRequests && venue.refundRequests.length) ? venue.refundRequests : this.data.refundRequests,
      platformFeeRate: feeRate,
      pricingRules,
      courtUnits,
      scheduleSlots: this.buildScheduleSlots(courtUnits, venue.scheduleTemplate || venue.workbenchSchedule || [], venue.venueBookings || []),
      pageDraft: { description: venue.description || '', openingStart: venue.openingStart || '', openingEnd: venue.openingEnd || '', galleryImages: venue.galleryImages || [] }
    }, () => {
      if (this.data.activePanel === 'dashboard') setTimeout(() => this.drawAnalyticsChart(), 80)
    })
  },

  buildDefaultPeriods() {
    const start = this.data.pageDraft.openingStart || '10:00'
    const end = this.data.pageDraft.openingEnd || '22:00'
    const startHour = Number(start.split(':')[0]) || 10
    const endHour = Number(end.split(':')[0]) || 22
    const periods = []
    for (let hour = startHour; hour < endHour; hour += 2) periods.push({ start: `${String(hour).padStart(2, '0')}:00`, end: `${String(Math.min(hour + 2, endHour)).padStart(2, '0')}:00`, status: 'available' })
    return periods.length ? periods : [{ start: '10:00', end: '12:00', status: 'available' }]
  },

  buildScheduleSlots(courtUnits, savedSchedule, bookings = []) {
    const fallback = this.buildDefaultPeriods()
    const savedMap = {}
    ;(savedSchedule || []).forEach(item => {
      if (!savedMap[item.courtId]) savedMap[item.courtId] = []
      savedMap[item.courtId].push(item)
    })
    return courtUnits.map(court => ({
      ...court,
      slots: (savedMap[court.id] && savedMap[court.id].length ? savedMap[court.id] : fallback).map((period, index) => {
        const startTime = period.startTime || period.start
        const endTime = period.endTime || period.end
        const hasBooking = (bookings || []).some(item => item.courtId === court.id && item.status !== 'cancelled' && startTime < item.endTime && item.startTime < endTime)
        const status = hasBooking ? 'booked' : (period.status || 'available')
        return {
          slotId: period.slotId || `${court.id}_${index}_${startTime}`,
          startTime,
          endTime,
          status,
          statusLabel: this.slotStatusLabel(status)
        }
      })
    }))
  },

  slotStatusLabel(status) {
    return ({ available: '可约', locked: '锁定', booked: '已约' })[status] || '可约'
  },

  onPricingInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`pricingRules[${index}].${field}`]: e.detail.value })
  },

  setCasualDurationMode(e) {
    const { index, mode } = e.currentTarget.dataset
    this.setData({
      [`pricingRules[${index}].casualDurationMode`]: mode,
      [`pricingRules[${index}].casualDurationMinutes`]: mode === 'unlimited' ? '' : this.data.pricingRules[index].casualDurationMinutes
    })
  },

  onPageDraftInput(e) {
    this.setData({ [`pageDraft.${e.currentTarget.dataset.field}`]: e.detail.value })
  },

  onOpeningStartChange(e) { this.setData({ 'pageDraft.openingStart': e.detail.value }) },
  onOpeningEndChange(e) { this.setData({ 'pageDraft.openingEnd': e.detail.value }) },
  switchRange(e) { this.setData({ activeRange: e.currentTarget.dataset.key }, () => this.drawAnalyticsChart()) },
  switchAnalytics(e) { this.setData({ activeAnalytics: e.currentTarget.dataset.key }, () => this.drawAnalyticsChart()) },
  switchGameTab(e) {
    const activeGameTab = e.currentTarget.dataset.key
    this.setData({
      activeGameTab,
      visibleVenueGames: this.filterVenueGames(this.data.venueGames || [], activeGameTab)
    })
  },

  filterVenueGames(games, tab) {
    const now = new Date()
    return (games || []).filter(game => {
      const endAt = new Date(`${game.date} ${String(game.time || '').split('-')[1] || '23:59'}`).getTime()
      if (tab === 'active') return game.status !== 'finished' && game.status !== 'cancelled' && (game.status === 'awaiting_confirm' || (Number.isFinite(endAt) && endAt >= now.getTime()))
      if (tab === 'finished') return game.status === 'finished' || (Number.isFinite(endAt) && endAt < now.getTime())
      return ['open', 'formed', 'locked', 'pending_payment', 'privateBooked', 'in_progress', 'awaiting_confirm'].includes(game.status)
    })
  },

  completeVenueGame(e) {
    const gameId = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认完成',
      content: '确认该约场已完成？完成后参与者信誉分 +1。',
      confirmText: '完成',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...' })
        wx.cloud.callFunction({
          name: 'completeVenueGame',
          data: { gameId },
          success: (r) => {
            wx.hideLoading()
            if (r.result && r.result.code === 0) {
              wx.showToast({ title: '已完成', icon: 'success' })
              this.loadVenue()
            } else wx.showToast({ title: (r.result && r.result.msg) || '操作失败', icon: 'none' })
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '操作失败', icon: 'none' })
          }
        })
      }
    })
  },

  toggleSlot(e) {
    const { courtIndex, slotIndex } = e.currentTarget.dataset
    const current = this.data.scheduleSlots[courtIndex].slots[slotIndex]
    if (current.status === 'booked') return wx.showToast({ title: '已约时段不可改为可约', icon: 'none' })
    const nextStatus = current.status === 'available' ? 'locked' : 'available'
    this.setData({
      [`scheduleSlots[${courtIndex}].slots[${slotIndex}].status`]: nextStatus,
      [`scheduleSlots[${courtIndex}].slots[${slotIndex}].statusLabel`]: this.slotStatusLabel(nextStatus)
    })
  },

  onSlotStartChange(e) {
    const { courtIndex, slotIndex } = e.currentTarget.dataset
    const slot = this.data.scheduleSlots[courtIndex].slots[slotIndex]
    if (slot.status === 'booked') return wx.showToast({ title: '已约时段不可修改', icon: 'none' })
    this.setData({ [`scheduleSlots[${courtIndex}].slots[${slotIndex}].startTime`]: e.detail.value })
  },

  onSlotEndChange(e) {
    const { courtIndex, slotIndex } = e.currentTarget.dataset
    const slot = this.data.scheduleSlots[courtIndex].slots[slotIndex]
    if (slot.status === 'booked') return wx.showToast({ title: '已约时段不可修改', icon: 'none' })
    this.setData({ [`scheduleSlots[${courtIndex}].slots[${slotIndex}].endTime`]: e.detail.value })
  },

  addSlot(e) {
    const courtIndex = e.currentTarget.dataset.courtIndex
    const court = this.data.scheduleSlots[courtIndex]
    const slot = { slotId: `${court.id}_${Date.now()}`, startTime: '18:00', endTime: '20:00', status: 'available', statusLabel: '可约' }
    this.setData({ [`scheduleSlots[${courtIndex}].slots`]: court.slots.concat(slot) })
  },

  removeSlot(e) {
    const { courtIndex, slotIndex } = e.currentTarget.dataset
    const slot = this.data.scheduleSlots[courtIndex].slots[slotIndex]
    if (slot.status === 'booked') return wx.showToast({ title: '已约时段不可删除', icon: 'none' })
    this.setData({ [`scheduleSlots[${courtIndex}].slots`]: this.data.scheduleSlots[courtIndex].slots.filter((_, index) => index !== slotIndex) })
  },

  savePricing() {
    const pricingRules = this.data.pricingRules.map(rule => ({
      courtType: rule.courtType,
      casualPricePerPerson: Number(rule.casualPricePerPerson) || 0,
      casualDurationMode: rule.casualDurationMode || 'unlimited',
      casualDurationMinutes: rule.casualDurationMode === 'limited' ? Number(rule.casualDurationMinutes) || 0 : 0,
      privatePricePerHour: Number(rule.privatePricePerHour) || 0
    }))
    this.saveWorkbench({ pricingRules }, '价格已保存', 'schedule')
  },

  saveSchedule() {
    const scheduleTemplate = []
    this.data.scheduleSlots.forEach(court => {
      court.slots.forEach(slot => scheduleTemplate.push({ slotId: slot.slotId, courtId: court.id, courtName: court.name, courtType: court.courtType, startTime: slot.startTime, endTime: slot.endTime, status: slot.status }))
    })
    this.saveWorkbench({ scheduleTemplate }, '排班模板已保存', 'homepage')
  },

  async uploadHomepageGallery() {
    const current = this.data.pageDraft.galleryImages || []
    const remain = 9 - current.length
    if (remain <= 0) return wx.showToast({ title: '相册最多9张', icon: 'none' })
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      success: async (res) => {
        wx.showLoading({ title: '上传中...' })
        try {
          const uploads = []
          for (let i = 0; i < res.tempFiles.length; i++) {
            const compressed = await security.compressImageForAudit(res.tempFiles[i].tempFilePath)
            const ext = (compressed.split('.').pop() || 'jpg').toLowerCase()
            const uploadRes = await wx.cloud.uploadFile({
              cloudPath: `venues/gallery/${Date.now()}_${i}.${ext}`,
              filePath: compressed
            })
            const safe = await security.checkImage(uploadRes.fileID)
            if (safe) uploads.push(uploadRes.fileID)
          }
          wx.hideLoading()
          if (!uploads.length) return wx.showToast({ title: '图片未通过审核', icon: 'none' })
          this.setData({
            'pageDraft.galleryImages': current.concat(uploads).slice(0, 9),
            'venue.galleryImages': current.concat(uploads).slice(0, 9)
          })
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },

  removeHomepageGallery(e) {
    const index = e.currentTarget.dataset.index
    const galleryImages = (this.data.pageDraft.galleryImages || []).filter((_, i) => i !== index)
    this.setData({
      'pageDraft.galleryImages': galleryImages,
      'venue.galleryImages': galleryImages
    })
  },

  saveHomepage() {
    this.saveWorkbench({
      description: this.data.pageDraft.description,
      openingStart: this.data.pageDraft.openingStart,
      openingEnd: this.data.pageDraft.openingEnd,
      galleryImages: this.data.pageDraft.galleryImages || []
    }, '主页信息已保存', 'pricing')
  },

  saveWorkbench(data, successTitle, nextPanel = '') {
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'updateVenueWorkbench',
      data,
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          this.loadVenue()
          const nextMap = {
            pricing: { label: '设置场地价格', desc: '继续补齐各规格的散客价和包场价。' },
            schedule: { label: '设置可约排班', desc: '设置每日可约时间，用户才能按真实时段预约。' },
            homepage: { label: '完善球馆主页', desc: '补充介绍和相册，让用户更了解球馆。' }
          }
          const next = nextMap[nextPanel]
          if (!next) {
            wx.showToast({ title: successTitle, icon: 'success' })
            return
          }
          wx.showModal({
            title: successTitle,
            content: `下一步：${next.desc}`,
            cancelText: '留在此页',
            confirmText: next.label,
            success: modalRes => {
              if (modalRes.confirm) {
                wx.redirectTo({ url: `/pages/venue-workbench-detail/venue-workbench-detail?panel=${nextPanel}` })
              }
            }
          })
        } else wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  goPanel(e) {
    const panel = e.currentTarget.dataset.panel
    if (panel) wx.redirectTo({ url: `/pages/venue-workbench-detail/venue-workbench-detail?panel=${panel}` })
  },

  showComingSoon() { wx.showToast({ title: '功能建设中', icon: 'none' }) },
  previewCover() {
    const cover = this.data.venue.coverImage
    if (!cover) return
    wx.previewImage({ current: cover, urls: [cover].concat(this.data.venue.galleryImages || []).filter(Boolean) })
  },

  openVenueLocation() {
    const venue = this.data.venue || {}
    const latitude = Number(venue.latitude)
    const longitude = Number(venue.longitude)
    if (!latitude || !longitude) return wx.showToast({ title: '暂无球馆定位', icon: 'none' })
    wx.openLocation({
      latitude,
      longitude,
      name: venue.locationName || venue.name || '球馆位置',
      address: venue.address || ''
    })
  },

  drawAnalyticsChart() {
    const rangeData = this.data.analyticsData[this.data.activeRange] || {}
    const values = rangeData[this.data.activeAnalytics] || []
    if (!values.length) return
    const ctx = wx.createCanvasContext('analyticsChart', this)
    const width = 320
    const height = 170
    const padding = 24
    const max = Math.max(...values)
    const min = Math.min(...values)
    const range = max === min ? 1 : max - min
    const points = values.map((value, index) => ({ x: padding + index * ((width - padding * 2) / (values.length - 1)), y: height - padding - ((value - min) / range) * (height - padding * 2) }))
    ctx.clearRect(0, 0, width, height)
    ctx.setStrokeStyle('#2A2A2A')
    ctx.setLineWidth(1)
    for (let i = 0; i < 4; i++) {
      const y = padding + i * ((height - padding * 2) / 3)
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke()
    }
    ctx.setStrokeStyle('#FF6B1A'); ctx.setLineWidth(3); ctx.beginPath()
    points.forEach((point, index) => { if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y) })
    ctx.stroke(); ctx.setFillStyle('#FF6B1A')
    points.forEach(point => { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill() })
    ctx.draw()
  }
})
