Page({
  data: {
    step: 1,
    sports: ['篮球', '足球', '羽毛球'],
    footballPositions: ['边锋', '中锋', '前腰', '后腰', '边后卫', '中后卫', '门将'],
    basketballPositions: ['控球后卫', '得分后卫', '小前锋', '大前锋', '中锋'],
    badmintonPositions: ['男单', '女单', '男双', '女双', '混双'],
    sportIndex: 0,
    maxBirthDate: '',
    canNext1: false, canNext2: false,
    verifyingIdentity: false,
    isFootball: false, isBasketball: false, isBadminton: false, careerLabel: '', levelLabel: '', isPendingReview: false,
    form: {
      sport: '', position: '', secondaryPosition: '', name: '', nickname: '', idCard: '', gender: '', city: '',
      photo: '',
      description: '',
      phone: '', purePhoneNumber: '', countryCode: '', phoneVerified: false,
      birthDate: '', age: '', height: '', weight: '', wingspan: '', preferredFoot: '', preferredHand: '',
      isStudent: null, studentProofFile: '',
      athleteLevelCertFile: '', athleteLevelCertLevel: '',
      trainedProfessionally: null,
      hasProBackground: null, proofFile: '',
      hasAmateurLeague: null,
      // 统一记录竞技经历；篮球显示 CUBAL，足球显示青训/校队等足球专属选项。
      competitiveBackground: null,
      hasTopThree: null, topThreeCount: null, playYears: null
    }
  },

  onLoad() {
    const today = new Date()
    const yyyy = today.getFullYear()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    this.setData({ maxBirthDate: `${yyyy}-${mm}-${dd}` })
  },

  onInput(e) {
    const f = e.currentTarget.dataset.field
    let value = e.detail.value
    if (f === 'idCard') value = String(value || '').replace(/\s/g, '').toUpperCase()
    if (f === 'name') value = String(value || '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ')
    // 最后一次输入后立即点击提交时，setData 可能尚未反映到读取值；保留同步副本避免姓名丢失。
    if (f === 'name') this._realName = String(value || '').trim()
    this.setData({ [`form.${f}`]: value }, () => this.checkAll())
  },

  onSportChange(e) {
    const idx = parseInt(e.detail.value)
    const sport = this.data.sports[idx]
    this.setData({
      sportIndex: idx,
      'form.sport': sport,
      'form.position': '',
      'form.secondaryPosition': '',
      isFootball: sport === '足球',
      isBasketball: sport === '篮球',
      isBadminton: sport === '羽毛球'
    }, () => this.checkAll())
  },

  bindPhone(e) {
    const { errMsg, code } = e.detail || {}
    if (!errMsg || !errMsg.includes('ok')) return wx.showToast({ title: '请完成手机号验证', icon: 'none' })
    if (!code) return wx.showToast({ title: '版本不支持', icon: 'none' })
    wx.showLoading({ title: '绑定中...' })
    wx.cloud.callFunction({
      name: 'bindPhone',
      data: { code },
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
        } else {
          wx.showToast({ title: res.result && res.result.msg ? res.result.msg : '绑定失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      }
    })
  },

  setGender(e) {
    const val = e.currentTarget.dataset.val
    if (!val) return
    this.setData({ 'form.gender': val }, () => this.checkAll())
  },
  onCityChange(e) {
    this.setData({ 'form.city': e.detail.value[1] }, () => this.checkAll())
  },

  onBirthDateChange(e) {
    const birthDate = e.detail.value || ''
    this.setData({
      'form.birthDate': birthDate,
      'form.age': this.calcAge(birthDate)
    }, () => this.checkAll())
  },

  calcAge(birthDate) {
    if (!birthDate) return ''
    const birth = new Date(String(birthDate).replace(/-/g, '/'))
    if (Number.isNaN(birth.getTime())) return ''
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    const hadBirthday = today.getMonth() > birth.getMonth() ||
      (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate())
    if (!hadBirthday) age -= 1
    return age >= 0 ? String(age) : ''
  },

  uploadAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        wx.showLoading({ title: '上传头像中...' })
        try {
          const extMatch = String(file.tempFilePath).match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
          const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg'
          const uploaded = await wx.cloud.uploadFile({
            cloudPath: `avatars/athlete_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
            filePath: file.tempFilePath
          })
          this.setData({ 'form.photo': uploaded.fileID }, () => this.checkAll())
          wx.hideLoading()
          wx.showToast({ title: '头像已上传', icon: 'success' })
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '头像上传失败', icon: 'none' })
        }
      }
    })
  },
  setFoot(e) { this.setData({ 'form.preferredFoot': e.currentTarget.dataset.val }, () => this.checkAll()) },
  setHand(e) { this.setData({ 'form.preferredHand': e.currentTarget.dataset.val }, () => this.checkAll()) },

  setSportPosition(e) {
    const { field, val } = e.currentTarget.dataset
    if (field === 'secondaryPosition' && val === this.data.form.position) return
    if (field === 'secondaryPosition' && val === this.data.form.secondaryPosition) {
      this.setData({ 'form.secondaryPosition': '' }, () => this.checkAll())
      return
    }
    const updates = { [`form.${field}`]: val }
    if (field === 'position' && this.data.form.secondaryPosition === val) {
      updates['form.secondaryPosition'] = ''
    }
    this.setData(updates, () => this.checkAll())
  },

  isValidRealName(name) {
    // 覆盖扩展汉字、繁体字和少数民族姓名中的“·”，避免合法姓名被误拦截。
    return /^[\u3400-\u9FFF\uF900-\uFAFFA-Za-z·\s]{2,30}$/u.test(String(name || '').trim())
  },

  isValidIdCard(idCard) {
    const id = String(idCard || '').trim().toUpperCase()
    if (!/^\d{17}[\dX]$/.test(id)) return false

    const birth = id.slice(6, 14)
    const year = Number(birth.slice(0, 4))
    const month = Number(birth.slice(4, 6))
    const day = Number(birth.slice(6, 8))
    const date = new Date(year, month - 1, day)
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) return false

    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
    const sum = weights.reduce((total, weight, index) => total + Number(id[index]) * weight, 0)
    return checks[sum % 11] === id[17]
  },

  setTrained(e) {
    this.setData({
      'form.trainedProfessionally': e.currentTarget.dataset.val,
      'form.hasProBackground': null, 'form.hasAmateurLeague': null,
      'form.competitiveBackground': null, 'form.proofFile': ''
    }, () => this.checkAll())
  },

  setProBg(e) {
    this.setData({
      'form.hasProBackground': e.currentTarget.dataset.val,
      'form.competitiveBackground': null, 'form.proofFile': ''
    }, () => this.checkAll())
  },

  setAmateur(e) {
    this.setData({
      'form.hasAmateurLeague': e.currentTarget.dataset.val,
      'form.hasTopThree': null, 'form.topThreeCount': null, 'form.playYears': null, 'form.proofFile': ''
    }, () => this.checkAll())
  },

  setTopThree(e) {
    this.setData({
      'form.hasTopThree': e.currentTarget.dataset.val,
      'form.topThreeCount': null, 'form.playYears': null, 'form.proofFile': ''
    }, () => this.checkAll())
  },
  setTopThreeCount(e) { this.setData({ 'form.topThreeCount': e.currentTarget.dataset.val, 'form.proofFile': '' }, () => this.checkAll()) },
  setPlayYears(e) { this.setData({ 'form.playYears': e.currentTarget.dataset.val }, () => this.checkAll()) },

  setCompetitiveBackground(e) {
    this.setData({ 'form.competitiveBackground': e.currentTarget.dataset.val, 'form.proofFile': '' }, () => this.checkAll())
  },

  setStudent(e) {
    const raw = e.currentTarget.dataset.val
    const isStudent = raw === true || raw === 'true'
    this.setData({
      'form.isStudent': isStudent,
      'form.studentProofFile': isStudent ? this.data.form.studentProofFile : ''
    }, () => this.checkAll())
  },

  uploadFiles({ count = 1, folder = 'proofs', loadingTitle = '上传中...', successTitle = '已上传' } = {}) {
    return new Promise((resolve, reject) => {
      wx.chooseMedia({
        count,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const files = (res.tempFiles || []).filter(file => file && file.tempFilePath)
          if (!files.length) return resolve([])
          wx.showLoading({ title: loadingTitle })
          const stamp = Date.now()
          const uploads = files.map((file, index) => {
            const extMatch = String(file.tempFilePath).match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
            const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg'
            return wx.cloud.uploadFile({
              cloudPath: `${folder}/${stamp}_${index}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
              filePath: file.tempFilePath
            })
          })
          Promise.all(uploads).then(results => {
            wx.hideLoading()
            wx.showToast({ title: successTitle, icon: 'success' })
            resolve(results.map(item => item.fileID).filter(Boolean))
          }).catch(err => {
            wx.hideLoading()
            wx.showToast({ title: '上传失败', icon: 'none' })
            reject(err)
          })
        },
        fail: reject
      })
    })
  },

  async uploadStudentProof() {
    try {
      const files = await this.uploadFiles({ count: 1, folder: 'student-proofs', successTitle: '学生证明已上传' })
      if (files.length) this.setData({ 'form.studentProofFile': files.join(',') }, () => this.checkAll())
    } catch (e) {}
  },

  async uploadAthleteLevelCert() {
    try {
      const files = await this.uploadFiles({ count: 1, folder: 'athlete-level-certs', successTitle: '等级证书已上传' })
      if (files.length) this.setData({ 'form.athleteLevelCertFile': files.join(',') }, () => this.checkAll())
    } catch (e) {}
  },

  uploadProof() {
    this.uploadFiles({ count: 3, folder: 'proofs', successTitle: '已上传，等待审核' }).then(files => {
      if (files.length) this.setData({ 'form.proofFile': files.join(',') }, () => this.checkAll())
    }).catch(() => {})
  },

  checkAll() {
    const f = this.data.form
    const isFB = this.data.isFootball
    const isBB = this.data.isBasketball
    const step1Base = !!(f.photo && f.sport && f.position && f.city)
    const step1Extra = isFB ? !!(f.birthDate && f.height && f.weight && f.preferredFoot) : true
    const basketballExtra = isBB ? !!(f.birthDate && f.height && f.weight && f.wingspan && f.preferredHand) : true
    const identityBase = this.isValidRealName(f.name) && !!f.gender
    this.setData({ canNext1: step1Base && step1Extra && basketballExtra && identityBase && f.phoneVerified })

    let qOk = false
    if (f.trainedProfessionally === true) {
      if (f.hasProBackground === true) {
        qOk = !!f.proofFile
      } else if (f.hasProBackground === false) {
        if (f.competitiveBackground === 'levelA' || f.competitiveBackground === 'levelB') {
          qOk = !!f.proofFile  // 选择高级竞技经历 → 必须上传证明
        } else if (f.competitiveBackground === 'none') {
          // Qd=否 → 跳转到业余路径，需完成Qc
          qOk = f.hasAmateurLeague !== null
            ? (f.hasAmateurLeague === true ? (f.hasTopThree !== null ? (f.hasTopThree === true ? !!(f.topThreeCount && f.proofFile) : !!f.playYears) : false) : !!f.playYears)
            : false
        }
      }
    } else if (f.trainedProfessionally === false) {
      if (f.hasAmateurLeague === true) {
        if (f.hasTopThree === true) {
          qOk = !!(f.topThreeCount && f.proofFile)  // Qe=是 → Qf+证明
        } else if (f.hasTopThree === false) {
          qOk = !!f.playYears  // Qe=否 → 球龄
        }
      } else if (f.hasAmateurLeague === false) {
        qOk = !!f.playYears  // Qc=否 → 球龄必填
      }
    }
    const studentOk = f.isStudent === false || (f.isStudent === true && !!f.studentProofFile)
    this.setData({ canNext2: studentOk && qOk })
  },

  getCareerLabel() {
    const f = this.data.form
    const parts = []
    if (f.trainedProfessionally === true) {
      parts.push('专业训练')
      if (f.hasProBackground === true) parts.push('职业背景')
      if (f.competitiveBackground === 'levelA') parts.push(this.data.isFootball ? '职业梯队/青训经历' : 'CUBAL一级/省BA')
      if (f.competitiveBackground === 'levelB') parts.push(this.data.isFootball ? '校队/高水平青少年赛事' : 'CUBAL二级')
    } else {
      if (f.hasAmateurLeague === true) {
        parts.push('业余联赛')
        if (f.hasTopThree === true) {
          parts.push(f.topThreeCount === 'gt3' ? '前三名×3+' : '前三名≤3')
        }
      }
      if (f.hasAmateurLeague === false && f.playYears) {
        parts.push('球龄' + {lt1:'<1年','1to3':'1-3年','3to5':'3-5年',gt5:'>5年'}[f.playYears])
      }
      else parts.push('自学/业余爱好')
    }
    return parts.join(' + ')
  },

  getLevelLabel() {
    const f = this.data.form
    if (this.data.isBasketball) {
      let resumeScore = 100
      if (f.hasProBackground === true && f.proofFile) resumeScore = 800
      else if (f.competitiveBackground === 'levelA' && f.proofFile) resumeScore = 650
      else if (f.competitiveBackground === 'levelB' && f.proofFile) resumeScore = 500
      else if (f.hasAmateurLeague === true && f.hasTopThree === true && f.proofFile) {
        resumeScore = f.topThreeCount === 'gt3' ? 500 : 300
      }
      const height = Number(f.height) || 0
      const positionScore = ['中锋', '大前锋'].includes(f.position) ? 100 : (f.position === '小前锋' ? 50 : 0)
      const heightScore = height >= 195 ? 100 : (height >= 190 ? 60 : (height >= 185 ? 30 : 0))
      const score = Math.min(1000, resumeScore + Math.min(200, positionScore + heightScore))
      const tier = score >= 850 ? 'S' : score >= 650 ? 'A' : score >= 500 ? 'B' : score >= 300 ? 'C' : 'D'
      return `${tier}级推荐（待验证）`
    }
    if (f.hasProBackground === true && f.proofFile) return 'S级（审核中）'
    if (f.competitiveBackground === 'levelA' && f.proofFile) return 'A级（审核中）'
    if (f.competitiveBackground === 'levelB' && f.proofFile) return 'B级（审核中）'
    if (f.trainedProfessionally === true && f.competitiveBackground === 'none') return '进入业余评估'
    if (f.hasAmateurLeague === true && f.hasTopThree === true && f.topThreeCount === 'gt3' && f.proofFile) return 'B级（审核中）'
    if (f.hasAmateurLeague === true && f.hasTopThree === true && f.proofFile) return 'C级（审核中）'
    if (f.hasAmateurLeague === true) return 'D级'
    if (f.hasAmateurLeague === false && f.playYears) return 'D级'
    return 'D级'
  },

  async nextStep() {
    const { step, canNext1, canNext2 } = this.data
    if (this.data.verifyingIdentity) return
    if (step === 1 && !canNext1) return
    if (step === 2 && !canNext2) return
    if (step === 2) {
      this.setData({
        careerLabel: this.getCareerLabel(),
        levelLabel: this.getLevelLabel(),
        isPendingReview: !!this.data.form.proofFile
      })
    }
    this.setData({ step: step + 1 })
  },

  prevStep() { this.setData({ step: Math.max(1, this.data.step - 1) }) },
  goBack() {
    if (this.data.step > 1) {
      this.prevStep()
      return
    }
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/market/market' })
    }
  },

  goToMarket() {
    const f = this.data.form
    const realName = String(this._realName || f.name || '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim()
    if (!this.isValidRealName(realName)) {
      return wx.showToast({ title: '请填写有效的真实姓名', icon: 'none' })
    }
    const app = getApp()
    const nickname = ''
    const displayName = ''
    const profileData = {
      name: realName,
      realName,
      nickname,
      displayName,
      idCard: f.idCard,
      gender: f.gender, city: f.city,
      phone: f.phone, purePhoneNumber: f.purePhoneNumber,
      countryCode: f.countryCode, phoneVerified: f.phoneVerified,
      description: f.description,
      affiliation: f.affiliation,
      sport: f.sport, position: f.position, secondaryPosition: f.secondaryPosition,
      birthDate: f.birthDate,
      age: f.age || this.calcAge(f.birthDate),
      height: f.height, weight: f.weight, wingspan: f.wingspan,
      preferredFoot: f.preferredFoot, preferredHand: f.preferredHand,
      trainedProfessionally: f.trainedProfessionally,
      hasProBackground: f.hasProBackground, proofFile: f.proofFile,
      isStudent: f.isStudent,
      studentProofFile: f.studentProofFile,
      athleteLevelCertFile: f.athleteLevelCertFile,
      athleteLevelCertFiles: f.athleteLevelCertFile ? f.athleteLevelCertFile.split(',').filter(Boolean) : [],
      athleteLevelCertLevel: f.athleteLevelCertLevel,
      hasAmateurLeague: f.hasAmateurLeague, hasTopThree: f.hasTopThree,
      topThreeCount: f.topThreeCount, playYears: f.playYears,
      competitiveBackground: f.competitiveBackground,
      careerLabel: this.data.careerLabel,
      levelLabel: this.data.levelLabel,
      acceptMatch: f.acceptMatch,
      acceptAd: false,
      matchPrice: parseInt(f.matchPrice) || 0,
      adPrice: 0,
      photo: f.photo,
      videoUploaded: f.videoUploaded,
      videoName: f.videoName,
      certUploaded: f.certUploaded,
      certName: f.certName,
      socials: []
    }
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'saveUser',
      data: {
        userType: 'athlete',
        profileData
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result.code === 0) {
          wx.setStorageSync('editProfileForm', profileData)
          app.globalData.userInfo = { ...(app.globalData.userInfo || {}), ...profileData }
          if (typeof app.completeRegistration === 'function') {
            app.completeRegistration('athlete')
          } else {
            app.globalData.userType = 'athlete'; app.globalData.registered = true
            wx.setStorageSync('userType', 'athlete'); wx.setStorageSync('registered', '1')
            wx.removeStorageSync('selectedRegisterUserType')
          }
          wx.switchTab({ url: '/pages/market/market' })
        } else {
          wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
        }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }) }
    })
  }
})
