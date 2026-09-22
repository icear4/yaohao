/* ===========================================================
   juice.js — 手感层（Game Feel）
   定位：只做「表现」，不改任何战斗数值与规则。
   1) HitStop —— 命中 / 击杀的极短定格，让打击有重量
   2) Perf    —— 自适应性能档位（粒子预算 / 拖影 / 拖尾发射器）
   3) PROJ_VIZ—— 投射物视觉档案：大小 / 轨迹 / 粒子 / 命中效果
   4) Juice   —— 特效入口（冲击波 / 闪屏 / 道具浮现 / 命中与暴击）
   =========================================================== */
'use strict';

/* -----------------------------------------------------------
   1) 定格 HitStop
   命中与击杀的瞬间把世界时间压慢几帧，是"打击感"最廉价也最有效的来源。
   cd 用来防止连续击杀时画面一卡一卡（只有足够强的事件才 force 打断）。
   ----------------------------------------------------------- */
const HitStop = {
  t: 0,
  cd: 0,
  scale: 0.16,          // 定格期间的时间倍率（越小越"顿"）
  enabled: true,

  request(dur, force) {
    if (!this.enabled || !(dur > 0)) return;
    if (!force && this.cd > 0) return;
    if (dur > this.t) this.t = dur;
    this.cd = 0.13;
  },

  update(realDt) {
    if (this.cd > 0) this.cd -= realDt;
    if (this.t > 0) this.t -= realDt;
  },

  /* 世界更新用的时间倍率 */
  mul() { return (this.enabled && this.t > 0) ? this.scale : 1; },

  reset() { this.t = 0; this.cd = 0; }
};

/* -----------------------------------------------------------
   2) 性能自适应 Perf
   按实测 FPS 自动降档：先砍拖尾发射器，再砍拖影，最后压粒子预算。
   只在真实主循环里采样（Game.loop），所以不影响确定性测试。
   ----------------------------------------------------------- */
const Perf = {
  level: 2,             // 2 = 完整　1 = 均衡　0 = 省电
  auto: true,
  budget: 900,          // 粒子上限
  trails: true,         // 投射物拖影
  emitters: true,       // 投射物拖尾粒子发射器
  glow: true,           // 光晕 / 阴影等重绘开销
  _acc: 0, _frames: 0, _lowT: 0, _highT: 0,

  _apply() {
    if (this.level >= 2) {
      this.budget = 900; this.trails = true; this.emitters = true; this.glow = true;
    } else if (this.level === 1) {
      this.budget = 520; this.trails = true; this.emitters = false; this.glow = true;
    } else {
      this.budget = 300; this.trails = false; this.emitters = false; this.glow = false;
    }
  },

  setLevel(n) {
    this.level = clamp(n | 0, 0, 2);
    this._apply();
  },

  sample(realDt) {
    if (!this.auto) return;
    this._acc += realDt;
    this._frames++;
    if (this._acc < 0.5) return;
    const fps = this._frames / this._acc;
    this._acc = 0; this._frames = 0;
    if (fps < 47) { this._lowT += 0.5; this._highT = 0; }
    else if (fps > 57) { this._highT += 0.5; this._lowT = 0; }
    else { this._lowT = 0; this._highT = 0; }
    if (this._lowT >= 1.0 && this.level > 0) { this.level--; this._apply(); this._lowT = 0; }
    else if (this._highT >= 4.0 && this.level < 2) { this.level++; this._apply(); this._highT = 0; }
  }
};
Perf._apply();

/* -----------------------------------------------------------
   3) 投射物视觉档案
   每个档案决定：形状 / 大小 / 轨迹样式 / 拖尾粒子 / 命中效果。
   —— 让"不同的投射物"在飞的时候就一眼能分辨。
   ----------------------------------------------------------- */
const PROJ_VIZ = {
  /* --- 玩家弹 --- */
  bolt:      { shape: 'capsule', sizeMul: 1.00, trail: 'stream', trailLen: 7,  glow: 0.34, core: 1.00, spin: 0,
               emit: null, impact: 'spark' },
  slug:      { shape: 'capsule', sizeMul: 1.32, trail: 'stream', trailLen: 9,  glow: 0.42, core: 1.00, spin: 0,
               emit: { rate: 22, color: '#ffb347', size: 2.4, life: 0.22, speed: 26 }, impact: 'burst' },
  shard:     { shape: 'diamond', sizeMul: 1.12, trail: 'spark',  trailLen: 5,  glow: 0.30, core: 1.00, spin: 9,
               emit: null, impact: 'spark' },
  seeker:    { shape: 'orb',     sizeMul: 1.10, trail: 'stream', trailLen: 10, glow: 0.55, core: 1.00, spin: 0,
               emit: { rate: 26, color: '#7fe4ff', size: 2.2, life: 0.30, speed: 22 }, impact: 'spark' },
  venom:     { shape: 'blob',    sizeMul: 1.06, trail: 'drip',   trailLen: 6,  glow: 0.30, core: 0.65, spin: 2,
               emit: { rate: 12, color: '#9ad14f', size: 2.6, life: 0.42, speed: 16 }, impact: 'venom' },
  frost:     { shape: 'crystal', sizeMul: 1.10, trail: 'spark',  trailLen: 5,  glow: 0.46, core: 1.00, spin: 0,
               emit: { rate: 11, color: '#8fd8ff', size: 2.2, life: 0.36, speed: 14 }, impact: 'frost' },
  boomerang: { shape: 'ring',    sizeMul: 1.22, trail: 'stream', trailLen: 12, glow: 0.40, core: 1.00, spin: 14,
               emit: null, impact: 'spark' },
  shell:     { shape: 'capsule', sizeMul: 1.46, trail: 'smoke',  trailLen: 8,  glow: 0.36, core: 1.00, spin: 0,
               emit: { rate: 16, color: '#ff8a5c', size: 3.0, life: 0.30, speed: 18 }, impact: 'shock' },

  /* --- 敌方弹 --- */
  orb:       { shape: 'orb',     sizeMul: 1.00, trail: 'stream', trailLen: 5, glow: 0.46, core: 0.85, spin: 0,
               emit: null, impact: 'spark' },
  needle:    { shape: 'capsule', sizeMul: 0.82, trail: 'dash',   trailLen: 4, glow: 0.22, core: 1.00, spin: 0,
               emit: null, impact: 'spark' },
  wisp:      { shape: 'blob',    sizeMul: 1.06, trail: 'stream', trailLen: 9, glow: 0.60, core: 0.80, spin: 3,
               emit: { rate: 14, color: '#c08bff', size: 2.4, life: 0.36, speed: 15 }, impact: 'spark' },
  spike:     { shape: 'diamond', sizeMul: 1.00, trail: 'dash',   trailLen: 4, glow: 0.24, core: 0.90, spin: 6,
               emit: null, impact: 'spark' },
  bomb:      { shape: 'orb',     sizeMul: 1.50, trail: 'smoke',  trailLen: 7, glow: 0.46, core: 1.00, spin: 0,
               emit: { rate: 11, color: '#ff4d6b', size: 3.0, life: 0.36, speed: 16 }, impact: 'shock' }
};

/* 按投射物参数挑选视觉档案（opt.viz 可显式指定） */
function vizFor(opt) {
  if (opt.viz && PROJ_VIZ[opt.viz]) return PROJ_VIZ[opt.viz];
  const r = opt.r || 5;
  if (opt.friendly) {
    if (opt.orbit > 0) return PROJ_VIZ.boomerang;
    if (opt.explode > 0) return PROJ_VIZ.shell;
    if (opt.poison > 0) return PROJ_VIZ.venom;
    if (opt.freeze > 0) return PROJ_VIZ.frost;
    if (opt.homing > 0) return PROJ_VIZ.seeker;
    if (opt.burn > 0) return PROJ_VIZ.slug;
    if (r >= 7) return PROJ_VIZ.slug;
    return PROJ_VIZ.bolt;
  }
  if (opt.homing > 0) return PROJ_VIZ.wisp;
  if (r >= 11) return PROJ_VIZ.bomb;
  if (r <= 4.2) return PROJ_VIZ.needle;
  if (opt.spin) return PROJ_VIZ.spike;
  return PROJ_VIZ.orb;
}

/* -----------------------------------------------------------
   4) Juice：常用特效入口
   ----------------------------------------------------------- */
const Juice = {

  /* 冲击波圆环（画在实体之上） */
  ring(game, x, y, color, r1, dur, width) {
    if (!game || !game.fx) return;
    game.fx.push({
      type: 'ring', x: x, y: y, color: color, r1: r1,
      life: dur || 0.34, max: dur || 0.34, w: width || 3
    });
  },

  /* 全屏闪色（受伤 / 暴击 / 清怪 / 通关） */
  flash(game, color, alpha, dur) {
    if (!game || !game.fx) return;
    game.fx.push({ type: 'flash', color: color, a0: alpha, life: dur || 0.16, max: dur || 0.16 });
  },

  /* 道具浮现：拾取时从物件上方升起的一张小卡片 */
  itemPop(game, x, y, item) {
    if (!game || !game.fx || !item) return;
    game.fx.push({ type: 'item', x: x, y: y, item: item, life: 1.5, max: 1.5 });
  },

  /* 玩家子弹命中：命中火花 + 命中标记（准星回响） */
  hit(game, x, y, ang, color, crit) {
    const P = game.particles;
    if (crit) {
      P.burst(x, y, 10, { speed: 250, life: 0.38, size: 4.2, colors: ['#ffd85e', '#ffffff', color], drag: 4.5 });
      P.ring(x, y, '#ffd85e', 10, 210);
      this.flash(game, '#ffd85e', 0.10, 0.12);
      game.addShake(1.6);
      HitStop.request(0.05);
    } else {
      P.hitSpark(x, y, ang, color);
    }
    if (game.ui) game.ui.hitMark = 1;
  },

  /* 暴击专属：星芒 + 金色冲击 */
  critBurst(game, x, y) {
    const P = game.particles;
    P.ring(x, y, '#ffe08a', 14, 240);
    P.burst(x, y, 8, { speed: 200, life: 0.5, size: 3.4, colors: ['#ffe08a', '#ffffff'], drag: 3.2, shape: 'shard' });
    this.ring(game, x, y, '#ffd85e', 70, 0.3, 3);
  },

  /* 敌人死亡：碎裂 + 冲击波（大体积额外爆一团火） */
  death(game, e) {
    const P = game.particles;
    const scale = clamp(e.r / 16, 0.6, 2.4);
    P.deathBurst(e.x, e.y, e.colors, scale * 0.8);
    P.burst(e.x, e.y, Math.round(10 + 8 * scale), {
      speed: 120 + 60 * scale, life: 0.6, size: 5,
      colors: ['#ffffff', e.colors[1], e.colors[0]], drag: 2.2
    });
    this.ring(game, e.x, e.y, e.colors[1], 40 + 40 * scale, 0.32, 3);
    if (e.isBoss) {
      /* Boss 陨落：大冲击波 + 全屏闪 + 强定格 */
      this.ring(game, e.x, e.y, '#ffffff', 320, 0.75, 6);
      this.ring(game, e.x, e.y, e.colors[1], 220, 0.55, 4);
      this.flash(game, '#ffffff', 0.55, 0.3);
      P.burst(e.x, e.y, 46, { speed: 340, life: 1.1, size: 6, colors: ['#ffffff', e.colors[1], '#ffd35e'] });
      HitStop.request(0.16, true);
    } else if (e.r >= 20) {
      /* 大体积敌人：多一层爆燃 */
      P.ring(e.x, e.y, '#ff8a5c', Math.round(12 * scale), 200);
      P.burst(e.x, e.y, 10, { speed: 190, life: 0.5, size: 5, colors: ['#ff8a5c', '#ffd35e', '#ffffff'], drag: 3 });
      HitStop.request(0.055);
    } else {
      HitStop.request(0.04);
    }
  },

  /* 投射物消散 / 撞墙 / 命中：按视觉档案走不同命中效果 */
  impact(game, p, x, y, scale) {
    const v = p.viz || PROJ_VIZ.orb;
    const col = p.color || '#ffffff';
    const s = scale === undefined ? 1 : scale;
    const ang = Math.atan2(p.vy, p.vx);
    const P = game.particles;

    switch (v.impact) {
      case 'burst':
        P.burst(x, y, Math.round(9 * s), {
          speed: 210, life: 0.34, size: 3.6, colors: [col, '#ffffff', '#ffd35e'], drag: 5
        });
        break;
      case 'shock':
        P.ring(x, y, col, Math.round(12 * s), 190);
        P.burst(x, y, Math.round(8 * s), {
          speed: 200, life: 0.4, size: 4, colors: [col, '#ffffff'], drag: 4
        });
        break;
      case 'venom':
        P.burst(x, y, Math.round(8 * s), {
          speed: 130, life: 0.5, size: 3.4, colors: [col, '#9ad14f', '#e8ffb0'], drag: 3
        });
        break;
      case 'frost':
        P.burst(x, y, Math.round(8 * s), {
          speed: 150, life: 0.42, size: 3, colors: [col, '#ffffff', '#c9ecff'], drag: 4, shape: 'shard'
        });
        break;
      default:
        P.hitSpark(x, y, ang + Math.PI, col);
        break;
    }
  }
};
