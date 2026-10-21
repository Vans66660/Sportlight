const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  try {
    // 查找所有没有 reputation 字段的运动员
    const res = await db.collection('athletes')
      .where({ reputation: _.exists(false) })
      .limit(100)
      .get()

    const athletes = res.data
    if (athletes.length === 0) {
      return { code: 0, msg: '所有运动员已有信誉分，无需迁移', updated: 0 }
    }

    for (const athlete of athletes) {
      await db.collection('athletes').doc(athlete._id).update({
        data: { reputation: 80 }
      })
    }

    return { code: 0, msg: `已初始化 ${athletes.length} 名运动员的信誉分`, updated: athletes.length }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
