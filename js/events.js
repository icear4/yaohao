/* ===========================================================
   events.js — 异象房（Event）
   数据驱动的随机事件：牺牲生命 / 赌博 / 付费抽奖 /
   随机强化 / 随机诅咒 / 献祭道具 等
   新增事件 = 往 EVENTS 里加一条数据对象
   =========================================================== */
'use strict';

const EVENTS = [
  {
    id: 'blood_pact', name: '血契熔炉', color: '#ff6b5c',
    desc: '献出 30 点生命，换取一件随机道具',
    can: (g) => g.player.hp > 34,
    run(g, rng) {
      g.player.takeDamage(30, g.player.x, g.player.y);
      g.player.invuln = 0;
      const it = pickItem(rng, g.player.build, { synergy: true });
      const got = g.player.gainItem(it.id);
      return { name: got ? got.name : '血契', desc: got ? got.desc : '没有可获得的道具', color: got ? got.color : '#ff6b5c' };
    }
  },
  {
    id: 'ember_gamble', name: '残响赌局', color: '#ffd35e',
    desc: '押上 18 金币：五成翻倍至 45，五成血本无归',
    can: (g) => g.coins >= 18,
    run(g, rng) {
      g.spendCoins(18);
      if (rng.chance(0.5)) {
        g.addCoins(45);
        return { name: '赌局 · 赢', desc: '+45 金币', color: '#7dffb0' };
      }
      return { name: '赌局 · 输', desc: '18 金币化为回声', color: '#ff6b5c' };
    }
  },
  {
    id: 'echo_forge', name: '回声熔炉', color: '#7fe4ff',
    desc: '花 26 金币，换取一件随机道具',
    can: (g) => g.coins >= 26,
    run(g, rng) {
      g.spendCoins(26);
      const it = pickItem(rng, g.player.build, { synergy: true });
      const got = g.player.gainItem(it.id);
      return { name: got ? got.name : '熔炉空转', desc: got ? got.desc : '没有可获得的道具', color: got ? got.color : '#7fe4ff' };
    }
  },
  {
    id: 'cursed_boon', name: '诅咒恩赐', color: '#c08bff',
    desc: '获得强大增益，同时背上一层诅咒',
    can: () => true,
    run(g, rng) {
      const boons = [
        { key: 'stim', txt: '攻击大幅提升' },
        { key: 'fervor', txt: '射速大幅提升' },
        { key: 'haste', txt: '移动速度提升' }
      ];
      const curses = ['heavy', 'sluggish', 'brittle'];
      const b = boons[Math.floor(rng.next() * boons.length)];
      const c = curses[Math.floor(rng.next() * curses.length)];
      g.player.buffs.addPreset(b.key, 90);
      g.player.buffs.addPreset(c, 60);
      return { name: '诅咒恩赐', desc: b.txt + '，但 ' + BUFF_PRESETS[c].name + ' 缠身 60 秒', color: '#c08bff' };
    }
  },
  {
    id: 'shatter_altar', name: '碎裂祭坛', color: '#ff8a5c',
    desc: '献祭一件已持有道具，换取两件新的 + 20 金币',
    can: (g) => g.player.build.slots.length > 0,
    run(g, rng) {
      const slots = g.player.build.slots;
      let old = null;
      if (slots.length > 0) {
        /* 优先献祭堆叠数最高的那件（损失最小） */
        let vi = 0;
        for (let i = 1; i < slots.length; i++) if (slots[i].n > slots[vi].n) vi = i;
        old = ITEM_BY_ID[slots[vi].id];
        slots.splice(vi, 1);
        g.player.build.recompute();
      }
      const a = g.player.gainItem(pickItem(rng, g.player.build, { synergy: true }).id);
      const b = g.player.gainItem(pickItem(rng, g.player.build, { synergy: true }).id);
      g.addCoins(20);
      const names = [a && a.name, b && b.name].filter(Boolean).join('、');
      return {
        name: '碎裂：' + (old ? old.name : '?'),
        desc: (names || '（无可获得道具）') + ' + 20 金币',
        color: '#ff8a5c'
      };
    }
  },
  {
    id: 'scavenger', name: '拾荒者之匣', color: '#ffd35e',
    desc: '获得 40 金币，但最大生命 -12',
    can: () => true,
    run(g) {
      g.addCoins(40);
      g.player.buffs.add({ id: 'scav_debt', name: '拾荒者负债', kind: 'curse', color: '#c08bff', dur: 0, stats: { maxHp: -12 } });
      return { name: '拾荒者之匣', desc: '+40 金币，最大生命 -12', color: '#ffd35e' };
    }
  },
  {
    id: 'brand', name: '燃命烙印', color: '#ffb347',
    desc: '最大生命 -15，攻击力 +9（永久）',
    can: () => true,
    run(g) {
      g.player.buffs.add({ id: 'brand', name: '燃命烙印', kind: 'buff', color: '#ffb347', dur: 0, stats: { maxHp: -15, damage: 9 } });
      return { name: '燃命烙印', desc: '最大生命 -15，攻击力 +9', color: '#ffb347' };
    }
  },
  {
    id: 'blind_box', name: '回声盲盒', color: '#9ad14f',
    desc: '四种结果随机其一：道具 / 金币 / 治疗 / 陷阱',
    can: () => true,
    run(g, rng) {
      const roll = rng.next();
      if (roll < 0.34) {
        const it = pickItem(rng, g.player.build, { synergy: true });
        const got = g.player.gainItem(it.id);
        return { name: got ? got.name : '盲盒', desc: got ? got.desc : '空盒', color: got ? got.color : '#9ad14f' };
      }
      if (roll < 0.60) {
        g.addCoins(30);
        return { name: '盲盒 · 金币', desc: '+30 金币', color: '#ffd35e' };
      }
      if (roll < 0.84) {
        g.player.hp = g.player.maxHp;
        return { name: '盲盒 · 治疗', desc: '生命完全回复', color: '#7dffb0' };
      }
      g.player.takeDamage(22, g.player.x, g.player.y);
      g.player.invuln = 0;
      return { name: '盲盒 · 陷阱', desc: '-22 生命', color: '#ff6b5c' };
    }
  },
  {
    id: 'hidden_compass', name: '秘室石碑', color: '#c08bff',
    desc: '揭示本层所有隐藏房（若已全部发现则给 25 金币）',
    can: () => true,
    run(g) {
      const n = g.discoverAllSecrets(false);
      if (n > 0) return { name: '秘室石碑', desc: '揭示 ' + n + ' 间隐藏房', color: '#c08bff' };
      g.addCoins(25);
      return { name: '秘室石碑', desc: '本层无隐藏房，+25 金币', color: '#ffd35e' };
    }
  },
  {
    id: 'ward_cache', name: '守望者的暗库', color: '#ff4d6b',
    desc: '获得 2 件道具，但立刻引来一波残形',
    can: () => true,
    run(g, rng) {
      const a = g.player.gainItem(pickItem(rng, g.player.build, { synergy: true }).id);
      const b = g.player.gainItem(pickItem(rng, g.player.build, { synergy: true }).id);
      const types = ['chaser', 'shooter', 'charger'];
      for (let i = 0; i < 3; i++) {
        g.room.pending.push({ type: types[Math.floor(rng.next() * types.length)], delay: 0.2 * i });
      }
      /* 异象房临时变成战斗房：关门，打完才开 */
      if (g.room) { g.room.state = 'fighting'; g.room.doorsOpen = false; }
      g.addShake(2.5);
      const names = [a && a.name, b && b.name].filter(Boolean).join('、');
      return { name: '守望者的暗库', desc: (names || '空库') + '，但残形被惊动了', color: '#ff4d6b' };
    }
  }
];

function pickEvent(rng, game) {
  const pool = EVENTS.filter(e => !e.can || e.can(game));
  if (!pool.length) return EVENTS[0];
  return rng.pick(pool);
}

/* -----------------------------------------------------------
   异象石碑（可交互物件）
   ----------------------------------------------------------- */
class EventShrine extends Prop {
  constructor(game, x, y, rng) {
    super(game, x, y, { r: 26 });
    this.rng = rng;
    this.event = pickEvent(rng, game);
    this.label = this.event.name;
    this.outcome = null;
  }

  /* 悬停 / 靠近时展示的说明 */
  get detail() { return this.event.desc; }

  use() {
    if (!super.use()) return false;
    const res = this.event.run(this.game, this.rng.fork(this.event.id));
    this.outcome = res;
    this.game.ui.showBanner(res.name, res.desc, 3.0);
    this.game.damageNumbers.add(this.x, this.y - 34, res.name, { color: res.color, life: 1.4, vy: -40 });
    this.game.particles.ring(this.x, this.y, res.color, 22, 220);
    this.game.particles.burst(this.x, this.y, 20, {
      speed: 200, life: 0.8, size: 4, colors: [res.color, '#ffffff']
    });
    return true;
  }

  draw(ctx) {
    const t = this.animT;
    const col = this.used ? (this.outcome ? this.outcome.color : '#5d6f7e') : this.event.color;
    this.drawBase(ctx, col, this.used ? 0.18 : 0.34);
    if (!this.used) this.drawMarker(ctx, col);

    ctx.save();
    ctx.translate(this.x, this.y);

    /* 三根立柱 */
    ctx.strokeStyle = '#2c3446';
    ctx.lineWidth = 5;
    for (let i = 0; i < 3; i++) {
      const a = t * 0.5 + (i / 3) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 18, Math.sin(a) * 9);
      ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 9 - 30);
      ctx.stroke();
    }

    /* 悬浮晶体 */
    const fy = -40 + Math.sin(t * 2) * 3;
    ctx.save();
    ctx.translate(0, fy);
    ctx.rotate(t * 0.8);
    ctx.fillStyle = col;
    ctx.globalAlpha = this.used ? 0.35 : 0.92;
    polygonPath(ctx, [[0, -13], [9, 0], [0, 13], [-9, 0]]);
    ctx.fill();
    ctx.globalAlpha = this.used ? 0.12 : 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, TAU);
    ctx.fill();
    ctx.restore();

    /* 事件名与说明（未触发时显示，方便决定是否触碰） */
    if (!this.used) {
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.font = '700 14px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = col;
      ctx.fillText(this.event.name, 0, -66);
      ctx.font = '600 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(200,215,230,0.78)';
      const w = ctx.measureText(this.event.desc).width;
      ctx.fillStyle = 'rgba(6,10,15,0.62)';
      roundRectPath(ctx, -w / 2 - 10, -54, w + 20, 20, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,215,230,0.8)';
      ctx.fillText(this.event.desc, 0, -40);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }
}
