/* js/grid.js — map grid geometry for the Maps tab (js/maps.js). Pure: no
 * DOM, no storage. Exposes window.MapGrid / module.exports.
 *
 * A grid is { type: 'square' | 'hex', orient: 'flat' | 'pointy', size,
 * offsetX, offsetY } in map pixels (the image's own pixels).
 *   square  size = the side of a cell; (offsetX, offsetY) = a cell corner.
 *           A cell is { col, row }.
 *   hex     size = the width of a hex (flat-top: corner to corner; pointy-top:
 *           flat side to flat side); (offsetX, offsetY) = the center of hex
 *           { q: 0, r: 0 }. A cell is axial { q, r } (redblobgames.com/grids/hexagons).
 */
(function (root) {
  'use strict';
  const SQRT3 = Math.sqrt(3);

  // The hex "radius" (center to corner) from the grid's size.
  const radius = g => (g.orient === 'pointy' ? g.size / SQRT3 : g.size / 2);

  function hexRound(q, r) {
    let x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy <= dz) rz = -rx - ry;
    return { q: rx + 0, r: rz + 0 }; // + 0 turns -0 into 0
  }

  // The cell under map point (x, y).
  function cellAt(x, y, g) {
    if (g.type !== 'hex') {
      return { col: Math.floor((x - g.offsetX) / g.size), row: Math.floor((y - g.offsetY) / g.size) };
    }
    const s = radius(g), px = x - g.offsetX, py = y - g.offsetY;
    if (g.orient === 'pointy') return hexRound((SQRT3 / 3 * px - py / 3) / s, (2 / 3 * py) / s);
    return hexRound((2 / 3 * px) / s, (-px / 3 + SQRT3 / 3 * py) / s);
  }

  // The center of a cell, in map pixels.
  function cellCenter(c, g) {
    if (g.type !== 'hex') return { x: g.offsetX + (c.col + 0.5) * g.size, y: g.offsetY + (c.row + 0.5) * g.size };
    const s = radius(g);
    if (g.orient === 'pointy') return { x: g.offsetX + s * SQRT3 * (c.q + c.r / 2), y: g.offsetY + s * 1.5 * c.r };
    return { x: g.offsetX + s * 1.5 * c.q, y: g.offsetY + s * SQRT3 * (c.r + c.q / 2) };
  }

  // The six corners of a hex (or the four of a square), for drawing.
  function cellCorners(c, g) {
    if (g.type !== 'hex') {
      const x = g.offsetX + c.col * g.size, y = g.offsetY + c.row * g.size, s = g.size;
      return [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
    }
    const ctr = cellCenter(c, g), s = radius(g), start = g.orient === 'pointy' ? 30 : 0;
    const out = [];
    for (let i = 0; i < 6; i++) {
      const a = (start + 60 * i) * Math.PI / 180;
      out.push({ x: ctr.x + s * Math.cos(a), y: ctr.y + s * Math.sin(a) });
    }
    return out;
  }

  // Steps between two cells: on squares the larger of the two axis steps (a
  // diagonal step counts 1), on hexes the hex distance.
  function distance(a, b, g) {
    if (g.type !== 'hex') return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
    return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  }

  // The cells a thing of `size` covers. Squares: size × size cells from `c`
  // to the right and down. Hexes: `c` and the size − 1 rings around it.
  function cellsCovered(c, size, g) {
    const n = Math.max(1, Math.round(size));
    const out = [];
    if (g.type !== 'hex') {
      for (let dr = 0; dr < n; dr++) for (let dc = 0; dc < n; dc++) out.push({ col: c.col + dc, row: c.row + dr });
      return out;
    }
    const k = n - 1;
    for (let dq = -k; dq <= k; dq++) {
      for (let dr = Math.max(-k, -dq - k); dr <= Math.min(k, -dq + k); dr++) out.push({ q: c.q + dq, r: c.r + dr });
    }
    return out;
  }

  // Every cell whose center lies in the rectangle (with one cell of margin),
  // at most `max` of them (null when more: too small to draw one by one).
  function cellsIn(rect, g, max) {
    const out = [];
    const step = g.type === 'hex' ? radius(g) : g.size;
    const x0 = rect.x - 2 * step, y0 = rect.y - 2 * step, x1 = rect.x + rect.w + 2 * step, y1 = rect.y + rect.h + 2 * step;
    if (g.type !== 'hex') {
      const a = cellAt(x0, y0, g), b = cellAt(x1, y1, g);
      if ((b.col - a.col + 1) * (b.row - a.row + 1) > max) return null;
      for (let row = a.row; row <= b.row; row++) for (let col = a.col; col <= b.col; col++) out.push({ col, row });
      return out;
    }
    const corners = [cellAt(x0, y0, g), cellAt(x1, y0, g), cellAt(x0, y1, g), cellAt(x1, y1, g)];
    const qs = corners.map(c => c.q), rs = corners.map(c => c.r);
    const qMin = Math.min(...qs) - 1, qMax = Math.max(...qs) + 1, rMin = Math.min(...rs) - 1, rMax = Math.max(...rs) + 1;
    if ((qMax - qMin + 1) * (rMax - rMin + 1) > max * 3) return null;
    for (let q = qMin; q <= qMax; q++) {
      for (let r = rMin; r <= rMax; r++) {
        const p = cellCenter({ q, r }, g);
        if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
        out.push({ q, r });
        if (out.length > max) return null;
      }
    }
    return out;
  }

  // A grid from a rectangle the user dragged over `span` × `span` cells of
  // the image (a longer drag is more exact). Squares: the rectangle's corner
  // is a cell corner. Hexes: `span` hexes side by side in a row (flat-top: their
  // widths overlap by 1/4), and the rectangle's center is a hex center when
  // `span` is odd.
  function gridFromRect(rect, g, span) {
    const n = Math.max(1, Math.round(span || 1));
    const w = Math.abs(rect.w), h = Math.abs(rect.h);
    const x = Math.min(rect.x, rect.x + rect.w), y = Math.min(rect.y, rect.y + rect.h);
    if (g.type !== 'hex') {
      const size = (w + h) / 2 / n;
      return Object.assign({}, g, { size, offsetX: mod(x, size), offsetY: mod(y, size) });
    }
    // n flat-top hexes in a row span (3n + 1)/4 widths; n pointy-top ones span n widths.
    const size = g.orient === 'pointy' ? w / n : w * 4 / (3 * n + 1);
    return Object.assign({}, g, { size, offsetX: x + size / 2, offsetY: y + h / 2 });
  }
  const mod = (a, n) => ((a % n) + n) % n;

  const api = { cellAt, cellCenter, cellCorners, distance, cellsCovered, cellsIn, gridFromRect, hexRound };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MapGrid = api;
})(typeof window !== 'undefined' ? window : globalThis);
