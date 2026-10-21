Page({
  data: {
    loading: true,
    activePanel: '',
    venue: {},
    status: 'pending',
    statusLabel: '待审核',
    metricCards: [],
    panels: [
      { key: 'dashboard', title: '数据仪表盘', desc: '收入、订单、到场分析', accent: 'orange' },
      { key: 'pricing', title: '价格设置', desc: '散客价和包场价', accent: 'green' },
      { key: 'games', title: '球局管理', desc: '预约中和进行中球局', accent: 'blue' },
      { key: 'schedule', title: '场地排班', desc: '每日可用时间模板', accent: 'red' },
      { key: 'homepage', title: '球馆主页', desc: '用户端展示与编辑', accent: 'purple' },
      { key: 'orders', title: '订单结算', desc: '订单和结算记录', accent: 'gray' }
    ],
    pricingRules: [],
    courtUnits: [],
    scheduleDate: '',
    scheduleSlots: [],
    analyticsTabs: [
      { key: 'attendance', label: '到场' },
      { key: 'income', label: '收入' }
    ],
    activeAnalytics: 'attendance',
    analyticsData: {
      attendance: [18, 24, 16, 32, 28, 36, 42],
      income: [520, 860, 430, 1200, 980, 1480, 1660]
    },
    pageDraft: {
      description: '',
      openingStart: '',
      openingEnd: ''
    },
    venueGuide: { visible: false, completedCount: 0, totalCount: 4, items: [] },
    placeholderGames: [],
    placeholderOrders: []
  },

  onLoad() {
    this.setToday()
    this.loadVenue()
  },

  onShow() {
    if (!this.data.loading) this.loadVenue(false)
  },

  setToday() {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    this.setData({ scheduleDate: `${yyyy}-${mm}-${dd}` })
  },

  loadVenue(showLoading = true) {
    if (showLoading) this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getMyVenue',
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
          return
        }
        const venue = result.data || {}
        this.hydrateVenue(venue)
      },
      fail: () => {
        wx.showToast({ title: '球馆资料加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  hydrateVenue(venue) {
    const status = venue.status || 'pending'
    const statusLabelMap = { pending: '待审核', approved: '已通过', rejected: '已驳回' }
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
      for (let i = 1; i <= count; i++) {
        courtUnits.push({
          id: `${type}_${i}`,
          name: `${type}${i}`,
          courtType: type
        })
      }
    })

    const scheduleSlots = this.buildScheduleSlots(courtUnits, venue.scheduleTemplate || venue.workbenchSchedule || [], venue.venueBookings || [])
    const dashboard = venue.dashboard || {}
    const range7 = (venue.analyticsData && venue.analyticsData['7']) || {}
    const venueKey = venue._id || venue.id || 'current'
    const orderViewed = !!wx.getStorageSync(`venueGuideOrdersViewed:${venueKey}`)
    const priced = pricingRules.length > 0 && pricingRules.every(rule => (
      Number(rule.casualPricePerPerson) >= 0 && Number(rule.privatePricePerHour) >= 0 &&
      String(rule.casualPricePerPerson || '') !== '' && String(rule.privatePricePerHour || '') !== ''
    ))
    const guideItems = [
      { key: 'homepage', title: '完善球馆主页', desc: '补齐展示图和介绍，方便用户了解球馆', done: !!(venue.coverImage && venue.description) },
      { key: 'pricing', title: '设置场地价格', desc: '分别填写各规格的散客价和包场价', done: priced },
      { key: 'schedule', title: '设置可约排班', desc: '保存每日场地可约时间模板', done: Array.isArray(venue.scheduleTemplate) && venue.scheduleTemplate.length > 0 },
      { key: 'orders', title: '查看订单结算', desc: '熟悉预约订单和后续结算入口', done: orderViewed }
    ]
    const completedCount = guideItems.filter(item => item.done).length

    this.setData({
      loading: false,
      venue,
      status,
      statusLabel: statusLabelMap[status] || '待审核',
      rejectText: venue.rejectReason ? `审核未通过：${venue.rejectReason}` : '审核未通过',
      pricingRules,
      courtUnits,
      scheduleSlots,
      analyticsData: {
        attendance: range7.arrivalDistribution || this.data.analyticsData.attendance,
        income: range7.income || this.data.analyticsData.income
      },
      pageDraft: {
        description: venue.description || '',
        openingStart: venue.openingStart || '',
        openingEnd: venue.openingEnd || ''
      },
      venueGuide: {
        visible: completedCount < guideItems.length,
        completedCount,
        totalCount: guideItems.length,
        items: guideItems
      },
      metricCards: [
        { label: '今日收入', value: `¥${Number(dashboard.todayIncome || 0)}` },
        { label: '今日订单', value: String(Number(dashboard.todayOrders || 0)) },
        { label: '包场订单', value: String(Number(dashboard.privateOrders || 0)) },
        { label: '散客成局', value: String(Number(dashboard.casualFormed || 0)) },
        { label: '退款申请', value: '0' }
      ],
      placeholderGames: [
        { title: '暂无进行中的球局', meta: '后续会展示散客组局、球队约战和包场球局' }
      ],
      placeholderOrders: [
        { title: '暂无订单', meta: '支付接入后展示散客支付、包场支付和结算状态' }
      ]
    })
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

  buildDefaultPeriods() {
    const start = this.data.pageDraft.openingStart || '10:00'
    const end = this.data.pageDraft.openingEnd || '22:00'
    const startHour = Number(start.split(':')[0]) || 10
    const endHour = Number(end.split(':')[0]) || 22
    const periods = []
    for (let hour = startHour; hour < endHour; hour += 2) {
      periods.push({
        start: `${String(hour).padStart(2, '0')}:00`,
        end: `${String(Math.min(hour + 2, endHour)).padStart(2, '0')}:00`,
        status: 'available'
      })
    }
    return periods.length ? periods : [
      { start: '10:00', end: '12:00', status: 'available' }
    ]
  },

  slotStatusLabel(status) {
    const map = { available: '可约', locked: '锁定', booked: '已约' }
    return map[status] || '可约'
  },

  switchPanel(e) {
    const panel = e.currentTarget.dataset.panel
    wx.navigateTo({ url: `/pages/venue-workbench-detail/venue-workbench-detail?panel=${panel}` })
  },

  goVenueGuideStep(e) {
    const panel = e.currentTarget.dataset.panel
    if (panel === 'orders') {
      const venue = this.data.venue || {}
      wx.setStorageSync(`venueGuideOrdersViewed:${venue._id || venue.id || 'current'}`, true)
    }
    this.switchPanel({ currentTarget: { dataset: { panel } } })
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
    const field = e.currentTarget.dataset.field
    this.setData({ [`pageDraft.${field}`]: e.detail.value })
  },

  onOpeningStartChange(e) {
    this.setData({ 'pageDraft.openingStart': e.detail.value })
  },

  onOpeningEndChange(e) {
    this.setData({ 'pageDraft.openingEnd': e.detail.value })
  },

  switchAnalytics(e) {
    this.setData({ activeAnalytics: e.currentTarget.dataset.key }, () => this.drawAnalyticsChart())
  },

  toggleSlot(e) {
    const { courtIndex, slotIndex } = e.currentTarget.dataset
    const current = this.data.scheduleSlots[courtIndex].slots[slotIndex]
    if (current.status === 'booked') {
      wx.showToast({ title: '已约时段不可改为可约', icon: 'none' })
      return
    }
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
    const slot = {
      slotId: `${court.id}_${Date.now()}`,
      startTime: '18:00',
      endTime: '20:00',
      status: 'available',
      statusLabel: this.slotStatusLabel('available')
    }
    this.setData({ [`scheduleSlots[${courtIndex}].slots`]: court.slots.concat(slot) })
  },

  removeSlot(e) {
    const { courtIndex, slotIndex } = e.currentTarget.dataset
    const slot = this.data.scheduleSlots[courtIndex].slots[slotIndex]
    if (slot.status === 'booked') return wx.showToast({ title: '已约时段不可删除', icon: 'none' })
    const slots = this.data.scheduleSlots[courtIndex].slots.filter((_, index) => index !== slotIndex)
    this.setData({ [`scheduleSlots[${courtIndex}].slots`]: slots })
  },

  savePricing() {
    const pricingRules = this.data.pricingRules.map(rule => ({
      courtType: rule.courtType,
      casualPricePerPerson: Number(rule.casualPricePerPerson) || 0,
      casualDurationMode: rule.casualDurationMode || 'unlimited',
      casualDurationMinutes: rule.casualDurationMode === 'limited' ? Number(rule.casualDurationMinutes) || 0 : 0,
      privatePricePerHour: Number(rule.privatePricePerHour) || 0
    }))
    this.saveWorkbench({ pricingRules }, '价格已保存')
  },

  saveSchedule() {
    const scheduleTemplate = []
    this.data.scheduleSlots.forEach(court => {
      court.slots.forEach(slot => {
        scheduleTemplate.push({
          slotId: slot.slotId,
          courtId: court.id,
          courtName: court.name,
          courtType: court.courtType,
          startTime: slot.startTime,
          endTime: slot.endTime,
          status: slot.status
        })
      })
    })
    this.saveWorkbench({ scheduleTemplate }, '排班模板已保存')
  },

  saveHomepage() {
    this.saveWorkbench({
      description: this.data.pageDraft.description,
      openingStart: this.data.pageDraft.openingStart,
      openingEnd: this.data.pageDraft.openingEnd
    }, '主页信息已保存')
  },

  saveWorkbench(data, successTitle) {
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'updateVenueWorkbench',
      data,
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: successTitle, icon: 'success' })
          this.loadVenue(false)
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  showComingSoon() {
    wx.showToast({ title: '功能建设中', icon: 'none' })
  },

  previewCover() {
    const cover = this.data.venue.coverImage
    if (!cover) return
    const urls = [cover].concat(this.data.venue.galleryImages || []).filter(Boolean)
    wx.previewImage({ current: cover, urls })
  },

  drawAnalyticsChart() {
    const values = this.data.analyticsData[this.data.activeAnalytics] || []
    if (!values.length) return
    const ctx = wx.createCanvasContext('analyticsChart', this)
    const width = 320
    const height = 170
    const padding = 24
    const max = Math.max(...values)
    const min = Math.min(...values)
    const range = max === min ? 1 : max - min
    const points = values.map((value, index) => {
      const x = padding + index * ((width - padding * 2) / (values.length - 1))
      const y = height - padding - ((value - min) / range) * (height - padding * 2)
      return { x, y, value }
    })

    ctx.clearRect(0, 0, width, height)
    ctx.setStrokeStyle('#2A2A2A')
    ctx.setLineWidth(1)
    for (let i = 0; i < 4; i++) {
      const y = padding + i * ((height - padding * 2) / 3)
      ctx.beginPath()
      ctx.moveTo(padding, y)
      ctx.lineTo(width - padding, y)
      ctx.stroke()
    }

    ctx.setStrokeStyle('#FF6B1A')
    ctx.setLineWidth(3)
    ctx.beginPath()
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.stroke()

    ctx.setFillStyle('#FF6B1A')
    points.forEach(point => {
      ctx.beginPath()
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.draw()
  }
})
