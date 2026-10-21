// cloudfunctions/securityCheck/index.js
// 微信内容安全检测云函数
// 支持图片检测 (imgSecCheck) 和文本检测 (msgSecCheck)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { type, fileID, content } = event

  try {
    // ===== 图片安全检测 =====
    if (type === 'image') {
      if (!fileID) {
        return { code: -1, msg: '缺少图片文件ID' }
      }

      // 下载云存储中的图片
      const downloadRes = await cloud.downloadFile({ fileID })
      const buffer = downloadRes.fileContent

      if (!buffer || buffer.length === 0) {
        return { code: -1, msg: '图片下载失败' }
      }

      // 图片大小限制：imgSecCheck 要求 ≤ 1MB
      if (buffer.length > 1024 * 1024) {
        return { code: -2, msg: '图片过大，请压缩后重新上传', safe: false }
      }

      // 调用微信内容安全 API
      const result = await cloud.openapi.security.imgSecCheck({
        media: {
          contentType: 'image/jpeg',
          value: buffer
        }
      })

      // errcode: 0=正常, 87014=含有违规内容
      const errCode = result.errCode !== undefined ? result.errCode : result.errcode
      if (errCode === 0) {
        return { code: 0, safe: true, msg: '内容正常' }
      } else if (errCode === 87014) {
        return { code: 0, safe: false, msg: '图片含有违规内容' }
      } else {
        console.warn('imgSecCheck 返回:', result)
        return { code: -1, safe: false, msg: '图片审核服务异常，请稍后重试' }
      }
    }

    // ===== 文本安全检测 =====
    if (type === 'text') {
      if (!content || !content.trim()) {
        return { code: 0, safe: true, msg: '内容为空，跳过检测' }
      }

      // msgSecCheck 要求内容不超过 500KB
      const textContent = content.slice(0, 500000)

      const result = await cloud.openapi.security.msgSecCheck({
        content: textContent
      })

      const errCode = result.errCode !== undefined ? result.errCode : result.errcode
      if (errCode === 0) {
        return { code: 0, safe: true, msg: '内容正常' }
      } else if (errCode === 87014) {
        return { code: 0, safe: false, msg: '文本含有违规内容' }
      } else {
        console.warn('msgSecCheck 返回:', result)
        return { code: -1, safe: false, msg: '文本审核服务异常，请稍后重试' }
      }
    }

    return { code: -1, msg: '未知检测类型: ' + type }
  } catch (e) {
    console.error('安全检测异常:', e)
    return { code: -1, safe: false, msg: '内容审核服务异常，请稍后重试' }
  }
}
