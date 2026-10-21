const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function toTempURLs(photos) {
  const cloudPhotos = photos.filter(p => p && p.startsWith('cloud://'))
  if (cloudPhotos.length === 0) return {}
  try {
    const res = await cloud.getTempFileURL({ fileList: cloudPhotos })
    const map = {}
    res.fileList.forEach(f => { if (f.tempFileURL) map[f.fileID] = f.tempFileURL })
    return map
  } catch (e) {
    return {}
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  try {
    const [ordersRes, convsRes, notifMsgRes] = await Promise.all([
      // 主查询：从订单关系推导会话
      db.collection('orders')
        .where(
          _.or([
            { athleteOpenid: OPENID, status: _.in(['locked', 'done', 'cancelled']) },
            { bossOpenid: OPENID, status: _.in(['locked', 'done', 'cancelled']) }
          ])
        )
        .orderBy('updatedAt', 'desc')
        .limit(20)
        .get(),
      // 主查询补充：conversations 集合（精确记录的会话，不依赖状态推导）
      db.collection('conversations')
        .where(_.or([
          { bossOpenid: OPENID },
          { athleteOpenid: OPENID }
        ]))
        .field({ orderId: true, bossOpenid: true, athleteOpenid: true, participants: true, chatKind: true, directChat: true, teamCaptainChat: true, title: true, teamName: true })
        .get(),
      // 消息补充：有 toOpenid 消息但未被以上两路覆盖的边缘情况
      db.collection('messages')
        .where({ toOpenid: OPENID })
        .field({ orderId: true })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
    ])

    const existingIds = new Set(ordersRes.data.map(o => o._id))
    const realOrderPairs = new Set(
      (ordersRes.data || [])
        .filter(o => o.status === 'locked' && !o.directChat && o.bossOpenid && o.athleteOpenid)
        .map(o => `${o.bossOpenid}__${o.athleteOpenid}`)
    )
    const directConvs = (convsRes.data || []).filter(c => {
      if (!(c.directChat || c.chatKind || c.teamCaptainChat)) return false
      const sameRealOrderExists = c.directChat &&
        !c.teamCaptainChat &&
        realOrderPairs.has(`${c.bossOpenid}__${c.athleteOpenid}`)
      return !sameRealOrderExists
    })
    const normalConvIds = (convsRes.data || []).filter(c => !(c.directChat || c.chatKind || c.teamCaptainChat)).map(c => c.orderId)
    const notifOrderIds = [
      ...[...new Set(normalConvIds)],
      ...[...new Set(notifMsgRes.data.map(m => m.orderId))]
    ].filter(id => id && !existingIds.has(id))
    const uniqueExtraIds = [...new Set(notifOrderIds)]

    let extraOrders = []
    if (uniqueExtraIds.length > 0) {
      const extraRes = await db.collection('orders')
        .where({ _id: _.in(uniqueExtraIds) })
        .get()
      extraOrders = extraRes.data
    }

    const directOrders = directConvs.map(c => ({
      _id: c.orderId,
      title: c.title || c.teamName || '聊天',
      type: c.chatKind || 'direct',
      bossOpenid: c.bossOpenid,
      athleteOpenid: c.athleteOpenid,
      directChat: true,
      teamCaptainChat: !!c.teamCaptainChat,
      status: 'open',
      price: 0,
      city: '',
      _directPreview: '点击进入聊天'
    }))

    const orders = [...ordersRes.data, ...extraOrders, ...directOrders]
    if (orders.length === 0) return { code: 0, data: [] }

    const orderIds = orders.map(o => o._id)

    // 收集需要查询的对方 openid
    const bossOpenids = []
    const athleteOpenids = []
    orders.forEach(o => {
      if (o.directChat) {
        const other = o.bossOpenid === OPENID ? o.athleteOpenid : o.bossOpenid
        if (other && !athleteOpenids.includes(other)) athleteOpenids.push(other)
        if (other && !bossOpenids.includes(other)) bossOpenids.push(other)
        return
      }
      if (o.bossOpenid === OPENID) {
        if (!athleteOpenids.includes(o.athleteOpenid)) athleteOpenids.push(o.athleteOpenid)
      } else {
        if (!bossOpenids.includes(o.bossOpenid)) bossOpenids.push(o.bossOpenid)
      }
    })

    // 并行查询对方资料、未读消息、最后一条消息
    const [bossUserRes, bossProfileRes, athleteRes, unreadRes, lastMsgRes] = await Promise.all([
      bossOpenids.length > 0
        ? db.collection('users').where({ openid: _.in(bossOpenids) }).field({ openid: true, name: true, nickname: true, displayName: true, logo: true, avatarUrl: true }).get()
        : Promise.resolve({ data: [] }),
      bossOpenids.length > 0
        ? db.collection('bosses').where({ openid: _.in(bossOpenids) }).field({ openid: true, name: true, nickname: true, displayName: true, logo: true, avatarUrl: true }).get().catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      athleteOpenids.length > 0
        ? db.collection('athletes').where({ openid: _.in(athleteOpenids) }).field({ openid: true, name: true, nickname: true, displayName: true, sportlightId: true, photo: true }).get()
        : Promise.resolve({ data: [] }),
      db.collection('messages').where({ orderId: _.in(orderIds), fromOpenid: _.neq(OPENID), read: false }).field({ orderId: true }).get(),
      db.collection('messages').where({ orderId: _.in(orderIds) }).orderBy('createdAt', 'desc').limit(100).get()
    ])

    const bossMap = {}
    bossUserRes.data.forEach(u => { bossMap[u.openid] = u })
    bossProfileRes.data.forEach(b => { bossMap[b.openid] = { ...(bossMap[b.openid] || {}), ...b } })
    const athleteMap = {}
    athleteRes.data.forEach(a => { athleteMap[a.openid] = a })

    const unreadCounts = {}
    unreadRes.data.forEach(msg => {
      unreadCounts[msg.orderId] = (unreadCounts[msg.orderId] || 0) + 1
    })

    const lastMsgs = {}
    lastMsgRes.data.forEach(msg => {
      if (!lastMsgs[msg.orderId]) lastMsgs[msg.orderId] = msg
    })

    // 收集所有照片用于批量转换 cloud:// URL
    const rawPhotos = []
    orders.forEach(o => {
      if (o.directChat) {
        const other = o.bossOpenid === OPENID ? o.athleteOpenid : o.bossOpenid
        const a = athleteMap[other]
        const b = bossMap[other]
        if (a && a.photo) rawPhotos.push(a.photo)
        else if (b) rawPhotos.push(b.logo || b.avatarUrl || '')
        return
      }
      if (o.bossOpenid === OPENID) {
        const a = athleteMap[o.athleteOpenid]
        if (a && a.photo) rawPhotos.push(a.photo)
      } else {
        const b = bossMap[o.bossOpenid]
        if (b) rawPhotos.push(b.logo || b.avatarUrl || '')
      }
    })
    const tempMap = await toTempURLs(rawPhotos)

    const resolve = (url) => tempMap[url] || url || ''

    const result = orders.map(o => {
      const isBoss = o.bossOpenid === OPENID
      let otherName = ''
      let otherPhoto = ''

      if (isBoss) {
        const a = athleteMap[o.athleteOpenid]
        const b = bossMap[o.athleteOpenid]
        if (a) { otherName = a.displayName || a.nickname || a.name || ''; otherPhoto = resolve(a.photo) }
        else if (b) { otherName = b.displayName || b.nickname || b.name || ''; otherPhoto = resolve(b.logo || b.avatarUrl || '') }
      } else {
        if (o.directChat) {
          const a = athleteMap[o.bossOpenid]
          const b = bossMap[o.bossOpenid]
          if (a) { otherName = a.displayName || a.nickname || a.name || ''; otherPhoto = resolve(a.photo) }
          else if (b) { otherName = b.displayName || b.nickname || b.name || ''; otherPhoto = resolve(b.logo || b.avatarUrl || '') }
        } else {
          const b = bossMap[o.bossOpenid]
          if (b) { otherName = b.displayName || b.nickname || b.name || ''; otherPhoto = resolve(b.logo || b.avatarUrl || '') }
        }
      }

      const statusLabelMap = { open: '招募中', locked: '进行中', done: '已完成', cancelled: '已取消' }
      return {
        ...o,
        otherName,
        otherPhoto,
        statusLabel: o.directChat ? '沟通中' : (statusLabelMap[o.status] || ''),
        unreadCount: unreadCounts[o._id] || 0,
        lastMsg: lastMsgs[o._id] ? lastMsgs[o._id].content : (o.directChat ? o._directPreview || '点击进入聊天' : ''),
        lastMsgTime: lastMsgs[o._id] ? new Date(lastMsgs[o._id].createdAt).getTime() : 0,
        pinned: o.status === 'locked'
      }
    })

    // 进行中的订单置顶，其余按最后消息时间排序
    result.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return b.lastMsgTime - a.lastMsgTime
    })

    return { code: 0, data: result }
  } catch (e) {
    return { code: -1, msg: e.message }
  }
}
