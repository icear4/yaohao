/* ===========================================================
   game.js — 主循环 / 状态机 / 地图与房间推进 / 全局事件
   扩展：程序生成的地图、Seed 系统、房间类型、摄像机滑动切换
   =========================================================== */
'use strict';

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;

    this.input = new Input(canvas);
    this.ui = new UI(this);
    this.particles = new ParticleSystem(900);
    this.damageNumbers = new DamageNumbers();
    this.projectiles = [];

    this.state = 'title';        // title | playing | paused | gameover
    this.time = 0;
    this.kills = 0;
    this.shake = 0;
    this.transition = null;
    this.mouseWorld = { x: VIEW_W / 2, y: VIEW_H / 2 };
    this.nearProp = null;
    this.fx = [];                // 电弧等短时特效
    this.zones = [];             // 泥沼等持续区域

    /* 种子 / 层数 / 货币 / 已获得道具 */
    this.seed = randomSeedString();
    this.floor = 1;
    this.embers = 0;
    this.ownedItems = [];

    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    /* 已实例化的房间缓存：key = floor#c,r
       → 重新进入已探索的房间时复用同一实例，敌人 / 宝箱 / 状态都不会刷新 */
    this.roomCache = {};

    /* 首屏也要有一张地图和房间（标题界面背景） */
    this.map = new GameMap(this.seed, this.floor);
    this.player = new Player(this, VIEW_W / 2, VIEW_H / 2 + 90);
    this.room = this._roomFor(this.map.start);
    this.map.current = this.map.start;
    this.map.visit(this.map.start);

    this._placePlayerAtEntry('bottom');

    this.input.onBlur = () => { if (this.state === 'playing') this.pause(); };

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.resize(), 60));
  }

  /* ---------------------------------------------------------
     尺寸 / 全屏
     --------------------------------------------------------- */
  resize() {
    const stage = document.getElementById('stage');
    const pad = 30;
    const aw = Math.max(400, window.innerWidth - pad);
    const ah = Math.max(240, window.innerHeight - pad);
    const s = Math.min(aw / VIEW_W, ah / VIEW_H);
    stage.style.width = Math.floor(VIEW_W * s) + 'px';
    stage.style.height = Math.floor(VIEW_H * s) + 'px';

    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(VIEW_W * this.dpr);
    this.canvas.height = Math.round(VIEW_H * this.dpr);
  }

  toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      const el = document.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
    }
  }

  /* ---------------------------------------------------------
     流程控制
     --------------------------------------------------------- */
  startRun(seedStr) {
    this.seed = (seedStr && String(seedStr).trim().length)
      ? String(seedStr).trim().toUpperCase()
      : randomSeedString();

    this.floor = 1;
    this.kills = 0;
    this.embers = 0;
    this.ownedItems = [];
    this.projectiles.length = 0;
    this.fx.length = 0;
    this.zones.length = 0;
    this.particles.clear();
    this.damageNumbers.clear();
    this.transition = null;
    this.shake = 0;
    this.nearProp = null;
    this.roomCache = {};

    this.player = new Player(this, VIEW_W / 2, VIEW_H / 2 + 90);
    this.map = new GameMap(this.seed, this.floor);
    this.state = 'playing';
    this.ui.setOverlay(null);

    this.room = this._roomFor(this.map.start);
    this.map.current = this.map.start;
    this.map.visit(this.map.start);
    this._placePlayerAtEntry('bottom');

    this.ui.showBanner('第 1 层 · ' + this.map.cells.length + ' 间',
      'SEED ' + this.seed + ' · 走到守望者面前', 2.4);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.setOverlay('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.setOverlay(null);
  }

  primaryAction() {
    if (this.state === 'title' || this.state === 'gameover') this.startRun(this.ui.readSeedInput());
    else if (this.state === 'paused') this.resume();
  }

  roomTypeName() { return this.room ? this.room.meta.cn : '-'; }

  onPlayerDeath() {
    this.state = 'gameover';
    this.addShake(16);
    this.particles.burst(this.player.x, this.player.y, 34, {
      speed: 260, life: 0.9, size: 5, colors: ['#ffb347', '#ff6b5c', '#ffffff', '#7fd7ea']
    });
    this.ui.setOverlay('gameover');
  }

  onEnemyKilled(e) {
    this.kills++;
    let drop = 2;
    if (e.type === 'charger') drop = 3;
    else if (e.type === 'shooter') drop = 2;
    if (e.type === 'boss') drop = 40;
    if (e.isBoss) drop = 40;
    this.embers += drop;
    this.damageNumbers.add(e.x, e.y - 14, '◈' + drop, { color: '#ffd35e', life: 0.9, vy: -46 });

    /* 击杀类组合 */
    const m = (this.player && this.player.mods) ? this.player.mods : {};
    if (m.killBlast > 0) {
      this._explode(e.x, e.y, 56 + 12 * m.killBlast, 12 * m.killBlast, { color: '#ffd35e' });
    }
    if (m.freezeExplode > 0 && e.freezeT > 0) {
      this._explode(e.x, e.y, 82, 24, { color: '#8fd8ff', freeze: true });
    }
  }

  onRoomCleared(room) {
    if (room.type === ROOM_TYPE.BOSS) {
      this.ui.showClearBanner('守望者已陨落 · 触碰裂隙进入下一层');
      this.player.heal(35);
      this.addShake(10);
    } else if (room.isCombatRoom) {
      this.ui.showClearBanner();
      this.player.heal(room.type === ROOM_TYPE.ELITE ? 18 : 10);
    }
  }

  nextFloor() {
    this.floor++;
    this.transition = null;
    this.projectiles.length = 0;
    this.fx.length = 0;
    this.zones.length = 0;
    this.particles.clear();
    this.damageNumbers.clear();
    this.roomCache = {};
    this.map = new GameMap(this.seed, this.floor);
    this.room = this._roomFor(this.map.start);
    this.map.current = this.map.start;
    this.map.visit(this.map.start);
    this._placePlayerAtEntry('bottom');
    this.player.heal(20);
    this.ui.showBanner('第 ' + this.floor + ' 层',
      '回廊重新排列 · ' + this.map.cells.length + ' 间', 2.4);
  }

  /* ---------------------------------------------------------
     房间创建与进入
     --------------------------------------------------------- */
  _createRoom(cell) {
    const seedKey = this.seed + '#' + this.floor + '#' + cell.c + ',' + cell.r;
    const rng = new Rng(hashSeed(seedKey));
    const tier = (this.floor - 1) * 2 +
      (cell.type === ROOM_TYPE.ELITE ? 3 : 0) +
      (cell.branch ? 1 : 0);
    return new Room(this, {
      def: cell,
      index: cell.id,
      depth: this.floor - 1,
      tier: tier,
      connections: this.map.connectionsOf(cell),
      rng: rng,
      roomSeed: seedKey
    });
  }

  /* 取（或首次创建）房间实例：已存在则复用，保证房间状态持久化 */
  _roomFor(cell) {
    const key = this.floor + '#' + cell.c + ',' + cell.r;
    let room = this.roomCache[key];
    if (!room) {
      room = this._createRoom(cell);
      this.roomCache[key] = room;
    }
    return room;
  }

  _placePlayerAtEntry(side) {
    const pos = this._entryPosition(side);
    this.player.x = pos.x;
    this.player.y = pos.y;
    this.player.invuln = Math.max(this.player.invuln, 0.8);
    this.room.clampEntity(this.player, this.room.doorsOpen);
  }

  _entryPosition(side) {
    const cx = ARENA.x + ARENA.w / 2;
    const cy = ARENA.y + ARENA.h / 2;
    switch (side) {
      case 'top': return { x: cx, y: ARENA.y + 78 };
      case 'bottom': return { x: cx, y: ARENA.y + ARENA.h - 78 };
      case 'left': return { x: ARENA.x + 88, y: cy };
      default: return { x: ARENA.x + ARENA.w - 88, y: cy };
    }
  }

  _enterCell(cell, fromSide) {
    const alreadyVisited = this.map.isVisited(cell);
    this.map.current = cell;
    this.map.visit(cell);
    this.projectiles.length = 0;
    this.particles.clear();
    this.damageNumbers.clear();

    /* 复用已有房间实例：已清空的房间不会再刷敌人，已开过的宝箱不会重置 */
    this.room = this._roomFor(cell);
    this.room.onReenter();
    this._placePlayerAtEntry(fromSide ? OPPOSITE_DOOR[fromSide] : 'bottom');

    const meta = ROOM_META[cell.type];
    let sub;
    if (alreadyVisited) {
      if (cell.type === ROOM_TYPE.BOSS && this.room.state === 'clear') {
        sub = '守望者已陨落 · 触碰裂隙进入下一层';
      } else if (this.room.isCombatRoom && this.room.state !== 'clear') {
        sub = '返回之前的房间 · 战斗继续';
      } else if (cell.type === ROOM_TYPE.TREASURE || cell.type === ROOM_TYPE.SHOP ||
                 cell.type === ROOM_TYPE.EVENT) {
        sub = '已探索 · 开启过的物件保持原样';
      } else {
        sub = '已探索 · 房间保持清空状态';
      }
    } else if (cell.type === ROOM_TYPE.BOSS) sub = '守望者就在前方';
    else if (cell.type === ROOM_TYPE.TREASURE) sub = '按 E 开启宝箱';
    else if (cell.type === ROOM_TYPE.SHOP) sub = '按 E 购买强化';
    else if (cell.type === ROOM_TYPE.EVENT) sub = '按 E 触碰异象';
    else if (cell.type === ROOM_TYPE.ELITE) sub = '强力残形盘踞';
    else if (cell.type === ROOM_TYPE.START) sub = '走进门洞开始探索';
    else sub = '击败所有残形，门才会开启';
    this.ui.showBanner(meta.cn, sub, alreadyVisited ? 1.2 : 1.5);
  }

  /* 走进门洞 → 摄像机滑向相邻房间 */
  enterDoor(door) {
    if (this.transition) return;
    const target = this.map.neighbor(this.map.current, door.side);
    if (!target) return;
    this.transition = { t: 0, dur: 0.62, dir: door.dir, prevRoom: this.room };
    this._enterCell(target, door.side);
  }

  _updateTransition(dt) {
    const tr = this.transition;
    tr.t += dt;
    if (tr.t >= tr.dur) this.transition = null;
  }

  /* ---------------------------------------------------------
     投射物
     --------------------------------------------------------- */
  spawnProjectile(opt) {
    const p = new Projectile(opt);
    this.projectiles.push(p);
    return p;
  }

  /* =========================================================
     道具机制的战斗结算
     ========================================================= */

  /* 命中敌人：吸血 / 状态 / 击退 */
  _onHit(p, e, dmg, crit) {
    const player = this.player;
    if (p.burn > 0) e.applyStatus('burn', p.burn);
    if (p.poison > 0) e.applyStatus('poison', p.poison);
    if (p.slow > 0) e.applyStatus('slow', p.slow);
    if (p.freeze > 0 && chance(Math.min(0.75, 0.18 * p.freeze))) e.applyStatus('freeze', p.freeze);

    if (p.knockback > 0) {
      const ang = angleTo(p.x, p.y, e.x, e.y);
      const boost = (p.slowKnock > 0 && e.slowT > 0) ? 2 : 1;
      const force = 130 * p.knockback * boost;
      e.kx += Math.cos(ang) * force;
      e.ky += Math.sin(ang) * force;
    }

    if (p.lifesteal > 0 && !player.dead) {
      const mul = (crit && p.critVamp > 0) ? 3 : 1;
      player._lsAcc = (player._lsAcc || 0) + dmg * 0.08 * p.lifesteal * mul;
      if (player._lsAcc >= 1) {
        const g = Math.floor(player._lsAcc);
        player._lsAcc -= g;
        player.hp = Math.min(player.maxHp, player.hp + g);
      }
    }
  }

  /* 子弹结束使命（命中或寿命耗尽）时的一次性结算 */
  _bulletImpact(p, x, y, dmg, hitEnemy) {
    if (p.explode > 0) {
      const radius = 48 + 14 * p.explode + (p.homingExplode > 0 ? 22 : 0);
      this._explode(x, y, radius, dmg, {
        color: p.color,
        burn: p.burnExplode > 0 ? Math.max(1, p.burn) : 0,
        slow: p.slowExplode > 0,
        zone: p.slowExplode > 0
      });
    }
    if (p.split > 0 && p.splitLeft > 0) {
      this._spawnSplit(p, x, y, Math.atan2(p.vy, p.vx));
    }
    if (p.chain > 0) this._chain(p, x, y, dmg);
  }

  /* 范围爆炸 */
  _explode(x, y, radius, dmg, opt) {
    opt = opt || {};
    const color = opt.color || '#ff8a5c';
    this.particles.ring(x, y, color, Math.round(radius * 0.45), radius * 3.2);
    this.particles.burst(x, y, 16, {
      speed: 260, life: 0.55, size: 5, colors: [color, '#ffffff', '#ffd35e']
    });
    this.addShake(2.6);

    const mul = opt.dmgMul === undefined ? 0.6 : opt.dmgMul;
    const amount = Math.max(1, Math.round(dmg * mul));
    const list = this.room ? this.room.enemies : [];
    for (const e of list) {
      if (e.dead) continue;
      if (dist2(x, y, e.x, e.y) > radius * radius) continue;
      e.takeDamage(amount, x, y);
      this.damageNumbers.add(e.x, e.y - e.r - 6, amount, { color: color });
      if (opt.freeze) e.applyStatus('freeze', 1);
      if (opt.slow) e.applyStatus('slow', 1);
      if (opt.burn) e.applyStatus('burn', opt.burn);
    }
    if (opt.zone) this.zones.push({ x: x, y: y, r: radius * 0.9, life: 2.5, t: 0 });
  }

  /* 分裂碎片 */
  _spawnSplit(p, x, y, baseAngle) {
    const n = Math.min(8, p.split);
    const proto = defaultMods();
    for (let i = 0; i < n; i++) {
      const a = baseAngle + (i - (n - 1) / 2) * 0.44;
      const opt = {
        x: x, y: y, angle: a, speed: p.speed * 0.9,
        damage: p.damage, r: Math.max(2.5, p.r * 0.76),
        friendly: true, color: p.color, core: p.core,
        life: 0.85, game: this, splitLeft: 0, isChild: true
      };
      for (const k in proto) opt[k] = 0;
      opt.damageMul = (p.damageMul || 1) * 0.55;
      /* 毒素完整继承（毒染裂片）或减半继承 */
      opt.poison = p.poisonSplit > 0 ? p.poison : Math.ceil(p.poison / 2);
      opt.burn = p.burn;
      opt.slow = p.slow;
      opt.freeze = p.freeze;
      opt.knockback = p.knockback;
      opt.lifesteal = p.lifesteal;
      opt.homing = (p.splitHoming > 0 || p.homing > 0) ? Math.max(1, p.homing) : 0;
      this.spawnProjectile(opt);
    }
    this.particles.burst(x, y, 6, { speed: 150, life: 0.3, size: 3, color: p.color });
  }

  /* 链式电弧 */
  _chain(p, x, y, dmg) {
    const jumps = Math.min(4, p.chain);
    const color = p.chainBurn > 0 ? '#ff9d3c' : (p.chainPoison > 0 ? '#9ad14f' : '#7fe4ff');
    const used = [];
    let cx = x, cy = y;
    const list = this.room ? this.room.enemies : [];
    for (let j = 0; j < jumps; j++) {
      let best = null, bestD = 260 * 260;
      for (const e of list) {
        if (e.dead || used.indexOf(e) >= 0) continue;
        const d = dist2(cx, cy, e.x, e.y);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (!best) break;
      this._zap(cx, cy, best.x, best.y, color);
      const amount = Math.max(1, Math.round(dmg * 0.55));
      best.takeDamage(amount, cx, cy);
      this.damageNumbers.add(best.x, best.y - best.r - 6, amount, { color: color });
      if (p.chainPoison > 0) best.applyStatus('poison', Math.max(1, Math.ceil(p.poison / 2)));
      if (p.chainBurn > 0) best.applyStatus('burn', Math.max(1, Math.ceil(p.burn / 2)));
      if (p.chainExplode > 0 && p.explode > 0) {
        this._explode(best.x, best.y, 40 + 14 * p.explode, amount, { color: color });
      }
      used.push(best);
      cx = best.x; cy = best.y;
    }
  }

  _zap(x1, y1, x2, y2, color) {
    this.fx.push({ type: 'zap', x1: x1, y1: y1, x2: x2, y2: y2, life: 0.18, max: 0.18, color: color || '#7fe4ff' });
  }

  /* 烬迹：身周灼烧 */
  burnAround(x, y, radius, dmg) {
    const list = this.room ? this.room.enemies : [];
    for (const e of list) {
      if (e.dead) continue;
      if (dist2(x, y, e.x, e.y) > radius * radius) continue;
      e.applyStatus('burn', 1);
      e.takeDot(Math.max(1, Math.round(dmg)), this.player);
    }
    if (Math.random() < 0.6) {
      this.particles.spawn(x + rand(-14, 14), y + rand(-8, 14), rand(-16, 16), rand(-60, -24),
        rand(0.25, 0.5), rand(2, 4), '#ff9d3c', { drag: 2.4 });
    }
  }

  _updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      this.fx[i].life -= dt;
      if (this.fx[i].life <= 0) this.fx.splice(i, 1);
    }
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life -= dt;
      z.t += dt;
      if (z.life <= 0) { this.zones.splice(i, 1); continue; }
      const list = this.room ? this.room.enemies : [];
      for (const e of list) {
        if (e.dead) continue;
        if (dist2(z.x, z.y, e.x, e.y) > z.r * z.r) continue;
        e.applyStatus('slow', 1);
        e.takeDot(6 * dt, this.player);
      }
    }
  }

  _drawZones(ctx) {
    for (const z of this.zones) {
      const a = 0.10 + 0.05 * Math.sin(z.t * 4);
      const g = ctx.createRadialGradient(z.x, z.y, 4, z.x, z.y, z.r);
      g.addColorStop(0, `rgba(90,169,255,${a + 0.10})`);
      g.addColorStop(1, 'rgba(90,169,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,210,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  _drawFx(ctx) {
    for (const f of this.fx) {
      const a = clamp(f.life / f.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      /* 折线电弧 */
      const seg = 5;
      ctx.moveTo(f.x1, f.y1);
      for (let i = 1; i < seg; i++) {
        const t = i / seg;
        const nx = lerp(f.x1, f.x2, t) + rand(-7, 7);
        const ny = lerp(f.y1, f.y2, t) + rand(-7, 7);
        ctx.lineTo(nx, ny);
      }
      ctx.lineTo(f.x2, f.y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawStatusRing(ctx, e) {
    let color = null;
    if (e.freezeT > 0) color = '#8fd8ff';
    else if (e.burnT > 0 && e.burnStack >= e.poisonStack) color = '#ff9d3c';
    else if (e.poisonT > 0) color = '#9ad14f';
    else if (e.slowT > 0) color = '#5aa9ff';
    if (!color) return;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 5, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  _updateProjectiles(dt) {
    const room = this.room;
    const player = this.player;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt);

      if (p.dead) {
        if (p.friendly && p.explode > 0) {
          const dmg = p.damage * (p.damageMul || 1);
          this._explode(p.x, p.y, 48 + 14 * p.explode, dmg, { color: p.color });
        }
        this.projectiles.splice(i, 1);
        continue;
      }

      /* 撞墙：反弹或消散 */
      if (room.hitsWall(p.x, p.y, p.r)) {
        const boomerang = p.orbit > 0;      // 回旋弹永远不会被墙吃掉
        if (p.bounce > 0 || boomerang) {
          room.bounceOffWalls(p);
          if (p.bounce > 0) p.bounce--;
          this.particles.burst(p.x, p.y, 4, {
            speed: 140, life: 0.24, size: 3, color: p.color, drag: 6
          });
          if (p.bounceHoming > 0) { p.homing = Math.max(1, p.homing); p.hitIds.length = 0; }
          if (p.endlessRefract > 0) p.pierce = Math.max(1, p.pierce);
          if (p.bounceExplode > 0 && p.explode > 0) {
            this._explode(p.x, p.y, 42 + 14 * p.explode, p.damage * (p.damageMul || 1), { color: p.color });
          }
          continue;
        }
        this.particles.burst(p.x, p.y, 5, {
          speed: 130, life: 0.26, size: 3, color: p.color, drag: 6
        });
        this.projectiles.splice(i, 1);
        continue;
      }

      if (p.friendly) {
        let hit = null;
        for (const e of room.enemies) {
          if (e.dead) continue;
          if (p.hitIds.indexOf(e) >= 0) continue;
          if (Collision.circleCircle(p.x, p.y, p.r, e.x, e.y, e.r)) { hit = e; break; }
        }
        if (hit) {
          const crit = chance(player.critChance);
          let dmg = p.damage * (p.damageMul || 1);
          if (crit) dmg *= player.critDamage;
          dmg = Math.max(1, Math.round(dmg));

          hit.takeDamage(dmg, p.x, p.y);
          this._onHit(p, hit, dmg, crit);

          this.damageNumbers.add(hit.x, hit.y - hit.r - 6, dmg, { crit: crit });
          this.particles.burst(p.x, p.y, crit ? 9 : 4, {
            speed: 180, life: 0.3, size: 3.2,
            color: crit ? '#ffd85e' : '#ffcf8a',
            dir: Math.atan2(p.vy, p.vx) + Math.PI, spread: 1.7
          });
          if (crit) this.addShake(2.4);

          /* 穿透 / 回旋：继续飞行 */
          if (p.pierce > 0 || p.orbit > 0) {
            p.hitIds.push(hit);
            if (p.pierce > 0 && !(p.orbitPierce > 0)) p.pierce--;
            if (p.burnPierce > 0) hit.applyStatus('burn', 1);
            if (p.freezePierce > 0) hit.applyStatus('freeze', Math.max(1, p.freeze));
            if (p.pierceSplit > 0 && p.splitLeft > 0) {
              this._spawnSplit(p, hit.x, hit.y, Math.atan2(p.vy, p.vx));
              p.splitLeft--;
            }
            continue;
          }

          this._bulletImpact(p, hit.x, hit.y, dmg, hit);
          this.projectiles.splice(i, 1);
          continue;
        }
      } else {
        if (!player.dead && Collision.circleCircle(p.x, p.y, p.r, player.x, player.y, player.r)) {
          player.takeDamage(p.damage, p.x, p.y);
          this.ui.hitVignette = 1;
          this.particles.burst(p.x, p.y, 6, {
            speed: 150, life: 0.3, size: 3.4, color: '#7fe4ff', drag: 5
          });
          this.projectiles.splice(i, 1);
          continue;
        }
      }
    }
  }

  addShake(v) {
    this.shake = Math.min(22, this.shake + v);
  }

  /* ---------------------------------------------------------
     更新
     --------------------------------------------------------- */
  update(dt) {
    this.time += dt;
    this.ui.update(dt);
    this.mouseWorld = this.input.toWorld();

    if (this.input.wasPressed('KeyF')) this.toggleFullscreen();

    if (this.state === 'title') {
      if (this.input.wasPressed('Enter') || this.input.wasPressed('Space')) {
        this.startRun(this.ui.readSeedInput());
      }
      this.input.endFrame();
      return;
    }

    if (this.state === 'gameover') {
      if (this.input.wasPressed('KeyR') || this.input.wasPressed('Enter')) {
        this.startRun(this.ui.readSeedInput());
      }
      this.particles.update(dt);
      this.damageNumbers.update(dt);
      this.shake = Math.max(0, this.shake - dt * 45);
      this.input.endFrame();
      return;
    }

    if (this.state === 'paused') {
      if (this.input.wasPressed('Escape') || this.input.wasPressed('Enter')) this.resume();
      if (this.input.wasPressed('KeyR')) this.startRun(this.ui.readSeedInput());
      this.input.endFrame();
      return;
    }

    /* --- 游戏中 --- */
    if (this.input.wasPressed('Escape')) { this.pause(); this.input.endFrame(); return; }
    if (this.input.wasPressed('KeyR')) { this.startRun(this.ui.readSeedInput()); this.input.endFrame(); return; }

    /* 摄像机滑动期间：世界照常运转，只是不再触发新的门 */
    if (this.transition) this._updateTransition(dt);

    this.player.update(dt, this.input);
    this.room.update(dt);
    this._updateProjectiles(dt);
    this._updateFx(dt);
    this.particles.update(dt);
    this.damageNumbers.update(dt);
    this.shake = Math.max(0, this.shake - dt * 45);

    /* 交互物件 */
    this.nearProp = null;
    for (const pr of this.room.props) {
      if (!pr.used && pr.inRange(this.player)) { this.nearProp = pr; break; }
    }
    if (this.nearProp && this.input.wasPressed('KeyE')) this.nearProp.use();

    /* 走进门洞 → 下一间 */
    if (!this.transition) {
      const door = this.room.doorUnder(this.player.x, this.player.y);
      if (door) this.enterDoor(door);
    }

    this.input.endFrame();
  }

  /* ---------------------------------------------------------
     绘制
     --------------------------------------------------------- */
  _drawRoomScene(room, withPlayer) {
    const ctx = this.ctx;
    room.drawFloor(ctx);
    this._drawZones(ctx);
    room.drawProps(ctx);
    for (const e of room.enemies) e.draw(ctx);
    for (const e of room.enemies) if (e.hasStatus()) this._drawStatusRing(ctx, e);
    if (withPlayer) {
      this.player.draw(ctx);
      for (const p of this.projectiles) p.draw(ctx);
      this._drawFx(ctx);
      this.particles.draw(ctx);
      this.damageNumbers.draw(ctx);
    }
    room.drawWalls(ctx);
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const sh = this.shake;
    ctx.save();
    if (sh > 0.05) ctx.translate(rand(-sh, sh), rand(-sh, sh));

    if (this.transition) {
      /* 摄像机沿行进方向滑动：旧房间滑出，新房间滑入 */
      const tr = this.transition;
      const t = easeInOutCubic(clamp(tr.t / tr.dur, 0, 1));
      const O = { x: tr.dir.x * VIEW_W, y: tr.dir.y * VIEW_H };

      ctx.save();
      ctx.translate(-O.x * t, -O.y * t);
      this._drawRoomScene(tr.prevRoom, false);
      ctx.restore();

      ctx.save();
      ctx.translate(O.x * (1 - t), O.y * (1 - t));
      this._drawRoomScene(this.room, true);
      ctx.restore();
    } else {
      this._drawRoomScene(this.room, true);
    }

    ctx.restore();

    this.ui.drawBanner(ctx);
    if (this.state !== 'title') this.ui.drawHUD(ctx);
    if (this.state === 'playing' && !this.transition) this.ui.drawCrosshair(ctx);
  }

  /* ---------------------------------------------------------
     主循环
     --------------------------------------------------------- */
  loop(ts) {
    const now = ts / 1000;
    if (this._last === undefined) this._last = now;
    let dt = now - this._last;
    this._last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }

    this.update(dt);
    this.draw();

    const ctx = this.ctx;
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(120,150,170,0.55)';
    ctx.fillText(`${this.fps} FPS`, VIEW_W - 26, VIEW_H - 18);
    ctx.textAlign = 'left';

    requestAnimationFrame((t) => this.loop(t));
  }

  start() {
    requestAnimationFrame((t) => this.loop(t));
  }
}

/* 门的对侧映射 */
const OPPOSITE_DOOR = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left'
};
