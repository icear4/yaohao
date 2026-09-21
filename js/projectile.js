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
  }

  update(dt) {
    this.trail.push(this.x, this.y);
    if (this.trail.length > this.trailMax * 2) this.trail.splice(0, 2);
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
