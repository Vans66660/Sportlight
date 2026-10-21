const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

async function getAthleteProfiles(openids) {
  const ids = [...new Set((openids || []).filter(Boolean))]
  if (ids.length === 0) return []

  const athleteRes = await db.collection('athletes')
    .where({ openid: db.command.in(ids) })
    .get()

  const foundOpenids = athleteRes.data.map(a => a.openid)
  const missingOpenids = ids.filter(id => !foundOpenids.includes(id))
  let combined = athleteRes.data

  if (missingOpenids.length > 0) {
    const userRes = await db.collection('users')
      .where({ openid: db.command.in(missingOpenids) })
      .get()

    const fallback = userRes.data.map(u => ({
      openid: u.openid,
      name: u.name || '未命名球员',
      photo: '',
      rank: 'D',
      sport: '-',
      city: u.city || '-',
      affiliation: ''
    }))
    combined = [...combined, ...fallback]
  }

  const profileMap = {}
  combined.forEach(item => { profileMap[item.openid] = item })
  return ids.map(id => profileMap[id]).filter(Boolean)
}

function enrichProfiles(list) {
  const repLevel = (s) => {
    const n = s || 80
    if (n >= 90) return 'great'
    if (n >= 75) return 'good'
    if (n >= 60) return 'ok'
    return 'bad'
  }
  return list.map(a => ({
    ...a,
    rank: normalizeTier(a.currentTier || a.rank),
    age: calcAge(a.birthDate, a.age),
    reputation: a.reputation || 80,
    reputationLevel: repLevel(a.reputation)
  }))
}

exports.main = async (event, context) => {
  const { orderId } = event

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data

    console.log('applicants array:', JSON.stringify(order.applicants))

    // 老板查看报名者时，清除新报名提醒
    if (order.newApplicantsCount > 0) {
      await db.collection('orders').doc(orderId).update({
        data: { newApplicantsCount: 0 }
      })
    }

    const applicants = order.applicants || []
    const rejectedApplicants = order.rejectedApplicants || []
    if (applicants.length === 0 && rejectedApplicants.length === 0) {
      return { code: 0, data: { applicants: [], rejectedApplicants: [] } }
    }

    const [pendingProfiles, rejectedProfiles] = await Promise.all([
      getAthleteProfiles(applicants),
      getAthleteProfiles(rejectedApplicants)
    ])

    console.log('athletes found:', pendingProfiles.length + rejectedProfiles.length)

    return {
      code: 0,
      data: {
        applicants: enrichProfiles(pendingProfiles),
        rejectedApplicants: enrichProfiles(rejectedProfiles)
      }
    }
  } catch (e) {
    console.error('getApplicants error:', e)
    return { code: -1, msg: e.message }
  }
}
