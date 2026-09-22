/* ===========================================================
   projectile.js — 投射物（玩家 / 敌人共用）
   视觉档案见 juice.js（PROJ_VIZ）：不同投射物有不同的
   形状 / 大小 / 轨迹 / 拖尾粒子 / 命中效果。
   实例由 Game 的对象池复用（reset 而非 new），避免弹幕高峰的 GC 抖动。
   =========================================================== */
'use strict';

const TRAIL_CAP = 12;          // 拖影点上限（环形缓冲，不再 splice）

class Projectile {
  constructor(opt) {
    this.trail = new Float32Array(TRAIL_CAP * 2);
    this.hitIds = [];
    this.reset(opt);
  }

  /* 复用入口：把所有字段一次性写干净 */
  reset(opt) {
    this.x = opt.x;
    this.y = opt.y;
    this.vx = Math.cos(opt.angle) * opt.speed;
    this.vy = Math.sin(opt.angle) * opt.speed;
    this.r = opt.r || 5;
    this.damage = opt.damage || 10;
    this.friendly = !!opt.friendly;
    this.life = opt.life || 2.4;
    this.maxLife = this.life;
    this.color = opt.color || (this.friendly ? '#ffc65a' : '#7fe4ff');
    this.core = opt.core || '#ffffff';
    this.size = opt.size || 1;
    this.dead = false;
    this.spin = opt.spin !== undefined ? opt.spin : 0;
    this.rot = opt.angle;
    this.game = opt.game || null;
    this.speed = opt.speed || 0;
    this.damageMul = opt.damageMul || 1;
    this.splitLeft = opt.splitLeft || 0;
    this.isChild = !!opt.isChild;
    this.crackHit = false;

    /* 道具机制快照（由 Player.shoot 拷贝进来） */
    if (!Projectile._modKeys) Projectile._modKeys = Object.keys(defaultMods());
    const keys = Projectile._modKeys;
    for (let i = 0; i < keys.length; i++) this[keys[i]] = opt[keys[i]] || 0;

    this.hitIds.length = 0;
    this.rehitT = 0;                        // 回旋弹的重复命中间隔
    this.orbitDir = opt.orbitDir !== undefined ? opt.orbitDir : (chance(0.5) ? 1 : -1);
    this.omega = 2.2 * this.orbitDir;

    /* 视觉档案 */
    this.viz = vizFor(opt);
    this.trailMax = Math.min(TRAIL_CAP, this.viz.trailLen);
    this._tn = 0;
    this._ti = 0;
    this._emitAcc = 0;
    this.pulse = Math.random() * TAU;       // 呼吸相位（纯表现，不进种子）
  }

  /* 追踪：友军弹朝最近的敌人转向，敌方弹朝玩家缓慢转向（转向速率受限，可躲） */
  _steer(dt) {
    const g = this.game;
    if (!g) return;
    let tx, ty;
    if (this.friendly) {
      let best = null, bestD = 520 * 520;
      const list = g.room ? g.room.enemies : [];
      for (const e of list) {
        if (e.dead) continue;
        const d = dist2(this.x, this.y, e.x, e.y);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (!best) return;
      tx = best.x; ty = best.y;
    } else {
      const p = g.player;
      if (!p || p.dead) return;
      tx = p.x; ty = p.y;
    }
    const cur = Math.atan2(this.vy, this.vx);
    const want = angleTo(this.x, this.y, tx, ty);
    const rate = Math.min(7.5, 2.4 + this.homing * 2.2) * dt;
    const na = cur + clamp(angleDelta(cur, want), -rate, rate);
    this.vx = Math.cos(na) * this.speed;
    this.vy = Math.sin(na) * this.speed;
  }

  /* 回旋：先划弧线，后半程折返飞回玩家 */
  _orbit(dt) {
    const cur = Math.atan2(this.vy, this.vx);
    let na;
    if (this.life < this.maxLife * 0.55 && this.game && this.game.player) {
      const p = this.game.player;
      const want = angleTo(this.x, this.y, p.x, p.y);
      const rate = 5.0 * dt;
      na = cur + clamp(angleDelta(cur, want), -rate, rate);
    } else {
      na = cur + this.omega * dt;
    }
    this.vx = Math.cos(na) * this.speed;
    this.vy = Math.sin(na) * this.speed;
  }

  /* 拖影：环形缓冲，写满自动覆盖最旧的点（不再有数组搬移） */
  _pushTrail(x, y) {
    const i = (this._ti % TRAIL_CAP) * 2;
    this.trail[i] = x;
    this.trail[i + 1] = y;
    this._ti++;
    if (this._tn < TRAIL_CAP) this._tn++;
  }

  /* 拖尾粒子发射器（按视觉档案，受性能档位控制） */
  _emit(dt) {
    const e = this.viz.emit;
    if (!e || !Perf.emitters) return;
    this._emitAcc += dt * e.rate;
    while (this._emitAcc >= 1) {
      this._emitAcc -= 1;
      this.game.particles.spawn(
        this.x + rand(-2, 2), this.y + rand(-2, 2),
        rand(-e.speed, e.speed) - this.vx * 0.08,
        rand(-e.speed, e.speed) - this.vy * 0.08,
        e.life * rand(0.7, 1.2), e.size * rand(0.7, 1.2), e.color,
        { drag: 3.4 }
      );
    }
  }

  update(dt) {
    this._pushTrail(this.x, this.y);
    if (Perf.emitters) this._emit(dt);

    if (this.homing > 0) this._steer(dt);
    if (this.orbit > 0) {
      this._orbit(dt);
      /* 回旋弹可以反复命中同一目标 */
      this.rehitT -= dt;
      if (this.rehitT <= 0) {
        this.rehitT = this.orbitPierce > 0 ? 0.18 : 0.38;
        this.hitIds.length = 0;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += (this.spin || this.viz.spin) * dt;
    this.pulse += dt * 12;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  /* ---------------- 绘制 ---------------- */
  draw(ctx) {
    const v = this.viz;
    const a = this.friendly ? Math.atan2(this.vy, this.vx) : this.rot;
    const s = this.size * v.sizeMul;
    const rr = this.r * s;

    /* ---- 拖影：一条渐隐的折线（一次 stroke 画完，比逐点画圆便宜一个数量级） ---- */
    if (Perf.trails && this._tn > 1) {
      const n = Math.min(this._tn, this.trailMax);
      let lw = rr * 1.1, al = 0.34;
      if (v.trail === 'dash') { lw = rr * 0.75; al = 0.30; }
      else if (v.trail === 'spark') { lw = rr * 0.65; al = 0.22; }
      else if (v.trail === 'drip') { lw = rr * 0.95; al = 0.28; }
      else if (v.trail === 'smoke') { lw = rr * 1.45; al = 0.18; }
      ctx.save();
      ctx.globalAlpha = al;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = Math.max(1, lw);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const idx = (((this._ti - n + k) % TRAIL_CAP) + TRAIL_CAP) % TRAIL_CAP;
        const px = this.trail[idx * 2], py = this.trail[idx * 2 + 1];
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(a);

    const glow = Perf.glow ? v.glow : 0;

    /* 外层光晕 */
    if (glow > 0) {
      ctx.globalAlpha = glow;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, rr * 2.4, rr * 1.35, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    switch (v.shape) {
      case 'capsule':
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, rr * 1.55, rr * 0.95, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = this.core;
        ctx.globalAlpha = v.core;
        ctx.beginPath();
        ctx.ellipse(rr * 0.2, 0, rr * 0.72, rr * 0.5, 0, 0, TAU);
        ctx.fill();
        break;

      case 'orb': {
        const pu = 1 + 0.10 * Math.sin(this.pulse);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, rr * 1.15 * pu, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = this.color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, rr * 1.75 * pu, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = this.core;
        ctx.beginPath();
        ctx.arc(0, 0, rr * 0.52, 0, TAU);
        ctx.fill();
        break;
      }

      case 'diamond':
        ctx.fillStyle = this.color;
        polygonPath(ctx, [[0, -rr * 1.7], [rr * 0.95, 0], [0, rr * 1.7], [-rr * 0.95, 0]]);
        ctx.fill();
        ctx.fillStyle = this.core;
        ctx.globalAlpha = v.core;
        polygonPath(ctx, [[0, -rr * 0.8], [rr * 0.42, 0], [0, rr * 0.8], [-rr * 0.42, 0]]);
        ctx.fill();
        break;

      case 'blob': {
        /* 毒液：两团错位的黏块，看起来在晃 */
        const w = Math.sin(this.pulse * 0.6) * rr * 0.18;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(-rr * 0.2 + w, rr * 0.1, rr * 1.0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(rr * 0.28 - w, -rr * 0.14, rr * 0.78, 0, TAU);
        ctx.fill();
        ctx.fillStyle = this.core;
        ctx.beginPath();
        ctx.arc(rr * 0.15, 0, rr * 0.36, 0, TAU);
        ctx.fill();
        break;
      }

      case 'crystal': {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * TAU;
          const px = Math.cos(ang) * rr * 1.25, py = Math.sin(ang) * rr * 0.95;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = this.core;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = this.core;
        ctx.beginPath();
        ctx.arc(0, 0, rr * 0.4, 0, TAU);
        ctx.fill();
        break;
      }

      case 'ring':
        /* 回旋弹：旋转的圆环 */
        ctx.strokeStyle = this.color;
        ctx.lineWidth = Math.max(2, rr * 0.55);
        ctx.beginPath();
        ctx.arc(0, 0, rr * 1.15, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = this.core;
        ctx.beginPath();
        ctx.arc(rr * 0.9, 0, rr * 0.42, 0, TAU);
        ctx.fill();
        break;

      default:
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, TAU);
        ctx.fill();
        break;
    }

    ctx.restore();
  }
}
