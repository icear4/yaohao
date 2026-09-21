/* ===========================================================
   game.js — 主循环 / 状态机 / 房间推进 / 全局事件
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
    this.roomIndex = 0;
    this.kills = 0;
    this.shake = 0;
    this.transition = null;
    this.mouseWorld = { x: VIEW_W / 2, y: VIEW_H / 2 };

    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    this.player = new Player(this, VIEW_W / 2, VIEW_H / 2 + 90);
    this.room = new Room(this, 0);

    this.input.onBlur = () => { if (this.state === 'playing') this.pause(); };

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.resize(), 60));
  }

  /* ---------------------------------------------------------
     尺寸
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
  startRun() {
    this.roomIndex = 0;
    this.kills = 0;
    this.projectiles.length = 0;
    this.particles.clear();
    this.damageNumbers.clear();
    this.transition = null;
    this.shake = 0;

    this.player = new Player(this, VIEW_W / 2, VIEW_H / 2 + 90);
    this.room = new Room(this, 0);
    this.state = 'playing';
    this.ui.setOverlay(null);
    this.ui.showBanner('回廊 · 第 1 间', '击败所有残形，门才会开启', 2.0);
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
    if (this.state === 'title' || this.state === 'gameover') this.startRun();
    else if (this.state === 'paused') this.resume();
  }

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
  }

  onRoomCleared() {
    this.ui.showClearBanner();
    this.addShake(2.5);
    this.player.heal(12);
  }

  /* ---------------------------------------------------------
     房间推进
     --------------------------------------------------------- */
  enterDoor(door) {
    if (this.transition) return;
    this.transition = { t: 0, dur: 0.6, side: door.side, switched: false };
  }

  _updateTransition(dt) {
    const tr = this.transition;
    tr.t += dt;
    const half = tr.dur * 0.45;
    if (!tr.switched && tr.t >= half) {
      tr.switched = true;
      this.roomIndex++;
      this.room = new Room(this, this.roomIndex);
      this.projectiles.length = 0;
      this.particles.clear();
      const pos = this._entryPosition(OPPOSITE_DOOR[tr.side]);
      this.player.x = pos.x;
      this.player.y = pos.y;
      this.player.invuln = Math.max(this.player.invuln, 0.8);
      this.room.clampEntity(this.player, false);
      this.ui.showBanner(`回廊 · 第 ${this.roomIndex + 1} 间`, '击败所有残形，门才会开启', 1.8);
    }
    if (tr.t >= tr.dur) this.transition = null;
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

      /* 撞墙 */
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

    /* --- 标题 --- */
    if (this.state === 'title') {
      if (this.input.wasPressed('Enter') || this.input.wasPressed('Space')) this.startRun();
      this.input.endFrame();
      return;
    }

    /* --- 结束 --- */
    if (this.state === 'gameover') {
      if (this.input.wasPressed('KeyR') || this.input.wasPressed('Enter')) this.startRun();
      this.particles.update(dt);
      this.damageNumbers.update(dt);
      this.shake = Math.max(0, this.shake - dt * 45);
      this.input.endFrame();
      return;
    }

    /* --- 暂停 --- */
    if (this.state === 'paused') {
      if (this.input.wasPressed('Escape') || this.input.wasPressed('Enter')) this.resume();
      if (this.input.wasPressed('KeyR')) this.startRun();
      this.input.endFrame();
      return;
    }

    /* --- 游戏中 --- */
    if (this.input.wasPressed('Escape')) {
      this.pause();
      this.input.endFrame();
      return;
    }
    if (this.input.wasPressed('KeyR')) {
      this.startRun();
      this.input.endFrame();
      return;
    }

    if (this.transition) {
      this._updateTransition(dt);
      this.input.endFrame();
      return;
    }

    this.player.update(dt, this.input);
    this.room.update(dt);
    this._updateProjectiles(dt);
    this.particles.update(dt);
    this.damageNumbers.update(dt);
    this.shake = Math.max(0, this.shake - dt * 45);

    /* 走进门洞 → 下一间 */
    const door = this.room.doorUnder(this.player.x, this.player.y);
    if (door) this.enterDoor(door);

    this.input.endFrame();
  }

  /* ---------------------------------------------------------
     绘制
     --------------------------------------------------------- */
  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const sh = this.shake;
    ctx.save();
    if (sh > 0.05) ctx.translate(rand(-sh, sh), rand(-sh, sh));

    if (this.room) this.room.drawFloor(ctx);

    if (this.room) {
      for (const e of this.room.enemies) e.draw(ctx);
    }
    if (this.player) this.player.draw(ctx);
    for (const p of this.projectiles) p.draw(ctx);
    this.particles.draw(ctx);
    this.damageNumbers.draw(ctx);
    if (this.room) this.room.drawWalls(ctx);

    ctx.restore();

    /* 房间切换黑场 */
    if (this.transition) {
      const tr = this.transition;
      const half = tr.dur * 0.45;
      let a;
      if (tr.t < half) a = tr.t / half;
      else a = 1 - (tr.t - half) / (tr.dur - half);
      ctx.fillStyle = `rgba(0,0,0,${clamp(a, 0, 1)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

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
    if (dt > 0.05) dt = 0.05;     // 掉帧保护
    if (dt < 0) dt = 0;

    /* FPS 统计 */
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }

    this.update(dt);
    this.draw();

    /* FPS（右下角小字） */
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
