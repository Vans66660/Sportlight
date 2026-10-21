const security = require('../../utils/security')

const TYPE_MAP = {
  match_result: '⚔️ 赛果',
  training: '💪 训练',
  collab: '📣 合作',
  general: '💬 日常',
  event: '🏆 赛事'
}

Page({
  data: {
    user: {},
    profile: {},
    userType: '',
    isRegistered: false,
    identityVerified: false,
    accountIdentityLabel: '',
    accountPhoneVerified: false,
    myTeams: [],
    cardCount: 0,
    unseenCardCount: 0,
    showcaseCards: [],
    badgeExpanded: false,
    selectedBadge: null,
    isPlatformAdmin: false,
    bossGuide: { visible: false, completedCount: 0, totalCount: 3, items: [], next: null }
  },

  onLoad() {
    this.loadProfile()
    this.setData({ isPlatformAdmin: !!(getApp().globalData.isPlatformAdmin) })
  },

  onShow() {
    const app = getApp()
    const userType = app.globalData.userType || wx.getStorageSync('userType') || ''
    this.setData({ isPlatformAdmin: !!(app.globalData.isPlatformAdmin) })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const tabBar = this.getTabBar()
      const selected = userType === 'boss' ? 3 : 4
      if (typeof tabBar.syncRole === 'function') tabBar.syncRole({ selected })
      else tabBar.setData({ selected })
    }
    // 退出登录后不加载资料
    if (wx.getStorageSync('_forceLogout') === '1') {
      this.setData({ isRegistered: false, user: {}, profile: {}, userType: '' })
      return
    }
    if (wx.getStorageSync('_identityVerified') === '1') {
      this.setData({ identityVerified: true })
    }
    this.loadProfile()
  },

  loadProfile() {
    // 二次校验：未注册/已退出的状态不请求云函数
    if (wx.getStorageSync('_forceLogout') === '1') {
      this.setData({ isRegistered: false, user: {}, profile: {}, userType: '' })
      return
    }
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getMyProfile',
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          const { userType, profile } = res.result
          if (userType === 'athlete' && profile) {
            const showcaseCards = (profile.showcaseCards || profile.cardShowcase || []).slice(0, 6).map(card => ({
              ...card,
              _showBack: false
            }))
            const cardCount = Number(profile.cardCount || (profile.cards || []).length || showcaseCards.length || 0)
            const unseenCardCount = Number(profile.unseenCardCount || 0)
            const identityVerified = !!profile.identityVerified || !!profile.realNameVerified || profile.realNameStatus === '已实名'
            this.syncIdentityCache(identityVerified)
            this.setData({
              user: profile,
              userType,
              isRegistered: true,
              identityVerified,
              accountIdentityLabel: '运动员',
              accountPhoneVerified: !!profile.phoneVerified,
              cardCount,
              unseenCardCount,
              showcaseCards
            }, () => this.loadMyTeams())
          } else if (userType === 'boss' && profile) {
            const identityVerified = !!profile.identityVerified || !!profile.realNameVerified || profile.realNameStatus === '已实名'
            this.syncIdentityCache(identityVerified)
            profile.recentPosts = (profile.recentPosts || []).map(p => ({
              ...p,
              typeLabel: TYPE_MAP[p.type] || '💬 日常',
              timeLabel: this.timeAgo(p.createdAt)
            }))
            this.setData({
              profile,
              userType,
              isRegistered: true,
              identityVerified,
              accountIdentityLabel: '主办方',
              accountPhoneVerified: !!profile.phoneVerified
            }, () => this.buildBossGuide())
          } else {
            this.syncIdentityCache(false)
            this.setData({
              isRegistered: false,
              accountIdentityLabel: '',
              accountPhoneVerified: false
            })
          }
        } else {
          this.syncIdentityCache(false)
          this.setData({
            isRegistered: false,
            accountIdentityLabel: '',
            accountPhoneVerified: false
          })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        this.syncIdentityCache(false)
        this.setData({
          isRegistered: false,
          accountIdentityLabel: '',
          accountPhoneVerified: false
        })
        console.error('获取个人资料失败', err)
      }
    })
  },

  syncIdentityCache(identityVerified) {
    if (identityVerified) {
      wx.setStorageSync('_identityVerified', '1')
    } else {
      wx.removeStorageSync('_identityVerified')
    }
  },

  loadMyTeams() {
    wx.cloud.callFunction({
      name: 'getMyTeams',
      success: res => {
        const result = res.result || {}
        if (result.code === 0) this.setData({ myTeams: (result.data || []).slice(0, 3) })
      }
    })
  },

  goEdit() {
    if (this.data.userType === 'boss') {
      wx.navigateTo({ url: '/pages/edit-boss-profile/edit-boss-profile' })
    } else {
      wx.setStorageSync('editProfileForm', this.data.user)
      wx.navigateTo({ url: '/pages/edit-profile/edit-profile' })
    }
  },

  goMyPosts() {
    wx.setStorageSync('bossManageTab', 'orders')
    wx.switchTab({ url: '/pages/my-orders/my-orders' })
  },

  buildBossGuide() {
    const profile = this.data.profile || {}
    const recentPosts = profile.recentPosts || []
    const manageViewed = !!wx.getStorageSync(`bossGuideManageViewed:${profile._id || profile.openid || 'current'}`)
    const items = [
      {
        key: 'profile',
        step: '01',
        title: '完善主体资料',
        desc: '补充头像、城市和主体介绍，先让合作方确认你是谁。',
        actionLabel: '去完善资料',
        done: !!(profile.logo && profile.city && profile.description)
      },
      {
        key: 'publish',
        step: '02',
        title: '发布第一条需求',
        desc: '发布赛事或合作需求，开始获得报名与合作线索。',
        actionLabel: '去发布',
        done: Number(profile.orderCount || 0) > 0 || recentPosts.length > 0
      },
      {
        key: 'manage',
        step: '03',
        title: '查看发布管理',
        desc: '在发布管理中处理报名、沟通，并跟进赛事进度。',
        actionLabel: '查看发布管理',
        done: manageViewed
      }
    ]
    const completedCount = items.filter(item => item.done).length
    const next = items.find(item => !item.done) || null
    this.setData({
      bossGuide: {
        visible: completedCount < items.length,
        completedCount,
        totalCount: items.length,
        items,
        next
      }
    })
  },

  goBossGuideStep(e) {
    const step = e.currentTarget.dataset.step
    if (step === 'profile') {
      this.goEdit()
      return
    }
    if (step === 'publish') {
      wx.showActionSheet({
        itemList: ['发布赛事', '发布合作需求'],
        success: res => {
          const url = res.tapIndex === 0
            ? '/pages/publish-event/publish-event'
            : '/pages/publish-order/publish-order'
          wx.navigateTo({ url })
        }
      })
      return
    }
    if (step === 'manage') {
      const profile = this.data.profile || {}
      wx.setStorageSync(`bossGuideManageViewed:${profile._id || profile.openid || 'current'}`, true)
      this.buildBossGuide()
      this.goMyPosts()
    }
  },

  goPostDetail(e) {
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${e.currentTarget.dataset.id}` })
  },

  timeAgo(dateStr) {
    if (!dateStr) return ''
    const diff = Date.now() - new Date(dateStr).getTime()
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


  addSocial() {
    wx.setStorageSync('editProfileForm', this.data.user)
    wx.navigateTo({ url: '/pages/edit-profile/edit-profile' })
  },

  addHighlight() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image', 'video'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath
        const isVideo = res.tempFiles[0].fileType === 'video'

        if (isVideo) {
          const thumbPath = res.tempFiles[0].thumbTempFilePath
          const ts = Date.now()
          wx.showLoading({ title: '压缩中...' })
          wx.compressVideo({
            src: tempPath,
            quality: 'medium',
            success: async (compressRes) => {
              const compressedThumbPath = thumbPath ? await security.compressImageForAudit(thumbPath) : ''
              wx.showLoading({ title: '上传中...' })
              const uploadVideo = wx.cloud.uploadFile({ cloudPath: `highlights/${ts}.mp4`, filePath: compressRes.tempFilePath })
              const uploadThumb = compressedThumbPath ? wx.cloud.uploadFile({ cloudPath: `highlights/${ts}_thumb.jpg`, filePath: compressedThumbPath }) : Promise.resolve(null)
              Promise.all([uploadVideo, uploadThumb]).then(async ([videoRes, thumbRes]) => {
                // 视频缩略图安全检测
                if (thumbRes && thumbRes.fileID) {
                  const thumbSafe = await security.checkImage(thumbRes.fileID)
                  if (!thumbSafe) {
                    wx.hideLoading()
                    return
                  }
                }
                const highlights = [...(this.data.user.highlights || [])]
                highlights.push({ src: videoRes.fileID, poster: thumbRes ? thumbRes.fileID : '', isVideo: true, label: '' })
                wx.cloud.callFunction({
                  name: 'updateProfile',
                  data: { profileData: { ...this.data.user, highlights } },
                  success: () => {
                    wx.hideLoading()
                    this.setData({ 'user.highlights': highlights })
                    wx.showToast({ title: '添加成功', icon: 'success' })
                  },
                  fail: () => {
                    wx.hideLoading()
                    wx.showToast({ title: '保存失败', icon: 'none' })
                  }
                })
              }).catch(() => {
                wx.hideLoading()
                wx.showToast({ title: '上传失败', icon: 'none' })
              })
            },
            fail: () => {
              wx.hideLoading()
              wx.showToast({ title: '压缩失败', icon: 'none' })
            }
          })
        } else {
          wx.cropImage({
            src: tempPath,
            cropScale: '1:1',
            success: async (cropRes) => {
              const filePath = await security.compressImageForAudit(cropRes.tempFilePath)
              const cloudPath = `highlights/${Date.now()}.jpg`
              wx.showLoading({ title: '上传中...' })
              wx.cloud.uploadFile({
                cloudPath,
                filePath,
                success: async (uploadRes) => {
                  // 图片安全检测
                  const safe = await security.checkImage(uploadRes.fileID)
                  if (!safe) {
                    wx.hideLoading()
                    return
                  }
                  const highlights = [...(this.data.user.highlights || [])]
                  highlights.push({ src: uploadRes.fileID, isVideo: false, label: '' })
                  wx.cloud.callFunction({
                    name: 'updateProfile',
                    data: { profileData: { ...this.data.user, highlights } },
                    success: () => {
                      wx.hideLoading()
                      this.setData({ 'user.highlights': highlights })
                      wx.showToast({ title: '添加成功', icon: 'success' })
                    },
                    fail: () => {
                      wx.hideLoading()
                      wx.showToast({ title: '保存失败', icon: 'none' })
                    }
                  })
                },
                fail: () => {
                  wx.hideLoading()
                  wx.showToast({ title: '上传失败', icon: 'none' })
                }
              })
            }
          })
        }
      }
    })
  },

  deleteHighlight(e) {
    const index = e.currentTarget.dataset.index
    wx.showModal({
      title: '删除高光',
      content: '确认删除这个高光时刻吗？',
      confirmText: '删除',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (res.confirm) {
          const highlights = [...this.data.user.highlights]
          highlights.splice(index, 1)
          wx.showLoading({ title: '删除中...' })
          wx.cloud.callFunction({
            name: 'updateProfile',
            data: { profileData: { ...this.data.user, highlights } },
            success: () => {
              wx.hideLoading()
              this.setData({ 'user.highlights': highlights })
              wx.showToast({ title: '已删除', icon: 'success' })
            },
            fail: () => {
              wx.hideLoading()
              wx.showToast({ title: '删除失败', icon: 'none' })
            }
          })
        }
      }
    })
  },

  previewHighlight(e) {
    const index = e.currentTarget.dataset.index
    const sources = this.data.user.highlights.map(h => ({
      url: h.src,
      type: h.isVideo ? 'video' : 'image'
    }))
    wx.previewMedia({ sources, current: index })
  },

  goPublishPost() {
    wx.navigateTo({ url: '/pages/publish-post/publish-post' })
  },

  goEventDetail(e) {
    const postId = e.currentTarget.dataset.id
    if (postId) wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${postId}` })
  },

  goOrderDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` })
  },

  goRegister() {
    // 标记从 profile 页跳转，防止登录页自动重定向
    wx.setStorageSync('_fromProfileRegister', '1')

    wx.navigateTo({
      url: '/pages/login/login',
      fail: () => {
        // navigateTo 失败时用 redirectTo 兜底
        wx.redirectTo({
          url: '/pages/login/login',
          fail: () => {
            // 最后用 reLaunch 兜底
            wx.reLaunch({ url: '/pages/login/login' })
          }
        })
      }
    })
  },

  goMarket() {
    wx.switchTab({ url: '/pages/market/market' })
  },

  goMessages() {
    wx.navigateTo({ url: '/pages/messages/messages' })
  },

  goMyOrders() {
    wx.switchTab({ url: '/pages/my-orders/my-orders' })
  },

  goMyTeams() {
    wx.navigateTo({ url: '/pages/my-teams/my-teams' })
  },

  goCardPack() {
    if (this.data.userType !== 'athlete') return
    wx.navigateTo({ url: '/pages/card-pack/card-pack' })
  },

  flipShowcaseCard(e) {
    const index = Number(e.currentTarget.dataset.index)
    const card = this.data.showcaseCards[index]
    if (!card) return
    if (!card.backImage) {
      wx.showToast({ title: '这张旧卡暂无背面', icon: 'none' })
      return
    }
    this.setData({ [`showcaseCards[${index}]._showBack`]: !card._showBack })
  },

  goScoreDetails() {
    if (this.data.userType !== 'athlete') return
    wx.navigateTo({ url: '/pages/score-details/score-details' })
  },

  goMatchStats(e) {
    if (this.data.userType !== 'athlete') return
    const tab = e.currentTarget.dataset.tab || 'all'
    wx.navigateTo({ url: `/pages/player-match-stats/player-match-stats?tab=${tab}` })
  },

  toggleBadges() {
    this.setData({ badgeExpanded: !this.data.badgeExpanded })
  },

  openBadgeDetail(e) {
    const index = Number(e.currentTarget.dataset.index)
    const badge = (this.data.user.tournamentBadges || [])[index]
    if (badge) this.setData({ selectedBadge: badge })
  },

  closeBadgeDetail() {
    this.setData({ selectedBadge: null })
  },

  copySportlightId() {
    const id = this.data.user && this.data.user.sportlightId
    if (!id) return
    wx.setClipboardData({
      data: id,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  goTeamHome(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/team-home/team-home?teamId=${id}` })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/account-settings/account-settings' })
  },

  goAdminHub() {
    const app = getApp()
    app.switchSubject('admin', (res) => {
      if (res.code === 0) {
        app.goSubjectHome('admin')
      } else {
        wx.showToast({ title: res.msg || '切换失败', icon: 'none' })
      }
    })
  },

  showAgreement() {
    wx.navigateTo({ url: '/pages/legal/legal?type=agreement' })
  },

  showPrivacy() {
    wx.navigateTo({ url: '/pages/legal/legal?type=privacy' })
  },

  switchAccount() {
    const app = getApp()
    app.logout()
    wx.reLaunch({ url: '/pages/login/login' })
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
  },

})
