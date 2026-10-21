Page({
  data: {
    gameId: '',
    game: {},
    loading: true
  },

  onLoad(options) {
    this.setData({ gameId: options.gameId || '' })
    this.loadDetail()
  },

  onShow() {
    if (this.data.gameId) this.loadDetail(false)
  },

  onShareAppMessage() {
    const game = this.data.game || {}
    return {
      title: `${game.venueName || '球馆'} ${game.sport || '散客'}组局`,
      path: `/pages/solo-game-detail/solo-game-detail?gameId=${this.data.gameId}`
    }
  },

  loadDetail(showLoading = true) {
    if (showLoading) this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getSoloGameDetail',
      data: { gameId: this.data.gameId },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          const game = result.data || {}
          game.participants = (game.participants || []).map(item => ({
            ...item,
            initial: (item.name || '球员').slice(0, 1)
          }))
          game.paymentLabel = game.paymentMethod === 'aa'
            ? `AA预交 ¥${Number(game.aaPricePerPerson || game.pricePerPerson || 0).toFixed(2)}/人`
            : (game.paymentMethod === 'free' ? '免费局' : `包场 ¥${Number(game.privateAmount || 0).toFixed(2)}`)
          this.setData({ game, loading: false })
        }
        else {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  openLocation() {
    const game = this.data.game || {}
    if (!game.venueLatitude || !game.venueLongitude) return
    wx.openLocation({
      latitude: Number(game.venueLatitude),
      longitude: Number(game.venueLongitude),
      name: game.venueName || '球场位置',
      address: game.venueAddress || ''
    })
  },

  goAthlete(e) {
    const openid = e.currentTarget.dataset.openid
    if (!openid) return
    wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
  },

  joinGame() {
    if (this.data.game.needsPrivatePayment) {
      this.payAndJoin('包场成功')
      return
    }
    if (this.data.game.paymentMethod === 'aa') {
      this.payAndJoin('报名成功')
      return
    }
    wx.showLoading({ title: '报名中...' })
    wx.cloud.callFunction({
      name: 'joinSoloGame',
      data: { gameId: this.data.gameId },
      success: res => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '报名成功', icon: 'success' })
          this.loadDetail(false)
        } else wx.showToast({ title: (res.result && res.result.msg) || '报名失败', icon: 'none' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '报名失败', icon: 'none' })
      }
    })
  },

  payAndJoin(successTitle = '报名成功') {
    wx.showLoading({ title: '准备支付...' })
    wx.cloud.callFunction({
      name: 'soloGamePayment',
      data: { action: 'create', gameId: this.data.gameId },
      success: res => {
        wx.hideLoading()
        const result = res.result || {}
        if (result.code !== 0) {
          wx.showToast({ title: result.msg || '发起支付失败', icon: 'none' })
          return
        }
        const { timeStamp, nonceStr, package: pkg, signType, paySign } = result.payParams || {}
        wx.requestPayment({
          timeStamp,
          nonceStr,
          package: pkg,
          signType,
          paySign,
          success: () => this.confirmSoloPayment(result.tradeNo, 0, successTitle),
          fail: err => {
            const cancelled = err.errMsg && err.errMsg.includes('cancel')
            wx.showToast({ title: cancelled ? '已取消支付' : '支付失败，请重试', icon: 'none' })
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '发起支付失败', icon: 'none' })
      }
    })
  },

  confirmSoloPayment(tradeNo, retry = 0, successTitle = '报名成功') {
    wx.showLoading({ title: successTitle === '包场成功' ? '确认包场...' : '确认报名...' })
    wx.cloud.callFunction({
      name: 'soloGamePayment',
      data: { action: 'confirm', gameId: this.data.gameId, tradeNo },
      success: res => {
        wx.hideLoading()
        const result = res.result || {}
        if (result.code === 0) {
          wx.showToast({ title: successTitle, icon: 'success' })
          this.loadDetail(false)
        } else {
          if ((result.msg || '').includes('尚未确认') && retry < 1) {
            setTimeout(() => this.confirmSoloPayment(tradeNo, retry + 1, successTitle), 1200)
            return
          }
          wx.showToast({ title: result.msg || '确认失败', icon: 'none', duration: 3000 })
          this.loadDetail(false)
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '确认失败，请稍后刷新', icon: 'none' })
      }
    })
  },

  cancelJoin() {
    if (!this.data.game.canRefund) return wx.showToast({ title: '已过截止时间，无法退款', icon: 'none' })
    const isAaPaid = this.data.game.paymentMethod === 'aa' && this.data.game.currentParticipant && this.data.game.currentParticipant.tradeNo
    wx.showModal({
      title: '取消报名',
      content: isAaPaid ? '确认取消报名并发起原路退款？' : '确认取消报名？',
      confirmText: '取消报名',
      confirmColor: '#FF6B1A',
      success: res => {
        if (!res.confirm) return
        if (isAaPaid) {
          this.refundSoloPayment()
          return
        }
        wx.cloud.callFunction({
          name: 'cancelSoloJoin',
          data: { gameId: this.data.gameId },
          success: r => {
            if (r.result && r.result.code === 0) {
              wx.showToast({ title: '已取消', icon: 'success' })
              this.loadDetail(false)
            } else wx.showToast({ title: (r.result && r.result.msg) || '取消失败', icon: 'none' })
          }
        })
      }
    })
  },

  refundSoloPayment() {
    wx.showLoading({ title: '退款中...' })
    wx.cloud.callFunction({
      name: 'soloGamePayment',
      data: { action: 'refund', gameId: this.data.gameId },
      success: r => {
        wx.hideLoading()
        if (r.result && r.result.code === 0) {
          wx.showToast({ title: '已发起退款', icon: 'success' })
          this.loadDetail(false)
        } else wx.showToast({ title: (r.result && r.result.msg) || '退款失败', icon: 'none' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '退款失败', icon: 'none' })
      }
    })
  }
})
