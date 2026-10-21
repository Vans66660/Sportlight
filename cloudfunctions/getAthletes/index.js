const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function calcAge(birthDate, fallbackAge) {
  if (!birthDate) return fallbackAge || ''
  const birth = new Date(String(birthDate).replace(/-/g, '/'))
  if (Number.isNaN(birth.getTime())) return fallbackAge || ''
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const hasHadBirthday = today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate())
  if (!hasHadBirthday) age -= 1
  return age >= 0 ? age : (fallbackAge || '')
}

function normalizeTier(tier) {
  const value = String(tier || '').trim()
  return !value || value === 'F' || value.startsWith('F') ? 'D' : value
}

exports.main = async (event, context) => {
  const { sport, keyword, page = 0, pageSize = 20 } = event

  try {
    const condition = {}
    if (sport && sport !== '全部') {
      condition.sport = sport
    }

    let result

    if (keyword) {
      // 关键词搜索——匹配名字、城市、院校
      result = await db.collection('athletes')
        .where(
          _.or([
            { name: db.RegExp({ regexp: keyword, options: 'i' }) },
            { city: db.RegExp({ regexp: keyword, options: 'i' }) },
            { affiliation: db.RegExp({ regexp: keyword, options: 'i' }) },
            { sport: db.RegExp({ regexp: keyword, options: 'i' }) }
          ])
        )
        .limit(pageSize)
        .get()
    } else {
      result = await db.collection('athletes')
        .where(condition)
        .skip(page * pageSize)
        .limit(pageSize)
        .orderBy('competitionScore', 'desc')
        .get()
    }

    const repLevel = (s) => {
      const n = s || 80
      if (n >= 90) return 'great'
      if (n >= 75) return 'good'
      if (n >= 60) return 'ok'
      return 'bad'
    }
    const data = result.data.map(a => {
      const rank = normalizeTier(a.currentTier || a.rank)
      const levelReviewStatus = a.levelReviewStatus || 'none'
      const isLevelPending = levelReviewStatus === 'pending'
      return {
        ...a,
        rank,
        rankBase: rank[0] || 'D',
        rankLabel: isLevelPending ? '审核中' : `${rank}级`,
        rankStatusClass: isLevelPending ? 'pending' : (rank[0] || 'D'),
        levelReviewStatus,
        age: calcAge(a.birthDate, a.age),
        reputation: a.reputation || 80,
        reputationLevel: repLevel(a.reputation)
      }
    })
    return { code: 0, data }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
