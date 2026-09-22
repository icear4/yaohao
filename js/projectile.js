/* ===========================================================
   projectile.js — 投射物（玩家 / 敌人共用）
   =========================================================== */
'use strict';

class Projectile {
  constructor(opt) {
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
    this.trail = [];
    this.trailMax = opt.trailMax !== undefined ? opt.trailMax : 6;

    /* ---- 道具机制快照（由 Player.shoot 拷贝进来） ---- */
    const proto = defaultMods();
    for (const k in proto) this[k] = opt[k] || 0;
    this.game = opt.game || null;
    this.speed = opt.speed || 0;
    this.damageMul = opt.damageMul || 1;
    this.splitLeft = opt.splitLeft || 0;
    this.isChild = !!opt.isChild;
    this.hitIds = [];                       // 穿透时避免重复命中
    this.rehitT = 0;                        // 回旋弹的重复命中间隔
    this.orbitDir = opt.orbitDir !== undefined ? opt.orbitDir : (chance(0.5) ? 1 : -1);
    this.omega = 2.2 * this.orbitDir;
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

  update(dt) {
    this.trail.push(this.x, this.y);
    if (this.trail.length > this.trailMax * 2) this.trail.splice(0, 2);

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
    this.rot += this.spin * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    const a = this.friendly ? Math.atan2(this.vy, this.vx) : this.rot;
    ctx.save();

    /* 拖影 */
    const n = this.trail.length / 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n;
      ctx.globalAlpha = 0.30 * t;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.trail[i * 2], this.trail[i * 2 + 1], this.r * 0.85 * t, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.translate(this.x, this.y);
    ctx.rotate(a);

    /* 外层光晕 */
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 2.4 * this.size, this.r * 1.35 * this.size, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 弹体 */
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 1.55 * this.size, this.r * 0.95 * this.size, 0, 0, TAU);
    ctx.fill();

    /* 弹芯 */
    ctx.fillStyle = this.core;
    ctx.beginPath();
    ctx.ellipse(this.r * 0.2, 0, this.r * 0.72 * this.size, this.r * 0.5 * this.size, 0, 0, TAU);
    ctx.fill();

    ctx.restore();
  }
}
