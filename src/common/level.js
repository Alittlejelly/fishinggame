/**
 * 等级系统：用「钓鱼积分」（历史累计钓到的分数）换算等级。
 *
 * 规则：每 15 级换一个徽章样式 —— TIERS[0] 是 Lv1~15，TIERS[1] 是 Lv16~30，依此类推。
 * 一个等级区间（tier）内的积分是**均分**到 15 级的，所以进度条走起来很线性：
 *   tierStart + 每级所需 * 已过级数  ≤  总积分  <  tierStart + 每级所需 * (已过级数 + 1)
 *
 * 徽章图由 tools/gen_sprites.mjs 按 TIERS 顺序烘成：
 *   /common/sprites/lv-<i>.png    小图 30x34（选择页 / 结算页）
 *   /common/sprites/lv-<i>-b.png  大图 60x68（等级页）
 *
 * 这个文件被 fishing.ux 和 level.ux 共用，改数值只改这里。
 */

export const LV_PER_TIER = 15 // 每 15 级换一次样式
export const MAX_TIER = 9 // TIERS.length，写死给 fallback 用

/**
 * start = 进入该档所需的累计积分。
 *
 * 节奏基准（单局大致得分：初图 ~250 / 中图 ~650 / 高图 ~850）：
 *   木牌档每级 200 分 → 初图一局升 1~2 级，换第一枚徽章要攒十来局；
 *   之后每档跨度放大约 2 倍，越往后越像"长期目标"，不再一局跳十级。
 *   满级 31.6 万分是给老玩家的终点，正常玩几个月也到不了，不着急。
 *
 * 三张地图按等级解锁（见 fishing.ux 的 THEMES[].needLv）：
 *   初图 Lv1（开局就能玩）/ 中图 Lv10（约 1800 分）/ 高图 Lv20（约 1.06 万分）
 */
export const TIERS = [
  { name: '木牌', start: 0, color: '#d9a05e' },
  { name: '翠玉', start: 3000, color: '#8fe0a2' },
  { name: '青晶', start: 9000, color: '#7fe6ee' },
  { name: '蓝晶', start: 20000, color: '#79b8f5' },
  { name: '紫晶', start: 40000, color: '#c1a0ff' },
  { name: '红玉', start: 74000, color: '#ff8f86' },
  { name: '银翼', start: 126000, color: '#dfe7f2' },
  { name: '金翼', start: 202000, color: '#ffd166' },
  { name: '星辰', start: 316000, color: '#ffffff' }
]

export const LEVEL_KEY = 'band_pixel_fish_total' // 累计积分
export const BEST_KEY = 'band_pixel_fish_' // 单图最高分（与游戏页共用）

/**
 * 总积分 → 等级明细。
 * 返回值全部是"能直接塞进模板"的普通值，页面不用再算：
 *   level     当前等级（1 起）
 *   tier      档位下标（0 起），决定用哪张徽章
 *   tierName  档位名（木牌 / 翠玉 / …）
 *   color     档位主色
 *   inTier    本档内第几级（1~15）
 *   floor/ceil 本级起点 / 下一级起点（积分）
 *   percent   本级进度 0~100（进度条宽度 = 百分比）
 *   toNext    还差多少分升级
 *   isMax     是否已到顶档最后一级
 */
export function levelInfo(total) {
  const t = Math.max(0, Math.floor(Number(total) || 0))

  let tier = 0
  for (let i = 0; i < TIERS.length; i++) {
    if (t >= TIERS[i].start) tier = i
  }

  const start = TIERS[tier].start
  // 每档的跨度 = 下一档起点 - 本档起点；顶档没有"下一档"，沿用上一档的跨度
  const prevStart = tier > 0 ? TIERS[tier - 1].start : 0
  const span = tier < TIERS.length - 1 ? TIERS[tier + 1].start - start : start - prevStart || 60000
  const step = span / LV_PER_TIER

  let inTier = Math.floor((t - start) / step)
  if (inTier > LV_PER_TIER - 1) inTier = LV_PER_TIER - 1 // 顶档最后一级封顶
  if (inTier < 0) inTier = 0

  const floor = start + inTier * step
  const ceil = floor + step
  const isMax = tier === TIERS.length - 1 && inTier === LV_PER_TIER - 1

  return {
    total: t,
    level: tier * LV_PER_TIER + inTier + 1,
    tier,
    tierName: TIERS[tier].name,
    color: TIERS[tier].color,
    inTier: inTier + 1,
    floor: Math.floor(floor),
    ceil: Math.floor(ceil),
    percent: isMax ? 100 : Math.max(0, Math.min(100, ((t - floor) / step) * 100)),
    toNext: isMax ? 0 : Math.ceil(ceil - t),
    isMax
  }
}

/** 徽章图路径（size = 's' 小图 / 'b' 大图），页面里直接用 */
export function badgeSrc(tier, size) {
  return '/common/sprites/lv-' + Math.max(0, Math.min(TIERS.length - 1, tier)) + (size === 'b' ? '-b' : '') + '.png'
}
