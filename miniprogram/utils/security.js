/**
 * 内容安全检测工具模块
 * utils/security.js
 *
 * 用法：
 *   const security = require('../../utils/security')
 *
 *   // 检测图片（上传到云存储后调用）
 *   const ok = await security.checkImage(fileID)
 *   if (!ok) return
 *
 *   // 检测文本（发布前调用）
 *   const ok = await security.checkText(content)
 *   if (!ok) return
 */

/**
 * 将图片压缩到适合内容安全审核的体积。
 * 微信 imgSecCheck 对图片大小有限制，这里尽量压到 900KB 以下，留出编码差异余量。
 * @param {string} filePath - 本地临时图片路径
 * @returns {Promise<string>} 压缩后的本地临时图片路径；压缩不可用时返回原路径
 */
async function compressImageForAudit(filePath) {
  if (!filePath) return filePath
  if (!wx.compressImage || !wx.getFileInfo) return filePath

  const maxSize = 900 * 1024
  const qualities = [80, 60, 40, 25]
  let currentPath = filePath

  const originalSize = await new Promise((resolve) => {
    wx.getFileInfo({
      filePath: currentPath,
      success: res => resolve(res.size || 0),
      fail: () => resolve(0)
    })
  })

  if (originalSize && originalSize <= maxSize) return currentPath

  for (let i = 0; i < qualities.length; i++) {
    currentPath = await new Promise((resolve) => {
      wx.compressImage({
        src: currentPath,
        quality: qualities[i],
        success: res => resolve(res.tempFilePath || currentPath),
        fail: () => resolve(currentPath)
      })
    })

    const size = await new Promise((resolve) => {
      wx.getFileInfo({
        filePath: currentPath,
        success: res => resolve(res.size || 0),
        fail: () => resolve(0)
      })
    })

    if (!size || size <= maxSize) break
  }

  return currentPath
}

/**
 * 检测图片是否含违规内容
 * @param {string} fileID - 云存储文件ID
 * @returns {Promise<boolean>} true=安全，false=违规
 */
function checkImage(fileID) {
  return new Promise((resolve) => {
    if (!fileID) {
      resolve(true)
      return
    }

    wx.cloud.callFunction({
      name: 'securityCheck',
      data: { type: 'image', fileID },
      success: (res) => {
        const result = res.result || {}
        if (result.safe === false) {
          wx.showModal({
            title: result.code === -2 ? '图片过大' : '内容违规',
            content: result.msg || '您上传的图片含有违规信息，请更换后重试',
            showCancel: false,
            confirmText: '我知道了'
          })
          resolve(false)
        } else {
          resolve(true)
        }
      },
      fail: () => {
        wx.showToast({ title: '内容审核暂不可用，请稍后重试', icon: 'none' })
        resolve(false)
      }
    })
  })
}

/**
 * 检测文本是否含违规内容
 * @param {string} content - 待检测文本
 * @returns {Promise<boolean>} true=安全，false=违规
 */
function checkText(content) {
  return new Promise((resolve) => {
    if (!content || !content.trim()) {
      resolve(true)
      return
    }

    wx.cloud.callFunction({
      name: 'securityCheck',
      data: { type: 'text', content },
      success: (res) => {
        const result = res.result || {}
        if (result.safe === false) {
          wx.showModal({
            title: '内容违规',
            content: '您发布的内容含有违规信息，请修改后重试',
            showCancel: false,
            confirmText: '我知道了'
          })
          resolve(false)
        } else {
          resolve(true)
        }
      },
      fail: () => {
        wx.showToast({ title: '内容审核暂不可用，请稍后重试', icon: 'none' })
        resolve(false)
      }
    })
  })
}

/**
 * 批量检测多张图片
 * @param {string[]} fileIDs - 云存储文件ID数组
 * @returns {Promise<boolean>} 全部安全=true，任一违规=false
 */
function checkImages(fileIDs) {
  return new Promise((resolve) => {
    if (!fileIDs || fileIDs.length === 0) {
      resolve(true)
      return
    }

    let allSafe = true
    let completed = 0
    let unsafeResult = null
    const total = fileIDs.length

    fileIDs.forEach((fileID) => {
      wx.cloud.callFunction({
        name: 'securityCheck',
        data: { type: 'image', fileID },
        success: (res) => {
          const result = res.result || {}
          if (result.safe === false) {
            allSafe = false
            unsafeResult = unsafeResult || result
          }
        },
        fail: () => {
          allSafe = false
          unsafeResult = unsafeResult || { msg: '内容审核暂不可用，请稍后重试' }
        },
        complete: () => {
          completed++
          if (completed === total) {
            if (!allSafe) {
              wx.showModal({
                title: unsafeResult && unsafeResult.code === -2 ? '图片过大' : '内容违规',
                content: (unsafeResult && unsafeResult.msg) || '您上传的图片中含有违规内容，请更换后重试',
                showCancel: false,
                confirmText: '我知道了'
              })
            }
            resolve(allSafe)
          }
        }
      })
    })
  })
}

module.exports = {
  compressImageForAudit,
  checkImage,
  checkText,
  checkImages
}
