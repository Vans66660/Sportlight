Page({
  data: {
    // ── Phase ──
    phase: 'setup',
    tournamentId: '',
    loading: true,
    canManage: false,
    tournament: null,
    sportKicker: 'OPEN TOURNAMENT',

    // ── Setup phase ──
    approvedTeams: [],
    displayTeams: [],
    groupCountDraft: 2,
    groupCountOptions: [2, 3, 4, 6, 8],
    advancePerGroupDraft: 2,
    advancePerGroupOptions: [1, 2, 3, 4],
    showAdvancedSetup: false,
    showDevTools: false,
    pendingAction: '',
    pendingGroupCount: 0,

    // ── Entry phase ──
    entryFilter: { group: 'all', round: 'all', stage: 'all', knockoutRound: 'all', bracket: 'all' },
    groupProgress: [],
    groupOptions: [],
    roundOptions: [],
    knockoutRoundOptions: [],
    scheduleTabs: [],
    activeScheduleTab: 'all',
    entryMatches: [],
    filteredEntryMatches: [],
    selectedMatchId: '',
    editorExpanded: false,
    savingMatch: false,
    completedMatchIds: {},
    completedCount: 0,
    totalCount: 0,
    completionRate: 0,
    workflow: { stage: '报名审核', label: '等待审核参赛队伍', detail: '', settlementLabel: '尚未开始' },
    nextAction: { label: '', detail: '', action: '', count: 0 },
    entrySport: 'football',

    // ── Editor (inline, shared between entry + viewer) ──
    editor: {
      activeTab: 'score',
      match: null,
      homeTeamIndex: 0,
      awayTeamIndex: 1,
      match_date: '',
      match_clock: '',
      match_time: '',
      venue: '',
      status: 'not_started',
      lineupLimit: 0,
      lineups: { home: [], away: [] },
      substitutions: [],
      football: { homeScore: '', awayScore: '', events: [], playerDetails: [] },
      badminton: { homeScore: '', awayScore: '', playerStats: [] },
      basketball: { quarters: [], playerStats: [] }
    },
    editorMatchTeams: [],
    editorTeamOptions: [],
    editorSelectedRoster: [],

    // ── Quick event draft ──
    quickEvent: {
      teamIndex: 0,
      playerIndex: 0,
      typeIndex: 0,
      minute: '',
      count: ''
    },

    // ── Results phase ──
    activeResultsTab: 'standings',
    activeStatTab: 'primary',
    viewerTab: 'schedule',
    standingsList: [],
    leaderboards: null,
    bracketRounds: [],
    viewerBracketRounds: [],
    knockoutChampion: null,
    knockoutChampions: [],
    viewerKnockoutChampions: [],
    knockoutBrackets: [],
    allScheduleMatches: [],

    // ── Modals (reduced) ──
    groupModal: { show: false, title: '', groupCount: 2, groupLabels: [], assignments: [], groupColumns: [], afterSaveGenerate: false, moveIndex: -1, moveTeamName: '' },
    scheduleTool: { show: false, mode: '', targetStage: 'all', targetGroup: 'all', targetRound: 'all', targetKnockoutRound: 'all', match_date: '', match_clock: '', match_time: '', venue: '', status: '', firstIndex: 0, secondIndex: 0 },
    honorEditor: { show: false, modeLabel: '', awards: [], teamOptions: [] },
    matchViewer: { show: false, match: null, teams: [] },
    teamViewer: { show: false, team: null, players: [] },

    // ── Config constants ──
    statusLabels: { not_started: '未开始', in_progress: '进行中', finished: '已结束', postponed: '延期', cancelled: '取消' },
    statusOptions: [
      { label: '未开始', value: 'not_started' },
      { label: '进行中', value: 'in_progress' },
      { label: '已结束', value: 'finished' },
      { label: '延期', value: 'postponed' },
      { label: '取消', value: 'cancelled' }
    ],
    eventTypes: [
      { label: '进球', value: 'goal' },
      { label: '助攻', value: 'assist' },
      { label: '射正', value: 'shot_on_target' },
      { label: '成功过人', value: 'successful_dribble' },
      { label: '关键直塞', value: 'through_ball' },
      { label: '关键传球', value: 'key_pass' },
      { label: '成功抢断', value: 'successful_tackle' },
      { label: '扑救', value: 'save' },
      { label: '黄牌', value: 'yellow_card' },
      { label: '红牌', value: 'red_card' }
    ],
    scheduleStageOptions: [
      { label: '所有赛程', value: 'all' },
      { label: '小组赛', value: 'group' },
      { label: '淘汰赛', value: 'knockout' }
    ],
    scheduleStatusOptions: [
      { label: '不修改状态', value: '' },
      { label: '未开始', value: 'not_started' },
      { label: '进行中', value: 'in_progress' },
      { label: '已结束', value: 'finished' },
      { label: '延期', value: 'postponed' },
      { label: '取消', value: 'cancelled' }
    ],
    footballStatTabs: [
      { label: '射手', value: 'primary' },
      { label: '助攻', value: 'assists' },
      { label: '射正', value: 'shots' },
      { label: '过人', value: 'dribbles' },
      { label: '直塞', value: 'throughBalls' },
      { label: '关键传球', value: 'keyPasses' },
      { label: '抢断', value: 'tackles' },
      { label: '扑救', value: 'saves' },
      { label: '黄牌', value: 'yellowCards' },
      { label: '红牌', value: 'redCards' }
    ],
    basketballStatTabs: [
      { label: '得分', value: 'primary' },
      { label: '篮板', value: 'rebounds' },
      { label: '助攻', value: 'assists' },
      { label: '失误', value: 'turnovers' }
    ],
    badmintonStatTabs: [
      { label: '得分', value: 'primary' },
      { label: '制胜分', value: 'winners' },
      { label: '发球得分', value: 'aces' },
      { label: '救球', value: 'saves' },
      { label: '失误', value: 'errors' }
    ],
    substitutionDraft: { teamIndex: 0, outIndex: 0, inIndex: 0, minute: '' },
    substitutionRoster: [],
    allMatchOptions: []
  },

  // ═══════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════

  onLoad(options) {
    const pendingGroupCount = Number(options.groupCount || 0)
    this.setData({
      tournamentId: options.tournamentId || options.postId || options.id || '',
      pendingAction: options.action || '',
      pendingGroupCount,
      groupCountDraft: pendingGroupCount || this.data.groupCountDraft
    })
    this.load()
  },

  load() {
    if (!this.data.tournamentId) {
      wx.showToast({ title: '缺少赛事ID', icon: 'none' })
      this.setData({ loading: false })
      return
    }
    wx.showLoading({ title: '加载中...' })
    wx.cloud.callFunction({
      name: 'getOpenTournament',
      data: { tournamentId: this.data.tournamentId },
      success: (res) => {
        wx.hideLoading()
        if (!res.result || res.result.code !== 0) {
          wx.showToast({ title: (res.result && res.result.msg) || '加载失败', icon: 'none' })
          this.setData({ loading: false })
          return
        }
        const tournament = res.result.tournament
        const sport = tournament.sport || 'football'
        const sportKicker = sport === 'basketball' ? 'BASKETBALL OPEN' : (sport === 'badminton' ? 'BADMINTON OPEN' : 'FOOTBALL OPEN')
        const hasSchedule = this.hasAnySchedule(tournament.openTournament || {})

        this.setData({
          tournament,
          sportKicker,
          canManage: !!res.result.canManage,
          approvedTeams: res.result.approvedTeams || [],
          entrySport: sport,
          loading: false,
          // 自动进入当前最需要处理的阶段：有未完成赛程时优先录入，否则进入准备。
          phase: hasSchedule ? 'entry' : 'setup'
        }, () => {
          this.rebuildView()
          if (hasSchedule) {
            this.computeCompletedMatches()
            const next = (this.data.entryMatches || []).find(item => item.status !== 'finished')
            if (next) this.setData({ selectedMatchId: next.matchId })
          }
          this.updateWorkflow()
          this.updateNextAction()
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '云函数调用失败', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  hasAnySchedule(ot) {
    return ((ot.matches || []).length + (ot.knockoutMatches || []).length) > 0
  },

  // ═══════════════════════════════════════════
  // Phase navigation
  // ═══════════════════════════════════════════

  switchPhase(e) {
    const phase = e.currentTarget.dataset.phase
    if (phase === this.data.phase) return
    if (phase === 'entry' && !this.hasAnySchedule((this.data.tournament || {}).openTournament || {})) {
      wx.showToast({ title: '请先生成赛程', icon: 'none' })
      return
    }
    this.setData({ phase, selectedMatchId: '', editorExpanded: false })
    if (phase === 'entry') this.computeCompletedMatches()
  },

  goRegistrants() {
    wx.navigateTo({ url: `/pages/event-registrants/event-registrants?postId=${this.data.tournamentId}` })
  },

  runNextAction() {
    const action = this.data.nextAction.action
    if (action === 'registrants') return this.goRegistrants()
    if (action === 'schedule') return this.setData({ phase: 'setup' })
    if (action === 'entry') {
      const next = (this.data.entryMatches || []).find(item => item.status !== 'finished')
      this.setData({ phase: 'entry' }, () => {
        if (next) this.openInlineEditor(next.matchId)
      })
      return
    }
    if (action === 'secondStage') return this.generateSecondStage()
    if (action === 'knockout') return this.generateKnockout()
    if (action === 'results') this.setData({ phase: 'results' })
  },

  updateNextAction() {
    const ot = ((this.data.tournament || {}).openTournament) || {}
    const matches = (ot.matches || []).concat(ot.knockoutMatches || [])
    const unfinished = matches.filter(item => item.status !== 'finished').length
    const firstStageMatches = (ot.matches || []).filter(item => item.phase !== 'second_stage')
    const secondStageMatches = (ot.matches || []).filter(item => item.phase === 'second_stage')
    const firstStageDone = firstStageMatches.length > 0 && firstStageMatches.every(item => item.status === 'finished')
    const secondStageDone = secondStageMatches.length > 0 && secondStageMatches.every(item => item.status === 'finished')
    const teams = this.data.approvedTeams || []
    let nextAction
    if (teams.length < 2) nextAction = { label: '去审核报名', detail: '至少需要 2 支已通过队伍才能生成赛程', action: 'registrants', count: teams.length }
    else if (!matches.length) nextAction = { label: '生成赛事赛程', detail: `${teams.length} 支队伍已就绪，先选择赛制与分组`, action: 'schedule', count: teams.length }
    else if (ot.playoffMode === 'two_stage_split' && firstStageDone && (ot.secondStage || {}).status !== 'active') nextAction = { label: '生成胜者组 / 败者组', detail: '首阶段小组赛已结束，按每组前 2 名分流进入第二阶段', action: 'secondStage', count: firstStageMatches.length }
    else if (ot.playoffMode === 'two_stage_split' && secondStageDone && !(ot.knockoutMatches || []).length) nextAction = { label: '生成两个组别决赛', detail: '胜者组、败者组积分榜已确定，各取前 2 名争冠', action: 'knockout', count: secondStageMatches.length }
    else if (unfinished) nextAction = { label: '录入下一场赛果', detail: `还有 ${unfinished} 场比赛待确认，确认后自动同步积分`, action: 'entry', count: unfinished }
    else nextAction = { label: '核对积分与荣誉', detail: '全部赛果已确认，请在结果页完成最后公示', action: 'results', count: matches.length }
    this.setData({ nextAction })
  },

  updateWorkflow() {
    const ot = ((this.data.tournament || {}).openTournament) || {}
    const matches = (ot.matches || []).concat(ot.knockoutMatches || [])
    const total = matches.length
    const finished = matches.filter(item => item.status === 'finished').length
    const teams = this.data.approvedTeams || []
    let workflow
    if (teams.length < 2) workflow = { stage: '报名审核', label: '等待参赛队伍', detail: `当前已通过 ${teams.length} 支队伍，至少需要 2 支`, settlementLabel: '尚未开始' }
    else if (!total) workflow = { stage: '赛程准备', label: '待生成赛程', detail: `${teams.length} 支已通过队伍可进入分组和排程`, settlementLabel: '尚未开始' }
    else if (finished < total) workflow = { stage: '赛果录入', label: '进行中', detail: `已确认 ${finished}/${total} 场赛果；保存赛果会自动同步积分`, settlementLabel: finished ? '部分已同步' : '等待首场结算' }
    else workflow = { stage: '赛事结算', label: '全部赛果已确认', detail: `${finished} 场比赛均已录入，请在结果页核对积分榜与荣誉`, settlementLabel: '积分已随赛果同步' }
    this.setData({ workflow })
  },

  // ═══════════════════════════════════════════
  // Shared: rebuild view from tournament data
  // ═══════════════════════════════════════════

  rebuildView() {
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    const matches = ot.matches || []
    const groups = ot.groups || []
    const groupOptions = [{ label: '全部小组', value: 'all' }].concat(groups.map(g => ({ label: `${g.groupName}组`, value: g.groupId })))
    const rounds = [...new Set(matches.map(m => m.round_number))].sort((a, b) => a - b)
    const roundOptions = [{ label: '全部轮次', value: 'all' }].concat(rounds.map(r => ({ label: `第${r}轮`, value: String(r) })))
    const knockoutRoundOptions = this.buildKnockoutRoundOptions(ot.knockoutMatches || [])
    const knockoutBrackets = this.buildKnockoutBrackets(ot)
    const scheduleTabs = [
      { label: '所有赛程', value: 'all' },
      { label: '小组赛', value: 'group' }
    ].concat(knockoutBrackets.length > 1
      ? knockoutBrackets.map(bracket => ({ label: bracket.name, value: `bracket_${bracket.bracketId}` }))
      : [{ label: '淘汰赛', value: 'knockout' }])
    const displayTeams = (ot.teams && ot.teams.length ? ot.teams : this.data.approvedTeams).map(team => ({
      ...team,
      teamName: team.teamName || team.name || '未命名队伍',
      roster: team.roster || team.members || []
    }))
    const savedGroupCount = Number(this.data.pendingGroupCount) || Number(ot.groupCount) || (groups.length ? groups.length : this.data.groupCountDraft)
    const allScheduleMatches = this.buildAllScheduleMatches(ot)
    const entryMatches = this.buildEntryMatchList(ot)
    this.setData({
      groupOptions, roundOptions, knockoutRoundOptions, knockoutBrackets,
      scheduleTabs, displayTeams,
      groupCountDraft: savedGroupCount,
      allScheduleMatches, entryMatches,
      standingsList: this.buildStandings(ot.standings || {}, ot),
      leaderboards: ot.leaderboards || null,
      bracketRounds: this.buildBracketRounds((ot.knockoutMatches || []).filter(m => {
        const activeBracketId = String(this.data.activeScheduleTab || '').startsWith('bracket_') ? String(this.data.activeScheduleTab).replace('bracket_', '') : ''
        return !activeBracketId || (m.bracketId || '') === activeBracketId
      })),
      viewerBracketRounds: this.buildBracketRounds(ot.knockoutMatches || []),
      knockoutChampion: this.buildKnockoutChampion(ot),
      knockoutChampions: this.buildKnockoutChampionsList(ot),
      viewerKnockoutChampions: this.buildKnockoutChampionsList(ot),
      allMatchOptions: this.getAllMatchOptions()
    }, () => {
      this.applyEntryFilters()
      if (this.data.canManage && this.data.pendingAction === 'manualGroups') {
        this.setData({ pendingAction: '', pendingGroupCount: 0 })
        this.openManualGroupsForSchedule()
      }
    })
    this.updateWorkflow()
    this.updateNextAction()
  },

  // ═══════════════════════════════════════════
  // Entry phase: match list & filtering
  // ═══════════════════════════════════════════

  buildEntryMatchList(ot) {
    const sport = this.data.entrySport
    const groupMatches = (ot.matches || []).map(m => this.enrichMatch(m, 'group', sport))
    const knockoutMatches = (ot.knockoutMatches || []).map(m => this.enrichMatch(m, 'knockout', sport))
    return this.sortMatchesByTime(groupMatches.concat(knockoutMatches))
  },

  enrichMatch(match, stage, sport) {
    const flags = this.matchScoreFlags(match, sport)
    return {
      ...match,
      scheduleStage: stage,
      groupRoundLabel: stage === 'knockout'
        ? this.normalizeKnockoutLabel(match.roundLabel)
        : `${match.group_name ? match.group_name + '组 · ' : ''}第${match.round_number}轮`,
      statusLabel: this.data.statusLabels[match.status] || '未开始',
      displayScore: match.status === 'finished'
        ? (sport === 'basketball'
          ? `${(match.basketball || {}).homeScore} : ${(match.basketball || {}).awayScore}`
          : (sport === 'badminton'
            ? `${(match.badminton || {}).homeScore} : ${(match.badminton || {}).awayScore}`
            : `${(match.football || {}).homeScore} : ${(match.football || {}).awayScore}`))
        : 'VS',
      ...flags
    }
  },

  applyEntryFilters() {
    const { entryFilter, entryMatches } = this.data
    const filtered = entryMatches.filter(m => {
      if (entryFilter.stage !== 'all' && m.scheduleStage !== entryFilter.stage) return false
      if (entryFilter.stage === 'group') {
        if (entryFilter.group !== 'all' && m.group_id !== entryFilter.group) return false
        if (entryFilter.round !== 'all' && String(m.round_number) !== entryFilter.round) return false
      }
      if (entryFilter.stage === 'knockout') {
        if (entryFilter.knockoutRound !== 'all') {
          const label = this.normalizeKnockoutLabel(m.roundLabel)
          if (label !== entryFilter.knockoutRound) return false
        }
        if (entryFilter.bracket !== 'all') {
          if ((m.bracketId || '') !== entryFilter.bracket) return false
        }
      }
      return true
    })
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    const viewerKnockoutMatches = (ot.knockoutMatches || []).filter(m => entryFilter.bracket === 'all' || (m.bracketId || '') === entryFilter.bracket)
    const viewerKnockoutChampions = this.buildKnockoutChampionsList(ot).filter(item => entryFilter.bracket === 'all' || item.bracketId === entryFilter.bracket)
    this.setData({
      filteredEntryMatches: filtered,
      viewerBracketRounds: this.buildBracketRounds(viewerKnockoutMatches),
      viewerKnockoutChampions
    }, () => this.computeGroupProgress())
  },

  setEntryFilter(e) {
    const { field, value } = e.currentTarget.dataset
    this.setData({ [`entryFilter.${field}`]: value }, () => this.applyEntryFilters())
  },

  setViewerScheduleFilter(e) {
    const { mode, value } = e.currentTarget.dataset
    const next = {
      'entryFilter.stage': 'all',
      'entryFilter.group': 'all',
      'entryFilter.round': 'all',
      'entryFilter.knockoutRound': 'all',
      'entryFilter.bracket': 'all'
    }
    if (mode === 'group') {
      next['entryFilter.stage'] = 'group'
      next['entryFilter.group'] = value || 'all'
    } else if (mode === 'knockout') {
      next['entryFilter.stage'] = 'knockout'
      next['entryFilter.bracket'] = value || 'all'
    }
    this.setData(next, () => this.applyEntryFilters())
  },

  selectScheduleTab(e) {
    const value = e.currentTarget.dataset.value
    const stageMap = { all: 'all', group: 'group' }
    let stage = stageMap[value] || 'knockout'
    // Handle bracket_xxx tab values
    if (String(value).startsWith('bracket_')) stage = 'knockout'
    this.setData({
      activeScheduleTab: value,
      'entryFilter.stage': stage
    }, () => this.applyEntryFilters())
  },

  // ═══════════════════════════════════════════
  // Entry phase: select match for editing
  // ═══════════════════════════════════════════

  selectMatch(e) {
    const matchId = e.currentTarget.dataset.matchid
    if (matchId === this.data.selectedMatchId && this.data.editorExpanded) {
      this.setData({ editorExpanded: false, selectedMatchId: '' })
      return
    }
    this.setData({ selectedMatchId: matchId, editorExpanded: true })
    this.openInlineEditor(matchId)
    this.scrollToMatch(matchId)
  },

  collapseEditor() {
    this.setData({ editorExpanded: false, selectedMatchId: '', 'quickEvent.count': '' })
    // Scroll back to top of the match list
    if (this.data.filteredEntryMatches.length > 0) {
      wx.createSelectorQuery().selectViewport().scrollOffset((scroll) => {
        wx.pageScrollTo({ scrollTop: Math.max(0, scroll.scrollTop - 300), duration: 200 })
      }).exec()
    }
  },

  openInlineEditor(matchId) {
    const match = this.data.entryMatches.find(m => m.matchId === matchId)
    if (!match) return
    if (!this.data.canManage) {
      this.openMatchDetail({ currentTarget: { dataset: { match } } })
      return
    }
    const sport = this.data.entrySport
    const teams = this.getMatchTeams(match)
    const teamOptions = this.getTeamOptions()
    const homeTeamIndex = Math.max(0, teamOptions.findIndex(t => t.teamId === match.home_team_id))
    const awayTeamIndex = Math.max(0, teamOptions.findIndex(t => t.teamId === match.away_team_id))
    const parsedTime = this.splitMatchTime(match.match_time)
    const roster = this.getMatchRoster(match)
    const lineups = { home: ((match.lineups || {}).home) || [], away: ((match.lineups || {}).away) || [] }

    // Build sport-specific editor state
    let editorPatch = {}
    if (sport === 'basketball') {
      editorPatch.basketball = {
        quarters: (match.basketball && match.basketball.quarters) || [{ home: '', away: '' }, { home: '', away: '' }, { home: '', away: '' }, { home: '', away: '' }],
        playerStats: (match.basketball && match.basketball.playerStats && match.basketball.playerStats.length)
          ? match.basketball.playerStats.map(s => ({ ...s, steals: Number(s.steals) || 0, blocks: Number(s.blocks) || 0, turnovers: Number(s.turnovers) || 0 }))
          : roster.map(p => ({ teamId: p.teamId, playerOpenid: p.openid, playerName: p.name, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0 }))
      }
    } else if (sport === 'badminton') {
      editorPatch.badminton = {
        homeScore: match.badminton && match.badminton.homeScore !== null ? String(match.badminton.homeScore) : '',
        awayScore: match.badminton && match.badminton.awayScore !== null ? String(match.badminton.awayScore) : '',
        playerStats: (match.badminton && match.badminton.playerStats && match.badminton.playerStats.length)
          ? match.badminton.playerStats.map(s => ({ ...s, points: Number(s.points) || 0, winners: Number(s.winners) || 0, aces: Number(s.aces) || 0, saves: Number(s.saves) || 0, errors: Number(s.errors) || 0 }))
          : roster.map(p => ({ teamId: p.teamId, playerOpenid: p.openid, playerName: p.name, points: 0, winners: 0, aces: 0, saves: 0, errors: 0 }))
      }
    } else {
      editorPatch.football = {
        homeScore: match.football && match.football.homeScore !== null ? String(match.football.homeScore) : '',
        awayScore: match.football && match.football.awayScore !== null ? String(match.football.awayScore) : '',
        events: (match.football && match.football.events) || [],
        playerDetails: []
      }
    }

    this.setData({
      editor: {
        activeTab: 'score',
        match,
        homeTeamIndex, awayTeamIndex,
        match_date: parsedTime.date, match_clock: parsedTime.clock,
        match_time: match.match_time || '', venue: match.venue || '',
        status: match.status || 'not_started',
        lineupLimit: 0,
        // 当前赛事不记录换人，所选出场人员均按全额出场时间结算。
        lineups, substitutions: [],
        football: editorPatch.football || { homeScore: '', awayScore: '', events: [], playerDetails: [] },
        badminton: editorPatch.badminton || { homeScore: '', awayScore: '', playerStats: [] },
        basketball: editorPatch.basketball || { quarters: [], playerStats: [] }
      },
      editorTeamOptions: teamOptions,
      editorMatchTeams: teams,
      editorSelectedRoster: (teams[0] && teams[0].roster) || [],
      substitutionRoster: (teams[0] && teams[0].roster) || [],
      'substitutionDraft.teamIndex': 0, 'substitutionDraft.outIndex': 0,
      'substitutionDraft.inIndex': 0, 'substitutionDraft.minute': '',
      'quickEvent.teamIndex': 0, 'quickEvent.playerIndex': 0,
      'quickEvent.typeIndex': 0, 'quickEvent.minute': '', 'quickEvent.count': ''
    }, () => this.refreshLineupRosterFlags())
  },

  // ═══════════════════════════════════════════
  // Entry phase: completion tracking
  // ═══════════════════════════════════════════

  computeCompletedMatches() {
    const completed = {}
    let doneCount = 0
    this.data.entryMatches.forEach(m => {
      if (m.status === 'finished') { completed[m.matchId] = true; doneCount++ }
    })
    const total = this.data.entryMatches.length
    this.setData({
      completedMatchIds: completed,
      completedCount: doneCount,
      totalCount: total,
      completionRate: total > 0 ? Math.round((doneCount / total) * 100) : 0
    }, () => this.computeGroupProgress())
  },

  computeGroupProgress() {
    const groups = {}
    this.data.filteredEntryMatches.forEach(m => {
      const key = m.group_name || m.group_id || '淘汰赛'
      if (!groups[key]) groups[key] = { total: 0, done: 0 }
      groups[key].total++
      if (m.status === 'finished') groups[key].done++
    })
    const groupProgress = Object.keys(groups).sort().map(key => ({
      name: key, done: groups[key].done, total: groups[key].total,
      rate: groups[key].total > 0 ? Math.round((groups[key].done / groups[key].total) * 100) : 0
    }))
    this.setData({ groupProgress })
  },

  // ═══════════════════════════════════════════
  // Entry phase: save & next
  // ═══════════════════════════════════════════

  saveAndNext() {
    this._saveMatch(() => {
      // Find next unfinished match after current
      const currentIdx = this.data.entryMatches.findIndex(m => m.matchId === this.data.selectedMatchId)
      let next = null
      for (let i = currentIdx + 1; i < this.data.entryMatches.length; i++) {
        if (!this.data.completedMatchIds[this.data.entryMatches[i].matchId]) {
          next = this.data.entryMatches[i]
          break
        }
      }
      if (!next) {
        // Wrap around
        for (let i = 0; i < currentIdx; i++) {
          if (!this.data.completedMatchIds[this.data.entryMatches[i].matchId]) {
            next = this.data.entryMatches[i]
            break
          }
        }
      }
      if (next) {
        this.setData({ selectedMatchId: next.matchId })
        this.openInlineEditor(next.matchId)
      } else {
        wx.showToast({ title: '所有比赛已录入完毕！', icon: 'success' })
        this.setData({ selectedMatchId: '', editorExpanded: false })
      }
      this.computeCompletedMatches()
    })
  },

  saveMatchOnly() {
    this._saveMatch(() => {
      this.computeCompletedMatches()
      this.collapseEditor()
    })
  },

  _saveMatch(done) {
    if (this.data.savingMatch) return wx.showToast({ title: '比赛正在保存，请稍候', icon: 'none' })
    const editor = this.data.editor
    const sport = this.data.entrySport
    const teamOptions = this.data.editorTeamOptions || []
    const homeTeam = teamOptions[editor.homeTeamIndex]
    const awayTeam = teamOptions[editor.awayTeamIndex]
    if (!homeTeam || !awayTeam) return wx.showToast({ title: '请选择主客队', icon: 'none' })
    if (homeTeam.teamId === awayTeam.teamId) return wx.showToast({ title: '主客队不能相同', icon: 'none' })

    const patch = {
      home_team_id: homeTeam.teamId, home_team_name: homeTeam.teamName,
      away_team_id: awayTeam.teamId, away_team_name: awayTeam.teamName,
      match_time: editor.match_time, venue: editor.venue, status: editor.status,
      // 暂不记录换人，避免历史换人数据影响本次全额出场时间结算。
      lineups: editor.lineups, substitutions: [],
      resetOnTeamChange: true,
      affectsQualification: this.editorAffectsQualification(editor, sport,
        homeTeam.teamId !== editor.match.home_team_id || awayTeam.teamId !== editor.match.away_team_id)
    }
    if (sport === 'basketball') patch.basketball = editor.basketball
    else if (sport === 'badminton') patch.badminton = { homeScore: editor.badminton.homeScore, awayScore: editor.badminton.awayScore, playerStats: editor.badminton.playerStats }
    else patch.football = { homeScore: editor.football.homeScore, awayScore: editor.football.awayScore, events: editor.football.events, playerDetails: [] }

    const teamChanged = homeTeam.teamId !== editor.match.home_team_id || awayTeam.teamId !== editor.match.away_team_id
    const doSave = () => {
      this.setData({ savingMatch: true })
      wx.showLoading({ title: '保存中...' })
      wx.cloud.callFunction({
        name: 'updateOpenTournamentMatch',
        data: { tournamentId: this.data.tournamentId, matchId: editor.match.matchId, patch },
        success: (res) => {
          wx.hideLoading()
          this.setData({ savingMatch: false })
          if (res.result && res.result.code === 0) {
            this.showScoreSyncResult(res.result)
            // Update local match data immediately
            this.patchLocalMatch(editor.match.matchId, patch, editor.status)
            if (done) done()
            // Silent background refresh for standings/leaderboards
            this.loadSilent()
            if (res.result.needsScoreSync) this.syncSavedMatchResult(editor.match.matchId, !!res.result.syncAll)
          } else {
            wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
          }
        },
        fail: (err) => {
          wx.hideLoading()
          this.setData({ savingMatch: false })
          // 请求超时不等于未保存：服务端可能已写入，静默刷新以恢复真实状态。
          this.loadSilent()
          const message = String((err && (err.errMsg || err.message)) || '')
          const isTimeout = (err && Number(err.errCode) === -504003) || message.includes('timeout')
          wx.showToast({ title: isTimeout ? '保存超时，正在核对结果' : (message.slice(0, 28) || '保存连接失败，请重试'), icon: 'none' })
        }
      })
    }
    if (teamChanged) {
      wx.showModal({ title: '确认更换对阵', content: '更换主队或客队后，将清空这场比赛原有比分、球员数据和淘汰赛后续晋级结果。', confirmText: '确认保存', confirmColor: '#FF6B1A', success: m => { if (m.confirm) doSave() } })
    } else { doSave() }
  },

  syncSavedMatchResult(matchId, syncAll) {
    const tournamentId = this.data.tournamentId
    wx.cloud.callFunction({
      name: 'applyCompetitionScoreForMatch',
      data: { tournamentId, matchId, syncAll },
      success: (res) => {
        if (!res.result || res.result.code !== 0) {
          wx.showModal({ title: '积分同步失败', content: '赛果已保存，但积分尚未同步。\n\n原因：' + ((res.result && res.result.msg) || '未知错误'), showCancel: false, confirmText: '知道了' })
          return
        }
        this.loadSilent()
        wx.cloud.callFunction({
          name: 'syncMatchCards',
          data: { sourceType: 'open_tournament_match', sourceId: tournamentId, matchId, syncAll },
          fail: err => console.warn('比赛卡片同步失败，赛果和积分不受影响', err)
        })
      },
      fail: (err) => {
        console.error('积分同步调用失败', err)
        const message = String((err && (err.errMsg || err.message)) || '云函数调用失败')
        wx.showModal({ title: '积分同步失败', content: `赛果已保存，但积分尚未同步。\n\n原因：${message.slice(0, 120)}`, showCancel: false, confirmText: '知道了' })
      }
    })
  },

  patchLocalMatch(matchId, patch, newStatus) {
    const sport = this.data.entrySport
    const entryMatches = this.data.entryMatches.map(m => {
      if (m.matchId !== matchId) return m
      const updated = { ...m, ...patch, status: newStatus || patch.status || m.status }
      // Refresh display fields
      updated.statusLabel = this.data.statusLabels[updated.status] || '未开始'
      if (updated.status === 'finished') {
        const homeScore = sport === 'basketball' ? ((patch.basketball || m.basketball || {}).homeScore) :
          (sport === 'badminton' ? ((patch.badminton || m.badminton || {}).homeScore) : ((patch.football || m.football || {}).homeScore))
        const awayScore = sport === 'basketball' ? ((patch.basketball || m.basketball || {}).awayScore) :
          (sport === 'badminton' ? ((patch.badminton || m.badminton || {}).awayScore) : ((patch.football || m.football || {}).awayScore))
        updated.displayScore = `${homeScore} : ${awayScore}`
        const flags = this.matchScoreFlags(updated, sport)
        updated.homeWinner = flags.homeWinner
        updated.awayWinner = flags.awayWinner
      } else {
        updated.displayScore = 'VS'
        updated.homeWinner = false
        updated.awayWinner = false
      }
      return updated
    })
    // Also update allScheduleMatches
    const allScheduleMatches = this.data.allScheduleMatches.map(m => {
      if (m.matchId !== matchId) return m
      return entryMatches.find(em => em.matchId === matchId) || m
    })
    this.setData({ entryMatches, allScheduleMatches }, () => {
      this.applyEntryFilters()
      this.computeCompletedMatches()
    })
  },

  loadSilent() {
    wx.cloud.callFunction({
      name: 'getOpenTournament',
      data: { tournamentId: this.data.tournamentId },
      success: (res) => {
        if (!res.result || res.result.code !== 0) return
        const tournament = res.result.tournament
        const ot = tournament.openTournament || {}
        this.setData({
          tournament,
          approvedTeams: res.result.approvedTeams || [],
          standingsList: this.buildStandings(ot.standings || {}, ot),
          leaderboards: ot.leaderboards || null,
          allScheduleMatches: this.buildAllScheduleMatches(ot),
        })
        // Sync entryMatches with fresh data, preserving editor state
        const freshMatches = this.buildEntryMatchList(ot)
        const preservedEditor = this.data.editorExpanded ? this.data.selectedMatchId : ''
        this.setData({ entryMatches: freshMatches }, () => {
          this.applyEntryFilters()
          this.computeCompletedMatches()
        })
      }
    })
  },

  scrollToMatch(matchId) {
    setTimeout(() => {
      wx.createSelectorQuery().select(`#match-${matchId}`).boundingClientRect((rect) => {
        if (rect) {
          wx.createSelectorQuery().selectViewport().scrollOffset((scroll) => {
            wx.pageScrollTo({ scrollTop: scroll.scrollTop + rect.top - 160, duration: 250 })
          }).exec()
        }
      }).exec()
    }, 200)
  },

  undoLastFootballEvent() {
    const events = this.data.editor.football.events
    if (!events.length) return
    this.setData({ 'editor.football.events': events.slice(0, -1) })
  },

  // ═══════════════════════════════════════════
  // Editor: tab switching
  // ═══════════════════════════════════════════

  selectEditorTab(e) {
    this.setData({ 'editor.activeTab': e.currentTarget.dataset.value })
  },

  // ═══════════════════════════════════════════
  // Editor: basic info
  // ═══════════════════════════════════════════

  onEditorInput(e) {
    this.setData({ [`editor.${e.currentTarget.dataset.field}`]: e.detail.value })
  },
  onEditorDateChange(e) {
    const date = e.detail.value
    this.setData({ 'editor.match_date': date, 'editor.match_time': this.joinMatchTime(date, this.data.editor.match_clock) })
  },
  onEditorTimeChange(e) {
    const clock = e.detail.value
    this.setData({ 'editor.match_clock': clock, 'editor.match_time': this.joinMatchTime(this.data.editor.match_date, clock) })
  },
  onStatusChange(e) {
    this.setData({ 'editor.status': this.data.statusOptions[Number(e.detail.value)].value })
  },
  onEditorTeamChange(e) {
    const side = e.currentTarget.dataset.side
    const index = Number(e.detail.value)
    this.setData({ [`editor.${side === 'home' ? 'homeTeamIndex' : 'awayTeamIndex'}`]: index }, () => this.refreshEditorTeams())
  },
  swapEditorTeams() {
    this.setData({ 'editor.homeTeamIndex': this.data.editor.awayTeamIndex, 'editor.awayTeamIndex': this.data.editor.homeTeamIndex }, () => this.refreshEditorTeams())
  },
  refreshEditorTeams() {
    const options = this.data.editorTeamOptions || []
    const home = options[this.data.editor.homeTeamIndex]
    const away = options[this.data.editor.awayTeamIndex]
    const teams = [home, away].filter(Boolean)
    this.setData({
      editorMatchTeams: teams, editorSelectedRoster: (teams[0] && teams[0].roster) || [],
      substitutionRoster: (teams[0] && teams[0].roster) || [],
      'editor.lineups': { home: [], away: [] }, 'editor.substitutions': [],
      'quickEvent.teamIndex': 0, 'quickEvent.playerIndex': 0,
      'substitutionDraft.teamIndex': 0, 'substitutionDraft.outIndex': 0, 'substitutionDraft.inIndex': 0, 'substitutionDraft.minute': ''
    }, () => this.refreshLineupRosterFlags())
  },

  // ═══════════════════════════════════════════
  // Editor: football score
  // ═══════════════════════════════════════════

  onFootballScoreInput(e) {
    this.setData({ [`editor.football.${e.currentTarget.dataset.side}`]: e.detail.value })
  },

  // ═══════════════════════════════════════════
  // Editor: quick event entry (football)
  // ═══════════════════════════════════════════

  onQuickEventTeamChange(e) {
    const teamIndex = Number(e.detail.value)
    this.setData({ 'quickEvent.teamIndex': teamIndex, 'quickEvent.playerIndex': 0, editorSelectedRoster: this.getEditorTeamParticipants(teamIndex) })
  },
  onQuickEventPlayerChange(e) {
    this.setData({ 'quickEvent.playerIndex': Number(e.detail.value) })
  },
  onQuickEventMinute(e) {
    this.setData({ 'quickEvent.minute': e.detail.value })
  },
  onQuickEventCount(e) {
    this.setData({ 'quickEvent.count': e.detail.value })
  },

  quickAddEvent(e) {
    const typeIndex = Number(e.currentTarget.dataset.typeindex)
    const teams = this.data.editorMatchTeams || []
    const roster = this.data.editorSelectedRoster || []
    const player = roster[this.data.quickEvent.playerIndex]
    const type = this.data.eventTypes[typeIndex]
    if (!player || !type) return wx.showToast({ title: '请先选择球员', icon: 'none' })
    const team = teams[this.data.quickEvent.teamIndex]
    if (!team) return
    const minute = Number(this.data.quickEvent.minute) || 0
    const event = {
      type: type.value, typeLabel: type.label,
      teamId: team.teamId, teamName: team.teamName,
      playerOpenid: player.openid, playerName: player.name,
      minute,
      count: this.normalizeEventCount(this.data.quickEvent.count)
    }
    // Persist the minute for next event
    this.setData({
      'editor.football.events': [...this.data.editor.football.events, event],
      'quickEvent.count': ''
    })
  },

  quickAddEventByPlayer(e) {
    const { teamindex, playerindex, type } = e.currentTarget.dataset
    const teams = this.data.editorMatchTeams || []
    const team = teams[Number(teamindex)]
    if (!team) return
    const participants = this.getEditorTeamParticipants(Number(teamindex))
    const player = participants[Number(playerindex)]
    if (!player) return wx.showToast({ title: '请先确认出场球员', icon: 'none' })
    const typeObj = this.data.eventTypes.find(t => t.value === type)
    if (!typeObj) return
    const minute = Number(this.data.quickEvent.minute) || 0
    const event = {
      type: typeObj.value, typeLabel: typeObj.label,
      teamId: team.teamId, teamName: team.teamName,
      playerOpenid: player.openid, playerName: player.name,
      minute,
      count: this.normalizeEventCount(this.data.quickEvent.count)
    }
    this.setData({
      'editor.football.events': [...this.data.editor.football.events, event],
      'quickEvent.count': ''
    })
  },

  removeFootballEvent(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ 'editor.football.events': this.data.editor.football.events.filter((_, i) => i !== index) })
  },

  // ═══════════════════════════════════════════
  // Editor: basketball
  // ═══════════════════════════════════════════

  onQuarterInput(e) {
    const { index, side } = e.currentTarget.dataset
    this.setData({ [`editor.basketball.quarters[${index}].${side}`]: e.detail.value })
  },
  onBoxInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`editor.basketball.playerStats[${index}].${field}`]: Number(e.detail.value) || 0 })
  },

  // ═══════════════════════════════════════════
  // Editor: badminton
  // ═══════════════════════════════════════════

  onBadmintonScoreInput(e) {
    this.setData({ [`editor.badminton.${e.currentTarget.dataset.side}`]: e.detail.value })
  },
  onBadmintonBoxInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`editor.badminton.playerStats[${index}].${field}`]: Number(e.detail.value) || 0 })
  },

  // ═══════════════════════════════════════════
  // Editor: lineup
  // ═══════════════════════════════════════════

  toggleStarter(e) {
    const { side, openid } = e.currentTarget.dataset
    const editor = this.data.editor
    const teams = this.data.editorMatchTeams || []
    const team = side === 'home' ? teams[0] : teams[1]
    if (!team || !openid) return
    const roster = team.roster || []
    const player = roster.find(p => (p.openid || p.playerOpenid) === openid)
    if (!player) return
    const current = ((editor.lineups || {})[side] || []).slice()
    const idx = current.findIndex(p => p.openid === openid)
    if (idx >= 0) { current.splice(idx, 1) }
    else current.push(this.makeLineupPlayer(player, team))
    this.setData({ [`editor.lineups.${side}`]: current }, () => this.refreshLineupRosterFlags())
  },

  refreshLineupRosterFlags() {
    const homeIds = this.getStarterOpenids('home')
    const awayIds = this.getStarterOpenids('away')
    const teams = (this.data.editorMatchTeams || []).map((team, index) => ({
      ...team,
      side: index === 0 ? 'home' : 'away',
      starterCount: index === 0 ? homeIds.length : awayIds.length,
      participants: this.buildTeamParticipants(team, index === 0 ? 'home' : 'away'),
      roster: (team.roster || []).map(player => ({
        ...player,
        starterSelected: index === 0 ? homeIds.includes(player.openid || player.playerOpenid) : awayIds.includes(player.openid || player.playerOpenid)
      }))
    }))
    this.setData({ editorMatchTeams: teams }, () => this.refreshEditorParticipantViews())
  },

  refreshEditorParticipantViews() {
    const teams = this.data.editorMatchTeams || []
    const draftTeamIndex = Number(this.data.quickEvent.teamIndex) || 0
    const selectedRoster = this.getEditorTeamParticipants(draftTeamIndex)
    this.setData({ editorSelectedRoster: selectedRoster })
  },

  // ═══════════════════════════════════════════
  // Editor: substitutions
  // ═══════════════════════════════════════════

  onSubTeamChange(e) {
    const teamIndex = Number(e.detail.value)
    const team = (this.data.editorMatchTeams || [])[teamIndex]
    this.setData({ 'substitutionDraft.teamIndex': teamIndex, 'substitutionDraft.outIndex': 0, 'substitutionDraft.inIndex': 0, substitutionRoster: (team && team.roster) || [] })
  },
  onSubOutChange(e) { this.setData({ 'substitutionDraft.outIndex': Number(e.detail.value) }) },
  onSubInChange(e) { this.setData({ 'substitutionDraft.inIndex': Number(e.detail.value) }) },
  onSubMinute(e) { this.setData({ 'substitutionDraft.minute': e.detail.value }) },

  addSubstitution() {
    const draft = this.data.substitutionDraft
    const team = (this.data.editorMatchTeams || [])[draft.teamIndex]
    if (!team) return wx.showToast({ title: '请选择球队', icon: 'none' })
    const roster = this.data.substitutionRoster || team.roster || []
    const outPlayer = roster[draft.outIndex], inPlayer = roster[draft.inIndex]
    if (!outPlayer || !inPlayer) return wx.showToast({ title: '请选择换人球员', icon: 'none' })
    const outOpenid = outPlayer.openid || outPlayer.playerOpenid
    const inOpenid = inPlayer.openid || inPlayer.playerOpenid
    if (outOpenid === inOpenid) return wx.showToast({ title: '换上和换下不能相同', icon: 'none' })
    const sub = { teamId: team.teamId, teamName: team.teamName, minute: Number(draft.minute) || 0, outOpenid, outName: outPlayer.name || outPlayer.playerName || '未命名', inOpenid, inName: inPlayer.name || inPlayer.playerName || '未命名' }
    this.setData({ 'editor.substitutions': [...(this.data.editor.substitutions || []), sub], 'substitutionDraft.minute': '' }, () => this.refreshLineupRosterFlags())
  },
  removeSubstitution(e) {
    this.setData({ 'editor.substitutions': (this.data.editor.substitutions || []).filter((_, i) => i !== Number(e.currentTarget.dataset.index)) }, () => this.refreshLineupRosterFlags())
  },

  toggleAdvancedSetup() { this.setData({ showAdvancedSetup: !this.data.showAdvancedSetup }) },
  toggleDevTools() { this.setData({ showDevTools: !this.data.showDevTools }) },

  // ═══════════════════════════════════════════
  // Setup phase: schedule generation
  // ═══════════════════════════════════════════

  selectGroupCount(e) { this.setData({ groupCountDraft: Number(e.currentTarget.dataset.count) || 2 }) },
  selectAdvancePerGroup(e) { this.setData({ advancePerGroupDraft: Number(e.currentTarget.dataset.count) || 2 }) },

  generateTwoGroupKnockout() {
    if (!this.data.canManage) return
    const teams = this.getGroupingTeams()
    if (teams.length < 4) return wx.showToast({ title: '两组晋级淘汰赛至少需要 4 支已确认队伍', icon: 'none' })
    // 固定两组、每组前两名晋级：A1 vs B2、B1 vs A2，胜者进入决赛。
    this.setData({ groupCountDraft: 2, advancePerGroupDraft: 2 }, () => this.chooseGroupCreateMode(2))
  },

  generateTwoStageSplit() {
    if (!this.data.canManage) return
    const teams = this.getGroupingTeams()
    if (teams.length < 6) return wx.showToast({ title: '胜者组/败者组赛制至少需要 6 支已确认队伍', icon: 'none' })
    this.setData({ groupCountDraft: 2, advancePerGroupDraft: 2 }, () => {
      this.generateSchedule({ format: 'cup_groups', groupCount: 2, playoffMode: 'two_stage_split' })
    })
  },

  generateGroups() {
    if (!this.data.canManage) return
    const teams = this.getGroupingTeams()
    if (teams.length < 2) return wx.showToast({ title: '至少 2 支已确认队伍', icon: 'none' })
    const groupOptions = (this.data.groupCountOptions || [2, 3, 4, 6, 8]).filter(c => c <= teams.length)
    wx.showActionSheet({
      itemList: groupOptions.map(c => `${c}组`),
      success: s => {
        const gc = groupOptions[s.tapIndex] || this.data.groupCountDraft || 2
        this.setData({ groupCountDraft: gc }, () => this.chooseGroupCreateMode(gc))
      }
    })
  },

  chooseGroupCreateMode(groupCount) {
    wx.showActionSheet({
      itemList: ['自定义创建', '系统随机生成'],
      success: s => {
        if (s.tapIndex === 0) { this.openManualGroupsForSchedule(); return }
        this.generateSchedule({ format: 'cup_groups', groupCount })
      }
    })
  },

  generateLeague() { this.generateSchedule({ format: 'league', isDoubleLoop: false }) },
  generateDoubleLeague() { this.generateSchedule({ format: 'league', isDoubleLoop: true }) },

  reselectScheduleFormat() {
    if (!this.data.canManage) return
    wx.showActionSheet({
      itemList: ['小组赛', '单循环联赛', '双循环联赛'],
      success: s => {
        if (s.tapIndex === 0) { this.generateGroups(); return }
        if (s.tapIndex === 1) { this.generateLeague(); return }
        if (s.tapIndex === 2) this.generateDoubleLeague()
      }
    })
  },

  generateSchedule(payload) {
    const teamCount = (this.data.displayTeams || []).length
    const hasSchedule = (this.data.allScheduleMatches || []).length > 0
    const hasFinishedScores = (this.data.allScheduleMatches || []).some(match => match.status === 'finished')
    const hasKnockout = (((this.data.tournament || {}).openTournament || {}).knockoutMatches || []).length > 0
    let estimate = ''
    if (payload.format === 'league') {
      const base = teamCount * Math.max(0, teamCount - 1) / 2
      estimate = `预计生成 ${payload.isDoubleLoop ? base * 2 : base} 场比赛。`
    } else if (payload.format === 'cup_groups') {
      const groups = Number(payload.groupCount) || 1
      estimate = `将分为 ${groups} 组；各组队伍数量不均时会自动安排轮空。`
    }
    let risk = '确认后将使用当前已通过审核的队伍生成赛程。'
    let title = '赛程生成预览'
    let confirmText = '生成'
    if (hasSchedule) {
      title = hasFinishedScores || hasKnockout ? '危险：重新生成赛程' : '覆盖已有赛程'
      confirmText = hasFinishedScores || hasKnockout ? '确认重排' : '覆盖重排'
      risk = hasFinishedScores || hasKnockout
        ? '当前赛事已有赛果或淘汰赛。确认后会覆盖当前赛程，清空已录入赛果、积分榜、数据榜和淘汰赛，请只在选错赛制时使用。'
        : '当前已有赛程。确认后会覆盖并重新排列，原赛程时间/场地安排会被清空。'
    }
    wx.showModal({
      title, content: `参赛队伍：${teamCount} 支\n${estimate}\n${risk}`,
      confirmText, confirmColor: '#FF6B1A',
      success: m => { if (m.confirm) this.runGenerateSchedule(payload) }
    })
  },

  runGenerateSchedule(payload) {
    wx.showLoading({ title: '生成中...' })
    wx.cloud.callFunction({
      name: 'generateOpenTournamentSchedule',
      data: { tournamentId: this.data.tournamentId, overwrite: true, ...payload },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '已生成', icon: 'success' })
          this.load()
        } else { wx.showToast({ title: (res.result && res.result.msg) || '生成失败', icon: 'none' }) }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) }
    })
  },

  generateKnockout() {
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    const unfinishedGroups = (ot.matches || []).filter(match => match.status !== 'finished').length
    if (unfinishedGroups > 0) {
      wx.showToast({ title: `还有 ${unfinishedGroups} 场小组赛未确认，暂不能生成淘汰赛`, icon: 'none' })
      return
    }
    const isTwoStage = ot.playoffMode === 'two_stage_split'
    const isSplit = ot.playoffMode === 'split_knockout' || ((ot.knockout || {}).mode === 'split')
    wx.showModal({
      title: isTwoStage ? '生成两个组别决赛' : (isSplit ? '生成双淘汰赛' : '生成淘汰赛'),
      content: isTwoStage ? '将分别按胜者组和败者组积分榜取前 2 名，生成两个独立决赛。' : (isSplit ? '将按当前积分榜把每组前两名生成淘汰赛一，后两名生成淘汰赛二。' : `将按当前积分榜取每组前 ${this.data.advancePerGroupDraft} 名生成淘汰赛。`),
      confirmText: '生成', confirmColor: '#FF6B1A',
      success: m => {
        if (!m.confirm) return
        wx.showLoading({ title: '生成中...' })
        wx.cloud.callFunction({
          name: 'generateOpenTournamentKnockout', data: { tournamentId: this.data.tournamentId, advancePerGroup: this.data.advancePerGroupDraft, overwrite: true },
          success: r => { wx.hideLoading(); if (r.result && r.result.code === 0) { wx.showToast({ title: '已生成', icon: 'success' }); this.load() } else wx.showToast({ title: (r.result && r.result.msg) || '生成失败', icon: 'none' }) },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) }
        })
      }
    })
  },

  generateSecondStage() {
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    const unfinished = (ot.matches || []).filter(match => match.phase !== 'second_stage' && match.status !== 'finished').length
    if (unfinished) return wx.showToast({ title: `还有 ${unfinished} 场首阶段小组赛未确认`, icon: 'none' })
    wx.showModal({
      title: '生成胜者组 / 败者组',
      content: '每个首阶段小组前 2 名进入胜者组，其余队伍进入败者组。将生成两个新的小组循环赛程。',
      confirmText: '生成', confirmColor: '#FF6B1A',
      success: m => {
        if (!m.confirm) return
        wx.showLoading({ title: '生成中...' })
        wx.cloud.callFunction({
          name: 'generateOpenTournamentSecondStage', data: { tournamentId: this.data.tournamentId, overwrite: true },
          success: r => { wx.hideLoading(); if (r.result && r.result.code === 0) { wx.showToast({ title: '已生成', icon: 'success' }); this.load() } else wx.showToast({ title: (r.result && r.result.msg) || '生成失败', icon: 'none' }) },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) }
        })
      }
    })
  },

  generateSplitKnockout() {
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    const unfinishedGroups = (ot.matches || []).filter(match => match.status !== 'finished').length
    if (unfinishedGroups > 0) {
      wx.showToast({ title: `还有 ${unfinishedGroups} 场小组赛未确认，暂不能生成淘汰赛`, icon: 'none' })
      return
    }
    wx.showModal({
      title: '生成双淘汰赛', content: '将按当前积分榜把每组前两名生成淘汰赛一，后两名生成淘汰赛二。', confirmText: '生成', confirmColor: '#FF6B1A',
      success: m => {
        if (!m.confirm) return
        wx.showLoading({ title: '生成中...' })
        wx.cloud.callFunction({
          name: 'generateOpenTournamentKnockout', data: { tournamentId: this.data.tournamentId, mode: 'split_knockout', overwrite: true },
          success: r => { wx.hideLoading(); if (r.result && r.result.code === 0) { wx.showToast({ title: '已生成', icon: 'success' }); this.load() } else wx.showToast({ title: (r.result && r.result.msg) || '生成失败', icon: 'none' }) },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) }
        })
      }
    })
  },

  seedVirtualTeams() {
    if (!this.data.canManage) return
    wx.showModal({
      title: '添加机器人队伍', content: '将按赛事名额自动补充已确认的机器人队伍，仅建议在测试阶段使用。', confirmText: '添加', confirmColor: '#FF6B1A',
      success: m => {
        if (!m.confirm) return
        wx.showLoading({ title: '添加中...' })
        wx.cloud.callFunction({ name: 'seedEventRegistrations', data: { postId: this.data.tournamentId }, success: r => { wx.hideLoading(); if (r.result && r.result.code === 0) { wx.showToast({ title: r.result.msg || '已添加', icon: 'success' }); this.load() } else wx.showToast({ title: (r.result && r.result.msg) || '添加失败', icon: 'none' }) }, fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) } })
      }
    })
  },

  // ═══════════════════════════════════════════
  // Manual grouping (setup)
  // ═══════════════════════════════════════════

  openManualGroups() {
    if (!this.data.canManage) return
    const teams = this.getGroupingTeams()
    if (teams.length < 2) return wx.showToast({ title: '至少 2 支已确认队伍', icon: 'none' })
    const draft = this.buildGroupAssignments(this.data.groupCountDraft, 'existing')
    this.setData({ groupModal: { show: true, title: '调整分组', groupCount: draft.groupCount, groupLabels: draft.groupLabels, assignments: draft.assignments, groupColumns: this.buildGroupColumns(draft.assignments, draft.groupLabels), afterSaveGenerate: false, moveIndex: -1, moveTeamName: '' } })
  },

  openManualGroupsForSchedule() {
    if (!this.data.canManage) return
    const teams = this.getGroupingTeams()
    if (teams.length < 2) return wx.showToast({ title: '至少 2 支已确认队伍', icon: 'none' })
    const draft = this.buildGroupAssignments(this.data.groupCountDraft, 'existing')
    this.setData({ groupModal: { show: true, title: '手动分组并生成赛程', groupCount: draft.groupCount, groupLabels: draft.groupLabels, assignments: draft.assignments, groupColumns: this.buildGroupColumns(draft.assignments, draft.groupLabels), afterSaveGenerate: true, moveIndex: -1, moveTeamName: '' } })
  },

  closeGroupModal() { this.setData({ 'groupModal.show': false }) },

  moveTeamGroup(e) {
    const assignmentIndex = Number(e.currentTarget.dataset.index)
    const teamId = e.currentTarget.dataset.teamid
    const assignmentsSource = this.data.groupModal.assignments || []
    const finalIndex = Number.isInteger(assignmentIndex) && assignmentIndex >= 0 ? assignmentIndex : assignmentsSource.findIndex(item => item.teamId === teamId)
    const team = assignmentsSource[finalIndex]
    if (!team) return
    this.setData({ 'groupModal.moveIndex': finalIndex, 'groupModal.moveTeamName': team.teamName })
  },

  selectMoveTarget(e) {
    const groupIndex = Number(e.currentTarget.dataset.groupindex)
    const moveIndex = Number(this.data.groupModal.moveIndex)
    const assignmentsSource = this.data.groupModal.assignments || []
    if (!Number.isInteger(groupIndex) || !Number.isInteger(moveIndex) || moveIndex < 0) return
    const assignments = assignmentsSource.map((item, index) => index === moveIndex ? { ...item, groupIndex } : item)
    this.setData({ 'groupModal.assignments': assignments, 'groupModal.groupColumns': this.buildGroupColumns(assignments, this.data.groupModal.groupLabels), 'groupModal.moveIndex': -1, 'groupModal.moveTeamName': '' })
  },

  saveManualGroups() {
    const shouldGenerate = !!this.data.groupModal.afterSaveGenerate
    this.saveGroupAssignments(this.data.groupModal.assignments, this.data.groupModal.groupLabels, () => {
      this.closeGroupModal()
      if (shouldGenerate) this.runGenerateSchedule({ format: 'cup_groups', groupCount: Number(this.data.groupModal.groupCount) || Number(this.data.groupCountDraft) || 2 })
    }, { reload: !shouldGenerate })
  },

  saveGroupAssignments(assignments, groupLabels, done, options = {}) {
    const groups = this.buildGroupsFromAssignments(assignments, groupLabels)
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'saveOpenTournamentGroups', data: { tournamentId: this.data.tournamentId, groups },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) { wx.showToast({ title: '分组已保存', icon: 'success' }); if (done) done(); if (options.reload !== false) this.load() }
        else wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) }
    })
  },

  // ═══════════════════════════════════════════
  // Batch schedule tools (entry toolbar)
  // ═══════════════════════════════════════════

  openScheduleTool(e) {
    if (!this.data.canManage) return
    const mode = e.currentTarget.dataset.mode
    const matches = this.getAllMatchOptions()
    if (!matches.length && mode !== 'reset') return wx.showToast({ title: '请先生成赛程', icon: 'none' })
    this.setData({ scheduleTool: { show: true, mode, targetStage: 'all', targetGroup: 'all', targetRound: 'all', targetKnockoutRound: 'all', match_date: '', match_clock: '', match_time: '', venue: '', status: '', firstIndex: 0, secondIndex: matches.length > 1 ? 1 : 0 } })
  },
  closeScheduleTool() { this.setData({ 'scheduleTool.show': false }) },
  onScheduleToolInput(e) { this.setData({ [`scheduleTool.${e.currentTarget.dataset.field}`]: e.detail.value }) },
  onScheduleToolDateChange(e) { const d = e.detail.value; this.setData({ 'scheduleTool.match_date': d, 'scheduleTool.match_time': this.joinMatchTime(d, this.data.scheduleTool.match_clock) }) },
  onScheduleToolTimeChange(e) { const c = e.detail.value; this.setData({ 'scheduleTool.match_clock': c, 'scheduleTool.match_time': this.joinMatchTime(this.data.scheduleTool.match_date, c) }) },
  onScheduleToolStage(e) { this.setData({ 'scheduleTool.targetStage': (this.data.scheduleStageOptions[Number(e.detail.value)] || {}).value || 'all' }) },
  onScheduleToolGroup(e) { this.setData({ 'scheduleTool.targetGroup': (this.data.groupOptions[Number(e.detail.value)] || {}).value || 'all' }) },
  onScheduleToolRound(e) { this.setData({ 'scheduleTool.targetRound': (this.data.roundOptions[Number(e.detail.value)] || {}).value || 'all' }) },
  onScheduleToolKnockoutRound(e) { this.setData({ 'scheduleTool.targetKnockoutRound': (this.data.knockoutRoundOptions[Number(e.detail.value)] || {}).value || 'all' }) },
  onScheduleToolStatus(e) { this.setData({ 'scheduleTool.status': (this.data.scheduleStatusOptions[Number(e.detail.value)] || {}).value || '' }) },
  onScheduleToolMatch(e) { this.setData({ [`scheduleTool.${e.currentTarget.dataset.field}`]: Number(e.detail.value) }) },

  buildScheduleToolTarget() {
    const t = this.data.scheduleTool
    if (t.targetStage === 'group') return { stage: 'group', groupId: t.targetGroup, roundNumber: t.targetRound }
    if (t.targetStage === 'knockout') return { stage: 'knockout', roundLabel: t.targetKnockoutRound }
    return { stage: 'all' }
  },

  saveBatchSchedule() {
    const t = this.data.scheduleTool
    const patch = {}
    if (t.match_time !== '') patch.match_time = t.match_time
    if (t.venue !== '') patch.venue = t.venue
    if (t.status) patch.status = t.status
    if (!Object.keys(patch).length) return wx.showToast({ title: '请填写要批量修改的内容', icon: 'none' })
    this.callScheduleAction({ action: 'batchUpdateSchedule', target: this.buildScheduleToolTarget(), patch }, '批量调整已保存')
  },

  saveSwapSlots() {
    const matches = this.getAllMatchOptions()
    const first = matches[this.data.scheduleTool.firstIndex], second = matches[this.data.scheduleTool.secondIndex]
    if (!first || !second || first.matchId === second.matchId) return wx.showToast({ title: '请选择两场不同比赛', icon: 'none' })
    this.callScheduleAction({ action: 'swapMatchSlots', firstMatchId: first.matchId, secondMatchId: second.matchId }, '已交换时间和场地')
  },

  resetScoresByTool() {
    wx.showModal({ title: '清空赛果', content: '将清空所选范围内的比分、球员数据和淘汰赛胜者。', confirmText: '清空', confirmColor: '#FF6B1A', success: m => { if (m.confirm) this.callScheduleAction({ action: 'resetScores', target: this.buildScheduleToolTarget() }, '赛果已清空') } })
  },

  callScheduleAction(payload, successTitle) {
    wx.showLoading({ title: '处理中...' })
    wx.cloud.callFunction({
      name: 'updateOpenTournamentMatch', data: { tournamentId: this.data.tournamentId, ...payload },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) { this.showScoreSyncResult(res.result, successTitle); this.closeScheduleTool(); this.load() }
        else wx.showToast({ title: (res.result && res.result.msg) || '操作失败', icon: 'none' })
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) }
    })
  },

  // ═══════════════════════════════════════════
  // Results phase: navigation
  // ═══════════════════════════════════════════

  selectResultsTab(e) { this.setData({ activeResultsTab: e.currentTarget.dataset.value }) },
  selectStatTab(e) { this.setData({ activeStatTab: e.currentTarget.dataset.value }) },
  selectViewerTab(e) { this.setData({ viewerTab: e.currentTarget.dataset.value }) },

  // ═══════════════════════════════════════════
  // Honors (results phase)
  // ═══════════════════════════════════════════

  getHonorLabels() {
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    const eventFormat = (this.data.tournament && this.data.tournament.eventFormat) || ''
    const isLeague = ot.format === 'league' || eventFormat.indexOf('联赛') >= 0
    return isLeague
      ? [{ rank: '1', label: '第一名' }, { rank: '2', label: '第二名' }, { rank: '3', label: '第三名' }, { rank: '4', label: '第四名' }]
      : [{ rank: 'champion', label: '冠军' }, { rank: 'runner_up', label: '亚军' }, { rank: 'third_place', label: '季军' }, { rank: 'semi_final', label: '四强' }]
  },

  openHonorEditor() {
    if (!this.data.canManage) return
    const teams = this.getGroupingTeams()
    if (!teams.length) return wx.showToast({ title: '暂无可选队伍', icon: 'none' })
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    const saved = ot.honorAwards || []
    const teamOptions = [{ teamId: '', teamName: '请选择队伍' }].concat(teams)
    const labels = this.getHonorLabels()
    const awards = labels.map(item => {
      const old = saved.find(a => a.rank === item.rank || a.label === item.label) || {}
      return { ...item, teamId: old.teamId || '', teamName: old.teamName || '', teamIndex: Math.max(0, teamOptions.findIndex(t => t.teamId === old.teamId)) }
    })
    this.setData({ honorEditor: { show: true, modeLabel: labels[0] && labels[0].rank === '1' ? '联赛前四' : '淘汰赛名次', awards, teamOptions } })
  },
  closeHonorEditor() { this.setData({ 'honorEditor.show': false }) },
  onHonorTeamChange(e) {
    const idx = Number(e.currentTarget.dataset.index), ti = Number(e.detail.value)
    const t = (this.data.honorEditor.teamOptions || [])[ti] || {}
    this.setData({ [`honorEditor.awards[${idx}].teamIndex`]: ti, [`honorEditor.awards[${idx}].teamId`]: t.teamId || '', [`honorEditor.awards[${idx}].teamName`]: t.teamName || '' })
  },
  saveHonorAwards() {
    if (!this.data.canManage) return
    const awards = (this.data.honorEditor.awards || []).filter(i => i.teamId).map(i => ({ rank: i.rank, label: i.label, teamId: i.teamId, teamName: i.teamName }))
    if (!awards.length) return wx.showToast({ title: '至少选择一个名次', icon: 'none' })
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'saveTournamentHonors', data: { tournamentId: this.data.tournamentId, awards },
      success: r => { wx.hideLoading(); if (r.result && r.result.code === 0) { wx.showToast({ title: '荣誉已同步', icon: 'success' }); this.closeHonorEditor(); this.load() } else wx.showToast({ title: (r.result && r.result.msg) || '保存失败', icon: 'none' }) },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) }
    })
  },

  // ═══════════════════════════════════════════
  // Simulate (dev only)
  // ═══════════════════════════════════════════

  simulateResults() {
    if (!this.data.canManage) return
    wx.showModal({ title: '模拟赛果', content: '将自动为所有比赛生成比分、积分榜和数据榜。', confirmText: '模拟', confirmColor: '#FF6B1A', success: m => { if (!m.confirm) return; wx.showLoading({ title: '模拟中...' }); wx.cloud.callFunction({ name: 'simulateOpenTournamentResults', data: { tournamentId: this.data.tournamentId, advancePerGroup: this.data.advancePerGroupDraft, includeKnockout: true }, success: r => { wx.hideLoading(); if (r.result && r.result.code === 0) { wx.showToast({ title: '已模拟', icon: 'success' }); this.load() } else wx.showToast({ title: (r.result && r.result.msg) || '模拟失败', icon: 'none' }) }, fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) } }) } })
  },

  simulateSplitResults() {
    if (!this.data.canManage) return
    wx.showModal({ title: '模拟双淘汰赛', content: '将自动模拟小组赛，并按前两名/后两名分别生成两个淘汰赛。', confirmText: '模拟', confirmColor: '#FF6B1A', success: m => { if (!m.confirm) return; wx.showLoading({ title: '模拟中...' }); wx.cloud.callFunction({ name: 'simulateOpenTournamentResults', data: { tournamentId: this.data.tournamentId, includeKnockout: true, mode: 'split_knockout' }, success: r => { wx.hideLoading(); if (r.result && r.result.code === 0) { wx.showToast({ title: '已模拟', icon: 'success' }); this.load() } else wx.showToast({ title: (r.result && r.result.msg) || '模拟失败', icon: 'none' }) }, fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) } }) } })
  },

  renameKnockoutBracket(e) {
    if (!this.data.canManage) return
    const bracketId = e.currentTarget.dataset.bracketid
    const bracket = (this.data.knockoutBrackets || []).find(b => b.bracketId === bracketId)
    if (!bracket) return
    wx.showModal({ title: '修改淘汰赛名称', editable: true, placeholderText: bracket.name || '淘汰赛名称', content: bracket.name || '', confirmText: '保存', confirmColor: '#FF6B1A', success: m => { if (!m.confirm) return; const name = String(m.content || '').trim(); if (!name) return wx.showToast({ title: '请输入名称', icon: 'none' }); wx.showLoading({ title: '保存中...' }); wx.cloud.callFunction({ name: 'updateOpenTournamentMatch', data: { tournamentId: this.data.tournamentId, action: 'renameKnockoutBracket', bracketId, name }, success: r => { wx.hideLoading(); if (r.result && r.result.code === 0) { wx.showToast({ title: '已保存', icon: 'success' }); this.load() } else wx.showToast({ title: (r.result && r.result.msg) || '保存失败', icon: 'none' }) }, fail: () => { wx.hideLoading(); wx.showToast({ title: '云函数调用失败', icon: 'none' }) } }) } })
  },

  // ═══════════════════════════════════════════
  // Viewers (match detail, team detail)
  // ═══════════════════════════════════════════

  openMatchDetail(e) {
    const match = e.currentTarget.dataset.match
    if (!match || !match.matchId) return
    const score = this.data.entrySport === 'basketball'
      ? `${(match.basketball || {}).homeScore} : ${(match.basketball || {}).awayScore}`
      : this.data.entrySport === 'badminton'
        ? `${(match.badminton || {}).homeScore} : ${(match.badminton || {}).awayScore}`
        : `${(match.football || {}).homeScore} : ${(match.football || {}).awayScore}`
    this.setData({ matchViewer: { show: true, match: this.normalizeMatchDetail({ ...match, statusLabel: this.data.statusLabels[match.status] || '未开始', displayScore: match.status === 'finished' ? score : 'VS' }), teams: this.getMatchTeams(match) } })
  },
  closeMatchDetail() { this.setData({ 'matchViewer.show': false, 'matchViewer.match': null, 'matchViewer.teams': [] }) },

  openTeamDetail(e) {
    const teamId = e.currentTarget.dataset.teamid
    const team = (this.data.displayTeams || []).find(t => t.teamId === teamId)
    if (!team) return
    this.setData({ teamViewer: { show: true, team, players: this.buildTeamPlayerStats(team) } })
  },
  closeTeamDetail() { this.setData({ 'teamViewer.show': false, 'teamViewer.team': null, 'teamViewer.players': [] }) },

  goAthleteProfile(e) {
    const openid = e.currentTarget.dataset.openid
    if (openid && !String(openid).startsWith('virtual_')) wx.navigateTo({ url: `/pages/athlete-profile/athlete-profile?openid=${openid}` })
    else wx.showToast({ title: '测试球员暂无主页', icon: 'none' })
  },

  // ═══════════════════════════════════════════
  // Utilities (unchanged from original)
  // ═══════════════════════════════════════════

  showScoreSyncResult(result, successTitle = '已保存') {
    const ss = result && result.scoreSync
    if (ss && ss.ok === false) { wx.showModal({ title: '积分同步失败', content: `${result.msg || successTitle}，但积分同步失败。\n\n原因：${ss.msg || '未知错误'}`, showCancel: false, confirmText: '知道了', confirmColor: '#FF6B1A' }); return }
    wx.showToast({ title: (result && result.msg) || successTitle, icon: 'success' })
  },

  splitMatchTime(value) {
    const text = String(value || '').trim()
    const matched = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/)
    return { date: matched ? matched[1] : '', clock: matched ? matched[2] : '' }
  },
  joinMatchTime(date, clock) { if (date && clock) return `${date} ${clock}`; if (date) return date; if (clock) return clock; return '' },

  normalizeEventCount(value) { const count = Math.floor(Number(value) || 1); return count > 0 ? count : 1 },
  normalizeScoreValue(value) { if (value === '' || value === null || value === undefined) return null; const n = Number(value); return Number.isFinite(n) ? n : null },

  normalizeMatchDetail(match) {
    return { ...match, lineups: { home: ((match.lineups || {}).home) || [], away: ((match.lineups || {}).away) || [] }, substitutions: match.substitutions || [] }
  },

  matchScoreFlags(match, sport) {
    if (match.status !== 'finished') return { homeWinner: false, awayWinner: false }
    const home = sport === 'basketball' ? Number((match.basketball || {}).homeScore) : (sport === 'badminton' ? Number((match.badminton || {}).homeScore) : Number((match.football || {}).homeScore))
    const away = sport === 'basketball' ? Number((match.basketball || {}).awayScore) : (sport === 'badminton' ? Number((match.badminton || {}).awayScore) : Number((match.football || {}).awayScore))
    return { homeWinner: Number.isFinite(home) && Number.isFinite(away) && home > away, awayWinner: Number.isFinite(home) && Number.isFinite(away) && away > home }
  },

  matchTimeValue(match) {
    const text = String(match.match_time || '').trim(); if (!text) return Infinity
    const normalized = text.replace(/\./g, '-').replace(/\//g, '-')
    const matched = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/)
    if (!matched) return Infinity
    const value = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), Number(matched[4] || 0), Number(matched[5] || 0)).getTime()
    return Number.isFinite(value) ? value : Infinity
  },

  matchFallbackOrder(match) {
    const stageOrder = match.scheduleStage === 'knockout' || match.stage === 'knockout' ? 2 : 1
    return [stageOrder, Number(match.round_number || 0), String(match.group_id || match.group_name || ''), this.knockoutRoundOrder(match.roundLabel || match.groupRoundLabel), Number(match.roundIndex || 0), Number(match.order || 0), String(match.matchId || '')]
  },

  sortMatchesByTime(matches) {
    return (matches || []).slice().sort((a, b) => { const ta = this.matchTimeValue(a), tb = this.matchTimeValue(b); if (ta !== tb) return ta - tb; const fa = this.matchFallbackOrder(a), fb = this.matchFallbackOrder(b); for (let i = 0; i < fa.length; i++) { if (fa[i] < fb[i]) return -1; if (fa[i] > fb[i]) return 1 } return 0 })
  },

  getAllMatchOptions() {
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    const groupMatches = (ot.matches || []).map(m => ({ ...m, optionLabel: `${m.group_name ? m.group_name + '组 ' : ''}第${m.round_number || '-'}轮 ${m.home_team_name} VS ${m.away_team_name}` }))
    const knockoutMatches = (ot.knockoutMatches || []).map(m => ({ ...m, optionLabel: `${this.bracketNameFor(m, this.buildKnockoutBrackets(ot))} ${this.normalizeKnockoutLabel(m.roundLabel)} ${m.home_team_name} VS ${m.away_team_name}` }))
    return groupMatches.concat(knockoutMatches)
  },

  getTeamOptions() {
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    return ((ot.teams && ot.teams.length ? ot.teams : this.data.approvedTeams) || []).map(t => ({ teamId: t.teamId || t.registrationId, teamName: t.teamName || t.name || '未命名队伍', roster: t.roster || t.members || [] })).filter(t => t.teamId)
  },

  getMatchTeams(match) {
    const teams = ((this.data.tournament.openTournament || {}).teams || [])
    return [
      teams.find(t => t.teamId === match.home_team_id) || { teamId: match.home_team_id, teamName: match.home_team_name, roster: [] },
      teams.find(t => t.teamId === match.away_team_id) || { teamId: match.away_team_id, teamName: match.away_team_name, roster: [] }
    ]
  },

  getMatchRoster(match) { return this.getMatchTeams(match).reduce((list, team) => list.concat((team.roster || []).map(p => ({ ...p, teamId: team.teamId, teamName: team.teamName }))), []) },
  getLineupLimit() { const t = this.data.tournament || {}; const rules = ((t.openTournament || {}).matchRules) || {}; return Number(rules.teamSize || t.teamSize || 5) || 5 },

  makeLineupPlayer(player, team) { return { openid: player.openid || player.playerOpenid || '', name: player.name || player.playerName || '未命名球员', teamId: team.teamId, teamName: team.teamName } },
  makeParticipantPlayer(player, team, side) { return { ...player, openid: player.openid || player.playerOpenid || '', name: player.name || player.playerName || '未命名球员', teamId: team.teamId, teamName: team.teamName, side } },
  getStarterOpenids(side) { return ((this.data.editor.lineups || {})[side] || []).map(p => p.openid) },

  buildTeamParticipants(team, side) {
    if (!team) return []
    const roster = team.roster || []
    const byOpenid = {}; roster.forEach(p => { const o = p.openid || p.playerOpenid || ''; if (o) byOpenid[o] = p })
    const participants = []
    const add = (player = {}) => { const o = player.openid || player.playerOpenid || ''; if (!o || participants.some(i => i.openid === o)) return; participants.push(this.makeParticipantPlayer({ ...(byOpenid[o] || {}), ...player }, team, side)) }
    ;(((this.data.editor.lineups || {})[side]) || []).forEach(add)
    ;(this.data.editor.substitutions || []).filter(s => s.teamId === team.teamId).forEach(s => { add({ openid: s.inOpenid, name: s.inName }); if (!participants.some(i => i.openid === s.outOpenid)) add({ openid: s.outOpenid, name: s.outName }) })
    return participants
  },

  getEditorTeamParticipants(teamIndex) {
    const team = (this.data.editorMatchTeams || [])[teamIndex]
    if (!team) return []
    return this.buildTeamParticipants(team, teamIndex === 0 ? 'home' : 'away')
  },

  editorAffectsQualification(editor, sport, teamChanged) {
    if (teamChanged) return true
    if ((editor.status || 'not_started') !== (editor.match.status || 'not_started')) return true
    if (sport === 'basketball') { const a = editor.match.basketball || {}, b = editor.basketball || {}; return JSON.stringify(a.quarters || []) !== JSON.stringify(b.quarters || []) || JSON.stringify(a.playerStats || []) !== JSON.stringify(b.playerStats || []) }
    if (sport === 'badminton') { const a = editor.match.badminton || {}, b = editor.badminton || {}; return this.normalizeScoreValue(a.homeScore) !== this.normalizeScoreValue(b.homeScore) || this.normalizeScoreValue(a.awayScore) !== this.normalizeScoreValue(b.awayScore) || JSON.stringify(a.playerStats || []) !== JSON.stringify(b.playerStats || []) }
    const a = editor.match.football || {}
    return this.normalizeScoreValue(a.homeScore) !== this.normalizeScoreValue(editor.football.homeScore) || this.normalizeScoreValue(a.awayScore) !== this.normalizeScoreValue(editor.football.awayScore) || JSON.stringify(a.events || []) !== JSON.stringify(editor.football.events || [])
  },

  buildStandings(standings, openTournament = {}) {
    const groupNameMap = {}
    ;(openTournament.groups || []).forEach(group => {
      if (group.groupId) groupNameMap[group.groupId] = group.groupName || group.groupId
    })
    ;(openTournament.stage2Groups || []).forEach(group => {
      if (group.groupId) groupNameMap[group.groupId] = group.groupName || group.groupId
    })
    return Object.keys(standings)
      .filter(key => !(openTournament.format === 'cup_groups' && key === 'league'))
      .sort()
      .map(key => {
        const groupName = groupNameMap[key] || key
        return { key, title: key === 'league' ? '联赛积分榜' : `${groupName}组积分榜`, rows: standings[key] || [] }
      })
  },

  buildKnockoutBrackets(ot = {}) {
    const knockout = ot.knockout || {}
    const eventFormat = (this.data.tournament && this.data.tournament.eventFormat) || ''
    if (ot.playoffMode === 'two_stage_split' || knockout.mode === 'two_stage_split') {
      const saved = knockout.brackets || []
      return [{ bracketId: 'winner', name: (saved.find(b => b.bracketId === 'winner') || {}).name || '胜者组淘汰赛' }, { bracketId: 'loser', name: (saved.find(b => b.bracketId === 'loser') || {}).name || '败者组淘汰赛' }]
    }
    if (eventFormat === '双淘汰赛' || ot.playoffMode === 'split_knockout' || knockout.mode === 'split') {
      const saved = knockout.brackets || []
      return [{ bracketId: 'upper', name: (saved.find(b => b.bracketId === 'upper') || {}).name || '淘汰赛一' }, { bracketId: 'lower', name: (saved.find(b => b.bracketId === 'lower') || {}).name || '淘汰赛二' }]
    }
    return [{ bracketId: '', name: '淘汰赛' }]
  },

  bracketNameFor(match, brackets) {
    if (match.bracketName) return match.bracketName
    const bracket = (brackets || []).find(b => b.bracketId === (match.bracketId || ''))
    return bracket ? bracket.name : '淘汰赛'
  },

  normalizeKnockoutLabel(label) {
    if (label === '1/16决赛') return '16分之一'
    if (label === '1/8决赛') return '8分之一'
    if (label === '1/4决赛') return '4分之一'
    return label || '淘汰赛'
  },

  knockoutRoundOrder(label) {
    const normalized = this.normalizeKnockoutLabel(label)
    const order = { '16分之一': 1, '8分之一': 2, '4分之一': 3, '半决赛': 4, '决赛': 5 }
    return order[normalized] || 99
  },

  buildKnockoutRoundOptions(matches) {
    const fixedLabels = ['16分之一', '8分之一', '4分之一', '半决赛', '决赛']
    const labels = [...new Set(fixedLabels.concat((matches || []).map(m => this.normalizeKnockoutLabel(m.roundLabel)).filter(Boolean)))].sort((a, b) => this.knockoutRoundOrder(a) - this.knockoutRoundOrder(b))
    return [{ label: '所有轮次', value: 'all' }].concat(labels.map(l => ({ label: l, value: l })))
  },

  buildAllScheduleMatches(ot) {
    const sport = this.data.entrySport
    const groupMatches = (ot.matches || []).map(m => this.enrichMatch(m, 'group', sport))
    const knockoutMatches = (ot.knockoutMatches || []).map(m => this.enrichMatch(m, 'knockout', sport))
    return this.sortMatchesByTime(groupMatches.concat(knockoutMatches))
  },

  buildKnockoutChampion(ot) {
    const knockout = ot.knockout || {}
    return knockout.championTeamId ? { teamId: knockout.championTeamId, teamName: knockout.championTeamName || '冠军' } : null
  },

  buildKnockoutChampionsList(ot) {
    const knockout = ot.knockout || {}
    const champ = this.buildKnockoutChampion(ot)
    if (Array.isArray(knockout.brackets)) return knockout.brackets.filter(b => b.championTeamId).map(b => ({ bracketId: b.bracketId, title: `${b.name || '淘汰赛'}冠军`, teamId: b.championTeamId, teamName: b.championTeamName || '冠军' }))
    return champ ? [{ bracketId: 'main', title: '冠军', ...champ }] : []
  },

  buildBracketRounds(matches) {
    const grouped = {}
    ;(matches || []).forEach(m => { const l = this.normalizeKnockoutLabel(m.roundLabel || m.groupRoundLabel); if (!grouped[l]) grouped[l] = []; grouped[l].push(m) })
    return Object.keys(grouped).sort((a, b) => this.knockoutRoundOrder(a) - this.knockoutRoundOrder(b)).map((label, index) => ({
      label, roundClass: `round-${index}`,
      matches: grouped[label].sort((a, b) => (a.roundIndex || 0) - (b.roundIndex || 0) || (a.order || 0) - (b.order || 0))
        .map((match, mi) => ({ ...match, nodeClass: mi % 2 === 0 ? 'upper' : 'lower', hasPrev: index > 0, hasNext: index + 1 < Object.keys(grouped).length }))
    }))
  },

  buildTeamPlayerStats(team) {
    const sport = this.data.entrySport
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    const matches = (ot.matches || []).concat(ot.knockoutMatches || [])
    const statsMap = {}
    ;(team.roster || []).forEach((player, index) => { const key = this.getPlayerStatKey({ ...player, teamId: team.teamId }, index); statsMap[key] = this.emptyPlayerStats(player, team.teamId, sport, index) })
    matches.forEach(match => {
      if (match.status !== 'finished') return
      if (match.home_team_id !== team.teamId && match.away_team_id !== team.teamId) return
      Object.keys(statsMap).forEach(o => { statsMap[o].played += 1 })
      if (sport === 'basketball') { ;(((match.basketball || {}).playerStats) || []).forEach(s => { const k = s.playerOpenid || s.openid; if (s.teamId !== team.teamId || !statsMap[k]) return; statsMap[k].points += Number(s.points) || 0; statsMap[k].rebounds += Number(s.rebounds) || 0; statsMap[k].assists += Number(s.assists) || 0; statsMap[k].turnovers += Number(s.turnovers) || 0 }) }
      else if (sport === 'badminton') { ;(((match.badminton || {}).playerStats) || []).forEach(s => { const k = s.playerOpenid || s.openid; if (s.teamId !== team.teamId || !statsMap[k]) return; statsMap[k].points += Number(s.points) || 0; statsMap[k].winners += Number(s.winners) || 0; statsMap[k].aces += Number(s.aces) || 0; statsMap[k].saves += Number(s.saves) || 0; statsMap[k].errors += Number(s.errors) || 0 }) }
      else { ;(((match.football || {}).events) || []).forEach(e => { const k = e.playerOpenid || e.openid; if (e.teamId !== team.teamId || !statsMap[k]) return; const c = this.normalizeEventCount(e.count); if (e.type === 'goal') statsMap[k].goals += c; if (e.type === 'assist') statsMap[k].assists += c; if (e.type === 'shot_on_target') statsMap[k].shotsOnTarget += c; if (e.type === 'successful_dribble') statsMap[k].successfulDribbles += c; if (e.type === 'through_ball') statsMap[k].throughBalls += c; if (e.type === 'key_pass') statsMap[k].keyPasses += c; if (e.type === 'successful_tackle') statsMap[k].successfulTackles += c; if (e.type === 'save') statsMap[k].saves += c; if (['shot_on_target', 'successful_dribble', 'through_ball', 'key_pass', 'successful_tackle', 'save'].includes(e.type)) statsMap[k].technical += c; if (e.type === 'yellow_card') statsMap[k].cards += c; if (e.type === 'red_card') statsMap[k].cards += c * 2 }) }
    })
    return Object.values(statsMap).sort((a, b) => {
      if (sport === 'basketball') { if (b.points !== a.points) return b.points - a.points; if (b.rebounds !== a.rebounds) return b.rebounds - a.rebounds; if (b.assists !== a.assists) return b.assists - a.assists; return a.turnovers - b.turnovers }
      if (sport === 'badminton') { if (b.points !== a.points) return b.points - a.points; if (b.winners !== a.winners) return b.winners - a.winners; if (b.aces !== a.aces) return b.aces - a.aces; return a.errors - b.errors }
      if (b.goals !== a.goals) return b.goals - a.goals; if (b.assists !== a.assists) return b.assists - a.assists; if (b.technical !== a.technical) return b.technical - a.technical; return a.cards - b.cards
    })
  },

  getPlayerStatKey(player, index) { return player.openid || player.playerOpenid || `${player.teamId || 'team'}_${index}` },

  emptyPlayerStats(player, teamId, sport, index) {
    const openid = player.openid || player.playerOpenid || ''
    const base = { statKey: this.getPlayerStatKey({ ...player, teamId }, index), openid, name: player.name || player.playerName || '未命名球员', teamId, played: 0 }
    if (sport === 'basketball') return { ...base, points: 0, rebounds: 0, assists: 0, turnovers: 0 }
    if (sport === 'badminton') return { ...base, points: 0, winners: 0, aces: 0, saves: 0, errors: 0, position: player.position || '' }
    return { ...base, goals: 0, assists: 0, shotsOnTarget: 0, successfulDribbles: 0, throughBalls: 0, keyPasses: 0, successfulTackles: 0, saves: 0, technical: 0, cards: 0 }
  },

  getGroupingTeams() {
    const ot = (this.data.tournament && this.data.tournament.openTournament) || {}
    return ((ot.teams && ot.teams.length ? ot.teams : this.data.approvedTeams) || []).map(t => ({ teamId: t.teamId || t.registrationId, teamName: t.teamName || t.name || '未命名队伍', roster: t.roster || t.members || [] })).filter(t => t.teamId)
  },

  makeGroupLabels(groupCount) { return Array.from({ length: groupCount }, (_, i) => `${String.fromCharCode(65 + i)}组`) },

  buildGroupAssignments(groupCount, mode = 'existing') {
    const teams = this.getGroupingTeams()
    const safeCount = Math.max(1, Number(groupCount) || 2)
    const labels = this.makeGroupLabels(safeCount)
    const existingGroups = ((this.data.tournament && this.data.tournament.openTournament && this.data.tournament.openTournament.groups) || [])
    const existingMap = {}; existingGroups.forEach((g, gi) => { (g.teamIds || []).forEach(tid => { existingMap[tid] = gi }) })
    return { groupCount: safeCount, groupLabels: labels, assignments: teams.map((t, i) => ({ ...t, groupIndex: mode === 'existing' && existingMap[t.teamId] !== undefined && existingMap[t.teamId] < safeCount ? existingMap[t.teamId] : i % safeCount })) }
  },

  buildGroupsFromAssignments(assignments, groupLabels) { return groupLabels.map((l, i) => ({ groupId: String.fromCharCode(65 + i), groupName: l.replace('组', ''), teamIds: assignments.filter(t => t.groupIndex === i).map(t => t.teamId) })) },

  buildGroupColumns(assignments, groupLabels) { return groupLabels.map((l, i) => ({ label: l, groupIndex: i, teams: (assignments || []).map((t, ai) => ({ ...t, assignmentIndex: ai })).filter(t => t.groupIndex === i) })) }
})
