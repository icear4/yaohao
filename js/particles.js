/* ===========================================================
   particles.js — 粒子系统 + 飘字伤害数字
   =========================================================== */
'use strict';

class Particle {
  constructor() { this.alive = false; }

  init(x, y, vx, vy, life, size, color, opt) {
    opt = opt || {};
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.size = size;
    this.color = color;
    this.drag = opt.drag !== undefined ? opt.drag : 3.2;
    this.shrink = opt.shrink !== undefined ? opt.shrink : true;
    this.glow = opt.glow !== undefined ? opt.glow : false;
    this.shape = opt.shape || 'circle';
    this.rot = opt.rot || 0;
    this.spin = opt.spin || 0;
    this.alive = true;
    return this;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    const k = Math.max(0, 1 - this.drag * dt);
    this.vx *= k;
    this.vy *= k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += this.spin * dt;
  }

  draw(ctx) {
    const t = this.life / this.maxLife;
    const a = clamp(t, 0, 1);
    const s = this.shrink ? this.size * (0.25 + t * 0.75) : this.size;
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    if (this.shape === 'square') {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
      ctx.restore();
    } else if (this.shape === 'shard') {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.55, s * 0.7);
      ctx.lineTo(-s * 0.55, s * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(this.x, this.y, s * 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

class ParticleSystem {
  constructor(max) {
    this.max = max || 900;
    this.items = [];
    this.pool = [];
  }

  _get() {
    const p = this.pool.pop() || new Particle();
    return p;
  }

  spawn(x, y, vx, vy, life, size, color, opt) {
    if (this.items.length >= this.max) return null;
    const p = this._get().init(x, y, vx, vy, life, size, color, opt);
    this.items.push(p);
    return p;
  }

  /* 通用爆发 */
  burst(x, y, count, opt) {
    opt = opt || {};
    const speed = opt.speed || 140;
    const life = opt.life || 0.45;
    const size = opt.size || 4;
    const color = opt.color || '#ffb347';
    const dir = opt.dir !== undefined ? opt.dir : null;
    const spread = opt.spread !== undefined ? opt.spread : TAU;
    for (let i = 0; i < count; i++) {
      const a = dir !== null ? dir + rand(-spread * 0.5, spread * 0.5) : rand(0, TAU);
      const s = speed * rand(0.35, 1.15);
      this.spawn(
        x + rand(-3, 3), y + rand(-3, 3),
        Math.cos(a) * s, Math.sin(a) * s,
        life * rand(0.6, 1.25), size * rand(0.6, 1.35),
        opt.colors ? pick(opt.colors) : color,
        opt
      );
    }
  }

  /* 枪口火花 */
  muzzle(x, y, angle, color) {
    for (let i = 0; i < 5; i++) {
      const a = angle + rand(-0.32, 0.32);
      const s = rand(120, 320);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s,
        rand(0.08, 0.19), rand(2.5, 5.5), i % 2 ? '#fff2c8' : color,
        { drag: 6, shape: 'circle' });
    }
  }

  /* 命中火花 */
  hitSpark(x, y, angle, color) {
    for (let i = 0; i < 7; i++) {
      const a = angle + rand(-1.0, 1.0);
      const s = rand(90, 260);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s,
        rand(0.15, 0.34), rand(2, 4.5), color,
        { drag: 5, shape: 'shard', rot: a, spin: rand(-9, 9) });
    }
  }

  /* 死亡碎裂 */
  deathBurst(x, y, colors, scale) {
    scale = scale || 1;
    for (let i = 0; i < 16 * scale; i++) {
      const a = rand(0, TAU);
      const s = rand(60, 300) * scale;
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s,
        rand(0.3, 0.75), rand(2.5, 6.5) * scale, pick(colors),
        { drag: 3.0, shape: 'shard', rot: a, spin: rand(-12, 12) });
    }
    for (let i = 0; i < 5; i++) {
      this.spawn(x, y, rand(-20, 20), rand(-20, 20),
        rand(0.4, 0.8), rand(14, 26) * scale, 'rgba(255,255,255,0.10)',
        { drag: 2.2, shrink: false });
    }
  }

  /* 冲刺拖影 */
  trail(x, y, color, size) {
    this.spawn(x + rand(-4, 4), y + rand(-4, 4), rand(-20, 20), rand(-20, 20),
      rand(0.18, 0.36), size || 7, color, { drag: 4, shrink: true });
  }

  /* 环形冲击波（用碎片模拟） */
  ring(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      this.spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed,
        rand(0.25, 0.45), rand(3, 5), color, { drag: 3.6 });
    }
  }

  update(dt) {
    const arr = this.items;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.update(dt);
      if (!p.alive) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
        this.pool.push(p);
      }
    }
  }

  /* 绘制：先按「颜色 → 透明度档」把圆形粒子分桶，再一桶一次 fill。
     弹幕高峰时粒子数是最大的绘制开销来源，合批能把 draw call 降一到两个数量级
     （400 颗粒子从 400 次路径填充降到几十次）。 */
  draw(ctx) {
    const arr = this.items;
    if (!arr.length) return;

    const NL = 10;                                  // 透明度档数
    const B = this._buckets || (this._buckets = new Map());
    const SB = this._shapeBuf || (this._shapeBuf = []);

    /* 清空上一帧的分桶（保留数组对象，避免每帧重新分配） */
    for (const g of B.values()) {
      for (let k = 0; k < NL; k++) g[k].length = 0;
    }
    SB.length = 0;

    /* 一遍扫描完成分桶 */
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const a = clamp(p.life / p.maxLife, 0, 1);
      if (a < 0.05) continue;
      if (p.shape !== 'circle') { SB.push(p); continue; }
      let g = B.get(p.color);
      if (!g) { g = []; for (let k = 0; k < NL; k++) g.push([]); B.set(p.color, g); }
      g[Math.round(a * (NL - 1))].push(p);
    }

    ctx.save();

    /* 圆形：一桶一条路径 */
    for (const g of B.values()) {
      for (let k = 0; k < NL; k++) {
        const list = g[k];
        if (!list.length) continue;
        ctx.globalAlpha = k / (NL - 1);
        ctx.fillStyle = list[0].color;
        ctx.beginPath();
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const t = p.life / p.maxLife;
          const s = p.shrink ? p.size * (0.25 + t * 0.75) : p.size;
          ctx.moveTo(p.x + s * 0.5, p.y);
          ctx.arc(p.x, p.y, s * 0.5, 0, TAU);
        }
        ctx.fill();
      }
    }

    /* 方形 / 碎片：需要各自旋转，逐个画（数量通常远少于圆形） */
    for (let i = 0; i < SB.length; i++) {
      const p = SB[i];
      const t = p.life / p.maxLife;
      const a = clamp(t, 0, 1);
      const s = p.shrink ? p.size * (0.25 + t * 0.75) : p.size;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.shape === 'square') {
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.55, s * 0.7);
        ctx.lineTo(-s * 0.55, s * 0.7);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  clear() {
    for (const p of this.items) this.pool.push(p);
    this.items.length = 0;
  }
}

/* -----------------------------------------------------------
   伤害飘字
   ----------------------------------------------------------- */
class DamageNumbers {
  constructor() { this.items = []; }

  add(x, y, value, opt) {
    opt = opt || {};
    this.items.push({
      x: x + rand(-7, 7),
      y: y - 10,
      vx: rand(-16, 16),
      vy: opt.vy !== undefined ? opt.vy : -64,
      life: opt.life || 0.72,
      maxLife: opt.life || 0.72,
      value: typeof value === 'number' ? Math.round(value) : value,
      crit: !!opt.crit,
      color: opt.color || (opt.crit ? '#ffd85e' : '#ffe9c0'),
      scale: opt.crit ? 1.55 : 1
    });
  }

  update(dt) {
    const arr = this.items;
    for (let i = arr.length - 1; i >= 0; i--) {
      const d = arr[i];
      d.life -= dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 78 * dt;      // 轻微下坠
      d.vx *= (1 - 1.6 * dt);
      if (d.life <= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); }
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of this.items) {
      const t = d.life / d.maxLife;
      const a = clamp(t * 1.6, 0, 1);
      const size = (d.crit ? 22 : 15) * (0.75 + 0.25 * t) * d.scale / (d.crit ? 1.55 : 1);
      ctx.globalAlpha = a;
      ctx.font = `800 ${d.crit ? 24 : 16}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      ctx.strokeText(d.value, d.x, d.y);
      ctx.fillStyle = d.color;
      ctx.fillText(d.value, d.x, d.y);
    }
    ctx.restore();
  }

  clear() { this.items.length = 0; }
}
