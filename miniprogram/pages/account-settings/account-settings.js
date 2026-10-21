Page({
  data: {
    user: {},
    profile: {},
    userType: '',
    subjectTypes: [],
    accountIdentityLabel: '',
    accountPhoneVerified: false,
    accountIdentityVerified: false
  },

  onLoad() {
    this.loadProfile()
  },

  loadProfile() {
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getMyProfile',
      success: (res) => {
        wx.hideLoading()
        if (!res.result || res.result.code !== 0) {
          this.handleProfileMissing()
          return
        }

        const { userType, profile, subjectTypes = [] } = res.result
        const idVerified = !!((profile && (profile.identityVerified || profile.realNameVerified || profile.realNameStatus === '已实名')));
        if (userType === 'athlete' && profile) {
          this.setData({
            user: profile,
            profile: {},
            userType,
            subjectTypes,
            accountIdentityLabel: '运动员',
            accountPhoneVerified: !!profile.phoneVerified,
		    accountIdentityVerified: idVerified
          })
        } else if (userType === 'boss' && profile) {
          this.setData({
            user: {},
            profile,
            userType,
            subjectTypes,
            accountIdentityLabel: '主办方',
            accountPhoneVerified: !!profile.phoneVerified,
		    accountIdentityVerified: idVerified
          })
        } else if (userType === 'venue' && profile) {
          this.setData({
            user: {},
            profile,
            userType,
            subjectTypes,
            accountIdentityLabel: '球馆方',
            accountPhoneVerified: !!profile.phoneVerified,
		    accountIdentityVerified: idVerified
          })
        } else {
          this.handleProfileMissing()
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('获取设置资料失败', err)
        this.handleProfileMissing()
      }
    })
  },

  handleProfileMissing() {
    wx.showToast({ title: '请先登录入驻', icon: 'none' })
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/login/login' })
    }, 600)
  },

  bindPhone(e) {
    const { errMsg, code } = e.detail || {}
    if (!errMsg || !errMsg.includes('ok')) {
      wx.showToast({ title: '需要授权手机号才能绑定', icon: 'none' })
      return
    }
    if (!code) {
      wx.showToast({ title: '当前微信版本不支持手机号授权', icon: 'none' })
      return
    }

    wx.showLoading({ title: '绑定中...' })
    wx.cloud.callFunction({
      name: 'bindPhone',
      data: { code },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          this.setData({ accountPhoneVerified: true })
          wx.showToast({ title: '手机号已绑定', icon: 'success' })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '绑定失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('绑定手机号失败', err)
        wx.showToast({ title: '网络错误，请重试', icon: 'none' })
      }
    })
  },

  showPhoneBoundInfo() {
    wx.showModal({
      title: '手机号已绑定',
      content: '手机号用于赛事报名、订单沟通与必要的账号安全验证。如需更换手机号，请联系平台客服处理。',
      confirmText: '我知道了',
      showCancel: false
    })
  },

  goVerifyIdentity() {
    wx.navigateTo({ url: '/pages/verify-identity/verify-identity' })
  },

  goEdit() {
    if (this.data.userType === 'boss') {
      wx.navigateTo({ url: '/pages/edit-boss-profile/edit-boss-profile' })
      return
    }
    if (this.data.userType === 'venue') {
      wx.navigateTo({ url: '/pages/venue-workbench-detail/venue-workbench-detail?panel=homepage' })
      return
    }

    wx.setStorageSync('editProfileForm', this.data.user)
    wx.navigateTo({ url: '/pages/edit-profile/edit-profile' })
  },

  goMyPosts() {
    wx.navigateTo({ url: '/pages/my-posts/my-posts' })
  },

  goMyOrders() {
    if (this.data.userType === 'venue') {
      wx.navigateTo({ url: '/pages/venue-manage/venue-manage' })
      return
    }
    wx.switchTab({ url: '/pages/my-orders/my-orders' })
  },

  goMessages() {
    wx.navigateTo({ url: '/pages/messages/messages' })
  },

  showAgreement() {
    wx.navigateTo({ url: '/pages/legal/legal?type=agreement' })
  },

  showPrivacy() {
    wx.navigateTo({ url: '/pages/legal/legal?type=privacy' })
  },

  showPrivacySettings() {
    wx.showModal({
      title: '隐私授权管理',
      content: '您可在系统设置中管理相册、通知等授权。如需撤回肖像权商业使用授权，请联系平台客服 15877659702，我们将在7个工作日内处理。',
      confirmText: '我知道了',
      showCancel: false
    })
  },

  requestAccountCancellation() {
    wx.showModal({
      title: '注销账号申请',
      content: '账号注销会停止平台服务并按隐私政策处理个人信息。请联系平台客服 15877659702 提交注销申请。',
      confirmText: '我知道了',
      showCancel: false
    })
  },

  switchSubject() {
    const labels = {
      athlete: '运动员',
      boss: '主办方',
      venue: '球馆方'
    }
    const registerRoutes = {
      athlete: '/pages/register-athlete/register-athlete',
      boss: '/pages/register-boss/register-boss',
      venue: '/pages/register-venue/register-venue'
    }
    const subjectTypes = this.data.subjectTypes || []
    const subjects = ['athlete', 'boss', 'venue']
    const actions = subjects.map(type => ({
      type,
      registered: subjectTypes.includes(type),
      label: subjectTypes.includes(type)
        ? `${this.data.userType === type ? '当前：' : '切换到'}${labels[type]}`
        : `入驻${labels[type]}`
    }))

    wx.showActionSheet({
      itemList: actions.map(item => item.label),
      success: (res) => {
        const action = actions[res.tapIndex]
        if (!action || action.type === this.data.userType) return
        const app = getApp()
        if (!action.registered) {
          app.selectRegisterUserType(action.type)
          wx.navigateTo({ url: registerRoutes[action.type] })
          return
        }
        wx.showLoading({ title: '切换中...' })
        app.switchSubject(action.type, (result) => {
          wx.hideLoading()
          if (result.code === 0) {
            wx.showModal({
              title: `已切换为${labels[action.type]}`,
              content: `你正在使用${labels[action.type]}主体，页面和可用功能已同步切换。`,
              confirmText: '进入工作台',
              showCancel: false,
              success: () => app.goSubjectHome(action.type)
            })
            return
          }
          wx.showToast({ title: result.msg || '切换失败', icon: 'none' })
        })
      }
    })
  },

  logout() {
    wx.showModal({
      title: '确认退出',
      content: '退出账号后需要重新登录，确认退出吗？',
      confirmText: '退出',
      confirmColor: '#FF6B1A',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          const app = getApp()
          app.logout()
          wx.reLaunch({ url: '/pages/login/login' })
        }
      }
    })
  }
})
