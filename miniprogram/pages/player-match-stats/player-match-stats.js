Page({
  data: {
    openid: '',
    activeTab: 'all',
    sport: '足球',
    loading: true,
    matches: [],
    visibleMatches: [],
    summaryCards: [],
    summary: {
      participations: 0,
      goals: 0,
      assists: 0,
      wins: 0,
      shotsOnTarget: 0,
      successfulDribbles: 0,
      throughBalls: 0,
      keyPasses: 0,
      successfulTackles: 0,
      saves: 0,
      yellowCards: 0,
      redCards: 0
    },
    tabs: [
      { label: '全部', value: 'all' },
      { label: '进球', value: 'goals' },
      { label: '助攻', value: 'assists' },
      { label: '胜场', value: 'wins' },
      { label: '参赛', value: 'participations' }
    ]
  },

  buildTabs(sport) {
    if (sport === '篮球') {
      return [
        { label: '全部', value: 'all' },
        { label: '得分', value: 'points' },
        { label: '篮板', value: 'rebounds' },
        { label: '助攻', value: 'assists' },
        { label: '胜场', value: 'wins' },
        { label: '参赛', value: 'participations' }
      ]
    }
    if (sport === '羽毛球') {
      return [
        { label: '全部', value: 'all' },
        { label: '得分', value: 'points' },
        { label: '胜场', value: 'wins' },
        { label: '参赛', value: 'participations' }
      ]
    }
    return [
      { label: '全部', value: 'all' },
      { label: '进球', value: 'goals' },
      { label: '助攻', value: 'assists' },
      { label: '胜场', value: 'wins' },
      { label: '参赛', value: 'participations' }
    ]
  },

  buildSummaryCards(sport, summary = {}) {
    if (sport === '篮球') {
      return [
        { label: '参赛', value: summary.participations || 0 },
        { label: '得分', value: summary.basketballPoints || 0 },
        { label: '篮板', value: summary.basketballRebounds || 0 },
        { label: '助攻', value: summary.basketballAssists || 0 }
      ]
    }
    if (sport === '羽毛球') {
      return [
        { label: '参赛', value: summary.participations || 0 },
        { label: '胜场', value: summary.wins || 0 },
        { label: '得分', value: summary.badmintonPoints || 0 },
        { label: '胜率', value: summary.winRateLabel || '0%' }
      ]
    }
    return [
      { label: '参赛', value: summary.participations || 0 },
      { label: '进球', value: summary.goals || 0 },
      { label: '助攻', value: summary.assists || 0 },
      { label: '胜场', value: summary.wins || 0 }
    ]
  },

  onLoad(options) {
    this.setData({
      openid: options.openid || '',
      activeTab: options.tab || 'all'
    })
    this.load()
  },

  load() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getAthleteMatchStats',
      data: { openid: this.data.openid },
      success: (res) => {
        const result = res.result || {}
        if (result.code === 0) {
          const payload = result.data || {}
          const sport = payload.sport || '足球'
          const tabs = this.buildTabs(sport)
          const activeTab = tabs.some(item => item.value === this.data.activeTab) ? this.data.activeTab : 'all'
          this.setData({
            sport,
            tabs,
            activeTab,
            matches: payload.matches || [],
            summary: payload.summary || { participations: 0, goals: 0, assists: 0, wins: 0 },
            summaryCards: this.buildSummaryCards(sport, payload.summary || {}),
            loading: false
          }, () => this.applyTab())
        } else {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
          this.setData({ loading: false })
        }
      },
      fail: () => {
        wx.showToast({ title: '云函数调用失败', icon: 'none' })
        this.setData({ loading: false })
      }
    })
  },

  selectTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.value || 'all' }, () => this.applyTab())
  },

  applyTab() {
    const tab = this.data.activeTab
    const visibleMatches = (this.data.matches || []).filter(item => {
      if (tab === 'goals') return (item.footballStats && item.footballStats.goals > 0)
      if (tab === 'assists') {
        if (this.data.sport === '篮球') return item.basketballStats && item.basketballStats.assists > 0
        return item.footballStats && item.footballStats.assists > 0
      }
      if (tab === 'points') {
        if (this.data.sport === '篮球') return item.basketballStats && item.basketballStats.points > 0
        return item.badmintonStats && item.badmintonStats.points > 0
      }
      if (tab === 'rebounds') return item.basketballStats && item.basketballStats.rebounds > 0
      if (tab === 'wins') return item.result === 'win'
      return true
    })
    this.setData({ visibleMatches })
  },

  goEventDetail(e) {
    const postId = e.currentTarget.dataset.postid
    if (postId) wx.navigateTo({ url: `/pages/post-detail/post-detail?id=${postId}` })
  }
})
