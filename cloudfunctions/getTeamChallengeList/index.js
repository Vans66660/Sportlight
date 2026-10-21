const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { mode = 'public', teamId = '' } = event
  try {
    let query
    if (teamId) query = db.collection('teamChallenges').where({ teamIds: db.command.all([teamId]) })
    else query = db.collection('teamChallenges').where({ visibility: mode === 'direct' ? 'direct' : 'public', status: 'open' })
    const res = await query.orderBy('createdAt', 'desc').limit(50).get()
    return { code: 0, data: res.data || [] }
  } catch (e) {
    return { code: 0, data: [], msg: e.message }
  }
}
