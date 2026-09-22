/* ===========================================================
   props.js — 房间内的可交互物件
   宝箱 / 异象祭坛 / 商栈基座 / 层间裂隙
   全部原创，材质用 Canvas 绘制
   =========================================================== */
'use strict';

class Prop {
  constructor(game, x, y, opt) {
    opt = opt || {};
    this.game = game;
    this.x = x;
    this.y = y;
    this.r = opt.r || 20;
    this.used = false;
    this.animT = Math.random() * 6;
    this.label = opt.label || '交互';
    this.hint = '';
  }

  update(dt) { this.animT += dt; }

  inRange(player) {
    return dist(this.x, this.y, player.x, player.y) < this.r + player.r + 26;
  }

  use() { if (this.used) return false; this.used = true; return true; }

  /* 底座光环（所有物件共用） */
  drawBase(ctx, color, alpha) {
    const t = this.animT;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 0.35 : alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const rr = this.r + 8 + Math.sin(t * 2) * 2.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, rr, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /* 头顶提示箭头 */
  drawMarker(ctx, color) {
    const t = this.animT;
    const y = this.y - this.r - 20 + Math.sin(t * 3) * 3;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    polygonPath(ctx, [
      [this.x, y + 10],
      [this.x - 7, y - 2],
      [this.x + 7, y - 2]
    ]);
    ctx.fill();
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   宝箱（Treasure）
   ----------------------------------------------------------- */
class Chest extends Prop {
  constructor(game, x, y, rng, lesser) {
    super(game, x, y, { r: 22 });
    this.rng = rng;
    this.lesser = !!lesser;
    /* 道具来自数据驱动的道具表，按房间种子抽取 → 同 Seed 完全一致 */
    const build = game.player ? game.player.build : null;
    this.item = pickItem(rng, build, { synergy: true, early: (build ? build.length : 0) < 2 });
    this.label = '开启宝箱';
    this.openT = 0;
    this.burstT = 0;          // 开箱演出计时（0 表示未触发）
  }

  use() {
    if (!super.use()) return false;
    const p = this.game.player;
    const got = p.gainItem(this.item.id);
    if (!got) return false;                 // 已达堆叠上限
    this.game.ui.showBanner(got.name, got.desc, 2.6);

    /* ---- 开箱演出：箱盖弹开 → 光柱冲起 → 道具卡浮现 ---- */
    this.burstT = 0.0001;
    this.game.particles.burst(this.x, this.y - 6, 26, {
      speed: 220, life: 0.8, size: 5,
      colors: [this.item.color, '#ffffff', '#ffd35e']
    });
    this.game.particles.ring(this.x, this.y, this.item.color, 20, 200);
    this.game.addShake(2.4);
    if (typeof Juice !== 'undefined') {
      Juice.itemPop(this.game, this.x, this.y - 16, { name: got.name, color: got.color });
      Juice.flash(this.game, '#ffe08a', 0.10, 0.16);
      Juice.ring(this.game, this.x, this.y, this.item.color, 120, 0.4, 3);
    }
    return true;
  }

  update(dt) {
    super.update(dt);
    if (this.used && this.openT < 1) this.openT = Math.min(1, this.openT + dt * 2.4);
    if (this.used) this.burstT += dt;
  }

  draw(ctx) {
    const t = this.animT;
    /* 箱盖用回弹缓动：先猛地弹开，再落回一点 */
    const open = easeOutBack(clamp(this.openT, 0, 1));
    const col = this.used ? '#5d6f7e' : this.item.color;
    this.drawBase(ctx, col, 0.35);
    if (!this.used) this.drawMarker(ctx, col);

    /* 开箱瞬间冲起的光柱 */
    if (this.used && this.burstT < 0.9) {
      const a = (1 - this.burstT / 0.9);
      ctx.save();
      ctx.globalAlpha = a * 0.55;
      const g = ctx.createLinearGradient(this.x, this.y - 10, this.x, this.y - 190);
      g.addColorStop(0, this.item.color);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      const w = 16 + 26 * (1 - a);
      ctx.beginPath();
      ctx.moveTo(this.x - w * 0.35, this.y - 6);
      ctx.lineTo(this.x + w * 0.35, this.y - 6);
      ctx.lineTo(this.x + w, this.y - 190);
      ctx.lineTo(this.x - w, this.y - 190);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    const bob = this.used ? 0 : Math.sin(t * 2.2) * 2;
    ctx.translate(0, bob);

    /* 箱体 */
    ctx.fillStyle = '#3a2a18';
    roundRectPath(ctx, -20, -10, 40, 22, 4);
    ctx.fill();
    ctx.strokeStyle = '#7a5a2a';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 箱盖（开启时抬起并翻转，带轻微过冲） */
    ctx.save();
    ctx.translate(0, -10 - open * 16);
    ctx.rotate(-open * 0.95);
    ctx.fillStyle = '#4a3520';
    roundRectPath(ctx, -21, -14, 42, 16, 6);
    ctx.fill();
    ctx.strokeStyle = '#8a6a32';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    /* 锁扣 / 内部光 */
    if (!this.used) {
      ctx.fillStyle = '#ffd35e';
      roundRectPath(ctx, -4, -4, 8, 8, 2);
      ctx.fill();
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(t * 4);
      ctx.fillStyle = '#ffd35e';
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ffd35e';
      ctx.beginPath();
      ctx.arc(0, -6, 10, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   Boss 遗物（Boss 房通关掉落）—— 必定是一件强力道具
   ----------------------------------------------------------- */
class BossRelic extends Prop {
  constructor(game, x, y, rng) {
    super(game, x, y, { r: 26 });
    this.rng = rng;
    const build = game.player ? game.player.build : null;
    this.item = pickStrongItem(rng, build);
    this.label = '取走首领遗物';
    this.openT = 0;
  }

  use() {
    if (!super.use()) return false;
    const p = this.game.player;
    const got = p.gainItem(this.item.id);
    if (!got) return false;
    this.game.ui.showBanner('遗物 · ' + got.name, got.desc, 3.2);
    this.game.particles.burst(this.x, this.y, 34, {
      speed: 240, life: 0.9, size: 6,
      colors: [this.item.color, '#ffffff', '#ffd35e']
    });
    this.game.particles.ring(this.x, this.y, this.item.color, 24, 220);
    this.game.addShake(3);
    if (typeof Juice !== 'undefined') {
      Juice.itemPop(this.game, this.x, this.y - 20, { name: got.name, color: got.color });
      Juice.ring(this.game, this.x, this.y, this.item.color, 190, 0.55, 4);
      Juice.flash(this.game, this.item.color, 0.14, 0.2);
    }
    return true;
  }

  update(dt) {
    super.update(dt);
    if (this.used && this.openT < 1) this.openT = Math.min(1, this.openT + dt * 2);
    /* 未拾取时持续散发星屑 */
    if (!this.used && Math.random() < dt * 12) {
      const a = Math.random() * TAU;
      this.game.particles.spawn(this.x + Math.cos(a) * 22, this.y + Math.sin(a) * 22,
        Math.cos(a) * 18, Math.sin(a) * 18 - 26, rand(0.5, 1.0), rand(2, 4),
        this.item.color, { drag: 1.2 });
    }
  }

  draw(ctx) {
    const t = this.animT;
    const col = this.used ? '#5d6f7e' : this.item.color;
    this.drawBase(ctx, col, 0.42);
    if (!this.used) this.drawMarker(ctx, col);

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.translate(0, this.used ? 0 : Math.sin(t * 2) * 3);

    /* 三柱残骸托起的光核 */
    ctx.strokeStyle = '#3a2a18';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i - 1) * 1.1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12 + 8);
      ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20 + 20);
      ctx.stroke();
    }

    /* 光核 */
    const rr = 13 + Math.sin(t * 3) * 1.6;
    const g = ctx.createRadialGradient(0, -2, 2, 0, -2, 30);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = this.used ? 0.35 : 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -2, 30, 0, TAU);
    ctx.fill();

    ctx.fillStyle = this.used ? '#4a5666' : '#ffffff';
    ctx.beginPath();
    ctx.arc(0, -2, rr * 0.5, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 旋转棱框 */
    ctx.save();
    ctx.rotate(t * 0.9);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    polygonPath(ctx, [[0, -22], [19, 11], [-19, 11]]);
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    /* 未拾取时显示道具名 */
    if (!this.used) {
      ctx.save();
      ctx.font = '700 12px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.fillText(this.item.name, this.x, this.y - 42);
      ctx.restore();
    }
  }
}

/* -----------------------------------------------------------
   异象祭坛（Event）—— 随机正负效果
   ----------------------------------------------------------- */
class Shrine extends Prop {
  constructor(game, x, y, rng) {
    super(game, x, y, { r: 24 });
    this.rng = rng;
    this.label = '触碰异象';
    this.outcome = this._roll();
  }

  _roll() {
    const rng = this.rng;
    const roll = rng.next();
    if (roll < 0.30) return { id: 'heal', name: '回响恩泽', desc: '生命完全回复', color: '#7dffb0' };
    if (roll < 0.55) return { id: 'power', name: '残响灌注', desc: '攻击力 +5，最大生命 -8', color: '#ff8a5c' };
    if (roll < 0.78) return { id: 'ember', name: '余烬涌流', desc: '获得 14 余烬', color: '#ffd35e' };
    return { id: 'risk', name: '裂焰契约', desc: '当前生命 -18，暴击率 +15%', color: '#c08bff' };
  }

  use() {
    if (!super.use()) return false;
    const p = this.game.player;
    const o = this.outcome;
    if (o.id === 'heal') p.hp = p.maxHp;
    else if (o.id === 'power') { p.damage += 5; p.maxHp = Math.max(30, p.maxHp - 8); p.hp = Math.min(p.hp, p.maxHp); }
    else if (o.id === 'ember') this.game.embers += 14;
    else if (o.id === 'risk') { p.critChance = Math.min(0.7, p.critChance + 0.15); p.takeDamage(18, this.x, this.y + 60); p.invuln = 0; }

    this.game.ui.showBanner(o.name, o.desc, 2.2);
    this.game.damageNumbers.add(this.x, this.y - 32, o.name, { color: o.color, life: 1.3, vy: -40 });
    this.game.particles.ring(this.x, this.y, o.color, 20, 200);
    return true;
  }

  update(dt) { super.update(dt); }

  draw(ctx) {
    const t = this.animT;
    const col = this.used ? '#5d6f7e' : this.outcome.color;
    this.drawBase(ctx, col, 0.3);
    if (!this.used) this.drawMarker(ctx, col);

    ctx.save();
    ctx.translate(this.x, this.y);

    /* 三根立柱 */
    ctx.strokeStyle = '#2c3446';
    ctx.lineWidth = 5;
    for (let i = 0; i < 3; i++) {
      const a = t * 0.5 + (i / 3) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 16, Math.sin(a) * 8);
      ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 8 - 26);
      ctx.stroke();
    }

    /* 悬浮晶体 */
    const fy = -34 + Math.sin(t * 2) * 3;
    ctx.save();
    ctx.translate(0, fy);
    ctx.rotate(t * 0.8);
    ctx.fillStyle = col;
    ctx.globalAlpha = this.used ? 0.35 : 0.9;
    polygonPath(ctx, [[0, -11], [8, 0], [0, 11], [-8, 0]]);
    ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }
}

/* -----------------------------------------------------------
   商栈基座（Shop）—— 消耗余烬换取强化
   ----------------------------------------------------------- */
class Pedestal extends Prop {
  constructor(game, x, y, rng, cost) {
    super(game, x, y, { r: 20 });
    this.rng = rng;
    this.cost = cost;
    this.item = pickItem(rng, game.player ? game.player.build : null, { synergy: true });
    this.label = `购买 ${cost} 余烬`;
    this.denyT = 0;
  }

  canAfford() { return this.game.embers >= this.cost; }

  use() {
    if (this.used) return false;
    if (!this.canAfford()) {
      this.denyT = 0.6;
      this.game.damageNumbers.add(this.x, this.y - 28, '余烬不足', { color: '#ff7a7a', life: 0.9 });
      return false;
    }
    this.used = true;
    this.game.embers -= this.cost;
    const got = this.game.player.gainItem(this.item.id);
    if (!got) { this.used = false; this.game.embers += this.cost; return false; }
    this.game.ui.showBanner(got.name, got.desc, 2.6);
    this.game.damageNumbers.add(this.x, this.y - 30, this.item.name, {
      color: this.item.color, life: 1.3, vy: -40
    });
    this.game.particles.burst(this.x, this.y, 20, {
      speed: 180, life: 0.7, size: 4, colors: [this.item.color, '#ffffff', '#7fe4ff']
    });
    return true;
  }

  update(dt) {
    super.update(dt);
    if (this.denyT > 0) this.denyT -= dt;
  }

  draw(ctx) {
    const t = this.animT;
    const col = this.used ? '#4a5a66' : (this.canAfford() ? this.item.color : '#7a6a5a');
    this.drawBase(ctx, this.canAfford() && !this.used ? col : '#5d6f7e', 0.32);
    if (!this.used) this.drawMarker(ctx, col);

    ctx.save();
    ctx.translate(this.x, this.y);

    /* 基座 */
    ctx.fillStyle = '#1d2531';
    roundRectPath(ctx, -18, 0, 36, 14, 3);
    ctx.fill();
    ctx.strokeStyle = '#3c4a5e';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#161d27';
    roundRectPath(ctx, -12, -22, 24, 24, 3);
    ctx.fill();
    ctx.stroke();

    /* 商品 */
    if (!this.used) {
      const fy = -32 + Math.sin(t * 2.4) * 2.5;
      ctx.save();
      ctx.translate(0, fy);
      ctx.rotate(t * 0.9);
      ctx.fillStyle = this.item.color;
      ctx.globalAlpha = this.canAfford() ? 1 : 0.45;
      polygonPath(ctx, [[0, -9], [7, 0], [0, 9], [-7, 0]]);
      ctx.fill();
      ctx.restore();

      /* 价格 */
      ctx.globalAlpha = 1;
      ctx.font = '800 13px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.canAfford() ? '#ffd35e' : '#ff7a7a';
      ctx.fillText('◈' + this.cost, 0, 26);
    } else {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#5d6f7e';
      ctx.beginPath(); ctx.arc(0, -18, 8, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   层间裂隙（Boss 房通关后出现）
   ----------------------------------------------------------- */
class Portal extends Prop {
  constructor(game, x, y, label) {
    super(game, x, y, { r: 30 });
    this.label = label || '进入下一层';
  }

  use() {
    if (!super.use()) return false;
    this.game.particles.burst(this.x, this.y, 40, {
      speed: 300, life: 1.0, size: 5, colors: ['#ffd35e', '#ff8a5c', '#ffffff', '#7fe4ff']
    });
    this.game.nextFloor();
    return true;
  }

  draw(ctx) {
    const t = this.animT;
    ctx.save();
    ctx.translate(this.x, this.y);

    /* 外圈旋转符环 */
    ctx.strokeStyle = 'rgba(255,200,110,0.55)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const a0 = t * (0.8 + i * 0.4) + (i / 3) * TAU;
      ctx.beginPath();
      ctx.arc(0, 0, 30 + i * 9, a0, a0 + Math.PI * 1.2);
      ctx.stroke();
    }

    /* 裂隙核心 */
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, '#ffd35e');
    g.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 34 + Math.sin(t * 3) * 3, 0, TAU);
    ctx.fill();

    ctx.restore();
    this.drawBase(ctx, '#ffd35e', 0.4);
  }
}
