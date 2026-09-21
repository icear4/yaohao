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
