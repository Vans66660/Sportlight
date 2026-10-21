const identity = require('../../utils/identity')

Page({
  data: {
    loading: true,
    submitting: false,
    post: null,
    mode: 'choose',
    teams: [],
    selectedTeam: null,
    selectedOpenids: {},
    selectedCount: 0
  },

  onLoad(options) {
    this.postId = options.postId || ''
    this.load()
  },

  load() {
    wx.cloud.callFunction({
      name: 'getEventRegistrationOptions',
      data: { postId: this.postId },
      success: r => {
        const result = r.result || {}
        if (result.code !== 0) {
          this.setData({ loading: false })
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          return
        }
        this.setData({ loading: false, post: result.post, teams: result.teams || [] })
      },
      fail: () => {
        this.setData({ loading: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  chooseSolo() {
    const post = this.data.post || {}
    if (post.registrationMode === 'team') return wx.showToast({ title: '该赛事仅支持球队报名', icon: 'none' })
    wx.showModal({
      title: '散客报名',
      content: '你将进入本赛事的散客报名池。后续可由队长邀请加入参赛队伍，报名截止后统一按 AA 方式缴费。',
      confirmText: '确认进入',
      confirmColor: '#FF6B1A',
      success: res => { if (res.confirm) identity.ensureVerified(() => this.submit({ registrationType: 'solo' })) }
    })
  },

  chooseTeam() {
    if ((this.data.post || {}).registrationMode === 'solo') return wx.showToast({ title: '该赛事仅支持散客报名', icon: 'none' })
    this.setData({ mode: 'team' })
  },

  chooseTemporary() {
    wx.redirectTo({ url: `/pages/post-detail/post-detail?id=${this.postId}&registration=temporary` })
  },

  selectTeam(e) {
    const team = this.data.teams[Number(e.currentTarget.dataset.index)]
    if (!team) return
    const selectedOpenids = {}
    const limit = (this.data.post && this.data.post.maxTeamMembers) || (this.data.post && this.data.post.teamSize) || 99
    ;(team.members || []).forEach(member => {
      if (member.openid === team.captainOpenid || Object.keys(selectedOpenids).length < limit) selectedOpenids[member.openid] = true
    })
    selectedOpenids[team.captainOpenid] = true
    this.setData({ mode: 'roster', selectedTeam: team, selectedOpenids, selectedCount: Object.keys(selectedOpenids).length })
  },

  toggleMember(e) {
    const openid = e.currentTarget.dataset.openid
    const team = this.data.selectedTeam
    if (!openid || !team || openid === team.captainOpenid) return
    const selectedOpenids = { ...this.data.selectedOpenids }
    const limit = (this.data.post && this.data.post.maxTeamMembers) || (this.data.post && this.data.post.teamSize) || 99
    if (selectedOpenids[openid]) delete selectedOpenids[openid]
    else {
      if (Object.keys(selectedOpenids).length >= limit) return wx.showToast({ title: `本次最多选择 ${limit} 人`, icon: 'none' })
      selectedOpenids[openid] = true
    }
    this.setData({ selectedOpenids, selectedCount: Object.keys(selectedOpenids).length })
  },

  submitRegular() {
    const team = this.data.selectedTeam
    if (!team) return
    const min = (this.data.post && this.data.post.minTeamSize) || 1
    if (this.data.selectedCount < min) return wx.showToast({ title: `至少选择 ${min} 人`, icon: 'none' })
    wx.showModal({
      title: '确认球队报名',
      content: `将以「${team.name}」报名。已选 ${this.data.selectedCount} 人，队员可通过通知或分享链接确认参赛；报名截止后统一 AA 缴费。`,
      confirmText: '确认报名',
      confirmColor: '#FF6B1A',
      success: res => {
        if (!res.confirm) return
        identity.ensureVerified(() => this.submit({
          registrationType: 'regular_team',
          sourceTeamId: team._id,
          memberOpenids: Object.keys(this.data.selectedOpenids)
        }))
      }
    })
  },

  submit(data) {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    wx.cloud.callFunction({
      name: 'registerEvent',
      data: { postId: this.postId, ...data },
      success: r => {
        this.setData({ submitting: false })
        const result = r.result || {}
        if (result.code !== 0) return wx.showToast({ title: result.msg || '报名失败', icon: 'none' })
        wx.showToast({ title: result.msg || '报名成功', icon: 'success' })
        setTimeout(() => wx.redirectTo({ url: `/pages/post-detail/post-detail?id=${this.postId}` }), 600)
      },
      fail: () => {
        this.setData({ submitting: false })
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  goBack() {
    if (this.data.mode === 'roster') this.setData({ mode: 'team' })
    else if (this.data.mode === 'team') this.setData({ mode: 'choose' })
    else wx.navigateBack()
  }
})
