const AUTH_STORAGE = {
  registered: 'registered',
  userType: 'userType',
  subjectTypes: 'subjectTypes',
  selectedUserType: 'selectedRegisterUserType'
}

const SUBJECT_HOME = {
  athlete: '/pages/market/market',
  boss: '/pages/market/market',
  venue: '/pages/venue-manage/venue-manage',
  admin: '/pages/admin-hub/admin-hub'
}

App({
  onLaunch() {
    wx.cloud.init({
      env: 'cloud1-d1gc37qacf1fd1eee',
      traceUser: true
    })
    this._authGeneration = 0
    this.cloudLogin()
  },

  cloudLogin() {
    const generation = ++this._authGeneration
    wx.cloud.callFunction({
      name: 'login',
      data: {},
      success: (res) => {
        if (!res || !res.result) {
          console.warn('登录云函数返回异常')
          this.globalData.loginReady = true
          return
        }

        const { code, user } = res.result
        if (code === 0 && user) {
          // 如果登录过程中有 logout 发生，放弃本次结果
          if (generation !== this._authGeneration) return

          // _forceLogout 标记：不自动跳转，让用户看到登录页
          const forceLogout = wx.getStorageSync('_forceLogout') === '1'

          this.applyAuthState(user)

          this.globalData.loginReady = true
          const cbs = this._loginCallbacks || []
          this._loginCallbacks = []
          cbs.forEach(cb => cb())

          // 已注册用户自动跳转
          if (!forceLogout) {
            if (user.userType === 'admin') {
              setTimeout(() => {
                wx.reLaunch({ url: '/pages/admin-hub/admin-hub' })
              }, 0)
            } else if (user.registered && user.userType === 'venue') {
              wx.redirectTo({ url: '/pages/venue-manage/venue-manage' })
            } else if (user.registered && user.userType) {
              wx.switchTab({ url: '/pages/market/market' })
            }
          }

          if (this.globalData.registered || this.globalData.userType === 'admin') {
            this.initRoleServices()
          }
        } else {
          console.warn('登录云函数返回非0:', res.result)
          this.globalData.loginReady = true
        }
      },
      fail: (err) => {
        console.error('自动登录失败，进入离线模式', err)
        this.globalData.loginReady = true
      }
    })
  },

  applyAuthState(user) {
    const isRegistered = !!(user.registered && user.userType)
    const isAdmin = user.userType === 'admin'
    const userType = isRegistered || isAdmin ? user.userType : ''
    const subjectTypes = Array.isArray(user.subjectTypes)
      ? user.subjectTypes.filter(type => ['athlete', 'boss', 'venue'].includes(type))
      : (userType && userType !== 'admin' ? [userType] : [])

    this.globalData.openid = user.openid || ''
    this.globalData.userId = user._id || ''
    this.globalData.openidReady = !!user.openid
    this.globalData.registered = isRegistered
    this.globalData.userType = userType
    this.globalData.subjectTypes = subjectTypes
    this.globalData.isPlatformAdmin = !!user.isPlatformAdmin
    this.globalData.activityAdmin = !!user.activityAdmin
    this.globalData.selectedUserType = isRegistered ? '' : (wx.getStorageSync(AUTH_STORAGE.selectedUserType) || '')

    wx.setStorageSync(AUTH_STORAGE.userType, userType)
    wx.setStorageSync(AUTH_STORAGE.subjectTypes, subjectTypes)
    wx.setStorageSync(AUTH_STORAGE.registered, isRegistered ? '1' : '')
    if (isRegistered) wx.removeStorageSync(AUTH_STORAGE.selectedUserType)
  },

  selectRegisterUserType(userType) {
    this.globalData.selectedUserType = userType
    wx.setStorageSync(AUTH_STORAGE.selectedUserType, userType)
    if (!this.globalData.registered) {
      wx.setStorageSync(AUTH_STORAGE.userType, '')
      wx.setStorageSync(AUTH_STORAGE.registered, '')
    }
  },

  completeRegistration(userType) {
    const subjectTypes = [...new Set([...(this.globalData.subjectTypes || wx.getStorageSync(AUTH_STORAGE.subjectTypes) || []), userType])]
    this.globalData.registered = true
    this.globalData.userType = userType
    this.globalData.subjectTypes = subjectTypes
    this.globalData.selectedUserType = ''
    wx.setStorageSync(AUTH_STORAGE.userType, userType)
    wx.setStorageSync(AUTH_STORAGE.subjectTypes, subjectTypes)
    wx.setStorageSync(AUTH_STORAGE.registered, '1')
    wx.removeStorageSync(AUTH_STORAGE.selectedUserType)
    this.initRoleServices()
  },

  switchSubject(userType, cb) {
    if (!['athlete', 'boss', 'venue', 'admin'].includes(userType)) {
      if (cb) cb({ code: -1, msg: '无效的主体类型' })
      return
    }
    wx.cloud.callFunction({
      name: 'switchSubject',
      data: { userType },
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0 && result.user) {
          this.applyAuthState(result.user)
          this.initRoleServices()
        }
        if (cb) cb(result)
      },
      fail: (err) => {
        if (cb) cb({ code: -1, msg: err.errMsg || '切换失败' })
      }
    })
  },

  goSubjectHome(userType) {
    const url = SUBJECT_HOME[userType] || '/pages/market/market'
    wx.reLaunch({ url })
  },

  initRoleServices() {
    const { openid, userType } = this.globalData
    if (!openid) return
    // 无条件关闭老板专属监听器（防止角色切换后残留）
    if (this._orderWatcher) { this._orderWatcher.close(); this._orderWatcher = null }
    if (this._eventWatcher) { this._eventWatcher.close(); this._eventWatcher = null }
    this.startUnreadWatcher(openid)
    this.startNotifWatcher(openid)
    this.startUnreadPolling()
    this.loadSubscribeTemplates()
    if (userType === 'boss') {
      wx.setTabBarItem({ index: 0, text: '招募' })
      wx.setTabBarItem({ index: 3, text: '合作', iconPath: 'images/icons/cooperation.png', selectedIconPath: 'images/icons/cooperation-active.png' })
      this.startApplicantWatcher(openid)
    } else {
      wx.setTabBarItem({ index: 0, text: '战役' })
      wx.setTabBarItem({ index: 3, text: '消息', iconPath: 'images/icons/message.png', selectedIconPath: 'images/icons/message-active.png' })
    }
  },

  loadSubscribeTemplates() {
    wx.cloud.callFunction({
      name: 'getPlatformSettings',
      success: (res) => {
        const data = res.result && res.result.data || {}
        wx.setStorageSync('subscribeTemplates', data.subscribeTemplates || {})
      }
    })
  },

  onLoginReady(cb) {
    if (this.globalData.loginReady) {
      cb()
    } else {
      if (!this._loginCallbacks) this._loginCallbacks = []
      this._loginCallbacks.push(cb)
    }
  },

  startUnreadWatcher(openid) {
    if (this._unreadWatcher) this._unreadWatcher.close()
    const db = wx.cloud.database()
    this._unreadWatcher = db.collection('messages')
      .where({ toOpenid: openid, read: false })
      .watch({
        onChange: () => this.refreshUnreadBadge(),
        onError: () => {}
      })
  },

  startNotifWatcher(openid) {
    if (this._notifWatcher) this._notifWatcher.close()
    const db = wx.cloud.database()
    this._notifWatcher = db.collection('notifications')
      .where({ toOpenid: openid, read: false })
      .watch({
        onChange: (snapshot) => {
          const count = snapshot.docs.length
          this.globalData.notifUnread = count
          const pages = getCurrentPages()
          pages.forEach(p => {
            if (typeof p.onNotifUnreadUpdate === 'function') p.onNotifUnreadUpdate(count)
          })
          this.refreshUnreadBadge()
        },
        onError: () => {}
      })
  },

  startApplicantWatcher(openid) {
    if (this._orderWatcher) this._orderWatcher.close()
    if (this._eventWatcher) this._eventWatcher.close()
    const db = wx.cloud.database()
    const onApplicantChange = () => {
      this.refreshApplicantBadge()
      const pages = getCurrentPages()
      if (pages.length) {
        const page = pages[pages.length - 1]
        if (typeof page.onApplicantUpdate === 'function') page.onApplicantUpdate()
      }
    }
    this._orderWatcher = db.collection('orders')
      .where({ bossOpenid: openid })
      .watch({ onChange: onApplicantChange, onError: () => {} })
    this._eventWatcher = db.collection('posts')
      .where({ openid: openid, postType: 'event' })
      .watch({ onChange: onApplicantChange, onError: () => {} })
  },

  startUnreadPolling() {
    this.refreshUnreadBadge()
    this.refreshApplicantBadge()
    if (this.unreadTimer) clearInterval(this.unreadTimer)
    this.unreadTimer = setInterval(() => {
      this.refreshUnreadBadge()
      this.refreshApplicantBadge()
    }, 60000)
  },

  refreshUnreadBadge() {
    wx.cloud.callFunction({
      name: 'getUnreadCount',
      success: (res) => {
        if (res.result && res.result.code === 0) {
          const count = res.result.count || 0
          this.globalData.totalUnread = count
          if (typeof res.result.notificationCount === 'number') {
            this.globalData.notifUnread = res.result.notificationCount
          }
          // 球员：消息 tab 显示聊天 + 系统通知未读；老板：badge 由 refreshApplicantBadge 管理
          const userType = this.globalData.userType || ''
          if (userType !== 'boss') {
            if (count > 0) {
              wx.setTabBarBadge({ index: 3, text: count > 99 ? '99+' : String(count) })
            } else {
              wx.removeTabBarBadge({ index: 3 })
            }
          }
          this._broadcastUnread(count)
        }
      }
    })
  },

  // 把最新 unread count 推给当前活跃页面
  _broadcastUnread(count) {
    const pages = getCurrentPages()
    if (!pages.length) return
    const page = pages[pages.length - 1]
    if (typeof page.onUnreadUpdate === 'function') {
      page.onUnreadUpdate(count)
    }
  },

  refreshApplicantBadge() {
    const userType = this.globalData.userType || wx.getStorageSync('userType') || ''
    if (userType !== 'boss') return
    wx.cloud.callFunction({
      name: 'getApplicantNotifCount',
      success: (res) => {
        if (res.result && res.result.code === 0) {
          const count = res.result.count || 0
          if (count > 0) {
            wx.setTabBarBadge({ index: 2, text: count > 99 ? '99+' : String(count) })
          } else {
            wx.removeTabBarBadge({ index: 2 })
          }
        }
      }
    })
  },

  logout() {
    // 废弃所有进行中的 cloudLogin 回调
    this._authGeneration++

    // 关闭所有数据库监听
    if (this._unreadWatcher) { this._unreadWatcher.close(); this._unreadWatcher = null }
    if (this._notifWatcher) { this._notifWatcher.close(); this._notifWatcher = null }
    if (this._orderWatcher) { this._orderWatcher.close(); this._orderWatcher = null }
    if (this._eventWatcher) { this._eventWatcher.close(); this._eventWatcher = null }

    // 清除定时器
    if (this.unreadTimer) { clearInterval(this.unreadTimer); this.unreadTimer = null }

    // 清除 TabBar 角标
    wx.removeTabBarBadge({ index: 1 })
    wx.removeTabBarBadge({ index: 2 })
    wx.removeTabBarBadge({ index: 3 })

    // 清除全部本地缓存（确保彻底退出）
    wx.clearStorageSync()

    // 重新写入强制退出标记（clearStorage 会清掉，需要重新设置）
    wx.setStorageSync('_forceLogout', '1')

    // 重置全局状态
    this.globalData.openid = ''
    this.globalData.userId = ''
    this.globalData.openidReady = false
    this.globalData.registered = false
    this.globalData.userType = ''
    this.globalData.subjectTypes = []
    this.globalData.selectedUserType = ''
    this.globalData.userInfo = null
    this.globalData.loginReady = false
    this.globalData.totalUnread = 0
    this.globalData.notifUnread = 0
    this.globalData.isPlatformAdmin = false
    this.globalData.activityAdmin = false
  },

  globalData: {
    openid: '',
    userId: '',
    openidReady: false,
    registered: false,
    userType: '',
    subjectTypes: [],
    selectedUserType: '',
    userInfo: null,
    loginReady: false,
    totalUnread: 0,
    notifUnread: 0,
    isPlatformAdmin: false,
    activityAdmin: false
  }
})
