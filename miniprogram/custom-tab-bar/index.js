const app = getApp()

const ATHLETE_TABS = [
  { text: '战役', icon: '/images/icons/battle.png', activeIcon: '/images/icons/battle-active.png' },
  { text: '动态', icon: '/images/icons/home.png', activeIcon: '/images/icons/home-active.png' },
  { text: '约场', icon: '/images/icons/VS.png', activeIcon: '/images/icons/VS.png' },
  { text: '消息', icon: '/images/icons/chat.png', activeIcon: '/images/icons/chat-active.png' },
  { text: '我的', icon: '/images/icons/usercenter.png', activeIcon: '/images/icons/usercenter-active.png' }
]

const ATHLETE_PATHS = [
  '/pages/market/market',
  '/pages/feed/feed',
  '/pages/match/match',
  '/pages/my-orders/my-orders',
  '/pages/profile/profile'
]

const BOSS_TABS = [
  { text: '探照', icon: '/images/icons/flashlight.png', activeIcon: '/images/icons/flashlight-active.png' },
  { text: '动态', icon: '/images/icons/home.png', activeIcon: '/images/icons/home-active.png' },
  { text: '比赛', icon: '/images/icons/goods.png', activeIcon: '/images/icons/goods-active.png' },
  { text: '我的', icon: '/images/icons/usercenter.png', activeIcon: '/images/icons/usercenter-active.png' }
]

const BOSS_PATHS = [
  '/pages/market/market',
  '/pages/feed/feed',
  '/pages/my-orders/my-orders',
  '/pages/profile/profile'
]

Component({
  data: {
    selected: 0,
    isBoss: false,
    showPublishSheet: false,
    tabs: ATHLETE_TABS,
    paths: ATHLETE_PATHS
  },

  lifetimes: {
    attached() {
      this.syncRole()
    }
  },

  methods: {
    syncRole(options = {}) {
      const userType = app.globalData.userType || wx.getStorageSync('userType') || ''
      if (userType === 'boss') {
        this.setData({
          isBoss: true,
          tabs: BOSS_TABS,
          paths: BOSS_PATHS,
          ...(typeof options.selected === 'number' ? { selected: options.selected } : {})
        })
      } else {
        this.setData({
          isBoss: false,
          tabs: ATHLETE_TABS,
          paths: ATHLETE_PATHS,
          ...(typeof options.selected === 'number' ? { selected: options.selected } : {})
        })
      }
    },

    switchTab(e) {
      this.syncRole()
      const index = e.currentTarget.dataset.index
      if (index === this.data.selected) {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        if (page && typeof page.onTabItemTap === 'function') {
          page.onTabItemTap()
        }
        return
      }
      const previous = this.data.selected
      this.setData({ selected: index })
      wx.switchTab({
        url: this.data.paths[index],
        fail: () => this.setData({ selected: previous })
      })
    },

    openPublish() {
      this.setData({ showPublishSheet: true })
    },

    closePublishSheet() {
      this.setData({ showPublishSheet: false })
    },

    goPublishEvent() {
      this.setData({ showPublishSheet: false })
      wx.navigateTo({ url: '/pages/publish-event/publish-event' })
    },

    goPublishOrder() {
      this.setData({ showPublishSheet: false })
      wx.navigateTo({ url: '/pages/publish-order/publish-order' })
    }
  }
})
