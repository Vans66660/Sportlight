Page({
  data: {
    postId: '',
    keyword: '',
    role: 'full',
    roleOptions: [
      { value: 'full', label: '全部权限', desc: '可编辑赛事、审核报名、管理赛程和录入成绩' },
      { value: 'score', label: '成绩权限', desc: '可管理赛程、录入赛果、编辑名次荣誉' }
    ],
    admins: [],
    results: [],
    searched: false,
    loading: true,
    searching: false
  },

  onLoad(options) {
    this.setData({ postId: options.postId || '' })
    this.loadAdmins()
  },

  loadAdmins() {
    if (!this.data.postId) return
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getEventAdmins',
      data: { postId: this.data.postId },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) this.setData({ admins: result.data || [], loading: false })
        else {
          this.setData({ loading: false })
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        }
      },
      fail: (err) => {
        console.error('getEventAdmins 调用失败:', err)
        this.setData({ loading: false })
        wx.showToast({ title: '请先部署 getEventAdmins', icon: 'none' })
      }
    })
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  setRole(e) {
    this.setData({ role: e.currentTarget.dataset.role })
  },

  search() {
    const keyword = String(this.data.keyword || '').trim()
    if (!keyword) {
      wx.showToast({ title: '请输入搜索内容', icon: 'none' })
      return
    }
    this.setData({ searching: true, searched: true })
    wx.cloud.callFunction({
      name: 'searchSocialUsers',
      data: { keyword },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          const invited = {}
          this.data.admins.forEach(item => {
            if (['pending', 'accepted'].includes(item.status)) invited[item.adminOpenid] = true
          })
          this.setData({
            results: (result.data || []).map(item => ({ ...item, invited: !!invited[item.openid] })),
            searching: false
          })
        } else {
          this.setData({ searching: false })
          wx.showToast({ title: result.msg || '搜索失败', icon: 'none' })
        }
      },
      fail: (err) => {
        console.error('searchSocialUsers 调用失败:', err)
        this.setData({ searching: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  invite(e) {
    const index = e.currentTarget.dataset.index
    const user = this.data.results[index]
    if (!user || user.invited) return
    wx.cloud.callFunction({
      name: 'inviteEventAdmin',
      data: { postId: this.data.postId, adminOpenid: user.openid, role: this.data.role },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          wx.showToast({ title: '已邀请', icon: 'success' })
          this.setData({ [`results[${index}].invited`]: true })
          this.loadAdmins()
        } else {
          wx.showToast({ title: result.msg || '邀请失败', icon: 'none' })
        }
      },
      fail: (err) => {
        console.error('inviteEventAdmin 调用失败:', err)
        wx.showToast({ title: '请先部署 inviteEventAdmin', icon: 'none' })
      }
    })
  },

  removeAdmin(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '移除管理员',
      content: '移除后该用户将无法继续管理这场赛事。',
      confirmText: '移除',
      confirmColor: '#E53935',
      success: res => {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'removeEventAdmin',
          data: { eventAdminId: id },
          success: callRes => {
            const result = callRes.result || {}
            if (result.code === 0) {
              wx.showToast({ title: '已移除', icon: 'success' })
              this.loadAdmins()
            } else wx.showToast({ title: result.msg || '移除失败', icon: 'none' })
          },
          fail: (err) => {
            console.error('removeEventAdmin 调用失败:', err)
            wx.showToast({ title: '请先部署 removeEventAdmin', icon: 'none' })
          }
        })
      }
    })
  }
})
