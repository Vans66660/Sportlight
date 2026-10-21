/**
 * Sportlight ID 通用工具
 * 被 login/index.js 和 saveUser/index.js 共用
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function ensureCollection(name) {
  try { await db.createCollection(name) } catch (e) {}
}

function formatSportlightId(n) {
  const seq = Math.max(1, Number(n) || 1)
  return `SL${String(10000000 + seq).padStart(8, '0')}`
}

function normalizeSportlightId(id) {
  const text = String(id || '').trim().toUpperCase()
  if (/^SL\d{8}$/.test(text)) return text
  if (/^\d{8}$/.test(text)) return `SL${String(10000000 + Number(text)).padStart(8, '0')}`
  return ''
}

async function isSportlightIdAvailable(sportlightId, ownerOpenid = '') {
  const [userRes, athleteRes, registryRes] = await Promise.all([
    db.collection('users').where({ sportlightId }).limit(2).get().catch(() => ({ data: [] })),
    db.collection('athletes').where({ sportlightId }).limit(2).get().catch(() => ({ data: [] })),
    db.collection('sportlightIds').doc(sportlightId).get().catch(() => ({ data: null }))
  ])
  const docs = [...(userRes.data || []), ...(athleteRes.data || [])]
  if (!docs.every(doc => ownerOpenid && doc.openid === ownerOpenid)) return false
  const reg = registryRes.data
  return !reg || !reg.openid || reg.openid === ownerOpenid
}

async function reserveSportlightId(sportlightId, ownerOpenid) {
  await ensureCollection('sportlightIds')
  if (!await isSportlightIdAvailable(sportlightId, ownerOpenid)) return false
  await db.collection('sportlightIds').doc(sportlightId).set({
    data: { sportlightId, openid: ownerOpenid, updatedAt: db.serverDate() }
  })
  return true
}

async function nextSportlightId(ownerOpenid) {
  await ensureCollection('platformCounters')
  await ensureCollection('sportlightIds')
  for (let i = 0; i < 100; i++) {
    try {
      const updateRes = await db.collection('platformCounters').doc('sportlightUser').update({
        data: { seq: _.inc(1), updatedAt: db.serverDate() }
      })
      if (!updateRes.stats || updateRes.stats.updated === 0) {
        await db.collection('platformCounters').doc('sportlightUser').set({
          data: { seq: 1, updatedAt: db.serverDate() }
        })
      }
    } catch (e) {
      await db.collection('platformCounters').doc('sportlightUser').set({
        data: { seq: 1, updatedAt: db.serverDate() }
      })
    }
    const res = await db.collection('platformCounters').doc('sportlightUser').get()
    const id = formatSportlightId(res.data.seq)
    if (await reserveSportlightId(id, ownerOpenid)) return id
  }
  throw new Error('Sport Light ID 生成失败，请稍后重试')
}

async function ensureSportlightId(openid, user) {
  const existing = normalizeSportlightId(user && user.sportlightId)
  const sportlightId = existing && await reserveSportlightId(existing, openid)
    ? existing
    : await nextSportlightId(openid)
  await db.collection('users').where({ openid }).update({
    data: { sportlightId, updatedAt: db.serverDate() }
  })
  await db.collection('athletes').where({ openid }).update({
    data: { sportlightId, updatedAt: db.serverDate() }
  }).catch(() => null)
  return sportlightId
}

module.exports = {
  ensureCollection,
  formatSportlightId,
  normalizeSportlightId,
  isSportlightIdAvailable,
  reserveSportlightId,
  nextSportlightId,
  ensureSportlightId
}
