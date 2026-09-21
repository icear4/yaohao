/* ===========================================================
   utils.js — 全局常量与数学 / 绘图工具
   =========================================================== */
'use strict';

/* 逻辑分辨率（所有游戏坐标都基于这个尺寸） */
const VIEW_W = 1280;
const VIEW_H = 720;

/* 房间墙厚与门宽 */
const WALL_T = 44;
const DOOR_W = 132;

/* 房间内部可行走区域 */
const ARENA = {
  x: WALL_T,
  y: WALL_T,
  w: VIEW_W - WALL_T * 2,
  h: VIEW_H - WALL_T * 2
};

const TAU = Math.PI * 2;

function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
function chance(p) { return Math.random() < p; }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

function dist(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}
function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}
function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }

/* 角度插值（走最短弧） */
function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
}

/* 确定性哈希，用于地板花纹等（保证同一房间每次一致） */
function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/* 缓动 */
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/* 圆角矩形路径 */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/* 多边形路径（用于绘制楔形 / 棱形） */
function polygonPath(ctx, points) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
}

/* ===========================================================
   种子随机数系统
   —— 地图 / 房间类型 / 敌人 / 道具 / 宝箱 使用 Rng（可复现）
   —— 粒子、抖动等表现层随机继续用 Math.random，不影响复现性
   =========================================================== */
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  str = String(str);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

class Rng {
  constructor(seed) {
    const s = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
    this.s = s === 0 ? 1 : s;
  }
  /* mulberry32 */
  next() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + this.next() * (b - a); }
  int(a, b) { return Math.floor(a + this.next() * (b - a + 1)); }   // 闭区间
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  fork(salt) { return new Rng(hashSeed(this.s + '|' + String(salt))); }
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomSeedString(len) {
  len = len || 6;
  let s = '';
  for (let i = 0; i < len; i++) {
    s += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
  }
  return s;
}
