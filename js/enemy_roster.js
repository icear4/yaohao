/* ===========================================================
   enemy_roster.js — 扩充敌人图鉴（数据驱动注册）
   -----------------------------------------------------------
   本文件只做「追加」：不改动 enemy.js 中已有的灰噬体 / 棱目 / 锥锋 / 守望者。
   每只敌人都具备：
     · 独立 AI（各自的状态机）
     · 独立 HP / 移速 / 攻击方式 / 攻击冷却
     · 受伤反馈（基类统一：白闪 + 击退 + 火花 + 血条）
     · 死亡效果（基类统一：碎裂爆散，部分敌人有额外的死亡效果）
   新增一只敌人 = 写一个 class + 一条 EnemyFactory.register(...)
   =========================================================== */
'use strict';

/* -----------------------------------------------------------
   通用小工具（本文件内部使用）
   ----------------------------------------------------------- */

/* 把点夹到场地内，留 margin 边距 */
function arenaClamp(x, y, margin) {
  const m = margin || 24;
  return {
    x: clamp(x, ARENA.x + m, ARENA.x + ARENA.w - m),
    y: clamp(y, ARENA.y + m, ARENA.y + ARENA.h - m)
  };
}

/* 预警扇形（世界坐标已由调用方平移） */
function drawTelegraphArc(ctx, radius, halfAngle, progress, color) {
  ctx.save();
  ctx.globalAlpha = 0.14 + 0.30 * progress;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, -halfAngle, halfAngle);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.45 + 0.45 * progress;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/* 预警圆环（渐满） */
function drawTelegraphRing(ctx, radius, progress, color) {
  ctx.save();
  ctx.globalAlpha = 0.16 + 0.20 * progress;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.5 + 0.4 * progress;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 + 2 * progress;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.stroke();
  /* 内圈随进度收缩，读秒感 */
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.arc(0, 0, radius * (1 - progress), 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/* ===========================================================
   近战 · 跳跃：跃尘 Hopper
   蓄力屈身 → 高高跃起砸向玩家落点（落点有预警圈）→ 砸地范围伤害
   =========================================================== */
class Hopper extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '跃尘',
      r: 15,
      hp: 32,
      speed: 122,
      touchDamage: 8,
      touchInterval: 0.9,
      mass: 1,
      rng: rng,
      colors: ['#4d5c38', '#d8ff7a', '#a6d94f']
    });
    this.slamDamage = 14;
    this.slamRadius = 76;
    this.dmgFields = ['slamDamage'];
    this.state = 'hop';
    this.stateT = rng.range(0.25, 0.9);
    this.tx = x; this.ty = y;
    this.sx = x; this.sy = y;
    this.leapT = 0;
    this.leapDur = 0.4;
    this.squash = 0;
  }

  onUpdate(dt) {
    const p = this.game.player;

    if (this.state === 'hop') {
      this.stateT -= dt;
      const a = angleTo(this.x, this.y, p.x, p.y);
      this.face = angleLerp(this.face, a, Math.min(1, 6 * dt));
      const sp = this.speed * (this.stateT > 0 ? 1 : 0.25);
      this.vx = Math.cos(this.face) * sp;
      this.vy = Math.sin(this.face) * sp;
      this.tryTouchDamage(this.touchDamage);
      this.squash = 0;

      if (this.stateT <= 0) {
        const t = arenaClamp(p.x, p.y, this.slamRadius * 0.6);
        this.tx = t.x; this.ty = t.y;
        this.sx = this.x; this.sy = this.y;
        this.leapT = 0;
        this.leapDur = clamp(dist(this.x, this.y, this.tx, this.ty) / 640, 0.26, 0.62);
        this.state = 'leap';
      }
    } else if (this.state === 'leap') {
      this.leapT += dt;
      const t = clamp(this.leapT / this.leapDur, 0, 1);
      const rem = Math.max(0.0001, this.leapDur - this.leapT);
      this.vx = (this.tx - this.x) / rem;
      this.vy = (this.ty - this.y) / rem;
      this.face = Math.atan2(this.vy, this.vx);
      if (Math.random() < dt * 34) {
        this.game.particles.trail(this.x, this.y, 'rgba(216,255,122,0.30)', 6);
      }
      if (t >= 1) {
        this._slam();
        this.state = 'land';
        this.stateT = 0.42;
        this.vx = 0; this.vy = 0;
        this.squash = 1;
      }
    } else {
      this.stateT -= dt;
      this.vx *= 0.8; this.vy *= 0.8;
      this.squash = Math.max(0, this.squash - dt * 3);
      if (this.stateT <= 0) { this.state = 'hop'; this.stateT = this.rng.range(0.45, 1.15); }
    }
  }

  _slam() {
    const p = this.game.player;
    this.game.particles.ring(this.x, this.y, '#d8ff7a', 16, 250);
    this.game.particles.burst(this.x, this.y, 14, {
      speed: 220, life: 0.45, size: 4, colors: ['#d8ff7a', '#ffffff', this.colors[0]]
    });
    this.game.addShake(2.2);
    const reach = this.slamRadius + p.r;
    if (dist2(this.x, this.y, p.x, p.y) <= reach * reach) {
      p.takeDamage(this.dmgOut(this.slamDamage), this.x, this.y);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const crouch = this.state === 'hop' && this.stateT < 0.35 ? 0.78 : 1;
    const air = this.state === 'leap';
    const sq = this.squash;

    /* 起跳落点预警 */
    if (air) {
      ctx.save();
      drawTelegraphRing(ctx, this.slamRadius, clamp(this.leapT / this.leapDur, 0, 1), '#ff8a5c');
      ctx.restore();
    }

    /* 影子留在地面 */
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 6, this.r * (air ? 0.7 : 1), this.r * 0.5, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.rotate(this.face);

    /* 后腿（屈身时压缩） */
    ctx.strokeStyle = '#33401f';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const bend = air ? 1.25 : (crouch < 1 ? 0.55 : 0.95);
      ctx.beginPath();
      ctx.moveTo(-this.r * 0.3, s * this.r * 0.5);
      ctx.lineTo(-this.r * 0.95 * bend, s * this.r * 1.05 * bend);
      ctx.stroke();
    }

    /* 身体：椭圆 + 背纹 */
    ctx.scale(1 / Math.max(0.4, crouch) * (1 - sq * 0.18), crouch * (1 + sq * 0.2));
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 1.02, this.r * 0.88, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-this.r * 0.15, 0, this.r * 0.6, -1.0, 1.0);
    ctx.stroke();

    /* 头 / 眼 */
    ctx.fillStyle = '#e9ffb0';
    ctx.beginPath(); ctx.arc(this.r * 0.45, -this.r * 0.34, 3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.45, this.r * 0.34, 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1b2410';
    ctx.beginPath(); ctx.arc(this.r * 0.55, -this.r * 0.34, 1.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.55, this.r * 0.34, 1.5, 0, TAU); ctx.fill();

    /* 蓄力时的尘光 */
    if (crouch < 1) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 26);
      ctx.strokeStyle = '#d8ff7a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.35, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

/* ===========================================================
   近战 · 连击：啮喙 Gnasher
   疾冲贴身 → 三连撕咬（每咬一次小突进）→ 短暂喘息
   =========================================================== */
class Gnasher extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '啮喙',
      r: 15,
      hp: 42,
      speed: 138,
      touchDamage: 6,
      touchInterval: 0.55,
      mass: 1,
      rng: rng,
      colors: ['#5c3a32', '#ffb08a', '#ff7a4d']
    });
    this.biteDamage = 7;
    this.dmgFields = ['biteDamage'];
    this.state = 'chase';
    this.cd = rng.range(0.3, 1.0);
    this.biteLeft = 0;
    this.biteT = 0;
    this.jaw = 0;
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);

    if (this.state === 'chase') {
      this.cd -= dt;
      const a = angleTo(this.x, this.y, p.x, p.y) + Math.sin(this.animT * 6.5) * 0.34;
      this.face = angleLerp(this.face, a, Math.min(1, 9 * dt));
      this.vx = Math.cos(this.face) * this.speed;
      this.vy = Math.sin(this.face) * this.speed;
      this.tryTouchDamage(this.touchDamage);
      this.jaw = Math.max(0, this.jaw - dt * 4);
      if (d < 78 && this.cd <= 0) {
        this.state = 'combo';
        this.biteLeft = 3;
        this.biteT = 0;
      }
    } else if (this.state === 'combo') {
      this.biteT -= dt;
      const a = angleTo(this.x, this.y, p.x, p.y);
      this.face = angleLerp(this.face, a, Math.min(1, 12 * dt));
      if (this.biteT <= 0) {
        this.biteT = 0.16;
        this.biteLeft--;
        this.jaw = 1;
        const lunge = this.speed * 2.4;
        this.vx = Math.cos(this.face) * lunge;
        this.vy = Math.sin(this.face) * lunge;
        this.game.particles.burst(this.x + Math.cos(this.face) * this.r,
          this.y + Math.sin(this.face) * this.r, 4, {
            speed: 130, life: 0.22, size: 3, color: '#ffb08a', dir: this.face, spread: 1.3
          });
        if (dist(this.x, this.y, p.x, p.y) < this.r + p.r + 22) {
          p.takeDamage(this.dmgOut(this.biteDamage), this.x, this.y);
        }
        if (this.biteLeft <= 0) {
          this.state = 'rest';
          this.stateT = 0.55;
          this.cd = this.rng.range(1.4, 2.2);
        }
      } else {
        this.vx *= 0.72; this.vy *= 0.72;
      }
      this.jaw = Math.max(0, this.jaw - dt * 3);
    } else {
      this.stateT -= dt;
      this.vx *= 0.82; this.vy *= 0.82;
      if (this.stateT <= 0) this.state = 'chase';
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    ctx.save();
    ctx.rotate(this.face);

    /* 拖在身后的碎屑 */
    ctx.strokeStyle = '#3a241d';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * 0.5 + Math.sin(t * 8 + i) * 0.18;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.r * 0.5, Math.sin(a) * this.r * 0.5);
      ctx.lineTo(Math.cos(a) * (this.r + 9), Math.sin(a) * (this.r + 9));
      ctx.stroke();
    }

    /* 身体 */
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.ellipse(-this.r * 0.1, 0, this.r * 0.95, this.r * 0.8, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[2];
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 上下颚（张开时露出利齿） */
    const open = 0.2 + this.jaw * 0.72 + Math.sin(t * 5) * 0.06;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.rotate(s * open * 0.55);
      ctx.fillStyle = '#7a4436';
      ctx.beginPath();
      ctx.moveTo(this.r * 0.1, 0);
      ctx.lineTo(this.r * 1.25, s * this.r * 0.12);
      ctx.lineTo(this.r * 0.95, s * this.r * 0.42);
      ctx.closePath();
      ctx.fill();
      /* 利齿 */
      ctx.fillStyle = '#ffe6cf';
      for (let i = 0; i < 3; i++) {
        const px = this.r * (0.45 + i * 0.28);
        ctx.beginPath();
        ctx.moveTo(px, s * this.r * 0.12);
        ctx.lineTo(px + 3, s * this.r * 0.02);
        ctx.lineTo(px + 6, s * this.r * 0.12);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    /* 眼（连击时发红） */
    ctx.fillStyle = this.state === 'combo' ? '#ff3b30' : '#ffd0b0';
    ctx.beginPath(); ctx.arc(this.r * 0.05, -this.r * 0.42, 2.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.05, this.r * 0.42, 2.6, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ===========================================================
   近战 · 分裂：裂蜕 Slougher
   迟缓追击；死亡时蜕裂成两只幼虫（幼虫不再分裂）
   =========================================================== */
class Slougher extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '裂蜕',
      r: 20,
      hp: 52,
      speed: 78,
      touchDamage: 9,
      touchInterval: 0.9,
      mass: 1.6,
      rng: rng,
      colors: ['#2f5a52', '#7fffd8', '#39c9a8']
    });
    this.canSplit = true;
    this.wob = rng.range(0, TAU);
    this.seam = 0;
  }

  onUpdate(dt) {
    const p = this.game.player;
    this.wob += dt * 2.2;
    const a = angleTo(this.x, this.y, p.x, p.y) + Math.sin(this.wob) * 0.22;
    this.face = angleLerp(this.face, a, Math.min(1, 4 * dt));
    this.vx = Math.cos(this.face) * this.speed;
    this.vy = Math.sin(this.face) * this.speed;
    this.tryTouchDamage(this.touchDamage);
    /* 血量越低，蜕裂缝越明显 */
    this.seam = 1 - this.hp / this.maxHp;
  }

  /* 死亡效果：蜕裂出两只幼虫 */
  die() {
    if (this.dead) return;
    super.die();
    if (this.canSplit && this.game.room) {
      this.game.particles.ring(this.x, this.y, '#7fffd8', 18, 200);
      for (let i = 0; i < 2; i++) {
        this.game.room.pending.push({ type: 'sloughling', delay: 0.12 * i });
      }
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    ctx.save();
    ctx.rotate(this.face);
    /* 伪足 */
    ctx.strokeStyle = '#1d3b36';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.sin(t * 3 + i) * 0.2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.r * 0.4, Math.sin(a) * this.r * 0.4);
      ctx.lineTo(Math.cos(a) * (this.r + 8 + Math.sin(t * 6 + i * 2) * 3),
                 Math.sin(a) * (this.r + 8 + Math.sin(t * 6 + i * 2) * 3));
      ctx.stroke();
    }
    /* 胶质体 */
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 1.05, this.r * 0.95, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 蜕裂缝（血量越低越亮） */
    ctx.strokeStyle = '#7fffd8';
    ctx.globalAlpha = 0.35 + 0.6 * this.seam;
    ctx.lineWidth = 1.5 + 2 * this.seam;
    ctx.beginPath();
    ctx.moveTo(-this.r, 0);
    ctx.quadraticCurveTo(0, Math.sin(t * 2) * 6, this.r, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
    /* 内核（表示即将分裂的东西） */
    ctx.fillStyle = this.colors[2];
    ctx.beginPath(); ctx.arc(-this.r * 0.2, 0, 5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.3, -this.r * 0.2, 3.4, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* 幼虫：裂蜕分裂出来的小型追击者（不参与随机生成） */
class Sloughling extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '蜕幼虫',
      r: 11,
      hp: 15,
      speed: 176,
      touchDamage: 5,
      touchInterval: 0.7,
      mass: 0.6,
      rng: rng,
      colors: ['#2f5a52', '#7fffd8', '#39c9a8']
    });
    this.wob = rng.range(0, TAU);
  }
  onUpdate(dt) {
    const p = this.game.player;
    this.wob += dt * 7;
    const a = angleTo(this.x, this.y, p.x, p.y) + Math.sin(this.wob) * 0.3;
    this.face = angleLerp(this.face, a, Math.min(1, 10 * dt));
    this.vx = Math.cos(this.face) * this.speed;
    this.vy = Math.sin(this.face) * this.speed;
    this.tryTouchDamage(this.touchDamage);
  }
  onDraw(ctx) {
    ctx.save();
    ctx.rotate(this.face);
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 1.1, this.r * 0.85, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.fillStyle = this.colors[1];
    ctx.beginPath(); ctx.arc(this.r * 0.2, 0, 3, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ===========================================================
   近战 · 重击：崩岩 Brute
   缓慢逼近 → 抬臂蓄力（扇形预警）→ 砸地（前方扇形范围伤害 + 强击退）
   =========================================================== */
class Brute extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '崩岩',
      r: 24,
      hp: 96,
      speed: 72,
      touchDamage: 10,
      touchInterval: 1.0,
      mass: 3,
      rng: rng,
      colors: ['#3d3a4a', '#b9a7ff', '#7a5cff']
    });
    this.slamDamage = 20;
    this.slamRange = 108;
    this.slamHalf = 0.85;
    this.dmgFields = ['slamDamage'];
    this.state = 'walk';
    this.stateT = rng.range(0.4, 1.0);
    this.cd = 1.6;
    this.armT = 0;
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);

    if (this.state === 'walk') {
      this.cd -= dt;
      const a = angleTo(this.x, this.y, p.x, p.y);
      this.face = angleLerp(this.face, a, Math.min(1, 3 * dt));
      this.vx = Math.cos(this.face) * this.speed;
      this.vy = Math.sin(this.face) * this.speed;
      this.tryTouchDamage(this.touchDamage);
      this.armT = 0;
      if (this.cd <= 0 && d < this.slamRange + 60) {
        this.state = 'wind';
        this.stateT = 0.75;
      }
    } else if (this.state === 'wind') {
      this.stateT -= dt;
      this.vx *= 0.7; this.vy *= 0.7;
      this.face = angleLerp(this.face, angleTo(this.x, this.y, p.x, p.y), Math.min(1, 4 * dt));
      this.armT = 1 - this.stateT / 0.75;
      if (this.stateT <= 0) {
        this.state = 'slam';
        this.stateT = 0.22;
        this._slam();
      }
    } else if (this.state === 'slam') {
      this.stateT -= dt;
      this.vx *= 0.5; this.vy *= 0.5;
      this.armT = 1;
      if (this.stateT <= 0) { this.state = 'walk'; this.cd = this.rng.range(1.8, 2.6); }
    }
  }

  _slam() {
    const p = this.game.player;
    this.game.particles.ring(this.x, this.y, '#b9a7ff', 14, 300);
    this.game.particles.burst(
      this.x + Math.cos(this.face) * this.r, this.y + Math.sin(this.face) * this.r, 16,
      { speed: 240, life: 0.5, size: 5, colors: ['#b9a7ff', '#ffffff', this.colors[0]] }
    );
    this.game.addShake(3);
    const dd = dist(this.x, this.y, p.x, p.y);
    if (dd <= this.slamRange + p.r) {
      const pa = angleTo(this.x, this.y, p.x, p.y);
      if (Math.abs(angleDelta(this.face, pa)) <= this.slamHalf) {
        p.takeDamage(this.dmgOut(this.slamDamage), this.x, this.y);
      }
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const g = this.armT;

    /* 扇形预警 */
    if (this.state === 'wind') {
      ctx.save();
      ctx.rotate(this.face);
      drawTelegraphArc(ctx, this.slamRange, this.slamHalf, g, '#b9a7ff');
      ctx.restore();
    }

    ctx.save();
    ctx.rotate(this.face);

    /* 双腿 */
    ctx.fillStyle = '#2a2733';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(-this.r * 0.35, s * this.r * 0.62, this.r * 0.34, this.r * 0.26, 0, 0, TAU);
      ctx.fill();
    }

    /* 躯干（岩石块） */
    ctx.fillStyle = this.colors[0];
    polygonPath(ctx, [
      [-this.r * 0.9, -this.r * 0.85],
      [this.r * 0.7, -this.r * 0.7],
      [this.r * 0.95, 0],
      [this.r * 0.7, this.r * 0.7],
      [-this.r * 0.9, this.r * 0.85]
    ]);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2.2;
    ctx.stroke();

    /* 裂纹 */
    ctx.strokeStyle = 'rgba(185,167,255,0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-this.r * 0.5, -this.r * 0.3);
    ctx.lineTo(0, 0);
    ctx.lineTo(this.r * 0.35, this.r * 0.3);
    ctx.stroke();

    /* 举起的重臂（蓄力时抬高） */
    ctx.save();
    ctx.translate(this.r * 0.35, 0);
    ctx.rotate(-g * 1.1 + (this.state === 'slam' ? 1.4 : 0));
    ctx.fillStyle = '#4b4660';
    roundRectPath(ctx, -6, -this.r * 0.3, this.r * 1.25, this.r * 0.6, 6);
    ctx.fill();
    ctx.fillStyle = this.colors[2];
    ctx.beginPath();
    ctx.arc(this.r * 1.15, 0, this.r * 0.36, 0, TAU);
    ctx.fill();
    ctx.restore();

    /* 眼 */
    ctx.fillStyle = this.state === 'wind' ? '#ffd0ff' : '#8f7fd8';
    ctx.beginPath(); ctx.arc(this.r * 0.3, -this.r * 0.34, 3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.3, this.r * 0.34, 3, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ===========================================================
   近战 · 群体：蚀群 Swarmer
   极小的快速残形，成群出现，血量极低，走位飘忽
   =========================================================== */
class Swarmer extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '蚀群',
      r: 9,
      hp: 12,
      speed: 192,
      touchDamage: 4,
      touchInterval: 0.5,
      mass: 0.4,
      rng: rng,
      colors: ['#4a2a55', '#d68bff', '#9a4dd6']
    });
    this.wob = rng.range(0, TAU);
    this.wobSpeed = rng.range(6, 10);
  }

  onUpdate(dt) {
    const p = this.game.player;
    this.wob += dt * this.wobSpeed;
    const a = angleTo(this.x, this.y, p.x, p.y) + Math.sin(this.wob) * 0.55;
    this.face = angleLerp(this.face, a, Math.min(1, 12 * dt));
    this.vx = Math.cos(this.face) * this.speed;
    this.vy = Math.sin(this.face) * this.speed;
    this.tryTouchDamage(this.touchDamage);
  }

  onDraw(ctx) {
    const t = this.animT;
    ctx.save();
    ctx.rotate(this.face);
    /* 三条细腿 */
    ctx.strokeStyle = '#331d3d';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * 0.7 + Math.sin(t * 14 + i) * 0.3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * (this.r + 6), Math.sin(a) * (this.r + 6));
      ctx.stroke();
    }
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 1.05, this.r * 0.85, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = this.colors[1];
    ctx.beginPath(); ctx.arc(this.r * 0.35, 0, 2.4, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ===========================================================
   近战 · 反伤：刺壳 Spiker
   缓慢沉重的甲壳，受伤时向四周喷出尖刺
   =========================================================== */
class Spiker extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '刺壳',
      r: 19,
      hp: 70,
      speed: 66,
      touchDamage: 9,
      touchInterval: 0.9,
      mass: 2,
      rng: rng,
      colors: ['#2c3a48', '#9ec9e8', '#5a86ad']
    });
    this.dr = 0.22;                 // 天生硬壳
    this.spikeDamage = 7;
    this.dmgFields = ['spikeDamage'];
    this.spikeCd = 0;
    this.bristle = 0;
    this.roll = rng.range(0, TAU);
  }

  onUpdate(dt) {
    const p = this.game.player;
    if (this.spikeCd > 0) this.spikeCd -= dt;
    this.bristle = Math.max(0, this.bristle - dt * 2);
    this.roll += dt * 0.8;
    const a = angleTo(this.x, this.y, p.x, p.y);
    this.face = angleLerp(this.face, a, Math.min(1, 3.5 * dt));
    this.vx = Math.cos(this.face) * this.speed;
    this.vy = Math.sin(this.face) * this.speed;
    this.tryTouchDamage(this.touchDamage);
  }

  takeDamage(amount, srcX, srcY) {
    const before = this.hp;
    super.takeDamage(amount, srcX, srcY);
    if (this.dead || this.hp === before) return;
    /* 受伤反馈：炸开一圈尖刺（有冷却，不会刷屏） */
    if (this.spikeCd <= 0) {
      this.spikeCd = 1.1;
      this.bristle = 1;
      const n = 5;
      const base = this.rng.range(0, TAU);
      for (let i = 0; i < n; i++) {
        this.fireBullet(base + (i / n) * TAU, {
          speed: 300, damage: this.dmgOut(this.spikeDamage), r: 4.5,
          color: '#9ec9e8', core: '#ffffff', life: 1.1, spin: 12
        });
      }
      this.game.particles.ring(this.x, this.y, '#9ec9e8', 10, 190);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    ctx.save();
    ctx.rotate(this.roll);
    /* 甲壳刺（受击后竖起） */
    const len = this.r + 6 + this.bristle * 9;
    ctx.strokeStyle = '#8fb6cf';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.r * 0.75, Math.sin(a) * this.r * 0.75);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }
    /* 壳体 */
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.92, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2.4;
    ctx.stroke();
    /* 内层甲片 */
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, this.r * (0.3 + i * 0.22), 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = this.bristle > 0 ? '#ffd0a0' : '#5a86ad';
    ctx.beginPath(); ctx.arc(0, 0, this.r * 0.24, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ===========================================================
   远程 · 单发：准瞳 Marksman
   远距离保持，长时间激光瞄准线（可躲），然后射出一发高速弹
   =========================================================== */
class Marksman extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '准瞳',
      r: 17,
      hp: 30,
      speed: 104,
      touchDamage: 5,
      touchInterval: 1.0,
      mass: 0.9,
      rng: rng,
      colors: ['#3b3350', '#ffe066', '#ffb347']
    });
    this.bulletDamage = 15;
    this.dmgFields = ['bulletDamage'];
    this.keepMin = 330;
    this.keepMax = 560;
    this.state = 'idle';
    this.stateT = rng.range(0.5, 1.4);
    this.cd = rng.range(0.8, 1.6);
    this.aimA = 0;
    this.aimT = 0;
    this.aimDur = 1.05;
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const toP = angleTo(this.x, this.y, p.x, p.y);
    this.face = angleLerp(this.face, toP, Math.min(1, 5 * dt));

    /* 距离控制：太近后撤，太远靠近 */
    let mx = 0, my = 0;
    if (d < this.keepMin) { mx = -Math.cos(toP); my = -Math.sin(toP); }
    else if (d > this.keepMax) { mx = Math.cos(toP); my = Math.sin(toP); }
    else {
      mx = Math.cos(toP + Math.PI / 2) * Math.sin(this.animT * 0.9);
      my = Math.sin(toP + Math.PI / 2) * Math.sin(this.animT * 0.9);
    }
    const len = Math.hypot(mx, my) || 1;
    const sp = this.speed * (this.state === 'aim' ? 0.25 : 1);
    this.vx = (mx / len) * sp;
    this.vy = (my / len) * sp;

    if (this.state === 'idle') {
      this.cd -= dt;
      if (this.cd <= 0 && d < 640) {
        this.state = 'aim';
        this.aimT = 0;
        this.aimA = toP;
      }
    } else if (this.state === 'aim') {
      this.aimT += dt;
      /* 瞄准线缓慢跟枪：玩家跑动即可甩掉 */
      this.aimA = angleLerp(this.aimA, toP, Math.min(1, 2.2 * dt));
      if (this.aimT >= this.aimDur) {
        this.fireBullet(this.aimA, {
          speed: 620, damage: this.dmgOut(this.bulletDamage), r: 5,
          color: '#ffe066', core: '#ffffff', life: 1.6, spin: 16
        });
        this.game.particles.burst(
          this.x + Math.cos(this.aimA) * this.r, this.y + Math.sin(this.aimA) * this.r, 6,
          { speed: 150, life: 0.28, size: 3, color: '#ffe066', dir: this.aimA, spread: 1.0 }
        );
        this.state = 'idle';
        this.cd = this.rng.range(1.9, 2.8);
      }
    }
    this.tryTouchDamage(this.touchDamage);
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 瞄准线（细 → 粗，最后一刻收束） */
    if (this.state === 'aim') {
      const g = clamp(this.aimT / this.aimDur, 0, 1);
      ctx.save();
      ctx.rotate(this.aimA);
      ctx.globalAlpha = 0.20 + 0.55 * g;
      ctx.strokeStyle = g > 0.85 ? '#ffffff' : '#ff8a5c';
      ctx.lineWidth = 0.8 + 2.4 * g;
      ctx.setLineDash([18, 12]);
      ctx.lineDashOffset = -t * 90;
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(this.r + 700, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.save();
    /* 三脚支架 */
    ctx.strokeStyle = '#2a2438';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + t * 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.r * 0.4, Math.sin(a) * this.r * 0.4);
      ctx.lineTo(Math.cos(a) * (this.r + 10), Math.sin(a) * (this.r + 10));
      ctx.stroke();
    }
    ctx.rotate(this.face);
    /* 机体 */
    ctx.fillStyle = this.colors[0];
    polygonPath(ctx, [
      [this.r * 0.9, 0],
      [-this.r * 0.5, -this.r * 0.85],
      [-this.r * 0.85, 0],
      [-this.r * 0.5, this.r * 0.85]
    ]);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 单眼镜头 */
    ctx.fillStyle = '#1a1626';
    ctx.beginPath(); ctx.arc(this.r * 0.18, 0, this.r * 0.52, 0, TAU); ctx.fill();
    ctx.fillStyle = this.state === 'aim' ? '#ff5a4d' : '#ffe066';
    ctx.beginPath(); ctx.arc(this.r * 0.18, 0, this.r * 0.34, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = this.state === 'aim' ? 0.9 : 0.35;
    ctx.beginPath(); ctx.arc(this.r * 0.26, 0, this.r * 0.14, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/* ===========================================================
   远程 · 环形弹幕：环律 Ringer
   悬停蓄能，然后放出一圈弹幕 —— 但永远留出一道缺口（必定可躲）
   =========================================================== */
class Ringer extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '环律',
      r: 19,
      hp: 44,
      speed: 74,
      touchDamage: 6,
      touchInterval: 1.0,
      mass: 1.2,
      rng: rng,
      colors: ['#46305c', '#ff9de0', '#c86bff']
    });
    this.bulletDamage = 8;
    this.dmgFields = ['bulletDamage'];
    this.state = 'hover';
    this.stateT = rng.range(0.4, 1.2);
    this.charge = 0;
    this.chargeDur = 0.95;
    this.cd = rng.range(1.0, 1.8);
    this.orbit = rng.range(0, TAU);
    this.gapStart = 0;
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const toP = angleTo(this.x, this.y, p.x, p.y);
    this.orbit += dt * 1.6;

    /* 维持中距（280~430） */
    let mx = 0, my = 0;
    if (d < 280) { mx = -Math.cos(toP); my = -Math.sin(toP); }
    else if (d > 430) { mx = Math.cos(toP); my = Math.sin(toP); }
    else {
      mx = Math.cos(toP + Math.PI / 2) * Math.sin(this.animT * 0.7);
      my = Math.sin(toP + Math.PI / 2) * Math.sin(this.animT * 0.7);
    }
    const len = Math.hypot(mx, my) || 1;
    const sp = this.speed * (this.state === 'charge' ? 0.3 : 1);
    this.vx = (mx / len) * sp;
    this.vy = (my / len) * sp;
    this.face = angleLerp(this.face, toP, Math.min(1, 4 * dt));

    if (this.state === 'hover') {
      this.cd -= dt;
      if (this.cd <= 0 && d < 560) {
        this.state = 'charge';
        this.charge = 0;
        /* 缺口位置随机：玩家必须找缺口，而不是站原地 */
        this.gapStart = this.rng.int(0, 11);
      }
    } else if (this.state === 'charge') {
      this.charge += dt;
      if (this.charge >= this.chargeDur) {
        this._ring();
        this.state = 'hover';
        this.cd = this.rng.range(2.6, 3.6);
      }
    }
    this.tryTouchDamage(this.touchDamage);
  }

  /* 12 发环形弹幕，连续 3 发留空 → 永远有缺口 */
  _ring() {
    const N = 12, GAP = 3;
    const base = this.animT * 0.7;
    for (let i = 0; i < N; i++) {
      let hole = false;
      for (let k = 0; k < GAP; k++) if ((this.gapStart + k) % N === i) hole = true;
      if (hole) continue;
      const a = base + (i / N) * TAU;
      this.fireBullet(a, {
        speed: 205, damage: this.dmgOut(this.bulletDamage), r: 6.5,
        color: '#ff9de0', core: '#ffe0f5', life: 4.0, spin: 5
      });
    }
    this.game.particles.ring(this.x, this.y, '#ff9de0', 14, 240);
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 环绕的律点 */
    for (let i = 0; i < 4; i++) {
      const a = this.orbit + (i / 4) * TAU;
      const rr = this.r + 12;
      ctx.fillStyle = this.colors[1];
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.6, 3.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    /* 蓄能：先画出缺口环（让玩家提前看到逃生口） */
    if (this.state === 'charge') {
      const g = clamp(this.charge / this.chargeDur, 0, 1);
      const N = 12, GAP = 3;
      const base = this.animT * 0.7;
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.5 * g;
      ctx.strokeStyle = '#ff9de0';
      ctx.lineWidth = 2;
      for (let i = 0; i < N; i++) {
        let hole = false;
        for (let k = 0; k < GAP; k++) if ((this.gapStart + k) % N === i) hole = true;
        if (hole) continue;
        const a = base + (i / N) * TAU;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * this.r * 1.6, Math.sin(a) * this.r * 1.6, 3 * (0.5 + g), 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * (1.15 + 0.5 * (1 - g)), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    /* 主体：悬浮的环 */
    ctx.save();
    ctx.rotate(this.orbit * 0.5);
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.78, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.78, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = this.colors[2];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.48, 0.4, 0.4 + Math.PI * 1.2);
    ctx.stroke();
    /* 中心核 */
    ctx.fillStyle = this.state === 'charge' ? '#ffffff' : '#ff9de0';
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.26 * (this.state === 'charge' ? 1 + 0.3 * Math.sin(t * 24) : 1), 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/* ===========================================================
   远程 · 扇形弹幕：扇喙 Fanner
   正面扇形 5 发，蓄力时显示扇区（走位或绕背即可躲）
   =========================================================== */
class Fanner extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '扇喙',
      r: 18,
      hp: 36,
      speed: 96,
      touchDamage: 6,
      touchInterval: 0.9,
      mass: 1,
      rng: rng,
      colors: ['#5a3f22', '#ffc46b', '#ff7a3c']
    });
    this.bulletDamage = 7;
    this.dmgFields = ['bulletDamage'];
    this.half = 0.52;          // 扇形半角（总约 60°）
    this.shots = 5;
    this.state = 'idle';
    this.cd = rng.range(0.6, 1.4);
    this.aimT = 0;
    this.aimDur = 0.7;
    this.aimA = 0;
    this.keepMin = 200;
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const toP = angleTo(this.x, this.y, p.x, p.y);

    let mx = 0, my = 0;
    if (d < this.keepMin) { mx = -Math.cos(toP); my = -Math.sin(toP); }
    else if (d > 420) { mx = Math.cos(toP); my = Math.sin(toP); }
    else {
      mx = Math.cos(toP + Math.PI / 2) * Math.sin(this.animT * 1.1);
      my = Math.sin(toP + Math.PI / 2) * Math.sin(this.animT * 1.1);
    }
    const len = Math.hypot(mx, my) || 1;
    const sp = this.speed * (this.state === 'aim' ? 0.35 : 1);
    this.vx = (mx / len) * sp;
    this.vy = (my / len) * sp;
    this.face = angleLerp(this.face, toP, Math.min(1, 5 * dt));

    if (this.state === 'idle') {
      this.cd -= dt;
      if (this.cd <= 0 && d < 520) { this.state = 'aim'; this.aimT = 0; this.aimA = toP; }
    } else {
      this.aimT += dt;
      this.aimA = angleLerp(this.aimA, toP, Math.min(1, 3.2 * dt));
      if (this.aimT >= this.aimDur) {
        const n = this.shots;
        for (let i = 0; i < n; i++) {
          const a = this.aimA + (i - (n - 1) / 2) * (this.half * 2 / (n - 1));
          this.fireBullet(a, {
            speed: 300, damage: this.dmgOut(this.bulletDamage), r: 5.5,
            color: '#ffc46b', core: '#fff3d0', life: 2.6, spin: 8
          });
        }
        this.game.particles.burst(
          this.x + Math.cos(this.aimA) * this.r, this.y + Math.sin(this.aimA) * this.r, 8,
          { speed: 180, life: 0.3, size: 3.4, color: '#ffc46b', dir: this.aimA, spread: this.half * 2 }
        );
        this.state = 'idle';
        this.cd = this.rng.range(1.8, 2.6);
      }
    }
    this.tryTouchDamage(this.touchDamage);
  }

  onDraw(ctx) {
    const t = this.animT;
    if (this.state === 'aim') {
      const g = clamp(this.aimT / this.aimDur, 0, 1);
      ctx.save();
      ctx.rotate(this.aimA);
      drawTelegraphArc(ctx, 260, this.half, g, '#ffc46b');
      ctx.restore();
    }
    ctx.save();
    ctx.rotate(this.face);
    /* 扇形尾鳍 */
    ctx.fillStyle = this.colors[0];
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-this.r * 0.6, s * this.r * 0.3);
      ctx.quadraticCurveTo(-this.r * 0.2, s * this.r * 1.3, this.r * 0.5, s * this.r * 0.95);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = this.colors[1];
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    /* 楔形喙 */
    ctx.fillStyle = this.colors[0];
    polygonPath(ctx, [
      [this.r * 1.3, 0],
      [-this.r * 0.7, -this.r * 0.8],
      [-this.r * 0.9, 0],
      [-this.r * 0.7, this.r * 0.8]
    ]);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 喙口（蓄力时张开） */
    const open = this.state === 'aim' ? 0.6 : 0.25;
    ctx.fillStyle = '#2a1a0d';
    ctx.beginPath();
    ctx.moveTo(this.r * 0.7, 0);
    ctx.arc(this.r * 0.7, 0, this.r * 0.7, -open, open);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = this.state === 'aim' ? '#fff3d0' : '#ff7a3c';
    ctx.beginPath(); ctx.arc(this.r * 0.35, 0, this.r * 0.24, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ===========================================================
   远程 · 抛射：曲射囊 Lobber
   抛出一个慢速落点弹（落点提前显示预警圈），到点后爆开
   =========================================================== */
class Lobber extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '曲射囊',
      r: 18,
      hp: 40,
      speed: 88,
      touchDamage: 6,
      touchInterval: 1.0,
      mass: 1.2,
      rng: rng,
      colors: ['#2f4a3a', '#9ad14f', '#c8ff6a']
    });
    this.blastDamage = 16;
    this.blastRadius = 88;
    this.dmgFields = ['blastDamage'];
    this.cd = rng.range(0.8, 1.6);
    this.marks = [];               // {x, y, t, dur, r, dmg}
    this.keepMin = 240;
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const toP = angleTo(this.x, this.y, p.x, p.y);

    let mx = 0, my = 0;
    if (d < this.keepMin) { mx = -Math.cos(toP); my = -Math.sin(toP); }
    else if (d > 460) { mx = Math.cos(toP); my = Math.sin(toP); }
    else { mx = Math.cos(toP + Math.PI / 2) * Math.sin(this.animT * 0.8); my = Math.sin(toP + Math.PI / 2) * Math.sin(this.animT * 0.8); }
    const len = Math.hypot(mx, my) || 1;
    this.vx = (mx / len) * this.speed;
    this.vy = (my / len) * this.speed;
    this.face = angleLerp(this.face, toP, Math.min(1, 3.5 * dt));

    this.cd -= dt;
    if (this.cd <= 0 && d < 620) {
      this.cd = this.rng.range(2.4, 3.4);
      /* 落点 = 玩家当前位置（不预判，保证玩家走开就能躲） */
      const t = arenaClamp(p.x, p.y, this.blastRadius * 0.5);
      const flight = clamp(dist(this.x, this.y, t.x, t.y) / 420, 0.7, 1.5);
      this.marks.push({
        x: t.x, y: t.y, t: 0, dur: flight, r: this.blastRadius, dmg: this.dmgOut(this.blastDamage)
      });
    }

    /* 落点结算 */
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.t += dt;
      if (m.t >= m.dur) {
        this._blast(m);
        this.marks.splice(i, 1);
      }
    }
    this.tryTouchDamage(this.touchDamage);
  }

  _blast(m) {
    this.game.particles.ring(m.x, m.y, '#9ad14f', 16, m.r * 3);
    this.game.particles.burst(m.x, m.y, 16, {
      speed: 240, life: 0.5, size: 5, colors: ['#9ad14f', '#ffffff', this.colors[0]]
    });
    this.game.addShake(1.8);
    const p = this.game.player;
    const reach = m.r + p.r;
    if (dist2(m.x, m.y, p.x, p.y) <= reach * reach) {
      p.takeDamage(m.dmg, m.x, m.y);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 落点预警（世界坐标 → 局部坐标） */
    for (const m of this.marks) {
      ctx.save();
      ctx.translate(m.x - this.x, m.y - this.y);
      drawTelegraphRing(ctx, m.r, clamp(m.t / m.dur, 0, 1), '#9ad14f');
      ctx.restore();
    }
    ctx.save();
    ctx.rotate(this.face);
    /* 囊袋（充能时鼓起） */
    const puff = 1 + 0.12 * Math.sin(t * 3);
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.ellipse(-this.r * 0.2, 0, this.r * 0.95 * puff, this.r * 0.9 * puff, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 悬挂的弹囊 */
    ctx.fillStyle = this.colors[2];
    ctx.beginPath();
    ctx.arc(this.r * 0.5, this.r * 0.15, this.r * 0.42, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    /* 短足 */
    ctx.strokeStyle = '#1e3327';
    ctx.lineWidth = 3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-this.r * 0.4, s * this.r * 0.5);
      ctx.lineTo(-this.r * 0.95, s * this.r * 1.05);
      ctx.stroke();
    }
    ctx.fillStyle = '#e8ffb0';
    ctx.beginPath(); ctx.arc(this.r * 0.15, -this.r * 0.35, 2.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.15, this.r * 0.35, 2.4, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ===========================================================
   远程 · 追踪弹：曳光 Wisp
   射出慢速追踪弹（转向速率受限，跑起来就能甩掉）
   =========================================================== */
class Wisp extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '曳光',
      r: 14,
      hp: 26,
      speed: 112,
      touchDamage: 4,
      touchInterval: 1.0,
      mass: 0.7,
      rng: rng,
      colors: ['#2a3f5c', '#7fe4ff', '#4fb0ff']
    });
    this.bulletDamage = 6;
    this.dmgFields = ['bulletDamage'];
    this.cd = rng.range(0.6, 1.4);
    this.phase = rng.range(0, TAU);
    this.keepMin = 260;
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const toP = angleTo(this.x, this.y, p.x, p.y);
    this.phase += dt * 3;

    /* 飘忽绕行 */
    const orbitA = toP + Math.PI / 2 * Math.sin(this.animT * 0.8);
    let mx, my;
    if (d < this.keepMin) { mx = -Math.cos(toP); my = -Math.sin(toP); }
    else { mx = Math.cos(orbitA); my = Math.sin(orbitA); }
    const len = Math.hypot(mx, my) || 1;
    this.vx = (mx / len) * this.speed;
    this.vy = (my / len) * this.speed;
    this.face = angleLerp(this.face, toP, Math.min(1, 4 * dt));

    this.cd -= dt;
    if (this.cd <= 0 && d < 560) {
      this.cd = this.rng.range(1.6, 2.4);
      const a = toP + this.rng.range(-0.35, 0.35);
      this.fireBullet(a, {
        speed: 176, damage: this.dmgOut(this.bulletDamage), r: 6,
        color: '#7fe4ff', core: '#ffffff', life: 3.4, homing: 1
      });
    }
    if (Math.random() < dt * 12) {
      this.game.particles.trail(this.x, this.y, 'rgba(127,228,255,0.28)', 4);
    }
    this.tryTouchDamage(this.touchDamage);
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 光晕 */
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, this.r * 2);
    g.addColorStop(0, 'rgba(127,228,255,0.35)');
    g.addColorStop(1, 'rgba(127,228,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 2, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.rotate(this.phase * 0.4);
    /* 飘带 */
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = 0.7;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a) * this.r, Math.sin(a) * this.r,
        Math.cos(a + 0.7) * (this.r + 12 + Math.sin(t * 5 + i) * 4),
        Math.sin(a + 0.7) * (this.r + 12 + Math.sin(t * 5 + i) * 4));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.72, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#eaffff';
    ctx.beginPath();
    ctx.arc(Math.cos(this.face) * 2.5, Math.sin(this.face) * 2.5, this.r * 0.3, 0, TAU);
    ctx.fill();
  }
}

/* ===========================================================
   远程 · 固定炮台：铸哨 Turret
   不会移动，护甲偏高，间歇打出三连点射
   =========================================================== */
class Turret extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '铸哨',
      r: 20,
      hp: 74,
      speed: 0,
      touchDamage: 8,
      touchInterval: 1.2,
      mass: 4,
      rng: rng,
      colors: ['#333a44', '#ffd35e', '#8fa3b5']
    });
    this.dr = 0.15;
    this.bulletDamage = 7;
    this.dmgFields = ['bulletDamage'];
    this.cd = rng.range(0.8, 1.6);
    this.burstLeft = 0;
    this.burstT = 0;
    this.barrel = rng.range(0, TAU);
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    this.vx = 0; this.vy = 0;
    const toP = angleTo(this.x, this.y, p.x, p.y);
    this.face = angleLerp(this.face, toP, Math.min(1, 3.4 * dt));
    this.barrel += dt * (this.burstLeft > 0 ? 9 : 0.8);

    if (this.burstLeft > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.burstT = 0.13;
        this.burstLeft--;
        this.fireBullet(this.face + this.rng.range(-0.06, 0.06), {
          speed: 330, damage: this.dmgOut(this.bulletDamage), r: 5.5,
          color: '#ffd35e', core: '#fff6da', life: 2.4
        });
        this.game.particles.burst(
          this.x + Math.cos(this.face) * this.r, this.y + Math.sin(this.face) * this.r, 4,
          { speed: 130, life: 0.22, size: 3, color: '#ffd35e', dir: this.face, spread: 0.9 }
        );
      }
    } else {
      this.cd -= dt;
      if (this.cd <= 0 && d < 620) {
        this.burstLeft = 3;
        this.burstT = 0;
        this.cd = this.rng.range(2.0, 2.8);
      }
    }
    this.tryTouchDamage(this.touchDamage);
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 底座 */
    ctx.fillStyle = '#20262e';
    polygonPath(ctx, (() => {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.5;
        pts.push([Math.cos(a) * this.r * 1.22, Math.sin(a) * this.r * 1.22]);
      }
      return pts;
    })());
    ctx.fill();
    ctx.strokeStyle = this.colors[2];
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 炮塔 */
    ctx.save();
    ctx.rotate(this.face);
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.82, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2.2;
    ctx.stroke();

    /* 炮管 */
    ctx.fillStyle = '#141a20';
    roundRectPath(ctx, this.r * 0.3, -4.5, this.r * 1.15, 9, 3);
    ctx.fill();
    ctx.fillStyle = this.burstLeft > 0 ? '#fff6da' : '#ffd35e';
    roundRectPath(ctx, this.r * 1.3, -2.4, 5, 4.8, 2);
    ctx.fill();
    ctx.restore();

    /* 旋转的哨环 */
    ctx.save();
    ctx.rotate(this.barrel);
    ctx.strokeStyle = 'rgba(255,211,94,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.35, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    /* 待机指示灯 */
    ctx.fillStyle = this.cd < 0.4 ? '#ff5a4d' : '#8fa3b5';
    ctx.beginPath();
    ctx.arc(0, -this.r * 0.95, 3 + (this.cd < 0.4 ? 1.5 * Math.sin(t * 22) : 0), 0, TAU);
    ctx.fill();
  }
}

/* ===========================================================
   特殊 · 召唤：织卵 Summoner
   远离玩家，周期性孵化蚀群（场上同类数量有上限）
   =========================================================== */
class Summoner extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '织卵',
      r: 21,
      hp: 58,
      speed: 84,
      touchDamage: 6,
      touchInterval: 1.0,
      mass: 1.4,
      rng: rng,
      colors: ['#3c2a4a', '#c86bff', '#7f3fd6']
    });
    this.cd = rng.range(1.2, 2.0);
    this.hatchT = 0;
    this.hatching = false;
    this.maxMinions = 5;
    this.legPhase = rng.range(0, TAU);
  }

  _minionCount() {
    const list = this.game.room ? this.game.room.enemies : [];
    let n = 0;
    for (const e of list) if (!e.dead && e.type === 'swarmer') n++;
    return n + (this.game.room ? this.game.room.pending.filter(q => q.type === 'swarmer').length : 0);
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const toP = angleTo(this.x, this.y, p.x, p.y);
    this.legPhase += dt * 4;

    /* 始终保持距离 */
    let mx = 0, my = 0;
    if (d < 300) { mx = -Math.cos(toP); my = -Math.sin(toP); }
    else if (d > 480) { mx = Math.cos(toP) * 0.4; my = Math.sin(toP) * 0.4; }
    else { mx = Math.cos(toP + Math.PI / 2) * 0.5; my = Math.sin(toP + Math.PI / 2) * 0.5; }
    const len = Math.hypot(mx, my) || 1;
    const sp = this.speed * (this.hatching ? 0.35 : 1);
    this.vx = (mx / len) * sp;
    this.vy = (my / len) * sp;
    this.face = angleLerp(this.face, toP, Math.min(1, 3 * dt));

    if (this.hatching) {
      this.hatchT -= dt;
      if (this.hatchT <= 0) {
        this.hatching = false;
        this.cd = this.rng.range(3.2, 4.4);
        const room = this.game.room;
        const n = Math.min(2, this.maxMinions - this._minionCount());
        for (let i = 0; i < n; i++) {
          if (room) room.pending.push({ type: 'swarmer', delay: 0.14 * i });
        }
        this.game.particles.ring(this.x, this.y, '#c86bff', 12, 200);
      }
    } else {
      this.cd -= dt;
      if (this.cd <= 0 && this._minionCount() < this.maxMinions) {
        this.hatching = true;
        this.hatchT = 0.9;
      }
    }
    this.tryTouchDamage(this.touchDamage);
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 蜘蛛腿 */
    ctx.strokeStyle = '#2a1d33';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.sin(this.legPhase + i) * 0.12;
      const mid = this.r * 0.9, tip = this.r + 14;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.r * 0.4, Math.sin(a) * this.r * 0.4);
      ctx.quadraticCurveTo(
        Math.cos(a + 0.3) * mid, Math.sin(a + 0.3) * mid,
        Math.cos(a + 0.15) * tip, Math.sin(a + 0.15) * tip
      );
      ctx.stroke();
    }
    /* 卵囊（孵化时鼓动） */
    const pulse = this.hatching ? 1 + 0.16 * Math.sin(t * 18) : 1 + 0.05 * Math.sin(t * 2.5);
    ctx.save();
    ctx.scale(pulse, pulse);
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.ellipse(-this.r * 0.1, 0, this.r * 0.95, this.r * 0.88, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 卵粒 */
    ctx.fillStyle = this.colors[2];
    for (let i = 0; i < 4; i++) {
      const a = t * 0.6 + (i / 4) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * this.r * 0.4, Math.sin(a) * this.r * 0.4, 3.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    /* 眼 */
    ctx.fillStyle = this.hatching ? '#ffe0ff' : '#c86bff';
    ctx.beginPath(); ctx.arc(this.r * 0.35, -this.r * 0.3, 2.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.35, this.r * 0.3, 2.6, 0, TAU); ctx.fill();
  }
}

/* ===========================================================
   特殊 · 隐身：潜影 Phantom
   显形追击 → 潜行（半透明、加速、不可被锁定）→ 贴近后突袭
   =========================================================== */
class Phantom extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '潜影',
      r: 17,
      hp: 34,
      speed: 132,
      touchDamage: 6,
      touchInterval: 1.0,
      mass: 0.9,
      rng: rng,
      colors: ['#1e2a3a', '#a8c4ff', '#5f7fc0']
    });
    this.strikeDamage = 17;
    this.dmgFields = ['strikeDamage'];
    this.state = 'stalk';
    this.stateT = rng.range(1.0, 1.8);
    this.veil = 0;                 // 0 显形 · 1 完全潜行
    this.drift = rng.range(0, TAU);
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    this.drift += dt * 2.2;

    if (this.state === 'stalk') {
      this.stateT -= dt;
      this.veil = Math.max(0, this.veil - dt * 3);
      const a = angleTo(this.x, this.y, p.x, p.y) + Math.sin(this.drift) * 0.4;
      this.face = angleLerp(this.face, a, Math.min(1, 6 * dt));
      this.vx = Math.cos(this.face) * this.speed;
      this.vy = Math.sin(this.face) * this.speed;
      this.tryTouchDamage(this.touchDamage);
      if (this.stateT <= 0) { this.state = 'veil'; this.stateT = this.rng.range(1.8, 2.8); }
    } else if (this.state === 'veil') {
      this.stateT -= dt;
      this.veil = Math.min(1, this.veil + dt * 2.2);
      /* 潜行期：绕着玩家兜圈子保持一个身位，不急着贴脸 */
      const toP = angleTo(this.x, this.y, p.x, p.y);
      const orbit = toP + Math.PI / 2 * 0.85;
      let mx, my;
      if (d > 230) { mx = Math.cos(toP); my = Math.sin(toP); }
      else if (d < 150) { mx = -Math.cos(toP); my = -Math.sin(toP); }
      else { mx = Math.cos(orbit); my = Math.sin(orbit); }
      const len = Math.hypot(mx, my) || 1;
      const sp = this.speed * 1.35;
      this.vx = (mx / len) * sp;
      this.vy = (my / len) * sp;
      this.face = angleLerp(this.face, toP, Math.min(1, 5 * dt));
      if (Math.random() < dt * 16) {
        this.game.particles.trail(this.x, this.y, 'rgba(168,196,255,0.22)', 5);
      }
      /* 潜行走完才突袭（保证有一段真正的隐身期） */
      if (this.stateT <= 0) {
        this.state = 'strike';
        this.stateT = 0.32;
        this.face = angleTo(this.x, this.y, p.x, p.y);
      }
    } else {
      this.stateT -= dt;
      this.veil = Math.max(0, this.veil - dt * 6);
      const sp = this.speed * 3.2;
      this.vx = Math.cos(this.face) * sp;
      this.vy = Math.sin(this.face) * sp;
      if (this.stateT > 0.16 && dist(this.x, this.y, p.x, p.y) < this.r + p.r + 26) {
        p.takeDamage(this.dmgOut(this.strikeDamage), this.x, this.y);
        this.stateT = Math.min(this.stateT, 0.15);
        this.game.particles.burst(this.x, this.y, 10, {
          speed: 190, life: 0.35, size: 4, colors: ['#a8c4ff', '#ffffff', this.colors[2]]
        });
      }
      if (this.stateT <= 0) { this.state = 'stalk'; this.stateT = this.rng.range(0.8, 1.4); }
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 潜行：整体变淡，只留轮廓与眼 */
    ctx.save();
    ctx.globalAlpha = 1 - this.veil * 0.82;

    ctx.rotate(this.face);
    /* 斗篷状轮廓 */
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.moveTo(this.r * 1.2, 0);
    ctx.quadraticCurveTo(0, -this.r * 1.15, -this.r * 1.0, -this.r * 0.5);
    ctx.quadraticCurveTo(-this.r * 0.5, 0, -this.r * 1.0, this.r * 0.5);
    ctx.quadraticCurveTo(0, this.r * 1.15, this.r * 1.2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 兜帽下的双眼 */
    ctx.fillStyle = this.state === 'veil' ? '#ff6b6b' : '#dce8ff';
    ctx.beginPath(); ctx.arc(this.r * 0.45, -this.r * 0.28, 2.8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.45, this.r * 0.28, 2.8, 0, TAU); ctx.fill();
    ctx.restore();

    /* 潜行时额外画一层可辨认的轮廓（不至于完全看不见） */
    if (this.veil > 0.2) {
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.10 * Math.sin(t * 6);
      ctx.strokeStyle = '#a8c4ff';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.15, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
}

/* ===========================================================
   特殊 · 自爆：胀囊 Bomber
   贴近后进入倒计时（鼓胀 + 预警环），到点自爆；提前击杀也会炸
   =========================================================== */
class Bomber extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '胀囊',
      r: 17,
      hp: 28,
      speed: 128,
      touchDamage: 5,
      touchInterval: 1.0,
      mass: 0.9,
      rng: rng,
      colors: ['#5c2222', '#ff8a5c', '#ff3b30']
    });
    this.blastDamage = 20;
    this.blastRadius = 104;
    this.dmgFields = ['blastDamage'];
    this.fuse = -1;                // <0 未点火
    this.fuseDur = 1.15;
    this.exploded = false;
    this.bob = rng.range(0, TAU);
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    this.bob += dt * 4;

    const a = angleTo(this.x, this.y, p.x, p.y);
    this.face = angleLerp(this.face, a, Math.min(1, 5 * dt));

    if (this.fuse < 0) {
      const sp = this.speed;
      this.vx = Math.cos(this.face) * sp;
      this.vy = Math.sin(this.face) * sp;
      this.tryTouchDamage(this.touchDamage);
      if (d < 132) this.fuse = 0;
    } else {
      this.fuse += dt;
      /* 点火后仍在缓慢逼近，但玩家可以走开 */
      const sp = this.speed * 0.45;
      this.vx = Math.cos(this.face) * sp;
      this.vy = Math.sin(this.face) * sp;
      if (Math.random() < dt * 30) {
        this.game.particles.spawn(
          this.x + rand(-8, 8), this.y - this.r + rand(-6, 6),
          rand(-20, 20), rand(-70, -30), rand(0.2, 0.45), rand(2, 4),
          'rgba(255,180,90,0.7)', { drag: 2 }
        );
      }
      if (this.fuse >= this.fuseDur) {
        this._explode();
      }
    }
  }

  _explode() {
    if (this.exploded) return;
    this.exploded = true;
    const p = this.game.player;
    this.game.particles.ring(this.x, this.y, '#ff8a5c', 22, this.blastRadius * 3.4);
    this.game.particles.burst(this.x, this.y, 26, {
      speed: 300, life: 0.6, size: 6, colors: ['#ff8a5c', '#ffd35e', '#ffffff', this.colors[0]]
    });
    this.game.addShake(3);
    const reach = this.blastRadius + p.r;
    if (dist2(this.x, this.y, p.x, p.y) <= reach * reach) {
      p.takeDamage(this.dmgOut(this.blastDamage), this.x, this.y);
    }
    if (!this.dead) { this.hp = 0; this.die(); }
  }

  /* 死亡效果：被击杀时同样引爆 */
  die() {
    if (this.dead) return;
    this._explode();
    super.die();
  }

  onDraw(ctx) {
    const t = this.animT;
    const g = this.fuse >= 0 ? clamp(this.fuse / this.fuseDur, 0, 1) : 0;

    /* 爆炸预警环 */
    if (this.fuse >= 0) drawTelegraphRing(ctx, this.blastRadius, g, '#ff5a4d');

    /* 鼓胀的囊体 */
    const swell = 1 + g * 0.35 + Math.sin(this.bob) * (0.04 + 0.10 * g);
    ctx.save();
    ctx.scale(swell, swell);
    ctx.fillStyle = this.fuse >= 0 && Math.sin(t * (14 + 26 * g)) > 0 ? '#ffd35e' : this.colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.95, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2 + 1.5 * g;
    ctx.stroke();
    /* 内部涌动 */
    ctx.fillStyle = this.colors[2];
    ctx.globalAlpha = 0.55 + 0.35 * g;
    ctx.beginPath();
    ctx.arc(Math.sin(t * 3) * 3, Math.cos(t * 2.4) * 3, this.r * (0.34 + 0.18 * g), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    /* 引线火花 */
    if (this.fuse >= 0) {
      const fx = Math.cos(-Math.PI / 2 + Math.sin(t * 9) * 0.5) * this.r * 1.1;
      const fy = -this.r * 1.1;
      ctx.fillStyle = '#fff3c0';
      ctx.beginPath();
      ctx.arc(fx, fy, 3 + Math.sin(t * 30), 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = '#ffd0b0';
      ctx.beginPath(); ctx.arc(-this.r * 0.25, -this.r * 0.35, 2.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-this.r * 0.25, this.r * 0.35, 2.4, 0, TAU); ctx.fill();
    }
  }
}

/* ===========================================================
   特殊 · 治疗：织愈 Mender
   躲在最远处，持续为受伤同伴织补生命（优先击杀目标）
   =========================================================== */
class Mender extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '织愈',
      r: 17,
      hp: 32,
      speed: 106,
      touchDamage: 4,
      touchInterval: 1.2,
      mass: 0.8,
      rng: rng,
      colors: ['#22463c', '#7dffb0', '#39c98a']
    });
    this.healAmount = 10;
    this.dmgFields = ['healAmount'];
    this.cd = rng.range(0.8, 1.6);
    this.beam = null;              // {x, y, t}
    this.float = rng.range(0, TAU);
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const toP = angleTo(this.x, this.y, p.x, p.y);
    this.float += dt * 2;

    /* 玩家靠近就跑，尽可能远离 */
    let mx, my;
    if (d < 340) { mx = -Math.cos(toP); my = -Math.sin(toP); }
    else { mx = Math.cos(toP + Math.PI / 2) * Math.sin(this.animT * 0.6); my = Math.sin(toP + Math.PI / 2) * Math.sin(this.animT * 0.6); }
    const len = Math.hypot(mx, my) || 1;
    this.vx = (mx / len) * this.speed;
    this.vy = (my / len) * this.speed;
    this.face = angleLerp(this.face, toP, Math.min(1, 3 * dt));

    if (this.beam) {
      this.beam.t -= dt;
      if (this.beam.t <= 0) this.beam = null;
    }

    this.cd -= dt;
    if (this.cd <= 0) {
      const target = this._pickTarget();
      if (target) {
        this.cd = this.rng.range(2.2, 3.0);
        const amount = Math.round(this.healAmount + target.maxHp * 0.10);
        const before = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + amount);
        const gained = Math.round(target.hp - before);
        this.beam = { x: target.x, y: target.y, t: 0.45 };
        if (gained > 0) {
          this.game.damageNumbers.add(target.x, target.y - target.r - 6, '+' + gained, {
            color: '#7dffb0', life: 0.8, vy: -40
          });
        }
        this.game.particles.ring(target.x, target.y, '#7dffb0', 8, 120);
      } else {
        this.cd = 0.6;
      }
    }
    this.tryTouchDamage(this.touchDamage);
  }

  _pickTarget() {
    const list = this.game.room ? this.game.room.enemies : [];
    let best = null, worst = 0.999;
    for (const e of list) {
      if (e === this || e.dead || e.isBoss) continue;
      if (e.hp >= e.maxHp) continue;
      if (dist2(this.x, this.y, e.x, e.y) > 300 * 300) continue;
      const ratio = e.hp / e.maxHp;
      if (ratio < worst) { worst = ratio; best = e; }
    }
    return best;
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 治疗光束 */
    if (this.beam) {
      ctx.save();
      ctx.globalAlpha = clamp(this.beam.t / 0.45, 0, 1) * 0.8;
      ctx.strokeStyle = '#7dffb0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(this.beam.x - this.x, this.beam.y - this.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.translate(0, Math.sin(this.float) * 3);
    /* 灯笼状躯体 */
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, this.r * 1.6);
    g.addColorStop(0, 'rgba(125,255,176,0.45)');
    g.addColorStop(1, 'rgba(125,255,176,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.6, 0, TAU);
    ctx.fill();

    ctx.fillStyle = this.colors[0];
    polygonPath(ctx, [
      [0, -this.r * 1.1],
      [this.r * 0.8, -this.r * 0.2],
      [this.r * 0.55, this.r * 0.95],
      [-this.r * 0.55, this.r * 0.95],
      [-this.r * 0.8, -this.r * 0.2]
    ]);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 心核 */
    ctx.fillStyle = this.colors[1];
    const pulse = 1 + 0.15 * Math.sin(t * 5);
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.34 * pulse, 0, TAU);
    ctx.fill();
    /* 环绕的织针 */
    ctx.strokeStyle = 'rgba(125,255,176,0.6)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const a = t * 1.4 + (i / 3) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.r * 0.9, Math.sin(a) * this.r * 0.9);
      ctx.lineTo(Math.cos(a) * (this.r * 1.35), Math.sin(a) * (this.r * 1.35));
      ctx.stroke();
    }
  }
}

/* ===========================================================
   特殊 · 护盾：盾壳 Aegis
   缓慢移动，周期性给附近同伴（含自己）套上护盾
   =========================================================== */
class Aegis extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '盾壳',
      r: 22,
      hp: 92,
      speed: 62,
      touchDamage: 9,
      touchInterval: 1.0,
      mass: 2.4,
      rng: rng,
      colors: ['#26364a', '#8fd8ff', '#3f7fb0']
    });
    this.dr = 0.18;
    this.shieldAmount = 24;
    this.dmgFields = ['shieldAmount'];
    this.cd = rng.range(0.6, 1.4);
    this.castT = 0;
    this.casting = false;
    this.spin = rng.range(0, TAU);
  }

  onUpdate(dt) {
    const p = this.game.player;
    const a = angleTo(this.x, this.y, p.x, p.y);
    this.face = angleLerp(this.face, a, Math.min(1, 2.6 * dt));
    this.spin += dt * 0.9;
    const sp = this.speed * (this.casting ? 0.3 : 1);
    this.vx = Math.cos(this.face) * sp;
    this.vy = Math.sin(this.face) * sp;
    this.tryTouchDamage(this.touchDamage);

    if (this.casting) {
      this.castT -= dt;
      if (this.castT <= 0) {
        this.casting = false;
        this.cd = this.rng.range(4.0, 5.2);
        this._grant();
      }
    } else {
      this.cd -= dt;
      if (this.cd <= 0) { this.casting = true; this.castT = 0.7; }
    }
  }

  _grant() {
    const list = this.game.room ? this.game.room.enemies : [];
    let n = 0;
    for (const e of list) {
      if (e.dead) continue;
      if (dist2(this.x, this.y, e.x, e.y) > 230 * 230) continue;
      e.shield = Math.max(e.shield, Math.round(this.shieldAmount));
      this.game.particles.ring(e.x, e.y, '#8fd8ff', 8, 110);
      n++;
    }
    this.game.particles.ring(this.x, this.y, '#8fd8ff', 16, 300);
    if (n > 0) {
      this.game.damageNumbers.add(this.x, this.y - this.r - 8, '护盾 ×' + n, {
        color: '#8fd8ff', life: 0.8
      });
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 施法预警范围 */
    if (this.casting) {
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.2 * Math.sin(t * 12);
      ctx.fillStyle = '#8fd8ff';
      ctx.beginPath();
      ctx.arc(0, 0, 230, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#8fd8ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.rotate(this.face);
    /* 六边形壳 */
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      pts.push([Math.cos(a) * this.r, Math.sin(a) * this.r]);
    }
    ctx.fillStyle = this.colors[0];
    polygonPath(ctx, pts);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2.4;
    ctx.stroke();
    /* 内层板 */
    ctx.strokeStyle = 'rgba(143,216,255,0.45)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.6, 0, TAU);
    ctx.stroke();
    /* 举在身前的盾 */
    ctx.save();
    ctx.translate(this.r * 0.7, 0);
    ctx.rotate(this.casting ? Math.sin(t * 20) * 0.1 : 0);
    ctx.fillStyle = this.casting ? '#cdefff' : this.colors[2];
    polygonPath(ctx, [
      [0, -this.r * 0.85], [this.r * 0.35, -this.r * 0.5],
      [this.r * 0.35, this.r * 0.5], [0, this.r * 0.85]
    ]);
    ctx.fill();
    ctx.strokeStyle = '#8fd8ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    /* 眼缝 */
    ctx.fillStyle = '#cdefff';
    roundRectPath(ctx, -this.r * 0.1, -this.r * 0.35, this.r * 0.7, 3.4, 1.7);
    ctx.fill();
    roundRectPath(ctx, -this.r * 0.1, this.r * 0.35, this.r * 0.7, 3.4, 1.7);
    ctx.fill();
    ctx.restore();

    /* 自转的护环 */
    ctx.save();
    ctx.rotate(this.spin);
    ctx.strokeStyle = 'rgba(143,216,255,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.3, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

/* ===========================================================
   特殊 · 减速：滞泥 Bogger
   缓慢爬行并沿途留下泥沼，玩家踏入会被拖慢
   =========================================================== */
class Bogger extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '滞泥',
      r: 19,
      hp: 56,
      speed: 58,
      touchDamage: 7,
      touchInterval: 1.0,
      mass: 2,
      rng: rng,
      colors: ['#3b3324', '#c8b46b', '#8f7a3c']
    });
    this.poolCd = rng.range(0.4, 1.2);
    this.pools = [];               // {x, y, r, life, t}
    this.drip = rng.range(0, TAU);
  }

  onUpdate(dt) {
    const p = this.game.player;
    const a = angleTo(this.x, this.y, p.x, p.y);
    this.face = angleLerp(this.face, a, Math.min(1, 2.2 * dt));
    this.vx = Math.cos(this.face) * this.speed;
    this.vy = Math.sin(this.face) * this.speed;
    this.tryTouchDamage(this.touchDamage);
    this.drip += dt * 3;

    this.poolCd -= dt;
    if (this.poolCd <= 0) {
      this.poolCd = this.rng.range(1.5, 2.2);
      this.pools.push({ x: this.x, y: this.y, r: 72, life: 6.0, t: 0 });
      if (this.pools.length > 5) this.pools.shift();
      this.game.particles.burst(this.x, this.y, 6, {
        speed: 90, life: 0.5, size: 4, color: '#c8b46b', drag: 4
      });
    }

    for (let i = this.pools.length - 1; i >= 0; i--) {
      const z = this.pools[i];
      z.life -= dt;
      z.t += dt;
      if (z.life <= 0) { this.pools.splice(i, 1); continue; }
      if (dist2(z.x, z.y, p.x, p.y) < (z.r + p.r) * (z.r + p.r)) p.applySlow(0.28);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 泥沼（世界坐标） */
    for (const z of this.pools) {
      ctx.save();
      ctx.translate(z.x - this.x, z.y - this.y);
      const fade = clamp(z.life / 1.2, 0, 1);
      ctx.globalAlpha = (0.16 + 0.06 * Math.sin(z.t * 3)) * fade;
      ctx.fillStyle = '#c8b46b';
      ctx.beginPath();
      ctx.arc(0, 0, z.r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.35 * fade;
      ctx.strokeStyle = '#8f7a3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, z.r, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.25 * fade;
      for (let i = 0; i < 3; i++) {
        const a = z.t * 0.8 + (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * z.r * 0.5, Math.sin(a) * z.r * 0.5, 8, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.rotate(this.face);
    /* 泥块躯体 */
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 1.05, this.r * 0.9, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 下滴的泥浆 */
    ctx.fillStyle = this.colors[2];
    for (let i = 0; i < 3; i++) {
      const px = -this.r * 0.5 + i * this.r * 0.5;
      const len = 6 + Math.abs(Math.sin(this.drip + i)) * 8;
      ctx.beginPath();
      ctx.ellipse(px, this.r * 0.7, 3, len * 0.5, 0, 0, TAU);
      ctx.fill();
    }
    /* 背上的孔洞 */
    ctx.fillStyle = '#241f16';
    ctx.beginPath(); ctx.arc(-this.r * 0.2, -this.r * 0.25, 4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.25, this.r * 0.2, 3, 0, TAU); ctx.fill();
    /* 眼 */
    ctx.fillStyle = '#f0e2a8';
    ctx.beginPath(); ctx.arc(this.r * 0.4, -this.r * 0.3, 2.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.4, this.r * 0.3, 2.4, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ===========================================================
   特殊 · 传送：折跃 Blinker
   周期性瞬移到玩家侧后方，现身后立刻打出两发（有淡入淡出预警）
   =========================================================== */
class Blinker extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '折跃',
      r: 16,
      hp: 36,
      speed: 108,
      touchDamage: 6,
      touchInterval: 1.0,
      mass: 1,
      rng: rng,
      colors: ['#3a2a52', '#c08bff', '#7f5cd6']
    });
    this.bulletDamage = 8;
    this.dmgFields = ['bulletDamage'];
    this.state = 'move';
    this.stateT = rng.range(1.0, 1.8);
    this.fade = 1;                 // 1 实体 · 0 完全消失
    this.tx = x; this.ty = y;
    this.cd = rng.range(1.6, 2.6);
    this.spin = rng.range(0, TAU);
    this._fired = false;
  }

  onUpdate(dt) {
    const p = this.game.player;
    this.spin += dt * 2.2;

    if (this.state === 'move') {
      this.cd -= dt;
      this.fade = Math.min(1, this.fade + dt * 4);
      const a = angleTo(this.x, this.y, p.x, p.y) + Math.sin(this.animT * 2) * 0.5;
      this.face = angleLerp(this.face, a, Math.min(1, 5 * dt));
      this.vx = Math.cos(this.face) * this.speed * 0.7;
      this.vy = Math.sin(this.face) * this.speed * 0.7;
      this.tryTouchDamage(this.touchDamage);
      if (this.cd <= 0) {
        this.state = 'vanish';
        this.stateT = 0.26;
        /* 目标：玩家侧后方 150~210 */
        const base = angleTo(p.x, p.y, this.x, this.y);
        const a2 = base + this.rng.range(-1.0, 1.0);
        const dd = this.rng.range(150, 210);
        const t = arenaClamp(p.x + Math.cos(a2) * dd, p.y + Math.sin(a2) * dd, 40);
        this.tx = t.x; this.ty = t.y;
        this.game.particles.burst(this.x, this.y, 10, {
          speed: 170, life: 0.35, size: 4, color: '#c08bff'
        });
      }
    } else if (this.state === 'vanish') {
      this.stateT -= dt;
      this.vx *= 0.7; this.vy *= 0.7;
      this.fade = Math.max(0, this.fade - dt / 0.26);
      if (this.stateT <= 0) {
        /* 瞬移 */
        this.x = this.tx; this.y = this.ty;
        this.game.room.clampEntity(this, false);
        this.state = 'appear';
        this.stateT = 0.26;
        this.game.particles.ring(this.x, this.y, '#c08bff', 14, 200);
      }
    } else if (this.state === 'appear') {
      this.stateT -= dt;
      this.vx = 0; this.vy = 0;
      this.fade = Math.min(1, this.fade + dt / 0.26);
      this.face = angleLerp(this.face, angleTo(this.x, this.y, p.x, p.y), Math.min(1, 12 * dt));
      if (this.stateT <= 0) {
        this.state = 'volley';
        this.stateT = 0.28;
      }
    } else {
      this.stateT -= dt;
      this.vx *= 0.6; this.vy *= 0.6;
      if (this.stateT > 0.14 && !this._fired) {
        this._fired = true;
        const base = angleTo(this.x, this.y, p.x, p.y);
        for (const off of [-0.13, 0.13]) {
          this.fireBullet(base + off, {
            speed: 320, damage: this.dmgOut(this.bulletDamage), r: 5.5,
            color: '#c08bff', core: '#efe0ff', life: 2.4, spin: 10
          });
        }
      }
      if (this.stateT <= 0) {
        this.state = 'move';
        this.cd = this.rng.range(2.0, 3.0);
        this._fired = false;
      }
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    ctx.save();
    ctx.globalAlpha = this.fade;
    ctx.rotate(this.spin * 0.4);

    /* 菱形本体 */
    ctx.fillStyle = this.colors[0];
    polygonPath(ctx, [
      [0, -this.r * 1.15],
      [this.r * 0.85, 0],
      [0, this.r * 1.15],
      [-this.r * 0.85, 0]
    ]);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 内部折跃核心 */
    ctx.fillStyle = this.colors[2];
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.4 * (0.8 + 0.3 * Math.sin(t * 6)), 0, TAU);
    ctx.fill();
    /* 相位环 */
    ctx.strokeStyle = 'rgba(192,139,255,0.55)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.45, this.spin, this.spin + Math.PI * 1.4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    /* 折跃目标提示（消失期间显示落点） */
    if (this.state === 'vanish') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#c08bff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(this.tx - this.x, this.ty - this.y, this.r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
}

/* ===========================================================
   特殊 · 分裂：畸核 Nucleus
   受到伤害时有概率裂出一颗小核（有数量上限），越打越多
   =========================================================== */
class Nucleus extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '畸核',
      r: 21,
      hp: 64,
      speed: 70,
      touchDamage: 8,
      touchInterval: 0.9,
      mass: 1.8,
      rng: rng,
      colors: ['#4a2a2a', '#ff9d6b', '#d65a3c']
    });
    this.maxSplits = 3;
    this.splitChance = 0.30;
    this.splitCd = 0;
    this.pulse = rng.range(0, TAU);
    this.spawned = false;
  }

  onUpdate(dt) {
    const p = this.game.player;
    if (this.splitCd > 0) this.splitCd -= dt;
    this.pulse += dt * 2.6;
    const a = angleTo(this.x, this.y, p.x, p.y) + Math.sin(this.animT * 1.4) * 0.4;
    this.face = angleLerp(this.face, a, Math.min(1, 3.4 * dt));
    this.vx = Math.cos(this.face) * this.speed;
    this.vy = Math.sin(this.face) * this.speed;
    this.tryTouchDamage(this.touchDamage);
  }

  _nucleidCount() {
    const list = this.game.room ? this.game.room.enemies : [];
    let n = 0;
    for (const e of list) if (!e.dead && e.type === 'nucleid') n++;
    return n + (this.game.room ? this.game.room.pending.filter(q => q.type === 'nucleid').length : 0);
  }

  takeDamage(amount, srcX, srcY) {
    const before = this.hp;
    super.takeDamage(amount, srcX, srcY);
    if (this.dead || this.hp === before) return;
    /* 受伤反馈：有概率裂出小核 */
    if (this.splitCd <= 0 && this._nucleidCount() < this.maxSplits && this.rng.chance(this.splitChance)) {
      this.splitCd = 1.6;
      const room = this.game.room;
      if (room) room.pending.push({ type: 'nucleid', delay: 0.1 });
      this.game.particles.ring(this.x, this.y, '#ff9d6b', 10, 170);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 外膜 */
    const pulse = 1 + 0.07 * Math.sin(this.pulse);
    ctx.save();
    ctx.scale(pulse, pulse);
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2.4;
    ctx.stroke();
    /* 内部气泡（表示待分裂的核） */
    ctx.fillStyle = this.colors[2];
    for (let i = 0; i < 4; i++) {
      const a = t * 0.9 + (i / 4) * TAU;
      const rr = this.r * 0.42;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 4.6 + Math.sin(t * 4 + i) * 1.4, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd0b0';
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.24, 0, TAU);
    ctx.fill();
    ctx.restore();
    /* 触须 */
    ctx.strokeStyle = '#331c1c';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + t * 0.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.r * 0.7, Math.sin(a) * this.r * 0.7);
      ctx.lineTo(Math.cos(a) * (this.r + 10 + Math.sin(t * 5 + i) * 3),
                 Math.sin(a) * (this.r + 10 + Math.sin(t * 5 + i) * 3));
      ctx.stroke();
    }
  }
}

/* 小核：畸核分裂物（不参与随机生成） */
class Nucleid extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '小核',
      r: 11,
      hp: 14,
      speed: 168,
      touchDamage: 5,
      touchInterval: 0.7,
      mass: 0.5,
      rng: rng,
      colors: ['#4a2a2a', '#ff9d6b', '#d65a3c']
    });
    this.wob = rng.range(0, TAU);
  }
  onUpdate(dt) {
    const p = this.game.player;
    this.wob += dt * 6.5;
    const a = angleTo(this.x, this.y, p.x, p.y) + Math.sin(this.wob) * 0.32;
    this.face = angleLerp(this.face, a, Math.min(1, 10 * dt));
    this.vx = Math.cos(this.face) * this.speed;
    this.vy = Math.sin(this.face) * this.speed;
    this.tryTouchDamage(this.touchDamage);
  }
  onDraw(ctx) {
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.fillStyle = this.colors[2];
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.45, 0, TAU);
    ctx.fill();
  }
}

/* ===========================================================
   特殊 · 增益：塑能 Curator
   不直接攻击，周期给附近同伴注入狂暴（移速 +25%，伤害 +20%）
   =========================================================== */
class Curator extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '塑能',
      r: 18,
      hp: 40,
      speed: 96,
      touchDamage: 4,
      touchInterval: 1.2,
      mass: 0.9,
      rng: rng,
      colors: ['#4a3520', '#ffb347', '#ff7a3c']
    });
    this.cd = rng.range(0.8, 1.6);
    this.castT = 0;
    this.casting = false;
    this.float = rng.range(0, TAU);
    this.ring = 0;
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const toP = angleTo(this.x, this.y, p.x, p.y);
    this.float += dt * 2.4;

    /* 中距离徘徊 */
    let mx = 0, my = 0;
    if (d < 240) { mx = -Math.cos(toP); my = -Math.sin(toP); }
    else if (d > 420) { mx = Math.cos(toP) * 0.5; my = Math.sin(toP) * 0.5; }
    else { mx = Math.cos(toP + Math.PI / 2) * 0.6; my = Math.sin(toP + Math.PI / 2) * 0.6; }
    const len = Math.hypot(mx, my) || 1;
    const sp = this.speed * (this.casting ? 0.3 : 1);
    this.vx = (mx / len) * sp;
    this.vy = (my / len) * sp;
    this.face = angleLerp(this.face, toP, Math.min(1, 3 * dt));

    if (this.ring > 0) this.ring -= dt;

    if (this.casting) {
      this.castT -= dt;
      if (this.castT <= 0) {
        this.casting = false;
        this.cd = this.rng.range(3.4, 4.6);
        this._empower();
      }
    } else {
      this.cd -= dt;
      if (this.cd <= 0) { this.casting = true; this.castT = 0.8; }
    }
    this.tryTouchDamage(this.touchDamage);
  }

  _empower() {
    const list = this.game.room ? this.game.room.enemies : [];
    let n = 0;
    for (const e of list) {
      if (e === this || e.dead) continue;
      if (dist2(this.x, this.y, e.x, e.y) > 250 * 250) continue;
      e.rageT = Math.max(e.rageT, 5.0);
      this.game.particles.ring(e.x, e.y, '#ffb347', 8, 120);
      n++;
    }
    this.ring = 0.5;
    this.game.particles.ring(this.x, this.y, '#ffb347', 18, 320);
    if (n > 0) {
      this.game.damageNumbers.add(this.x, this.y - this.r - 8, '狂暴 ×' + n, {
        color: '#ffb347', life: 0.8
      });
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    /* 施法范围 */
    if (this.casting) {
      ctx.save();
      ctx.globalAlpha = 0.10 + 0.16 * Math.sin(t * 12);
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.arc(0, 0, 250, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    /* 生效扩散环 */
    if (this.ring > 0) {
      ctx.save();
      ctx.globalAlpha = this.ring / 0.5;
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 250 * (1 - this.ring / 0.5) + 20, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    ctx.translate(0, Math.sin(this.float) * 3);
    /* 悬浮的眼状核心 */
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, this.r * 1.7);
    g.addColorStop(0, 'rgba(255,179,71,0.4)');
    g.addColorStop(1, 'rgba(255,179,71,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.7, 0, TAU);
    ctx.fill();

    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 0.9, this.r * 0.78, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 单只大眼 */
    ctx.fillStyle = '#fff3d0';
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.46, 0, TAU);
    ctx.fill();
    ctx.fillStyle = this.casting ? '#ff3b30' : this.colors[2];
    const px = Math.cos(this.face) * 3, py = Math.sin(this.face) * 3;
    ctx.beginPath();
    ctx.arc(px, py, this.r * 0.24, 0, TAU);
    ctx.fill();
    /* 能量须 */
    ctx.strokeStyle = 'rgba(255,179,71,0.6)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const a = t * 1.6 + (i / 4) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.r * 0.9, Math.sin(a) * this.r * 0.9);
      ctx.lineTo(Math.cos(a) * (this.r * 1.3), Math.sin(a) * (this.r * 1.3));
      ctx.stroke();
    }
  }
}

/* ===========================================================
   注册：新增敌人只需要在这里加一行
   def 字段说明
     r        出生点半径
     cat      melee / ranged / special（生成系统按类配比）
     role     行为标签（用于文档 / 生成规则）
     cost     生成预算成本（越强调越贵）
     minDepth 最早出现的层数深度（0 = 第 1 层）
     tags     swarm / bullethell / support / tank 等（生成限制用）
     coin     额外金币
     hidden   true = 不参与随机生成（只由其它敌人产生）
   =========================================================== */
EnemyFactory.register('hopper', Hopper, {
  r: 15, cat: 'melee', role: 'jump', cost: 3, minDepth: 0, tags: ['mobile'], coin: 1
});
EnemyFactory.register('gnasher', Gnasher, {
  r: 15, cat: 'melee', role: 'chase', cost: 4, minDepth: 0, tags: ['mobile'], coin: 1
});
EnemyFactory.register('slougher', Slougher, {
  r: 20, cat: 'melee', role: 'split', cost: 5, minDepth: 1, tags: ['tank'], coin: 2
});
EnemyFactory.register('sloughling', Sloughling, {
  r: 11, cat: 'melee', role: 'chase', cost: 1, minDepth: 0, tags: ['swarm'], hidden: true, coin: 0
});
EnemyFactory.register('brute', Brute, {
  r: 24, cat: 'melee', role: 'charge', cost: 7, minDepth: 1, tags: ['tank'], coin: 4
});
EnemyFactory.register('swarmer', Swarmer, {
  r: 9, cat: 'melee', role: 'chase', cost: 1, minDepth: 0, tags: ['swarm'], coin: 0
});
EnemyFactory.register('spiker', Spiker, {
  r: 19, cat: 'melee', role: 'charge', cost: 5, minDepth: 1, tags: ['tank'], coin: 2
});

EnemyFactory.register('marksman', Marksman, {
  r: 17, cat: 'ranged', role: 'single', cost: 4, minDepth: 1, tags: ['sniper'], coin: 1
});
EnemyFactory.register('ringer', Ringer, {
  r: 19, cat: 'ranged', role: 'ring', cost: 7, minDepth: 2, tags: ['bullethell'], coin: 3
});
EnemyFactory.register('fanner', Fanner, {
  r: 18, cat: 'ranged', role: 'fan', cost: 5, minDepth: 1, tags: ['bullethell'], coin: 2
});
EnemyFactory.register('lobber', Lobber, {
  r: 18, cat: 'ranged', role: 'lob', cost: 5, minDepth: 1, tags: ['zone'], coin: 2
});
EnemyFactory.register('wisp', Wisp, {
  r: 14, cat: 'ranged', role: 'single', cost: 4, minDepth: 0, tags: ['homing'], coin: 1
});
EnemyFactory.register('turret', Turret, {
  r: 20, cat: 'ranged', role: 'burst', cost: 6, minDepth: 2, tags: ['bullethell', 'tank'], coin: 3
});

EnemyFactory.register('summoner', Summoner, {
  r: 21, cat: 'special', role: 'summon', cost: 7, minDepth: 2, tags: ['support'], coin: 3
});
EnemyFactory.register('phantom', Phantom, {
  r: 17, cat: 'special', role: 'stealth', cost: 6, minDepth: 2, tags: ['mobile'], coin: 2
});
EnemyFactory.register('bomber', Bomber, {
  r: 17, cat: 'special', role: 'bomb', cost: 5, minDepth: 1, tags: ['zone'], coin: 2
});
EnemyFactory.register('mender', Mender, {
  r: 17, cat: 'special', role: 'heal', cost: 6, minDepth: 2, tags: ['support'], coin: 3
});
EnemyFactory.register('aegis', Aegis, {
  r: 22, cat: 'special', role: 'shield', cost: 8, minDepth: 2, tags: ['support', 'tank'], coin: 4
});
EnemyFactory.register('bogger', Bogger, {
  r: 19, cat: 'special', role: 'slow', cost: 5, minDepth: 2, tags: ['zone'], coin: 2
});
EnemyFactory.register('blinker', Blinker, {
  r: 16, cat: 'special', role: 'blink', cost: 6, minDepth: 2, tags: ['mobile'], coin: 2
});
EnemyFactory.register('nucleus', Nucleus, {
  r: 21, cat: 'special', role: 'split', cost: 7, minDepth: 3, tags: ['tank'], coin: 3
});
EnemyFactory.register('nucleid', Nucleid, {
  r: 11, cat: 'melee', role: 'chase', cost: 1, minDepth: 0, tags: ['swarm'], hidden: true, coin: 0
});
EnemyFactory.register('curator', Curator, {
  r: 18, cat: 'special', role: 'buff', cost: 7, minDepth: 3, tags: ['support'], coin: 3
});
