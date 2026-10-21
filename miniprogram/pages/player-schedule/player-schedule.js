function parseDate(str) {
  if (!str) return null
  const text = String(str).trim()
  let m = text.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime()
  m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime()
  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]).getTime()
  return null
}

function formatDay(dateStr) {
  const time = parseDate(dateStr)
  if (!time) return dateStr || '待定'
  const d = new Date(time)
  const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weeks[d.getDay()]}`
}

function normalizeItem(item) {
  const typeText = {
    order: '战役',
    event: '公开赛',
    eventMatch: '赛事比赛',
    teamChallenge: '队伍约战',
    venueBooking: '约场'
  }[item.itemType] || '比赛'

  const normalized = {
    ...item,
    typeText,
    dayLabel: formatDay(item.date),
    timeText: item.time || '',
    dateTime: parseDate(item.date) || 0,
    statusText: item.statusLabel || '即将开始',
    subTitle: item.eventTitle || item.teamName || item.bossName || item.spec || '',
    locationText: item.location || '地点待定',
    actionHint: item.itemType === 'eventMatch' ? '查看赛事赛程' : (item.itemType === 'venueBooking' ? '查看约场' : '查看详情')
  }
  normalized.statusGroup = getStatusGroup(normalized)
  return normalized
}

function getStatusGroup(item) {
  const status = String(item.status || '').toLowerCase()
  const label = item.statusLabel || item.statusText || ''
  if (['cancelled', 'canceled', 'rejected'].includes(status) || label.includes('取消') || label.includes('驳回')) return 'cancelled'
  if (['done', 'finished', 'completed'].includes(status) || label.includes('完成') || label.includes('结束')) return 'completed'
  if (['locked', 'in_progress', 'active', 'awaiting_confirm'].includes(status) || label.includes('进行中') || label.includes('待确认')) return 'ongoing'
  return 'recruiting'
}

function filterScheduleItems(items, filter) {
  if (filter === 'all') return items
  return items.filter(item => item.statusGroup === filter)
}

Page({
  data: {
    loading: true,
    activeFilter: 'all',
    filterTabs: [
      { label: '全部', value: 'all' },
      { label: '招募中', value: 'recruiting' },
      { label: '进行中', value: 'ongoing' },
      { label: '已完成', value: 'completed' },
      { label: '已取消', value: 'cancelled' }
    ],
    scheduleItems: [],
    filteredItems: []
  },

  onLoad() {
    this.loadSchedule()
  },

  onPullDownRefresh() {
    this.loadSchedule(true)
  },

  loadSchedule(isRefresh = false) {
    if (!isRefresh) wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getMySchedule',
      success: (res) => {
        if (!isRefresh) wx.hideLoading()
        wx.stopPullDownRefresh()
        const result = res.result || {}
        if (result.code !== 0) {
          this.setData({ loading: false })
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          return
        }

        const items = [...(result.orders || []), ...(result.events || [])]
          .map(normalizeItem)
          .sort((a, b) => {
            const aDone = ['completed', 'cancelled'].includes(a.statusGroup) ? 1 : 0
            const bDone = ['completed', 'cancelled'].includes(b.statusGroup) ? 1 : 0
            if (aDone !== bDone) return aDone - bDone
            const at = a.dateTime || Number.MAX_SAFE_INTEGER
            const bt = b.dateTime || Number.MAX_SAFE_INTEGER
            return aDone ? bt - at : at - bt
          })

        this.setData({
          scheduleItems: items,
          filteredItems: filterScheduleItems(items, this.data.activeFilter),
          loading: false
        })
      },
      fail: () => {
        if (!isRefresh) wx.hideLoading()
        wx.stopPullDownRefresh()
        this.setData({ loading: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  selectFilter(e) {
    const filter = e.currentTarget.dataset.value || 'all'
    this.setData({
      activeFilter: filter,
      filteredItems: filterScheduleItems(this.data.scheduleItems, filter)
    })
  },

  goScheduleItem(e) {
    const { id, type, postId } = e.currentTarget.dataset
    if (type === 'order') {
      wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` })
    } else if (type === 'eventMatch') {
      wx.navigateTo({ url: `/pages/open-tournament/open-tournament?postId=${postId || id}` })
    } else if (type === 'teamChallenge') {
      wx.navigateTo({ url: `/pages/team-challenge-detail/team-challenge-detail?challengeId=${id}` })
    } else if (type === 'venueBooking') {
      wx.navigateTo({ url: `/pages/solo-game-detail/solo-game-detail?gameId=${id}` })
    } else {
      wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${id}` })
    }
  },

  goMarket() {
    wx.switchTab({ url: '/pages/market/market' })
  }
})
