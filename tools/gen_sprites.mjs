/**
 * 把 SPR 字符网格烘成 PNG，输出到 src/common/sprites/。
 *
 *   node tools/gen_sprites.mjs
 *
 * 精灵数据仍然写在 src/pages/fishing/fishing.ux 里（唯一真源），
 * 这里只负责"打点成图"，并校验 ux 里的钓具尺寸常量与包围盒一致。
 */
import fs from 'fs'
import path from 'path'
import { gridToPng, rigToPng, buildRig, mirrorRects, styled, canvas, rect, writePng } from './pixel.js'
import { STARS, STAR_PAL } from '../src/common/star.js'

const root = path.resolve(import.meta.dirname, '..')
const UX = path.join(root, 'src/pages/fishing/fishing.ux')
const OUT = path.join(root, 'src/common/sprites')
const ux = fs.readFileSync(UX, 'utf8')

/* ---------------- 从 ux 抽取数据 ---------------- */
const iConst = ux.indexOf('const DESIGN_W')
const iScene = ux.indexOf('/* ---------------- 每张地图的场景装饰')
const iPage = ux.indexOf('/* ---------------- 页面 ----')
if (iConst < 0 || iScene < 0 || iPage < 0) throw new Error('提取失败：ux 的分节注释被改了')

// 常量区里引用了 STARS（鱼缸位数），所以把星标鱼表当参数注进去
const G = new Function(
  'STARS',
  ux.slice(iConst, iScene) +
    '\n' +
    ux.slice(iScene, iPage) +
    '\nreturn { SPR, PAL, THEMES, buildScene, block,' +
    ' ROD_C, ROD_TIP_C, DESIGN_W, PAGE_H, WATER_TOP, GROUND_Y, BED_TOP, BED_H, GROUND_H, UNIT, FUNIT,' +
    ' BOAT_TOP, RIG_DX, RIG_DY, ROD_TIP_DX, ROD_TIP_DY, HOOK_REST, FISH_TOP }'
)(STARS)

// 行宽校验：任何一行长度不一致都会让造型错位
for (const key of Object.keys(G.SPR)) {
  const len = G.SPR[key][0].length
  G.SPR[key].forEach((r, i) => {
    if (r.length !== len) throw new Error(`SPR.${key} 第 ${i} 行长度 ${r.length}，应为 ${len}`)
  })
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

/* ---------------- 1. 鱼：每张地图 × 池里出现过的鱼种 + 稀有鱼 × 左右两个朝向 ---------------- */
let total = 0
let count = 0

// 背纹 / 斑点的颜色：身体色压暗，不用每张地图再手写一个色值
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v)))
  const r = ch(((n >> 16) & 255) * f)
  const g = ch(((n >> 8) & 255) * f)
  const b = ch((n & 255) * f)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

function dump(name, rows, pal, unit) {
  const r = gridToPng(path.join(OUT, name), rows, pal, unit)
  total += r.bytes
  count++
  return r
}

G.THEMES.forEach((theme, t) => {
  // 同一地图里同种鱼只烘一份图（池里重复项只是权重）
  const done = {}
  theme.fish.forEach((cfg) => {
    if (done[cfg.shape]) return
    done[cfg.shape] = 1
    const st = styled(G.SPR[cfg.shape])
    const pal = {
      B: cfg.body,
      F: cfg.fin,
      W: cfg.belly,
      R: cfg.red,
      D: shade(cfg.body, 0.55),
      E: cfg.eye,
      O: theme.outline
    }
    dump(`fish-${t}-${cfg.shape}.png`, st.r, pal, G.FUNIT)
    dump(`fish-${t}-${cfg.shape}-l.png`, st.l, pal, G.FUNIT)
  })
  const rare = styled(G.SPR.fry)
  const rpal = {
    B: theme.rare.body,
    F: theme.rare.fin,
    W: theme.rare.belly,
    R: theme.rare.red,
    D: shade(theme.rare.body, 0.6),
    E: theme.rare.eye,
    O: theme.outline
  }
  dump(`fish-${t}-r.png`, rare.r, rpal, G.FUNIT)
  dump(`fish-${t}-r-l.png`, rare.l, rpal, G.FUNIT)
})

/* ---------------- 1.5 星标鱼：每张地图一条，金身 + 深金描边 ----------------
 * 星标鱼和普通鱼共用造型，只换配色 —— 一眼能认出"这条是金色的"，
 * 至于它是虹鳟还是鳐鱼，看剪影就知道。文件名用 fish-<地图>-star，和页面里的
 * srcR/srcL 拼法一致。
 */
STARS.forEach((s) => {
  const rows = G.SPR[s.shape]
  if (!rows) throw new Error(`星标鱼 ${s.shape} 不在 SPR 里，先补造型再烘图`)
  const st = styled(rows)
  const pal = {
    B: STAR_PAL.body,
    F: STAR_PAL.fin,
    W: STAR_PAL.belly,
    R: STAR_PAL.red,
    D: shade(STAR_PAL.body, 0.72),
    E: STAR_PAL.eye,
    O: STAR_PAL.outline
  }
  dump(`fish-${s.m}-star.png`, st.r, pal, G.FUNIT)
  dump(`fish-${s.m}-star-l.png`, st.l, pal, G.FUNIT)
})

/* ---------------- 2. 鱼钩 ---------------- */
const hook = dump('hook.png', styled(G.SPR.hook).r, G.PAL.hook, G.UNIT)

/* ---------------- 3. 钓具（船 + 渔夫 + 竿） ----------------
 * 烘两张：rig.png（船头朝右，竿甩向右）和 rig-l.png（左右镜像，朝左）。
 * 页面按船的行进方向换 src —— 竿永远朝着船走的方向，
 * 钩也就永远落在"前方"，屏右边的死角就是这么消掉的。
 */
const rigRects = buildRig(G)
const rig = rigToPng(path.join(OUT, 'rig.png'), rigRects)
total += rig.bytes
count++
const rigL = rigToPng(path.join(OUT, 'rig-l.png'), mirrorRects(rigRects))
total += rigL.bytes
count++

/* ---------------- 3.5 每张地图的静态场景 → 全屏背景位图 ----------------
 * 天空 / 远岸 / 月亮 / 水面线 / 浪花 / 水草 / 礁石全是静态的，真机上没必要
 * 用几十个 div 摆出来：烘成一张 336x480 全屏 PNG，切地图只换 image 的 src，
 * 节点数不变、也没有整批销毁重建，切换时才不会顿一下。
 * 绘制顺序与 tools/preview.mjs 的 drawScene() 保持一致。
 */
/* 同一份场景画两遍，切两段：
 *   bg-{t}.png   0 .. BED_TOP(356)         天空 + 远岸 + 水面线 + 浪花 + 浅水
 *   bed-{t}.png  BED_TOP .. PAGE_H(480)     深水带 + 水底景观
 * 中间缺的那段（如果设备比设计稿高）由页面用纯水色 .wx 抻开 —— 见 fishing.ux。
 * rect() 自带裁剪，所以"画两遍 + 平移"是最省事的切法，不用改任何绘制代码。
 */
function paint(cv, scene, theme, dy) {
  rect(cv, 0, 0, cv.w, cv.h, theme.sky)
  scene.sky.forEach((b) => rect(cv, b.x, b.y + dy, b.w, b.h, b.c))
  rect(cv, 0, G.WATER_TOP + dy, G.DESIGN_W, G.PAGE_H - G.WATER_TOP, theme.water)
  scene.waves.forEach((b) => rect(cv, b.x, b.y + dy, b.w, b.h, b.c))
  scene.water.forEach((b) => rect(cv, b.x, b.y + dy, b.w, b.h, b.c))
}

G.THEMES.forEach((theme, t) => {
  const scene = G.buildScene(theme)
  const up = canvas(G.DESIGN_W, G.BED_TOP)
  paint(up, scene, theme, 0)
  total += writePng(path.join(OUT, `bg-${t}.png`), up)
  count++

  const bed = canvas(G.DESIGN_W, G.BED_H)
  paint(bed, scene, theme, -G.BED_TOP)
  total += writePng(path.join(OUT, `bed-${t}.png`), bed)
  count++
})

/* ---------------- 3.6 等级徽章：9 档样式，各两号尺寸 ----------------
 * 每 15 级换一个样式（见 src/common/level.js 的 TIERS）。9 档造型不一样，
 * 但都画在同一块 19x19 的格子上：小图 unit=2（38x38，选择页/结算页），
 * 大图 unit=4（76x76，等级页），整数倍放大不会糊。
 *
 * 画法：先用"每行 [左,右]"的区间拼出身体轮廓，再叠翅膀 / 王冠，
 * 最后把轮廓像素本身涂成深色（内描边）——比往外扩一圈更省画布，小尺寸也不会糊。
 */
const BW = 19
const BH = 19
const OX = 2 // 身体在 19 格画布里的横向偏移（左右留给翅膀）
const OY = 2 // 上边留给王冠

// 身体：15 宽 x 17 高，按行给 [左, 右]（含端点），null = 这行空
const BODY = {
  // 圆角木牌
  plank: [
    null, [3, 11], [2, 12], [1, 13], [1, 13], [1, 13], [1, 13], [1, 13],
    [1, 13], [1, 13], [1, 13], [1, 13], [2, 12], [3, 11], null, null, null
  ],
  // 八边圆宝石
  round: [
    null, [4, 10], [2, 12], [1, 13], [1, 13], [1, 13], [1, 13], [1, 13],
    [1, 13], [1, 13], [1, 13], [1, 13], [2, 12], [3, 11], [4, 10], null, null
  ],
  // 菱形
  diamond: [
    null, [7, 7], [6, 8], [5, 9], [4, 10], [3, 11], [1, 13], [1, 13],
    [1, 13], [1, 13], [3, 11], [4, 10], [5, 9], [6, 8], [7, 7], null, null
  ],
  // 六边形（平顶）
  hex: [
    null, [4, 10], [2, 12], [1, 13], [1, 13], [1, 13], [1, 13], [1, 13],
    [1, 13], [1, 13], [1, 13], [1, 13], [2, 12], [4, 10], null, null, null
  ],
  // 五边形 + 尖底
  pent: [
    null, [3, 11], [2, 12], [2, 12], [2, 12], [2, 12], [2, 12], [2, 12],
    [2, 12], [2, 12], [3, 11], [3, 11], [4, 10], [5, 9], [6, 8], [7, 7], null
  ],
  // 盾牌
  shield: [
    null, [4, 10], [2, 12], [1, 13], [1, 13], [1, 13], [1, 13], [1, 13],
    [1, 13], [1, 13], [1, 13], [2, 12], [3, 11], [4, 10], [5, 9], [6, 8], null
  ]
}

// 19x19 的类型图：0 空 / 1 身体 / 2 翅膀 / 3 王冠
function badgeTypes(kind, deco) {
  const grid = []
  for (let y = 0; y < BH; y++) grid.push(new Array(BW).fill(0))

  const rows = BODY[kind]
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y]
    if (!r) continue
    for (let x = r[0]; x <= r[1]; x++) grid[y + OY][x + OX] = 1
  }

  // 翅膀：左右对称，三层羽毛（上长下短），跟身体连成一体
  if (deco === 1 || deco === 2) {
    const wide = deco === 2
    const wing = wide
      ? [[4, 0], [5, 0], [6, 0], [7, 0], [8, 1], [9, 1], [10, 2]]
      : [[5, 1], [6, 0], [7, 0], [8, 1], [9, 2]]
    for (const [y, from] of wing) {
      const to = wide ? 3 : 2
      for (let x = from; x <= to; x++) {
        grid[y + OY][x] = 2
        grid[y + OY][BW - 1 - x] = 2
      }
    }
  }

  return grid
}

const BADGE_PAL = [
  { base: '#b5793c', dark: '#7d4a22', light: '#dfa869', out: '#2a1809' }, // 1 木牌
  { base: '#6fd08a', dark: '#3b8a58', light: '#b3f2c4', out: '#0e2b1b' }, // 2 翠玉
  { base: '#57d6e6', dark: '#25899c', light: '#aef3fb', out: '#08262c' }, // 3 青晶
  { base: '#5aa9f0', dark: '#2b5fa6', light: '#b6dcff', out: '#0a1f34' }, // 4 蓝晶
  { base: '#b98cf5', dark: '#6b41ac', light: '#e4d0ff', out: '#221233' }, // 5 紫晶
  { base: '#f0625f', dark: '#9c2b2f', light: '#ffb4ab', out: '#310d0c' }, // 6 红玉
  { base: '#cfd8e3', dark: '#8592a3', light: '#f6fbff', out: '#1d232b' }, // 7 银翼
  { base: '#ffcf5c', dark: '#b8821a', light: '#fff3c2', out: '#2e2008' }, // 8 金翼
  { base: '#eaf4ff', dark: '#86aede', light: '#ffffff', out: '#15223a' }  // 9 星辰
]

const BADGE_SHAPE = [
  ['plank', 0], ['round', 0], ['diamond', 0], ['hex', 0], ['pent', 0],
  ['shield', 0], ['shield', 1], ['shield', 2], ['shield', 3]
]

function drawBadge(cv, unit, tierIdx) {
  const pal = BADGE_PAL[tierIdx]
  const [kind, deco] = BADGE_SHAPE[tierIdx]
  const g = badgeTypes(kind, deco)
  const at = (x, y) => (x >= 0 && y >= 0 && x < BW && y < BH ? g[y][x] : 0)

  for (let y = 0; y < BH; y++) {
    for (let x = 0; x < BW; x++) {
      const t = g[y][x]
      if (!t) continue
      // 内描边：四邻有空格（或出界）的像素涂深色
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)
      let c
      if (edge) {
        c = pal.out
      } else if (t === 1) {
        // 宝石切面：左上亮、右下暗
        const d = x - BW / 2 + (y - BH / 2) * 0.55
        c = d < -3.4 ? pal.light : d > 3.4 ? pal.dark : pal.base
      } else if (t === 2) {
        c = y + OY < 8 ? pal.light : pal.dark // 翅膀上亮下暗，像羽毛
      } else {
        c = y < 2 ? pal.light : pal.base
      }
      rect(cv, x * unit, y * unit, unit, unit, c)
    }
  }

  // 王冠单独画（走类型图的话每个像素都会被判成"内描边"，1px 宽的东西全是深色）：
  // 一条 7px 横带 + 三个尖，横带自身带明暗，才看得出是王冠
  if (deco === 3) {
    const cy = 0 // 横带在 y=1，尖在 y=0
    for (let x = 6; x <= 12; x++) {
      const c = x === 6 || x === 12 ? pal.dark : pal.base
      rect(cv, x * unit, (cy + 1) * unit, unit, unit, c)
      rect(cv, x * unit, (cy + 1) * unit, unit, unit, c)
    }
    // 横带下沿压一条深色，跟盾牌顶端分开
    for (let x = 6; x <= 12; x++) rect(cv, x * unit, (cy + 2) * unit, unit, unit, pal.out)
    for (const x of [6, 9, 12]) {
      rect(cv, x * unit, cy * unit, unit, unit, pal.light)
    }
  }

  // 木纹：三条横线
  if (kind === 'plank') {
    for (const gy of [7, 11, 14]) {
      for (let x = 5; x <= 13; x++) rect(cv, x * unit, gy * unit, unit, unit, pal.dark)
    }
  } else {
    // 高光：左上两颗白点
    rect(cv, 6 * unit, 6 * unit, unit, unit, '#ffffff')
    rect(cv, 7 * unit, 7 * unit, unit, unit, '#ffffff')
  }
}

const badgeSizes = []
BADGE_PAL.forEach((_, i) => {
  const small = canvas(BW * 2, BH * 2)
  drawBadge(small, 2, i)
  total += writePng(path.join(OUT, `lv-${i}.png`), small)
  count++

  const big = canvas(BW * 4, BH * 4)
  drawBadge(big, 4, i)
  total += writePng(path.join(OUT, `lv-${i}-b.png`), big)
  count++

  badgeSizes.push({ w: small.w, h: small.h })
})

/* ---------------- 4. 校验 ux 里的尺寸常量 ---------------- */
function uxNum(name) {
  const m = ux.match(new RegExp('const ' + name + ' = (-?\\d+)'))
  if (!m) throw new Error('ux 里找不到常量 ' + name)
  return parseInt(m[1], 10)
}

// 竿末块（buildRig 里 i=11 那节 5x3）的左右边缘，用来算"竿尖"的横坐标
const TIP_BLOCK_R = G.RIG_DX + 90 + 5
const rigMaxX = rig.dx + rig.w
const expect = {
  RIG_IMG_W: rig.w,
  RIG_IMG_H: rig.h,
  RIG_IMG_DX: rig.dx,
  RIG_IMG_DY: rig.dy,
  ROD_TIP_DX: Math.floor(rigMaxX - 2.5),                       // 竿尖（朝右）
  ROD_TIP_DX_L: Math.floor(rig.dx + rigMaxX - TIP_BLOCK_R + 2.5) // 同一块镜像后（朝左）
}
const bad = Object.keys(expect).filter((k) => {
  try {
    return uxNum(k) !== expect[k]
  } catch (e) {
    return true
  }
})
if (bad.length) {
  console.error('\n❌ fishing.ux 里的钓具尺寸常量和包围盒不一致，请改成：')
  for (const k of bad) console.error(`   const ${k} = ${expect[k]}`)
  process.exit(1)
}

/* ---------------- 5. 精灵尺寸表（预览页要用） ---------------- */
const sizes = { hook: { w: hook.w, h: hook.h }, rig: { w: rig.w, h: rig.h } }
G.THEMES.forEach((theme, t) => {
  const done = {}
  theme.fish.forEach((cfg) => {
    if (done[cfg.shape]) return
    done[cfg.shape] = 1
    const shape = G.SPR[cfg.shape]
    sizes[`${t}-${cfg.shape}`] = {
      w: (shape[0].length + 2) * G.FUNIT,
      h: (shape.length + 2) * G.FUNIT
    }
  })
  sizes[`${t}-r`] = {
    w: (G.SPR.fry[0].length + 2) * G.FUNIT,
    h: (G.SPR.fry.length + 2) * G.FUNIT
  }
})
STARS.forEach((s) => {
  const shape = G.SPR[s.shape]
  sizes[`${s.m}-star`] = {
    w: (shape[0].length + 2) * G.FUNIT,
    h: (shape.length + 2) * G.FUNIT
  }
})
sizes.badges = badgeSizes
fs.writeFileSync(path.join(root, 'tools/sprite-sizes.json'), JSON.stringify(sizes, null, 2))

console.log(`\n✅ 生成 ${count} 张精灵，共 ${(total / 1024).toFixed(1)} KB → src/common/sprites/`)
console.log(`   钓具包围盒 ${rig.w}x${rig.h}，偏移 (${rig.dx}, ${rig.dy})`)
