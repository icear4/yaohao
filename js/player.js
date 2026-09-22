/* ===========================================================
   player.js — 玩家角色「拾火者」
   属性 / 移动 / 瞄准 / 射击 / 受伤 / 绘制
   =========================================================== */
'use strict';

class Player {
  constructor(game, x, y) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.r = 15;

    /* ---- 基础属性（道具系统的叠加基准，只在这里写一次） ---- */
    this.base = {
      maxHp: 100,
      damage: 11,
      fireInterval: 0.17,
      moveSpeed: 262,
      bulletSpeed: 660,
      bulletRadius: 5,
      bulletCount: 1,
      critChance: 0.08,
      critDamage: 2.0,
      range: 1060,
      invulnTime: 0.9
    };

    /* ---- 属性（由 Build.recompute() 每次重新写入） ---- */
    this.maxHp = this.base.maxHp;
    this.hp = this.base.maxHp;
    this.moveSpeed = this.base.moveSpeed;
    this.damage = this.base.damage;
    this.fireInterval = this.base.fireInterval;
    this.bulletSpeed = this.base.bulletSpeed;
    this.bulletRadius = this.base.bulletRadius;
    this.bulletCount = this.base.bulletCount;
    this.critChance = this.base.critChance;
    this.critDamage = this.base.critDamage;
    this.range = this.base.range;
    this.armor = 0;
    this.regen = 0;

    /* ---- Build（道具 / 组合） ---- */
    this.build = new Build(this);
    this.mods = this.build.mods;

    /* ---- 运行时状态 ---- */
    this.fireTimer = 0;
    this.invuln = 0;
    this.invulnTime = this.base.invulnTime;
    this.aim = -Math.PI / 2;
    this.moving = false;
    this.walkPhase = 0;
    this.recoil = 0;
    this.hurtFlash = 0;
    this.dead = false;
    this.shotsFired = 0;
    this.trailT = 0;      // 烬迹计时
  }

  /* 拾取道具（所有入口统一走这里） */
  gainItem(itemId) {
    const it = this.build.add(itemId);
    if (!it) return null;
    this.game.ownedItems.push(itemId);
    return it;
  }

  get alive() { return !this.dead; }

  /* ---------------------------------------------------------
     更新
     --------------------------------------------------------- */
  update(dt, input) {
    if (this.dead) return;

    /* 移动（键盘 WASD/方向键 与 触屏虚拟摇杆统一走 Input.moveVector） */
    const v = input.moveVector();
    let mx = v.x, my = v.y;
    const vlen = Math.hypot(mx, my);

    this.moving = vlen > 0.001;
    if (this.moving) {
      if (vlen > 1) { mx /= vlen; my /= vlen; }
      const sp = this.moveSpeed;
      this.x += mx * sp * dt;
      this.y += my * sp * dt;
      this.walkPhase += dt * 11;
      /* 移动尘埃 */
      if (Math.random() < dt * 14) {
        this.game.particles.spawn(
          this.x - mx * 8 + rand(-4, 4), this.y - my * 8 + rand(-4, 4),
          -mx * rand(10, 40) + rand(-12, 12), -my * rand(10, 40) + rand(-12, 12),
          rand(0.18, 0.4), rand(2, 4), 'rgba(120,200,220,0.35)', { drag: 4 }
        );
      }
    }

    /* 瞄准 */
    const m = this.game.mouseWorld;
    this.aim = angleTo(this.x, this.y, m.x, m.y);

    /* 生命回复 */
    if (this.regen > 0 && this.hp > 0 && this.hp < this.maxHp) {
      this._regenAcc = (this._regenAcc || 0) + this.regen * dt;
      if (this._regenAcc >= 1) {
        const g = Math.floor(this._regenAcc);
        this._regenAcc -= g;
        this.hp = Math.min(this.maxHp, this.hp + g);
      }
    }

    /* 烬迹：身周持续灼烧 */
    if (this.mods.trailFire > 0) {
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.3;
        this.game.burnAround(this.x, this.y, 66, this.mods.trailFire * 3);
      }
    }

    /* 射击 */
    this.fireTimer -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 9);
    if (input.firing() && this.fireTimer <= 0) {
      this.shoot();
      this.fireTimer = this.fireInterval;
    }

    /* 受伤后的无敌闪烁 */
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);

    /* 与墙体 / 门的碰撞 */
    this.game.room.clampEntity(this, true);
  }

  /* ---------------------------------------------------------
     射击
     --------------------------------------------------------- */
  shoot() {
    const m = this.mods;
    const n = this.bulletCount;
    const spreadTotal = n > 1 ? 0.11 * (n - 1) : 0;
    const start = this.aim - spreadTotal * 0.5;
    const muzzleLen = this.r + 8;
    const life = this.range / this.bulletSpeed;
    const eff = this.build.shotEffects();

    for (let i = 0; i < n; i++) {
      const a = n > 1 ? start + (spreadTotal / (n - 1)) * i : this.aim;
      const px = this.x + Math.cos(a) * muzzleLen;
      const py = this.y + Math.sin(a) * muzzleLen;

      const opt = {
        x: px, y: py,
        angle: a,
        speed: this.bulletSpeed,
        damage: this.damage,
        r: this.bulletRadius,
        friendly: true,
        color: '#ffb347',
        core: '#fff6da',
        life: life,
        game: this.game,
        spin: m.orbit > 0 ? 9 : 0
      };
      /* 机制快照：一次拷贝，之后与 Build 解耦 */
      for (const k in eff) opt[k] = eff[k];
      opt.splitLeft = m.split;          // 剩余可分裂次数
      opt.isChild = false;
      opt.damageMul = 1;

      /* 外观随机制变化 */
      if (m.poison > 0) { opt.color = '#9ad14f'; opt.core = '#e8ffb0'; }
      else if (m.freeze > 0) { opt.color = '#8fd8ff'; opt.core = '#ffffff'; }
      else if (m.homing > 0) { opt.color = '#7fe4ff'; }
      else if (m.explode > 0) { opt.color = '#ff8a5c'; }

      this.game.spawnProjectile(opt);
    }

    this.shotsFired++;
    this.recoil = 1;
    this.game.particles.muzzle(
      this.x + Math.cos(this.aim) * (this.r + 10),
      this.y + Math.sin(this.aim) * (this.r + 10),
      this.aim, '#ffd27a'
    );
    this.game.addShake(1.1);
  }

  /* ---------------------------------------------------------
     受伤
     --------------------------------------------------------- */
  takeDamage(amount, srcX, srcY) {
    if (this.dead || this.invuln > 0) return false;

    const real = Math.max(1, Math.round(amount - (this.armor || 0)));
    this.hp -= real;
    this.invuln = this.invulnTime;
    this.hurtFlash = 1;
    this.game.addShake(7);

    const ang = angleTo(srcX, srcY, this.x, this.y);
    this.game.particles.burst(this.x, this.y, 12, {
      speed: 190, life: 0.4, size: 4, color: '#ff5d5d',
      dir: ang, spread: 2.2, colors: ['#ff5d5d', '#ff9a6a', '#ffd0a0']
    });
    this.game.damageNumbers.add(this.x, this.y - 18, amount, {
      color: '#ff7a7a', life: 0.85, vy: -52
    });

    /* 轻微击退 */
    const push = 46;
    this.x += Math.cos(ang) * push * 0.35;
    this.y += Math.sin(ang) * push * 0.35;
    this.game.room.clampEntity(this, true);

    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.game.onPlayerDeath();
    }
    return true;
  }

  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const gained = Math.round(this.hp - before);
    if (gained > 0) {
      this.game.damageNumbers.add(this.x, this.y - 26, '+' + gained, {
        color: '#7dffb0', life: 0.95, vy: -46
      });
      this.game.particles.ring(this.x, this.y, '#7dffb0', 14, 130);
    }
    return gained;
  }

  /* ---------------------------------------------------------
     绘制：兜帽斗篷 + 胸口火种核心 + 指向准星的射口
     --------------------------------------------------------- */
  draw(ctx) {
    if (this.dead) return;
    const blink = this.invuln > 0 && Math.floor(this.invuln * 16) % 2 === 0;

    ctx.save();
    ctx.translate(this.x, this.y);

    /* 影子 */
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(2, 9, this.r * 1.1, this.r * 0.58, 0, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = blink ? 0.42 : 1;

    /* 背部推进光（移动时） */
    if (this.moving) {
      ctx.save();
      ctx.rotate(this.aim + Math.PI);
      ctx.globalAlpha = (blink ? 0.2 : 0.5) * (0.6 + 0.4 * Math.sin(this.walkPhase * 2));
      ctx.fillStyle = '#4fd6ff';
      ctx.beginPath();
      ctx.moveTo(this.r * 0.8, 0);
      ctx.lineTo(this.r * 2.0, -this.r * 0.45);
      ctx.lineTo(this.r * 2.0, this.r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = blink ? 0.42 : 1;
    }

    /* 斗篷（六边形袍身） */
    ctx.save();
    ctx.rotate(this.aim);
    const wob = Math.sin(this.walkPhase) * (this.moving ? 1.6 : 0.4);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const rr = this.r * (1.06 + (i % 2 === 0 ? 0.05 : -0.03)) + wob * Math.cos(a);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    ctx.fillStyle = '#15333c';
    polygonPath(ctx, pts);
    ctx.fill();
    ctx.strokeStyle = '#2f6b74';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 肩部旋转环 */
    ctx.rotate(-this.aim);
    ctx.strokeStyle = 'rgba(120, 230, 250, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.28, this.game.time * 1.4, this.game.time * 1.4 + Math.PI * 1.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.28, this.game.time * 1.4 + Math.PI, this.game.time * 1.4 + Math.PI * 1.75);
    ctx.stroke();

    /* 射口（指向准星） */
    ctx.rotate(this.aim);
    const rc = this.recoil * 4;
    ctx.fillStyle = '#0d2229';
    roundRectPath(ctx, this.r * 0.35 - rc, -3.6, this.r * 1.15, 7.2, 3);
    ctx.fill();
    ctx.fillStyle = this.fireTimer > this.fireInterval - 0.07 ? '#fff6cf' : '#ff9d3c';
    roundRectPath(ctx, this.r * 1.25 - rc, -2.2, 5, 4.4, 2);
    ctx.fill();

    /* 胸口火种核心 */
    const pulse = 0.86 + 0.14 * Math.sin(this.game.time * 4.2);
    const g = ctx.createRadialGradient(0, 0, 0.5, 0, 0, this.r * 0.82 * pulse);
    g.addColorStop(0, '#fff4d2');
    g.addColorStop(0.42, '#ffb347');
    g.addColorStop(1, 'rgba(255,120,40,0.05)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.82 * pulse, 0, TAU);
    ctx.fill();
    ctx.restore();

    /* 受击红闪 */
    if (this.hurtFlash > 0) {
      ctx.globalAlpha = this.hurtFlash * 0.55;
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.15, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }
}
