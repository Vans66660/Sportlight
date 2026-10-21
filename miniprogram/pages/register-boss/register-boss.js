const security = require('../../utils/security')

function validateIdCard(id) {
  if (!id || id.length !== 18) return false
  const w = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]
  const c = ['1','0','X','9','8','7','6','5','4','3','2']
  let s = 0
  for (let i = 0; i < 17; i++) {
    if (isNaN(parseInt(id[i]))) return false
    s += parseInt(id[i]) * w[i]
  }
  return c[s % 11] === id[17].toUpperCase()
}

function normalizeText(text) {
  return String(text || '').trim().replace(/\s+/g, '')
}

function normalizeCreditCode(code) {
  return String(code || '').trim().toUpperCase()
}

function validateCreditCode(code) {
  return /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(normalizeCreditCode(code))
}

Page({
  data: {
    step: 1,
    bossTypes: [
      { key: 'personal', emoji: '👤', label: '个人主体', desc: '个人教练、自由星探等' },
      { key: 'company', emoji: '🏢', label: '企业主体', desc: '体育公司、品牌方等' },
      { key: 'club',   emoji: '⚽', label: '俱乐部主体', desc: '运动俱乐部、场馆方等' }
    ],
    canNext1: false, canNext2: false, canNext3: false,
    verifyingIdentity: false,
    bossTypeLabel: '', regionValue: [],
    ocrRunning: false, ocrDone: false, ocrStatus: '',
    descriptionFocused: false,
    form: {
      logo: '', city: '', description: '', phone: '', purePhoneNumber: '', countryCode: '', phoneVerified: false,
      bossType: '',
      // 个人
      displayName: '', realName: '', idCard: '',
      receiveMethod: '', wxpayBound: false,
      // 企业
      companyName: '', creditCode: '', license: '', ocrCompanyName: '', ocrCreditCode: '', ocrLegalPerson: '',
      legalType: '', legalName: '', legalIdCard: '', agentName: '', agentIdCard: '', authLetter: '',
      // 俱乐部
      clubType: '', clubLogo: ''
    }
  },

  onDescriptionFocus() {
    this.setData({ descriptionFocused: true })
    // 给键盘预留空间，避免输入框与“下一步”区域被键盘遮住。
    setTimeout(() => wx.pageScrollTo({ scrollTop: 360, duration: 220 }), 80)
  },

  onDescriptionBlur() {
    this.setData({ descriptionFocused: false })
  },

  onInput(e) {
    const f = e.currentTarget.dataset.field
    const upperFields = ['idCard', 'legalIdCard', 'agentIdCard', 'creditCode']
    const value = upperFields.includes(f) ? String(e.detail.value || '').toUpperCase() : e.detail.value
    this.setData({ [`form.${f}`]: value }, () => this.checkAll())
  },

  onCityChange(e) {
    const v = e.detail.value
    this.setData({ regionValue: v, 'form.city': v[1] || v[0] }, () => this.checkAll())
  },

  // ===== Logo =====
  uploadLogo() {
    wx.chooseMedia({ count: 1, mediaType: ['image'],
      success: async (res) => {
        const tp = await security.compressImageForAudit(res.tempFiles[0].tempFilePath)
        this.setData({ 'form.logo': tp })
        wx.showLoading({ title: '上传中...' })
        const ext = tp.split('.').pop() || 'jpg'
        wx.cloud.uploadFile({
          cloudPath: 'bosses/' + Date.now() + '.' + ext, filePath: tp,
          success: async (up) => {
            wx.hideLoading()
            const safe = await security.checkImage(up.fileID)
            if (!safe) { this.setData({ 'form.logo': '' }); return }
            this.setData({ 'form.logo': up.fileID }, () => this.checkAll())
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }) }
        })
      }
    })
  },

  // ===== 手机 =====
  bindPhone(e) {
    const { errMsg, code } = e.detail || {}
    if (!errMsg || !errMsg.includes('ok')) return wx.showToast({ title: '请完成手机号验证', icon: 'none' })
    if (!code) return wx.showToast({ title: '版本不支持', icon: 'none' })
    wx.showLoading({ title: '绑定中...' })
    wx.cloud.callFunction({ name: 'bindPhone', data: { code },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0) {
          this.setData({
            'form.phone': res.result.phone || '',
            'form.purePhoneNumber': res.result.purePhoneNumber || '',
            'form.countryCode': res.result.countryCode || '',
            'form.phoneVerified': true
          }, () => this.checkAll())
          wx.showToast({ title: '已绑定', icon: 'success' })
        }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
    })
  },

  // ===== 身份类型 =====
  setBossType(e) {
    const type = e.currentTarget.dataset.type
    const item = this.data.bossTypes.find(t => t.key === type)
    if (!item) return
    this.setData({ 'form.bossType': type, bossTypeLabel: item.label }, () => this.checkAll())
  },

  // ===== 收款方式 =====
  setReceiveMethod(e) {
    this.setData({ 'form.receiveMethod': e.currentTarget.dataset.method }, () => this.checkAll())
  },

  bindWxPay(e) {
    if (e.detail && e.detail.errMsg && e.detail.errMsg.includes('ok')) {
      this.setData({ 'form.wxpayBound': true }, () => this.checkAll())
      wx.showToast({ title: '已绑定', icon: 'success' })
    }
  },

  // ===== 法人/经办人切换 =====
  setLegalType(e) {
    this.setData({ 'form.legalType': e.currentTarget.dataset.type }, () => this.checkAll())
  },

  // ===== 营业执照上传 + OCR =====
  uploadLicense() {
    wx.chooseMedia({ count: 1, mediaType: ['image'],
      success: async (res) => {
        const tp = await security.compressImageForAudit(res.tempFiles[0].tempFilePath)
        this.setData({
          'form.license': tp,
          'form.ocrCompanyName': '',
          'form.ocrCreditCode': '',
          'form.ocrLegalPerson': '',
          ocrRunning: true,
          ocrDone: false,
          ocrStatus: 'running'
        })
        wx.showLoading({ title: '上传并识别中...' })
        const cloudPath = 'licenses/' + Date.now() + '.jpg'
        wx.cloud.uploadFile({
          cloudPath, filePath: tp,
          success: async (up) => {
            const safe = await security.checkImage(up.fileID)
            if (!safe) {
              wx.hideLoading()
              this.setData({ 'form.license': '', ocrRunning: false, ocrStatus: 'failed' }); return
            }
            this.setData({ 'form.license': up.fileID })
            // 调用云函数 OCR 识别
            wx.cloud.callFunction({
              name: 'ocrLicense',
              data: { fileID: up.fileID },
              success: (ocrRes) => {
                wx.hideLoading()
                if (ocrRes.result && ocrRes.result.code === 0) {
                  const d = ocrRes.result.data || {}
                  const recognized = !!(d.companyName && d.creditCode)
                  if (!recognized) {
                    this.setData({
                      ocrRunning: false,
                      ocrDone: false,
                      ocrStatus: 'failed'
                    }, () => this.checkAll())
                    wx.showToast({ title: '未识别到营业执照', icon: 'none' })
                    return
                  }
                  this.setData({
                    'form.companyName': d.companyName || this.data.form.companyName,
                    'form.creditCode': d.creditCode || this.data.form.creditCode,
                    'form.legalName': d.legalPerson || this.data.form.legalName,
                    'form.ocrCompanyName': d.companyName || '',
                    'form.ocrCreditCode': normalizeCreditCode(d.creditCode),
                    'form.ocrLegalPerson': d.legalPerson || '',
                    ocrRunning: false, ocrDone: true, ocrStatus: 'success'
                  }, () => this.checkAll())
                  wx.showToast({ title: '识别完成', icon: 'success' })
                } else {
                  this.setData({ ocrRunning: false, ocrDone: false, ocrStatus: 'failed' }, () => this.checkAll())
                  wx.showToast({ title: (ocrRes.result && ocrRes.result.msg) || '未识别到营业执照', icon: 'none' })
                }
              },
              fail: () => {
                wx.hideLoading()
                this.setData({ ocrRunning: false, ocrDone: false, ocrStatus: 'failed' }, () => this.checkAll())
                wx.showToast({ title: '营业执照识别失败', icon: 'none' })
              }
            })
          },
          fail: () => { wx.hideLoading(); this.setData({ ocrRunning: false, ocrStatus: 'failed' }); wx.showToast({ title: '上传失败', icon: 'none' }) }
        })
      }
    })
  },

  // ===== 俱乐部类型 =====
  setClubType(e) {
    this.setData({
      'form.clubType': e.currentTarget.dataset.type,
      'form.license': '',
      'form.realName': '',
      'form.idCard': '',
      'form.ocrCompanyName': '',
      'form.ocrCreditCode': '',
      'form.ocrLegalPerson': '',
      ocrStatus: '',
      ocrDone: false
    }, () => this.checkAll())
  },

  isLicenseInfoMatched() {
    const f = this.data.form
    if (!f.ocrCompanyName && !f.ocrCreditCode) return true
    if (f.ocrCompanyName && normalizeText(f.companyName) !== normalizeText(f.ocrCompanyName)) return false
    if (f.ocrCreditCode && normalizeCreditCode(f.creditCode) !== normalizeCreditCode(f.ocrCreditCode)) return false
    return true
  },

  // ===== 俱乐部Logo上传 =====
  uploadClubLogo() {
    wx.chooseMedia({ count: 1, mediaType: ['image'],
      success: async (res) => {
        const tp = await security.compressImageForAudit(res.tempFiles[0].tempFilePath)
        this.setData({ 'form.clubLogo': tp })
        wx.showLoading({ title: '上传中...' })
        wx.cloud.uploadFile({
          cloudPath: 'clubLogos/' + Date.now() + '.jpg', filePath: tp,
          success: async (up) => {
            wx.hideLoading()
            const safe = await security.checkImage(up.fileID)
            if (!safe) { this.setData({ 'form.clubLogo': '' }); return }
            this.setData({ 'form.clubLogo': up.fileID }, () => this.checkAll())
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }) }
        })
      }
    })
  },

  // ===== 授权委托书上传 =====
  uploadAuthLetter() {
    wx.chooseMedia({ count: 1, mediaType: ['image'],
      success: async (res) => {
        const tp = await security.compressImageForAudit(res.tempFiles[0].tempFilePath)
        this.setData({ 'form.authLetter': tp })
        wx.showLoading({ title: '上传中...' })
        wx.cloud.uploadFile({
          cloudPath: 'authletters/' + Date.now() + '.jpg', filePath: tp,
          success: async (up) => {
            wx.hideLoading()
            const safe = await security.checkImage(up.fileID)
            if (!safe) { this.setData({ 'form.authLetter': '' }); return }
            this.setData({ 'form.authLetter': up.fileID }, () => this.checkAll())
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }) }
        })
      }
    })
  },

  // ===== 统一校验 =====
  checkAll() {
    const f = this.data.form
    const bt = f.bossType

    this.setData({ canNext1: !!(f.logo && f.city && f.phoneVerified) })
    this.setData({ canNext2: !!bt })

    if (bt === 'personal') {
      this.setData({ canNext3: !!f.displayName })
    } else if (bt === 'company') {
      this.setData({ canNext3: !!(f.companyName && validateCreditCode(f.creditCode) && f.license && this.isLicenseInfoMatched()) })
    } else if (bt === 'club') {
      if (f.clubType === 'registered') {
        this.setData({ canNext3: !!(f.displayName && f.license && f.clubLogo) })
      } else if (f.clubType === 'grassroots') {
        this.setData({ canNext3: !!(f.displayName && f.clubLogo) })
      } else {
        this.setData({ canNext3: false })
      }
    } else {
      this.setData({ canNext3: false })
    }
  },

  // ===== 导航 =====
  nextStep() {
    const { step, canNext1, canNext2 } = this.data
    if (step === 1 && !canNext1) return
    if (step === 2 && !canNext2) return
    this.setData({ step: step + 1 })
  },
  prevStep() { this.setData({ step: Math.max(1, this.data.step - 1) }) },

  // ===== 完成 =====
  async finish() {
    if (this.data.verifyingIdentity) return
    const f = this.data.form
    if (f.bossType === 'company' && !this.isLicenseInfoMatched()) {
      wx.showToast({ title: '请与营业执照信息保持一致', icon: 'none' })
      return
    }
    if (f.bossType === 'company' && !validateCreditCode(f.creditCode)) {
      wx.showToast({ title: '信用代码格式不正确', icon: 'none' })
      return
    }
    if (!this.data.canNext3) return

    wx.showLoading({ title: '保存中...' })
    const app = getApp()
    wx.cloud.callFunction({
      name: 'saveUser',
      data: {
        userType: 'boss',
        profileData: {
          logo: f.logo, bossType: f.bossType, city: f.city,
          name: f.displayName || f.companyName || '',
          displayName: f.displayName,
          description: f.description,
          phone: f.phone, purePhoneNumber: f.purePhoneNumber, countryCode: f.countryCode, phoneVerified: f.phoneVerified,
          realName: f.realName, idCard: f.idCard,
          receiveMethod: f.receiveMethod, wxpayBound: f.wxpayBound,
          companyName: f.companyName, creditCode: f.creditCode, license: f.license,
          ocrCompanyName: f.ocrCompanyName, ocrCreditCode: f.ocrCreditCode, ocrLegalPerson: f.ocrLegalPerson,
          legalType: f.legalType, legalName: f.legalName, legalIdCard: f.legalIdCard,
          agentName: f.agentName, agentIdCard: f.agentIdCard, authLetter: f.authLetter,
          clubType: f.clubType, clubLogo: f.clubLogo
        }
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          if (typeof app.completeRegistration === 'function') {
            app.completeRegistration('boss')
          } else {
            app.globalData.userType = 'boss'; app.globalData.registered = true
            wx.setStorageSync('userType', 'boss'); wx.setStorageSync('registered', '1')
            wx.removeStorageSync('selectedRegisterUserType')
          }
          this.setData({ step: 4 })
        } else { wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' }) }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
    })
  },

  goMarket() { wx.switchTab({ url: '/pages/market/market' }) },
  goPublish() { wx.navigateTo({ url: '/pages/publish-order/publish-order' }) },
  goBack() {
    if (this.data.step > 1 && this.data.step < 4) {
      this.prevStep()
      return
    }
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/market/market' })
    }
  }
})
