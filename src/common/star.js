/**
 * 星标鱼（★）—— 每张地图只出一种，是本图的"招牌猎物"。
 *
 * 星标鱼和普通鱼的区别只有三条，都在这里统一约定：
 *   1. 全身金色（STAR_PAL），在任何一张地图的水色里都能一眼认出；
 *   2. 钓上来的那一下要玩「拉鱼力度条」（fishing.ux 的 reel 阶段），
 *      力度条只在星标鱼身上出现 —— 普通鱼照旧直接入护；
 *   3. 只有星标鱼能放进鱼缸（tank.ux），每个缸位对应一张地图，共 7 位。
 *
 * 主页面、鱼缸页、构建脚本、自测都从这一份取数据，改星标鱼只改这里。
 * 注意 shape 必须是 fishing.ux 的 SPR 里已有的造型，否则烘图时会报错。
 */

/** 星标鱼的统一配色：金身 + 亮腹 + 深金描边，跨地图一致 */
export const STAR_PAL = {
  body: '#f7c948',
  fin: '#c08a1e',
  belly: '#fff4c6',
  red: '#fffbe8',
  eye: '#3a2400',
  outline: '#5a3a00'
}

/**
 * 鱼缸存储：'m:shape:ts' 的换行数组，ts 是钓到那一刻的毫秒时间戳。
 *
 * 为什么把时间塞进同一条记录里（而不是另开一个 key 存时间表）：
 * 两处分别写就一定会出现"鱼在缸里、时间却没写上"的半截状态，
 * 而鱼缸页要拿时间做详情展示 —— 宁可一条记录完整，也不要两张表对齐。
 * 老的 'm:shape'（两段）照旧能读，时间按 0 处理，界面上显示"时间未知"。
 */
export const TANK_KEY = 'band_pixel_tank'

/**
 * 七条星标鱼，按地图顺序（m = THEMES 下标）。
 * value 是基础分（还没乘地图倍率与连击），约等于同图最贵普通鱼的 1.8~2 倍。
 */
export const STARS = [
  { m: 0, shape: 'trout', name: '虹鳟', value: 16, tier: '初级', map: '青草池塘', color: '#8fe0a2', w: 110, h: 60 },
  { m: 1, shape: 'koi', name: '锦鲤', value: 28, tier: '中级', map: '碧波湖', color: '#79d8f5', w: 130, h: 50 },
  { m: 2, shape: 'crab', name: '螃蟹', value: 26, tier: '高级', map: '幽暗深海', color: '#bb93ff', w: 100, h: 55 },
  { m: 3, shape: 'icefish', name: '冰鱼', value: 30, tier: '极寒', map: '极光冰海', color: '#8ff0ea', w: 115, h: 55 },
  { m: 4, shape: 'octopus', name: '章鱼', value: 36, tier: '秘林', map: '紫雾藻林', color: '#d98cff', w: 90, h: 75 },
  { m: 5, shape: 'starfish', name: '海星', value: 44, tier: '熔岩', map: '熔岩海沟', color: '#ff8a3c', w: 75, h: 70 },
  { m: 6, shape: 'ray', name: '鳐鱼', value: 56, tier: '星海', map: '星海之底', color: '#cfe4ff', w: 125, h: 65 }
]

/** 某张地图的星标鱼（越界时退回第一条，页面永远不会因为下标拿不到数据而白屏） */
export function starOf(m) {
  return STARS[m] || STARS[0]
}

/** 鱼缸键：'1:koi' —— 地图下标 + 造型，天然去重 */
export function tankId(m) {
  return m + ':' + starOf(m).shape
}

/** 鱼缸条目：'1:koi:1731832000000'。ts 缺省写 0（= 时间未知），不写空串，分割后段数固定 */
export function tankEntry(m, ts) {
  return tankId(m) + ':' + (ts || 0)
}

/**
 * 解析鱼缸存储 → [{ id, m, ts }]
 * - 三段的 'm:shape:ts' 是现在的格式；
 * - 两段的 'm:shape' 是 v2.x 早期写的，照样收，ts 记 0；
 * - 脏数据（段数不对、m 不是数字）直接丢掉，绝不让一条坏记录把整缸读空。
 */
export function parseTank(raw) {
  if (!raw || typeof raw !== 'string') return []
  const list = []
  const seen = {}
  const rows = raw.split('\n')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const p = row.split(':')
    if (p.length < 2) continue
    const m = parseInt(p[0], 10)
    if (isNaN(m) || m < 0 || m >= STARS.length) continue
    const id = tankId(m)
    if (seen[id]) continue // 同一条鱼重复记录只留第一条（老的 putInTank 没做前缀匹配时的脏数据）
    seen[id] = 1
    list.push({ id: id, m: m, ts: parseInt(p[2], 10) || 0 })
  }
  return list
}

/** 毫秒时间戳 → 'YYYY-MM-DD HH:mm'。0 / 非法值回 ''，调用方自己决定显示什么 */
export function fmtTime(ts) {
  if (!ts) return ''
  let d
  try {
    d = new Date(ts)
  } catch (e) {
    return ''
  }
  if (!d || isNaN(d.getTime())) return ''
  return (
    d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  )
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n
}
