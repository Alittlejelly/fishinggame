/**
 * 鱼缸 / 关于 两页的整套尺寸（宽屏 336x480 / 窄屏 212x520 两套）
 *
 * 和 cardsize.js 同一套换算：**物理像素 = 设计单位 × 0.631**（手环 11）。
 * 这两页原来是照 480 的设计稿写死的，换到 824 的画布上就出两个毛病：
 *   · 字号看着"设计稿够大"，真机上只有 11~12 物理像素（手环系统菜单 28~32）
 *   · 内容按 480 排完就停在屏幕上半截，下面 344 个单位全是空白
 *
 * 所以窄屏这套不只是把字放大，还要把"画布多出来的高度"用掉：
 *   鱼缸 256 → 460（物理 290，占屏高 56%），鱼 52x30 → 78x44，七条泳道 30 → 56
 *   关于页把行距和间距一起撑开，正文 18 → 26（物理 16.4）
 *
 * 宽屏分支是**设计稿原值**，一个像素都不动 —— Pro 上已经调好的东西不要碰。
 */

/* 胶囊屏的可用宽度：W(d) = 2·√(r² − (r−d)²)，r = 半宽 = 168 设计单位。
 * 顶部那一条（剩余时间条 + HUD）同样受它约束，所以这里也用得上。 */
import { pillAvailW } from './cardsize.js'

/* ---------------- 鱼缸 ---------------- */
/**
 * @param {boolean} narrow 真实屏幕宽 < 300（手环 11 = 212）
 */
export function tankSizes(narrow) {
  if (!narrow) {
    return {
      // 缸体：内容区（不含 3px 边框）
      tankW: 300, tankH: 256, sandH: 25, shineH: 54,
      // 鱼：缩放上限 + 泳道
      fishMaxW: 52, fishMaxH: 30, laneTop: 10, laneGap: 30,
      // 三根水草的净高（底端都插进沙子里 18，顶到同一条线）
      weedH: [60, 46, 56],
      // 页头
      hdrMt: 4, hdrT: 30, hdrS: 14,
      // 详情块（名字 / 时间 / 基础分）
      infoH: 72, nameSize: 17, timeSize: 15, subSize: 12,
      noteSize: 13, missSize: 14, emptySize: 15,
      // 返回胶囊：bottom 是离屏幕下沿的距离，R = 高的一半（半圆端）
      backW: 160, backH: 48, backR: 24, backSize: 17, backTxtW: 150, backBottom: 22
    }
  }
  return {
    /* 缸体：宽度只能顶满（212 物理宽本来就窄），高度从 256 长到 460。
     * 824 的画布上原来缸只占屏幕 1/3 高、上下各空一大块，鱼小得看不清。 */
    tankW: 300, tankH: 440, sandH: 40, shineH: 96,
    /* 鱼：52x30 → 78x44（物理 49x28），泳道间距 30 → 56。
     * 七条铺满 460 的缸：20 + 6*56 = 356，加鱼高 44 = 400，还在沙地（420）之上。 */
    fishMaxW: 78, fishMaxH: 44, laneTop: 20, laneGap: 56,
    weedH: [100, 78, 92],
    hdrMt: 4, hdrT: 40, hdrS: 20,
    infoH: 110, nameSize: 26, timeSize: 24, subSize: 20,
    noteSize: 22, missSize: 22, emptySize: 22,
    /* 返回胶囊：高 84（物理 53），离下沿 72（物理 45），宽 200。
     * 原来是 220 宽、离下沿 48 —— 屏是两端半圆（r=168），48 那个高度只剩 235 可用宽，
     * 220 的按钮两侧仅 7.5 设计单位，真机上两端弧线会被屏幕边吃掉。
     * 现在 72 处可用 276，200 的按钮两侧各 38。缸高 460 → 440 让出这 12。 */
    backW: 200, backH: 84, backR: 42, backSize: 28, backTxtW: 186, backBottom: 72
  }
}

/* ---------------- 关于 ---------------- */
/**
 * @param {boolean} narrow 同上
 */
export function aboutSizes(narrow) {
  if (!narrow) {
    return {
      padX: 20, hdrPadL: 20, hdrMt: 8, logo: 48, logoGap: 12, tSize: 34, sSize: 15,
      sub: 'ABOUT · PIXEL FISHING',
      cardMt: 6, cardPad: 9, nameSize: 32, verSize: 17,
      secSize: 17, secMt: 8,
      liSize: 18, liMt: 5, lisMt: 5,
      rkL: 18, rkV: 20, rkMt: 4,
      noteSize: 15, noteMt: 6,
      backW: 160, backH: 52, backSize: 19, backTxtW: 150, backBottom: 20,
      tips: [
        '· 轻点放钩，钩到鱼得分',
        '· 连续命中叠连击倍率',
        '· 星标鱼要按住屏幕拉上来',
        '· 空钩或超时，连击清零'
      ]
    }
  }
  return {
    /* 内容区宽 308（336 - 左右各 14），不是 296 —— 正文放到 31 之后，
     * 296 会让"星标鱼按住拉上来"这种长句折行（实测 265，只剩 31 的余量），折行比小一号字更难看。 */
    /* padX 14 是正文的内缩；页头还要额外缩 —— 屏顶那 168 设计单位是半圆，
     * d=34 时左右各只能用到 67 号位，logo 摆 14 会被弧线切掉半边（真机照片里就是残的鱼）。 */
    padX: 14, hdrPadL: 68, hdrMt: 10, logo: 64, logoGap: 12, tSize: 40, sSize: 20,
    // 标题列 232 宽放不下「ABOUT · PIXEL FISHING」（20 号字要 250），窄屏只留后半截
    sub: 'PIXEL FISHING',
    cardMt: 20, cardPad: 12, nameSize: 44, verSize: 24,
    /* 2026-11-24 真机：红圈那几行（四条玩法 / 最高分 / 纪录行 / 解锁进度）整体 ×1.2。
     * 26→31 是 19.6 物理，正好是"看着像正文"的那一档；行距相应压低
     * （liMt 14→12、secMt 26→22、rkMt 12→10、noteMt 12→10），把放大吃掉的十几像素还回去，
     * 免得整页顶到返回键上。 */
    secSize: 29, secMt: 22,
    liSize: 31, liMt: 12, lisMt: 12,
    rkL: 31, rkV: 36, rkMt: 10,
    noteSize: 24, noteMt: 10,
    backW: 220, backH: 84, backSize: 28, backTxtW: 206, backBottom: 84,
    /* 窄屏的玩法说明砍短一点（原句 13 个字，26 的字号要 338 宽，308 放不下）。
     * 少掉的都是虚词，"按住屏幕拉上来" → "按住拉上来" 意思一点没丢。 */
    tips: [
      '· 轻点放钩得分',
      '· 连续命中叠倍率',
      '· 星标鱼按住拉上来',
      '· 空钩或超时清零'
    ]
  }
}

/* ---------------- 结算面板 ---------------- */
/**
 * 时间到 → 分数 → 明细 → 进度条 → 按钮。宽 272 / 正文 16 是 480 设计稿的值，
 * 手环 11 上缩到 0.631 只剩 172 物理宽、正文 10 物理像素 —— 真机上就是"结算栏太小"。
 * 窄屏整块放大到 300（物理 189，占屏 89%），分数 76（物理 48）。
 *
 * 字放大之后原来那行「钓到 3 条 · 初级 · 青草池塘」放不下了（14 个字 × 24 = 336 > 264），
 * 所以窄屏的地图名只留地名（fishing.ux 的 mapLabel 跟着改），星标鱼那行也砍成「★ 虹鳟」。
 *
 * @param {boolean} narrow 真实屏幕宽 < 300
 */
export function panelSizes(narrow) {
  if (!narrow) {
    return {
      w: 272, padT: 16, padB: 16,
      // 面板内的文字都按 240 宽居中（Vela 的 text 不给宽度会缩成一个字宽）
      barW: 240, barH: 8, barMt: 6,
      titleSize: 22, titleLs: 2,
      scoreSize: 56, scoreMt: 2,
      lineSize: 16, lineMt: 4,
      gainSize: 15, gainMt: 8,
      lvupSize: 16, lvupMt: 8,
      unlockSize: 16, unlockMt: 6,
      bestSize: 15, bestMt: 6,
      btnW: 106, btnH: 44, btnMt: 14, btnMx: 5, btnTxtW: 100, btnSize: 16,
      starW: 240, starMt: 8, starPadT: 6, starPadB: 6,
      starImgW: 76, starImgMr: 6, starNameW: 150, starNameSize: 15,
      starBtnW: 148, starBtnH: 34, starBtnMt: 6, starBtnR: 17, starBtnTW: 136, starBtnSize: 15,
      starDoneSize: 14, starDoneMt: 6
    }
  }
  return {
    /* 300 是 border-box，扣掉左右各 2 的边框还剩 296 —— barW 264 两边各余 16。 */
    w: 300, padT: 22, padB: 22,
    barW: 264, barH: 12, barMt: 8,
    titleSize: 32, titleLs: 2,
    scoreSize: 76, scoreMt: 2,
    lineSize: 24, lineMt: 6,
    gainSize: 22, gainMt: 10,
    lvupSize: 24, lvupMt: 10,
    unlockSize: 24, unlockMt: 8,
    bestSize: 22, bestMt: 8,
    /* 两个按钮 124 宽 + 左右各 6 = 272，卡在 296 里；72 高 = 45 物理，够按。 */
    btnW: 124, btnH: 72, btnMt: 18, btnMx: 6, btnTxtW: 118, btnSize: 26,
    /* 星标鱼那一块：图 96 + 间距 8 + 名字 168 = 272（296 放得下 24 号字的「★ 虹鳟」） */
    starW: 264, starMt: 10, starPadT: 10, starPadB: 10,
    starImgW: 96, starImgMr: 8, starNameW: 168, starNameSize: 24,
    starBtnW: 196, starBtnH: 56, starBtnMt: 10, starBtnR: 28, starBtnTW: 184, starBtnSize: 24,
    starDoneSize: 22, starDoneMt: 8
  }
}

/* ---------------- 等级 ---------------- */
/**
 * 等级页：页头 + 当前等级卡 + 3x3 徽章墙。
 * @param {boolean} narrow 同上
 */
export function levelSizes(narrow) {
  if (!narrow) {
    return {
      hdrMt: 8, hdrT: 34, hdrS: 14,
      heroMt: 8, heroW: 300, heroH: 96, badge: 76, infoW: 200,
      lv: 30, tier: 14, barH: 8, barMt: 5, next: 13,
      secMt: 8, secSize: 14, rowMt: 2,
      cellW: 96, cellH: 62, cellMl: 2, cellBadge: 38, cellLv: 12,
      backW: 160, backH: 50, backSize: 18, backTxtW: 150, backBottom: 22
    }
  }
  return {
    /* 824 的画布上原来整页只占上面 393，下面 400 多全空着，字还只有 11 物理像素。
     * 现在徽章卡长到 150、九宫格每格 100 高，撑满到返回键上方。 */
    hdrMt: 10, hdrT: 40, hdrS: 20,
    /* 徽章 96 + 左缩进 2 + 间距 8 + 文字区 194 = 300（整卡宽）。
     * 「星辰 · 总积分 334000」19 号字下约 186 —— 22 号字会折行，折了就顶出卡片。 */
    heroMt: 16, heroW: 300, heroH: 150, badge: 96, infoW: 194,
    lv: 40, tier: 19, barH: 12, barMt: 8, next: 19,
    secMt: 16, secSize: 24, rowMt: 4,
    cellW: 96, cellH: 100, cellMl: 2, cellBadge: 52, cellLv: 18,
    backW: 220, backH: 84, backSize: 28, backTxtW: 206, backBottom: 84
  }
}

/* ---------------- 游戏 HUD ---------------- */
/**
 * 游戏页顶部那一条：剩余时间进度条 + 「分数 / 连击 / 倒计时」。
 *
 * 480 的设计稿把进度条画在 y=0、整宽 336，HUD 画在 y=8 —— 就是贴着屏幕最顶上。
 * 到了胶囊屏（手环 11）这条就废了：屏顶是半圆，d=0 处可用宽度是 **0**，
 * 4px 高的进度条只剩中间一小段弧（真机照片里就是眉心那一道蓝），
 * 分数和倒计时也各自被屏幕左右两端的弧线切掉一个数字。
 *
 * 所以窄屏把这一整条按几何往下搬，宽度按那个高度的可用宽度收：
 *   W(d) = 2·√(r² − (r−d)²)，r = 168（半宽）
 * 并留 12 的余量，让两端不贴着弧线。
 *
 * @param {boolean} narrow 真实屏幕宽 < 300（手环 11 = 212）
 */
export function hudSizes(narrow) {
  if (!narrow) {
    return {
      barTop: 0, barH: 4, barW: 336, barX: 0, barR: 0,
      top: 8, h: 46, padX: 14,
      scoreSize: 34, comboSize: 15, timeSize: 26, comboPrefix: 'COMBO x'
    }
  }
  /* 往上顶到 36 是为了离水面/船远一点：钓具位图的上沿在 99（RIG_IMG_TOP），
   * 再往下压就会蹭到渔夫的草帽。36 处可用 209 → 条 185 宽（物理 117），居中 x=76。 */
  const barTop = 36
  const barW = Math.round(pillAvailW(barTop) - 24)
  /* HUD：50 起、44 高（50..94），正好卡在时间条和草帽之间。
   * 字号 40 / 18 / 30（物理 25 / 11 / 19）；文字顶在 54 附近，那个高度可用 247 →
   * 每边 44.5，再给 15 的余量 = 60，内容宽 216 放得下「128 + x1.5 + 37s」（约 163）。 */
  const top = 50
  const padX = Math.round((336 - pillAvailW(top + 4)) / 2) + 15
  return {
    barTop: barTop, barH: 6, barW: barW, barX: Math.round((336 - barW) / 2), barR: 3,
    top: top, h: 44, padX: padX,
    scoreSize: 40, comboSize: 18, timeSize: 30,
    /* 窄屏放不下「COMBO x1.5」（10 个字 × 18 = 108），只留倍数 —— 连击的读法一次就学会，
     * 分数和倍数本来就是一组的。 */
    comboPrefix: 'x'
  }
}
