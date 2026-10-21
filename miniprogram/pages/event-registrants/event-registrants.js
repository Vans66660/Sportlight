Page({
  data: {
    postId: '',
    postInfo: null,
    assembling: [],
    solo: [],
    pending: [],
    confirmed: [],
    seedHint: '',
    loading: true,
    assignModal: {
      show: false,
      soloRegistrationId: '',
      soloName: '',
      teams: [],
      directAssign: false
    },
    detailModal: {
      show: false,
      status: '',
      team: null
    },
    rejectModal: {
      show: false,
      registrationId: '',
      teamName: '',
      selectedType: '',
      selectedLabel: '',
      customReason: '',
      reasons: [
        { type: 'team_size_not_met', label: '队伍人数未达标' },
        { type: 'member_info_incomplete', label: '队员信息不完整' },
        { type: 'member_identity_not_eligible', label: '队员身份不符合赛事要求' },
        { type: 'offline_payment_unconfirmed', label: '报名费/线下收款未确认' },
        { type: 'team_profile_invalid', label: '队名或头像不符合规范' },
        { type: 'duplicate_registration', label: '重复报名' },
        { type: 'event_full', label: '赛事名额已满' },
        { type: 'other', label: '其它' }
      ]
    }
  },

  onLoad(options) {
    this.postId = options.postId
    this.load()
  },

  load() {
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getEventRegistrants',
      data: { postId: this.postId },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          const decorate = team => ({
            ...team,
            ...this._teamCount(team),
            sourceLabel: team.registrationType === 'regular_team' || team.teamSource === 'regular' ? '常规球队' : team.registrationType === 'solo' ? '散客报名' : '临时球队',
            isRegularTeam: team.registrationType === 'regular_team' || team.teamSource === 'regular'
          })
          const assembling = (res.result.assembling || []).map(decorate)
          const pending = (res.result.pending || []).map(decorate)
          const confirmed = (res.result.confirmed || []).map(decorate)
          const postInfo = res.result.post
          this.setData({
            assembling,
            solo: res.result.solo || [],
            pending,
            confirmed,
            postInfo,
            seedHint: this.buildSeedHint(postInfo, confirmed.length),
            loading: false
          })
        } else {
          wx.showToast({ title: res.result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  buildSeedHint(postInfo, confirmedCount) {
    if (!postInfo) return '仅主办方可用：添加机器人队伍用于报名链路、赛程和赛果测试'
    if (postInfo.maxTeams > 0) {
      return `仅主办方可用：补齐到 ${postInfo.maxTeams} 支队，当前已确认 ${confirmedCount} 支`
    }
    return `仅主办方可用：补到至少 8 支队，当前已确认 ${confirmedCount} 支`
  },

  approveEligibleBatch() {
    const min = Number((this.data.postInfo || {}).minTeamSize) || 1
    const eligible = (this.data.pending || []).filter(team => Number(team.confirmedCount || team.memberCount || 0) >= min)
    if (!eligible.length) return wx.showToast({ title: '没有符合人数要求的待审队伍', icon: 'none' })
    wx.showModal({
      title: '批量通过报名',
      content: `将通过 ${eligible.length} 支人数达标的队伍；请确认线下收款状态无误。`,
      confirmText: '批量通过', confirmColor: '#FF6B1A',
      success: modal => {
        if (!modal.confirm) return
        wx.showLoading({ title: '处理中...' })
        Promise.all(eligible.map(team => new Promise(resolve => wx.cloud.callFunction({
          name: 'approveRegistrant', data: { postId: this.postId, registrationId: team._id, action: 'approve' },
          success: res => resolve(res.result || {}), fail: () => resolve({ code: -1 })
        })))).then(results => {
          wx.hideLoading()
          const success = results.filter(item => item.code === 0).length
          wx.showToast({ title: `已通过 ${success}/${eligible.length} 支`, icon: success ? 'success' : 'none' })
          this.load()
        })
      }
    })
  },

  seedVirtualTeams() {
    wx.showModal({
      title: '添加机器人队伍',
      content: '将按赛事名额自动补充已确认的机器人队伍，用于完整测试报名、赛程和赛果链路。',
      confirmText: '添加',
      confirmColor: '#FF6B1A',
      success: (modal) => {
        if (!modal.confirm) return
        wx.showLoading({ title: '添加中...' })
        wx.cloud.callFunction({
          name: 'seedEventRegistrations',
          data: { postId: this.postId },
          success: (res) => {
            wx.hideLoading()
            if (res.result && res.result.code === 0) {
              wx.showToast({ title: res.result.msg || '已添加', icon: 'success' })
              this.load()
            } else {
              wx.showToast({ title: (res.result && res.result.msg) || '添加失败', icon: 'none' })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            console.error('seedEventRegistrations 调用失败:', err)
            wx.showToast({ title: '云函数调用失败', icon: 'none' })
          }
        })
      }
    })
  },

  approve(e) {
    const { id, teamname } = e.currentTarget.dataset
    wx.showModal({
      title: '通过报名',
      content: `确认通过「${teamname || '该队伍'}」的报名？`,
      confirmText: '通过',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        this._doAction(id, 'approve')
      }
    })
  },

  reject(e) {
    const { id, teamname } = e.currentTarget.dataset
    this.setData({
      rejectModal: {
        ...this.data.rejectModal,
        show: true,
        registrationId: id,
        teamName: teamname || '该队伍',
        selectedType: '',
        selectedLabel: '',
        customReason: ''
      }
    })
  },

  closeRejectModal() {
    this.setData({
      'rejectModal.show': false,
      'rejectModal.registrationId': '',
      'rejectModal.teamName': '',
      'rejectModal.selectedType': '',
      'rejectModal.selectedLabel': '',
      'rejectModal.customReason': ''
    })
  },

  noop() {},

  selectRejectReason(e) {
    const { type, label } = e.currentTarget.dataset
    this.setData({
      'rejectModal.selectedType': type,
      'rejectModal.selectedLabel': label,
      'rejectModal.customReason': type === 'other' ? this.data.rejectModal.customReason : ''
    })
  },

  onRejectCustomInput(e) {
    this.setData({ 'rejectModal.customReason': e.detail.value })
  },

  confirmReject() {
    const modal = this.data.rejectModal
    if (!modal.registrationId || !modal.selectedType) {
      return wx.showToast({ title: '请选择拒绝原因', icon: 'none' })
    }
    const customReason = String(modal.customReason || '').trim()
    const rejectReason = modal.selectedType === 'other' ? customReason : modal.selectedLabel
    if (!rejectReason) {
      return wx.showToast({ title: '请填写其它原因', icon: 'none' })
    }
    this._doAction(modal.registrationId, 'reject', {
      rejectReasonType: modal.selectedType,
      rejectReason,
      rejectRemark: modal.selectedType === 'other' ? customReason : ''
    })
  },

  _doAction(registrationId, action, extra = {}) {
    wx.showLoading({ title: action === 'approve' ? '通过中...' : '拒绝中...' })
    wx.cloud.callFunction({
      name: 'approveRegistrant',
      data: { postId: this.postId, registrationId, action, ...extra },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          wx.showToast({ title: res.result.msg, icon: 'success' })
          this.closeRejectModal()
          this.closeTeamDetail()
          this.load()
        } else {
          wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('approveRegistrant 调用失败:', err)
        wx.showToast({ title: '操作状态已刷新', icon: 'none' })
        this.closeTeamDetail()
        this.load()
      }
    })
  },

  openTeamDetail(e) {
    const { status, index } = e.currentTarget.dataset
    const list = this.data[status] || []
    const team = list[index]
    if (!team) return
    this.setData({
      detailModal: {
        show: true,
        status,
        team: {
          ...team,
          ...this._teamCount(team)
        }
      }
    })
  },

  closeTeamDetail() {
    this.setData({
      'detailModal.show': false,
      'detailModal.status': '',
      'detailModal.team': null
    })
  },

  approveDetail() {
    const team = this.data.detailModal.team
    if (!team) return
    this.approve({ currentTarget: { dataset: { id: team._id, teamname: team.teamName } } })
  },

  rejectDetail() {
    const team = this.data.detailModal.team
    if (!team) return
    this.reject({ currentTarget: { dataset: { id: team._id, teamname: team.teamName } } })
  },

  _teamCount(team) {
    const members = team.members || []
    const occupiedCount = members.filter(m => m.openid).length
    const confirmedCount = members.filter(m => m.openid && m.confirmed).length
    const emptyCount = members.filter(m => !m.openid).length
    return { occupiedCount, confirmedCount, emptyCount }
  },

  openAssign(e) {
    const { id, name } = e.currentTarget.dataset
    const maxTeamMembers = this.data.postInfo ? (this.data.postInfo.maxTeamMembers || 0) : 0
    const directAssign = !!(this.data.postInfo && this.data.postInfo.canManage)
    const sourceTeams = directAssign
      ? [...(this.data.assembling || []), ...(this.data.pending || []), ...(this.data.confirmed || [])]
      : (this.data.assembling || [])
    const teams = sourceTeams.map(team => {
      const counts = this._teamCount(team)
      const canInvite = !maxTeamMembers || counts.occupiedCount < maxTeamMembers
      return { ...team, ...counts, canInvite }
    }).filter(team => team.canInvite)

    if (teams.length === 0) {
      wx.showToast({ title: '暂无可邀请的队伍', icon: 'none' })
      return
    }

    this.setData({
      assignModal: {
        show: true,
        soloRegistrationId: id,
        soloName: name || '该球员',
        teams,
        directAssign
      }
    })
  },

  closeAssign() {
    this.setData({
      'assignModal.show': false,
      'assignModal.soloRegistrationId': '',
      'assignModal.soloName': '',
      'assignModal.teams': [],
      'assignModal.directAssign': false
    })
  },

  assignToTeam(e) {
    const { teamid, teamname } = e.currentTarget.dataset
    const { soloRegistrationId, soloName } = this.data.assignModal
    const directAssign = this.data.assignModal.directAssign
    wx.showModal({
      title: directAssign ? '直接分配球员' : '邀请球员',
      content: directAssign
        ? `确认将「${soloName}」直接分配到「${teamname || '该队伍'}」？分配后立即加入本次赛事名单。`
        : `邀请「${soloName}」加入「${teamname || '该队伍'}」？对方同意后才会入队。`,
      confirmText: directAssign ? '确认分配' : '发送邀请',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '发送中...' })
        wx.cloud.callFunction({
          name: directAssign ? 'assignSoloToTeam' : 'inviteSoloToTeam',
          data: {
            postId: this.postId,
            soloRegistrationId,
            teamRegistrationId: teamid
          },
          success: (r) => {
            wx.hideLoading()
            if (r.result.code === 0) {
              wx.showToast({ title: r.result.msg || '已发送', icon: 'success' })
              this.closeAssign()
              this.load()
            } else {
              wx.showToast({ title: r.result.msg || '邀请失败', icon: 'none' })
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

  goEnterResults() {
    wx.navigateTo({ url: `/pages/event-results/event-results?postId=${this.postId}` })
  },

  goEventSchedule() {
    wx.navigateTo({ url: `/pages/open-tournament/open-tournament?postId=${this.postId}` })
  },

  generateSchedule() {
    const teams = (this.data.confirmed || []).filter(team => ['paid', 'free', 'offline', 'unpaid'].includes(team.paymentStatus))
    if (teams.length < 2) {
      wx.showToast({ title: '至少 2 支已确认队伍', icon: 'none' })
      return
    }
    const groupOptions = [1, 2, 3, 4, 6, 8].filter(count => count <= teams.length)
    const itemList = groupOptions.map(count => `${count}组`)
    wx.showActionSheet({
      itemList,
      success: (sheet) => {
        const groupCount = groupOptions[sheet.tapIndex] || 1
        this.chooseScheduleCreateMode(teams, groupCount)
      }
    })
  },

  chooseScheduleCreateMode(teams, groupCount) {
    wx.showActionSheet({
      itemList: ['自定义创建', '系统随机生成'],
      success: (sheet) => {
        if (sheet.tapIndex === 0) {
          wx.navigateTo({
            url: `/pages/open-tournament/open-tournament?postId=${this.postId}&action=manualGroups&groupCount=${groupCount}`
          })
          return
        }
        this.confirmGenerateSchedule(teams, groupCount)
      }
    })
  },

  confirmGenerateSchedule(teams, groupCount) {
    wx.showModal({
      title: '生成赛程',
      content: `将用 ${teams.length} 支已确认参赛队伍生成 ${groupCount} 组公开赛小组赛。若已有赛程，将覆盖重排。`,
      confirmText: '生成',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '生成中...' })
        wx.cloud.callFunction({
          name: 'generateOpenTournamentSchedule',
          data: { tournamentId: this.postId, format: 'cup_groups', groupCount, overwrite: true },
          success: (r) => {
            wx.hideLoading()
            if (r.result && r.result.code === 0) {
              wx.showToast({ title: '赛程已生成', icon: 'success' })
              setTimeout(() => this.goEventSchedule(), 700)
            } else {
              wx.showToast({ title: (r.result && r.result.msg) || '生成失败', icon: 'none' })
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

  goAthleteProfile(e) {
    const { openid } = e.currentTarget.dataset
    if (!openid) return
    wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
  },

  submitTeam(e) {
    const { id, count, min } = e.currentTarget.dataset
    const isManagerSubmit = this.data.postInfo && this.data.postInfo.canApprove && !this.data.postInfo.isCaptain
    wx.showModal({
      title: isManagerSubmit ? '代提交审核' : '提交审核',
      content: `当前 ${count}/${min} 人，确认${isManagerSubmit ? '代队长' : ''}将队伍提交给赛方审核？提交后将不能继续邀请散客池球员。`,
      confirmText: isManagerSubmit ? '代提交' : '提交审核',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '提交中...' })
        wx.cloud.callFunction({
          name: 'submitTeamForReview',
          data: { registrationId: id },
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
  }
})
