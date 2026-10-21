const TYPE_MAP = {
  match_result: '⚔️ 赛果',
  training: '💪 训练',
  collab: '📣 合作',
  general: '💬 日常',
  event: '🏆 赛事'
}

Page({
  data: {
    posts: [],
    page: 0,
    loading: false,
    hasMore: true
  },

  onLoad() {
    this.loadPosts()
  },

  loadPosts() {
    if (this.data.loading) return
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getMyPosts',
      data: { page: this.data.page, limit: 15 },
      success: (res) => {
        if (res.result.code === 0) {
          const newPosts = res.result.data.map(p => ({
            ...p,
            typeLabel: TYPE_MAP[p.type] || '💬 日常',
            timeLabel: this.timeAgo(p.createdAt)
          }))
          this.setData({
            posts: this.data.page === 0 ? newPosts : [...this.data.posts, ...newPosts],
            hasMore: res.result.hasMore,
            loading: false
          })
        } else {
          this.setData({ loading: false })
        }
      },
      fail: () => this.setData({ loading: false })
    })
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return
    this.setData({ page: this.data.page + 1 }, () => this.loadPosts())
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${e.currentTarget.dataset.id}` })
  },

  goPublish() {
    wx.showActionSheet({
      itemList: ['发布赛事', '发布合作需求'],
      success: res => {
        wx.navigateTo({ url: res.tapIndex === 0 ? '/pages/publish-event/publish-event' : '/pages/publish-order/publish-order' })
      }
    })
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
        const posts = this.data.posts.filter((_, i) => i !== index)
        this.setData({ posts })
        wx.cloud.callFunction({
          name: 'deletePost',
          data: { postId: id },
          fail: () => {
            wx.showToast({ title: '删除失败', icon: 'none' })
            this.setData({ posts: [], page: 0, hasMore: true }, () => this.loadPosts())
          }
        })
      }
    })
  },

  goBack() {
    wx.navigateBack()
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
