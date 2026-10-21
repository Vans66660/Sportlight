const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function normalizeNickname(value, sportlightId) {
  const text = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24)
  return text || `用户${sportlightId || ''}`
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const profileData = event.profileData || {}

  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
    const user = userRes.data[0] || {}
    const athleteRes = await db.collection('athletes').where({ openid: OPENID }).limit(1).get()
    const athlete = athleteRes.data[0] || {}
    const sportlightId = user.sportlightId || athlete.sportlightId || ''
    const currentName = athlete.identityName || athlete.name || user.name || ''
    const nickname = normalizeNickname(profileData.nickname || athlete.nickname || user.nickname, sportlightId)

    await db.collection('users').where({ openid: OPENID }).update({
      data: {
        name: currentName,
        nickname,
        displayName: nickname,
        photo: profileData.photo || user.photo || '',
        gender: profileData.gender || '',
        sport: profileData.sport || '',
        position: profileData.position || '',
        city: profileData.city || '',
        affiliation: profileData.affiliation || '',
        phone: profileData.phone || user.phone || '',
        phoneVerified: profileData.phoneVerified !== undefined ? !!profileData.phoneVerified : !!user.phoneVerified,
        updatedAt: db.serverDate()
      }
    })

    await db.collection('athletes')
  .where({ openid: OPENID })
	.update({
	    data: {
	      name: currentName,
	      sportlightId,
      nickname,
      displayName: nickname,
      photo: profileData.photo,
      gender: profileData.gender || '',
      sport: profileData.sport,
      position: profileData.position,
      height: profileData.height || '',
      weight: profileData.weight || '',
      wingspan: profileData.wingspan || '',
      preferredFoot: profileData.preferredFoot || '',
      preferredHand: profileData.preferredHand || '',
      city: profileData.city,
      affiliation: profileData.affiliation,
      acceptMatch: profileData.acceptMatch,
      acceptAd: false,
      matchPrice: profileData.matchPrice,
      adPrice: 0,
      socials: [],
      videoUploaded: profileData.videoUploaded || false,
      videoName: profileData.videoName || '',
      videoFile: profileData.videoFile || '',
      certUploaded: profileData.certUploaded || false,
      certName: profileData.certName || '',
      certFiles: profileData.certFiles || [],
      highlights: profileData.highlights || [],
      updatedAt: db.serverDate()
    }
  })

    return { code: 0, msg: 'success' }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
