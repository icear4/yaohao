/* ===========================================================
   player.js — 玩家角色「拾火者」
   属性 / 移动 / 瞄准 / 射击 / 受伤 / 绘制
   =========================================================== */
'use strict';

class Player {
  constructor(game, x, y, charId) {
    this.game = game;

    /* ---- 角色（Meta 系统：不同基础属性 + 特殊能力，见 meta.js） ----
       未加载 meta.js 时为 null，一切走原来的默认数值（向后兼容） */
    this.char = (typeof CHARACTERS !== 'undefined')
      ? CharacterOf(charId || (game && game.charId)) : null;

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
    /* 角色覆盖：高攻必然低血、高血必然低攻（Meta 不给净增益） */
    if (this.char && this.char.base) {
      for (const k in this.char.base) this.base[k] = this.char.base[k];
    }

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

    /* ---- 临时增益 / 诅咒 ---- */
    this.buffs = new BuffSystem(this);

    /* 角色自带机制（如星轨的回旋）要写进 Build，这里先算一次 */
    this.build.recompute();

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
    this.slowT = 0;       // 被泥沼等减速的剩余时间

    /* ---- 受击反馈（手感层） ---- */
    this.kx = 0;          // 受击击退速度
    this.ky = 0;
    this.hurtDir = 0;     // 受击来向（画方向指示）
    this.hurtRing = 0;    // 受击冲击环
    this.muzzleFlash = 0; // 开火枪口闪光

    /* ---- 角色能力运行时状态（只有对应角色会用到） ---- */
    this.heat = 0;        // 灼刃：过热层数
    this.heatT = 0;       // 灼刃：停火倒计时
    this.wallT = 0;       // 磐盾：护壁剩余时间
    this.wallCd = 0;      // 磐盾：护壁冷却
    this.autoT = 2.0;     // 星轨：自动星弹倒计时
  }

  /* 取角色的能力钩子（没有就返回 null，走默认行为） */
  _abil(name) {
    if (!this.char) return null;
    if (typeof CHAR_ABILITIES === 'undefined') return null;
    const a = CHAR_ABILITIES[this.char.id];
    return (a && a[name]) ? a[name] : null;
  }

  /* 角色配色（没有角色时用原来的兜帽配色） */
  get skin() {
    return (this.char && this.char.colors) || {
      cloak: '#15333c', edge: '#2f6b74', core: '#ffb347',
      accent: '#7fd7ea', bullet: '#ffb347'
    };
  }

  /* 击杀回调（由 game.onEnemyKilled 调用） */
  onPlayerKill(e) {
    const f = this._abil('onKill');
    if (f) f(this, this.game, e);
  }

  /* 进入新一层（含开局第 1 层）回调 */
  onFloorStart() {
    const f = this._abil('onFloor');
    if (f) f(this, this.game);
  }

  /* 金币倍率（拾荒者） */
  get coinMul() { return (this.char && this.char.coinMul) || 1; }

  /* 被减速（取最长持续时间，不叠加） */
  applySlow(dur) {
    if (this.dead) return;
    this.slowT = Math.max(this.slowT, dur);
  }

  get slowFactor() { return this.slowT > 0 ? 0.55 : 1; }

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

    /* 减速计时 */
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (Math.random() < dt * 8) {
        this.game.particles.spawn(
          this.x + rand(-10, 10), this.y + rand(-6, 10),
          rand(-8, 8), rand(-24, -6), rand(0.3, 0.6), rand(2, 4),
          'rgba(120,180,255,0.5)', { drag: 3 }
        );
      }
    }

    /* 移动（键盘 WASD/方向键 与 触屏虚拟摇杆统一走 Input.moveVector） */
    const v = input.moveVector();
    let mx = v.x, my = v.y;
    const vlen = Math.hypot(mx, my);

    this.moving = vlen > 0.001;
    if (this.moving) {
      if (vlen > 1) { mx /= vlen; my /= vlen; }
      const sp = this.moveSpeed * this.slowFactor;
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

    /* ---- 受击击退：独立的短促位移，衰减很快，不干扰走位手感 ---- */
    if (this.kx !== 0 || this.ky !== 0) {
      this.x += this.kx * dt;
      this.y += this.ky * dt;
      const kd = Math.max(0, 1 - 11 * dt);
      this.kx *= kd; this.ky *= kd;
      if (Math.abs(this.kx) < 2 && Math.abs(this.ky) < 2) { this.kx = 0; this.ky = 0; }
    }
    if (this.hurtRing > 0) this.hurtRing = Math.max(0, this.hurtRing - dt * 2.6);
    if (this.muzzleFlash > 0) this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 9);

    /* 瞄准 */
    const m = this.game.mouseWorld;
    this.aim = angleTo(this.x, this.y, m.x, m.y);

    /* 临时增益 / 诅咒计时 */
    this.buffs.update(dt);

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

    /* 角色能力的每帧逻辑（过热衰减 / 护壁计时 / 自动星弹……） */
    const ab = this._abil('update');
    if (ab) ab(this, dt, this.game);

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
    /* 角色伤害倍率（灼刃的过热） */
    const dm = this._abil('dmgMul');
    const cmul = dm ? dm(this) : 1;
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
        damage: this.damage * cmul,
        r: this.bulletRadius,
        friendly: true,
        color: this.skin.bullet,
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
    this.muzzleFlash = 1;
    const os = this._abil('onShoot');
    if (os) os(this, this.game);

    /* ---- 开火反馈：枪口闪光 + 火花 + 抛壳 + 轻微后坐位移 ---- */
    const mxx = this.x + Math.cos(this.aim) * (this.r + 10);
    const mxy = this.y + Math.sin(this.aim) * (this.r + 10);
    this.game.particles.muzzle(mxx, mxy, this.aim, this.skin.bullet);
    this.game.particles.spawn(mxx, mxy,
      Math.cos(this.aim) * rand(60, 190) + rand(-40, 40),
      Math.sin(this.aim) * rand(60, 190) + rand(-40, 40),
      rand(0.06, 0.14), rand(6, 11), 'rgba(255,240,200,0.55)',
      { drag: 7, shrink: false });
    /* 抛壳：朝射口侧后方弹出一枚小碎片 */
    const ea = this.aim + Math.PI * 0.5 * (chance(0.5) ? 1 : -1);
    this.game.particles.spawn(this.x, this.y,
      Math.cos(ea) * rand(70, 150), Math.sin(ea) * rand(70, 150),
      rand(0.3, 0.55), rand(2.2, 3.4), 'rgba(255,190,110,0.75)',
      { drag: 3.6, shape: 'shard', rot: ea, spin: rand(-12, 12) });
    /* 后坐：朝反方向轻推一点点（不影响可控性） */
    this.x -= Math.cos(this.aim) * 3.2;
    this.y -= Math.sin(this.aim) * 3.2;
    this.game.room.clampEntity(this, true);
  }

  /* ---------------------------------------------------------
     受伤
     --------------------------------------------------------- */
  takeDamage(amount, srcX, srcY) {
    if (this.dead || this.invuln > 0) return false;

    /* 角色减伤（磐盾的回声护壁） */
    const tm = this._abil('dmgTakenMul');
    if (tm) amount *= tm(this);

    const real = Math.max(1, Math.round(amount - (this.armor || 0)));
    this.hp -= real;
    this.invuln = this.invulnTime;
    this.hurtFlash = 1;
    this.hurtRing = 1;

    /* ---- 屏幕震动：随伤害占最大生命的比例增强，但始终"轻微" ---- */
    const weight = clamp(real / Math.max(1, this.maxHp), 0, 1);
    this.game.addShake(3.2 + 5.2 * weight, srcX, srcY);
    HitStop.request(0.05 + 0.05 * weight, weight > 0.25);

    /* 角色受伤钩子（护壁展开等） */
    const oh = this._abil('onHurt');
    if (oh) oh(this, this.game);

    const ang = angleTo(srcX, srcY, this.x, this.y);
    this.hurtDir = ang;
    this.game.particles.burst(this.x, this.y, 12 + Math.round(8 * weight), {
      speed: 190 + 120 * weight, life: 0.4, size: 4, color: '#ff5d5d',
      dir: ang, spread: 2.2, colors: ['#ff5d5d', '#ff9a6a', '#ffd0a0']
    });
    this.game.particles.ring(this.x, this.y, '#ff5d5d', 10 + Math.round(8 * weight), 150);
    this.game.damageNumbers.add(this.x, this.y - 18, amount, {
      color: '#ff7a7a', life: 0.85, vy: -52
    });
    if (typeof Juice !== 'undefined') Juice.flash(this.game, '#ff3b3b', 0.16 + 0.22 * weight, 0.2);
    if (this.game.ui) this.game.ui.hitVignette = Math.max(this.game.ui.hitVignette, 0.7 + 0.3 * weight);

    /* ---- 击退：来得快去得快，明显但不会把人推到失控 ---- */
    const push = 120 + 190 * weight;
    this.kx += Math.cos(ang) * push;
    this.ky += Math.sin(ang) * push;
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
    const C = this.skin;
    const cid = this.char ? this.char.id : 'ember';

    ctx.save();
    ctx.translate(this.x, this.y);

    /* 开火枪口闪光：一圈短促的亮光，让射击"有落地感" */
    if (this.muzzleFlash > 0) {
      const mf = this.muzzleFlash;
      ctx.save();
      ctx.rotate(this.aim);
      ctx.globalAlpha = mf * 0.55;
      const mg = ctx.createRadialGradient(this.r * 0.9, 0, 1, this.r * 0.9, 0, this.r * 2.6);
      mg.addColorStop(0, 'rgba(255,246,214,0.95)');
      mg.addColorStop(0.4, 'rgba(255,179,71,0.55)');
      mg.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(this.r * 0.9, 0, this.r * 2.6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    /* 无敌时间：脚下一圈逆时针转的虚线环，明确"现在打不到我" */
    if (this.invuln > 0) {
      ctx.save();
      ctx.globalAlpha = 0.28 + 0.22 * Math.sin(this.game.time * 18);
      ctx.strokeStyle = '#8fe9ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 7]);
      ctx.lineDashOffset = -this.game.time * 90;
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.55, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* 磐盾：护壁展开时脚下一圈绿环 */
    if (this.wallT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.game.time * 9);
      ctx.strokeStyle = '#7dffb0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.75, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#7dffb0';
      ctx.fill();
      ctx.restore();
    }

    /* 灼刃：过热越高，脚下火环越亮 */
    if (this.heat > 0) {
      ctx.save();
      ctx.globalAlpha = 0.10 + 0.05 * (this.heat / 10);
      ctx.fillStyle = this.heat > 7 ? '#fff0c0' : '#ff6b3c';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * (1.3 + 0.5 * (this.heat / 10)), 0, TAU);
      ctx.fill();
      ctx.restore();
    }

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
      ctx.fillStyle = C.accent;
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
    ctx.fillStyle = C.cloak;
    polygonPath(ctx, pts);
    ctx.fill();
    ctx.strokeStyle = C.edge;
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 肩部旋转环 */
    ctx.rotate(-this.aim);
    ctx.strokeStyle = C.accent;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.28, this.game.time * 1.4, this.game.time * 1.4 + Math.PI * 1.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.28, this.game.time * 1.4 + Math.PI, this.game.time * 1.4 + Math.PI * 1.75);
    ctx.stroke();
    ctx.globalAlpha = 1;

    /* 角色标识（一眼分辨是谁） */
    ctx.save();
    ctx.rotate(this.game.time * 0.8);
    if (cid === 'cinder') {
      /* 灼刃：背后两片火羽 */
      ctx.fillStyle = '#ff6b3c';
      for (let s = -1; s <= 1; s += 2) {
        ctx.beginPath();
        ctx.moveTo(0, this.r * 0.5);
        ctx.lineTo(s * this.r * 1.0, this.r * 1.25);
        ctx.lineTo(s * this.r * 0.35, this.r * 0.75);
        ctx.closePath();
        ctx.fill();
      }
    } else if (cid === 'bulwark') {
      /* 磐盾：肩侧两块盾板 */
      ctx.fillStyle = '#3f7ba8';
      for (let s = -1; s <= 1; s += 2) {
        ctx.beginPath();
        ctx.arc(s * this.r * 0.95, 0, this.r * 0.42, 0, TAU);
        ctx.fill();
      }
    } else if (cid === 'orbiter') {
      /* 星轨：绕身的一颗星弹 */
      const ra = this.game.time * 2.4;
      ctx.fillStyle = '#d8b4ff';
      ctx.beginPath();
      ctx.arc(Math.cos(ra) * this.r * 1.45, Math.sin(ra) * this.r * 1.45, 3.4, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(Math.cos(ra + Math.PI) * this.r * 1.45, Math.sin(ra + Math.PI) * this.r * 1.45, 3.4, 0, TAU);
      ctx.fill();
    } else if (cid === 'scav') {
      /* 拾荒者：腰间晃动的钱袋微光 */
      ctx.fillStyle = '#ffd35e';
      ctx.beginPath();
      ctx.arc(this.r * 0.9, this.r * 0.5, 2.6, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-this.r * 0.9, -this.r * 0.5, 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

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
    g.addColorStop(0.42, C.core);
    g.addColorStop(1, 'rgba(255,120,40,0.05)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.82 * pulse, 0, TAU);
    ctx.fill();
    ctx.restore();

    /* 受击：红闪 + 白闪叠加（先白后红，一瞬间看清"挨打了"）
       亮度跟随「画面闪烁」档位（关掉也保留 35%） */
    if (this.hurtFlash > 0) {
      const hfm = (this.game && this.game.hitFlashMul !== undefined) ? this.game.hitFlashMul : 1;
      const hf = this.hurtFlash * hfm;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = hf * 0.75;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.18, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = hf * 0.45;
      ctx.fillStyle = '#ff3b3b';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.28, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    /* 受击方向：来向的一段厚弧，知道伤害从哪里来 */
    if (this.hurtRing > 0) {
      ctx.save();
      ctx.globalAlpha = this.hurtRing * 0.7;
      ctx.strokeStyle = '#ff5d5d';
      ctx.lineWidth = 4 * this.hurtRing + 1;
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.9, this.hurtDir - 0.62, this.hurtDir + 0.62);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }
}
