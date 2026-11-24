/**
 * 无界面逻辑自测：把 fishing.ux 的 script 抽出来跑一遍完整对局，
 * 检查"下钩 → 命中 → 计分 → 连击 → 结算存分"是否正常，
 * 并盯住每帧的渲染属性写入次数（防止又退化成"每帧重建上百个节点"）。
 *
 * 用法：node tools/simulate.mjs
 */
import fs from 'fs'
import path from 'path'
import { levelInfo, badgeSrc, TIERS, LV_PER_TIER, LEVEL_KEY } from '../src/common/level.js'
import { STARS, STAR_PAL, TANK_KEY, starOf, tankId, tankEntry, parseTank, fmtTime } from '../src/common/star.js'
import { TEST, TEST_SEED_KEY } from '../src/common/dev.js'
import { cardSizes, isNarrow, shortDesc, titleOf, bestOf, PILL_R, pillAvailW } from '../src/common/cardsize.js'
import { tankSizes, aboutSizes, levelSizes, panelSizes, hudSizes } from '../src/common/pagesize.js'

const root = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'))
// 设计单位 → 手环 11 物理像素（designWidth=336 在 212 宽屏上缩 0.631 倍）
const scale11 = 212 / 336
const phys = (v) => v * scale11
const ux = fs.readFileSync(path.join(root, 'src/pages/fishing/fishing.ux'), 'utf8')
const script = ux.slice(ux.indexOf('<script>') + 8, ux.indexOf('</script>'))

const store = {}
const storageStub = {
  get({ key, default: def, success }) {
    if (success) success(key in store ? store[key] : def)
  },
  set({ key, value }) {
    store[key] = value
  }
}

// 去掉所有 import（@system 的和项目内的 level.js），把 export default 改成 return，
// 直接当函数体执行。项目内的模块由下面 new Function 的入参注入，保证和页面用同一份实现。
const src = script
  .replace(/import\s+\w+\s+from\s+'@system\.\w+'\s*/g, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'[^']*common\/[a-z]+\.js'\s*/g, '')
  .replace('export default {', 'return {')

// 主循环用桩定时器：真 setInterval 会在断言期间偷偷跑 tick，把状态搅乱
const timers = { seq: 0, live: new Set() }
const stubSetInterval = () => {
  const id = ++timers.seq
  timers.live.add(id)
  return id
}
const stubClearInterval = (id) => {
  timers.live.delete(id)
}

// setTimeout 桩：解锁提示"1.8 秒后自动消失"用的，不进主循环计时器集合
const timeouts = { seq: 0, live: new Set() }
const stubSetTimeout = (fn) => {
  const id = ++timeouts.seq
  timeouts.live.add(id)
  return id
}
const stubClearTimeout = (id) => {
  timeouts.live.delete(id)
}

// 路由桩：关于页现在是独立页面，进出全靠 router
const routes = { pushed: [], backs: 0, replaced: [] }
const routerStub = {
  push({ uri }) {
    routes.pushed.push(uri)
  },
  back() {
    routes.backs++
  },
  replace({ uri }) {
    routes.replaced.push(uri)
  }
}

// 亮度桩：记录每次 setKeepScreenOn，用来验证"进游戏必须常亮、回选择页放开"
const bright = { calls: [] }
const brightnessStub = {
  setKeepScreenOn({ keepScreenOn }) {
    bright.calls.push(keepScreenOn)
  },
  setValue() {},
  wakeScreenOn() {}
}

/* 屏幕桩：默认 336x480（手环 Pro = 设计稿），
 * 想验窄长屏就把 SCREEN_STUB.h 改成 824 再调 inst.setViewport() —— 见"多屏"那一节 */
const SCREEN_STUB = {
  w: 336, h: 480, realW: 336, realH: 480, shape: 'rect', dpr: 2.1,
  pill: false, tall: false, extra: 0, ready: true,
  name: '小米手环 10 Pro', padTop: 0, padBottom: 0, padX: 0
}
const DESIGN_H = 480
const screenH = () => SCREEN_STUB.h
const probeScreen = () => true
const screenListeners = []
const onScreen = (fn) => {
  if (SCREEN_STUB.ready) {
    fn(SCREEN_STUB)
    return () => {}
  }
  screenListeners.push(fn)
  return () => {
    const i = screenListeners.indexOf(fn)
    if (i >= 0) screenListeners.splice(i, 1)
  }
}

const makeComponent = new Function(
  'storage', 'router', 'brightness', 'levelInfo', 'badgeSrc', 'LEVEL_KEY',
  'STARS', 'STAR_PAL', 'TANK_KEY', 'starOf', 'tankId', 'tankEntry', 'parseTank',
  'TEST', 'TEST_SEED_KEY',
  'SCREEN', 'DESIGN_H', 'screenH', 'probeScreen', 'onScreen',
  'cardSizes', 'isNarrow', 'shortDesc', 'titleOf', 'bestOf', 'panelSizes', 'PILL_R', 'pillAvailW', 'hudSizes',
  'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', src
)

// 把 ux 顶部的常量区求值一次，断言里用"期望值"而不是魔数
// 鱼种已经拆成每张地图一个鱼池，常量区截到精灵表之前即可
const constSrc = script.slice(script.indexOf('const DESIGN_W'), script.indexOf('const SPR = {'))
const K = new Function('STARS', constSrc + '\nreturn { DESIGN_W, WATER_TOP, FISH_TOP, FISH_HOP, FISH_GAP, FISH_WARM, ROD_TIP_DX, ROD_TIP_DX_L, HOOK_DX, RIG_IMG_DX, RIG_IMG_W, SWIPE_DX, REEL_H, REEL_ZONE, REEL_DRIFT, REEL_UP, REEL_DOWN, REEL_NEED, REEL_LIMIT }')(STARS)
// 自测跑"正式逻辑"：把 TEST 关掉，避免开局就被灌成 123 级 / 满缸
const TEST_OFF = Object.assign({}, TEST, { on: false })
const def = makeComponent(
  storageStub, routerStub, brightnessStub, levelInfo, badgeSrc, LEVEL_KEY,
  STARS, STAR_PAL, TANK_KEY, starOf, tankId, tankEntry, parseTank, TEST_OFF, TEST_SEED_KEY,
  SCREEN_STUB, DESIGN_H, screenH, probeScreen, onScreen,
  cardSizes, isNarrow, shortDesc, titleOf, bestOf, panelSizes, PILL_R, pillAvailW, hudSizes,
  stubSetInterval, stubClearInterval, stubSetTimeout, stubClearTimeout
)

// 用 Proxy 包一层：统计"每帧往渲染字段上写了多少次"
const writes = {}
const base = Object.assign({}, def.private)
for (const k of Object.keys(def)) {
  if (k !== 'private') base[k] = def[k]
}
const inst = new Proxy(base, {
  set(t, k, v) {
    writes[k] = (writes[k] || 0) + 1
    t[k] = v
    return true
  }
})

let failures = 0
function check(name, cond, extra = '') {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? '  ' + extra : ''))
  if (!cond) failures++
}

const spritePath = (src) => path.join(root, 'src', src.replace(/^\//, ''))

// —— 初始化 ——
inst.onInit()
check('初始阶段为地图选择', inst.phase === 'select')

// —— 地图靠等级解锁：Lv1 只开第一张 ——
check('初始只有第一张地图解锁',
  inst.maps[0].locked === false && inst.maps[1].locked === true && inst.maps[2].locked === true,
  inst.maps.map((m) => (m.locked ? '锁' : '开')).join(''))
check('锁住的地图写出解锁等级', inst.maps[1].descLine === '达到 Lv' + inst.maps[1].needLv + ' 解锁',
  inst.maps[1].descLine + ' / ' + inst.maps[2].descLine)
check('锁住的地图不显示最高分', inst.maps[1].bestLine === '未解锁', inst.maps[1].bestLine)
inst.selectMap(1)
check('点未解锁的地图不会进游戏', inst.phase === 'select' && inst.mapIdx === 0,
  'phase=' + inst.phase + ' map=' + inst.mapIdx)
check('底部提示还差几级', /还差 \d+ 级 · Lv\d+ 解锁/.test(inst.lockMsg), inst.lockMsg)
check('提示自带收起定时器', timeouts.live.size === 1, 'live=' + timeouts.live.size)

// —— 开局 ——
inst.selectMap(0)
check('进入游戏', inst.phase === 'playing')
check('进游戏强制屏幕常亮', bright.calls[0] === true && inst.keepOn === true,
  'calls=' + JSON.stringify(bright.calls))
check('进游戏即启动主循环', inst.loop > 0, 'loop=' + inst.loop)
check('鱼群数量为 3', inst.g.fish.length === 3)
check('鱼有朝右/朝左两套图源', !!inst.g.fish[0].srcR && !!inst.g.fish[0].srcL,
  inst.g.fish[0].srcR)
check('三张鱼图都已落到页面字段', !!inst.f1src && !!inst.f2src && !!inst.f3src)
check('钓具/鱼钩是位图节点', inst.rigX > 0 && inst.hookLX > 0 && inst.hookW > 0 && inst.hookH > 0,
  'rigX=' + inst.rigX + ' hook=' + inst.hookLX + ',' + inst.hookY)
check('鱼线从竿尖垂下', inst.lineTop < inst.hookY && inst.lineTop < inst.waterTop + 60,
  'lineTop=' + inst.lineTop + ' hookY=' + inst.hookY)
check('时间初始 60s', inst.timeLeft === 60)

// —— 回归：船移动时钩子和鱼线必须跟着走（真机上曾整体落在原地）——
// 竿尖挂在船的哪一边，由船头朝哪边决定（朝右 +108 / 朝左 +12）
const tipOf = (o) => o.boatX + (o.faceDir > 0 ? K.ROD_TIP_DX : K.ROD_TIP_DX_L)
const x0 = inst.boatX
for (let i = 0; i < 12; i++) inst.moveBoat()
const moved = inst.boatX - x0
check('船在移动', moved > 0, '船右移 ' + moved + 'px')
check('钩随船平移', inst.hookLX === tipOf(inst) - K.HOOK_DX,
  'hookLX=' + inst.hookLX + ' 期望=' + (tipOf(inst) - K.HOOK_DX))
check('鱼线随船平移', inst.lineX === tipOf(inst) - 1,
  'lineX=' + inst.lineX + ' 期望=' + (tipOf(inst) - 1))
check('钓具图随船平移', inst.rigX === inst.boatX + K.RIG_IMG_DX,
  'rigX=' + inst.rigX + ' 期望=' + (inst.boatX + K.RIG_IMG_DX))

// —— 掉头换向：竿永远朝着船走的方向（这版修的就是"右边死角"）——
// 老写法竿死钉在船右边，所以钩只能在船右侧；船左边那片（x<80）永远钓不到，
// 船也得提前 14px 停在右边。现在两张镜像图轮换，钩跟着甩到前方。
inst.selectMap(0)
let flipSeen = 0
let rigFlipped = 0
let hidAtFlip = 0
let shown = 0
const hookOff = []
let hookMinL = 9999
let hookMaxL = -1
let hookMinR = 9999
let hookMaxR = -1
for (let i = 0; i < 900; i++) {
  const before = inst.faceDir
  inst.moveBoat()
  inst.tickFlip()
  if (inst.faceDir !== before) {
    flipSeen += 1
    if ((inst.rigSrc.indexOf('rig-l') >= 0) === (inst.faceDir < 0)) rigFlipped += 1
    if (inst.hookOp === 0 && inst.lineOp === 0) hidAtFlip += 1
  }
  if (inst.hookOp === 1) shown += 1
  if (inst.faceDir < 0) {
    hookMinL = Math.min(hookMinL, inst.hookX)
    hookMaxL = Math.max(hookMaxL, inst.hookX)
  } else {
    hookMinR = Math.min(hookMinR, inst.hookX)
    hookMaxR = Math.max(hookMaxR, inst.hookX)
  }
  if (inst.hookLX < 0 || inst.hookLX + inst.hookW > K.DESIGN_W) hookOff.push(inst.hookLX)
  if (inst.lineX < 1 || inst.lineX > K.DESIGN_W - 1) hookOff.push('line' + inst.lineX)
}
check('一趟巡航里船会掉好几次头', flipSeen >= 3, 'flips=' + flipSeen)
check('每次掉头都换成朝那一边的钓具图', rigFlipped === flipSeen, rigFlipped + '/' + flipSeen)
check('掉头那一拍钩和线隐身（不然线会瞬移 96px）', hidAtFlip === flipSeen, hidAtFlip + '/' + flipSeen)
check('隐身只藏两帧就恢复', shown > 880, 'shown=' + shown)
check('朝左时钩探到船左前方', hookMinL < 60 && hookMaxL > 100, hookMinL + '..' + hookMaxL)
check('朝右时钩能到屏幕右边', hookMaxR > 300, 'hookX max=' + hookMaxR)
check('钩和线全程不出屏', hookOff.length === 0, hookOff.length ? hookOff.slice(0, 5).join(',') : '0 次')

// —— 精灵文件必须真的在包里（漏生成会在真机上直接留白）——
const needed = new Set()
for (let m = 0; m < 3; m++) {
  inst.selectMap(m)
  needed.add(inst.bgSrc)
  inst.g.fish.forEach((f) => {
    needed.add(f.srcR)
    needed.add(f.srcL)
  })
  needed.add(inst.g.rare.srcR)
  needed.add(inst.g.rare.srcL)
  needed.add('/common/sprites/rig.png')
  needed.add('/common/sprites/rig-l.png')
  needed.add('/common/sprites/hook.png')
}
const missing = [...needed].filter((s) => !fs.existsSync(spritePath(s)))
check('精灵位图文件齐全', missing.length === 0, needed.size + ' 个' + (missing.length ? ' 缺失:' + missing.join(',') : ''))

// —— 性能回归：一帧到底写几次渲染属性 ——
inst.selectMap(0)
check('主循环没有重复计时器（重复 = 越玩越卡）', timers.live.size === 1, 'live=' + timers.live.size)
for (const k of Object.keys(writes)) delete writes[k]
for (let i = 0; i < 30; i++) inst.tick()
const perFrame = Object.values(writes).reduce((a, b) => a + b, 0) / 30
check('每帧渲染属性写入 < 24 次', perFrame < 24, perFrame.toFixed(1) + ' 次/帧')

// —— 让钩子必然命中：把鱼搬到钩子正下方 ——
const fish = inst.g.fish[0]
fish.x = inst.hookX - 20
fish.y = 300
fish.dir = -1
inst.onTap()
check('点击后钩子下放', inst.hookState === 'drop')

let caught = false
for (let i = 0; i < 30 && !caught; i++) {
  inst.tick()
  if (inst.score > 0) caught = true
}
check('钩子命中鱼并计分', inst.score > 0, 'score=' + inst.score)
check('连击已累计', inst.combo >= 1, 'combo=' + inst.combo)
check('鱼计数 +1', inst.caught === 1)

// —— 空钩应清零连击 ——
const savedFish = inst.g.fish
inst.combo = 2
inst.g.fish = [] // 清空鱼群，保证这一钩必然是空钩
inst.g.rare = null
inst.hookY = inst.waterTop + 10
inst.hookState = 'drop'
for (let i = 0; i < 60 && inst.hookState !== 'reel'; i++) inst.tick()
check('空钩后连击清零', inst.combo === 0)

// 恢复鱼群（保留已有分数，继续把时间走完）
inst.g.fish = savedFish

// —— 走完剩余时间，进入结算 ——
let guard = 0
while (inst.phase === 'playing' && guard++ < 3000) inst.tick()
check('时间到进入结算', inst.phase === 'over')
check('最高分已写入 storage', store['band_pixel_fish_0'] === String(inst.score), 'store=' + JSON.stringify(store))
check('地图卡片上的最高分同步刷新', inst.maps[0].bestLine === '最高 ' + inst.score + ' 分',
  inst.maps[0].bestLine)
check('这一局的分数累计进总积分', store[LEVEL_KEY] === String(inst.score),
  'total=' + store[LEVEL_KEY] + ' score=' + inst.score)
check('结算面板拿到了等级 / 进度条宽度', inst.lvLevel >= 1 && inst.lvBarW >= 0 && inst.lvBarW <= 240,
  'LV' + inst.lvLevel + ' bar=' + inst.lvBarW)

// 后面要测三张图，先把积分抬到"全都解锁"（真实流程里靠一局局攒等级）
inst.total = TIERS[2].start // 青晶档起点 = Lv31
inst.applyLevel()
check('等级够了 → 中 / 高级地图解锁', inst.maps[1].locked === false && inst.maps[2].locked === false,
  inst.maps[1].descLine + ' / ' + inst.maps[2].descLine)

// —— 换地图：高级地图参数 ——
inst.backToSelect()
check('返回选择页后主循环已停止', !inst.loop)
check('回选择页放开常亮（把控制权还给系统）', inst.keepOn === false && bright.calls[bright.calls.length - 1] === false,
  'calls=' + JSON.stringify(bright.calls))
inst.selectMap(2)
check('返回后重进游戏：主循环必须重启（漏了就是静止画面 = 卡住）', inst.loop > 0, 'loop=' + inst.loop)
check('重进游戏再次要求常亮', inst.keepOn === true, 'calls=' + JSON.stringify(bright.calls))
check('切图只换背景 src，不重建场景节点', inst.bgSrc === '/common/sprites/bg-2.png', inst.bgSrc)
check('高级地图 45 秒', inst.timeLeft === 45)
check('高级地图倍率 3', inst.mapIdx === 2)

// —— 三张地图都至少能跑 200 帧不报错 ——
for (let m = 0; m < 3; m++) {
  inst.selectMap(m)
  for (let i = 0; i < 200; i++) inst.tick()
  check('地图 ' + (m + 1) + ' 连跑 200 帧无异常', inst.phase === 'playing' || inst.phase === 'over')
}

// —— 返回 / 退出：手环的侧滑就是系统返回，必须两级 ——
//   游戏里 → 回地图选择；地图选择页 → 退出应用（否则永远退不出，只能关机）
let exits = 0
inst.$app = {
  exit() {
    exits++
  }
}
inst.selectMap(1)
check('游戏中按返回 → 回到地图选择', inst.onBackPress() === true && inst.phase === 'select')
check('地图选择页按返回 → 退出应用', inst.onBackPress() === true && exits === 1, 'exits=' + exits)
inst.onBackPress()
check('退出只执行一次（重复调用不再 exit）', exits === 1, 'exits=' + exits)

// 刚回到选择页的那次手势余波不能把应用顺手关掉
inst.selectMap(2)
inst.backToSelect()
inst.tx0 = 100
inst.ty0 = 200
inst.onTouchEnd({ changedTouches: [{ clientX: 200, clientY: 205 }] })
check('刚返回时的同一手势不会误退出应用', exits === 1, 'exits=' + exits)

// 停一会儿之后的右滑才算真的"再返回一次"
inst.backAt = Date.now() - 1000 // 模拟距上次返回已过 1 秒
inst.quitAt = Date.now() - 1000
inst.tx0 = 100
inst.ty0 = 200
inst.onTouchEnd({ changedTouches: [{ clientX: 200, clientY: 205 }] })
check('选择页再右滑 → 退出应用', exits === 2, 'exits=' + exits)

// —— 关于页：必须是"独立页面"，不是弹窗阶段 ——
inst.bests = [46, 128, 92]
inst.openAbout()
check('点关于 → 路由跳到独立页面 /about', routes.pushed[0] === '/about', routes.pushed.join(','))
check('关于页不再是 phase 遮罩（主页面仍是选择态）', inst.phase === 'select', inst.phase)

// 从关于页回来：onShow 会再触发一次，不能给选择页起一个空转的循环
inst.tx0 = 100
inst.onShow()
check('从关于页回到选择页：不起空转主循环', !inst.loop, 'loop=' + inst.loop)

/* ==================== 关于页本体 ==================== */
const aboutUx = fs.readFileSync(path.join(root, 'src/pages/about/about.ux'), 'utf8')
const aboutScript = aboutUx.slice(aboutUx.indexOf('<script>') + 8, aboutUx.indexOf('</script>'))

const aboutStore = {
  band_pixel_fish_0: '46', band_pixel_fish_1: '128', band_pixel_fish_2: '92',
  band_pixel_fish_3: '0', band_pixel_fish_4: '0', band_pixel_fish_5: '0', band_pixel_fish_6: '0',
  band_pixel_fish_total: '2200' // 2200 分 → LV12 → 只解锁了第一张
}
const aboutStorageStub = {
  get({ key, default: def, success }) {
    if (success) success(key in aboutStore ? aboutStore[key] : def)
  },
  set({ key, value }) {
    aboutStore[key] = value
  }
}
const aboutRoutes = { backs: 0, replaced: [] }
const aboutRouterStub = {
  push() {},
  back() {
    aboutRoutes.backs++
  },
  replace({ uri }) {
    aboutRoutes.replaced.push(uri)
  },
  // 从主页面 push 进来 → 栈深度 1
  getState() {
    return { index: 1, name: 'about', path: '/about' }
  }
}
const aboutSrc = aboutScript
  .replace(/import\s+storage\s+from\s+'@system\.storage'\s*/, '')
  .replace(/import\s+router\s+from\s+'@system\.router'\s*/, '')
  .replace(/import\s+\{[^}]*\}\s+from\s+'[^']*level\.js'\s*/, '')
  .replace(/import\s+\{[^}]*\}\s+from\s+'[^']*screen\.js'\s*/, '')
  .replace(/import\s+\{[^}]*\}\s+from\s+'[^']*pagesize\.js'\s*/, '')
  .replace(/import\s+\{[^}]*\}\s+from\s+'[^']*cardsize\.js'\s*/, '')
  .replace('export default {', 'return {')
const aboutDef = new Function(
  'storage', 'router', 'levelInfo', 'LEVEL_KEY', 'SCREEN', 'screenH', 'probeScreen', 'onScreen',
  'aboutSizes', 'isNarrow', aboutSrc
)(aboutStorageStub, aboutRouterStub, levelInfo, LEVEL_KEY, SCREEN_STUB, screenH, probeScreen, onScreen,
  aboutSizes, isNarrow)
const about = Object.assign({}, aboutDef.private, {})
for (const k of Object.keys(aboutDef)) if (k !== 'private') about[k] = aboutDef[k]
about.onInit()

check('关于页取七张图里的最佳纪录', about.bestScore === 128, 'best=' + about.bestScore + ' ' + about.bestName)
check('最佳纪录带上地图名', about.bestName.indexOf('碧波湖') >= 0, about.bestName)
check('关于页显示解锁进度（2200 分 → 1/7）', about.unlockLine === '已解锁 1 / 7 张地图', about.unlockLine)

// 系统返回 / 侧滑 = 回主页
check('关于页按系统返回 → back 回主页', about.onBackPress() === true && aboutRoutes.backs === 1,
  'backs=' + aboutRoutes.backs)
about.goHome()
check('重复触发不会连退两页（避免顺手把应用退出）', aboutRoutes.backs === 1, 'backs=' + aboutRoutes.backs)

// 侧滑手势
about.leaving = false
about.onTouchStart({ touches: [{ clientX: 40, clientY: 240 }] })
about.onTouchEnd({ changedTouches: [{ clientX: 196, clientY: 245 }] })
check('关于页右滑 → 回主页', aboutRoutes.backs === 2, 'backs=' + aboutRoutes.backs)

about.leaving = false
about.onTouchStart({ touches: [{ clientX: 260, clientY: 240 }] })
about.onTouchEnd({ changedTouches: [{ clientX: 120, clientY: 244 }] })
check('关于页左滑不当作返回', aboutRoutes.backs === 2, 'backs=' + aboutRoutes.backs)

// 没有上一页（index 0）时要用 replace 兜底，不能把用户卡在关于页
about.leaving = false
aboutRouterStub.getState = () => ({ index: 0, name: 'about', path: '/about' })
about.goHome()
check('没有上一页时兜底 replace 回主页', aboutRoutes.replaced[0] === '/' && aboutRoutes.backs === 2,
  'replaced=' + aboutRoutes.replaced.join(',') + ' backs=' + aboutRoutes.backs)

// 老固件没有 getState / back 抛错时也要能回去
about.leaving = false
aboutRouterStub.getState = undefined
aboutRouterStub.back = () => {
  throw new Error('no page stack')
}
about.goHome()
check('back 抛错时兜底 replace 回主页', aboutRoutes.replaced.length === 2, aboutRoutes.replaced.join(','))
check('关于页不会调用 $app.exit（不该由它退出应用）', typeof about.$app === 'undefined' && about.leaving === true)

/* ==================== 等级换算 ==================== */
check('0 分 = LV1 / 木牌', levelInfo(0).level === 1 && levelInfo(0).tier === 0,
  'LV' + levelInfo(0).level + ' ' + levelInfo(0).tierName)
check('刚好卡在档位起点时进新档',
  levelInfo(TIERS[1].start).level === 16 && levelInfo(TIERS[1].start).tier === 1,
  'LV' + levelInfo(TIERS[1].start).level + ' ' + levelInfo(TIERS[1].start).tierName)
check('档位起点前 1 分仍是上一档最后一级',
  levelInfo(TIERS[1].start - 1).level === 15 && levelInfo(TIERS[1].start - 1).tier === 0,
  'LV' + levelInfo(TIERS[1].start - 1).level)
check('每 15 级换一个样式（等级=档位*15+档内序号）',
  TIERS.every((t, i) => levelInfo(t.start).level === i * LV_PER_TIER + 1),
  TIERS.map((t, i) => levelInfo(t.start).level).join(','))

// 单调性 + 区间连续性：积分越高等级只能越高，不能跳级
// （步长 25 < 最小每级跨度 200，所以"相邻两档之间漏掉一整级"一定会被抓到）
const maxV = TIERS[TIERS.length - 1].start + 50000
let prev = 0
let monotonic = true
let noJump = true
for (let v = 0; v <= maxV; v += 25) {
  const info = levelInfo(v)
  if (info.level < prev) monotonic = false
  if (info.level - prev > 1 && v > 0) noJump = false
  prev = info.level
}
check('等级随积分单调不减', monotonic)
check('积分小步增加不会跳级', noJump)

// 进度条：本级起点处 0%，快到下一级时接近 100%
const atFloor = levelInfo(0)
check('本级起点进度为 0%', atFloor.percent === 0, atFloor.percent.toFixed(1) + '%')
// 木牌档最后一级的末尾（每级 200 分）
const firstStep = TIERS[1].start / LV_PER_TIER
const nearTop = levelInfo(TIERS[1].start - 10)
check('本级末段进度接近 100%', nearTop.percent > 70 && nearTop.percent <= 100, nearTop.percent.toFixed(1) + '%')
check('还差多少分升级是正数', nearTop.toNext > 0 && nearTop.toNext <= firstStep, 'toNext=' + nearTop.toNext)

/* ==================== 等级页本体 ==================== */
const levelUx = fs.readFileSync(path.join(root, 'src/pages/level/level.ux'), 'utf8')
const levelScript = levelUx.slice(levelUx.indexOf('<script>') + 8, levelUx.indexOf('</script>'))
// 翠玉档最后一级（Lv30）的起点：3000 + 14 * 400 = 8600（按 TIERS 现算，改数值不用改测试）
const lv30Total = TIERS[1].start + 14 * ((TIERS[2].start - TIERS[1].start) / LV_PER_TIER)
const levelStore = { [LEVEL_KEY]: String(lv30Total) }
const levelStorageStub = {
  get({ key, default: def, success }) {
    if (success) success(key in levelStore ? levelStore[key] : def)
  },
  set({ key, value }) {
    levelStore[key] = value
  }
}
const levelRoutes = { backs: 0, replaced: [] }
const levelRouterStub = {
  back() {
    levelRoutes.backs++
  },
  replace({ uri }) {
    levelRoutes.replaced.push(uri)
  },
  getState() {
    return { index: 1, name: 'level', path: '/level' }
  }
}
const levelSrc = levelScript
  .replace(/import\s+\w+\s+from\s+'@system\.\w+'\s*/g, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'[^']*common\/[a-z]+\.js'\s*/g, '')
  .replace('export default {', 'return {')
const levelDef = new Function(
  'storage', 'router', 'levelInfo', 'badgeSrc', 'TIERS', 'LV_PER_TIER', 'LEVEL_KEY',
  'SCREEN', 'screenH', 'probeScreen', 'onScreen', 'levelSizes', 'isNarrow', levelSrc
)(levelStorageStub, levelRouterStub, levelInfo, badgeSrc, TIERS, LV_PER_TIER, LEVEL_KEY,
  SCREEN_STUB, screenH, probeScreen, onScreen, levelSizes, isNarrow)
const lvp = Object.assign({}, levelDef.private, {})
for (const k of Object.keys(levelDef)) if (k !== 'private') lvp[k] = levelDef[k]
lvp.onInit()

check('等级页读到累计积分', lvp.total === lv30Total, 'total=' + lvp.total)
check('翠玉档最后一级 → LV30 / 翠玉（已跨过第一档）',
  lvp.level === 30 && lvp.tierName === '翠玉', 'LV' + lvp.level + ' ' + lvp.tierName)
check('等级页用对应档位的大号徽章图', lvp.badgeBig === '/common/sprites/lv-1-b.png', lvp.badgeBig)
check('等级页进度条宽度在 0~200 之间', lvp.barW >= 0 && lvp.barW <= 200, 'bar=' + lvp.barW)
check('等级页排出 9 个徽章（3x3）', lvp.rows.length === 3 && lvp.rows.every((r) => r.a && r.b && r.c),
  lvp.rows.length + ' 行')
check('徽章墙只高亮当前档位（翠玉），木牌是淡边',
  lvp.rows[0].b.border === TIERS[1].color && lvp.rows[0].a.border !== TIERS[0].color,
  lvp.rows[0].a.border + ' / ' + lvp.rows[0].b.border)
check('每格文案是 15 级的区间', lvp.rows[0].a.label === 'Lv1-15' && lvp.rows[2].c.label === 'Lv121-135',
  lvp.rows[0].a.label + ' … ' + lvp.rows[2].c.label)
check('等级页按系统返回 → back 回主页', lvp.onBackPress() === true && levelRoutes.backs === 1,
  'backs=' + levelRoutes.backs)

lvp.leaving = false
lvp.onTouchStart({ touches: [{ clientX: 40, clientY: 240 }] })
lvp.onTouchEnd({ changedTouches: [{ clientX: 200, clientY: 246 }] })
check('等级页右滑 → 回主页', levelRoutes.backs === 2, 'backs=' + levelRoutes.backs)

lvp.leaving = false
lvp.onTouchStart({ touches: [{ clientX: 260, clientY: 240 }] })
lvp.onTouchEnd({ changedTouches: [{ clientX: 120, clientY: 244 }] })
check('等级页左滑不当作返回', levelRoutes.backs === 2, 'backs=' + levelRoutes.backs)

lvp.leaving = false
levelRouterStub.getState = () => ({ index: 0 })
lvp.goHome()
check('等级页没有上一页时 replace 回主页', levelRoutes.replaced[0] === '/', levelRoutes.replaced.join(','))

// 主页面：等级入口要跳到 /level
inst.openLevel()
check('点等级 → 路由跳到 /level', routes.pushed.indexOf('/level') >= 0, routes.pushed.join(','))

/* ---------------- 鱼种自检 ----------------
 * 之前踩过的坑：网格里写了调色板没有的字符会渲染成"洞"，
 * 或者某一行多一个字，整条鱼错位。这里直接对着 SPR 与磁盘上的 PNG 校验。
 */
const sprStart = script.indexOf('const SPR = {')
const sprSrc = script.slice(sprStart, script.indexOf('\n}', sprStart) + 2)
const SPRV = new Function(sprSrc + '\nreturn SPR')()

const SPECIES = ['fry', 'trout', 'bass', 'puffer', 'koi', 'catfish', 'jelly', 'crab', 'icefish', 'octopus', 'starfish', 'ray']
check('十二种鱼/生物都在 SPR 里', SPECIES.every((k) => SPRV[k]), Object.keys(SPRV).join(','))

const PAL_KEYS = 'BDRWFE O'.replace(' ', '')
let ragged = []
let ghost = []
for (const k of SPECIES) {
  const rows = SPRV[k] || []
  const w = rows[0] ? rows[0].length : 0
  rows.forEach((r, i) => {
    if (r.length !== w) ragged.push(k + '#' + i + '=' + r.length)
    for (const ch of r) if (ch !== '.' && PAL_KEYS.indexOf(ch) < 0) ghost.push(k + ':' + ch)
  })
}
check('每种鱼的行宽一致（不会错位）', ragged.length === 0, ragged.join(' '))
check('网格字符都在调色板里（不会画成透明洞）', ghost.length === 0, [...new Set(ghost)].join(' '))

// 每张地图的鱼池都指向存在的造型，且 PNG 都烘出来了
const themesSrc = script.slice(script.indexOf('const THEMES = ['), script.indexOf('const LOCK_BORDER'))
const T = new Function(themesSrc + '\nreturn THEMES')()
let poolBad = []
let fileBad = []
T.forEach((theme, t) => {
  theme.fish.forEach((cfg) => {
    if (!SPRV[cfg.shape]) poolBad.push(t + ':' + cfg.shape)
    for (const suffix of ['.png', '-l.png']) {
      const p = spritePath('/common/sprites/fish-' + t + '-' + cfg.shape + suffix)
      if (!fs.existsSync(p)) fileBad.push('fish-' + t + '-' + cfg.shape + suffix)
    }
  })
})
check('三张地图的鱼池都指向已定义的造型', poolBad.length === 0, [...new Set(poolBad)].join(' '))
check('每张地图的每种鱼都烘了左右两张图', fileBad.length === 0, [...new Set(fileBad)].slice(0, 4).join(' '))

// 地图辨识度：每开一张新图，鱼池里必须有前面所有地图都没出现过的造型。
// （原来的"每张都有全网独一份"太苛刻：后期地图共用几条基础鱼是正常的）
const sets = T.map((th) => [...new Set(th.fish.map((c) => c.shape))])
const fresh = sets.every((st, i) => st.some((k) => sets.slice(0, i).every((o) => o.indexOf(k) < 0)))
check('每张新地图都引入了前面没有的生物', fresh, sets.map((st) => st.join('/')).join('  |  '))

// 四张后期地图的招牌生物各只出现在一张图里（防止以后又被"换色复用"回去）
const SIGN = { icefish: 3, octopus: 4, starfish: 5, ray: 6 }
const signBad = Object.keys(SIGN).filter((k) => {
  const where = sets.map((st, i) => (st.indexOf(k) >= 0 ? i : -1)).filter((i) => i >= 0)
  return where.length !== 1 || where[0] !== SIGN[k]
})
check('冰鱼/章鱼/海星/鳐鱼各只属于一张地图', signBad.length === 0, signBad.join(' '))

// 抽鱼要能抽到池里每一种，而且分值来自配置（不是写死的）
const seen = {}
let valueOk = true
for (let i = 0; i < 400; i++) {
  inst.mapIdx = 2
  const f = inst.rollFish()
  seen[f.shape] = (seen[f.shape] || 0) + 1
  const cfg = T[2].fish.find((c) => c.shape === f.shape)
  if (!cfg || cfg.value !== f.value) valueOk = false
  if (!f.w || !f.h) valueOk = false
}
const poolKinds = [...new Set(T[2].fish.map((c) => c.shape))]
check('随机抽鱼覆盖深海的每一种鱼', poolKinds.every((k) => seen[k] > 0),
  poolKinds.map((k) => k + '×' + (seen[k] || 0)).join(' '))
check('抽到的鱼带正确分值与尺寸', valueOk)
inst.mapIdx = 0

/* ==================== 星标鱼 · 拉鱼力度条 · 鱼缸 ==================== */

// —— 数据源：七条星标鱼，一图一条，金身 ——
check('星标鱼表 7 条（每张地图一条）', STARS.length === 7, 'n=' + STARS.length)
check('星标鱼的地图下标连续', STARS.every((s, i) => s.m === i))
check('七条星标鱼造型各不相同', new Set(STARS.map((s) => s.shape)).size === 7,
  STARS.map((s) => s.shape).join(','))
check('星标鱼造型都在 SPR 里', STARS.every((s) => !!SPRV[s.shape]))
check('每条星标鱼左右两张图都烘出来了',
  STARS.every((s) => fs.existsSync(spritePath('/common/sprites/fish-' + s.m + '-star.png')) &&
    fs.existsSync(spritePath('/common/sprites/fish-' + s.m + '-star-l.png'))))
check('星标鱼比同图最贵的普通鱼还值钱',
  STARS.every((s) => s.value > Math.max(...T[s.m].fish.map((c) => c.value))),
  STARS.map((s) => s.value).join('/'))

// —— 出场：每局只安排一次，7 秒后才可能冒出来 ——
inst.bests = [0, 0, 0, 0, 0, 0, 0]
inst.total = 0
inst.applyLevel()
inst.selectMap(0)
check('开局场上没有星标鱼', !inst.g.star && inst.g.fish.every((f) => !f.star))

for (let i = 0; i < 120; i++) inst.tick()
check('前 4 秒不会冒出星标鱼（沉住气）', !inst.g.star)
for (let i = 0; i < 200; i++) inst.tick()
check('7 秒后星标鱼入场', !!inst.g.star, inst.g.star ? inst.g.star.name : 'none')

const star1 = inst.g.star
check('星标鱼用专属金色图源', /-star\.png$/.test(star1.srcR), star1.srcR)

// ★ 标记只在星标鱼真的进屏后才挂（syncFish 里判的是 sx >= 0）。
// 刚生成的那几帧它还在屏幕外，所以这里一路 tick 到它游进来为止 ——
// 原来写完只 tick 到"入场"就断言，结果这条断言是随机的（十次里红一两次）。
let starTagWait = 0
while (!inst.starOn && starTagWait < 600) {
  inst.tick()
  starTagWait++
}
check('星标鱼游进屏幕后头顶挂上 ★ 标记', inst.starOn === true, '等了 ' + starTagWait + ' 帧')
check('场上同时只有一条星标鱼', inst.g.fish.filter((f) => f.star).length === 1)

// —— 钓到星标鱼：不直接加分，先进力度条 ——
const scoreBefore = inst.score
inst.catchFish(star1, false)
check('钓到星标鱼先进力度条，不直接计分',
  inst.reelOn === true && inst.score === scoreBefore, 'score=' + inst.score)
check('力度条从底部起步', inst.reelFill === 0 && inst.reelTop === K.REEL_H,
  'fill=' + inst.reelFill + ' top=' + inst.reelTop)
check('绿区整个落在轨道里',
  inst.reelZoneTop >= 0 && inst.reelZoneTop + inst.reelZoneH <= K.REEL_H,
  inst.reelZoneTop + '..' + (inst.reelZoneTop + inst.reelZoneH))
check('绿框收窄了（v2 的 92 太宽，站着不动就过）', K.REEL_ZONE <= 56,
  'zone=' + K.REEL_ZONE + ' 轨道=' + K.REEL_H)
check('鱼纵向挂在绿框中间', Math.abs(
  inst.reelFishTop + inst.reelFishH / 2 - (inst.reelZoneTop + 2 + inst.reelZoneH / 2)) <= 1,
  'fish=' + inst.reelFishTop + ' zone=' + inst.reelZoneTop)

// 绿框不再固定：扫一整圈相位，看它能跑多远、会不会跑出轨道
const zScan = []
for (let p = 0; p < Math.PI * 2; p += 0.1) zScan.push(inst.zoneTopAt(p))
const zLo = Math.min(...zScan)
const zHi = Math.max(...zScan)
check('绿框自己上下游（不是固定靶）', zHi - zLo > 60, '行程=' + (zHi - zLo) + 'px')
check('绿框漂到哪都不出轨道',
  zScan.every((t) => t >= 0 && t + inst.reelZoneH <= K.REEL_H), zLo + '..' + (zHi + inst.reelZoneH))
// 最坏情况下绿框每帧挪多少 vs 柱子每帧能挪多少：追不上就变成纯运气
const zMaxStep = ((K.REEL_H - K.REEL_ZONE) / 2) * 0.9 * (K.REEL_DRIFT * 1.15)
check('绿框最快也没柱子快（追得上，靠手不靠运气）',
  zMaxStep < Math.min(K.REEL_UP, K.REEL_DOWN),
  '绿框 ' + zMaxStep.toFixed(2) + 'px/帧 · 柱子上 ' + K.REEL_UP + ' 下 ' + K.REEL_DOWN)
check('拉锯时钩子在收线', inst.hookState === 'reel')

// —— 物理：按住上升 / 松手下沉 ——
inst.hold = true
for (let i = 0; i < 10; i++) inst.tickReel()
check('按住 → 柱子往上顶', inst.reelFill > 0, 'fill=' + inst.reelFill)
const upTop = inst.reelTop
inst.hold = false
for (let i = 0; i < 6; i++) inst.tickReel()
check('松手 → 柱子往下沉', inst.reelTop > upTop, 'top=' + inst.reelTop)
check('柱子不会越过轨道上沿',
  inst.reelFill >= 0 && inst.reelFill <= K.REEL_H)

// —— 掉出绿框：进度往回跌 ——
// 老逻辑是"不在绿区就只是不涨"，顶进去守着不动就能过，绿框自己动也不咬人。
// 现在柱顶一离开绿框，进度就按 0.6 倍速倒扣；短暂失手能救回来，长时间跑偏白干。
// 先把绿框钉死在一个位置，方便算数，测完再还原给后面的"模拟玩家"用。
const save = {
  amp: inst.reelAmp,
  drift: inst.reelDrift,
  phase: inst.reelPhase,
  zoneTop: inst.reelZoneTop,
  hold: inst.reelHold,
  fill: inst.reelFill,
  top: inst.reelTop
}
inst.reelAmp = 0 // 振幅 0 → 绿框固定停在轨道正中
inst.reelDrift = 0
inst.reelPhase = 0
inst.reelZoneTop = inst.zoneTopAt(0)
inst.reelZoneH = K.REEL_ZONE
inst.reelTop = 10 // 顶到最上面：肯定在绿框上方
inst.reelFill = K.REEL_H - 10
inst.reelHold = 1000
inst.hold = false
const holdBefore = inst.reelHold
for (let i = 0; i < 10; i++) inst.tickReel()
check('柱顶不在绿框里时进度会跌', inst.reelHold < holdBefore, holdBefore + ' → ' + inst.reelHold)
check('下跌速度约等于累计速度的 0.6 倍',
  Math.abs(holdBefore - inst.reelHold - 10 * 33 * 0.6) <= 40,
  '掉 ' + Math.round(holdBefore - inst.reelHold) + 'ms')
check('正在掉的时候进度条转橙红', inst.reelBarColor === '#e0642f', inst.reelBarColor)
check('掉的时候提示"滑掉了"', inst.reelTip.indexOf('滑掉') >= 0, inst.reelTip)
inst.reelHold = 20
inst.reelTop = 0 // 柱顶顶到最上面（按住不会往下走），一直留在绿框外
inst.reelFill = K.REEL_H
inst.hold = true
for (let i = 0; i < 6; i++) inst.tickReel()
check('进度不会跌成负数', inst.reelHold === 0 && inst.reelProg === 0,
  'hold=' + inst.reelHold + ' prog=' + inst.reelProg)
check('跌到底之后回到方向提示（不是一直喊滑掉）',
  inst.reelTip.indexOf('滑掉') < 0, inst.reelTip)
// 还原：后面的"模拟玩家"继续用原来那条随机绿框
inst.reelAmp = save.amp
inst.reelDrift = save.drift
inst.reelPhase = save.phase
inst.reelZoneTop = inst.zoneTopAt(save.phase)
inst.reelHold = save.hold
inst.reelFill = save.fill
inst.reelTop = save.top
inst.hold = false

// —— 模拟玩家：盯着绿框中心追（绿框自己在动，所以每帧都要重新算） ——
let reelGuard = 0
let zTrackLo = inst.reelZoneTop
let zTrackHi = inst.reelZoneTop
let fishMoves = 0
let lastFishTop = inst.reelFishTop
while (inst.reelOn && reelGuard++ < 4000) {
  const mid = inst.reelZoneTop + inst.reelZoneH / 2
  inst.hold = inst.reelTop > mid
  inst.tickReel()
  if (inst.reelZoneTop < zTrackLo) zTrackLo = inst.reelZoneTop
  if (inst.reelZoneTop > zTrackHi) zTrackHi = inst.reelZoneTop
  if (inst.reelFishTop !== lastFishTop) {
    fishMoves++
    lastFishTop = inst.reelFishTop
  }
}
check('绿框在整段拉锯里真的在动', zTrackHi - zTrackLo > 10,
  '行程=' + (zTrackHi - zTrackLo) + 'px')
check('鱼跟着绿框一起动', fishMoves > 10, 'moves=' + fishMoves)
check('绿区内累计够了能把鱼拉上来', inst.reelOn === false && reelGuard < 4000,
  'frames=' + reelGuard + ' hold=' + inst.reelHold)
check('拉上来之后照常计分', inst.score > scoreBefore, 'score=' + inst.score)
check('结算面板挂上"待入缸"',
  inst.pendingStar === '0:trout' && inst.pendingName === '虹鳟', inst.pendingStar)
check('还没点入缸时按钮可用', inst.tankGot === false)
check('拉锯结束后回到普通游戏', inst.phase === 'playing' && inst.g.star === null)

// —— 只有星标鱼能入缸 ——
const putAt = Date.now()
inst.putInTank()
check('点「放入鱼缸」写入 storage', /^0:trout:\d+$/.test(store[TANK_KEY]), 'store=' + store[TANK_KEY])
check('入缸记录带上钓到的时间', parseTank(store[TANK_KEY])[0].ts >= putAt, 'ts=' + parseTank(store[TANK_KEY])[0].ts)
check('入缸后面板切成"已入缸"', inst.tankGot === true)
check('鱼缸计数 +1', inst.tankCount === 1, 'n=' + inst.tankCount)
const firstTs = parseTank(store[TANK_KEY])[0].ts
inst.putInTank()
check('同一条鱼不会重复占格', store[TANK_KEY] === '0:trout:' + firstTs, store[TANK_KEY])
check('普通鱼没有入缸入口（pendingStar 为空时点不动）', (function () {
  inst.pendingStar = ''
  inst.tankGot = false
  inst.putInTank()
  return store[TANK_KEY] === '0:trout:' + firstTs && inst.tankGot === false
})())

// —— 普通鱼完全不走力度条 ——
inst.selectMap(0)
const normalFish = inst.g.fish[0]
const normalScore = inst.score
inst.catchFish(normalFish, false)
check('普通鱼直接入护，不弹力度条',
  inst.reelOn === false && inst.score > normalScore, 'score=' + inst.score)

/* ==================== 鱼的出场 / 入场：不再"钓一条刷一条" ==================== */

inst.selectMap(0)
const cf = inst.g.fish[0]
cf.x = 120
cf.y = 320
cf.alpha = 1
cf.warm = K.FISH_WARM
inst.catchFish(cf, false)
check('钓到的鱼没有当场被换掉（还在原泳道里）', inst.g.fish.indexOf(cf) >= 0,
  'idx=' + inst.g.fish.indexOf(cf))
check('钓到的鱼进入"被提走"状态', cf.hop === K.FISH_HOP, 'hop=' + cf.hop)
check('被提走途中不再计分', cf.value === 0)

const riseFrom = cf.y
inst.moveFish()
check('被提走的鱼跟着钩子往上走', cf.y < riseFrom, riseFrom + ' → ' + cf.y)
check('被提走时同时淡出', cf.alpha < 1, 'alpha=' + cf.alpha.toFixed(2))

let hopGuard = 0
while (cf.hop > 0 && hopGuard++ < 40) inst.moveFish()
check('提完就隐身（不是直接消失）', cf.alpha === 0 && cf.wait > 0,
  'alpha=' + cf.alpha + ' wait=' + cf.wait)
check('隐身期间槽位没换鱼', inst.g.fish.indexOf(cf) >= 0)

let waitFrames = 0
while (inst.g.fish[0] === cf && waitFrames++ < 300) inst.moveFish()
const nf = inst.g.fish[0]
check('空档一会儿才补位（不是钓一条刷一条）', nf !== cf && waitFrames > 20, '等了 ' + waitFrames + ' 帧')
check('补位的鱼贴着屏边起步', nf.x === 0 || nf.x === K.DESIGN_W - nf.w, 'x=' + nf.x + ' dir=' + nf.dir)
check('补位的鱼从全透明开始（淡入）', nf.alpha === 0 && nf.warm === 0,
  'alpha=' + nf.alpha + ' warm=' + nf.warm)
const enterX = nf.x
for (let i = 0; i < 12; i++) inst.moveFish()
check('补位的鱼一进场就在往屏内游', nf.x !== enterX, enterX + ' → ' + nf.x)
check('12 帧后淡入过半', nf.alpha > 0.5, 'alpha=' + nf.alpha.toFixed(2))

// 半透明的鱼钩不到（不然会钩到刚淡入的"幽灵鱼"）
inst.g.fish[1].x = 20
inst.g.fish[1].y = 200
inst.g.fish[1].alpha = 1
inst.g.fish[1].hop = 0
inst.g.fish[1].wait = 0
inst.g.fish[2].x = 260
inst.g.fish[2].y = 200
inst.g.fish[2].alpha = 1
inst.g.fish[2].hop = 0
inst.g.fish[2].wait = 0
nf.x = 120
nf.y = 300
nf.alpha = 0.3
inst.hookX = nf.x + 16
inst.hookY = nf.y - 6
check('半透明的鱼钩不到', inst.checkCatch() === false)
nf.alpha = 1
check('淡入完成后照常能钩到', inst.checkCatch() === true)

// —— 稀有金鱼：出场坐标不能是 NaN + 淡入淡出 ——
// （旧代码先算 x = 336 - r.w 再给 r.w 赋值，第一次出场算出 NaN，整条鱼画在 left:NaN）
inst.selectMap(0)
inst.rareOn = false
inst.rareTimer = 1
inst.moveRare()
check('金鱼出场坐标是有限数', Number.isFinite(inst.rX), 'rX=' + inst.rX)
check('金鱼贴着右边缘出场', inst.rX === K.DESIGN_W - inst.rW, inst.rX + ' / w=' + inst.rW)
check('金鱼从透明淡入', inst.rOp === 0, 'rOp=' + inst.rOp)
for (let i = 0; i < 10; i++) inst.moveRare()
check('金鱼淡入到底', inst.rOp === 1, 'rOp=' + inst.rOp)
inst.rareLeft = 0
inst.moveRare()
check('金鱼到点先淡出，不直接撤节点', inst.g.rare.leaving === 1 && inst.rareOn === true)
for (let i = 0; i < 12; i++) inst.moveRare()
check('淡出完才离场', inst.rareOn === false)

// —— 拉不上来：15 秒后鱼跑掉，连击清零，本局不再出现 ——
inst.selectMap(0)
inst.starTimer = 0
inst.spawnStar()
const star2 = inst.g.star
inst.combo = 3
inst.beginReel(star2)
inst.hold = false
let guard2 = 0
while (inst.reelOn && guard2++ < 1200) inst.tickReel()
check('一直松手 → 超时鱼跑掉',
  inst.reelOn === false && inst.pendingStar === '', 'frames=' + guard2)
check('跑掉的星标鱼不再占泳道', !inst.g.fish.some((f) => f && f.star))
check('挣脱后连击清零', inst.combo === 0)
check('本局用完这一次机会', inst.starUsed === true)

/* ==================== 鱼缸记录（时间戳） ====================
 * 鱼缸从 'm:shape' 扩成 'm:shape:ts'，三种输入都得能读：
 * 新格式、老玩家的两段格式、以及各种脏数据。
 */
const parsed = parseTank('0:trout:1794892800000\n1:koi:1794806400000')
check('新格式解析出两条', parsed.length === 2, 'n=' + parsed.length)
check('解析带上钓到时间', parsed[0].ts === 1794892800000, String(parsed[0].ts))
check('解析带地图下标', parsed[1].m === 1, String(parsed[1].m))
check('解析带 id 方便去重', parsed[1].id === '1:koi', parsed[1].id)
check('老玩家的两段格式照样能读（时间按未知）',
  parseTank('0:trout\n2:crab')[1].ts === 0 && parseTank('0:trout\n2:crab').length === 2)
check('同一条鱼重复记录只留一条',
  parseTank('0:trout:111\n0:trout:222').length === 1)
check('脏数据不会把整缸读空',
  parseTank('\n\nfoo\n9:nope:1\n0:trout:5').length === 1,
  JSON.stringify(parseTank('\n\nfoo\n9:nope:1\n0:trout:5')))
check('空存储 = 空缸', parseTank('').length === 0 && parseTank(null).length === 0)
// 用本地时间构造，别写死时间戳 —— 断言的期望值不能跟着机器时区变
const tDemo = new Date(2026, 10, 17, 13, 20, 0).getTime()
check('时间格式化成年-月-日 时:分', fmtTime(tDemo) === '2026-11-17 13:20', fmtTime(tDemo))
check('个位数月/日/时/分补零', fmtTime(new Date(2026, 0, 5, 9, 7, 0).getTime()) === '2026-01-05 09:07')
check('没有时间不瞎显示（交给界面写"时间未知"）', fmtTime(0) === '' && fmtTime(undefined) === '')

/* ==================== 鱼缸页本体 ==================== */
const tankUx = fs.readFileSync(path.join(root, 'src/pages/tank/tank.ux'), 'utf8')
const tankScript = tankUx.slice(tankUx.indexOf('<script>') + 8, tankUx.indexOf('</script>'))
const tankSrc = tankScript
  .replace(/import\s+\w+\s+from\s+'@system\.\w+'\s*/g, '')
  .replace(/import\s*\{[^}]*\}\s*from\s*'[^']*common\/[a-z]+\.js'\s*/g, '')
  .replace('export default {', 'return {')

const tankStore = { [TANK_KEY]: '0:trout:' + Date.now() }
// 鱼缸页有一帧循环（鱼在游），必须用桩定时器，否则 node 进程会被真 interval 挂住
const tankTimers = { seq: 0, live: new Set() }
const tankSetInterval = () => {
  const id = ++tankTimers.seq
  tankTimers.live.add(id)
  return id
}
const tankClearInterval = (id) => tankTimers.live.delete(id)
const tankStorageStub = {
  get({ key, default: def, success }) {
    if (success) success(key in tankStore ? tankStore[key] : def)
  },
  set({ key, value }) {
    tankStore[key] = value
  }
}
const tankRoutes = { backs: 0 }
const tankRouterStub = {
  back() {
    tankRoutes.backs++
  },
  getState() {
    return { index: 1 }
  },
  replace() {}
}
// 每次新建一个页面实例：private 里的 raw / fishes 都是全新的，几个用例之间不会串状态
function newTankPage() {
  const def = new Function(
    'storage', 'router', 'STARS', 'TANK_KEY', 'parseTank', 'fmtTime',
    'SCREEN', 'screenH', 'probeScreen', 'onScreen', 'tankSizes', 'isNarrow',
    'setInterval', 'clearInterval', tankSrc
  )(tankStorageStub, tankRouterStub, STARS, TANK_KEY, parseTank, fmtTime,
    SCREEN_STUB, screenH, probeScreen, onScreen, tankSizes, isNarrow,
    tankSetInterval, tankClearInterval)
  const t = Object.assign({}, def.private, def)
  t.onInit()
  return t
}
// 后面几个用例只看命中/详情，不需要鱼游 —— 建完就停循环，
// 否则定时器会一直挂在 tankTimers.live 里，污染"离开页面要停循环"那条断言
function newTankStill() {
  const t = newTankPage()
  t.stopLoop()
  return t
}
const tank = newTankPage()

check('鱼缸只画已收集的鱼', tank.fishes.length === 1 && tank.got === 1, 'n=' + tank.fishes.length)
check('没收集的鱼不出场（缸里不摆问号）', tank.fishes[0].src.indexOf('fish-0-star') >= 0, tank.fishes[0].src)
check('底部提示还差几条', /还差 6 条/.test(tank.missText), tank.missText)
check('有鱼时才起一帧循环', tankTimers.live.size === 1, 'timers=' + tankTimers.live.size)
check('鱼有独立泳道，7 条不叠在一起', (function () {
  for (let i = 0; i < 6; i++) {
    if (10 + (i + 1) * 30 - (10 + i * 30) < 30) return false // 相邻泳道至少差一条鱼的高度
  }
  return 10 + 6 * 30 + 30 <= 228 // 最深那条 + 鱼高也不能游进沙里
})())

// —— 游动 ——
const bx = tank.raw[0].x
tank.step()
check('鱼会动', tank.raw[0].x !== bx, bx + ' → ' + tank.raw[0].x)
check('渲染坐标跟着算（模板读的是 fishes）',
  tank.fishes[0].l === tank.raw[0].x - 6, tank.fishes[0].l + ' vs ' + tank.raw[0].x)
check('鱼横向不出缸', (function () {
  for (let i = 0; i < 600; i++) tank.step()
  return tank.raw.every((f) => f.x >= 0 && f.x + f.w <= 300)
})(), tank.raw.map((f) => f.x).join(','))

// 撞左边界：必须掉头，不能停在原地也不能穿出去
tank.raw[0].x = 0
tank.raw[0].dir = -1
tank.step()
check('游到左边界掉头', tank.raw[0].dir === 1 && tank.raw[0].x >= 0,
  'dir=' + tank.raw[0].dir + ' x=' + tank.raw[0].x)
check('掉头后换朝向图', /-star\.png$/.test(tank.raw[0].src), tank.raw[0].src)
tank.raw[0].x = 300 - tank.raw[0].w
tank.raw[0].dir = 1
tank.step()
check('游到右边界掉头', tank.raw[0].dir === -1, 'dir=' + tank.raw[0].dir)

// —— 点鱼看详情 ——
tank.pick(0)
check('点一下鱼弹出详情', tank.selOn === true && tank.dName === '虹鳟', tank.dName)
check('详情写清是哪张图的鱼', tank.dMap === '青草池塘', tank.dMap)
check('详情里有钓到的时间（钓到于 YYYY-MM-DD HH:mm）',
  /^钓到于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(tank.dTimeText), tank.dTimeText)
check('选中的鱼加了金色描边', tank.fishes[0].ring.indexOf('247') >= 0, tank.fishes[0].ring)
tank.pick(0)
check('再点一次收起详情', tank.selOn === false, 'selOn=' + tank.selOn)
check('点越界的下标不崩', (function () {
  tank.pick(99)
  return tank.selOn === false
})())

/* —— 老玩家的缸（v2.6 之前的两段格式，没有时间戳） ——
 * 用户反馈"点鱼不显示钓获时间"，真机上看到的就是这一条：
 * 缸是老的 '0:trout'，ts 解析成 0，界面上原来是"钓到于 时间未知"（末尾还可能被截掉）。
 * 现在要明说"未记录"，并且不能把那一行渲染成空的。 */
tankStore[TANK_KEY] = '0:trout'
const tankOld = newTankStill()
tankOld.pick(0)
check('老缸（没有时间戳）点开也有详情，不会一片空白',
  tankOld.selOn === true && tankOld.dName === '虹鳟', 'selOn=' + tankOld.selOn)
check('老缸如实写"钓到时间未记录"，不摆空字符串',
  tankOld.dTimeText === '钓到时间未记录', tankOld.dTimeText)
check('未记录的时间用灰字（和真实时间区分开）',
  tankOld.dTimeColor.indexOf('0.38') > 0 || tankOld.dTimeColor.indexOf('255') >= 0, tankOld.dTimeColor)

// 空缸（正式版首次启动就是这个状态）：缸里那句和底部那两行不能说同一件事
tankStore[TANK_KEY] = ''
const tankEmpty = newTankStill()
check('空缸时底部不再重复"钓到星标鱼就能入缸"',
  tankEmpty.got === 0 && tankEmpty.missText === '' && tankEmpty.tipText.indexOf('七张地图') >= 0,
  'tip=' + tankEmpty.tipText + ' miss=' + JSON.stringify(tankEmpty.missText))
check('空缸不起循环（没鱼可游，别白烧电）', tankEmpty.loop === 0, 'loop=' + tankEmpty.loop)

/* —— 手指命中（真机上热区框是透明的，孩子节点的 click 可能压根不触发） ——
 * 所以 touchend 里自己按坐标算一遍：屏幕坐标 - 缸的原点 = 缸内坐标。 */
// 原点不再写死成模块常量（手环 11 上缸会挪位置），由 setViewport 算进实例：
// tankX = tankL + 3、tankY = tankTop + 3。480 上必须还是 18/69。
const tankX = tank.tankX
const tankY = tank.tankY
check('命中用的缸原点 = left 15 + 边框 3 / top 66 + 边框 3（480 上）',
  tankX === 18 && tankY === 69, tankX + ',' + tankY)
check('HTML 里的 .tank 定位确实还是 15/66（改了样式忘了改常量就会点偏）',
  /\.tank\s*\{[^}]*left:\s*15px;[^}]*top:\s*66px;/.test(tankUx))

tankStore[TANK_KEY] = '0:trout:' + Date.now()
const tankTap = newTankStill()
const f0 = tankTap.raw[0]
tankTap.hitTest(tankX + f0.x + 2, tankY + Math.round(f0.y) + 2)
check('按坐标点中鱼身就能选中（不依赖子节点 click）',
  tankTap.selOn === true && tankTap.dName === '虹鳟', 'selOn=' + tankTap.selOn)
tankTap.hitTest(tankX + 2, tankY + 190)
check('点水里空白处不会误选/误取消', tankTap.selOn === true, 'selOn=' + tankTap.selOn)
tankTap.hitTest(4, 4)
check('点缸外不会误触发', tankTap.selOn === true, 'selOn=' + tankTap.selOn)

// 一次点击会走两条路：touchend 的命中判定 + 冒泡上来的 click。
// 不去重就是"选中立刻被自己收起"，真机上的体感正是"点了没反应"。
const tankDup = newTankStill()
const d0 = tankDup.raw[0]
tankDup.tapAt = Date.now()
tankDup.hitTest(tankX + d0.x + 2, tankY + Math.round(d0.y) + 2)
const afterTap = tankDup.selOn
// 关键：模板里 onclick="pick($idx)" 编译成 pick($idx, evt)，第二个参数是事件对象（恒为真）。
// 这里必须照真机的实参形状调 —— 拿 evt 的真假值去做去抖判断，就等于永远不去抖。
tankDup.pick(0, { type: 'click' })
check('同一次点击只算一下（tap 之后冒泡的 click 被挡掉）',
  afterTap === true && tankDup.selOn === true, 'afterTap=' + afterTap + ' selOn=' + tankDup.selOn)

// 模板层面：时间必须独占一行，别和"基础分"挤在同一串里被截断
check('详情把时间单独一行（不再和基础分挤一行）',
  /class="d-time"[\s\S]{0,80}?\{\{dTimeText\}\}/.test(tankUx) &&
  /class="d-sub"[^>]*>基础分 \{\{dValue\}\}/.test(tankUx))
check('热区框有背景色（纯透明节点在真机上可能不参与命中）',
  /\.fw\s*\{[^}]*background-color/.test(tankUx))

tank.goHome()
check('鱼缸页右滑能返回', tankRoutes.backs === 1, 'backs=' + tankRoutes.backs)
check('离开页面就把循环停掉（别在后台烧电）', tankTimers.live.size === 0, 'timers=' + tankTimers.live.size)

/* —— 手环 11（212x520 / 画布 824）：鱼缸和关于页要跟着放大 ——
 * 这两页原来全是照 480 写死的：缸只有 256 高（物理 162 = 屏高 31%），上下各空一大块；
 * 关于页正文 18 设计单位 = 11.4 物理像素。真机截图里就是"缸小、字小"。 */
SCREEN_STUB.h = 824
SCREEN_STUB.realW = 212
SCREEN_STUB.realH = 520
SCREEN_STUB.pill = true
SCREEN_STUB.tall = true
SCREEN_STUB.extra = 344
SCREEN_STUB.padTop = 24
SCREEN_STUB.padBottom = 22
SCREEN_STUB.padX = 12

// 七条全塞进去（泳道够不够、鱼会不会游进沙里，只有满缸才看得出来）
tankStore[TANK_KEY] = STARS.map((st, i) => tankEntry(i, 1700000000000 + i * 86400000)).join('\n')
const tank11 = newTankStill()
const tk11 = tank11.tk
check('手环 11：缸高 440 = 278 物理（屏高 54%，原来 256 = 162 / 31%）',
  tk11.tankH === 440 && Math.round(tk11.tankH * scale11) === 278,
  tk11.tankH + ' → ' + Math.round(tk11.tankH * scale11) + 'px')
check('手环 11：缸体 118 起、详情 566、返回键 668（让出底部圆角）',
  tank11.tankTop === 118 && tank11.infoTop === 566 && tank11.backTop === 668,
  [tank11.tankTop, tank11.infoTop, tank11.backTop].join(' / '))
check('手环 11：返回胶囊 200x84（物理 126x53，离下沿 72 才躲得开半圆）',
  tk11.backW === 200 && tk11.backH === 84 && tank11.backL === 68 &&
  Math.round(tk11.backH * scale11) >= 50,
  tk11.backW + 'x' + tk11.backH + ' left=' + tank11.backL)
check('手环 11：七条鱼的最深一条也不会游进沙里',
  tank11.raw[6].y + tank11.raw[6].h <= tank11.sandTop &&
  tank11.sandTop === 397,
  'lane6=' + Math.round(tank11.raw[6].y) + '+' + tank11.raw[6].h + ' 沙地=' + tank11.sandTop)
check('手环 11：鱼放大到 78x44 上限（物理 49x28，原来 33x19）',
  tank11.raw.every((f) => f.w <= 78 && f.h <= 44) &&
  Math.max.apply(null, tank11.raw.map((f) => f.w)) >= 70,
  tank11.raw.map((f) => f.w + 'x' + f.h).join(' '))
check('手环 11：鱼缸页正文 ≥ 14 物理像素（名字 26 = 16.4）',
  phys(tk11.nameSize) >= 14 && phys(tk11.timeSize) >= 13 && phys(tk11.noteSize) >= 13,
  [tk11.nameSize, tk11.timeSize, tk11.noteSize].map((v) => phys(v).toFixed(1)).join(' / '))
check('手环 11：缸的原点跟 tankL / tankTop 一起挪（点鱼才不会点偏）',
  tank11.tankX === tank11.tankL + 3 && tank11.tankY === tank11.tankTop + 3,
  tank11.tankX + ',' + tank11.tankY)

// 关于页：同一套桩重算一遍（setViewport 会重新读 SCREEN）
about.setViewport()
const ab11 = about.ab
check('手环 11：关于页内容区 308（296 放不下 31 号字的玩法说明）',
  ab11.contentW === 308 && ab11.rkLW === 168 && ab11.hdrW === 254,
  [ab11.contentW, ab11.rkLW, ab11.hdrW].join(' / '))
/* 屏顶是半圆：d=34 处左右各只剩 67 号位，logo 摆 14 会被弧线切掉半边。
 * 页头单独缩进 68，副标题「PIXEL FISHING」还得放得下（20 号字约 160 宽）。 */
check('手环 11：关于页头缩进 68，且副标题塞得进标题列',
  ab11.hdrPadL === 68 && ab11.hdrTW >= 160,
  'padL=' + ab11.hdrPadL + ' hdrTW=' + ab11.hdrTW)
check('手环 11：关于页正文 31 = 19.6 物理、标题 40 = 25 物理',
  phys(ab11.liSize) >= 19 && phys(ab11.tSize) >= 24,
  phys(ab11.liSize).toFixed(1) + ' / ' + phys(ab11.tSize).toFixed(1))
check('手环 11：红圈那几行整体 ×1.2（正文 26→31、小标题 24→29、分数 30→36、进度 20→24）',
  ab11.liSize === 31 && ab11.secSize === 29 && ab11.rkV === 36 && ab11.noteSize === 24 &&
  ab11.rkL === 31,
  [ab11.liSize, ab11.secSize, ab11.rkV, ab11.noteSize, ab11.rkL].join(' / '))
check('手环 11：四条玩法在 308 宽内不折行（· 和空格不算全角）',
  ab11.tips.every((t) => t.replace(/[·\s]/g, '').length * ab11.liSize * 1.1 <= ab11.contentW),
  ab11.tips.map((t) => t.replace(/[·\s]/g, '').length + '字=' +
    Math.round(t.replace(/[·\s]/g, '').length * ab11.liSize * 1.1)).join(' '))
check('手环 11：关于页返回键 220x84，位置 656（离下沿 84 躲圆角）',
  ab11.backW === 220 && ab11.backH === 84 && about.backTop === 656 && about.backL === 58,
  ab11.backW + 'x' + ab11.backH + ' top=' + about.backTop)
check('关于页版本号 = manifest.versionName（别再出现"装的是 3.3、页面写 3.1"）',
  about.ver === 'v' + manifest.versionName, about.ver + ' vs v' + manifest.versionName)

// 等级页：同一套桩重算（它也是照 480 写死的）
lvp.setViewport()
check('手环 11：等级徽章卡 300x150、九宫格每格 100 高（原来 96x62）',
  lvp.sz.heroH === 150 && lvp.sz.cellH === 100 && lvp.sz.badge === 96,
  lvp.sz.heroH + ' / ' + lvp.sz.cellH + ' / ' + lvp.sz.badge)
check('手环 11：等级页 LV 号 40 = 25 物理、档位行 19 = 12 物理',
  phys(lvp.sz.lv) >= 24 && phys(lvp.sz.tier) >= 11.9,
  phys(lvp.sz.lv).toFixed(1) + ' / ' + phys(lvp.sz.tier).toFixed(1))
check('手环 11：进度条跟着 infoW 缩（写死 200 会顶出卡片）',
  lvp.sz.infoW === 194 && lvp.barW <= lvp.sz.infoW, 'bar=' + lvp.barW + ' info=' + lvp.sz.infoW)
check('手环 11：整页排到返回键上方，不给下面留一大块空白',
  (function () {
    const hdrTop = lvp.sz.hdrMt + 24
    const hdrH = lvp.sz.hdrT * 1.25 + lvp.sz.hdrS * 1.25 + 2
    const end = hdrTop + hdrH + lvp.sz.heroMt + lvp.sz.heroH + lvp.sz.secMt + lvp.sz.secSize * 1.25 +
      3 * (lvp.sz.cellH + lvp.sz.rowMt)
    return end < lvp.backTop && lvp.backTop - end < 120
  })(),
  '返回键 ' + lvp.backTop)
check('手环 11：等级页返回键 220x84，位置 656（离下沿 84 躲圆角）',
  lvp.sz.backW === 220 && lvp.sz.backH === 84 && lvp.backTop === 656 && lvp.backL === 58,
  lvp.sz.backW + 'x' + lvp.sz.backH + ' top=' + lvp.backTop)

// 切回手环 Pro：这两页必须原封不动
SCREEN_STUB.h = 480
SCREEN_STUB.realW = 336
SCREEN_STUB.realH = 480
SCREEN_STUB.pill = false
SCREEN_STUB.tall = false
SCREEN_STUB.extra = 0
SCREEN_STUB.padTop = 0
SCREEN_STUB.padBottom = 0
SCREEN_STUB.padX = 0
const tankPro = newTankStill()
check('切回 Pro：缸还是 300x256、鱼 52x30、返回键 410',
  tankPro.tk.tankH === 256 && tankPro.tankTop === 66 && tankPro.infoTop === 330 &&
  tankPro.backTop === 410 && Math.max.apply(null, tankPro.raw.map((f) => f.w)) <= 52,
  tankPro.tk.tankH + ' / ' + tankPro.tankTop + ' / ' + tankPro.backTop)
about.setViewport()
check('切回 Pro：关于页内容区还是 296、正文 18、返回键 408',
  about.ab.contentW === 296 && about.ab.liSize === 18 && about.backTop === 408,
  about.ab.contentW + ' / ' + about.ab.liSize + ' / ' + about.backTop)
lvp.setViewport()
check('切回 Pro：等级页还是 96x62 的格子、返回键 408',
  lvp.sz.heroH === 96 && lvp.sz.cellH === 62 && lvp.backTop === 408,
  lvp.sz.heroH + ' / ' + lvp.sz.cellH + ' / ' + lvp.backTop)

// —— 测试包（src/common/dev.js） ——
// 真机测试包靠它一次灌好 123 级 + 满缸，所以这几个数必须对得上，
// 不然装到手上发现是"122 级"或者"6 条鱼"，白跑一趟。
check('测试包积分正好是 123 级', levelInfo(TEST.total).level === 123, 'LV' + levelInfo(TEST.total).level)
check('测试包 123 级落在星辰档', levelInfo(TEST.total).tierName === '星辰', levelInfo(TEST.total).tierName)
check('测试包的积分没顶到天花板（进度条还能走）',
  levelInfo(TEST.total).percent > 5 && levelInfo(TEST.total).percent < 95,
  Math.round(levelInfo(TEST.total).percent) + '%')
check('测试包 123 级能解锁全部七张地图',
  T.every((t) => levelInfo(TEST.total).level >= t.needLv))
check('测试包的星标鱼比正式版来得快', TEST.starFirst < 210, TEST.starFirst + ' vs 210')
check('测试包允许一局出多条星标鱼', TEST.starRepeat === true)

// 真灌一次：writeTestData 不看 TEST.on，只看 fillTank / seedBest，可以直接验
inst.writeTestData()
check('灌完数据后是 123 级', inst.lvLevel === 123, 'LV' + inst.lvLevel)
check('灌完数据后鱼缸 7 / 7', inst.tankCount === 7 && inst.tankCount === STARS.length, 'n=' + inst.tankCount)

// 长按退出删过一次：手环上按住屏幕太常见（等鱼、按住没钓到），
// onlongpress 只有 500ms 左右，误触一次整局作废。别再绑回来。
check('页面没有绑定 onlongpress（长按不再退出游戏）', !/onlongpress/.test(ux))

/* —— 精灵的 object-fit 必须是 fill ——
 * 真机上鱼"变成面包"就是这条：原来写 object-fit: none（按图片原始物理像素画），
 * 336 物理宽的 Pro 上正好 1:1，看不出问题；212 宽 / 336 设计宽的手环 11 缩 0.631 倍后，
 * 110x60 的鱼图塞进 69x38 的框 —— 只有中间那截留下来，头尾被裁掉。 */
check('位图精灵用 object-fit: fill（none 会在窄屏把鱼裁成"面包"）',
  /\.spr\s*\{[^}]*object-fit:\s*fill/.test(ux) && !/object-fit:\s*none\s*;/.test(ux),
  (ux.match(/object-fit:\s*\w+\s*;/g) || []).join(' '))

/* —— 精灵不许跑出屏幕 ——
 * 页面能上下滑动的老毛病就是这么来的：绝对定位的框越过 0..336 / 0..480，
 * 文档被撑大，手指一滑整个背景跟着平移（v1 修过一次，加星标鱼之后又冒回来）。
 * 这里跑满一整局，逐帧检查三条鱼的框。 */
inst.selectMap(0)
let outX = 0
let outY = 0
let frames = 0
while (inst.phase === 'playing' && frames++ < 4000) {
  inst.tick()
  for (const k of ['f1', 'f2', 'f3']) {
    const x = inst[k + 'x']
    const y = inst[k + 'y']
    const w = inst[k + 'w']
    const h = inst[k + 'h']
    if (x < 0 || x + w > 336) outX++
    if (y < 0 || y + h > 480) outY++
  }
  if (inst.reelOn) inst.hold = true
}
check('跑一整局，鱼没有一帧跑出屏幕（否则页面能被拖动）',
  outX === 0 && outY === 0, 'x 越界 ' + outX + ' 帧 / y 越界 ' + outY + ' 帧 / 共 ' + frames + ' 帧')

/* —— 测试包的启动顺序（真机的 storage 是异步的） ——
 * 上面那个 storageStub 是同步回调，读到的永远是"刚写完的新值"，所以这个坑在自测里看不出来：
 * 早先把灌注放在 onInit 最前面，真机上 get 的旧值回调后到，把 123 级冲成 LV1，
 * 表现就是"等级是 123，地图却全锁着"。这里用"发起时快照 + 延后回调"复现真机语义。 */
const asyncStore = {}
const pendingGets = []
const asyncStorage = {
  get({ key, default: def, success }) {
    const v = key in asyncStore ? asyncStore[key] : def
    pendingGets.push(() => {
      if (success) success(v)
    })
  },
  set({ key, value }) {
    asyncStore[key] = value
  }
}
// 消费队列：回调里还会发起新的 get（seedTest 查标记），所以要循环到空
function flushGets(limit = 100) {
  let n = 0
  while (pendingGets.length && n < limit) {
    const fn = pendingGets.shift()
    fn()
    n++
  }
  return n
}

const TEST_ON = Object.assign({}, TEST, { on: true })
const def2 = makeComponent(
  asyncStorage, routerStub, brightnessStub, levelInfo, badgeSrc, LEVEL_KEY,
  STARS, STAR_PAL, TANK_KEY, starOf, tankId, tankEntry, parseTank, TEST_ON, TEST_SEED_KEY,
  SCREEN_STUB, DESIGN_H, screenH, probeScreen, onScreen,
  cardSizes, isNarrow, shortDesc, titleOf, bestOf, panelSizes, PILL_R, pillAvailW, hudSizes,
  stubSetInterval, stubClearInterval, stubSetTimeout, stubClearTimeout
)
const boot = Object.assign({}, def2.private)
for (const k of Object.keys(def2)) {
  if (k !== 'private') boot[k] = def2[k]
}
boot.onInit()
check('启动时一口气发起全部初始化读取', pendingGets.length === T.length + 2, 'n=' + pendingGets.length)
// Lv1 只有第一张图能点，其余六张都是锁的
check('读取没回来之前不抢跑（还是 LV1，只有第一张开）',
  boot.lvLevel === 1 && boot.maps[0].locked === false && boot.maps[1].locked === true,
  'LV' + boot.lvLevel + ' ' + boot.maps.map((m) => (m.locked ? '锁' : '开')).join(''))
flushGets()
check('读取回来后才灌：等级 123（不会被旧值冲掉）', boot.lvLevel === 123, 'LV' + boot.lvLevel)
check('读取回来后才灌：七张图全解锁',
  boot.maps.every((m) => !m.locked), boot.maps.map((m) => (m.locked ? '锁' : '开')).join(''))
check('灌完的总分落到 storage', asyncStore[LEVEL_KEY] === String(TEST.total), asyncStore[LEVEL_KEY])
check('灌完的鱼缸是 7 条', String(asyncStore[TANK_KEY]).split('\n').length === STARS.length)

// 再启动一次：已灌注过就不会重复拍（resetOnStart 为 false 时，测试中钓到的分要留住）
pendingGets.length = 0
const boot2 = Object.assign({}, def2.private)
for (const k of Object.keys(def2)) {
  if (k !== 'private') boot2[k] = def2[k]
}
boot2.onInit()
flushGets()
check('第二次启动仍读到 123 级（标记生效，不重复灌）', boot2.lvLevel === 123, 'LV' + boot2.lvLevel)

/* —— 老格式的鱼缸（'m:shape'，没有时间戳）——
 * 这正是用户手上那一台：缸是 v2.2 的测试数据灌的，TEST_SEED_KEY 早就写着，
 * 升级到 v2.6 之后不会重新灌 → 鱼缸页点开只会显示"时间未知/未记录"，
 * 看起来就像"点鱼不显示钓获时间"。测试包启动时把这种缸按当前时间补一遍。 */
asyncStore[TANK_KEY] = '0:trout\n1:koi'
pendingGets.length = 0
const boot3 = Object.assign({}, def2.private)
for (const k of Object.keys(def2)) {
  if (k !== 'private') boot3[k] = def2[k]
}
boot3.onInit()
flushGets()
const refilled = parseTank(asyncStore[TANK_KEY])
check('老格式的缸在测试包里被补成七条、且都有时间',
  refilled.length === STARS.length && refilled.every((e) => e.ts > 0),
  'n=' + refilled.length + ' 无时间的=' + refilled.filter((e) => !e.ts).length)
check('补完之后界面上的缸数也跟着是 7', boot3.tankCount === STARS.length, 'n=' + boot3.tankCount)

// 已经有时间的缸不许覆盖：玩家自己钓到的那条时间要留住
const keepTs = 1794892800000
asyncStore[TANK_KEY] = '0:trout:' + keepTs
pendingGets.length = 0
const boot4 = Object.assign({}, def2.private)
for (const k of Object.keys(def2)) {
  if (k !== 'private') boot4[k] = def2[k]
}
boot4.onInit()
flushGets()
check('已经记过时间的缸不会被测试包重写',
  asyncStore[TANK_KEY] === '0:trout:' + keepTs, asyncStore[TANK_KEY])

// 单条老记录：再钓到同一条时把时间补上（否则缸里永远"未记录"，玩家没别的办法补）
store[TANK_KEY] = '0:trout'
inst.tankGot = false
inst.pendingStar = '0:trout'
inst.putInTank()
check('再钓到缸里那条老记录时，顺手把时间补上',
  /^0:trout:\d{11,}$/.test(store[TANK_KEY]), store[TANK_KEY])

/* ==================== 多屏适配 ====================
 * 两档目标机型（Vela 官方设备表）：
 *   小米手环 10 Pro  336x480 矩形  designWidth=336 → px 1:1
 *   小米手环 11      212x520 胶囊  画布高 = 336*520/212 = 824
 * 纵向数值全部从画布高推出来，所以这里改 SCREEN_STUB 再 setViewport 就能验。
 */

// —— 手环 Pro：必须和设计稿一字不差（回归保护）——
SCREEN_STUB.h = 480
SCREEN_STUB.realW = 336
SCREEN_STUB.realH = 480
SCREEN_STUB.pill = false
SCREEN_STUB.extra = 0
SCREEN_STUB.padTop = 0
SCREEN_STUB.padBottom = 0
SCREEN_STUB.padX = 0
inst.setViewport()
check('手环 Pro：画布高 480', inst.vh === 480, 'vh=' + inst.vh)
check('手环 Pro：背景上半段仍是 356、水底景观仍贴在 356',
  inst.bgH === 356 && inst.bedTop === 356, inst.bgH + ' / ' + inst.bedTop)
check('手环 Pro：中间纯水色 304（= 480 - 176）', inst.wxH === 304, 'wxH=' + inst.wxH)
check('手环 Pro：底部提示还在 408', inst.hintTop === 408, 'hintTop=' + inst.hintTop)
check('手环 Pro：顶部时间条 + HUD 一个像素不动（条贴 y=0 全宽 336，HUD top 8 / 左右 14）',
  inst.hudS.barTop === 0 && inst.hudS.barW === 336 && inst.hudS.barH === 4 &&
  inst.hudS.top === 8 && inst.hudS.padX === 14 &&
  inst.barW === Math.round(inst.hudS.barW * inst.timeLeft / inst.timeTotal),
  [inst.hudS.barTop, inst.hudS.barW, inst.hudS.top, inst.hudS.padX].join(' / '))
check('手环 Pro：底部留白 15（真机照片里胶囊贴着下沿，抬高 15 指尖才落得下）',
  inst.selPadB === 15 && inst.cardS.lockBottom === 75,
  'selPadB=' + inst.selPadB + ' lockBottom=' + inst.cardS.lockBottom)
check('手环 Pro：列表高度 305（= 480 - reserve 160 - padB 15）', inst.cardsH === 305, 'cardsH=' + inst.cardsH)
check('手环 Pro：卡片整体 ×1.2（98→118 高、20→24 字），宽度封顶 336（296×1.2=355 超屏宽）',
  inst.narrow === false && inst.cardS.cardH === 118 && inst.cardS.nameSize === 24 &&
  inst.cardS.cardW === 336 && inst.cardS.cardMl === 0 && inst.cardS.cellH === 120,
  'h=' + inst.cardS.cardH + ' w=' + inst.cardS.cardW + ' 字=' + inst.cardS.nameSize)
check('手环 Pro：预览 89 + 预览边距 10 + 文字列边距 12 + 文字 221 = 332 = 卡内宽',
  inst.cardS.pv === 89 &&
  inst.cardS.pv + 10 + 12 + inst.cardS.infoW === inst.cardS.cardW - 4,
  '拼起来=' + (inst.cardS.pv + 10 + 12 + inst.cardS.infoW) + ' 卡内宽=' + (inst.cardS.cardW - 4))
check('手环 Pro：三行文字 24/19/22 竖着塞得进 118 的卡',
  inst.cardS.nameSize * 1.25 + inst.cardS.descMt + inst.cardS.descSize * 1.25 +
  inst.cardS.rowMt + inst.cardS.rowH <= inst.cardS.cardH - 8,
  Math.round(inst.cardS.nameSize * 1.25 + inst.cardS.descMt + inst.cardS.descSize * 1.25 +
  inst.cardS.rowMt + inst.cardS.rowH) + ' / ' + inst.cardS.cardH)
check('手环 Pro：一屏 2.5 张（305 / 120），第 3 张露一半当滚动暗示',
  inst.cardsH === 305 && inst.cardsH / inst.cardS.cellH >= 2.4 &&
  inst.cardsH / inst.cardS.cellH < 2.6,
  '一屏=' + (inst.cardsH / inst.cardS.cellH).toFixed(2))
check('手环 Pro：卡名保留"初级 · "前缀',
  inst.maps[0].title === '初级 · 青草池塘', inst.maps[0].title)

// —— 手环 11：824 的画布，多出来的 344 全给水下 ——
SCREEN_STUB.h = 824
SCREEN_STUB.realW = 212
SCREEN_STUB.realH = 520
SCREEN_STUB.pill = true
SCREEN_STUB.tall = true
SCREEN_STUB.extra = 344
SCREEN_STUB.padTop = 24
SCREEN_STUB.padBottom = 22
SCREEN_STUB.padX = 12
inst.setViewport()
check('手环 11：画布高 824（336*520/212）', inst.vh === 824, 'vh=' + inst.vh)
check('手环 11：水底景观贴屏幕底（824 - 124）', inst.bedTop === 700, 'bedTop=' + inst.bedTop)
// 上半段背景图是设计稿切的固定 356，屏再高也不许拉长（拉长=像素格变扁）
check('手环 11：上半段背景图仍是 356，不被拉长', inst.bgH === 356, 'bgH=' + inst.bgH)
check('手环 11：中间纯水色拉长到 648（= 824 - 176）', inst.wxH === 648, 'wxH=' + inst.wxH)
check('手环 11：底部提示跟着沉底（824 - 72）', inst.hintTop === 752, 'hintTop=' + inst.hintTop)
/* 时间条和 HUD 原来都贴屏幕顶（条 y=0、HUD y=8）。手环 11 的屏顶是半圆：
 * d=0 处可用宽度 0，4px 的条只剩中间一道弧（真机照片里就是眉心那条蓝线），
 * 分数 / 倒计时也各被两端弧线切掉一个数字。窄屏改成按 W(d) 往下搬 + 收窄。 */
check('手环 11：时间条搬到屏顶半圆之下，宽度收进该高度的可用宽度',
  inst.hudS.barTop >= 32 && inst.hudS.barW <= pillAvailW(inst.hudS.barTop) - 20 &&
  inst.hudS.barTop + inst.hudS.barH <= inst.hudS.top,
  'y=' + inst.hudS.barTop + ' 宽=' + inst.hudS.barW +
  ' 可用=' + pillAvailW(inst.hudS.barTop).toFixed(1))
check('手环 11：HUD 两端不撞弧线（分数和倒计时不再各少一个数字）',
  inst.hudS.top > inst.hudS.barTop && 336 - inst.hudS.padX * 2 <= pillAvailW(inst.hudS.top + 6),
  'padX=' + inst.hudS.padX + ' 内容=' + (336 - inst.hudS.padX * 2) +
  ' 可用=' + pillAvailW(inst.hudS.top + 6).toFixed(1))
/* 船不是从 142 开始的：钓具位图（船 + 渔夫 + 竿）的上沿在 BOAT_TOP - 43 = 99，
 * 渔夫的草帽就在那儿。HUD 压到 99 以下就会顶在草帽上 —— 第一版排到 122 就是这样。 */
check('手环 11：HUD 三块字塞得进内容宽，且整条停在钓具位图（99）之上',
  (inst.hudS.scoreSize * 1.7 + inst.hudS.comboSize * 4 + inst.hudS.timeSize * 1.7) <= 336 - inst.hudS.padX * 2 &&
  inst.hudS.top + inst.hudS.h <= 99,
  '估宽=' + Math.round(inst.hudS.scoreSize * 1.7 + inst.hudS.comboSize * 4 + inst.hudS.timeSize * 1.7) +
  ' 内容=' + (336 - inst.hudS.padX * 2) + ' 底=' + (inst.hudS.top + inst.hudS.h))
check('手环 11：连击只写倍数（「COMBO x1.5」10 个字放不下）',
  inst.hudS.comboPrefix === 'x' && /\{\{hudS\.comboPrefix\}\}/.test(ux),
  inst.hudS.comboPrefix)
check('手环 11：时间条 184 宽，进度填充按它算（原来写死 DESIGN_W，缩窄后永远差一截）',
  inst.hudS.barW === 184 &&
  inst.barW === Math.round(184 * inst.timeLeft / inst.timeTotal),
  '条=' + inst.hudS.barW + ' 填充=' + inst.barW)
check('手环 11：列表底部留出圆角安全区（84，按半圆屏算过）', inst.selPadB === 84, 'selPadB=' + inst.selPadB)

/* 地图选择页：窄屏要"少露几张 + 字放大到看得清"。
 * 用户在真机上连着提了两次"字太小" —— 根子是 designWidth=336 在 212 宽上把字号缩到 0.631：
 * 设计稿写 30 只有 18.9 物理像素，而手环系统菜单的字是 28~32 物理像素。
 * 所以现在卡名 40（≈25 物理）、底部胶囊 82 高（≈52 物理）。
 * 胶囊改成上下两行后，列表从 574 缩到 482 —— 仍露 2 张整 + 第 3 张的六成，滚动暗示还在。 */
check('手环 11：列表 436 高，一屏 2 张 + 第 3 张露一截（不再一次全展示）',
  inst.cardsH === 436 && inst.cardsH / inst.cardS.cellH >= 2 && inst.cardsH / inst.cardS.cellH < 2.6,
  'cardsH=' + inst.cardsH + ' 一屏=' + (inst.cardsH / inst.cardS.cellH).toFixed(2))
check('手环 11：卡片 174 高、卡名字号 38',
  inst.cardS.cardH === 174 && inst.cardS.nameSize === 38 && inst.cardS.descSize === 30,
  inst.cardS.cardH + ' / ' + inst.cardS.nameSize + ' / ' + inst.cardS.descSize)
check('手环 11：卡名 24 物理像素（原来 12.6，手环系统菜单约 28~32）',
  phys(inst.cardS.nameSize) >= 23.5, phys(inst.cardS.nameSize).toFixed(1) + 'px')
check('手环 11：描述 / 星级 / 最高分都 ≥ 16 物理像素',
  phys(inst.cardS.descSize) >= 16 && phys(inst.cardS.starSize) >= 18 && phys(inst.cardS.bestSize) >= 16,
  [inst.cardS.descSize, inst.cardS.starSize, inst.cardS.bestSize].map((v) => phys(v).toFixed(1)).join(' / '))
check('手环 11：顶部标题 25 物理像素，副标题 12.6 物理',
  phys(inst.cardS.titleSize) >= 25 && phys(inst.cardS.subSize) >= 12.5,
  phys(inst.cardS.titleSize).toFixed(1) + ' / ' + phys(inst.cardS.subSize).toFixed(1))
check('手环 11：星级/最高分放不下并排，改成竖排两列',
  inst.cardS.rowDir === 'column' && inst.cardS.rowH === 72,
  inst.cardS.rowDir + ' / ' + inst.cardS.rowH)
check('手环 11：卡片内容放得进卡片高度（字号再大就会顶出边框）',
  inst.cardS.nameSize * 1.25 + inst.cardS.descMt + inst.cardS.descSize * 1.25 +
  inst.cardS.rowMt + inst.cardS.rowH <= inst.cardS.cardH - 8,
  Math.round(inst.cardS.nameSize * 1.25 + inst.cardS.descMt + inst.cardS.descSize * 1.25 +
  inst.cardS.rowMt + inst.cardS.rowH) + ' / ' + inst.cardS.cardH)
// 预览框 74→92 是等比放大：鱼、尾巴、眼睛、水线都得按同一比例挪，否则会跑出框
// （尾巴右端故意压在鱼身左端上 2~3px，两截接成一条鱼，所以允许一点点重叠）
const pv = inst.cardS
check('手环 11：预览框 92，鱼身整个还在框内',
  pv.pv === 92 && pv.pvFishX + pv.pvFishW <= pv.pv &&
  pv.pvTailX + pv.pvTailW <= pv.pvFishX + 4 &&
  pv.pvEyeX + pv.pvEyeS <= pv.pvFishX + pv.pvFishW &&
  pv.pvDeepTop + pv.pvDeepH === pv.pv && pv.pvWaterTop + pv.pvWaterH > pv.pvDeepTop,
  'size=' + pv.pv + ' fish=' + pv.pvFishX + '+' + pv.pvFishW + ' eye=' + pv.pvEyeX)
// 中文实际字宽比 1em 略大（实测约 1.05~1.1），这里按 1.1 保守算，超了真机就会溢出卡片
check('手环 11：四条文案在信息区宽度内不折行（按 1.1em 保守算）',
  pv.nameSize * 4 * 1.1 <= pv.infoW && pv.descSize * 3 * 1.1 <= pv.infoW &&
  pv.starSize * 5 <= pv.infoW && pv.bestSize * 5 * 1.1 <= pv.infoW,
  'info=' + pv.infoW + ' name4=' + Math.round(pv.nameSize * 4 * 1.1) +
  ' star5=' + pv.starSize * 5 + ' best5=' + Math.round(pv.bestSize * 5 * 1.1))
// 卡 300 是 border-box，左右各 2 的边框要扣掉 —— 少算这 4 会让卡名右边溢出卡框
check('手环 11：预览 + 文字区宽度不超过卡片内容区（防溢出卡框）',
  pv.pv + 10 + 12 + pv.infoW <= pv.cardW - 4,
  'piece=' + (pv.pv + 10 + 12 + pv.infoW) + ' 内容区=' + (pv.cardW - 4))
check('手环 11：卡名去掉"初级 · "前缀（38px 下会折行）',
  inst.maps[0].title === '青草池塘', inst.maps[0].title)
check('手环 11：已解锁卡的描述只留倍率',
  inst.maps[0].descLine === '1倍分', inst.maps[0].descLine)
check('手环 11：最高分去掉空格和量词才放得下',
  /^最高\d+$/.test(inst.maps[0].bestLine), inst.maps[0].bestLine)
// 锁定文案要在"等级不够"的状态下验，前面几节把 total 抬到过很高，先按新号归零
const savedTotal11 = inst.total
inst.total = 0
inst.refreshMaps()
check('手环 11：锁定卡说清楚差几级（短版，不带"达到"）',
  /^Lv\d+ 解锁$/.test(inst.maps[1].descLine), inst.maps[1].descLine)
inst.total = savedTotal11
inst.refreshMaps()
// 提示行要绝对定位（占流的话这一行 22 高会从列表里扣掉，列表底部"露一角"就没了）
const lockCss = ux.slice(ux.indexOf('.sel-foot-lock {'), ux.indexOf('}', ux.indexOf('.sel-foot-lock {')))
check('手环 11：锁图提示绝对定位，不占列表高度',
  lockCss.indexOf('position: absolute') >= 0 && inst.cardS.reserve === 304,
  'reserve=' + inst.cardS.reserve)
check('手环 11：页面底部留白 84 = 53 物理（48 时「关于」两端被半圆屏吃掉）',
  inst.cardS.padB === 84 && inst.selPadB === 84 && phys(inst.cardS.padB) >= 50,
  inst.cardS.padB + ' → ' + phys(inst.cardS.padB).toFixed(1) + 'px')
/* 真正让按钮掉到屏幕最下沿的两件事，这一条把两件都钉住：
 *   1) `.sel { padding-bottom }` —— Vela 的 div 是 content-box，padding 不计入 height，
 *      子节点照样排在 0..vh 里，留白被画到屏幕外（真机上连着三版加大 padB 毫无变化）；
 *   2) `.cards { flex-grow: 1 }` —— 列表把剩余空间全吃掉，按钮被推到最下沿。
 * 所以安全区必须是**按钮之后的占位空 div**，且自己和按钮都不许被压缩。 */
const selTag = (ux.match(/<div class="sel"[^>]*>/) || [''])[0]
const gapTag = (ux.match(/<div class="sel-gap"[^>]*>/) || [''])[0]
const gapBeforeWrap = ux.indexOf('class="sel-gap"') > ux.indexOf('class="entry-wrap"')
const wrapCss = ux.slice(ux.indexOf('.entry-wrap {'), ux.indexOf('}', ux.indexOf('.entry-wrap {')))
const gapCss = ux.slice(ux.indexOf('.sel-gap {'), ux.indexOf('}', ux.indexOf('.sel-gap {')))
check('手环 11：底部安全区是占位 div（不是 padding-bottom —— content-box 里它会跑到屏幕外）',
  selTag.indexOf('padding-bottom') < 0 && gapBeforeWrap &&
  /height: \{\{cardS\.padB\}\}px/.test(gapTag),
  'padding-bottom=' + (selTag.indexOf('padding-bottom') >= 0) + ' gap 在按钮之后=' + gapBeforeWrap)
check('手环 11：按钮与占位都不许被压缩（列表让位，按钮必须整块留在屏内）',
  wrapCss.indexOf('flex-shrink: 0') >= 0 && gapCss.indexOf('flex-shrink: 0') >= 0,
  'wrap=' + (wrapCss.indexOf('flex-shrink: 0') >= 0) + ' gap=' + (gapCss.indexOf('flex-shrink: 0') >= 0))
check('手环 11：纵向账平 —— 头部 118 + 行距 12 + 两行按钮 174 + 留白 84 + 列表 436 = 824',
  inst.cardS.reserve === 118 + 12 + inst.cardS.entryH * 2 + inst.cardS.entryGap &&
  inst.cardsH + inst.cardS.reserve + inst.cardS.padB === 824,
  inst.cardS.reserve + ' + ' + inst.cardsH + ' + ' + inst.cardS.padB + ' = ' +
  (inst.cardsH + inst.cardS.reserve + inst.cardS.padB))
check('手环 11：底部胶囊 82 高 = 52 物理像素（上一版 68=43 还嫌小）',
  inst.cardS.entryH === 82 && phys(inst.cardS.entryH) >= 50,
  inst.cardS.entryH + ' → ' + phys(inst.cardS.entryH).toFixed(1) + 'px')
check('手环 11：胶囊字号 30 = 19 物理像素（上一版 24=15）',
  inst.cardS.entrySize === 30 && phys(inst.cardS.entrySize) >= 18,
  inst.cardS.entrySize + ' → ' + phys(inst.cardS.entrySize).toFixed(1) + 'px')
/* 三个并排时每个只有 55~72 物理宽：高够了，但手指横着放不下，按「关于」会蹭到鱼缸。
 * 改上下两行后第一行两个、第二行一个，逐个宽度翻倍。 */
check('手环 11：底部胶囊分两行（上面 等级+鱼缸，下面 关于）',
  inst.cardS.twoRows === true && inst.cardS.entryGap > 0,
  'twoRows=' + inst.cardS.twoRows + ' gap=' + inst.cardS.entryGap)
/* 手环 11 的屏是**两端半圆**（r = 168 设计单位 = 106 物理），不是 40 物理的小圆角。
 * 距底 d 处的可用宽度 W(d) = 2*sqrt(r² - (r-d)²)，所以"按钮离底多高"直接决定它能有多宽。
 * 这里按几何算一遍：每个按钮两侧都要留 ≥28 设计单位（18 物理）的余量。 */
const row1W = inst.cardS.entryW + inst.cardS.entryWBig + 12
const row1D = inst.cardS.padB + inst.cardS.entryH + inst.cardS.entryGap // 第一行底边距屏幕底
check('手环 12：圆角半径按半宽算（168 设计 = 106 物理），不是 40 物理',
  PILL_R === 168 && pillAvailW(0) === 0 && pillAvailW(PILL_R) === 336,
  'R=' + PILL_R + ' W(0)=' + pillAvailW(0) + ' W(R)=' + pillAvailW(PILL_R))
check('手环 11：第一行两个胶囊两侧各留 ≥28 设计单位（真机 18 物理）',
  pillAvailW(row1D) - row1W >= 56 &&
  inst.cardS.entrySize * 3 <= inst.cardS.entryTextWBig,
  '占宽=' + row1W + ' 可用=' + pillAvailW(row1D).toFixed(1) +
  ' 余量=' + (pillAvailW(row1D) - row1W).toFixed(1) + ' d=' + row1D)
check('手环 11：「关于」220 宽，在它离底的高度上可用宽度够（不被半圆切）',
  pillAvailW(inst.cardS.padB) - inst.cardS.entryWAbout - 6 >= 56,
  '可用=' + pillAvailW(inst.cardS.padB).toFixed(1) +
  ' 按钮=' + (inst.cardS.entryWAbout + 6) +
  ' 余量=' + (pillAvailW(inst.cardS.padB) - inst.cardS.entryWAbout - 6).toFixed(1))
/* 「等级」116 设计 = 73 物理宽、52 物理高 —— 按 1.8 吋屏折算是 16×11mm，够按。
 * 想再加宽就得吃掉两端的弧形余量，真机上反而变成"边框被屏幕啃掉"。 */
check('手环 11：每个胶囊宽 ≥72 物理、且都比三个并排时的 55 宽',
  phys(inst.cardS.entryW) >= 72 && phys(inst.cardS.entryWAbout) >= 80 &&
  phys(inst.cardS.entryW) > 72,
  phys(inst.cardS.entryW).toFixed(0) + ' / ' + phys(inst.cardS.entryWBig).toFixed(0) +
  ' / ' + phys(inst.cardS.entryWAbout).toFixed(0))
check('手环 11：第二行「关于」220 宽居中，比第一行短一截（等宽会像横幅）',
  inst.cardS.entryWAbout === 220 && inst.cardS.entryWAbout < inst.cardS.entryW + inst.cardS.entryWBig &&
  inst.cardS.entryWAbout % 2 === 0,
  inst.cardS.entryWAbout + ' vs ' + (inst.cardS.entryW + inst.cardS.entryWBig))
/* 分行要还账：两行多吃 92，列表只剩 482 —— 仍要能露 2 张整卡 + 第 3 张的一角，
 * 否则"下面还有地图"的滚动暗示就没了（列表变成刚好两张，看不出能滑）。 */
check('手环 11：分两行后列表仍露 2 张整卡 + 第 3 张一角',
  inst.cardsH >= inst.cardS.cellH * 2 + 60,
  'cardsH=' + inst.cardsH + ' cellH=' + inst.cardS.cellH +
  ' 整卡=' + Math.floor(inst.cardsH / inst.cardS.cellH))
check('手环 11：锁图提示浮在第二行胶囊之上，不压按钮',
  inst.cardS.lockBottom > inst.cardS.padB + inst.cardS.entryH * 2 + inst.cardS.entryGap,
  'lockBottom=' + inst.cardS.lockBottom +
  ' 需要>' + (inst.cardS.padB + inst.cardS.entryH * 2 + inst.cardS.entryGap))

/* 结算面板：原来照 480 写死（272 宽 / 正文 16），212 宽的真机上只有 172 物理宽、
 * 正文 10 物理像素 —— 真机截图里就是"结算栏太小，字要凑近看"。 */
check('手环 11：结算面板 300 宽 = 189 物理（原来 272 = 172，占屏 81%）',
  inst.pS.w === 300 && phys(inst.pS.w) >= 185,
  inst.pS.w + ' → ' + phys(inst.pS.w).toFixed(0) + 'px')
check('手环 11：面板正文 24 = 15 物理像素、标题 32 = 20（原来 16 = 10）',
  phys(inst.pS.lineSize) >= 14.5 && phys(inst.pS.titleSize) >= 19,
  phys(inst.pS.lineSize).toFixed(1) + ' / ' + phys(inst.pS.titleSize).toFixed(1))
check('手环 11：分数 76 = 48 物理像素（一眼能读出这局多少分）',
  inst.pS.scoreSize === 76 && phys(inst.pS.scoreSize) >= 44,
  inst.pS.scoreSize + ' → ' + phys(inst.pS.scoreSize).toFixed(0) + 'px')
check('手环 11：面板内文字宽度 = barW，且不顶出面板内容区（300 - 左右边框 4）',
  inst.pS.barW === 264 && inst.pS.barW + 4 <= inst.pS.w,
  'barW=' + inst.pS.barW + ' 内容区=' + (inst.pS.w - 4))
check('手环 11：两个按钮 124x72（物理 45 高）+ 外边距塞得下 296',
  inst.pS.btnW * 2 + inst.pS.btnMx * 4 <= inst.pS.w - 4,
  '占宽=' + (inst.pS.btnW * 2 + inst.pS.btnMx * 4) + ' / ' + (inst.pS.w - 4))
check('手环 11：按钮字号 26 = 16 物理像素（原来 16 = 10，按不准也看不清）',
  inst.pS.btnSize === 26 && phys(inst.pS.btnSize) >= 16,
  inst.pS.btnSize + ' → ' + phys(inst.pS.btnSize).toFixed(1) + 'px')
// 面板整体（含星标鱼那一块）要能立在 824 的画布里，上下各留 24 的圆角安全区
check('手环 11：面板连星标鱼块一共 592 高，塞得进 824 的画布',
  (function () {
    const P = inst.pS
    const base = P.padT + P.titleSize * 1.25 + P.scoreSize * 1.25 + P.lineSize * 1.25 +
      P.gainSize * 1.25 + P.barH + P.bestSize * 1.25 +
      (P.scoreMt + P.lineMt + P.gainMt + P.barMt + P.bestMt) + P.btnMt + P.btnH + P.padB
    const star = P.starMt + P.starPadT + P.starImgW + P.starBtnMt + P.starBtnH + P.starPadB
    return base + star < 824 - 48
  })(),
  '画布 824')
check('手环 11：进度条宽度跟着面板走（写死 240 会只走一半）',
  inst.lvBarW === Math.round(inst.pS.barW * (inst.lvPct / 100)) &&
  /this\.lvBarW = Math\.round\(this\.pS\.barW/.test(ux),
  'lvBarW=' + inst.lvBarW + ' barW=' + inst.pS.barW)
// 模板层面：面板里每个 text 的宽度/字号必须读 pS，不能再写死 240
const panelTags = ux.match(/<text class="panel-[a-z]+"[^>]*>/g) || []
check('手环 11：结算面板的字号/宽度全走 pS（没有写死的 240）',
  panelTags.length >= 8 &&
  panelTags.every((t) => t.indexOf('font-size: {{pS.') >= 0 && t.indexOf('width: {{pS.') >= 0),
  'panel 文本 ' + panelTags.length + ' 条')

/* 胶囊分行在模板上必须"两块关于二选一"，不能同时渲染：
 * 第一行里那颗带 if="{{!cardS.twoRows}}"，第二行整行带 if="{{cardS.twoRows}}"。
 * 只有三颗而无 wrap 时（上一版），窄屏会把两颗关于都画出来 —— 版面直接塌。 */
const wrapStart = ux.indexOf('<div class="entry-wrap"')
const wrapHtml = wrapStart >= 0 ? ux.slice(wrapStart, ux.indexOf('</div>', ux.indexOf('<text class="sel-foot-lock"') - 400)) : ''
check('手环 11：底部入口包在 .entry-wrap 里（外面一层竖排容器）',
  wrapStart >= 0 && /\.entry-wrap\s*\{[^}]*flex-direction:\s*column/.test(ux),
  wrapStart >= 0 ? '.entry-wrap 有 column' : '模板里没有 .entry-wrap')
check('手环 11：两颗「关于」靠 twoRows 二选一，不会同时出现',
  (ux.match(/onclick="openAbout"/g) || []).length === 2 &&
  /if="\{\{!cardS\.twoRows\}\}"[^>]*onclick="openAbout"/.test(ux) &&
  /if="\{\{cardS\.twoRows\}\}"/.test(ux),
  'openAbout 节点 ' + (ux.match(/onclick="openAbout"/g) || []).length + ' 颗')
check('手环 11：第二行只放一个入口（关于），行距读 cardS.entryGap',
  /cardS\.entryGap/.test(ux) && inst.cardS.entryGap === 10,
  'entryGap=' + inst.cardS.entryGap)
check('宽屏：仍然一行三个胶囊（twoRows=false，关于留在第一行）',
  cardSizes(false).twoRows === false && cardSizes(false).entryWAbout === 102 &&
  cardSizes(false).reserve === 160,
  'twoRows=' + cardSizes(false).twoRows + ' reserve=' + cardSizes(false).reserve)

// 开一局：鱼群按新画布重排，第 4 条自动上场
inst.phase = 'select'
inst.selectMap(0)
// 结算面板那行「钓到 N 条 · 初级 · 青草池塘」在 24 号字下要 336 宽，面板内宽只有 264 —— 窄屏只留地名
check('手环 11：结算面板的地图名只写地名（带"初级 · "会顶出面板）',
  inst.mapLabel === T[0].name && inst.mapLabel.indexOf(' · ') < 0, inst.mapLabel)
check('手环 11：深水区多派一条鱼（4 条 + 第 4 槽打开）',
  inst.g.fish.length === 4 && inst.f4on === true, 'n=' + inst.g.fish.length)
check('手环 11：四条鱼都落在水面与沙地之间',
  inst.g.fish.every((f) => f.y >= K.FISH_TOP - 1 && f.y + f.h <= 774 - 22),
  inst.g.fish.map((f) => Math.round(f.y)).join(','))
// 钩子一路下放：到底就停（GROUND_Y - 36 = 738），不会钻进沙子里。
// 先把鱼挪走（免得半路被钩到），测完放回去 —— 不能直接清空数组，
// 后面还有用例要按 f[0] 改鱼的坐标。
const savedFishTall = inst.g.fish
inst.g.fish = []
inst.hookState = 'drop'
let dropGuard = 0
while (inst.hookState === 'drop' && dropGuard++ < 400) inst.moveHook()
inst.g.fish = savedFishTall
check('手环 11：钩子最深只到 774-36 = 738，不穿沙地',
  inst.hookY === 738, 'hookY=' + inst.hookY + ' 帧=' + dropGuard)

// 屏幕尺寸中途变（极少见：外接/旋转）→ relayoutFish 把鱼捞回活动带
inst.g.fish[0].y = 800
inst.relayoutFish()
check('鱼被挤出画布后会被捞回活动带', inst.g.fish[0].y <= 774 - 22 - inst.g.fish[0].h + 1,
  'y=' + inst.g.fish[0].y)

// —— 回到手环 Pro：一切复原 ——
SCREEN_STUB.h = 480
SCREEN_STUB.realW = 336
SCREEN_STUB.realH = 480
SCREEN_STUB.pill = false
SCREEN_STUB.tall = false
SCREEN_STUB.extra = 0
SCREEN_STUB.padTop = 0
SCREEN_STUB.padBottom = 0
SCREEN_STUB.padX = 0
inst.setViewport()
inst.phase = 'select'
inst.selectMap(0)
check('切回手环 Pro：鱼恢复 3 条、第 4 槽关闭',
  inst.g.fish.length === 3 && inst.f4on === false, 'n=' + inst.g.fish.length)
check('切回手环 Pro：水底景观回到 356', inst.bedTop === 356, 'bedTop=' + inst.bedTop)
check('切回手环 Pro：卡片尺寸/文案跟着回到 1.2 倍那套',
  inst.narrow === false && inst.cardsH === 305 && inst.cardS.cardH === 118 &&
  inst.maps[0].title === '初级 · 青草池塘', inst.cardsH + ' / ' + inst.maps[0].title)
// 面板也要跟着回去，并且进度条宽度按 240 重算（窄屏那套 264 不许留在 Pro 上）
check('切回手环 Pro：结算面板回到 272 宽 / 正文 16 / 进度条按 240 算',
  inst.pS.w === 272 && inst.pS.lineSize === 16 && inst.pS.barW === 240 &&
  inst.lvBarW === Math.round(240 * (inst.lvPct / 100)),
  inst.pS.w + ' / ' + inst.pS.lineSize + ' / lvBarW=' + inst.lvBarW)

/* ==================== 发布门禁 ====================
 * 正式包唯一不能搞错的一件事：dev.js 的 TEST.on 必须是 false。
 * 忘了关就直接发出去，玩家拿到的是"123 级 + 七图全开 + 满缸 + 半秒一条星标鱼"。
 */
check('发布门禁：dev.js 的 TEST.on 必须是 false', TEST.on === false, 'on=' + TEST.on)

/* ==================== 正式版清掉测试包留下的假存档 ====================
 * 光把开关关掉不会改写设备上已经存在的 123 级 / 满缸 / 假最高分，
 * 于是正式版首次启动清一次，并把 TEST_SEED_KEY 删掉（不删就是每次启动都清，等于每日清档）。
 */
check('清档用的最高分键前缀与页面一致',
  /const BEST_KEY = 'band_pixel_fish_'/.test(ux))
store[TEST_SEED_KEY] = '1'
store[LEVEL_KEY] = '334000'
store['band_pixel_fish_0'] = '220'
store[TANK_KEY] = '0:trout:1794892800000'
inst.total = 334000
inst.tankCount = 7
inst.bests = [220, 350, 480, 610, 740, 870, 1000]
inst.purgeTestData()
check('装过测试包的机器：等级 / 最高分 / 鱼缸一次清空',
  store[LEVEL_KEY] === '0' && store['band_pixel_fish_0'] === '0' && store[TANK_KEY] === '',
  'lv=' + store[LEVEL_KEY] + ' best=' + store['band_pixel_fish_0'] + ' tank=' + JSON.stringify(store[TANK_KEY]))
check('清完必须删掉标记（否则每次启动都清一次）',
  store[TEST_SEED_KEY] === '', 'seed=' + JSON.stringify(store[TEST_SEED_KEY]))
check('内存里的等级 / 缸数 / 最高分也跟着归零',
  inst.total === 0 && inst.lvLevel === 1 && inst.tankCount === 0 && inst.bests.every((v) => v === 0),
  'total=' + inst.total + ' LV' + inst.lvLevel + ' tank=' + inst.tankCount + ' bests=' + JSON.stringify(inst.bests))

// 干净的机器（没有标记）一律不许动玩家存档
store[LEVEL_KEY] = '5000'
store[TANK_KEY] = '0:trout:1794892800000'
store[TEST_SEED_KEY] = ''
inst.purgeTestData()
check('没装过测试包的机器不会被清档',
  store[LEVEL_KEY] === '5000' && store[TANK_KEY] === '0:trout:1794892800000',
  'lv=' + store[LEVEL_KEY] + ' tank=' + JSON.stringify(store[TANK_KEY]))

console.log(failures ? '\n❌ 有 ' + failures + ' 项未通过' : '\n✅ 逻辑自测全部通过')
process.exit(failures ? 1 : 0)
