/* ===========================================================
   bosses.js — 原创 Boss 图鉴（8 位，各自独立设计）
   -----------------------------------------------------------
   本文件只做「追加」：不改动 enemy.js 中已有的玩家 / 敌人 / 碰撞系统。
   每位 Boss 都具备：
     · 名称 / 称号 / HP
     · 三个阶段（HP 70% / 40% 触发阶段变化）
       阶段变化 = 攻击方式变化 + 攻击频率提高 + 解锁新弹幕
     · 至少 4 种攻击（环形 / 扇形 / 螺旋 / 追踪 / 激光 / 冲刺 /
                     地面危险区域 / 召唤）
     · 一个专属特殊技能
     · 召唤机制（统一走 BossBase.summon）
     · 受伤反馈（白闪 + 火花 + 裂纹 + 专属表现）
     · 独立死亡动画（播完才真正移除）
   可躲避性硬约束（所有 Boss 通用）：
     1. 任何攻击都有预警状态（telegraphText + 视觉预警线 / 预警圈）
     2. 环形弹幕永远留连续缺口；敌弹速 <= 640
     3. 地面危险区域先画预警圈，warn >= 0.5s 后才生效
     4. 激光 warn >= 0.65s；冲刺有蓄力线与蓄力时间
   新增一位 Boss = 写一个 class + 一条 EnemyFactory.register + 一条 BossRoster 记录
   =========================================================== */
'use strict';

/* -----------------------------------------------------------
   通用绘图小工具（Boss 之间的共享表现，不共享 AI）
   ----------------------------------------------------------- */
/* 冲刺预警线：调用前需 ctx.rotate(this.face) */
function bossWarnLine(ctx, r, len, prog, color, t) {
  ctx.save();
  ctx.globalAlpha = 0.20 + 0.45 * clamp(prog, 0, 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3 + 3 * clamp(prog, 0, 1);
  ctx.setLineDash([16, 12]);
  ctx.lineDashOffset = -t * 70;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(r + len, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/* 扇形预警弧：调用前需 ctx.rotate(aim) */
function bossWarnArc(ctx, r, spread, prog, color, t) {
  ctx.save();
  ctx.globalAlpha = 0.10 + 0.30 * clamp(prog, 0, 1);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r * 5.2, -spread * 0.5, spread * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.35 + 0.35 * clamp(prog, 0, 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -t * 60;
  ctx.beginPath();
  ctx.arc(0, 0, r * 5.2, -spread * 0.5, spread * 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/* 核心渐变球（多数 Boss 的躯干底子） */
function bossCore(ctx, r, inner, mid, outer) {
  const g = ctx.createRadialGradient(0, 0, 3, 0, 0, r * 1.45);
  g.addColorStop(0, inner);
  g.addColorStop(0.38, mid);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.05, 0, TAU);
  ctx.fill();
}

/* 受伤光环（统一画法） */
function bossHurtRing(ctx, boss) {
  if (boss.hurtRing <= 0) return;
  const q = clamp(boss.hurtRing / 0.34, 0, 1);
  ctx.save();
  ctx.globalAlpha = q * 0.6;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, boss.r + 12 + (1 - q) * 26, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/* 玩家牵引（引力漩涡 / 沙涡：力递减，可挣脱） */
function bossPullPlayer(game, tx, ty, force, range, dt) {
  const p = game.player;
  if (!p || p.dead) return;
  const d = dist(p.x, p.y, tx, ty);
  if (d > range) return;
  const a = angleTo(p.x, p.y, tx, ty);
  const f = force * (1 - d / range);
  p.x += Math.cos(a) * f * dt;
  p.y += Math.sin(a) * f * dt;
  if (game.room) game.room.clampEntity(p, true);
}

/* ===========================================================
   1. 熔渣铸匠 · Slagsmith
   主题：地面危险区域（熔岩）
   攻击：扇形火弹 / 环形熔渣 / 熔铸冲撞 / 熔岩池 / 追踪炉渣 / 召唤渣灵
   特殊：熔炉过载 —— 蓄热后在四周砸出放射状熔岩沟，熔岩持续扩张
   =========================================================== */
class Slagsmith extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '熔渣铸匠',
      title: '炉火不熄，锻渣成形',
      r: 32, hp: 520, speed: 96, touchDamage: 15, touchInterval: 0.9, mass: 8,
      rng: rng, colors: ['#5a2a1a', '#ff8a3c', '#ff4d2a'],
      specialName: '熔炉过载',
      phaseNames: ['点火', '鼓风', '炉心崩解'],
      summonPool: ['swarmer', 'gnasher'], maxMinions: 6
    });
    this.bulletDamage = 9;
    this.dmgFields = ['bulletDamage'];
    this.specialCd = 7.0;
    this.ringLeft = 0;
    this.dashDir = 0;
    this.deathDur = 2.5;
    this.attacks = [
      { id: 'fan', cn: '扇形火弹', w: 26 },
      { id: 'ring', cn: '环形熔渣', w: 22 },
      { id: 'dash', cn: '熔铸冲撞', w: 22 },
      { id: 'lava', cn: '熔岩池', w: 24 },
      { id: 'homing', cn: '追踪炉渣', w: 16, min: 2 },
      { id: 'summon', cn: '召唤渣灵', w: 14 }
    ];
  }

  onPhase(n) {
    /* 阶段 2 解锁追踪炉渣，阶段 3 熔岩沟数量翻倍（见 _overload / lavaCast） */
    this.summon(this.summonPool, n === 2 ? 2 : 3);
    this.specialCd = 1.4;                       // 进阶段立刻来一次熔炉过载
  }

  onHurt() {
    this.game.particles.burst(this.x, this.y, 4, {
      speed: 150, life: 0.34, size: 3.6, colors: ['#ff8a3c', '#ffd35e', '#ffffff']
    });
    if (Math.random() < 0.35) {
      this.game.particles.spawn(this.x + rand(-18, 18), this.y + rand(-18, 18),
        rand(-30, 30), rand(-70, -30), rand(0.3, 0.6), rand(2, 4),
        '#ff9d3c', { drag: 2.4 });
    }
  }

  act(dt) {
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;

    switch (this.state) {
      case 'idle':
        this.hover(dt, 200, 360);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'overloadWind'; this.stateT = 1.15; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;

      case 'fanWind':
        this.brake(0.84);
        this.telegraphText = '扇形火弹';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 8 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.fanShot(this.phase >= 3 ? 9 : 7, 1.0, this.face, {
            speed: 330, damage: this.bulletDamage + 1, r: 7, color: '#ff8a3c'
          });
          this.state = 'idle'; this.atkCd = 0.95;
        }
        break;

      case 'ringWind':
        this.brake(0.86);
        this.telegraphText = '环形熔渣';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.ringShot(this.phase >= 3 ? 18 : 14, {
            speed: 250, damage: this.bulletDamage, gap: 3, r: 7, color: '#ff8a3c'
          });
          this.ringLeft--;
          if (this.ringLeft > 0) this.stateT = 0.32;
          else { this.state = 'idle'; this.atkCd = 1.05; }
        }
        break;

      case 'windup':
        this.brake(0.78);
        this.telegraphText = '熔铸冲撞';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 6 * dt));
        this.stateT -= dt;
        if (Math.random() < dt * 28) {
          this.game.particles.spawn(this.x + rand(-22, 22), this.y + rand(-22, 22),
            rand(-40, 40), rand(-40, 40), rand(0.2, 0.45), rand(3, 6),
            'rgba(255,140,60,0.55)', { drag: 3 });
        }
        if (this.stateT <= 0) {
          this.dashDir = this.face;
          this.state = 'dash';
          this.stateT = 0.55;
          this.game.addShake(2);
        }
        break;

      case 'dash':
        this.stateT -= dt;
        const r = this.dashMove(dt, this.dashDir, 660 * this.phaseSpeed,
          Math.round(this.touchDamage * 1.4), 6);
        if (r === 'wall' || this.stateT <= 0) {
          this.state = 'stagger';
          this.stateT = 0.7;
          this.game.addShake(3);
          this.game.particles.burst(this.x, this.y, 14, {
            speed: 240, life: 0.55, size: 5, colors: ['#ffd0b0', '#ff8a3c', '#ffffff']
          });
          /* 撞墙后震出一片熔岩（有预警圈，可躲） */
          this.addHazard(this.x, this.y, {
            r: 52, warn: 0.5, active: 2.6, dmg: 11, grow: 10, color: '#ff8a3c'
          });
        }
        break;

      case 'stagger':
        this.brake(0.85);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.0; }
        break;

      case 'lavaCast':
        this.brake(0.86);
        this.telegraphText = '熔岩池';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const p = this.game.player;
          const n = this.phase >= 3 ? 4 : (this.phase >= 2 ? 3 : 2);
          this.addHazard(p.x, p.y, {
            r: 58, warn: 0.9, active: 3.2, dmg: 11, grow: 13, color: '#ff8a3c'
          });
          for (let i = 1; i < n; i++) {
            const a = this.rng.range(0, TAU);
            this.addHazard(p.x + Math.cos(a) * this.rng.range(95, 195),
              p.y + Math.sin(a) * this.rng.range(95, 195), {
                r: 48, warn: 0.95, active: 2.8, dmg: 10, grow: 11, color: '#ff8a3c'
              });
          }
          this.state = 'idle'; this.atkCd = 1.1;
        }
        break;

      case 'homingCast':
        this.brake(0.88);
        this.telegraphText = '追踪炉渣';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.homingShot(this.phase >= 3 ? 4 : 3, {
            speed: 215, damage: this.bulletDamage + 2, r: 8, color: '#ff4d2a', homing: 1
          });
          this.state = 'idle'; this.atkCd = 1.0;
        }
        break;

      case 'summonCast':
        this.brake(0.84);
        this.telegraphText = '召唤渣灵';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 3 : 2);
          this.state = 'idle'; this.atkCd = 1.3;
        }
        break;

      case 'overloadWind':
        this.brake(0.8);
        this.telegraphText = '熔炉过载';
        this.stateT -= dt;
        if (Math.random() < dt * 40) {
          this.game.particles.spawn(this.x + rand(-26, 26), this.y + rand(-26, 26),
            rand(-20, 20), rand(-90, -40), rand(0.3, 0.6), rand(3, 6),
            '#ffd35e', { drag: 2 });
        }
        if (this.stateT <= 0) { this.state = 'overload'; this.stateT = 0.9; this._overload(); }
        break;

      case 'overload':
        this.brake(0.9);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.2; this.specialCd = 8.5; }
        break;

      default: this.state = 'idle'; break;
    }
  }

  _start(id) {
    if (id === 'fan') { this.state = 'fanWind'; this.stateT = 0.5; }
    else if (id === 'ring') { this.state = 'ringWind'; this.stateT = 0.5; this.ringLeft = this.phase >= 2 ? 3 : 2; }
    else if (id === 'dash') { this.state = 'windup'; this.stateT = 0.62; }
    else if (id === 'lava') { this.state = 'lavaCast'; this.stateT = 0.55; }
    else if (id === 'homing') { this.state = 'homingCast'; this.stateT = 0.5; }
    else { this.state = 'summonCast'; this.stateT = 0.6; }
  }

  /* 特殊技能：放射状熔岩沟 + 环形弹幕 */
  _overload() {
    const arms = this.phase >= 3 ? 8 : (this.phase >= 2 ? 6 : 4);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TAU + this.rng.range(-0.15, 0.15);
      const d = this.rng.range(105, 165);
      this.addHazard(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, {
        r: 46, warn: 0.5, active: 3.2, dmg: 11, grow: 14, color: '#ff8a3c'
      });
    }
    this.ringShot(this.phase >= 2 ? 16 : 12, {
      speed: 230, damage: this.bulletDamage, gap: 3, r: 7, color: '#ff4d2a'
    });
    this.game.addShake(4.5);
    this.game.particles.ring(this.x, this.y, '#ffd35e', 26, 300);
  }

  onDeathStart() {
    this.game.particles.ring(this.x, this.y, '#ff8a3c', 30, 280);
  }

  onDeath(dt) {
    /* 炉心连续喷发，最后一次大爆炸 */
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = 0.28;
      const a = this.rng.range(0, TAU);
      this.game.particles.burst(this.x + Math.cos(a) * 26, this.y + Math.sin(a) * 26, 14, {
        speed: 250, life: 0.65, size: 5,
        colors: ['#ff8a3c', '#ffd35e', '#ffffff', '#ff4d2a']
      });
      this.game.particles.ring(this.x, this.y, '#ff8a3c', 12, 180);
      this.game.addShake(2.6);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const winding = this.state === 'windup';
    const overload = this.state === 'overloadWind';

    this.drawAura(ctx, this.r + 14, '#ff8a3c');

    if (winding) {
      ctx.save();
      ctx.rotate(this.face);
      bossWarnLine(ctx, this.r, 620 * (0.35 + 0.65 * (1 - this.stateT / 0.62)),
        1 - this.stateT / 0.62, '#ff4d2a', t);
      ctx.restore();
    }

    ctx.save();
    if (this.dying) this.deathTransform(ctx);

    /* 烟囱（顶部冒火） */
    ctx.fillStyle = '#3a2318';
    roundRectPath(ctx, -9, -this.r - 20, 18, 22, 4);
    ctx.fill();
    ctx.strokeStyle = '#6a3a22';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (Math.random() < 0.4) {
      this.game.particles.spawn(this.x + rand(-5, 5), this.y - this.r - 22,
        rand(-14, 14), rand(-90, -50), rand(0.3, 0.6), rand(2, 4.5),
        overload ? '#fff0b0' : '#ff9d3c', { drag: 2 });
    }

    bossCore(ctx, this.r, overload ? '#fff4c8' : '#ffd35e', '#ff8a3c', 'rgba(90,42,26,0.2)');

    /* 炉体外壳 */
    ctx.fillStyle = this.colors[0];
    roundRectPath(ctx, -this.r * 0.78, -this.r * 0.62, this.r * 1.56, this.r * 1.24, 8);
    ctx.fill();
    ctx.strokeStyle = '#8a4a26';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    /* 炉门：越热越亮 */
    const heat = clamp(1 - this.hp / this.maxHp, 0, 1);
    ctx.globalAlpha = 0.55 + 0.4 * heat + (overload ? 0.3 * Math.sin(t * 30) : 0);
    ctx.fillStyle = overload ? '#fff6d0' : '#ff6b2a';
    roundRectPath(ctx, -this.r * 0.42, -this.r * 0.3, this.r * 0.84, this.r * 0.62, 5);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 铆钉 */
    ctx.fillStyle = '#c8a06a';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * this.r * 0.66, Math.sin(a) * this.r * 0.56, 2.6, 0, TAU);
      ctx.fill();
    }

    /* 双臂铁锤 */
    ctx.strokeStyle = '#4a3020';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    const swing = this.state === 'dash' ? 0.7 : Math.sin(t * 1.6) * 0.25;
    for (let s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.moveTo(s * this.r * 0.7, this.r * 0.1);
      ctx.lineTo(s * this.r * 1.15, this.r * 0.5 + swing * 12);
      ctx.stroke();
    }

    this.drawCracks(ctx, this.r * 0.95, '#ffd35e');
    ctx.restore();

    bossHurtRing(ctx, this);
  }
}

/* ===========================================================
   2. 经纬织者 · Weaver
   主题：激光与编织
   攻击：激光十字 / 螺旋织线 / 追踪线锥 / 扇形织针 / 穿线位移 / 召唤织影
   特殊：织幕 —— 织出一圈缓慢扩散的弹幕墙，永远留一个缺口
   =========================================================== */
class Weaver extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '经纬织者',
      title: '每一条线，都是一道未竟的回廊',
      r: 30, hp: 470, speed: 108, touchDamage: 12, touchInterval: 0.85, mass: 6,
      rng: rng, colors: ['#26384f', '#a6e8ff', '#7fd7ea'],
      specialName: '织幕',
      phaseNames: ['引线', '成纹', '绞杀'],
      summonPool: ['wisp', 'phantom'], maxMinions: 4
    });
    this.bulletDamage = 9;
    this.dmgFields = ['bulletDamage'];
    this.spiralAngle = rng.range(0, TAU);
    this.spiralLeft = 0;
    this.specialCd = 6.5;
    this.deathDur = 2.4;
    this.attacks = [
      { id: 'laser', cn: '激光十字', w: 28 },
      { id: 'spiral', cn: '螺旋织线', w: 24 },
      { id: 'homing', cn: '追踪线锥', w: 18, min: 2 },   /* 第 2 阶段解锁 */
      { id: 'fan', cn: '扇形织针', w: 18 },
      { id: 'blink', cn: '穿线位移', w: 12 },
      { id: 'summon', cn: '召唤织影', w: 14 }
    ];
  }

  onPhase(n) {
    this.summon(this.summonPool, n === 2 ? 2 : 3);
    this.specialCd = 1.2;
  }

  onHurt() {
    /* 受伤时线轴散开：短暂加速并撒出线屑 */
    this.game.particles.burst(this.x, this.y, 4, {
      speed: 160, life: 0.3, size: 3, colors: ['#a6e8ff', '#ffffff']
    });
    this.rageT = Math.max(this.rageT, 0.6);
  }

  act(dt) {
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;

    switch (this.state) {
      case 'idle':
        this.hover(dt, 230, 400);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'weaveWind'; this.stateT = 0.7; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;

      case 'laserWind':
        this.brake(0.8);
        this.telegraphText = '激光十字';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const n = this.phase >= 3 ? 6 : (this.phase >= 2 ? 4 : 3);
          const base = this.aimAngle();
          const sweep = this.phase >= 3 ? 0.5 : 0;
          for (let i = 0; i < n; i++) {
            this.addBeam({
              x: this.x, y: this.y, angle: base + (i / n) * TAU,
              warn: 0.7, active: 0.42, width: 16, dmg: 18,
              color: '#a6e8ff', sweep: sweep * (i % 2 ? 1 : -1)
            });
          }
          this.game.addShake(2.4);
          this.state = 'idle'; this.atkCd = 1.15;
        }
        break;

      case 'spiral':
        this.brake(0.9);
        this.telegraphText = '螺旋织线';
        this.stateT -= dt;
        this.spiralLeft -= dt;
        if (this.spiralLeft <= 0) {
          this.spiralLeft = 0.09;
          this.spiralAngle += 0.5 * this.phaseSpeed;
          this.spiralShot(this.phase >= 2 ? 3 : 2, this.spiralAngle, {
            speed: 300, damage: this.bulletDamage, r: 6.5, color: '#7fd7ea'
          });
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.05; }
        break;

      case 'homingCast':
        this.brake(0.88);
        this.telegraphText = '追踪线锥';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.homingShot(this.phase >= 3 ? 5 : 3, {
            speed: 205, damage: this.bulletDamage + 2, r: 7.5, color: '#a6e8ff', homing: 2
          });
          this.state = 'idle'; this.atkCd = 1.0;
        }
        break;

      case 'fanWind':
        this.brake(0.86);
        this.telegraphText = '扇形织针';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 7 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.fanShot(this.phase >= 3 ? 9 : 7, 1.05, this.face, {
            speed: 320, damage: this.bulletDamage + 1, r: 6.5, color: '#7fd7ea'
          });
          this.state = 'idle'; this.atkCd = 0.95;
        }
        break;

      case 'blinkWind':
        this.brake(0.86);
        this.telegraphText = '穿线位移';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          /* 位移到玩家侧后方，落点有短暂预警圈（不伤害，只是位移） */
          const p = this.game.player;
          const a = angleTo(p.x, p.y, this.x, this.y) + this.rng.range(-0.7, 0.7);
          const pos = arenaClamp(p.x + Math.cos(a) * 210, p.y + Math.sin(a) * 210, 70);
          this.game.particles.ring(this.x, this.y, '#a6e8ff', 18, 220);
          this.x = pos.x; this.y = pos.y;
          this.vx = 0; this.vy = 0;
          this.game.particles.ring(this.x, this.y, '#ffffff', 18, 200);
          this.state = 'idle'; this.atkCd = 0.85;
        }
        break;

      case 'summonCast':
        this.brake(0.84);
        this.telegraphText = '召唤织影';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 3 : 2);
          this.state = 'idle'; this.atkCd = 1.3;
        }
        break;

      case 'weaveWind':
        this.brake(0.82);
        this.telegraphText = '织幕';
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'weave'; this.stateT = 0.5; this._weave(); }
        break;

      case 'weave':
        this.brake(0.94);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.2; this.specialCd = 8.0; }
        break;

      default: this.state = 'idle'; break;
    }
  }

  _start(id) {
    if (id === 'laser') { this.state = 'laserWind'; this.stateT = 0.55; }
    else if (id === 'spiral') { this.state = 'spiral'; this.stateT = 1.35; this.spiralLeft = 0; }
    else if (id === 'homing') { this.state = 'homingCast'; this.stateT = 0.5; }
    else if (id === 'fan') { this.state = 'fanWind'; this.stateT = 0.5; }
    else if (id === 'blink') { this.state = 'blinkWind'; this.stateT = 0.35; }
    else { this.state = 'summonCast'; this.stateT = 0.6; }
  }

  /* 特殊技能：一圈缓慢向外扩散的弹幕墙，永远留一个连续缺口 */
  _weave() {
    const count = this.phase >= 3 ? 26 : (this.phase >= 2 ? 22 : 18);
    const gapAt = Math.floor(this.rng.next() * count);
    const gap = this.phase >= 3 ? 5 : 6;          // 缺口宽度（越多阶段越窄，但始终存在）
    for (let i = 0; i < count; i++) {
      const rel = (i - gapAt + count) % count;
      if (rel < gap) continue;
      const a = (i / count) * TAU;
      this.fireBullet(a, {
        speed: 150, damage: this.bulletDamage, r: 8, color: '#a6e8ff',
        core: '#ffffff', life: 4.6, spin: 2, offset: 62
      });
    }
    this.game.particles.ring(this.x, this.y, '#a6e8ff', 22, 240);
    this.game.addShake(2.6);
  }

  onDeathStart() {
    /* 整幅织锦被抽走：一次性撒出大量线屑 */
    this.game.particles.ring(this.x, this.y, '#a6e8ff', 34, 300);
  }

  onDeath(dt) {
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = 0.2;
      const a = this.rng.range(0, TAU);
      const rr = this.rng.range(0, this.r * 2.2);
      this.game.particles.spawn(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr,
        Math.cos(a) * 60, Math.sin(a) * 60, rand(0.5, 0.9), rand(3, 6),
        '#a6e8ff', { drag: 1.6 });
      this.game.addShake(1.8);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const casting = this.state === 'weaveWind' || this.state === 'laserWind';

    this.drawAura(ctx, this.r + 16, '#a6e8ff');

    /* 扇形织针预警 */
    if (this.state === 'fanWind') {
      ctx.save();
      ctx.rotate(this.face);
      bossWarnArc(ctx, this.r, 1.05, 1 - this.stateT / 0.5, '#7fd7ea', t);
      ctx.restore();
    }

    ctx.save();
    if (this.dying) this.deathTransform(ctx);

    /* 外圈织梭（阶段越多越快） */
    ctx.save();
    ctx.rotate(t * (0.9 + 0.4 * this.phase));
    const shuttles = 3 + this.phase;
    for (let i = 0; i < shuttles; i++) {
      const a = (i / shuttles) * TAU;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(this.r + 20, 0);
      ctx.fillStyle = i % 2 ? '#a6e8ff' : '#7fd7ea';
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 4.5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    /* 主体：线球 */
    bossCore(ctx, this.r, '#e8fbff', '#a6e8ff', 'rgba(38,56,79,0.25)');
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.72, 0, TAU);
    ctx.fill();

    /* 缠绕的经线 */
    ctx.strokeStyle = 'rgba(166,232,255,0.75)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 5; i++) {
      const a = t * 0.6 + (i / 5) * Math.PI;
      ctx.beginPath();
      ctx.ellipse(0, 0, this.r * 0.72, this.r * 0.72 * Math.abs(Math.cos(a)), a, 0, TAU);
      ctx.stroke();
    }

    /* 瞳孔（蓄力时收缩） */
    const pupilR = casting ? 4 + Math.sin(t * 26) * 1.6 : 7;
    ctx.fillStyle = casting ? '#ffffff' : '#0e1a26';
    ctx.beginPath();
    ctx.arc(0, 0, pupilR, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#7fd7ea';
    ctx.beginPath();
    ctx.arc(0, 0, pupilR * 0.45, 0, TAU);
    ctx.fill();

    this.drawCracks(ctx, this.r * 0.9, '#ffffff');
    ctx.restore();

    bossHurtRing(ctx, this);
  }
}

/* ===========================================================
   3. 铁律摆钟 · Verdict
   主题：重压与冲击波
   攻击：摆锤横扫 / 钟摆冲撞 / 钟鸣环弹 / 齿轮飞刃 / 震荡砸地 / 召唤钟仆
   特殊：审判钟鸣 —— 三圈依次向外扩散的冲击波（环弹 + 环形地面危险）
   =========================================================== */
class Verdict extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '铁律摆钟',
      title: '每一记钟声，都是一次不可上诉的判决',
      r: 36, hp: 560, speed: 84, touchDamage: 18, touchInterval: 0.9, mass: 10,
      rng: rng, colors: ['#3b3a33', '#ffd35e', '#c8a06a'],
      specialName: '审判钟鸣',
      phaseNames: ['上弦', '落锤', '终审'],
      summonPool: ['spiker', 'aegis'], maxMinions: 4
    });
    this.bulletDamage = 9;
    this.dmgFields = ['bulletDamage'];
    this.specialCd = 8.0;
    this.waveLeft = 0;
    this.waveT = 0;
    this.dashDir = 0;
    this.sweepDir = 1;
    this.pendulum = 0;
    this.deathDur = 2.6;
    this.attacks = [
      { id: 'sweep', cn: '摆锤横扫', w: 26 },
      { id: 'dash', cn: '钟摆冲撞', w: 22 },
      { id: 'ring', cn: '钟鸣环弹', w: 20 },
      { id: 'fan', cn: '齿轮飞刃', w: 18, min: 2 },
      { id: 'quake', cn: '震荡砸地', w: 18, min: 2 },
      { id: 'summon', cn: '召唤钟仆', w: 14 }
    ];
  }

  onPhase(n) {
    /* 阶段 2 解锁齿轮飞刃与震荡砸地；阶段 3 冲击波三圈 → 四圈 */
    this.summon(this.summonPool, n === 2 ? 2 : 3);
    this.specialCd = 1.5;
  }

  onHurt() {
    /* 金属受击：迸出火星 + 一声闷响的震动环 */
    this.game.particles.burst(this.x, this.y, 5, {
      speed: 170, life: 0.3, size: 3.2, colors: ['#ffd35e', '#ffffff', '#c8a06a']
    });
    if (Math.random() < 0.5) this.game.addShake(1.2);
  }

  act(dt) {
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;
    this.pendulum += dt * (1.4 + 0.5 * this.phase);

    switch (this.state) {
      case 'idle':
        this.hover(dt, 190, 330);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'tollWind'; this.stateT = 0.9; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;

      case 'sweepWind':
        this.brake(0.8);
        this.telegraphText = '摆锤横扫';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.state = 'sweep';
          this.stateT = 0.42;
          this.sweepDir = this.rng.chance(0.5) ? 1 : -1;
          this.game.addShake(3);
        }
        break;

      case 'sweep': {
        /* 锤头绕自身扫过半圈，沿途留下地面裂纹（危险区） */
        this.stateT -= dt;
        const span = Math.PI * (this.phase >= 3 ? 1.35 : 1.0);
        const prog = 1 - this.stateT / 0.42;
        const a = this.face - span * 0.5 + span * prog * this.sweepDir;
        const hx = this.x + Math.cos(a) * 78;
        const hy = this.y + Math.sin(a) * 78;
        this.tryTouchDamage(Math.round(this.touchDamage * 1.15), 44);
        if (Math.random() < dt * 60) {
          this.game.particles.trail(hx, hy, 'rgba(255,211,94,0.4)', 10);
        }
        if (this.phase >= 2 && Math.random() < dt * 22) {
          /* 二阶段起：锤头轨迹上留下可躲的裂纹地块 */
          const pos = arenaClamp(hx, hy, 50);
          this.addHazard(pos.x, pos.y, {
            r: 34, warn: 0.55, active: 1.6, dmg: 9, color: '#c8a06a'
          });
        }
        this.sweepA = a;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.0; }
        break;
      }

      case 'windup':
        this.brake(0.78);
        this.telegraphText = '钟摆冲撞';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 6 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.dashDir = this.face;
          this.state = 'dash';
          this.stateT = 0.6;
          this.game.addShake(2.4);
        }
        break;

      case 'dash': {
        this.stateT -= dt;
        const r = this.dashMove(dt, this.dashDir, 640 * this.phaseSpeed,
          Math.round(this.touchDamage * 1.5), 8);
        if (r === 'wall' || this.stateT <= 0) {
          this.state = 'stagger';
          this.stateT = 0.8;
          this.game.addShake(5);
          /* 撞墙：一圈碎石地块 */
          for (let i = 0; i < 5; i++) {
            const a = this.rng.range(0, TAU);
            this.addHazard(this.x + Math.cos(a) * 62, this.y + Math.sin(a) * 62, {
              r: 38, warn: 0.5, active: 2.2, dmg: 10, color: '#c8a06a'
            });
          }
        }
        break;
      }

      case 'stagger':
        this.brake(0.84);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.1; }
        break;

      case 'ringWind':
        this.brake(0.86);
        this.telegraphText = '钟鸣环弹';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.ringShot(this.phase >= 3 ? 20 : 14, {
            speed: 235, damage: this.bulletDamage, gap: 4, r: 7, color: '#ffd35e'
          });
          this.state = 'idle'; this.atkCd = 1.05;
        }
        break;

      case 'fanWind':
        this.brake(0.86);
        this.telegraphText = '齿轮飞刃';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 7 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const n = this.phase >= 3 ? 9 : 7;
          this.fanShot(n, 1.15, this.face, {
            speed: 330, damage: this.bulletDamage + 1, r: 7.5, color: '#c8a06a', spin: 14
          });
          this.state = 'idle'; this.atkCd = 0.95;
        }
        break;

      case 'quakeWind':
        this.brake(0.8);
        this.telegraphText = '震荡砸地';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const n = this.phase >= 3 ? 6 : 4;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + this.rng.range(-0.2, 0.2);
            const d = this.rng.range(90, 200);
            this.addHazard(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, {
              r: 52, warn: 0.75, active: 2.6, dmg: 12, color: '#ffd35e'
            });
          }
          this.game.addShake(4.5);
          this.state = 'idle'; this.atkCd = 1.15;
        }
        break;

      case 'summonCast':
        this.brake(0.84);
        this.telegraphText = '召唤钟仆';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 3 : 2);
          this.state = 'idle'; this.atkCd = 1.3;
        }
        break;

      case 'tollWind':
        this.brake(0.82);
        this.telegraphText = '审判钟鸣';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.state = 'toll';
          this.stateT = 1.5;
          this.waveLeft = this.phase >= 3 ? 4 : 3;
          this.waveT = 0;
          this.game.addShake(5);
        }
        break;

      case 'toll':
        /* 三/四圈冲击波依次扩散：每圈都是环形地面危险 + 环形弹幕（带缺口） */
        this.brake(0.9);
        this.stateT -= dt;
        this.waveT -= dt;
        if (this.waveT <= 0 && this.waveLeft > 0) {
          this.waveT = 0.36;
          this.waveLeft--;
          this._shockwave();
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.2; this.specialCd = 9.0; }
        break;

      default: this.state = 'idle'; break;
    }
  }

  _start(id) {
    if (id === 'sweep') { this.state = 'sweepWind'; this.stateT = 0.6; }
    else if (id === 'dash') { this.state = 'windup'; this.stateT = 0.62; }
    else if (id === 'ring') { this.state = 'ringWind'; this.stateT = 0.55; }
    else if (id === 'fan') { this.state = 'fanWind'; this.stateT = 0.5; }
    else if (id === 'quake') { this.state = 'quakeWind'; this.stateT = 0.6; }
    else { this.state = 'summonCast'; this.stateT = 0.6; }
  }

  _shockwave() {
    /* 环形地面危险：8 个小地块围成一圈，缝隙处可以站人 */
    const idx = (this.phase >= 3 ? 4 : 3) - this.waveLeft;
    const rad = 90 + idx * 78;
    const n = 10;
    const skip = Math.floor(this.rng.next() * n);
    for (let i = 0; i < n; i++) {
      if (i === skip || i === (skip + 1) % n) continue;   // 留两处缝隙
      const a = (i / n) * TAU;
      this.addHazard(this.x + Math.cos(a) * rad, this.y + Math.sin(a) * rad, {
        r: 40, warn: 0.55, active: 1.5, dmg: 10, color: '#ffd35e'
      });
    }
    this.ringShot(this.phase >= 2 ? 16 : 12, {
      speed: 260, damage: this.bulletDamage, gap: 4, r: 7, color: '#ffd35e',
      dist: 30
    });
    this.game.addShake(3.4);
    this.game.particles.ring(this.x, this.y, '#ffd35e', 20, 280);
  }

  onDeathStart() {
    this.game.particles.ring(this.x, this.y, '#ffd35e', 34, 300);
    this.game.addShake(6);
  }

  onDeath(dt) {
    /* 钟体裂开，钟舌一次次砸下，最后一声长鸣 */
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = 0.34;
      const a = this.rng.range(0, TAU);
      this.game.particles.burst(this.x + Math.cos(a) * 30, this.y + Math.sin(a) * 30, 16, {
        speed: 240, life: 0.7, size: 5.5,
        colors: ['#ffd35e', '#c8a06a', '#ffffff']
      });
      this.game.particles.ring(this.x, this.y, '#c8a06a', 14, 200);
      this.game.addShake(3);
      if (Math.random() < 0.5) {
        this.addHazard(this.x + this.rng.range(-90, 90), this.y + this.rng.range(-90, 90),
          { r: 40, warn: 0.4, active: 0.9, dmg: 6, color: '#c8a06a' });
      }
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const winding = this.state === 'windup';
    const tolling = this.state === 'tollWind' || this.state === 'toll';

    this.drawAura(ctx, this.r + 18, '#ffd35e');

    if (winding) {
      ctx.save();
      ctx.rotate(this.face);
      bossWarnLine(ctx, this.r, 640 * (0.35 + 0.65 * (1 - this.stateT / 0.62)),
        1 - this.stateT / 0.62, '#ffd35e', t);
      ctx.restore();
    }

    /* 摆锤（横扫时看得见轨迹） */
    if (this.state === 'sweep' || this.state === 'sweepWind') {
      const a = this.state === 'sweep'
        ? (this.sweepA !== undefined ? this.sweepA : this.face)
        : this.face + Math.sin(this.pendulum) * 0.5;
      ctx.save();
      ctx.rotate(a);
      ctx.globalAlpha = this.state === 'sweep' ? 1 : 0.35 + 0.3 * Math.sin(t * 18);
      ctx.strokeStyle = '#6a6252';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(78, 0);
      ctx.stroke();
      ctx.fillStyle = this.colors[0];
      ctx.beginPath();
      ctx.arc(78, 0, 17, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ffd35e';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    ctx.save();
    if (this.dying) this.deathTransform(ctx);

    /* 钟体 */
    ctx.fillStyle = this.colors[0];
    polygonPath(ctx, [
      [-this.r * 0.85, this.r * 0.75],
      [-this.r * 0.62, -this.r * 0.6],
      [0, -this.r * 0.95],
      [this.r * 0.62, -this.r * 0.6],
      [this.r * 0.85, this.r * 0.75]
    ]);
    ctx.fill();
    ctx.strokeStyle = '#8a7a52';
    ctx.lineWidth = 3;
    ctx.stroke();

    /* 钟口金色内圈 */
    ctx.fillStyle = '#2b2a24';
    roundRectPath(ctx, -this.r * 0.86, this.r * 0.5, this.r * 1.72, this.r * 0.3, 6);
    ctx.fill();
    ctx.fillStyle = '#ffd35e';
    ctx.globalAlpha = tolling ? 0.6 + 0.4 * Math.sin(t * 26) : 0.45;
    roundRectPath(ctx, -this.r * 0.78, this.r * 0.56, this.r * 1.56, this.r * 0.18, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 钟舌 */
    const ty = this.r * 0.35 + Math.sin(this.pendulum * 2) * 4;
    ctx.fillStyle = '#c8a06a';
    ctx.beginPath();
    ctx.arc(0, ty, 7, 0, TAU);
    ctx.fill();

    /* 表盘：指针随阶段加速 */
    ctx.strokeStyle = 'rgba(255,211,94,0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, -this.r * 0.15, this.r * 0.34, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -this.r * 0.15);
    ctx.lineTo(Math.cos(t * (1.5 + this.phase)) * this.r * 0.3,
      -this.r * 0.15 + Math.sin(t * (1.5 + this.phase)) * this.r * 0.3);
    ctx.stroke();

    this.drawCracks(ctx, this.r * 0.9, '#ffe9a8');
    ctx.restore();

    bossHurtRing(ctx, this);
  }
}

/* ===========================================================
   4. 腐殖母冠 · Bloom
   主题：召唤与毒沼
   攻击：孢子喷吐 / 孢子环 / 腐殖地块 / 追踪孢囊 / 藤鞭（激光） / 召唤藤裔
   特殊：开花期 —— 全场孢子云（留安全走廊）+ 大量召唤
   =========================================================== */
class Bloom extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '腐殖母冠',
      title: '它记得每一粒落在回廊里的种子',
      r: 34, hp: 600, speed: 78, touchDamage: 14, touchInterval: 0.85, mass: 9,
      rng: rng, colors: ['#2c4426', '#9ad14f', '#c8ff6a'],
      specialName: '开花期',
      phaseNames: ['抽芽', '展瓣', '腐殖满开'],
      summonPool: ['swarmer', 'bomber', 'mender'], maxMinions: 8
    });
    this.bulletDamage = 9;
    this.dmgFields = ['bulletDamage'];
    this.specialCd = 9.0;
    this.bloomT = 0;
    this.bloomLeft = 0;
    this.deathDur = 2.6;
    this.attacks = [
      { id: 'fan', cn: '孢子喷吐', w: 24 },
      { id: 'ring', cn: '孢子环', w: 20 },
      { id: 'field', cn: '腐殖地块', w: 22 },
      { id: 'homing', cn: '追踪孢囊', w: 16, min: 2 },
      { id: 'whip', cn: '藤鞭', w: 18, min: 2 },
      { id: 'summon', cn: '召唤藤裔', w: 20 }
    ];
  }

  onPhase(n) {
    /* 母冠每进一阶段就先播一轮种子 */
    this.summon(this.summonPool, n === 2 ? 3 : 4);
    this.specialCd = 1.6;
  }

  onHurt() {
    /* 受伤时抖落孢子（受伤反馈的专属表现） */
    this.game.particles.burst(this.x, this.y, 6, {
      speed: 130, life: 0.5, size: 3.4, colors: ['#9ad14f', '#c8ff6a', '#ffffff']
    });
    if (Math.random() < 0.4) {
      const a = this.rng.range(0, TAU);
      this.game.particles.spawn(this.x + Math.cos(a) * 20, this.y + Math.sin(a) * 20,
        Math.cos(a) * 40, Math.sin(a) * 40 - 20, rand(0.6, 1.1), rand(2, 4),
        '#9ad14f', { drag: 1.4 });
    }
  }

  act(dt) {
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;

    switch (this.state) {
      case 'idle':
        this.hover(dt, 210, 380);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'bloomWind'; this.stateT = 1.0; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;

      case 'fanWind':
        this.brake(0.86);
        this.telegraphText = '孢子喷吐';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 6 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.fanShot(this.phase >= 3 ? 9 : 7, 1.2, this.face, {
            speed: 300, damage: this.bulletDamage, r: 7.5, color: '#9ad14f', spin: 3
          });
          this.state = 'idle'; this.atkCd = 1.0;
        }
        break;

      case 'ringWind':
        this.brake(0.88);
        this.telegraphText = '孢子环';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.ringShot(this.phase >= 3 ? 18 : 13, {
            speed: 225, damage: this.bulletDamage, gap: 4, r: 7.5, color: '#c8ff6a'
          });
          this.state = 'idle'; this.atkCd = 1.05;
        }
        break;

      case 'fieldCast':
        this.brake(0.88);
        this.telegraphText = '腐殖地块';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const p = this.game.player;
          const n = this.phase >= 3 ? 4 : (this.phase >= 2 ? 3 : 2);
          for (let i = 0; i < n; i++) {
            const a = this.rng.range(0, TAU);
            const d = i === 0 ? 0 : this.rng.range(80, 190);
            this.addHazard(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, {
              r: 56, warn: 0.85, active: 3.4, dmg: 10, grow: 8, color: '#9ad14f'
            });
          }
          this.state = 'idle'; this.atkCd = 1.15;
        }
        break;

      case 'homingCast':
        this.brake(0.9);
        this.telegraphText = '追踪孢囊';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.homingShot(this.phase >= 3 ? 4 : 3, {
            speed: 195, damage: this.bulletDamage + 2, r: 9, color: '#c8ff6a', homing: 1
          });
          this.state = 'idle'; this.atkCd = 1.05;
        }
        break;

      case 'whipWind':
        this.brake(0.84);
        this.telegraphText = '藤鞭';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          /* 藤鞭 = 快速激光，三条从脚下伸出，留大空隙 */
          const base = this.aimAngle();
          const n = this.phase >= 3 ? 3 : 2;
          for (let i = 0; i < n; i++) {
            this.addBeam({
              x: this.x, y: this.y,
              angle: base + (i - (n - 1) / 2) * 0.85 + this.rng.range(-0.1, 0.1),
              warn: 0.68, active: 0.35, width: 15, dmg: 17, color: '#9ad14f'
            });
          }
          this.state = 'idle'; this.atkCd = 1.1;
        }
        break;

      case 'summonCast':
        this.brake(0.84);
        this.telegraphText = '召唤藤裔';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 4 : 3);
          this.state = 'idle'; this.atkCd = 1.4;
        }
        break;

      case 'bloomWind':
        this.brake(0.8);
        this.telegraphText = '开花期';
        this.stateT -= dt;
        if (Math.random() < dt * 34) {
          const a = this.rng.range(0, TAU);
          this.game.particles.spawn(this.x + Math.cos(a) * this.r, this.y + Math.sin(a) * this.r,
            Math.cos(a) * 70, Math.sin(a) * 70, rand(0.4, 0.8), rand(3, 6),
            '#c8ff6a', { drag: 1.8 });
        }
        if (this.stateT <= 0) {
          this.state = 'bloom';
          this.stateT = 2.4;
          this.bloomLeft = this.phase >= 3 ? 3 : 2;
          this.bloomT = 0;
        }
        break;

      case 'bloom':
        /* 开花期内不动，持续铺孢子云（留安全走廊）+ 分批召唤 */
        this.brake(0.92);
        this.stateT -= dt;
        this.bloomT -= dt;
        if (this.bloomT <= 0 && this.bloomLeft > 0) {
          this.bloomT = 0.7;
          this.bloomLeft--;
          this._bloomWave();
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.2; this.specialCd = 11.0; }
        break;

      default: this.state = 'idle'; break;
    }
  }

  _start(id) {
    if (id === 'fan') { this.state = 'fanWind'; this.stateT = 0.55; }
    else if (id === 'ring') { this.state = 'ringWind'; this.stateT = 0.55; }
    else if (id === 'field') { this.state = 'fieldCast'; this.stateT = 0.5; }
    else if (id === 'homing') { this.state = 'homingCast'; this.stateT = 0.55; }
    else if (id === 'whip') { this.state = 'whipWind'; this.stateT = 0.5; }
    else { this.state = 'summonCast'; this.stateT = 0.65; }
  }

  /* 特殊技能：孢子云铺场（固定留出一条安全走廊）+ 播种召唤 */
  _bloomWave() {
    const safeA = this.aimAngle() + Math.PI + this.rng.range(-0.35, 0.35);
    const rings = this.phase >= 3 ? 3 : 2;
    for (let ring = 0; ring < rings; ring++) {
      const rad = 110 + ring * 92;
      const n = 8 + ring * 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        /* 安全走廊：与安全方向夹角小于 0.55 弧度的一律不铺 */
        if (Math.abs(angleDelta(a, safeA)) < 0.55) continue;
        this.addHazard(this.x + Math.cos(a) * rad, this.y + Math.sin(a) * rad, {
          r: 44, warn: 0.6, active: 2.6, dmg: 9, color: '#9ad14f'
        });
      }
    }
    this.summon(this.summonPool, this.phase >= 3 ? 3 : 2);
    this.ringShot(12, { speed: 210, damage: this.bulletDamage, gap: 5, r: 7, color: '#c8ff6a' });
    this.game.addShake(3);
  }

  onDeathStart() {
    this.game.particles.ring(this.x, this.y, '#9ad14f', 36, 280);
    /* 母冠连同所有藤裔一起枯萎（召唤物由基类统一崩解） */
  }

  onDeath(dt) {
    /* 花瓣一片片脱落，最后整株萎倒 */
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = 0.22;
      const a = this.rng.range(0, TAU);
      this.game.particles.spawn(this.x + Math.cos(a) * this.r * 0.8, this.y + Math.sin(a) * this.r * 0.8,
        Math.cos(a) * 90, Math.sin(a) * 90 - 30, rand(0.7, 1.2), rand(4, 8),
        this.rng.chance(0.5) ? '#9ad14f' : '#c8ff6a', { drag: 1.2 });
      this.game.addShake(1.8);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const blooming = this.state === 'bloomWind' || this.state === 'bloom';

    this.drawAura(ctx, this.r + 18, '#9ad14f');

    if (this.state === 'fanWind') {
      ctx.save();
      ctx.rotate(this.face);
      bossWarnArc(ctx, this.r, 1.2, 1 - this.stateT / 0.55, '#9ad14f', t);
      ctx.restore();
    }

    ctx.save();
    if (this.dying) this.deathTransform(ctx);

    /* 藤蔓根须（阶段越多越粗） */
    ctx.strokeStyle = '#31502c';
    ctx.lineWidth = 4 + this.phase;
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + t * 0.2;
      const wob = Math.sin(t * 1.6 + i) * 6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * (this.r + 26 + wob), Math.sin(a) * (this.r + 26 + wob));
      ctx.stroke();
    }

    /* 花萼主体 */
    bossCore(ctx, this.r, '#e6ffc8', '#9ad14f', 'rgba(44,68,38,0.25)');
    ctx.fillStyle = this.colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.68, 0, TAU);
    ctx.fill();

    /* 花瓣：开花期张开 */
    const open = blooming ? 1 : 0.45 + 0.1 * Math.sin(t * 2);
    const petals = 6 + this.phase;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU + t * 0.35;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(this.r * (0.55 + 0.35 * open), 0);
      ctx.fillStyle = i % 2 ? '#c8ff6a' : '#9ad14f';
      ctx.beginPath();
      ctx.ellipse(0, 0, 15 * (0.6 + open * 0.6), 8, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    /* 花心口器 */
    ctx.fillStyle = '#1d2e1a';
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.34, 0, TAU);
    ctx.fill();
    ctx.fillStyle = blooming ? '#ffffff' : '#c8ff6a';
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * (blooming ? 22 : 4));
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.18, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    this.drawCracks(ctx, this.r * 0.9, '#e6ffc8');
    ctx.restore();

    bossHurtRing(ctx, this);
  }
}

/* ===========================================================
   5. 折射歌伶 · Prism
   主题：折射与多重弹幕
   攻击：双螺旋棱光 / 棱镜扇 / 折射激光 / 碎晶环 / 滑步突进 / 召唤棱镜仆
   特殊：棱镜回廊 —— 六道缓慢旋转的激光，缝隙随时间移动
   =========================================================== */
class Prism extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '折射歌伶',
      title: '光进入她的身体，就再也没能走出来',
      r: 30, hp: 500, speed: 116, touchDamage: 13, touchInterval: 0.8, mass: 5,
      rng: rng, colors: ['#3a2f5c', '#c8a6ff', '#7fe4ff'],
      specialName: '棱镜回廊',
      phaseNames: ['单色', '分光', '全谱'],
      summonPool: ['wisp', 'marksman'], maxMinions: 4
    });
    this.bulletDamage = 9;
    this.dmgFields = ['bulletDamage'];
    this.spiralAngle = rng.range(0, TAU);
    this.spiralLeft = 0;
    this.specialCd = 8.5;
    this.dashDir = 0;
    this.deathDur = 2.5;
    this.attacks = [
      { id: 'spiral', cn: '双螺旋棱光', w: 24 },
      { id: 'fan', cn: '棱镜扇', w: 22 },
      { id: 'laser', cn: '折射激光', w: 24, min: 2 },   /* 第 2 阶段解锁 */
      { id: 'ring', cn: '碎晶环', w: 20 },
      { id: 'dash', cn: '滑步突进', w: 16 },
      { id: 'summon', cn: '召唤棱镜仆', w: 14 }
    ];
  }

  onPhase(n) {
    /* 阶段 2 起螺旋变成双臂对转；阶段 3 激光开始扫射 */
    this.summon(this.summonPool, n === 2 ? 2 : 3);
    this.specialCd = 1.5;
  }

  onHurt() {
    /* 受击时折射出错：撒出彩色碎光 */
    this.game.particles.burst(this.x, this.y, 5, {
      speed: 180, life: 0.34, size: 3.2,
      colors: ['#c8a6ff', '#7fe4ff', '#ffffff', '#ff9de2']
    });
  }

  act(dt) {
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;

    switch (this.state) {
      case 'idle':
        this.hover(dt, 240, 420);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'mazeWind'; this.stateT = 0.8; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;

      case 'spiral':
        this.brake(0.9);
        this.telegraphText = '双螺旋棱光';
        this.stateT -= dt;
        this.spiralLeft -= dt;
        if (this.spiralLeft <= 0) {
          this.spiralLeft = 0.085;
          const arms = this.phase >= 2 ? 2 : 1;
          this.spiralAngle += 0.46 * this.phaseSpeed;
          for (let k = 0; k < arms; k++) {
            this.spiralShot(this.phase >= 3 ? 3 : 2, this.spiralAngle + k * Math.PI, {
              speed: 295, damage: this.bulletDamage, r: 6.5,
              color: k === 0 ? '#c8a6ff' : '#7fe4ff'
            });
          }
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.05; }
        break;

      case 'fanWind':
        this.brake(0.86);
        this.telegraphText = '棱镜扇';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 8 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          /* 三色扇形：中间一束慢、两侧快（可穿过缝隙） */
          const n = this.phase >= 3 ? 9 : 7;
          this.fanShot(n, 1.1, this.face, {
            speed: 300, damage: this.bulletDamage, r: 7, color: '#c8a6ff'
          });
          if (this.phase >= 2) {
            this.fanShot(3, 0.35, this.face - 0.75, {
              speed: 380, damage: this.bulletDamage, r: 6, color: '#7fe4ff'
            });
            this.fanShot(3, 0.35, this.face + 0.75, {
              speed: 380, damage: this.bulletDamage, r: 6, color: '#ff9de2'
            });
          }
          this.state = 'idle'; this.atkCd = 0.95;
        }
        break;

      case 'laserWind':
        this.brake(0.82);
        this.telegraphText = '折射激光';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const n = this.phase >= 3 ? 4 : 3;
          const base = this.aimAngle();
          const sweep = this.phase >= 3 ? 0.42 : 0;
          for (let i = 0; i < n; i++) {
            this.addBeam({
              x: this.x, y: this.y,
              angle: base + (i - (n - 1) / 2) * 0.7,
              warn: 0.7, active: 0.4, width: 15, dmg: 17,
              color: '#c8a6ff', sweep: sweep * (i % 2 ? 1 : -1)
            });
          }
          this.game.addShake(2.2);
          this.state = 'idle'; this.atkCd = 1.1;
        }
        break;

      case 'ringWind':
        this.brake(0.88);
        this.telegraphText = '碎晶环';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.ringShot(this.phase >= 3 ? 20 : 15, {
            speed: 245, damage: this.bulletDamage, gap: 4, r: 7, color: '#7fe4ff'
          });
          this.state = 'idle'; this.atkCd = 1.0;
        }
        break;

      case 'dashWind':
        this.brake(0.8);
        this.telegraphText = '滑步突进';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 7 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.dashDir = this.face;
          this.state = 'dash';
          this.stateT = 0.42;
        }
        break;

      case 'dash':
        this.stateT -= dt;
        const r = this.dashMove(dt, this.dashDir, 700 * this.phaseSpeed,
          Math.round(this.touchDamage * 1.35), 6);
        /* 滑步途中不断折射出小碎晶 */
        if (Math.random() < dt * 30) {
          this.fireBullet(this.dashDir + this.rng.range(-1, 1), {
            speed: 260, damage: 7, r: 5.5, color: '#7fe4ff', life: 2.4
          });
        }
        if (r === 'wall' || this.stateT <= 0) { this.state = 'idle'; this.atkCd = 0.9; }
        break;

      case 'summonCast':
        this.brake(0.84);
        this.telegraphText = '召唤棱镜仆';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 3 : 2);
          this.state = 'idle'; this.atkCd = 1.3;
        }
        break;

      case 'mazeWind':
        this.brake(0.82);
        this.telegraphText = '棱镜回廊';
        this.stateT -= dt;
        if (Math.random() < dt * 30) {
          const a = this.rng.range(0, TAU);
          this.game.particles.spawn(this.x + Math.cos(a) * this.r * 1.3,
            this.y + Math.sin(a) * this.r * 1.3,
            Math.cos(a) * 50, Math.sin(a) * 50, rand(0.3, 0.6), rand(3, 5),
            '#c8a6ff', { drag: 2 });
        }
        if (this.stateT <= 0) { this.state = 'maze'; this.stateT = 1.1; this._maze(); }
        break;

      case 'maze':
        this.brake(0.94);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.2; this.specialCd = 10.0; }
        break;

      default: this.state = 'idle'; break;
    }
  }

  _start(id) {
    if (id === 'spiral') { this.state = 'spiral'; this.stateT = 1.4; this.spiralLeft = 0; }
    else if (id === 'fan') { this.state = 'fanWind'; this.stateT = 0.5; }
    else if (id === 'laser') { this.state = 'laserWind'; this.stateT = 0.55; }
    else if (id === 'ring') { this.state = 'ringWind'; this.stateT = 0.5; }
    else if (id === 'dash') { this.state = 'dashWind'; this.stateT = 0.4; }
    else { this.state = 'summonCast'; this.stateT = 0.6; }
  }

  /* 特殊技能：六道缓慢旋转的激光（缝隙一直存在，跟着转） */
  _maze() {
    const n = this.phase >= 3 ? 7 : 6;
    const gapAt = Math.floor(this.rng.next() * n);
    const dir = this.rng.chance(0.5) ? 0.30 : -0.30;
    for (let i = 0; i < n; i++) {
      if (i === gapAt) continue;                    // 空出一道：始终有缝可走
      this.addBeam({
        x: this.x, y: this.y, angle: (i / n) * TAU,
        warn: 0.75, active: 0.9, width: 13, dmg: 15,
        color: i % 2 ? '#c8a6ff' : '#7fe4ff',
        sweep: dir, follow: true
      });
    }
    this.game.addShake(3.2);
    this.game.particles.ring(this.x, this.y, '#c8a6ff', 24, 260);
  }

  onDeathStart() {
    this.game.particles.ring(this.x, this.y, '#c8a6ff', 34, 320);
    /* 身体里的光一次性全部放出来 */
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      this.fireBullet(a, {
        speed: 220, damage: 6, r: 6, color: i % 2 ? '#c8a6ff' : '#7fe4ff', life: 1.6
      });
    }
  }

  onDeath(dt) {
    /* 棱镜一片片剥落、碎成光屑 */
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = 0.18;
      const a = this.rng.range(0, TAU);
      const rr = this.rng.range(0, this.r * 1.8);
      this.game.particles.burst(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr, 10, {
        speed: 200, life: 0.55, size: 4.5,
        colors: ['#c8a6ff', '#7fe4ff', '#ffffff', '#ff9de2']
      });
      this.game.addShake(1.8);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const casting = this.state === 'mazeWind' || this.state === 'laserWind';

    this.drawAura(ctx, this.r + 16, '#c8a6ff');

    if (this.state === 'dashWind') {
      ctx.save();
      ctx.rotate(this.face);
      bossWarnLine(ctx, this.r, 520 * (0.4 + 0.6 * (1 - this.stateT / 0.4)),
        1 - this.stateT / 0.4, '#7fe4ff', t);
      ctx.restore();
    }

    ctx.save();
    if (this.dying) this.deathTransform(ctx);

    /* 折射棱环（三片旋转棱柱） */
    ctx.save();
    ctx.rotate(t * (0.7 + 0.3 * this.phase));
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i / 3) * TAU);
      ctx.fillStyle = ['rgba(200,166,255,0.35)', 'rgba(127,228,255,0.35)', 'rgba(255,157,226,0.3)'][i];
      polygonPath(ctx, [
        [this.r + 8, -7], [this.r + 26, 0], [this.r + 8, 7], [this.r + 2, 0]
      ]);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    /* 主体：多面棱镜 */
    bossCore(ctx, this.r, '#f2e9ff', '#c8a6ff', 'rgba(58,47,92,0.25)');
    const faces = 6;
    for (let i = 0; i < faces; i++) {
      const a0 = (i / faces) * TAU, a1 = ((i + 1) / faces) * TAU;
      ctx.fillStyle = ['#6a4fa8', '#4a3a7a', '#8a6fd0', '#5a44a0', '#7a5cc0', '#3a2f5c'][i % 6];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a0) * this.r * 0.82, Math.sin(a0) * this.r * 0.82);
      ctx.lineTo(Math.cos(a1) * this.r * 0.82, Math.sin(a1) * this.r * 0.82);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(200,166,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.82, 0, TAU);
    ctx.stroke();

    /* 内核光点：蓄力时爆亮 */
    ctx.fillStyle = casting ? '#ffffff' : '#7fe4ff';
    ctx.globalAlpha = casting ? 0.6 + 0.4 * Math.sin(t * 26) : 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * (casting ? 0.26 : 0.18), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    this.drawCracks(ctx, this.r * 0.9, '#ffffff');
    ctx.restore();

    bossHurtRing(ctx, this);
  }
}

/* ===========================================================
   6. 沙丘巨颚 · Dune
   主题：钻地与流沙
   攻击：钻地突袭 / 沙柱 / 喷沙扇形 / 追踪沙弹 / 沙环 / 召唤沙蝎
   特殊：流沙漩涡 —— 三个漂移漩涡牵引玩家，同时升起沙柱阵
   =========================================================== */
class Dune extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '沙丘巨颚',
      title: '沙面之下，没有所谓的脚下',
      r: 35, hp: 640, speed: 92, touchDamage: 16, touchInterval: 0.85, mass: 9,
      rng: rng, colors: ['#6a5330', '#e8c88a', '#c8a06a'],
      specialName: '流沙漩涡',
      phaseNames: ['潜行', '涌沙', '沙暴'],
      summonPool: ['hopper', 'spiker'], maxMinions: 6
    });
    this.bulletDamage = 9;
    this.dmgFields = ['bulletDamage'];
    this.specialCd = 9.5;
    this.burrowed = false;
    this.burrowTarget = null;
    this.vortex = [];
    this.deathDur = 2.6;
    this.attacks = [
      { id: 'burrow', cn: '钻地突袭', w: 26 },
      { id: 'pillars', cn: '沙柱', w: 22 },
      { id: 'fan', cn: '喷沙', w: 20 },
      { id: 'homing', cn: '追踪沙弹', w: 16, min: 2 },
      { id: 'ring', cn: '沙环', w: 18 },
      { id: 'summon', cn: '召唤沙蝎', w: 14 }
    ];
  }

  onPhase(n) {
    this.summon(this.summonPool, n === 2 ? 3 : 4);
    this.specialCd = 1.6;
  }

  onHurt() {
    /* 沙块被击碎：掉落沙屑 */
    this.game.particles.burst(this.x, this.y, 6, {
      speed: 140, life: 0.45, size: 3.6, colors: ['#e8c88a', '#c8a06a', '#ffffff']
    });
  }

  /* 钻地期间免疫（有明确的沙丘移动提示，且时间很短） */
  takeDamage(amount, srcX, srcY) {
    if (this.burrowed) {
      this.game.particles.burst(this.x, this.y, 3, {
        speed: 90, life: 0.3, size: 3, color: '#e8c88a'
      });
      return;
    }
    super.takeDamage(amount, srcX, srcY);
  }

  act(dt) {
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;
    this._updateVortex(dt);

    switch (this.state) {
      case 'idle':
        if (this.burrowed) this.burrowed = false;
        this.hover(dt, 200, 360);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'vortexWind'; this.stateT = 0.85; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;

      case 'burrowDown':
        this.brake(0.8);
        this.telegraphText = '钻地突袭';
        this.stateT -= dt;
        if (Math.random() < dt * 40) {
          this.game.particles.spawn(this.x + rand(-24, 24), this.y + rand(-24, 24),
            rand(-60, 60), rand(-90, -30), rand(0.3, 0.6), rand(3, 6),
            '#e8c88a', { drag: 2.4 });
        }
        if (this.stateT <= 0) {
          this.burrowed = true;
          this.state = 'burrowMove';
          this.stateT = 0.55;
          /* 目标点：玩家附近，但留一点距离，落点有预警圈 */
          const p = this.game.player;
          const a = this.rng.range(0, TAU);
          const d = this.rng.range(60, 120);
          this.burrowTarget = arenaClamp(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 70);
          /* 落点预警：先出现沙涌圈，玩家有时间走开 */
          this.addHazard(this.burrowTarget.x, this.burrowTarget.y, {
            r: 62, warn: 0.55, active: 0.9, dmg: 15, color: '#e8c88a'
          });
          this.game.addShake(2.4);
        }
        break;

      case 'burrowMove':
        this.stateT -= dt;
        this.vx = 0; this.vy = 0;
        /* 沙丘在地面上移动（可见），抵达后破土 */
        if (this.burrowTarget) {
          const k = Math.min(1, dt * 5.5);
          this.x = lerp(this.x, this.burrowTarget.x, k);
          this.y = lerp(this.y, this.burrowTarget.y, k);
        }
        if (Math.random() < dt * 50) {
          this.game.particles.spawn(this.x + rand(-16, 16), this.y + rand(-16, 16),
            rand(-40, 40), rand(-80, -20), rand(0.25, 0.5), rand(3, 5),
            '#c8a06a', { drag: 3 });
        }
        if (this.stateT <= 0) { this.state = 'burrowUp'; this.stateT = 0.45; }
        break;

      case 'burrowUp':
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.burrowed = false;
          this.game.addShake(5);
          this.game.particles.burst(this.x, this.y, 22, {
            speed: 280, life: 0.7, size: 6, colors: ['#e8c88a', '#c8a06a', '#ffffff']
          });
          this.ringShot(this.phase >= 2 ? 14 : 10, {
            speed: 260, damage: this.bulletDamage, gap: 4, r: 7, color: '#e8c88a'
          });
          this.tryTouchDamage(this.touchDamage + 6, 30);
          this.state = 'stagger';
          this.stateT = 0.6;
        }
        break;

      case 'stagger':
        this.brake(0.86);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.1; }
        break;

      case 'pillarCast':
        this.brake(0.86);
        this.telegraphText = '沙柱';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const p = this.game.player;
          const n = this.phase >= 3 ? 6 : (this.phase >= 2 ? 4 : 3);
          for (let i = 0; i < n; i++) {
            const a = this.rng.range(0, TAU);
            const d = i === 0 ? 40 : this.rng.range(90, 230);
            this.addHazard(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, {
              r: 46, warn: 0.8, active: 2.4, dmg: 12, color: '#c8a06a'
            });
          }
          this.state = 'idle'; this.atkCd = 1.15;
        }
        break;

      case 'fanWind':
        this.brake(0.86);
        this.telegraphText = '喷沙';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 6 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.fanShot(this.phase >= 3 ? 11 : 8, 1.25, this.face, {
            speed: 320, damage: this.bulletDamage, r: 8, color: '#e8c88a', spin: 2
          });
          this.state = 'idle'; this.atkCd = 1.0;
        }
        break;

      case 'homingCast':
        this.brake(0.9);
        this.telegraphText = '追踪沙弹';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.homingShot(this.phase >= 3 ? 4 : 3, {
            speed: 200, damage: this.bulletDamage + 2, r: 9, color: '#c8a06a', homing: 1
          });
          this.state = 'idle'; this.atkCd = 1.05;
        }
        break;

      case 'ringWind':
        this.brake(0.88);
        this.telegraphText = '沙环';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.ringShot(this.phase >= 3 ? 20 : 15, {
            speed: 235, damage: this.bulletDamage, gap: 4, r: 7.5, color: '#e8c88a'
          });
          this.state = 'idle'; this.atkCd = 1.05;
        }
        break;

      case 'summonCast':
        this.brake(0.84);
        this.telegraphText = '召唤沙蝎';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 4 : 3);
          this.state = 'idle'; this.atkCd = 1.4;
        }
        break;

      case 'vortexWind':
        this.brake(0.8);
        this.telegraphText = '流沙漩涡';
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'vortex'; this.stateT = 3.4; this._vortex(); }
        break;

      case 'vortex':
        this.brake(0.92);
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.vortex.length = 0;
          this.state = 'idle'; this.atkCd = 1.2; this.specialCd = 12.0;
        }
        break;

      default: this.state = 'idle'; break;
    }
  }

  _start(id) {
    if (id === 'burrow') { this.state = 'burrowDown'; this.stateT = 0.5; }
    else if (id === 'pillars') { this.state = 'pillarCast'; this.stateT = 0.55; }
    else if (id === 'fan') { this.state = 'fanWind'; this.stateT = 0.55; }
    else if (id === 'homing') { this.state = 'homingCast'; this.stateT = 0.5; }
    else if (id === 'ring') { this.state = 'ringWind'; this.stateT = 0.5; }
    else { this.state = 'summonCast'; this.stateT = 0.6; }
  }

  /* 特殊技能：三个漂移漩涡（牵引玩家）+ 沙柱阵 */
  _vortex() {
    const n = this.phase >= 3 ? 3 : 2;
    this.vortex.length = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + this.rng.range(-0.4, 0.4);
      const pos = arenaClamp(this.x + Math.cos(a) * 220, this.y + Math.sin(a) * 220, 90);
      const drift = { x: Math.cos(a + Math.PI / 2) * 46, y: Math.sin(a + Math.PI / 2) * 46 };
      const h = this.addHazard(pos.x, pos.y, {
        r: 74, warn: 0.7, active: 2.6, dmg: 10, color: '#c8a06a', drift: drift
      });
      this.vortex.push(h);
    }
    /* 沙柱阵：以自身为心向外一圈，留缺口 */
    const m = this.phase >= 3 ? 8 : 6;
    const gapAt = Math.floor(this.rng.next() * m);
    for (let i = 0; i < m; i++) {
      if (i === gapAt) continue;
      const a = (i / m) * TAU;
      this.addHazard(this.x + Math.cos(a) * 150, this.y + Math.sin(a) * 150, {
        r: 40, warn: 0.75, active: 2.2, dmg: 11, color: '#e8c88a'
      });
    }
    this.game.addShake(3.6);
  }

  /* 漩涡牵引：只拉不锁，玩家一直可以挣脱 */
  _updateVortex(dt) {
    if (this.state !== 'vortex') return;
    for (const h of this.vortex) {
      if (h.dead) continue;
      bossPullPlayer(this.game, h.x, h.y, 165, 260, dt);
    }
  }

  onDeathStart() {
    this.game.particles.ring(this.x, this.y, '#e8c88a', 34, 300);
    this.vortex.length = 0;
  }

  onDeath(dt) {
    /* 巨躯沉入沙中：一圈圈沙浪散开 */
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = 0.3;
      this.game.particles.ring(this.x, this.y, '#c8a06a', 14, 150 + this.deathT * 90);
      this.game.particles.burst(this.x + rand(-30, 30), this.y + rand(-30, 30), 10, {
        speed: 180, life: 0.6, size: 4.5, colors: ['#e8c88a', '#c8a06a', '#ffffff']
      });
      this.game.addShake(2.4);
    }
  }

  onDraw(ctx) {
    const t = this.animT;

    this.drawAura(ctx, this.r + 16, '#e8c88a');

    /* 钻地：只画移动的沙丘（让玩家看得见它去哪） */
    if (this.burrowed) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#8a6f42';
      ctx.beginPath();
      ctx.ellipse(0, 4, this.r * 1.25, this.r * 0.72, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#e8c88a';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -t * 60;
      ctx.beginPath();
      ctx.ellipse(0, 4, this.r * 1.35, this.r * 0.8, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      /* 沙涌尖顶 */
      ctx.fillStyle = '#c8a06a';
      ctx.beginPath();
      ctx.moveTo(-this.r * 0.5, 0);
      ctx.lineTo(0, -this.r * 0.75);
      ctx.lineTo(this.r * 0.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    if (this.state === 'fanWind') {
      ctx.save();
      ctx.rotate(this.face);
      bossWarnArc(ctx, this.r, 1.25, 1 - this.stateT / 0.55, '#e8c88a', t);
      ctx.restore();
    }

    ctx.save();
    if (this.dying) this.deathTransform(ctx);

    /* 背甲沙丘 */
    ctx.fillStyle = '#8a6f42';
    polygonPath(ctx, [
      [-this.r, this.r * 0.5],
      [-this.r * 0.6, -this.r * 0.85],
      [this.r * 0.1, -this.r * 1.0],
      [this.r * 0.75, -this.r * 0.5],
      [this.r, this.r * 0.55]
    ]);
    ctx.fill();

    bossCore(ctx, this.r, '#fff3d0', '#e8c88a', 'rgba(106,83,48,0.25)');

    /* 大颚（喷沙 / 破土时张开） */
    const open = (this.state === 'fanWind' || this.state === 'burrowUp') ? 0.8 : 0.25 + 0.1 * Math.sin(t * 2.2);
    ctx.fillStyle = this.colors[0];
    for (let s = -1; s <= 1; s += 2) {
      ctx.save();
      ctx.translate(s * this.r * 0.42, this.r * 0.35);
      ctx.rotate(s * (0.4 + open));
      polygonPath(ctx, [[0, 0], [s * this.r * 0.62, -6], [s * this.r * 0.7, 8], [0, 10]]);
      ctx.fill();
      ctx.strokeStyle = '#e8c88a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    /* 复眼（两排） */
    ctx.fillStyle = '#2b2216';
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(s * (this.r * 0.22 + i * 7), -this.r * 0.35 - i * 5, 3.2, 0, TAU);
        ctx.fill();
      }
    }

    this.drawCracks(ctx, this.r * 0.9, '#fff3d0');
    ctx.restore();

    bossHurtRing(ctx, this);
  }
}

/* ===========================================================
   7. 万伏主教 · Volt
   主题：电场与连锁
   攻击：电弧激光 / 电荷环 / 电闪位移 / 电场地块 / 追踪电球 / 召唤电仆
   特殊：过载雷网 —— 全场交织的电网激光（长预警，缝隙充足）
   =========================================================== */
class Volt extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '万伏主教',
      title: '跪下不是礼节，是导电的必要姿势',
      r: 31, hp: 540, speed: 112, touchDamage: 14, touchInterval: 0.8, mass: 6,
      rng: rng, colors: ['#26384f', '#7fd7ea', '#fff07a'],
      specialName: '过载雷网',
      phaseNames: ['起电', '升压', '击穿'],
      summonPool: ['wisp', 'turret'], maxMinions: 5
    });
    this.bulletDamage = 9;
    this.dmgFields = ['bulletDamage'];
    this.specialCd = 8.0;
    this.chainLeft = 0;
    this.chainT = 0;
    this.blinkTarget = null;
    this.deathDur = 2.5;
    this.attacks = [
      { id: 'arc', cn: '电弧激光', w: 26 },
      { id: 'ring', cn: '电荷环', w: 20 },
      { id: 'blink', cn: '电闪位移', w: 16 },
      { id: 'field', cn: '电场地块', w: 20 },
      { id: 'homing', cn: '追踪电球', w: 16, min: 2 },
      { id: 'summon', cn: '召唤电仆', w: 14 }
    ];
  }

  onPhase(n) {
    this.summon(this.summonPool, n === 2 ? 2 : 3);
    this.specialCd = 1.4;
  }

  onHurt() {
    /* 受击时电弧乱窜 */
    this.game.particles.burst(this.x, this.y, 5, {
      speed: 200, life: 0.28, size: 3, colors: ['#7fd7ea', '#fff07a', '#ffffff']
    });
    this.rageT = Math.max(this.rageT, 0.5);
  }

  act(dt) {
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;

    switch (this.state) {
      case 'idle':
        this.hover(dt, 230, 400);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'gridWind'; this.stateT = 0.9; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;

      case 'arcWind':
        this.brake(0.84);
        this.telegraphText = '电弧激光';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const n = this.phase >= 3 ? 4 : (this.phase >= 2 ? 3 : 2);
          const base = this.aimAngle();
          for (let i = 0; i < n; i++) {
            this.addBeam({
              x: this.x, y: this.y,
              angle: base + (i - (n - 1) / 2) * 0.9 + this.rng.range(-0.08, 0.08),
              warn: 0.72, active: 0.38, width: 14, dmg: 16, color: '#7fd7ea'
            });
          }
          this.game.addShake(2.2);
          this.state = 'idle'; this.atkCd = 1.05;
        }
        break;

      case 'ringWind':
        this.brake(0.88);
        this.telegraphText = '电荷环';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.ringShot(this.phase >= 3 ? 20 : 15, {
            speed: 250, damage: this.bulletDamage, gap: 4, r: 7, color: '#7fd7ea'
          });
          this.state = 'idle'; this.atkCd = 1.0;
        }
        break;

      case 'blinkWind':
        this.brake(0.84);
        this.telegraphText = '电闪位移';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const p = this.game.player;
          const a = angleTo(p.x, p.y, this.x, this.y) + this.rng.range(-0.6, 0.6);
          const pos = arenaClamp(p.x + Math.cos(a) * 230, p.y + Math.sin(a) * 230, 70);
          this.game.particles.ring(this.x, this.y, '#7fd7ea', 18, 240);
          this.x = pos.x; this.y = pos.y;
          this.vx = 0; this.vy = 0;
          this.game.particles.ring(this.x, this.y, '#fff07a', 18, 220);
          /* 落点放电：短促的环形电场（有预警圈） */
          this.addHazard(this.x, this.y, {
            r: 58, warn: 0.5, active: 0.8, dmg: 9, color: '#7fd7ea'
          });
          this.state = 'idle'; this.atkCd = 0.9;
        }
        break;

      case 'fieldCast':
        this.brake(0.86);
        this.telegraphText = '电场地块';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const p = this.game.player;
          const n = this.phase >= 3 ? 5 : (this.phase >= 2 ? 4 : 3);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + this.rng.range(-0.2, 0.2);
            const d = i === 0 ? 30 : this.rng.range(90, 200);
            this.addHazard(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, {
              r: 48, warn: 0.8, active: 2.8, dmg: 11, color: '#fff07a'
            });
          }
          this.state = 'idle'; this.atkCd = 1.15;
        }
        break;

      case 'homingCast':
        this.brake(0.9);
        this.telegraphText = '追踪电球';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.homingShot(this.phase >= 3 ? 4 : 3, {
            speed: 205, damage: this.bulletDamage + 2, r: 8, color: '#fff07a', homing: 2
          });
          this.state = 'idle'; this.atkCd = 1.05;
        }
        break;

      case 'summonCast':
        this.brake(0.84);
        this.telegraphText = '召唤电仆';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 3 : 2);
          this.state = 'idle'; this.atkCd = 1.3;
        }
        break;

      case 'gridWind':
        this.brake(0.8);
        this.telegraphText = '过载雷网';
        this.stateT -= dt;
        if (Math.random() < dt * 36) {
          const a = this.rng.range(0, TAU);
          this.game.particles.spawn(this.x + Math.cos(a) * this.r, this.y + Math.sin(a) * this.r,
            Math.cos(a) * 80, Math.sin(a) * 80, rand(0.2, 0.4), rand(2, 4),
            '#fff07a', { drag: 2 });
        }
        if (this.stateT <= 0) {
          this.state = 'grid';
          this.stateT = 1.3;
          this.chainLeft = this.phase >= 3 ? 3 : 2;
          this.chainT = 0;
        }
        break;

      case 'grid':
        this.brake(0.92);
        this.stateT -= dt;
        this.chainT -= dt;
        if (this.chainT <= 0 && this.chainLeft > 0) {
          this.chainT = 0.55;
          this.chainLeft--;
          this._gridWave();
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.2; this.specialCd = 10.0; }
        break;

      default: this.state = 'idle'; break;
    }
  }

  _start(id) {
    if (id === 'arc') { this.state = 'arcWind'; this.stateT = 0.55; }
    else if (id === 'ring') { this.state = 'ringWind'; this.stateT = 0.5; }
    else if (id === 'blink') { this.state = 'blinkWind'; this.stateT = 0.4; }
    else if (id === 'field') { this.state = 'fieldCast'; this.stateT = 0.55; }
    else if (id === 'homing') { this.state = 'homingCast'; this.stateT = 0.5; }
    else { this.state = 'summonCast'; this.stateT = 0.6; }
  }

  /* 特殊技能：电网 —— 每批 5 条交叉激光，缝隙很大，预警 0.95s */
  _gridWave() {
    const n = 5;
    const base = this.rng.range(0, TAU);
    for (let i = 0; i < n; i++) {
      this.addBeam({
        x: this.x, y: this.y,
        angle: base + (i / n) * Math.PI + this.rng.range(-0.12, 0.12),
        warn: 0.95, active: 0.32, width: 12, dmg: 15, color: '#fff07a'
      });
    }
    this.game.addShake(2.8);
    this.game.particles.ring(this.x, this.y, '#7fd7ea', 18, 240);
  }

  onDeathStart() {
    this.game.particles.ring(this.x, this.y, '#fff07a', 34, 320);
    this.game.addShake(5);
  }

  onDeath(dt) {
    /* 电容逐个炸开，最后一次强放电 */
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = 0.24;
      const a = this.rng.range(0, TAU);
      const rr = this.rng.range(0, this.r * 1.6);
      this.game.particles.burst(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr, 12, {
        speed: 260, life: 0.5, size: 4.5,
        colors: ['#7fd7ea', '#fff07a', '#ffffff']
      });
      this.game.addShake(2.2);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const casting = this.state === 'gridWind' || this.state === 'grid' || this.state === 'arcWind';

    this.drawAura(ctx, this.r + 16, '#7fd7ea');

    ctx.save();
    if (this.dying) this.deathTransform(ctx);

    /* 主教冠冕（三尖） */
    ctx.fillStyle = '#2f4a63';
    polygonPath(ctx, [
      [-this.r * 0.8, -this.r * 0.4],
      [-this.r * 0.5, -this.r * 1.05],
      [0, -this.r * 0.7],
      [this.r * 0.5, -this.r * 1.05],
      [this.r * 0.8, -this.r * 0.4]
    ]);
    ctx.fill();
    ctx.strokeStyle = '#7fd7ea';
    ctx.lineWidth = 2;
    ctx.stroke();

    bossCore(ctx, this.r, '#eaffff', '#7fd7ea', 'rgba(38,56,79,0.25)');

    /* 法袍主体 */
    ctx.fillStyle = this.colors[0];
    polygonPath(ctx, [
      [-this.r * 0.75, -this.r * 0.35],
      [this.r * 0.75, -this.r * 0.35],
      [this.r * 0.5, this.r * 0.85],
      [-this.r * 0.5, this.r * 0.85]
    ]);
    ctx.fill();
    ctx.strokeStyle = '#4a6a8a';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    /* 电弧（环绕躯干的折线闪电，蓄力时更密） */
    const bolts = 3 + this.phase;
    ctx.strokeStyle = casting ? '#fff07a' : '#7fd7ea';
    ctx.lineWidth = 2;
    for (let i = 0; i < bolts; i++) {
      const a0 = (i / bolts) * TAU + t * 1.6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * this.r * 0.5, Math.sin(a0) * this.r * 0.5);
      let px = Math.cos(a0) * this.r * 0.5, py = Math.sin(a0) * this.r * 0.5;
      for (let k = 1; k <= 3; k++) {
        const a1 = a0 + k * 0.22 + Math.sin(t * 9 + i + k) * 0.18;
        const rr = this.r * (0.5 + k * 0.22);
        px = Math.cos(a1) * rr; py = Math.sin(a1) * rr;
        ctx.lineTo(px, py);
      }
      ctx.globalAlpha = casting ? 0.9 : 0.45 + 0.2 * Math.sin(t * 12 + i);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* 权杖核心 */
    ctx.fillStyle = casting ? '#ffffff' : '#fff07a';
    ctx.beginPath();
    ctx.arc(0, -this.r * 0.05, casting ? 8 + Math.sin(t * 26) * 2 : 6, 0, TAU);
    ctx.fill();

    this.drawCracks(ctx, this.r * 0.9, '#ffffff');
    ctx.restore();

    bossHurtRing(ctx, this);
  }
}

/* ===========================================================
   8. 坍缩星核 · Collapse
   主题：引力与终末
   攻击：星环弹幕 / 螺旋星屑 / 扫射激光 / 引力场 / 坍缩冲撞 / 召唤星屑
   特殊：奇点坍缩 —— 强牵引 1.4s 后内爆（大范围地面危险区）
   =========================================================== */
class Collapse extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '坍缩星核',
      title: '所有回廊的尽头，都是一个点',
      r: 33, hp: 700, speed: 100, touchDamage: 17, touchInterval: 0.85, mass: 12,
      rng: rng, colors: ['#1b1b2e', '#b98cff', '#ff6bd0'],
      specialName: '奇点坍缩',
      phaseNames: ['吸积', '临界', '坍缩'],
      summonPool: ['nucleid', 'wisp'], maxMinions: 6
    });
    this.bulletDamage = 9;
    this.dmgFields = ['bulletDamage'];
    this.specialCd = 10.0;
    this.spiralAngle = rng.range(0, TAU);
    this.spiralLeft = 0;
    this.pullT = 0;
    this.dashDir = 0;
    this.deathDur = 3.0;
    this.attacks = [
      { id: 'ring', cn: '星环弹幕', w: 24 },
      { id: 'spiral', cn: '螺旋星屑', w: 22 },
      { id: 'laser', cn: '扫射激光', w: 22 },
      { id: 'pull', cn: '引力场', w: 18, min: 2 },
      { id: 'dash', cn: '坍缩冲撞', w: 18 },
      { id: 'summon', cn: '召唤星屑', w: 14 }
    ];
  }

  onPhase(n) {
    this.summon(this.summonPool, n === 2 ? 3 : 4);
    this.specialCd = 1.5;
  }

  onHurt() {
    /* 星核被击碎一角：抛出吸积盘碎片 */
    this.game.particles.burst(this.x, this.y, 5, {
      speed: 190, life: 0.36, size: 3.4, colors: ['#b98cff', '#ff6bd0', '#ffffff']
    });
  }

  act(dt) {
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;

    switch (this.state) {
      case 'idle':
        this.hover(dt, 220, 390);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'singularityWind'; this.stateT = 1.0; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;

      case 'ringWind':
        this.brake(0.86);
        this.telegraphText = '星环弹幕';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.ringShot(this.phase >= 3 ? 22 : 16, {
            speed: 255, damage: this.bulletDamage, gap: 4, r: 7, color: '#b98cff'
          });
          this.state = 'idle'; this.atkCd = 1.0;
        }
        break;

      case 'spiral':
        this.brake(0.9);
        this.telegraphText = '螺旋星屑';
        this.stateT -= dt;
        this.spiralLeft -= dt;
        if (this.spiralLeft <= 0) {
          this.spiralLeft = 0.08;
          this.spiralAngle += 0.52 * this.phaseSpeed;
          this.spiralShot(this.phase >= 3 ? 4 : (this.phase >= 2 ? 3 : 2), this.spiralAngle, {
            speed: 300, damage: this.bulletDamage, r: 6.5, color: '#ff6bd0'
          });
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.05; }
        break;

      case 'laserWind':
        this.brake(0.82);
        this.telegraphText = '扫射激光';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const n = this.phase >= 3 ? 3 : 2;
          const base = this.aimAngle();
          const sweep = this.phase >= 3 ? 0.62 : 0.4;
          for (let i = 0; i < n; i++) {
            this.addBeam({
              x: this.x, y: this.y, angle: base + (i / n) * TAU,
              warn: 0.8, active: 0.55, width: 15, dmg: 18,
              color: '#b98cff', sweep: sweep * (i % 2 ? 1 : -1)
            });
          }
          this.game.addShake(2.6);
          this.state = 'idle'; this.atkCd = 1.1;
        }
        break;

      case 'pullWind':
        this.brake(0.88);
        this.telegraphText = '引力场';
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'pull'; this.stateT = 1.5; }
        break;

      case 'pull':
        /* 牵引玩家（力度有限，可以靠反向移动挣脱）+ 内圈减速地块 */
        this.brake(0.94);
        this.stateT -= dt;
        bossPullPlayer(this.game, this.x, this.y, 190, 430, dt);
        if (Math.random() < dt * 30) {
          const a = this.rng.range(0, TAU);
          const d = this.rng.range(60, 300);
          this.game.particles.spawn(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d,
            -Math.cos(a) * 160, -Math.sin(a) * 160, rand(0.3, 0.6), rand(2, 4),
            '#b98cff', { drag: 0.6 });
        }
        if (this.stateT <= 0) {
          /* 引力收束：一圈向内的冲击（预警后生效） */
          const m = 6;
          const gapAt = Math.floor(this.rng.next() * m);
          for (let i = 0; i < m; i++) {
            if (i === gapAt) continue;
            const a = (i / m) * TAU;
            this.addHazard(this.x + Math.cos(a) * 120, this.y + Math.sin(a) * 120, {
              r: 46, warn: 0.55, active: 1.4, dmg: 10, color: '#b98cff'
            });
          }
          this.state = 'idle'; this.atkCd = 1.15;
        }
        break;

      case 'windup':
        this.brake(0.78);
        this.telegraphText = '坍缩冲撞';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 6 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.dashDir = this.face;
          this.state = 'dash';
          this.stateT = 0.5;
          this.game.addShake(2.4);
        }
        break;

      case 'dash': {
        this.stateT -= dt;
        const r = this.dashMove(dt, this.dashDir, 680 * this.phaseSpeed,
          Math.round(this.touchDamage * 1.4), 8);
        if (r === 'wall' || this.stateT <= 0) {
          this.state = 'stagger';
          this.stateT = 0.55;
          this.game.addShake(4.5);
          this.addHazard(this.x, this.y, {
            r: 60, warn: 0.5, active: 1.6, dmg: 11, color: '#ff6bd0'
          });
        }
        break;
      }

      case 'stagger':
        this.brake(0.86);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.0; }
        break;

      case 'summonCast':
        this.brake(0.84);
        this.telegraphText = '召唤星屑';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 4 : 3);
          this.state = 'idle'; this.atkCd = 1.35;
        }
        break;

      case 'singularityWind':
        this.brake(0.8);
        this.telegraphText = '奇点坍缩';
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'singularity'; this.stateT = 1.4; }
        break;

      case 'singularity':
        /* 强牵引 1.4s（预警期间可以跑远），随后内爆 */
        this.brake(0.95);
        this.stateT -= dt;
        bossPullPlayer(this.game, this.x, this.y, 235, 520, dt);
        if (Math.random() < dt * 46) {
          const a = this.rng.range(0, TAU);
          const d = this.rng.range(70, 380);
          this.game.particles.spawn(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d,
            -Math.cos(a) * 260, -Math.sin(a) * 260, rand(0.25, 0.55), rand(2.5, 5),
            '#ff6bd0', { drag: 0.4 });
        }
        if (this.stateT <= 0) { this.state = 'implode'; this.stateT = 0.9; this._implode(); }
        break;

      case 'implode':
        this.brake(0.92);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.2; this.specialCd = 13.0; }
        break;

      default: this.state = 'idle'; break;
    }
  }

  _start(id) {
    if (id === 'ring') { this.state = 'ringWind'; this.stateT = 0.5; }
    else if (id === 'spiral') { this.state = 'spiral'; this.stateT = 1.35; this.spiralLeft = 0; }
    else if (id === 'laser') { this.state = 'laserWind'; this.stateT = 0.6; }
    else if (id === 'pull') { this.state = 'pullWind'; this.stateT = 0.55; }
    else if (id === 'dash') { this.state = 'windup'; this.stateT = 0.6; }
    else { this.state = 'summonCast'; this.stateT = 0.6; }
  }

  /* 特殊技能：内爆（大范围但只有中心一圈，边缘永远安全） */
  _implode() {
    this.addHazard(this.x, this.y, {
      r: 150, warn: 0.5, active: 1.5, dmg: 20, color: '#ff6bd0'
    });
    const m = 8;
    const gapAt = Math.floor(this.rng.next() * m);
    for (let i = 0; i < m; i++) {
      if (i === gapAt || i === (gapAt + 1) % m) continue;
      const a = (i / m) * TAU;
      this.addHazard(this.x + Math.cos(a) * 250, this.y + Math.sin(a) * 250, {
        r: 44, warn: 0.5, active: 1.8, dmg: 11, color: '#b98cff'
      });
    }
    this.ringShot(this.phase >= 2 ? 20 : 16, {
      speed: 270, damage: this.bulletDamage + 1, gap: 5, r: 7, color: '#ff6bd0'
    });
    this.game.addShake(7);
    this.game.particles.ring(this.x, this.y, '#ff6bd0', 34, 380);
  }

  onDeathStart() {
    this.game.particles.ring(this.x, this.y, '#b98cff', 40, 340);
    this.game.addShake(8);
  }

  onDeath(dt) {
    /* 先急速收缩成一点，再炸成一片星尘 */
    const q = clamp(this.deathT / this.deathDur, 0, 1);
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = q < 0.6 ? 0.16 : 0.3;
      if (q < 0.6) {
        const a = this.rng.range(0, TAU);
        const d = this.rng.range(120, 340);
        this.game.particles.spawn(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d,
          -Math.cos(a) * 320, -Math.sin(a) * 320, rand(0.3, 0.6), rand(2.5, 5),
          '#b98cff', { drag: 0.5 });
      } else {
        const a = this.rng.range(0, TAU);
        this.game.particles.burst(this.x + Math.cos(a) * 40, this.y + Math.sin(a) * 40, 18, {
          speed: 300, life: 0.8, size: 5.5,
          colors: ['#b98cff', '#ff6bd0', '#ffffff']
        });
        this.game.addShake(3.6);
      }
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const pulling = this.state === 'pull' || this.state === 'singularity' || this.state === 'singularityWind';

    this.drawAura(ctx, this.r + 20, '#b98cff');

    /* 引力场可视化：向内收束的同心环 */
    if (pulling) {
      ctx.save();
      ctx.strokeStyle = '#b98cff';
      for (let i = 0; i < 4; i++) {
        const phase = (t * 0.85 + i * 0.25) % 1;
        const rr = lerp(430, 90, phase);
        ctx.globalAlpha = 0.30 * (1 - Math.abs(phase - 0.5) * 1.2);
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this.state === 'windup') {
      ctx.save();
      ctx.rotate(this.face);
      bossWarnLine(ctx, this.r, 660 * (0.35 + 0.65 * (1 - this.stateT / 0.6)),
        1 - this.stateT / 0.6, '#ff6bd0', t);
      ctx.restore();
    }

    ctx.save();
    if (this.dying) this.deathTransform(ctx);

    /* 吸积盘（两层反向旋转） */
    ctx.save();
    ctx.rotate(t * 1.1);
    ctx.strokeStyle = 'rgba(185,140,255,0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 1.7, this.r * 0.62, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.rotate(-t * 0.8);
    ctx.strokeStyle = 'rgba(255,107,208,0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 1.35, this.r * 0.5, 0.6, 0, TAU);
    ctx.stroke();
    ctx.restore();

    /* 事件视界：纯黑核心 */
    bossCore(ctx, this.r, '#ffffff', '#b98cff', 'rgba(27,27,46,0.35)');
    ctx.fillStyle = '#05040a';
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.62, 0, TAU);
    ctx.fill();

    /* 视界外圈的高光（越接近死亡越亮） */
    const hurt = 1 - clamp(this.hp / this.maxHp, 0, 1);
    ctx.strokeStyle = pulling ? '#ff6bd0' : '#ffffff';
    ctx.globalAlpha = 0.5 + 0.4 * hurt + (pulling ? 0.3 * Math.sin(t * 24) : 0);
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.62, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    /* 环绕的星屑 */
    for (let i = 0; i < 6; i++) {
      const a = t * 1.6 + (i / 6) * TAU;
      const rr = this.r * (1.05 + 0.25 * Math.sin(t * 2 + i));
      ctx.fillStyle = i % 2 ? '#b98cff' : '#ff6bd0';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 3.4, 0, TAU);
      ctx.fill();
    }

    this.drawCracks(ctx, this.r * 0.9, '#ff6bd0');
    ctx.restore();

    bossHurtRing(ctx, this);
  }
}

/* ===========================================================
   Boss 名册：按层数挑选（第 1 层固定回廊守望者）
   —— 数据驱动：新增 Boss = 加一条 { id, minFloor }
   =========================================================== */
const BossRoster = {
  list: [
    { id: 'boss', name: '回廊守望者', minFloor: 1 },
    { id: 'boss_slagsmith', name: '熔渣铸匠', minFloor: 2 },
    { id: 'boss_weaver', name: '经纬织者', minFloor: 2 },
    { id: 'boss_verdict', name: '铁律摆钟', minFloor: 3 },
    { id: 'boss_bloom', name: '腐殖母冠', minFloor: 3 },
    { id: 'boss_prism', name: '折射歌伶', minFloor: 4 },
    { id: 'boss_dune', name: '沙丘巨颚', minFloor: 4 },
    { id: 'boss_volt', name: '万伏主教', minFloor: 5 },
    { id: 'boss_collapse', name: '坍缩星核', minFloor: 6 }
  ],

  /* floor 从 1 开始；rng 传入 → 同 Seed 同 Boss
     （不使用跨局状态：只依赖 floor + rng，保证种子可复现）
     章节表（chapters.js）为每层指定了专属 Boss 池，池与池之间互不重叠
     → 每层遇到的 Boss 一定是该层独有的那一批 */
  pick(floor, rng) {
    if (!floor || floor <= 1) { this.lastId = 'boss'; return 'boss'; }
    const r = rng || new Rng(floor);

    if (typeof CHAPTERS !== 'undefined') {
      const ch = ChapterOf(floor);
      if (ch && ch.bosses && ch.bosses.length) {
        /* 只保留「已解锁」的 Boss（Meta 解锁后才会加入该层随机池） */
        let use = ch.bosses.filter(id => this.list.some(b => b.id === id));
        use = Meta.availableBosses(use);
        if (use.length) {
          const id = r.pick(use);
          this.lastId = id;
          return id;
        }
      }
    }

    const pool = this.list.filter(b => b.id !== 'boss' && floor >= (b.minFloor || 1));
    if (!pool.length) return 'boss';
    let use = pool;
    if (pool.length > 1) {
      /* 避免与「上一层会遇到的 Boss」重复：用 floor 派生 Rng 计算，仍然可复现 */
      const prevPool = this.list.filter(b => b.id !== 'boss' && (floor - 1) >= (b.minFloor || 1));
      if (prevPool.length) {
        const prev = r.fork('prev').pick(prevPool).id;
        const f = pool.filter(b => b.id !== prev);
        if (f.length) use = f;
      }
    }
    return r.pick(use).id;
  },

  nameOf(id) {
    for (const b of this.list) if (b.id === id) return b.name;
    return '回廊守望者';
  },

  /* UI 用：展示当前层的 Boss 信息 */
  infoOf(id) {
    const d = EnemyFactory.defOf(id);
    return { name: (d && d.boss && d.boss.name) || this.nameOf(id), title: (d && d.boss && d.boss.title) || '' };
  }
};

/* ===========================================================
   注册（cat: 'boss' → 不会进入普通房间的生成池）
   =========================================================== */
EnemyFactory.register('boss_slagsmith', Slagsmith, {
  r: 32, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '熔渣铸匠', title: '炉火不熄，锻渣成形' }
});
EnemyFactory.register('boss_weaver', Weaver, {
  r: 30, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '经纬织者', title: '每一条线，都是一道未竟的回廊' }
});
EnemyFactory.register('boss_verdict', Verdict, {
  r: 36, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '铁律摆钟', title: '每一记钟声，都是一次不可上诉的判决' }
});
EnemyFactory.register('boss_bloom', Bloom, {
  r: 34, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '腐殖母冠', title: '它记得每一粒落在回廊里的种子' }
});
EnemyFactory.register('boss_prism', Prism, {
  r: 30, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '折射歌伶', title: '光进入她的身体，就再也没能走出来' }
});
EnemyFactory.register('boss_dune', Dune, {
  r: 35, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '沙丘巨颚', title: '沙面之下，没有所谓的脚下' }
});
EnemyFactory.register('boss_volt', Volt, {
  r: 31, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '万伏主教', title: '跪下不是礼节，是导电的必要姿势' }
});
EnemyFactory.register('boss_collapse', Collapse, {
  r: 33, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '坍缩星核', title: '所有回廊的尽头，都是一个点' }
});
