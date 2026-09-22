/* ===========================================================
   chapters.js — 五章节主题系统（区域 / 视觉 / 敌人 / Boss / 环境）
   -----------------------------------------------------------
   完整流程：Start → 第1层 → Boss → 第2层 → Boss → …… → 第5层 → 最终 Boss → 结算

   每一层（章节）拥有：
     · 独立房间视觉（地砖 / 墙体 / 符环 / 环境色）
     · 独立敌人组合（编队主题 + 偏好种类 + 特殊敌人出现率）
     · 独立 Boss（各层 Boss 池互不重叠，第 5 层为最终 Boss）
     · 独立背景效果（飘落物 / 火星 / 孢子 / 星辰 / 能量流）
     · 独立环境障碍（石柱 / 蒸汽 / 毒沼 / 虚空裂隙 / 电弧塔……）

   难度随层数提升的五种维度（不单纯堆 HP）：
     1. HP 倍率        —— 缓慢增长（1.00 → 1.70）
     2. 攻击节奏倍率    —— 所有冷却整体缩短（1.00 → 1.56）
     3. 弹幕复杂度      —— 弹幕型敌人上限 + 主弹附带弹 + 波次预算
     4. 特殊敌人出现率  —— 特殊 / 辅助类权重提高（0.04 → 0.52）
     5. 精英词缀渗透率  —— 普通敌人也可能带词缀（0 → 0.32）
   同时 Boss 逐层更复杂（专属 Boss 池 + 护卫 + 阶段压力）。

   新增一章 = 在 CHAPTERS 里加一条数据（其余系统自动读取）
   =========================================================== */
'use strict';

/* ===========================================================
   章节数据表
   =========================================================== */
const CHAPTERS = [
  /* ---------------- 第 1 层：废弃庭院 ---------------- */
  {
    id: 1,
    cn: '废弃庭院',
    en: 'FORSAKEN COURTYARD',
    sub: '藤蔓吞掉了石阶，喷泉早已干涸，回声在空庭里打转。',
    tip: '石柱可以打碎 · 落石落地前有阴影预警',
    pal: {
      void: '#05070c',
      floor: '#0e151d',
      tile: [16, 22, 30],
      tileVar: 14,
      grout: 'rgba(120,190,170,0.10)',
      dot: 'rgba(150,220,200,0.07)',
      accent: '#7dffb0',
      wall: '#171d29',
      wallEdge: '#2b3547',
      fx: '#a8e6c8'
    },
    bg: { type: 'petal', n: 42 },
    size: { cols: 5, rows: 5 },
    hazards: [
      { type: 'pillar', style: 'rubble', n: [2, 3], hp: 70 },
      { type: 'geyser', style: 'rock', n: [0, 1], dmg: 12 }
    ],
    bossHazards: [{ type: 'pillar', style: 'rubble', n: [1, 2], hp: 70 }],
    pool: {
      prefer: ['chaser', 'charger', 'hopper', 'gnasher', 'shooter', 'swarmer'],
      themes: ['rush', 'gunline'],
      special: 0.04, bullet: 0, spread: 0, affix: 0.00, budget: 0, max: 0
    },
    scale: { hp: 1.00, rate: 1.00, speed: 1.00 },
    bosses: ['boss'],
    guard: [],
    coins: 1.0
  },

  /* ---------------- 第 2 层：机械矿井 ---------------- */
  {
    id: 2,
    cn: '机械矿井',
    en: 'CLOCKWORK MINE',
    sub: '齿轮仍在转动，无人记得它们原本为谁而转。',
    tip: '蒸汽喷口会周期喷发 · 传送带会把你推走',
    pal: {
      void: '#070503',
      floor: '#14100c',
      tile: [30, 22, 16],
      tileVar: 16,
      grout: 'rgba(255,170,90,0.10)',
      dot: 'rgba(255,190,120,0.07)',
      accent: '#ffb35c',
      wall: '#1d1712',
      wallEdge: '#3a2c1e',
      fx: '#ffb35c'
    },
    bg: { type: 'spark', n: 46 },
    size: { cols: 6, rows: 5 },
    hazards: [
      { type: 'pillar', style: 'gear', n: [1, 2], hp: 150 },
      { type: 'geyser', style: 'steam', n: [1, 1], dmg: 11 },
      { type: 'conveyor', n: [0, 1] }
    ],
    bossHazards: [{ type: 'geyser', style: 'steam', n: [1, 2], dmg: 11 }],
    pool: {
      prefer: ['shooter', 'marksman', 'turret', 'charger', 'spiker', 'brute', 'hopper'],
      themes: ['gunline', 'siege', 'rush'],
      special: 0.16, bullet: 1, spread: 0, affix: 0.06, budget: 3, max: 0
    },
    scale: { hp: 1.14, rate: 1.16, speed: 1.05 },
    bosses: ['boss_slagsmith', 'boss_verdict'],
    guard: ['shooter'],
    coins: 1.15
  },

  /* ---------------- 第 3 层：腐化森林 ---------------- */
  {
    id: 3,
    cn: '腐化森林',
    en: 'ROTWOOD FOREST',
    sub: '根系在地下互相啃食，孢子代替了雨落下来。',
    tip: '毒沼会拖慢你 · 打碎孢子囊会炸出一片毒雾',
    pal: {
      void: '#040806',
      floor: '#0c1510',
      tile: [18, 30, 22],
      tileVar: 15,
      grout: 'rgba(150,220,110,0.10)',
      dot: 'rgba(180,240,140,0.07)',
      accent: '#9ad14f',
      wall: '#12200f',
      wallEdge: '#2f4a24',
      fx: '#9ad14f'
    },
    bg: { type: 'spore', n: 50 },
    size: { cols: 6, rows: 5 },
    hazards: [
      { type: 'slick', style: 'bog', n: [1, 2], dmg: 7 },
      { type: 'pillar', style: 'pod', n: [1, 2], hp: 60 },
      { type: 'geyser', style: 'spore', n: [0, 1], dmg: 9 }
    ],
    bossHazards: [{ type: 'slick', style: 'bog', n: [1, 1], dmg: 7 }],
    pool: {
      prefer: ['swarmer', 'gnasher', 'slougher', 'bogger', 'summoner', 'phantom', 'chaser'],
      themes: ['swarm', 'occult', 'rush'],
      special: 0.28, bullet: 1, spread: 1, affix: 0.13, budget: 6, max: 1
    },
    scale: { hp: 1.28, rate: 1.32, speed: 1.09 },
    bosses: ['boss_bloom', 'boss_weaver'],
    guard: ['charger', 'shooter'],
    coins: 1.3
  },

  /* ---------------- 第 4 层：虚空遗迹 ---------------- */
  {
    id: 4,
    cn: '虚空遗迹',
    en: 'VOID RUINS',
    sub: '这里没有重力，也没有上下，只有塌缩后留下的碎块。',
    tip: '虚空裂隙会把你吸过去 · 相位柱会周期性实体化',
    pal: {
      void: '#03030a',
      floor: '#0b0a16',
      tile: [24, 20, 40],
      tileVar: 15,
      grout: 'rgba(190,150,255,0.10)',
      dot: 'rgba(210,180,255,0.08)',
      accent: '#c08bff',
      wall: '#150f26',
      wallEdge: '#33265c',
      fx: '#c08bff'
    },
    bg: { type: 'star', n: 54 },
    size: { cols: 6, rows: 5 },
    hazards: [
      { type: 'vortex', n: [1, 1] },
      { type: 'pillar', style: 'crystal', n: [1, 2], hp: 110 },
      { type: 'geyser', style: 'void', n: [0, 1], dmg: 13 }
    ],
    bossHazards: [{ type: 'vortex', n: [1, 1] }],
    pool: {
      prefer: ['phantom', 'blinker', 'wisp', 'ringer', 'aegis', 'marksman', 'bomber', 'curator'],
      themes: ['occult', 'cohort', 'siege'],
      special: 0.40, bullet: 2, spread: 1, affix: 0.22, budget: 9, max: 1
    },
    scale: { hp: 1.44, rate: 1.48, speed: 1.14 },
    bosses: ['boss_prism', 'boss_dune', 'boss_volt', 'boss_kaleido'],
    guard: ['charger', 'shooter', 'wisp'],
    coins: 1.5
  },

  /* ---------------- 第 5 层：星界核心（最终层） ---------------- */
  {
    id: 5,
    cn: '星界核心',
    en: 'ASTRAL CORE',
    sub: '所有回廊的尽头，星脉在这里搏动最后一次。',
    tip: '电弧塔会锁定你 · 能量脉冲会在地面炸开',
    pal: {
      void: '#02060c',
      floor: '#0a1018',
      tile: [22, 32, 46],
      tileVar: 16,
      grout: 'rgba(140,230,255,0.12)',
      dot: 'rgba(190,245,255,0.09)',
      accent: '#8fe9ff',
      wall: '#101a26',
      wallEdge: '#24435c',
      fx: '#8fe9ff'
    },
    bg: { type: 'ray', n: 52 },
    size: { cols: 7, rows: 5 },
    hazards: [
      { type: 'pylon', n: [1, 1], dmg: 12 },
      { type: 'pillar', style: 'core', n: [1, 2], hp: 130 },
      { type: 'geyser', style: 'pulse', n: [1, 1], dmg: 14 }
    ],
    bossHazards: [{ type: 'pylon', n: [1, 1], dmg: 12 }],
    pool: {
      prefer: ['aegis', 'mender', 'curator', 'ringer', 'marksman', 'brute', 'bomber',
               'blinker', 'phantom', 'spiker', 'turret'],
      themes: ['cohort', 'siege', 'occult'],
      special: 0.52, bullet: 2, spread: 2, affix: 0.32, budget: 12, max: 2
    },
    scale: { hp: 1.60, rate: 1.64, speed: 1.18 },
    bosses: ['boss_collapse', 'boss_nameless'],
    guard: ['charger', 'shooter', 'aegis'],
    coins: 1.8,
    final: true
  }
];

/* 取章节（层数越界时钳制，保证永远有主题） */
function ChapterOf(floor) {
  const f = clamp(Math.floor(floor) || 1, 1, CHAPTERS.length);
  return CHAPTERS[f - 1];
}

/* 总层数（流程终点） */
const CHAPTER_COUNT = CHAPTERS.length;

/* ===========================================================
   章节背景效果（纯表现层，不参与碰撞）
   —— 每层一种：飘落物 / 火星 / 孢子 / 星辰 / 能量流
   =========================================================== */
class ChapterFx {
  constructor(chapter, rng) {
    this.ch = chapter;
    this.type = (chapter.bg && chapter.bg.type) || 'petal';
    this.t = 0;
    this.items = [];
    const R = rng || new Rng(1);
    const n = (chapter.bg && chapter.bg.n) || 40;

    for (let i = 0; i < n; i++) {
      const it = this._make(R, true);
      this.items.push(it);
    }

    /* 机械矿井：背景齿轮剪影 */
    this.gears = [];
    if (this.type === 'spark') {
      for (let i = 0; i < 5; i++) {
        this.gears.push({
          x: R.range(ARENA.x + 80, ARENA.x + ARENA.w - 80),
          y: R.range(ARENA.y + 70, ARENA.y + ARENA.h - 70),
          r: R.range(44, 108),
          sp: R.range(-0.5, 0.5) || 0.3,
          teeth: R.int(8, 12),
          a: R.range(0, TAU)
        });
      }
    }
    /* 虚空遗迹：扭曲网格 */
    if (this.type === 'star') {
      this.grid = { off: R.range(0, 90), wob: R.range(0.6, 1.4) };
    }
    /* 星界核心：中央光晕 */
    if (this.type === 'ray') {
      this.rays = [];
      for (let i = 0; i < 9; i++) {
        this.rays.push({ a: (i / 9) * TAU + R.range(-0.2, 0.2), w: R.range(10, 30), sp: R.range(0.05, 0.2) });
      }
    }
  }

  _make(R, spread) {
    const it = { x: 0, y: 0, vx: 0, vy: 0, r: 2, life: 1, ph: 0, sp: 0 };
    switch (this.type) {
      case 'petal':     // 缓缓飘落的叶屑与尘埃
        it.x = R.range(ARENA.x, ARENA.x + ARENA.w);
        it.y = spread ? R.range(ARENA.y, ARENA.y + ARENA.h) : ARENA.y - 10;
        it.vx = R.range(-16, 16);
        it.vy = R.range(22, 52);
        it.r = R.range(1.6, 4.2);
        it.ph = R.range(0, TAU);
        it.sp = R.range(0.6, 1.8);
        break;
      case 'spark':     // 上升的火星（矿井炉火）
        it.x = R.range(ARENA.x, ARENA.x + ARENA.w);
        it.y = spread ? R.range(ARENA.y, ARENA.y + ARENA.h) : ARENA.y + ARENA.h + 8;
        it.vx = R.range(-12, 12);
        it.vy = R.range(-56, -22);
        it.r = R.range(1.2, 3.0);
        it.ph = R.range(0, TAU);
        it.sp = R.range(2, 5);
        break;
      case 'spore':     // 悬浮孢子（缓慢漂移）
        it.x = R.range(ARENA.x, ARENA.x + ARENA.w);
        it.y = spread ? R.range(ARENA.y, ARENA.y + ARENA.h) : ARENA.y + ARENA.h;
        it.vx = R.range(-10, 10);
        it.vy = R.range(-18, -5);
        it.r = R.range(1.8, 4.6);
        it.ph = R.range(0, TAU);
        it.sp = R.range(0.5, 1.4);
        break;
      case 'star':      // 虚空星尘（横向漂移）
        it.x = R.range(ARENA.x, ARENA.x + ARENA.w);
        it.y = spread ? R.range(ARENA.y, ARENA.y + ARENA.h) : R.range(ARENA.y, ARENA.y + ARENA.h);
        it.vx = R.range(-26, -6);
        it.vy = R.range(-6, 6);
        it.r = R.range(1.0, 2.6);
        it.ph = R.range(0, TAU);
        it.sp = R.range(1.5, 4);
        break;
      default:          // ray：能量流（斜向）
        it.x = R.range(ARENA.x, ARENA.x + ARENA.w);
        it.y = spread ? R.range(ARENA.y, ARENA.y + ARENA.h) : R.range(ARENA.y, ARENA.y + ARENA.h);
        it.vx = R.range(30, 90);
        it.vy = R.range(-40, -14);
        it.r = R.range(1.2, 3.2);
        it.ph = R.range(0, TAU);
        it.sp = R.range(1, 3);
        break;
    }
    return it;
  }

  _recycle(it) {
    const R = this._rr || (this._rr = new Rng(hashSeed(this.ch.cn)));
    const fresh = this._make(R, false);
    it.x = fresh.x; it.y = fresh.y;
    it.vx = fresh.vx; it.vy = fresh.vy;
    it.r = fresh.r; it.ph = fresh.ph; it.sp = fresh.sp;
  }

  update(dt) {
    this.t += dt;
    const L = ARENA.x, Rr = ARENA.x + ARENA.w, T = ARENA.y, B = ARENA.y + ARENA.h;
    for (const it of this.items) {
      it.ph += dt * it.sp;
      it.x += (it.vx + Math.sin(it.ph) * 12) * dt;
      it.y += it.vy * dt;
      if (it.y > B + 20 || it.y < T - 20 || it.x < L - 20 || it.x > Rr + 20) this._recycle(it);
    }
    if (this.gears) for (const g of this.gears) g.a += g.sp * dt;
    if (this.rays) for (const r of this.rays) r.a += r.sp * dt * 0.35;
  }

  /* 环境层：画在地板之上、实体之下 */
  drawUnder(ctx) {
    const ch = this.ch;
    const col = ch.pal.fx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.clip();

    /* 矿井齿轮剪影 */
    if (this.gears) {
      for (const g of this.gears) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.a);
        ctx.globalAlpha = 0.055;
        ctx.strokeStyle = ch.pal.accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, g.r, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, g.r * 0.55, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < g.teeth; i++) {
          const a = (i / g.teeth) * TAU;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * g.r, Math.sin(a) * g.r);
          ctx.lineTo(Math.cos(a) * (g.r + 9), Math.sin(a) * (g.r + 9));
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    /* 虚空扭曲网格 */
    if (this.grid) {
      ctx.globalAlpha = 0.05;
      ctx.strokeStyle = ch.pal.accent;
      ctx.lineWidth = 1;
      const step = 74;
      for (let x = ARENA.x; x < ARENA.x + ARENA.w; x += step) {
        ctx.beginPath();
        for (let y = ARENA.y; y <= ARENA.y + ARENA.h; y += 18) {
          const wx = x + Math.sin(y * 0.012 + this.t * 0.7) * 9;
          if (y === ARENA.y) ctx.moveTo(wx, y); else ctx.lineTo(wx, y);
        }
        ctx.stroke();
      }
    }

    /* 星界核心：中央放射光带 */
    if (this.rays) {
      const cx = VIEW_W / 2, cy = VIEW_H / 2;
      ctx.globalAlpha = 0.055;
      ctx.fillStyle = ch.pal.accent;
      for (const r of this.rays) {
        const w = r.w + Math.sin(this.t * 1.4 + r.a) * 8;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(r.a - w / 600) * 900, cy + Math.sin(r.a - w / 600) * 900);
        ctx.lineTo(cx + Math.cos(r.a + w / 600) * 900, cy + Math.sin(r.a + w / 600) * 900);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;

    /* 粒子 */
    for (const it of this.items) {
      const tw = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(it.ph * 1.7));
      ctx.globalAlpha = this.type === 'spore' ? tw * 0.7 : tw;
      ctx.fillStyle = col;
      if (this.type === 'petal') {
        ctx.save();
        ctx.translate(it.x, it.y);
        ctx.rotate(it.ph);
        ctx.beginPath();
        ctx.ellipse(0, 0, it.r * 2.1, it.r * 0.8, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* 顶层：章节色调 + 边缘氛围（画在实体之上、墙体之下） */
  drawOver(ctx) {
    const ch = this.ch;
    ctx.save();
    if (this.type === 'spore') {
      /* 森林：底部雾气 */
      const g = ctx.createLinearGradient(0, ARENA.y + ARENA.h * 0.55, 0, ARENA.y + ARENA.h);
      g.addColorStop(0, 'rgba(90,160,80,0)');
      g.addColorStop(1, 'rgba(90,190,110,0.09)');
      ctx.fillStyle = g;
      ctx.fillRect(ARENA.x, ARENA.y + ARENA.h * 0.55, ARENA.w, ARENA.h * 0.45);
    } else if (this.type === 'spark') {
      const g = ctx.createLinearGradient(0, ARENA.y, 0, ARENA.y + ARENA.h * 0.5);
      g.addColorStop(0, 'rgba(255,150,60,0.07)');
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h * 0.5);
    } else if (this.type === 'star') {
      const p = 0.05 + 0.02 * Math.sin(this.t * 1.1);
      const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, ARENA.h * 0.2, VIEW_W / 2, VIEW_H / 2, ARENA.w * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(120,70,220,${p})`);
      ctx.fillStyle = g;
      ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    } else if (this.type === 'ray') {
      const p = 0.06 + 0.03 * Math.sin(this.t * 2.2);
      const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 40, VIEW_W / 2, VIEW_H / 2, ARENA.w * 0.55);
      g.addColorStop(0, `rgba(150,235,255,${p})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    }
    ctx.restore();
  }
}

/* ===========================================================
   环境障碍（每层不同）
   -----------------------------------------------------------
   通用契约：
     · solid        —— 是否阻挡移动与子弹
     · affect(e,dt) —— 对实体（玩家与敌人一致）的持续作用
     · onBullet(p)  —— 被子弹命中（可破坏物在这里扣血）
     · drawUnder / drawOver —— 分层绘制（地面预警在下，柱体在上）
   所有障碍的伤害都「先预警、再生效」，且对玩家与敌人同等生效
   =========================================================== */
class EnvHazard {
  constructor(game, x, y, opt) {
    opt = opt || {};
    this.game = game;
    this.x = x;
    this.y = y;
    this.r = opt.r || 30;
    this.solid = !!opt.solid;
    this.hp = opt.hp || 0;
    this.maxHp = this.hp;
    this.dead = false;
    this.t = opt.phase || 0;
    this.hitFlash = 0;
    this.dmg = opt.dmg || 0;
    this.color = opt.color || '#8fa3b5';
    this.rng = opt.rng || new Rng(hashSeed('hz'));
    this.isHazard = true;
  }

  update(dt) {
    this.t += dt;
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
  }

  /* 持续作用：默认无 */
  affect(entity, dt) { /* 子类实现 */ }

  /* 命中判定（圆） */
  contains(x, y, r) {
    return Collision.circleCircle(x, y, r || 0, this.x, this.y, this.r);
  }

  /* 子弹命中（solid 的障碍吸收子弹；可破坏物在此扣血） */
  onBullet(p) {
    if (this.hp <= 0) return;
    const d = Math.max(1, Math.round(p.damage * (p.damageMul || 1)));
    this.hp -= d;
    this.hitFlash = 1;
    this.game.damageNumbers.add(p.x, p.y - 8, d, { color: '#c8d8e4', life: 0.5 });
    this.game.particles.burst(p.x, p.y, 4, { speed: 150, life: 0.24, size: 3, color: this.color });
    if (this.hp <= 0) this.onBreak();
  }

  onBreak() {
    this.dead = true;
    this.game.particles.burst(this.x, this.y, 16, {
      speed: 230, life: 0.6, size: 5, colors: [this.color, '#ffffff', '#8fa3b5']
    });
    this.game.particles.ring(this.x, this.y, this.color, 12, 190);
    this.game.addShake(1.6);
  }

  drawUnder(ctx) { /* 子类实现 */ }
  drawOver(ctx) { /* 子类实现 */ }

  /* 统一阴影 */
  drawShadow(ctx, w, h) {
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + this.r * 0.42, (w || this.r) * 1.05, (h || this.r * 0.42), 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   1. 柱体障碍（石柱 / 齿轮 / 孢子囊 / 晶簇 / 星核柱）
      —— 阻挡移动与子弹，可被击碎（击碎后不再阻挡）
   ----------------------------------------------------------- */
class PillarHazard extends EnvHazard {
  constructor(game, x, y, opt) {
    opt = Object.assign({ solid: true, r: 30, hp: 70 }, opt);
    super(game, x, y, opt);
    this.style = opt.style || 'rubble';
    this.spin = this.rng.range(0, TAU);
    this.spinSpd = this.style === 'gear' ? this.rng.range(0.5, 1.1) * (this.rng.chance(0.5) ? 1 : -1) : 0;
    this.lumps = [];
    for (let i = 0; i < 5; i++) {
      this.lumps.push({ a: this.rng.range(0, TAU), d: this.rng.range(0.2, 0.7), s: this.rng.range(0.3, 0.6) });
    }
    if (this.style === 'gear') this.color = '#ffb35c';
    else if (this.style === 'pod') this.color = '#9ad14f';
    else if (this.style === 'crystal') this.color = '#c08bff';
    else if (this.style === 'core') this.color = '#8fe9ff';
    else this.color = '#9fb2c4';
  }

  update(dt) {
    super.update(dt);
    this.spin += dt * this.spinSpd;
  }

  onBreak() {
    /* 孢子囊：碎裂后炸出一片毒沼 */
    if (this.style === 'pod' && this.game.room && this.game.room.hazards &&
        this.game.room.hazards.list) {
      this.game.room.hazards.list.push(new SlickHazard(this.game, this.x, this.y, {
        r: 62, dmg: 6, color: '#9ad14f', rng: this.rng.fork('pod')
      }));
      this.game.particles.ring(this.x, this.y, '#9ad14f', 16, 130);
    }
    super.onBreak();
  }

  drawOver(ctx) {
    const q = this.maxHp > 0 ? clamp(this.hp / this.maxHp, 0, 1) : 1;
    ctx.save();
    ctx.translate(this.x, this.y);

    if (this.style === 'gear') {
      /* 机械矿井：转动的齿轮柱 */
      ctx.save();
      ctx.rotate(this.spin);
      ctx.fillStyle = '#3a2c1e';
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ffb35c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 0.92, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#5a4426';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 0.42, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        ctx.strokeStyle = '#ffb35c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * this.r * 0.92, Math.sin(a) * this.r * 0.92);
        ctx.lineTo(Math.cos(a) * (this.r + 8), Math.sin(a) * (this.r + 8));
        ctx.stroke();
      }
      ctx.restore();
    } else if (this.style === 'crystal') {
      /* 虚空遗迹：晶簇 */
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + this.t * 0.2;
        const h = this.r * (1.5 + 0.3 * Math.sin(this.t * 2 + i));
        ctx.fillStyle = i === 0 ? '#4b3a7a' : '#33265c';
        polygonPath(ctx, [
          [Math.cos(a - 0.28) * this.r * 0.5, Math.sin(a - 0.28) * this.r * 0.5],
          [Math.cos(a + 0.28) * this.r * 0.5, Math.sin(a + 0.28) * this.r * 0.5],
          [Math.cos(a) * 4, Math.sin(a) * 4 - h]
        ]);
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,160,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (this.style === 'core') {
      /* 星界核心：能量柱 */
      const g = ctx.createRadialGradient(0, 0, 3, 0, 0, this.r * 1.3);
      g.addColorStop(0, '#eaffff');
      g.addColorStop(0.4, '#8fe9ff');
      g.addColorStop(1, 'rgba(30,80,110,0.15)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, this.r * (1.02 + 0.05 * Math.sin(this.t * 3)), 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,245,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.25, this.spin, this.spin + Math.PI * 1.3);
      ctx.stroke();
    } else if (this.style === 'pod') {
      /* 腐化森林：孢子囊（越打越鼓） */
      const pulse = 1 + 0.08 * Math.sin(this.t * 2.4);
      ctx.fillStyle = '#3f5c2a';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.r * pulse, this.r * 0.92 * pulse, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#9ad14f';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(150,210,90,0.55)';
      for (const l of this.lumps) {
        ctx.beginPath();
        ctx.arc(Math.cos(l.a) * this.r * l.d, Math.sin(l.a) * this.r * l.d, this.r * l.s * 0.5, 0, TAU);
        ctx.fill();
      }
    } else {
      /* 废弃庭院：碎石堆 */
      ctx.fillStyle = '#2b3547';
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#3d4a60';
      for (const l of this.lumps) {
        ctx.beginPath();
        ctx.arc(Math.cos(l.a) * this.r * l.d, Math.sin(l.a) * this.r * l.d, this.r * l.s, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = '#55637a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.stroke();
    }

    /* 受损裂纹 */
    if (q < 1) {
      ctx.strokeStyle = 'rgba(20,20,26,0.75)';
      ctx.lineWidth = 1.6 + (1 - q) * 2;
      const n = Math.ceil((1 - q) * 5);
      for (let i = 0; i < n; i++) {
        const a = (i / 5) * TAU + 0.4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * this.r * 0.15, Math.sin(a) * this.r * 0.15);
        ctx.lineTo(Math.cos(a) * this.r * 0.85, Math.sin(a) * this.r * 0.85);
        ctx.stroke();
      }
    }
    if (this.hitFlash > 0) {
      ctx.globalAlpha = this.hitFlash * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.05, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   2. 周期喷发（落石 / 蒸汽 / 孢子 / 虚空 / 脉冲）
      —— 预警 → 喷发 → 冷却；对玩家与敌人同等伤害
   ----------------------------------------------------------- */
class GeyserHazard extends EnvHazard {
  constructor(game, x, y, opt) {
    opt = Object.assign({ r: 56, dmg: 11 }, opt);
    super(game, x, y, opt);
    this.style = opt.style || 'rock';
    this.period = opt.period || 3.5;
    this.warn = opt.warn || 0.95;
    this.erupt = opt.erupt || 0.45;
    this.ph = this.rng.range(0, this.period);
    this.tickT = 0;
    this.hitIds = [];
    if (this.style === 'steam') this.color = '#ffb35c';
    else if (this.style === 'spore') this.color = '#9ad14f';
    else if (this.style === 'void') this.color = '#c08bff';
    else if (this.style === 'pulse') this.color = '#8fe9ff';
    else this.color = '#c8b48a';
  }

  get warning() { return this.ph > this.period - this.warn; }
  get erupting() { return this.ph < this.erupt; }

  update(dt) {
    super.update(dt);
    this.ph += dt;
    if (this.ph >= this.period) {
      this.ph -= this.period;
      this.hitIds.length = 0;
      this.tickT = 0;
      this._boom();
    }
  }

  _boom() {
    this.game.particles.burst(this.x, this.y, 14, {
      speed: 240, life: 0.5, size: 5, colors: [this.color, '#ffffff']
    });
    this.game.particles.ring(this.x, this.y, this.color, 14, 220);
    this.game.addShake(1.2);
  }

  affect(entity, dt) {
    if (!this.erupting) return;
    if (!this.contains(entity.x, entity.y, entity.r)) return;

    /* 每次喷发对同一目标只结算一次 */
    if (this.hitIds.indexOf(entity) >= 0) return;
    this.hitIds.push(entity);

    if (entity === this.game.player) {
      if (!entity.dead) entity.takeDamage(this.dmg, this.x, this.y);
    } else if (!entity.dead) {
      entity.takeDamage(this.dmg, this.x, this.y);
    }
    this.game.particles.burst(entity.x, entity.y, 6, { speed: 170, life: 0.3, size: 3.4, color: this.color });
  }

  drawUnder(ctx) {
    ctx.save();
    if (this.warning) {
      const g = clamp((this.ph - (this.period - this.warn)) / this.warn, 0, 1);
      ctx.globalAlpha = 0.14 + 0.30 * g;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * (0.35 + 0.65 * g), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.5 + 0.4 * g;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2 + 2 * g;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -this.t * 60;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      /* 落石：预警阴影由小变大 */
      if (this.style === 'rock') {
        ctx.globalAlpha = 0.20 + 0.5 * g;
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r * 0.28 * (0.4 + g), 0, TAU);
        ctx.fill();
      }
    } else if (this.style !== 'rock') {
      /* 常态：地面痕迹 */
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 0.6, 0, TAU);
      ctx.fill();
    }

    if (this.erupting) {
      const q = 1 - this.ph / this.erupt;
      ctx.globalAlpha = clamp(q, 0, 1) * 0.7;
      const g2 = ctx.createRadialGradient(this.x, this.y, 4, this.x, this.y, this.r);
      g2.addColorStop(0, '#ffffff');
      g2.addColorStop(0.35, this.color);
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * (0.6 + 0.4 * q), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   3. 传送带（机械矿井）：矩形区域持续推动实体
   ----------------------------------------------------------- */
class ConveyorHazard extends EnvHazard {
  constructor(game, x, y, opt) {
    opt = Object.assign({ r: 26 }, opt);
    super(game, x, y, opt);
    this.w = opt.w || 320;
    this.h = opt.h || 150;
    this.dir = opt.dir || { x: 1, y: 0 };
    this.force = opt.force || 150;
    this.color = '#ffb35c';
    this.rect = { x: x - this.w / 2, y: y - this.h / 2, w: this.w, h: this.h };
  }

  contains(x, y, r) {
    return Collision.circleRect(x, y, r || 0, this.rect);
  }

  affect(entity, dt) {
    if (!this.contains(entity.x, entity.y, entity.r)) return;
    const mul = (entity === this.game.player) ? 1 : 0.75;
    entity.x += this.dir.x * this.force * mul * dt;
    entity.y += this.dir.y * this.force * mul * dt;
  }

  drawUnder(ctx) {
    const r = this.rect;
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = this.color;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    /* 滚动箭头 */
    const horiz = Math.abs(this.dir.x) >= Math.abs(this.dir.y);
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const step = 46;
    const off = (this.t * this.force * 0.55) % step;
    if (horiz) {
      const sx = this.dir.x > 0 ? 1 : -1;
      for (let y = r.y + 22; y < r.y + r.h; y += 44) {
        for (let i = -1; i * step < r.w + step; i++) {
          const x = r.x + i * step + off * sx;
          if (x < r.x - 20 || x > r.x + r.w + 20) continue;
          ctx.beginPath();
          ctx.moveTo(x - 9 * sx, y - 8);
          ctx.lineTo(x + 9 * sx, y);
          ctx.lineTo(x - 9 * sx, y + 8);
          ctx.stroke();
        }
      }
    } else {
      const sy = this.dir.y > 0 ? 1 : -1;
      for (let x = r.x + 24; x < r.x + r.w; x += 46) {
        for (let i = -1; i * step < r.h + step; i++) {
          const y = r.y + i * step + off * sy;
          if (y < r.y - 20 || y > r.y + r.h + 20) continue;
          ctx.beginPath();
          ctx.moveTo(x - 8, y - 9 * sy);
          ctx.lineTo(x, y + 9 * sy);
          ctx.lineTo(x + 8, y - 9 * sy);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   4. 持续区域（毒沼 / 星云残留）：减速 + 持续伤害
   ----------------------------------------------------------- */
class SlickHazard extends EnvHazard {
  constructor(game, x, y, opt) {
    opt = Object.assign({ r: 64, dmg: 7 }, opt);
    super(game, x, y, opt);
    this.style = opt.style || 'bog';
    this.dps = this.dmg;
    this.tick = 0;
    if (this.style === 'bog') this.color = '#9ad14f';
    else if (this.style === 'void') this.color = '#c08bff';
    else this.color = '#8fe9ff';
  }

  affect(entity, dt) {
    if (!this.contains(entity.x, entity.y, entity.r)) return;
    if (entity === this.game.player) {
      entity.applySlow(0.35);
      this.tick -= dt;
      if (this.tick <= 0) {
        this.tick = 1.0;
        if (!entity.dead) entity.takeDamage(Math.round(this.dps), this.x, this.y);
      }
    } else if (!entity.dead) {
      entity.applyStatus('slow', 1);
      entity.takeDot(this.dps * dt, this.game.player);
    }
  }

  drawUnder(ctx) {
    ctx.save();
    const wob = 1 + 0.04 * Math.sin(this.t * 1.8);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, this.r * wob, this.r * 0.86 * wob, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 气泡 */
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = this.color;
    for (let i = 0; i < 4; i++) {
      const a = this.t * (0.5 + i * 0.2) + i * 1.7;
      const d = this.r * (0.25 + 0.45 * (0.5 + 0.5 * Math.sin(a)));
      ctx.beginPath();
      ctx.arc(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d * 0.8, 2.4 + (i % 2), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   5. 引力漩涡（虚空遗迹）：周期激活，把附近实体往中心拉
      —— 只位移不伤害，可挣脱
   ----------------------------------------------------------- */
class VortexHazard extends EnvHazard {
  constructor(game, x, y, opt) {
    opt = Object.assign({ r: 70 }, opt);
    super(game, x, y, opt);
    this.period = opt.period || 6.2;
    this.on = opt.on || 3.0;
    this.color = '#c08bff';
    this.ph = this.rng.range(0, this.period);
  }

  get active() { return this.ph < this.on; }

  update(dt) {
    super.update(dt);
    this.ph = (this.ph + dt) % this.period;
    if (this.active && Math.random() < dt * 12) {
      const a = Math.random() * TAU;
      const d = this.r * (0.5 + Math.random() * 1.6);
      this.game.particles.spawn(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d,
        -Math.cos(a) * 90, -Math.sin(a) * 90, 0.5, 3, 'rgba(190,150,255,0.8)', { drag: 1.2 });
    }
  }

  affect(entity, dt) {
    if (!this.active) return;
    const dx = this.x - entity.x, dy = this.y - entity.y;
    const d = Math.hypot(dx, dy);
    const reach = this.r * 2.6;
    if (d > reach || d < 1) return;
    const k = 1 - d / reach;
    const force = (entity === this.game.player ? 150 : 110) * k;
    entity.x += (dx / d) * force * dt;
    entity.y += (dy / d) * force * dt;
  }

  drawUnder(ctx) {
    ctx.save();
    const warm = this.ph > this.period - 1.0;                 // 即将激活
    ctx.globalAlpha = this.active ? 0.30 : (warm ? 0.14 + 0.12 * Math.sin(this.t * 12) : 0.10);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 3; i++) {
      const rr = this.r * (0.55 + i * 0.32);
      const a0 = this.t * (1.4 + i * 0.7) * (this.active ? 2.2 : 0.6);
      ctx.beginPath();
      ctx.arc(this.x, this.y, rr, a0, a0 + Math.PI * 1.35);
      ctx.stroke();
    }
    ctx.globalAlpha = this.active ? 0.20 : 0.08;
    const g = ctx.createRadialGradient(this.x, this.y, 4, this.x, this.y, this.r * 1.3);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, this.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * 1.3, 0, TAU);
    ctx.fill();
    /* 预警：激活前 1 秒闪外圈 */
    if (warm) {
      ctx.globalAlpha = 0.4;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -this.t * 50;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 2.6, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   6. 相位柱（虚空遗迹）：周期实体化 / 虚化
      —— 实体化前 0.8s 有明确预警
   ----------------------------------------------------------- */
class PhaserHazard extends EnvHazard {
  constructor(game, x, y, opt) {
    opt = Object.assign({ r: 30 }, opt);
    super(game, x, y, opt);
    this.period = opt.period || 6.0;
    this.solidDur = opt.solidDur || 2.8;
    this.warn = 0.85;
    this.color = '#c08bff';
    this.ph = this.rng.range(0, this.period);
    this.solid = false;
  }

  update(dt) {
    super.update(dt);
    this.ph = (this.ph + dt) % this.period;
    this.solid = this.ph < this.solidDur;
  }

  affectsCollision() { return this.solid; }

  drawUnder(ctx) {
    /* 虚化 / 预警轮廓 */
    if (this.solid) return;
    const toSolid = this.period - this.ph;
    const warm = toSolid < this.warn;
    ctx.save();
    ctx.globalAlpha = warm ? 0.35 + 0.35 * Math.sin(this.t * 16) : 0.16;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * (warm ? 1 : 0.85), 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawOver(ctx) {
    if (!this.solid) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = '#2a1f4a';
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * (0.45 + 0.12 * Math.sin(this.t * 4)), 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   7. 电弧塔（星界核心）：周期锁定最近目标 → 预警 → 放电
   ----------------------------------------------------------- */
class PylonHazard extends EnvHazard {
  constructor(game, x, y, opt) {
    opt = Object.assign({ solid: true, r: 24, hp: 120, dmg: 12 }, opt);
    super(game, x, y, opt);
    this.period = opt.period || 3.4;
    this.warn = 0.75;
    this.range = opt.range || 250;
    this.color = '#8fe9ff';
    this.ph = this.rng.range(0, this.period);
    this.target = null;
    this.zapT = 0;
  }

  update(dt) {
    super.update(dt);
    if (this.zapT > 0) this.zapT -= dt;
    const prev = this.ph;
    this.ph += dt;
    if (this.ph >= this.period) {
      this.ph -= this.period;
      this._fire();
    }
    /* 预警阶段锁定目标 */
    if (this.ph > this.period - this.warn) {
      this.target = this._nearest();
    } else if (prev <= this.period - this.warn) {
      this.target = null;
    }
  }

  _nearest() {
    const p = this.game.player;
    let best = null, bd = this.range * this.range;
    if (p && !p.dead) {
      const d = dist2(this.x, this.y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    const list = (this.game.room && this.game.room.enemies) || [];
    for (const e of list) {
      if (e.dead) continue;
      const d = dist2(this.x, this.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  _fire() {
    const t = this.target || this._nearest();
    if (!t) return;
    this.game._zap(this.x, this.y - 18, t.x, t.y, this.color);
    if (t === this.game.player) {
      if (!t.dead) t.takeDamage(this.dmg, this.x, this.y);
    } else if (!t.dead) {
      t.takeDamage(this.dmg, this.x, this.y);
    }
    this.game.particles.burst(t.x, t.y, 8, { speed: 180, life: 0.3, size: 3.4, color: this.color });
    this.zapT = 0.2;
    this.target = null;
  }

  drawUnder(ctx) {
    if (!this.target) return;
    const g = clamp((this.ph - (this.period - this.warn)) / this.warn, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.5 * g;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.5 + 2 * g;
    ctx.setLineDash([8, 7]);
    ctx.lineDashOffset = -this.t * 90;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - 18);
    ctx.lineTo(this.target.x, this.target.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawOver(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    this.drawShadow(ctx, this.r * 0.9, this.r * 0.34);
    /* 塔身 */
    ctx.fillStyle = '#16283a';
    roundRectPath(ctx, -this.r * 0.62, -this.r * 1.5, this.r * 1.24, this.r * 1.9, 5);
    ctx.fill();
    ctx.strokeStyle = '#24435c';
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 顶端球 */
    const chg = this.ph > this.period - this.warn
      ? clamp((this.ph - (this.period - this.warn)) / this.warn, 0, 1) : 0;
    const g = ctx.createRadialGradient(0, -this.r * 1.5, 2, 0, -this.r * 1.5, this.r * (0.7 + chg * 0.5));
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, this.color);
    g.addColorStop(1, 'rgba(40,120,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -this.r * 1.5, this.r * (0.55 + chg * 0.35), 0, TAU);
    ctx.fill();
    if (this.zapT > 0) {
      ctx.globalAlpha = this.zapT / 0.2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, -this.r * 1.5, this.r * 0.9, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   环境障碍工厂 + 场地管理
   ----------------------------------------------------------- */
const HazardFactory = {
  create(game, def, x, y, rng) {
    const opt = { rng: rng || new Rng(hashSeed('hz' + x + ',' + y)), color: def.color };
    if (def.hp !== undefined) opt.hp = def.hp;
    if (def.dmg !== undefined) opt.dmg = def.dmg;
    opt.style = def.style;

    switch (def.type) {
      case 'pillar': return new PillarHazard(game, x, y, opt);
      case 'geyser': return new GeyserHazard(game, x, y, opt);
      case 'conveyor': {
        const horiz = rng ? rng.chance(0.5) : true;
        const w = horiz ? 330 : 150;
        const h = horiz ? 150 : 300;
        const dir = horiz
          ? { x: (rng && rng.chance(0.5)) ? 1 : -1, y: 0 }
          : { x: 0, y: (rng && rng.chance(0.5)) ? 1 : -1 };
        return new ConveyorHazard(game, x, y, Object.assign(opt, { w: w, h: h, dir: dir }));
      }
      case 'slick': return new SlickHazard(game, x, y, opt);
      case 'vortex': return new VortexHazard(game, x, y, opt);
      case 'phaser': return new PhaserHazard(game, x, y, opt);
      case 'pylon': return new PylonHazard(game, x, y, opt);
      default: return new PillarHazard(game, x, y, opt);
    }
  }
};

/* 一个房间内的环境障碍集合 */
class HazardField {
  constructor(room) {
    this.room = room;
    this.game = room.game;
    this.list = [];
    this.chapter = room.chapter;
    this._build();
  }

  /* 生成：数量与种类由章节决定，位置由房间 Rng 决定（同种子可复现） */
  _build() {
    const room = this.room;
    const rng = room.rng.fork('hazards');
    const ch = this.chapter;
    const defs = (room.type === ROOM_TYPE.BOSS)
      ? (ch.bossHazards || [])
      : (ch.hazards || []);
    if (!defs.length) return;

    const marginX = 108, marginY = 108;
    const cx = VIEW_W / 2, cy = VIEW_H / 2;
    const minFromCenter = room.type === ROOM_TYPE.BOSS ? 210 : 165;
    /* Boss 出场点：周围要留出空地，别把 Boss 卡在柱子里 */
    const bossPt = { x: ARENA.x + ARENA.w / 2, y: ARENA.y + 120 };

    for (const def of defs) {
      const n = rng.int(def.n[0], def.n[1]);
      for (let i = 0; i < n; i++) {
        let pt = null;
        for (let a = 0; a < 30; a++) {
          const x = rng.range(ARENA.x + marginX, ARENA.x + ARENA.w - marginX);
          const y = rng.range(ARENA.y + marginY, ARENA.y + ARENA.h - marginY);
          if (dist(x, y, cx, cy) < minFromCenter) continue;
          if (room.type === ROOM_TYPE.BOSS && dist(x, y, bossPt.x, bossPt.y) < 170) continue;
          let ok = true;
          for (const h of this.list) {
            if (dist(x, y, h.x, h.y) < 130) { ok = false; break; }
          }
          if (!ok) continue;
          pt = { x: x, y: y };
          break;
        }
        if (!pt) continue;
        this.list.push(HazardFactory.create(this.game, def, pt.x, pt.y, rng.fork('h' + this.list.length)));
      }
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      h.update(dt);
      if (h.dead) { this.list.splice(i, 1); continue; }
    }
  }

  /* 对玩家与敌人施加作用（中立：谁踩到都一样） */
  affectAll(dt) {
    const p = this.game.player;
    for (const h of this.list) {
      if (p && !p.dead) h.affect(p, dt);
      for (const e of this.room.enemies) {
        if (!e.dead) h.affect(e, dt);
      }
    }
  }

  /* 阻挡移动：把实体推出实体化的障碍 */
  resolveEntity(e) {
    for (const h of this.list) {
      if (!h.solid) continue;
      const dx = e.x - h.x, dy = e.y - h.y;
      const need = e.r + h.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= need * need) continue;
      const d = Math.sqrt(d2);
      if (d < 0.0001) {
        /* 正好压在圆心上：随机挑一个方向推出去 */
        const a = Math.random() * TAU;
        e.x = h.x + Math.cos(a) * need;
        e.y = h.y + Math.sin(a) * need;
        continue;
      }
      const push = need - d;
      e.x += (dx / d) * push;
      e.y += (dy / d) * push;
    }
  }

  /* 子弹碰撞：返回被命中的障碍（solid 才算） */
  hitTest(x, y, r) {
    for (const h of this.list) {
      if (!h.solid) continue;
      if (h.contains(x, y, r)) return h;
    }
    return null;
  }

  /* 圆形反弹（供 bounce 类子弹使用） */
  bounce(p, h) {
    const dx = p.x - h.x, dy = p.y - h.y;
    const need = p.r + h.r;
    let d = Math.hypot(dx, dy) || 0.001;
    const ux = dx / d, uy = dy / d;
    p.x = h.x + ux * (need + 0.5);
    p.y = h.y + uy * (need + 0.5);
    const dot = p.vx * ux + p.vy * uy;
    p.vx -= 2 * dot * ux;
    p.vy -= 2 * dot * uy;
  }

  drawUnder(ctx) { for (const h of this.list) h.drawUnder(ctx); }
  drawOver(ctx) { for (const h of this.list) h.drawOver(ctx); }
}
