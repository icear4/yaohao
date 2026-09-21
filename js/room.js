/* ===========================================================
   room.js — 固定尺寸战斗房
   进入：门关闭 + 生成敌人 + 玩家无法离开
   清空：门打开 + 提示 Room Clear
   =========================================================== */
'use strict';

class Room {
  constructor(game, index) {
    this.game = game;
    this.index = index;

    this.enemies = [];
    this.pending = [];
    this.waves = [];
    this.waveIndex = 0;
    this.waveTimer = 0.9;

    this.state = 'fighting';   // 'fighting' | 'clear'
    this.clearTime = 0;
    this.doorsOpen = false;
    this.spawnFx = 0;

    this._buildWalls();
    this._buildFloor();
    this._planWaves();
    this._startWave();
  }

  /* ---------------------------------------------------------
     墙体 / 门
     --------------------------------------------------------- */
  _buildWalls() {
    const W = VIEW_W, H = VIEW_H, T = WALL_T;
    const cx = W / 2, cy = H / 2, dw = DOOR_W / 2;

    /* 门全部封闭时的四面墙 */
    this.wallsClosed = [
      { x: 0, y: 0, w: W, h: T, inner: 'bottom' },
      { x: 0, y: H - T, w: W, h: T, inner: 'top' },
      { x: 0, y: T, w: T, h: H - T * 2, inner: 'right' },
      { x: W - T, y: T, w: T, h: H - T * 2, inner: 'left' }
    ];

    /* 门打开后：每面墙被门洞切成两段 */
    const open = [];
    open.push({ x: 0, y: 0, w: cx - dw, h: T, inner: 'bottom' });
    open.push({ x: cx + dw, y: 0, w: W - (cx + dw), h: T, inner: 'bottom' });
    open.push({ x: 0, y: H - T, w: cx - dw, h: T, inner: 'top' });
    open.push({ x: cx + dw, y: H - T, w: W - (cx + dw), h: T, inner: 'top' });
    open.push({ x: 0, y: T, w: T, h: cy - dw - T, inner: 'right' });
    open.push({ x: 0, y: cy + dw, w: T, h: H - T - (cy + dw), inner: 'right' });
    open.push({ x: W - T, y: T, w: T, h: cy - dw - T, inner: 'left' });
    open.push({ x: W - T, y: cy + dw, w: T, h: H - T - (cy + dw), inner: 'left' });
    this.wallsOpen = open;

    /* 门：洞口矩形 + 触发区（略微向房间内延伸） */
    const trig = 8;
    this.doors = [
      {
        side: 'top', dir: { x: 0, y: -1 },
        gap: { x: cx - dw, y: 0, w: dw * 2, h: T },
        trigger: { x: cx - dw + trig, y: 0, w: dw * 2 - trig * 2, h: T + trig }
      },
      {
        side: 'bottom', dir: { x: 0, y: 1 },
        gap: { x: cx - dw, y: H - T, w: dw * 2, h: T },
        trigger: { x: cx - dw + trig, y: H - T - trig, w: dw * 2 - trig * 2, h: T + trig }
      },
      {
        side: 'left', dir: { x: -1, y: 0 },
        gap: { x: 0, y: cy - dw, w: T, h: dw * 2 },
        trigger: { x: 0, y: cy - dw + trig, w: T + trig, h: dw * 2 - trig * 2 }
      },
      {
        side: 'right', dir: { x: 1, y: 0 },
        gap: { x: W - T, y: cy - dw, w: T, h: dw * 2 },
        trigger: { x: W - T - trig, y: cy - dw + trig, w: T + trig, h: dw * 2 - trig * 2 }
      }
    ];
  }

  /* ---------------------------------------------------------
     地板（一次性烘焙到离屏画布）
     --------------------------------------------------------- */
  _buildFloor() {
    const c = document.createElement('canvas');
    c.width = VIEW_W;
    c.height = VIEW_H;
    const g = c.getContext('2d');

    /* 房间外底色 */
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    /* 地板底 */
    g.fillStyle = '#0e151d';
    g.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

    /* 地砖 */
    const ts = 64;
    g.save();
    g.beginPath();
    g.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    g.clip();

    const seedX = this.index * 37.7, seedY = this.index * 91.3;
    for (let ty = 0; ty * ts < ARENA.h + ts; ty++) {
      for (let tx = 0; tx * ts < ARENA.w + ts; tx++) {
        const n = hash2(tx + seedX, ty + seedY);
        const x = ARENA.x + tx * ts;
        const y = ARENA.y + ty * ts;
        const shade = 14 + Math.floor(n * 12);
        g.fillStyle = `rgb(${shade}, ${shade + 6}, ${shade + 12})`;
        g.fillRect(x + 1, y + 1, ts - 2, ts - 2);

        /* 少量刻纹 */
        if (n > 0.82) {
          g.strokeStyle = 'rgba(90,170,190,0.10)';
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(x + 12, y + ts - 14);
          g.lineTo(x + ts - 14, y + ts - 14);
          g.stroke();
        } else if (n < 0.14) {
          g.fillStyle = 'rgba(120,200,220,0.06)';
          g.beginPath();
          g.arc(x + ts * 0.5, y + ts * 0.5, 4, 0, TAU);
          g.fill();
        }
      }
    }
    g.restore();

    /* 中央符环 */
    const cx = VIEW_W / 2, cy = VIEW_H / 2;
    g.strokeStyle = 'rgba(255,170,80,0.055)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 168, 0, TAU); g.stroke();
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, 148, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,170,80,0.05)';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 148, cy + Math.sin(a) * 148);
      g.lineTo(cx + Math.cos(a) * 168, cy + Math.sin(a) * 168);
      g.stroke();
    }

    /* 内边缘暗角 */
    const vg = g.createRadialGradient(cx, cy, ARENA.h * 0.35, cx, cy, ARENA.h * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

    this.floorCanvas = c;
  }

  /* ---------------------------------------------------------
     敌人波次规划
     --------------------------------------------------------- */
  _planWaves() {
    const idx = this.index;
    const total = Math.min(11, 3 + idx);

    /* 可用类型随房间深度解锁 */
    const pool = [['chaser', 5]];
    if (idx >= 1) pool.push(['shooter', 3]);
    if (idx >= 2) pool.push(['charger', idx >= 4 ? 3 : 2]);

    const list = [];
    for (let i = 0; i < total; i++) {
      let sum = 0;
      for (const p of pool) sum += p[1];
      let r = Math.random() * sum;
      for (const p of pool) {
        r -= p[1];
        if (r <= 0) { list.push(p[0]); break; }
      }
    }
    /* 保证至少一只追击者，避免开局全远程僵持 */
    if (!list.includes('chaser')) list[0] = 'chaser';

    if (total <= 5) {
      this.waves = [list];
    } else {
      const cut = Math.ceil(total * 0.55);
      this.waves = [list.slice(0, cut), list.slice(cut)];
    }
  }

  _startWave() {
    const w = this.waves[this.waveIndex] || [];
    this.pending = w.map((type, i) => ({ type: type, delay: i * 0.16 }));
  }

  /* ---------------------------------------------------------
     出生点：远离玩家、彼此不重叠
     --------------------------------------------------------- */
  _spawnPoint(radius) {
    const p = this.game.player;
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = rand(ARENA.x + radius + 24, ARENA.x + ARENA.w - radius - 24);
      const y = rand(ARENA.y + radius + 24, ARENA.y + ARENA.h - radius - 24);
      if (p && dist(x, y, p.x, p.y) < 210) continue;
      let ok = true;
      for (const e of this.enemies) {
        if (dist(x, y, e.x, e.y) < radius + e.r + 14) { ok = false; break; }
      }
      if (ok) return { x: x, y: y };
    }
    /* 兜底：房间四角 */
    const cx = ARENA.x + ARENA.w / 2, cy = ARENA.y + ARENA.h / 2;
    const sx = chance(0.5) ? -1 : 1, sy = chance(0.5) ? -1 : 1;
    return {
      x: clamp(cx + sx * ARENA.w * 0.36, ARENA.x + 50, ARENA.x + ARENA.w - 50),
      y: clamp(cy + sy * ARENA.h * 0.36, ARENA.y + 50, ARENA.y + ARENA.h - 50)
    };
  }

  _spawnEnemy(type) {
    const r = type === 'charger' ? 19 : (type === 'shooter' ? 18 : 16);
    const pt = this._spawnPoint(r);
    const e = EnemyFactory.create(this.game, type, pt.x, pt.y, this.index);
    this.enemies.push(e);
    this.spawnFx = 0.3;
    this.game.particles.ring(pt.x, pt.y, e.colors[1], 12, 150);
    return e;
  }

  /* ---------------------------------------------------------
     更新
     --------------------------------------------------------- */
  update(dt) {
    if (this.spawnFx > 0) this.spawnFx -= dt;

    /* 待生成队列 */
    if (this.pending.length) {
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const q = this.pending[i];
        q.delay -= dt;
        if (q.delay <= 0) {
          this._spawnEnemy(q.type);
          this.pending.splice(i, 1);
        }
      }
    }

    /* 敌人 */
    for (const e of this.enemies) e.update(dt);

    /* 互相分离，避免叠在一起 */
    const n = this.enemies.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        Collision.separate(this.enemies[i], this.enemies[j]);
      }
    }
    for (const e of this.enemies) this.clampEntity(e, false);

    /* 清理尸体 */
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) this.enemies.splice(i, 1);
    }

    /* 房间结算 */
    if (this.state === 'fighting') {
      if (this.pending.length === 0 && this.enemies.length === 0) {
        if (this.waveIndex + 1 < this.waves.length) {
          this.waveTimer -= dt;
          if (this.waveTimer <= 0) {
            this.waveIndex++;
            this.waveTimer = 0.9;
            this._startWave();
            this.game.ui.showBanner('残形涌现', '第二波', 1.1);
          }
        } else {
          this.markCleared();
        }
      }
    } else {
      this.clearTime += dt;
    }
  }

  markCleared() {
    if (this.state === 'clear') return;
    this.state = 'clear';
    this.doorsOpen = true;
    this.clearTime = 0;
    this.game.onRoomCleared();
  }

  /* ---------------------------------------------------------
     碰撞辅助
     --------------------------------------------------------- */
  clampEntity(e, allowDoors) {
    const walls = (allowDoors && this.doorsOpen) ? this.wallsOpen : this.wallsClosed;
    return Collision.resolveAll(e, walls);
  }

  /* 投射物是否撞墙（门关闭与否都视为实心，子弹不会飞出房间） */
  hitsWall(x, y, r) {
    for (const w of this.wallsClosed) {
      if (Collision.circleRect(x, y, r, w)) return true;
    }
    return false;
  }

  aliveCount() {
    let c = 0;
    for (const e of this.enemies) if (!e.dead) c++;
    return c + this.pending.length;
  }

  /* 玩家是否踩进了打开的门 */
  doorUnder(px, py) {
    if (!this.doorsOpen) return null;
    for (const d of this.doors) {
      if (Collision.pointInRect(px, py, d.trigger)) return d;
    }
    return null;
  }

  /* ---------------------------------------------------------
     绘制
     --------------------------------------------------------- */
  drawFloor(ctx) {
    ctx.drawImage(this.floorCanvas, 0, 0);

    /* 清空后地板中心的暖色脉冲 */
    if (this.state === 'clear') {
      const t = this.clearTime;
      const a = 0.10 + 0.05 * Math.sin(t * 3);
      const cx = VIEW_W / 2, cy = VIEW_H / 2;
      const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 210);
      g.addColorStop(0, `rgba(255,190,110,${a})`);
      g.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 220, cy - 220, 440, 440);
    }
  }

  drawWalls(ctx) {
    const walls = this.doorsOpen ? this.wallsOpen : this.wallsClosed;

    /* 门洞（地板延伸 + 状态光） */
    for (const d of this.doors) {
      const g = d.gap;
      ctx.fillStyle = '#0b1119';
      ctx.fillRect(g.x, g.y, g.w, g.h);

      if (this.doorsOpen) {
        /* 开启：青绿色通行光 */
        const pulse = 0.5 + 0.5 * Math.sin(this.clearTime * 3.4);
        const grad = ctx.createLinearGradient(g.x, g.y, g.x + (g.w > g.h ? 0 : g.w), g.y + (g.h > g.w ? g.h : 0));
        grad.addColorStop(0, 'rgba(90,255,190,0.05)');
        grad.addColorStop(0.5, `rgba(120,255,200,${0.20 + 0.10 * pulse})`);
        grad.addColorStop(1, 'rgba(90,255,190,0.05)');
        ctx.fillStyle = grad;
        ctx.fillRect(g.x, g.y, g.w, g.h);

        /* 门框 */
        ctx.strokeStyle = 'rgba(140,255,210,0.75)';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(g.x + 1, g.y + 1, g.w - 2, g.h - 2);
      } else {
        /* 封闭：赤色能量屏障 */
        ctx.fillStyle = 'rgba(255,70,60,0.13)';
        ctx.fillRect(g.x, g.y, g.w, g.h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.x, g.y, g.w, g.h);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,110,90,0.32)';
        ctx.lineWidth = 3;
        const off = (this.game.time * 42) % 22;
        const horiz = g.w > g.h;
        for (let i = -1; i < (horiz ? g.w : g.h) / 22 + 2; i++) {
          ctx.beginPath();
          if (horiz) {
            const x = g.x + i * 22 + off;
            ctx.moveTo(x, g.y);
            ctx.lineTo(x + 10, g.y + g.h);
          } else {
            const y = g.y + i * 22 + off;
            ctx.moveTo(g.x, y);
            ctx.lineTo(g.x + g.w, y + 10);
          }
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,90,80,0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(g.x + 1, g.y + 1, g.w - 2, g.h - 2);
      }
    }

    /* 墙体 */
    for (const w of walls) {
      ctx.fillStyle = '#171d29';
      ctx.fillRect(w.x, w.y, w.w, w.h);

      /* 内侧面高光 */
      ctx.fillStyle = '#2b3547';
      if (w.inner === 'bottom') ctx.fillRect(w.x, w.y + w.h - 5, w.w, 5);
      else if (w.inner === 'top') ctx.fillRect(w.x, w.y, w.w, 5);
      else if (w.inner === 'right') ctx.fillRect(w.x + w.w - 5, w.y, 5, w.h);
      else ctx.fillRect(w.x, w.y, 5, w.h);

      /* 砖缝 */
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1;
      const horiz = w.w > w.h;
      const step = 48;
      ctx.beginPath();
      if (horiz) {
        for (let x = w.x + step; x < w.x + w.w; x += step) {
          ctx.moveTo(x, w.y); ctx.lineTo(x, w.y + w.h);
        }
      } else {
        for (let y = w.y + step; y < w.y + w.h; y += step) {
          ctx.moveTo(w.x, y); ctx.lineTo(w.x + w.w, y);
        }
      }
      ctx.stroke();

      /* 外框 */
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }
  }
}
