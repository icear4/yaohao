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
    this.hitMark = 0;              // 命中标记（准星回响，命中瞬间点亮）
    this.buildOpen = false;        // 道具面板是否常驻展开（B 键切换）
    this._hpGhost = null;          // 血条的延迟层
    this._mmBottom = 150;          // 小地图信息区底部（增益条从这里往下排）
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
    this.elFlashBtn = document.getElementById('flash-btn');
    this.elActions = document.getElementById('ov-actions');
    this.elPanel = (document.querySelector ? document.querySelector('.panel') : null);
    this.refreshFxBtns();

    this.elBtn.addEventListener('click', () => {
      this.game.primaryAction();
    });

    /* 可滚动面板：滚动时刷新底部渐隐提示 */
    if (this.elText && this.elText.addEventListener) {
      this.elText.addEventListener('scroll', () => this._syncScroll(false));
    }

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
        else if (act === 'menu') { this._askQuit(); }
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
        if (act === 'quit-yes') { this.game.quitToTitle(); return; }
        if (act === 'quit-no') { this.setOverlay(this._quitFrom || 'pause'); return; }
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
    } else if (m === 'pause' || m === 'gameover' || m === 'victory') {
      html = '<button type="button" data-act="menu">返回主菜单</button>';
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

  /* 返回主菜单：先确认一次，避免误触丢掉一整局 */
  _askQuit() {
    const g = this.game;
    this._quitFrom = this.overlayMode;
    const inRun = (g.state === 'paused' || g.state === 'playing');
    const head = inRun ? '放弃本局，返回主菜单？' : '返回主菜单？';
    const body = inRun
      ? '当前这一局的进度不会保存（Build / 金币 / 层数都会丢失）。<br>' +
        '<span style="opacity:.7">本局数据照常计入统计，解锁条件也照常结算。</span>'
      : '<span style="opacity:.7">本局已经结算完毕，可以直接返回主菜单。</span>';
    this.elText.innerHTML =
      '<div class="warn-box">' + head + '<br>' + body + '</div>' +
      '<div class="row-btns">' +
      '<button type="button" class="cc-btn danger" data-act="quit-yes">' +
      (inRun ? '放弃本局' : '返回主菜单') + '</button>' +
      '<button type="button" class="cc-btn" data-act="quit-no">' +
      (inRun ? '继续游戏' : '取消') + '</button></div>';
    /* 确认期间收掉底部按钮，只留面板里的两个选择 */
    if (this.elActions) { this.elActions.innerHTML = ''; this.elActions.style.display = 'none'; }
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

  /* HUD 上的「抖动 / 闪烁」按钮文案 */
  refreshFxBtns() { this.refreshShakeBtn(); this.refreshFlashBtn(); }
  refreshShakeBtn() {
    if (!this.elShakeBtn) return;
    this.elShakeBtn.textContent = '抖动 · ' + this.game.shakeLabel();
  }
  refreshFlashBtn() {
    if (!this.elFlashBtn) return;
    this.elFlashBtn.textContent = '闪烁 · ' + this.game.flashLabel();
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
    /* 角色 / 统计 / 图鉴页面需要更宽的面板，并且正文可滚动 */
    if (this.elPanel && this.elPanel.classList) {
      const wide = (mode === 'chars' || mode === 'stats' || mode === 'codex');
      if (wide) this.elPanel.classList.add('wide');
      else this.elPanel.classList.remove('wide');
      if (wide) this.elPanel.classList.add('tall');
      else this.elPanel.classList.remove('tall');
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
      const kbHint = 'WASD 移动 · 鼠标瞄准 · 左键射击 · E 交互 · B 查看道具 · ESC 暂停 · F 全屏';
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
      this.elHint.textContent = '角色只是不同起手式，没有强弱之分　·　解锁条件见「解锁图鉴」';
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
      this.elHint.textContent = '解锁只拓宽随机池，不给任何局外数值加成　·　列表可滚动（滚轮 / 拖动 / ↑↓）';
      if (this.elSeed) this.elSeed.style.display = 'none';
    }
    /* 可滚动页面：回到顶部 + 刷新「下面还有内容」的渐隐提示 */
    this._syncScroll(true);
  }

  /* 可滚动页面（角色 / 统计 / 图鉴）的滚动状态同步 */
  _syncScroll(reset) {
    const el = this.elText;
    if (!el || !this.elPanel || !this.elPanel.classList) return;
    if (!this.elPanel.classList.contains('tall')) {
      this.elPanel.classList.remove('scrollable-bottom');
      return;
    }
    if (reset && el.scrollTop !== undefined) {
      try { el.scrollTop = 0; } catch (e) { /* 某些环境下只读，忽略 */ }
    }
    const sh = el.scrollHeight || 0, ch = el.clientHeight || 0;
    const st = el.scrollTop || 0;
    const atBottom = (sh - ch - st) < 8;
    this.elPanel.classList.toggle('scrollable-bottom', (sh - ch > 4) && !atBottom);
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
    if (this.hitMark > 0) this.hitMark = Math.max(0, this.hitMark - dt * 4.2);

    /* 血条延迟层：缓慢追平真实血量，让"掉了多少血"看得见 */
    const p = this.game.player;
    if (p) {
      if (this._hpGhost === null) this._hpGhost = p.hp;
      else if (this._hpGhost > p.hp) this._hpGhost = Math.max(p.hp, this._hpGhost - dt * p.maxHp * 0.5);
      else this._hpGhost = p.hp;
    }
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

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    this._drawStatus(ctx, p);      // 左上：生命 / 金币 / 层数 / 房间状态
    this.drawMinimap(ctx);         // 右上：小地图 + SEED + FPS
    this.drawBuffs(ctx);           // 右侧：增益 / 诅咒
    this.drawBossBar(ctx);         // 顶部中央：Boss 血条 + 预警
    this.drawBuildPanel(ctx);      // 左下：道具（悬停或 B 键展开）
    this._drawInteract(ctx);       // 底部中央：交互提示
    this._drawHint(ctx);           // 底部：操作 / 章节提示（渐隐）
    this._drawVignette(ctx, p);    // 受击 / 低血量

    ctx.restore();

    /* 道具说明画在最上层，永远不被其它 HUD 压住 */
    this.drawItemTooltip(ctx);
  }

  /* 统一背板：深底 + 细亮边 → 任何场景底色上都有足够对比度 */
  _panel(ctx, x, y, w, h, r) {
    ctx.fillStyle = 'rgba(4,8,13,0.82)';
    roundRectPath(ctx, x, y, w, h, r === undefined ? 8 : r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,200,225,0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* 带描边的文字（保证在亮/暗底色上都读得清） */
  _outlined(ctx, text, x, y, color) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.82)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /* ---------------------------------------------------------
     左上：状态条（生命 / 金币 / 层数 / 房间状态）
     —— 只占屏幕左上角一小块，不压战斗区
     --------------------------------------------------------- */
  _drawStatus(ctx, p) {
    const g = this.game;
    const x = 16, y = 14, W = 266, H = 56;
    this._panel(ctx, x, y, W, H);

    const bx = x + 11, by = y + 9, bw = W - 22, bh = 18;
    const ratio = clamp(p.hp / p.maxHp, 0, 1);
    const ghost = clamp((this._hpGhost === undefined ? p.hp : this._hpGhost) / p.maxHp, 0, 1);

    /* 槽 */
    ctx.fillStyle = '#241018';
    roundRectPath(ctx, bx, by, bw, bh, 4);
    ctx.fill();

    /* 延迟层：刚掉的血用白色缓慢回落，一眼看出这一击有多疼 */
    if (ghost > ratio + 0.001) {
      ctx.fillStyle = 'rgba(255,255,255,0.48)';
      roundRectPath(ctx, bx, by, Math.max(4, bw * ghost), bh, 4);
      ctx.fill();
    }
    /* 当前血量 */
    if (ratio > 0.001) {
      const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      if (ratio > 0.35) { grad.addColorStop(0, '#ff9d3c'); grad.addColorStop(1, '#ffd98a'); }
      else { grad.addColorStop(0, '#ff2f3e'); grad.addColorStop(1, '#ff8a5c'); }
      ctx.fillStyle = grad;
      roundRectPath(ctx, bx, by, Math.max(4, bw * ratio), bh, 4);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, 4);
    ctx.stroke();

    /* 生命数字 */
    ctx.font = '800 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    this._outlined(ctx, Math.ceil(p.hp) + ' / ' + Math.round(p.maxHp), bx + bw - 7, by + 13.5, '#ffffff');

    /* 第二行：金币 · 层数 · 房间状态 */
    ctx.textAlign = 'left';
    const ty = y + 44;
    ctx.font = '800 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#ffd35e';
    const coinTxt = '◈ ' + g.coins;
    this._outlined(ctx, coinTxt, bx, ty, '#ffd35e');
    const coinW = ctx.measureText(coinTxt).width;

    const ch = ChapterOf(g.floor);
    ctx.font = '700 12px "Segoe UI", "PingFang SC", system-ui, sans-serif';
    const floorTxt = 'F' + g.floor + ' · ' + ch.cn;
    this._outlined(ctx, floorTxt, bx + coinW + 12, ty, ch.pal.accent);
    const floorW = ctx.measureText(floorTxt).width;

    const room = g.room;
    const fighting = !!(room && room.isCombatRoom && room.state !== 'clear');
    const statusTxt = fighting ? ('残形 ' + room.aliveCount()) : (room ? room.meta.cn : '');
    this._outlined(ctx, statusTxt, bx + coinW + floorW + 24, ty, fighting ? '#ff9d6b' : '#7dffb0');
  }

  /* 底部中央：交互提示（靠近可交互物件时才出现） */
  _drawInteract(ctx) {
    const g = this.game;
    if (!g.nearProp || g.nearProp.used) return;
    const txt = (g.touchMode ? '' : 'E · ') + g.nearProp.label;
    ctx.font = '700 14px "Segoe UI", "PingFang SC", system-ui, sans-serif';
    const w = ctx.measureText(txt).width + 26;
    const x = VIEW_W / 2 - w / 2, y = VIEW_H - 74;
    this._panel(ctx, x, y, w, 30, 8);
    ctx.strokeStyle = 'rgba(255,200,110,0.65)';
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, x, y, w, 30, 8);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd28a';
    ctx.fillText(txt, VIEW_W / 2, y + 20);
    ctx.textAlign = 'left';
  }

  /* 底部：操作 / 章节环境提示（淡出，不长期占视野） */
  _drawHint(ctx) {
    const g = this.game;
    if (this.customHintT > 0 && this.customHint) {
      ctx.globalAlpha = clamp(this.customHintT / 2.0, 0, 1);
      ctx.font = '700 13px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = ChapterOf(g.floor).pal.accent;
      ctx.textAlign = 'center';
      ctx.fillText(this.customHint, VIEW_W / 2, VIEW_H - 22);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
      return;
    }
    if (this.hintTimer > 0) {
      ctx.globalAlpha = clamp(this.hintTimer / 2.5, 0, 1);
      ctx.font = '600 12px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = '#6d8296';
      ctx.textAlign = 'center';
      const hint = g.touchMode
        ? '拖动屏幕两侧即可移动与射击'
        : 'WASD 移动　·　鼠标瞄准　·　左键射击　·　E 交互　·　B 查看道具　·　ESC 暂停　·　F 全屏';
      ctx.fillText(hint, VIEW_W / 2, VIEW_H - 22);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }

  /* 受击 / 低血量暗角 */
  _drawVignette(ctx, p) {
    const g = this.game;
    const ratio = clamp(p.hp / p.maxHp, 0, 1);
    if (this.hitVignette > 0) {
      /* 受击红晕也算闪烁，跟着「画面闪烁」档位一起缩放 */
      const fm = (g.flashScale === undefined ? 1 : g.flashScale);
      const a = this.hitVignette * 0.45 * fm;
      if (a > 0.004) {
        const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.28, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.78);
        vg.addColorStop(0, 'rgba(255,40,40,0)');
        vg.addColorStop(1, `rgba(255,40,40,${a})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      }
    }
    if (p.hp > 0 && ratio < 0.3) {
      /* 低血量脉动是生存提示：关掉闪烁时也保留 35%，不至于完全看不见 */
      const lm = (g.hitFlashMul === undefined ? 1 : g.hitFlashMul);
      const pulse = (0.10 + 0.08 * Math.sin(g.time * 6)) * lm;
      const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.3, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.8);
      vg.addColorStop(0, 'rgba(255,0,0,0)');
      vg.addColorStop(1, `rgba(255,0,0,${pulse})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
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
    const bw = 620, bh = 14;
    const bx = cx - bw / 2, by = 26;
    const ratio = clamp(boss.hp / boss.maxHp, 0, 1);
    const col = boss.colors[1] || '#ff4d6b';
    const sub = boss.colors[2] || '#ffffff';

    /* 背板 */
    ctx.fillStyle = 'rgba(4,8,13,0.86)';
    roundRectPath(ctx, bx - 12, by - 23, bw + 24, bh + 46, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,120,140,0.30)';
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
    ctx.fillText(`${Math.ceil(boss.hp)} / ${boss.maxHp}`, bx + bw - 66, by + 11);
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
  buildPanelMetrics(slotsLen, combosLen) {
    const rowH = 19, colW = 206, maxRows = 8;
    const cols = slotsLen > maxRows ? 2 : 1;
    const rows = Math.min(maxRows, Math.ceil(slotsLen / cols));
    return {
      rowH: rowH, colW: colW, maxRows: maxRows, cols: cols, rows: rows,
      w: colW * cols + 16,
      h: 32 + rows * rowH + (combosLen ? 17 : 0)
    };
  }

  toggleBuild() {
    this.buildOpen = !this.buildOpen;
    return this.buildOpen;
  }

  drawBuildPanel(ctx) {
    const g = this.game;
    const p = g.player;
    if (!p || !p.build) return;

    const slots = p.build.slots;
    this._hoverItem = null;
    if (!slots.length) return;

    const mx = g.mouseWorld.x, my = g.mouseWorld.y;
    const combos = p.build.comboList || [];

    /* ---- 常驻：底部左侧一行小色块 ---- */
    const CHIP = 18, GAP = 4, MAX_CHIP = 14;
    const x0 = 20;
    const y0 = VIEW_H - 30;
    const shown = Math.min(slots.length, MAX_CHIP);
    const extra = slots.length - shown;
    const stripW = shown * CHIP + (shown - 1) * GAP + (extra > 0 ? 26 : 0);

    const M = this.buildPanelMetrics(slots.length, combos.length);
    const panelX = x0 - 8, panelY = y0 - 14 - M.h;

    /* 悬停热区：色块条 + 展开面板整体（触屏时靠 B / 按钮固定展开） */
    const inChips = mx >= x0 - 12 && mx <= x0 + stripW + (combos.length ? 50 : 12)
                 && my >= y0 - 12 && my <= y0 + CHIP + 12;
    const inPanel = this.buildOpen &&
                    mx >= panelX && mx <= panelX + M.w && my >= panelY && my <= panelY + M.h;
    const open = this.buildOpen || (inChips && !g.touchMode);

    ctx.save();

    /* ---- 展开面板：图标 + 名称 + 数量 + 分类，鼠标行高亮 ---- */
    if (open) {
      this._panel(ctx, panelX, panelY, M.w, M.h, 8);

      ctx.font = '700 11.5px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#7fd7ea';
      ctx.fillText(`道具 ${p.build.length} 件`, panelX + 9, panelY + 15);
      if (combos.length) {
        ctx.font = '700 10.5px "Segoe UI", "PingFang SC", system-ui, sans-serif';
        ctx.fillStyle = '#c08bff';
        const names = combos.slice(0, 3).map(c => c.name).join(' · ');
        const more = combos.length > 3 ? ` +${combos.length - 3}` : '';
        ctx.fillText('⚡组合 ' + names + more, panelX + 78, panelY + 15);
      }

      for (let i = 0; i < slots.length; i++) {
        const it = ITEM_BY_ID[slots[i].id];
        if (!it) continue;
        const col = Math.floor(i / M.maxRows);
        const row = i % M.maxRows;
        if (col >= M.cols) break;
        const rx = panelX + 9 + col * M.colW;
        const ry = panelY + 34 + row * M.rowH;
        const inRow = (inPanel || inChips) &&
                      mx >= rx - 5 && mx <= rx + M.colW - 14 && my >= ry - 12 && my <= ry + 5;
        if (inRow) this._hoverItem = { item: it, n: slots[i].n };

        const cat = ITEM_CAT[it.cat] || ITEM_CAT.special;
        /* 色块图标 */
        ctx.fillStyle = it.color;
        roundRectPath(ctx, rx, ry - 10, 12, 12, 3);
        ctx.fill();
        ctx.fillStyle = cat.color;
        ctx.fillRect(rx + 2, ry - 8, 4, 4);

        const label = it.name + (slots[i].n > 1 ? ` ×${slots[i].n}` : '');
        ctx.font = '700 12px "Segoe UI", "PingFang SC", system-ui, sans-serif';
        if (inRow) {
          ctx.strokeStyle = 'rgba(255,220,150,0.6)';
          ctx.lineWidth = 1;
          roundRectPath(ctx, rx - 5, ry - 12, M.colW - 14, 18, 4);
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
        } else {
          ctx.fillStyle = '#d6e3ee';
        }
        ctx.fillText(label, rx + 18, ry);
      }

      if (combos.length) {
        ctx.font = '700 10.5px "Segoe UI", "PingFang SC", system-ui, sans-serif';
        ctx.fillStyle = '#c08bff';
        ctx.fillText('◆ 已激活组合 ' + combos.length + ' 条', panelX + 9, panelY + M.h - 5);
      }
    }

    /* ---- 常驻色块条 ---- */
    ctx.globalAlpha = open ? 1 : 0.62;
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
      ctx.strokeStyle = inChip ? 'rgba(255,235,190,0.95)' : 'rgba(10,16,22,0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = cat.color;
      ctx.fillRect(x + 2.5, y0 + 2.5, 3.5, 3.5);
      if (slots[i].n > 1) {
        ctx.font = '800 9px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(8,12,18,0.9)';
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
    ctx.globalAlpha = 1;

    /* 超出显示上限 */
    if (extra > 0) {
      ctx.font = '700 10px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#8fa3b5';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${extra}`, x0 + shown * (CHIP + GAP) + 4, y0 + CHIP / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    }

    /* 道具数 / 组合数徽标（未展开时也能一眼看到） */
    if (!open) {
      const bx = x0 + stripW + 10;
      ctx.font = '700 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#9fb6c8';
      ctx.fillText(`${p.build.length} 件`, bx, y0 + CHIP / 2 + 1);
      if (combos.length) {
        ctx.fillStyle = '#c08bff';
        ctx.fillText(`⚡${combos.length}`, bx + 44, y0 + CHIP / 2 + 1);
      }
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

    const cell = 20;
    const pad = 8;
    const w = map.cols * cell, h = map.rows * cell;
    const ox = VIEW_W - 16 - w, oy = 14;

    ctx.save();
    ctx.fillStyle = 'rgba(4,8,13,0.82)';
    roundRectPath(ctx, ox - pad, oy - pad, w + pad * 2, h + pad * 2, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,200,225,0.24)';
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
      const s = cell - 6;

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
        ctx.font = '800 10px "Segoe UI", system-ui, sans-serif';
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

    /* 右下信息行：地图进度 / SEED / 击杀 / FPS —— 统一右对齐，便于扫一眼 */
    ctx.textAlign = 'right';
    let iy = oy + h + pad + 12;
    ctx.font = '700 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = '#9fb6c8';
    ctx.fillText(`回廊地图 ${map.countableVisited()}/${map.countableRooms()}`, VIEW_W - 16, iy);
    iy += 14;
    ctx.font = '600 10.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(150,175,195,0.8)';
    ctx.fillText(`SEED ${g.seed}　击碎 ${g.kills}`, VIEW_W - 16, iy);
    iy += 13;
    ctx.fillStyle = 'rgba(120,150,170,0.55)';
    ctx.fillText(`${g.fps} FPS`, VIEW_W - 16, iy);
    this._mmBottom = iy + 4;
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

  /* ---- 准星：高对比 + 命中标记 ---- */
  drawCrosshair(ctx) {
    const m = this.game.mouseWorld;
    const p = this.game.player;
    const t = this.game.time;
    ctx.save();
    ctx.translate(m.x, m.y);

    /* 命中标记：四条短线向外张，0.24s 内收干净 */
    if (this.hitMark > 0) {
      const k = this.hitMark;
      const d0 = 7 + (1 - k) * 9;
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#fff3c4';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        ctx.moveTo(Math.cos(a) * d0, Math.sin(a) * d0);
        ctx.lineTo(Math.cos(a) * (d0 + 7), Math.sin(a) * (d0 + 7));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* 外圈：可开火时暖色，冷却中冷色 */
    const ready = p && p.fireTimer <= 0;
    ctx.strokeStyle = ready ? 'rgba(255,232,170,0.95)' : 'rgba(150,240,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, TAU);
    ctx.stroke();

    /* 四角刻度（随时间长转） */
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + t * 0.6;
      ctx.moveTo(Math.cos(a) * 13, Math.sin(a) * 13);
      ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
    }
    ctx.stroke();

    /* 中心点（黑底白点，任何底色上都看得见） */
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 1.7, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------
     增益 / 诅咒：右侧竖向堆叠（跟着小地图下面走，不挡左上与战斗区）
     --------------------------------------------------------- */
  drawBuffs(ctx) {
    const list = this.game.player ? this.game.player.buffs.list : [];
    if (!list.length) return;
    const right = VIEW_W - 16;
    let y = (this._mmBottom || 150) + 10;
    const max = 6;
    for (let i = 0; i < Math.min(list.length, max); i++) {
      const b = list[i];
      const label = b.name + (b.dur > 0 ? ' ' + Math.ceil(b.t) + 's' : '');
      ctx.font = '700 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      const w = Math.min(150, ctx.measureText(label).width + 24);
      const x = right - w;
      ctx.fillStyle = 'rgba(4,8,13,0.82)';
      roundRectPath(ctx, x, y, w, 18, 5);
      ctx.fill();
      ctx.strokeStyle = b.kind === 'curse' ? 'rgba(192,139,255,0.7)' : 'rgba(125,255,176,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = b.color;
      ctx.fillRect(x + 6, y + 6, 4, 6);
      ctx.fillStyle = b.kind === 'curse' ? '#d8c2ff' : '#cfe6d8';
      ctx.fillText(label, x + 14, y + 13);
      /* 剩余时间条 */
      if (b.dur > 0) {
        ctx.fillStyle = b.kind === 'curse' ? 'rgba(192,139,255,0.5)' : 'rgba(125,255,176,0.45)';
        ctx.fillRect(x + 1, y + 17, (w - 2) * clamp(b.t / b.dur, 0, 1), 1.5);
      }
      y += 21;
    }
    if (list.length > max) {
      ctx.font = '700 10px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#8fa3b5';
      ctx.textAlign = 'right';
      ctx.fillText('+' + (list.length - max), right, y + 10);
      ctx.textAlign = 'left';
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
