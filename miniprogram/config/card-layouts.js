/**
 * 「橙场」基础赛事卡构图预设
 *
 * 所有坐标均为 0-1 归一化坐标，渲染时乘以实际画布宽高。
 * 卡片基准比例为 63:88；建议高清输出 1260 x 1760。
 * 卡面背景、信息布局和卡背共用，仅人物构图区分半身/全身。
 */

const ORANGE_FIELD_BASE = {
  templateId: 'orange-field-event-01',
  templateName: '橙场·基础赛事卡',
  templateVersion: 1,
  rendererVersion: 'unified-layout-2',
  aspectRatio: 63 / 88,
  canvas: { width: 1260, height: 1760 },
  assets: {
    front: '/images/cards/card-front-orange-field.jpg',
    back: '/images/cards/card-back-orange-field.jpg'
  },

  // 正面固定信息位置
  front: {
    // 人物只能显示在卡面中央的内框中。预览页和最终画布必须共用
    // 这一组归一化坐标，否则人物会在生成时越过白边或发生二次裁切。
    playerViewport: {
      x: 0.160, y: 0.180, width: 0.680, height: 0.585
    },
    logo: { x: 0.06, y: 0.05, width: 0.20, align: 'left' },
    displayName: {
      x: 0.50, y: 0.850, maxWidth: 0.48,
      fontSize: 0.050, minFontSize: 0.035,
      color: '#172235', weight: 800, maxLines: 1
    },
    teamName: {
      x: 0.50, y: 0.810, maxWidth: 0.46,
      fontSize: 0.024, minFontSize: 0.018,
      color: '#B58A3A', weight: 700, maxLines: 1
    },
    primaryPosition: {
      x: 0.50, y: 0.890, maxWidth: 0.20,
      fontSize: 0.021, color: '#FF641E', weight: 700, maxLines: 1
    }
  },

  // 卡背固定信息位置，两种人物构图完全共用
  back: {
    eventName: {
      x: 0.07, y: 0.075, maxWidth: 0.78,
      fontSize: 0.034, minFontSize: 0.024,
      color: '#FFFFFF', weight: 800, maxLines: 1
    },
    matchSummary: { x: 0.50, y: 0.31, width: 0.84, align: 'center' },
    matchDate: {
      x: 0.50, y: 0.405,
      fontSize: 0.022, color: '#7D8794', weight: 500, align: 'center'
    },
    featuredStats: [
      { x: 0.235, y: 0.705, width: 0.22 },
      { x: 0.500, y: 0.705, width: 0.22 },
      { x: 0.765, y: 0.705, width: 0.22 }
    ],
    certification: { x: 0.07, y: 0.915, width: 0.36, align: 'left' },
    cardId: { x: 0.93, y: 0.915, width: 0.38, align: 'right' }
  },

  // 任何人物都不能侵入的固定区域
  protectedZones: [
    { id: 'brand', x: 0.04, y: 0.03, width: 0.25, height: 0.11 },
    { id: 'identity', x: 0.04, y: 0.69, width: 0.52, height: 0.21 }
  ],

  renderOrder: [
    'frontBackground',
    'rearDecoration',
    'playerCutout',
    'frontForeground',
    'identityText',
    'brandMark'
  ]
}

const COMPOSITION_PRESETS = {
  half: {
    id: 'half',
    name: '半身构图',
    acceptedCrop: ['chest', 'waist', 'thigh'],

    // 人脸优先对齐；人物素材本身允许胸口、腰部或大腿处被截断。
    anchor: { x: 0.575, eyeY: 0.215 },
    targetBounds: {
      centerX: 0.575,
      top: 0.055,
      bottom: 0.955,
      maxWidth: 0.76
    },
    scale: { default: 1.18, min: 0.88, max: 1.58 },
    offset: {
      defaultX: 0.025, defaultY: 0,
      minX: -0.13, maxX: 0.16,
      minY: -0.12, maxY: 0.13
    },
    shoulderWidth: { preferred: 0.64, max: 0.78 },
    foregroundMask: {
      startY: 0.835,
      feather: 0.035,
      mode: 'fade-and-cover'
    },
    safeFaceZone: { x: 0.30, y: 0.07, width: 0.52, height: 0.30 },
    // 与 card-image-setup.wxss 中旧版人物层的几何位置一致。
    // 现在由 JS 和生成器共同读取，不再维护两套魔法数字。
    layer: { x: 0.14, y: 0.16, width: 0.72, height: 0.58 }
  },

  full: {
    id: 'full',
    name: '全身构图',
    acceptedCrop: ['knees', 'calves', 'full_body'],

    // 全身优先保证头顶和脚底，同时让人物略偏右给左下信息留白。
    anchor: { x: 0.595, eyeY: 0.195 },
    targetBounds: {
      centerX: 0.595,
      top: 0.055,
      bottom: 0.955,
      maxWidth: 0.61
    },
    scale: { default: 1.00, min: 0.78, max: 1.32 },
    offset: {
      defaultX: 0.045, defaultY: 0,
      minX: -0.12, maxX: 0.17,
      minY: -0.09, maxY: 0.09
    },
    shoulderWidth: { preferred: 0.48, max: 0.62 },
    foregroundMask: {
      startY: 0.915,
      feather: 0.015,
      mode: 'cover-feet'
    },
    safeFaceZone: { x: 0.37, y: 0.06, width: 0.45, height: 0.27 },
    layer: { x: 0.20, y: 0.19, width: 0.60, height: 0.56 }
  }
}

function numberOr(value, fallback) {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

/**
 * 计算人物 PNG 在最终卡面上的实际绘制矩形。
 *
 * 算法等价于小程序预览中的：
 * 固定人物层 + image aspectFit + 以中心缩放 + 归一化位移。
 * sourceWidth/sourceHeight 包含腾讯云 PNG 的透明画布，确保精修前后构图不跳动。
 */
function getPortraitDrawRect(options = {}) {
  const canvasWidth = Math.max(1, numberOr(options.canvasWidth, ORANGE_FIELD_BASE.canvas.width))
  const canvasHeight = Math.max(1, numberOr(options.canvasHeight, ORANGE_FIELD_BASE.canvas.height))
  const sourceWidth = Math.max(1, numberOr(options.sourceWidth, 1))
  const sourceHeight = Math.max(1, numberOr(options.sourceHeight, 1))
  const mode = options.compositionMode === 'full' ? 'full' : 'half'
  const preset = COMPOSITION_PRESETS[mode]
  const layer = preset.layer
  const scale = Math.min(preset.scale.max, Math.max(
    preset.scale.min,
    numberOr(options.scale, preset.scale.default)
  ))
  const offsetX = Math.min(preset.offset.maxX, Math.max(
    preset.offset.minX,
    numberOr(options.offsetX, preset.offset.defaultX)
  ))
  const offsetY = Math.min(preset.offset.maxY, Math.max(
    preset.offset.minY,
    numberOr(options.offsetY, preset.offset.defaultY)
  ))

  const boxWidth = canvasWidth * layer.width
  const boxHeight = canvasHeight * layer.height
  const sourceRatio = sourceWidth / sourceHeight
  const boxRatio = boxWidth / boxHeight
  let fittedWidth
  let fittedHeight
  if (sourceRatio >= boxRatio) {
    fittedWidth = boxWidth
    fittedHeight = boxWidth / sourceRatio
  } else {
    fittedHeight = boxHeight
    fittedWidth = boxHeight * sourceRatio
  }

  const width = fittedWidth * scale
  const height = fittedHeight * scale
  const centerX = canvasWidth * (layer.x + layer.width / 2 + offsetX)
  const centerY = canvasHeight * (layer.y + layer.height / 2 + offsetY)
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    centerX,
    centerY,
    scale,
    offsetX,
    offsetY
  }
}

function getPlayerViewport(canvasWidth, canvasHeight) {
  const viewport = ORANGE_FIELD_BASE.front.playerViewport
  return {
    x: viewport.x * canvasWidth,
    y: viewport.y * canvasHeight,
    width: viewport.width * canvasWidth,
    height: viewport.height * canvasHeight
  }
}

function getOrangeFieldLayout(compositionMode = 'half') {
  const mode = compositionMode === 'full' ? 'full' : 'half'
  return {
    ...ORANGE_FIELD_BASE,
    compositionMode: mode,
    player: COMPOSITION_PRESETS[mode]
  }
}

module.exports = {
  ORANGE_FIELD_BASE,
  COMPOSITION_PRESETS,
  getOrangeFieldLayout,
  getPortraitDrawRect,
  getPlayerViewport
}
