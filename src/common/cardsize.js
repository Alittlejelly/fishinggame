/**
 * 地图选择页的整套尺寸（宽屏 / 窄屏两套）
 *
 * 为什么要分两套：
 *   DESIGN_W=336 决定了 px 是"按设计稿宽度等比缩放"的单位。手环 11 只有 212 物理宽，
 *   整块设计稿被缩到 0.631 倍 —— 30px 的卡名到屏幕上只剩 18.9 物理像素。
 *   手环系统菜单的字大约 28~32 物理像素，所以"设计稿上看着够大"完全不代表真机看得清。
 *
 *   换算口诀：**物理像素 = 设计单位 × 0.631（手环 11）/ × 1（Pro）**
 *   要 25 物理的卡名，设计单位就得写 40；要 43 物理的按钮，就得写 68。
 *
 * 窄屏因此付出两笔代价：
 *   · 一屏只露 3.3 张（原来 7 张几乎全塞进来）—— 剩下的靠 list 滚，第 4 张露一角当提示
 *   · 卡片文案砍到最短：卡名只留地名、描述只留倍率（"1倍分"），星级和最高分竖排两行
 *   这两笔都是刻意的：小屏上"少而大"永远赢过"多而小"。
 *
 * 单独放在 common 里是为了让预览页（tools/preview.mjs）和自测读同一份数据，
 * 不然改完真机再手抄一遍预览，两边迟早对不上。
 */

/**
 * @param {boolean} narrow 真实屏幕宽是否小于 300（手环 11 = 212，手环 9 = 192）
 * @returns {object} 页头 / 列表预留 / 卡片 / 底部胶囊 的所有尺寸与字号
 */
export function cardSizes(narrow) {
  if (!narrow) {
    // 宽屏 336x480（手环 10 Pro）：卡片整体放大到 1.2 倍（2026-11-24 需求）
    return {
      // ---- 页头（不动，只有列表放大）----
      titleSize: 34, subSize: 14,
      // 头部 + 底部按钮占掉的高度（列表 = 画布高 - reserve - padB）
      reserve: 160,
      /* 页面底部留白 15。矩形屏本来没有圆角，早期这里是 0；2026-11-24 真机照片里
       * 三个胶囊几乎贴着屏幕下沿（肉眼只剩一条缝），抬高 15 之后指尖才好落。
       * 留白是从列表那里让出来的（cardsH = 480 - reserve - padB），卡片区少 15。 */
      padB: 15,
      /* ---- 预览框 89x89（原 74 ×1.2）----
       * 框内每个元素都按同一比例挪（×1.2 后取整），否则鱼/尾巴/眼睛会跑出框；
       * 断言在 simulate 里：pvDeepTop + pvDeepH 必须正好等于 pv。 */
      pv: 89, pvWaterTop: 41, pvWaterH: 31, pvDeepTop: 67, pvDeepH: 22,
      pvWaveY: 36, pvWaveW1: 14, pvWaveW2: 12, pvWaveX2: 29,
      pvTailX: 24, pvTailY: 50, pvTailW: 12, pvTailH: 14,
      pvFishX: 34, pvFishY: 53, pvFishW: 34, pvFishH: 11,
      pvEyeX: 60, pvEyeY: 55, pvEyeS: 5, pvLockT: 26,
      /* ---- 卡片与文字（全部 ×1.2：98→118 / 100→120 / 字号 20→24、16→19、18→22）----
       * 宽度是唯一没吃到 1.2 倍的一项：296×1.2 = 355 > 屏宽 336，所以卡宽封顶 336、
       * 左右外边距归零（贴边），横向只多了 13.5%，纵向老老实实 ×1.2。
       * infoW 是硬账：336 - 左右边框 4 - 预览 89 - 预览右边距 10 - 文字列左边距 12 = 221。
       * 一屏从 3 张变 2.5 张（305 / 120），第 3 张露一半，滚动暗示还留着。 */
      cellH: 120, cardH: 118, cardW: 336, cardMl: 0, infoW: 221,
      nameSize: 24, descSize: 19, starSize: 22, bestSize: 19,
      rowH: 29, rowDir: 'row', rowAlign: 'center', bestMl: 12, descMt: 6, rowMt: 5, entryMt: 4, lockBottom: 75,
      // ---- 底部三个胶囊：矩形屏一行放得下，不分行 ----
      twoRows: false, entryGap: 0,
      entryH: 50, entryW: 102, entryWBig: 102, entryWAbout: 102, entryR: 25,
      entrySize: 18, entryTextW: 96, entryTextWBig: 96, entryTextWAbout: 96,
      bigLabel: '★ 鱼缸'
    }
  }
  return {
    // ---- 页头（物理 25 / 16.4）----
    /* subSize 20 → 26（2026-11-24 真机：标题下那行「LV 1 · 星辰 · 300」太小）。
     * 上限就是 26：20 号字量出来 207 宽，"LV 123 · 星辰 · 334000" 到 26 是 269；
     * 这行落在屏顶半圆下面（该高度可用宽度约 303），269 还剩 17 的余量。
     * 28 是 290，真机字体略宽一点就贴到弧线上了，不敢再大。 */
    titleSize: 40, subSize: 26,
    /* 头部 118（标题 48 + 副标题 34 + 上下留白，副标题 20→26 之后多了 8）
     * + 第一行 82 + 行距 10 + 第二行 82 + 12 = 304。
     * 列表 = 824 - 304 - 84(底部圆角安全区) = 436 = 2 张整(372) + 第 3 张露 64。
     * 两行比一行多啃掉 92 —— 这是分行的明码代价，换来每个胶囊宽 82~100 物理、高 52 物理。 */
    reserve: 304,
    /* 底部留白 84（物理 53）。上一版 48（物理 30）—— 真机照片里「关于」两端的圆弧
     * 是被屏幕圆角压掉的：手环 11 的屏是**胶囊形，圆角半径 = 半宽（168 设计 = 106 物理）**，
     * 而不是早先估的 40 物理。距底 d 处的可用宽度 = 2*sqrt(r² - (r-d)²)：
     *   d=48 → 235（放不下 220 的关于，两侧只剩 7.5 设计 = 4.7 物理）
     *   d=84 → 291（两侧各 35.5 设计 = 22 物理）✓
     * 所以底部这块必须整体往上抬，不是把按钮改窄就能了事。 */
    padB: 84,
    /* ---- 预览框 92x92（74 那套 ×1.24，鱼/尾巴/眼睛/水线一起挪，否则跑出框）----
     * ★ 这里的宽度是硬账，别随手加：卡 300 是 border-box，扣掉左右各 2 的边框只剩 296，
     *   预览(92) + margin(10) + info 的 margin(12) + info(180) = 294，只剩 2 的余量。
     *   早先写成 pv 102 / info 176 时正好 300 —— 比内容区宽 4，卡名右边就溢到卡框外了。
     *   预览还给多了会挤掉文字宽度：92 是"预览还能看出是张地图 + 文字留够余量"的平衡点。 */
    pv: 92, pvWaterTop: 42, pvWaterH: 32, pvDeepTop: 70, pvDeepH: 22,
    pvWaveY: 37, pvWaveW1: 15, pvWaveW2: 12, pvWaveX2: 30,
    pvTailX: 25, pvTailY: 52, pvTailW: 12, pvTailH: 15,
    pvFishX: 35, pvFishY: 55, pvFishW: 35, pvFishH: 11,
    pvEyeX: 62, pvEyeY: 57, pvEyeS: 5, pvLockT: 27,
    /* ---- 卡片与文字（物理 24 / 19 / 19 / 19）----
     * 星级和最高分并排放不下（5 星 150 + "最高220" 165），所以竖排两行。
     * cellH(186) 比 cardH(174) 多 12 —— 卡片之间留一条缝，不然边框会连成一堵墙。 */
    cellH: 186, cardH: 174, cardW: 300, cardMl: 18, infoW: 180,
    nameSize: 38, descSize: 30, starSize: 30, bestSize: 30,
    rowH: 72, rowDir: 'column', rowAlign: 'flex-start', bestMl: 0, descMt: 3, rowMt: 2, entryMt: 12, lockBottom: 268,
    /* ---- 底部胶囊：上下两行，上面「等级 + 鱼缸」，下面「关于」单独一行 ----
     * 分行理由：212 物理宽塞三个，每个只有 55~72 物理宽，手指横着放不下。
     * 收窄理由（v3.7）：第一行整排落在圆角之外（d=176 > r=168），可用宽度就是全宽 336，
     * 但两侧还要各留 32 给屏幕弧线的阴影，所以总宽只能到 272（116+144+左右各 3 的外边距）。
     * 上一版 288（130+158）在真机上距屏幕边只剩 11 物理，看着像被啃掉一口。 */
    twoRows: true, entryGap: 10,
    entryH: 82, entryW: 116, entryWBig: 144, entryWAbout: 220, entryR: 41,
    entrySize: 30, entryTextW: 110, entryTextWBig: 138, entryTextWAbout: 214,
    bigLabel: '★鱼缸'
  }
}

/** 窄屏判定：看真实宽度，不看画布高（拿不到尺寸时按宽屏走，安全） */
export function isNarrow(realW) {
  return !!realW && realW < 300
}

/* ---------------- 胶囊屏的圆角 ----------------
 * 手环 11 的屏是**两端半圆**（胶囊），圆角半径 = 屏宽的一半 = 168 设计单位（106 物理）。
 * 早先按 40 物理估的，于是底部按钮一放就两端被吃掉 —— 真机照片里「关于」的圆弧缺一块。
 *
 * 距底 d 处可用宽度：圆角矩形扣掉左右两个半径为 r 的圆之后，中间是直的（336 - 2r = 0），
 * 两侧各剩 sqrt(r² - (r-d)²)，所以 W(d) = 336 - 2r + 2*sqrt(...)（r = 168 时就是 0 + ...）。
 * d ≥ r 之后不再受圆角影响，全宽可用。
 */
export const PILL_R = 168

/** 距屏幕底 d（设计单位）处横向还剩多少宽度可用 */
export function pillAvailW(d, r, W) {
  const R = r || PILL_R
  const FULL = W || 336
  if (d <= 0) return 0
  if (d >= R) return FULL
  return FULL - 2 * R + 2 * Math.sqrt(R * R - (R - d) * (R - d))
}

/**
 * 窄屏的卡片描述：'慢鱼 · 1倍分 · 60秒' → '1倍分'。
 * 27px 字号下 170 宽的信息区只放得下 6 个多字，氛围描述和时长都得让位
 * （时长在游戏 HUD 里一直显示，不缺这一处）。
 */
export function shortDesc(desc) {
  const parts = String(desc).split(' · ')
  return parts.length > 2 ? parts[1] : desc
}

/** 窄屏的卡片标题：'初级 · 青草池塘' → '青草池塘'（40px 下带前缀必然折行） */
export function titleOf(theme, narrow) {
  return narrow ? theme.name : theme.level + ' · ' + theme.name
}

/** 窄屏的最高分：'最高 220 分' → '最高220'（去掉空格和量词，30px 下才不折行） */
export function bestOf(score, locked, narrow) {
  if (locked) return '未解锁'
  return narrow ? '最高' + score : '最高 ' + score + ' 分'
}
