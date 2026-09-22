/* ===========================================================
   shop.js — 商栈（Shop 房）
   随机生成 3~5 个商品，五大类：
     道具 / 回复 / 临时增益 / 宝箱 / 特殊物品
   全部数据驱动：新增商品只需往 SHOP_GOODS 里加一条数据
   =========================================================== */
'use strict';

const SHOP_KIND = {
  item:    { cn: '道具', color: '#ffb347' },
  heal:    { cn: '回复', color: '#7dffb0' },
  buff:    { cn: '增益', color: '#7fe4ff' },
  chest:   { cn: '宝箱', color: '#ffd35e' },
  special: { cn: '奇物', color: '#c08bff' }
};

/* -----------------------------------------------------------
   商品表：cost 为基础价（会按层数略微上浮）
   make(g) 生成具体的商品实例（名字/说明/价格/结算）
   ----------------------------------------------------------- */
const SHOP_GOODS = [
  /* ---- 道具 ---- */
  {
    id: 'item_basic', kind: 'item', weight: 26, cost: 20,
    make(rng, game) {
      const it = pickItem(rng, game.player ? game.player.build : null, { synergy: true });
      return {
        name: it.name, desc: it.desc, color: it.color, cost: 20,
        apply(g) { return g.player.gainItem(it.id); }
      };
    }
  },
  {
    id: 'item_premium', kind: 'item', weight: 12, cost: 34,
    make(rng, game) {
      const build = game.player ? game.player.build : null;
      const hot = ITEMS.filter(it => it.cat === 'special' || it.cat === 'attack')
        .filter(it => !build || build.count(it.id) < (it.max || 99));
      const it = hot.length ? rng.pick(hot) : pickItem(rng, build, {});
      return {
        name: it.name, desc: it.desc + '（稀有货架）', color: it.color, cost: 34,
        apply(g) { return g.player.gainItem(it.id); }
      };
    }
  },

  /* ---- 回复 ---- */
  {
    id: 'heal_potion', kind: 'heal', weight: 18, cost: 14,
    make() {
      return {
        name: '余烬药剂', desc: '回复 45 点生命', color: '#7dffb0', cost: 14,
        apply(g) { g.player.heal(45); return true; }
      };
    }
  },
  {
    id: 'heal_full', kind: 'heal', weight: 8, cost: 30,
    make() {
      return {
        name: '回响圣杯', desc: '生命完全回复', color: '#7dffb0', cost: 30,
        apply(g) { g.player.hp = g.player.maxHp; return true; }
      };
    }
  },
  {
    id: 'heal_max', kind: 'heal', weight: 10, cost: 24,
    make() {
      return {
        name: '薪火之种', desc: '最大生命 +18 并回复 20', color: '#8fe0a0', cost: 24,
        apply(g) {
          g.player.buffs.add({ id: 'seed_hp', name: '薪火之种', kind: 'buff', color: '#8fe0a0', dur: 0, stats: { maxHp: 18 } });
          g.player.heal(20);
          return true;
        }
      };
    }
  },

  /* ---- 临时增益 ---- */
  {
    id: 'buff_stim', kind: 'buff', weight: 12, cost: 16,
    make() {
      return {
        name: '战斗兴奋剂', desc: '30 秒内攻击 +6、伤害 +25%', color: '#ff8a5c', cost: 16,
        apply(g) { g.player.buffs.addPreset('stim'); return true; }
      };
    }
  },
  {
    id: 'buff_haste', kind: 'buff', weight: 12, cost: 14,
    make() {
      return {
        name: '疾行回响', desc: '30 秒内移动速度 +55', color: '#7fe4ff', cost: 14,
        apply(g) { g.player.buffs.addPreset('haste'); return true; }
      };
    }
  },
  {
    id: 'buff_stone', kind: 'buff', weight: 10, cost: 18,
    make() {
      return {
        name: '石肤涂层', desc: '30 秒内受伤减免 22%', color: '#c8ff6a', cost: 18,
        apply(g) { g.player.buffs.addPreset('stoneskin'); return true; }
      };
    }
  },
  {
    id: 'buff_fervor', kind: 'buff', weight: 10, cost: 18,
    make() {
      return {
        name: '狂热引信', desc: '30 秒内射速 +45%', color: '#ffd35e', cost: 18,
        apply(g) { g.player.buffs.addPreset('fervor'); return true; }
      };
    }
  },

  /* ---- 宝箱 ---- */
  {
    id: 'chest_small', kind: 'chest', weight: 10, cost: 22,
    make(rng, game) {
      return {
        name: '封缄木匣', desc: '购买后原地留下一口宝箱', color: '#ffd35e', cost: 22,
        apply(g) {
          const cx = g.player.x, cy = g.player.y + 66;
          const c = new Chest(g, cx, cy, rng.fork('shopChest'), true);
          g.room.props.push(c);
          return true;
        }
      };
    }
  },
  {
    id: 'chest_grand', kind: 'chest', weight: 5, cost: 44,
    make(rng, game) {
      return {
        name: '鎏金秘匣', desc: '购买后原地留下一口大宝箱（额外金币）', color: '#ffe08a', cost: 44,
        apply(g) {
          const cx = g.player.x, cy = g.player.y + 66;
          const c = new Chest(g, cx, cy, rng.fork('shopGrand'), false);
          c.coinBonus = 40;
          g.room.props.push(c);
          return true;
        }
      };
    }
  },

  /* ---- 特殊物品 ---- */
  {
    id: 'sp_cleanse', kind: 'special', weight: 8, cost: 20,
    make(rng, game) {
      const cursed = game.player && game.player.buffs.list.some(b => b.kind === 'curse');
      return {
        name: '净化之尘', desc: cursed ? '清除身上所有诅咒' : '清除所有诅咒（当前无诅咒）',
        color: '#c08bff', cost: 20,
        need: () => !!(game.player && game.player.buffs.list.some(b => b.kind === 'curse')),
        apply(g) { return g.player.buffs.cleanseCurses() > 0; }
      };
    }
  },
  {
    id: 'sp_compass', kind: 'special', weight: 8, cost: 26,
    make(rng, game) {
      return {
        name: '秘室罗盘', desc: '揭示本层所有隐藏房', color: '#c08bff', cost: 26,
        need: () => !!(game.map && game.map.cells.some(c => c.hidden && !c.discovered)),
        apply(g) {
          const n = g.discoverAllSecrets(true);
          return n > 0;
        }
      };
    }
  },
  {
    id: 'sp_atlas', kind: 'special', weight: 9, cost: 18,
    make(rng, game) {
      return {
        name: '回廊残图', desc: '揭示本层全部房间的布局', color: '#c08bff', cost: 18,
        apply(g) {
          if (!g.map) return false;
          g.map.revealAll();
          return true;
        }
      };
    }
  },
  {
    id: 'sp_forge', kind: 'special', weight: 8, cost: 28,
    make(rng, game) {
      return {
        name: '重塑熔炉', desc: '随机替换一件已持有道具，换一件新的', color: '#c08bff', cost: 28,
        need: () => !!(game.player && game.player.build.slots.length > 0),
        apply(g) {
          const slots = g.player.build.slots;
          if (!slots.length) return false;
          const pick = slots[Math.floor(rng.next() * slots.length)];
          const old = ITEM_BY_ID[pick.id];
          /* 直接改槽位（保留层数），再重算 */
          const fresh = pickItem(rng, g.player.build, { synergy: false });
          pick.id = fresh.id; pick.n = 1;
          g.player.build.recompute();
          g.ui.showBanner('重塑：' + (old ? old.name : '?') + ' → ' + fresh.name, fresh.desc, 2.6);
          return true;
        }
      };
    }
  },
  {
    id: 'sp_coinpile', kind: 'special', weight: 6, cost: 12,
    make() {
      return {
        name: '拾荒者钱袋', desc: '立刻获得 40 金币', color: '#ffd35e', cost: 12,
        apply(g) { g.addCoins(40); return true; }
      };
    }
  }
];

/* -----------------------------------------------------------
   生成一整套货架（3~5 件，按权重抽，不重复）
   ----------------------------------------------------------- */
function rollShopStocks(rng, game, floor) {
  const count = rng.int(3, 5);
  const pool = SHOP_GOODS.slice();
  const stocks = [];
  const scale = 1 + Math.max(0, ((floor || 1) - 1)) * 0.10;

  /* 保证第一件是道具，最后一件尽量是特殊/宝箱，其余按权重 */
  const takeOne = (filter) => {
    let cands = pool.filter(filter || (() => true));
    if (!cands.length) cands = pool.slice();
    let sum = 0;
    for (const c of cands) sum += (c.weight || 5);
    let r = rng.next() * sum;
    let chosen = cands[cands.length - 1];
    for (const c of cands) {
      r -= (c.weight || 5);
      if (r <= 0) { chosen = c; break; }
    }
    const idx = pool.indexOf(chosen);
    if (idx >= 0) pool.splice(idx, 1);
    return chosen;
  };

  const first = takeOne(g => g.kind === 'item');
  stocks.push(first);
  for (let i = 1; i < count; i++) {
    const last = (i === count - 1 && count >= 4);
    stocks.push(takeOne(last ? (g => g.kind === 'special' || g.kind === 'chest') : null));
  }

  return stocks.map((g, i) => {
    const inst = g.make(rng.fork('goods' + i), game);
    inst.kind = g.kind;
    inst.kindCn = (SHOP_KIND[g.kind] || SHOP_KIND.item).cn;
    inst.cost = Math.max(6, Math.round((inst.cost || g.cost) * scale));
    return inst;
  });
}

/* -----------------------------------------------------------
   货架（可交互物件）
   ----------------------------------------------------------- */
class ShopStall extends Prop {
  constructor(game, x, y, stock) {
    super(game, x, y, { r: 20 });
    this.stock = stock;
    this.cost = stock.cost;
    this.label = `${stock.name} · ◈${stock.cost}`;
    this.denyT = 0;
  }

  canAfford() { return this.game.coins >= this.cost; }

  available() {
    if (this.used) return false;
    if (this.stock.need && !this.stock.need()) return false;
    return true;
  }

  use() {
    if (this.used) return false;
    if (!this.available()) {
      this.denyT = 0.6;
      this.game.damageNumbers.add(this.x, this.y - 28, '现在用不上', { color: '#ff9d6b', life: 0.9 });
      return false;
    }
    if (!this.canAfford()) {
      this.denyT = 0.6;
      this.game.damageNumbers.add(this.x, this.y - 28, '金币不足', { color: '#ff7a7a', life: 0.9 });
      return false;
    }
    const ok = this.stock.apply(this.game);
    if (!ok) {
      this.denyT = 0.6;
      this.game.damageNumbers.add(this.x, this.y - 28, '无法购买', { color: '#ff7a7a', life: 0.9 });
      return false;
    }
    this.used = true;
    this.game.spendCoins(this.cost);
    this.game.damageNumbers.add(this.x, this.y - 30, '-◈' + this.cost, { color: '#ffd35e', life: 1.1, vy: -40 });
    this.game.particles.burst(this.x, this.y, 18, {
      speed: 180, life: 0.7, size: 4,
      colors: [this.stock.color, '#ffffff', '#ffd35e']
    });
    return true;
  }

  update(dt) {
    super.update(dt);
    if (this.denyT > 0) this.denyT -= dt;
  }

  draw(ctx) {
    const t = this.animT;
    const st = this.stock;
    const ok = this.available() && this.canAfford();
    const col = this.used ? '#4a5a66' : (ok ? st.color : '#6b7684');

    this.drawBase(ctx, ok && !this.used ? col : '#5d6f7e', 0.32);
    if (!this.used) this.drawMarker(ctx, col);

    ctx.save();
    ctx.translate(this.x, this.y);

    /* 基座 */
    ctx.fillStyle = '#1d2531';
    roundRectPath(ctx, -22, 2, 44, 14, 3);
    ctx.fill();
    ctx.strokeStyle = '#3c4a5e';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#161d27';
    roundRectPath(ctx, -14, -24, 28, 28, 3);
    ctx.fill();
    ctx.stroke();

    if (!this.used) {
      /* 商品本体（按类型画不同形状） */
      const fy = -34 + Math.sin(t * 2.4) * 2.5;
      ctx.save();
      ctx.translate(0, fy);
      ctx.rotate(t * 0.8);
      ctx.fillStyle = st.color;
      ctx.globalAlpha = ok ? 1 : 0.4;
      if (this.stock.kind === 'heal') {
        polygonPath(ctx, [[0, -10], [7, 0], [0, 10], [-7, 0]]);
      } else if (this.stock.kind === 'chest') {
        polygonPath(ctx, [[-9, -8], [9, -8], [9, 8], [-9, 8]]);
      } else if (this.stock.kind === 'buff') {
        polygonPath(ctx, [[0, -11], [10, -2], [6, 10], [-6, 10], [-10, -2]]);
      } else if (this.stock.kind === 'special') {
        polygonPath(ctx, [[0, -12], [11, -4], [7, 10], [-7, 10], [-11, -4]]);
      } else {
        polygonPath(ctx, [[0, -11], [8, 0], [0, 11], [-8, 0]]);
      }
      ctx.fill();
      ctx.restore();

      /* 名字 */
      ctx.globalAlpha = 1;
      ctx.font = '700 12px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = ok ? '#dbe6ef' : '#7b8896';
      ctx.fillText(st.name, 0, -50);
      ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#6d8296';
      ctx.fillText(st.kindCn || '', 0, 44);

      /* 价格 */
      ctx.font = '800 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = this.canAfford() ? '#ffd35e' : '#ff7a7a';
      ctx.fillText('◈' + this.cost, 0, 28);
    } else {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#5d6f7e';
      ctx.beginPath(); ctx.arc(0, -18, 8, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#5d6f7e';
      ctx.fillText('已售出', 0, 28);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}
