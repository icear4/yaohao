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

    game.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
