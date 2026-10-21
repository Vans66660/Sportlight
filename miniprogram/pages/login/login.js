Page({
  data: {
    mode: 'login',       // 'login' | 'register'
    selected: '',
    showSkip: true,
    loggingIn: false,
    loginSuccess: false,
    userId: '',
    registerHint: false,
    userProfile: {},
    maskedOpenid: '',
    agreedPrivacy: false
  },

  onLoad() {
    const app = getApp()

    // 从 profile 页「立即入驻」进入时，标记强制登录模式
    const fromProfileRegister = wx.getStorageSync('_fromProfileRegister') === '1'
    if (fromProfileRegister) {
      wx.removeStorageSync('_fromProfileRegister')
      this.setData({ showSkip: true })
      app.globalData.registered = false
      app.globalData.userType = ''
      wx.removeStorageSync('registered')
      wx.removeStorageSync('userType')
      return
    }

    const selected = app.globalData.selectedUserType || wx.getStorageSync('selectedRegisterUserType') || ''
    if (selected) this.setData({ selected })

    app.onLoginReady(() => {
      if (app.globalData.userType === 'admin') {
        wx.reLaunch({ url: '/pages/admin-hub/admin-hub' })
      } else if (app.globalData.registered && app.globalData.userType) {
        if (app.globalData.userType === 'venue') {
          wx.redirectTo({ url: '/pages/venue-manage/venue-manage' })
        } else {
          wx.switchTab({ url: '/pages/market/market' })
        }
      } else {
        const selected = app.globalData.selectedUserType || wx.getStorageSync('selectedRegisterUserType') || ''
        if (selected) this.setData({ selected })
      }
    })
  },

  onShow() {
    this.setData({
      agreedPrivacy: wx.getStorageSync('_sportlightLegalConsentAccepted') === '1',
      loggingIn: false
    })
    wx.hideLoading()
  },

  // ===== 切换到注册页 =====
  goToRegister() {
    this.setData({ mode: 'register' })
  },

  // ===== 返回登录页 =====
  goBackToLogin() {
    this.setData({ mode: 'login', loggingIn: false })
    wx.hideLoading()
  },

  // ===== 快捷登录 =====
  wechatLogin() {
    if (this.data.loggingIn) return
    if (!this.data.agreedPrivacy) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' })
      return
    }
    this.setData({ loggingIn: true, loginSuccess: false })

    wx.showLoading({ title: '正在登录...', mask: true })

    wx.login({
      success: (loginRes) => {
        const code = loginRes.code
        if (!code) {
          wx.hideLoading()
          this.setData({ loggingIn: false })
          wx.showModal({
            title: '登录失败',
            content: '无法获取登录凭证，请在小程序内重试',
            showCancel: false
          })
          return
        }

        wx.cloud.callFunction({
          name: 'login',
          data: { code: code },
          success: (res) => {
            wx.hideLoading()
            this.handleLoginResult(res)
          },
          fail: (err) => {
            wx.hideLoading()
            this.setData({ loggingIn: false })
            console.error('云函数调用失败:', err)
            wx.showModal({
              title: '登录失败',
              content: '网络异常或云函数未部署。\n请在开发者工具中上传部署 cloudfunctions/login 后重试。',
              confirmText: '重试',
              cancelText: '取消',
              success: (modalRes) => {
                if (modalRes.confirm) this.wechatLogin()
              }
            })
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ loggingIn: false })
        wx.showModal({
          title: '登录失败',
          content: '登录组件调用失败，请在小程序内重试',
          showCancel: false
        })
      }
    })
  },

  handleLoginResult(res) {
    if (!res || !res.result) {
      this.setData({ loggingIn: false })
      wx.showToast({ title: '服务异常，请重试', icon: 'none' })
      return
    }

    const { code, msg, user } = res.result

    if (code !== 0 || !user || !user.openid) {
      this.setData({ loggingIn: false })
      wx.showModal({
        title: '登录失败',
        content: msg || '未能获取身份信息',
        showCancel: false,
        confirmText: '我知道了'
      })
      return
    }

    const app = getApp()
    app.applyAuthState(user)
    app.globalData.loginReady = true

    const cbs = app._loginCallbacks || []
    app._loginCallbacks = []
    cbs.forEach(cb => cb())

    const openid = user.openid || ''
    const maskedOpenid = openid.length > 6
      ? openid.slice(0, 3) + '****' + openid.slice(-3)
      : openid

    if (user.userType === 'admin') {
      wx.showToast({ title: '登录成功', icon: 'success', duration: 1000 })
      try { app.initRoleServices() } catch (e) {}
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/admin-hub/admin-hub' })
      }, 600)
    } else if (user.registered && user.userType) {
      wx.removeStorageSync('_forceLogout')
      wx.showToast({ title: '登录成功', icon: 'success', duration: 1000 })
      this.fetchMyProfile(openid)
      try { app.initRoleServices() } catch (e) {}
      setTimeout(() => {
        if (user.userType === 'venue') {
          wx.redirectTo({ url: '/pages/venue-manage/venue-manage' })
        } else {
          wx.switchTab({ url: '/pages/market/market' })
        }
      }, 600)
    } else {
      // 新用户 → 跳转到身份选择
      wx.removeStorageSync('_forceLogout')
      this.fetchMyProfile(openid)
      this.setData({ loggingIn: false })
      setTimeout(() => {
        this.setData({ mode: 'register', registerHint: true })
      }, 800)
    }
  },

  fetchMyProfile(openid) {
    wx.cloud.callFunction({
      name: 'getMyProfile',
      success: (res) => {
        if (res.result && res.result.code === 0) {
          const { profile } = res.result
          if (profile && (profile.name || profile.photo || profile.logo)) {
            this.setData({
              userProfile: {
                name: profile.name || '',
                photo: profile.photo || profile.logo || '',
                userType: res.result.userType || ''
              }
            })
          }
        }
      },
      fail: () => {}
    })
  },

  // ===== 身份选择 =====
  selectIdentity(e) {
    this.setData({ selected: e.currentTarget.dataset.type })
  },

  goNext() {
    const { selected } = this.data
    if (!selected) {
      wx.showToast({ title: '请先选择身份', icon: 'none' })
      return
    }
    wx.removeStorageSync('_forceLogout')
    this.setData({ loggingIn: false })
    wx.hideLoading()
    const app = getApp()
    if (typeof app.selectRegisterUserType === 'function') {
      app.selectRegisterUserType(selected)
    } else {
      wx.setStorageSync('selectedRegisterUserType', selected)
      wx.setStorageSync('userType', '')
      wx.setStorageSync('registered', '')
    }
    wx.navigateTo({
      url: selected === 'athlete'
        ? '/pages/register-athlete/register-athlete'
        : selected === 'venue'
          ? '/pages/register-venue/register-venue'
          : '/pages/register-boss/register-boss'
    })
  },

  goSkip() {
    wx.switchTab({ url: '/pages/market/market' })
  },

  // ===== 隐私协议 =====
  toggleAgreement() {
    const nextAgreed = !this.data.agreedPrivacy
    if (nextAgreed) {
      wx.setStorageSync('_sportlightLegalConsentAccepted', '1')
    } else {
      wx.removeStorageSync('_sportlightLegalConsentAccepted')
    }
    this.setData({ agreedPrivacy: nextAgreed })
  },

  openUserAgreement() {
    wx.navigateTo({ url: '/pages/legal/legal?type=agreement' })
  },

  openPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/legal/legal?type=privacy' })
  }
})
