const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function initials(name) {
  const text = String(name || '').trim()
  return text ? text.slice(0, 1) : '队'
}

exports.main = async (event) => {
  const { sport = '', skip = 0, limit = 20 } = event
  try {
    const condition = sport ? { status: 'active', sport } : { status: 'active' }
    const query = db.collection('teams').where(condition)
    const res = await query.orderBy('updatedAt', 'desc').skip(Number(skip) || 0).limit(Math.min(Number(limit) || 20, 50)).get()
    return {
      code: 0,
      data: (res.data || []).map(team => ({
        _id: team._id,
        name: team.name || '',
        logoText: initials(team.name),
        sport: team.sport || '',
        logo: team.logo || '',
        cover: team.cover || '',
        description: team.description || '',
        recruitmentStatus: team.recruitmentStatus || 'open',
        memberCount: (team.members || []).length || (team.memberOpenids || []).length || 0,
        averageScore: Math.round(team.averageScore || 0),
        venues: team.venues || []
      }))
    }
  } catch (e) {
    return { code: 0, data: [], msg: e.message }
  }
}
