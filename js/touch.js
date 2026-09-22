/* ===========================================================
   touch.js — 移动端触控（虚拟双摇杆 + 屏幕按钮）
   左半屏：移动摇杆
   右半屏：瞄准摇杆（按住即持续射击）
   所有坐标都换算成 1280x720 的逻辑世界坐标，与画布缩放完全解耦
   =========================================================== */
'use strict';

class TouchControls {
  constructor(canvas) {
    this.canvas = canvas;
    this.active = false;             // 是否处于触屏模式（首次真实触摸后置真）
    this.radius = 84;                // 摇杆半径（逻辑坐标）
    this.deadZone = 0.12;            // 归一化死区
    this.firing = false;

    this.move = { id: null, x: 0, y: 0, ax: 0, ay: 0, active: false };
    this.aim = { id: null, x: 0, y: 0, ax: 0, ay: 0, active: false };

    this.buttonsFn = null;           // () => [{ id, x, y, w, h }]
    this.onButton = null;            // (id) => void

    this._bind();
  }

  /* 客户端坐标 → 逻辑世界坐标（画布被 CSS transform 缩放也能正确换算） */
  _toWorld(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return { x: 0, y: 0 };
    return {
      x: (cx - r.left) * (VIEW_W / r.width),
      y: (cy - r.top) * (VIEW_H / r.height)
    };
  }

  _bind() {
    const c = this.canvas;
    if (!c || !c.addEventListener) return;

    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;      // 鼠标走原有逻辑
      const p = this._toWorld(e.clientX, e.clientY);
      this.onDown(e.pointerId, p.x, p.y);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') return;
      const p = this._toWorld(e.clientX, e.clientY);
      this.onMove(e.pointerId, p.x, p.y);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    const up = (e) => { if (e.pointerType !== 'mouse') this.onUp(e.pointerId); };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /* ---------- 供事件与测试调用的三件套 ---------- */
  onDown(id, wx, wy) {
    this.active = true;

    /* 屏幕按钮优先：落在按钮上就不起摇杆 */
    const btns = this.buttonsFn ? this.buttonsFn() : [];
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) {
        if (this.onButton) this.onButton(b.id);
        return;
      }
    }

    if (wx < VIEW_W * 0.5) {
      if (this.move.id !== null) return;
      this.move.id = id;
      this.move.ax = wx; this.move.ay = wy;
      this.move.x = 0; this.move.y = 0; this.move.active = true;
    } else {
      if (this.aim.id !== null) return;
      this.aim.id = id;
      this.aim.ax = wx; this.aim.ay = wy;
      this.aim.x = 0; this.aim.y = 0; this.aim.active = true;
      this.firing = true;
    }
  }

  onMove(id, wx, wy) {
    const st = (id === this.move.id) ? this.move
      : (id === this.aim.id) ? this.aim : null;
    if (!st) return;

    const dx = wx - st.ax, dy = wy - st.ay;
    const len = Math.hypot(dx, dy);
    const mag = Math.min(1, len / this.radius);
    if (mag < this.deadZone || len <= 0) { st.x = 0; st.y = 0; return; }
    st.x = (dx / len) * mag;
    st.y = (dy / len) * mag;
  }

  onUp(id) {
    if (id === this.move.id) {
      this.move.id = null; this.move.active = false; this.move.x = 0; this.move.y = 0;
    }
    if (id === this.aim.id) {
      this.aim.id = null; this.aim.active = false; this.aim.x = 0; this.aim.y = 0;
      this.firing = false;
    }
  }

  releaseAll() {
    this.move.id = null; this.move.active = false; this.move.x = 0; this.move.y = 0;
    this.aim.id = null; this.aim.active = false; this.aim.x = 0; this.aim.y = 0;
    this.firing = false;
  }

  /* ---------- 绘制 ---------- */
  draw(ctx) {
    if (!this.active) return;
    this._stick(ctx, this.move, '127,215,234');
    this._stick(ctx, this.aim, '255,179,71');
  }

  _stick(ctx, st, rgb) {
    if (!st.active) return;
    const R = this.radius;
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = 'rgba(' + rgb + ',0.16)';
    ctx.beginPath();
    ctx.arc(st.ax, st.ay, R, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = 'rgba(' + rgb + ',0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.globalAlpha = 0.72;
    ctx.fillStyle = 'rgba(' + rgb + ',0.72)';
    ctx.beginPath();
    ctx.arc(st.ax + st.x * R, st.ay + st.y * R, R * 0.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
