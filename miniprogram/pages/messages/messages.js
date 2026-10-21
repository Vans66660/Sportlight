const app = getApp()
const DELETE_W = 160  // rpx

Page({
  data: {
    conversations: [],
    notifUnread: 0
  },

  onLoad() {
    const info = wx.getSystemInfoSync()
    this._rpxRatio = 750 / info.windowWidth
    this._openId = null
  },

  onShow() {
    this.loadConversations()
    this.loadNotifCount()
    this.timer = setInterval(() => {
      this.loadConversations()
      this.loadNotifCount()
    }, 15000)
  },

  onHide() {
    if (this.timer) clearInterval(this.timer)
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer)
  },

  // 由 app.js _broadcastUnread 实时推送
  onUnreadUpdate() {
    this.loadConversations()
  },

  onNotifUnreadUpdate(count) {
    this.setData({ notifUnread: count })
  },

  loadNotifCount() {
    wx.cloud.callFunction({
      name: 'getNotifications',
      data: { markRead: false },
      success: (res) => {
        if (res.result.code === 0) {
          this.setData({ notifUnread: res.result.unreadCount })
        }
      }
    })
  },

  goNotifications() {
    wx.navigateTo({ url: '/pages/notifications/notifications' })
  },

  loadConversations() {
    wx.cloud.callFunction({
      name: 'getConversations',
      success: (res) => {
        if (res.result.code === 0) {
          let hidden = wx.getStorageSync('hiddenConversations') || []

          // 有新消息的会话从隐藏列表移除
          const withUnread = res.result.data.filter(c => c.unreadCount > 0).map(c => c._id)
          if (withUnread.length > 0) {
            hidden = hidden.filter(id => !withUnread.includes(id))
            wx.setStorageSync('hiddenConversations', hidden)
          }

          // 按 _id 保留当前滑动状态，防止 setData 打断进行中的手势
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
          this.setData({ conversations })
        }
      },
      fail: (err) => {
        console.error('获取会话失败', err)
      }
    })
  },

  // 根据 _id 找当前 index（防止 loadConversations 刷新后 index 位移）
  _findIndex(id) {
    return this.data.conversations.findIndex(c => c._id === id)
  },

  // ── 滑动手势 ──

  onTouchStart(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const id = this.data.conversations[index]?._id
    this._startX = e.touches[0].clientX
    this._startY = e.touches[0].clientY
    this._activeId = id
    this._directionLocked = false
    this._isHorizontal = false

    // 关闭其他已打开的项
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

    // 拖动期间关闭过渡动画，让跟手更流畅
    if (id) {
      this.setData({ [`conversations[${index}].transitioning`]: false })
    }
  },

  onTouchMove(e) {
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
    if (!this._isHorizontal) return

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

  // ── 跳转与删除 ──

  goChat(e) {
    const index = parseInt(e.currentTarget.dataset.index)
    const conv = this.data.conversations[index]
    if (!conv) return

    // 已滑开则收回，不跳转
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
    wx.cloud.callFunction({
      name: 'markMessagesRead',
      data: { orderId: id },
      complete: () => app.refreshUnreadBadge && app.refreshUnreadBadge()
    })
  }
})
