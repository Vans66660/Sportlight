const app = getApp()
const identity = require('../../utils/identity')
const { requestImportantNotice, TEMPLATE_TYPES } = require('../../utils/subscribe-notice')

const INSURANCE_DISCLAIMER = '平台仅提供赛事信息服务，不提供保险。参赛前请自行评估运动风险，建议购买运动意外险。'

function showInsuranceDisclaimer(callback) {
  wx.showModal({
    title: '保险风险免责声明',
    content: INSURANCE_DISCLAIMER,
    confirmText: '已知晓，继续',
    cancelText: '取消',
    confirmColor: '#FF6B1A',
    success: res => { if (res.confirm && callback) callback() }
  })
}

Page({
  data: {
    post: null,
    comments: [],
    eventResults: [],
    inputVal: '',
    keyboardBottom: 0,
    keyboardActive: false,
    myOpenid: '',
    loading: true,
    loadError: false,
    soloRegistering: false,
    teamModal: {
      show: false,
      teamName: '',
      totalSize: 0,
      submitting: false,
      preparingSubmit: false,
      disclaimerShow: false,
      slots: [],
      searchPanel: {
        show: false,
        slotIndex: -1,
        keyword: '',
        results: [],
        frequent: [],
        loadingFrequent: false,
        searching: false,
        selectedOpenids: {},
        selectedNames: {}
      }
    }
  },

  onLoad(options) {
    this.postId = options.id
    this.openTemporaryRegistration = options.registration === 'temporary'
    app.onLoginReady(() => {
      this.setData({ myOpenid: app.globalData.openid })
    })
    this.load()
  },

  onShow() {
    if (!this._keyboardHandler) {
      this._keyboardHandler = (res) => {
        const height = res.height || 0
        this.setData({
          keyboardBottom: height > 0 ? height + 2 : 0,
          keyboardActive: height > 0
        })
      }
    }
    if (!this._keyboardListening && wx.onKeyboardHeightChange) {
      wx.onKeyboardHeightChange(this._keyboardHandler)
      this._keyboardListening = true
    }
  },

  onHide() {
    this.setData({ keyboardBottom: 0, keyboardActive: false })
  },

  onUnload() {
    clearTimeout(this._teamSubmitTimer)
    this._teamSubmitPending = false
    wx.hideLoading()
    if (wx.offKeyboardHeightChange && this._keyboardHandler) {
      wx.offKeyboardHeightChange(this._keyboardHandler)
    }
    this._keyboardListening = false
    wx.hideLoading()
  },

  load() {
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getPostDetail',
      data: { postId: this.postId },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          const post = res.result.post
          post.timeLabel = this.timeAgo(post.createdAt)
          post.typeLabel = this.typeLabel(post.type)
          const comments = res.result.comments.map(c => ({
            ...c,
            timeLabel: this.timeAgo(c.createdAt)
          }))
          const eventResults = (res.result.eventResults || []).map(r => ({
            ...r,
            medalIcon: r.rank === 1 ? '/images/icons/medal-gold.png' : r.rank === 2 ? '/images/icons/medal-silver.png' : r.rank === 3 ? '/images/icons/medal-bronze.png' : null
          }))
          this.setData({ post, comments, eventResults, loading: false })
          if (post.postType === 'event') {
            wx.setNavigationBarTitle({ title: '赛事详情' })
            if (this.openTemporaryRegistration) {
              this.openTemporaryRegistration = false
              setTimeout(() => this.registerEvent(), 80)
            }
          }
        } else {
          this.setData({ loading: false, loadError: true })
          wx.showToast({ title: res.result.msg || '加载失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ loading: false, loadError: true })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  goEventRegistration() {
    wx.navigateTo({ url: `/pages/event-registration/event-registration?postId=${this.postId}` })
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
  },

  typeLabel(type) {
    const map = { match_result: '⚔️ 赛果', training: '💪 训练', collab: '📣 合作', general: '💬 日常' }
    return map[type] || '💬 日常'
  },

  goBack() {
    wx.navigateBack()
  },

  deletePost() {
    wx.showModal({
      title: '删除动态',
      content: '删除后无法恢复，确认吗？',
      confirmText: '删除',
      confirmColor: '#E53935',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        wx.cloud.callFunction({
          name: 'deletePost',
          data: { postId: this.postId },
          success: (r) => {
            wx.hideLoading()
            if (r.result.code === 0) {
              wx.navigateBack()
            } else {
              wx.showToast({ title: r.result.msg || '删除失败', icon: 'none' })
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

  likePost() {
    const post = this.data.post
    if (!post || post.likePending) return

    const oldLiked = !!post.liked
    const oldCount = post.likesCount || 0
    const newLiked = !oldLiked
    const newCount = Math.max(0, oldCount + (newLiked ? 1 : -1))
    this.setData({ 'post.liked': newLiked, 'post.likesCount': newCount, 'post.likePending': true })
    wx.cloud.callFunction({
      name: 'likePost',
      data: { postId: this.postId },
      success: (res) => {
        if (res.result.code !== 0) {
          this.setData({ 'post.liked': oldLiked, 'post.likesCount': oldCount, 'post.likePending': false })
          return
        }
        this.setData({
          'post.liked': !!res.result.liked,
          'post.likesCount': res.result.likesCount,
          'post.likePending': false
        })
      },
      fail: () => {
        this.setData({ 'post.liked': oldLiked, 'post.likesCount': oldCount, 'post.likePending': false })
      }
    })
  },

  registerEvent() {
    const post = this.data.post
    if (!post || post.isRegistered || post.isPending || post.isAssembling || post.isSoloPending || post.eventStatus === 'full' || post.eventStatus === 'closed') return
    const teamSize = Math.max(post.teamSize || 5, post.maxTeamMembers || 0)
    const slotCount = Math.max(0, teamSize - 1)
    const slots = Array.from({ length: slotCount }, () => ({ openid: null, name: '', photoUrl: '' }))
    this.setData({
      'teamModal.show': true,
      'teamModal.teamName': '',
      'teamModal.totalSize': teamSize,
      'teamModal.submitting': false,
      'teamModal.preparingSubmit': false,
      'teamModal.disclaimerShow': false,
      'teamModal.slots': slots,
      'teamModal.searchPanel.show': false,
      'teamModal.searchPanel.keyword': '',
      'teamModal.searchPanel.results': []
    })
  },

  registerSolo() {
    const post = this.data.post
    if (this.data.soloRegistering) return
    if (!post || post.isRegistered || post.isPending || post.isAssembling || post.isSoloPending || post.eventStatus === 'full' || post.eventStatus === 'closed') return
    wx.showModal({
      title: '散客报名',
      content: `提交后你会进入散客报名池，队长可以向你发出组队邀请。\n\n${INSURANCE_DISCLAIMER}`,
      confirmText: '确认报名',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        this.setData({ soloRegistering: true })
        identity.ensureVerified(
          () => this._doRegisterSolo(),
          () => this.setData({ soloRegistering: false })
        )
      }
    })
  },

  registerRegularTeam() {
    const post = this.data.post
    const team = post && post.captainRegularTeam
    if (!post || !team || post.isRegistered || post.isPending || post.isAssembling || post.isSoloPending || post.eventStatus === 'full' || post.eventStatus === 'closed') return
    wx.showModal({
      title: '以球队身份报名',
      content: `确认代表「${team.name || '我的球队'}」报名该赛事？提交后会进入主办方审核名单，并通知队员确认参赛。\n\n${INSURANCE_DISCLAIMER}`,
      confirmText: '确认报名',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        identity.ensureVerified(() => this._doRegisterRegularTeam(team.teamId))
      }
    })
  },

  _doRegisterRegularTeam(sourceTeamId) {
    requestImportantNotice([TEMPLATE_TYPES.event, TEMPLATE_TYPES.team])
    wx.showLoading({ title: '报名中...' })
    wx.cloud.callFunction({
      name: 'registerEvent',
      data: { postId: this.postId, registrationType: 'regular_team', sourceTeamId },
      success: (r) => {
        wx.hideLoading()
        const result = r.result || {}
        if (result.code === 0) {
          this.setData({
            'post.isPending': true,
            'post.myRegistrationId': result.registrationId
          })
          wx.showToast({ title: '已提交审核', icon: 'success' })
        } else {
          wx.showToast({ title: result.msg || '报名失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  _doRegisterSolo() {
    requestImportantNotice([TEMPLATE_TYPES.event, TEMPLATE_TYPES.team])
    wx.showLoading({ title: '报名中...' })
    wx.cloud.callFunction({
      name: 'registerEvent',
      data: { postId: this.postId, registrationType: 'solo' },
      success: (r) => {
        wx.hideLoading()
        this.setData({ soloRegistering: false })
        const result = r.result
        if (result.code === 0) {
          this.setData({
            'post.isSoloPending': true,
            'post.myRegistrationId': result.registrationId,
            'post.myMembers': []
          })
          wx.showToast({ title: '已进入散客池', icon: 'success' })
        } else {
          wx.showToast({ title: result.msg, icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ soloRegistering: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  closeTeamModal() {
    clearTimeout(this._teamSubmitTimer)
    this._teamSubmitPending = false
    this.setData({
      'teamModal.show': false,
      'teamModal.submitting': false,
      'teamModal.preparingSubmit': false,
      'teamModal.disclaimerShow': false,
      'teamModal.searchPanel.show': false
    })
  },

  onTeamNameInput(e) {
    this.setData({ 'teamModal.teamName': e.detail.value })
  },

  hideKeyboard() {
    if (wx.hideKeyboard) wx.hideKeyboard()
  },

  _buildSelectedOpenids(slots) {
    const map = {}
    if (this.data.myOpenid) map[this.data.myOpenid] = true
    slots.forEach(s => { if (s.openid) map[s.openid] = true })
    return map
  },

  _buildSelectedNames(slots) {
    const map = {}
    slots.forEach(s => {
      const name = (s.name || '').trim()
      if (name) map[name] = true
    })
    return map
  },

  openSearchPanel(e) {
    const index = e.currentTarget.dataset.index
    const selectedOpenids = this._buildSelectedOpenids(this.data.teamModal.slots)
    const selectedNames = this._buildSelectedNames(this.data.teamModal.slots)
    this.setData({
      'teamModal.searchPanel.show': true,
      'teamModal.searchPanel.slotIndex': index,
      'teamModal.searchPanel.keyword': '',
      'teamModal.searchPanel.results': [],
      'teamModal.searchPanel.frequent': [],
      'teamModal.searchPanel.loadingFrequent': true,
      'teamModal.searchPanel.searching': false,
      'teamModal.searchPanel.selectedOpenids': selectedOpenids,
      'teamModal.searchPanel.selectedNames': selectedNames
    })
    this.loadFrequentTeammates()
  },

  closeSearchPanel() {
    this.setData({ 'teamModal.searchPanel.show': false })
  },

  loadFrequentTeammates() {
    wx.cloud.callFunction({
      name: 'getFrequentTeammates',
      success: (res) => {
        const panel = this.data.teamModal.searchPanel
        if (!panel.show) return
        this.setData({
          'teamModal.searchPanel.frequent': (res.result && res.result.users) || [],
          'teamModal.searchPanel.loadingFrequent': false
        })
      },
      fail: () => {
        this.setData({ 'teamModal.searchPanel.loadingFrequent': false })
      }
    })
  },

  onSearchInput(e) {
    const keyword = e.detail.value
    this.setData({ 'teamModal.searchPanel.keyword': keyword })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    if (!keyword.trim()) {
      this.setData({ 'teamModal.searchPanel.results': [], 'teamModal.searchPanel.searching': false })
      return
    }
    this.setData({ 'teamModal.searchPanel.searching': true })
    this._searchTimer = setTimeout(() => {
      wx.cloud.callFunction({
        name: 'searchUsers',
        data: { keyword: keyword.trim() },
        success: (r) => {
          if (this.data.teamModal.searchPanel.keyword !== keyword) return
          this.setData({ 'teamModal.searchPanel.results': r.result.users || [], 'teamModal.searchPanel.searching': false })
        },
        fail: () => {
          this.setData({ 'teamModal.searchPanel.searching': false })
        }
      })
    }, 400)
  },

  selectMember(e) {
    if (e.currentTarget.dataset.disabled) return
    const user = e.currentTarget.dataset.user
    const selectedNames = this._buildSelectedNames(this.data.teamModal.slots)
    if (selectedNames[(user.name || '').trim()]) {
      wx.showToast({ title: '队员不能重复', icon: 'none' })
      return
    }
    const slotIndex = this.data.teamModal.searchPanel.slotIndex
    const newSlots = [...this.data.teamModal.slots]
    newSlots[slotIndex] = { openid: user.openid, name: user.name, photoUrl: user.photoUrl || '' }
    this.setData({
      'teamModal.slots': newSlots,
      'teamModal.searchPanel.show': false
    })
  },

  removeMember(e) {
    const index = e.currentTarget.dataset.index
    const newSlots = [...this.data.teamModal.slots]
    newSlots[index] = { openid: null, name: '', photoUrl: '' }
    this.setData({ 'teamModal.slots': newSlots })
  },

  saveCaptainGroupQr() {
    const qrUrl = this.data.post && this.data.post.captainGroupQrUrl
    if (!qrUrl) return
    wx.showLoading({ title: '保存中...' })
    wx.downloadFile({
      url: qrUrl,
      success: (res) => {
        if (res.statusCode !== 200) {
          wx.hideLoading()
          wx.showToast({ title: '下载失败', icon: 'none' })
          return
        }
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => {
            wx.hideLoading()
            wx.showToast({ title: '已保存到相册', icon: 'success' })
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '请授权保存到相册', icon: 'none' })
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '下载失败', icon: 'none' })
      }
    })
  },

  handleTeamSubmit() {
    const now = Date.now()
    if (this.data.teamModal.submitting || this.data.teamModal.preparingSubmit) return
    if (this._lastTeamSubmitTapAt && now - this._lastTeamSubmitTapAt < 500) return
    this._lastTeamSubmitTapAt = now
    this.submitTeamReg()
  },

  submitTeamReg() {
    if (this.data.teamModal.submitting || this.data.teamModal.preparingSubmit) return
    if (!this.validateTeamRegistration()) return
    this.setData({ 'teamModal.preparingSubmit': true })
    this.hideKeyboard()
    clearTimeout(this._teamSubmitTimer)
    this._teamSubmitTimer = setTimeout(() => {
      this.setData({
        'teamModal.preparingSubmit': false,
        'teamModal.disclaimerShow': true
      })
    }, 260)
  },

  cancelTeamDisclaimer() {
    this.setData({ 'teamModal.disclaimerShow': false })
  },

  confirmTeamDisclaimer() {
    if (this.data.teamModal.submitting) return
    if (!this.validateTeamRegistration()) return
    this.setData({
      'teamModal.disclaimerShow': false,
      'teamModal.submitting': true
    })
    identity.ensureVerified(
      () => this._doSubmitTeamReg(),
      () => this.setData({ 'teamModal.submitting': false })
    )
  },

  validateTeamRegistration() {
    const { teamModal } = this.data
    if (!teamModal.teamName.trim()) {
      wx.showToast({ title: '请填写队名', icon: 'none' })
      return false
    }
    const seenOpenids = {}
    const seenNames = {}
    for (const slot of teamModal.slots || []) {
      if (!slot.openid) continue
      const name = (slot.name || '').trim()
      if (seenOpenids[slot.openid] || (name && seenNames[name])) {
        wx.showToast({ title: '队员不能重复', icon: 'none' })
        return false
      }
      seenOpenids[slot.openid] = true
      if (name) seenNames[name] = true
    }
    return true
  },

  _doSubmitTeamReg() {
    const { teamModal } = this.data
    if (!this.validateTeamRegistration()) {
      this.setData({ 'teamModal.submitting': false })
      return
    }
    requestImportantNotice([TEMPLATE_TYPES.event, TEMPLATE_TYPES.team])
    wx.showLoading({ title: '报名中...' })
    wx.cloud.callFunction({
      name: 'registerEvent',
      data: { postId: this.postId, teamName: teamModal.teamName, slots: teamModal.slots },
      success: (r) => {
        wx.hideLoading()
        this.setData({ 'teamModal.submitting': false })
        const res = r.result
        if (res.code === 0) {
          this.setData({
            'teamModal.show': false,
            'post.isAssembling': true,
            'post.myInviteCode': res.inviteCode,
            'post.myRegistrationId': res.registrationId
          })
          wx.showToast({ title: '报名已提交', icon: 'success' })
        } else {
          wx.showToast({ title: res.msg, icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ 'teamModal.submitting': false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  onShareAppMessage() {
    const post = this.data.post
    if (post && post.myInviteCode) {
      return {
        title: `加入「${post.myTeamName || '我的队伍'}」一起参加赛事`,
        path: `/pages/join-team/join-team?code=${post.myInviteCode}`
      }
    }
    return { title: post ? (post.title || post.content?.slice(0, 30) || '赛事详情') : '赛事详情', path: `/pages/post-detail/post-detail?id=${this.postId}` }
  },

  goEnterResults() {
    wx.navigateTo({ url: `/pages/open-tournament/open-tournament?postId=${this.postId}` })
  },

  goViewRegistrants() {
    wx.navigateTo({ url: `/pages/event-registrants/event-registrants?postId=${this.postId}` })
  },

  goEventSchedule() {
    wx.navigateTo({ url: `/pages/open-tournament/open-tournament?postId=${this.postId}` })
  },

  goDispute() {
    const title = this.data.post ? (this.data.post.title || '') : ''
    wx.navigateTo({ url: `/pages/match-dispute/match-dispute?postId=${this.postId}&title=${encodeURIComponent(title)}` })
  },

  goEditEvent() {
    wx.navigateTo({ url: `/pages/publish-event/publish-event?postId=${this.postId}` })
  },

  goEventAdmins() {
    wx.navigateTo({ url: `/pages/event-admins/event-admins?postId=${this.postId}` })
  },

  submitTeamForReview() {
    const { post } = this.data
    if (!post || !post.canSubmitReview || !post.myRegistrationId) return
    wx.showModal({
      title: '提交审核',
      content: `当前 ${post.myConfirmedCount}/${post.minTeamSize} 人，提交后将进入赛方审核，不能继续邀请队员。`,
      confirmText: '提交审核',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '提交中...' })
        wx.cloud.callFunction({
          name: 'submitTeamForReview',
          data: { registrationId: post.myRegistrationId },
          success: (r) => {
            wx.hideLoading()
            if (r.result.code === 0) {
              wx.showToast({ title: '已提交审核', icon: 'success' })
              this.load()
            } else {
              wx.showToast({ title: r.result.msg || '提交失败', icon: 'none' })
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

  cancelRegistration() {
    const { post } = this.data
    if (!post || !post.myRegistrationId || !post.canCancelRegistration) return
    const actionText = post.cancelActionText || '取消报名'
    const content = actionText === '退出参赛'
      ? '确认退出本次赛事参赛名单？这不会取消整支队伍的报名。'
      : actionText === '申请取消'
        ? '该报名已涉及平台支付，提交后需要平台处理退款。确认申请取消？'
        : '确认取消本次赛事报名？取消后可在报名截止前重新报名。'
    wx.showModal({
      title: actionText,
      content,
      confirmText: actionText,
      confirmColor: '#E53935',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...' })
        wx.cloud.callFunction({
          name: 'cancelEventRegistration',
          data: { registrationId: post.myRegistrationId },
          success: (r) => {
            wx.hideLoading()
            const result = r.result || {}
            if (result.code === 0) {
              wx.showToast({ title: result.msg || '已取消', icon: 'success' })
              this.load()
            } else {
              wx.showToast({ title: result.msg || '取消失败', icon: 'none' })
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

  goAuthorProfile() {
    const { openid, authorType } = this.data.post
    if (authorType === 'boss') {
      wx.navigateTo({ url: `/pages/boss-profile/boss-profile?openid=${openid}` })
    } else {
      wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
    }
  },

  goAthleteProfile(e) {
    const { openid } = e.currentTarget.dataset
    if (!openid) return
    wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
  },

  previewImage(e) {
    const { src, all } = e.currentTarget.dataset
    wx.previewImage({ current: src, urls: all })
  },

  previewCaptainGroupQr() {
    const qrUrl = this.data.post && this.data.post.captainGroupQrUrl
    if (!qrUrl) return
    wx.previewImage({ current: qrUrl, urls: [qrUrl] })
  },

  onInputChange(e) {
    this.setData({ inputVal: e.detail.value })
  },

  sendComment() {
    const content = this.data.inputVal.trim()
    if (!content) return
    this.setData({ inputVal: '' })
    wx.cloud.callFunction({
      name: 'addComment',
      data: { postId: this.postId, content },
      success: (res) => {
        if (res.result.code === 0) {
          const c = res.result.comment
          c.timeLabel = '刚刚'
          const comments = [...this.data.comments, c]
          const commentCount = (this.data.post.commentCount || 0) + 1
          this.setData({ comments, 'post.commentCount': commentCount })
        } else {
          wx.showToast({ title: res.result.msg, icon: 'none' })
        }
      },
      fail: () => wx.showToast({ title: '发送失败', icon: 'none' })
    })
  }
})
