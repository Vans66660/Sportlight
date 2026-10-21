const legalDocs = require('../../utils/legal-docs')

Page({
  data: {
    title: '',
    items: [],
    isConsentMode: false,
    canAgree: false
  },

  onLoad(options) {
    const type = options.type === 'consent'
      ? 'consent'
      : options.type === 'privacy' ? 'privacy' : 'agreement'
    const doc = this.getLegalDoc(type)
    const isConsentMode = type === 'consent'
    const items = doc.paragraphs
      .filter(text => text !== '---')
      .map((text, index) => ({
        id: index,
        text,
        type: this.getParagraphType(text, index)
      }))

    wx.setNavigationBarTitle({ title: doc.navTitle })
    this.setData({
      title: doc.title,
      items,
      isConsentMode,
      canAgree: !isConsentMode
    })
  },

  onReachBottom() {
    if (this.data.isConsentMode && !this.data.canAgree) {
      this.setData({ canAgree: true })
    }
  },

  getLegalDoc(type) {
    if (type !== 'consent') return legalDocs[type]

    return {
      navTitle: '阅读协议',
      title: 'Sportlight 用户协议与隐私政策',
      paragraphs: [
        ...legalDocs.agreement.paragraphs,
        '---',
        ...legalDocs.privacy.paragraphs
      ]
    }
  },

  getParagraphType(text, index) {
    if (index === 0 || text === legalDocs.privacy.title) return 'title'
    if (/^(版本日期|生效日期)：/.test(text)) return 'meta'
    if (/^【.+】$/.test(text)) return 'notice-title'
    if (/^第[一二三四五六七八九十]+章\s/.test(text) || /^[一二三四五六七八九十]+、/.test(text)) return 'heading'
    if (/^\d+\.\d+\s/.test(text)) return 'subheading'
    if (/^（\d+）/.test(text)) return 'subheading'
    if (/^- /.test(text)) return 'bullet'
    return 'paragraph'
  },

  confirmAgreement() {
    if (!this.data.canAgree) {
      wx.showToast({ title: '请先阅读到底部', icon: 'none' })
      return
    }
    wx.setStorageSync('_sportlightLegalConsentAccepted', '1')
    wx.showToast({ title: '已同意', icon: 'success', duration: 800 })
    setTimeout(() => wx.navigateBack(), 500)
  }
})
