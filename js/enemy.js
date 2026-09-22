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
    this.hpGhost = cfg.hp;               // 血条的延迟层（表现用，缓慢追平 hp）
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
    this.spreadFire = 0;             // 附加弹数量（由章节弹幕复杂度写入）
    this._spreadCd = 0;
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
    this.hpGhost = this.maxHp;
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
    const main = this.game.spawnProjectile({
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

    /* 章节弹幕复杂度：主弹附带扇形附加弹
       带节流（≤0.14s 一次），所以环形 / 扇形大招不会被成倍放大到无法躲避 */
    if (this.spreadFire > 0 && !opt.isExtra) {
      this._spreadCd = this._spreadCd || 0;
      if (this._spreadCd <= 0) {
        this._spreadCd = 0.14;
        for (let i = 1; i <= this.spreadFire; i++) {
          const side = (i % 2 === 0) ? 1 : -1;
          const a = angle + side * 0.26 * Math.ceil(i / 2);
          const extra = Object.assign({}, opt, { isExtra: true, damage: (opt.damage === undefined ? 8 : opt.damage) * 0.7 });
          this.fireBullet(a, extra);
        }
      }
    }
    return main;
  }

  /* 章节难度缩放（五章各自一套节奏）
     不靠单纯堆 HP：HP 缓慢成长，攻击节奏 / 移速 / 弹幕复杂度 / 词缀渗透同步上升。
     Boss 只吃一半的成长幅度（它本身靠阶段变化变强）。 */
  applyChapterScale(ch) {
    if (!ch || !ch.scale) return;
    const s = ch.scale;
    const boss = !!this.isBoss;

    const hpMul = 1 + ((s.hp || 1) - 1) * (boss ? 0.5 : 1);
    const rateMul = 1 + ((s.rate || 1) - 1) * (boss ? 0.6 : 1);
    const spdMul = 1 + ((s.speed || 1) - 1) * (boss ? 0.5 : 1);

    this.maxHp = Math.round(this.maxHp * hpMul);
    this.hp = this.maxHp;
    this.hpGhost = this.maxHp;
    this.speed *= spdMul;
    this.baseSpeed = this.speed;

    /* 攻击节奏：所有冷却类字段整体缩短（AI 代码不需要改动） */
    if (rateMul > 1.001) {
      const f = 1 / rateMul;
      for (const k in this) {
        const v = this[k];
        if (typeof v === 'number' && v > 0.08 && /(Cd|Interval)$/.test(k)) this[k] = v * f;
      }
    }

    if (boss) return;
    const pool = ch.pool || {};

    /* 弹幕复杂度：普通射击型敌人的主弹附带扇形附加弹（弹幕型敌人不加，避免无解） */
    if (pool.spread > 0) {
      const d = EnemyFactory.defOf(this.type);
      const tags = (d && d.tags) || [];
      if (tags.indexOf('bullethell') < 0) this.spreadFire = pool.spread;
    }

    /* 深层：普通敌人也可能自带精英词缀 */
    if (pool.affix > 0 && !this.affix && this.rng.chance(pool.affix)) {
      const keys = Object.keys(ELITE_AFFIX);
      this.applyAffixes([this.rng.pick(keys)]);
    }
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
    if (this._spreadCd > 0) this._spreadCd -= dt;
    if (!this.spawned && this.spawnT >= this.spawnDur) {
      this.spawned = true;
      this.game.particles.ring(this.x, this.y, this.colors[1], 10, 110);
    }

    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    if (this.touchTimer > 0) this.touchTimer -= dt;
    /* 血条延迟层：慢慢追平真实血量（让玩家看清这一击掉了多少） */
    if (this.hpGhost === undefined) this.hpGhost = this.hp;
    else if (this.hpGhost > this.hp) this.hpGhost = Math.max(this.hp, this.hpGhost - dt * this.maxHp * 0.55);
    else if (this.hpGhost < this.hp) this.hpGhost = this.hp;   // 回血时立即跟上

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

    /* 击退：伤害越高推得越狠，但按质量衰减（Boss 几乎推不动） */
    const ang = angleTo(srcX, srcY, this.x, this.y);
    const kb = (95 + Math.min(amount, 70) * 2.4) / this.mass;
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
    /* 死亡演出：碎裂 + 冲击波（大体积 / Boss 额外爆一团）—— 见 juice.js */
    if (typeof Juice !== 'undefined') Juice.death(this.game, this);
    else this.game.particles.deathBurst(this.x, this.y, this.colors, this.r / 16);
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

    /* 受击白闪：叠加式高光，命中瞬间最亮，快速衰减 */
    if (this.hitFlash > 0) {
      const hf = this.hitFlash;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = hf * 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.06, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = hf * 0.5;
      ctx.fillStyle = '#ffe9c0';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 1.22, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    /* 血条（受伤后才显示；Boss 走 UI 顶部大血条，这里跳过）
       双层：亮色 = 刚掉的血（延迟回落），实色 = 当前血 —— 一眼看出这一击打掉了多少 */
    if (this.hp < this.maxHp && !this.dead && !this.noSmallBar && !this.dying) {
      const w = Math.max(26, this.r * 2.1), h = 4;
      const bx = this.x - w * 0.5, by = this.y - this.r - 13;
      const ratio = clamp(this.hp / this.maxHp, 0, 1);
      const ghost = clamp((this.hpGhost === undefined ? this.hp : this.hpGhost) / this.maxHp, 0, 1);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(bx - 1.5, by - 1.5, w + 3, h + 3);
      ctx.fillStyle = '#2a1218';
      ctx.fillRect(bx, by, w, h);
      /* 延迟层 */
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.fillRect(bx, by, w * Math.max(ghost, ratio), h);
      /* 当前血量 */
      ctx.fillStyle = this.colors[2] || '#ff6b6b';
      ctx.fillRect(bx, by, w * ratio, h);
      ctx.restore();
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
   Boss 系统 · 通用组件与基类
   -----------------------------------------------------------
   所有 Boss 一律遵守的设计约定：
     1. 三阶段：HP 降到 70% / 40% 时必定触发阶段变化
     2. 阶段变化 = 攻击方式变化 + 攻击频率提高 + 解锁新弹幕模式
     3. 每种攻击都有明确预警（预警线 / 预警圈 / 预警扇形），不存在无法躲避的攻击
     4. 攻击类型覆盖：环形 / 扇形 / 螺旋 / 追踪 / 激光 / 冲刺 / 地面危险区域 / 召唤
     5. 死亡必须先播完死亡动画，再真正从场上移除
   =========================================================== */

/* -----------------------------------------------------------
   地面危险区域：预警圈 → 生效 → 消散（走开就能躲）
   ----------------------------------------------------------- */
class BossHazard {
  constructor(boss, x, y, opt) {
    opt = opt || {};
    this.boss = boss;
    this.game = boss.game;
    this.x = x; this.y = y;
    this.r = opt.r || 64;
    this.r0 = this.r;
    this.warn = opt.warn !== undefined ? opt.warn : 0.85;   // 预警时长
    this.active = opt.active !== undefined ? opt.active : 2.4;
    this.dmg = opt.dmg || 12;
    this.color = opt.color || '#ff8a5c';
    this.grow = opt.grow || 0;                              // 半径增长（熔岩扩张）
    this.tickGap = opt.tickGap !== undefined ? opt.tickGap : 0.75;
    this.hatch = opt.hatch || null;                         // 到期孵化（召唤机制）
    this.drift = opt.drift || null;                         // 漂移（龙卷）
    this.t = 0;
    this.tickT = 0;
    this.dead = false;
  }

  update(dt) {
    this.t += dt;
    if (this.drift) { this.x += this.drift.x * dt; this.y += this.drift.y * dt; }
    if (this.t < this.warn) return;
    if (this.grow) this.r = Math.min(this.r0 * 2.6, this.r + this.grow * dt);
    this.tickT -= dt;
    const p = this.game.player;
    if (p && !p.dead && this.tickT <= 0) {
      const rr = this.r + p.r * 0.35;
      if (dist2(this.x, this.y, p.x, p.y) <= rr * rr) {
        p.takeDamage(this.dmg, this.x, this.y);
        this.tickT = this.tickGap;
      }
    }
    if (this.t >= this.warn + this.active) {
      this.dead = true;
      if (this.hatch) this.boss.summon([this.hatch], 1);
    }
  }

  draw(ctx) {
    ctx.save();
    if (this.t < this.warn) {
      const p = clamp(this.t / this.warn, 0, 1);
      ctx.globalAlpha = 0.16 + 0.26 * p;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -this.t * 46;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.10 + 0.20 * p;
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r * p, 0, TAU); ctx.fill();
    } else {
      const left = this.warn + this.active - this.t;
      const a = clamp(left / 0.45, 0, 1);
      ctx.globalAlpha = 0.26 * a;
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.55 * a;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.12 * a;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r * 0.5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   激光：预警线 → 激发（看到线就有时间走开）
   ----------------------------------------------------------- */
class BossBeam {
  constructor(boss, opt) {
    opt = opt || {};
    this.boss = boss;
    this.game = boss.game;
    this.x = opt.x !== undefined ? opt.x : boss.x;
    this.y = opt.y !== undefined ? opt.y : boss.y;
    this.angle = opt.angle || 0;
    this.len = opt.len || 1500;
    this.width = opt.width || 18;
    this.warn = opt.warn !== undefined ? opt.warn : 0.75;
    this.active = opt.active !== undefined ? opt.active : 0.4;
    this.dmg = opt.dmg || 20;
    this.color = opt.color || '#ff4d6b';
    this.sweep = opt.sweep || 0;        // 角速度（扫射）
    this.follow = !!opt.follow;         // 是否跟随 Boss
    this.t = 0;
    this.tickT = 0;
    this.dead = false;
  }

  update(dt) {
    this.t += dt;
    if (this.sweep) this.angle += this.sweep * dt;
    if (this.follow) { this.x = this.boss.x; this.y = this.boss.y; }
    if (this.t < this.warn) return;
    this.tickT -= dt;
    const p = this.game.player;
    if (p && !p.dead && this.tickT <= 0) {
      const x2 = this.x + Math.cos(this.angle) * this.len;
      const y2 = this.y + Math.sin(this.angle) * this.len;
      if (pointSegDist(p.x, p.y, this.x, this.y, x2, y2) < this.width * 0.5 + p.r) {
        p.takeDamage(this.dmg, this.x, this.y);
        this.tickT = 0.55;
      }
    }
    if (this.t >= this.warn + this.active) this.dead = true;
  }

  draw(ctx) {
    const x2 = this.x + Math.cos(this.angle) * this.len;
    const y2 = this.y + Math.sin(this.angle) * this.len;
    ctx.save();
    if (this.t < this.warn) {
      const p = clamp(this.t / this.warn, 0, 1);
      ctx.globalAlpha = 0.22 + 0.45 * p;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.5 + 3 * p;
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = -this.t * 110;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const q = clamp((this.t - this.warn) / this.active, 0, 1);
      const a = q < 0.15 ? q / 0.15 : Math.max(0, 1 - (q - 0.15) / 0.85);
      ctx.globalAlpha = 0.26 * a;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.width * 2.0;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = 0.85 * a;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.width;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = this.width * 0.34;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   Boss 基类
   ----------------------------------------------------------- */
class BossBase extends Enemy {
  constructor(game, x, y, cfg) {
    super(game, x, y, cfg);
    this.isBoss = true;
    this.title = cfg.title || '';
    this.specialName = cfg.specialName || '';      // 特殊技能名

    /* ---- 阶段 ---- */
    this.phase = 1;
    this.maxPhase = 3;
    this.phaseNames = cfg.phaseNames || ['苏醒', '解封', '终末'];
    this.phaseLock = 0;                            // >0：阶段转换演出中
    this.phaseGates = [0.70, 0.40];                // 阶段阈值

    /* ---- 攻击调度 ---- */
    this.state = 'idle';
    this.stateT = 1.0;
    this.atkCd = 1.2;
    this.attacks = [];                             // [{id, cn, w, min}] 数据驱动
    this.telegraphText = null;                     // 供 UI 显示的当前预警
    this.orbitDir = this.rng.chance(0.5) ? 1 : -1;

    /* ---- 召唤 ---- */
    this.minions = [];
    this.summonPool = cfg.summonPool || ['chaser'];
    this.maxMinions = cfg.maxMinions || 5;
    this.summonCount = 0;

    /* ---- 场景要素 ---- */
    this.hazards = [];
    this.beams = [];

    /* ---- 受伤 / 死亡 ---- */
    this.hurtRing = 0;
    this.deathT = 0;
    this.deathDur = 2.2;
    this.deathBombT = 0;
    this.dying = false;
    this.introDone = false;

    this.noSmallBar = true;                        // 血条走 UI 的 Boss 条
    this.spawnDur = 1.25;                          // 出场更长，给玩家反应时间
  }

  /* =============== 阶段 =============== */
  get atkRate() { return 1 + (this.phase - 1) * 0.30; }     // 攻击频率提高
  get phaseSpeed() { return 1 + (this.phase - 1) * 0.20; }  // 移动 / 弹速提高

  _checkPhase() {
    const r = this.hp / this.maxHp;
    let want = 1;
    if (r <= this.phaseGates[1]) want = 3;
    else if (r <= this.phaseGates[0]) want = 2;
    if (want > this.phase) { this._enterPhase(want); return true; }
    return false;
  }

  _enterPhase(n) {
    this.phase = n;
    this.phaseLock = 1.05;
    this.state = 'idle';
    this.stateT = 0.55;
    this.atkCd = 0.55;
    this.vx = 0; this.vy = 0;

    this.game.addShake(6);
    this.game.particles.ring(this.x, this.y, this.colors[1], 34, 300);
    this.game.particles.burst(this.x, this.y, 26, {
      speed: 300, life: 0.85, size: 6,
      colors: [this.colors[1], '#ffffff', this.colors[0]]
    });
    this.game.ui.showBanner(this.name + ' · 第 ' + n + ' 阶段',
      this.phaseNames[n - 1] + ' · 攻击更快，弹幕更密', 1.7);
    this.onPhase(n);
  }

  /* =============== 更新 =============== */
  onUpdate(dt) {
    /* 0. 出场后的登场播报 */
    if (!this.introDone) {
      this.introDone = true;
      this.game.ui.showBanner(this.name, this.title, 2.4);
      this.game.addShake(4);
    }

    /* 1. 死亡动画（播完才真正移除） */
    if (this.dying) { this._updateDeath(dt); return; }

    /* 2. 阶段转换演出 */
    if (this.phaseLock > 0) {
      this.phaseLock -= dt;
      this.vx *= 0.88; this.vy *= 0.88;
      if (Math.random() < dt * 26) {
        const a = Math.random() * TAU;
        this.game.particles.spawn(
          this.x + Math.cos(a) * this.r * 1.2, this.y + Math.sin(a) * this.r * 1.2,
          Math.cos(a) * 60, Math.sin(a) * 60, rand(0.25, 0.5), rand(3, 6),
          this.colors[1], { drag: 3 }
        );
      }
      return;
    }

    /* 3. 阈值检查 */
    if (this._checkPhase()) return;

    /* 4. 场景要素 */
    this._updateHazards(dt);
    this._updateBeams(dt);
    if (this.hurtRing > 0) this.hurtRing -= dt;

    /* 5. 子类 AI */
    this.telegraphText = null;
    this.act(dt);
  }

  act(dt) {
    /* 默认行为：中距游走 */
    this.hover(dt, 220, 380);
    this.tryTouchDamage(this.touchDamage);
  }

  _updateHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.update(dt);
      if (h.dead) this.hazards.splice(i, 1);
    }
  }

  _updateBeams(dt) {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.update(dt);
      if (b.dead) this.beams.splice(i, 1);
    }
  }

  /* =============== 移动 helper =============== */
  aimAngle() {
    const p = this.game.player;
    return angleTo(this.x, this.y, p.x, p.y);
  }

  hover(dt, minD, maxD, spd) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    const a = angleTo(this.x, this.y, p.x, p.y);
    const s = (spd === undefined ? this.speed : spd) * this.phaseSpeed;
    let mx, my;
    if (d > (maxD || 360)) { mx = Math.cos(a); my = Math.sin(a); }
    else if (d < (minD || 220)) { mx = -Math.cos(a); my = -Math.sin(a); }
    else {
      mx = Math.cos(a + Math.PI / 2) * this.orbitDir;
      my = Math.sin(a + Math.PI / 2) * this.orbitDir;
    }
    this.vx = mx * s;
    this.vy = my * s;
    this.face = angleLerp(this.face, a, Math.min(1, 3.2 * dt));
    return d;
  }

  brake(k) { const f = k === undefined ? 0.86 : k; this.vx *= f; this.vy *= f; }

  /* 冲刺一步：撞墙时立刻停下并返回 'wall'（供硬直 / 震荡波用） */
  dashMove(dt, angle, speed, damage, extraRange) {
    const nx = this.x + Math.cos(angle) * speed * dt;
    const ny = this.y + Math.sin(angle) * speed * dt;
    if (this.game.room && this.game.room.hitsWall(nx, ny, this.r)) {
      this.vx = 0; this.vy = 0;
      return 'wall';
    }
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    if (Math.random() < dt * 45) {
      this.game.particles.trail(this.x, this.y, 'rgba(255,255,255,0.22)', 9);
    }
    if (damage) this.tryTouchDamage(damage, extraRange);
    return 'run';
  }

  /* =============== 弹幕 helper =============== */
  /* 环形弹幕：可留连续缺口（永远留一条能走出去的路） */
  ringShot(count, opt) {
    opt = opt || {};
    const gap = opt.gap || 0;
    const base = opt.rot !== undefined ? opt.rot : this.rng.range(0, TAU);
    const skipFrom = opt.gapAt !== undefined ? opt.gapAt : Math.floor(this.rng.next() * count);
    let fired = 0;
    for (let i = 0; i < count; i++) {
      if (gap > 0) {
        const rel = (i - skipFrom + count) % count;
        if (rel < gap) continue;
      }
      this.fireBullet(base + (i / count) * TAU, {
        speed: opt.speed || 250,
        damage: opt.damage || 9,
        r: opt.r || 7,
        color: opt.color || this.colors[1],
        core: opt.core || '#ffffff',
        life: opt.life || 4.4,
        spin: opt.spin !== undefined ? opt.spin : 6,
        homing: opt.homing || 0,
        offset: opt.dist
      });
      fired++;
    }
    this.game.particles.ring(this.x, this.y, opt.color || this.colors[1],
      Math.max(6, Math.round(count * 0.7)), 210);
    return fired;
  }

  /* 扇形弹幕 */
  fanShot(count, spread, aim, opt) {
    opt = opt || {};
    const a0 = aim === undefined ? this.aimAngle() : aim;
    const s = spread === undefined ? 0.9 : spread;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      this.fireBullet(a0 - s * 0.5 + s * t, {
        speed: opt.speed || 300,
        damage: opt.damage || 10,
        r: opt.r || 7,
        color: opt.color || this.colors[1],
        core: opt.core || '#ffffff',
        life: opt.life || 3.6,
        spin: opt.spin !== undefined ? opt.spin : 4,
        homing: opt.homing || 0,
        offset: opt.dist
      });
    }
  }

  /* 螺旋弹幕：单帧一次，angle 由调用方推进 */
  spiralShot(arms, angle, opt) {
    opt = opt || {};
    for (let i = 0; i < arms; i++) {
      const a = angle + (i / arms) * TAU;
      this.fireBullet(a, {
        speed: opt.speed || 285,
        damage: opt.damage || 9,
        r: opt.r || 6.5,
        color: opt.color || this.colors[1],
        core: opt.core || '#ffffff',
        life: opt.life || 4.2,
        spin: opt.spin !== undefined ? opt.spin : 8,
        homing: opt.homing || 0,
        offset: opt.dist
      });
    }
  }

  /* 追踪弹：朝玩家附近散布，转向速率受限（可绕开） */
  homingShot(count, opt) {
    opt = opt || {};
    const base = this.aimAngle();
    const spread = opt.spread === undefined ? 1.0 : opt.spread;
    for (let i = 0; i < count; i++) {
      const a = base + (count === 1 ? 0 : (i / (count - 1) - 0.5) * spread);
      this.fireBullet(a, {
        speed: opt.speed || 210,
        damage: opt.damage || 11,
        r: opt.r || 8,
        color: opt.color || this.colors[2] || this.colors[1],
        core: opt.core || '#ffffff',
        life: opt.life || 3.4,
        spin: opt.spin !== undefined ? opt.spin : 9,
        homing: opt.homing || 1,
        offset: opt.dist
      });
    }
  }

  /* =============== 场景要素 helper =============== */
  addHazard(x, y, opt) {
    const pos = arenaClamp(x, y, 60);
    const h = new BossHazard(this, pos.x, pos.y, opt);
    this.hazards.push(h);
    return h;
  }

  addBeam(opt) {
    const b = new BossBeam(this, opt);
    this.beams.push(b);
    return b;
  }

  /* =============== 召唤 =============== */
  summon(types, n) {
    const room = this.game.room;
    if (!room || !types || !types.length) return 0;
    let made = 0;
    for (let i = 0; i < n; i++) {
      if (this.minions.filter(m => !m.dead).length >= this.maxMinions) break;
      const t = types[(this.summonCount + i) % types.length];
      const e = room._spawnEnemy(t);
      if (!e) continue;
      e.spawnT = e.spawnDur * 0.55;
      this.minions.push(e);
      this.summonCount++;
      made++;
      this.game.particles.ring(e.x, e.y, this.colors[1], 12, 160);
    }
    if (made) {
      this.game.damageNumbers.add(this.x, this.y - this.r - 20, '召唤', {
        color: this.colors[1], life: 1.0, vy: -40
      });
    }
    return made;
  }

  /* =============== 攻击选择（数据驱动） =============== */
  _pick(list) {
    const usable = list.filter(a => this.phase >= (a.min || 1));
    const use = usable.length ? usable : list;
    let sum = 0;
    for (const a of use) sum += (a.w || 1);
    let r = this.rng.next() * sum;
    for (const a of use) { r -= (a.w || 1); if (r <= 0) return a.id; }
    return use[use.length - 1].id;
  }

  /* =============== 受伤反馈 =============== */
  applyStatus(kind, level) {
    /* Boss 不会被长时间冻结，只会被短暂迟滞（否则会被控到死） */
    if (kind === 'freeze') {
      this.freezeT = Math.max(this.freezeT, Math.min(0.30, 0.12 + 0.06 * level));
      return;
    }
    super.applyStatus(kind, level);
  }

  takeDamage(amount, srcX, srcY) {
    if (this.dying || this.dead) return;
    /* 阶段转换演出期间减伤，避免刚进阶段就被一轮爆发打穿 */
    if (this.phaseLock > 0) amount *= 0.45;
    super.takeDamage(amount, srcX, srcY);
    if (this.dead || this.dying) return;
    this.hurtRing = 0.34;
    this.onHurt(amount, srcX, srcY);
  }

  onHurt(amount, srcX, srcY) {
    /* 默认受伤反馈：裂纹环 + 碎屑（白闪与火花由基类完成） */
    this.game.particles.burst(this.x, this.y, 3, {
      speed: 130, life: 0.32, size: 3.4, color: this.colors[1],
      dir: angleTo(srcX, srcY, this.x, this.y), spread: 1.6
    });
  }

  /* =============== 死亡动画 =============== */
  die() {
    if (this.dying || this.dead) return;
    this.dying = true;
    this.deathT = 0;
    this.deathBombT = 0.2;
    this.vx = 0; this.vy = 0;
    this.hazards.length = 0;
    this.beams.length = 0;
    this.telegraphText = null;
    this.game.addShake(8);
    this.game.ui.showBanner(this.name + ' 陨落', '房间解除 · 拾取战利品', 2.8);

    /* 召唤物随主人一起崩解（不留下拖时间的小怪） */
    for (const m of this.minions) {
      if (m && !m.dead) {
        this.game.particles.ring(m.x, m.y, this.colors[1], 10, 130);
        m.die();
      }
    }
    this.onDeathStart();
  }

  _updateDeath(dt) {
    this.deathT += dt;
    this.vx = 0; this.vy = 0;
    this.onDeath(dt);
    if (this.deathT >= this.deathDur) {
      this.dying = false;
      super.die();
    }
  }

  onDeath(dt) {
    /* 默认死亡动画：连续内爆 + 抖动 */
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = 0.24;
      const a = this.rng.range(0, TAU);
      const rr = this.rng.range(0, this.r * 1.5);
      this.game.particles.burst(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr, 12, {
        speed: 220, life: 0.6, size: 5,
        colors: [this.colors[1], '#ffffff', this.colors[0]]
      });
      this.game.addShake(2.2);
    }
  }

  /* =============== 钩子（子类实现） =============== */
  onPhase(n) {}
  onDeathStart() {}
  onHurtVisual(ctx) {}

  /* =============== 绘制 =============== */
  draw(ctx) {
    /* 场景要素在世界坐标下绘制（地面危险区域 / 激光） */
    for (const h of this.hazards) h.draw(ctx);
    for (const b of this.beams) b.draw(ctx);
    super.draw(ctx);
  }

  /* 脚下符环（所有 Boss 通用，阶段越高转得越快） */
  drawAura(ctx, r, color) {
    const t = this.animT;
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.10 * Math.sin(t * 3);
    ctx.strokeStyle = color || this.colors[1];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.rotate(t * (0.5 + 0.25 * this.phase));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
      ctx.lineTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 裂纹（血量越低越密） */
  drawCracks(ctx, r, color) {
    const hurt = 1 - clamp(this.hp / this.maxHp, 0, 1);
    const n = 3 + Math.round(hurt * 5);
    ctx.save();
    ctx.globalAlpha = 0.25 + hurt * 0.55;
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineWidth = 1.8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + this.animT * 0.15;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.18, Math.sin(a) * r * 0.18);
      ctx.lineTo(Math.cos(a + 0.22) * r * 0.62, Math.sin(a + 0.22) * r * 0.62);
      ctx.lineTo(Math.cos(a - 0.12) * r * 0.95, Math.sin(a - 0.12) * r * 0.95);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 死亡演出：整体缩小 + 抖动 + 白炽 */
  deathTransform(ctx) {
    const t = clamp(this.deathT / this.deathDur, 0, 1);
    const shake = (1 - t) * 5;
    ctx.translate(rand(-shake, shake), rand(-shake, shake));
    const s = 1 + Math.sin(t * Math.PI) * 0.22 - t * 0.55;
    ctx.scale(Math.max(0.15, s), Math.max(0.15, s));
    ctx.globalAlpha = clamp(1.25 - t, 0, 1);
    return t;
  }
}

/* ===========================================================
   1. 回廊守望者 · Warden（Boss）
   三眼随阶段睁开：环形弹幕 / 螺旋弹幕 / 扇形弹幕 / 蓄力冲撞 / 召唤残形
   =========================================================== */
class Warden extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '回廊守望者',
      title: '三眼睁开之时，回廊开始崩解',
      r: 34,
      hp: 460,
      speed: 88,
      touchDamage: 16,
      touchInterval: 0.8,
      mass: 7,
      rng: rng,
      colors: ['#4a2b52', '#ff6bd0', '#ff4d6b'],
      specialName: '三眼睁开',
      phaseNames: ['独眼凝视', '双眼洞开', '三眼全睁'],
      summonPool: ['chaser', 'charger'],
      maxMinions: 5
    });
    this.spiralAngle = this.rng.range(0, TAU);
    this.spiralLeft = 0;
    this.ringLeft = 0;
    this.dashDir = 0;
    this.spin = 0;
    this.specialCd = 8.0;              // 三眼睁开
    this.deathDur = 2.3;
    this.attacks = [
      { id: 'ring', cn: '环形弹幕', w: 30 },
      { id: 'spiral', cn: '螺旋弹幕', w: 26 },
      { id: 'dash', cn: '蓄力冲撞', w: 24 },
      { id: 'fan', cn: '扇形棱晶', w: 16, min: 2 },
      { id: 'summon', cn: '召唤残形', w: 14 }
    ];
  }

  onPhase(n) {
    /* 每阶段多睁一只眼 → 弹幕臂数与召唤量同步增加 */
    this.summon(n === 2 ? ['chaser'] : ['chaser', 'charger'], n === 2 ? 2 : 3);
    this.spin = 0;
    this.specialCd = 1.4;              // 进阶段立刻睁眼
  }

  onHurt() {
    this.game.particles.burst(this.x, this.y, 3, {
      speed: 140, life: 0.3, size: 3.4, color: '#ff6bd0'
    });
  }

  act(dt) {
    const p = this.game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    this.spin += dt * (0.8 + 0.35 * this.phase);

    /* 攻击计时：阶段越高越快 */
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;

    switch (this.state) {
      case 'idle': {
        this.hover(dt, 200, 340);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'gazeWind'; this.stateT = 0.9; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;
      }
      case 'ringWind': {
        this.brake(0.82);
        this.telegraphText = '环形弹幕';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.ringShot(this.phase >= 3 ? 20 : (this.phase >= 2 ? 16 : 12), {
            speed: 250, damage: 9, gap: 3, r: 7, color: '#ff6bd0', core: '#ffe0f5'
          });
          this.ringLeft--;
          if (this.ringLeft > 0) this.stateT = 0.34;
          else { this.state = 'idle'; this.atkCd = 1.0; }
        }
        break;
      }
      case 'spiral': {
        this.brake(0.9);
        this.telegraphText = '螺旋弹幕';
        this.stateT -= dt;
        this.spiralLeft -= dt;
        if (this.spiralLeft <= 0) {
          this.spiralLeft = 0.085;
          this.spiralAngle += 0.42 * this.phaseSpeed;
          this.spiralShot(this.phase >= 2 ? 3 : 2, this.spiralAngle, {
            speed: 300, damage: 8, r: 6, color: '#ff6bd0'
          });
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.0; }
        break;
      }
      case 'fanWind': {
        this.brake(0.86);
        this.telegraphText = '扇形棱晶';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 7 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.fanShot(this.phase >= 3 ? 9 : 7, 1.05, this.face, {
            speed: 320, damage: 10, r: 7, color: '#ff4d6b'
          });
          this.state = 'idle';
          this.atkCd = 0.9;
        }
        break;
      }
      case 'windup': {
        this.brake(0.78);
        this.telegraphText = '蓄力冲撞';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 6 * dt));
        this.stateT -= dt;
        if (Math.random() < dt * 30) {
          this.game.particles.spawn(this.x + rand(-24, 24), this.y + rand(-24, 24),
            rand(-40, 40), rand(-40, 40), rand(0.2, 0.45), rand(3, 6),
            'rgba(255,90,170,0.55)', { drag: 3 });
        }
        if (this.stateT <= 0) {
          this.dashDir = this.face;
          this.state = 'dash';
          this.stateT = 0.5;
          this.game.addShake(2.2);
        }
        break;
      }
      case 'dash': {
        this.stateT -= dt;
        const sp = 620 * this.phaseSpeed;
        this.vx = Math.cos(this.dashDir) * sp;
        this.vy = Math.sin(this.dashDir) * sp;
        if (Math.random() < dt * 50) {
          this.game.particles.trail(this.x, this.y, 'rgba(255,90,170,0.35)', 12);
        }
        this.tryTouchDamage(Math.round(this.touchDamage * 1.4), 6);
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.1; }
        break;
      }
      case 'summonCast': {
        this.brake(0.8);
        this.telegraphText = '召唤残形';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 3 : 2);
          this.state = 'idle';
          this.atkCd = 1.3;
        }
        break;
      }
      case 'gazeWind': {
        /* 特殊技能：三眼睁开 —— 旋转凝视激光 + 环形弹幕 */
        this.brake(0.8);
        this.telegraphText = '三眼睁开';
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'gaze'; this.stateT = 0.8; this._gaze(); }
        break;
      }
      case 'gaze': {
        this.brake(0.94);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.2; this.specialCd = 9.5; }
        break;
      }
      default:
        this.state = 'idle';
        break;
    }
  }

  _gaze() {
    const arms = 2 + this.phase;                    // 阶段越高睁眼越多
    const base = this.aimAngle();
    const dir = this.rng.chance(0.5) ? 0.45 : -0.45;
    for (let i = 0; i < arms; i++) {
      this.addBeam({
        x: this.x, y: this.y, angle: base + (i / arms) * TAU,
        warn: 0.75, active: 0.6, width: 15, dmg: 17,
        color: '#ff6bd0', sweep: dir, follow: true
      });
    }
    this.ringShot(this.phase >= 2 ? 16 : 12, {
      speed: 240, damage: 9, gap: 4, r: 7, color: '#ff6bd0'
    });
    this.game.addShake(3.5);
    this.game.particles.ring(this.x, this.y, '#ff6bd0', 24, 280);
  }

  _start(id) {
    if (id === 'ring') { this.state = 'ringWind'; this.stateT = 0.55; this.ringLeft = this.phase >= 2 ? 3 : 2; }
    else if (id === 'spiral') { this.state = 'spiral'; this.stateT = 1.4; this.spiralLeft = 0; }
    else if (id === 'fan') { this.state = 'fanWind'; this.stateT = 0.55; }
    else if (id === 'dash') { this.state = 'windup'; this.stateT = 0.62; }
    else { this.state = 'summonCast'; this.stateT = 0.6; }
  }

  onDeathStart() {
    this.game.particles.ring(this.x, this.y, '#ff4d6b', 30, 260);
  }

  onDeath(dt) {
    /* 三只眼依次熄灭，每熄一只炸一次 */
    const step = Math.floor(this.deathT / 0.62);
    if (step !== this._deathStep) {
      this._deathStep = step;
      this.game.particles.burst(this.x, this.y, 18, {
        speed: 260, life: 0.7, size: 5, colors: ['#ff6bd0', '#ff4d6b', '#ffffff']
      });
      this.game.particles.ring(this.x, this.y, '#ff6bd0', 16, 200);
      this.game.addShake(3);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const winding = this.state === 'windup';
    const dashing = this.state === 'dash';

    this.drawAura(ctx, this.r + 16, '#ff6bd0');

    /* 蓄力预警线 */
    if (winding) {
      const g = 1 - this.stateT / 0.62;
      ctx.save();
      ctx.rotate(this.face);
      ctx.globalAlpha = 0.25 + 0.45 * g;
      ctx.strokeStyle = '#ff4d6b';
      ctx.lineWidth = 3 + 3 * g;
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = -t * 70;
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(this.r + 620 * (0.4 + 0.6 * g), 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* 外环旋转护板 */
    ctx.save();
    ctx.rotate(this.spin);
    const plates = 4 + this.phase;
    for (let i = 0; i < plates; i++) {
      const a = (i / plates) * TAU;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = i % 2 ? '#5c3566' : '#3b2244';
      polygonPath(ctx, [
        [this.r + 14, -9],
        [this.r + 28, 0],
        [this.r + 14, 9],
        [this.r + 2, 0]
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
    if (this.dying) this.deathTransform(ctx);
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

    /* 三只眼（阶段越高睁得越多） */
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

    this.drawCracks(ctx, this.r * 0.9, dashing ? '#ffffff' : '#ff4d6b');
    ctx.restore();

    /* 受伤环 */
    if (this.hurtRing > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(this.hurtRing / 0.34, 0, 1) * 0.6;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 12 + (1 - this.hurtRing / 0.34) * 26, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
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
EnemyFactory.register('boss', Warden, {
  r: 34, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '回廊守望者', title: '三眼睁开之时，回廊开始崩解', minFloor: 1 }
});
