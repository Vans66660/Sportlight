const TYPE_MAP = {
  match_result: '⚔️ 赛果',
  training: '💪 训练',
  collab: '📣 合作',
  general: '💬 日常',
  event: '🏆 赛事'
}

Page({
  data: {
    boss: {},
    loaded: false
  },

  onLoad(options) {
    if (options.openid) {
      this.loadBoss(options.openid)
    }
  },

  loadBoss(openid) {
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getBossDetail',
      data: { bossOpenid: openid },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          const data = res.result.data
          data.recentPosts = (data.recentPosts || []).map(p => ({
            ...p,
            typeLabel: TYPE_MAP[p.type] || '💬 日常',
            timeLabel: this.timeAgo(p.createdAt)
          }))
          this.setData({ boss: data, loaded: true })
        } else {
          wx.showToast({ title: '加载失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  onUnload() {
    wx.hideLoading()
  },

  goBack() {
    wx.navigateBack()
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
  }
})
