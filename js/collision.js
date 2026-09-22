/* ===========================================================
   collision.js — 碰撞检测与分离
   全部基于「圆 vs 圆」「圆 vs 矩形」
   =========================================================== */
'use strict';

const Collision = {

  /* 圆 vs 圆：是否相交 */
  circleCircle(ax, ay, ar, bx, by, br) {
    const dx = bx - ax, dy = by - ay;
    const r = ar + br;
    return dx * dx + dy * dy <= r * r;
  },

  /* 圆 vs 矩形：是否相交 */
  circleRect(cx, cy, r, rect) {
    const nx = clamp(cx, rect.x, rect.x + rect.w);
    const ny = clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  },

  /* 点是否在矩形内 */
  pointInRect(px, py, rect) {
    return px >= rect.x && px <= rect.x + rect.w &&
           py >= rect.y && py <= rect.y + rect.h;
  },

  /* 圆 vs 矩形：把圆推出矩形（就地修改实体 x/y，使用 entity.r 作为半径）
     返回 true 表示发生了推挤（被墙挡住） */
  resolveCircleRect(entity, rect) {
    const r = entity.r;
    const nx = clamp(entity.x, rect.x, rect.x + rect.w);
    const ny = clamp(entity.y, rect.y, rect.y + rect.h);
    let dx = entity.x - nx;
    let dy = entity.y - ny;
    let d2 = dx * dx + dy * dy;

    if (d2 > r * r) return false;

    if (d2 > 0.000001) {
      const d = Math.sqrt(d2);
      const push = r - d;
      entity.x += (dx / d) * push;
      entity.y += (dy / d) * push;
    } else {
      /* 圆心已在矩形内部：沿穿透最浅的轴弹出 */
      const leftPen = entity.x - rect.x;
      const rightPen = rect.x + rect.w - entity.x;
      const topPen = entity.y - rect.y;
      const botPen = rect.y + rect.h - entity.y;
      const m = Math.min(leftPen, rightPen, topPen, botPen);
      if (m === leftPen) entity.x = rect.x - r;
      else if (m === rightPen) entity.x = rect.x + rect.w + r;
      else if (m === topPen) entity.y = rect.y - r;
      else entity.y = rect.y + rect.h + r;
    }
    return true;
  },

  /* 矩形列表解算 */
  resolveAll(entity, rects) {
    let hit = false;
    for (let i = 0; i < rects.length; i++) {
      if (Collision.resolveCircleRect(entity, rects[i])) hit = true;
    }
    return hit;
  },

  /* 两个圆形实体互相分离（避免敌人叠在一起） */
  separate(a, b) {
    let dx = b.x - a.x, dy = b.y - a.y;
    let d2 = dx * dx + dy * dy;
    const r = a.r + b.r;
    if (d2 >= r * r) return;
    let d = Math.sqrt(d2);
    if (d < 0.0001) { dx = rand(-1, 1); dy = rand(-1, 1); d = Math.hypot(dx, dy) || 1; }
    const overlap = (r - d) * 0.5;
    const ux = dx / d, uy = dy / d;
    a.x -= ux * overlap; a.y -= uy * overlap;
    b.x += ux * overlap; b.y += uy * overlap;
  }
};

/* ===========================================================
   均匀网格 —— 宽阶段碰撞筛选
   弹幕 + 敌群同时很大时，「每颗子弹 × 每只敌人」会退化成 O(P×E)。
   网格把敌人按格子登记，子弹只检查自己所在格子的候选，
   实测能把上千次距离比较压到几十次。
   =========================================================== */
class SpatialGrid {
  constructor(cell) {
    this.cell = cell || 110;
    this.map = new Map();
  }

  clear() { this.map.clear(); }

  _key(gx, gy) { return (gx + 64) * 128 + (gy + 64); }

  /* 把一个圆形实体登记进它覆盖到的所有格子 */
  insert(e) {
    const c = this.cell;
    const x0 = Math.floor((e.x - e.r) / c), x1 = Math.floor((e.x + e.r) / c);
    const y0 = Math.floor((e.y - e.r) / c), y1 = Math.floor((e.y + e.r) / c);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = this._key(x, y);
        let b = this.map.get(k);
        if (!b) { b = []; this.map.set(k, b); }
        b.push(e);
      }
    }
  }

  /* 查询圆 (x,y,r) 覆盖格子里的候选，写进 out（自动去重） */
  query(x, y, r, out) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const b = this.map.get(this._key(xx, yy));
        if (!b) continue;
        for (let i = 0; i < b.length; i++) {
          if (out.indexOf(b[i]) < 0) out.push(b[i]);
        }
      }
    }
    return out;
  }
}