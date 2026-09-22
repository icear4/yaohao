/* ===========================================================
   map.js — 程序生成的房间地图（网格 / 节点结构）
   - Start 房固定
   - Boss 房位于地图末端
   - 所有房间由「从已有房间生长」产生 → 天然连通，无孤立房间
   - 相同 Seed + 相同层数 → 完全相同地图
   =========================================================== */
'use strict';

const ROOM_TYPE = {
  START: 'start',
  COMBAT: 'combat',
  TREASURE: 'treasure',
  ELITE: 'elite',
  SHOP: 'shop',
  EVENT: 'event',
  BOSS: 'boss',
  SECRET: 'secret'
};

const ROOM_META = {
  start:    { cn: '起点',   color: '#7dffb0', glyph: 'S' },
  combat:   { cn: '战斗',   color: '#8fa3b5', glyph: '·' },
  treasure: { cn: '宝库',   color: '#ffd35e', glyph: 'T' },
  elite:    { cn: '精英',   color: '#ff8a5c', glyph: 'E' },
  shop:     { cn: '商栈',   color: '#7fe4ff', glyph: '$' },
  event:    { cn: '异象',   color: '#c08bff', glyph: '?' },
  boss:     { cn: '首领',   color: '#ff4d6b', glyph: 'B' },
  secret:   { cn: '秘室',   color: '#c08bff', glyph: '*' }
};

const DIRS = [
  { side: 'top', dc: 0, dr: -1 },
  { side: 'bottom', dc: 0, dr: 1 },
  { side: 'left', dc: -1, dr: 0 },
  { side: 'right', dc: 1, dr: 0 }
];

class GameMap {
  constructor(seed, floor) {
    this.seed = seed;
    this.floor = floor || 1;
    this.rng = new Rng(hashSeed(seed) ^ hashSeed('floor:' + this.floor));
    this.cols = 0;
    this.rows = 0;
    this.cells = [];
    this.grid = {};        // key "c,r" -> cell
    this.visited = {};
    this.current = null;
    this.start = null;
    this.boss = null;
    this.generate();
  }

  /* ---------------------------------------------------------
     生成
     --------------------------------------------------------- */
  generate() {
    const rng = this.rng;
    /* 章节决定地图规模（每层的主场尺寸不同） */
    const ch = ChapterOf(this.floor);
    const sz = ch.size || { cols: 5, rows: 5 };
    this.cols = clamp(sz.cols, 5, 7);
    this.rows = clamp(sz.rows, 5, 6);
    const cols = this.cols, rows = this.rows;

    /* 1. 起点固定在最左列（纵向居中附近） */
    const startR = rows >= 5 ? 2 + rng.int(-1, 1) : Math.floor(rows / 2);
    const start = this._add(0, clamp(startR, 0, rows - 1));
    this.start = start;
    start.type = ROOM_TYPE.START;

    /* 2. 主路径：从起点一路向右生长到最右列 → 末端即 Boss */
    let cur = start;
    let guard = 0;
    const mainPath = [start];
    while (cur.c < cols - 1 && guard++ < 200) {
      /* 先在当前列纵向游走 0~2 格，再向右推进一格。
         注意：纵向漂移必须在「尚未进入最右列」时完成，
         否则会在最右列留下比 Boss 更远的房间，破坏 Boss 的末端性。 */
      const vSteps = rng.int(0, 2);
      const vDir = rng.chance(0.5) ? -1 : 1;
      for (let i = 0; i < vSteps; i++) {
        const nr = cur.r + vDir;
        if (nr < 0 || nr >= rows) break;
        cur = this._add(cur.c, nr);
        mainPath.push(cur);
      }
      /* 向右推进（最后一次推进一定落在最右列，其后不再漂移 → 末端即 Boss） */
      cur = this._add(cur.c + 1, cur.r);
      mainPath.push(cur);
    }

    /* 3. Boss = 主路径末端（一定在最右列） */
    this.boss = cur;
    cur.type = ROOM_TYPE.BOSS;

    /* 4. 分支：从主路径上的房间长出 2~4 条短支线 */
    const branchCount = clamp(2 + rng.int(0, 2), 2, 4);
    const branchRoots = rng.shuffle(mainPath.slice(0, Math.max(1, mainPath.length - 1)));
    let made = 0;
    for (let i = 0; i < branchRoots.length && made < branchCount; i++) {
      const root = branchRoots[i];
      if (root === this.start || root === this.boss) continue;
      /* 支线不从末端附近长出，保证 Boss 房始终是地图尽头 */
      if (root.c >= this.boss.c - 1) continue;
      const len = rng.int(1, 2);
      let node = root;
      for (let s = 0; s < len; s++) {
        const dirs = rng.shuffle(DIRS);
        let placed = null;
        for (const d of dirs) {
          const nc = node.c + d.dc, nr = node.r + d.dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          if (this.grid[nc + ',' + nr]) continue;
          if (nc >= this.boss.c) continue;          // 不越过 Boss 所在列
          /* 支线房间只能挂在自己父节点上：避免支线互相粘连后比 Boss 更远 */
          let otherNeighbors = 0;
          for (const dd of DIRS) {
            const nb = this.grid[(nc + dd.dc) + ',' + (nr + dd.dr)];
            if (nb && nb !== node) otherNeighbors++;
          }
          if (otherNeighbors > 0) continue;
          placed = this._add(nc, nr);
          break;
        }
        if (!placed) break;
        node = placed;
      }
      made++;
    }

    /* 5. 分配房间类型 */
    this._assignTypes(mainPath);

    /* 6. 建立连接（四方向相邻即连通） */
    this._linkAll();

    /* 7. 保险：确保 Boss 一定是离 Start 最远的房间（末端） */
    this._ensureBossTerminal();

    /* 8. 隐藏房：放在保险之后，避免被剪枝逻辑误删 */
    this._placeSecretRooms();
  }

  /* ---------------------------------------------------------
     隐藏房
     - 挂在一个普通房间的空邻位上（死路尽头）
     - 未发现前：地图不显示，父房间也不开门
     - 发现条件：击碎父房间墙上那道可疑裂缝
     --------------------------------------------------------- */
  _placeSecretRooms() {
    const rng = this.rng;
    const want = this.floor <= 1
      ? (rng.chance(0.55) ? 1 : 0)
      : (rng.chance(0.45) ? 2 : 1);

    /* 父房间必须离 Start 足够近：秘室 = 父房间距离 +1，
       所以要保证 秘室距离 < Boss 距离，Boss 才始终是地图尽头 */
    const d0 = this.distancesFromStart();
    const bd = d0[this.boss.c + ',' + this.boss.r];
    const parents = rng.shuffle(this.cells.filter(c => {
      if (c === this.start || c === this.boss || c.type === ROOM_TYPE.BOSS) return false;
      if (c.c >= this.boss.c - 1) return false;        // 也要远离 Boss 所在列
      const dd = d0[c.c + ',' + c.r];
      return dd !== undefined && dd + 1 < bd;
    }));

    let made = 0;
    for (const parent of parents) {
      if (made >= want) break;
      const sides = rng.shuffle(DIRS.slice());
      let ok = false;
      for (const d of sides) {
        if (parent.links[d.side]) continue;                 // 该方向已有房间
        const nc = parent.c + d.dc, nr = parent.r + d.dr;
        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
        if (this.grid[nc + ',' + nr]) continue;
        /* 新格子除了父房间外不能有别的邻居（保持死路尽头） */
        let extra = 0;
        for (const dd of DIRS) {
          const nb = this.grid[(nc + dd.dc) + ',' + (nr + dd.dr)];
          if (nb && nb !== parent) extra++;
        }
        if (extra > 0) continue;

        const cell = this._add(nc, nr);
        cell.type = ROOM_TYPE.SECRET;
        cell.hidden = true;
        cell.discovered = false;
        cell.branch = true;
        /* 记录裂缝开在哪一侧（父房间视角） */
        parent.secretSide = d.side;
        parent.secretCell = cell;
        cell.parentCell = parent;
        this._linkAll();
        ok = true;
        made++;
        break;
      }
      if (!ok) continue;
    }
  }

  /* BFS 距离表（以 Start 为原点） */
  distancesFromStart() {
    const d = {};
    d[this.start.c + ',' + this.start.r] = 0;
    const q = [this.start];
    while (q.length) {
      const cur = q.shift();
      for (const dir of DIRS) {
        const n = cur.links[dir.side];
        if (!n) continue;
        const k = n.c + ',' + n.r;
        if (d[k] !== undefined) continue;
        d[k] = d[cur.c + ',' + cur.r] + 1;
        q.push(n);
      }
    }
    return d;
  }

  /* 若存在比 Boss 更远的房间，整批剪掉。
     安全性说明：BFS 最短路经过的中间房间距离严格递减，
     因此「距离 > Boss 距离」的房间被删除后，剩下的房间仍全部连通（无孤立）。 */
  _ensureBossTerminal() {
    for (let pass = 0; pass < 12; pass++) {
      const d = this.distancesFromStart();
      const bd = d[this.boss.c + ',' + this.boss.r];
      const doomed = this.cells.filter(c => {
        if (c === this.boss || c === this.start) return false;
        const dd = d[c.c + ',' + c.r];
        return dd === undefined || dd > bd;      // 不可达 或 比 Boss 更远
      });
      if (!doomed.length) break;
      for (const cell of doomed) {
        delete this.grid[cell.c + ',' + cell.r];
        const idx = this.cells.indexOf(cell);
        if (idx >= 0) this.cells.splice(idx, 1);
      }
      this._linkAll();
    }
  }

  _add(c, r) {
    const key = c + ',' + r;
    if (this.grid[key]) return this.grid[key];
    const cell = {
      id: this.cells.length,
      c: c, r: r,
      type: ROOM_TYPE.COMBAT,
      links: {},             // side -> cell
      branch: false
    };
    this.grid[key] = cell;
    this.cells.push(cell);
    return cell;
  }

  _assignTypes(mainPath) {
    const rng = this.rng;

    /* 主路径（含起点/Boss）上的中间房间：多为战斗，偶尔精英 / 异象 */
    for (const cell of mainPath) {
      if (cell === this.start || cell === this.boss) continue;
      const roll = rng.next();
      if (roll < 0.16) cell.type = ROOM_TYPE.ELITE;
      else if (roll < 0.30) cell.type = ROOM_TYPE.EVENT;
      else cell.type = ROOM_TYPE.COMBAT;
    }

    /* 支线房间：宝库 / 商栈 / 异象为主 */
    const branches = this.cells.filter(c => c !== this.start && c !== this.boss &&
      !mainPath.includes(c));
    const shuffled = rng.shuffle(branches);

    /* 保证：至少一间宝库；房间多时保证一间商栈 */
    const want = [];
    want.push(ROOM_TYPE.TREASURE);
    if (shuffled.length >= 3) want.push(ROOM_TYPE.SHOP);
    if (shuffled.length >= 5) want.push(ROOM_TYPE.TREASURE);
    if (this.floor >= 2 && shuffled.length >= 4) want.push(ROOM_TYPE.ELITE);

    for (let i = 0; i < shuffled.length; i++) {
      const cell = shuffled[i];
      if (i < want.length) {
        cell.type = want[i];
      } else {
        const roll = rng.next();
        if (roll < 0.34) cell.type = ROOM_TYPE.TREASURE;
        else if (roll < 0.56) cell.type = ROOM_TYPE.EVENT;
        else if (roll < 0.78) cell.type = ROOM_TYPE.ELITE;
        else cell.type = ROOM_TYPE.COMBAT;
      }
      cell.branch = true;
    }

    /* 兜底：如果没有宝库（支线太少），把某个非 Boss 战斗房改成宝库 */
    if (!this.cells.some(c => c.type === ROOM_TYPE.TREASURE)) {
      const cand = this.cells.filter(c => c !== this.start && c !== this.boss &&
        c.type === ROOM_TYPE.COMBAT);
      if (cand.length) cand[rng.int(0, cand.length - 1)].type = ROOM_TYPE.TREASURE;
    }
  }

  _linkAll() {
    for (const cell of this.cells) {
      cell.links = {};
      for (const d of DIRS) {
        const n = this.grid[(cell.c + d.dc) + ',' + (cell.r + d.dr)];
        if (n) cell.links[d.side] = n;
      }
    }
  }

  /* ---------------------------------------------------------
     查询
     --------------------------------------------------------- */
  /* 门的连接：未发现的隐藏房不出现在父房间的门列表里 */
  connectionsOf(cell) {
    const out = {
      top: !!cell.links.top,
      bottom: !!cell.links.bottom,
      left: !!cell.links.left,
      right: !!cell.links.right
    };
    for (const d of DIRS) {
      const n = cell.links[d.side];
      if (n && n.hidden && !n.discovered) out[d.side] = false;
    }
    return out;
  }

  /* 揭示整张地图（回廊残图） */
  revealAll() {
    for (const c of this.cells) {
      if (c.hidden && !c.discovered) continue;
      this.visit(c);
    }
  }

  secretCells() { return this.cells.filter(c => c.hidden); }

  /* 计入探索度的房间数（未发现的隐藏房不算在内） */
  countableRooms() {
    return this.cells.filter(c => !c.hidden || c.discovered).length;
  }

  countableVisited() {
    let n = 0;
    for (const c of this.cells) {
      if (c.hidden && !c.discovered) continue;
      if (this.isVisited(c)) n++;
    }
    return n;
  }

  neighbor(cell, side) { return cell.links[side] || null; }

  visit(cell) {
    this.visited[cell.c + ',' + cell.r] = true;
  }

  isVisited(cell) { return !!this.visited[cell.c + ',' + cell.r]; }

  typeCount(type) {
    let n = 0;
    for (const c of this.cells) if (c.type === type) n++;
    return n;
  }

  /* 从 Start 做 BFS，返回可达集合 —— 用于自检 */
  reachableFromStart() {
    const seen = {};
    const q = [this.start];
    seen[this.start.c + ',' + this.start.r] = true;
    while (q.length) {
      const cur = q.shift();
      for (const d of DIRS) {
        const n = cur.links[d.side];
        if (!n) continue;
        const k = n.c + ',' + n.r;
        if (seen[k]) continue;
        seen[k] = true;
        q.push(n);
      }
    }
    return seen;
  }

  /* 用于测试与「同种子一致性」比对 */
  serialize() {
    const cells = this.cells.slice().sort((a, b) => (a.c - b.c) || (a.r - b.r))
      .map(c => `${c.c},${c.r}:${c.type}:${Object.keys(c.links).sort().join('')}`);
    return `seed=${this.seed};floor=${this.floor};size=${this.cols}x${this.rows};` + cells.join('|');
  }
}
