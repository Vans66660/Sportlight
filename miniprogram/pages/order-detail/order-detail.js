const { requestImportantNotice, TEMPLATE_TYPES } = require('../../utils/subscribe-notice')

Page({
  data: {
    order: {},
    statusIcon: '',
    statusHint: '',
    isBoss: false,
    ratingOptions: [1, 2, 3, 4, 5],
    evalModal: {
      show: false,
      punctuality: 'good',
      communication: 'good',
      contentQuality: 'good',
      rating: 5,
      comment: '',
      exitType: 'normal',
      teamResult: 'win',
      playerPoints: ''
    },
    payoutConfirming: false,
    evalSubmitting: false
  },

  onLoad(options) {
    this._orderId = options.id
    this._firstLoad = true
    const app = getApp()
    const userType = app.globalData.userType || wx.getStorageSync('userType') || ''
    this.setData({ isBoss: userType === 'boss' })
    this.loadOrder(options.id, false)
  },

  onShow() {
    if (this._orderId && !this._firstLoad) this.loadOrder(this._orderId, true)
  },

  loadOrder(id, silent) {
    if (!silent) wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getOrderDetail',
      data: { orderId: id },
      success: (res) => {
        if (!silent) wx.hideLoading()
        this._firstLoad = false
        if (res.result.code === 0) {
          const order = res.result.data
          const statusMap = {
            open:      { icon: '📋', hint: '订单招募中' },
            pending:   { icon: '⏳', hint: '等待老板确认锁单' },
            locked:    { icon: '🔒', hint: '进行中 · 完成后平台结算报酬' },
            settlement_confirmation: { icon: '📝', hint: '等待球员确认异常结算方案' },
            settlement_disputed: { icon: '⚠️', hint: '结算申诉中 · 款项已冻结' },
            settling:  { icon: '⏳', hint: '结算中 · 平台正在发起打款' },
            done:      { icon: '✅', hint: order.canConfirmPayout ? '待确认收款' : (order.canRefreshPayout ? '打款处理中' : '订单已完成') },
            cancelled: { icon: '❌', hint: '订单已取消' }
          }
          const s = statusMap[order.status] || { icon: '📋', hint: '' }
          this.setData({ order, statusIcon: s.icon, statusHint: s.hint })
        } else {
          wx.showToast({ title: '加载失败', icon: 'none' })
        }
      },
      fail: () => {
        if (!silent) wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  onUnload() {
    wx.hideLoading()
  },

  goBossProfile() {
    const openid = this.data.order.bossOpenid
    if (!openid) return
    wx.navigateTo({
      url: `/pages/boss-profile/boss-profile?openid=${openid}`
    })
  },

  goAthleteProfile() {
    const openid = this.data.order.athleteOpenid
    if (!openid) return
    wx.navigateTo({
      url: `/pages/athlete-profile/athlete-profile?openid=${openid}`
    })
  },

  confirmPayout() {
    if (this.data.payoutConfirming) return
    this._doConfirmPayout()
  },

  _doConfirmPayout() {
    const { order } = this.data
    if (!order || !order._id || !order.canConfirmPayout) return
    const packageInfo = order.payoutPackageInfo || (order.payoutInfo && order.payoutInfo.wxPackageInfo)
    if (!packageInfo) {
      wx.showToast({ title: '暂无可确认的收款单', icon: 'none' })
      this.refreshPayoutStatus()
      return
    }

    if (typeof wx.requestMerchantTransfer !== 'function') {
      wx.showToast({ title: '当前微信版本暂不支持，正在同步', icon: 'none' })
      this.syncConfirmPayout()
      return
    }

    this.setData({ payoutConfirming: true })
    wx.requestMerchantTransfer({
      mchId: '1747444613',
      appId: 'wxe030eaf6a9059fca',
      package: packageInfo,
      success: () => {
        this.syncConfirmPayout()
      },
      fail: (err) => {
        this.setData({ payoutConfirming: false })
        if (err && err.errMsg && err.errMsg.includes('cancel')) {
          wx.showToast({ title: '已取消确认', icon: 'none' })
          return
        }
        wx.showToast({ title: '正在同步收款状态', icon: 'none' })
        this.refreshPayoutStatus()
      }
    })
  },

  syncConfirmPayout() {
    const { order } = this.data
    if (!order || !order._id) return
    wx.showLoading({ title: '同步中...' })
    wx.cloud.callFunction({
      name: 'applyOrder',
      data: { orderId: order._id, action: 'confirm_payout' },
      success: res => {
        wx.hideLoading()
        this.setData({ payoutConfirming: false })
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '已确认收款', icon: 'success' })
          this.setData({
            'order.canConfirmPayout': false,
            'order.payoutStatus': 'user_confirmed',
            'order.paymentStatus': 'released'
          })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '同步失败', icon: 'none' })
          this.loadOrder(order._id, true)
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ payoutConfirming: false })
        wx.showToast({ title: '同步失败，请刷新重试', icon: 'none' })
        this.loadOrder(order._id, true)
      }
    })
  },

  refreshPayoutStatus() {
    const { order } = this.data
    if (!order || !order._id) return
    wx.showLoading({ title: '查询中...' })
    wx.cloud.callFunction({
      name: 'applyOrder',
      data: { orderId: order._id, action: 'refresh_payout' },
      success: res => {
        wx.hideLoading()
        const result = res.result || {}
        if (result.code === 0) {
          wx.showToast({ title: result.msg || '已刷新', icon: 'none' })
          this.loadOrder(order._id, true)
        } else {
          wx.showToast({ title: result.msg || '查询失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '查询失败', icon: 'none' })
      }
    })
  },

  retryPayout() {
    const { order } = this.data
    if (!order || !order._id) return
    wx.showModal({
      title: '重新发起打款',
      content: `确认重新向球员发起 ¥${order.athleteGet} 打款？`,
      confirmText: '重新打款',
      confirmColor: '#FF6B1A',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '打款中...' })
        wx.cloud.callFunction({
          name: 'applyOrder',
          data: { orderId: order._id, action: 'retry_payout' },
          success: r => {
            wx.hideLoading()
            const result = r.result || {}
            wx.showToast({ title: result.msg || (result.code === 0 ? '已发起' : '打款失败'), icon: 'none' })
            this.loadOrder(order._id, true)
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '打款失败', icon: 'none' })
          }
        })
      }
    })
  },

  completeOrder() {
    const { order, isBoss } = this.data
    if (isBoss) {
      this.setData({
        'evalModal.show': true,
        'evalModal.punctuality': 'good',
        'evalModal.communication': 'good',
        'evalModal.contentQuality': 'good',
        'evalModal.rating': 5,
        'evalModal.comment': '',
        'evalModal.exitType': 'normal',
        'evalModal.teamResult': 'win',
        'evalModal.playerPoints': ''
      })
      return
    }
    wx.showModal({
      title: '确认完成',
      content: `确认已完成此订单？平台将向你结算报酬 ¥${order.athleteGet}\n\n保险风险提示：本平台仅为赛事信息中介，不提供保险。高风险运动建议自行购买运动意外险。`,
      confirmText: '确认完成',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (res.confirm) {
          requestImportantNotice([TEMPLATE_TYPES.order, TEMPLATE_TYPES.payment])
          wx.cloud.callFunction({
            name: 'applyOrder',
            data: { orderId: order._id, action: 'complete' },
            success: (res) => {
              const msg = res.result && res.result.msg || '操作成功'
              wx.showToast({ title: msg, icon: 'none', duration: 2500 })
              this.loadOrder(order._id)
            }
          })
        }
      }
    })
  },

  setEval(e) {
    const { field, val } = e.currentTarget.dataset
    this.setData({ [`evalModal.${field}`]: val })
  },

  setEvalRating(e) {
    this.setData({ 'evalModal.rating': Number(e.currentTarget.dataset.rating) })
  },

  onEvalCommentInput(e) {
    this.setData({ 'evalModal.comment': e.detail.value })
  },

  onPlayerPointsInput(e) {
    this.setData({ 'evalModal.playerPoints': e.detail.value })
  },

  submitEval() {
    const { evalModal, order } = this.data
    if (this.data.evalSubmitting) return
    if (order.basketballSettlementEnabled && evalModal.exitType !== 'unauthorized_leave') {
      if (!['win', 'loss'].includes(evalModal.teamResult)) {
        wx.showToast({ title: '请选择本场胜负结果', icon: 'none' })
        return
      }
      if (evalModal.playerPoints === '' || !Number.isInteger(Number(evalModal.playerPoints)) || Number(evalModal.playerPoints) < 0) {
        wx.showToast({ title: '请填写有效的球员得分', icon: 'none' })
        return
      }
    }
    requestImportantNotice([TEMPLATE_TYPES.order, TEMPLATE_TYPES.payment])
    this.setData({ evalSubmitting: true })
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'applyOrder',
      data: {
        orderId: order._id,
        action: 'complete',
        evaluation: {
          punctuality: evalModal.punctuality,
          communication: evalModal.communication,
          contentQuality: evalModal.contentQuality,
          rating: evalModal.rating,
          comment: evalModal.comment,
          exitType: evalModal.exitType,
          teamResult: evalModal.teamResult,
          playerPoints: evalModal.playerPoints === '' ? null : Number(evalModal.playerPoints)
        }
      },
      success: (res) => {
        wx.hideLoading()
        this.setData({ evalSubmitting: false })
        if (res.result && res.result.code === 0) {
          this.setData({ 'evalModal.show': false })
          wx.showToast({ title: res.result.msg || '已完成并评价 🎉', icon: 'none', duration: 2500 })
          this.loadOrder(order._id)
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '提交失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ evalSubmitting: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  closeEval() {
    this.setData({ 'evalModal.show': false })
  },

  confirmExceptionSettlement() {
    const { order } = this.data
    if (!order || !order._id) return
    wx.showModal({
      title: '确认异常结算',
      content: `确认按「${order.exceptionSettlementLabel}」结算 ¥${order.exceptionSettlementPayout} 吗？`,
      confirmText: '确认结算',
      confirmColor: '#FF6B1A',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '结算中...' })
        wx.cloud.callFunction({
          name: 'applyOrder', data: { orderId: order._id, action: 'confirm_exception_settlement' },
          success: result => {
            wx.hideLoading()
            wx.showToast({ title: (result.result && result.result.msg) || '操作完成', icon: 'none' })
            this.loadOrder(order._id, true)
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
        })
      }
    })
  },

  disputeExceptionSettlement() {
    const { order } = this.data
    if (!order || !order._id) return
    wx.showModal({
      title: '提出结算异议',
      editable: true,
      placeholderText: '说明异议原因，平台将介入处理',
      confirmText: '提交异议',
      confirmColor: '#D9534F',
      success: res => {
        const disputeReason = String(res.content || '').trim()
        if (!res.confirm || !disputeReason) return
        wx.showLoading({ title: '提交中...' })
        wx.cloud.callFunction({
          name: 'applyOrder', data: { orderId: order._id, action: 'dispute_exception_settlement', disputeReason },
          success: result => {
            wx.hideLoading()
            wx.showToast({ title: (result.result && result.result.msg) || '已提交', icon: 'none', duration: 2500 })
            this.loadOrder(order._id, true)
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
        })
      }
    })
  },

  applyOrder() {
    const order = this.data.order
    if (!order || !order._id) return wx.showToast({ title: '订单信息缺失', icon: 'none' })
    if (!order.canApplyToOrder) return wx.showToast({ title: order.applicationStatusText || '当前不可报名', icon: 'none' })
    requestImportantNotice([TEMPLATE_TYPES.order]).then((subscribeRes) => {
      const subscribeTip = this.getSubscribeResultText(subscribeRes)
      setTimeout(() => {
        wx.showModal({
          title: '确认报名',
          content: `${subscribeTip}\n\n确认要报名这条赏金令吗？发布方将从报名者中选择合作运动员。`,
          confirmText: '确认报名',
          confirmColor: '#FF6B1A',
          success: (res) => {
            if (res.confirm) this.submitOrderApplication(order)
          }
        })
      }, 600)
    })
  },

  getSubscribeResultText(res = {}) {
    if (res.subscribeStatus === 'accept') return '微信通知：已授权，后续结果会尝试通过微信服务通知提醒你。'
    if (res.subscribeStatus === 'reject') return '微信通知：你刚刚拒绝了授权，后续结果仍会保留在站内消息。'
    if (res.subscribeStatus === 'ban') return '微信通知：订阅消息权限已关闭，请到小程序右上角设置中开启。'
    if (res.skipped) return `微信通知：${res.failText || '未触发授权'}后续结果仍会保留在站内消息。`
    return '微信通知：未检测到授权结果，后续结果仍会保留在站内消息。'
  },

  submitOrderApplication(order) {
    wx.showLoading({ title: '报名中...' })
    wx.cloud.callFunction({
      name: 'applyOrder',
      data: { orderId: order._id },
      success: (result) => {
        wx.hideLoading()
        if (result.result.code === 0) {
          wx.showToast({ title: '报名成功 🎉', icon: 'none' })
          this.loadOrder(order._id, true)
        } else {
          wx.showToast({ title: result.result.msg || '报名失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  cancelOrder() {
    const order = this.data.order
    wx.showModal({
      title: '确认取消',
      content: '取消后订单将关闭',
      confirmText: '确认取消',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'applyOrder',
            data: { orderId: order._id, action: 'cancel' },
            success: () => {
              this.setData({
                'order.status': 'cancelled',
                'order.statusLabel': '已取消',
                statusIcon: '❌',
                statusHint: '订单已取消'
              })
              wx.showToast({ title: '订单已取消', icon: 'none' })
            }
          })
        }
      }
    })
  },

  cancelCooperation() {
    const order = this.data.order
    if (!order || !order._id) return
    wx.showModal({
      title: '取消合作',
      content: '取消后本次合作将关闭，球员侧会显示合作已取消，托管款将原路退回。',
      confirmText: '取消合作',
      confirmColor: '#FF6B1A',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...' })
        wx.cloud.callFunction({
          name: 'applyOrder',
          data: { orderId: order._id, action: 'cancel_cooperation' },
          success: (result) => {
            wx.hideLoading()
            const r = result.result || {}
            if (r.code !== 0) {
              wx.showToast({ title: r.msg || '操作失败', icon: 'none' })
              return
            }
            wx.showToast({ title: '合作已取消', icon: 'none' })
            this.loadOrder(order._id, true)
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络错误', icon: 'none' })
          }
        })
      }
    })
  },

  goMessage() {
    const order = this.data.order
    wx.navigateTo({
      url: `/pages/chat/chat?orderId=${order._id}&title=${encodeURIComponent(order.title || '聊天')}`
    })
  },

  previewPromoImage(e) {
    const index = e.currentTarget.dataset.index
    const urls = this.data.order.promoImages
    wx.previewImage({ current: urls[index], urls })
  },

  goBack() {
    wx.navigateBack()
  }
})
