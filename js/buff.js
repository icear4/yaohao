/* ===========================================================
   buff.js — 临时增益 / 诅咒（限时或永久）
   数据驱动：新增一个 buff 只需加一条数据对象
   结算并入 Build.recompute()，因此与道具系统完全叠加
   =========================================================== */
'use strict';

/* 常用增益 / 诅咒模板（商店、事件、特殊房共用） */
const BUFF_PRESETS = {
  stim:      { id: 'stim',      name: '战斗兴奋剂', kind: 'buff',  color: '#ff8a5c', dur: 30, stats: { damage: 6, damagePct: 0.25 } },
  haste:     { id: 'haste',     name: '疾行回响',   kind: 'buff',  color: '#7fe4ff', dur: 30, stats: { moveSpeed: 55 } },
  stoneskin: { id: 'stoneskin', name: '石肤',       kind: 'buff',  color: '#c8ff6a', dur: 30, stats: { dr: 22 } },
  fervor:    { id: 'fervor',    name: '狂热',       kind: 'buff',  color: '#ffd35e', dur: 30, stats: { fireRate: 0.45 } },
  bulwark:   { id: 'bulwark',   name: '壁垒',       kind: 'buff',  color: '#7dffb0', dur: 30, stats: { maxHp: 30 } },
  heavy:     { id: 'heavy',     name: '沉重诅咒',   kind: 'curse', color: '#c08bff', dur: 45, stats: { moveSpeed: -70 } },
  brittle:   { id: 'brittle',   name: '易碎诅咒',   kind: 'curse', color: '#c08bff', dur: 45, stats: { dr: -15 } },
  sluggish:  { id: 'sluggish',  name: '迟滞诅咒',   kind: 'curse', color: '#c08bff', dur: 40, stats: { fireRate: -0.30 } },
  frail:     { id: 'frail',     name: '虚弱诅咒',   kind: 'curse', color: '#c08bff', dur: 40, stats: { maxHp: -20 } }
};

class BuffSystem {
  constructor(player) {
    this.player = player;
    this.list = [];        // { id, name, desc, kind, color, stats, mods, dur, t }
  }

  /* def: { id,name,desc,kind,color,stats,mods,dur }   dur<=0 表示永久 */
  add(def) {
    if (!def) return null;
    const dur = def.dur === undefined ? 30 : def.dur;
    const b = {
      id: def.id || ('buff' + this.list.length),
      name: def.name || '回响',
      desc: def.desc || '',
      kind: def.kind || 'buff',
      color: def.color || '#7dffb0',
      stats: def.stats || null,
      mods: def.mods || null,
      dur: dur,
      t: dur
    };
    /* 同名最多叠 3 层，超过则刷新最旧一层的持续时间 */
    const same = this.list.filter(x => x.id === b.id);
    if (same.length >= 3) {
      same[0].t = Math.max(same[0].t, b.t);
    } else {
      this.list.push(b);
    }
    this.refresh();
    return b;
  }

  addPreset(key, durOverride) {
    const p = BUFF_PRESETS[key];
    if (!p) return null;
    const def = Object.assign({}, p);
    if (durOverride !== undefined) def.dur = durOverride;
    return this.add(def);
  }

  has(id) { return this.list.some(b => b.id === id); }

  remove(id) {
    const before = this.list.length;
    this.list = this.list.filter(b => b.id !== id);
    if (this.list.length !== before) this.refresh();
  }

  /* 清掉所有诅咒（商店净化类商品） */
  cleanseCurses() {
    const before = this.list.length;
    this.list = this.list.filter(b => b.kind !== 'curse');
    if (this.list.length !== before) this.refresh();
    return before - this.list.length;
  }

  update(dt) {
    if (!this.list.length) return;
    let expired = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (b.dur <= 0) continue;             // 永久
      b.t -= dt;
      if (b.t <= 0) { this.list.splice(i, 1); expired = true; }
    }
    if (expired) this.refresh();
  }

  /* 汇总成 { stats, mods }，供 Build.recompute() 叠加 */
  aggregate() {
    const st = {}, md = {};
    for (const b of this.list) {
      if (b.stats) for (const k in b.stats) st[k] = (st[k] || 0) + b.stats[k];
      if (b.mods) for (const k in b.mods) md[k] = (md[k] || 0) + b.mods[k];
    }
    return { stats: st, mods: md };
  }

  refresh() {
    if (this.player && this.player.build) this.player.build.recompute();
  }

  clear() { this.list.length = 0; }

  serialize() { return this.list.map(b => b.id + '@' + Math.ceil(b.t)).join(','); }
}
