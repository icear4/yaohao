/* ===========================================================
   main.js — 启动入口
   =========================================================== */
'use strict';

(function () {
  function boot() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;

    const game = new Game(canvas);

    /* 方便调试：控制台可直接访问 game */
    window.game = game;

    const fsBtn = document.getElementById('fs-btn');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        game.toggleFullscreen();
        fsBtn.blur();
      });
    }

    /* 竖屏提示：可以关掉，关掉后不再弹出 */
    const rhBtn = document.getElementById('rh-btn');
    if (rhBtn) {
      rhBtn.addEventListener('click', () => {
        game.rotateHintDismissed = true;
        const el = document.getElementById('rotate-hint');
        if (el) el.classList.add('hidden');
        rhBtn.blur();
      });
    }

    /* 任意位置的首次触摸都立刻切到触屏模式（包括标题面板上的点击） */
    const onFirstTouch = (e) => {
      if (e.pointerType && e.pointerType !== 'touch') return;
      game._enableTouchMode();
      window.removeEventListener('pointerdown', onFirstTouch, true);
    };
    window.addEventListener('pointerdown', onFirstTouch, true);

    /* 双击页面也可进入/继续（手机上手势兜底） */
    document.addEventListener('dblclick', (e) => {
      if (e.target && e.target.tagName === 'BUTTON') return;
      game.primaryAction();
    });

    game.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
