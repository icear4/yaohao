/* ===========================================================
   items.js — 原创道具 / 强化（直接作用于玩家属性）
   全部为原创命名，与既有 Player 属性字段一一对应
   =========================================================== */
'use strict';

const UPGRADES = [
  {
    id: 'flame', name: '裂焰核心', desc: '攻击力 +3', color: '#ff9d3c',
    apply: (p) => { p.damage += 3; }
  },
  {
    id: 'quick', name: '速燃齿轮', desc: '攻击间隔 -12%', color: '#ffd35e',
    apply: (p) => { p.fireInterval = Math.max(0.06, p.fireInterval * 0.88); }
  },
  {
    id: 'split', name: '分光棱镜', desc: '子弹数 +1（单发伤害略降）', color: '#7fe4ff',
    apply: (p) => { p.bulletCount += 1; p.damage = Math.max(4, p.damage * 0.88); }
  },
  {
    id: 'swift', name: '疾行灰烬', desc: '移动速度 +24', color: '#7dffb0',
    apply: (p) => { p.moveSpeed += 24; }
  },
  {
    id: 'heart', name: '余烬之心', desc: '最大生命 +20 并回复 20', color: '#ff6b8a',
    apply: (p) => { p.maxHp += 20; p.hp = Math.min(p.maxHp, p.hp + 20); }
  },
  {
    id: 'heavy', name: '重弹铸模', desc: '子弹伤害 +40%、体积 +2', color: '#ff5d5d',
    apply: (p) => { p.damage = Math.round(p.damage * 1.4); p.bulletRadius += 2; }
  },
  {
    id: 'eye', name: '锐眼透镜', desc: '暴击率 +10%', color: '#c08bff',
    apply: (p) => { p.critChance = Math.min(0.6, p.critChance + 0.10); }
  },
  {
    id: 'velocity', name: '流光推进', desc: '子弹速度 +25%', color: '#aef0ff',
    apply: (p) => { p.bulletSpeed *= 1.25; }
  }
];

/* 按种子取强化（不重复优先） */
function pickUpgrade(rng, ownedIds) {
  const pool = UPGRADES.filter(u => {
    if (u.id === 'split' && ownedIds.filter(x => x === 'split').length >= 3) return false;
    return true;
  });
  /* 前两次尽量给输出类，手感更明显 */
  const early = pool.filter(u => u.id === 'flame' || u.id === 'quick' || u.id === 'split');
  const usePool = (ownedIds.length < 2 && early.length) ? early : pool;
  return rng.pick(usePool);
}

/* 玩家属性摘要（HUD 用） */
function playerStatsText(p) {
  return `伤害 ${p.damage.toFixed(0)} · 射速 ${(1 / p.fireInterval).toFixed(1)}/s · 弹数 ${p.bulletCount}`;
}
