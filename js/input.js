/* ===========================================================
   input.js — 键盘 / 鼠标输入管理器
   鼠标坐标会被换算回 1280x720 的逻辑世界坐标
   =========================================================== */
'use strict';

class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();       // 当前按住
    this.pressed = new Set();    // 本帧刚按下（每帧末清空）
    this.mouse = { cx: 0, cy: 0, down: false };
    this.mouseWorld = { x: VIEW_W * 0.5, y: VIEW_H * 0.5 };
    this._mv = { x: 0, y: 0 };   // moveVector 的复用对象
    this.touch = new TouchControls(canvas);
    this._bind();
  }

  _bind() {
    const stopKeys = new Set([
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'
    ]);

    window.addEventListener('keydown', (e) => {
      if (stopKeys.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
      if (this.touch) this.touch.releaseAll();
      if (this.onBlur) this.onBlur();
    });

    this.canvas.addEventListener('mousemove', (e) => {
      this.mouse.cx = e.clientX;
      this.mouse.cy = e.clientY;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouse.down = true;
        this.mouse.cx = e.clientX;
        this.mouse.cy = e.clientY;
        if (this.onMouseDown) this.onMouseDown();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  /* 移动向量：键盘方向键 / WASD 与虚拟摇杆合并，结果已归一化（长度 <= 1） */
  moveVector() {
    let mx = 0, my = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) mx -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) mx += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) my -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) my += 1;

    const t = this.touch;
    if (t && t.move.active) { mx += t.move.x; my += t.move.y; }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this._mv.x = mx; this._mv.y = my;
    return this._mv;
  }

  /* 是否正在开火：鼠标左键 或 瞄准摇杆按住 */
  firing() {
    return this.mouse.down || !!(this.touch && this.touch.firing);
  }

  /* 触屏瞄准方向（单位向量），未使用摇杆时返回 null */
  aimDir() {
    const t = this.touch;
    if (!t || !t.aim.active) return null;
    if (t.aim.x === 0 && t.aim.y === 0) return null;
    const len = Math.hypot(t.aim.x, t.aim.y) || 1;
    return { x: t.aim.x / len, y: t.aim.y / len };
  }

  /* 把客户端坐标换算成逻辑世界坐标 */
  toWorld() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return this.mouseWorld;
    this.mouseWorld.x = (this.mouse.cx - r.left) * (VIEW_W / r.width);
    this.mouseWorld.y = (this.mouse.cy - r.top) * (VIEW_H / r.height);
    return this.mouseWorld;
  }

  /* 每帧末调用 */
  endFrame() {
    this.pressed.clear();
  }
}
