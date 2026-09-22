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
    this.animT = 0;
    this.customHint = '';          // 章节环境提示（进入新层时短暂显示）
    this.customHintT = 0;

    this.overlay = document.getElementById('overlay');
    this.elKicker = document.getElementById('ov-kicker');
    this.elTitleCn = document.getElementById('ov-title-cn');
    this.elTitleEn = document.getElementById('ov-title-en');
    this.elText = document.getElementById('ov-text');
    this.elBtn = document.getElementById('ov-btn');
    this.elHint = document.getElementById('ov-hint');
    this.elSeed = document.getElementById('seed-input');
    this.elShakeBtn = document.getElementById('shake-btn');
    this.elActions = document.getElementById('ov-actions');
    this.elPanel = (document.querySelector ? document.querySelector('.panel') : null);
    this.refreshShakeBtn();

    this.elBtn.addEventListener('click', () => {
      this.game.primaryAction();
    });

    /* 面板内的动态按钮（角色 / 统计 / 图鉴 / 返回 / 重置存档） */
    if (this.elActions) {
      this.elActions.addEventListener('click', (ev) => {
        const t = ev.target;
        if (!t || !t.getAttribute) return;
        const act = t.getAttribute('data-act');
        if (act === 'chars') this.setOverlay('chars');
        else if (act === 'stats') this.setOverlay('stats');
        else if (act === 'codex') this.setOverlay('codex');
        else if (act === 'back') this.setOverlay('title');
        else if (act === 'reset') { this._askReset(t); }
        else if (act === 'reset-yes') { if (typeof Meta !== 'undefined') Meta.reset(); this.setOverlay('stats'); }
        else if (act === 'reset-no') { this.setOverlay('stats'); }
        if (t.blur) t.blur();
      });
    }

    /* 角色卡片 / 存档确认：统一走一次事件委托 */
    if (this.elText) {
      this.elText.addEventListener('click', (ev) => {
        const t = ev.target;
        if (!t) return;
        const act = this._attrUpTo(t, 'data-act', this.elText);
        if (act === 'reset-yes') {
          if (typeof Meta !== 'undefined') Meta.reset();
          this.setOverlay('stats');
          return;
        }
        if (act === 'reset-no') { this.setOverlay('stats'); return; }
        const id = this._attrUpTo(t, 'data-char', this.elText);
        if (!id) return;
        if (typeof Meta === 'undefined' || !Meta.isCharUnlocked(id)) return;
        Meta.selectChar(id);
        this.game.charId = id;
        if (this.game.player) {
          this.game.player.char = CharacterOf(id);
          if (this.game.player.build) this.game.player.build.recompute();
        }
        this.setOverlay('chars');
      });
    }

    this.setOverlay('title');
  }

  /* 遮罩底部按钮组（按当前面板动态生成） */
  renderActions() {
    if (!this.elActions) return;
    const m = this.overlayMode;
    let html = '';
    if (m === 'title') {
      html =
        '<button type="button" data-act="chars">角色</button>' +
        '<button type="button" data-act="stats">统计</button>' +
        '<button type="button" data-act="codex">解锁图鉴</button>';
    } else if (m === 'chars' || m === 'stats' || m === 'codex') {
      html = '<button type="button" data-act="back">返回</button>';
      if (m === 'stats') html += '<button type="button" data-act="reset" class="danger">清空存档</button>';
    }
    this.elActions.innerHTML = html;
    this.elActions.style.display = html ? '' : 'none';
  }

  _askReset() {
    this.elText.innerHTML =
      '<div class="warn-box">确定清空全部 Meta 存档？<br>' +
      '<span style="opacity:.7">解锁内容、统计、设置都会归零，且无法恢复。</span></div>' +
      '<div class="row-btns">' +
      '<button type="button" class="cc-btn danger" data-act="reset-yes">确认清空</button>' +
      '<button type="button" class="cc-btn" data-act="reset-no">取消</button></div>';
  }

  /* 从点击目标向上找某个属性（DOM 里的卡片 / 按钮嵌套层级不定） */
  _attrUpTo(node, attr, root) {
    let n = node;
    let guard = 0;
    while (n && guard++ < 12) {
      if (n.getAttribute) {
        const v = n.getAttribute(attr);
        if (v) return v;
      }
      if (n === root) break;
      n = n.parentNode;
    }
    return null;
  }

  /* HUD 上的「抖动强度」按钮文案 */
  refreshShakeBtn() {
    if (!this.elShakeBtn) return;
    this.elShakeBtn.textContent = '抖动 · ' + this.game.shakeLabel();
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
    this.renderActions();
    /* 角色 / 统计 / 图鉴页面需要更宽的面板 */
    if (this.elPanel && this.elPanel.classList) {
      const wide = (mode === 'chars' || mode === 'stats' || mode === 'codex');
      if (wide) this.elPanel.classList.add('wide');
      else this.elPanel.classList.remove('wide');
    }
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
        '你是拾火者。穿过 <b>五层回廊</b>，击败每一层的守望者，<br>' +
        '直到星界核心停止搏动。<br><br>' +
        '<span style="color:#8fa3b5">废弃庭院 → 机械矿井 → 腐化森林 → 虚空遗迹 → 星界核心</span><br>' +
        '<span style="color:#6b7c8c;font-size:12px">局外成长只解锁「新的可能性」，不会让你变得更强 —— 每一局的强度仍然只来自随机到的 Build</span>';
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
        `层数　<b>第 ${g.floor} 层 · ${this.chapterName(g)}</b><br>` +
        `金币　<b>${g.coins}</b><br>` +
        `已探索　<b>${Object.keys(g.map ? g.map.visited : {}).length} / ${g.map ? g.map.cells.length : 0}</b> 间<br>` +
        `持有道具　<b>${g.player ? g.player.build.length : 0}</b> 件<br>` +
        `<span style="color:#8fa3b5">${this.buildSummary(g)}</span>`;
      this.elBtn.textContent = '继续';
      this.elHint.textContent = 'R 重新开始 · ESC 继续';
      if (this.elSeed) this.elSeed.style.display = 'none';
    } else if (mode === 'victory') {
      const bosses = (g.bossDefeated && g.bossDefeated.length)
        ? g.bossDefeated.join(' → ') : '—';
      this.elKicker.textContent = 'THE RIFT FALLS SILENT';
      this.elTitleCn.textContent = '回廊终结';
      this.elTitleEn.textContent = 'RUN COMPLETE';
      this.elText.innerHTML =
        `SEED　<b>${g.seed}</b><br>` +
        `路线　<b>${this.chapterRoute(g)}</b><br>` +
        `击败首领　<b>${bosses}</b><br>` +
        `击碎残形　<b>${g.kills}</b>　用时　<b>${this.fmtTime(g.runTime)}</b>　金币　<b>${g.coins}</b><br>` +
        `持有道具　<b>${g.player ? g.player.build.length : 0}</b> 件<br>` +
        `<span style="color:#8fa3b5">${this.buildSummary(g)}</span>`;
      this.elBtn.textContent = '再来一局';
      this.elHint.textContent = '按 R 也可以重来（可先改 Seed）';
      if (this.elSeed) this.elSeed.style.display = '';
    } else if (mode === 'gameover') {
      this.elKicker.textContent = 'EMBER EXTINGUISHED';
      this.elTitleCn.textContent = '火种熄灭';
      this.elTitleEn.textContent = 'RUN OVER';
      this.elText.innerHTML =
        `SEED　<b>${g.seed}</b><br>` +
        `抵达　<b>第 ${g.floor} 层 · ${this.chapterName(g)} · ${g.roomTypeName()}</b><br>` +
        `击碎残形　<b>${g.kills}</b>　射出弹丸　<b>${g.player ? g.player.shotsFired : 0}</b><br>` +
        `持有道具　<b>${g.player ? g.player.build.length : 0}</b> 件<br>` +
        `<span style="color:#8fa3b5">${this.buildSummary(g)}</span>`;
      this.elBtn.textContent = '重新开始';
      this.elHint.textContent = '按 R 也可以重来（可先改 Seed）';
      if (this.elSeed) this.elSeed.style.display = '';
    } else if (mode === 'chars') {
      this.elKicker.textContent = 'CHOOSE YOUR EMBER';
      this.elTitleCn.textContent = '角色';
      this.elTitleEn.textContent = 'CHARACTERS';
      this.elText.innerHTML = this.charSelectHtml();
      this.elBtn.textContent = '开始探索';
      this.elHint.textContent = '角色只是不同起手式，没有强弱之分 · 解锁条件见「解锁图鉴」';
      if (this.elSeed) this.elSeed.style.display = '';
    } else if (mode === 'stats') {
      this.elKicker.textContent = 'LIFETIME RECORDS';
      this.elTitleCn.textContent = '统计';
      this.elTitleEn.textContent = 'STATISTICS';
      this.elText.innerHTML = this.statsHtml();
      this.elBtn.textContent = '返回标题';
      this.elHint.textContent = '数据保存在本机 localStorage · 不会上传';
      if (this.elSeed) this.elSeed.style.display = 'none';
    } else if (mode === 'codex') {
      this.elKicker.textContent = 'UNLOCK CODEX';
      this.elTitleCn.textContent = '解锁图鉴';
      this.elTitleEn.textContent = 'CODEX';
      this.elText.innerHTML = this.codexHtml();
      this.elBtn.textContent = '返回标题';
      this.elHint.textContent = '解锁只拓宽随机池，不给任何局外数值加成';
      if (this.elSeed) this.elSeed.style.display = 'none';
    }
  }

  /* ---------------- 角色选择页 ---------------- */
  charSelectHtml() {
    const cur = (typeof Meta !== 'undefined') ? Meta.selectedChar() : 'ember';
    const out = [];
    for (const c of CHARACTERS) {
      const ok = (typeof Meta === 'undefined') ? !c.locked : Meta.isCharUnlocked(c.id);
      const sel = (c.id === cur);
      const b = c.base;
      out.push(
        '<div class="char-card' + (sel ? ' sel' : '') + (ok ? '' : ' locked') + '"' +
        (ok ? ' data-char="' + c.id + '"' : '') + '>' +
        '<div class="cc-head"><span class="cc-name">' + c.name + '</span>' +
        '<span class="cc-en">' + c.en + '</span>' +
        (sel ? '<span class="cc-badge">使用中</span>' : (ok ? '' : '<span class="cc-badge lock">未解锁</span>')) +
        '</div>' +
        '<div class="cc-tag">' + c.tag + '</div>' +
        '<div class="cc-desc">' + (ok ? c.desc : '???') + '</div>' +
        '<div class="cc-abil"><b>能力</b>　' + (ok ? c.ability : '???') + '</div>' +
        '<div class="cc-stats">' +
        (ok
          ? ('生命 <b>' + b.maxHp + '</b>　攻击 <b>' + b.damage + '</b>　射速 <b>' +
            (1 / b.fireInterval).toFixed(1) + '/s</b>　移速 <b>' + b.moveSpeed + '</b>')
          : ('生命 <b>?</b>　攻击 <b>?</b>　射速 <b>?</b>　移速 <b>?</b>')) +
        '</div>' +
        (ok ? '' : '<div class="cc-cond">解锁条件 · ' + this.unlockCondOf('char', c.id) + '</div>') +
        '</div>'
      );
    }
    return '<div class="char-grid">' + out.join('') + '</div>';
  }

  unlockCondOf(kind, id) {
    const u = (typeof UNLOCK_BY !== 'undefined') ? UNLOCK_BY[kind + ':' + id] : null;
    return u ? u.cond : '—';
  }

  /* ---------------- 统计页 ---------------- */
  statsHtml() {
    const s = (typeof Meta !== 'undefined') ? Meta.stats : null;
    if (!s) return '<div class="warn-box">统计不可用</div>';
    const row = (k, v) => '<div class="stat"><span>' + k + '</span><b>' + v + '</b></div>';
    const beaten = (typeof Meta !== 'undefined') ? Meta.beatenBosses() : [];
    const beatenNames = beaten.map(id => BossRoster.nameOf(id));
    return '<div class="stat-grid">' +
      row('游戏次数', s.runs) +
      row('死亡次数', s.deaths) +
      row('通关次数', s.wins) +
      row('Boss 击杀', s.bossKills) +
      row('总击杀', s.kills) +
      row('累计金币', s.coins) +
      row('最远层数', '第 ' + s.bestFloor + ' 层') +
      row('最长生存', this.fmtTime(s.bestTime)) +
      row('累计游玩', this.fmtTime(s.time)) +
      row('已击败首领', (typeof Meta !== 'undefined') ? (Meta.data.beaten.length + ' / ' + BossRoster.list.length) : '—') +
      '</div>' +
      '<div class="codex-note">' +
      (beatenNames.length ? ('击败过的首领：<b>' + beatenNames.join('、') + '</b>') : '尚未击败任何首领') +
      '</div>';
  }

  /* ---------------- 解锁图鉴 ---------------- */
  codexHtml() {
    if (typeof Meta === 'undefined') return '<div class="warn-box">不可用</div>';
    const KIND = { char: '角色', item: '道具', event: '房间事件', boss: '首领' };
    const groups = {};
    for (const c of Meta.codex()) {
      (groups[c.kind] = groups[c.kind] || []).push(c);
    }
    const out = [];
    for (const k of ['char', 'item', 'event', 'boss']) {
      const list = groups[k];
      if (!list || !list.length) continue;
      const got = list.filter(c => c.got).length;
      out.push('<div class="cdx-group"><div class="cdx-title">' + KIND[k] +
        '　<span>' + got + ' / ' + list.length + '</span></div>');
      for (const c of list) {
        const pct = Math.round(clamp(c.cur / Math.max(1, c.need), 0, 1) * 100);
        out.push('<div class="cdx-row' + (c.got ? ' got' : '') + '">' +
          '<span class="cdx-name">' + (c.got ? c.name : '???') + '</span>' +
          '<span class="cdx-cond">' + c.cond + '</span>' +
          '<span class="cdx-bar"><i style="width:' + (c.got ? 100 : pct) + '%"></i></span>' +
          '<span class="cdx-pct">' + (c.got ? '已解锁' : pct + '%') + '</span>' +
          '</div>');
      }
      out.push('</div>');
    }
    return out.join('');
  }

  /* 读取玩家输入的 Seed（空则随机） */
  readSeedInput() {
    if (!this.elSeed) return '';
    return (this.elSeed.value || '').trim().toUpperCase();
  }

  /* 当前章节名（如「机械矿井」） */
  chapterName(g) {
    const ch = ChapterOf(g ? g.floor : 1);
    return ch ? ch.cn : '';
  }

  /* 结算用：完整路线（第1层 废弃庭院 → …… → 第5层 星界核心） */
  chapterRoute(g) {
    const out = [];
    for (const ch of CHAPTERS) {
      const reached = (g && g.floor >= ch.id);
      out.push((reached ? '' : '<span style="opacity:0.4">') +
        `${ch.id}·${ch.cn}` + (reached ? '' : '</span>'));
    }
    return out.join(' → ');
  }

  /* 秒 → mm:ss */
  fmtTime(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  /* ---------------------------------------------------------
     横幅
     --------------------------------------------------------- */
  /* 章节环境提示（进入新层时短暂显示） */
  showHint(text, dur) {
    this.customHint = text || '';
    this.customHintT = dur || 5;
  }

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
    this.animT += dt;
    if (this.hintTimer > 0) this.hintTimer -= dt;
    if (this.customHintT > 0) {
      this.customHintT -= dt;
      if (this.customHintT <= 0) this.customHint = '';
    }
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
    ctx.fillText((p.char ? p.char.name + ' · ' + p.char.en : '拾火者 · EMBER'), bx, by - 7);

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
    ctx.fillText(`◈ ${g.coins} 金币`, bx, by + 40);

    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    const roomName = g.room ? g.room.meta.cn : '-';
    const alive = g.room ? g.room.aliveCount() : 0;
    const statusTxt = (g.room && g.room.isCombatRoom)
      ? (g.room.state === 'clear' ? '已肃清 · 门已开启' : `残形剩余 ${alive}`)
      : '可自由通行';
    ctx.fillStyle = (g.room && g.room.isCombatRoom && g.room.state !== 'clear') ? '#ff9d6b' : '#7dffb0';
    const chCn = this.chapterName(g);
    ctx.fillText(`第 ${g.floor} 层 · ${chCn} · ${roomName} · ${statusTxt}`, bx + 88, by + 40);

    ctx.fillStyle = '#5d6f7e';
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`SEED ${g.seed}　击碎 ${g.kills}　${playerStatsText(p)}`, bx, by + 58);

    /* 章节进度：五章小圆点（当前章节点亮） */
    const dotY = by + 74;
    let dotX = bx + 168;
    for (const ch of CHAPTERS) {
      const cur = (ch.id === g.floor);
      const done = (ch.id < g.floor);
      ctx.fillStyle = cur ? ch.pal.accent : (done ? 'rgba(160,190,210,0.55)' : 'rgba(120,150,170,0.22)');
      ctx.beginPath();
      ctx.arc(dotX, dotY, cur ? 4.5 : 3, 0, TAU);
      ctx.fill();
      dotX += 15;
    }

    /* ---- 增益 / 诅咒条 ---- */
    this.drawBuffs(ctx, bx, by + 76);

    /* ---- 右上：小地图 ---- */
    this.drawMinimap(ctx);

    /* ---- 顶部中央：Boss 血条 + 阶段 + 攻击预警 ---- */
    this.drawBossBar(ctx);

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

    /* ---- 底部操作提示 / 章节环境提示（渐隐） ---- */
    if (this.hintTimer > 0 || this.customHintT > 0) {
      if (this.customHintT > 0) {
        ctx.globalAlpha = clamp(this.customHintT / 2.0, 0, 1);
        ctx.font = '700 13px "Segoe UI", "PingFang SC", system-ui, sans-serif';
        ctx.fillStyle = ChapterOf(g.floor).pal.accent;
        ctx.textAlign = 'center';
        ctx.fillText(this.customHint, VIEW_W / 2, VIEW_H - 22);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      } else {
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
  /* ---------------------------------------------------------
     Boss 血条：名称 / 阶段 / HP / 阶段阈值刻度 / 攻击预警
     —— Boss 战的关键可读性：当前在打什么、处在第几阶段、下一招是什么
     --------------------------------------------------------- */
  drawBossBar(ctx) {
    const g = this.game;
    if (!g || !g.room) return;
    let boss = null;
    for (const e of g.room.enemies) {
      if (e.isBoss && !e.dead) { boss = e; break; }
    }
    if (!boss) return;

    const cx = VIEW_W / 2;
    const bw = 660, bh = 16;
    const bx = cx - bw / 2, by = 30;
    const ratio = clamp(boss.hp / boss.maxHp, 0, 1);
    const col = boss.colors[1] || '#ff4d6b';
    const sub = boss.colors[2] || '#ffffff';

    /* 背板 */
    ctx.fillStyle = 'rgba(6,10,15,0.78)';
    roundRectPath(ctx, bx - 12, by - 24, bw + 24, bh + 50, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,120,140,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* 名称 + 阶段 */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '800 14px "Segoe UI", "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = col;
    ctx.fillText(boss.name || '守望者', bx, by - 8);

    ctx.font = '700 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = sub;
    const pname = boss.phaseNames ? boss.phaseNames[boss.phase - 1] : '';
    ctx.fillText(`第 ${boss.phase} 阶段 · ${pname}`, bx + ctx.measureText(boss.name || '守望者').width + 90, by - 8);

    /* 阶段点 */
    for (let i = 0; i < 3; i++) {
      const px = bx + bw - 12 - (2 - i) * 16;
      const on = i < boss.phase;
      ctx.fillStyle = on ? col : 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(px, by - 12, 4.5, 0, TAU);
      ctx.fill();
    }

    /* 血条 */
    ctx.fillStyle = '#241018';
    roundRectPath(ctx, bx, by, bw, bh, 5);
    ctx.fill();

    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, boss.colors[0] || '#4a2b52');
    grad.addColorStop(0.35, col);
    grad.addColorStop(1, sub);
    ctx.fillStyle = grad;
    if (ratio > 0.001) {
      roundRectPath(ctx, bx, by, bw * ratio, bh, 5);
      ctx.fill();
    }

    /* 阶段阈值刻度（70% / 40%）：让玩家知道什么时候会变招 */
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    for (const gate of [0.70, 0.40]) {
      const gx = bx + bw * gate;
      ctx.beginPath();
      ctx.moveTo(gx, by - 2);
      ctx.lineTo(gx, by + bh + 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, 5);
    ctx.stroke();

    ctx.textAlign = 'right';
    ctx.font = '800 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#ffe9c0';
    ctx.fillText(`${Math.ceil(boss.hp)} / ${boss.maxHp}`, bx + bw - 66, by + 13);
    ctx.textAlign = 'left';

    /* 攻击预警：当前招式名 / 阶段转换提示 */
    let warn = null;
    if (boss.phaseLock > 0) warn = '阶段转换 · 攻击更快，弹幕更密';
    else if (boss.dying) warn = '陨落中';
    else if (boss.telegraphText) warn = boss.telegraphText;

    ctx.textAlign = 'center';
    if (warn) {
      const pulse = 0.72 + 0.28 * Math.sin(this.animT * 9);
      ctx.globalAlpha = boss.dying ? 0.8 : pulse;
      ctx.font = '800 15px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = boss.dying ? '#ffd35e' : '#ff9d6b';
      ctx.fillText('▲ ' + warn, cx, by + bh + 18);
      ctx.globalAlpha = 1;
    } else {
      ctx.font = '600 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = '#6d8296';
      ctx.fillText('特殊技能：' + (boss.specialName || '-'), cx, by + bh + 18);
    }
    ctx.textAlign = 'left';
  }

  /* ---------------------------------------------------------
     Build 面板（左下）
     --------------------------------------------------------- */
  drawBuildPanel(ctx) {
    const g = this.game;
    const p = g.player;
    if (!p || !p.build) return;

    const slots = p.build.slots;
    this._hoverItem = null;
    if (!slots.length) return;

    const mx = g.mouseWorld.x, my = g.mouseWorld.y;
    const combos = p.build.comboList || [];

    /* ---- 布局：单行紧凑色块条，贴在左下角 ---- */
    const CHIP = 17, GAP = 4, MAX_CHIP = 14;
    const x0 = 26;
    const y0 = VIEW_H - 32;                       // 色块顶边
    const shown = Math.min(slots.length, MAX_CHIP);
    const extra = slots.length - shown;
    let stripW = shown * CHIP + (shown - 1) * GAP + (extra > 0 ? 30 : 0);

    /* 悬停热区（略放大好进入） */
    const hot = mx >= x0 - 10 && mx <= x0 + stripW + (combos.length ? 74 : 10)
             && my >= y0 - 14 && my <= y0 + CHIP + 14;

    ctx.save();

    /* ---- 悬停时才展开完整列表（平时不占视野） ---- */
    if (hot && !g.touchMode) {
      const rowH = 17, colW = 214, maxRows = 8;
      const cols = slots.length > maxRows ? 2 : 1;
      const rows = Math.min(maxRows, Math.ceil(slots.length / cols));
      const panelH = 26 + rows * rowH;
      const px2 = x0 - 8, py2 = y0 - 12 - panelH;

      ctx.fillStyle = 'rgba(6,10,15,0.88)';
      roundRectPath(ctx, px2, py2, colW * cols + 16, panelH, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,190,220,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = '700 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#7fd7ea';
      ctx.fillText(`BUILD · ${p.build.length} 件道具`, px2 + 8, py2 + 15);

      if (combos.length) {
        ctx.font = '700 10.5px "Segoe UI", "PingFang SC", system-ui, sans-serif';
        ctx.fillStyle = '#c08bff';
        const names = combos.slice(0, 3).map(c => c.name).join(' · ');
        const more = combos.length > 3 ? ` +${combos.length - 3}` : '';
        ctx.fillText('组合 ' + names + more, px2 + 126, py2 + 15);
      }

      for (let i = 0; i < slots.length; i++) {
        const it = ITEM_BY_ID[slots[i].id];
        if (!it) continue;
        const col = Math.floor(i / maxRows);
        const row = i % maxRows;
        if (col >= cols) break;
        const rx = px2 + 8 + col * colW;
        const ry = py2 + 32 + row * rowH;
        const inRow = mx >= rx - 4 && mx <= rx + colW - 12 && my >= ry - 10 && my <= ry + 5;
        if (inRow) this._hoverItem = { item: it, n: slots[i].n };

        ctx.fillStyle = it.color;
        roundRectPath(ctx, rx, ry - 9, 10, 10, 3);
        ctx.fill();

        const label = it.name + (slots[i].n > 1 ? ` ×${slots[i].n}` : '');
        ctx.font = '700 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
        ctx.fillStyle = inRow ? '#ffffff' : '#d6e3ee';
        ctx.fillText(label, rx + 15, ry);
        if (inRow) {
          ctx.strokeStyle = 'rgba(255,220,150,0.55)';
          ctx.lineWidth = 1;
          roundRectPath(ctx, rx - 4, ry - 10, colW - 12, 16, 4);
          ctx.stroke();
        }
      }
    }

    /* ---- 常驻：一行小色块（半透明，鼠标移近才变亮） ---- */
    ctx.globalAlpha = hot ? 1 : 0.6;
    for (let i = 0; i < shown; i++) {
      const it = ITEM_BY_ID[slots[i].id];
      if (!it) continue;
      const x = x0 + i * (CHIP + GAP);
      const inChip = mx >= x - 2 && mx <= x + CHIP + 2 && my >= y0 - 6 && my <= y0 + CHIP + 6;
      if (inChip) this._hoverItem = { item: it, n: slots[i].n };

      const cat = ITEM_CAT[it.cat] || ITEM_CAT.special;
      ctx.fillStyle = it.color;
      roundRectPath(ctx, x, y0, CHIP, CHIP, 4);
      ctx.fill();
      ctx.strokeStyle = inChip ? 'rgba(255,235,190,0.9)' : 'rgba(10,16,22,0.75)';
      ctx.lineWidth = 1;
      ctx.stroke();

      /* 左上小角标 = 分类色；堆叠数画在方块右下 */
      ctx.fillStyle = cat.color;
      ctx.fillRect(x + 2.5, y0 + 2.5, 3.5, 3.5);
      if (slots[i].n > 1) {
        ctx.font = '800 9px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(8,12,18,0.85)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(slots[i].n), x + CHIP - 5, y0 + CHIP - 5);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
      if (inChip) {
        ctx.strokeStyle = 'rgba(255,225,160,0.9)';
        ctx.lineWidth = 1.4;
        roundRectPath(ctx, x - 2, y0 - 2, CHIP + 4, CHIP + 4, 5);
        ctx.stroke();
      }
    }

    /* 超出显示上限 */
    if (extra > 0) {
      ctx.font = '700 10px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#8fa3b5';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${extra}`, x0 + shown * (CHIP + GAP) + 4, y0 + CHIP / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    }

    /* 组合数小徽标 */
    if (combos.length) {
      const bx = x0 + stripW + 10;
      ctx.font = '700 10px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = '#c08bff';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⚡${combos.length}`, bx, y0 + CHIP / 2 + 1);
      ctx.textBaseline = 'alphabetic';
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
      if (cd.hidden && !cd.discovered) continue;
      if (!map.isVisited(cd) && cd !== map.current) continue;
      for (const d of DIRS) {
        const n = cd.links[d.side];
        if (!n) continue;
        if (n.hidden && !n.discovered) continue;
        ctx.beginPath();
        ctx.moveTo(cxOf(cd.c), cyOf(cd.r));
        ctx.lineTo(lerp(cxOf(cd.c), cxOf(n.c), 0.5), lerp(cyOf(cd.r), cyOf(n.r), 0.5));
        ctx.stroke();
      }
    }

    /* 房间格（未发现的隐藏房不显示） */
    for (const cd of map.cells) {
      if (cd.hidden && !cd.discovered) continue;
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
    ctx.fillText(`回廊地图　${map.countableVisited()}/${map.countableRooms()}`, ox + w / 2, oy + h + pad + 12);
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
     增益 / 诅咒条（左上角第三行）
     --------------------------------------------------------- */
  drawBuffs(ctx, x, y) {
    const list = this.game.player ? this.game.player.buffs.list : [];
    if (!list.length) return;
    let cx = x;
    for (const b of list.slice(0, 8)) {
      const label = b.name + (b.dur > 0 ? ' ' + Math.ceil(b.t) + 's' : '');
      ctx.font = '600 10.5px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      const w = ctx.measureText(label).width + 18;
      if (cx + w > VIEW_W * 0.42) break;
      ctx.fillStyle = 'rgba(6,10,15,0.72)';
      roundRectPath(ctx, cx, y - 10, w, 17, 5);
      ctx.fill();
      ctx.strokeStyle = b.kind === 'curse' ? 'rgba(192,139,255,0.55)' : 'rgba(125,255,176,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = b.color;
      ctx.fillRect(cx + 5, y - 5, 5, 7);
      ctx.fillStyle = b.kind === 'curse' ? '#d8c2ff' : '#cfe6d8';
      ctx.fillText(label, cx + 13, y + 2.5);
      cx += w + 6;
    }
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
