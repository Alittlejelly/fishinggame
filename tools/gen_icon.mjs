/**
 * 生成 logo 系列：
 *   src/common/logo.png     192x192 —— 应用图标（manifest.json 的 icon）
 *   src/common/logo-48.png   48x48  —— 关于页页头（192 / 4，整数降采样）
 *   src/common/logo-64.png   64x64  —— 备用（192 / 3）
 *
 *   node tools/gen_icon.mjs
 *
 * 设计稿放在 tools/assets/logo-src.png（画板导出，192x192、圆形外透明）。
 * 原来是拿鱼精灵程序化画一张，现在改成"设计稿即真源"：
 * 界面上看到的和桌面上看到的必须是同一张图，省得改一处忘一处。
 *
 * 降采样一律用最近邻（取每块中心像素）：像素图不能用双三次，
 * 一插值边缘就糊成一片，圆形 logo 缩到 48 会变成灰疙瘩。
 */
import path from 'path'
import { canvas, writePng } from './pixel.js'
import { readPng } from './pngread.mjs'

const root = path.resolve(import.meta.dirname, '..')
const SRC = path.join(root, 'tools/assets/logo-src.png')
const OUT = path.join(root, 'src/common')

const src = readPng(SRC)

/**
 * 缩放到 size×size。
 *
 * 设计稿的圆边带抗锯齿（alpha 64~192 的过渡带），直接最近邻取中心像素会把这一圈
 * 随机采样成"有缺口"的锯齿圆 —— 48px 下看起来像被虫啃过。所以小尺寸走 crisp：
 * 每 block×block 个像素投票，不透明占一半以上才算不透明，颜色取块内众数。
 * 等于先二值化 alpha 再降采样，圆边变成干净的阶梯，颜色也不会被抗锯齿的过渡色污染。
 */
function resize(size, crisp) {
  const cv = canvas(size, size)
  const k = src.w / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      if (!crisp) {
        ;[r, g, b, a] = src.at(
          Math.min(src.w - 1, Math.floor(x * k + k / 2)),
          Math.min(src.h - 1, Math.floor(y * k + k / 2))
        )
      } else {
        const x0 = Math.floor(x * k)
        const y0 = Math.floor(y * k)
        const x1 = Math.min(src.w, Math.floor((x + 1) * k))
        const y1 = Math.min(src.h, Math.floor((y + 1) * k))
        const vote = new Map()
        let solid = 0
        let total = 0
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            total++
            const c = src.at(px, py)
            if (c[3] < 128) continue
            solid++
            const key = (c[0] << 16) | (c[1] << 8) | c[2]
            vote.set(key, (vote.get(key) || 0) + 1)
          }
        }
        if (!total || solid * 2 < total) continue
        let bestKey = 0
        let bestN = -1
        for (const [key, n] of vote) {
          if (n > bestN) {
            bestN = n
            bestKey = key
          }
        }
        r = (bestKey >> 16) & 255
        g = (bestKey >> 8) & 255
        b = bestKey & 255
        a = 255
      }

      if (a < 128) continue
      const i = (y * size + x) * 4
      cv.buf[i] = r
      cv.buf[i + 1] = g
      cv.buf[i + 2] = b
      cv.buf[i + 3] = 255
    }
  }
  return cv
}

// 应用图标：1:1 重写一遍（统一走 writePng，顺手保证是 RGBA、无多余 chunk）。
// 桌面图标要抗锯齿的圆边，所以这里不投票、原样搬。
writePng(path.join(OUT, 'logo.png'), resize(src.w, false))
console.log('logo.png', src.w + 'x' + src.h)

for (const s of [48, 64]) {
  writePng(path.join(OUT, `logo-${s}.png`), resize(s, true))
  console.log(`logo-${s}.png ${s}x${s}`)
}
