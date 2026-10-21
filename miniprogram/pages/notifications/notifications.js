const app = getApp()
const { requestImportantNotice, TEMPLATE_TYPES } = require('../../utils/subscribe-notice')

Page({
  data: {
    list: [],
    loading: true
  },

  onLoad() {},

  onShow() {
    app.globalData.notifUnread = 0
    this.load()
  },

  load() {
    wx.cloud.callFunction({
      name: 'getNotifications',
      data: { markRead: true },
      success: (res) => {
        if (res.result.code === 0) {
          const list = res.result.data.map(n => ({
            ...n,
            timeLabel: this.timeAgo(n.createdAt)
          }))
          this.setData({ list, loading: false })
          if (app.refreshUnreadBadge) app.refreshUnreadBadge()
        } else {
          this.setData({ loading: false })
        }
      },
      fail: () => this.setData({ loading: false })
    })
  },

  goPost(e) {
    const { postid, index } = e.currentTarget.dataset
    if (index !== undefined) {
      this.setData({ [`list[${index}].read`]: true })
    }
    if (postid) wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${postid}` })
  },

  confirmInvite(e) {
    const { regid, notifid, index, action, inviteType } = e.currentTarget.dataset
    const label = action === 'accept' ? '确认参赛' : '拒绝邀请'
    const isSoloInvite = inviteType === 'solo'
    const isRegularTeamInvite = inviteType === 'regular'
    wx.showModal({
      title: action === 'accept' ? '确认参赛' : '拒绝邀请',
      content: isSoloInvite
        ? (action === 'accept' ? '确认后你将加入这支队伍，原散客报名会从散客池移除。' : '拒绝后你仍会留在散客池，等待其他队伍邀请。')
        : isRegularTeamInvite
          ? (action === 'accept' ? '确认后你将以该球队队员身份参加本次赛事。' : '拒绝后你不会加入本次赛事参赛名单。')
          : (action === 'accept' ? '确认后队长将收到通知，等待队伍满员进入审核。' : '拒绝后该槽位将释放给队长重新邀请。'),
      confirmText: label,
      confirmColor: action === 'accept' ? '#FF6B1A' : '#E53935',
      success: (res) => {
        if (!res.confirm) return
        requestImportantNotice([TEMPLATE_TYPES.event, TEMPLATE_TYPES.team])
        wx.showLoading({ title: '提交中...' })
        wx.cloud.callFunction({
          name: isSoloInvite ? 'confirmSoloInvite' : isRegularTeamInvite ? 'confirmRegularTeamEventInvite' : 'confirmTeamInvite',
          data: isSoloInvite ? { notificationId: notifid, action } : { registrationId: regid, action },
          success: (r) => {
            wx.hideLoading()
            const result = r.result
            if (result.code === 0) {
              this.setData({
                [`list[${index}].responded`]: true,
                [`list[${index}].responseAction`]: action,
                [`list[${index}].read`]: true
              })
              wx.showToast({ title: result.msg, icon: 'success' })
            } else {
              wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
            }
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络错误', icon: 'none' })
          }
        })
      }
    })
  },

  reviewFriend(e) {
    const { requestid, index, action } = e.currentTarget.dataset
    wx.cloud.callFunction({
      name: 'reviewFriendRequest',
      data: { requestId: requestid, action },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          // 服务端已删除申请通知，当前列表同步移除，避免留下“已处理”卡片。
          const list = (this.data.list || []).filter((_, itemIndex) => itemIndex !== Number(index))
          this.setData({ list })
          wx.showToast({ title: action === 'approve' ? '已成为好友' : '已拒绝', icon: 'success' })
        } else wx.showToast({ title: result.msg || '处理失败', icon: 'none' })
      }
    })
  },

  reviewTeamInvite(e) {
    const { inviteid, index, action } = e.currentTarget.dataset
    wx.cloud.callFunction({
      name: 'reviewTeamInvite',
      data: { inviteId: inviteid, action },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          this.setData({ [`list[${index}].responded`]: true, [`list[${index}].responseAction`]: action, [`list[${index}].read`]: true })
          wx.showToast({ title: action === 'accept' ? '已加入球队' : '已拒绝', icon: 'success' })
        } else wx.showToast({ title: result.msg || '处理失败', icon: 'none' })
      }
    })
  },

  reviewEventAdminInvite(e) {
    const { eventadminid, notifid, index, action } = e.currentTarget.dataset
    wx.cloud.callFunction({
      name: 'reviewEventAdminInvite',
      data: { eventAdminId: eventadminid, notificationId: notifid, action },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          this.setData({ [`list[${index}].responded`]: true, [`list[${index}].responseAction`]: action, [`list[${index}].read`]: true })
          wx.showToast({ title: action === 'accept' ? '已接受' : '已拒绝', icon: 'success' })
        } else wx.showToast({ title: result.msg || '处理失败', icon: 'none' })
      },
      fail: () => wx.showToast({ title: '网络错误', icon: 'none' })
    })
  },

  timeAgo(dateStr) {
    if (!dateStr) return ''
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    const diff = now - then
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
