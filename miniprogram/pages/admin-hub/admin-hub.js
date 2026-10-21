Page({
  data: {
    mode: 'events',
    currentMode: { title: '成绩录入工作台', subtitle: '处理报名审核、赛程数据和公开赛成绩' },
    activeSection: 'workbench',
    activeSubNav: [
      { key: 'todo', label: '待办中心', icon: '✓' },
      { key: 'events', label: '赛事成绩', icon: '▦' },
      { key: 'disputes', label: '数据异议', icon: '◇' }
    ],
    navSections: [
      {
        key: 'workbench',
        label: '赛事工作台',
        items: [
          { key: 'todo', label: '待办中心', icon: '✓' },
          { key: 'events', label: '赛事成绩', icon: '▦' },
          { key: 'disputes', label: '数据异议', icon: '◇' }
        ]
      },
      {
        key: 'reviews',
        label: '审核中心',
        items: [
          { key: 'venues', label: '球馆审核', icon: '⌂' },
          { key: 'levels', label: '等级审核', icon: '★' },
          { key: 'reports', label: '举报审核', icon: '!' }
        ]
      },
      {
        key: 'operations',
        label: '内容运营',
        items: [
          { key: 'metrics', label: '运营数据', icon: '↗' },
          { key: 'posts', label: '帖子管理', icon: '▤' },
          { key: 'deletedPosts', label: '恢复中心', icon: '↶' },
          { key: 'users', label: '用户检索', icon: '⌕' }
        ]
      },
      {
        key: 'system',
        label: '平台管理',
        items: [
          { key: 'settings', label: '平台设置', icon: '⚙' },
          { key: 'auditLogs', label: '操作记录', icon: '◷' }
        ]
      }
    ],
    adminOverview: { venues: 0, levels: 0, reports: 0, disputes: 0, total: 0 },
    todoItems: [],
    auditLogs: [],
    auditLogsLoading: false,
    auditPage: 0,
    auditHasMore: false,
    auditCategory: 'all',
    metricsCards: [],
    metricsHealth: [],
    metricsLoading: false,
    deletedPosts: [],
    deletedPostsLoading: false,
    todoView: 'all',
    events: [],
    visibleEvents: [],
    eventStats: { total: 0, active: 0, pendingReview: 0, closed: 0 },
    venues: [],
    visibleVenues: [],
    venuePage: 0,
    venueHasMore: false,
    reports: [],
    visibleReports: [],
    reportPage: 0,
    reportHasMore: false,
    posts: [],
    visiblePosts: [],
    levelReviews: [],
    visibleLevelReviews: [],
    levelPage: 0,
    levelHasMore: false,
    disputes: [],
    visibleDisputes: [],
    disputePage: 0,
    disputeHasMore: false,
    disputeFilter: 'pending',
    userResults: [],
    userSearchLoading: false,
    keyword: '',
    activeFilter: 'pending',
    venueFilter: 'pending',
    reportFilter: 'pending',
    levelFilter: 'pending',
    loading: true,
    availableSubjectTypes: [],
    settingsLoading: false,
    paymentConfig: [],
    venueCommissionRate: 8,
    scoreFormula: null,
    scoreFormulaText: '',
    formulaTierKeys: ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+'],
    footballPositionKeys: ['边锋', '中锋', '前腰', '后腰', '边后卫', '中后卫', '门将'],
    footballDetailWeightKeys: [
      { key: 'keyPasses', label: '关键传球' },
      { key: 'throughBalls', label: '成功直塞' },
      { key: 'keyThroughBalls', label: '关键直塞' },
      { key: 'shotsOnTarget', label: '射正' },
      { key: 'bigChanceMissed', label: '错失机会' },
      { key: 'dribbles', label: '成功过人' },
      { key: 'tackles', label: '抢断' },
      { key: 'interceptions', label: '拦截' },
      { key: 'blocks', label: '封堵' },
      { key: 'errorToGoal', label: '导致丢球失误' },
      { key: 'keeperSaves', label: '扑救' },
      { key: 'keeperBigSaves', label: '扑出绝佳机会' },
      { key: 'keeperError', label: '门将失误' }
    ],
    formulaTierRows: [],
    footballAttackRows: [],
    footballDefenseRows: [],
    footballPositionRows: [],
    footballDetailWeightRows: []
  },

  onLoad() {
    const app = getApp()
    const subjectTypes = app.globalData.subjectTypes || []
    this.setData({ availableSubjectTypes: subjectTypes })
    // 首屏只加载当前赛事页和待办汇总，其他模块在进入时再请求。
    this.loadEvents()
    this.loadTodoSummary()
  },

  loadTodoSummary() {
    wx.cloud.callFunction({
      name: 'getAdminTodoSummary',
      success: (res) => {
        const data = (res.result && res.result.data) || null
        if (!data) return
        const todoItems = [
          { key: 'reports', title: '举报审核', desc: '处理社区风险反馈与信誉处罚', count: data.reports, priority: data.reports ? '待处理' : '已清空', tone: data.reports ? 'warning' : 'done' },
          { key: 'venues', title: '球馆审核', desc: '核验经营资料与场地信息', count: data.venues, priority: data.venues ? '待处理' : '已清空', tone: data.venues ? 'warning' : 'done' },
          { key: 'levels', title: '等级审核', desc: '审核球员履历和证明材料', count: data.levels, priority: data.levels ? '待处理' : '已清空', tone: data.levels ? 'warning' : 'done' },
          { key: 'disputes', title: '数据异议', desc: '处理赛果和个人数据反馈', count: data.disputes, priority: data.disputes ? '待处理' : '已清空', tone: data.disputes ? 'warning' : 'done' },
          { key: 'events', title: '赛事报名', desc: '复核公开赛待审核队伍', count: data.eventRegistrations, priority: data.eventRegistrations ? '待审核' : '已清空', tone: data.eventRegistrations ? 'warning' : 'done' }
        ]
        this.setData({ adminOverview: data, todoItems })
      }
    })
  },

  switchToRole(e) {
    const app = getApp()
    const types = this.data.availableSubjectTypes || app.globalData.subjectTypes || []
    if (!types.length) return
    const labels = { athlete: '球员', boss: '主办方', venue: '球馆' }
    const items = types.map(t => labels[t] || t)
    if (items.length === 1) {
      this._confirmSwitch(types[0])
    } else {
      wx.showActionSheet({
        itemList: items,
        success: (res) => {
          this._confirmSwitch(types[res.tapIndex])
        }
      })
    }
  },

  _confirmSwitch(role) {
    const app = getApp()
    const labels = { athlete: '球员', boss: '主办方', venue: '球馆' }
    wx.showModal({
      title: '切换身份',
      content: `切换到「${labels[role] || role}」身份？可在个人页随时切回管理后台。`,
      confirmText: '切换',
      confirmColor: '#FF6B1A',
      success: (modalRes) => {
        if (!modalRes.confirm) return
        app.switchSubject(role, (res) => {
          if (res.code === 0) {
            app.goSubjectHome(role)
          } else {
            wx.showToast({ title: res.msg || '切换失败', icon: 'none' })
          }
        })
      }
    })
  },

  onShow() {
    if (this.data.events.length > 0) {
      this.silentRefresh()
    }
  },

  silentRefresh() {
    if (this.data.mode === 'reports') {
      this.loadReports(false)
    } else if (this.data.mode === 'levels') {
      this.loadLevelReviews(false)
    } else if (this.data.mode === 'disputes') {
      this.loadDisputes(false)
    } else if (this.data.mode === 'settings') {
      this.loadSettings(false)
    } else if (this.data.mode === 'auditLogs') {
      this.loadAuditLogs(false)
    } else if (this.data.mode === 'venues') {
      this.loadVenues(false)
    } else if (this.data.mode === 'posts') {
      this.loadPosts(false)
    } else {
      wx.cloud.callFunction({
        name: 'getAdminEvents',
        success: (res) => {
          if (res.result.code === 0) {
          this.setData({ events: res.result.data }, () => {
            this.applyFilters()
            this.loadTodoSummary()
          })
          }
        }
      })
    }
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.selectMode(mode)
  },

  switchSection(e) {
    const sectionKey = e.currentTarget.dataset.section
    const section = (this.data.navSections || []).find(item => item.key === sectionKey)
    if (!section || !section.items || !section.items.length) return
    this.setData({ activeSection: sectionKey, activeSubNav: section.items }, () => {
      this.selectMode(section.items[0].key)
    })
  },

  selectMode(mode) {
    const section = (this.data.navSections || []).find(item => (item.items || []).some(entry => entry.key === mode))
    const currentMode = this.getModeMeta(mode)
    this.setData({
      mode,
      currentMode,
      keyword: '',
      activeSection: section ? section.key : this.data.activeSection,
      activeSubNav: section ? section.items : this.data.activeSubNav
    }, () => {
      if (mode === 'venues') this.applyVenueFilters()
      else if (mode === 'posts') this.applyPostFilters()
      else if (mode === 'reports') this.applyReportFilters()
      else if (mode === 'levels') this.applyLevelFilters()
      else if (mode === 'disputes') this.loadDisputes()
      else if (mode === 'todo') this.loadTodoSummary()
      else if (mode === 'metrics') this.loadMetrics()
      else if (mode === 'users') this.setData({ userResults: [], userSearchLoading: false })
      else if (mode === 'settings') this.loadSettings(false)
      else if (mode === 'auditLogs') this.loadAuditLogs()
      else if (mode === 'deletedPosts') this.loadDeletedPosts()
      else this.applyFilters()
    })
  },

  getModeMeta(mode) {
    const groups = this.data.navSections || []
    for (let i = 0; i < groups.length; i++) {
      const item = (groups[i].items || []).find(entry => entry.key === mode)
      if (item) {
        const subtitles = {
          events: '处理报名审核、赛程数据和公开赛成绩',
          todo: '集中处理平台内所有需要人工介入的事项',
          venues: '核验场馆资料，维护可用场地',
          levels: '审核球员等级与证明材料',
          reports: '优先处理社区风险反馈',
          metrics: '查看新增、报名、约场和支付核心运营指标',
          posts: '查看并处理平台内容',
          disputes: '处理赛事数据反馈',
          users: '按关键身份信息检索账号',
          settings: '维护平台结算与积分规则'
          ,auditLogs: '查看管理员高风险操作的处理记录', deletedPosts: '恢复 30 天保留期内误删的内容'
        }
        return { title: item.label, subtitle: subtitles[mode] || 'Sportlight 平台运营管理' }
      }
    }
    return { title: '平台管理', subtitle: 'Sportlight 平台运营管理' }
  },

  updateAdminOverview() {
    const count = (list, field) => (list || []).filter(item => item[field] === 'pending').length
    const overdueCount = (list, field, hours) => (list || []).filter(item => {
      if (item[field] !== 'pending') return false
      const raw = item.createdAt || item.submittedAt || item.applyAt
      const value = raw && typeof raw.toDate === 'function' ? raw.toDate() : raw
      const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
      return Number.isFinite(time) && Date.now() - time >= hours * 60 * 60 * 1000
    }).length
    const venues = count(this.data.venues, 'status')
    const levels = count(this.data.levelReviews, 'levelReviewStatus')
    const reports = count(this.data.reports, 'status')
    const disputes = count(this.data.disputes, 'status')
    const overdueReports = overdueCount(this.data.reports, 'status', 24)
    const overdueVenues = overdueCount(this.data.venues, 'status', 48)
    const overdueLevels = overdueCount(this.data.levelReviews, 'levelReviewStatus', 48)
    const overdueDisputes = overdueCount(this.data.disputes, 'status', 24)
    const eventRegistrations = (this.data.events || []).reduce((sum, item) => sum + (Number(item.pendingCount) || 0), 0)
    const todoItems = [
      { key: 'reports', title: '举报审核', desc: '处理社区风险反馈与信誉处罚', count: reports, overdue: overdueReports, priority: overdueReports ? `已超时 ${overdueReports} 项` : (reports ? '24小时内处理' : '已清空'), tone: overdueReports ? 'danger' : (reports ? 'warning' : 'done') },
      { key: 'venues', title: '球馆审核', desc: '核验经营资料与场地信息', count: venues, overdue: overdueVenues, priority: overdueVenues ? `已超时 ${overdueVenues} 项` : (venues ? '48小时内处理' : '已清空'), tone: overdueVenues ? 'danger' : (venues ? 'warning' : 'done') },
      { key: 'levels', title: '等级审核', desc: '审核球员履历和证明材料', count: levels, overdue: overdueLevels, priority: overdueLevels ? `已超时 ${overdueLevels} 项` : (levels ? '48小时内处理' : '已清空'), tone: overdueLevels ? 'danger' : (levels ? 'warning' : 'done') },
      { key: 'disputes', title: '数据异议', desc: '处理赛果和个人数据反馈', count: disputes, overdue: overdueDisputes, priority: overdueDisputes ? `已超时 ${overdueDisputes} 项` : (disputes ? '24小时内处理' : '已清空'), tone: overdueDisputes ? 'danger' : (disputes ? 'warning' : 'done') },
      { key: 'events', title: '赛事报名', desc: '复核公开赛待审核队伍', count: eventRegistrations, priority: eventRegistrations ? '待审核' : '已清空', tone: eventRegistrations ? 'warning' : 'done' }
    ]
    this.setData({
      adminOverview: { venues, levels, reports, disputes, total: venues + levels + reports + disputes + eventRegistrations },
      todoItems
    })
  },

  openTodo(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === 'venues') this.setData({ venueFilter: 'pending' })
    if (mode === 'levels') this.setData({ levelFilter: 'pending' })
    if (mode === 'reports') this.setData({ reportFilter: 'pending' })
    if (mode === 'disputes') this.setData({ disputeFilter: 'pending' })
    if (mode === 'events') this.setData({ activeFilter: 'pending' })
    this.selectMode(mode)
  },

  refreshCurrent() {
    if (this.data.mode === 'todo') {
      this.loadEvents()
      this.loadVenues(false)
      this.loadReports(false)
      this.loadLevelReviews(false)
      this.loadDisputes(false)
      this.loadTodoSummary()
    } else if (this.data.mode === 'reports') this.loadReports()
    else if (this.data.mode === 'levels') this.loadLevelReviews()
    else if (this.data.mode === 'disputes') this.loadDisputes()
    else if (this.data.mode === 'settings') this.loadSettings()
    else if (this.data.mode === 'auditLogs') this.loadAuditLogs()
    else if (this.data.mode === 'deletedPosts') this.loadDeletedPosts()
    else if (this.data.mode === 'venues') this.loadVenues()
    else if (this.data.mode === 'posts') this.loadPosts()
    else if (this.data.mode === 'metrics') this.loadMetrics()
    else if (this.data.mode === 'users') this.submitUserSearch()
    else this.loadEvents()
  },

  loadPaymentConfigStatus() {
    wx.cloud.callFunction({
      name: 'getPaymentConfigStatus',
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0) this.setData({ paymentConfig: result.data || [] })
      }
    })
  },

  loadDeletedPosts(showLoading = true) {
    if (showLoading) this.setData({ deletedPostsLoading: true })
    wx.cloud.callFunction({ name: 'getDeletedPosts', success: (res) => {
      const result = res.result || {}
      if (result.code === 0) this.setData({ deletedPosts: result.data || [] })
      this.setData({ deletedPostsLoading: false })
    }, fail: () => this.setData({ deletedPostsLoading: false }) })
  },

  loadMetrics() {
    this.setData({ metricsLoading: true })
    wx.cloud.callFunction({
      name: 'getAdminMetrics',
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0) {
          this.setData({
            metricsCards: (result.data && result.data.cards) || [],
            metricsHealth: (result.data && result.data.health) || []
          })
        } else {
          wx.showToast({ title: result.msg || '运营数据加载失败', icon: 'none' })
        }
        this.setData({ metricsLoading: false })
      },
      fail: () => {
        this.setData({ metricsLoading: false })
        wx.showToast({ title: '运营数据加载失败', icon: 'none' })
      }
    })
  },

  restoreDeletedPost(e) {
    const postId = e.currentTarget.dataset.id
    wx.showModal({ title: '恢复帖子', content: '恢复后帖子会重新对用户可见，确认继续？', confirmText: '恢复', confirmColor: '#FF6B1A', success: modal => {
      if (!modal.confirm) return
      wx.cloud.callFunction({ name: 'restoreAdminPost', data: { postId }, success: res => {
        const result = res.result || {}
        if (result.code === 0) { wx.showToast({ title: '已恢复', icon: 'success' }); this.loadDeletedPosts(false); this.loadAuditLogs(false) }
        else wx.showToast({ title: result.msg || '恢复失败', icon: 'none' })
      }, fail: () => wx.showToast({ title: '恢复失败', icon: 'none' }) })
    } })
  },

  setTodoView(e) { this.setData({ todoView: e.currentTarget.dataset.view }) },

  loadAuditLogs(showLoading = true, append = false) {
    if (showLoading) this.setData({ auditLogsLoading: true })
    wx.cloud.callFunction({
      name: 'getAdminAuditLogs',
      data: { limit: 50, page: append ? this.data.auditPage + 1 : 0, category: this.data.auditCategory },
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0) {
          const actionLabels = {
            venue_review: '球馆审核', athlete_level_review: '球员等级审核', report_review: '举报处理',
            post_delete: '删除帖子', post_restore: '恢复帖子', user_account_reset: '重置账号', platform_settings_update: '更新平台设置', match_dispute_resolve: '处理数据异议',
            event_certify: '认证赛事', event_certification_cancel: '取消赛事认证',
            sensitive_data_view: '查看敏感资料', athlete_level_review_created: '创建等级审核',
            user_hard_delete: '硬删除账号', recompute_official_athlete_scores: '重算官方积分'
          }
          const auditLogs = (result.data || []).map(item => ({
            ...item,
            actionLabel: actionLabels[item.action] || item.action || '后台操作',
            timeLabel: this.formatAuditTime(item.createdAt)
          }))
          this.setData({
            auditLogs: append ? [...this.data.auditLogs, ...auditLogs] : auditLogs,
            auditPage: result.page || 0,
            auditHasMore: !!result.hasMore
          })
        }
        this.setData({ auditLogsLoading: false })
      },
      fail: () => {
        this.setData({ auditLogsLoading: false })
        if (showLoading) wx.showToast({ title: '操作记录加载失败', icon: 'none' })
      }
    })
  },

  setAuditCategory(e) {
    this.setData({ auditCategory: e.currentTarget.dataset.category || 'all', auditPage: 0 }, () => this.loadAuditLogs())
  },

  loadMoreAuditLogs() {
    if (!this.data.auditHasMore || this.data.auditLogsLoading) return
    this.loadAuditLogs(false, true)
  },

  formatAuditTime(value) {
    if (!value) return '时间未知'
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return '时间未知'
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },

  loadSettings(showLoading = true) {
    if (showLoading) this.setData({ settingsLoading: true })
    this.loadPaymentConfigStatus()
    wx.cloud.callFunction({
      name: 'getPlatformSettings',
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0) {
          const scoreFormula = result.data.scoreFormula || null
          this.setData({
            venueCommissionRate: result.data.venueCommissionRate || 8,
            scoreFormula,
            scoreFormulaText: this.buildScoreFormulaText(scoreFormula),
            formulaTierRows: this.buildTierRows(scoreFormula),
            footballAttackRows: this.buildBucketRows(scoreFormula, 'attack'),
            footballDefenseRows: this.buildBucketRows(scoreFormula, 'defense'),
            footballPositionRows: this.buildPositionRows(scoreFormula),
            footballDetailWeightRows: this.buildDetailWeightRows(scoreFormula)
          })
        }
        this.setData({ settingsLoading: false })
      },
      fail: () => {
        wx.showToast({ title: '平台设置加载失败', icon: 'none' })
        this.setData({ settingsLoading: false })
      }
    })
  },

  loadReports(showLoading = true, append = false) {
    if (showLoading) this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getAdminReports',
      data: { limit: 30, page: append ? this.data.reportPage + 1 : 0 },
      success: (res) => {
        if (res.result && res.result.code === 0) {
          const reports = res.result.data || []
          this.setData({
            reports: append ? [...this.data.reports, ...reports] : reports,
            reportPage: res.result.page || 0,
            reportHasMore: !!res.result.hasMore,
            loading: false
          }, () => {
            this.applyReportFilters()
          })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '举报加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: (err) => {
        wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  loadPosts(showLoading = true) {
    if (showLoading) this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getAdminPosts',
      data: { limit: 100 },
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0) {
          this.setData({ posts: result.data || [], loading: false }, () => this.applyPostFilters())
        } else {
          wx.showToast({ title: result.msg || '帖子加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: (err) => {
        wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  loadLevelReviews(showLoading = true, append = false) {
    if (showLoading) this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getAthleteLevelReviews',
      data: { limit: 30, page: append ? this.data.levelPage + 1 : 0 },
      success: (res) => {
        if (res.result && res.result.code === 0) {
          const levelReviews = res.result.data || []
          this.setData({
            levelReviews: append ? [...this.data.levelReviews, ...levelReviews] : levelReviews,
            levelPage: res.result.page || 0,
            levelHasMore: !!res.result.hasMore,
            loading: false
          }, () => {
            this.applyLevelFilters()
          })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '等级审核加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: (err) => {
        wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  loadDisputes(showLoading = true, append = false) {
    if (showLoading) this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getMatchDisputes',
      data: { status: 'all', limit: 30, page: append ? this.data.disputePage + 1 : 0 },
      success: (res) => {
        if (res.result && res.result.code === 0) {
          const disputes = res.result.data || []
          this.setData({
            disputes: append ? [...this.data.disputes, ...disputes] : disputes,
            disputePage: res.result.page || 0,
            disputeHasMore: !!res.result.hasMore,
            loading: false
          }, () => {
            this.applyDisputeFilters()
          })
        } else {
          this.setData({ loading: false })
        }
      },
      fail: () => {
        this.setData({ loading: false })
      }
    })
  },

  applyDisputeFilters() {
    const { disputes, disputeFilter } = this.data
    const visible = disputeFilter === 'all'
      ? disputes
      : disputes.filter(d => d.status === disputeFilter)
    this.setData({ visibleDisputes: visible })
  },

  setDisputeFilter(e) {
    this.setData({ disputeFilter: e.currentTarget.dataset.filter }, () => this.applyDisputeFilters())
  },

  loadMoreReviews(e) {
    const type = e.currentTarget.dataset.type
    if (type === 'venues' && this.data.venueHasMore) this.loadVenues(false, true)
    if (type === 'reports' && this.data.reportHasMore) this.loadReports(false, true)
    if (type === 'levels' && this.data.levelHasMore) this.loadLevelReviews(false, true)
    if (type === 'disputes' && this.data.disputeHasMore) this.loadDisputes(false, true)
  },

  async resolveDispute(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '处理异议',
      content: '确认已处理该数据异议？',
      confirmText: '确认',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'resolveMatchDispute',
          data: { disputeId: id },
          success: () => {
            wx.showToast({ title: '已处理', icon: 'success' })
          this.loadDisputes(false)
          this.loadTodoSummary()
          },
          fail: () => wx.showToast({ title: '操作失败', icon: 'none' })
        })
      }
    })
  },

  onCommissionInput(e) {
    this.setData({ venueCommissionRate: e.detail.value })
  },

  onScoreFormulaInput(e) {
    const path = e.currentTarget.dataset.path
    if (!path) return
    const scoreFormula = JSON.parse(JSON.stringify(this.data.scoreFormula || {}))
    const parts = String(path).split('.')
    let cursor = scoreFormula
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cursor[parts[i]]) cursor[parts[i]] = {}
      cursor = cursor[parts[i]]
    }
    cursor[parts[parts.length - 1]] = e.detail.value
    this.setData({ scoreFormula }, () => {
      this.setData({
        scoreFormulaText: this.buildScoreFormulaText(this.data.scoreFormula),
        formulaTierRows: this.buildTierRows(this.data.scoreFormula),
        footballAttackRows: this.buildBucketRows(this.data.scoreFormula, 'attack'),
        footballDefenseRows: this.buildBucketRows(this.data.scoreFormula, 'defense'),
        footballPositionRows: this.buildPositionRows(this.data.scoreFormula),
        footballDetailWeightRows: this.buildDetailWeightRows(this.data.scoreFormula)
      })
    })
  },

  buildTierRows(formula) {
    const coeffs = (formula && formula.tierCoefficients) || {}
    return this.data.formulaTierKeys.map(key => ({ key, value: coeffs[key] }))
  },

  buildPositionRows(formula) {
    const weights = (formula && formula.football && formula.football.positionWeights) || {}
    return this.data.footballPositionKeys.map(key => ({
      key,
      attack: weights[key] && weights[key].attack,
      defense: weights[key] && weights[key].defense,
      opportunity: weights[key] && weights[key].opportunity
    }))
  },

  buildBucketRows(formula, type) {
    const football = (formula && formula.football) || {}
    const keys = type === 'attack' ? ['0', '1', '2', '3', '4+'] : ['0', '1', '2', '3', '4', '5+']
    const map = type === 'attack' ? (football.teamAttackByGoals || {}) : (football.teamDefenseByAgainst || {})
    return keys.map(key => ({
      key,
      label: type === 'attack' ? `进${key}` : `失${key}`,
      value: map[key],
      path: type === 'attack' ? `football.teamAttackByGoals.${key}` : `football.teamDefenseByAgainst.${key}`
    }))
  },

  buildDetailWeightRows(formula) {
    const weights = (((formula || {}).football || {}).detailWeights) || {}
    return this.data.footballDetailWeightKeys.map(item => ({
      ...item,
      value: weights[item.key],
      path: `football.detailWeights.${item.key}`
    }))
  },

  buildScoreFormulaText(formula) {
    if (!formula) return ''
    const br = (formula.basketball || {}).resultBase || {}
    const fr = (formula.football || {}).resultBase || {}
    const bc = ((formula.basketball || {}).detailCaps) || {}
    return [
      '通用：单场积分 =（比赛胜负基础分 + 个人表现修正）× 比赛强度系数 × 出场时间比重，最终四舍五入为整数。',
      `强度系数：1 -（球员段位系数 - 双方平均段位系数），限制在 ${formula.intensityMin}-${formula.intensityMax}。`,
      `篮球：赢球 ${br.win}，输球 ${br.loss}；分/板/助/断/帽按权重加分，失误按权重扣分，单场限制 ${bc.matchDeltaMin} 到 ${bc.matchDeltaMax}。`,
      `足球：赢 ${fr.win}，平 ${fr.draw}，输 ${fr.loss}；球队进球和失球按位置权重折算，个人事件按下方十项事件权重计算。`,
      '足球标准事件：进球、助攻、射正、成功过人、关键直塞、关键传球、成功抢断、扑救、黄牌、红牌。主观评分和旧版详细字段不参与当前算法。',
      '用户端只展示处理后的“比赛胜负”和“个人表现”两个模块，不展示强度、段位、位置和时间系数。'
    ].join('\n')
  },

  savePlatformSettings() {
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'updatePlatformSettings',
      data: {
        venueCommissionRate: Number(this.data.venueCommissionRate),
        scoreFormula: this.data.scoreFormula
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) wx.showToast({ title: '已保存', icon: 'success' })
        else wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
  },

  loadEvents() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getAdminEvents',
      success: (res) => {
        if (res.result.code === 0) {
          this.setData({ events: res.result.data, loading: false }, () => {
            this.applyFilters()
          })
        } else {
          wx.showToast({ title: res.result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: (err) => {
        console.error('getAdminEvents 调用失败:', err)
        wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  loadVenues(showLoading = true, append = false) {
    if (showLoading) this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getAdminVenues',
      data: { limit: 30, page: append ? this.data.venuePage + 1 : 0 },
      success: (res) => {
        if (res.result && res.result.code === 0) {
          const venues = res.result.data || []
          this.setData({
            venues: append ? [...this.data.venues, ...venues] : venues,
            venuePage: res.result.page || 0,
            venueHasMore: !!res.result.hasMore,
            loading: false
          }, () => {
            this.applyVenueFilters()
          })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: (err) => {
        console.error('getAdminVenues 调用失败:', err)
        wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  formatCloudError(err) {
    const msg = (err && (err.errMsg || err.message)) || '云函数调用失败'
    if (msg.includes('not found') || msg.includes('function not found')) return '云函数未部署'
    if (msg.includes('Environment not found')) return '云环境未找到'
    if (msg.includes('timeout')) return '云函数超时'
    if (msg.includes('permission')) return '云函数权限异常'
    return msg
  },

  seedDemoData() {
    wx.showModal({
      title: '生成测试数据',
      content: '将生成一组足球公开赛和24支队伍的模拟赛程。重复点击会复用同一组测试赛事。',
      confirmText: '生成',
      confirmColor: '#FF6B1A',
      success: (modalRes) => {
        if (!modalRes.confirm) return
        wx.showLoading({ title: '生成中...' })
        wx.cloud.callFunction({
          name: 'seedDemoFootballData',
          data: {},
          success: (res) => {
            wx.hideLoading()
            if (res.result && res.result.code === 0) {
              wx.showToast({ title: '测试数据已生成', icon: 'success' })
              this.loadEvents()
              if (res.result.postId) {
                setTimeout(() => {
                  wx.navigateTo({ url: `/pages/open-tournament/open-tournament?postId=${res.result.postId}` })
                }, 700)
              }
            } else {
              wx.showToast({ title: (res.result && res.result.msg) || '生成失败', icon: 'none' })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            console.error('seedDemoFootballData 调用失败:', err)
            wx.showModal({
              title: '测试数据生成失败',
              content: this.formatCloudError(err),
              showCancel: false,
              confirmText: '我知道了'
            })
          }
        })
      }
    })
  },

  setFilter(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.filter }, () => this.applyFilters())
  },

  toggleEventCertification(e) {
    const { id, title, certified } = e.currentTarget.dataset
    if (!id) return
    const isCertified = certified === true || certified === 'true'
    const action = isCertified ? 'cancel' : 'certify'
    wx.showModal({
      title: isCertified ? '取消赛事认证' : '认证赛事',
      content: isCertified
        ? `确认取消「${title || '该赛事'}」的 Sportlight 官方认证？取消后将停止发放认证比赛卡，也不会出现在认证赛事列表中。`
        : `确认将「${title || '该赛事'}」认证为 Sportlight 官方平台认证赛事？认证后该赛事可以发放认证比赛卡。`,
      confirmText: isCertified ? '取消认证' : '确认认证',
      confirmColor: isCertified ? '#D9534F' : '#FF6B1A',
      success: (modalRes) => {
        if (!modalRes.confirm) return
        wx.showLoading({ title: isCertified ? '取消中...' : '认证中...' })
        wx.cloud.callFunction({
          name: 'adminSetEventCertification',
          data: { postId: id, action },
          success: (res) => {
            wx.hideLoading()
            const result = res.result || {}
            if (result.code === 0) {
              wx.showToast({ title: result.msg || '操作成功', icon: 'success' })
              this.loadEvents()
            } else {
              wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
          }
        })
      }
    })
  },

  setVenueFilter(e) {
    this.setData({ venueFilter: e.currentTarget.dataset.filter }, () => this.applyVenueFilters())
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value || '' }, () => {
      if (this.data.mode === 'venues') this.applyVenueFilters()
      else if (this.data.mode === 'posts') this.applyPostFilters()
      else if (this.data.mode === 'reports') this.applyReportFilters()
      else if (this.data.mode === 'levels') this.applyLevelFilters()
      else if (this.data.mode === 'users') {
        if (!this.data.keyword.trim()) this.setData({ userResults: [] })
      }
      else if (this.data.mode === 'settings') return
      else this.applyFilters()
    })
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => {
      if (this.data.mode === 'venues') this.applyVenueFilters()
      else if (this.data.mode === 'posts') this.applyPostFilters()
      else if (this.data.mode === 'reports') this.applyReportFilters()
      else if (this.data.mode === 'levels') this.applyLevelFilters()
      else if (this.data.mode === 'users') this.setData({ userResults: [], userSearchLoading: false })
      else if (this.data.mode === 'settings') return
      else this.applyFilters()
    })
  },

  submitUserSearch() {
    if (this.data.mode !== 'users') return
    const keyword = (this.data.keyword || '').trim()
    if (!keyword) {
      this.setData({ userResults: [] })
      wx.showToast({ title: '请输入手机号或用户ID', icon: 'none' })
      return
    }

    this.setData({ userSearchLoading: true })
    wx.cloud.callFunction({
      name: 'searchAdminUsers',
      data: { keyword },
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0) {
          this.setData({ userResults: result.data || [], userSearchLoading: false })
        } else {
          wx.showToast({ title: result.msg || '查询失败', icon: 'none' })
          this.setData({ userSearchLoading: false })
        }
      },
      fail: (err) => {
        wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
        this.setData({ userSearchLoading: false })
      }
    })
  },

  viewSensitiveUserData(e) {
    const { openid, name } = e.currentTarget.dataset
    if (!openid) return
    wx.showModal({
      title: '查看敏感信息',
      content: `将查看「${name || '该用户'}」的完整手机号与 OpenID，本次查看会记录在操作日志中。请填写查看原因。`,
      editable: true,
      placeholderText: '例如：处理支付、身份核验或用户申诉',
      confirmText: '查看并记录',
      confirmColor: '#FF6B1A',
      success: modal => {
        if (!modal.confirm) return
        const reason = String(modal.content || '').trim()
        if (!reason) return wx.showToast({ title: '请填写查看原因', icon: 'none' })
        wx.showLoading({ title: '读取中...' })
        wx.cloud.callFunction({
          name: 'getAdminUserSensitiveData',
          data: { targetOpenid: openid, reason },
          success: res => {
            wx.hideLoading()
            const result = res.result || {}
            if (result.code !== 0) return wx.showToast({ title: result.msg || '读取失败', icon: 'none' })
            const data = result.data || {}
            wx.showModal({
              title: '敏感信息',
              content: `手机号：${data.phone || '未绑定'}\nOpenID：${data.openid || '无'}\n\n本次查看已记录。`,
              showCancel: false,
              confirmText: '关闭'
            })
            this.loadAuditLogs(false)
          },
          fail: err => { wx.hideLoading(); wx.showToast({ title: this.formatCloudError(err), icon: 'none' }) }
        })
      }
    })
  },

  resetUserAccount(e) {
    const { openid, name } = e.currentTarget.dataset
    if (!openid) return

    wx.showModal({
      title: '重置用户账号',
      content: `确认重置「${name || openid}」吗？将删除 users 和 athletes 中的账号资料。他下次打开小程序会作为新用户重新注册，历史订单、赛事、聊天记录会保留。`,
      confirmText: '确认重置',
      confirmColor: '#FF5A5F',
      success: (modalRes) => {
        if (!modalRes.confirm) return
        wx.showLoading({ title: '重置中...' })
        wx.cloud.callFunction({
          name: 'adminResetUserAccount',
          data: { openid, confirm: 'RESET_ACCOUNT' },
          success: (res) => {
            wx.hideLoading()
            const result = res.result || {}
            if (result.code === 0) {
              wx.showToast({ title: '已重置', icon: 'success' })
              this.setData({
                userResults: (this.data.userResults || []).filter(user => user.openid !== openid)
              })
            } else {
              wx.showToast({ title: result.msg || '重置失败', icon: 'none' })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
          }
        })
      }
    })
  },

  handleUserAction(e) {
    const action = e.currentTarget.dataset.action
    if (action === 'promote') return this.promoteUserToAdmin(e)
    if (action === 'level') return this.setUserLevelReview(e)
    if (action === 'reset') return this.resetUserAccount(e)
    wx.showToast({ title: '未知操作', icon: 'none' })
  },

  promoteUserToAdmin(e) {
    const index = Number(e.currentTarget.dataset.index)
    const user = (this.data.userResults || [])[index] || {}
    const openid = e.currentTarget.dataset.openid || user.openid || ''
    const name = e.currentTarget.dataset.name || user.name || openid
    if (!openid) {
      wx.showToast({ title: '未获取到用户ID', icon: 'none' })
      return
    }
    this.confirmPromoteUserToAdmin(openid, name)
  },

  confirmPromoteUserToAdmin(openid, name) {
    wx.showModal({
      title: '设为管理员',
      content: `确认将「${name || openid}」设为管理员吗？该用户将获得后台管理权限。`,
      confirmText: '设为管理员',
      confirmColor: '#FF6B1A',
      success: (modalRes) => {
        if (!modalRes.confirm) return
        wx.showLoading({ title: '处理中...' })
        wx.cloud.callFunction({
          name: 'adminPromoteUser',
          data: { targetOpenid: openid, confirm: 'PROMOTE_ADMIN' },
          success: (res) => {
            wx.hideLoading()
            const result = res.result || {}
            if (result.code === 0) {
              wx.showToast({ title: '已设为管理员', icon: 'success' })
              this.submitUserSearch()
            } else {
              wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
          }
        })
      }
    })
  },

  setUserLevelReview(e) {
    const index = Number(e.currentTarget.dataset.index)
    const user = (this.data.userResults || [])[index] || {}
    const openid = e.currentTarget.dataset.openid || user.openid || ''
    const name = e.currentTarget.dataset.name || user.name || openid
    if (!openid) {
      wx.showToast({ title: '未获取到用户ID', icon: 'none' })
      return
    }
    const isAthlete = (user.userType || e.currentTarget.dataset.usertype || '') === 'athlete'
    const activityActionText = user.activityAdmin ? '取消活动管理员' : '设为活动管理员'
    const itemList = isAthlete
      ? ['设为管理员', activityActionText, '发起S级审核', '发起A级审核', '发起B级审核', '发起C级审核']
      : ['设为管理员', activityActionText]
    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (res.tapIndex === 0) {
          setTimeout(() => this.confirmPromoteUserToAdmin(openid, name), 250)
          return
        }
        if (res.tapIndex === 1) {
          setTimeout(() => this.confirmSetActivityAdmin(openid, name, !user.activityAdmin), 250)
          return
        }
        const tier = ['S', 'A', 'B', 'C'][res.tapIndex - 2]
        if (!tier) return
        wx.showModal({
          title: '发起等级审核',
          content: `将「${name || openid}」设为申请 ${tier} 级，并进入等级审核列表。`,
          editable: true,
          placeholderText: '备注，选填',
          confirmText: '确认',
          confirmColor: '#FF6B1A',
          success: (modalRes) => {
            if (!modalRes.confirm) return
            wx.showLoading({ title: '处理中...' })
            wx.cloud.callFunction({
              name: 'adminSetAthleteLevelReview',
              data: { athleteOpenid: openid, tier, note: modalRes.content || '' },
              success: (callRes) => {
                wx.hideLoading()
                const result = callRes.result || {}
                if (result.code === 0) {
                  wx.showToast({ title: '已加入审核', icon: 'success' })
                  this.submitUserSearch()
                  this.loadLevelReviews(false)
                } else {
                  wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
                }
              },
              fail: (err) => {
                wx.hideLoading()
                wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
              }
            })
          }
        })
      }
    })
  },

  confirmSetActivityAdmin(openid, name, enabled) {
    wx.showModal({
      title: enabled ? '设为活动管理员' : '取消活动管理员',
      content: enabled
        ? `确认将「${name || openid}」设为活动管理员吗？该用户可发布活动、更新公告、公众号转载和联名内容。`
        : `确认取消「${name || openid}」的活动管理员权限吗？`,
      confirmText: enabled ? '确认设置' : '确认取消',
      confirmColor: '#FF6B1A',
      success: (modalRes) => {
        if (!modalRes.confirm) return
        wx.showLoading({ title: '处理中...' })
        wx.cloud.callFunction({
          name: 'adminSetActivityAdmin',
          data: { targetOpenid: openid, enabled, confirm: 'SET_ACTIVITY_ADMIN' },
          success: (res) => {
            wx.hideLoading()
            const result = res.result || {}
            if (result.code === 0) {
              wx.showToast({ title: enabled ? '已设置' : '已取消', icon: 'success' })
              this.submitUserSearch()
            } else {
              wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
          }
        })
      }
    })
  },

  applyFilters() {
    const keyword = (this.data.keyword || '').trim().toLowerCase()
    const events = this.data.events || []
    const eventStats = {
      total: events.length,
      active: events.filter(ev => ev.eventStatus !== 'closed').length,
      pendingReview: events.reduce((sum, ev) => sum + (Number(ev.pendingCount) || 0), 0),
      closed: events.filter(ev => ev.eventStatus === 'closed').length
    }
    const visibleEvents = events.filter(ev => {
      if (this.data.activeFilter === 'pending' && ev.eventStatus === 'closed') return false
      if (this.data.activeFilter === 'certified' && !ev.platformCertified) return false
      if (!keyword) return true
      return [
        ev.title,
        ev.content,
        ev.eventDate,
        ev.eventLocation,
        ev.sport,
        ev.authorName,
        ev.statusLabel
      ].filter(Boolean).join(' ').toLowerCase().includes(keyword)
    })
    this.setData({ visibleEvents, eventStats })
  },

  applyVenueFilters() {
    const keyword = (this.data.keyword || '').trim().toLowerCase()
    const visibleVenues = (this.data.venues || []).filter(venue => {
      if (this.data.venueFilter !== 'all' && venue.status !== this.data.venueFilter) return false
      if (!keyword) return true
      return [
        venue.name,
        venue.venueType,
        venue.city,
        venue.address,
        venue.locationName,
        venue.operatorName,
        venue.phone,
        venue.statusLabel,
        (venue.sports || []).join(' '),
        (venue.courtTypes || []).join(' ')
      ].filter(Boolean).join(' ').toLowerCase().includes(keyword)
    }).map(venue => ({
      ...venue,
      previewImages: [venue.coverImage].concat(venue.galleryImages || []).filter(Boolean),
      sportsText: (venue.sports || []).join(' / '),
      operatorText: [venue.operatorName, venue.phone].filter(Boolean).join(' · '),
      courtSummary: (venue.courtTypes || []).map(type => {
        const count = venue.courtCounts && venue.courtCounts[type] ? venue.courtCounts[type] : ''
        return count ? `${type}×${count}` : type
      }).join(' / ')
    }))
    this.setData({ visibleVenues })
  },

  applyPostFilters() {
    const keyword = (this.data.keyword || '').trim().toLowerCase()
    const visiblePosts = (this.data.posts || []).filter(post => {
      if (!keyword) return true
      return [
        post.title,
        post.content,
        post.authorName,
        post.authorOpenid,
        post.typeLabel,
        post.eventDate,
        post.eventLocation
      ].filter(Boolean).join(' ').toLowerCase().includes(keyword)
    })
    this.setData({ visiblePosts })
  },

  deleteAdminPost(e) {
    const { id, title, author } = e.currentTarget.dataset
    if (!id) return
    wx.showModal({
      title: '删除帖子',
      content: `确认删除「${title || '该帖子'}」吗？作者：${author || '未知'}。删除后帖子和评论将不可恢复。`,
      confirmText: '删除',
      confirmColor: '#FF5A5F',
      success: (modalRes) => {
        if (!modalRes.confirm) return
        wx.showLoading({ title: '删除中...' })
        wx.cloud.callFunction({
          name: 'adminDeletePost',
          data: { postId: id, confirm: 'DELETE_POST' },
          success: (res) => {
            wx.hideLoading()
            const result = res.result || {}
            if (result.code === 0) {
              wx.showToast({ title: '已删除', icon: 'success' })
              this.setData({
                posts: (this.data.posts || []).filter(post => post._id !== id)
              }, () => this.applyPostFilters())
            } else {
              wx.showToast({ title: result.msg || '删除失败', icon: 'none' })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
          }
        })
      }
    })
  },

  setReportFilter(e) {
    this.setData({ reportFilter: e.currentTarget.dataset.filter }, () => this.applyReportFilters())
  },

  setLevelFilter(e) {
    this.setData({ levelFilter: e.currentTarget.dataset.filter }, () => this.applyLevelFilters())
  },

  applyReportFilters() {
    const keyword = (this.data.keyword || '').trim().toLowerCase()
    const visibleReports = (this.data.reports || []).filter(report => {
      const status = report.status || 'pending'
      if (this.data.reportFilter === 'pending' && status !== 'pending') return false
      if (this.data.reportFilter === 'done' && status === 'pending') return false
      if (!keyword) return true
      return [
        report.reporterName,
        report.targetName,
        report.reason,
        report.scene,
        report.statusLabel
      ].filter(Boolean).join(' ').toLowerCase().includes(keyword)
    })
    this.setData({ visibleReports: visibleReports.map(report => {
      const text = `${report.reason || ''} ${report.scene || ''}`
      const high = /暴力|威胁|骚扰|诈骗|未成年|色情|人身/.test(text)
      return { ...report, riskLabel: high ? '高风险' : '一般风险', riskTone: high ? 'high' : 'normal' }
    }) })
  },

  applyLevelFilters() {
    const keyword = (this.data.keyword || '').trim().toLowerCase()
    const visibleLevelReviews = (this.data.levelReviews || []).filter(item => {
      const status = item.levelReviewStatus || 'none'
      if (this.data.levelFilter === 'pending' && status !== 'pending') return false
      if (this.data.levelFilter === 'done' && status === 'pending') return false
      if (this.data.levelFilter !== 'all' && this.data.levelFilter !== 'pending' && this.data.levelFilter !== 'done' && status !== this.data.levelFilter) return false
      if (!keyword) return true
      return [
        item.name,
        item.nickname,
        item.sportlightId,
        item.sport,
        item.position,
        item.city,
        item.affiliation,
        item.careerLabel,
        item.levelLabel,
        item.proposedTier,
        item.statusLabel
      ].filter(Boolean).join(' ').toLowerCase().includes(keyword)
    }).map(item => {
      const reviewProofs = item.levelReviewProofs || []
      const allProofs = [...(item.proofFiles || []), ...reviewProofs]
      return {
        ...item,
        proofPreview: allProofs.length ? allProofs[0] : '',
        proofCount: allProofs.length,
        reviewProofCount: reviewProofs.length
      }
    })
    this.setData({ visibleLevelReviews })
  },

  approveLevel(e) {
    const { id, name, tier } = e.currentTarget.dataset
    wx.showModal({
      title: '通过等级审核',
      content: `确认通过「${name || '该球员'}」的 ${tier || ''} 级申请？`,
      confirmText: '通过',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        this.reviewAthleteLevel(id, 'approve')
      }
    })
  },

  rejectLevel(e) {
    const { id, name } = e.currentTarget.dataset
    this.chooseReason('驳回等级审核', ['证明材料不足', '申请等级与履历不匹配', '资料信息不完整', '其他原因'], reason => this.reviewAthleteLevel(id, 'reject', reason))
  },

  reviewAthleteLevel(athleteId, action, reason = '') {
    wx.showLoading({ title: action === 'approve' ? '通过中...' : '驳回中...' })
    wx.cloud.callFunction({
      name: 'reviewAthleteLevel',
      data: { athleteId, action, reason },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: action === 'approve' ? '已通过' : '已驳回', icon: 'success' })
          this.loadLevelReviews(false)
          this.loadTodoSummary()
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '操作失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
      }
    })
  },

  warnReport(e) {
    this.reviewReport(e.currentTarget.dataset.id, 'warn')
  },

  rejectReport(e) {
    this.reviewReport(e.currentTarget.dataset.id, 'reject')
  },

  deductReport(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '扣除信誉分',
      content: '请输入要扣除的信誉分，1-100',
      editable: true,
      placeholderText: '例如：10',
      confirmText: '扣分',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        const points = Number(res.content)
        if (!points || points <= 0) return wx.showToast({ title: '请输入扣分数', icon: 'none' })
        this.reviewReport(id, 'deduct', points)
      }
    })
  },

  reviewReport(reportId, action, deductPoints = 0) {
    wx.showLoading({ title: '处理中...' })
    wx.cloud.callFunction({
      name: 'reviewReport',
      data: { reportId, action, deductPoints },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '已处理', icon: 'success' })
          this.loadReports(false)
          this.loadTodoSummary()
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '处理失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
      }
    })
  },

  goEnterResults(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/open-tournament/open-tournament?postId=${id}` })
  },

  resyncEventCards(e) {
    const { id, title } = e.currentTarget.dataset
    wx.showModal({
      title: '补发球星卡',
      content: `重新扫描「${title || '该赛事'}」所有已结束比赛，为符合条件的球员补发/更新球星卡。已撤回的卡也会恢复。`,
      confirmText: '补发',
      confirmColor: '#FF6B1A',
      success: (modalRes) => {
        if (!modalRes.confirm) return
        wx.showLoading({ title: '补发中...' })
        wx.cloud.callFunction({
          name: 'syncMatchCards',
          data: { sourceType: 'open_tournament_match', sourceId: id, syncAll: true, recordedByOpenid: '' },
          success: (res) => {
            wx.hideLoading()
            const result = res.result || {}
            if (result.code === 0) {
              const issued = result.issued || 0
              const pending = result.pending || 0
              const withdrawn = result.withdrawn || 0
              wx.showToast({ title: `已发放 ${issued} 张${withdrawn ? '，撤回 ' + withdrawn + ' 张' : ''}`, icon: 'success' })
            } else {
              wx.showToast({ title: result.msg || '补发失败', icon: 'none' })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
          }
        })
      }
    })
  },

  goEventRegistrants(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/event-registrants/event-registrants?postId=${id}` })
  },

  previewImage(e) {
    const src = e.currentTarget.dataset.src
    const urls = e.currentTarget.dataset.urls || [src]
    if (!src) return
    wx.previewImage({ current: src, urls })
  },

  approveVenue(e) {
    const { id, name } = e.currentTarget.dataset
    wx.showModal({
      title: '通过球馆审核',
      content: `确认通过「${name || '该球馆'}」的入驻申请？`,
      confirmText: '通过',
      confirmColor: '#FF6B1A',
      success: (res) => {
        if (!res.confirm) return
        this.reviewVenue(id, 'approve')
      }
    })
  },

  rejectVenue(e) {
    const { id, name } = e.currentTarget.dataset
    this.chooseReason('驳回球馆审核', ['经营资质或图片不完整', '场馆地址信息不完整', '场地信息不符合要求', '其他原因'], reason => this.reviewVenue(id, 'reject', reason))
  },

  chooseReason(title, templates, callback) {
    wx.showActionSheet({ itemList: templates, success: pick => {
      const selected = templates[pick.tapIndex]
      if (selected !== '其他原因') return callback(selected)
      wx.showModal({ title, content: '请填写处理原因', editable: true, placeholderText: '请输入原因', confirmText: '确认', confirmColor: '#FF5A5F', success: modal => {
        if (modal.confirm) callback(modal.content || '其他原因')
      } })
    } })
  },

  reviewVenue(id, action, reason = '') {
    wx.showLoading({ title: action === 'approve' ? '通过中...' : '驳回中...' })
    wx.cloud.callFunction({
      name: 'reviewVenue',
      data: { venueId: id, action, reason },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: action === 'approve' ? '已通过' : '已驳回', icon: 'success' })
          this.loadVenues(false)
          this.loadTodoSummary()
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '操作失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        wx.showToast({ title: this.formatCloudError(err), icon: 'none' })
      }
    })
  },

  get filteredEvents() {
    const { events, activeFilter } = this.data
    if (activeFilter === 'pending') {
      return events.filter(ev => ev.eventStatus !== 'closed')
    }
    return events
  }
})
