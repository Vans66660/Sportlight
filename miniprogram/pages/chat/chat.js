const app = getApp()
const db = wx.cloud.database()

function formatMsg(msg) {
  const d = new Date(msg.createdAt)
  msg.timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  return msg
}

Page({
  data: {
    orderId: '',
    orderTitle: '',
    order: null,
    chatKind: '',
    otherName: '',
    myPhoto: '',
    otherPhoto: '',
    myOpenid: '',
    messages: [],
    inputVal: '',
    scrollToId: ''
  },

  onLoad(options) {
    const { orderId, title, chatKind = '' } = options
    this.setData({
      orderId,
      chatKind,
      orderTitle: decodeURIComponent(title || '聊天'),
      myOpenid: app.globalData.openid
    })
    if (chatKind === 'direct') this.loadDirectChatDetail(orderId)
    else this.loadOrderDetail(orderId)
    this._fallbackLoad(true)
    this._startWatcher(orderId)
  },

  onUnload() {
    if (this._watcher) this._watcher.close()
    if (this._focusTimer) clearTimeout(this._focusTimer)
    if (this._pollTimer) clearInterval(this._pollTimer)
  },

  // ── 实时监听（WebSocket，替代轮询）──

  _startWatcher(orderId) {
    if (this._watcher) this._watcher.close()
    this._watcher = db.collection('messages')
      .where({ orderId })
      .orderBy('createdAt', 'asc')
      .watch({
        onChange: (snapshot) => this._onSnapshot(snapshot),
        onError: (err) => {
          console.error('消息监听断开:', err)
          this._fallbackLoad(true)
          this._startPolling()
        }
      })
  },

  _startPolling() {
    if (this._pollTimer) return
    this._pollTimer = setInterval(() => this._fallbackLoad(false), 3000)
  },

  _onSnapshot(snapshot) {
    if (snapshot.type === 'init') {
      const messages = snapshot.docs.map(formatMsg)
      const lastIdx = messages.length - 1
      this.setData({ messages, scrollToId: '' })
      if (lastIdx >= 0) {
        this._programmaticScroll = true
        wx.nextTick(() => this.setData({ scrollToId: `msg-${lastIdx}` }))
      }
      this._markRead()
      return
    }

    snapshot.docChanges.forEach(change => {
      if (change.dataType !== 'add') return
      const newMsg = formatMsg(change.doc)
      const msgs = this.data.messages

      const pendingIdx = msgs.findIndex(
        m => m.pending && m.fromOpenid === newMsg.fromOpenid && m.content === newMsg.content
      )

      if (pendingIdx >= 0) {
        this.setData({ [`messages[${pendingIdx}]`]: newMsg })
      } else {
        const idx = msgs.length
        this._programmaticScroll = true
        this.setData({ [`messages[${idx}]`]: newMsg, scrollToId: '' })
        wx.nextTick(() => this.setData({ scrollToId: `msg-${idx}` }))
      }

      this._markRead()
    })
  },

  _fallbackLoad(scrollToBottom = false) {
    wx.cloud.callFunction({
      name: 'getMessages',
      data: { orderId: this.data.orderId },
      success: (res) => {
        if (res.result.code === 0) {
          const messages = res.result.data.map(formatMsg)
          const lastIdx = messages.length - 1
          this.setData({ messages, scrollToId: '' })
          if (scrollToBottom && lastIdx >= 0) {
            this._programmaticScroll = true
            wx.nextTick(() => this.setData({ scrollToId: `msg-${lastIdx}` }))
          }
          this._markRead()
        }
      }
    })
  },

  _markRead() {
    wx.cloud.callFunction({
      name: 'markMessagesRead',
      data: { orderId: this.data.orderId },
      success: () => { app.refreshUnreadBadge() }
    })
  },

  // ── 发送消息 ──

  sendMsg() {
    const content = this.data.inputVal.trim()
    if (!content) return

    this.setData({ inputVal: '' })

    // 乐观更新：立刻追加气泡，标记 pending
    const now = new Date()
    const tmpId = `tmp-${Date.now()}`
    const optimistic = {
      _id: tmpId,
      fromOpenid: this.data.myOpenid,
      content,
      createdAt: now.getTime(),
      timeStr: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`,
      pending: true
    }
    const idx = this.data.messages.length
    this._programmaticScroll = true
    this.setData({ [`messages[${idx}]`]: optimistic, scrollToId: '' })
    wx.nextTick(() => this.setData({ scrollToId: `msg-${idx}` }))

    const order = this.data.order
    const toOpenid = order
      ? (this.data.myOpenid === order.bossOpenid ? order.athleteOpenid : order.bossOpenid)
      : ''

    const removePending = () =>
      this.setData({ messages: this.data.messages.filter(m => m._id !== tmpId) })

    wx.cloud.callFunction({
      name: 'sendMessage',
      data: { orderId: this.data.orderId, content, toOpenid },
      success: (res) => {
        if (!res.result || res.result.code !== 0) {
          removePending()
          wx.showToast({ title: res.result?.msg || '发送失败', icon: 'none' })
        }
        // 成功时 watcher 会自动推过来，替换 pending 气泡
      },
      fail: () => {
        removePending()
        wx.showToast({ title: '发送失败', icon: 'none' })
      }
    })
  },

  onInput(e) {
    this.setData({ inputVal: e.detail.value })
  },

  onTapBackground() {
    wx.hideKeyboard()
  },

  onChatScroll(e) {
    const scrollTop = e.detail.scrollTop
    if (this._programmaticScroll) {
      // 代码触发的滚动，忽略，不收键盘
      this._programmaticScroll = false
      this._lastScrollTop = scrollTop
      return
    }
    // 用户手动上翻历史记录才收起键盘
    if (scrollTop < (this._lastScrollTop || 0)) {
      wx.hideKeyboard()
    }
    this._lastScrollTop = scrollTop
  },

  onInputFocus() {
    if (this._focusTimer) clearTimeout(this._focusTimer)
    this._focusTimer = setTimeout(() => {
      const lastIdx = this.data.messages.length - 1
      if (lastIdx < 0) return
      this._programmaticScroll = true
      this.setData({ scrollToId: '' })
      wx.nextTick(() => {
        this._programmaticScroll = true
        this.setData({ scrollToId: `msg-${lastIdx}` })
      })
    }, 350)
  },

  // ── 订单详情 ──

  loadOrderDetail(orderId) {
    wx.cloud.callFunction({
      name: 'getOrderDetail',
      data: { orderId },
      success: (res) => {
        if (res.result.code === 0) {
          const order = res.result.data
          const myOpenid = this.data.myOpenid || app.globalData.openid
          const isBoss = myOpenid === order.bossOpenid
          const otherName = isBoss ? order.athleteName : order.bossName
          let myPhoto    = isBoss ? order.bossPhoto    : order.athletePhoto
          let otherPhoto = isBoss ? order.athletePhoto : order.bossPhoto

          const cloudPhotos = [myPhoto, otherPhoto].filter(p => p && p.startsWith('cloud://'))
          const apply = (bossP, athleteP) => {
            myPhoto    = isBoss ? bossP    : athleteP
            otherPhoto = isBoss ? athleteP : bossP
            this.setData({ order, otherName, myPhoto, otherPhoto })
          }

          if (cloudPhotos.length > 0) {
            wx.cloud.getTempFileURL({
              fileList: cloudPhotos,
              success: (r) => {
                const urlMap = {}
                r.fileList.forEach(f => { urlMap[f.fileID] = f.tempFileURL })
                apply(urlMap[order.bossPhoto] || order.bossPhoto || '', urlMap[order.athletePhoto] || order.athletePhoto || '')
              },
              fail: () => apply(order.bossPhoto || '', order.athletePhoto || '')
            })
          } else {
            apply(order.bossPhoto || '', order.athletePhoto || '')
          }
        }
      }
    })
  },

  loadDirectChatDetail(chatId) {
    wx.cloud.callFunction({
      name: 'getDirectChatDetail',
      data: { chatId },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          const data = result.data || {}
          this.setData({
            orderTitle: data.title || this.data.orderTitle,
            otherName: data.otherName || '队长',
            myPhoto: data.myPhoto || '',
            otherPhoto: data.otherPhoto || '',
            order: null
          })
        } else {
          wx.showToast({ title: result.msg || '会话加载失败', icon: 'none' })
        }
      }
    })
  },

  goMyProfile() {
    const { order, myOpenid } = this.data
    if (this.data.chatKind === 'direct') {
      wx.navigateTo({ url: '/pages/athlete-profile/athlete-profile?openid=' + myOpenid })
      return
    }
    if (!order) return
    if (order.teamCaptainChat) {
      wx.navigateTo({ url: '/pages/athlete-profile/athlete-profile?openid=' + myOpenid })
      return
    }
    if (myOpenid === order.bossOpenid) {
      wx.navigateTo({ url: '/pages/boss-profile/boss-profile?openid=' + myOpenid })
    } else {
      wx.navigateTo({ url: '/pages/athlete-profile/athlete-profile?openid=' + myOpenid })
    }
  },

  goOtherProfile() {
    const { order, myOpenid } = this.data
    if (this.data.chatKind === 'direct') {
      wx.cloud.callFunction({
        name: 'getDirectChatDetail',
        data: { chatId: this.data.orderId },
        success: res => {
          const otherOpenid = (((res.result || {}).data) || {}).otherOpenid
          if (otherOpenid) wx.navigateTo({ url: '/pages/athlete-profile/athlete-profile?openid=' + otherOpenid })
        }
      })
      return
    }
    if (!order) return
    if (order.teamCaptainChat) {
      const otherOpenid = myOpenid === order.bossOpenid ? order.athleteOpenid : order.bossOpenid
      wx.navigateTo({ url: '/pages/athlete-profile/athlete-profile?openid=' + otherOpenid })
      return
    }
    if (myOpenid === order.bossOpenid) {
      wx.navigateTo({ url: '/pages/athlete-profile/athlete-profile?openid=' + order.athleteOpenid })
    } else {
      wx.navigateTo({ url: '/pages/boss-profile/boss-profile?openid=' + order.bossOpenid })
    }
  },

  goOrderDetail() {
    if (this.data.chatKind === 'direct') return
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${this.data.orderId}` })
  },

  goBack() {
    wx.hideKeyboard()
    setTimeout(() => wx.navigateBack(), 150)
  }
})
