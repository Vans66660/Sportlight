const cloud = require('wx-server-sdk')
const Jimp = require('jimp')
const path = require('path')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const W = 1260, H = 1760
const VP = { x: 194, y: 306, w: 872, h: 1074 }

// 人物层参数（compositionPresets）
const P = {
  half: { lx: 0.05, ly: 0.04, lw: 0.90, lh: 0.88, sDef: 1.18, sMin: 0.88, sMax: 1.58, oxDef: 0.025, oyDef: 0, oxMin: -0.13, oxMax: 0.16, oyMin: -0.12, oyMax: 0.13 },
  full: { lx: 0.12, ly: 0.06, lw: 0.76, lh: 0.82, sDef: 1.0, sMin: 0.78, sMax: 1.32, oxDef: 0.045, oyDef: 0, oxMin: -0.12, oxMax: 0.17, oyMin: -0.09, oyMax: 0.09 },
}

function dl(fid) {
  if (!fid || !String(fid).startsWith('cloud://')) return null
  return cloud.downloadFile({ fileID: fid }).then(r => r.fileContent).catch(() => null)
}

// 计算肖像在 viewport 中的可见区域（直接从源图裁剪）
function calcCrop(srcW, srcH, opts) {
  const mode = opts.compositionMode === 'full' ? 'full' : 'half'
  const p = P[mode]
  const sc = Math.min(p.sMax, Math.max(p.sMin, Number(opts.scale) || p.sDef))
  const ox = Math.min(p.oxMax, Math.max(p.oxMin, Number(opts.offsetX) || p.oxDef))
  const oy = Math.min(p.oyMax, Math.max(p.oyMin, Number(opts.offsetY) || p.oyDef))
  const boxW = W * p.lw, boxH = H * p.lh
  const srcR = srcW / srcH, boxR = boxW / boxH
  let fw, fh
  if (srcR >= boxR) { fw = boxW; fh = boxW / srcR } else { fh = boxH; fw = boxH * srcR }
  const dw = fw * sc, dh = fh * sc
  const cx = W * (p.lx + p.lw / 2 + ox), cy = H * (p.ly + p.lh / 2 + oy)
  // 肖像绘制区域
  const dx = cx - dw / 2, dy = cy - dh / 2
  // 与 viewport 重叠区域
  const ox2 = Math.max(dx, VP.x), oy2 = Math.max(dy, VP.y)
  const ox3 = Math.min(dx + dw, VP.x + VP.w), oy3 = Math.min(dy + dh, VP.y + VP.h)
  if (ox2 >= ox3 || oy2 >= oy3) return null
  const s = srcW / dw
  return {
    srcX: Math.round((ox2 - dx) * s), srcY: Math.round((oy2 - dy) * s),
    srcW: Math.round((ox3 - ox2) * s), srcH: Math.round((oy3 - oy2) * s),
    dstW: Math.round(ox3 - ox2), dstH: Math.round(oy3 - oy2),
  }
}

// 写入彩色文字：先写白色 → 再替换像素为目标颜色
async function coloredText(img, text, x, y, fontSize, hexColor) {
  if (!text) return
  const txt = String(text)
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE)
  const tw = Jimp.measureText(font, txt)
  const th = Jimp.measureTextHeight(font, txt, tw) + 4
  const pad = Math.max(4, Math.round(fontSize / 8))
  const tw2 = Math.max(1, Math.round(tw + pad * 2))
  const th2 = Math.max(1, th)
  const temp = new Jimp(tw2, th2, 0x00000000)
  temp.print(font, pad, 2, txt)
  // 染色
  const tr = parseInt(hexColor.slice(1,3), 16)
  const tg = parseInt(hexColor.slice(3,5), 16)
  const tb = parseInt(hexColor.slice(5,7), 16)
  // 如果颜色是深色（亮度 < 128），增强对比度
  const bright = (tr * 299 + tg * 587 + tb * 114) / 1000
  const threshold = bright < 128 ? 80 : 200
  temp.scan(0, 0, tw2, th2, function(xx, yy, idx) {
    const r = this.bitmap.data[idx], g = this.bitmap.data[idx+1], b = this.bitmap.data[idx+2], a = this.bitmap.data[idx+3]
    if (a > 100 && r > threshold && g > threshold && b > threshold) {
      this.bitmap.data[idx] = tr
      this.bitmap.data[idx+1] = tg
      this.bitmap.data[idx+2] = tb
    }
  })
  img.composite(temp, Math.round(x - tw2 / 2), Math.round(y - th2 / 2))
}

exports.main = async (event) => {
  try {
    const cd = event.cardData || {}
    if (!cd.portraitFileID) return { code: -1, msg: 'no portrait' }
    const [pb, ob] = await Promise.all([dl(cd.portraitFileID), dl((cd.matchSnapshot || {}).organizerAvatar)])

    // ── 正面 ──
    const front = await Jimp.read(path.join(__dirname, 'card-front-orange-field.jpg'))
    if (pb) {
      try {
        const p = await Jimp.read(pb)
        const cr = calcCrop(p.bitmap.width, p.bitmap.height, cd.portraitOpts || {})
        if (cr && cr.srcW > 4 && cr.srcH > 4) {
          p.crop(cr.srcX, cr.srcY, cr.srcW, cr.srcH)
          p.resize(cr.dstW, cr.dstH)
          front.composite(p, VP.x, VP.y)
        }
      } catch (e) { console.error('portrait err', e) }
    }
    // logo
    if (ob) {
      try {
        const o = await Jimp.read(ob); o.resize(112, 112)
        const m = new Jimp(112, 112, 0)
        m.scan(0,0,112,112,function(xx,yy,idx){if(Math.sqrt((xx-56)*(xx-56)+(yy-56)*(yy-56))>56)this.bitmap.data[idx+3]=0})
        o.mask(m,0,0); const r = new Jimp(120,120,0xFFFFFFFF); r.composite(o,4,4)
        front.composite(r, 1260-120-76, 76)
      } catch(e){}
    }
    // 正面文字 — 从 canvas drawFront 精确翻译
    const snap = cd.playerSnapshot || {}
    // teamName: canvas 315,715 (630x880) → 2x: 630,1430 (1260x1760)
    await coloredText(front, snap.teamName, 630, 1430, 30, '#B58A3A')
    // displayName: canvas 315,750 → 2x: 630,1500
    await coloredText(front, cd.playerName, 630, 1500, 32, '#172235')
    // position: canvas 315,780 → 2x: 630,1560
    await coloredText(front, snap.position, 630, 1560, 28, '#FF641E')

    // ── 背面 ──
    const back = await Jimp.read(path.join(__dirname, 'card-back-orange-field.jpg'))
    const match = cd.matchSnapshot || {}
    const hs = match.homeScore, aw = match.awayScore
    const hasScore = hs !== undefined && hs !== null && aw !== undefined && aw !== null
    const home = match.homeTeamName || match.home_team_name || 'HOME'
    const away = match.awayTeamName || match.away_team_name || 'AWAY'
    const summary = hasScore ? (home + '  ' + hs + ' : ' + aw + '  ' + away) : (home + '  VS  ' + away)
    const score = cd.scoreSnapshot || {}
    const delta = Number(score.delta) || Number(score.eventScore) || 0
    const fb = [{ v: delta, l: 'SCORE' }, { v: hasScore ? (match.result || 'OK').toUpperCase() : 'DONE', l: '' }, { v: 1, l: 'GAME' }]
    const st = (cd.stats || []).slice(0, 3)
    const items = st.length >= 3 ? st : (st.length ? st.concat(fb).slice(0, 3) : fb)
    const dateStr = (match.matchTime || match.eventDate || '').replace(/-/g, '.')
    // 背面文字 — 从 canvas drawBack 精确翻译
    // eventName: canvas 315,275 → 2x: 630,550
    await coloredText(back, match.eventTitle, 630, 550, 32, '#173451')
    // summary: canvas 315,371 → 2x: 630,742
    await coloredText(back, summary, 630, 742, 32, '#173451')
    // date: canvas 315,405 → 2x: 630,810
    if (dateStr) await coloredText(back, dateStr, 630, 810, 30, '#7A8490')
    // stats: canvas xs=[210,315,420], yValue=610 yLabel=644 → 2x: xs=[420,630,840], yVal=1220 yLbl=1288
    const xs = [420, 630, 840]
    for (let i = 0; i < Math.min(3, items.length); i++) {
      const val = items[i].value !== undefined && items[i].value !== null && items[i].value !== '' ? String(items[i].value) : ''
      if (val) await coloredText(back, val, xs[i], 1220, 62, '#F0641E')
      if (items[i].label) await coloredText(back, String(items[i].label), xs[i], 1288, 28, '#526173')
    }
    // cardId: canvas 315,755 → 2x: 630,1510
    if (cd.cardId) await coloredText(back, cd.cardId, 630, 1510, 30, '#173451')

    const sid = String(cd.cardId || cd._id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_')
    const ts = Date.now()
    const [fu, bu] = await Promise.all([
      cloud.uploadFile({ cloudPath: 'player-cards/' + sid + '/' + ts + '_f.jpg', fileContent: await front.getBufferAsync(Jimp.MIME_JPEG) }),
      cloud.uploadFile({ cloudPath: 'player-cards/' + sid + '/' + ts + '_b.jpg', fileContent: await back.getBufferAsync(Jimp.MIME_JPEG) }),
    ])
    return { code: 0, frontImage: fu.fileID, backImage: bu.fileID }
  } catch (e) {
    console.error('error', e)
    return { code: -1, msg: e.message || 'failed' }
  }
}
