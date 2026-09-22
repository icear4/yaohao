/* ===========================================================
   secret.js — 隐藏房机制
   1) WallCrack：父房间墙上的可疑裂缝，射击 3 次可击碎
   2) CoinPile：秘室内的金币堆
   隐藏房在地图上不显示，发现后才会连出真正的门
   =========================================================== */
'use strict';

/* -----------------------------------------------------------
   可疑裂缝（画在墙上，只能被子弹打碎）
   ----------------------------------------------------------- */
class WallCrack extends Prop {
  constructor(game, x, y, side, secretCell) {
    super(game, x, y, { r: 18 });
    this.side = side;
    this.secretCell = secretCell;
    this.hitsLeft = 3;
    this.broken = false;
    this.shakeT = 0;
    /* 不参与 E 交互（只能靠射击） */
    this.label = '可疑的裂缝';

    /* 判定中心往房间内侧偏移：裂缝长在墙上，但子弹会在撞墙前就被吃掉，
       所以判定框必须提前伸进房间一段距离，否则永远打不碎 */
    const INWARD = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] };
    const inv = INWARD[side] || [0, 0];
    this.hx = x + inv[0] * 26;
    this.hy = y + inv[1] * 26;
  }

  inRange() { return false; }
  use() { return false; }

  /* 子弹命中判定（矩形区域，中心已向房间内侧偏移） */
  hitTest(x, y, r) {
    if (this.broken) return false;
    const w = this._w(), h = this._h();
    return Math.abs(x - this.hx) <= w / 2 + r && Math.abs(y - this.hy) <= h / 2 + r;
  }

  _w() { return (this.side === 'left' || this.side === 'right') ? 34 : 118; }
  _h() { return (this.side === 'left' || this.side === 'right') ? 118 : 34; }

  onHit(p) {
    if (this.broken || p.crackHit) return false;
    p.crackHit = true;
    this.hitsLeft--;
    this.shakeT = 0.35;
    this.game.particles.burst(p.x, p.y, 8, {
      speed: 160, life: 0.35, size: 3.4, colors: ['#c8d8e4', '#7fe4ff', '#ffffff']
    });
    this.game.damageNumbers.add(this.x, this.y - 26, '裂缝 ' + Math.max(0, this.hitsLeft) + '/3',
      { color: '#9fe4f5', life: 0.8 });
    if (this.hitsLeft <= 0) this.breakOpen();
    return true;
  }

  breakOpen() {
    if (this.broken) return;
    this.broken = true;
    this.game.particles.burst(this.x, this.y, 26, {
      speed: 240, life: 0.8, size: 5, colors: ['#c08bff', '#ffffff', '#ffd35e']
    });
    this.game.particles.ring(this.x, this.y, '#c08bff', 20, 240);
    this.game.addShake(3.5);
    if (this.secretCell) this.game.discoverSecret(this.secretCell);
  }

  update(dt) {
    super.update(dt);
    if (this.shakeT > 0) this.shakeT -= dt;
  }

  draw(ctx) {
    if (this.broken) return;
    const t = this.animT;
    const sh = this.shakeT > 0 ? Math.sin(this.shakeT * 60) * 3 : 0;
    ctx.save();
    ctx.translate(this.x + sh, this.y);
    if (this.side === 'left' || this.side === 'right') ctx.rotate(Math.PI / 2);

    /* 微弱的光晕（几乎看不出来，靠近时才明显） */
    const p = this.game.player;
    const near = p ? Math.max(0, 1 - dist(this.x, this.y, p.x, p.y) / 260) : 0;
    const a = 0.10 + 0.22 * near + 0.05 * Math.sin(t * 2.2);
    const g = ctx.createLinearGradient(-60, 0, 60, 0);
    g.addColorStop(0, 'rgba(192,139,255,0)');
    g.addColorStop(0.5, `rgba(192,139,255,${a})`);
    g.addColorStop(1, 'rgba(192,139,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-60, -17, 120, 34);

    /* 裂纹 */
    ctx.strokeStyle = `rgba(220,235,255,${0.28 + 0.4 * near})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-52, 4);
    for (let i = 0; i <= 8; i++) {
      const px = -52 + i * 13;
      ctx.lineTo(px, Math.sin(i * 1.7 + 0.6) * 7);
    }
    ctx.stroke();

    ctx.strokeStyle = `rgba(160,200,230,${0.14 + 0.24 * near})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-40, -8);
    ctx.lineTo(-14, 2);
    ctx.lineTo(18, -6);
    ctx.lineTo(46, 3);
    ctx.stroke();
    ctx.restore();

    /* 靠近时给个提示 */
    if (near > 0.45) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '600 11px "Segoe UI", "PingFang SC", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(160,200,230,0.75)';
      ctx.fillText('墙上有可疑的裂缝…（射击它）', this.x, this.y + (this.side === 'bottom' ? 40 : 34));
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }
}

/* -----------------------------------------------------------
   金币堆（秘室 / 奖励房）
   ----------------------------------------------------------- */
class CoinPile extends Prop {
  constructor(game, x, y, amount) {
    super(game, x, y, { r: 24 });
    this.amount = amount;
    this.label = '拾取金币';
  }

  use() {
    if (!super.use()) return false;
    this.game.addCoins(this.amount, this.x, this.y);
    this.game.particles.burst(this.x, this.y, 26, {
      speed: 220, life: 0.9, size: 4, colors: ['#ffd35e', '#ffe08a', '#ffffff']
    });
    this.game.particles.ring(this.x, this.y, '#ffd35e', 16, 200);
    return true;
  }

  draw(ctx) {
    const t = this.animT;
    this.drawBase(ctx, this.used ? '#5d6f7e' : '#ffd35e', 0.3);
    if (!this.used) this.drawMarker(ctx, '#ffd35e');

    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.used) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#5d6f7e';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(-8 + i * 8, 8, 9, 5, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }
    /* 三摞金币 */
    for (let i = 0; i < 3; i++) {
      const h = 4 + i * 2;
      const x = -12 + i * 12;
      const y = 10 - h - Math.sin(t * 2.4 + i) * 1.5;
      ctx.fillStyle = i === 1 ? '#ffe08a' : '#ffd35e';
      for (let k = 0; k < h; k++) {
        ctx.beginPath();
        ctx.ellipse(x, y + k * 3, 10 - k * 0.6, 4.4, 0, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(120,80,20,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, y + h * 3, 10 - h * 0.6, 4.4, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.font = '800 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe9c0';
    ctx.fillText('◈' + this.amount, 0, -28);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}
