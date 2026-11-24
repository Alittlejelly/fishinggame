/**
 * 像素精灵的"打点"工具：把字符网格画成位图 / 矩形块。
 *
 * 为什么会走位图这条路：
 *   最早游戏是把每个像素块当成一个 <div>，一条鱼 ~50 个块，三鱼 + 钓具 + 钩
 *   一帧要重建 200 多个块、做一次完整的数组 diff，手环上直接卡成幻灯片。
 *   现在精灵在构建期就烘成 PNG，运行时一帧只改 10 来个 left/top。
 *
 * 这个文件只给工具链用（tools/gen_sprites.mjs、tools/preview.mjs），
 * 不进 rpk。精灵的"真源"仍然是 src/pages/fishing/fishing.ux 里的 SPR 字符网格。
 */
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

/* ---------------- 颜色 ---------------- */
export function color(c) {
  if (c[0] === '#') {
    let h = c.slice(1)
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255]
  }
  const m = c.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s.trim()))
    return [p[0], p[1], p[2], p.length > 3 ? Math.round(p[3] * 255) : 255]
  }
  return [255, 0, 255, 255]
}

/* ---------------- 画布（默认全透明） ---------------- */
export function canvas(w, h, bg) {
  const buf = new Uint8Array(w * h * 4)
  const cv = { w, h, buf }
  if (bg) rect(cv, 0, 0, w, h, bg)
  return cv
}

// source-over 合成，保留 alpha（船的倒影是半透明的）
export function rect(cv, x, y, w, h, col) {
  const [r, g, b, a] = color(col)
  const sa = a / 255
  if (sa <= 0) return
  const x0 = Math.max(0, Math.round(x))
  const y0 = Math.max(0, Math.round(y))
  const x1 = Math.min(cv.w, Math.round(x + w))
  const y1 = Math.min(cv.h, Math.round(y + h))
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * cv.w + px) * 4
      const da = cv.buf[i + 3] / 255
      const oa = sa + da * (1 - sa)
      if (oa <= 0) continue
      cv.buf[i] = Math.round((r * sa + cv.buf[i] * da * (1 - sa)) / oa)
      cv.buf[i + 1] = Math.round((g * sa + cv.buf[i + 1] * da * (1 - sa)) / oa)
      cv.buf[i + 2] = Math.round((b * sa + cv.buf[i + 2] * da * (1 - sa)) / oa)
      cv.buf[i + 3] = Math.round(oa * 255)
    }
  }
}

/* ---------------- PNG 编码 ---------------- */
function crc32(buf) {
  const table = []
  let c
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function writePng(file, cv) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(cv.w, 0)
  ihdr.writeUInt32BE(cv.h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((cv.w * 4 + 1) * cv.h)
  for (let y = 0; y < cv.h; y++) {
    raw[y * (cv.w * 4 + 1)] = 0 // filter: none
    Buffer.from(cv.buf.buffer, y * cv.w * 4, cv.w * 4).copy(raw, y * (cv.w * 4 + 1) + 1)
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, png)
  return png.length
}

/* ---------------- 字符网格 → 绘制 ---------------- */

// 逐行游程合并：一行里连续同色像素并成一个块
export function rectsOf(rows, pal, unit) {
  const out = []
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]
    let x = 0
    while (x < row.length) {
      const ch = row.charAt(x)
      if (ch === '.') {
        x++
        continue
      }
      let w = 1
      while (x + w < row.length && row.charAt(x + w) === ch) w++
      const c = pal[ch]
      if (c) out.push({ x: x * unit, y: y * unit, w: w * unit, h: unit, c })
      x += w
    }
  }
  return out
}

// 竖向再合并：上下相邻、同色同宽的块拼成一块
export function mergeRects(list) {
  const out = []
  const open = {}
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    const k = r.x + '|' + r.w + '|' + r.c
    const o = open[k]
    if (o && o.y + o.h === r.y) {
      o.h += r.h
    } else {
      const nr = { x: r.x, y: r.y, w: r.w, h: r.h, c: r.c }
      out.push(nr)
      open[k] = nr
    }
  }
  return out
}

export function offsetRects(list, dx, dy) {
  return list.map((r) => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h, c: r.c }))
}

/**
 * 左右镜像一组像素块（就地按包围盒对称）。
 * 包围盒宽度不变，所以镜像后 rigToPng 算出来的 dx/dy/w/h 和原图完全一致，
 * 页面里只换 src、不用改任何定位常量 —— 竿尖的横坐标例外，得单独算。
 */
export function mirrorRects(list) {
  let minX = Infinity
  let maxX = -Infinity
  for (const r of list) {
    minX = Math.min(minX, r.x)
    maxX = Math.max(maxX, r.x + r.w)
  }
  return list.map((r) => ({ x: minX + maxX - (r.x + r.w), y: r.y, w: r.w, h: r.h, c: r.c }))
}

export function flipRows(rows) {
  return rows.map((r) => r.split('').reverse().join(''))
}

// 外包一圈透明像素，给描边留位置
export function padRows(rows) {
  const w = rows[0].length + 2
  const blank = new Array(w + 1).join('.')
  const out = [blank]
  rows.forEach((r) => out.push('.' + r + '.'))
  out.push(blank)
  return out
}

// 自动描边：空像素若与实心像素相邻，就变成描边像素 O
// 小屏上深色描边能让精灵从水色里"跳"出来，辨识度提升非常明显
export function outlineRows(rows) {
  const h = rows.length
  const w = rows[0].length
  const out = []
  for (let y = 0; y < h; y++) {
    let line = ''
    for (let x = 0; x < w; x++) {
      const c = rows[y].charAt(x)
      if (c !== '.') {
        line += c
        continue
      }
      const up = y > 0 ? rows[y - 1].charAt(x) : '.'
      const dn = y < h - 1 ? rows[y + 1].charAt(x) : '.'
      const lf = x > 0 ? rows[y].charAt(x - 1) : '.'
      const rt = x < w - 1 ? rows[y].charAt(x + 1) : '.'
      const near = (v) => v !== '.' && v !== 'O'
      line += near(up) || near(dn) || near(lf) || near(rt) ? 'O' : '.'
    }
    out.push(line)
  }
  return out
}

export function styled(rows) {
  const o = outlineRows(padRows(rows))
  return { r: o, l: flipRows(o) }
}

/**
 * 船 + 渔夫 + 鱼竿合成一台"钓具"。
 * 船上的一切相对船左边缘/船顶部定位，所以整张精灵可以当一张图整体平移。
 * 返回本地坐标（可能带负数 y），由 rigToPng 负责贴到画布上。
 */
export function buildRig(S) {
  const boatR = rectsOf(styled(S.SPR.boat).r, S.PAL.boat, S.UNIT)
  const angR = rectsOf(S.SPR.angler, S.PAL.angler, S.UNIT)
  const rig = boatR.slice()
  for (const r of angR) {
    rig.push({ x: r.x + S.RIG_DX, y: r.y + S.RIG_DY, w: r.w, h: r.h, c: r.c })
  }

  // 鱼竿：从手上斜向右上一段段长出去，竿尖正好在船头之外
  const handX = S.RIG_DX + 35
  const handY = S.RIG_DY + 35
  for (let i = 0; i < 12; i++) {
    rig.push({
      x: handX + i * 5,
      y: handY - i * 3,
      w: 5,
      h: 3,
      c: i >= 10 ? S.ROD_TIP_C : S.ROD_C
    })
  }

  // 船头小浪花 + 水面倒影，船才像"浮"在水上
  rig.push({ x: 96, y: 44, w: 6, h: 3, c: 'rgba(255,255,255,0.28)' })
  rig.push({ x: 12, y: 46, w: 74, h: 4, c: 'rgba(0,0,0,0.24)' })
  rig.push({ x: 26, y: 50, w: 48, h: 3, c: 'rgba(0,0,0,0.14)' })
  return rig
}

/* ---------------- 精灵 → 位图 ---------------- */

// 一个字符网格精灵画成一张正好等于显示尺寸的 PNG（不缩放，避免插值糊边）
export function gridToPng(file, rows, pal, unit) {
  const cv = canvas(rows[0].length * unit, rows.length * unit)
  for (const r of rectsOf(rows, pal, unit)) rect(cv, r.x, r.y, r.w, r.h, r.c)
  return { w: cv.w, h: cv.h, bytes: writePng(file, cv) }
}

/**
 * 船 + 渔夫 + 鱼竿合成一张"钓具"位图。
 * 精灵本地坐标里有负数 y（渔夫站在船顶上方、鱼竿往上斜），
 * 所以按包围盒贴到画布上，同时返回包围盒偏移供页面定位。
 */
export function rigToPng(file, rects) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  const w = Math.ceil(maxX - minX)
  const h = Math.ceil(maxY - minY)
  const cv = canvas(w, h)
  for (const r of rects) rect(cv, r.x - minX, r.y - minY, r.w, r.h, r.c)
  return { w, h, dx: minX, dy: minY, bytes: writePng(file, cv) }
}
