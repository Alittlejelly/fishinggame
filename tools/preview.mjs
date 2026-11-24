/**
 * 预览生成器：
 *  1) preview/sprites.png      —— 精灵放大 8 倍，检查像素造型
 *  2) preview/scene-1..7.png  —— 每张地图的实际场景（336x480 的 1.5 倍）
 *  3) preview/fishing-preview.html —— 可直接在浏览器里看的多屏预览
 *
 * 关键点：精灵/地图/场景装饰全部从 src/pages/fishing/fishing.ux 里提取，
 * 预览与真机渲染用的是同一份数据，不会各自漂移。
 * 注意预览按"真机的扁平坐标"来画：船+渔夫+竿是一个整体精灵 rig。
 */
import fs from 'fs'
import path from 'path'
import { rectsOf, mergeRects, offsetRects, mirrorRects, styled, buildRig, canvas, rect, writePng } from './pixel.js'
import { levelInfo, TIERS, LV_PER_TIER } from '../src/common/level.js'
import { STARS, STAR_PAL, fmtTime } from '../src/common/star.js'
import { TEST } from '../src/common/dev.js'
import { cardSizes, shortDesc, titleOf, bestOf } from '../src/common/cardsize.js'
import { tankSizes, aboutSizes, levelSizes, panelSizes, hudSizes } from '../src/common/pagesize.js'

const root = path.resolve(import.meta.dirname, '..')
const ux = fs.readFileSync(path.join(root, 'src/pages/fishing/fishing.ux'), 'utf8')

/* ---------------- 从 ux 抽取数据与工具 ---------------- */
// 精灵的字符网格/地图配色仍然写在 fishing.ux 里（唯一真源）；
// 画点工具统一走 pixel.js，和 gen_sprites.mjs 共用同一套实现。
const iConst = ux.indexOf('const DESIGN_W')
const iScene = ux.indexOf('/* ---------------- 每张地图的场景装饰')
const iPage = ux.indexOf('/* ---------------- 页面 ----')
if (iConst < 0 || iScene < 0 || iPage < 0) throw new Error('提取失败：ux 的分节注释被改了')

// 版本号从 manifest 读：关于页写死 v3.1 那次，装的是 3.3 却在页面上说 3.1
const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'src/manifest.json'), 'utf8'))

const G = new Function(
  'STARS',
  ux.slice(iConst, iScene) +
    '\n' +
    ux.slice(iScene, iPage) +
    '\nreturn { SPR, PAL, THEMES, buildScene, block,' +
    ' ROD_C, ROD_TIP_C, DESIGN_W, PAGE_H, WATER_TOP, GROUND_Y, UNIT, FUNIT,' +
    ' BOAT_TOP, RIG_DX, RIG_DY, ROD_TIP_DX, ROD_TIP_DX_L, ROD_TIP_DY, HOOK_DX, HOOK_REST, FISH_TOP,' +
    ' RIG_IMG_W, RIG_IMG_H, RIG_IMG_DX, RIG_IMG_DY, HOOK_IMG_W, HOOK_IMG_H }'
)(STARS)

const {
  SPR,
  PAL,
  THEMES,
  buildScene,
  DESIGN_W,
  PAGE_H,
  WATER_TOP,
  GROUND_Y,
  UNIT,
  FUNIT,
  BOAT_TOP,
  ROD_TIP_DX,
  ROD_TIP_DX_L,
  ROD_TIP_DY,
  HOOK_DX,
  HOOK_REST,
  FISH_TOP,
  RIG_IMG_W,
  RIG_IMG_H,
  RIG_IMG_DX,
  RIG_IMG_DY,
  HOOK_IMG_W,
  HOOK_IMG_H
} = G

// 精灵行宽校验：任何一行长度不一致都会让造型错位
for (const key of Object.keys(SPR)) {
  const len = SPR[key][0].length
  SPR[key].forEach((r, i) => {
    if (r.length !== len) throw new Error('SPR.' + key + ' 第 ' + i + ' 行长度 ' + r.length + '，应为 ' + len)
  })
}

const outDir = path.join(root, 'preview')
fs.mkdirSync(outDir, { recursive: true })

function savePng(file, cv) {
  writePng(file, cv)
  console.log('written', path.relative(root, file), cv.w + 'x' + cv.h)
}

/* ---------------- 1. 精灵表（8x） ---------------- */
const S = 8
const t0 = THEMES[0]
const fpal = (cfg, th) => ({ B: cfg.body, F: cfg.fin, W: cfg.belly, R: cfg.red, D: '#00000022', E: cfg.eye, O: th.outline })
// 每种造型取它第一次出现的那张地图的配色
const findCfg = (shape) => {
  for (const th of THEMES) {
    const cfg = th.fish.filter((c) => c.shape === shape)[0]
    if (cfg) return { cfg, th }
  }
  return null
}
const fishRow = (shape, label) => {
  const f = findCfg(shape)
  return [label, SPR[shape], fpal(f.cfg, f.th), FUNIT]
}
const items = [
  fishRow('fry', 'fry 小银鱼'),
  fishRow('trout', 'trout 虹鳟'),
  fishRow('bass', 'bass 鲈鱼'),
  fishRow('puffer', 'puffer 河豚'),
  fishRow('koi', 'koi 锦鲤'),
  fishRow('catfish', 'catfish 鲶鱼'),
  fishRow('jelly', 'jelly 水母'),
  fishRow('crab', 'crab 螃蟹'),
  ['rare 金鱼', SPR.fry, fpal(t0.rare, t0), FUNIT],
  ['boat 船', SPR.boat, Object.assign({}, PAL.boat), UNIT],
  ['angler 渔夫', SPR.angler, Object.assign({}, PAL.angler), UNIT],
  ['hook 钩', SPR.hook, Object.assign({}, PAL.hook), UNIT]
]

const pad = 12
const sheetW = 760
const sheetH = items.reduce((s, it) => s + it[1].length * it[3] * S + pad, pad)
const sheet = canvas(sheetW, sheetH, '#101418')
let cursorY = pad
for (const [label, rows, pal, u] of items) {
  const st = styled(rows)
  for (const r of rectsOf(st.r, pal, u * S)) rect(sheet, 14 + r.x, cursorY + r.y, r.w, r.h, r.c)
  cursorY += st.r.length * u * S + pad
}
savePng(path.join(outDir, 'sprites.png'), sheet)

/* ---------------- 场景数据（真机同款坐标） ---------------- */
function sceneData(themeIdx, face) {
  const theme = THEMES[themeIdx]
  const scene = buildScene(theme)
  // face < 0 = 船头朝左（竿甩到左边）。真机上是船掉头时自动切的，
  // 这里手指定一下，方便看"朝左那张图"和钩的位置对不对。
  const dir = face == null ? 1 : face
  const boatX = dir < 0 ? 196 : 120
  const rigRects = dir < 0 ? mirrorRects(buildRig(G)) : buildRig(G)
  const rig = offsetRects(rigRects, boatX, BOAT_TOP)
  const tipX = boatX + (dir < 0 ? ROD_TIP_DX_L : ROD_TIP_DX)
  const tipY = BOAT_TOP + ROD_TIP_DY
  const hookY = WATER_TOP + 92
  const hook = offsetRects(mergeRects(rectsOf(styled(SPR.hook).r, PAL.hook, UNIT)), tipX - HOOK_DX, hookY)

  // 预览里每张地图挑三种不同的鱼（真机是随机抽）：前两种 + 池里最值钱的那种
  const uniq = []
  theme.fish.forEach((cfg, i) => {
    if (!uniq.some((u) => theme.fish[u].shape === cfg.shape)) uniq.push(i)
  })
  const pick = uniq.length >= 3 ? [uniq[0], uniq[1], uniq[uniq.length - 1]] : uniq
  const fishX = [10, 96, 190]
  const fishY = [FISH_TOP + 8, FISH_TOP + 58, GROUND_Y - 84]
  const fish = []
  for (let i = 0; i < 3; i++) {
    const cfg = theme.fish[pick[i]]
    const st = styled(SPR[cfg.shape])
    const pal = { B: cfg.body, F: cfg.fin, W: cfg.belly, R: cfg.red, E: cfg.eye, O: theme.outline }
    const rows = i === 1 ? st.l : st.r
    fish.push({ list: offsetRects(mergeRects(rectsOf(rows, pal, FUNIT)), fishX[i], fishY[i]) })
  }
  // 位图精灵（和真机同一份 PNG，坐标也按真机的约定算一遍）
  const imgs = {
    rig: { x: boatX + RIG_IMG_DX, y: BOAT_TOP + RIG_IMG_DY, w: RIG_IMG_W, h: RIG_IMG_H, src: dir < 0 ? 'rig-l.png' : 'rig.png' },
    hook: { x: tipX - HOOK_DX, y: hookY, w: HOOK_IMG_W, h: HOOK_IMG_H, src: 'hook.png' },
    fish: []
  }
  for (let i = 0; i < 3; i++) {
    const shape = SPR[theme.fish[pick[i]].shape]
    imgs.fish.push({
      x: fishX[i],
      y: fishY[i],
      w: (shape[0].length + 2) * FUNIT,
      h: (shape.length + 2) * FUNIT,
      src: 'fish-' + themeIdx + '-' + theme.fish[pick[i]].shape + (i === 1 ? '-l' : '') + '.png'
    })
  }
  return { theme, scene, rig, hook, fish, tipX, tipY, hookY, imgs }
}

/* ---------------- 2. 三张地图场景 ---------------- */
function drawScene(themeIdx) {
  const { theme, scene, rig, hook, fish, tipX, tipY, hookY } = sceneData(themeIdx)
  const K = 1.5
  const cv = canvas(Math.round(DESIGN_W * K), Math.round(PAGE_H * K), theme.sky)
  const R = (x, y, w, h, c) => rect(cv, x * K, y * K, w * K, h * K, c)
  const px = (list) => list.forEach((b) => R(b.x, b.y, b.w, b.h, b.c))

  px(scene.sky)
  R(0, WATER_TOP, DESIGN_W, PAGE_H - WATER_TOP, theme.water)
  px(scene.waves)
  px(scene.water)

  fish.forEach((f) => px(f.list))
  px(rig)
  R(tipX - 1, tipY, 2, hookY - tipY, 'rgba(255,255,255,0.5)')
  px(hook)

  // HUD 占位（真机上这里是数字/文字）
  R(0, 0, DESIGN_W, 4, theme.accent)
  R(14, 16, 54, 18, '#ffffff')
  R(DESIGN_W - 60, 18, 46, 14, '#ffffff')

  savePng(path.join(outDir, 'scene-' + (themeIdx + 1) + '.png'), cv)
}
THEMES.forEach((t, i) => drawScene(i))

/* ---------------- 3. HTML 多屏预览 ---------------- */
function divs(list) {
  return list
    .map((b) => `<i style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${b.c}"></i>`)
    .join('')
}

function imgTag(b) {
  const base = '../src/common/sprites/'
  return `<img src="${base}${b.src}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px" alt="">`
}

/* 背景是三段拼的（对应 fishing.ux 里的 bgSrc / .wx / bedSrc）：
 *   bg-i.png   贴顶，336x356   天空 + 水面 + 浅水
 *   纯水色     从 176 到 vh-124，屏越高越厚
 *   bed-i.png  贴底，336x124   深水带 + 水底
 * 所以 480 和 824 两种画布用的是同一份图，只是中间那段水色被拉长。
 */
function sceneBg(themeIdx, vh) {
  const h = vh || PAGE_H
  const bedTop = h - 124
  return `<img src="../src/common/sprites/bg-${themeIdx}.png" style="left:0;top:0;width:${DESIGN_W}px;height:356px" alt="">`
    + `<i style="left:0;top:${WATER_TOP}px;width:${DESIGN_W}px;height:${bedTop - WATER_TOP}px;background:${THEMES[themeIdx].water}"></i>`
    + `<img src="../src/common/sprites/bed-${themeIdx}.png" style="left:0;top:${bedTop}px;width:${DESIGN_W}px;height:124px" alt="">`
}

function sceneHtml(themeIdx, face, vh) {
  const H = vh || PAGE_H
  const tall = H > PAGE_H
  // 顶部时间条 / HUD 和页面同一份 hudSizes：窄屏往下搬 + 按圆角几何收窄
  const hud = hudSizes(tall)
  const { theme, rig, hook, fish, tipX, tipY, hookY, imgs } = sceneData(themeIdx, face)
  // 场景底图直接用构建期烘好的全屏位图，和真机同一个文件
  // 窄长屏：深水区多一条鱼（真机是 4 条），再单独给一条放到深处，
  // 让人一眼看出"多出来的高度是水，不是空白"
  const deepFish = tall
    ? `<img src="../src/common/sprites/fish-${themeIdx}-${theme.fish[0].shape}.png" style="left:120px;top:${H - 320}px;width:78px;height:30px" alt="">`
    : ''
  return `
  <div class="screen" style="background:${theme.sky}; height:${H}px">
    ${sceneBg(themeIdx, H)}
    ${imgs.fish.map(imgTag).join('')}
    ${deepFish}
    ${imgTag(imgs.rig)}
    <i class="line" style="left:${tipX - 1}px;top:${tipY}px;height:${hookY - tipY}px"></i>
    ${imgTag(imgs.hook)}

    <div class="bar" style="left:${hud.barX}px;top:${hud.barTop}px;width:${hud.barW}px;height:${hud.barH}px;border-radius:${hud.barR}px"><i style="width:${Math.round(hud.barW * 0.62)}px;height:${hud.barH}px;border-radius:${hud.barR}px;background:${theme.accent}"></i></div>
    <div class="hud" style="top:${hud.top}px;height:${hud.h}px;padding-left:${hud.padX}px;padding-right:${hud.padX}px"><b style="font-size:${hud.scoreSize}px">128</b><span style="font-size:${hud.comboSize}px;color:${theme.accent}">${hud.comboPrefix}1.5</span><b style="font-size:${hud.timeSize}px">37s</b></div>
    <div class="hint" style="top:${H - 72}px">轻点放钩 · 右滑返回</div>
    <div class="tag">${theme.level} · ${theme.name}${face < 0 ? ' · 竿朝左' : ''}${tall ? ' · 212×520' : ''}</div>
  </div>`
}

function selectHtml(totalOverride, vh) {
  const H = vh || PAGE_H
  const tall = H > PAGE_H
  // 默认跟着测试包的数值走（LV123 → 七张图全解锁），画的是"设计全貌"；
  // 传 0 就是正式版首次启动：LV1、只有第一张图能点。
  const lvTotal = totalOverride == null ? TEST.total : totalOverride
  const fresh = lvTotal === 0
  const lv = levelInfo(lvTotal)
  // 真机上列表能滚，预览里只画前 4 张（第 4 张被视口切一半，正是"下面还有"的暗示）
  const BEST = fresh ? [0, 0, 0, 0, 0, 0, 0] : (TEST.seedBest ? THEMES.map((t, i) => 220 + i * 130) : [46, 128, 92, 0, 0, 0, 0])
  // 窄屏（手环 11 212x520）用放大版卡片，宽屏用设计稿原值 —— 和 fishing.ux 同一份 cardSizes
  const S = cardSizes(tall)
  const cardOf = (t, i) => {
    const locked = lv.level < t.needLv
    const accent = locked ? 'rgba(255,255,255,.42)' : t.accent
    return `
    <div class="card${locked ? ' lock' : ''}" style="width:${S.cardW}px;height:${S.cardH}px;margin-left:${S.cardMl}px;margin-bottom:${S.cellH - S.cardH}px;border-color:${locked ? '#343a40' : t.border}">
      <div class="pv" style="width:${S.pv}px;height:${S.pv}px;background:${t.sky}">
        <i style="left:0;top:${S.pvWaterTop}px;width:${S.pv}px;height:${S.pvWaterH}px;background:${t.water}"></i>
        <i style="left:0;top:${S.pvDeepTop}px;width:${S.pv}px;height:${S.pvDeepH}px;background:${t.deep}"></i>
        <i style="left:0;top:${S.pvWaveY}px;width:${S.pvWaveW1}px;height:4px;background:${t.accent}"></i>
        <i style="left:${S.pvWaveX2}px;top:${S.pvWaveY}px;width:${S.pvWaveW2}px;height:4px;background:${t.accent}"></i>
        <i style="left:${S.pvTailX}px;top:${S.pvTailY}px;width:${S.pvTailW}px;height:${S.pvTailH}px;background:${t.fish[1].fin}"></i>
        <i style="left:${S.pvFishX}px;top:${S.pvFishY}px;width:${S.pvFishW}px;height:${S.pvFishH}px;background:${t.fish[1].body}"></i>
        <i style="left:${S.pvEyeX}px;top:${S.pvEyeY}px;width:${S.pvEyeS}px;height:${S.pvEyeS}px;background:#101010"></i>
        ${locked ? `<div class="pvlk" style="width:${S.pv}px;height:${S.pv}px"><span style="font-size:${S.pvLockT}px">锁</span></div>` : ''}
      </div>
      <div class="ci" style="width:${S.infoW}px">
        <p class="n" style="font-size:${S.nameSize}px;color:${accent}">${titleOf(t, tall)}</p>
        <p class="d" style="font-size:${S.descSize}px;margin-top:${S.descMt}px${locked ? ';color:#ff8f86' : ''}">${locked ? (tall ? 'Lv' + t.needLv + ' 解锁' : '达到 Lv' + t.needLv + ' 解锁') : (tall ? shortDesc(t.desc) : t.desc)}</p>
        <div class="row" style="width:${S.infoW}px;height:${S.rowH}px;margin-top:${S.rowMt}px;flex-direction:${S.rowDir};align-items:${S.rowAlign}">
          <span style="font-size:${S.starSize}px;color:${accent}">${t.stars}</span>
          <span class="b" style="font-size:${S.bestSize}px;margin-left:${S.bestMl}px">${bestOf(BEST[i], locked, tall)}</span>
        </div>
      </div>
    </div>`
  }
  // 真机上列表能滚，预览里只画到"被视口切一半"的那张：宽屏 4 张 / 窄屏 4 张
  const shown = 4
  return `
  <div class="screen sel" style="height:${H}px">
    <div class="head" style="margin-top:${tall ? 32 : 8}px"><h1 style="font-size:${S.titleSize}px">像素钓鱼</h1><p style="font-size:${S.subSize}px;color:${lv.color}">LV ${lv.level} · ${lv.tierName} · ${tall ? '' : '总积分 '}${lv.total}</p></div>
    <div class="cards" style="height:${H - S.reserve - S.padB}px">${THEMES.slice(0, shown).map((t, i) => cardOf(t, i)).join('')}</div>
    <div class="entry-wrap" style="margin-top:${S.entryMt}px">
      <div class="entry-row">
        <div class="entry" style="width:${S.entryW}px;height:${S.entryH}px;border-radius:${S.entryR}px;font-size:${S.entrySize}px;border-color:${lv.color}">
          <span style="color:${lv.color}">等级</span>
        </div>
        <div class="entry" style="width:${S.entryWBig}px;height:${S.entryH}px;border-radius:${S.entryR}px;font-size:${S.entrySize}px;border-color:#f7c948">
          <span style="color:#f7c948">${S.bigLabel}</span>
        </div>
        ${S.twoRows ? '' : `<div class="entry" style="width:${S.entryWAbout}px;height:${S.entryH}px;border-radius:${S.entryR}px;font-size:${S.entrySize}px;border-color:${THEMES[0].accent}">
          <span style="color:${THEMES[0].accent}">关于</span>
        </div>`}
      </div>
      ${S.twoRows ? `<div class="entry-row" style="margin-top:${S.entryGap}px">
        <div class="entry" style="width:${S.entryWAbout}px;height:${S.entryH}px;border-radius:${S.entryR}px;font-size:${S.entrySize}px;border-color:${THEMES[0].accent}">
          <span style="color:${THEMES[0].accent}">关于</span>
        </div>
      </div>` : ''}
    </div>
    <!-- 底部安全区占位：和 fishing.ux 的 .sel-gap 一样，是**真占位**不是 padding -->
    <div class="sel-gap" style="height:${S.padB}px"></div>
  </div>`
}

/* 结算面板：验证 .panel 是 column —— 漏写 flex-direction 时真机会把所有文字挤成一行。
 * 尺寸/字号全部读 panelSizes（和 fishing.ux 同一份），窄屏那版放大到 300 宽 / 正文 24。 */
function overHtml(themeIdx, vh, tall) {
  const t = THEMES[themeIdx]
  const H = vh || PAGE_H
  const P = panelSizes(tall)
  // 结算里的等级/积分跟着测试包走：原来写死 2328 分（Lv12 木牌），
  // 换上 123 级的测试数据后就看得出矛盾（面板说升级到 Lv12，选择页写着 Lv123）。
  const gain = 26
  const before = levelInfo(TEST.total)
  const after = levelInfo(TEST.total + gain)
  const up = after.level > before.level
  const p = (cls, style, txt) =>
    `<p class="${cls}" style="width:${P.barW}px;${style}">${txt}</p>`
  return `
  <div class="screen" style="background:${t.sky};height:${H}px">
    ${sceneBg(themeIdx, H)}
    <div class="mask" style="height:${H}px">
      <div class="panel" style="width:${P.w}px;padding:${P.padT}px 0 ${P.padB}px;border-color:${t.accent}">
        ${p('pt', `font-size:${P.titleSize}px;letter-spacing:${P.titleLs}px;color:${t.accent}`, '时间到')}
        ${p('ps', `font-size:${P.scoreSize}px;margin-top:${P.scoreMt}px`, '26')}
        ${p('pl', `font-size:${P.lineSize}px;margin-top:${P.lineMt}px`,
          '钓到 4 条 · ' + (tall ? t.name : t.level + ' · ' + t.name))}
        ${p('pg', `font-size:${P.gainSize}px;margin-top:${P.gainMt}px`,
          `积分 +${gain} · 总 ${TEST.total + gain}`)}
        <div class="pbar" style="width:${P.barW}px;height:${P.barH}px;margin-top:${P.barMt}px">
          <i style="width:${Math.round(P.barW * (after.percent / 100))}px;height:${P.barH}px;background:${after.color}"></i>
        </div>
        ${up ? p('pup', `font-size:${P.lvupSize}px;margin-top:${P.lvupMt}px;color:${after.color}`,
          `升级！LV ${after.level} · ${after.tierName}`) : ''}
        ${p('pb', `font-size:${P.bestSize}px;margin-top:${P.bestMt}px`, '★ 新纪录 ★')}
        <div class="star-box" style="width:${P.starW}px;margin-top:${P.starMt}px;padding:${P.starPadT}px 0 ${P.starPadB}px">
          <div class="star-row">
            <img class="star-img" src="../src/common/sprites/fish-0-star.png" style="width:${P.starImgW}px;height:${Math.round(P.starImgW * 0.545)}px;margin-right:${P.starImgMr}px" alt="">
            <p class="star-name" style="width:${P.starNameW}px;font-size:${P.starNameSize}px">${tall ? '★ 虹鳟' : '★ 星标鱼 · 虹鳟'}</p>
          </div>
          <div class="star-btn" style="width:${P.starBtnW}px;height:${P.starBtnH}px;margin-top:${P.starBtnMt}px;border-radius:${P.starBtnR}px">
            <span style="font-size:${P.starBtnSize}px">放入鱼缸</span>
          </div>
        </div>
        <div class="btns" style="margin-top:${P.btnMt}px">
          <div class="btn" style="width:${P.btnW}px;height:${P.btnH}px;margin:0 ${P.btnMx}px;background:${t.accent}"><span style="width:${P.btnTxtW}px;font-size:${P.btnSize}px">再来一局</span></div>
          <div class="btn ghost" style="width:${P.btnW}px;height:${P.btnH}px;margin:0 ${P.btnMx}px;border-color:${t.accent}"><span style="width:${P.btnTxtW}px;font-size:${P.btnSize}px;color:${t.accent}">换地图</span></div>
        </div>
      </div>
    </div>
  </div>`
}

/* 拉鱼力度条：只有星标鱼才会出现。绿框（= 鱼）自己上下游，柱子要一直追着它
   （对应 fishing.ux 的 .reel / tickReel）。这里挂一段真驱动脚本，
   预览里看到的就是"框在动、鱼跟着动、柱子追"，不是一张静态图。 */
function reelHtml(vh) {
  const H = vh || PAGE_H
  const REEL_H = 246
  const ZONE = 52
  const zoneTop = 120
  const fill = 150
  const fishTop = zoneTop + 2 + Math.round((ZONE - 30) / 2)
  const ticks = Array.from({ length: 11 }).map(() => '<i></i>').join('')
  const driver = '<script>(function(){var B=document.getElementById("reelbox");if(!B)return;'
    + 'var H=246,Z=52,UP=4.8,DOWN=5.8,ph=1.2,drift=0.032,amp=0.78;'
    + 'var zone=B.querySelector(".reel-zone"),fill=B.querySelector(".reel-fill"),'
    + 'fish=B.querySelector(".reel-fish"),tip=B.querySelector(".reel-tip");'
    + 'var h=0,cap=H,prog=0,bar=B.querySelector(".reel-bar i");'
    + 'setInterval(function(){'
    + 'ph+=drift;var span=H-Z,mid=span/2,zt=Math.round(mid+Math.sin(ph)*mid*amp);'
    + 'if(zt<0)zt=0;if(zt>span)zt=span;'
    + 'zone.style.top=zt+"px";'
    + 'fish.style.marginTop=(zt+2+Math.round((Z-30)/2))+"px";'
    + 'cap=H-Math.round(h);'
    + 'var hold=cap>zt+Z/2;'
    + 'h+=hold?UP:-DOWN;if(h<0)h=0;if(h>H)h=H;'
    + 'cap=H-Math.round(h);'
    + 'fill.style.top=cap+"px";fill.style.height=Math.round(h)+"px";'
    + 'var inz=cap>=zt&&cap<=zt+Z;'
    + 'prog+=inz?1:-0.6;if(prog<0)prog=0;if(prog>60)prog=60;'
    + 'bar.style.width=Math.round(prog*3.4)+"px";'
    + 'bar.style.background=inz?"#7ee08a":(prog>0?"#e0642f":"#f7c948");'
    + 'zone.style.borderColor=inz?"#7ee08a":"#f7c948";'
    + 'tip.style.color=inz?"#7ee08a":"#f7c948";'
    + 'tip.textContent=inz?"稳住 · 保持住":(prog>0?"滑掉了 · 快回绿框":(cap<zt?"太高了 · 松一点":"按住 · 追上鱼"));'
    + '},33);})();<\/script>'
  return `
  <div class="screen" style="background:${THEMES[1].sky}; height:${H}px">
    <img src="../src/common/sprites/bg-1.png" style="left:0;top:0;width:${DESIGN_W}px;height:${PAGE_H}px" alt="">
    <div class="reel" id="reelbox" style="height:${H}px">
      <div class="reel-head">
        <p class="rt">★ 星标鱼上钩</p>
        <p class="rs">按住往上拉 · 松手下滑 · 跟住绿框</p>
      </div>
      <div class="reel-body">
        <div class="reel-scale">${ticks}</div>
        <div class="reel-track">
          <div class="reel-zone" style="top:${zoneTop}px;height:${ZONE}px;border-color:#7ee08a"></div>
          <div class="reel-fill" style="top:${REEL_H - fill}px;height:${fill}px">
            <div class="reel-cap"></div>
          </div>
        </div>
        <img class="reel-fish flow" src="../src/common/sprites/fish-1-star.png" style="width:78px;height:30px;margin-top:${fishTop}px" alt="">
      </div>
      <div class="reel-bar"><i style="width:120px;background:#e0642f"></i></div>
      <p class="reel-tip" style="color:#7ee08a">稳住 · 保持住</p>
    </div>
  </div>
  ${driver}`
}

/* 缺鱼提示：三种状态和 tank.ux 的 apply() 一一对应（满缸时不能再说"还差 0 条"） */
function missLine(owned, got) {
  const missing = STARS.filter((x) => !owned[x.m + ':' + x.shape]).map((x) => x.map)
  if (got === 0) return '还空着 · 钓到星标鱼就能入缸'
  if (!missing.length) return '七条集齐了 · 整缸都是星标鱼'
  return '还差 ' + missing.length + ' 条：' + missing.slice(0, 2).join(' / ') + (missing.length > 2 ? ' 等' : '')
}

/* 鱼缸页：7 个缸位，已收集的是金色星标鱼，没收集的是空展柜（对应 tank.ux） */
function tankHtml(selIdx, boxId, noTs, noFish, vh) {
  const H = vh || PAGE_H
  const tall = H > PAGE_H
  // 尺寸和 tank.ux 同一份（pagesize.js 的 tankSizes），不手抄数字
  const tk = tankSizes(tall)
  const topPad = tall ? 100 : 70
  const botPad = tall ? 132 : 76
  const groupH = tk.tankH + 6 + tk.infoH
  const tankTop = tall ? topPad + Math.round((H - topPad - botPad - groupH) / 2) : 66
  const infoTop = tankTop + tk.tankH + 8
  const tankL = Math.round((336 - tk.tankW - 6) / 2)
  const sandTop = tk.tankH - tk.sandH - 3
  const emptyTop = Math.round((tk.tankH - tk.sandH) / 2) - 6
  const wd = tk.weedH
  const wTop = (h) => sandTop + 18 - h
  const hdrTop = tk.hdrMt + (tall ? 24 : 0)
  const backTop = H - tk.backBottom - tk.backH
  const backL = Math.round((336 - tk.backW) / 2)

  // 和 tank.ux 同一套：只画已收集的，缩放上限 / 泳道都跟着屏幕走
  // noTs   = 老玩家的缸（v2.6 之前的两段格式，没有时间戳）
  // noFish = 正式版首次启动：一条都还没钓到
  const owned = {}
  if (!noFish) STARS.forEach((st, i) => {
    if (TEST.fillTank) owned[st.m] = { ts: noTs ? 0 : 1794892800000 - (STARS.length - i) * 2 * 86400000 }
  })
  const swim = []
  STARS.forEach((st, i) => {
    const rec = owned[st.m]
    if (!rec) return
    const scale = Math.min(tk.fishMaxW / st.w, tk.fishMaxH / st.h)
    const w = Math.round(st.w * scale)
    const h = Math.round(st.h * scale)
    swim.push({
      m: st.m,
      w: w,
      h: h,
      x: 6 + Math.round(((i * 0.37) % 1) * (tk.tankW - w - 12)),
      lane: tk.laneTop + swim.length * tk.laneGap,
      dir: i % 2 === 0 ? 1 : -1,
      spd: Number((0.55 + (i % 3) * 0.22).toFixed(2)),
      ph: i * 0.9
    })
  })

  const got = swim.length
  const missing = STARS.filter((st) => !owned[st.m]).map((st) => st.map)
  const tipLine = got === 0 ? '七张地图 · 每张各有一条 ★' : '点一下鱼看钓到的时间'
  const missLine = got === 0
    ? ''
    : !missing.length
      ? '七条集齐了 · 整缸都是星标鱼'
      : '还差 ' + missing.length + ' 条：' + missing.slice(0, 2).join(' / ') + (missing.length > 2 ? ' 等' : '')

  const fishEls = swim.map((f, i) => {
    const st = STARS.find((x) => x.m === f.m)
    const on = selIdx >= 0 && selIdx === i
    const dirL = f.dir < 0
    return '<div class="tk-fw" style="left:' + (f.x - 6) + 'px;top:' + (f.lane - 6) + 'px;width:' + (f.w + 12) + 'px;height:' + (f.h + 12) + 'px;border-color:' + (on ? 'rgba(247,201,72,.85)' : 'transparent') + '">'
      + '<img class="tk-f r" src="../src/common/sprites/fish-' + st.m + '-star.png" style="width:' + f.w + 'px;height:' + f.h + 'px;display:' + (dirL ? 'none' : 'block') + '" alt="">'
      + '<img class="tk-f l" src="../src/common/sprites/fish-' + st.m + '-star-l.png" style="width:' + f.w + 'px;height:' + f.h + 'px;display:' + (dirL ? 'block' : 'none') + '" alt="">'
      + '</div>'
  }).join('')

  let info
  if (selIdx >= 0 && swim[selIdx]) {
    const st = STARS.find((x) => x.m === swim[selIdx].m)
    const t = fmtTime(owned[st.m].ts)
    info = '<div class="tk-info" style="top:' + infoTop + 'px;height:' + tk.infoH + 'px">'
      + '<p class="dn" style="font-size:' + tk.nameSize + 'px;color:' + st.color + '">★ ' + st.name + ' · ' + st.map + '</p>'
      + '<p class="dt" style="font-size:' + tk.timeSize + 'px;color:' + (t ? 'rgba(247,201,72,.95)' : 'rgba(255,255,255,.38)') + '">'
      + (t ? '钓到于 ' + t : '钓到时间未记录') + '</p>'
      + '<p class="dsub" style="font-size:' + tk.subSize + 'px">基础分 ' + st.value + '</p></div>'
  } else {
    info = '<div class="tk-info" style="top:' + infoTop + 'px;height:' + tk.infoH + 'px">'
      + '<p class="note" style="font-size:' + tk.noteSize + 'px">' + tipLine + '</p>'
      + '<p class="miss" style="font-size:' + tk.missSize + 'px">' + missLine + '</p></div>'
  }

  // 一小段驱动脚本：预览里的鱼真的在游（left 每 60ms 走一步，触边掉头换图）。
  // 不用模板字符串，免得这段 JS 里的 ${} 被外层的模板字符串吃掉。
  const driver = swim.length
    ? '<script>(function(){var B=document.getElementById("' + boxId + '");if(!B)return;'
      + 'var F=' + JSON.stringify(swim) + ',TW=' + tk.tankW + ',ST=' + sandTop + ';'
      + 'var W=B.querySelectorAll(".tk-fw");'
      + 'setInterval(function(){for(var i=0;i<F.length;i++){var f=F[i],e=W[i];if(!e)continue;'
      + 'var maxX=TW-f.w-6;f.x+=f.spd*f.dir;'
      + 'if(f.x<=6){f.x=6;f.dir=1}else if(f.x>=maxX){f.x=maxX;f.dir=-1}'
      + 'f.ph+=0.12;var y=f.lane+Math.sin(f.ph)*3;if(y>ST-f.h)y=ST-f.h;if(y<0)y=0;'
      + 'e.style.left=(f.x-6)+"px";e.style.top=(Math.round(y)-6)+"px";'
      + 'var r=e.querySelector("img.r"),l=e.querySelector("img.l");'
      + 'r.style.display=f.dir>0?"block":"none";l.style.display=f.dir>0?"none":"block";}},60);})();<\/script>'
    : ''

  return `
  <div class="screen tk" id="${boxId}" style="height:${H}px">
    <div class="tk-hdr" style="left:${tankL}px;top:${hdrTop}px;width:${tk.tankW}px"><p class="t" style="width:${tk.tankW}px;font-size:${tk.hdrT}px">我的鱼缸</p><p class="s" style="width:${tk.tankW}px;font-size:${tk.hdrS}px">星标鱼 ${got} / ${STARS.length} · 每张地图一条</p></div>
    <div class="tank" style="left:${tankL}px;top:${tankTop}px;width:${tk.tankW + 6}px;height:${tk.tankH + 6}px">
      <i class="water" style="width:${tk.tankW}px;height:${tk.tankH}px"></i>
      <i class="surface" style="width:${tk.tankW}px"></i>
      <i class="shine" style="width:${tk.tankW}px;height:${tk.shineH}px"></i>
      <i class="sand-hi" style="top:${sandTop}px;width:${tk.tankW}px"></i>
      <i class="sand" style="top:${sandTop + 3}px;height:${tk.sandH}px;width:${tk.tankW}px"></i>
      <i class="weed" style="left:22px;top:${wTop(wd[0])}px;height:${wd[0]}px"></i>
      <i class="weed" style="left:40px;top:${wTop(wd[1])}px;height:${wd[1]}px;background:#17553f"></i>
      <i class="weed" style="left:258px;top:${wTop(wd[2])}px;height:${wd[2]}px"></i>
      <i class="bub" style="left:262px;top:12px"></i>
      <i class="bub" style="left:276px;top:22px"></i>
      <i class="bub" style="left:28px;top:16px"></i>
      ${got === 0 ? '<p class="tk-empty" style="top:' + emptyTop + 'px;width:' + tk.tankW + 'px;font-size:' + tk.emptySize + 'px">空缸 · 钓到星标鱼就能入缸</p>' : ''}
      ${fishEls}
    </div>
    ${info}
    <div class="tk-back" style="left:${backL}px;top:${backTop}px;width:${tk.backW}px;height:${tk.backH}px;border-radius:${tk.backR}px"><span style="width:${tk.backTxtW}px;font-size:${tk.backSize}px">返回主页</span></div>
  </div>
  ${driver}`
}

/* 等级页：真机上是独立页面；数据用 level.js 现算，和真机完全同一套规则。
   尺寸和 level.ux 同一份（pagesize.js 的 levelSizes），窄屏不再是一屏小字。 */
function levelHtml(total, vh) {
  const H = vh || PAGE_H
  const tall = H > PAGE_H
  const sz = levelSizes(tall)
  const hdrTop = sz.hdrMt + (tall ? 24 : 0)
  const backTop = H - sz.backBottom - sz.backH
  const backL = Math.round((336 - sz.backW) / 2)
  const info = levelInfo(total)
  const cells = TIERS.map((t, i) => {
    const from = i * LV_PER_TIER + 1
    return {
      src: `../src/common/sprites/lv-${i}.png`,
      label: 'Lv' + from + '-' + (from + LV_PER_TIER - 1),
      color: t.color,
      border: i === info.tier ? t.color : 'rgba(255,255,255,.12)'
    }
  })
  const cell = (c) => `<div class="cell" style="border-color:${c.border};width:${sz.cellW}px;height:${sz.cellH}px;margin:0 ${sz.cellMl}px">
        <img class="flow" src="${c.src}" style="width:${sz.cellBadge}px;height:${sz.cellBadge}px" alt=""><span style="width:${sz.cellW}px;font-size:${sz.cellLv}px;color:${c.color}">${c.label}</span>
      </div>`
  const rows = [0, 3, 6]
    .map((k) => `<div class="grow" style="width:${sz.heroW}px;margin-top:${sz.rowMt}px">${cell(cells[k])}${cell(cells[k + 1])}${cell(cells[k + 2])}</div>`)
    .join('')
  return `
  <div class="screen lv" style="height:${H}px">
    <div class="lv-bar" style="background:${info.color}"></div>
    <div class="lv-hdr" style="width:${sz.heroW}px;margin-top:${hdrTop}px">
      <p class="t" style="width:${sz.heroW}px;font-size:${sz.hdrT}px;color:${info.color}">等级</p>
      <p class="s" style="width:${sz.heroW}px;font-size:${sz.hdrS}px">每 15 级换一个徽章 · 积分累计</p>
    </div>
    <div class="hero" style="border-color:${info.color};width:${sz.heroW}px;height:${sz.heroH}px;margin-top:${sz.heroMt}px">
      <img class="hero-badge flow" src="../src/common/sprites/lv-${info.tier}-b.png" style="width:${sz.badge}px;height:${sz.badge}px" alt="">
      <div class="hero-info" style="width:${sz.infoW}px">
        <p class="lv-num" style="width:${sz.infoW}px;font-size:${sz.lv}px;color:${info.color}">LV ${info.level}</p>
        <p class="lv-tier" style="width:${sz.infoW}px;font-size:${sz.tier}px">${info.tierName} · 总积分 ${info.total}</p>
        <div class="hero-bar" style="width:${sz.infoW}px;height:${sz.barH}px;margin-top:${sz.barMt}px"><i style="height:${sz.barH}px;width:${Math.round(sz.infoW * (info.percent / 100))}px;background:${info.color}"></i></div>
        <p class="lv-next" style="width:${sz.infoW}px;font-size:${sz.next}px">${info.isMax ? '已达最高等级' : '还差 ' + info.toNext + ' 分升级'}</p>
      </div>
    </div>
    <p class="lv-sec" style="width:${sz.heroW}px;font-size:${sz.secSize}px;margin-top:${sz.secMt}px">徽章</p>
    ${rows}
    <div class="lv-back" style="left:${backL}px;top:${backTop}px;width:${sz.backW}px;height:${sz.backH}px;border-color:${info.color}"><span style="width:${sz.backTxtW}px;font-size:${sz.backSize}px;color:${info.color}">返回主页</span></div>
  </div>`
}

/* 关于页：真机上是独立页面（router.push 进来），所以这里按"整屏页面"画，不是遮罩。
   尺寸和 about.ux 同一份（pagesize.js 的 aboutSizes），窄屏那套会明显放大。 */
function aboutHtml(vh) {
  const H = vh || PAGE_H
  const tall = H > PAGE_H
  const ab = aboutSizes(tall)
  ab.contentW = Math.round(336 - ab.padX * 2)
  ab.innerW = ab.contentW - 36
  /* 页头单独缩进（窄屏 68 躲顶部半圆），和 about.ux 的 setViewport 同一套算法 */
  const padL = ab.hdrPadL == null ? ab.padX : ab.hdrPadL
  ab.hdrW = Math.round(336 - padL - ab.padX)
  ab.hdrTW = ab.hdrW - ab.logo - ab.logoGap
  ab.rkVW = tall ? 132 : 100
  ab.rkLW = ab.contentW - ab.rkVW - 8
  const hdrTop = ab.hdrMt + (tall ? 24 : 0)
  const backTop = H - ab.backBottom - ab.backH
  const backL = Math.round((336 - ab.backW) / 2)

  const accent = '#8fe0a2'
  // 真机只显示"最佳的一张 + 解锁进度"，预览照抄
  const best = { level: '中级', name: '碧波湖', score: 128, color: '#79d8f5' }
  const lis = ab.tips.map((t) =>
    `<p class="ab-li" style="width:${ab.contentW}px;font-size:${ab.liSize}px;margin-top:${ab.liMt}px">${t}</p>`
  ).join('')
  return `
  <div class="screen about" style="height:${H}px">
    <div class="ab-bar" style="background:${accent}"></div>
    <div class="ab-hdr" style="width:${ab.hdrW}px;margin-left:${padL}px;margin-top:${hdrTop}px">
      <img class="ab-logo" src="../src/common/logo-48.png" style="width:${ab.logo}px;height:${ab.logo}px;margin-right:${ab.logoGap}px" alt="">
      <div class="ab-txt" style="width:${ab.hdrTW}px">
        <p class="t" style="width:${ab.hdrTW}px;font-size:${ab.tSize}px;color:${accent}">关于</p>
        <p class="s" style="width:${ab.hdrTW}px;font-size:${ab.sSize}px">${ab.sub}</p>
      </div>
    </div>
    <div class="ab-card" style="border-color:${THEMES[0].border};width:${ab.contentW}px;margin-top:${ab.cardMt}px;padding:${ab.cardPad}px 0">
      <p class="n" style="width:${ab.innerW}px;font-size:${ab.nameSize}px">像素钓鱼</p>
      <p class="v" style="width:${ab.innerW}px;font-size:${ab.verSize}px">v${manifest.versionName}</p>
    </div>
    <div class="ab-lis" style="width:${ab.contentW}px;margin-top:${ab.lisMt}px">${lis}</div>
    <p class="ab-sec" style="width:${ab.contentW}px;font-size:${ab.secSize}px;margin-top:${ab.secMt}px;color:${accent}">最高分</p>
    <div class="ab-rank" style="width:${ab.contentW}px;margin-top:${ab.rkMt}px">
      <p class="l" style="width:${ab.rkLW}px;font-size:${ab.rkL}px">${tall ? best.name : best.level + ' · ' + best.name}</p>
      <p class="r" style="width:${ab.rkVW}px;font-size:${ab.rkV}px;color:${best.color}">${best.score} 分</p>
    </div>
    <p class="ab-note" style="width:${ab.contentW}px;font-size:${ab.noteSize}px;margin-top:${ab.noteMt}px">已解锁 ${THEMES.filter((t) => levelInfo(TEST.total).level >= t.needLv).length} / ${THEMES.length} 张地图</p>
    <div class="ab-back" style="left:${backL}px;top:${backTop}px;width:${ab.backW}px;height:${ab.backH}px;border-color:${accent}"><span style="width:${ab.backTxtW}px;font-size:${ab.backSize}px;color:${accent}">返回主页</span></div>
  </div>`
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>像素钓鱼 · 小米手环 10 Pro 预览</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0c0e; color: #cfd8dc; font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; padding: 32px 24px 60px; }
  h2.title { font-size: 18px; font-weight: 600; color: #e8f0f2; letter-spacing: 1px; }
  p.sub { font-size: 12px; color: #7d8c93; margin-top: 6px; line-height: 1.7; }
  .stage { display: flex; gap: 40px; margin-top: 28px; flex-wrap: wrap; }
  /* 手环 11 那一排有 7 屏，间距收紧一点才能挤在一行（7*212 + 6*18 = 1592） */
  .stage.s11 { gap: 18px; }
  .slot { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .slot > span { font-size: 12px; color: #8fa2aa; letter-spacing: 1px; }
  .phone { width: 336px; height: 480px; border-radius: 26px; overflow: hidden; box-shadow: 0 0 0 6px #1c2226, 0 18px 40px rgba(0,0,0,.6); position: relative; }
  .screen { position: relative; width: 336px; height: 480px; overflow: hidden; }
  .screen i, .screen img { position: absolute; display: block; }
  .screen img { image-rendering: pixelated; }
  .line { position: absolute; width: 2px; background: rgba(255,255,255,.5); }
  .bar { position: absolute; left: 0; top: 0; width: 336px; height: 4px; background: rgba(0,0,0,.45); }
  .bar i { display: block; height: 4px; }
  .hud { position: absolute; left: 0; top: 8px; width: 336px; height: 46px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; }
  .hud b { color: #fff; font-size: 34px; font-weight: 700; }
  .hud span { font-size: 15px; }
  .hint { position: absolute; left: 0; top: 408px; width: 336px; text-align: center; color: rgba(255,255,255,.55); font-size: 15px; }
  .tag { position: absolute; right: 10px; bottom: 96px; color: rgba(255,255,255,.24); font-size: 11px; }
  /* 选择页（字号与 fishing.ux 的 .sel 段一一对应） */
  /* 注意：这里**不能**用 padding-bottom 当安全区。Vela 的 div 是 content-box，
     padding 不计入 height，子节点照样排到最下沿 —— 真机上连着三版 padB 加大都没用，
     就是这个原因。预览要是用 border-box（本文件全局 * 就是），那它永远看不出这个 bug。 */
  .sel { background: #0b0f0c; padding: 0; display: flex; flex-direction: column; align-items: center; }
  .head { width: 336px; text-align: center; margin-bottom: 2px; }
  .head h1 { color: #fff; font-size: 34px; letter-spacing: 2px; }
  .head p { color: rgba(255,255,255,.42); font-size: 14px; margin-top: 2px; letter-spacing: 1px; }
  .card { width: 296px; height: 98px; background: #15191c; border: 2px solid; display: flex; align-items: center; margin-bottom: 2px; flex: none; }
  .pv { position: relative; width: 74px; height: 74px; margin-left: 10px; overflow: hidden; flex: none; }
  .pv i { position: absolute; }
  .card.lock { opacity: .55; }
  /* flex-grow: 1 是照着真机写的：ux 的 .cards 就是这个值，它会吃掉底部所有剩余空间。
     正是它让 padding-bottom 那版看起来"留白没生效" —— 留白在 content 区之外，
     列表却把 content 区撑满，按钮就顶到屏幕最下沿去了。 */
  .cards { width: 336px; height: 305px; overflow: hidden; flex-grow: 1; }
  .pvlk { position: absolute; left: 0; top: 0; width: 74px; height: 74px; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; }
  .pvlk span { color: rgba(255,255,255,.88); font-size: 22px; }
  .ci { width: 196px; margin-left: 12px; }
  .ci p.n { color: #fff; font-size: 24px; }
  .ci p.d { color: rgba(255,255,255,.7); font-size: 16px; margin-top: 5px; }
  .ci .row { display: flex; align-items: center; margin-top: 4px; }
  .ci .row span { font-size: 18px; }
  .ci .row span.b { font-size: 16px; color: rgba(255,255,255,.55); margin-left: 10px; }
  /* 窄屏两行入口：wrap 竖排，行间距由第二行内联 —— 和 fishing.ux 的 .entry-wrap 一致 */
  .entry-wrap { width: 336px; display: flex; flex-direction: column; align-items: center; flex: none; }
  .sel-gap { width: 336px; flex: none; }
  .entry-row { width: 336px; margin-top: 0; display: flex; align-items: center; justify-content: center; }
  .entry { width: 102px; height: 50px; margin: 0 3px; flex: none; background: #191e22; border: 2px solid; border-radius: 25px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff; }
  /* 结算 / 关于面板（严格对应 ux 的 .mask / .panel，含 flex-direction: column） */
  .mask { position: absolute; left: 0; top: 0; width: 336px; height: 480px; background: rgba(0,0,0,.78); display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .panel { width: 272px; background: #10161a; border: 2px solid; display: flex; flex-direction: column; align-items: center; padding: 16px 0; }
  .panel p { width: 240px; text-align: center; }
  .panel p.pt { font-size: 22px; letter-spacing: 2px; }
  .panel p.ps { color: #fff; font-size: 56px; font-weight: 700; margin-top: 2px; }
  .panel p.pl { color: rgba(255,255,255,.78); font-size: 16px; margin-top: 4px; }
  .panel p.pb { color: rgba(255,255,255,.55); font-size: 15px; margin-top: 6px; }
  .panel p.pg { color: rgba(255,255,255,.6); font-size: 15px; margin-top: 8px; }
  .panel .pbar { width: 240px; height: 8px; margin-top: 6px; background: rgba(255,255,255,.14); }
  .panel .pbar i { display: block; height: 8px; }
  .panel p.pup { width: 240px; text-align: center; font-size: 16px; font-weight: 700; margin-top: 8px; }
  /* 关于页（整屏页面，对应 about.ux） */
  .about { background: #0b0f0c; display: flex; flex-direction: column; align-items: center; }
  .ab-bar { position: absolute; left: 0; top: 0; width: 336px; height: 4px; }
  .ab-hdr { width: 296px; margin-top: 8px; display: flex; flex-direction: row; align-items: center; }
  .screen img.ab-logo { position: static; width: 48px; height: 48px; margin-right: 12px; }
  .ab-txt { width: 236px; display: flex; flex-direction: column; align-items: flex-start; }
  .ab-hdr p.t { width: 236px; text-align: left; font-size: 34px; letter-spacing: 2px; }
  .ab-hdr p.s { width: 236px; text-align: left; color: rgba(255,255,255,.45); font-size: 15px; letter-spacing: 1px; margin-top: 2px; }
  .ab-card { width: 296px; border: 2px solid; margin-top: 6px; padding: 9px 0; display: flex; flex-direction: column; align-items: center; }
  .ab-card p.n { width: 260px; text-align: center; color: #fff; font-size: 32px; letter-spacing: 2px; }
  .ab-card p.v { width: 260px; text-align: center; color: rgba(255,255,255,.6); font-size: 17px; margin-top: 3px; }
  .ab-sec { width: 296px; text-align: left; font-size: 17px; margin-top: 8px; }
  .ab-lis { width: 296px; display: flex; flex-direction: column; margin-top: 5px; }
  .ab-li { width: 296px; text-align: left; color: rgba(255,255,255,.82); font-size: 18px; margin-top: 5px; }
  .ab-rank { width: 296px; display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
  .ab-rank p.l { width: 188px; text-align: left; color: rgba(255,255,255,.82); font-size: 18px; }
  .ab-rank p.r { width: 100px; text-align: right; font-size: 20px; }
  .ab-back { position: absolute; left: 88px; top: 408px; width: 160px; height: 52px; border: 2px solid; display: flex; align-items: center; justify-content: center; }
  .ab-back span { width: 150px; text-align: center; font-size: 19px; font-weight: 700; }
  .ab-note { width: 296px; text-align: left; color: rgba(255,255,255,.5); font-size: 15px; margin-top: 6px; }
  /* 等级页（对应 level.ux） */
  .lv { background: #0b0f0c; display: flex; flex-direction: column; align-items: center; }
  .lv-bar { position: absolute; left: 0; top: 0; width: 336px; height: 4px; }
  .lv-hdr { width: 296px; margin-top: 8px; display: flex; flex-direction: column; align-items: center; }
  .lv-hdr p.t { width: 296px; text-align: center; font-size: 34px; letter-spacing: 2px; }
  .lv-hdr p.s { width: 296px; text-align: center; color: rgba(255,255,255,.45); font-size: 14px; margin-top: 2px; }
  .hero { width: 300px; height: 96px; margin-top: 8px; border: 2px solid; background: #10161a; display: flex; align-items: center; }
  .hero-badge { width: 76px; height: 76px; margin-left: 2px; }
  .hero-info { width: 200px; margin-left: 8px; display: flex; flex-direction: column; align-items: flex-start; }
  .hero-info p { width: 200px; }
  .hero-info p.lv-num { font-size: 30px; font-weight: 700; }
  .hero-info p.lv-tier { color: rgba(255,255,255,.65); font-size: 14px; margin-top: 1px; }
  .hero-bar { width: 200px; height: 8px; margin-top: 5px; background: rgba(255,255,255,.14); }
  .hero-bar i { display: block; height: 8px; }
  .hero-info p.lv-next { color: rgba(255,255,255,.5); font-size: 13px; margin-top: 3px; }
  .lv-sec { width: 300px; text-align: left; color: rgba(255,255,255,.6); font-size: 14px; margin-top: 8px; }
  .grow { width: 300px; margin-top: 2px; display: flex; align-items: center; justify-content: center; }
  .cell { width: 96px; height: 62px; margin: 0 2px; border: 2px solid; background: #12171a; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  /* 预览里 .screen img 一律绝对定位（场景精灵这么用），等级相关的图要回到普通流：
     用 .screen img.flow 提高优先级，否则被 .screen img 覆盖回去 */
  .screen img.flow { position: static; display: block; }
  .cell img { width: 38px; height: 38px; }
  .cell span { width: 92px; text-align: center; font-size: 12px; margin-top: 1px; }
  .lv-back { position: absolute; left: 88px; top: 408px; width: 160px; height: 50px; border: 2px solid; display: flex; align-items: center; justify-content: center; }
  .lv-back span { width: 150px; text-align: center; font-size: 18px; font-weight: 700; }
  .btns { display: flex; margin-top: 14px; }
  .btn { width: 106px; height: 44px; display: flex; align-items: center; justify-content: center; margin: 0 5px; }
  .btn span { width: 100px; text-align: center; font-size: 16px; font-weight: 700; color: #0b0f0c; }
  .btn.ghost { background: none; border: 2px solid; }
  /* 星标鱼 / 入缸（对应 .star-box） */
  .star-box { width: 240px; display: flex; flex-direction: column; align-items: center; margin-top: 8px; padding: 6px 0; border-top: 1px solid rgba(247,201,72,.35); }
  .star-row { display: flex; align-items: center; justify-content: center; }
  .screen img.star-img { position: static; margin-right: 6px; image-rendering: pixelated; }
  .panel p.star-name { width: 150px; text-align: left; color: #f7c948; font-size: 15px; font-weight: 700; }
  .star-btn { width: 148px; height: 34px; margin-top: 6px; background: #f7c948; border-radius: 17px; display: flex; align-items: center; justify-content: center; }
  .star-btn span { color: #2a1c00; font-size: 15px; font-weight: 700; }
  /* 拉鱼力度条 */
  .reel { position: absolute; left: 0; top: 0; width: 336px; height: 480px; background: rgba(4,8,10,.74); display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .reel-head { width: 300px; text-align: center; margin-bottom: 8px; }
  .reel-head p.rt { color: #f7c948; font-size: 24px; font-weight: 700; letter-spacing: 1px; }
  .reel-head p.rs { color: rgba(255,255,255,.62); font-size: 14px; margin-top: 2px; }
  .reel-body { width: 182px; height: 264px; border: 3px solid #3a4650; background: #161b1f; padding: 4px; display: flex; align-items: flex-start; }
  .reel-scale { width: 12px; height: 246px; display: flex; flex-direction: column; justify-content: space-between; }
  .reel-scale i { position: static; width: 12px; height: 2px; background: rgba(255,255,255,.42); }
  .reel-track { position: relative; width: 64px; height: 246px; margin-left: 6px; border: 2px solid #2f363c; background: #0b0f12; overflow: hidden; }
  .reel-zone { position: absolute; left: 2px; width: 56px; border: 2px solid; background: rgba(96,220,130,.30); }
  .reel-fill { position: absolute; left: 3px; width: 54px; background: #5aa8dc; }
  .reel-cap { width: 54px; height: 12px; background: #ffd166; }
  .screen img.reel-fish { position: static; margin-left: 8px; }
  .reel-bar { width: 200px; height: 10px; margin-top: 12px; background: rgba(255,255,255,.16); }
  .reel-bar i { position: static; display: block; height: 10px; }
  .reel-tip { width: 300px; text-align: center; font-size: 17px; font-weight: 700; margin-top: 8px; }
  /* 鱼缸页 */
  .tk { background: #08131a; display: flex; flex-direction: column; align-items: center; }
  /* 鱼缸页：页头/缸体/详情全绝对定位，和 tank.ux 一一对应。
     缸用 border-box（306 含 3px 边框 = 内容 300），Vela 的盒模型就是这样，改成 content-box 会对不上。 */
  .tk-hdr { position: absolute; left: 18px; top: 4px; width: 300px; }
  .tk-hdr p.t { width: 300px; text-align: center; color: #f7c948; font-size: 30px; font-weight: 700; letter-spacing: 2px; }
  .tk-hdr p.s { width: 300px; text-align: center; color: rgba(255,255,255,.55); font-size: 14px; margin-top: 2px; }
  .tank { position: absolute; left: 15px; top: 66px; width: 306px; height: 262px; box-sizing: border-box; border: 3px solid #2c5a68; border-radius: 10px; overflow: hidden; background: #0b2230; }
  .tank i.water { left: 0; top: 0; width: 300px; height: 256px; background: #0d2a36; }
  .tank i.surface { left: 0; top: 0; width: 300px; height: 5px; background: #3d8fa8; }
  .tank i.shine { left: 0; top: 5px; width: 300px; height: 54px; background: #123a49; }
  .tank i.sand-hi { left: 0; top: 228px; width: 300px; height: 3px; background: #3d525d; }
  .tank i.sand { left: 0; top: 231px; width: 300px; height: 25px; background: #2a3a43; }
  .tank i.weed { position: absolute; width: 6px; background: #1f6b52; }
  .tank i.bub { width: 5px; height: 5px; border-radius: 3px; background: rgba(190,240,255,.28); }
  .tk-empty { position: absolute; left: 0; top: 110px; width: 300px; text-align: center; color: rgba(255,255,255,.35); font-size: 15px; }
  /* 一条鱼一个热区框（比鱼大 12px），左/右两张图叠在同一格里切换 */
  .tk-fw { position: absolute; display: flex; align-items: center; justify-content: center; border: 2px solid transparent; border-radius: 8px; background: rgba(255,255,255,.02); }
  .screen img.tk-f { position: static; image-rendering: pixelated; }
  .screen img.tk-f.l { display: none; }
  .tk-info { position: absolute; left: 18px; top: 330px; width: 300px; height: 72px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .tk-info p.dn { width: 300px; text-align: center; font-size: 17px; font-weight: 700; }
  .tk-info p.dt { width: 300px; text-align: center; font-size: 15px; font-weight: 700; margin-top: 4px; }
  .tk-info p.dsub { width: 300px; text-align: center; color: rgba(255,255,255,.42); font-size: 12px; margin-top: 3px; }
  .tk-info p.note { width: 300px; text-align: center; color: rgba(255,255,255,.55); font-size: 13px; }
  .tk-info p.miss { width: 300px; text-align: center; color: rgba(247,201,72,.8); font-size: 14px; margin-top: 5px; }
  .tk-back { position: absolute; left: 88px; top: 410px; width: 160px; height: 48px; border: 2px solid #f7c948; border-radius: 24px; display: flex; align-items: center; justify-content: center; }
  .tk-back span { color: #f7c948; font-size: 17px; font-weight: 700; }

  /* ---- 小米手环 11（212x520 胶囊屏）----
     真机上是"336x824 的画布整体缩到 212 宽"（px 跟着 designWidth=336 等比缩放），
     这里用 transform: scale(212/336) 一模一样地模拟，不是另画一套 UI。 */
  /* 手环 11 是真·胶囊屏：圆角半径 = 半宽 106px（不是 46 的小圆角）。
     早先写 46 时，预览永远看不出"底部按钮被圆角吃掉" —— 真机才发现。
     半径一改成 106，预览里凡是压到弧线上的东西都会当场被裁，等于免费的自检。 */
  .phone11 { width: 212px; height: 520px; border-radius: 106px; overflow: hidden; box-shadow: 0 0 0 6px #1c2226, 0 18px 40px rgba(0,0,0,.6); position: relative; }
  .phone11 .shrink { position: absolute; left: 0; top: 0; width: 336px; height: 824px; transform: scale(0.6309); transform-origin: 0 0; }
  /* 头部位置（8 + padTop 24）已经由 selectHtml 内联给 .head 的 margin-top，
     这里不要再补 padding-top —— 两处都加会多顶 32，列表少露半张卡。
     底部胶囊的宽度/字号同样由 selectHtml 内联写出（和 ux 同源），不在这里覆盖。 */
</style>
</head>
<body>
  <h2 class="title">像素钓鱼 · 小米手环 10 Pro（336×480）</h2>
  <p class="sub">下面是 1:1 的屏幕（336×480）：地图选择 / 七张地图 / 拉鱼力度条 / 结算 / 鱼缸 / 关于 / 等级。渔夫站在船上，鱼线与钩从竿尖垂下。</p>
  <div class="stage">
    <div class="slot"><div class="phone">${selectHtml()}</div><span>地图选择（7 张可滚动 · 满级账号）</span></div>
    <div class="slot"><div class="phone">${selectHtml(0)}</div><span>正式版首次启动（LV1 · 只有第一张图能点）</span></div>
    ${THEMES.map((t, i) => `<div class="slot"><div class="phone">${sceneHtml(i)}</div><span>${t.level} · ${t.name}</span></div>`).join('')}
    <div class="slot"><div class="phone">${sceneHtml(1, -1)}</div><span>船掉头 · 鱼竿跟着转向（钩挂到左侧）</span></div>
    <div class="slot"><div class="phone">${reelHtml()}</div><span>星标鱼 · 拉鱼力度条</span></div>
    <div class="slot"><div class="phone">${overHtml(0)}</div><span>结算（含放入鱼缸）</span></div>
    <div class="slot"><div class="phone">${tankHtml(-1, 'tkA')}</div><span>鱼缸 · 鱼在游（${TEST.fillTank ? STARS.length : 0} / ${STARS.length}）</span></div>
    <div class="slot"><div class="phone">${tankHtml(-1, 'tkE', false, true)}</div><span>正式版首次启动 · 空缸</span></div>
    <div class="slot"><div class="phone">${tankHtml(0, 'tkB')}</div><span>鱼缸 · 点鱼看钓到时间</span></div>
    <div class="slot"><div class="phone">${tankHtml(0, 'tkC', true)}</div><span>鱼缸 · 老记录没有时间戳（如实写"未记录"）</span></div>
    <div class="slot"><div class="phone">${aboutHtml()}</div><span>关于</span></div>
    <div class="slot"><div class="phone">${levelHtml(TEST.total)}</div><span>等级（${TEST.total} 分 → LV${levelInfo(TEST.total).level} · ${levelInfo(TEST.total).tierName}）</span></div>
  </div>
  <h2 class="title" style="margin-top:44px">多屏适配 · 小米手环 11（212 × 520 胶囊屏）</h2>
  <p class="sub">同一份代码：画布宽恒为 336，画布高按 336 × 520 / 212 = <b>824</b> 重排 —— 水面仍在 176，
  多出来的 344 全给深水区（鱼多派一条），水底景观贴着屏幕底边，HUD 和底部按钮躲开圆角。
  整块按 0.631 缩到 212 宽，就是真机的样子（下面几屏是等比缩放，不是另画的一套）。</p>
  <div class="stage s11">
    <div class="slot"><div class="phone11"><div class="shrink">${selectHtml(null, 824)}</div></div><span>地图选择 · 胶囊两行 / 高 52 物理</span></div>
    <div class="slot"><div class="phone11"><div class="shrink">${sceneHtml(1, 1, 824)}</div></div><span>游戏中 · 深水区更长</span></div>
    <div class="slot"><div class="phone11"><div class="shrink">${reelHtml(824)}</div></div><span>拉鱼力度条 · 垂直居中</span></div>
    <div class="slot"><div class="phone11"><div class="shrink">${overHtml(0, 824, true)}</div></div><span>结算 · 面板 300 宽 / 正文 15 物理</span></div>
    <div class="slot"><div class="phone11"><div class="shrink">${tankHtml(-1, 'tk11', false, false, 824)}</div></div><span>鱼缸 · 缸高 290 物理</span></div>
    <div class="slot"><div class="phone11"><div class="shrink">${aboutHtml(824)}</div></div><span>关于 · 正文 16.4 物理</span></div>
    <div class="slot"><div class="phone11"><div class="shrink">${levelHtml(TEST.total, 824)}</div></div><span>等级 · 徽章卡 150 高</span></div>
  </div>

  <p class="sub" style="margin-top:28px">每张地图的差异：<br>
  ${THEMES.map((t) => `${t.level} ${t.mult}× / ${t.speed}px / ${t.time}s`).join(' · ')}<br>
  地图按等级解锁（${THEMES.map((t) => 'Lv' + t.needLv).join(' / ')}），每张地图有自己的招牌生物。</p>
</body>
</html>
`

/* ---------------- 图片内联 ----------------
 * 预览面板是用 http://127.0.0.1:xxxx/static-html/... 打开这个 html 的，
 * 相对路径 ../src/common/... 会越出静态根目录、整片 404（页面上就是一堆破图标）。
 * 干脆把用到的 png 全部转成 data URI —— 单文件预览，发给谁都能直接看，
 * 不再受"预览服务器把哪个目录当根"的影响。
 */
let inlined = 0
const htmlSelf = html.replace(/src="(\.\.\/[^"]+\.png)"/g, (m, rel) => {
  const file = path.resolve(outDir, rel)
  if (!fs.existsSync(file)) throw new Error('预览引用了不存在的图：' + rel)
  inlined++
  return 'src="data:image/png;base64,' + fs.readFileSync(file).toString('base64') + '"'
})

fs.writeFileSync(path.join(outDir, 'fishing-preview.html'), htmlSelf)
console.log('written preview/fishing-preview.html', '内联图片', inlined, '张',
  Math.round(Buffer.byteLength(htmlSelf) / 1024) + ' KB')
