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

    /* 屏幕抖动强度档位（可在 HUD 按钮上循环切换，写入 localStorage 记住）
       必须在 new UI 之前初始化：UI 构造时会读它来渲染按钮文案 */
    this.shakeLevels = [
      { name: '关', scale: 0 },
      { name: '弱', scale: 0.3 },
      { name: '中', scale: 0.6 },
      { name: '强', scale: 1 }
    ];
    this.shakeLevel = 1;               // 默认「弱」
    this.shakeScale = this.shakeLevels[1].scale;
    this._loadShakePref();

    this.input = new Input(canvas);
    this.ui = new UI(this);
    this.particles = new ParticleSystem(900);
    this.damageNumbers = new DamageNumbers();
    this.projectiles = [];
    /* 投射物对象池：弹幕高峰不再频繁 new / GC */
    this._projPool = [];
    /* 宽阶段网格（投射物 vs 敌人） */
    this._grid = new SpatialGrid(110);
    this._hitBuf = [];

    this.state = 'title';        // title | playing | paused | gameover
    this.time = 0;
    this.kills = 0;
    this.shake = 0;
    this.shakeDX = 0;            // 抖动方向（受击时朝背离伤害源的方向顶一下）
    this.shakeDY = 0;
    this.shakeKick = 0;
    this.transition = null;
    this.mouseWorld = { x: VIEW_W / 2, y: VIEW_H / 2 };
    this.nearProp = null;
    this.fx = [];                // 电弧等短时特效
    this.zones = [];             // 泥沼等持续区域
    this.touchMode = false;      // 触屏模式（首次触摸后自动开启）
    this.rotateHintDismissed = false;
    this.viewScale = 1;

    /* 种子 / 层数 / 货币 / 已获得道具 */
    this.seed = randomSeedString();
    this.floor = 1;
    this.embers = 0;
    this.ownedItems = [];
    this.runTime = 0;
    this.bossDefeated = [];

    /* 当前选择的角色（来自 Meta 存档的设置项） */
    this.charId = (typeof Meta !== 'undefined') ? Meta.selectedChar() : null;

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

    /* 触屏：按钮布局与回调接到 TouchControls 上 */
    this.input.touch.buttonsFn = () => this.touchButtons();
    this.input.touch.onButton = (id) => this.onTouchButton(id);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.resize(), 60));
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.resize(), 80);
      setTimeout(() => this.resize(), 400);
    });
    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener('resize', () => this.resize());
    }
  }

  /* ---------------------------------------------------------
     自适应尺寸：舞台用 transform 等比缩放，永远保持 16:9 不变形
     --------------------------------------------------------- */
  resize() {
    const stage = document.getElementById('stage');
    const vv = window.visualViewport;
    const de = document.documentElement;
    const aw = Math.max(320, Math.round(vv ? vv.width : (de.clientWidth || window.innerWidth)));
    const ah = Math.max(240, Math.round(vv ? vv.height : (de.clientHeight || window.innerHeight)));

    /* 等比 contain：手机上不留白边，桌面留 30px 呼吸 */
    const pad = this.touchMode ? 0 : 30;
    const s = Math.min((aw - pad) / VIEW_W, (ah - pad) / VIEW_H);
    this.viewScale = s;
    if (stage) stage.style.transform = 'scale(' + s + ')';

    /* 渲染分辨率：按实际显示大小决定 → 手机上降采样保 60FPS，高分屏不糊 */
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rs = clamp(s * dpr, 0.75, 1.5);
    if (Math.abs(rs - this.dpr) > 0.01) {
      this.dpr = rs;
      this.canvas.width = Math.round(VIEW_W * rs);
      this.canvas.height = Math.round(VIEW_H * rs);
    }

    this._updateRotateHint(aw, ah);
  }

  /* 竖屏提示（仅触屏设备，且未被玩家关掉） */
  _updateRotateHint(w, h) {
    const el = document.getElementById('rotate-hint');
    if (!el || !el.classList) return;
    const portrait = h > w * 1.08;
    const show = portrait && this.touchMode && !this.rotateHintDismissed;
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }

  /* 首次真实触摸 → 切到触屏模式 */
  _enableTouchMode() {
    if (this.touchMode) return;
    this.touchMode = true;
    if (document.body && document.body.classList) document.body.classList.add('touch-mode');
    if (this.ui && this.ui.setTouchHint) this.ui.setTouchHint();
    this.resize();
  }

  /* 触屏屏幕按钮（逻辑坐标，随画布一起缩放） */
  touchButtons() {
    if (!this.touchMode) return [];
    if (this.state !== 'playing' && this.state !== 'paused') return [];
    const list = [{
      id: 'pause', x: VIEW_W - 92, y: VIEW_H - 92, w: 72, h: 72,
      label: this.state === 'paused' ? '继续' : '暂停'
    }, {
      id: 'build', x: 14, y: VIEW_H - 146, w: 62, h: 40,
      label: this.ui && this.ui.buildOpen ? '收起' : '道具'
    }];
    if (this.state === 'playing' && this.nearProp && !this.nearProp.used) {
      list.push({
        id: 'act', x: VIEW_W / 2 - 86, y: VIEW_H - 172, w: 172, h: 60,
        label: this.nearProp.label
      });
    }
    return list;
  }

  onTouchButton(id) {
    if (id === 'pause') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    } else if (id === 'act') {
      if (this.nearProp && !this.nearProp.used) this.nearProp.use();
    } else if (id === 'build') {
      if (this.ui) this.ui.toggleBuild();
    }
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
    /* 每次开局都重新读一次角色设置（可能在角色页刚换过） */
    this.charId = (typeof Meta !== 'undefined') ? Meta.selectedChar() : null;
    if (typeof Meta !== 'undefined') Meta.beginRun();
    this.seed = (seedStr && String(seedStr).trim().length)
      ? String(seedStr).trim().toUpperCase()
      : randomSeedString();

    this.floor = 1;
    this.kills = 0;
    this.embers = 0;
    this.ownedItems = [];
    this.runTime = 0;                // 本局累计时间（结算用）
    this.bossDefeated = [];          // 本局击败的 Boss 名字（结算用）
    this._clearProjectiles();
    this.fx.length = 0;
    this.zones.length = 0;
    this.particles.clear();
    this.damageNumbers.clear();
    this.transition = null;
    this.shake = 0;
    this.nearProp = null;
    this.roomCache = {};

    /* 每次都是全新的角色实例 → Build 一律重新随机，绝不继承上一局 */
    this.player = new Player(this, VIEW_W / 2, VIEW_H / 2 + 90, this.charId);
    this.map = new GameMap(this.seed, this.floor);
    this.state = 'playing';
    this.ui.setOverlay(null);

    this.room = this._roomFor(this.map.start);
    this.map.current = this.map.start;
    this.map.visit(this.map.start);
    this._placePlayerAtEntry('bottom');
    if (this.player.onFloorStart) this.player.onFloorStart();

    const ch1 = ChapterOf(1);
    const who = this.player.char ? this.player.char.name : '拾火者';
    this.ui.showBanner('第 1 层 · ' + ch1.cn,
      ch1.sub + '　·　' + who + ' 踏入回廊', 4.0);
    this.ui.showHint(ch1.tip, 6);
  }

  /* 解锁播报：把 Meta.checkUnlocks() 的返回逐条提示出来 */
  _flushUnlocks(list) {
    if (!list || !list.length) return;
    const KIND_CN = { char: '新角色', item: '新道具', event: '新事件', boss: '新首领' };
    for (const u of list) {
      this.ui.showBanner('解锁 · ' + (KIND_CN[u.kind] || '新内容') + '　' + u.name,
        u.cond + '　（已加入随机池）', 3.2);
    }
    this.particles.ring(VIEW_W / 2, VIEW_H / 2, '#ffd35e', 26, 260);
  }

  /* ---------------------------------------------------------
     通关：走完第 5 层（击败最终 Boss）→ 结算
     --------------------------------------------------------- */
  finishRun() {
    if (this.state === 'victory') return;
    this.state = 'victory';
    this.transition = null;
    this._clearProjectiles();
    this.addShake(8);
    if (typeof Meta !== 'undefined') {
      this._flushUnlocks(Meta.endRun({
        victory: true, floor: this.floor, time: this.runTime, coins: this.embers
      }));
      Meta.addPlayTime(this.runTime);
    }
    this.particles.burst(VIEW_W / 2, VIEW_H / 2, 60, {
      speed: 320, life: 1.4, size: 6,
      colors: ['#8fe9ff', '#ffffff', '#ffd35e', '#c08bff']
    });
    this.particles.ring(VIEW_W / 2, VIEW_H / 2, '#8fe9ff', 40, 380);
    this.ui.setOverlay('victory');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    if (this.input && this.input.touch) this.input.touch.releaseAll();
    this.ui.setOverlay('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    if (this.input && this.input.touch) this.input.touch.releaseAll();
    this.ui.setOverlay(null);
  }

  /* ---------------------------------------------------------
     返回主菜单（暂停面板 / 结算面板的「返回主菜单」）
     局中退出 = 主动放弃本局：照常结算统计与解锁，然后回到标题
     --------------------------------------------------------- */
  quitToTitle() {
    const s = this.state;
    if (s !== 'playing' && s !== 'paused' && s !== 'gameover' && s !== 'victory') return;

    const inRun = (s === 'playing' || s === 'paused');
    if (inRun && typeof Meta !== 'undefined') {
      this._flushUnlocks(Meta.endRun({
        victory: false, floor: this.floor, time: this.runTime, coins: this.embers
      }));
      Meta.addPlayTime(this.runTime);
    }

    this.state = 'title';
    this.transition = null;
    this._clearProjectiles();
    this.fx.length = 0;
    this.zones.length = 0;
    this.particles.clear();
    this.damageNumbers.clear();
    this.nearProp = null;
    this.shake = 0;
    this.shakeKick = 0;
    if (this.input && this.input.touch) this.input.touch.releaseAll();
    if (this.ui) { this.ui.buildOpen = false; this.ui.setOverlay('title'); }
  }

  primaryAction() {
    const om = this.ui ? this.ui.overlayMode : null;
    if (om === 'chars') { this.startRun(this.ui.readSeedInput()); return; }
    if (om === 'stats' || om === 'codex') { this.ui.setOverlay('title'); return; }
    if (this.state === 'title' || this.state === 'gameover' || this.state === 'victory') {
      this.startRun(this.ui.readSeedInput());
    } else if (this.state === 'paused') this.resume();
  }

  roomTypeName() { return this.room ? this.room.meta.cn : '-'; }

  /* ---------------------------------------------------------
     金币（coins）—— 与旧字段 embers 完全等价，只是换成更直白的名字
     --------------------------------------------------------- */
  get coins() { return this.embers; }
  set coins(v) { this.embers = v; }

  addCoins(n, x, y) {
    n = Math.round(n);
    if (n <= 0) return 0;
    /* 角色金币倍率（拾荒者） */
    if (this.player && this.player.coinMul) n = Math.round(n * this.player.coinMul);
    this.embers += n;
    if (x !== undefined) {
      this.damageNumbers.add(x, y - 14, '◈' + n, { color: '#ffd35e', life: 0.9, vy: -46 });
    }
    return n;
  }

  spendCoins(n) {
    if (this.embers < n) return false;
    this.embers -= n;
    return true;
  }

  /* ---------------------------------------------------------
     隐藏房
     --------------------------------------------------------- */
  discoverSecret(cell) {
    if (!cell || cell.discovered) return false;
    cell.discovered = true;

    /* 父房间的实例（可能已缓存）需要重新开门 */
    const parent = cell.parentCell;
    if (parent) {
      const key = this.floor + '#' + parent.c + ',' + parent.r;
      const room = this.roomCache[key];
      if (room) {
        room.refreshConnections(this.map.connectionsOf(parent));
        /* 裂缝已经碎了，从物件里去掉 */
        room.props = room.props.filter(pr => !(pr instanceof WallCrack));
        room.crack = null;
      }
    }
    this.ui.showBanner('秘室显现', '墙上裂开一道通往未知房间的缺口', 2.6);
    this.addShake(4);
    return true;
  }

  /* 揭示本层全部隐藏房（返回数量） */
  discoverAllSecrets(alsoVisit) {
    const list = this.map.secretCells().filter(c => !c.discovered);
    for (const c of list) {
      this.discoverSecret(c);
      if (alsoVisit) this.map.visit(c);
    }
    return list.length;
  }

  onPlayerDeath() {
    this.state = 'gameover';
    this.addShake(9);
    if (typeof Meta !== 'undefined') {
      this._flushUnlocks(Meta.endRun({
        victory: false, floor: this.floor, time: this.runTime, coins: this.embers
      }));
      Meta.addPlayTime(this.runTime);
    }
    this.particles.burst(this.player.x, this.player.y, 34, {
      speed: 260, life: 0.9, size: 5, colors: ['#ffb347', '#ff6b5c', '#ffffff', '#7fd7ea']
    });
    this.ui.setOverlay('gameover');
  }

  onEnemyKilled(e) {
    this.kills++;
    /* 角色击杀钩子（拾火者的余烬回燃等） */
    if (this.player && this.player.onPlayerKill) this.player.onPlayerKill(e);
    if (typeof Meta !== 'undefined') {
      this._flushUnlocks(Meta.addKill(1, !!e.isBoss, e.isBoss ? (e.type || null) : null));
    }

    /* 金币掉落：基础值 + 层数加成；精英房整体更高；「富饶」词缀 ×3 */
    let drop = 3 + Math.floor(this.floor * 0.8);
    if (e.type === 'charger') drop += 3;
    else if (e.type === 'shooter') drop += 1;
    /* 种类定义的额外金币（注册表里 coin 字段） */
    if (e.coinBonus) drop += e.coinBonus;
    if (e.isBoss) drop = 150 + this.floor * 30;
    if (this.room && this.room.type === ROOM_TYPE.ELITE) drop = Math.round(drop * 1.5);
    if (e.affix && e.affix.indexOf('rich') >= 0) drop *= 3;
    /* 章节金币系数（越深越值钱） */
    drop = Math.round(drop * (ChapterOf(this.floor).coins || 1));
    this.embers += drop;
    this.damageNumbers.add(e.x, e.y - 14, '◈' + drop, { color: '#ffd35e', life: 0.9, vy: -46 });

    /* 精英词缀结算 */
    if (e.affix) {
      if (e.affix.indexOf('volatile') >= 0) {
        this._explode(e.x, e.y, 92, 22 + this.floor * 3, { color: '#ff4d6b' });
      }
      if (e.affix.indexOf('splitting') >= 0 && this.room) {
        for (let i = 0; i < 2; i++) {
          this.room.pending.push({ type: 'chaser', delay: 0.12 * i });
        }
      }
    }

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
      const bname = BossRoster.nameOf(room.bossId || 'boss');
      if (this.bossDefeated.indexOf(bname) < 0) this.bossDefeated.push(bname);
      const ch = ChapterOf(this.floor);
      const last = (this.floor >= CHAPTER_COUNT);
      const sub = last
        ? '拾取遗物 · 触碰裂隙终结回廊'
        : '拾取遗物 · 进入第 ' + (this.floor + 1) + ' 层 · ' + ChapterOf(this.floor + 1).cn;
      this.ui.showClearBanner(bname + ' 已陨落 · ' + sub);
      this.player.heal(45);
      this.addShake(6);
    } else if (room.isCombatRoom) {
      this.ui.showClearBanner();
      this.player.heal(room.type === ROOM_TYPE.ELITE ? 18 : 10);
    }
  }

  nextFloor() {
    /* 已经打完最终层 → 结算，不再生成下一层 */
    if (this.floor >= CHAPTER_COUNT) { this.finishRun(); return; }

    this.floor++;
    this.transition = null;
    this._clearProjectiles();
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
    if (this.player.onFloorStart) this.player.onFloorStart();
    if (typeof Meta !== 'undefined') this._flushUnlocks(Meta.reachFloor(this.floor));

    const ch = ChapterOf(this.floor);
    this.ui.showBanner('第 ' + this.floor + ' 层 · ' + ch.cn,
      ch.sub + '　·　' + this.map.cells.length + ' 间', 3.4);
    this.ui.showHint(ch.tip, 6);
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
    this._clearProjectiles();
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
        sub = BossRoster.nameOf(this.room.bossId || 'boss') + ' 已陨落 · 触碰裂隙继续前行';
      } else if (this.room.isCombatRoom && this.room.state !== 'clear') {
        sub = '返回之前的房间 · 战斗继续';
      } else if (cell.type === ROOM_TYPE.TREASURE || cell.type === ROOM_TYPE.SHOP ||
                 cell.type === ROOM_TYPE.EVENT || cell.type === ROOM_TYPE.SECRET) {
        sub = '已探索 · 开启过的物件保持原样';
      } else {
        sub = '已探索 · 房间保持清空状态';
      }
    } else if (cell.type === ROOM_TYPE.BOSS) {
      sub = BossRoster.nameOf(this.room.bossId || 'boss') + ' 就在前方';
    } else if (cell.type === ROOM_TYPE.SECRET) sub = '秘室 · 无人看守的丰厚奖励';
    else if (cell.type === ROOM_TYPE.TREASURE) sub = '按 E 开启宝箱';
    else if (cell.type === ROOM_TYPE.SHOP) sub = '按 E 购买强化';
    else if (cell.type === ROOM_TYPE.EVENT) sub = '按 E 触碰异象';
    else if (cell.type === ROOM_TYPE.ELITE) sub = '强力残形盘踞 · ' + this._roomTheme();
    else if (cell.type === ROOM_TYPE.START) sub = '走进门洞开始探索';
    else sub = this._roomTheme() + '编队 · 击败所有残形，门才会开启';
    this.ui.showBanner(meta.cn, sub, alreadyVisited ? 1.2 : 1.5);
  }

  /* 当前房间的编队主题（供横幅显示） */
  _roomTheme() {
    if (!this.room) return '';
    if (this.room.themeCn) return this.room.themeCn;
    const n = this.room.aliveCount();
    return n > 0 ? '残形 ×' + n : '';
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

  /* 清空投射物（归还对象池）—— 换房 / 换层 / 重开时调用 */
  _clearProjectiles() {
    const arr = this.projectiles;
    const pool = this._projPool;
    for (const p of arr) {
      p.dead = true;
      if (pool.length < 320) pool.push(p);
    }
    arr.length = 0;
  }

  /* 移除第 i 颗投射物（与末尾交换 + 归还池，避免 splice 的数组搬移） */
  _reapProjectile(i) {
    const arr = this.projectiles;
    const p = arr[i];
    const last = arr.length - 1;
    if (i !== last) arr[i] = arr[last];
    arr.pop();
    p.dead = true;
    if (this._projPool.length < 320) this._projPool.push(p);
  }

  /* ---------------------------------------------------------
     投射物
     --------------------------------------------------------- */
  spawnProjectile(opt) {
    /* 弹幕安全上限：敌方在场弹数封顶，杜绝「无法躲避的弹幕墙」 */
    if (!opt.friendly && !opt.isChild) {
      let hostile = 0;
      for (const p of this.projectiles) if (!p.friendly && !p.isChild) hostile++;
      if (hostile >= 110) return null;
    }
    const p = this._projPool.pop() || new Projectile(opt);
    p.reset(opt);
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
    this.addShake(1.4);

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
      if (f.type === 'ring') {
        /* 冲击波：半径推到目标值，线宽与透明度一起收 */
        const t = 1 - a;
        const r = f.r1 * easeOutCubic(t);
        ctx.save();
        ctx.globalAlpha = a * 0.85;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1, f.w * a);
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = a * 0.20;
        ctx.lineWidth = Math.max(1, f.w * a * 2.2);
        ctx.beginPath();
        ctx.arc(f.x, f.y, r * 0.92, 0, TAU);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (f.type === 'item') {
        /* 道具浮现：从物件上方升起的一张小卡片 */
        const t = 1 - a;
        const rise = 46 * easeOutCubic(clamp(t * 2.4, 0, 1));
        const pop = clamp(t * 5, 0, 1);
        const alpha = a > 0.28 ? 1 : a / 0.28;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(f.x, f.y - 26 - rise);
        ctx.scale(easeOutBack(pop), easeOutBack(pop));
        const col = f.item.color || '#ffd35e';
        const label = f.item.name || '';
        ctx.font = '800 14px "Segoe UI", "PingFang SC", system-ui, sans-serif';
        const w = ctx.measureText(label).width + 34;
        ctx.fillStyle = 'rgba(6,10,15,0.88)';
        roundRectPath(ctx, -w / 2, -14, w, 28, 7);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();
        /* 图标（菱形，和 HUD 色块呼应） */
        ctx.fillStyle = col;
        polygonPath(ctx, [[-w / 2 + 15, 0], [-w / 2 + 9, -6], [-w / 2 + 3, 0], [-w / 2 + 9, 6]]);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, -w / 2 + 22, 1);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
        continue;
      }
      if (f.type === 'flash') continue;      // 闪屏在世界之外单独画
      /* ---- zap：链式电弧 ---- */
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 3.5;
      if (Perf.glow) { ctx.shadowColor = f.color; ctx.shadowBlur = 12; }
      ctx.beginPath();
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

  /* 全屏闪色：画在世界之上、UI 之下 */
  _drawFlashes(ctx) {
    for (const f of this.fx) {
      if (f.type !== 'flash') continue;
      const a = clamp(f.life / f.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = f.a0 * a;
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
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
    const enemies = room.enemies;

    /* 宽阶段：敌人较多时先登记网格，子弹只查自己所在格子 */
    const useGrid = enemies.length > 8;
    if (useGrid) {
      this._grid.clear();
      for (let i = 0; i < enemies.length; i++) {
        if (!enemies[i].dead) this._grid.insert(enemies[i]);
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt);

      if (p.dead) {
        if (p.friendly && p.explode > 0) {
          const dmg = p.damage * (p.damageMul || 1);
          this._explode(p.x, p.y, 48 + 14 * p.explode, dmg, { color: p.color });
        } else Juice.impact(this, p, p.x, p.y, 0.7);
        this._reapProjectile(i);
        continue;
      }

      /* 可疑裂缝：只能被子弹打碎（发现隐藏房的唯一途径） */
      if (p.friendly && !p.crackHit && room.crack && room.crack.hitTest(p.x, p.y, p.r)) {
        room.crack.onHit(p);
        if (!(p.pierce > 0 || p.orbit > 0)) {
          Juice.impact(this, p, p.x, p.y, 0.8);
          this._reapProjectile(i);
          continue;
        }
      }

      /* 环境障碍（石柱 / 齿轮 / 相位柱 / 电弧塔）：挡子弹，可破坏物在此扣血 */
      const hz = room.hazardAt(p.x, p.y, p.r);
      if (hz) {
        if (p.friendly) hz.onBullet(p);
        const boomerang = p.orbit > 0;
        if (p.bounce > 0 || boomerang) {
          room.bounceOffHazard(p, hz);
          if (p.bounce > 0) p.bounce--;
          Juice.impact(this, p, p.x, p.y, 0.6);
          if (p.bounceHoming > 0) { p.homing = Math.max(1, p.homing); p.hitIds.length = 0; }
          if (p.endlessRefract > 0) p.pierce = Math.max(1, p.pierce);
          if (p.bounceExplode > 0 && p.explode > 0) {
            this._explode(p.x, p.y, 42 + 14 * p.explode, p.damage * (p.damageMul || 1), { color: p.color });
          }
          continue;
        }
        Juice.impact(this, p, p.x, p.y);
        this._reapProjectile(i);
        continue;
      }

      /* 撞墙：反弹或消散 */
      if (room.hitsWall(p.x, p.y, p.r)) {
        const boomerang = p.orbit > 0;      // 回旋弹永远不会被墙吃掉
        if (p.bounce > 0 || boomerang) {
          room.bounceOffWalls(p);
          if (p.bounce > 0) p.bounce--;
          Juice.impact(this, p, p.x, p.y, 0.6);
          if (p.bounceHoming > 0) { p.homing = Math.max(1, p.homing); p.hitIds.length = 0; }
          if (p.endlessRefract > 0) p.pierce = Math.max(1, p.pierce);
          if (p.bounceExplode > 0 && p.explode > 0) {
            this._explode(p.x, p.y, 42 + 14 * p.explode, p.damage * (p.damageMul || 1), { color: p.color });
          }
          continue;
        }
        Juice.impact(this, p, p.x, p.y);
        this._reapProjectile(i);
        continue;
      }

      if (p.friendly) {
        let hit = null;
        const cand = useGrid ? this._grid.query(p.x, p.y, p.r, this._hitBuf) : enemies;
        for (const e of cand) {
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

          /* ---- 命中反馈：普通命中 / 暴击各有各的火花 ---- */
          const hang = Math.atan2(p.vy, p.vx) + Math.PI;
          Juice.hit(this, p.x, p.y, hang, p.color, crit);
          if (crit) Juice.critBurst(this, hit.x, hit.y);
          this.damageNumbers.add(hit.x, hit.y - hit.r - 6, dmg, { crit: crit });

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
          this._reapProjectile(i);
          continue;
        }
      } else {
        if (!player.dead && Collision.circleCircle(p.x, p.y, p.r, player.x, player.y, player.r)) {
          player.takeDamage(p.damage, p.x, p.y);
          this.ui.hitVignette = 1;
          Juice.impact(this, p, p.x, p.y, 0.8);
          this._reapProjectile(i);
          continue;
        }
      }
    }
  }

  /* ---------------------------------------------------------
     屏幕抖动：全局倍率 + 取大不叠加（避免多个来源叠加成剧烈晃动）
     --------------------------------------------------------- */
  addShake(v, srcX, srcY) {
    if (this.shakeScale <= 0) return;
    const add = v * this.shakeScale;
    if (add <= 0.05) return;
    this.shake = Math.min(15, Math.max(this.shake, add));
    /* 有伤害来源时，画面朝"背离来源"的方向顶一下（方向感 = 知道挨的是哪边的打） */
    if (srcX !== undefined && this.player) {
      const a = angleTo(srcX, srcY, this.player.x, this.player.y);
      this.shakeDX = Math.cos(a);
      this.shakeDY = Math.sin(a);
      this.shakeKick = Math.min(1, (this.shakeKick || 0) + add * 0.16);
    }
  }

  cycleShake() {
    this.shakeLevel = (this.shakeLevel + 1) % this.shakeLevels.length;
    this.shakeScale = this.shakeLevels[this.shakeLevel].scale;
    this._saveShakePref();
    if (this.ui && this.ui.refreshShakeBtn) this.ui.refreshShakeBtn();
    if (this.ui && this.ui.showBanner) {
      this.ui.showBanner('屏幕抖动 · ' + this.shakeLevels[this.shakeLevel].name, '', 1.1);
    }
    return this.shakeLevels[this.shakeLevel].name;
  }

  shakeLabel() {
    return this.shakeLevels[this.shakeLevel].name;
  }

  _loadShakePref() {
    let raw = null;
    /* 优先读 Meta 存档里的设置；没有则兼容旧的独立键（读一次后迁移进 Meta） */
    if (typeof Meta !== 'undefined') raw = Meta.getSetting('shake', null);
    if (raw === null || raw === undefined) {
      try { if (typeof localStorage !== 'undefined') raw = localStorage.getItem('echoRiftShake'); }
      catch (e) { raw = null; }
    }
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 0 && n < this.shakeLevels.length) {
      this.shakeLevel = n;
      this.shakeScale = this.shakeLevels[n].scale;
    }
    if (typeof Meta !== 'undefined') Meta.setSetting('shake', this.shakeLevel);
  }

  _saveShakePref() {
    /* 统一写进 Meta 存档（含 localStorage 落盘） */
    if (typeof Meta !== 'undefined') Meta.setSetting('shake', this.shakeLevel);
  }

  /* ---------------------------------------------------------
     更新
     --------------------------------------------------------- */
  update(dt) {
    this.time += dt;
    this.ui.update(dt);
    this.mouseWorld = this.input.toWorld();

    /* 触屏：首次触摸自动切换模式；瞄准摇杆直接改写成世界瞄准点 */
    if (this.input.touch.active && !this.touchMode) this._enableTouchMode();
    if (this.touchMode) {
      const ad = this.input.aimDir();
      if (ad && this.player) {
        this.mouseWorld = {
          x: this.player.x + ad.x * 300,
          y: this.player.y + ad.y * 300
        };
      }
    }

    if (this.input.wasPressed('KeyF')) this.toggleFullscreen();

    if (this.state === 'title') {
      const om = this.ui ? this.ui.overlayMode : null;
      if (om === 'stats' || om === 'codex' || om === 'chars') {
        /* 子页面：Enter / ESC 返回标题，↑↓ 滚动列表 */
        if (this.input.wasPressed('Enter') || this.input.wasPressed('Escape')) {
          this.ui.setOverlay('title');
        } else {
          const el = this.ui.elText;
          if (el && el.scrollTop !== undefined) {
            const step = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight') ? 220 : 72;
            if (this.input.wasPressed('ArrowDown')) el.scrollTop += step;
            else if (this.input.wasPressed('ArrowUp')) el.scrollTop -= step;
            else if (this.input.wasPressed('PageDown')) el.scrollTop += step * 4;
            else if (this.input.wasPressed('PageUp')) el.scrollTop -= step * 4;
            else if (this.input.wasPressed('Home')) el.scrollTop = 0;
            if (this.input.wasPressed('ArrowDown') || this.input.wasPressed('ArrowUp') ||
                this.input.wasPressed('PageDown') || this.input.wasPressed('PageUp') ||
                this.input.wasPressed('Home')) this.ui._syncScroll(false);
          }
        }
      } else if (this.input.wasPressed('Enter') || this.input.wasPressed('Space')) {
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
      this.shake = Math.max(0, this.shake - dt * (34 + this.shake * 6));
    this.shakeKick = Math.max(0, (this.shakeKick || 0) - dt * 3.6);
      this.input.endFrame();
      return;
    }

    if (this.state === 'victory') {
      if (this.input.wasPressed('KeyR') || this.input.wasPressed('Enter')) {
        this.startRun(this.ui.readSeedInput());
      }
      this.particles.update(dt);
      this.damageNumbers.update(dt);
      this.shake = Math.max(0, this.shake - dt * (34 + this.shake * 6));
    this.shakeKick = Math.max(0, (this.shakeKick || 0) - dt * 3.6);
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
    if (this.input.wasPressed('KeyB')) this.ui.toggleBuild();

    /* 摄像机滑动期间：世界照常运转，只是不再触发新的门 */
    if (this.transition) this._updateTransition(dt);

    this.runTime += dt;
    this.player.update(dt, this.input);
    this.room.update(dt);
    this._updateProjectiles(dt);
    this._updateFx(dt);
    this.particles.update(dt);
    this.damageNumbers.update(dt);
    this.shake = Math.max(0, this.shake - dt * (34 + this.shake * 6));
    this.shakeKick = Math.max(0, (this.shakeKick || 0) - dt * 3.6);

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
    room.drawOverLayer(ctx);        // 环境柱体 / 章节氛围（在实体之上）
    room.drawWalls(ctx);
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const sh = this.shake;
    ctx.save();
    if (sh > 0.05) {
      /* 幅度做幂次衰减：小抖动更收敛（"轻微"），大冲击才明显 */
      const amp = Math.pow(sh / 15, 1.3) * 15;
      const k = (this.shakeKick || 0) * 7;
      ctx.translate(rand(-amp, amp) + this.shakeDX * k, rand(-amp, amp) + this.shakeDY * k);
    }

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

    /* 全屏闪色（受伤 / 暴击 / 清怪 / Boss 陨落） */
    this._drawFlashes(ctx);

    this.ui.drawBanner(ctx);
    if (this.state !== 'title') this.ui.drawHUD(ctx);
    if (this.state === 'playing' && !this.transition) this.ui.drawCrosshair(ctx);
    if (this.touchMode) this.ui.drawTouchControls(ctx);
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

    /* 性能自适应：只在真实主循环里采样（不影响确定性测试） */
    Perf.sample(dt);
    this.particles.max = Perf.budget;

    /* 定格：命中 / 击杀的瞬间把世界压慢几帧 */
    const hs = HitStop.mul();
    HitStop.update(dt);

    this.update(dt * hs);
    this.draw();

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
