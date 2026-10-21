// 营业执照 OCR 识别云函数
// 使用腾讯云 OCR BizLicense 接口自动识别营业执照信息
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function getFieldValue(source, keys) {
  if (!source) return ''
  if (Array.isArray(source)) {
    const item = source.find(entry => keys.includes(entry.Name) || keys.includes(entry.Key) || keys.includes(entry.Item))
    return item ? String(item.Value || item.Text || '').trim() : ''
  }
  for (const key of keys) {
    const value = source[key]
    if (value && typeof value === 'object') return String(value.Value || value.Text || '').trim()
    if (value) return String(value).trim()
  }
  return ''
}

exports.main = async (event, context) => {
  const { fileID } = event
  if (!fileID) return { code: -1, msg: '缺少 fileID' }
  if (!process.env.TENCENT_SECRET_ID || !process.env.TENCENT_SECRET_KEY) {
    return { code: -1, msg: '营业执照识别服务未配置密钥' }
  }

  try {
    // 1. 从云存储下载营业执照图片
    const downloadRes = await cloud.downloadFile({ fileID })
    const buffer = downloadRes.fileContent

    if (!buffer || buffer.length === 0) {
      return { code: -1, msg: '图片下载失败' }
    }

    // 图片转 base64（腾讯云 OCR 要求）
    const base64 = buffer.toString('base64')

    // 2. 调用腾讯云 OCR 营业执照识别
    const tencentcloud = require('tencentcloud-sdk-nodejs-ocr')
    const OcrClient = tencentcloud.ocr.v20181119.Client

    const client = new OcrClient({
      credential: {
        secretId: process.env.TENCENT_SECRET_ID || '',
        secretKey: process.env.TENCENT_SECRET_KEY || ''
      },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'ocr.tencentcloudapi.com' } }
    })

    const result = await client.BizLicenseOCR({
      ImageBase64: base64
    })

    // 3. 提取识别结果
    const info = result.BizLicenseInfos || result
    const data = {
      companyName: getFieldValue(info, ['Name', 'CompanyName', 'EntName', '名称', '企业名称']),
      creditCode: getFieldValue(info, ['RegNum', 'CreditCode', 'SocialCreditCode', '统一社会信用代码', '注册号', '信用代码']),
      legalPerson: getFieldValue(info, ['Person', 'LegalPerson', '法定代表人', '法人']),
      address: getFieldValue(info, ['Address', '住所', '地址']),
      capital: getFieldValue(info, ['Capital', '注册资本']),
      business: getFieldValue(info, ['Business', '经营范围']),
      period: getFieldValue(info, ['Period', '营业期限'])
    }

    if (!data.companyName || !data.creditCode) {
      return { code: -1, msg: '未识别到营业执照核心信息' }
    }

    return {
      code: 0,
      msg: '识别成功',
      data
    }
  } catch (e) {
    console.error('OCR error:', e)
    return { code: -1, msg: '识别失败: ' + (e.message || '未知错误') }
  }
}
