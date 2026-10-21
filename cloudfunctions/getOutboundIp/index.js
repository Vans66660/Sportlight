const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const endpoints = [
  'https://api.ipify.org?format=json',
  'https://ifconfig.me/ip',
  'https://ipinfo.io/ip'
]

const requestText = (url) => new Promise((resolve, reject) => {
  const req = https.get(url, { timeout: 8000 }, (res) => {
    let body = ''
    res.on('data', chunk => { body += chunk })
    res.on('end', () => resolve({ statusCode: res.statusCode, body: body.trim() }))
  })
  req.on('timeout', () => {
    req.destroy(new Error('request timeout'))
  })
  req.on('error', reject)
})

exports.main = async () => {
  const results = []

  for (const url of endpoints) {
    try {
      const res = await requestText(url)
      let ip = res.body
      try {
        const json = JSON.parse(res.body)
        ip = json.ip || res.body
      } catch (e) {}
      results.push({ url, ok: true, statusCode: res.statusCode, ip })
    } catch (e) {
      results.push({ url, ok: false, error: e.message })
    }
  }

  return {
    code: 0,
    results
  }
}
