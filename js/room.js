/* ===========================================================
   room.js — 战斗房（固定尺寸竞技场）
   扩展：房间类型（Start / Combat / Treasure / Elite / Shop / Event / Boss）
   - 只有与其它房间相连的方向才有门
   - 战斗类房间：进入关门 → 生成敌人 → 清空后开门
   - 非战斗房间：门常开，放置可交互物件
   =========================================================== */
'use strict';

class Room {
  constructor(game, opts) {
    opts = opts || {};
    this.game = game;
    this.def = opts.def || { id: 0, c: 0, r: 0, type: ROOM_TYPE.COMBAT };
    this.type = this.def.type || ROOM_TYPE.COMBAT;
    this.index = opts.index || 0;
    this.depth = opts.depth || 0;
    this.tier = opts.tier || 0;
    this.connections = opts.connections || { top: true, bottom: true, left: true, right: true };
    this.rng = opts.rng || new Rng(1);
    this.roomSeed = opts.roomSeed || '';

    this.enemies = [];
    this.props = [];
    this.pending = [];
    this.waves = [];
    this.waveIndex = 0;
    this.waveTimer = 0.9;

    this.isCombatRoom = (this.type === ROOM_TYPE.COMBAT ||
                         this.type === ROOM_TYPE.ELITE ||
                         this.type === ROOM_TYPE.BOSS);

    /* 章节（层数 → 主题）：视觉 / 敌人 / 环境障碍 / Boss 全部由它决定 */
    this.floor = (opts.depth || 0) + 1;
    this.chapter = ChapterOf(this.floor);

    this.state = this.isCombatRoom ? 'fighting' : 'clear';
    this.doorsOpen = !this.isCombatRoom;
    this.clearTime = 0;
    this.spawnFx = 0;
    this.everCleared = false;
    this._spawnCounter = 0;
    this.crack = null;               // 隐藏房裂缝（父房间才有）
    this.hazards = [];               // 环境障碍（由 HazardField 托管）

    this._buildWalls();
    this._buildFloor();
    this._planWaves();
    this._spawnProps();
    this._spawnHazards();
    this._startWave();
  }

  /* 隐藏房被发现后：父房间需要重新开门 */
  refreshConnections(conns) {
    this.connections = conns;
    this._buildWalls();
  }

  get meta() { return ROOM_META[this.type] || ROOM_META.combat; }

  /* ---------------------------------------------------------
     墙体 / 门（只在有连接的方向开门洞）
     --------------------------------------------------------- */
  _buildWalls() {
    const W = VIEW_W, H = VIEW_H, T = WALL_T;
    const cx = W / 2, cy = H / 2, dw = DOOR_W / 2;

    /* 全封闭四面墙：敌人与投射物永远用这一套 */
    this.wallsClosed = [
      { x: 0, y: 0, w: W, h: T, inner: 'bottom' },
      { x: 0, y: H - T, w: W, h: T, inner: 'top' },
      { x: 0, y: T, w: T, h: H - T * 2, inner: 'right' },
      { x: W - T, y: T, w: T, h: H - T * 2, inner: 'left' }
    ];

    /* 门打开后使用的墙体：有连接的方向留出门洞，其余保持实心 */
    const open = [];
    const seg = (side) => {
      if (side === 'top') {
        if (this.connections.top) {
          open.push({ x: 0, y: 0, w: cx - dw, h: T, inner: 'bottom' });
          open.push({ x: cx + dw, y: 0, w: W - (cx + dw), h: T, inner: 'bottom' });
        } else open.push({ x: 0, y: 0, w: W, h: T, inner: 'bottom' });
      } else if (side === 'bottom') {
        if (this.connections.bottom) {
          open.push({ x: 0, y: H - T, w: cx - dw, h: T, inner: 'top' });
          open.push({ x: cx + dw, y: H - T, w: W - (cx + dw), h: T, inner: 'top' });
        } else open.push({ x: 0, y: H - T, w: W, h: T, inner: 'top' });
      } else if (side === 'left') {
        if (this.connections.left) {
          open.push({ x: 0, y: T, w: T, h: cy - dw - T, inner: 'right' });
          open.push({ x: 0, y: cy + dw, w: T, h: H - T - (cy + dw), inner: 'right' });
        } else open.push({ x: 0, y: T, w: T, h: H - T * 2, inner: 'right' });
      } else {
        if (this.connections.right) {
          open.push({ x: W - T, y: T, w: T, h: cy - dw - T, inner: 'left' });
          open.push({ x: W - T, y: cy + dw, w: T, h: H - T - (cy + dw), inner: 'left' });
        } else open.push({ x: W - T, y: T, w: T, h: H - T * 2, inner: 'left' });
      }
    };
    seg('top'); seg('bottom'); seg('left'); seg('right');
    this.wallsOpen = open;

    /* 门：洞口矩形 + 触发区（略微向房间内延伸） */
    const trig = 8;
    this.doors = [];
    if (this.connections.top) {
      this.doors.push({
        side: 'top', dir: { x: 0, y: -1 },
        gap: { x: cx - dw, y: 0, w: dw * 2, h: T },
        trigger: { x: cx - dw + trig, y: 0, w: dw * 2 - trig * 2, h: T + trig }
      });
    }
    if (this.connections.bottom) {
      this.doors.push({
        side: 'bottom', dir: { x: 0, y: 1 },
        gap: { x: cx - dw, y: H - T, w: dw * 2, h: T },
        trigger: { x: cx - dw + trig, y: H - T - trig, w: dw * 2 - trig * 2, h: T + trig }
      });
    }
    if (this.connections.left) {
      this.doors.push({
        side: 'left', dir: { x: -1, y: 0 },
        gap: { x: 0, y: cy - dw, w: T, h: dw * 2 },
        trigger: { x: 0, y: cy - dw + trig, w: T + trig, h: dw * 2 - trig * 2 }
      });
    }
    if (this.connections.right) {
      this.doors.push({
        side: 'right', dir: { x: 1, y: 0 },
        gap: { x: W - T, y: cy - dw, w: T, h: dw * 2 },
        trigger: { x: W - T - trig, y: cy - dw + trig, w: T + trig, h: dw * 2 - trig * 2 }
      });
    }
  }

  /* ---------------------------------------------------------
     地板（一次性烘焙到离屏画布，按房间种子决定花纹）
     --------------------------------------------------------- */
  _buildFloor() {
    const c = document.createElement('canvas');
    c.width = VIEW_W;
    c.height = VIEW_H;
    const g = c.getContext('2d');
    const pal = this.chapter.pal;

    g.fillStyle = pal.void;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    g.fillStyle = pal.floor;
    g.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

    const ts = 64;
    g.save();
    g.beginPath();
    g.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    g.clip();

    const sd = hashSeed(this.roomSeed || (this.type + ':' + this.index));
    const seedX = (sd % 97) * 0.37, seedY = (sd % 61) * 0.91;
    const tr = pal.tile[0], tg = pal.tile[1], tb = pal.tile[2];
    const tv = pal.tileVar;
    for (let ty = 0; ty * ts < ARENA.h + ts; ty++) {
      for (let tx = 0; tx * ts < ARENA.w + ts; tx++) {
        const n = hash2(tx + seedX, ty + seedY);
        const x = ARENA.x + tx * ts;
        const y = ARENA.y + ty * ts;
        const shade = Math.floor(n * tv);
        g.fillStyle = `rgb(${tr + shade}, ${tg + shade}, ${tb + shade})`;
        g.fillRect(x + 1, y + 1, ts - 2, ts - 2);
        if (n > 0.82) {
          g.strokeStyle = pal.grout;
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(x + 12, y + ts - 14);
          g.lineTo(x + ts - 14, y + ts - 14);
          g.stroke();
        } else if (n < 0.14) {
          g.fillStyle = pal.dot;
          g.beginPath();
          g.arc(x + ts * 0.5, y + ts * 0.5, 4, 0, TAU);
          g.fill();
        }
      }
    }
    g.restore();

    /* 房间类型决定中央符环颜色（章节决定基础色调） */
    const accent = this.meta.color;
    const cx = VIEW_W / 2, cy = VIEW_H / 2;
    g.strokeStyle = accent;
    g.globalAlpha = 0.07;
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 168, 0, TAU); g.stroke();
    /* 章节外环：每层一个专属印纹 */
    g.strokeStyle = pal.accent;
    g.globalAlpha = 0.09;
    g.lineWidth = 2;
    const marks = this.chapter.id * 3;
    for (let i = 0; i < marks; i++) {
      const a = (i / marks) * TAU;
      g.beginPath();
      g.arc(cx, cy, 196, a, a + 0.16);
      g.stroke();
    }
    g.strokeStyle = accent;
    g.globalAlpha = 0.07;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, 148, 0, TAU); g.stroke();
    g.lineWidth = 2;
    const spokes = this.type === ROOM_TYPE.BOSS ? 8 : 6;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * TAU;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 148, cy + Math.sin(a) * 148);
      g.lineTo(cx + Math.cos(a) * 168, cy + Math.sin(a) * 168);
      g.stroke();
    }
    g.globalAlpha = 1;

    const vg = g.createRadialGradient(cx, cy, ARENA.h * 0.35, cx, cy, ARENA.h * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

    this.floorCanvas = c;
  }

  /* ---------------------------------------------------------
     敌人波次（使用房间专属 Rng → 同种子可复现）
     --------------------------------------------------------- */
  _planWaves() {
    const rng = this.rng;
    this.waves = [];
    this.themeCn = '';

    if (!this.isCombatRoom) return;

    if (this.type === ROOM_TYPE.BOSS) {
      /* 每一层有自己的 Boss 池（互不重叠），第 5 层是最终 Boss */
      const bossId = BossRoster.pick(this.depth + 1, rng.fork('boss'));
      this.bossId = bossId;
      const guard = (this.chapter.guard || []).slice();
      this.waves = [[bossId].concat(guard)];
      this.themeCn = BossRoster.nameOf(bossId);
      return;
    }

    /* 编队生成：按「章节 + 房间类型 + 深度」组合敌人，而不是把所有种类随机混在一起 */
    const res = SpawnDirector.build({
      type: this.type,
      depth: this.depth,
      isElite: this.type === ROOM_TYPE.ELITE,
      rng: rng.fork('waves'),
      chapter: this.chapter
    });
    this.waves = res.waves;
    this.themeCn = res.theme || '';
  }

  _startWave() {
    const w = this.waves[this.waveIndex] || [];
    this.pending = w.map((type, i) => ({ type: type, delay: i * 0.16 }));
  }

  /* ---------------------------------------------------------
     可交互物件（宝箱 / 祭坛 / 商栈）
     --------------------------------------------------------- */
  _spawnProps() {
    const cx = VIEW_W / 2, cy = VIEW_H / 2;
    const rng = this.rng;

    /* 隐藏房裂缝：父房间墙上（只有未发现时才存在） */
    const secSide = this.def.secretSide;
    const secCell = this.def.secretCell;
    if (secSide && secCell && !secCell.discovered) {
      const pos = this._wallCenter(secSide);
      this.crack = new WallCrack(this.game, pos.x, pos.y, secSide, secCell);
      this.props.push(this.crack);
    }

    switch (this.type) {
      case ROOM_TYPE.TREASURE:
        /* 主宝箱居中；第 2 层起两侧各多一口小箱 */
        this.props.push(new Chest(this.game, cx, cy, rng.fork('chest'), false));
        if (this.depth >= 1) {
          this.props.push(new Chest(this.game, cx - 190, cy + 40, rng.fork('chestL'), true));
          this.props.push(new Chest(this.game, cx + 190, cy + 40, rng.fork('chestR'), true));
        }
        break;
      case ROOM_TYPE.EVENT:
        this.props.push(new EventShrine(this.game, cx, cy, rng.fork('event')));
        break;
      case ROOM_TYPE.SHOP: {
        /* 3~5 个货架，横向铺开 */
        const stocks = rollShopStocks(rng.fork('shop'), this.game, this.depth + 1);
        const n = stocks.length;
        const span = Math.min(190, 760 / Math.max(1, n));
        for (let i = 0; i < n; i++) {
          const x = cx + (i - (n - 1) / 2) * span;
          this.props.push(new ShopStall(this.game, x, cy + 30, stocks[i]));
        }
        break;
      }
      case ROOM_TYPE.SECRET: {
        /* 秘室：两口宝箱 + 一堆金币 */
        this.props.push(new Chest(this.game, cx - 150, cy - 10, rng.fork('secL'), false));
        this.props.push(new Chest(this.game, cx + 150, cy - 10, rng.fork('secR'), true));
        const pile = new CoinPile(this.game, cx, cy + 90, 45 + (this.depth + 1) * 18);
        this.props.push(pile);
        break;
      }
      default:
        break;
    }
  }

  /* ---------------------------------------------------------
     环境障碍（章节决定种类与数量，房间 Rng 决定位置）
     只出现在战斗类房间；非战斗房间保持干净，方便交互
     --------------------------------------------------------- */
  _spawnHazards() {
    this.chapterFx = new ChapterFx(this.chapter, this.rng.fork('fx'));
    if (!this.isCombatRoom) return;
    this.hazards = new HazardField(this);
  }

  /* 墙面中心点（裂缝用） */
  _wallCenter(side) {
    const cx = VIEW_W / 2, cy = VIEW_H / 2;
    if (side === 'top') return { x: cx, y: WALL_T * 0.5 };
    if (side === 'bottom') return { x: cx, y: VIEW_H - WALL_T * 0.5 };
    if (side === 'left') return { x: WALL_T * 0.5, y: cy };
    return { x: VIEW_W - WALL_T * 0.5, y: cy };
  }

  /* ---------------------------------------------------------
     出生点：远离玩家、彼此不重叠（用房间 Rng）
     --------------------------------------------------------- */
  _spawnPoint(radius) {
    const p = this.game.player;
    const rng = this.rng;
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = rng.range(ARENA.x + radius + 24, ARENA.x + ARENA.w - radius - 24);
      const y = rng.range(ARENA.y + radius + 24, ARENA.y + ARENA.h - radius - 24);
      if (p && dist(x, y, p.x, p.y) < 210) continue;
      let ok = true;
      for (const e of this.enemies) {
        if (dist(x, y, e.x, e.y) < radius + e.r + 14) { ok = false; break; }
      }
      if (ok) return { x: x, y: y };
    }
    const cx = ARENA.x + ARENA.w / 2, cy = ARENA.y + ARENA.h / 2;
    const sx = rng.chance(0.5) ? -1 : 1, sy = rng.chance(0.5) ? -1 : 1;
    return {
      x: clamp(cx + sx * ARENA.w * 0.36, ARENA.x + 50, ARENA.x + ARENA.w - 50),
      y: clamp(cy + sy * ARENA.h * 0.36, ARENA.y + 50, ARENA.y + ARENA.h - 50)
    };
  }

  _spawnEnemy(type) {
    /* 半径走注册表（新增敌人不用改这里） */
    const r = EnemyFactory.radiusOf(type);
    const isBossType = EnemyFactory.defOf(type).cat === 'boss';
    const pt = isBossType
      ? { x: ARENA.x + ARENA.w / 2, y: ARENA.y + 120 }
      : this._spawnPoint(r);
    /* 每只敌人派生独立 Rng → 敌人组成、出生点、行为都随种子复现 */
    const e = EnemyFactory.create(this.game, type, pt.x, pt.y, this.tier,
      this.rng.fork('enemy' + this._spawnCounter++));

    /* 章节难度：HP / 攻击节奏 / 移速 / 弹幕复杂度 / 词缀渗透（Boss 吃半幅） */
    e.applyChapterScale(this.chapter);

    /* 精英房：每只敌人带 1~2 个词缀（更硬 / 更疯 / 死亡特效） */
    if (this.type === ROOM_TYPE.ELITE) {
      const keys = Object.keys(ELITE_AFFIX);
      const cnt = this.depth >= 2 ? 2 : 1;
      const pick = [];
      for (let i = 0; i < cnt; i++) {
        const k = keys[Math.floor(this.rng.next() * keys.length)];
        if (pick.indexOf(k) < 0) pick.push(k);
      }
      e.applyAffixes(pick);
    }

    this.enemies.push(e);
    this.spawnFx = 0.3;
    this.game.particles.ring(pt.x, pt.y, e.colors[1], isBossType ? 26 : 12, isBossType ? 260 : 150);
    if (isBossType) this.bossRef = e;
    return e;
  }

  /* ---------------------------------------------------------
     更新
     --------------------------------------------------------- */
  update(dt) {
    if (this.spawnFx > 0) this.spawnFx -= dt;

    /* 章节背景效果（纯表现） */
    if (this.chapterFx) this.chapterFx.update(dt);

    /* 环境障碍：更新 → 对玩家与敌人施加作用 */
    if (this.hazards && this.hazards.update) {
      this.hazards.update(dt);
      this.hazards.affectAll(dt);
    }

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

    /* 互相分离 */
    const n = this.enemies.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        Collision.separate(this.enemies[i], this.enemies[j]);
      }
    }
    for (const e of this.enemies) this.clampEntity(e, false);

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) this.enemies.splice(i, 1);
    }

    /* 物件 */
    for (const pr of this.props) pr.update(dt);

    /* 房间结算 */
    if (this.state === 'fighting') {
      if (this.pending.length === 0 && this.enemies.length === 0) {
        if (this.waveIndex + 1 < this.waves.length) {
          this.waveTimer -= dt;
          if (this.waveTimer <= 0) {
            this.waveIndex++;
            this.waveTimer = 0.9;
            this._startWave();
            this.game.ui.showBanner('残形涌现', '下一波', 1.1);
          }
        } else {
          this.markCleared();
        }
      }
    } else {
      this.clearTime += dt;
    }
  }

  /* ---------------------------------------------------------
     重新进入（复用实例时调用）：只重置瞬时表现，绝不重建敌人 / 物件
     --------------------------------------------------------- */
  onReenter() {
    this.spawnFx = 0;
    if (this.state === 'fighting') {
      /* 战斗未结束就返回（理论上门是关的）：重新锁门 */
      this.doorsOpen = false;
      this.clearTime = 0;
    }
  }

  markCleared() {
    if (this.state === 'clear') return;
    this.state = 'clear';
    this.doorsOpen = true;
    this.clearTime = 0;
    this.everCleared = true;

    /* Boss 房通关 → 解除房间（开门）+ 层间裂隙 + 大量金币 + 一件强力遗物 */
    if (this.type === ROOM_TYPE.BOSS) {
      const cx = ARENA.x + ARENA.w / 2, cy = ARENA.y + ARENA.h / 2;
      const lastFloor = this.floor >= CHAPTER_COUNT;
      this.props.push(new Portal(this.game, cx, cy + 40,
        lastFloor ? '终结回廊 · 查看结算' : '进入第 ' + (this.floor + 1) + ' 层 · ' + ChapterOf(this.floor + 1).cn));
      const cm = this.chapter.coins || 1;
      this.props.push(new CoinPile(this.game, cx + 210, cy, Math.round((120 + this.depth * 45) * cm)));
      this.props.push(new CoinPile(this.game, cx - 210, cy, Math.round((90 + this.depth * 35) * cm)));
      this.props.push(new BossRelic(this.game, cx - 120, cy - 60, this.rng.fork('bossRelic')));
      if (this.depth >= 2) {
        this.props.push(new BossRelic(this.game, cx + 120, cy - 60, this.rng.fork('bossRelic2')));
      }
    } else if (this.type === ROOM_TYPE.ELITE) {
      this.props.push(new Chest(this.game, ARENA.x + ARENA.w / 2 - 60, ARENA.y + ARENA.h / 2,
        this.rng.fork('eliteChest'), false));
      this.props.push(new CoinPile(this.game, ARENA.x + ARENA.w / 2 + 90, ARENA.y + ARENA.h / 2,
        28 + this.depth * 12));
    }
    this.game.onRoomCleared(this);
  }

  /* ---------------------------------------------------------
     碰撞辅助
     --------------------------------------------------------- */
  clampEntity(e, allowDoors) {
    const walls = (allowDoors && this.doorsOpen) ? this.wallsOpen : this.wallsClosed;
    const hit = Collision.resolveAll(e, walls);
    /* 环境障碍：实体化的柱子 / 齿轮 / 相位柱也会挡住去路 */
    if (this.hazards && this.hazards.resolveEntity) this.hazards.resolveEntity(e);
    return hit;
  }

  /* 子弹是否撞上环境障碍（返回该障碍） */
  hazardAt(x, y, r) {
    if (this.hazards && this.hazards.hitTest) return this.hazards.hitTest(x, y, r);
    return null;
  }

  /* 子弹在障碍表面反弹 */
  bounceOffHazard(p, h) {
    if (this.hazards && this.hazards.bounce) this.hazards.bounce(p, h);
  }

  hitsWall(x, y, r) {
    for (const w of this.wallsClosed) {
      if (Collision.circleRect(x, y, r, w)) return true;
    }
    return false;
  }

  /* 投射物撞墙反弹：就地修改 vx / vy 并推出墙体，返回是否发生反弹 */
  bounceOffWalls(p) {
    for (const w of this.wallsClosed) {
      if (!Collision.circleRect(p.x, p.y, p.r, w)) continue;
      const overLeft = (p.x + p.r) - w.x;
      const overRight = (w.x + w.w) - (p.x - p.r);
      const overTop = (p.y + p.r) - w.y;
      const overBottom = (w.y + w.h) - (p.y - p.r);
      const m = Math.min(overLeft, overRight, overTop, overBottom);
      /* overLeft = 需要向左挪多少才能脱离左面，以此类推 */
      if (m === overLeft) { p.vx = -Math.abs(p.vx); p.x -= overLeft; }
      else if (m === overRight) { p.vx = Math.abs(p.vx); p.x += overRight; }
      else if (m === overTop) { p.vy = -Math.abs(p.vy); p.y -= overTop; }
      else { p.vy = Math.abs(p.vy); p.y += overBottom; }
      return true;
    }
    return false;
  }

  aliveCount() {
    let c = 0;
    for (const e of this.enemies) if (!e.dead) c++;
    return c + this.pending.length;
  }

  doorUnder(px, py) {
    if (!this.doorsOpen) return null;
    for (const d of this.doors) {
      if (Collision.pointInRect(px, py, d.trigger)) return d;
    }
    return null;
  }

  doorBySide(side) {
    for (const d of this.doors) if (d.side === side) return d;
    return null;
  }

  /* ---------------------------------------------------------
     绘制
     --------------------------------------------------------- */
  drawFloor(ctx) {
    ctx.drawImage(this.floorCanvas, 0, 0);
    /* 章节背景（环境粒子）→ 地面预警层 */
    if (this.chapterFx) this.chapterFx.drawUnder(ctx);
    if (this.hazards && this.hazards.drawUnder) this.hazards.drawUnder(ctx);
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

  drawProps(ctx) {
    for (const pr of this.props) pr.draw(ctx);
  }

  /* 实体之上的一层：柱体 / 电弧塔 / 章节氛围 */
  drawOverLayer(ctx) {
    if (this.hazards && this.hazards.drawOver) this.hazards.drawOver(ctx);
    if (this.chapterFx) this.chapterFx.drawOver(ctx);
  }

  drawWalls(ctx) {
    const walls = this.doorsOpen ? this.wallsOpen : this.wallsClosed;

    for (const d of this.doors) {
      const g = d.gap;
      ctx.fillStyle = '#0b1119';
      ctx.fillRect(g.x, g.y, g.w, g.h);

      if (this.doorsOpen) {
        const pulse = 0.5 + 0.5 * Math.sin(this.clearTime * 3.4);
        const grad = ctx.createLinearGradient(g.x, g.y, g.x + (g.w > g.h ? 0 : g.w), g.y + (g.h > g.w ? g.h : 0));
        grad.addColorStop(0, 'rgba(90,255,190,0.05)');
        grad.addColorStop(0.5, `rgba(120,255,200,${0.20 + 0.10 * pulse})`);
        grad.addColorStop(1, 'rgba(90,255,190,0.05)');
        ctx.fillStyle = grad;
        ctx.fillRect(g.x, g.y, g.w, g.h);

        ctx.strokeStyle = 'rgba(140,255,210,0.75)';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(g.x + 1, g.y + 1, g.w - 2, g.h - 2);
      } else {
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
        const len = horiz ? g.w : g.h;
        for (let i = -1; i < len / 22 + 2; i++) {
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

    const pal = this.chapter.pal;
    for (const w of walls) {
      ctx.fillStyle = pal.wall;
      ctx.fillRect(w.x, w.y, w.w, w.h);

      ctx.fillStyle = pal.wallEdge;
      if (w.inner === 'bottom') ctx.fillRect(w.x, w.y + w.h - 5, w.w, 5);
      else if (w.inner === 'top') ctx.fillRect(w.x, w.y, w.w, 5);
      else if (w.inner === 'right') ctx.fillRect(w.x + w.w - 5, w.y, 5, w.h);
      else ctx.fillRect(w.x, w.y, 5, w.h);

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

      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }
  }
}
