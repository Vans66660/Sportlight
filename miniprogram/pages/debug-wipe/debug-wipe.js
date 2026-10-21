Page({
  data: {
    authorized: false,
    checking: true,
    canBootstrap: false,
    result: '',
    adminKey: '',
    wipePhrase: ''
  },

  onLoad() {
    this.guardAdminAccess()
  },

  guardAdminAccess() {
    const app = getApp()
    app.onLoginReady(() => {
      const userType = app.globalData.userType || wx.getStorageSync('userType') || ''
      const registered = app.globalData.registered || wx.getStorageSync('registered') === '1'

      if (userType === 'admin') {
        this.setData({ authorized: true, checking: false })
        return
      }

      wx.cloud.callFunction({
        name: 'adminBootstrapStatus',
        data: {}
      }).then(res => {
        const result = res.result || {}
        if (result.isAdmin) {
          app.globalData.registered = true
          app.globalData.userType = 'admin'
          wx.setStorageSync('registered', '1')
          wx.setStorageSync('userType', 'admin')
          this.setData({ authorized: true, checking: false, canBootstrap: true })
          return
        }

        if (result.eligible) {
          this.setData({ authorized: false, checking: false, canBootstrap: true })
          return
        }

        this.redirectNormalUser(registered, userType)
      }).catch(() => {
        this.redirectNormalUser(registered, userType)
      })
    })
  },

  redirectNormalUser(registered, userType) {
    this.setData({ authorized: false, checking: true, canBootstrap: false })
    setTimeout(() => {
      if (registered && userType) {
        wx.switchTab({ url: '/pages/market/market' })
      } else {
        wx.reLaunch({ url: '/pages/login/login' })
      }
    }, 300)
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onWipe() {
    if (!this.data.authorized) return
    if (this.data.wipePhrase !== '清空Sportlight全部数据') {
      wx.showToast({ title: '确认短语不正确', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认清空',
      content: '所有数据将被永久删除，确定继续？',
      confirmText: '确认清空',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return;
        this.doWipe();
      }
    });
  },

  doWipe() {
    if (!this.data.authorized) return
    wx.showLoading({ title: '正在清空...' });
    wx.cloud.callFunction({
      name: 'adminWipeDatabase',
      data: {
        confirm: 'NUCLEAR_WIPE',
        phrase: this.data.wipePhrase
      }
    }).then(res => {
      wx.hideLoading();
      const d = res.result;
      if (d && d.code === 0) {
        let text = '✅ 清空成功\n\n';
        for (const [k, v] of Object.entries(d.before)) {
          text += `${k}: ${v} 条\n`;
        }
        text += `\n共删除 ${d.totalDeleted || 0} 条记录`;
        this.setData({ result: text });
      } else if (d && d.code === -1) {
        wx.showModal({
          title: '提示',
          content: d.msg || '操作失败',
          showCancel: false
        });
        this.setData({ result: '❌ ' + (d.msg || '失败') });
      } else {
        this.setData({ result: '❌ 失败：' + JSON.stringify(d) });
      }
    }).catch(err => {
      wx.hideLoading();
      this.setData({ result: '❌ 错误：' + err.message });
    });
  },

  goBack() {
    wx.navigateBack();
  },

  promoteAdmin() {
    if (!this.data.adminKey) {
      wx.showToast({ title: '请输入管理员密钥', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '升级中...' });
    wx.cloud.callFunction({
      name: 'promoteMeToAdmin',
      data: {
        adminKey: this.data.adminKey
      }
    }).then(res => {
      wx.hideLoading();
      const d = res.result;
      if (d && d.code === 0) {
        const app = getApp()
        app.globalData.registered = true
        app.globalData.userType = 'admin'
        wx.setStorageSync('registered', '1')
        wx.setStorageSync('userType', 'admin')
        this.setData({ authorized: true, checking: false, canBootstrap: true })
        wx.showModal({ title: '成功', content: d.msg, showCancel: false });
      } else {
        wx.showModal({ title: '提示', content: d.msg || '失败', showCancel: false });
      }
    }).catch(err => {
      wx.hideLoading();
      wx.showModal({ title: '错误', content: err.message, showCancel: false });
    });
  }
});
