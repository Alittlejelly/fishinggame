/**
 * 参数化像素鱼生成器（一次性调形工具）。
 * 输出：控制台打印字符网格 + preview/fish-gen.png 位图，肉眼确认后复制进 fishing.ux。
 */
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

const root = path.resolve(import.meta.dirname, '..')

function makeFish(W, H, o = {}) {
  const g = Array.from({ length: H }, () => new Array(W).fill('.'))
  const cy = Math.floor((H - 1) / 2)
  const rx = o.rx
  const ry = o.ry
  const cx = W - 1 - rx // 身体贴右，左侧留给尾巴
  const put = (x, y, c) => {
    if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c
  }

  // 1) 身体椭圆
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1.0) put(x, y, 'B')
    }
  }

  // 2) 尾柄：把身体和尾鳍连起来的窄脖子（2 行）
  const bodyLeft = cx - rx
  const neckLen = 2
  for (let x = bodyLeft - neckLen; x < bodyLeft; x++) {
    put(x, cy - 1, 'B')
    put(x, cy, 'B')
  }

  // 3) 尾鳍：三角，尖端贴尾柄，宽端在最左
  const tailRows = o.tail
  const tailFar = bodyLeft - neckLen // 尾鳍最右端
  for (let dy = -tailRows; dy <= tailRows; dy++) {
    const t = 1 - Math.abs(dy) / (tailRows + 0.5)
    const w = Math.max(1, Math.round((tailFar + 1) * t))
    for (let x = 0; x < w; x++) put(x, cy + dy, 'F')
  }

  // 4) 背鳍：把背部顶行的几个身体像素换成鳍色（贴合，不悬空）
  const topRow = cy - ry
  for (let x = cx - 3; x <= cx + 1; x++) if (g[topRow] && g[topRow][x] === 'B') put(x, topRow, 'F')
  for (let x = cx - 2; x <= cx; x++) if (g[topRow - 1] && g[topRow - 1][x] === '.') put(x, topRow - 1, 'F')
  // 嘴巴（头部右端一个暗像素）
  put(cx + rx, cy, 'E')

  // 5) 腹部高光：身体最下两行
  for (let y = cy + ry - 1; y <= cy + ry; y++) {
    if (y < 0 || y >= H) continue
    const n = g[y].filter((c) => c === 'B').length
    if (n < 4) continue
    for (let x = 0; x < W; x++) if (g[y][x] === 'B') g[y][x] = 'W'
  }

  // 6) 眼睛（身体内，靠头部）
  put(cx + rx - 3, cy - 1, 'E')

  const rows = g.map((r) => r.join(''))
  // 去掉底/顶只有 1~2 像素的尖刺（描边后会像一截断腿）
  const count = (r) => r.replace(/\./g, '').length
  while (rows.length && count(rows[rows.length - 1]) < 3) rows.pop()
  while (rows.length && count(rows[0]) < 3) rows.shift()
  const filled = (r) => r.replace(/\./g, '').length > 0
  while (rows.length && !filled(rows[0])) rows.shift()
  while (rows.length && !filled(rows[rows.length - 1])) rows.pop()
  return rows
}

const specs = [
  ['small', 14, 10, { rx: 4, ry: 3, tail: 3, finW: 5, finH: 1, finX: -1 }],
  ['mid', 18, 12, { rx: 6, ry: 4, tail: 4, finW: 6, finH: 1, finX: -1 }],
  ['big', 22, 14, { rx: 7, ry: 5, tail: 5, finW: 7, finH: 1, finX: -1 }]
]

const out = []
for (const [name, w, h, o] of specs) {
  const rows = makeFish(w, h, o)
  out.push('  ' + name + ': [')
  rows.forEach((r, i) => out.push("    '" + r + "'" + (i < rows.length - 1 ? ',' : '')))
  out.push('  ],')
}
console.log(out.join('\n'))

/* ---------- 渲染 ---------- */
function rgb(c) {
  const h = c.slice(1)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const S = 9
const pal = { B: '#f0b352', F: '#c07a26', W: '#ffdc9a', E: '#20140a', O: '#0a1c12' }
const W = 22 * S + 60
const H = specs.reduce((s, [, , h]) => s + (h + 2) * S + 20, 20)
const buf = new Uint8Array(W * H * 4)
for (let i = 0; i < W * H; i++) {
  buf[i * 4] = 0x10
  buf[i * 4 + 1] = 0x14
  buf[i * 4 + 2] = 0x18
  buf[i * 4 + 3] = 255
}
const paint = (x, y, c) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const [r, g2, b] = rgb(c)
  const i = (y * W + x) * 4
  buf[i] = r
  buf[i + 1] = g2
  buf[i + 2] = b
}
// 简易描边
function outline(rows) {
  const h = rows.length
  const w = rows[0].length
  const o = rows.map((r) => r.split(''))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (rows[y][x] !== '.') continue
      const n = [
        rows[y - 1] && rows[y - 1][x],
        rows[y + 1] && rows[y + 1][x],
        rows[y][x - 1],
        rows[y][x + 1]
      ]
      if (n.some((c) => c && c !== '.')) o[y][x] = 'O'
    }
  return o.map((r) => r.join(''))
}

let oy = 20
for (const [name, w, h, o] of specs) {
  const padded = ['.'.repeat(w + 2)]
    .concat(makeFish(w, h, o).map((r) => '.' + r + '.'))
    .concat(['.'.repeat(w + 2)])
  const rows = outline(padded)
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === '.') continue
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) paint(20 + x * S + px, oy + y * S + py, pal[ch])
    }
  })
  oy += (h + 2) * S + 20
}

function crc32(b) {
  const t = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8
ihdr[9] = 6
const raw = Buffer.alloc((W * 4 + 1) * H)
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0
  Buffer.from(buf.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1)
}
fs.writeFileSync(
  path.join(root, 'preview', 'fish-gen.png'),
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
)
console.log('\nwritten preview/fish-gen.png')
