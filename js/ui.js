/* ===========================================================
   ui.js — HUD（Canvas）+ 遮罩面板（DOM）+ 小地图 + 横幅 + 准星
   =========================================================== */
'use strict';

class UI {
  constructor(game) {
    this.game = game;
    this.banner = null;
    this.hintTimer = 9;
    this.hitVignette = 0;

    this.overlay = document.getElementById('overlay');
    this.elKicker = document.getElementById('ov-kicker');
    this.elTitleCn = document.getElementById('ov-title-cn');
    this.elTitleEn = document.getElementById('ov-title-en');
    this.elText = document.getElementById('ov-text');
    this.elBtn = document.getElementById('ov-btn');
    this.elHint = document.getElementById('ov-hint');
    this.elSeed = document.getElementById('seed-input');

    this.elBtn.addEventListener('click', () => {
      this.game.primaryAction();
    });

    this.setOverlay('title');
  }

  /* 玩家当前 Build 的一句话摘要（遮罩面板用） */
  buildSummary(g) {
    if (!g.player || !g.player.build) return '';
    const slots = g.player.build.slots;
    if (!slots.length) return '尚无道具';
    const names = slots.slice(0, 8).map(s => {
      const it = ITEM_BY_ID[s.id];
      return (it ? it.name : s.id) + (s.n > 1 ? `×${s.n}` : '');
    });
    const more = slots.length > 8 ? ` 等 ${slots.length} 类` : '';
    return names.join('、') + more;
  }

  /* ---------------------------------------------------------
     遮罩面板
     --------------------------------------------------------- */
  setOverlay(mode) {
    this.overlayMode = mode;
    if (!mode) {
      this.overlay.classList.add('hidden');
      return;
    }
    this.overlay.classList.remove('hidden');

    const g = this.game;
    if (mode === 'title') {
      this.elKicker.textContent = 'ORIGINAL ROGUELIKE SHOOTER';
      this.elTitleCn.textContent = '残响回廊';
      this.elTitleEn.textContent = 'ECHO RIFT';
      this.elText.innerHTML =
        '星脉崩解之后，回廊在裂隙中生长。<br>' +
        '徘徊其中的，是回声凝成的残形。<br><br>' +
        '你是最后的拾火者，收集余烬，走到守望者面前。';
      this.elBtn.textContent = '开始探索';
      const kbHint = 'WASD 移动 · 鼠标瞄准 · 左键射击 · E 交互 · ESC 暂停 · F 全屏';
      this.elHint.textContent = (this.game.touchMode && this.touchHint) ? this.touchHint : kbHint;
      if (this.elSeed) this.elSeed.style.display = '';
    } else if (mode === 'pause') {
      this.elKicker.textContent = 'SYSTEM HALT';
      this.elTitleCn.textContent = '暂停';
      this.elTitleEn.textContent = 'PAUSED';
      this.elText.innerHTML =
        `SEED　<b>${g.seed}</b><br>` +
        `层数　<b>第 ${g.floor} 层</b><br>` +
        `余烬　<b>${g.embers}</b><br>` +
        `已探索　<b>${Object.keys(g.map ? g.map.visited : {}).length} / ${g.map ? g.map.cells.length : 0}</b> 间<br>` +
        `持有道具　<b>${g.player ? g.player.build.length : 0}</b> 件<br>` +
        `<span style="color:#8fa3b5">${this.buildSummary(g)}</span>`;
      this.elBtn.textContent = '继续';
      this.elHint.textContent = 'R 重新开始 · ESC 继续';
      if (this.elSeed) this.elSeed.style.display = 'none';
    } else if (mode === 'gameover') {
      this.elKicker.textContent = 'EMBER EXTINGUISHED';
      this.elTitleCn.textContent = '火种熄灭';
      this.elTitleEn.textContent = 'RUN OVER';
      this.elText.innerHTML =
        `SEED　<b>${g.seed}</b><br>` +
        `抵达　<b>第 ${g.floor} 层 · ${g.roomTypeName()}</b><br>` +
        `击碎残形　<b>${g.kills}</b>　射出弹丸　<b>${g.player ? g.player.shotsFired : 0}</b><br>` +
        `持有道具　<b>${g.player ? g.player.build.length : 0}</b> 件<br>` +
        `<span style="color:#8fa3b5">${this.buildSummary(g)}</span>`;
      this.elBtn.textContent = '重新开始';
      this.elHint.textContent = '按 R 也可以重来（可先改 Seed）';
      if (this.elSeed) this.elSeed.style.display = '';
    }
  }

  /* 读取玩家输入的 Seed（空则随机） */
  readSeedInput() {
    if (!this.elSeed) return '';
    return (this.elSeed.value || '').trim().toUpperCase();
  }

  /* ---------------------------------------------------------
     横幅
     --------------------------------------------------------- */
  showBanner(text, sub, duration) {
    if (!text) return;
    this.banner = {
      text: text, sub: sub || '', life: duration || 1.6, maxLife: duration || 1.6,
      style: 'normal'
    };
  }

  showClearBanner(sub) {
    this.banner = {
      text: 'ROOM CLEAR', sub: sub || '门已开启 · 走进门洞继续探索',
      life: 2.4, maxLife: 2.4, style: 'clear'
    };
  }

  update(dt) {
    if (this.hintTimer > 0) this.hintTimer -= dt;
    if (this.hitVignette > 0) this.hitVignette = Math.max(0, this.hitVignette - dt * 1.6);
    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }
  }

  /* ---------------------------------------------------------
     HUD
     --------------------------------------------------------- */
  drawHUD(ctx) {
    const g = this.game;
    const p = g.player;
    if (!p) return;

    /* ---- 左上：生命值 ---- */
    const bx = 26, by = 24, bw = 268, bh = 20;
    ctx.fillStyle = 'rgba(6,10,15,0.72)';
    roundRectPath(ctx, bx - 8, by - 22, bw + 96, bh + 62, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,190,220,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#7fd7ea';
    ctx.fillText('拾火者 · EMBER', bx, by - 7);

    ctx.fillStyle = '#2a1218';
    roundRectPath(ctx, bx, by, bw, bh, 5);
    ctx.fill();

    const ratio = clamp(p.hp / p.maxHp, 0, 1);
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    if (ratio > 0.35) {
      grad.addColorStop(0, '#ffb347');
      grad.addColorStop(1, '#ffe08a');
    } else {
      grad.addColorStop(0, '#ff4d4d');
      grad.addColorStop(1, '#ff8a5c');
    }
    ctx.fillStyle = grad;
    if (ratio > 0.001) {
      roundRectPath(ctx, bx, by, bw * ratio, bh, 5);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const x = bx + (bw / 5) * i;
      ctx.beginPath();
      ctx.moveTo(x, by + 2);
      ctx.lineTo(x, by + bh - 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,220,160,0.35)';
    roundRectPath(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, 5);
    ctx.stroke();

    ctx.font = '800 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#ffe9c0';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(p.hp)} / ${p.maxHp}`, bx + bw + 62, by + 15);

    /* ---- 左上第二行：余烬 / 层数 / 房间 / Seed ---- */
    ctx.textAlign = 'left';
    ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#ffd35e';
    ctx.fillText(`◈ ${g.embers} 余烬`, bx, by + 40);

    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    const roomName = g.room ? g.room.meta.cn : '-';
    const alive = g.room ? g.room.aliveCount() : 0;
    const statusTxt = (g.room && g.room.isCombatRoom)
      ? (g.room.state === 'clear' ? '已肃清 · 门已开启' : `残形剩余 ${alive}`)
      : '可自由通行';
    ctx.fillStyle = (g.room && g.room.isCombatRoom && g.room.state !== 'clear') ? '#ff9d6b' : '#7dffb0';
    ctx.fillText(`第 ${g.floor} 层 · ${roomName} · ${statusTxt}`, bx + 88, by + 40);

    ctx.fillStyle = '#5d6f7e';
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`SEED ${g.seed}　击碎 ${g.kills}　${playerStatsText(p)}`, bx, by + 58);

    /* ---- 右上：小地图 ---- */
    this.drawMinimap(ctx);

    /* ---- 左下：Build 面板（持有道具 + 组合） ---- */
    this.drawBuildPanel(ctx);

    /* ---- 交互提示 ---- */
    if (g.nearProp && !g.nearProp.used) {
      const txt = (g.touchMode ? '' : 'E · ') + g.nearProp.label;
      ctx.textAlign = 'center';
      ctx.font = '700 14px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      const w = ctx.measureText(txt).width + 26;
      ctx.fillStyle = 'rgba(6,10,15,0.8)';
      roundRectPath(ctx, VIEW_W / 2 - w / 2, VIEW_H - 74, w, 30, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,110,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ffd28a';
      ctx.fillText(txt, VIEW_W / 2, VIEW_H - 55);
      ctx.textAlign = 'left';
    }

    /* ---- 底部操作提示（渐隐） ---- */
    if (this.hintTimer > 0) {
      ctx.globalAlpha = clamp(this.hintTimer / 2.5, 0, 1);
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#6d8296';
      ctx.textAlign = 'center';
      const hint = g.touchMode
        ? '拖动屏幕两侧即可移动与射击'
        : 'WASD 移动　·　鼠标瞄准　·　左键射击　·　E 交互　·　ESC 暂停　·　F 全屏';
      ctx.fillText(hint, VIEW_W / 2, VIEW_H - 22);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    /* ---- 受击暗角 / 低血量 ---- */
    if (this.hitVignette > 0) {
      const a = this.hitVignette * 0.5;
      const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.28, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.78);
      vg.addColorStop(0, 'rgba(255,40,40,0)');
      vg.addColorStop(1, `rgba(255,40,40,${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (p.hp > 0 && ratio < 0.3) {
      const pulse = 0.10 + 0.08 * Math.sin(g.time * 6);
      const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.3, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.8);
      vg.addColorStop(0, 'rgba(255,0,0,0)');
      vg.addColorStop(1, `rgba(255,0,0,${pulse})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    /* 悬停说明画在最上层 */
    this.drawItemTooltip(ctx);
  }

  /* ---------------------------------------------------------
     Build 面板：当前持有的道具（左下角）
     鼠标悬停任意道具 → 显示完整说明
     --------------------------------------------------------- */
  drawBuildPanel(ctx) {
    const g = this.game;
    const p = g.player;
    if (!p || !p.build) return;

    const slots = p.build.slots;
    const mx = g.mouseWorld.x, my = g.mouseWorld.y;
    const rowH = 18;
    const colW = 236;
    const maxRows = 9;
    const maxShow = maxRows * 2;
    const shown = Math.min(slots.length, maxShow);
    const cols = shown > maxRows ? 2 : 1;
    const rowsUsed = Math.min(maxRows, shown);
    const bottomY = VIEW_H - 28;
    const panelH = 24 + rowsUsed * rowH;
    const px = 26, py = bottomY - panelH;
    const panelW = colW * cols;

    ctx.save();
    ctx.fillStyle = 'rgba(6,10,15,0.72)';
    roundRectPath(ctx, px - 8, py - 8, panelW + 16, panelH + 12, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,190,220,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* 标题 */
    ctx.font = '700 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#7fd7ea';
    ctx.fillText(`BUILD · ${p.build.length} 件道具`, px, py + 4);

    /* 生效中的组合 */
    this._hoverItem = null;
    if (p.build.comboList.length) {
      let cx2 = px + 118;
      ctx.font = '700 10.5px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = '#c08bff';
      const names = p.build.comboList.slice(0, 3).map(c => c.name).join(' · ');
      const more = p.build.comboList.length > 3 ? ` +${p.build.comboList.length - 3}` : '';
      ctx.fillText('组合 ' + names + more, cx2, py + 4);
    }

    /* 道具行（列优先排布） */
    for (let i = 0; i < shown; i++) {
      const it = ITEM_BY_ID[slots[i].id];
      if (!it) continue;
      const col = i >= maxRows ? 1 : 0;
      const row = i % maxRows;
      const x = px + col * colW;
      const rowY = py + 22 + row * rowH;

      /* 命中矩形（供悬停判定） */
      const inRow = mx >= x - 4 && mx <= x + colW - 12 && my >= rowY - 11 && my <= rowY + 6;
      if (inRow) this._hoverItem = { item: it, n: slots[i].n };

      /* 分类色块 */
      const cat = ITEM_CAT[it.cat] || ITEM_CAT.special;
      ctx.fillStyle = it.color;
      roundRectPath(ctx, x, rowY - 9, 11, 11, 3);
      ctx.fill();

      /* 名称 + 层数 */
      ctx.font = '700 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = inRow ? '#ffffff' : '#d6e3ee';
      const label = it.name + (slots[i].n > 1 ? ` ×${slots[i].n}` : '');
      ctx.fillText(label, x + 16, rowY);

      /* 分类标记 */
      ctx.font = '600 9.5px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = cat.color;
      const nameW = ctx.measureText(label).width;
      ctx.fillText(cat.cn, x + 18 + nameW + 4, rowY);

      if (inRow) {
        ctx.strokeStyle = 'rgba(255,220,150,0.55)';
        ctx.lineWidth = 1;
        roundRectPath(ctx, x - 4, rowY - 11, colW - 12, 17, 4);
        ctx.stroke();
      }
    }

    if (slots.length > maxShow) {
      ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#6d8296';
      ctx.fillText(`+${slots.length - maxShow} 件未显示`, px + colW, py + 4);
    }
    ctx.restore();
  }

  /* 悬停说明浮层 */
  drawItemTooltip(ctx) {
    const h = this._hoverItem;
    if (!h) return;
    const it = h.item;
    const cat = ITEM_CAT[it.cat] || ITEM_CAT.special;
    const combos = this.game.player.build.combosOf(it.id);

    const w = 306;
    const lines = this._wrap(ctx, it.desc, w - 30, 12);
    const boxH = 62 + lines.length * 16 + (combos.length ? 18 + combos.length * 14 : 0);
    let x = this.game.mouseWorld.x + 18;
    let y = this.game.mouseWorld.y - boxH - 12;
    if (x + w > VIEW_W - 12) x = VIEW_W - 12 - w;
    if (y < 12) y = Math.min(VIEW_H - boxH - 12, this.game.mouseWorld.y + 20);

    ctx.save();
    ctx.fillStyle = 'rgba(6,10,15,0.94)';
    roundRectPath(ctx, x, y, w, boxH, 8);
    ctx.fill();
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let ty = y + 22;

    ctx.font = '800 14px "Segoe UI", "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = it.color;
    ctx.fillText(it.name, x + 15, ty);

    ctx.font = '700 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = cat.color;
    const nw = ctx.measureText(it.name).width;
    ctx.fillText(cat.cn + (h.n > 1 ? ` ×${h.n}` : '') + `　上限 ${it.max}`, x + 19 + nw, ty);

    ty += 20;
    ctx.font = '600 12px "Segoe UI", "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = '#c8d8e4';
    for (const ln of lines) { ctx.fillText(ln, x + 15, ty); ty += 16; }

    if (combos.length) {
      ty += 4;
      ctx.font = '700 10.5px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = '#c08bff';
      ctx.fillText('可参与的组合', x + 15, ty);
      ty += 14;
      ctx.font = '600 10.5px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      for (const c of combos) {
        const active = this.game.player.build.comboList.indexOf(c) >= 0;
        ctx.fillStyle = active ? c.color : '#5d6f7e';
        ctx.fillText((active ? '◆ ' : '◇ ') + c.name + '　' + (active ? '已激活' : '需要 ' +
          Object.keys(c.need).map(k => MOD_CN[k] || k).join(' + ')), x + 15, ty);
        ty += 14;
      }
    }
    ctx.restore();
  }

  /* 简单折行（兼容中文：逐字测量） */
  _wrap(ctx, text, maxW, fontPx) {
    ctx.font = `600 ${fontPx}px "Segoe UI", "PingFang SC", system-ui, sans-serif`;
    const out = [];
    let line = '';
    for (const ch of text) {
      const t = line + ch;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = ch; }
      else line = t;
    }
    if (line) out.push(line);
    return out;
  }

  /* ---------------------------------------------------------
     小地图（右上角）
     当前房间 / 已访问 / 未访问 / Boss / 特殊房间
     --------------------------------------------------------- */
  drawMinimap(ctx) {
    const g = this.game;
    const map = g.map;
    if (!map) return;

    const cell = 24;
    const pad = 10;
    const w = map.cols * cell, h = map.rows * cell;
    const ox = VIEW_W - 26 - w, oy = 20;

    ctx.save();
    ctx.fillStyle = 'rgba(6,10,15,0.72)';
    roundRectPath(ctx, ox - pad, oy - pad, w + pad * 2, h + pad * 2 + 4, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,190,220,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const cxOf = (c) => ox + c * cell + cell / 2;
    const cyOf = (r) => oy + r * cell + cell / 2;

    /* 连接线 */
    ctx.strokeStyle = 'rgba(140,180,200,0.35)';
    ctx.lineWidth = 2;
    for (const cd of map.cells) {
      if (!map.isVisited(cd) && cd !== map.current) continue;
      for (const d of DIRS) {
        const n = cd.links[d.side];
        if (!n) continue;
        ctx.beginPath();
        ctx.moveTo(cxOf(cd.c), cyOf(cd.r));
        ctx.lineTo(lerp(cxOf(cd.c), cxOf(n.c), 0.5), lerp(cyOf(cd.r), cyOf(n.r), 0.5));
        ctx.stroke();
      }
    }

    /* 房间格 */
    for (const cd of map.cells) {
      const meta = ROOM_META[cd.type] || ROOM_META.combat;
      const visited = map.isVisited(cd);
      const isCurrent = (cd === map.current);
      const x = ox + cd.c * cell, y = oy + cd.r * cell;
      const s = cell - 7;

      /* 未访问：暗淡轮廓 */
      if (!visited && !isCurrent) {
        ctx.fillStyle = 'rgba(90,110,130,0.12)';
        roundRectPath(ctx, x + 3.5, y + 3.5, s, s, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,150,175,0.28)';
        ctx.lineWidth = 1;
        ctx.stroke();
        continue;
      }

      ctx.globalAlpha = isCurrent ? 1 : (visited ? 0.72 : 0.4);
      ctx.fillStyle = meta.color;
      roundRectPath(ctx, x + 3.5, y + 3.5, s, s, 3);
      ctx.fill();
      ctx.globalAlpha = 1;

      /* 特殊房间字形 */
      if (cd.type !== ROOM_TYPE.COMBAT) {
        ctx.font = '800 11px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#0b1017';
        ctx.fillText(meta.glyph, x + 3.5 + s / 2, y + 3.5 + s / 2 + 0.5);
      }

      /* 当前房间：脉冲高亮 + 中心点 */
      if (isCurrent) {
        const pulse = 0.6 + 0.4 * Math.sin(g.time * 5);
        ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
        ctx.lineWidth = 2.5;
        roundRectPath(ctx, x + 2, y + 2, s + 3, s + 3, 4);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x + 3.5 + s / 2, y + 3.5 + s / 2, 2.4, 0, TAU);
        ctx.fill();
      }
    }

    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#6d8296';
    ctx.fillText(`回廊地图　${Object.keys(map.visited).length}/${map.cells.length}`, ox + w / 2, oy + h + pad + 12);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /* ---- 横幅 ---- */
  drawBanner(ctx) {
    if (!this.banner) return;
    const b = this.banner;
    const t = b.life / b.maxLife;
    const inT = clamp((1 - t) * 5, 0, 1);
    const alpha = clamp(t * 2.2, 0, 1);
    const scale = 0.86 + easeOutCubic(inT) * 0.14;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(VIEW_W / 2, VIEW_H * 0.30);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (b.style === 'clear') {
      ctx.font = '900 58px "Segoe UI", system-ui, sans-serif';
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(b.text, 0, 0);
      const grad = ctx.createLinearGradient(-200, 0, 200, 0);
      grad.addColorStop(0, '#8affc8');
      grad.addColorStop(0.5, '#ffffff');
      grad.addColorStop(1, '#8affc8');
      ctx.fillStyle = grad;
      ctx.fillText(b.text, 0, 0);
    } else {
      ctx.font = '800 34px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(b.text, 0, 0);
      ctx.fillStyle = '#ffd28a';
      ctx.fillText(b.text, 0, 0);
    }

    if (b.sub) {
      ctx.font = '600 14px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = '#9fb6c8';
      ctx.fillText(b.sub, 0, b.style === 'clear' ? 42 : 26);
    }
    ctx.restore();
  }

  /* ---- 准星 ---- */
  drawCrosshair(ctx) {
    const m = this.game.mouseWorld;
    const p = this.game.player;
    const t = this.game.time;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.strokeStyle = p && p.fireTimer > 0 ? 'rgba(255,220,150,0.95)' : 'rgba(150,240,255,0.85)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + t * 0.6;
      ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
      ctx.lineTo(Math.cos(a) * 17, Math.sin(a) * 17);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------
     触屏层：虚拟摇杆 + 屏幕按钮
     --------------------------------------------------------- */
  drawTouchControls(ctx) {
    const t = this.game.input && this.game.input.touch;
    if (t) t.draw(ctx);

    const btns = this.game.touchButtons ? this.game.touchButtons() : [];
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      ctx.save();
      ctx.fillStyle = 'rgba(8,14,20,0.62)';
      roundRectPath(ctx, b.x, b.y, b.w, b.h, 10);
      ctx.fill();
      ctx.strokeStyle = (b.id === 'act') ? 'rgba(255,200,110,0.6)' : 'rgba(120,190,220,0.45)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.fillStyle = (b.id === 'act') ? '#ffd28a' : '#9fe4f5';
      ctx.font = '700 16px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label || '', b.x + b.w / 2, b.y + b.h / 2 + 1);
      ctx.restore();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /* 切到触屏模式时替换操作提示文案 */
  setTouchHint() {
    this.touchHint = '左半屏拖动移动　·　右半屏拖动瞄准并射击　·　按钮交互 / 暂停';
    if (this.elHint) this.elHint.textContent = this.touchHint;
  }
}
