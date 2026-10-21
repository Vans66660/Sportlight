const TEMPLATE_TYPES = {
  order: 'order',
  payment: 'payment',
  event: 'event',
  team: 'team'
}

const DEFAULT_TEMPLATES = {
  team: {
    templateId: 'FP_FE6U6eL2ELj1skG8I9JDpfP9nC1R67MyHgmeJgMI'
  },
  event: {
    templateId: 'hMUrnvn6T2-bsx0pGPx_63hdPWbiIecwDOV7D17sgJY'
  },
  payment: {
    templateId: 'l0eD560SJKTqx5hlQ1TDt4ZUowKAv4m55cHteQnTXDk'
  },
  order: {
    templateId: 'XS3YNclz2a6W5xi4cgHQvpryhVotR92yqS-gTeqoOuI'
  }
}

function getTemplateIds(types = []) {
  const config = {
    ...DEFAULT_TEMPLATES,
    ...(wx.getStorageSync('subscribeTemplates') || {})
  }
  return [...new Set(types
    .map(type => config[type] && (config[type].templateId || config[type]))
    .filter(Boolean))]
    .slice(0, 3)
}

function getSubscribeFailReason(err = {}) {
  const errMsg = err.errMsg || ''
  if (errMsg.includes('main switch') || errMsg.includes('switched off')) {
    return 'permission_off'
  }
  if (errMsg.includes('TAP') || errMsg.includes('tap')) {
    return 'not_user_tap'
  }
  if (errMsg.includes('template') || errMsg.includes('tmpl')) {
    return 'template_invalid'
  }
  return 'api_fail'
}

function getSubscribeFailText(reason) {
  if (reason === 'permission_off') return '订阅消息总开关未打开，请到小程序右上角设置里开启。'
  if (reason === 'not_user_tap') return '微信要求订阅授权必须由点击直接触发，本次未拉起。'
  if (reason === 'template_invalid') return '订阅模板暂不可用，请检查模板配置是否属于当前小程序。'
  if (reason === 'no_template') return '订阅模板未配置。'
  return '订阅授权未拉起。'
}

function requestImportantNotice(types = [], options = {}) {
  const tmplIds = getTemplateIds(types)
  if (!tmplIds.length || !wx.requestSubscribeMessage) {
    console.warn('skip subscribe message', { tmplIds, hasApi: !!wx.requestSubscribeMessage })
    return Promise.resolve({ skipped: true, reason: 'no_template', failText: getSubscribeFailText('no_template'), tmplIds })
  }
  return new Promise(resolve => {
    wx.requestSubscribeMessage({
      tmplIds,
      success: res => {
        const values = tmplIds.map(id => res[id]).filter(Boolean)
        let subscribeStatus = 'unknown'
        if (values.includes('ban')) {
          subscribeStatus = 'ban'
          if (options.showGuide) showSubscribeGuide('订阅消息已被系统关闭，请在小程序右上角「...」-「设置」中打开订阅消息。')
        } else if (values.length > 0 && values.every(v => v === 'reject')) {
          subscribeStatus = 'reject'
          if (options.showGuide) showSubscribeGuide('你已拒绝本次通知授权，后续重要结果仍会保留在站内消息里。')
        } else if (values.includes('accept')) {
          subscribeStatus = 'accept'
        }
        resolve({ ...res, subscribeStatus, tmplIds })
      },
      fail: err => {
        const reason = getSubscribeFailReason(err)
        const failText = getSubscribeFailText(reason)
        console.warn('requestSubscribeMessage fail', { reason, err, tmplIds })
        if (options.showGuide) showSubscribeGuide(failText)
        resolve({ skipped: true, reason, failText, err, tmplIds })
      }
    })
  })
}

function showSubscribeGuide(content) {
  wx.showModal({
    title: '通知授权提示',
    content,
    confirmText: '知道了',
    showCancel: false
  })
}

module.exports = {
  TEMPLATE_TYPES,
  requestImportantNotice,
  getSubscribeFailText
}
