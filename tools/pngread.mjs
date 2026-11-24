/**
 * 最小 PNG 解码器（只支持 8bit、非隔行、RGBA/RGB）。
 *
 *   node tools/pngread.mjs <file.png>
 *
 * 只给工具链自己用：读外部设计稿（比如画板导出的 logo），再按像素格重采样。
 * 不解调色板图/16bit/Adam7 —— 设计稿导出选 PNG-24/32 就好。
 */
import fs from 'fs'
import zlib from 'zlib'

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

export function readPng(file) {
  const b = fs.readFileSync(file)
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG: ' + file)

  let pos = 8
  let w = 0
  let h = 0
  let colorType = 0
  let bitDepth = 0
  let interlace = 0
  const idat = []
  let pal = null
  let trns = null

  while (pos < b.length) {
    const len = b.readUInt32BE(pos)
    const type = b.toString('ascii', pos + 4, pos + 8)
    const data = b.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      pal = data
    } else if (type === 'tRNS') {
      trns = data
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }

  if (bitDepth !== 8) throw new Error('只支持 8bit，当前 ' + bitDepth)
  if (interlace !== 0) throw new Error('不支持隔行 PNG')

  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0
  if (!ch && !pal) throw new Error('不支持的颜色类型 ' + colorType)

  const bpp = pal ? 1 : ch
  const stride = w * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(h * stride)

  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const bb = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = src[x]
      if (ft === 1) v += a
      else if (ft === 2) v += bb
      else if (ft === 3) v += (a + bb) >> 1
      else if (ft === 4) v += paeth(a, bb, c)
      cur[x] = v & 255
    }
  }

  /** 取某像素的 rgba 数组 */
  const at = (x, y) => {
    const i = y * stride + x * bpp
    if (pal) {
      const idx = out[i]
      const a = trns && idx < trns.length ? trns[idx] : 255
      return [pal[idx * 3], pal[idx * 3 + 1], pal[idx * 3 + 2], a]
    }
    if (ch === 4) return [out[i], out[i + 1], out[i + 2], out[i + 3]]
    if (ch === 3) return [out[i], out[i + 1], out[i + 2], 255]
    if (ch === 2) return [out[i], out[i], out[i], out[i + 1]]
    return [out[i], out[i], out[i], 255]
  }

  return { w, h, colorType, at }
}

/* ---------------- CLI：量像素格 ---------------- */
if (process.argv[2] && process.argv[1] && process.argv[1].endsWith('pngread.mjs')) {
  const file = process.argv[2]
  const img = readPng(file)
  const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')

  const colors = new Map()
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const k = hex(img.at(x, y))
      colors.set(k, (colors.get(k) || 0) + 1)
    }
  }

  // 沿一行/一列找颜色变化点，世界最小公差不一定是格子，所以取所有变化间隔的众数
  const runs = []
  for (let y = 0; y < img.h; y++) {
    let last = hex(img.at(0, y))
    let len = 1
    for (let x = 1; x < img.w; x++) {
      const c = hex(img.at(x, y))
      if (c === last) len++
      else {
        runs.push(len)
        last = c
        len = 1
      }
    }
  }
  const hist = new Map()
  for (const r of runs) hist.set(r, (hist.get(r) || 0) + 1)
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

  console.log(`${file}  ${img.w}x${img.h}  colorType=${img.colorType}`)
  console.log('颜色数', colors.size)
  console.log('出现最多的颜色：')
  ;[...colors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([c, n]) => console.log('  ', c, n))
  console.log('横向色块长度众数（推测格宽）：')
  top.forEach(([len, n]) => console.log('   ', len, 'px ×', n))
}
