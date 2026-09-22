/* ===========================================================
   enemy.js — 敌人基类 + 三种原创敌人（各自独立 AI）
     1. 灰噬体  Chaser  ：持续追踪 + 扑击近战
     2. 棱目    Shooter ：保持距离 + 预判弹幕
     3. 锥锋    Charger ：蓄力后高速冲锋
   =========================================================== */
'use strict';

/* -----------------------------------------------------------
   精英词缀表（数据驱动：新增词缀只需加一条数据）
   ----------------------------------------------------------- */
const ELITE_AFFIX = {
  warded:    { cn: '守护', color: '#7fe4ff', desc: '生命 +60%' },
  armored:   { cn: '甲壳', color: '#c8d8e4', desc: '受到伤害 -30%' },
  frenzy:    { cn: '狂乱', color: '#ff8a5c', desc: '移速 +40%，接触伤害 +20%' },
  volatile:  { cn: '不稳', color: '#ff4d6b', desc: '死亡时爆裂' },
  splitting: { cn: '裂生', color: '#9ad14f', desc: '死亡时裂出两只残形' },
  rich:      { cn: '富饶', color: '#ffd35e', desc: '掉落金币 ×3' }
};

/* -----------------------------------------------------------
   敌人基类
   ----------------------------------------------------------- */
class Enemy {
  constructor(game, x, y, cfg) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.kx = 0;                     // 击退速度
    this.ky = 0;

    this.r = cfg.r;
    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    this.speed = cfg.speed;
    this.touchDamage = cfg.touchDamage || 0;
    this.touchInterval = cfg.touchInterval || 0.8;

    this.name = cfg.name;
    this.colors = cfg.colors;
    this.mass = cfg.mass || 1;
    /* 每只敌人自带 Rng：行为随机也进入种子体系（相同 Seed → 相同战斗） */
    this.rng = cfg.rng || new Rng(Math.floor(Math.random() * 0x7fffffff));

    this.dead = false;
    this.touchTimer = 0;
    this.hitFlash = 0;
    this.animT = this.rng.range(0, 10);
    this.face = this.rng.range(0, TAU);

    this.spawnT = 0;
    this.spawnDur = 0.5;
    this.spawned = false;            // 出场动画完成

    /* ---- 状态效果（由道具施加） ---- */
    this.burnT = 0; this.burnStack = 0;
    this.poisonT = 0; this.poisonStack = 0;
    this.freezeT = 0;
    this.slowT = 0; this.slowStack = 0;
    this.baseSpeed = this.speed;
    this.dotAcc = 0;

    /* ---- 精英词缀 ---- */
    this.dr = 0;                     // 伤害减免（甲壳词缀）
    this.affix = null;               // 词缀 key 列表

    /* ---- 护盾 / 增益（由特殊敌人提供） ---- */
    this.shield = 0;                 // 护盾值：先于生命被消耗
    this.rageT = 0;                  // 狂暴增益剩余时间（移速 +25%，伤害 ×1.2）

    /* ---- 需要随层数成长的自定义伤害字段（子类填名字） ---- */
    this.dmgFields = null;
    this.coinBonus = 0;              // 额外金币（由种类定义写入）
  }

  /* 精英词缀表（数据驱动） */
  static get AFFIX() { return ELITE_AFFIX; }

  /* 施加状态：kind = burn | poison | freeze | slow，level = 层数 */
  applyStatus(kind, level) {
    if (this.dead || level <= 0) return;
    if (kind === 'burn') { this.burnStack = Math.min(9, this.burnStack + level); this.burnT = 3.0; }
    else if (kind === 'poison') { this.poisonStack = Math.min(12, this.poisonStack + level); this.poisonT = 4.0; }
    else if (kind === 'freeze') { this.freezeT = Math.max(this.freezeT, 0.8 + 0.25 * level); }
    else if (kind === 'slow') { this.slowStack = Math.min(5, this.slowStack + level); this.slowT = Math.max(this.slowT, 1.6); }
  }

  hasStatus() {
    return this.burnT > 0 || this.poisonT > 0 || this.freezeT > 0 || this.slowT > 0;
  }

  /* 持续伤害（不触发击退与受击闪白） */
  takeDot(amount, healer) {
    if (this.dead || amount <= 0) return;
    this.hp -= amount;
    if (healer && healer.build) {
      const m = healer.mods || {};
      if (m.dotVamp > 0) healer.hp = Math.min(healer.maxHp, healer.hp + amount * 0.10);
    }
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  _updateStatus(dt) {
    if (this.burnT > 0) this.burnT -= dt; else this.burnStack = 0;
    if (this.poisonT > 0) this.poisonT -= dt; else this.poisonStack = 0;
    if (this.freezeT > 0) this.freezeT -= dt;
    if (this.slowT > 0) this.slowT -= dt; else this.slowStack = 0;
    if (this.rageT > 0) this.rageT -= dt;

    const dps = this.burnStack * 3.2 + this.poisonStack * 2.4;
    if (dps > 0) {
      this.dotAcc += dps * dt;
      if (this.dotAcc >= 1) {
        const tick = Math.floor(this.dotAcc);
        this.dotAcc -= tick;
        this.takeDot(tick, this.game.player);
        if (Math.random() < 0.5) {
          this.game.particles.spawn(
            this.x + rand(-this.r, this.r), this.y + rand(-this.r, this.r),
            rand(-20, 20), rand(-50, -20), rand(0.3, 0.6), rand(2, 3.4),
            this.burnStack >= this.poisonStack ? '#ff9d3c' : '#9ad14f', { drag: 2 }
          );
        }
      }
    }

    /* 速度倍率：冰冻结死，减速按比例，狂暴加速 */
    const slowMul = this.slowT > 0 ? Math.max(0.4, 1 - 0.15 * this.slowStack) : 1;
    const rageMul = this.rageT > 0 ? 1.25 : 1;
    this.speed = this.baseSpeed * (this.freezeT > 0 ? 0 : slowMul) * rageMul;

    /* 极寒领域：被冻结/减速的敌人向外散发寒气 */
    if (this.game.player && this.game.player.mods &&
        this.game.player.mods.frostField > 0 && (this.freezeT > 0 || this.slowT > 0)) {
      for (const o of this.game.room.enemies) {
        if (o === this || o.dead) continue;
        if (dist2(this.x, this.y, o.x, o.y) < 110 * 110) o.applyStatus('slow', 1);
      }
    }
  }

  get spawnScale() {
    return this.spawnT >= this.spawnDur ? 1 : easeOutBack(clamp(this.spawnT / this.spawnDur, 0, 1));
  }

  applyTier(tier) {
    const hpMul = 1 + 0.14 * tier;
    const dmgMul = 1 + Math.min(0.05 * tier, 0.6);
    const spdMul = 1 + Math.min(0.022 * tier, 0.35);
    this.maxHp = Math.round(this.maxHp * hpMul);
    this.hp = this.maxHp;
    this.touchDamage = Math.round(this.touchDamage * dmgMul);
    this.speed *= spdMul;
    this.baseSpeed = this.speed;
    this.tier = tier;

    /* 子类声明的自定义伤害字段（子弹伤害 / 砸地伤害等）同步成长 */
    if (this.dmgFields) {
      for (const k of this.dmgFields) {
        if (typeof this[k] === 'number') this[k] = Math.round(this[k] * dmgMul);
      }
    }
  }

  /* 伤害输出（受狂暴增益影响） */
  dmgOut(base) { return Math.round(base * (this.rageT > 0 ? 1.2 : 1)); }

  /* 统一的敌方弹幕生成入口：所有敌人子弹都从这里出，便于统一做安全限制 */
  fireBullet(angle, opt) {
    opt = opt || {};
    return this.game.spawnProjectile({
      x: this.x + Math.cos(angle) * (this.r + (opt.offset || 6)),
      y: this.y + Math.sin(angle) * (this.r + (opt.offset || 6)),
      angle: angle,
      speed: opt.speed || 300,
      damage: opt.damage === undefined ? 8 : opt.damage,
      r: opt.r || 6,
      friendly: false,
      color: opt.color || this.colors[1],
      core: opt.core || '#ffffff',
      life: opt.life || 3.0,
      spin: opt.spin || 0,
      homing: opt.homing || 0,
      game: this.game
    });
  }

  /* 精英词缀（数据驱动，只改数值与标记，不动子类 AI） */
  applyAffixes(keys) {
    if (!keys || !keys.length) return;
    this.affix = keys.slice();
    for (const k of keys) {
      if (k === 'warded') { this.maxHp = Math.round(this.maxHp * 1.6); this.hp = this.maxHp; }
      else if (k === 'armored') { this.dr = 0.30; this.r = Math.round(this.r * 1.18); }
      else if (k === 'frenzy') {
        this.speed *= 1.4; this.baseSpeed = this.speed;
        this.touchDamage = Math.round(this.touchDamage * 1.2);
      }
      /* volatile / splitting / rich 只做标记，结算在 Game.onEnemyKilled */
    }
  }

  update(dt) {
    this.animT += dt;
    this.spawnT += dt;
    if (!this.spawned && this.spawnT >= this.spawnDur) {
      this.spawned = true;
      this.game.particles.ring(this.x, this.y, this.colors[1], 10, 110);
    }

    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    if (this.touchTimer > 0) this.touchTimer -= dt;

    /* 出场动画期间不行动 */
    if (!this.spawned) {
      this.vx = 0; this.vy = 0;
      return;
    }

    this._updateStatus(dt);
    if (this.dead) return;

    /* 冻结：完全停止行动（移动与攻击都被冻住） */
    if (this.freezeT > 0) {
      this.vx = 0; this.vy = 0;
      const kd = Math.max(0, 1 - 9 * dt);
      this.kx *= kd; this.ky *= kd;
      this.x += this.kx * dt;
      this.y += this.ky * dt;
      this.game.room.clampEntity(this, false);
      return;
    }

    this.onUpdate(dt);

    /* 击退衰减 */
    const kd = Math.max(0, 1 - 9 * dt);
    this.kx *= kd; this.ky *= kd;

    this.x += (this.vx + this.kx) * dt;
    this.y += (this.vy + this.ky) * dt;

    /* 永远被关在房间内（不会从门跑出去） */
    this.game.room.clampEntity(this, false);
  }

  /* 接触伤害：子类在需要时调用 */
  tryTouchDamage(amount, extraRange) {
    if (this.touchTimer > 0 || amount <= 0) return false;
    const p = this.game.player;
    if (!p || p.dead) return false;
    const reach = this.r + p.r + (extraRange || 2);
    if (dist2(this.x, this.y, p.x, p.y) <= reach * reach) {
      const hurt = p.takeDamage(this.dmgOut(amount), this.x, this.y);
      this.touchTimer = this.touchInterval;
      /* 烬刺外皮：近身接触时反弹伤害 */
      const th = (p.mods && p.mods.thorns) || 0;
      if (th > 0) {
        this.takeDamage(th * 10, p.x, p.y);
        this.game.particles.burst(this.x, this.y, 6, {
          speed: 160, life: 0.3, size: 3, color: '#c8ff6a'
        });
      }
      return hurt;
    }
    return false;
  }

  takeDamage(amount, srcX, srcY) {
    if (this.dead) return;
    if (this.dr > 0) amount = amount * (1 - this.dr);   // 甲壳词缀：减伤
    if (amount < 1) amount = 1;

    /* 护盾：先扣盾，扣完才算伤害（仍然有受击反馈） */
    if (this.shield > 0) {
      const absorb = Math.min(this.shield, amount);
      this.shield -= absorb;
      amount -= absorb;
      this.hitFlash = 1;
      this.game.particles.hitSpark(
        lerp(srcX, this.x, 0.75), lerp(srcY, this.y, 0.75),
        angleTo(srcX, srcY, this.x, this.y) + Math.PI, '#8fd8ff'
      );
      if (amount < 1) {
        this.game.damageNumbers.add(this.x, this.y - this.r - 6, '盾', {
          color: '#8fd8ff', life: 0.55
        });
        return;
      }
    }

    this.hp -= amount;
    this.hitFlash = 1;

    const ang = angleTo(srcX, srcY, this.x, this.y);
    const kb = 150 / this.mass;
    this.kx += Math.cos(ang) * kb;
    this.ky += Math.sin(ang) * kb;

    this.game.particles.hitSpark(
      lerp(srcX, this.x, 0.75), lerp(srcY, this.y, 0.75),
      ang + Math.PI, this.colors[1]
    );

    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.game.particles.deathBurst(this.x, this.y, this.colors, this.r / 16);
    this.game.particles.burst(this.x, this.y, 10, {
      speed: 120, life: 0.6, size: 5, color: '#ffffff',
      colors: ['#ffffff', this.colors[1], this.colors[0]], drag: 2.2
    });
    this.game.onEnemyKilled(this);
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    /* 影子 */
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(2, 7, this.r * 1.02, this.r * 0.55, 0, 0, TAU);
    ctx.fill();

    /* 出场动画：从地面升起 + 召唤环 */
    const st = clamp(this.spawnT / this.spawnDur, 0, 1);
    if (st < 1) {
      ctx.globalAlpha = 1 - st;
      ctx.strokeStyle = this.colors[1];
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, this.r * (0.6 + st * 2.6), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const s = this.spawnScale;
    ctx.scale(s, s);
    ctx.globalAlpha = st < 1 ? 0.35 + 0.65 * st : 1;

    this.onDraw(ctx);

    /* 精英词缀光环 */
    if (this.affix && this.affix.length) {
      const col = ELITE_AFFIX[this.affix[0]] ? ELITE_AFFIX[this.affix[0]].color : '#ff8a5c';
      ctx.save();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(this.animT * 3);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -this.animT * 14;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 7, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* 护盾环（盾持者提供） */
    if (this.shield > 0) {
      ctx.save();
      ctx.globalAlpha = 0.42 + 0.2 * Math.sin(this.animT * 5);
      ctx.strokeStyle = '#8fd8ff';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 4.5, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#8fd8ff';
      ctx.fill();
      ctx.restore();
    }

    /* 受击白闪 */
    if (this.hitFlash > 0) {
      ctx.globalAlpha = this.hitFlash * 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.05, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    /* 血条（受伤后才显示） */
    if (this.hp < this.maxHp && !this.dead) {
      const w = this.r * 2.1, h = 4;
      const bx = this.x - w * 0.5, by = this.y - this.r - 12;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
      ctx.fillStyle = '#3a1f26';
      ctx.fillRect(bx, by, w, h);
      ctx.fillStyle = this.colors[2] || '#ff6b6b';
      ctx.fillRect(bx, by, w * clamp(this.hp / this.maxHp, 0, 1), h);
    }
  }

  /* --- 子类实现 --- */
  onUpdate(dt) {}
  onDraw(ctx) {}

  /* 朝目标平滑转向 */
  steerTo(tx, ty, speed, dt, turnRate) {
    const want = angleTo(this.x, this.y, tx, ty);
    this.face = turnRate ? angleLerp(this.face, want, Math.min(1, turnRate * dt)) : want;
    this.vx = Math.cos(this.face) * speed;
    this.vy = Math.sin(this.face) * speed;
  }
}

/* ===========================================================
   1. 灰噬体 · Chaser
   不断追踪玩家；靠近后短暂缩身蓄力，然后高速扑击
   =========================================================== */
class Chaser extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '灰噬体',
      r: 16,
      hp: 34,
      speed: 116,
      touchDamage: 7,
      touchInterval: 0.75,
      mass: 1,
      rng: rng,
      colors: ['#53655a', '#c8ff6a', '#9ad14f']
    });
    this.lungeDamage = 12;
    this.state = 'chase';
    this.stateT = 0;
    this.lungeCd = this.rng.range(0.4, 1.4);
    this.lungeDir = 0;
    this.wob = this.rng.range(0, TAU);
  }

  applyTier(tier) {
    super.applyTier(tier);
    this.lungeDamage = Math.round(this.lungeDamage * (1 + Math.min(0.05 * tier, 0.6)));
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    this.wob += dt * 5.5;

    if (this.state === 'chase') {
      this.lungeCd -= dt;
      /* 蛇形追踪 */
      const a = angleTo(this.x, this.y, p.x, p.y) + Math.sin(this.wob) * 0.28;
      this.face = angleLerp(this.face, a, Math.min(1, 8 * dt));
      this.vx = Math.cos(this.face) * this.speed;
      this.vy = Math.sin(this.face) * this.speed;
      this.tryTouchDamage(this.touchDamage);

      if (d < 130 && this.lungeCd <= 0) {
        this.state = 'windup';
        this.stateT = 0.28;
        this.vx = 0; this.vy = 0;
      }
    } else if (this.state === 'windup') {
      this.stateT -= dt;
      this.vx *= 0.82; this.vy *= 0.82;
      this.face = angleLerp(this.face, angleTo(this.x, this.y, p.x, p.y), Math.min(1, 10 * dt));
      if (this.stateT <= 0) {
        this.lungeDir = angleTo(this.x, this.y, p.x, p.y);
        this.state = 'lunge';
        this.stateT = 0.26;
        this.lungeCd = this.rng.range(1.5, 2.4);
        this.game.particles.burst(this.x, this.y, 6, {
          speed: 90, life: 0.3, size: 3, color: '#c8ff6a', dir: this.lungeDir + Math.PI, spread: 1.5
        });
      }
    } else if (this.state === 'lunge') {
      this.stateT -= dt;
      const sp = this.speed * 3.1;
      this.vx = Math.cos(this.lungeDir) * sp;
      this.vy = Math.sin(this.lungeDir) * sp;
      if (Math.random() < dt * 30) this.game.particles.trail(this.x, this.y, 'rgba(200,255,106,0.28)', 5);
      this.tryTouchDamage(this.lungeDamage, 6);
      if (this.stateT <= 0) {
        this.state = 'chase';
        this.stateT = 0;
      }
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const lunging = this.state === 'lunge';
    const winding = this.state === 'windup';

    /* 腿（抖动的尖刺） */
    ctx.strokeStyle = '#33423a';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const a = t * (lunging ? 3.2 : 1.1) + (i / 5) * TAU;
      const len = this.r + 7 + Math.sin(t * 9 + i * 1.7) * 3.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.r * 0.4, Math.sin(a) * this.r * 0.4);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }

    ctx.save();
    ctx.rotate(this.face);

    /* 身体 */
    const squash = winding ? 0.86 : 1;
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 1.04 * (2 - squash), this.r * 0.92 * squash, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#7d8f80';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 背甲弧线 */
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(-this.r * 0.2, 0, this.r * 0.72, -1.1, 1.1);
    ctx.stroke();

    /* 噬口（朝向前方，蓄力/扑击时张开） */
    const open = lunging ? 1 : (winding ? 0.55 : 0.28 + 0.08 * Math.sin(t * 4));
    ctx.fillStyle = '#20160f';
    ctx.beginPath();
    ctx.moveTo(this.r * 0.34, 0);
    ctx.arc(this.r * 0.34, 0, this.r * 0.78, -open * 1.0, open * 1.0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = lunging ? '#ffe066' : '#ff9d3c';
    ctx.beginPath();
    ctx.moveTo(this.r * 0.5, 0);
    ctx.arc(this.r * 0.5, 0, this.r * 0.44, -open * 0.72, open * 0.72);
    ctx.closePath();
    ctx.fill();

    /* 两颗眼点 */
    ctx.fillStyle = '#e9ffb0';
    ctx.beginPath(); ctx.arc(this.r * 0.1, -this.r * 0.5, 2.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(this.r * 0.1, this.r * 0.5, 2.4, 0, TAU); ctx.fill();

    ctx.restore();
  }
}

/* ===========================================================
   2. 棱目 · Shooter
   维持中距离，横向游走，蓄能后射出三连棱晶
   =========================================================== */
class Shooter extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '棱目',
      r: 18,
      hp: 28,
      speed: 92,
      touchDamage: 5,
      touchInterval: 1.0,
      mass: 0.85,
      rng: rng,
      colors: ['#3a4a66', '#7fe4ff', '#5aa9ff']
    });
    this.keepMin = 190;
    this.keepMax = 330;
    this.strafeDir = this.rng.chance(0.5) ? 1 : -1;
    this.strafeT = this.rng.range(0.8, 1.8);
    this.cd = this.rng.range(0.7, 1.5);
    this.aimT = 0;               // 蓄能进度 0..1
    this.aiming = false;
    this.bulletDamage = 8;
    this.bob = this.rng.range(0, TAU);
  }

  applyTier(tier) {
    super.applyTier(tier);
    this.bulletDamage = Math.round(this.bulletDamage * (1 + Math.min(0.05 * tier, 0.6)));
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const toP = angleTo(this.x, this.y, p.x, p.y);
    this.face = angleLerp(this.face, toP, Math.min(1, 6 * dt));
    this.bob += dt * 2.4;

    /* 距离控制 */
    let mx = 0, my = 0;
    if (d < this.keepMin) {
      mx = -Math.cos(toP); my = -Math.sin(toP);      // 后退
    } else if (d > this.keepMax) {
      mx = Math.cos(toP); my = Math.sin(toP);         // 靠近
    } else {
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = this.rng.range(1.0, 2.2); }
      mx = Math.cos(toP + Math.PI / 2) * this.strafeDir;
      my = Math.sin(toP + Math.PI / 2) * this.strafeDir;
    }
    const len = Math.hypot(mx, my) || 1;
    const sp = this.speed * (this.aiming ? 0.35 : 1);
    this.vx = (mx / len) * sp;
    this.vy = (my / len) * sp;

    /* 开火循环 */
    if (!this.aiming) {
      this.cd -= dt;
      if (this.cd <= 0 && d < 520) {
        this.aiming = true;
        this.aimT = 0;
      }
    } else {
      this.aimT += dt / 0.55;
      if (this.aimT >= 1) {
        this.fire();
        this.aiming = false;
        this.cd = this.rng.range(1.6, 2.4);
      }
    }

    this.tryTouchDamage(this.touchDamage);
  }

  fire() {
    const p = this.game.player;
    const base = angleTo(this.x, this.y, p.x, p.y);
    const n = 3;
    const spread = 0.17;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * spread;
      this.game.spawnProjectile({
        x: this.x + Math.cos(a) * (this.r + 6),
        y: this.y + Math.sin(a) * (this.r + 6),
        angle: a,
        speed: 315,
        damage: this.bulletDamage,
        r: 6,
        friendly: false,
        color: '#7fe4ff',
        core: '#ffffff',
        life: 3.0,
        spin: 9
      });
    }
    this.game.particles.burst(this.x + Math.cos(base) * this.r, this.y + Math.sin(base) * this.r, 6, {
      speed: 120, life: 0.3, size: 3, color: '#aef0ff', dir: base, spread: 1.2
    });
  }

  onDraw(ctx) {
    const t = this.animT;
    const float = Math.sin(this.bob) * 3;

    /* 悬浮光环 */
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = this.colors[1];
    ctx.beginPath();
    ctx.ellipse(0, 9, this.r * 0.8, this.r * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.translate(0, float);

    /* 环绕碎片 */
    for (let i = 0; i < 3; i++) {
      const a = t * 1.6 + (i / 3) * TAU;
      const rr = this.r + 11;
      const sx = Math.cos(a) * rr, sy = Math.sin(a) * rr * 0.55;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a);
      ctx.fillStyle = this.colors[0];
      polygonPath(ctx, [[0, -5], [4, 4], [-4, 4]]);
      ctx.fill();
      ctx.strokeStyle = this.colors[1];
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    /* 棱形本体 */
    ctx.rotate(Math.sin(t * 0.9) * 0.12);
    ctx.fillStyle = this.colors[0];
    polygonPath(ctx, [
      [0, -this.r * 1.15],
      [this.r * 0.95, 0],
      [0, this.r * 1.15],
      [-this.r * 0.95, 0]
    ]);
    ctx.fill();
    ctx.strokeStyle = this.colors[1];
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 单眼 */
    const eyeR = this.r * 0.52;
    const px = Math.cos(this.face) * 3.2, py = Math.sin(this.face) * 3.2;
    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath(); ctx.arc(0, 0, eyeR, 0, TAU); ctx.fill();
    ctx.fillStyle = this.aiming ? '#ff7a4d' : '#2b3a55';
    ctx.beginPath(); ctx.arc(px, py, eyeR * 0.52, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0a0f18';
    ctx.beginPath(); ctx.arc(px * 1.25, py * 1.25, eyeR * 0.24, 0, TAU); ctx.fill();

    /* 蓄能提示 */
    if (this.aiming) {
      ctx.save();
      ctx.rotate(this.face);
      const g = this.aimT;
      ctx.globalAlpha = 0.22 + 0.5 * g;
      ctx.strokeStyle = '#ff8a5c';
      ctx.lineWidth = 1 + 2 * g;
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(this.r + 40 + g * 130, 0);
      ctx.stroke();
      ctx.restore();

      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 30);
      ctx.strokeStyle = '#ffb08a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, this.r * (1.2 + 0.35 * (1 - g)), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

/* ===========================================================
   3. 锥锋 · Charger
   缓慢逼近 → 原地蓄力（带预警线）→ 高速直线冲锋 → 硬直
   =========================================================== */
class Charger extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '锥锋',
      r: 19,
      hp: 54,
      speed: 104,
      touchDamage: 15,
      touchInterval: 0.9,
      mass: 1.5,
      rng: rng,
      colors: ['#6b2f3a', '#ff6b5c', '#ff3b57']
    });
    this.state = 'stalk';
    this.stateT = this.rng.range(0.5, 1.2);
    this.dashDir = 0;
    this.dashSpeed = 760;
    this.lastX = x;
    this.lastY = y;
    this.dashElapsed = 0;
    this.hitWall = false;
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);

    if (this.state === 'stalk') {
      this.stateT -= dt;
      /* 缓慢逼近，稍微绕圈 */
      const a = angleTo(this.x, this.y, p.x, p.y) + Math.sin(this.animT * 1.3) * 0.4;
      this.face = angleLerp(this.face, a, Math.min(1, 5 * dt));
      const sp = this.speed * (d > 260 ? 1 : 0.55);
      this.vx = Math.cos(this.face) * sp;
      this.vy = Math.sin(this.face) * sp;
      this.tryTouchDamage(Math.round(this.touchDamage * 0.45));

      if (this.stateT <= 0 && d < 520) {
        this.state = 'windup';
        this.stateT = 0.7;
      }
    } else if (this.state === 'windup') {
      this.stateT -= dt;
      this.vx *= 0.7; this.vy *= 0.7;
      this.face = angleLerp(this.face, angleTo(this.x, this.y, p.x, p.y), Math.min(1, 7 * dt));
      if (Math.random() < dt * 26) {
        this.game.particles.spawn(
          this.x + rand(-14, 14), this.y + rand(-14, 14),
          rand(-30, 30), rand(-30, 30), rand(0.2, 0.4), rand(2, 4),
          'rgba(255,90,80,0.5)', { drag: 3 }
        );
      }
      if (this.stateT <= 0) {
        this.dashDir = angleTo(this.x, this.y, p.x, p.y);
        this.state = 'dash';
        this.stateT = 0.42;
        this.dashElapsed = 0;
        this.lastX = this.x; this.lastY = this.y;
        this.game.particles.burst(this.x, this.y, 10, {
          speed: 200, life: 0.35, size: 4, color: '#ff6b5c',
          dir: this.dashDir + Math.PI, spread: 1.1
        });
      }
    } else if (this.state === 'dash') {
      this.stateT -= dt;
      this.dashElapsed += dt;
      this.face = this.dashDir;
      this.vx = Math.cos(this.dashDir) * this.dashSpeed;
      this.vy = Math.sin(this.dashDir) * this.dashSpeed;

      /* 撞墙检测：本帧实际位移远小于预期即为撞墙 */
      const moved = dist(this.lastX, this.lastY, this.x, this.y);
      const expect = this.dashSpeed * dt;
      this.lastX = this.x; this.lastY = this.y;

      if (Math.random() < dt * 45) {
        this.game.particles.trail(this.x, this.y, 'rgba(255,80,70,0.35)', 9);
      }
      this.tryTouchDamage(this.touchDamage, 4);

      if (this.dashElapsed > 0.08 && moved < expect * 0.5) {
        this.state = 'stagger';
        this.stateT = 0.85;
        this.vx = 0; this.vy = 0;
        this.game.particles.burst(this.x, this.y, 12, {
          speed: 220, life: 0.5, size: 4, color: '#ffd0b0',
          colors: ['#ffd0b0', '#ff8a6a', '#ffffff']
        });
        this.game.addShake(3);
        this.game.damageNumbers.add(this.x, this.y - this.r - 8, '撞击', {
          color: '#ffc0a0', life: 0.7
        });
      }

      if (this.stateT <= 0 && this.state === 'dash') {
        this.state = 'recover';
        this.stateT = 0.6;
      }
    } else if (this.state === 'recover' || this.state === 'stagger') {
      this.stateT -= dt;
      this.vx *= 0.86; this.vy *= 0.86;
      if (this.stateT <= 0) {
        this.state = 'stalk';
        this.stateT = this.rng.range(0.9, 1.7);
      }
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const winding = this.state === 'windup';
    const dashing = this.state === 'dash';
    const staggering = this.state === 'stagger';

    /* 蓄力预警线 */
    if (winding) {
      const g = 1 - this.stateT / 0.7;
      ctx.save();
      ctx.rotate(this.face);
      ctx.globalAlpha = 0.2 + 0.45 * g;
      ctx.strokeStyle = '#ff5a4d';
      ctx.lineWidth = 2 + 3 * g;
      ctx.setLineDash([14, 10]);
      ctx.lineDashOffset = -t * 60;
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(this.r + 520 * (0.35 + 0.65 * g), 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* 抖动 */
    if (winding) {
      ctx.translate(rand(-2.4, 2.4), rand(-2.4, 2.4));
    }

    ctx.rotate(this.face);

    /* 尾焰 / 拖影 */
    if (dashing) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = this.colors[1];
      polygonPath(ctx, [
        [-this.r * 1.1, -this.r * 0.5],
        [-this.r * 2.6, 0],
        [-this.r * 1.1, this.r * 0.5]
      ]);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    /* 楔形本体 */
    const stretch = dashing ? 1.35 : (winding ? 0.9 : 1);
    ctx.fillStyle = this.colors[0];
    polygonPath(ctx, [
      [this.r * 1.45 * stretch, 0],
      [-this.r * 0.85, -this.r * 0.95],
      [-this.r * 0.5, 0],
      [-this.r * 0.85, this.r * 0.95]
    ]);
    ctx.fill();
    ctx.strokeStyle = staggering ? '#ffd0b0' : this.colors[1];
    ctx.lineWidth = 2.2;
    ctx.stroke();

    /* 甲片 */
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-this.r * 0.2, -this.r * 0.62);
    ctx.lineTo(this.r * 0.5, 0);
    ctx.lineTo(-this.r * 0.2, this.r * 0.62);
    ctx.stroke();

    /* 尖端（蓄力 / 冲锋时炽亮） */
    const tipGlow = dashing ? 1 : (winding ? 0.5 + 0.5 * Math.sin(t * 26) : 0.35);
    ctx.globalAlpha = tipGlow;
    ctx.fillStyle = dashing ? '#fff2c8' : '#ff8a5c';
    polygonPath(ctx, [
      [this.r * 1.45 * stretch, 0],
      [this.r * 0.55, -this.r * 0.34],
      [this.r * 0.55, this.r * 0.34]
    ]);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 侧部能量点 */
    ctx.fillStyle = dashing ? '#ffe9a0' : '#ff5a4d';
    ctx.beginPath(); ctx.arc(-this.r * 0.1, -this.r * 0.55, 2.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-this.r * 0.1, this.r * 0.55, 2.6, 0, TAU); ctx.fill();
  }
}

/* ===========================================================
   4. 回廊守望者 · Warden（Boss）
   三形态：环形弹幕 / 旋转螺旋弹 / 蓄力冲撞，血量阈值召唤残形
   =========================================================== */
class Warden extends Enemy {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '回廊守望者',
      r: 34,
      hp: 460,
      speed: 88,
      touchDamage: 16,
      touchInterval: 0.8,
      mass: 6,
      rng: rng,
      colors: ['#4a2b52', '#ff6bd0', '#ff4d6b']
    });
    this.isBoss = true;
    this.phase = 1;
    this.state = 'hover';
    this.stateT = this.rng.range(0.6, 1.2);
    this.cd = 1.4;
    this.spiralAngle = this.rng.range(0, TAU);
    this.spiralShots = 0;
    this.ringLeft = 0;
    this.dashDir = 0;
    this.spin = 0;
    this.summoned = 0;
  }

  _bullet(angle, speed, r, damage) {
    return {
      x: this.x + Math.cos(angle) * (this.r + 8),
      y: this.y + Math.sin(angle) * (this.r + 8),
      angle: angle,
      speed: speed,
      damage: damage,
      r: r || 7,
      friendly: false,
      color: '#ff6bd0',
      core: '#ffe0f5',
      life: 4.0,
      spin: 6
    };
  }

  _ring(count, speed, offset) {
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * TAU;
      this.game.spawnProjectile(this._bullet(a, speed, 7, 9));
    }
    this.game.particles.ring(this.x, this.y, '#ff6bd0', count, 220);
  }

  onUpdate(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    this.spin += dt * 0.9;

    /* 形态切换 */
    const ratio = this.hp / this.maxHp;
    const wantPhase = ratio > 0.66 ? 1 : (ratio > 0.33 ? 2 : 3);
    if (wantPhase !== this.phase) {
      this.phase = wantPhase;
      this.state = 'hover';
      this.stateT = 0.7;
      this.game.addShake(6);
      this.game.particles.ring(this.x, this.y, '#ff4d6b', 30, 280);
      this.game.ui.showBanner('守望者 · 形态 ' + wantPhase, '回廊开始崩解', 1.4);
      /* 召唤残形 */
      const n = wantPhase === 2 ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const room = this.game.room;
        if (room && this.summoned < 8) {
          const e = room._spawnEnemy(wantPhase === 3 && i === 0 ? 'charger' : 'chaser');
          if (e) { e.spawnT = e.spawnDur * 0.6; this.summoned++; }
        }
      }
    }

    const speedMul = 1 + (this.phase - 1) * 0.35;

    if (this.state === 'hover') {
      /* 缓慢逼近并保持中距 */
      const a = angleTo(this.x, this.y, p.x, p.y);
      const sp = this.speed * speedMul * (d > 300 ? 1 : (d < 200 ? -0.5 : 0.25));
      this.face = angleLerp(this.face, a, Math.min(1, 3 * dt));
      this.vx = Math.cos(a) * Math.max(0, sp) + Math.cos(a + Math.PI / 2) * 40 * Math.sin(this.animT * 1.2);
      this.vy = Math.sin(a) * Math.max(0, sp) + Math.sin(a + Math.PI / 2) * 40 * Math.sin(this.animT * 1.2);
      this.tryTouchDamage(this.touchDamage);

      this.stateT -= dt;
      if (this.stateT <= 0) {
        const roll = this.rng.next();
        if (roll < 0.36) { this.state = 'ring'; this.stateT = 0.55; this.ringLeft = this.phase >= 2 ? 3 : 2; }
        else if (roll < 0.68) { this.state = 'spiral'; this.stateT = 1.5; this.spiralShots = 0; }
        else { this.state = 'windup'; this.stateT = 0.6; }
      }
    } else if (this.state === 'ring') {
      this.stateT -= dt;
      this.vx *= 0.85; this.vy *= 0.85;
      if (this.stateT <= 0) {
        this._ring(this.phase >= 3 ? 18 : 14, 250, this.rng.range(0, TAU));
        this.ringLeft--;
        if (this.ringLeft > 0) this.stateT = 0.28;
        else { this.state = 'hover'; this.stateT = 0.9; }
      }
    } else if (this.state === 'spiral') {
      this.stateT -= dt;
      this.vx *= 0.9; this.vy *= 0.9;
      this.spiralAngle += dt * 3.4 * speedMul;
      this.spiralShots -= dt;
      if (this.spiralShots <= 0) {
        this.spiralShots = 0.075;
        for (let i = 0; i < (this.phase >= 2 ? 3 : 2); i++) {
          const a = this.spiralAngle + (i / (this.phase >= 2 ? 3 : 2)) * TAU;
          this.game.spawnProjectile(this._bullet(a, 300, 6, 8));
        }
      }
      if (this.stateT <= 0) { this.state = 'hover'; this.stateT = 1.0; }
    } else if (this.state === 'windup') {
      this.stateT -= dt;
      this.vx *= 0.8; this.vy *= 0.8;
      this.face = angleLerp(this.face, angleTo(this.x, this.y, p.x, p.y), Math.min(1, 6 * dt));
      if (Math.random() < dt * 30) {
        this.game.particles.spawn(this.x + rand(-24, 24), this.y + rand(-24, 24),
          rand(-40, 40), rand(-40, 40), rand(0.2, 0.45), rand(3, 6),
          'rgba(255,90,170,0.55)', { drag: 3 });
      }
      if (this.stateT <= 0) {
        this.dashDir = angleTo(this.x, this.y, p.x, p.y);
        this.state = 'dash';
        this.stateT = 0.5;
        this.game.addShake(2);
      }
    } else if (this.state === 'dash') {
      this.stateT -= dt;
      this.face = this.dashDir;
      const sp = 620 * speedMul;
      this.vx = Math.cos(this.dashDir) * sp;
      this.vy = Math.sin(this.dashDir) * sp;
      if (Math.random() < dt * 50) {
        this.game.particles.trail(this.x, this.y, 'rgba(255,90,170,0.35)', 12);
      }
      this.tryTouchDamage(Math.round(this.touchDamage * 1.4), 6);
      if (this.stateT <= 0) { this.state = 'hover'; this.stateT = 1.1; }
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const winding = this.state === 'windup';
    const dashing = this.state === 'dash';

    /* 蓄力预警 */
    if (winding) {
      const g = 1 - this.stateT / 0.6;
      ctx.save();
      ctx.rotate(this.face);
      ctx.globalAlpha = 0.25 + 0.45 * g;
      ctx.strokeStyle = '#ff4d6b';
      ctx.lineWidth = 3 + 3 * g;
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = -t * 70;
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(this.r + 600 * (0.4 + 0.6 * g), 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* 外环旋转护板 */
    ctx.save();
    ctx.rotate(this.spin);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = i % 2 ? '#5c3566' : '#3b2244';
      polygonPath(ctx, [
        [this.r + 16, -9],
        [this.r + 30, 0],
        [this.r + 16, 9],
        [this.r + 4, 0]
      ]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,107,208,0.5)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    /* 主体 */
    ctx.save();
    if (winding) ctx.translate(rand(-2, 2), rand(-2, 2));
    const pulse = 1 + Math.sin(t * 2.4) * 0.04;
    ctx.scale(pulse, pulse);

    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, this.r * 1.5);
    g.addColorStop(0, '#ffd0ee');
    g.addColorStop(0.35, '#ff6bd0');
    g.addColorStop(1, 'rgba(74,43,82,0.15)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.05, 0, TAU);
    ctx.fill();

    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.78, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#ff6bd0';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    /* 三只眼（形态越多睁得越多） */
    for (let i = 0; i < 3; i++) {
      const open = i < this.phase;
      const a = -Math.PI / 2 + (i - 1) * 0.7;
      const ex = Math.cos(a) * this.r * 0.4;
      const ey = Math.sin(a) * this.r * 0.4;
      ctx.fillStyle = open ? '#fff0fb' : '#2b1b30';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 7, open ? 6 : 2, a, 0, TAU);
      ctx.fill();
      if (open) {
        ctx.fillStyle = '#ff2d6b';
        const pa = angleTo(ex, ey, this.game.player.x - this.x, this.game.player.y - this.y);
        ctx.beginPath();
        ctx.arc(ex + Math.cos(pa) * 2.2, ey + Math.sin(pa) * 2.2, 3, 0, TAU);
        ctx.fill();
      }
    }

    /* 核心裂纹（血量越低越亮） */
    const hurt = 1 - this.hp / this.maxHp;
    ctx.globalAlpha = 0.3 + hurt * 0.6;
    ctx.strokeStyle = dashing ? '#ffffff' : '#ff4d6b';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = t * 0.6 + (i / 4) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
      ctx.lineTo(Math.cos(a) * this.r * 0.7, Math.sin(a) * this.r * 0.7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/* ===========================================================
   敌人工厂（注册表驱动）
   —— 新增敌人 = 在 enemy_roster.js 里 EnemyFactory.register(...)
   —— 这里只登记最初的三只 + Boss，其余在 roster 中追加
   =========================================================== */
const EnemyFactory = {
  registry: {},

  register(id, cls, def) {
    this.registry[id] = { cls: cls, def: def || {} };
  },

  defOf(type) {
    const r = this.registry[type];
    return r ? r.def : {};
  },

  /* 出生点半径（房间生成时用） */
  radiusOf(type) {
    const d = this.defOf(type);
    return d.r || (type === 'boss' ? 34 : 16);
  },

  create(game, type, x, y, tier, rng) {
    const reg = this.registry[type];
    let e = null;
    if (reg) {
      e = new reg.cls(game, x, y, rng);
    } else {
      /* 未注册类型的兜底（不应该发生） */
      e = new Chaser(game, x, y, rng);
    }
    e.type = type;
    const d = this.defOf(type);
    if (d.coin) e.coinBonus = d.coin;
    e.applyTier(tier || 0);
    return e;
  }
};

/* 注意：这三只最初的敌人也要登记 cat / cost / minDepth，
   否则新的编队系统会把它们排除在生成池之外 */
EnemyFactory.register('chaser', Chaser, {
  r: 16, cat: 'melee', role: 'chase', cost: 2, minDepth: 0, tags: ['mobile'], coin: 0
});
EnemyFactory.register('shooter', Shooter, {
  r: 18, cat: 'ranged', role: 'burst', cost: 3, minDepth: 0, tags: [], coin: 1
});
EnemyFactory.register('charger', Charger, {
  r: 19, cat: 'melee', role: 'charge', cost: 4, minDepth: 0, tags: ['mobile'], coin: 3
});
EnemyFactory.register('boss', Warden, { r: 34, coin: 0, hidden: true, cat: 'boss' });
