const { requestImportantNotice, TEMPLATE_TYPES } = require('../../utils/subscribe-notice')

// 报名资料里可能保存为“北京市/重庆市”，筛选栏使用“北京/重庆”。
// 用统一城市键比较，避免行政区后缀导致筛选失效。
function cityFilterKey(value) {
  return String(value || '')
    .replace(/[\s·]/g, '')
    .replace(/特别行政区|自治区|自治州|地区|市|省/g, '')
}

Page({
  data: {
    keyword: '',
    eventKeyword: '',
    orderKeyword: '',
    allOrders: [],
    activeFilter: '全部',
    activeEventFilter: '全部',
    orderFilters: {
      sport: '全部',
      type: '全部',
      dateRange: '全部时间'
    },
    eventFiltersState: {
      sport: '全部',
      quick: '全部',
      time: '所有时间'
    },
    customDeadlineStart: '',
    customDeadlineEnd: '',
    activeTab: 'events',
    userType: '',
    filters: ['全部', '篮球', '足球', '羽毛球', '格斗', '电竞', '游泳'],
    bossFilterGroups: [
      { key: 'sport', label: '类目', filters: ['全部', '足球', '篮球', '羽毛球'] },
      { key: 'rank', label: '等级', filters: ['全部', 'S级', 'A级', 'B级', 'C级', 'D级'] },
      { key: 'city', label: '城市', filters: ['全部', '北京', '上海', '广州', '深圳', '成都', '杭州', '武汉', '南京', '重庆'] }
    ],
    bossFilters: {
      sport: '全部',
      rank: '全部',
      city: '全部'
    },
    // 老板打开小程序后的首屏引导，和“我的”页共享完成状态。
    bossHomeGuide: { visible: false, completedCount: 0, totalCount: 3, next: null, steps: [], guideId: '' },
    allAthletes: [],
    orderFilterGroups: [
      { key: 'sport', label: '类目', filters: ['全部', '足球', '篮球', '羽毛球'] },
      { key: 'type', label: '类型', filters: ['全部', '参赛雇佣'] },
      { key: 'dateRange', label: '赛程', filters: ['本周', '本月', '全部时间'] },
    ],
    eventFilterGroups: [
      { key: 'sport', label: '项目', filters: ['全部', '足球', '篮球', '羽毛球'] },
      { key: 'quick', label: '快筛', filters: ['全部', '可报名', '官方认证'] },
      { key: 'time', label: '时间', filters: ['所有时间', '本周', '本月', '自定义'] }
    ],
    athletes: [],
    orders: [],
    events: [],
    visibleEvents: [],
    hasEventQuery: false,
    hasOrderQuery: false,
    eventsPage: 0,
    eventsHasMore: true,
    eventsLoading: false,
    eventsRefreshing: false,
    ordersRefreshing: false
  },

  onLoad() {
    const userType = getApp().globalData.userType || wx.getStorageSync('userType') || ''
    this.setData({ userType })
    setTimeout(() => {
      if (userType === 'boss') {
        this.loadAthletes()
        this.loadBossHomeGuide()
      } else {
        this.loadEvents()
        this.loadOrders()
      }
    }, 500)
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const tabBar = this.getTabBar()
      if (typeof tabBar.syncRole === 'function') tabBar.syncRole({ selected: 0 })
      else tabBar.setData({ selected: 0 })
    }
    const latestUserType = getApp().globalData.userType || wx.getStorageSync('userType') || ''
    if (latestUserType !== this.data.userType) {
      this.setData({ userType: latestUserType, activeTab: 'events' }, () => {
        if (latestUserType === 'boss') {
          this.loadAthletes()
          this.loadBossHomeGuide()
        } else {
          this.loadEvents()
          this.loadOrders()
        }
      })
      return
    }
    if (!this._loaded) {
      this._loaded = true
      return
    }
    const { userType, activeTab } = this.data
    if (userType === 'boss') {
      this.loadAthletes()
    } else if (activeTab === 'orders') {
      this.loadOrders()
    }
  },

  loadBossHomeGuide() {
    wx.cloud.callFunction({
      name: 'getMyProfile',
      success: (res) => {
        const profile = (res.result && res.result.userType === 'boss' && res.result.profile) || null
        if (!profile) return
        const guideId = profile._id || profile.openid || 'current'
        const manageViewed = !!wx.getStorageSync(`bossGuideManageViewed:${guideId}`)
        const steps = [
          { key: 'profile', label: '资料', actionLabel: '完善主体资料', done: !!(profile.logo && profile.city && profile.description) },
          { key: 'publish', label: '发布', actionLabel: '发布赛事或需求', done: Number(profile.orderCount || 0) > 0 || (profile.recentPosts || []).length > 0 },
          { key: 'manage', label: '管理', actionLabel: '处理报名与沟通', done: manageViewed }
        ]
        const completedCount = steps.filter(item => item.done).length
        const next = steps.find(item => !item.done) || { key: 'manage', actionLabel: '进入发布管理' }
        this.setData({
          bossHomeGuide: {
            // 首屏始终保留轻量入口，完成新手步骤后也能快速找到运营管理。
            visible: true,
            completedCount,
            totalCount: steps.length,
            steps,
            next,
            guideId
          }
        })
      }
    })
  },

  goBossHomeGuide(e) {
    const step = e.currentTarget.dataset.step
    if (step === 'profile') return wx.navigateTo({ url: '/pages/edit-boss-profile/edit-boss-profile' })
    if (step === 'publish') {
      return wx.showActionSheet({
        itemList: ['发布赛事', '发布合作需求'],
        success: res => wx.navigateTo({ url: res.tapIndex === 0 ? '/pages/publish-event/publish-event' : '/pages/publish-order/publish-order' })
      })
    }
    if (step === 'manage') {
      const guideId = this.data.bossHomeGuide.guideId || 'current'
      wx.setStorageSync(`bossGuideManageViewed:${guideId}`, true)
      this.setData({ 'bossHomeGuide.steps[2].done': true })
      wx.setStorageSync('bossManageTab', 'orders')
      wx.switchTab({ url: '/pages/my-orders/my-orders' })
    }
  },

  loadAthletes() {
    const sport = this.data.bossFilters.sport === '全部' ? '' : this.data.bossFilters.sport
    wx.cloud.callFunction({
      name: 'getAthletes',
      data: { sport, pageSize: 100 },
      success: (res) => {
        if (res.result.code === 0) {
          this.setData({ allAthletes: res.result.data }, () => this.filterAthletes())
        }
      }
    })
  },

  filterAthletes() {
    const { allAthletes, bossFilters, keyword } = this.data
    const kw = (keyword || '').trim().toLowerCase()
    let filtered = allAthletes

    if (bossFilters.rank !== '全部') {
      const rank = bossFilters.rank.replace('级', '')
      filtered = filtered.filter(a => (a.rankBase || (a.rank || 'D')[0]) === rank)
    }

    if (bossFilters.city !== '全部') {
      const cityKey = cityFilterKey(bossFilters.city)
      filtered = filtered.filter(a => cityFilterKey(a.city) === cityKey)
    }

    if (kw) {
      filtered = filtered.filter(a => {
        return (a.name && a.name.toLowerCase().includes(kw)) ||
          (a.city && a.city.toLowerCase().includes(kw)) ||
          (a.sport && a.sport.toLowerCase().includes(kw)) ||
          (a.affiliation && a.affiliation.toLowerCase().includes(kw))
      })
    }

    this.setData({ athletes: filtered })
  },

  loadOrders() {
    const sport = this.data.orderFilters.sport === '全部' ? '' : this.data.orderFilters.sport
    wx.cloud.callFunction({
      name: 'getOrders',
      data: { sport },
      success: (res) => {
        if (res.result && res.result.code === 0) {
          this.setData({ allOrders: res.result.data }, () => this.filterOrders())
        }
      },
      complete: () => this.setData({ ordersRefreshing: false })
    })
  },

  onOrderSearch(e) {
    this.setData({ orderKeyword: e.detail.value }, () => this.filterOrders())
  },

  clearOrderSearch() {
    this.setData({ orderKeyword: '' }, () => this.filterOrders())
  },

  clearOrderFilters() {
    this.setData({
      orderKeyword: '',
      orderFilters: {
        sport: '全部',
        type: '全部',
        dateRange: '全部时间'
      },
      activeFilter: '全部'
    }, () => this.loadOrders())
  },

  filterOrders() {
    const { allOrders, orderKeyword, orderFilters } = this.data
    const kw = (orderKeyword || '').trim().toLowerCase()
    const hasOrderQuery = !!kw || orderFilters.sport !== '全部' || orderFilters.type !== '全部' || orderFilters.dateRange !== '全部时间'
    const orders = allOrders.filter(o => {
      if (kw) {
        const matchedKeyword =
        (o.title && o.title.toLowerCase().includes(kw)) ||
        (o.city && o.city.toLowerCase().includes(kw)) ||
        (o.bossName && o.bossName.toLowerCase().includes(kw)) ||
        (o.type && o.type.toLowerCase().includes(kw))
        if (!matchedKeyword) return false
      }

      if (orderFilters.type !== '全部') {
        if (o.type !== 'match') return false
      }

      if (orderFilters.dateRange === '本周' && !this.isDateInThisWeek(o.date)) return false
      if (orderFilters.dateRange === '本月' && !this.isDateInThisMonth(o.date)) return false

      return true
    })
    this.setData({ orders, hasOrderQuery })
  },

  loadEvents() {
    if (this.data.eventsLoading || !this.data.eventsHasMore) return
    this.setData({ eventsLoading: true })
    const sport = this.data.eventFiltersState.sport === '全部' ? '' : this.data.eventFiltersState.sport
    wx.cloud.callFunction({
      name: 'getEvents',
      data: { page: this.data.eventsPage, limit: 15, sport },
      success: (res) => {
        if (res.result.code === 0) {
          const sportClassMap = { '篮球': 'basketball', '足球': 'football', '羽毛球': 'badminton', '格斗': 'fight', '电竞': 'esport', '游泳': 'swim' }
          const fallbackClasses = ['basketball', 'football', 'badminton', 'fight', 'esport', 'swim']
          const newEvents = res.result.data.map(e => ({
            ...e,
            colorClass: sportClassMap[e.sport] || fallbackClasses[e._id.charCodeAt(e._id.length - 1) % 6]
          }))
          this.setData({
            events: this.data.eventsPage === 0 ? newEvents : [...this.data.events, ...newEvents],
            eventsHasMore: res.result.hasMore,
            eventsLoading: false,
            eventsRefreshing: false
          }, () => this.applyEventFilters())
        } else {
          this.setData({ eventsLoading: false })
        }
      },
      fail: () => this.setData({ eventsLoading: false, eventsRefreshing: false })
    })
  },

  applyEventFilters() {
    const keyword = (this.data.eventKeyword || '').trim().toLowerCase()
    const filters = this.data.eventFiltersState
    const hasEventQuery = !!keyword || filters.sport !== '全部' || filters.quick !== '全部' || filters.time !== '所有时间'

    const visibleEvents = this.data.events.filter(event => {
      if (keyword) {
        const haystack = [
          event.title,
          event.content,
          event.eventLocation,
          event.sport,
          event.authorName,
          event.teamSizeLabel,
          event.eventDate
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(keyword)) return false
      }

      if (filters.quick === '可报名') {
        const maxTeams = Number(event.maxTeams || 0)
        const registeredTeams = Number(event.registeredTeams || 0)
        if (event.eventStatus !== 'open') return false
        if (maxTeams && registeredTeams >= maxTeams) return false
      }

      if (filters.quick === '官方认证' && !event.platformCertified) {
        return false
      }

      if (!this.matchDeadlineFilter(event.registrationDeadline, filters.time)) {
        return false
      }

      return true
    })

    this.setData({ visibleEvents, hasEventQuery })
  },

  parseFirstDate(dateStr) {
    if (!dateStr) return null
    // 处理 "2026-07-10 至 2026-07-15" 等多日范围格式，取第一个日期
    const match = String(dateStr).match(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/)
    if (!match) return null
    const date = new Date(match[0].replace(/-/g, '/'))
    if (Number.isNaN(date.getTime())) return null
    date.setHours(0, 0, 0, 0)
    return date
  },

  isDateInThisWeek(dateStr) {
    const date = this.parseFirstDate(dateStr)
    if (!date) return false
    const now = new Date()
    const start = new Date(now)
    const day = start.getDay() || 7
    start.setDate(start.getDate() - day + 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 7)
    return date >= start && date < end
  },

  isDateInThisMonth(dateStr) {
    const date = this.parseFirstDate(dateStr)
    if (!date) return false
    const now = new Date()
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  },

  parseDateOnly(dateStr) {
    if (!dateStr) return null
    const match = String(dateStr).match(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/)
    if (!match) return null
    const date = new Date(match[0].replace(/-/g, '/'))
    if (Number.isNaN(date.getTime())) return null
    date.setHours(0, 0, 0, 0)
    return date
  },

  endOfDate(date) {
    if (!date) return null
    const end = new Date(date)
    end.setHours(23, 59, 59, 999)
    return end
  },

  isDeadlineWithinDays(deadlineStr, days) {
    const deadline = this.endOfDate(this.parseDateOnly(deadlineStr))
    if (!deadline) return false
    const now = new Date()
    const end = new Date(now)
    end.setDate(now.getDate() + days)
    end.setHours(23, 59, 59, 999)
    return deadline >= now && deadline <= end
  },

  isDeadlineInCustomRange(deadlineStr) {
    const deadline = this.endOfDate(this.parseDateOnly(deadlineStr))
    if (!deadline) return false
    const start = this.parseDateOnly(this.data.customDeadlineStart)
    const end = this.endOfDate(this.parseDateOnly(this.data.customDeadlineEnd))
    if (!start || !end) return true
    return deadline >= start && deadline <= end
  },

  matchDeadlineFilter(deadlineStr, timeFilter) {
    if (!timeFilter || timeFilter === '所有时间') return true
    if (timeFilter === '本周') return this.isDeadlineWithinDays(deadlineStr, 7)
    if (timeFilter === '本月') return this.isDeadlineWithinDays(deadlineStr, 30)
    if (timeFilter === '自定义') return this.isDeadlineInCustomRange(deadlineStr)
    return true
  },

  isDateToday(dateStr) {
    const date = this.parseFirstDate(dateStr)
    if (!date) return false
    const now = new Date()
    return date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
  },

  isDateAfterToday(dateStr) {
    const date = this.parseFirstDate(dateStr)
    if (!date) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return date > today
  },

  isWithinDays(dateStr, days) {
    const date = this.parseFirstDate(dateStr)
    if (!date) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const future = new Date(today)
    future.setDate(today.getDate() + days)
    return date > today && date <= future
  },

  onEventSearch(e) {
    this.setData({ eventKeyword: e.detail.value }, () => this.applyEventFilters())
  },

  clearEventSearch() {
    this.setData({ eventKeyword: '' }, () => this.applyEventFilters())
  },

  clearEventFilters() {
    this.setData({
      eventKeyword: '',
      activeEventFilter: '全部',
      activeFilter: '全部',
      eventFiltersState: {
        sport: '全部',
        quick: '全部',
        time: '所有时间'
      },
      customDeadlineStart: '',
      customDeadlineEnd: '',
      events: [],
      visibleEvents: [],
      eventsPage: 0,
      eventsHasMore: true
    }, () => this.loadEvents())
  },

  setEventFilter(e) {
    const { group, filter } = e.currentTarget.dataset
    const nextFilters = { ...this.data.eventFiltersState, [group]: filter }
    const oldSport = this.data.eventFiltersState.sport

    this.setData({
      eventFiltersState: nextFilters,
      activeEventFilter: filter,
      activeFilter: nextFilters.sport
    }, () => {
      if (group === 'sport' && filter !== oldSport) {
        this.setData({
          events: [],
          visibleEvents: [],
          eventsPage: 0,
          eventsHasMore: true
        })
        this.loadEvents()
      } else {
        this.applyEventFilters()
      }
    })
  },

  onCustomDeadlineStartChange(e) {
    const start = e.detail.value
    const next = { customDeadlineStart: start }
    if (this.data.customDeadlineEnd && this.parseDateOnly(this.data.customDeadlineEnd) < this.parseDateOnly(start)) {
      next.customDeadlineEnd = start
    }
    this.setData(next, () => this.applyEventFilters())
  },

  onCustomDeadlineEndChange(e) {
    const end = e.detail.value
    const next = { customDeadlineEnd: end }
    if (this.data.customDeadlineStart && this.parseDateOnly(end) < this.parseDateOnly(this.data.customDeadlineStart)) {
      next.customDeadlineStart = end
    }
    this.setData(next, () => this.applyEventFilters())
  },

  onSearch(e) {
    const keyword = e.detail.value
    this.setData({ keyword }, () => this.filterAthletes())
  },

  setFilter(e) {
    const activeFilter = e.currentTarget.dataset.filter
    const group = e.currentTarget.dataset.group
    const { userType } = this.data

    // 主办方端分组筛选
    if (userType === 'boss' && group) {
      const nextFilters = { ...this.data.bossFilters, [group]: activeFilter }
      this.setData({ bossFilters: nextFilters }, () => {
        if (group === 'sport') {
          this.loadAthletes()
        } else {
          this.filterAthletes()
        }
      })
      return
    }

    if (group) {
      const nextFilters = { ...this.data.orderFilters, [group]: activeFilter }
      this.setData({
        orderFilters: nextFilters,
        activeFilter: nextFilters.sport
      }, () => {
        if (group === 'sport') {
          this.loadOrders()
        } else {
          this.filterOrders()
        }
      })
      return
    }

    this.setData({ activeFilter }, () => {
      const { userType, activeTab } = this.data
      if (userType === 'boss') {
        this.loadAthletes()
      } else if (activeTab === 'events') {
        this.setData({ events: [], visibleEvents: [], eventsPage: 0, eventsHasMore: true }, () => this.loadEvents())
      } else {
        this.loadOrders()
      }
    })
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
    if (tab === 'orders') {
      this.loadOrders()
    } else if (tab === 'events') {
      if (this.data.events.length === 0) {
        this.loadEvents()
      } else {
        this.applyEventFilters()
      }
    }
  },

  goActivity() {
    wx.navigateTo({ url: '/pages/activity/activity' })
  },

  goEventDetail(e) {
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${e.currentTarget.dataset.id}` })
  },

  goAuthorProfile(e) {
    const { openid, type } = e.currentTarget.dataset
    if (type === 'boss') {
      wx.navigateTo({ url: `/pages/boss-profile/boss-profile?openid=${openid}` })
    } else {
      wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
    }
  },

  goAthleteProfile(e) {
    wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?id=${e.currentTarget.dataset.id}` })
  },

  applyOrder(e) {
    const id = e.currentTarget.dataset.id
    requestImportantNotice([TEMPLATE_TYPES.order]).then((subscribeRes) => {
      const subscribeTip = this.getSubscribeResultText(subscribeRes)
      setTimeout(() => {
        wx.showModal({
          title: '确认报名',
          content: `${subscribeTip}\n\n确认要报名这个订单吗？老板将从报名者中选择合作球员。`,
          confirmText: '确认报名',
          confirmColor: '#FF6B1A',
          success: (res) => {
            if (res.confirm) this.submitOrderApplication(id)
          }
        })
      }, 600)
    })
  },

  getSubscribeResultText(res = {}) {
    if (res.subscribeStatus === 'accept') return '微信通知：已授权，后续结果会尝试通过微信服务通知提醒你。'
    if (res.subscribeStatus === 'reject') return '微信通知：你刚刚拒绝了授权，后续结果仍会保留在站内消息。'
    if (res.subscribeStatus === 'ban') return '微信通知：订阅消息权限已关闭，请到小程序右上角设置中开启。'
    if (res.skipped) return `微信通知：${res.failText || '未触发授权'}后续结果仍会保留在站内消息。`
    return '微信通知：未检测到授权结果，后续结果仍会保留在站内消息。'
  },

  submitOrderApplication(id) {
    wx.showLoading({ title: '报名中...' })
    wx.cloud.callFunction({
      name: 'applyOrder',
      data: { orderId: id },
      success: (result) => {
        wx.hideLoading()
        if (result.result.code === 0) {
          wx.showToast({ title: '报名成功 🎉', icon: 'none' })
          this.loadOrders()
        } else {
          wx.showToast({ title: result.result.msg, icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  onEventsScrollLower() {
    if (!this.data.eventsHasMore || this.data.eventsLoading) return
    this.setData({ eventsPage: this.data.eventsPage + 1 }, () => this.loadEvents())
  },

  // 首页改为页面自身滚动后，由页面触底事件继续加载更多赛事。
  onReachBottom() {
    if (this.data.userType !== 'boss' && this.data.activeTab === 'events') {
      this.onEventsScrollLower()
    }
  },

  onEventsRefresh() {
    if (this.data.eventsLoading) return
    this.setData({ eventsRefreshing: true, events: [], visibleEvents: [], eventsPage: 0, eventsHasMore: true }, () => {
      this.loadEvents()
    })
  },

  onOrdersRefresh() {
    if (this.data.ordersRefreshing) return
    this.setData({ ordersRefreshing: true }, () => {
      this.loadOrders()
    })
  },

  goOrderDetail(e) {
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${e.currentTarget.dataset.id}` })
  }
})
