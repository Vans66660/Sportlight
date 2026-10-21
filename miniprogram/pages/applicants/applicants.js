const { requestImportantNotice, TEMPLATE_TYPES } = require('../../utils/subscribe-notice')

Page({
  data: {
    orderId: '',
    order: null,
    applicants: [],
    rejectedApplicants: []
  },

  onLoad(options) {
    const orderId = options.id
    this.setData({ orderId })
    this.loadOrderDetail(orderId)
    this.loadApplicants(orderId)
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

  loadApplicants(orderId) {
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getApplicants',
      data: { orderId },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          const payload = res.result.data || {}
          const pendingList = Array.isArray(payload) ? payload : (payload.applicants || [])
          const rejectedList = Array.isArray(payload) ? [] : (payload.rejectedApplicants || [])
          const allProfiles = [...pendingList, ...rejectedList]
          if (allProfiles.length === 0) {
            this.setData({ applicants: [], rejectedApplicants: [] })
            return
          }
          const fileIDs = allProfiles.map(a => a.photo).filter(p => p && p.startsWith('cloud://'))
          const applyPhotos = (urlMap = {}) => {
            const convert = (list) => list.map(a => ({
              ...a,
              photo: urlMap[a.photo] || a.photo
            }))
            this.setData({
              applicants: convert(pendingList),
              rejectedApplicants: convert(rejectedList)
            })
          }
          if (fileIDs.length > 0) {
            wx.cloud.getTempFileURL({
              fileList: fileIDs,
              success: (tempRes) => {
                const urlMap = {}
                tempRes.fileList.forEach(f => { urlMap[f.fileID] = f.tempFileURL })
                applyPhotos(urlMap)
              },
              fail: () => {
                applyPhotos()
              }
            })
          } else {
            applyPhotos()
          }
        } else {
          wx.showToast({ title: res.result.msg || '加载失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('getApplicants fail:', err)
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  rejectApplicant(e) {
    const { openid, name } = e.currentTarget.dataset
    if (!openid) {
      wx.showToast({ title: '运动员信息缺失', icon: 'none' })
      return
    }
    wx.showModal({
      title: '拒绝报名',
      content: `确认拒绝「${name || '该球员'}」？拒绝后会直接放入已取消区域。`,
      confirmText: '拒绝',
      confirmColor: '#FF6B1A',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...' })
        wx.cloud.callFunction({
          name: 'applyOrder',
          data: {
            orderId: this.data.orderId,
            action: 'reject_applicant',
            athleteOpenid: openid
          },
          success: (result) => {
            wx.hideLoading()
            const r = result.result || {}
            if (r.code !== 0) {
              wx.showToast({ title: r.msg || '操作失败', icon: 'none' })
              return
            }
            wx.showToast({ title: '已拒绝', icon: 'success' })
            this.loadOrderDetail(this.data.orderId)
            this.loadApplicants(this.data.orderId)
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络错误', icon: 'none' })
          }
        })
      }
    })
  },

  selectAthlete(e) {
    const { openid, name } = e.currentTarget.dataset
    if (!openid) {
      wx.showToast({ title: '运动员信息缺失', icon: 'none' })
      return
    }
    const order = this.data.order
    const price = order ? (order.price || 0) : 0
    const displayName = name || '该运动员'
    const orderId = this.data.orderId

    const doStartPayment = () => {
      wx.showLoading({ title: '准备支付...' })
      wx.cloud.callFunction({
        name: 'selectAthlete',
        data: { orderId, athleteOpenid: openid },
        success: (result) => {
          wx.hideLoading()
          const r = result.result || {}
          if (r.code !== 0) {
            wx.showToast({ title: r.msg || '操作失败', icon: 'none', duration: 3000 })
            return
          }
          const { timeStamp, nonceStr, package: pkg, signType, paySign } = r.payParams
          wx.requestPayment({
            timeStamp,
            nonceStr,
            package: pkg,
            signType,
            paySign,
            success: () => {
              wx.showToast({ title: '支付成功 🎉', icon: 'none', duration: 2000 })
              // 如果订单有球队名称，将球员绑定到球队
              const teamName = order ? (order.teamName || '').trim() : ''
              if (teamName) {
                wx.cloud.callFunction({
                  name: 'bindAthleteToTeam',
                  data: { athleteOpenid: openid, teamName, orderId }
                })
              }
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
    }
    const startPayment = () => {
      requestImportantNotice([TEMPLATE_TYPES.order, TEMPLATE_TYPES.payment]).then(doStartPayment)
    }

    wx.showModal({
      title: '确认合作',
      content: '合作球员：' + displayName + '\n报酬：¥' + price + '\n确认后发起微信支付。\n\n保险风险提示：本平台仅为赛事信息中介，不提供保险。足球属高风险运动，建议自行购买运动意外险。未投保产生的损失由参赛方自行承担。',
      confirmText: '去支付',
      confirmColor: '#FF6B1A',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm) return
        startPayment()
      },
      fail: (err) => {
        console.error('showModal fail', err)
        wx.showToast({ title: '确认失败，请重试', icon: 'none' })
      }
    })
  },

  goAthleteProfile(e) {
    const openid = e.currentTarget.dataset.openid
    wx.navigateTo({
      url: '/pages/athlete-profile/athlete-profile?openid=' + openid + '&orderId=' + this.data.orderId
    })
  },

  onUnload() {
    wx.hideLoading()
  },

  goBack() {
    wx.navigateBack()
  }
})
