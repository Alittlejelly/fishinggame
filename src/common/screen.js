/**
 * 屏幕视口（多屏适配的唯一真源）
 *
 * 为什么需要它：
 *   manifest 里的 designWidth=336 决定了 px 是"相对设计稿宽度等比缩放"的单位
 *   （官方原话：designWidth=336 时 168px 在 336 宽屏上是 168 物理像素，
 *    在 192 宽屏上是 96 物理像素）。宽度方向天生就能自适应，
 *   **高度方向不会** —— 窄长屏按宽度缩完之后，下半屏会空出来一大截。
 *
 *   例：小米手环 10 Pro 336x480（矩形），px 与物理像素 1:1；
 *       小米手环 11   212x520（胶囊），宽度缩到 212/336 = 0.631 倍，
 *       整块设计稿只占 212x303 物理像素，剩下 217px 全是空白。
 *
 * 所以这里把"真实屏幕"换算成"设计单位画布"：
 *   画布宽恒为 336（就是 designWidth，代码里的 px 数值不用改）
 *   画布高 H = 336 * 真实高 / 真实宽
 *     Pro → 336*480/336 = 480      （和设计稿完全一致，老机器一个像素都不动）
 *     手环 11 → 336*520/212 = 824  （多出 344 单位给深水区，见 fishing.ux 的 applyLayout）
 *
 * 胶囊屏（pill-shaped）还有圆角吃边的问题：上下两端左右两侧会被圆角切掉，
 * 贴着边缘的 HUD / 按钮必须往里缩（padTop / padBottom / padX）。
 *
 * 注意：device.getInfo 文档只给了回调形式，但底层同时支持"不传参数直接返回对象"，
 * 这里先试同步、失败再退回回调。同步能取到就不会出现"先按 480 排一帧再跳一下"。
 */
import device from '@system.device'

export const DESIGN_W = 336 // 设计稿宽（= manifest.config.designWidth）
export const DESIGN_H = 480 // 设计稿高（小米手环 9 Pro / 10 Pro 方屏）

// 胶囊屏安全内缩（设计单位）。手环 11 的圆角在 212 宽上约占 40 物理像素，
// 换算成设计单位约 63；但只在最顶上那几行才吃满，所以按"顶部 24 + 文字自身留白"折中。
const PILL_PAD_TOP = 24
const PILL_PAD_BOTTOM = 22 // 底部按钮一排横跨整宽，圆角切得最狠，多留一点
const PILL_PAD_X = 12

export const SCREEN = {
  w: DESIGN_W, // 画布宽（设计单位，恒定）
  h: DESIGN_H, // 画布高（设计单位，随设备变）★ 布局都按它算
  realW: DESIGN_W, // 真实分辨率宽（物理像素）
  realH: DESIGN_H, // 真实分辨率高
  shape: 'rect', // rect / circle / pill-shaped
  dpr: 1, // 设备像素比（PPI/160），只用于展示
  pill: false, // 是否胶囊屏
  tall: false, // 画布是否比设计稿高（多出来的高度归深水区）
  extra: 0, // h - 480，多出来的设计单位
  ready: false, // 是否已拿到真实尺寸（false 时下面全是设计稿默认值）
  name: '小米手环 10 Pro',
  padTop: 0, // 顶部安全内缩
  padBottom: 0, // 底部安全内缩
  padX: 0 // 左右安全内缩
}

/**
 * 型号名（调试用）。关于页 1.0.0 起不再显示机型，这里只保留给日志/排查。
 * 认不出来的设备老实写分辨率。
 */
function deviceName(w, h) {
  if (w === 336 && h === 480) return '小米手环 10 Pro'
  if (w === 212 && h === 520) return '小米手环 11'
  if (w === 192 && h === 490) return '小米手环 9'
  if (w === 172 && h === 320) return 'REDMI 手环'
  if (w === 432 && h === 514) return 'REDMI Watch 5'
  return '手环 ' + w + '×' + h
}

let listeners = []

function notify() {
  const list = listeners
  listeners = []
  for (let i = 0; i < list.length; i++) {
    try {
      list[i](SCREEN)
    } catch (e) {
      console.log('screen listener failed', e)
    }
  }
}

function apply(ret) {
  if (!ret || !ret.screenWidth || !ret.screenHeight) return false
  const rw = ret.screenWidth
  const rh = ret.screenHeight

  SCREEN.realW = rw
  SCREEN.realH = rh
  if (ret.screenShape) SCREEN.shape = ret.screenShape
  if (ret.screenDensity) SCREEN.dpr = ret.screenDensity
  SCREEN.pill = SCREEN.shape === 'pill-shaped'
  SCREEN.name = deviceName(rw, rh)

  // 真实像素 → 设计单位（px 单位就是"真实像素 * designWidth / 真实宽"）
  let h = Math.round((DESIGN_W * rh) / rw)
  // 比设计稿还矮的屏（方屏手表）不在这里适配：压到 480 会让水底那一层被裁掉，
  // 但至少船、鱼、HUD 都在原位；本项目目标机型是手环（Pro / 11），见 README。
  if (h < DESIGN_H) h = DESIGN_H
  SCREEN.h = h
  SCREEN.extra = h - DESIGN_H
  SCREEN.tall = SCREEN.extra > 40

  SCREEN.padTop = SCREEN.pill ? PILL_PAD_TOP : 0
  SCREEN.padBottom = SCREEN.pill ? PILL_PAD_BOTTOM : 0
  SCREEN.padX = SCREEN.pill ? PILL_PAD_X : 0
  SCREEN.ready = true

  notify()
  return true
}

/** 画布高（设计单位）。页面里凡是"纵向要贴底"的东西都该用它算 */
export function screenH() {
  return SCREEN.h
}

/**
 * 订阅一次尺寸变化（拿到真机尺寸时回调一次，之后自动退订）。
 * 返回退订函数：页面 onDestroy 里调一下，避免页面没了还在回调。
 */
export function onScreen(fn) {
  if (SCREEN.ready) {
    fn(SCREEN)
    return function () {}
  }
  listeners.push(fn)
  return function () {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

/** 读取屏幕信息（幂等）。同步拿不到就走回调，两条路都会 notify */
export function probeScreen() {
  if (SCREEN.ready) return true

  // 1) 先试同步返回（底层支持，文档没写）
  try {
    const info = device.getInfo()
    if (apply(info)) return true
  } catch (e) {
    // 老固件不返回对象就往下走
  }

  // 2) 退回文档里的回调形式
  try {
    device.getInfo({
      success: function (ret) {
        apply(ret)
      },
      fail: function () {
        // 拿不到就按设计稿（手环 Pro）排，至少不是黑屏
        SCREEN.ready = true
        notify()
      }
    })
  } catch (e) {
    SCREEN.ready = true
    notify()
  }
  return false
}
