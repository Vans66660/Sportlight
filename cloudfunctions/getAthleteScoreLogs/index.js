const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function sportText(sport) {
  if (sport === 'basketball') return '篮球'
  if (sport === 'badminton') return '羽毛球'
  return '足球'
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const athleteOpenid = (event && event.openid) || OPENID
  if (!athleteOpenid) return { code: -1, msg: 'openid 缺失' }

  try {
    const res = await db.collection('competitionScoreLogs')
      .where({ athleteOpenid })
      .orderBy('createdAtMs', 'desc')
      .limit(5)
      .get()

    const data = (res.data || []).map(log => {
      const resultScore = Math.round(Number(log.visibleResultScore) || 0)
      const personalScore = Math.round(Number(log.visiblePersonalScore) || 0)
      const delta = Math.round(Number(log.delta) || 0)
      const rawTotal = resultScore + personalScore
      return {
      _id: log._id,
      eventTitle: log.eventTitle || '公开赛',
      matchTitle: log.matchTitle || '',
      matchTime: log.matchTime || '',
      seasonId: log.seasonId || '',
      sport: sportText(log.sport),
      result: log.result || '',
      resultText: log.result === 'win' ? '胜' : log.result === 'draw' ? '平' : '负',
      resultScore,
      personalScore,
      delta,
      deltaText: `${delta >= 0 ? '+' : ''}${delta}`,
      rawTotal,
      rawTotalText: `${rawTotal >= 0 ? '+' : ''}${rawTotal}`,
      capped: rawTotal !== delta,
      formulaVersion: log.formulaVersion || '',
      preMatchScore: Number(log.preMatchScore) || 0,
      preMatchTier: log.preMatchTier || '',
      recordedByOpenid: log.recordedByOpenid || '',
      recordedAtMs: Number(log.recordedAtMs) || 0
      }
    })

    return { code: 0, data }
  } catch (e) {
    const msg = e && (e.message || e.errMsg || '')
    if (msg.includes('collection not exists') || msg.includes('DATABASE_COLLECTION_NOT_EXIST')) {
      return { code: 0, data: [] }
    }
    return { code: -1, msg: e.message }
  }
}
