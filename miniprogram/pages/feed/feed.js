const app = getApp()
const { requestImportantNotice, TEMPLATE_TYPES } = require('../../utils/subscribe-notice')

Page({
  data: {
    posts: [],
    page: 0,
    loading: false,
    hasMore: true,
    refreshing: false,
    userType: '',
    notifUnread: 0
  },

  onLoad() {
    const userType = app.globalData.userType || wx.getStorageSync('userType') || ''
    this.setData({ userType })
    this.loadFeed()
  },

  onTabItemTap() {
    // onShow 先于 onTabItemTap 执行，用时间差区分「再次点击 tab」和「从子页面返回」
    if (Date.now() - (this._showTime || 0) > 500) {
      this.onRefresh()
    }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const tabBar = this.getTabBar()
      if (typeof tabBar.syncRole === 'function') tabBar.syncRole({ selected: 1 })
      else tabBar.setData({ selected: 1 })
    }
    const userType = app.globalData.userType || wx.getStorageSync('userType') || ''
    if (userType !== this.data.userType) this.setData({ userType })
    this._showTime = Date.now()
    const count = app.globalData.notifUnread || 0
    this.setData({ notifUnread: count })
    if (count === 0) {
      wx.removeTabBarBadge({ index: 1 })
    }
    // 首次 onShow 是 onLoad 紧接着触发的，loadFeed 已调用过，跳过
    if (!this._loaded) {
      this._loaded = true
      return
    }
    // 从子页面返回或切换 Tab 回来：静默重载第 0 页，同步最新点赞/评论数
    this.setData({ page: 0, hasMore: true }, () => this.loadFeed())
  },

  onHide() {
    this._showTime = 0
  },

  loadFeed() {
    if (this.data.loading) return
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getFeed',
      data: { page: this.data.page, limit: 15 },
      success: (res) => {
        if (res.result.code === 0) {
          const newPosts = this.formatPosts(res.result.data)
          this.setData({
            posts: this.data.page === 0 ? newPosts : [...this.data.posts, ...newPosts],
            hasMore: res.result.hasMore,
            loading: false,
            refreshing: false
          })
        } else {
          this.setData({ loading: false, refreshing: false })
        }
      },
      fail: () => this.setData({ loading: false, refreshing: false })
    })
  },

  formatPosts(posts) {
    const typeMap = {
      match_result: '⚔️ 赛果',
      training: '💪 训练',
      collab: '📣 合作',
      general: '💬 日常'
    }
    return posts.map(p => ({
      ...p,
      typeLabel: typeMap[p.type] || '💬 日常',
      timeLabel: this.timeAgo(p.createdAt)
    }))
  },

  timeAgo(dateStr) {
    if (!dateStr) return ''
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    const diff = now - then
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins}分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}天前`
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}/${d.getDate()}`
  },

  likePost(e) {
    const { id, index } = e.currentTarget.dataset
    const post = this.data.posts[index]
    if (!post || post.likePending) return

    const oldLiked = !!post.liked
    const oldCount = post.likesCount || 0
    const newLiked = !oldLiked
    const newCount = Math.max(0, oldCount + (newLiked ? 1 : -1))
    this.setData({
      [`posts[${index}].liked`]: newLiked,
      [`posts[${index}].likesCount`]: newCount,
      [`posts[${index}].likePending`]: true
    })
    wx.cloud.callFunction({
      name: 'likePost',
      data: { postId: id },
      success: (res) => {
        if (res.result.code !== 0) {
          this.setData({
            [`posts[${index}].liked`]: oldLiked,
            [`posts[${index}].likesCount`]: oldCount,
            [`posts[${index}].likePending`]: false
          })
          return
        }
        this.setData({
          [`posts[${index}].liked`]: !!res.result.liked,
          [`posts[${index}].likesCount`]: res.result.likesCount,
          [`posts[${index}].likePending`]: false
        })
      },
      fail: () => {
        this.setData({
          [`posts[${index}].liked`]: oldLiked,
          [`posts[${index}].likesCount`]: oldCount,
          [`posts[${index}].likePending`]: false
        })
      }
    })
  },

  goPostDetail(e) {
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${e.currentTarget.dataset.id}` })
  },

  deletePost(e) {
    const { id, index } = e.currentTarget.dataset
    wx.showModal({
      title: '删除动态',
      content: '删除后无法恢复，确认吗？',
      confirmText: '删除',
      confirmColor: '#E53935',
      success: (res) => {
        if (!res.confirm) return
        // 乐观更新：立刻从列表移除
        const posts = this.data.posts.filter((_, i) => i !== index)
        this.setData({ posts })
        wx.cloud.callFunction({
          name: 'deletePost',
          data: { postId: id },
          success: (res) => {
            if (res.result.code !== 0) {
              wx.showToast({ title: res.result.msg || '删除失败', icon: 'none' })
              this.setData({ posts: [], page: 0, hasMore: true }, () => this.loadFeed())
            }
          },
          fail: () => {
            wx.showToast({ title: '删除失败', icon: 'none' })
            this.setData({ posts: [], page: 0, hasMore: true }, () => this.loadFeed())
          }
        })
      }
    })
  },

  onNotifUnreadUpdate(count) {
    this.setData({ notifUnread: count })
  },

  goNotifications() {
    wx.navigateTo({ url: '/pages/notifications/notifications' })
  },

  goPublishPost() {
    wx.navigateTo({ url: '/pages/publish-post/publish-post' })
  },

  goEnterResults(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/event-results/event-results?postId=${id}` })
  },

  goViewRegistrants(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/event-registrants/event-registrants?postId=${id}` })
  },

  registerEvent(e) {
    const { id, index } = e.currentTarget.dataset
    const post = this.data.posts[index]
    if (!post || post.isRegistered || post.isPending || post.eventStatus === 'full' || post.eventStatus === 'closed') return

    const feeText = post.entryFee > 0 ? `报名费：¥${post.entryFee}（线下缴纳）` : '免费报名'
    const approvalText = '需主办方审核'
    const lines = []
    if (post.eventDate) lines.push(`📅 ${post.eventDate}`)
    if (post.eventLocation) lines.push(`📍 ${post.eventLocation}`)
    lines.push(`💰 ${feeText}`)
    lines.push(`📋 ${approvalText}`)

    wx.showModal({
      title: '确认报名',
      content: lines.join('\n'),
      confirmText: '确认报名',
      confirmColor: '#CC8800',
      success: (res) => {
        if (!res.confirm) return
        requestImportantNotice([TEMPLATE_TYPES.event, TEMPLATE_TYPES.team])
        wx.showLoading({ title: '报名中...' })
        wx.cloud.callFunction({
          name: 'registerEvent',
          data: { postId: id },
          success: (res) => {
            wx.hideLoading()
            wx.showToast({ title: res.result.msg, icon: res.result.code === 0 ? 'success' : 'none' })
            if (res.result.code === 0) {
              this.setData({
                [`posts[${index}].isRegistered`]: false,
                [`posts[${index}].isPending`]: true
              })
            }
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络错误', icon: 'none' })
          }
        })
      }
    })
  },

  goAuthorProfile(e) {
    const { openid, type } = e.currentTarget.dataset
    if (type === 'boss') {
      wx.navigateTo({ url: `/pages/boss-profile/boss-profile?openid=${openid}` })
    } else {
      wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
    }
  },

  previewImage(e) {
    const { src, all } = e.currentTarget.dataset
    wx.previewImage({ current: src, urls: all })
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return
    this.setData({ page: this.data.page + 1 }, () => {
      this.loadFeed()
    })
  },

  onRefresh() {
    if (this.data.loading) return
    this.setData({ refreshing: true, posts: [], page: 0, hasMore: true }, () => {
      this.loadFeed()
    })
  }
})
