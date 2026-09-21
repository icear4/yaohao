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

    /* 种子 / 层数 / 货币 / 已获得道具 */
    this.seed = randomSeedString();
    this.floor = 1;
    this.embers = 0;
    this.ownedItems = [];

    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    /* 首屏也要有一张地图和房间（标题界面背景） */
    this.map = new GameMap(this.seed, this.floor);
    this.player = new Player(this, VIEW_W / 2, VIEW_H / 2 + 90);
    this.room = this._createRoom(this.map.start);
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
    this.particles.clear();
    this.damageNumbers.clear();
    this.transition = null;
    this.shake = 0;
    this.nearProp = null;

    this.player = new Player(this, VIEW_W / 2, VIEW_H / 2 + 90);
    this.map = new GameMap(this.seed, this.floor);
    this.state = 'playing';
    this.ui.setOverlay(null);

    this.room = this._createRoom(this.map.start);
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
    this.particles.clear();
    this.damageNumbers.clear();
    this.map = new GameMap(this.seed, this.floor);
    this.room = this._createRoom(this.map.start);
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
    this.map.current = cell;
    this.map.visit(cell);
    this.projectiles.length = 0;
    this.particles.clear();
    this.damageNumbers.clear();
    this.room = this._createRoom(cell);
    this._placePlayerAtEntry(fromSide ? OPPOSITE_DOOR[fromSide] : 'bottom');

    const meta = ROOM_META[cell.type];
    let sub = '';
    if (cell.type === ROOM_TYPE.BOSS) sub = '守望者就在前方';
    else if (cell.type === ROOM_TYPE.TREASURE) sub = '按 E 开启宝箱';
    else if (cell.type === ROOM_TYPE.SHOP) sub = '按 E 购买强化';
    else if (cell.type === ROOM_TYPE.EVENT) sub = '按 E 触碰异象';
    else if (cell.type === ROOM_TYPE.ELITE) sub = '强力残形盘踞';
    else if (cell.type === ROOM_TYPE.START) sub = '走进门洞开始探索';
    else sub = '击败所有残形，门才会开启';
    this.ui.showBanner(meta.cn, sub, 1.5);
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

  _updateProjectiles(dt) {
    const room = this.room;
    const player = this.player;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt);

      if (p.dead) { this.projectiles.splice(i, 1); continue; }

      if (room.hitsWall(p.x, p.y, p.r)) {
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
          if (Collision.circleCircle(p.x, p.y, p.r, e.x, e.y, e.r)) { hit = e; break; }
        }
        if (hit) {
          let dmg = p.damage;
          const crit = chance(player.critChance);
          if (crit) dmg = Math.round(dmg * 2);
          hit.takeDamage(dmg, p.x, p.y);
          this.damageNumbers.add(hit.x, hit.y - hit.r - 6, dmg, { crit: crit });
          this.particles.burst(p.x, p.y, crit ? 9 : 4, {
            speed: 180, life: 0.3, size: 3.2,
            color: crit ? '#ffd85e' : '#ffcf8a',
            dir: Math.atan2(p.vy, p.vx) + Math.PI, spread: 1.7
          });
          if (crit) this.addShake(2.4);
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
    room.drawProps(ctx);
    for (const e of room.enemies) e.draw(ctx);
    if (withPlayer) {
      this.player.draw(ctx);
      for (const p of this.projectiles) p.draw(ctx);
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
