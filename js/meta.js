/* ===========================================================
   meta.js — Meta Progression（跨局成长 / 解锁 / 存档 / 统计）
   -----------------------------------------------------------
   设计底线：**不破坏 Roguelike 的随机性**
     · 解锁只「拓宽随机池」（可抽到的道具 / 会遇到的 Boss / 会出现的事件），
       不给任何永久数值加成 —— 所有数值成长仍然只来自本局随机到的 Build
     · 角色是「不同起手式」，不是「更强的角色」（高攻必然低血，反之亦然）
     · 当前 Run 的 Build 一律不落盘；每次 startRun 都重新 new Player → Build 重新随机

   存档：localStorage（键 echo-rift-meta-v1）
     已解锁角色 / 已解锁道具 / 已击败 Boss / 已解锁事件 / 统计 / 设置

   本文件只做「追加」：
     · 不改玩家 / 射击 / 敌人 / 碰撞的既有逻辑
     · 新增角色  = CHARACTERS 加一条 + CHAR_ABILITIES 加一组钩子
     · 新增解锁  = UNLOCKS 加一条
     · 新增 Boss = 写一个 class + EnemyFactory.register + BossRoster.list
   =========================================================== */
'use strict';

const META_KEY = 'echo-rift-meta-v1';
const META_VERSION = 1;

/* ===========================================================
   1. 角色表（4 位可解锁 + 1 位初始）
   -----------------------------------------------------------
   字段：
     id / name / en / tag / desc / ability  展示用
     locked         true = 需要解锁
     base          基础属性（覆盖 Player.base 的对应项）
     mods          自带机制层数（写进 Build.recompute，和道具叠加）
     coinMul       金币获取倍率
     colors        斗篷 / 描边 / 核心 / 强调 / 弹丸 配色
   =========================================================== */
const CHARACTERS = [
  {
    id: 'ember', name: '拾火者', en: 'EMBER', locked: false,
    tag: '均衡 · 余烬回燃',
    desc: '最初的拾火者。属性均衡，击碎残形时偶尔能把余烬收回体内。',
    ability: '余烬回燃 · 每次击杀有 30% 概率回复 2 点生命；每进入新的一层回复 8 点',
    colors: {
      cloak: '#15333c', edge: '#2f6b74', core: '#ffb347',
      accent: '#7fd7ea', bullet: '#ffb347'
    },
    base: {
      maxHp: 100, damage: 11, fireInterval: 0.17, moveSpeed: 262,
      bulletSpeed: 660, bulletRadius: 5, bulletCount: 1,
      critChance: 0.08, critDamage: 2.0, range: 1060, invulnTime: 0.9
    }
  },
  {
    id: 'cinder', name: '灼刃', en: 'CINDER', locked: true,
    tag: '高攻击 · 低生命 · 过热',
    desc: '把命换成刀锋的人。血薄如纸，但只要不停开火，每一发都在变烫。',
    ability: '过热 · 连续射击每层 +3% 伤害（最多 10 层），停火 1.2 秒后迅速冷却',
    colors: {
      cloak: '#3a1414', edge: '#a33a2a', core: '#ff6b3c',
      accent: '#ff9d6b', bullet: '#ff7a3c'
    },
    base: {
      maxHp: 62, damage: 17, fireInterval: 0.15, moveSpeed: 250,
      bulletSpeed: 700, bulletRadius: 5, bulletCount: 1,
      critChance: 0.12, critDamage: 2.1, range: 1060, invulnTime: 0.8
    }
  },
  {
    id: 'bulwark', name: '磐盾', en: 'BULWARK', locked: true,
    tag: '高生命 · 低攻击 · 回声护壁',
    desc: '走得慢，打得轻，但极难被抹掉。护壁撑开的那一瞬间，回廊也咬不动他。',
    ability: '回声护壁 · 受伤后 2.5 秒内受到的伤害减半（冷却 6 秒）',
    colors: {
      cloak: '#14283a', edge: '#3f7ba8', core: '#7fd7ea',
      accent: '#7dffb0', bullet: '#9adcff'
    },
    base: {
      maxHp: 168, damage: 7.5, fireInterval: 0.22, moveSpeed: 238,
      bulletSpeed: 600, bulletRadius: 6, bulletCount: 1,
      critChance: 0.06, critDamage: 1.9, range: 1000, invulnTime: 1.0
    }
  },
  {
    id: 'orbiter', name: '星轨', en: 'ORBITER', locked: true,
    tag: '特殊投射物 · 回旋星弹',
    desc: '他的子弹不走直线 —— 它们飞出去，绕一圈，再回到他手上。',
    ability: '环绕星轨 · 所有弹丸都会折返回旋；每 3 秒自动射出一颗追踪星弹',
    mods: { orbit: 1 },
    colors: {
      cloak: '#1b1636', edge: '#6a4fa8', core: '#c08bff',
      accent: '#aef0ff', bullet: '#d8b4ff'
    },
    base: {
      maxHp: 84, damage: 9, fireInterval: 0.20, moveSpeed: 268,
      bulletSpeed: 620, bulletRadius: 6, bulletCount: 1,
      critChance: 0.09, critDamage: 2.0, range: 1250, invulnTime: 0.9
    }
  },
  {
    id: 'scav', name: '拾荒者', en: 'SCAVENGER', locked: true,
    tag: '经济 · 金币加成',
    desc: '别人在回廊里捡命，他在回廊里捡钱。',
    ability: '拾荒本能 · 金币获取 +30%；每进入新的一层立刻获得 25 金币',
    coinMul: 1.30,
    colors: {
      cloak: '#2e2812', edge: '#a08a3a', core: '#ffd35e',
      accent: '#ffd35e', bullet: '#ffe08a'
    },
    base: {
      maxHp: 88, damage: 10, fireInterval: 0.18, moveSpeed: 272,
      bulletSpeed: 680, bulletRadius: 5, bulletCount: 1,
      critChance: 0.10, critDamage: 2.0, range: 1060, invulnTime: 0.9
    }
  }
];

const CHAR_BY_ID = {};
for (const c of CHARACTERS) CHAR_BY_ID[c.id] = c;

function CharacterOf(id) {
  return CHAR_BY_ID[id] || CHARACTERS[0];
}

/* ===========================================================
   2. 角色能力钩子
   -----------------------------------------------------------
   全部是可选钩子，缺哪个就走默认行为 —— 新增角色不用改 Player。
     update(p, dt, g)        每帧
     onKill(p, g, e)         击杀敌人
     onHurt(p, g)            受伤瞬间
     onFloor(p, g)           进入新一层（含开局第 1 层）
     onShoot(p, g)           每次射击之后
     dmgMul(p)               射击伤害倍率
     dmgTakenMul(p)          受到伤害倍率
   =========================================================== */
const CHAR_ABILITIES = {
  /* 拾火者：击杀偶尔回血；进层回血 */
  ember: {
    onKill(p, g) { if (Math.random() < 0.30) p.heal(2); },
    onFloor(p, g) { p.heal(8); }
  },

  /* 灼刃：连射叠加过热，伤害递增；停火后迅速冷却 */
  cinder: {
    onShoot(p, g) {
      p.heat = Math.min(10, p.heat + 1);
      p.heatT = 1.2;
    },
    update(p, dt, g) {
      if (p.heatT > 0) p.heatT -= dt;
      else if (p.heat > 0) p.heat = Math.max(0, p.heat - dt * 6);
      /* 高热时身周冒火星 */
      if (p.heat > 4 && Math.random() < dt * 12 * (p.heat / 10)) {
        g.particles.spawn(
          p.x + rand(-12, 12), p.y + rand(-12, 12),
          rand(-16, 16), rand(-60, -24), rand(0.2, 0.45), rand(2, 3.6),
          p.heat > 8 ? '#fff0c0' : '#ff7a3c', { drag: 2.4 }
        );
      }
    },
    dmgMul(p) { return 1 + 0.03 * p.heat; }
  },

  /* 磐盾：受伤后开护壁，减伤 50% */
  bulwark: {
    onHurt(p, g) {
      if (p.wallCd > 0) return;
      p.wallT = 2.5;
      p.wallCd = 6;
      g.particles.ring(p.x, p.y, '#7dffb0', 18, 180);
      g.damageNumbers.add(p.x, p.y - 34, '护壁', { color: '#7dffb0', life: 0.9, vy: -40 });
    },
    update(p, dt, g) {
      if (p.wallT > 0) p.wallT -= dt;
      if (p.wallCd > 0) p.wallCd -= dt;
    },
    dmgTakenMul(p) { return p.wallT > 0 ? 0.5 : 1; }
  },

  /* 星轨：定期自动射出追踪回旋星弹 */
  orbiter: {
    update(p, dt, g) {
      if (p.dead) return;
      p.autoT -= dt;
      if (p.autoT > 0) return;
      p.autoT = 3.0;
      let best = null, bd = 660 * 660;
      const list = g.room ? g.room.enemies : [];
      for (const e of list) {
        if (e.dead) continue;
        const d = dist2(p.x, p.y, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      const a = best ? angleTo(p.x, p.y, best.x, best.y) : p.aim;
      g.spawnProjectile({
        x: p.x + Math.cos(a) * (p.r + 8),
        y: p.y + Math.sin(a) * (p.r + 8),
        angle: a,
        speed: 300,
        damage: Math.max(2, Math.round(p.damage * 0.6)),
        r: 7,
        friendly: true,
        color: '#d8b4ff',
        core: '#ffffff',
        life: 2.8,
        game: g,
        spin: 9,
        homing: 2,
        orbit: 1,
        splitLeft: 0,
        damageMul: 1
      });
      g.particles.ring(p.x, p.y, '#c08bff', 10, 140);
    },
    onFloor(p, g) { p.autoT = 1.2; }
  },

  /* 拾荒者：进层领钱 */
  scav: {
    onFloor(p, g) { g.addCoins(25, p.x, p.y); }
  }
};

/* ===========================================================
   3. 解锁表（数据驱动）
   -----------------------------------------------------------
   kind: char | item | event | boss
   test(s): 统计达标即解锁；prog(s): [当前, 需求]（统计页显示进度条）
   全部条件都来自「游戏行为」，没有任何付费 / 局外数值购买。
   =========================================================== */
const UNLOCKS = [
  /* ---- 角色 ---- */
  {
    kind: 'char', id: 'cinder', name: '灼刃 · CINDER',
    cond: '累计击碎 150 个残形',
    test: s => s.kills >= 150, prog: s => [Math.min(s.kills, 150), 150]
  },
  {
    kind: 'char', id: 'bulwark', name: '磐盾 · BULWARK',
    cond: '抵达第 3 层',
    test: s => s.bestFloor >= 3, prog: s => [Math.min(s.bestFloor, 3), 3]
  },
  {
    kind: 'char', id: 'orbiter', name: '星轨 · ORBITER',
    cond: '累计击败 3 位首领',
    test: s => s.bossKills >= 3, prog: s => [Math.min(s.bossKills, 3), 3]
  },
  {
    kind: 'char', id: 'scav', name: '拾荒者 · SCAVENGER',
    cond: '累计获得 2500 金币',
    test: s => s.coins >= 2500, prog: s => [Math.min(s.coins, 2500), 2500]
  },

  /* ---- 道具（解锁后进入随机池，不给永久加成，只是池更宽） ---- */
  {
    kind: 'item', id: 'prism_heart', name: '棱镜之心',
    cond: '累计击败 2 位首领',
    test: s => s.bossKills >= 2, prog: s => [Math.min(s.bossKills, 2), 2]
  },
  {
    kind: 'item', id: 'void_shell', name: '虚空甲壳',
    cond: '累计击碎 300 个残形',
    test: s => s.kills >= 300, prog: s => [Math.min(s.kills, 300), 300]
  },
  {
    kind: 'item', id: 'clockwork', name: '发条中枢',
    cond: '抵达第 4 层',
    test: s => s.bestFloor >= 4, prog: s => [Math.min(s.bestFloor, 4), 4]
  },
  {
    kind: 'item', id: 'rift_bloom', name: '裂隙之花',
    cond: '累计击碎 500 个残形',
    test: s => s.kills >= 500, prog: s => [Math.min(s.kills, 500), 500]
  },
  {
    kind: 'item', id: 'starlight', name: '星辉丝线',
    cond: '累计获得 4000 金币',
    test: s => s.coins >= 4000, prog: s => [Math.min(s.coins, 4000), 4000]
  },
  {
    kind: 'item', id: 'ember_titan', name: '泰坦余烬',
    cond: '累计死亡 5 次',
    test: s => s.deaths >= 5, prog: s => [Math.min(s.deaths, 5), 5]
  },

  /* ---- 房间事件 ---- */
  {
    kind: 'event', id: 'echo_pact', name: '回声契约',
    cond: '累计击败 3 位首领',
    test: s => s.bossKills >= 3, prog: s => [Math.min(s.bossKills, 3), 3]
  },
  {
    kind: 'event', id: 'star_dais', name: '星界赌盘',
    cond: '抵达第 5 层',
    test: s => s.bestFloor >= 5, prog: s => [Math.min(s.bestFloor, 5), 5]
  },
  {
    kind: 'event', id: 'relic_forge', name: '遗物熔炉',
    cond: '累计获得 3000 金币',
    test: s => s.coins >= 3000, prog: s => [Math.min(s.coins, 3000), 3000]
  },

  /* ---- Boss（解锁后加入对应层的 Boss 随机池） ---- */
  {
    kind: 'boss', id: 'boss_kaleido', name: '万华之瞳',
    cond: '累计击败 4 位首领',
    test: s => s.bossKills >= 4, prog: s => [Math.min(s.bossKills, 4), 4]
  },
  {
    kind: 'boss', id: 'boss_nameless', name: '无相回声',
    cond: '通关一次回廊',
    test: s => s.wins >= 1, prog: s => [Math.min(s.wins, 1), 1]
  }
];

const UNLOCK_BY = {};
for (const u of UNLOCKS) UNLOCK_BY[u.kind + ':' + u.id] = u;

/* ===========================================================
   4. 存档（localStorage）
   -----------------------------------------------------------
   只保存：解锁 / 已击败 Boss / 统计 / 设置
   绝不保存：当前 Run 的 Build、道具、血量、金币
   =========================================================== */
function lsGet(k) {
  try { return (typeof localStorage !== 'undefined') ? localStorage.getItem(k) : null; }
  catch (e) { return null; }
}
function lsSet(k, v) {
  try { if (typeof localStorage !== 'undefined') { localStorage.setItem(k, v); return true; } }
  catch (e) { /* 隐私模式 / 配额不足：静默降级为内存存档 */ }
  return false;
}
function lsDel(k) {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); } catch (e) { }
}

const Meta = {
  data: null,
  storageOk: true,

  /* ---- 默认存档 ---- */
  defaults() {
    return {
      v: META_VERSION,
      unlocked: { char: ['ember'], item: [], boss: [], event: [] },
      beaten: [],                 // 击败过的 Boss id（图鉴用）
      stats: {
        runs: 0,        // 游戏次数
        deaths: 0,      // 死亡次数
        wins: 0,        // 通关次数
        bossKills: 0,   // Boss 击杀
        kills: 0,       // 总击杀
        coins: 0,       // 累计金币
        bestFloor: 1,   // 最远到达层数
        bestTime: 0,    // 最长生存时间（秒）
        time: 0         // 累计游玩时间（秒）
      },
      settings: { char: 'ember', shake: 1 }
    };
  },

  /* ---- 载入 / 保存 ---- */
  load() {
    const d = this.defaults();
    const raw = lsGet(META_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          if (p.unlocked) for (const k in d.unlocked) {
            if (Array.isArray(p.unlocked[k])) d.unlocked[k] = p.unlocked[k].slice();
          }
          if (Array.isArray(p.beaten)) d.beaten = p.beaten.slice();
          if (p.stats) for (const k in d.stats) {
            const n = Number(p.stats[k]);
            if (!isNaN(n)) d.stats[k] = n;
          }
          if (p.settings) for (const k in d.settings) {
            if (p.settings[k] !== undefined && p.settings[k] !== null) d.settings[k] = p.settings[k];
          }
        }
      } catch (e) { /* 存档损坏：用默认值 */ }
    }
    /* 初始角色永远可用（防止存档被手动改坏） */
    if (d.unlocked.char.indexOf('ember') < 0) d.unlocked.char.push('ember');
    this.data = d;
    this.storageOk = !!raw || lsSet(META_KEY, JSON.stringify(d));
    return d;
  },

  save() {
    if (!this.data) return false;
    return lsSet(META_KEY, JSON.stringify(this.data));
  },

  /* 清空存档（统计页提供入口） */
  reset() {
    lsDel(META_KEY);
    this.data = this.defaults();
    this.save();
    return this.data;
  },

  get stats() { return this.data.stats; },

  /* ---- 设置 ---- */
  getSetting(k, dv) {
    if (!this.data) return dv;
    const v = this.data.settings[k];
    return (v === undefined || v === null) ? dv : v;
  },
  setSetting(k, v) {
    if (!this.data) return;
    this.data.settings[k] = v;
    this.save();
  },
  selectedChar() {
    const id = this.getSetting('char', 'ember');
    return this.isCharUnlocked(id) ? id : 'ember';
  },
  selectChar(id) {
    if (!this.isCharUnlocked(id)) return false;
    this.setSetting('char', id);
    return true;
  },

  /* ---- 解锁查询 ---- */
  isUnlocked(kind, id) {
    if (!this.data) return kind === 'char' && id === 'ember';
    return this.data.unlocked[kind].indexOf(id) >= 0;
  },
  isCharUnlocked(id) { return this.isUnlocked('char', id); },
  isItemUnlocked(id) { return this.isUnlocked('item', id); },
  isBossUnlocked(id) { return this.isUnlocked('boss', id); },
  isEventUnlocked(id) { return this.isUnlocked('event', id); },

  /* 已解锁的角色 / 道具 / 事件 / Boss（过滤 locked 条目） */
  unlockedChars() { return CHARACTERS.filter(c => !c.locked || this.isCharUnlocked(c.id)); },
  availableItems() {
    if (typeof ITEMS === 'undefined') return [];
    return ITEMS.filter(it => !it.locked || this.isItemUnlocked(it.id));
  },
  availableBosses(pool) {
    return (pool || []).filter(id => {
      const u = UNLOCK_BY['boss:' + id];
      return !u || this.isBossUnlocked(id);
    });
  },

  /* ---- 记录 ---- */
  beginRun() {
    if (!this.data) this.load();
    this.data.stats.runs++;
    this.save();
  },

  addKill(n, isBoss, bossId) {
    if (!this.data) this.load();
    const s = this.data.stats;
    s.kills += (n || 1);
    if (isBoss) {
      s.bossKills++;
      if (bossId && this.data.beaten.indexOf(bossId) < 0) this.data.beaten.push(bossId);
    }
    this.save();
    return this.checkUnlocks();
  },

  addCoins(n) {
    if (!this.data) this.load();
    this.data.stats.coins += Math.max(0, Math.round(n || 0));
    this.save();
    return this.checkUnlocks();
  },

  reachFloor(f) {
    if (!this.data) this.load();
    if (f > this.data.stats.bestFloor) { this.data.stats.bestFloor = f; this.save(); }
    return this.checkUnlocks();
  },

  /* 本局结束：death / victory 都走这里 */
  endRun(res) {
    if (!this.data) this.load();
    res = res || {};
    const s = this.data.stats;
    if (res.victory) s.wins++; else s.deaths++;
    if (res.time > s.bestTime) s.bestTime = res.time;
    if (res.floor > s.bestFloor) s.bestFloor = res.floor;
    s.coins += Math.max(0, Math.round(res.coins || 0));
    this.save();
    return this.checkUnlocks();
  },

  addPlayTime(sec) {
    if (!this.data) return;
    this.data.stats.time += Math.max(0, sec || 0);
  },

  /* ---- 解锁判定：返回本次「新解锁」的条目 ---- */
  checkUnlocks() {
    if (!this.data) return [];
    const s = this.data.stats;
    const out = [];
    for (const u of UNLOCKS) {
      if (this.isUnlocked(u.kind, u.id)) continue;
      let ok = false;
      try { ok = !!u.test(s); } catch (e) { ok = false; }
      if (!ok) continue;
      this.data.unlocked[u.kind].push(u.id);
      out.push(u);
    }
    if (out.length) this.save();
    return out;
  },

  /* 统计页 / 图鉴用：某条解锁的进度 [当前, 需求] */
  progressOf(u) {
    if (!this.data) return [0, 1];
    if (this.isUnlocked(u.kind, u.id)) return [1, 1];
    try { return u.prog(this.data.stats); } catch (e) { return [0, 1]; }
  },

  /* 图鉴：全部可解锁条目（含已解锁 / 未解锁） */
  codex() {
    return UNLOCKS.map(u => {
      const p = this.progressOf(u);
      return {
        kind: u.kind, id: u.id, name: u.name, cond: u.cond,
        got: this.isUnlocked(u.kind, u.id),
        cur: p[0], need: p[1]
      };
    });
  },

  /* 击败过的 Boss（图鉴） */
  beatenBosses() {
    return (this.data ? this.data.beaten : []).slice();
  }
};

Meta.load();

/* ===========================================================
   5. 可解锁 Boss
   -----------------------------------------------------------
   这两位不进默认池，只有完成解锁条件后才会加入对应层的随机池。
   解锁只「增加可能遇到的对手」，不改变任何数值平衡。
   =========================================================== */

/* -----------------------------------------------------------
   万华之瞳 · Kaleidoscope
   主题：镜面折射。环形镜棱 / 扇形棱镜 / 镜旋弹幕 / 镜面激光 /
        追光棱 / 镜闪突进 / 镜裂地面 / 召唤镜影
   特殊技能：万华绘卷 —— 六面镜子绕身旋转，放射双向螺旋弹幕 + 镜裂地面
   ----------------------------------------------------------- */
class Kaleidoscope extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '万华之瞳',
      title: '你看见的不是我，是我折射出去的你',
      r: 32, hp: 560, speed: 104, touchDamage: 13, touchInterval: 0.85, mass: 7,
      rng: rng, colors: ['#2a1840', '#ff6bd0', '#7fe4ff'],
      specialName: '万华绘卷',
      phaseNames: ['单镜', '重影', '万华'],
      summonPool: ['wisp', 'phantom', 'swarmer'], maxMinions: 5
    });
    this.bulletDamage = 9;
    this.dmgFields = ['bulletDamage'];
    this.specialCd = 7.5;
    this.spiralA = rng.range(0, TAU);
    this.spiralLeft = 0;
    this.dashDir = 0;
    this.mirrorRot = 0;
    this.deathDur = 2.5;
    this.attacks = [
      { id: 'ring', cn: '环形镜棱', w: 24 },
      { id: 'fan', cn: '扇形棱镜', w: 20 },
      { id: 'spiral', cn: '镜旋弹幕', w: 22 },
      { id: 'laser', cn: '镜面激光', w: 20 },
      { id: 'homing', cn: '追光棱', w: 16, min: 2 },
      { id: 'dash', cn: '镜闪突进', w: 18 },
      { id: 'shard', cn: '镜裂地面', w: 20, min: 2 },
      { id: 'summon', cn: '召唤镜影', w: 13 }
    ];
  }

  onPhase(n) {
    this.summon(this.summonPool, n === 2 ? 2 : 3);
    this.specialCd = 1.3;
  }

  onHurt() {
    this.game.particles.burst(this.x, this.y, 4, {
      speed: 170, life: 0.32, size: 3.2,
      colors: ['#ff6bd0', '#7fe4ff', '#ffffff']
    });
    /* 被打碎的镜片四散 */
    for (let i = 0; i < 3; i++) {
      const a = this.rng.range(0, TAU);
      this.game.particles.spawn(
        this.x + Math.cos(a) * 16, this.y + Math.sin(a) * 16,
        Math.cos(a) * 90, Math.sin(a) * 90, rand(0.25, 0.5), rand(2.4, 4.2),
        i % 2 ? '#ff6bd0' : '#7fe4ff', { drag: 2.6 }
      );
    }
  }

  act(dt) {
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;
    this.mirrorRot += dt * (0.8 + 0.35 * this.phase);

    switch (this.state) {
      case 'idle':
        this.hover(dt, 220, 380);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'weaveWind'; this.stateT = 0.8; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;

      case 'ringWind':
        this.brake(0.86);
        this.telegraphText = '环形镜棱';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.ringShot(this.phase >= 3 ? 18 : 14, {
            speed: 250, damage: this.bulletDamage, gap: 3, r: 7, color: '#ff6bd0'
          });
          this.ringLeft--;
          if (this.ringLeft > 0) this.stateT = 0.30;
          else { this.state = 'idle'; this.atkCd = 1.0; }
        }
        break;

      case 'fanWind':
        this.brake(0.85);
        this.telegraphText = '扇形棱镜';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 8 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.fanShot(this.phase >= 3 ? 9 : 7, 1.0, this.face, {
            speed: 330, damage: this.bulletDamage + 1, r: 7, color: '#7fe4ff'
          });
          this.state = 'idle'; this.atkCd = 0.95;
        }
        break;

      case 'spiral':
        this.brake(0.9);
        this.telegraphText = '镜旋弹幕';
        this.stateT -= dt;
        this.spiralLeft -= dt;
        if (this.spiralLeft <= 0) {
          this.spiralLeft = 0.1;
          this.spiralA += 0.42 * this.phaseSpeed;
          this.spiralShot(this.phase >= 2 ? 3 : 2, this.spiralA, {
            speed: 290, damage: this.bulletDamage, r: 6.5, color: '#ff6bd0'
          });
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.05; }
        break;

      case 'laserWind':
        this.brake(0.8);
        this.telegraphText = '镜面激光';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const n = this.phase >= 3 ? 5 : (this.phase >= 2 ? 4 : 3);
          const base = this.aimAngle();
          for (let i = 0; i < n; i++) {
            this.addBeam({
              x: this.x, y: this.y, angle: base + (i / n) * TAU,
              warn: 0.68, active: 0.4, width: 15, dmg: 17, color: '#ff6bd0'
            });
          }
          this.game.addShake(2.2);
          this.state = 'idle'; this.atkCd = 1.1;
        }
        break;

      case 'homingCast':
        this.brake(0.88);
        this.telegraphText = '追光棱';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.homingShot(this.phase >= 3 ? 4 : 3, {
            speed: 215, damage: this.bulletDamage + 2, r: 8, color: '#7fe4ff', homing: 2
          });
          this.state = 'idle'; this.atkCd = 1.0;
        }
        break;

      case 'windup':
        this.brake(0.78);
        this.telegraphText = '镜闪突进';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 6 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.dashDir = this.face;
          this.state = 'dash';
          this.stateT = 0.5;
        }
        break;

      case 'dash': {
        this.stateT -= dt;
        const r = this.dashMove(dt, this.dashDir, 680 * this.phaseSpeed,
          Math.round(this.touchDamage * 1.3), 6);
        if (r === 'wall' || this.stateT <= 0) {
          this.state = 'stagger';
          this.stateT = 0.65;
          this.game.addShake(3);
          this.game.particles.burst(this.x, this.y, 14, {
            speed: 250, life: 0.5, size: 4.5,
            colors: ['#ff6bd0', '#7fe4ff', '#ffffff']
          });
          this.ringShot(8, { speed: 230, damage: this.bulletDamage, gap: 2, r: 6, color: '#ff6bd0' });
        }
        break;
      }

      case 'stagger':
        this.brake(0.85);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 0.95; }
        break;

      case 'shardCast':
        this.brake(0.86);
        this.telegraphText = '镜裂地面';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const p = this.game.player;
          const n = this.phase >= 3 ? 4 : (this.phase >= 2 ? 3 : 2);
          this.addHazard(p.x, p.y, {
            r: 56, warn: 0.85, active: 2.8, dmg: 11, grow: 10, color: '#7fe4ff'
          });
          for (let i = 1; i < n; i++) {
            const a = this.rng.range(0, TAU);
            const d = this.rng.range(100, 200);
            this.addHazard(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, {
              r: 46, warn: 0.9, active: 2.6, dmg: 10, grow: 9, color: '#ff6bd0'
            });
          }
          this.state = 'idle'; this.atkCd = 1.05;
        }
        break;

      case 'summonCast':
        this.brake(0.84);
        this.telegraphText = '召唤镜影';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 3 : 2);
          this.state = 'idle'; this.atkCd = 1.25;
        }
        break;

      case 'weaveWind':
        this.brake(0.8);
        this.telegraphText = '万华绘卷';
        this.stateT -= dt;
        if (Math.random() < dt * 34) {
          const a = this.rng.range(0, TAU);
          this.game.particles.spawn(
            this.x + Math.cos(a) * 40, this.y + Math.sin(a) * 40,
            Math.cos(a) * 40, Math.sin(a) * 40, rand(0.25, 0.55), rand(3, 5.5),
            '#ff6bd0', { drag: 2 }
          );
        }
        if (this.stateT <= 0) { this.state = 'weave'; this.stateT = 1.1; this._weave(); }
        break;

      case 'weave':
        this.brake(0.9);
        this.stateT -= dt;
        this.spiralLeft -= dt;
        if (this.spiralLeft <= 0) {
          this.spiralLeft = 0.11;
          this.spiralA += 0.5;
          this.spiralShot(2, this.spiralA, { speed: 260, damage: this.bulletDamage, r: 6.5, color: '#7fe4ff' });
          this.spiralShot(2, -this.spiralA, { speed: 260, damage: this.bulletDamage, r: 6.5, color: '#ff6bd0' });
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.15; this.specialCd = 8.0; }
        break;

      default: this.state = 'idle'; break;
    }
  }

  _start(id) {
    if (id === 'ring') { this.state = 'ringWind'; this.stateT = 0.5; this.ringLeft = this.phase >= 2 ? 3 : 2; }
    else if (id === 'fan') { this.state = 'fanWind'; this.stateT = 0.5; }
    else if (id === 'spiral') { this.state = 'spiral'; this.stateT = 1.5; this.spiralLeft = 0; }
    else if (id === 'laser') { this.state = 'laserWind'; this.stateT = 0.6; }
    else if (id === 'homing') { this.state = 'homingCast'; this.stateT = 0.5; }
    else if (id === 'dash') { this.state = 'windup'; this.stateT = 0.6; }
    else if (id === 'shard') { this.state = 'shardCast'; this.stateT = 0.55; }
    else { this.state = 'summonCast'; this.stateT = 0.6; }
  }

  /* 特殊技能：六面镜子旋转 + 双向螺旋 + 环形镜棱 + 镜裂 */
  _weave() {
    const mirrors = this.phase >= 3 ? 6 : 4;
    for (let i = 0; i < mirrors; i++) {
      const a = (i / mirrors) * TAU + this.mirrorRot;
      const d = 130;
      this.addHazard(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, {
        r: 44, warn: 0.55, active: 2.4, dmg: 10, grow: 8, color: '#ff6bd0'
      });
    }
    this.ringShot(this.phase >= 2 ? 16 : 12, {
      speed: 240, damage: this.bulletDamage, gap: 3, r: 7, color: '#7fe4ff'
    });
    this.spiralA = this.rng.range(0, TAU);
    this.spiralLeft = 0;
    this.game.addShake(4);
    this.game.particles.ring(this.x, this.y, '#ff6bd0', 28, 300);
  }

  onDeathStart() {
    this.game.particles.ring(this.x, this.y, '#ff6bd0', 32, 290);
  }

  onDeath(dt) {
    /* 万华镜面逐个碎裂 */
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = 0.26;
      const a = this.rng.range(0, TAU);
      this.game.particles.burst(this.x + Math.cos(a) * 28, this.y + Math.sin(a) * 28, 12, {
        speed: 250, life: 0.6, size: 4.5,
        colors: ['#ff6bd0', '#7fe4ff', '#ffffff']
      });
      this.game.particles.ring(this.x, this.y, '#7fe4ff', 12, 190);
      this.game.addShake(2.4);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const winding = this.state === 'windup';
    const weave = this.state === 'weaveWind';

    this.drawAura(ctx, this.r + 16, '#ff6bd0');

    /* 突进预警线 */
    if (winding) {
      const g = 1 - this.stateT / 0.6;
      ctx.save();
      ctx.rotate(this.face);
      ctx.globalAlpha = 0.2 + 0.45 * g;
      ctx.strokeStyle = '#7fe4ff';
      ctx.lineWidth = 3 + 3 * g;
      ctx.setLineDash([14, 11]);
      ctx.lineDashOffset = -t * 70;
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(this.r + 600 * (0.35 + 0.65 * g), 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* 环绕镜片（本体之外，世界坐标旋转） */
    const mN = this.phase + 2;
    for (let i = 0; i < mN; i++) {
      const a = this.mirrorRot + (i / mN) * TAU;
      const d = this.r + 42 + Math.sin(t * 2 + i) * 6;
      ctx.save();
      ctx.translate(Math.cos(a) * d, Math.sin(a) * d);
      ctx.rotate(a + t);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = i % 2 ? '#ff6bd0' : '#7fe4ff';
      polygonPath(ctx, [[0, -11], [8, 0], [0, 11], [-8, 0]]);
      ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    if (this.dying) this.deathTransform(ctx);

    /* 本体：多面棱镜球 */
    const g2 = ctx.createRadialGradient(0, 0, 3, 0, 0, this.r * 1.3);
    g2.addColorStop(0, weave ? '#ffffff' : '#ffd6f2');
    g2.addColorStop(0.45, '#ff6bd0');
    g2.addColorStop(1, 'rgba(42,24,64,0.25)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.08, 0, TAU);
    ctx.fill();

    /* 折射切面 */
    ctx.save();
    ctx.rotate(t * 0.6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.fillStyle = i % 2 ? 'rgba(127,228,255,0.55)' : 'rgba(255,107,208,0.55)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * this.r, Math.sin(a) * this.r);
      ctx.lineTo(Math.cos(a + TAU / 6) * this.r, Math.sin(a + TAU / 6) * this.r);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    /* 中央瞳孔 */
    const pulse = 0.9 + 0.1 * Math.sin(t * 4);
    ctx.fillStyle = '#0d0718';
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 0.42 * pulse, this.r * 0.30 * pulse, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = weave ? '#ffffff' : '#7fe4ff';
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 0.20 * pulse, this.r * 0.26 * pulse, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = '#ffd6f2';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.05, 0, TAU);
    ctx.stroke();

    this.drawCracks(ctx, this.r * 0.95, '#7fe4ff');
    ctx.restore();

    bossHurtRing(ctx, this);
  }
}

/* -----------------------------------------------------------
   无相回声 · Nameless
   主题：拟态与残响。环形回声 / 扇形残响 / 螺旋回声 / 归寂激光 /
        追猎回声 / 无相突进 / 沉默领域 / 召唤回声分身
   特殊技能：万相归一 —— 瞬移到玩家身侧，沿途留下残影，
        每个残影射出一轮十字弹幕，本体落地释放十字激光
   ----------------------------------------------------------- */
class Nameless extends BossBase {
  constructor(game, x, y, rng) {
    super(game, x, y, {
      name: '无相回声',
      title: '它没有脸，因为它戴过所有人的脸',
      r: 33, hp: 660, speed: 112, touchDamage: 14, touchInterval: 0.8, mass: 7,
      rng: rng, colors: ['#0f1420', '#c9d8e8', '#8fa3b5'],
      specialName: '万相归一',
      phaseNames: ['拟形', '裂相', '归一'],
      summonPool: ['phantom', 'wisp', 'chaser'], maxMinions: 6
    });
    this.bulletDamage = 9;
    this.dmgFields = ['bulletDamage'];
    this.specialCd = 8.0;
    this.spiralA = rng.range(0, TAU);
    this.spiralLeft = 0;
    this.dashDir = 0;
    this.echoes = [];               // 残影（表演 + 弹幕源）
    this.deathDur = 2.8;
    this.attacks = [
      { id: 'ring', cn: '环形回声', w: 22 },
      { id: 'fan', cn: '扇形残响', w: 20 },
      { id: 'spiral', cn: '螺旋回声', w: 22 },
      { id: 'laser', cn: '归寂激光', w: 20 },
      { id: 'homing', cn: '追猎回声', w: 18, min: 2 },
      { id: 'dash', cn: '无相突进', w: 20 },
      { id: 'zone', cn: '沉默领域', w: 20, min: 2 },
      { id: 'summon', cn: '召唤回声', w: 14 }
    ];
  }

  onPhase(n) {
    this.summon(this.summonPool, n === 2 ? 2 : 3);
    this.specialCd = 1.2;
  }

  onHurt() {
    /* 受伤时剥落一层「脸」 */
    this.game.particles.burst(this.x, this.y, 5, {
      speed: 150, life: 0.4, size: 3.4,
      colors: ['#c9d8e8', '#8fa3b5', '#ffffff']
    });
    const a = this.rng.range(0, TAU);
    this.echoes.push({ x: this.x + Math.cos(a) * 8, y: this.y + Math.sin(a) * 8, t: 0.5, max: 0.5 });
  }

  act(dt) {
    this.atkCd -= dt * this.atkRate;
    this.specialCd -= dt * this.atkRate;

    /* 残影淡出 */
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      this.echoes[i].t -= dt;
      if (this.echoes[i].t <= 0) this.echoes.splice(i, 1);
    }

    switch (this.state) {
      case 'idle':
        this.hover(dt, 230, 400);
        this.tryTouchDamage(this.touchDamage);
        if (this.specialCd <= 0) { this.state = 'unityWind'; this.stateT = 0.75; }
        else if (this.atkCd <= 0) this._start(this._pick(this.attacks));
        break;

      case 'ringWind':
        this.brake(0.86);
        this.telegraphText = '环形回声';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.ringShot(this.phase >= 3 ? 18 : 14, {
            speed: 255, damage: this.bulletDamage, gap: 3, r: 7, color: '#c9d8e8'
          });
          this.ringLeft--;
          if (this.ringLeft > 0) this.stateT = 0.30;
          else { this.state = 'idle'; this.atkCd = 1.0; }
        }
        break;

      case 'fanWind':
        this.brake(0.85);
        this.telegraphText = '扇形残响';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 8 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.fanShot(this.phase >= 3 ? 9 : 7, 1.05, this.face, {
            speed: 335, damage: this.bulletDamage + 1, r: 7, color: '#8fa3b5'
          });
          this.state = 'idle'; this.atkCd = 0.95;
        }
        break;

      case 'spiral':
        this.brake(0.9);
        this.telegraphText = '螺旋回声';
        this.stateT -= dt;
        this.spiralLeft -= dt;
        if (this.spiralLeft <= 0) {
          this.spiralLeft = 0.1;
          this.spiralA += 0.45 * this.phaseSpeed;
          this.spiralShot(this.phase >= 2 ? 3 : 2, this.spiralA, {
            speed: 295, damage: this.bulletDamage, r: 6.5, color: '#c9d8e8'
          });
        }
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.05; }
        break;

      case 'laserWind':
        this.brake(0.8);
        this.telegraphText = '归寂激光';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const n = this.phase >= 3 ? 6 : (this.phase >= 2 ? 4 : 3);
          const base = this.aimAngle();
          for (let i = 0; i < n; i++) {
            this.addBeam({
              x: this.x, y: this.y, angle: base + (i / n) * TAU,
              warn: 0.7, active: 0.42, width: 16, dmg: 18, color: '#c9d8e8'
            });
          }
          this.game.addShake(2.4);
          this.state = 'idle'; this.atkCd = 1.1;
        }
        break;

      case 'homingCast':
        this.brake(0.88);
        this.telegraphText = '追猎回声';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.homingShot(this.phase >= 3 ? 5 : 3, {
            speed: 220, damage: this.bulletDamage + 2, r: 8, color: '#c9d8e8', homing: 2
          });
          this.state = 'idle'; this.atkCd = 1.0;
        }
        break;

      case 'windup':
        this.brake(0.78);
        this.telegraphText = '无相突进';
        this.face = angleLerp(this.face, this.aimAngle(), Math.min(1, 6 * dt));
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.dashDir = this.face;
          this.state = 'dash';
          this.stateT = 0.55;
        }
        break;

      case 'dash': {
        this.stateT -= dt;
        /* 突进途中拉出残影 */
        if (Math.random() < dt * 24) {
          this.echoes.push({ x: this.x, y: this.y, t: 0.45, max: 0.45 });
        }
        const r = this.dashMove(dt, this.dashDir, 700 * this.phaseSpeed,
          Math.round(this.touchDamage * 1.35), 6);
        if (r === 'wall' || this.stateT <= 0) {
          this.state = 'stagger';
          this.stateT = 0.6;
          this.game.addShake(3.2);
          this.game.particles.burst(this.x, this.y, 16, {
            speed: 260, life: 0.55, size: 5,
            colors: ['#c9d8e8', '#8fa3b5', '#ffffff']
          });
        }
        break;
      }

      case 'stagger':
        this.brake(0.85);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 0.95; }
        break;

      case 'zoneCast':
        this.brake(0.86);
        this.telegraphText = '沉默领域';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const p = this.game.player;
          const n = this.phase >= 3 ? 4 : 3;
          this.addHazard(p.x, p.y, {
            r: 60, warn: 0.9, active: 3.0, dmg: 12, grow: 12, color: '#8fa3b5'
          });
          for (let i = 1; i < n; i++) {
            const a = this.rng.range(0, TAU);
            const d = this.rng.range(110, 210);
            this.addHazard(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, {
              r: 48, warn: 0.95, active: 2.6, dmg: 10, grow: 10, color: '#c9d8e8'
            });
          }
          this.state = 'idle'; this.atkCd = 1.1;
        }
        break;

      case 'summonCast':
        this.brake(0.84);
        this.telegraphText = '召唤回声';
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.summon(this.summonPool, this.phase >= 3 ? 3 : 2);
          this.state = 'idle'; this.atkCd = 1.2;
        }
        break;

      case 'unityWind':
        this.brake(0.8);
        this.telegraphText = '万相归一';
        this.stateT -= dt;
        if (Math.random() < dt * 30) {
          const a = this.rng.range(0, TAU);
          this.echoes.push({
            x: this.x + Math.cos(a) * 30, y: this.y + Math.sin(a) * 30,
            t: 0.6, max: 0.6
          });
        }
        if (this.stateT <= 0) { this.state = 'unity'; this.stateT = 1.0; this._unity(); }
        break;

      case 'unity':
        this.brake(0.9);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.atkCd = 1.2; this.specialCd = 9.0; }
        break;

      default: this.state = 'idle'; break;
    }
  }

  _start(id) {
    if (id === 'ring') { this.state = 'ringWind'; this.stateT = 0.5; this.ringLeft = this.phase >= 2 ? 3 : 2; }
    else if (id === 'fan') { this.state = 'fanWind'; this.stateT = 0.5; }
    else if (id === 'spiral') { this.state = 'spiral'; this.stateT = 1.5; this.spiralLeft = 0; }
    else if (id === 'laser') { this.state = 'laserWind'; this.stateT = 0.6; }
    else if (id === 'homing') { this.state = 'homingCast'; this.stateT = 0.5; }
    else if (id === 'dash') { this.state = 'windup'; this.stateT = 0.6; }
    else if (id === 'zone') { this.state = 'zoneCast'; this.stateT = 0.55; }
    else { this.state = 'summonCast'; this.stateT = 0.6; }
  }

  /* 特殊技能：瞬移到玩家身侧 → 残影十字弹幕 → 本体十字激光 */
  _unity() {
    const p = this.game.player;
    const a = this.rng.range(0, TAU);
    const tx = clamp(p.x + Math.cos(a) * 190, ARENA.x + 110, ARENA.x + ARENA.w - 110);
    const ty = clamp(p.y + Math.sin(a) * 190, ARENA.y + 110, ARENA.y + ARENA.h - 110);

    /* 沿途残影：每个残影射一轮十字弹幕（有预警，可躲） */
    const steps = this.phase >= 3 ? 4 : 3;
    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps;
      const ex = this.x + (tx - this.x) * t;
      const ey = this.y + (ty - this.y) * t;
      this.echoes.push({ x: ex, y: ey, t: 0.7, max: 0.7 });
      this.addHazard(ex, ey, {
        r: 40, warn: 0.6, active: 1.6, dmg: 9, color: '#8fa3b5'
      });
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * TAU + this.rng.range(-0.1, 0.1);
        this.game.spawnProjectile({
          x: ex, y: ey, angle: ang, speed: 240,
          damage: this.bulletDamage, r: 6.5, friendly: false,
          color: '#c9d8e8', core: '#ffffff', life: 3.4, game: this.game, spin: 6
        });
      }
    }

    /* 位移 */
    this.particles_burst(this.x, this.y);
    this.x = tx; this.y = ty;
    this.vx = 0; this.vy = 0;
    this.particles_burst(this.x, this.y);

    /* 本体十字激光 */
    const base = this.aimAngle();
    for (let k = 0; k < 4; k++) {
      this.addBeam({
        x: this.x, y: this.y, angle: base + (k / 4) * TAU,
        warn: 0.66, active: 0.4, width: 15, dmg: 17, color: '#ffffff'
      });
    }
    this.game.addShake(4.5);
    this.game.particles.ring(this.x, this.y, '#c9d8e8', 30, 300);
  }

  particles_burst(x, y) {
    this.game.particles.burst(x, y, 14, {
      speed: 240, life: 0.5, size: 4.5, colors: ['#c9d8e8', '#8fa3b5', '#ffffff']
    });
  }

  onDeathStart() {
    this.game.particles.ring(this.x, this.y, '#c9d8e8', 36, 300);
  }

  onDeath(dt) {
    /* 所有「脸」依次剥落 */
    this.deathBombT -= dt;
    if (this.deathBombT <= 0) {
      this.deathBombT = 0.24;
      const a = this.rng.range(0, TAU);
      const d = this.rng.range(10, 40);
      this.game.particles.burst(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, 10, {
        speed: 220, life: 0.65, size: 4,
        colors: ['#c9d8e8', '#8fa3b5', '#ffffff', '#7fd7ea']
      });
      this.game.addShake(2.2);
    }
  }

  onDraw(ctx) {
    const t = this.animT;
    const winding = this.state === 'windup';
    const unity = this.state === 'unityWind';

    this.drawAura(ctx, this.r + 14, '#8fa3b5');

    if (winding) {
      const g = 1 - this.stateT / 0.6;
      ctx.save();
      ctx.rotate(this.face);
      ctx.globalAlpha = 0.2 + 0.45 * g;
      ctx.strokeStyle = '#c9d8e8';
      ctx.lineWidth = 3 + 3 * g;
      ctx.setLineDash([14, 11]);
      ctx.lineDashOffset = -t * 70;
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(this.r + 620 * (0.35 + 0.65 * g), 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* 残影（世界坐标） */
    for (const e of this.echoes) {
      const k = clamp(e.t / e.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.35 * k;
      ctx.fillStyle = '#c9d8e8';
      ctx.beginPath();
      ctx.arc(e.x - this.x, e.y - this.y, this.r * (0.75 + 0.25 * k), 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    if (this.dying) this.deathTransform(ctx);

    /* 本体：无面的苍白形体 */
    const g2 = ctx.createRadialGradient(0, 0, 3, 0, 0, this.r * 1.35);
    g2.addColorStop(0, unity ? '#ffffff' : '#dfe9f3');
    g2.addColorStop(0.5, '#8fa3b5');
    g2.addColorStop(1, 'rgba(15,20,32,0.3)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.05, 0, TAU);
    ctx.fill();

    /* 不断变形的轮廓（没有固定相貌） */
    ctx.strokeStyle = 'rgba(230,240,250,0.85)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    const pts = 11;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * TAU;
      const rr = this.r * (0.92 + 0.16 * Math.sin(t * 2.2 + i * 1.7) + 0.06 * Math.sin(t * 5 + i));
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    /* 空白的面具 */
    ctx.fillStyle = 'rgba(10,14,22,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, -2, this.r * 0.46, this.r * 0.56, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,235,250,0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    /* 阶段越高，身上浮现越多「别人的脸」 */
    for (let i = 0; i < this.phase; i++) {
      const a = t * 0.9 + (i / 3) * TAU;
      const d = this.r * 0.72;
      ctx.globalAlpha = 0.28 + 0.12 * Math.sin(t * 3 + i);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * d, Math.sin(a) * d, 7, 10, a, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * d - 4, Math.sin(a) * d - 3);
      ctx.lineTo(Math.cos(a) * d - 1, Math.sin(a) * d - 3);
      ctx.moveTo(Math.cos(a) * d + 1, Math.sin(a) * d - 3);
      ctx.lineTo(Math.cos(a) * d + 4, Math.sin(a) * d - 3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    this.drawCracks(ctx, this.r * 0.9, '#ffffff');
    ctx.restore();

    bossHurtRing(ctx, this);
  }
}

/* ---- 注册（cat:'boss' → 不进普通房生成池；locked → 需解锁才入池） ---- */
EnemyFactory.register('boss_kaleido', Kaleidoscope, {
  r: 32, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '万华之瞳', title: '你看见的不是我，是我折射出去的你' }
});
EnemyFactory.register('boss_nameless', Nameless, {
  r: 33, coin: 0, hidden: true, cat: 'boss',
  boss: { name: '无相回声', title: '它没有脸，因为它戴过所有人的脸' }
});

/* 名册补两条记录（minFloor 只作兜底；实际由 chapters.js 的 Boss 池决定） */
BossRoster.list.push({ id: 'boss_kaleido', name: '万华之瞳', minFloor: 4 });
BossRoster.list.push({ id: 'boss_nameless', name: '无相回声', minFloor: 5 });
