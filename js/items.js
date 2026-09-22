/* ===========================================================
   items.js — 数据驱动的道具 / Build 系统
   ------------------------------------------------------------
   新增道具只需往 ITEMS 里加一个数据对象：
     {
       id, name, cat, color, max,
       desc,            // 鼠标悬停时显示的说明
       stats: { ... },  // 基础属性增量（可选）
       flags: { ... }   // 特殊机制层数（可选）
     }
   新增组合只需往 COMBOS 里加一条：
     { id, name, desc, need:{flag:层数}, grant:{flag:层数} }
   核心战斗代码不需要改动。
   =========================================================== */
'use strict';

/* ---------------- 分类 ---------------- */
const ITEM_CAT = {
  attack: { cn: '攻击', color: '#ff8a5c', glyph: '⚔' },
  defense: { cn: '防御', color: '#7dffb0', glyph: '❖' },
  move: { cn: '移动', color: '#7fe4ff', glyph: '»' },
  proj: { cn: '投射物', color: '#aef0ff', glyph: '◆' },
  special: { cn: '特殊机制', color: '#c08bff', glyph: '✦' }
};

/* ---------------- 特殊机制（层数，可叠加） ---------------- */
const MOD_KEYS = [
  'pierce', 'split', 'bounce', 'homing', 'explode', 'orbit',
  'lifesteal', 'poison', 'burn', 'freeze', 'slow', 'knockback',
  'chain', 'thorns', 'trailFire', 'killBlast'
];

/* 机制中文名（UI 提示用） */
const MOD_CN = {
  pierce: '穿透', split: '分裂', bounce: '反弹', homing: '追踪',
  explode: '爆炸', orbit: '回旋', lifesteal: '吸血', poison: '中毒',
  burn: '燃烧', freeze: '冰冻', slow: '减速', knockback: '击退',
  chain: '链式', thorns: '荆棘', trailFire: '烬迹', killBlast: '击杀爆'
};

function defaultMods() {
  const m = {
    pierce: 0, split: 0, bounce: 0, homing: 0, explode: 0, orbit: 0,
    lifesteal: 0, poison: 0, burn: 0, freeze: 0, slow: 0, knockback: 0,
    chain: 0, thorns: 0, trailFire: 0, killBlast: 0
  };
  /* 组合专属标记（由 COMBOS 授予，供战斗代码读取） */
  const combo = [
    'pierceSplit', 'homingExplode', 'freezeExplode', 'poisonSplit',
    'burnPierce', 'bounceHoming', 'bounceExplode', 'chainPoison',
    'chainBurn', 'slowKnock', 'critVamp', 'orbitPierce', 'orbitExplode',
    'freezePierce', 'slowExplode', 'dotVamp', 'knockBounce', 'splitHoming',
    'burnExplode', 'chainExplode', 'frostField', 'endlessRefract'
  ];
  for (const k of combo) m[k] = 0;
  return m;
}

/* ===========================================================
   道具表（38 件，全部原创）
   =========================================================== */
const ITEMS = [
  /* ---------------- 攻击 ---------------- */
  {
    id: 'ember_core', name: '裂焰核心', cat: 'attack', color: '#ff9d3c', max: 6,
    desc: '攻击力 +3，命中附加 1 层灼烧（持续掉血）。',
    stats: { damage: 3 }, flags: { burn: 1 }
  },
  {
    id: 'ember_lance', name: '焰锥长钉', cat: 'attack', color: '#ffb347', max: 4,
    desc: '攻击力 +18%，暴击伤害 +30%。',
    stats: { damagePct: 0.18, critDamage: 0.3 }
  },
  {
    id: 'rift_edge', name: '裂隙锋刃', cat: 'attack', color: '#ffe08a', max: 4,
    desc: '暴击率 +12%，暴击伤害 +25%。',
    stats: { critChance: 0.12, critDamage: 0.25 }
  },
  {
    id: 'echo_hammer', name: '回响重锤', cat: 'attack', color: '#ff6b5c', max: 3,
    desc: '攻击力 +40%，但攻击间隔 +18%（更慢更重）。',
    stats: { damagePct: 0.40, fireRate: -0.18 }
  },
  {
    id: 'overheat_coil', name: '过载线圈', cat: 'attack', color: '#ffd35e', max: 4,
    desc: '攻击速度 +20%，攻击力 +1。',
    stats: { fireRate: 0.20, damage: 1 }
  },
  {
    id: 'cinder_twin', name: '双生烬芯', cat: 'attack', color: '#ff7a7a', max: 3,
    desc: '子弹数量 +1，单发攻击力 -10%。',
    stats: { bulletCount: 1, damagePct: -0.10 }
  },
  {
    id: 'brand_iron', name: '烙印铁', cat: 'attack', color: '#ff5d3c', max: 4,
    desc: '灼烧层数 +2，攻击力 +1。灼烧可被穿透与分裂继承。',
    stats: { damage: 1 }, flags: { burn: 2 }
  },
  {
    id: 'judgement_prism', name: '断罪棱镜', cat: 'attack', color: '#ff4d6b', max: 3,
    desc: '暴击伤害 +60%，暴击率 +5%。',
    stats: { critDamage: 0.6, critChance: 0.05 }
  },

  /* ---------------- 防御 ---------------- */
  {
    id: 'ember_heart', name: '余烬之心', cat: 'defense', color: '#ff6b8a', max: 6,
    desc: '最大生命 +22，并立即回复等量生命。',
    stats: { maxHp: 22 }
  },
  {
    id: 'ash_plate', name: '灰鳞护板', cat: 'defense', color: '#8fa3b5', max: 4,
    desc: '最大生命 +32，移动速度 -12（笨重但耐打）。',
    stats: { maxHp: 32, moveSpeed: -12 }
  },
  {
    id: 'ember_bulwark', name: '烬墙壁垒', cat: 'defense', color: '#7dffb0', max: 3,
    desc: '最大生命 +46，攻击速度 -10%。',
    stats: { maxHp: 46, fireRate: -0.10 }
  },
  {
    id: 'ember_thorn', name: '烬刺外皮', cat: 'defense', color: '#c8ff6a', max: 4,
    desc: '被近身接触时，对敌人反弹 10 点伤害（每层）。',
    flags: { thorns: 1 }
  },
  {
    id: 'mend_cinder', name: '愈合烬屑', cat: 'defense', color: '#9ad14f', max: 4,
    desc: '每秒回复 0.7 点生命（每层）。',
    stats: { regen: 0.7 }
  },
  {
    id: 'warden_shell', name: '守望残壳', cat: 'defense', color: '#7fd7ea', max: 3,
    desc: '最大生命 +18，每次受伤减免 2 点伤害。',
    stats: { maxHp: 18, dr: 2 }
  },
  {
    id: 'pulse_ward', name: '脉动护符', cat: 'defense', color: '#aef0ff', max: 3,
    desc: '最大生命 +14，受伤后的无敌时间 +0.22 秒。',
    stats: { maxHp: 14, invuln: 0.22 }
  },

  /* ---------------- 移动 ---------------- */
  {
    id: 'swift_ash', name: '疾行灰烬', cat: 'move', color: '#7dffb0', max: 5,
    desc: '移动速度 +26。',
    stats: { moveSpeed: 26 }
  },
  {
    id: 'phase_step', name: '相位步履', cat: 'move', color: '#7fe4ff', max: 3,
    desc: '移动速度 +12%，攻击速度 +6%。',
    stats: { moveSpeedPct: 0.12, fireRate: 0.06 }
  },
  {
    id: 'drift_cloak', name: '流影斗篷', cat: 'move', color: '#8fd8ff', max: 3,
    desc: '移动速度 +16，暴击率 +6%。',
    stats: { moveSpeed: 16, critChance: 0.06 }
  },
  {
    id: 'dash_spark', name: '闪燃推进', cat: 'move', color: '#ffd35e', max: 2,
    desc: '移动速度 +42，最大生命 -8（燃料在烧你的血）。',
    stats: { moveSpeed: 42, maxHp: -8 }
  },
  {
    id: 'gravity_anchor', name: '重力锚', cat: 'move', color: '#c08bff', max: 3,
    desc: '移动速度 -20，攻击力 +26%，击退 +1 层（站桩炮台流）。',
    stats: { moveSpeed: -20, damagePct: 0.26 }, flags: { knockback: 1 }
  },
  {
    id: 'trail_fire', name: '烬迹', cat: 'move', color: '#ff8a5c', max: 3,
    desc: '移动速度 +12，身周持续燃起烬火灼烧靠近的敌人。',
    stats: { moveSpeed: 12 }, flags: { trailFire: 1 }
  },

  /* ---------------- 投射物 ---------------- */
  {
    id: 'prism_split', name: '分光棱镜', cat: 'proj', color: '#7fe4ff', max: 3,
    desc: '子弹命中后分裂出 2 枚碎片（每层 +2 枚）。',
    flags: { split: 2 }
  },
  {
    id: 'pierce_rod', name: '贯钉', cat: 'proj', color: '#aef0ff', max: 4,
    desc: '子弹可多穿透 1 个敌人（每层）。',
    flags: { pierce: 1 }
  },
  {
    id: 'ricochet_ring', name: '折跃环', cat: 'proj', color: '#5aa9ff', max: 4,
    desc: '子弹撞墙后反弹 1 次（每层）。',
    flags: { bounce: 1 }
  },
  {
    id: 'seeker_eye', name: '寻迹棱目', cat: 'proj', color: '#7fd7ea', max: 3,
    desc: '子弹自动追踪最近的敌人（层数越高转向越急）。',
    flags: { homing: 1 }
  },
  {
    id: 'heavy_mold', name: '重弹铸模', cat: 'proj', color: '#ff5d5d', max: 3,
    desc: '子弹体积 +2、攻击力 +20%，子弹速度 -12%。',
    stats: { bulletRadius: 2, damagePct: 0.20, bulletSpeedPct: -0.12 }
  },
  {
    id: 'long_barrel', name: '长焰枪膛', cat: 'proj', color: '#ffd35e', max: 3,
    desc: '射程 +280，子弹速度 +12%。',
    stats: { range: 280, bulletSpeedPct: 0.12 }
  },
  {
    id: 'storm_seed', name: '风暴之种', cat: 'proj', color: '#c8ff6a', max: 2,
    desc: '子弹数量 +1、攻击速度 +10%，子弹体积 -1。',
    stats: { bulletCount: 1, fireRate: 0.10, bulletRadius: -1 }
  },
  {
    id: 'boomerang_core', name: '回旋核', cat: 'proj', color: '#c08bff', max: 2,
    desc: '子弹沿弧线回旋飞行，并可重复命中同一敌人。',
    flags: { orbit: 1 }
  },

  /* ---------------- 特殊机制 ---------------- */
  {
    id: 'venom_vial', name: '腐雾瓶', cat: 'special', color: '#9ad14f', max: 4,
    desc: '命中附加 2 层中毒（可叠加，持续掉血）。',
    flags: { poison: 2 }
  },
  {
    id: 'frost_shard', name: '霜棱', cat: 'special', color: '#8fd8ff', max: 3,
    desc: '命中有 18% 几率冻结敌人 0.9 秒（每层叠加几率与时长）。',
    flags: { freeze: 1 }
  },
  {
    id: 'mire_chain', name: '滞沼锁链', cat: 'special', color: '#5aa9ff', max: 4,
    desc: '命中使敌人减速 15%（每层），可叠加至 60%。',
    flags: { slow: 1 }
  },
  {
    id: 'shove_charge', name: '推流装药', cat: 'special', color: '#ffb347', max: 3,
    desc: '命中把敌人狠狠击退（层数越高推得越远）。',
    flags: { knockback: 1 }
  },
  {
    id: 'arc_link', name: '弧光链接', cat: 'special', color: '#7fe4ff', max: 3,
    desc: '命中后电弧跳跃到 1 个附近敌人（每层 +1 个）。',
    flags: { chain: 1 }
  },
  {
    id: 'vampiric_fang', name: '噬血獠牙', cat: 'special', color: '#ff4d6b', max: 4,
    desc: '造成伤害的 8% 转化为生命（每层）。',
    flags: { lifesteal: 1 }
  },
  {
    id: 'martyr_sigil', name: '殉爆符', cat: 'special', color: '#ff8a5c', max: 3,
    desc: '子弹命中或寿命结束时引爆，造成范围伤害。',
    flags: { explode: 1 }
  },
  {
    id: 'echo_resonance', name: '余烬回响', cat: 'special', color: '#ffd35e', max: 3,
    desc: '击杀敌人时在其位置引发一次小爆炸。',
    flags: { killBlast: 1 }
  },
  {
    id: 'crystal_resonance', name: '棱晶共鸣', cat: 'special', color: '#c08bff', max: 2,
    desc: '穿透 +1 层，链式跳跃 +1 次。',
    flags: { pierce: 1, chain: 1 }
  }
];

const ITEM_BY_ID = {};
for (const it of ITEMS) ITEM_BY_ID[it.id] = it;

/* ===========================================================
   组合效果（22 个）—— 满足条件即自动生效
   need：需要的机制层数；needStat：需要的最终属性阈值
   grant：授予的组合标记；grantStat：追加属性
   =========================================================== */
const COMBOS = [
  {
    id: 'pierce_split', name: '贯穿分裂', color: '#aef0ff',
    need: { pierce: 1, split: 1 }, grant: { pierceSplit: 1 },
    desc: '穿透后继续分裂：子弹每穿过一个敌人，都会再甩出一枚碎片。'
  },
  {
    id: 'homing_explode', name: '追猎爆轰', color: '#ff8a5c',
    need: { homing: 1, explode: 1 }, grant: { homingExplode: 1 },
    desc: '追踪投射物命中后必定引爆，且爆炸半径 +35%。'
  },
  {
    id: 'freeze_explode', name: '冰霜爆裂', color: '#8fd8ff',
    need: { freeze: 1, explode: 1 }, grant: { freezeExplode: 1 },
    desc: '被冻结的敌人死亡时炸出冰霜冲击，并冻结周围敌人。'
  },
  {
    id: 'poison_split', name: '毒染裂片', color: '#9ad14f',
    need: { poison: 1, split: 1 }, grant: { poisonSplit: 1 },
    desc: '分裂碎片完整继承毒素层数。'
  },
  {
    id: 'burn_pierce', name: '灼痕贯穿', color: '#ff5d3c',
    need: { burn: 1, pierce: 1 }, grant: { burnPierce: 1 },
    desc: '穿透时每穿过一个敌人，灼烧层数 +1。'
  },
  {
    id: 'bounce_homing', name: '回响制导', color: '#7fd7ea',
    need: { bounce: 1, homing: 1 }, grant: { bounceHoming: 1 },
    desc: '子弹每次撞墙反弹后都会重新锁定一个新目标。'
  },
  {
    id: 'bounce_explode', name: '弹壁雷暴', color: '#ffd35e',
    need: { bounce: 1, explode: 1 }, grant: { bounceExplode: 1 },
    desc: '子弹每次撞墙都会炸开一次。'
  },
  {
    id: 'chain_poison', name: '疫链', color: '#c8ff6a',
    need: { chain: 1, poison: 1 }, grant: { chainPoison: 1 },
    desc: '电弧跳跃时把毒素一起传导过去。'
  },
  {
    id: 'chain_burn', name: '燃链', color: '#ff9d3c',
    need: { chain: 1, burn: 1 }, grant: { chainBurn: 1 },
    desc: '电弧跳跃时点燃沿途的所有敌人。'
  },
  {
    id: 'slow_knock', name: '滞重推流', color: '#5aa9ff',
    need: { slow: 1, knockback: 1 }, grant: { slowKnock: 1 },
    desc: '被减速的敌人受到的击退距离翻倍。'
  },
  {
    id: 'crit_vamp', name: '嗜血锋刃', color: '#ff4d6b',
    need: { lifesteal: 1 }, needStat: { critChance: 0.25 }, grant: { critVamp: 1 },
    desc: '暴击时的吸血效果提升至 3 倍。'
  },
  {
    id: 'orbit_pierce', name: '回旋利刃', color: '#c08bff',
    need: { orbit: 1, pierce: 1 }, grant: { orbitPierce: 1 },
    desc: '回旋子弹的重复命中间隔缩短一半，且穿透不消耗层数。'
  },
  {
    id: 'orbit_explode', name: '回旋爆核', color: '#ff8a5c',
    need: { orbit: 1, explode: 1 }, grant: { orbitExplode: 1 },
    desc: '回旋子弹每次命中都会在原地留下一颗延时爆核。'
  },
  {
    id: 'freeze_pierce', name: '霜锥贯穿', color: '#aef0ff',
    need: { freeze: 1, pierce: 1 }, grant: { freezePierce: 1 },
    desc: '穿透命中必定冻结，冻结时长 +50%。'
  },
  {
    id: 'slow_explode', name: '泥沼爆', color: '#7fd7ea',
    need: { slow: 1, explode: 1 }, grant: { slowExplode: 1 },
    desc: '爆炸会在原地留下减速泥沼，持续 2.5 秒。'
  },
  {
    id: 'dot_vamp', name: '腐化生机', color: '#9ad14f',
    need: { lifesteal: 1, poison: 1 }, grant: { dotVamp: 1 },
    desc: '中毒与灼烧造成的持续伤害也会为你回血。'
  },
  {
    id: 'knock_bounce', name: '撞壁回弹', color: '#ffb347',
    need: { knockback: 1, bounce: 1 }, grant: { knockBounce: 1 },
    desc: '被击退的敌人撞到墙壁会反弹并受到额外伤害。'
  },
  {
    id: 'split_homing', name: '分导裂片', color: '#7fe4ff',
    need: { split: 1, homing: 1 }, grant: { splitHoming: 1 },
    desc: '分裂出的碎片会各自追踪不同的敌人。'
  },
  {
    id: 'burn_explode', name: '焚爆', color: '#ff6b5c',
    need: { burn: 1, explode: 1 }, grant: { burnExplode: 1 },
    desc: '爆炸会引爆目标身上的灼烧，立即结算剩余伤害。'
  },
  {
    id: 'chain_explode', name: '连环轰爆', color: '#ffd35e',
    need: { chain: 1, explode: 1 }, grant: { chainExplode: 1 },
    desc: '电弧命中的目标也会被引爆。'
  },
  {
    id: 'frost_field', name: '极寒领域', color: '#8fd8ff',
    need: { freeze: 1, slow: 1 }, grant: { frostField: 1 },
    desc: '被冻结或减速的敌人会持续向外散发寒气，减速附近的同伴。'
  },
  {
    id: 'endless_refract', name: '无尽折射', color: '#5aa9ff',
    need: { pierce: 1, bounce: 1 }, grant: { endlessRefract: 1 },
    desc: '子弹穿透敌人后反弹次数 +1，几乎不会停下的折射弹。'
  }
];

/* ===========================================================
   Build —— 玩家当前持有的道具与最终属性
   =========================================================== */
class Build {
  constructor(player) {
    this.player = player;
    this.slots = [];           // [{ id, n }]
    this.mods = defaultMods();
    this.final = {};
    this.comboList = [];
  }

  add(id) {
    const it = ITEM_BY_ID[id];
    if (!it) return null;
    if (this.count(id) >= (it.max || 99)) return null;   // 达到堆叠上限
    const slot = this.slots.find(s => s.id === id);
    if (slot) slot.n++;
    else this.slots.push({ id: id, n: 1 });
    this.recompute();
    return it;
  }

  count(id) {
    const s = this.slots.find(x => x.id === id);
    return s ? s.n : 0;
  }

  has(id) { return this.count(id) > 0; }

  get length() { return this.slots.reduce((a, s) => a + s.n, 0); }

  /* 叠加计算：属性 → 机制 → 组合 → 写回玩家 */
  recompute() {
    if (!this.player) return;
    const p = this.player;
    const b = p.base;

    /* 1. 累加属性与机制 */
    const st = {
      maxHp: 0, damage: 0, damagePct: 0, fireRate: 0,
      moveSpeed: 0, moveSpeedPct: 0, bulletSpeedPct: 0,
      bulletRadius: 0, bulletCount: 0, range: 0,
      critChance: 0, critDamage: 0, dr: 0, invuln: 0, regen: 0
    };
    const md = defaultMods();
    for (const slot of this.slots) {
      const it = ITEM_BY_ID[slot.id];
      if (!it) continue;
      const n = Math.min(slot.n, it.max || 99);
      if (it.stats) for (const k in it.stats) st[k] = (st[k] || 0) + it.stats[k] * n;
      if (it.flags) for (const k in it.flags) md[k] = (md[k] || 0) + it.flags[k] * n;
    }

    /* 1b. 临时增益 / 诅咒（与道具完全叠加，来源见 buff.js） */
    if (p.buffs) {
      const bf = p.buffs.aggregate();
      for (const k in bf.stats) st[k] = (st[k] || 0) + bf.stats[k];
      for (const k in bf.mods) md[k] = (md[k] || 0) + bf.mods[k];
    }

    /* 2. 最终属性（供组合条件判断） */
    const fin = {
      maxHp: Math.max(20, b.maxHp + st.maxHp),
      damage: Math.max(1, (b.damage + st.damage) * (1 + st.damagePct)),
      fireInterval: Math.max(0.05, b.fireInterval / (1 + Math.max(-0.7, st.fireRate))),
      moveSpeed: Math.max(90, (b.moveSpeed + st.moveSpeed) * (1 + st.moveSpeedPct)),
      bulletSpeed: Math.max(120, b.bulletSpeed * (1 + st.bulletSpeedPct)),
      bulletRadius: Math.max(2, b.bulletRadius + st.bulletRadius),
      bulletCount: Math.max(1, Math.round(b.bulletCount + st.bulletCount)),
      range: Math.max(200, b.range + st.range),
      critChance: clamp(b.critChance + st.critChance, 0, 0.9),
      critDamage: Math.max(1, b.critDamage + st.critDamage),
      dr: Math.max(0, st.dr),
      invuln: Math.max(0, st.invuln),
      regen: Math.max(0, st.regen)
    };

    /* 3. 组合判定 */
    this.comboList = [];
    for (const c of COMBOS) {
      let ok = true;
      if (c.need) for (const k in c.need) if ((md[k] || 0) < c.need[k]) { ok = false; break; }
      if (ok && c.needStat) {
        for (const k in c.needStat) if ((fin[k] || 0) < c.needStat[k]) { ok = false; break; }
      }
      if (!ok) continue;
      this.comboList.push(c);
      if (c.grant) for (const k in c.grant) md[k] = (md[k] || 0) + c.grant[k];
      if (c.grantStat) for (const k in c.grantStat) st[k] = (st[k] || 0) + c.grantStat[k];
    }

    /* 4. 写回玩家（保持既有字段语义不变） */
    const prevMax = p.maxHp;
    p.maxHp = Math.round(fin.maxHp);
    if (p.maxHp > prevMax) p.hp += (p.maxHp - prevMax);
    p.hp = Math.min(p.hp, p.maxHp);

    p.damage = fin.damage;
    p.fireInterval = fin.fireInterval;
    p.moveSpeed = fin.moveSpeed;
    p.bulletSpeed = fin.bulletSpeed;
    p.bulletRadius = fin.bulletRadius;
    p.bulletCount = fin.bulletCount;
    p.critChance = fin.critChance;
    p.critDamage = fin.critDamage;
    p.range = fin.range;
    p.armor = fin.dr;
    p.invulnTime = b.invulnTime + fin.invuln;
    p.regen = fin.regen;

    this.mods = md;
    p.mods = md;
    this.final = fin;
    return fin;
  }

  /* 供投射物使用的效果快照 */
  shotEffects() { return Object.assign({}, this.mods); }

  /* 该道具参与的所有组合（UI 悬停用） */
  combosOf(id) {
    const it = ITEM_BY_ID[id];
    if (!it) return [];
    const keys = Object.keys(it.flags || {});
    const out = [];
    for (const c of COMBOS) {
      if (!c.need) continue;
      for (const k in c.need) if (keys.indexOf(k) >= 0) { out.push(c); break; }
    }
    return out;
  }

  serialize() {
    return this.slots.map(s => s.id + 'x' + s.n).join(',') + '|' +
      this.comboList.map(c => c.id).join(',');
  }
}

/* ===========================================================
   抽取：按种子随机，尊重堆叠上限，尽量给没拿过的
   =========================================================== */
function pickItem(rng, build, opt) {
  opt = opt || {};
  const owned = build || { count: () => 0 };
  let pool = ITEMS.filter(it => opt.always !== it.id ? true : true);
  pool = pool.filter(it => owned.count(it.id) < (it.max || 99));
  if (!pool.length) pool = ITEMS.slice();

  /* 前两件优先给「立刻有感」的输出/机制件 */
  if (opt.early && pool.length > 3) {
    const hot = pool.filter(it => it.cat === 'attack' || it.cat === 'proj' || it.cat === 'special');
    if (hot.length) pool = hot;
  }
  /* 三成几率偏向玩家已经投入的方向，帮助成型 */
  if (opt.synergy && rng.chance(0.35)) {
    const cats = {};
    for (const s of (build ? build.slots : [])) {
      const it = ITEM_BY_ID[s.id];
      if (it) cats[it.cat] = (cats[it.cat] || 0) + s.n;
    }
    let best = null, bestN = 0;
    for (const k in cats) if (cats[k] > bestN) { bestN = cats[k]; best = k; }
    if (best) {
      const same = pool.filter(it => it.cat === best);
      if (same.length) pool = same;
    }
  }
  return rng.pick(pool);
}

/* Boss 奖励：随机一件强力道具
   —— 强力 = 稀有度高（max 小）+ 带机制（flags），且不与已堆满的重复 */
function pickStrongItem(rng, build) {
  const owned = build || { count: () => 0 };
  const avail = it => owned.count(it.id) < (it.max || 99);
  let pool = ITEMS.filter(it => avail(it) &&
    (it.cat === 'attack' || it.cat === 'proj' || it.cat === 'special'));
  if (pool.length > 2) {
    const rare = pool.filter(it => (it.max || 99) <= 3);
    if (rare.length) pool = rare;
  }
  if (!pool.length) pool = ITEMS.filter(avail);
  if (!pool.length) pool = ITEMS.slice();
  /* 偏向玩家已有方向，帮助成型（但仍受强力池限制） */
  if (rng.chance(0.4) && build && build.slots) {
    const cats = {};
    for (const s of build.slots) {
      const it = ITEM_BY_ID[s.id];
      if (it) cats[it.cat] = (cats[it.cat] || 0) + s.n;
    }
    let best = null, bestN = 0;
    for (const k in cats) if (cats[k] > bestN) { bestN = cats[k]; best = k; }
    if (best) {
      const same = pool.filter(it => it.cat === best);
      if (same.length) pool = same;
    }
  }
  return rng.pick(pool);
}

/* HUD 属性摘要 */
function playerStatsText(p) {
  return `伤害 ${p.damage.toFixed(0)} · 射速 ${(1 / p.fireInterval).toFixed(1)}/s · 弹数 ${p.bulletCount}` +
    ` · 暴击 ${Math.round(p.critChance * 100)}%`;
}
