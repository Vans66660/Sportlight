const app = getApp()
const DELETE_W = 160

// ── 日期工具 ──
function parseDate(str) {
  if (!str) return null
  str = String(str).trim()
  let m
  m = str.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/)
  if (m) return { year: +m[1], month: +m[2], day: +m[3] }
  m = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})/)
  if (m) return { year: +m[1], month: +m[2], day: +m[3] }
  m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return { year: +m[3], month: +m[1], day: +m[2] }
  return null
}

function toDateStr(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const CN_WEEKS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const SHORT_DAYS = ['日', '一', '二', '三', '四', '五', '六']

function buildCalendar(year, month, allItems) {
  const map = {}
  allItems.forEach(item => {
    const p = parseDate(item.date)
    if (!p) return
    const key = toDateStr(p.year, p.month, p.day)
    if (!map[key]) map[key] = []
    map[key].push(item)
  })

  const now = new Date()
  const todayStr = toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const firstDow = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const daysInPrev = new Date(year, month - 1, 0).getDate()
  const days = []

  for (let i = firstDow - 1; i >= 0; i--) {
    const d = daysInPrev - i
    const pm = month === 1 ? 12 : month - 1
    const py = month === 1 ? year - 1 : year
    const ds = toDateStr(py, pm, d)
    days.push({ dateStr: ds, dayNum: d, isCurrentMonth: false, isToday: false, hasOrder: false, hasEvent: false, weekDayShort: SHORT_DAYS[new Date(py, pm - 1, d).getDay()] })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = toDateStr(year, month, d)
    const items = map[ds] || []
    days.push({
      dateStr: ds, dayNum: d, isCurrentMonth: true,
      isToday: ds === todayStr,
      hasOrder: items.some(i => i.itemType === 'order'),
      hasEvent: items.some(i => i.itemType === 'event' || i.itemType === 'eventMatch' || i.itemType === 'teamChallenge'),
      weekDayShort: SHORT_DAYS[new Date(year, month - 1, d).getDay()]
    })
  }

  const rem = days.length % 7
  if (rem > 0) {
    for (let d = 1; d <= 7 - rem; d++) {
      const nm = month === 12 ? 1 : month + 1
      const ny = month === 12 ? year + 1 : year
      days.push({ dateStr: toDateStr(ny, nm, d), dayNum: d, isCurrentMonth: false, isToday: false, hasOrder: false, hasEvent: false, weekDayShort: SHORT_DAYS[new Date(ny, nm - 1, d).getDay()] })
    }
  }
  return days
}

Page({
  data: {
    userType: '',
    // 日历（球员）
    calendarYear: 0,
    calendarMonth: 0,
    calendarMonthLabel: '',
    calendarDays: [],
    selectedDate: '',
    selectedDateLabel: '',
    selectedItems: [],
    visibleScheduleItems: [],
    scheduleView: 'day',
    allItems: [],
    stripScrollId: '',
    // 消息角标
    totalUnread: 0,
    conversations: [],
    notifUnread: 0,
    messageTab: 'chats',
    friends: [],
    friendRequests: { received: [], sent: [] },
    // 老板 tab 切换
    activeTab: 'orders',
    totalOrderApplicants: 0,
    // 赛事列表（老板）
    myEvents: [],
    totalPendingCount: 0,
    // 订单列表（老板）
    activeStatus: 'all',
    statusList: [
      { key: 'all', label: '全部' },
      { key: 'open', label: '招募中' },
      { key: 'locked', label: '进行中' },
      { key: 'done', label: '已完成' },
      { key: 'cancelled', label: '已取消' }
    ],
    orders: [],
    filteredOrders: [],
    ratingOptions: [1, 2, 3, 4, 5],
    evalModal: {
      show: false, orderId: '', orderType: '',
      punctuality: 'good', communication: 'good', contentQuality: 'good',
      rating: 5, comment: ''
    }
  },

  onLoad() {
    this.consumeBossManageTab()
    const info = wx.getSystemInfoSync()
    this._rpxRatio = 750 / info.windowWidth
    this._openId = null
    app.onLoginReady(() => {
      const userType = app.globalData.userType || wx.getStorageSync('userType') || ''
      this.setData({ userType })
      if (userType === 'boss') {
        this.loadMyOrders()
        this.loadMyEvents()
      } else {
        this.loadConversations()
        this.loadNotifCount()
        this.loadFriends()
        this.loadFriendRequests()
      }
    })
  },

  onShow() {
    this.consumeBossManageTab()
    if (this.msgTimer) clearInterval(this.msgTimer)
    const userType = app.globalData.userType || wx.getStorageSync('userType') || ''
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const tabBar = this.getTabBar()
      const selected = userType === 'boss' ? 2 : 3
      if (typeof tabBar.syncRole === 'function') tabBar.syncRole({ selected })
      else tabBar.setData({ selected })
    }
    if (!app.globalData.loginReady) return
    this.setData({ userType })
    if (userType === 'boss') {
      this.loadMyOrders(true)
      this.loadMyEvents(true)
    } else {
      this.loadConversations()
      this.loadNotifCount()
      this.loadFriends()
      this.loadFriendRequests()
    }
    this.msgTimer = setInterval(() => {
      this.loadConversations()
      if (this.data.userType !== 'boss') this.loadNotifCount()
    }, 15000)
  },

  onTabItemTap() {
    if (this.data.userType === 'boss') return
    this.loadConversations()
    this.loadNotifCount()
  },

  onHide() { if (this.msgTimer) clearInterval(this.msgTimer) },
  onUnload() { if (this.msgTimer) clearInterval(this.msgTimer) },

  consumeBossManageTab() {
    const tab = wx.getStorageSync('bossManageTab')
    if (!['orders', 'events'].includes(tab)) return
    wx.removeStorageSync('bossManageTab')
    this.setData({ activeTab: tab })
  },

  // ── 日历 ──

  _initCalendar(year, month) {
    const now = new Date()
    const todayStr = toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate())
    this.setData({
      calendarYear: year,
      calendarMonth: month,
      calendarMonthLabel: `${year}年${month}月`,
      calendarDays: buildCalendar(year, month, []),
      selectedDate: todayStr,
      selectedDateLabel: this._dayLabel(todayStr),
      selectedItems: [],
      stripScrollId: 'strip-day-' + todayStr
    })
  },

  _dayLabel(dateStr) {
    const now = new Date()
    const todayStr = toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate())
    const p = parseDate(dateStr)
    if (!p) return ''
    const dow = new Date(p.year, p.month - 1, p.day).getDay()
    if (dateStr === todayStr) return `今天 · ${p.month}月${p.day}日`
    return `${p.month}月${p.day}日  ${CN_WEEKS[dow]}`
  },

  _itemsForDate(dateStr) {
    return this.data.allItems.filter(item => {
      const p = parseDate(item.date)
      return p && toDateStr(p.year, p.month, p.day) === dateStr
    })
  },

  loadSchedule(silent = false) {
    if (!silent) wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getMySchedule',
      success: (res) => {
        if (!silent) wx.hideLoading()
        if (res.result.code === 0) {
          const allItems = [...res.result.orders, ...res.result.events]
          const { calendarYear, calendarMonth, selectedDate } = this.data
          this.setData({
            allItems,
            calendarDays: buildCalendar(calendarYear, calendarMonth, allItems),
            selectedItems: allItems.filter(item => {
              const p = parseDate(item.date)
              return p && toDateStr(p.year, p.month, p.day) === selectedDate
            })
          }, () => this.applyScheduleView())
        }
      },
      fail: () => { if (!silent) wx.hideLoading() }
    })
  },

  prevMonth() {
    let { calendarYear: y, calendarMonth: m } = this.data
    if (--m < 1) { m = 12; y-- }
    const firstDs = toDateStr(y, m, 1)
    this.setData({
      calendarYear: y, calendarMonth: m,
      calendarMonthLabel: `${y}年${m}月`,
      calendarDays: buildCalendar(y, m, this.data.allItems),
      selectedDate: firstDs,
      selectedDateLabel: this._dayLabel(firstDs),
      selectedItems: this._itemsForDate(firstDs),
      stripScrollId: 'strip-day-' + firstDs
    }, () => this.applyScheduleView())
  },

  nextMonth() {
    let { calendarYear: y, calendarMonth: m } = this.data
    if (++m > 12) { m = 1; y++ }
    const firstDs = toDateStr(y, m, 1)
    this.setData({
      calendarYear: y, calendarMonth: m,
      calendarMonthLabel: `${y}年${m}月`,
      calendarDays: buildCalendar(y, m, this.data.allItems),
      selectedDate: firstDs,
      selectedDateLabel: this._dayLabel(firstDs),
      selectedItems: this._itemsForDate(firstDs),
      stripScrollId: 'strip-day-' + firstDs
    }, () => this.applyScheduleView())
  },

  selectDay(e) {
    const dateStr = e.currentTarget.dataset.date
    this.setData({
      selectedDate: dateStr,
      selectedDateLabel: this._dayLabel(dateStr),
      selectedItems: this._itemsForDate(dateStr),
      stripScrollId: 'strip-day-' + dateStr
    }, () => this.applyScheduleView())
  },

  setScheduleView(e) {
    this.setData({ scheduleView: e.currentTarget.dataset.view }, () => this.applyScheduleView())
  },

  applyScheduleView() {
    const visibleScheduleItems = this.data.scheduleView === 'all'
      ? this.data.allItems.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
      : this.data.selectedItems
    this.setData({ visibleScheduleItems })
  },

  goScheduleItem(e) {
    const { id, type } = e.currentTarget.dataset
    if (type === 'order') {
      wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` })
    } else if (type === 'venueBooking') {
      wx.navigateTo({ url: `/pages/solo-game-detail/solo-game-detail?gameId=${id}` })
    } else if (type === 'eventMatch') {
      wx.navigateTo({ url: `/pages/open-tournament/open-tournament?postId=${id}` })
    } else if (type === 'teamChallenge') {
      wx.navigateTo({ url: `/pages/team-challenge-detail/team-challenge-detail?challengeId=${id}` })
    } else {
      wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${id}` })
    }
  },

  // ── 老板订单列表 ──

  loadMyOrders(silent = false) {
    if (!silent) wx.showLoading({ title: '加载中...' })
    const done = (res) => {
      if (!silent) wx.hideLoading()
      if (res.result.code === 0) this.setData({ orders: res.result.data }, () => this.filterOrders())
    }
    const fail = () => { if (!silent) wx.hideLoading() }
    wx.cloud.callFunction({ name: 'getMyBossOrders', success: done, fail })
  },

  setStatus(e) {
    this.setData({ activeStatus: e.currentTarget.dataset.key }, () => this.filterOrders())
  },

  filterOrders() {
    const { orders, activeStatus } = this.data
    const hidden = wx.getStorageSync('hiddenOrders') || []
    const totalOrderApplicants = orders
      .filter(o => o.status === 'open')
      .reduce((sum, o) => sum + (o.newApplicantsCount || 0), 0)
    this.setData({
      totalOrderApplicants,
      filteredOrders: orders.filter(o => !hidden.includes(o._id)).filter(o => activeStatus === 'all' || o.status === activeStatus)
    })
  },

  setTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab })
  },


  loadMyEvents(silent = false) {
    wx.cloud.callFunction({
      name: 'getMyEvents',
      success: (res) => {
        if (res.result.code === 0) {
          const sportClassMap = { '篮球': 'basketball', '足球': 'football', '羽毛球': 'badminton', '格斗': 'fight', '电竞': 'esport', '游泳': 'swim' }
          const fallbackClasses = ['basketball', 'football', 'badminton', 'fight', 'esport', 'swim']
          const events = res.result.data.map(e => ({
            ...e,
            colorClass: sportClassMap[e.sport] || fallbackClasses[e._id.charCodeAt(e._id.length - 1) % fallbackClasses.length]
          }))
          const totalPendingCount = events.reduce((sum, e) => sum + (e.pendingCount || 0), 0)
          this.setData({ myEvents: events, totalPendingCount })
        }
      }
    })
  },

  goEventDetail(e) {
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${e.currentTarget.dataset.id}` })
  },

  goViewRegistrants(e) {
    wx.navigateTo({ url: `/pages/event-registrants/event-registrants?postId=${e.currentTarget.dataset.id}` })
  },

  goEditEvent(e) {
    wx.navigateTo({ url: `/pages/publish-event/publish-event?postId=${e.currentTarget.dataset.id}` })
  },

  goEventAdmins(e) {
    wx.navigateTo({ url: `/pages/event-admins/event-admins?postId=${e.currentTarget.dataset.id}` })
  },

  goEnterResults(e) {
    wx.navigateTo({ url: `/pages/open-tournament/open-tournament?postId=${e.currentTarget.dataset.id}` })
  },

  goFeed() {
    wx.switchTab({ url: '/pages/feed/feed' })
  },

  deleteEvent(e) {
    const { id, registered } = e.currentTarget.dataset
    const registeredCount = Number(registered) || 0
    const content = registeredCount > 0
      ? `已有 ${registeredCount} 人确认报名，删除后报名记录将清除，确认删除吗？`
      : '确认删除此赛事？删除后不可恢复。'
    wx.showModal({
      title: '删除赛事',
      content,
      confirmText: '确认删除',
      confirmColor: '#E53935',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        wx.cloud.callFunction({
          name: 'deletePost',
          data: { postId: id },
          success: (r) => {
            wx.hideLoading()
            if (r.result.code === 0) {
              this.setData({ myEvents: this.data.myEvents.filter(ev => ev._id !== id) })
              wx.showToast({ title: '已删除', icon: 'none' })
            } else {
              wx.showToast({ title: r.result.msg || '删除失败', icon: 'none' })
            }
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
        })
      }
    })
  },

  deleteOrder(e) {
    const { id } = e.currentTarget.dataset
    const hidden = wx.getStorageSync('hiddenOrders') || []
    hidden.push(id)
    wx.setStorageSync('hiddenOrders', hidden)
    this.setData({ filteredOrders: this.data.filteredOrders.filter(o => o._id !== id) })
  },

  goOrderDetail(e) {
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${e.currentTarget.dataset.id}` })
  },

  cancelOrder(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认取消', content: '取消后订单将关闭，确认吗？', confirmText: '确认取消', confirmColor: '#FF6B1A',
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'applyOrder', data: { orderId: id, action: 'cancel' },
            success: () => { this.loadMyOrders(); wx.showToast({ title: '订单已取消', icon: 'none' }) }
          })
        }
      }
    })
  },

  cancelCooperation(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '取消合作',
      content: '取消后本次合作将关闭，球员侧会显示合作已取消，托管款将原路退回。',
      confirmText: '取消合作',
      confirmColor: '#FF6B1A',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...' })
        wx.cloud.callFunction({
          name: 'applyOrder',
          data: { orderId: id, action: 'cancel_cooperation' },
          success: (result) => {
            wx.hideLoading()
            const r = result.result || {}
            if (r.code !== 0) {
              wx.showToast({ title: r.msg || '操作失败', icon: 'none' })
              return
            }
            wx.showToast({ title: '合作已取消', icon: 'none' })
            this.loadMyOrders()
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络错误', icon: 'none' })
          }
        })
      }
    })
  },

  completeOrder(e) {
    const id = e.currentTarget.dataset.id
    const order = this.data.orders.find(o => o._id === id)
    if (this.data.userType === 'boss') {
      this.setData({
        'evalModal.show': true,
        'evalModal.orderId': id,
        'evalModal.orderType': order ? order.type : 'match',
        'evalModal.punctuality': 'good',
        'evalModal.communication': 'good',
        'evalModal.contentQuality': 'good',
        'evalModal.rating': 5,
        'evalModal.comment': ''
      })
    } else {
      wx.showModal({
        title: '确认完成', content: '确认已完成此订单？', confirmText: '确认完成', confirmColor: '#FF6B1A',
        success: (res) => {
          if (res.confirm) {
            wx.cloud.callFunction({
              name: 'applyOrder', data: { orderId: id, action: 'complete' },
              success: () => { this.loadMyOrders(); wx.showToast({ title: '订单已完成 🎉', icon: 'none' }) }
            })
          }
        }
      })
    }
  },

  setEval(e) { this.setData({ [`evalModal.${e.currentTarget.dataset.field}`]: e.currentTarget.dataset.val }) },

  setEvalRating(e) {
    this.setData({ 'evalModal.rating': Number(e.currentTarget.dataset.rating) })
  },

  onEvalCommentInput(e) {
    this.setData({ 'evalModal.comment': e.detail.value })
  },

  submitEval() {
    const { evalModal } = this.data
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'applyOrder',
      data: {
        orderId: evalModal.orderId,
        action: 'complete',
        evaluation: {
          punctuality: evalModal.punctuality,
          communication: evalModal.communication,
          contentQuality: evalModal.contentQuality,
          rating: evalModal.rating,
          comment: evalModal.comment
        }
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          this.setData({ 'evalModal.show': false })
          this.loadMyOrders()
          wx.showToast({ title: '已完成并评价 🎉', icon: 'none' })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '提交失败', icon: 'none' })
        }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
    })
  },

  closeEval() { this.setData({ 'evalModal.show': false }) },

  rateOrder(e) {
    const id = e.currentTarget.dataset.id
    wx.showActionSheet({
      itemList: ['⭐ 1分', '⭐⭐ 2分', '⭐⭐⭐ 3分', '⭐⭐⭐⭐ 4分', '⭐⭐⭐⭐⭐ 5分'],
      success: (sheet) => {
        wx.showModal({
          title: `确认评 ${sheet.tapIndex + 1} 分`, editable: true, placeholderText: '说说这次合作的感受...', confirmText: '提交', confirmColor: '#FF6B1A',
          success: (modal) => {
            if (modal.confirm) {
              wx.showLoading({ title: '提交中...' })
              wx.cloud.callFunction({
                name: 'rateAthlete', data: { orderId: id, rating: sheet.tapIndex + 1, comment: modal.content || '' },
                success: (r) => { wx.hideLoading(); if (r.result.code === 0) { wx.showToast({ title: '评分成功 🎉', icon: 'success' }); this.loadMyOrders() } else wx.showToast({ title: r.result.msg, icon: 'none' }) },
                fail: () => { wx.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
              })
            }
          }
        })
      }
    })
  },

  goApplicants(e) { wx.navigateTo({ url: `/pages/applicants/applicants?id=${e.currentTarget.dataset.id}` }) },

  goMessage(e) {
    const id = e.currentTarget.dataset.id
    const order = this.data.orders.find(o => o._id === id)
    wx.navigateTo({ url: `/pages/chat/chat?orderId=${id}&title=${encodeURIComponent(order ? order.title : '聊天')}` })
  },

  goMarket() { wx.switchTab({ url: '/pages/market/market' }) },

  goMessages() { wx.navigateTo({ url: '/pages/messages/messages' }) },
  goPlayerSchedule() { wx.navigateTo({ url: '/pages/player-schedule/player-schedule' }) },
  goNotifications() { wx.navigateTo({ url: '/pages/notifications/notifications' }) },
  goFriendSearch() { wx.navigateTo({ url: '/pages/friend-search/friend-search' }) },

  setMessageTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.messageTab) return
    this.setData({ messageTab: tab })
    if (tab === 'friends') {
      this.loadFriends()
      this.loadFriendRequests()
    } else {
      this.loadConversations()
      this.loadNotifCount()
    }
  },

  // ── 消息角标 ──

  // 由 app.js _broadcastUnread 实时推送，无需轮询
  onUnreadUpdate(count) {
    this.setData({ totalUnread: count })
    if (this.data.userType !== 'boss') this.loadConversations()
  },

  onNotifUnreadUpdate(count) {
    if (this.data.userType !== 'boss') this.setData({ notifUnread: count })
  },

  loadConversations() {
    const count = getApp().globalData.totalUnread || 0
    if (this.data.userType === 'boss') {
      this.setData({ totalUnread: count })
      return
    }
    wx.cloud.callFunction({
      name: 'getConversations',
      success: (res) => {
        if (res.result.code === 0) {
          let hidden = wx.getStorageSync('hiddenConversations') || []

          const withUnread = res.result.data.filter(c => c.unreadCount > 0).map(c => c._id)
          if (withUnread.length > 0) {
            hidden = hidden.filter(id => !withUnread.includes(id))
            wx.setStorageSync('hiddenConversations', hidden)
          }

          const swipeState = {}
          this.data.conversations.forEach(c => {
            swipeState[c._id] = { swipeX: c.swipeX || 0, transitioning: c.transitioning || false }
          })

          const conversations = res.result.data
            .filter(c => !hidden.includes(c._id))
            .map(c => {
              const s = swipeState[c._id] || {}
              return { ...c, swipeX: s.swipeX || 0, transitioning: s.transitioning || false }
            })

          const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0)
          this.setData({ conversations, totalUnread: Math.max(totalUnread, getApp().globalData.totalUnread || 0) })
        }
      }
    })
  },

  loadNotifCount() {
    if (this.data.userType === 'boss') return
    wx.cloud.callFunction({
      name: 'getNotifications',
      data: { markRead: false },
      success: (res) => {
        if (res.result.code === 0) this.setData({ notifUnread: res.result.unreadCount })
      }
    })
  },

  loadFriends() {
    if (this.data.userType === 'boss') return
    wx.cloud.callFunction({
      name: 'getFriends',
      success: res => {
        const result = res.result || {}
        if (result.code === 0) this.setData({ friends: result.data || [] })
      }
    })
  },

  loadFriendRequests() {
    if (this.data.userType === 'boss') return
    wx.cloud.callFunction({
      name: 'getFriendRequests',
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          this.setData({
            friendRequests: {
              received: result.received || [],
              sent: result.sent || []
            }
          })
        }
      }
    })
  },

  goFriendChat(e) {
    const index = e.currentTarget.dataset.index
    const friend = this.data.friends[index]
    if (!friend) return
    wx.cloud.callFunction({
      name: 'startFriendChat',
      data: { friendOpenid: friend.friendOpenid },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          wx.navigateTo({ url: `/pages/chat/chat?orderId=${result.orderId}&title=${encodeURIComponent(result.title || friend.friendDisplayName || '好友聊天')}&chatKind=direct` })
        } else wx.showToast({ title: result.msg || '进入失败', icon: 'none' })
      }
    })
  },

  _findIndex(id) {
    return this.data.conversations.findIndex(c => c._id === id)
  },

  onTouchStart(e) {
    if (this.data.userType === 'boss') return
    const index = parseInt(e.currentTarget.dataset.index)
    const id = this.data.conversations[index]?._id
    this._startX = e.touches[0].clientX
    this._startY = e.touches[0].clientY
    this._activeId = id
    this._directionLocked = false
    this._isHorizontal = false

    if (this._openId && this._openId !== id) {
      const openIdx = this._findIndex(this._openId)
      if (openIdx >= 0) {
        this.setData({
          [`conversations[${openIdx}].swipeX`]: 0,
          [`conversations[${openIdx}].transitioning`]: true
        })
      }
      this._openId = null
    }

    if (id) this.setData({ [`conversations[${index}].transitioning`]: false })
  },

  onTouchMove(e) {
    if (this.data.userType === 'boss') return
    const dx = e.touches[0].clientX - this._startX
    const dy = e.touches[0].clientY - this._startY

    if (!this._directionLocked) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      this._directionLocked = true
      this._isHorizontal = Math.abs(dx) > Math.abs(dy)
    }
    if (!this._isHorizontal) return

    const index = this._findIndex(this._activeId)
    if (index < 0) return

    const dxRpx = dx * this._rpxRatio
    const base = this._openId === this._activeId ? -DELETE_W : 0
    const newX = Math.max(-DELETE_W, Math.min(0, base + dxRpx))
    this.setData({ [`conversations[${index}].swipeX`]: newX })
  },

  onTouchEnd() {
    if (this.data.userType === 'boss' || !this._isHorizontal) return

    const index = this._findIndex(this._activeId)
    if (index < 0) return

    const currentX = this.data.conversations[index].swipeX || 0
    const snap = currentX < -DELETE_W / 2 ? -DELETE_W : 0
    this._openId = snap < 0 ? this._activeId : null

    this.setData({
      [`conversations[${index}].swipeX`]: snap,
      [`conversations[${index}].transitioning`]: true
    })
  },

  goChat(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const conv = this.data.conversations[index]
    if (!conv) return

    if ((conv.swipeX || 0) !== 0) {
      this.setData({
        [`conversations[${index}].swipeX`]: 0,
        [`conversations[${index}].transitioning`]: true
      })
      this._openId = null
      return
    }

    const { id, title } = e.currentTarget.dataset
    const kindParam = conv.directChat || conv.teamCaptainChat || conv.chatKind ? '&chatKind=direct' : ''
    wx.navigateTo({
      url: `/pages/chat/chat?orderId=${id}&title=${encodeURIComponent(title)}${kindParam}`
    })
  },

  deleteConversation(e) {
    const { id } = e.currentTarget.dataset
    const hidden = wx.getStorageSync('hiddenConversations') || []
    hidden.push(id)
    wx.setStorageSync('hiddenConversations', hidden)
    this._openId = null
    this.setData({
      conversations: this.data.conversations.filter(c => c._id !== id)
    })
    wx.cloud.callFunction({ name: 'markMessagesRead', data: { orderId: id } })
  },

  onApplicantUpdate() {
    if (this.data.userType !== 'boss') return
    this.loadMyOrders(true)
    this.loadMyEvents(true)
  }
})
