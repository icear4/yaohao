/* ===========================================================
   spawn.js — 敌人生成编队系统（数据驱动）
   -----------------------------------------------------------
   设计目标：
     1. 不是「把所有敌人随机混在一起」，而是按「编队主题」成组出现
     2. 普通房：弱敌人 + 单一主题
     3. 精英房：强敌人 + 特殊敌人 + 精英词缀（由 Room 施加）
     4. 后期房：多兵种协同（前排 + 远程 + 辅助）
     5. 弹幕安全：限制弹幕型 / 辅助型数量，保证任何组合都有解
   新增敌人不需要改这里 —— 只需要在 enemy_roster.js 里注册时
   填好 cat / cost / minDepth / tags 即可自动进入编队池。
   =========================================================== */
'use strict';

/* -----------------------------------------------------------
   编队主题（数据驱动：新增主题只需加一条）
   ----------------------------------------------------------- */
const SPAWN_THEMES = [
  {
    id: 'rush', cn: '突袭', minDepth: 0, weight: 34,
    melee: 0.80, ranged: 0.20, special: 0.0,
    prefer: ['chaser', 'charger', 'hopper', 'gnasher']
  },
  {
    id: 'gunline', cn: '弹线', minDepth: 0, weight: 22,
    melee: 0.45, ranged: 0.55, special: 0.0,
    prefer: ['shooter', 'marksman', 'wisp', 'fanner']
  },
  {
    id: 'swarm', cn: '虫潮', minDepth: 1, weight: 18,
    melee: 0.85, ranged: 0.15, special: 0.0,
    prefer: ['swarmer', 'slougher', 'chaser', 'gnasher']
  },
  {
    id: 'siege', cn: '围城', minDepth: 2, weight: 16,
    melee: 0.55, ranged: 0.30, special: 0.15,
    prefer: ['brute', 'spiker', 'turret', 'marksman', 'charger']
  },
  {
    id: 'occult', cn: '诡术', minDepth: 2, weight: 16,
    melee: 0.35, ranged: 0.35, special: 0.30,
    prefer: ['phantom', 'blinker', 'bomber', 'ringer', 'wisp']
  },
  {
    id: 'cohort', cn: '战阵', minDepth: 3, weight: 16,
    melee: 0.45, ranged: 0.25, special: 0.30,
    prefer: ['aegis', 'mender', 'curator', 'bogger', 'summoner', 'brute', 'ringer']
  }
];

const SpawnDirector = {
  /* ---------------------------------------------------------
     主入口：返回 { waves: [[type...], ...], theme: '主题名' }
     --------------------------------------------------------- */
  build(opt) {
    opt = opt || {};
    const rng = opt.rng || new Rng(1);
    const depth = opt.depth || 0;
    const isElite = !!opt.isElite;
    const type = opt.type;

    /* Boss 房：守望者 + 深层护卫 */
    if (type === ROOM_TYPE.BOSS) {
      const guard = depth >= 3 ? ['charger', 'shooter'] : (depth >= 1 ? ['shooter'] : []);
      return { waves: [['boss'].concat(guard)], theme: '守望者' };
    }

    /* 1. 选主题 */
    const pool = SPAWN_THEMES.filter(t => depth >= t.minDepth);
    const theme = this._weighted(rng, pool.length ? pool : [SPAWN_THEMES[0]]);

    /* 2. 预算（精英与后期房间显著更高） */
    let budget = isElite ? 16 + depth * 3.4 : 9 + depth * 2.9;
    budget = Math.min(budget, isElite ? 50 : 34);

    const maxCount = isElite ? 10 : (depth >= 3 ? 9 : (depth >= 1 ? 7 : 6));

    /* 3. 分类池（过滤：未隐藏 + 达深度 + 未被禁用） */
    const reg = EnemyFactory.registry;
    const has = (d, tag) => d.tags && d.tags.indexOf(tag) >= 0;
    const usable = k => {
      const d = reg[k].def;
      return !d.hidden && !!d.cat && d.cat !== 'boss' && (d.minDepth || 0) <= depth;
    };
    const byCat = cat => Object.keys(reg).filter(k => usable(k) && reg[k].def.cat === cat);

    const meleePool = byCat('melee');
    const rangedPool = byCat('ranged');
    const specialPool = byCat('special');
    if (!meleePool.length) return { waves: [['chaser']], theme: theme.cn };

    /* 主题偏好优先，池子为空时退回全池 */
    const bias = list => {
      const p = list.filter(k => theme.prefer.indexOf(k) >= 0);
      return p.length ? p : list;
    };

    const chosen = [];
    const spend = id => { chosen.push(id); budget -= (reg[id].def.cost || 3); };
    const countOf = pred => chosen.filter(pred).length;

    /* 4. 辅助位（全场最多 1 个，且深层/精英房才出现） */
    const supportPool = bias(specialPool.filter(k => has(reg[k].def, 'support')));
    let wantSupport = isElite || depth >= 3 || (depth >= 2 && theme.id === 'cohort');
    if (wantSupport && supportPool.length) spend(rng.pick(supportPool));

    /* 5. 弹幕位（数量受严格上限，避免无法躲避的弹幕墙） */
    const bulletPool = bias(rangedPool.filter(k => has(reg[k].def, 'bullethell')));
    let bulletCap = depth >= 4 ? 2 : (depth >= 1 ? 1 : 0);
    if (isElite) bulletCap = Math.min(2, bulletCap + 1);
    for (let i = 0; i < bulletCap && bulletPool.length; i++) {
      const id = rng.pick(bulletPool);
      if ((reg[id].def.cost || 3) > budget) break;
      spend(id);
    }

    /* 6. 按主题比例填充剩余名额 */
    let guard = 0;
    while (budget > 0 && chosen.length < maxCount && guard++ < 60) {
      const roll = rng.next();
      let list;
      if (roll < theme.melee) list = bias(meleePool);
      else if (roll < theme.melee + theme.ranged) list = bias(rangedPool);
      else list = bias(specialPool.filter(k => !has(reg[k].def, 'support')));
      if (!list.length) list = bias(meleePool);

      /* 预算不够时，改用最便宜的可选项 */
      let id = rng.pick(list);
      if ((reg[id].def.cost || 3) > budget) {
        const cheap = list.slice().sort((a, b) => (reg[a].def.cost || 3) - (reg[b].def.cost || 3));
        if ((cheap[0] !== undefined) && (reg[cheap[0]].def.cost || 3) <= budget) id = cheap[0];
        else break;
      }

      /* 安全限制：同类成群的上限（弹幕型数量直接决定能否躲开） */
      const d = reg[id].def;
      if (has(d, 'swarm') && countOf(k => has(reg[k].def, 'swarm')) >= 6) continue;
      if (has(d, 'bullethell') &&
          (bulletCap <= 0 || countOf(k => has(reg[k].def, 'bullethell')) >= bulletCap)) continue;
      if (has(d, 'support') && countOf(k => has(reg[k].def, 'support')) >= 1) continue;

      spend(id);

      /* 群体型一次多带两只（它们是「成群」的意义所在） */
      if (has(d, 'swarm') && chosen.length < maxCount && budget > 0) {
        if (rng.chance(0.75)) spend(id);
      }
    }

    /* 7. 保底规则 */
    if (!chosen.length) chosen.push('chaser');
    /* 有辅助就必须有前排保护，否则辅助会孤立被秒（也让房间更耐打） */
    const supportN = countOf(k => has(reg[k].def, 'support'));
    const meleeN = countOf(k => reg[k].def.cat === 'melee');
    if (supportN > 0 && meleeN < 2) {
      const m = bias(meleePool);
      for (let i = meleeN; i < 2; i++) chosen.push(rng.pick(m));
    }
    if (chosen.length < 3) {
      const m = bias(meleePool);
      while (chosen.length < 3) chosen.push(rng.pick(m));
    }

    /* 8. 分波：先出前排与辅助，远程压后 */
    const order = { special: [], melee: [], ranged: [] };
    for (const id of chosen) {
      const cat = reg[id].def.cat;
      (order[cat] || order.melee).push(id);
    }
    const all = order.special.concat(order.melee, order.ranged);

    let waves;
    if (all.length <= 5 || isElite) {
      waves = [all];
    } else {
      const cut = Math.ceil(all.length * 0.55);
      waves = [all.slice(0, cut), all.slice(cut)];
      if (!waves[1].length) waves = [all];
    }

    return { waves: waves, theme: theme.cn };
  },

  _weighted(rng, list) {
    let sum = 0;
    for (const t of list) sum += (t.weight || 1);
    let r = rng.next() * sum;
    for (const t of list) {
      r -= (t.weight || 1);
      if (r <= 0) return t;
    }
    return list[list.length - 1];
  }
};
