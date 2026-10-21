const TYPE_MAP = {
  match_result: '⚔️ 赛果',
  training: '💪 训练',
  collab: '📣 合作',
  general: '💬 日常',
  event: '🏆 赛事'
}
const { requestImportantNotice, TEMPLATE_TYPES } = require('../../utils/subscribe-notice')

Page({
  data: {
    athlete: {},
    highlightIndex: 0,
    highlightStack: [],
    orderId: '',
    athleteOpenid: '',
    order: null,
    badgeExpanded: false,
    selectedBadge: null,
    proUpgradePanel: {
      show: false,
      used: 0,
      limit: 3,
      proLimit: 30,
      price: 29.9,
      durationDays: 30
    }
  },

  onLoad(options) {
    if (options.orderId) {
      this.setData({ orderId: options.orderId })
      this.loadOrderDetail(options.orderId)
    }
    if (options.id) {
      this.setData({ athleteOpenid: '' })
      this.loadAthlete({ athleteId: options.id })
    } else if (options.openid) {
      this.setData({ athleteOpenid: options.openid })
      this.loadAthlete({ openid: options.openid })
    }
  },

  flipShowcaseCard(e) {
    const index = Number(e.currentTarget.dataset.index)
    const cards = (this.data.athlete && this.data.athlete.showcaseCards) || []
    const card = cards[index]
    if (!card) return
    if (!card.backImage) {
      wx.showToast({ title: '这张旧卡暂无背面', icon: 'none' })
      return
    }
    this.setData({ [`athlete.showcaseCards[${index}]._showBack`]: !card._showBack })
  },

  loadOrderDetail(orderId) {
    wx.cloud.callFunction({
      name: 'getOrderDetail',
      data: { orderId },
      success: (res) => {
        if (res.result.code === 0) {
          this.setData({ order: res.result.data })
        }
      }
    })
  },

  loadAthlete(params) {
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getAthleteDetail',
      data: params,
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          const athlete = res.result.data
          athlete.rankBase = athlete.rankStatusClass || (athlete.rank || 'D')[0]
          athlete.nextRank = this.getNextRank(athlete.rank || 'D')
          athlete.progress = athlete.progress || 0
          athlete.orderCount = athlete.orderCount || 0
          athlete.rating = athlete.rating || 0
          athlete.repeatRate = athlete.repeatRate || 0
          athlete.marketValue = athlete.marketValue || 0
          athlete.highlights = athlete.highlights || []
          athlete.deals = athlete.deals || []
          athlete.tags = athlete.tags || []
          athlete.showcaseCards = (athlete.showcaseCards || athlete.cardShowcase || []).slice(0, 6).map(card => ({
            ...card,
            _showBack: false
          }))
          athlete.cardCount = Number(athlete.cardCount || athlete.showcaseCards.length || 0)
          athlete.honors = athlete.honors || []
          athlete.recentPosts = (athlete.recentPosts || []).map(p => ({
            ...p,
            typeLabel: TYPE_MAP[p.type] || '💬 日常',
            timeLabel: this.timeAgo(p.createdAt)
          }))

          if (athlete.highlights.length > 0) {
            const fileIDs = athlete.highlights.map(h => h.src)
            wx.cloud.getTempFileURL({
              fileList: fileIDs,
              success: (tempRes) => {
                tempRes.fileList.forEach((file, index) => {
                  athlete.highlights[index].src = file.tempFileURL
                })
                this.setData({ athlete }, () => {
                  this.buildStack()
                })
              },
              fail: () => {
                this.setData({ athlete }, () => {
                  this.buildStack()
                })
              }
            })
          } else {
            this.setData({ athlete }, () => {
              this.buildStack()
            })
          }
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('获取运动员详情失败', err)
      }
    })
  },

  getNextRank(rank) {
    const tiers = ['D','D+','C','C+','B','B+','A','A+','S','S+']
    const idx = tiers.indexOf(rank)
    return idx >= 0 && idx < tiers.length - 1 ? tiers[idx + 1] : 'S+'
  },

  goScoreDetails() {
    const openid = this.data.athleteOpenid || (this.data.athlete && this.data.athlete.openid) || ''
    const suffix = openid ? `?openid=${openid}` : ''
    wx.navigateTo({ url: `/pages/score-details/score-details${suffix}` })
  },

  goMatchStats(e) {
    const openid = this.data.athleteOpenid || (this.data.athlete && this.data.athlete.openid) || ''
    const tab = e.currentTarget.dataset.tab || 'all'
    const query = [`tab=${tab}`]
    if (openid) query.push(`openid=${openid}`)
    wx.navigateTo({ url: `/pages/player-match-stats/player-match-stats?${query.join('&')}` })
  },

  unlockScoutReport() {
    const athleteOpenid = this.data.athleteOpenid || (this.data.athlete && this.data.athlete.openid) || ''
    if (!athleteOpenid) {
      wx.showToast({ title: '运动员信息未加载', icon: 'none' })
      return
    }
    const report = (this.data.athlete && this.data.athlete.scoutReport) || {}
    wx.showModal({
      title: '解锁球探报告',
      content: `支付 ¥${report.price || 6.9} 后可永久查看该球员的深度数据、风险提示和合作建议。`,
      confirmText: '去支付',
      confirmColor: '#FF6B1A',
      success: (modal) => {
        if (!modal.confirm) return
        this.createScoutReportPayment(athleteOpenid)
      }
    })
  },

  createScoutReportPayment(athleteOpenid) {
    wx.showLoading({ title: '准备支付...' })
    wx.cloud.callFunction({
      name: 'scoutReportPayment',
      data: { athleteOpenid },
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.hideLoading()
          wx.showToast({ title: result.msg || '发起支付失败', icon: 'none' })
          return
        }
        if (result.unlocked) {
          wx.hideLoading()
          wx.showToast({ title: '报告已解锁', icon: 'success' })
          this.loadAthlete({ openid: athleteOpenid })
          return
        }
        const { timeStamp, nonceStr, package: pkg, signType, paySign } = result.payParams || {}
        wx.hideLoading()
        wx.requestPayment({
          timeStamp,
          nonceStr,
          package: pkg,
          signType,
          paySign,
          success: () => this.confirmScoutReportPayment(athleteOpenid, result.tradeNo),
          fail: (err) => {
            if (err.errMsg && err.errMsg.includes('cancel')) {
              wx.showToast({ title: '已取消支付', icon: 'none' })
            } else {
              wx.showToast({ title: '支付失败，请重试', icon: 'none' })
            }
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  confirmScoutReportPayment(athleteOpenid, tradeNo) {
    wx.showLoading({ title: '确认支付...' })
    wx.cloud.callFunction({
      name: 'scoutReportPayment',
      data: { action: 'confirm', athleteOpenid, tradeNo },
      success: (res) => {
        wx.hideLoading()
        const result = res.result || {}
        if (result.code === 0 && result.unlocked) {
          wx.showToast({ title: '报告已解锁', icon: 'success' })
          this.loadAthlete({ openid: athleteOpenid })
        } else {
          wx.showToast({ title: result.msg || '支付确认中', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '确认失败，请稍后重试', icon: 'none' })
      }
    })
  },

  toggleBadges() {
    this.setData({ badgeExpanded: !this.data.badgeExpanded })
  },

  openBadgeDetail(e) {
    const index = Number(e.currentTarget.dataset.index)
    const badge = (this.data.athlete.tournamentBadges || [])[index]
    if (badge) this.setData({ selectedBadge: badge })
  },

  closeBadgeDetail() {
    this.setData({ selectedBadge: null })
  },

  buildStack() {
    const { highlights } = this.data.athlete
    const highlightIndex = this.data.highlightIndex
    if (!highlights || highlights.length === 0) return
    const total = highlights.length
    const visible = Math.min(3, total)
    const stack = []
    for (let i = visible - 1; i >= 0; i--) {
      const idx = (highlightIndex + i) % total
      stack.push({
        src: highlights[idx].src,
        label: highlights[idx].label,
        rotate: (i - (visible - 1) / 2) * 3,
        scale: 1 - i * 0.04,
        top: i * 16,
        zIndex: visible - i
      })
    }
    this.setData({ highlightStack: stack })
  },

  nextHighlight() {
    const { highlights } = this.data.athlete
    const next = (this.data.highlightIndex + 1) % highlights.length
    this.setData({ highlightIndex: next }, () => {
      this.buildStack()
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
  },

  goEventDetail(e) {
    const postId = e.currentTarget.dataset.id
    if (postId) wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${postId}` })
  },

  goOrderDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` })
  },

  confirmCooperation() {
    const { orderId, athleteOpenid, athlete, order } = this.data

    if (!orderId) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' })
      return
    }
    const name = (athlete && athlete.name) ? athlete.name : '该运动员'
    const openid = athleteOpenid || (athlete && athlete.openid) || ''
    if (!openid) {
      wx.showToast({ title: '运动员信息未加载', icon: 'none' })
      return
    }

    const price = order ? (order.price || 0) : 0

    wx.showModal({
      title: '确认合作：' + name,
      content: '报酬金额：¥' + price + '\n确认后发起微信支付',
      confirmText: '去支付',
      confirmColor: '#FF6B1A',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm) return
        requestImportantNotice([TEMPLATE_TYPES.order, TEMPLATE_TYPES.payment]).then(() => {
          wx.showLoading({ title: '准备支付...' })
          wx.cloud.callFunction({
            name: 'selectAthlete',
            data: { orderId, athleteOpenid: openid },
            success: (result) => {
              wx.hideLoading()
              const r = result.result
              if (r.code !== 0) {
                wx.showToast({ title: r.msg || '操作失败', icon: 'none' })
                return
              }
              const { timeStamp, nonceStr, package: pkg, signType, paySign } = r.payParams
              wx.requestPayment({
                timeStamp, nonceStr, package: pkg, signType, paySign,
                success: () => {
                  wx.showToast({ title: '支付成功 🎉', icon: 'none', duration: 2000 })
                  setTimeout(() => {
                    wx.redirectTo({ url: '/pages/chat/chat?orderId=' + orderId + '&title=' + encodeURIComponent(order ? order.title : '聊天') })
                  }, 2000)
                },
                fail: (err) => {
                  if (err.errMsg && err.errMsg.includes('cancel')) {
                    wx.showToast({ title: '已取消支付', icon: 'none' })
                  } else {
                    wx.showToast({ title: '支付失败，请重试', icon: 'none' })
                  }
                }
              })
            },
            fail: () => {
              wx.hideLoading()
              wx.showToast({ title: '网络错误', icon: 'none' })
            }
          })
        })
      },
      fail: (err) => {
        console.error('showModal fail', err)
      }
    })
  },

  goContact() {
    const openid = this.data.athleteOpenid || (this.data.athlete && this.data.athlete.openid) || ''
    if (!openid) {
      wx.showToast({ title: '运动员信息未加载', icon: 'none' })
      return
    }
    wx.showLoading({ title: '打开聊天...' })
    wx.cloud.callFunction({
      name: 'startDirectChat',
      data: { athleteOpenid: openid },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          wx.navigateTo({
            url: '/pages/chat/chat?orderId=' + res.result.orderId + '&title=' + encodeURIComponent(this.data.athlete.name || '沟通')
          })
        } else if (res.result && res.result.reason === 'CONTACT_LIMIT_REACHED') {
          this.showProUpgradePanel(res.result)
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '无法发起沟通', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  showProUpgradePanel(result = {}) {
    const limit = Number(result.limit) || 3
    const used = Number(result.used) || limit
    this.setData({
      proUpgradePanel: {
        show: true,
        used,
        limit,
        proLimit: 30,
        price: 29.9,
        durationDays: 30
      }
    })
  },

  closeProUpgradePanel() {
    this.setData({ 'proUpgradePanel.show': false })
  },

  noop() {},

  handleProUpgrade() {
    wx.showLoading({ title: '准备支付...' })
    wx.cloud.callFunction({
      name: 'proSubscriptionPayment',
      data: {},
      success: (res) => {
        const result = res.result || {}
        if (result.code !== 0) {
          wx.hideLoading()
          wx.showToast({ title: result.msg || '发起支付失败', icon: 'none' })
          return
        }
        const { timeStamp, nonceStr, package: pkg, signType, paySign } = result.payParams || {}
        wx.hideLoading()
        wx.requestPayment({
          timeStamp,
          nonceStr,
          package: pkg,
          signType,
          paySign,
          success: () => this.confirmProUpgrade(result.tradeNo),
          fail: (err) => {
            if (err.errMsg && err.errMsg.includes('cancel')) {
              wx.showToast({ title: '已取消支付', icon: 'none' })
            } else {
              wx.showToast({ title: '支付失败，请重试', icon: 'none' })
            }
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  confirmProUpgrade(tradeNo) {
    wx.showLoading({ title: '确认支付...' })
    wx.cloud.callFunction({
      name: 'proSubscriptionPayment',
      data: { action: 'confirm', tradeNo },
      success: (res) => {
        wx.hideLoading()
        const result = res.result || {}
        if (result.code === 0 && result.activated) {
          wx.showToast({ title: 'Pro 已开通', icon: 'success' })
          this.closeProUpgradePanel()
          setTimeout(() => this.goContact(), 500)
        } else {
          wx.showToast({ title: result.msg || '支付确认中，请稍后重试', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '确认失败，请稍后重试', icon: 'none' })
      }
    })
  },

  addFriend() {
    const openid = this.data.athleteOpenid || (this.data.athlete && this.data.athlete.openid) || ''
    if (!openid) return wx.showToast({ title: '运动员信息未加载', icon: 'none' })
    wx.showModal({
      title: '好友申请',
      editable: true,
      placeholderText: `向 ${this.data.athlete.displayName || '对方'} 说句话`,
      confirmText: '发送',
      confirmColor: '#FF6B1A',
      success: res => {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'sendFriendRequest',
          data: { toOpenid: openid, message: res.content || '' },
          success: callRes => {
            const result = callRes.result || {}
            if (result.code === 0) {
              this.setData({ 'athlete.friendStatus': 'pending_sent' })
              wx.showToast({ title: '已发送', icon: 'success' })
            } else wx.showToast({ title: result.msg || '发送失败', icon: 'none' })
          }
        })
      }
    })
  },

  goFriendChat() {
    const openid = this.data.athleteOpenid || (this.data.athlete && this.data.athlete.openid) || ''
    if (!openid) return wx.showToast({ title: '运动员信息未加载', icon: 'none' })
    wx.cloud.callFunction({
      name: 'startFriendChat',
      data: { friendOpenid: openid },
      success: res => {
        const result = res.result || {}
        if (result.code === 0) {
          wx.navigateTo({ url: `/pages/chat/chat?orderId=${result.orderId}&title=${encodeURIComponent(result.title || this.data.athlete.displayName || '好友聊天')}&chatKind=direct` })
        } else wx.showToast({ title: result.msg || '进入失败', icon: 'none' })
      }
    })
  },

  reportAthlete() {
    const openid = this.data.athleteOpenid || (this.data.athlete && this.data.athlete.openid) || ''
    if (!openid) return wx.showToast({ title: '运动员信息未加载', icon: 'none' })
    wx.showModal({
      title: '举报球员',
      editable: true,
      placeholderText: '请说明违规、失约或骚扰等情况',
      confirmText: '提交',
      confirmColor: '#E53935',
      success: (modal) => {
        if (!modal.confirm) return
        const reason = (modal.content || '').trim()
        if (!reason) return wx.showToast({ title: '请填写举报原因', icon: 'none' })
        wx.showLoading({ title: '提交中...' })
        wx.cloud.callFunction({
          name: 'submitReport',
          data: {
            targetType: 'athlete',
            targetOpenid: openid,
            reason,
            scene: 'athlete-profile'
          },
          success: (res) => {
            wx.hideLoading()
            if (res.result && res.result.code === 0) {
              wx.showToast({ title: res.result.msg || '已提交', icon: 'success' })
            } else {
              wx.showToast({ title: (res.result && res.result.msg) || '提交失败', icon: 'none' })
            }
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络错误', icon: 'none' })
          }
        })
      }
    })
  }
})
