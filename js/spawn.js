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
    const ch = opt.chapter || ChapterOf(depth + 1);
    const poolCfg = ch.pool || {};

    /* Boss 房：每一层有自己的 Boss 池（第 1 层固定回廊守望者） */
    if (type === ROOM_TYPE.BOSS) {
      const bossId = BossRoster.pick(depth + 1, rng.fork('boss'));
      const guard = (ch.guard || []).slice();
      return { waves: [[bossId].concat(guard)], theme: BossRoster.nameOf(bossId) };
    }

    /* 1. 选主题（章节限定的主题集合，保证每层战斗风格不同） */
    let pool = SPAWN_THEMES.filter(t => depth >= t.minDepth);
    if (poolCfg.themes && poolCfg.themes.length) {
      const byChapter = pool.filter(t => poolCfg.themes.indexOf(t.id) >= 0);
      if (byChapter.length) pool = byChapter;
    }
    const theme = this._weighted(rng, pool.length ? pool : [SPAWN_THEMES[0]]);

    /* 2. 预算（精英与后期房间显著更高；章节再叠加自己的预算） */
    let budget = isElite ? 16 + depth * 3.4 : 9 + depth * 2.9;
    budget += (poolCfg.budget || 0);
    budget = Math.min(budget, isElite ? 50 : 34);

    const maxCount = isElite ? 10 : (depth >= 3 ? 9 : (depth >= 1 ? 7 : 6));
    const maxTotal = maxCount + (poolCfg.max || 0);

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

    /* 主题偏好优先，池子为空时退回全池；章节偏好再叠一层（每层主角不同） */
    const bias = list => {
      const p = list.filter(k => theme.prefer.indexOf(k) >= 0);
      return p.length ? p : list;
    };
    const chBias = list => {
      if (!poolCfg.prefer || !poolCfg.prefer.length) return list;
      const p = list.filter(k => poolCfg.prefer.indexOf(k) >= 0);
      return p.length ? p : list;
    };
    const pickFrom = list => chBias(bias(list));

    const chosen = [];
    const spend = id => { chosen.push(id); budget -= (reg[id].def.cost || 3); };
    const countOf = pred => chosen.filter(pred).length;

    /* 4. 辅助位（全场最多 1 个，且深层/精英房才出现） */
    const supportPool = pickFrom(specialPool.filter(k => has(reg[k].def, 'support')));
    /* 章节的特殊敌人出现率越高，越容易出现辅助 / 特殊位 */
    let wantSupport = isElite || depth >= 3 || (depth >= 2 && theme.id === 'cohort') ||
      (poolCfg.special > 0.2);
    if (wantSupport && supportPool.length) spend(rng.pick(supportPool));

    /* 5. 弹幕位（数量受严格上限，避免无法躲避的弹幕墙） */
    const bulletPool = pickFrom(rangedPool.filter(k => has(reg[k].def, 'bullethell')));
    let bulletCap = depth >= 4 ? 2 : (depth >= 1 ? 1 : 0);
    bulletCap = Math.max(bulletCap, poolCfg.bullet || 0);
    if (isElite) bulletCap = Math.min(2, bulletCap + 1);
    for (let i = 0; i < bulletCap && bulletPool.length; i++) {
      const id = rng.pick(bulletPool);
      if ((reg[id].def.cost || 3) > budget) break;
      spend(id);
    }

    /* 6. 按主题比例填充剩余名额
          章节的「特殊敌人出现率」会抬高特殊位权重（越深层越容易出现诡术/辅助） */
    const spRatio = clamp((theme.special || 0) + (poolCfg.special || 0) * 0.6, 0, 0.62);
    const rest = 1 - spRatio;
    const mr = (theme.melee || 0) + (theme.ranged || 0) || 1;
    const meleeR = rest * ((theme.melee || 0) / mr);
    const rangedR = rest * ((theme.ranged || 0) / mr);

    let guard = 0;
    while (budget > 0 && chosen.length < maxTotal && guard++ < 60) {
      const roll = rng.next();
      let list;
      if (roll < meleeR) list = pickFrom(meleePool);
      else if (roll < meleeR + rangedR) list = pickFrom(rangedPool);
      else list = pickFrom(specialPool.filter(k => !has(reg[k].def, 'support')));
      if (!list.length) list = pickFrom(meleePool);

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
      if (has(d, 'swarm') && chosen.length < maxTotal && budget > 0) {
        if (rng.chance(0.75)) spend(id);
      }
    }

    /* 7. 保底规则 */
    if (!chosen.length) chosen.push('chaser');
    /* 有辅助就必须有前排保护，否则辅助会孤立被秒（也让房间更耐打） */
    const supportN = countOf(k => has(reg[k].def, 'support'));
    const meleeN = countOf(k => reg[k].def.cat === 'melee');
    if (supportN > 0 && meleeN < 2) {
      const m = pickFrom(meleePool);
      for (let i = meleeN; i < 2; i++) chosen.push(rng.pick(m));
    }
    /* 精英房必有后排（远程 / 特殊），否则整房纯近战太单调 */
    if (isElite && !chosen.some(k => reg[k].def.cat !== 'melee')) {
      let back = pickFrom(rangedPool.concat(specialPool.filter(k => !has(reg[k].def, 'support'))))
        .filter(k => !has(reg[k].def, 'bullethell'));
      if (!back.length) back = pickFrom(rangedPool);
      if (back.length) chosen.push(rng.pick(back));
    }
    /* 普通房至少两名前排：避免整房纯远程（也让「近战为主」的浅层体验成立） */
    if (!isElite) {
      const mn = countOf(k => reg[k].def.cat === 'melee');
      if (mn < 2) {
        const m = pickFrom(meleePool);
        for (let i = mn; i < 2; i++) chosen.push(rng.pick(m));
      }
    }
    if (chosen.length < 3) {
      const m = pickFrom(meleePool);
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
      /* 深层大房间拆成更多波次（逐层加压，而不是一次性糊脸） */
      const parts = (all.length >= 11 && (poolCfg.max || 0) >= 2) ? 3 : 2;
      if (parts === 3) {
        const c1 = Math.ceil(all.length * 0.36);
        const c2 = Math.ceil(all.length * 0.68);
        waves = [all.slice(0, c1), all.slice(c1, c2), all.slice(c2)].filter(w => w.length);
      } else {
        const cut = Math.ceil(all.length * 0.55);
        waves = [all.slice(0, cut), all.slice(cut)];
      }
      if (!waves.length || !waves[waves.length - 1].length) waves = [all];
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
