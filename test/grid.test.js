'use strict';

// js/grid.js — pure map grid geometry (squares, flat-top hexes, pointy-top hexes).

const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../js/grid.js');

const square = { type: 'square', size: 50, offsetX: 12, offsetY: -7 };
const flat = { type: 'hex', orient: 'flat', size: 60, offsetX: 100, offsetY: 80 };
const pointy = { type: 'hex', orient: 'pointy', size: 60, offsetX: 100, offsetY: 80 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + ': ' + a + ' vs ' + b);

test('grid: cellCenter → cellAt gives the same cell back, for squares and both hex orientations, with offsets', () => {
  for (let col = -3; col <= 3; col++) for (let row = -3; row <= 3; row++) {
    const p = G.cellCenter({ col, row }, square);
    assert.deepStrictEqual(G.cellAt(p.x, p.y, square), { col, row });
  }
  [flat, pointy].forEach(g => {
    for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) {
      const p = G.cellCenter({ q, r }, g);
      assert.deepStrictEqual(G.cellAt(p.x, p.y, g), { q, r }, g.orient + ' ' + q + ',' + r);
      // A point a little off the center is still in the same hex.
      assert.deepStrictEqual(G.cellAt(p.x + g.size * 0.2, p.y - g.size * 0.15, g), { q, r });
    }
  });
});

test('grid: squares have the offset as a cell corner; hexes have it as the center of hex 0,0', () => {
  assert.deepStrictEqual(G.cellAt(12, -7, square), { col: 0, row: 0 });
  assert.deepStrictEqual(G.cellAt(11.9, -7, square), { col: -1, row: 0 });
  assert.deepStrictEqual(G.cellCenter({ col: 0, row: 0 }, square), { x: 37, y: 18 });
  assert.deepStrictEqual(G.cellCenter({ q: 0, r: 0 }, flat), { x: 100, y: 80 });
  assert.deepStrictEqual(G.cellCenter({ q: 0, r: 0 }, pointy), { x: 100, y: 80 });
});

test('grid: hex size is the width: flat-top neighbours are 3/4 width apart across, pointy-top ones a full width', () => {
  const f = G.cellCenter({ q: 1, r: 0 }, flat);
  near(f.x - 100, 45, 'flat q step');
  const p = G.cellCenter({ q: 1, r: 0 }, pointy);
  near(p.x - 100, 60, 'pointy q step');
  near(p.y - 80, 0, 'pointy q step is horizontal');
  const corners = G.cellCorners({ q: 0, r: 0 }, flat);
  assert.strictEqual(corners.length, 6);
  near(Math.max(...corners.map(c => c.x)) - Math.min(...corners.map(c => c.x)), 60, 'flat hex is 60 wide');
  const pc = G.cellCorners({ q: 0, r: 0 }, pointy);
  near(Math.max(...pc.map(c => c.x)) - Math.min(...pc.map(c => c.x)), 60, 'pointy hex is 60 wide');
});

test('grid: distance counts a square diagonal as 1, and hex steps as hex steps', () => {
  assert.strictEqual(G.distance({ col: 0, row: 0 }, { col: 3, row: 2 }, square), 3);
  assert.strictEqual(G.distance({ col: -2, row: 5 }, { col: 1, row: 5 }, square), 3);
  assert.strictEqual(G.distance({ q: 0, r: 0 }, { q: 2, r: -1 }, flat), 2);
  assert.strictEqual(G.distance({ q: 0, r: 0 }, { q: 3, r: 0 }, pointy), 3);
  assert.strictEqual(G.distance({ q: -1, r: 2 }, { q: 2, r: -2 }, pointy), 4);
});

test('grid: cellsCovered is n×n squares, or 1, 7, 19 hexes for sizes 1, 2, 3', () => {
  assert.deepStrictEqual(G.cellsCovered({ col: 2, row: 3 }, 1, square), [{ col: 2, row: 3 }]);
  assert.strictEqual(G.cellsCovered({ col: 2, row: 3 }, 2, square).length, 4);
  assert.deepStrictEqual(G.cellsCovered({ col: 0, row: 0 }, 3, square).slice(-1), [{ col: 2, row: 2 }]);
  [flat, pointy].forEach(g => {
    assert.deepStrictEqual(G.cellsCovered({ q: 1, r: 1 }, 1, g), [{ q: 1, r: 1 }]);
    const two = G.cellsCovered({ q: 1, r: 1 }, 2, g);
    assert.strictEqual(two.length, 7);
    two.forEach(c => assert.ok(G.distance(c, { q: 1, r: 1 }, g) <= 1));
    assert.strictEqual(G.cellsCovered({ q: 0, r: 0 }, 3, g).length, 19);
  });
});

test('grid: cellsIn lists the visible cells, and gives up (null) when there are too many to draw', () => {
  const cells = G.cellsIn({ x: 0, y: 0, w: 200, h: 100 }, { type: 'square', size: 50, offsetX: 0, offsetY: 0 }, 1000);
  assert.ok(cells.some(c => c.col === 0 && c.row === 0) && cells.some(c => c.col === 3 && c.row === 1));
  assert.strictEqual(G.cellsIn({ x: 0, y: 0, w: 10000, h: 10000 }, { type: 'square', size: 5, offsetX: 0, offsetY: 0 }, 1000), null);
  const hexes = G.cellsIn({ x: 0, y: 0, w: 300, h: 300 }, flat, 1000);
  assert.ok(hexes.some(c => c.q === 0 && c.r === 0));
  assert.strictEqual(G.cellsIn({ x: 0, y: 0, w: 20000, h: 20000 }, flat, 500), null);
});

test('grid: gridFromRect — a dragged square becomes the cell size and a corner; a dragged hex its width and center', () => {
  const s = G.gridFromRect({ x: 130, y: 205, w: 48, h: 52 }, { type: 'square', size: 10, offsetX: 0, offsetY: 0 });
  assert.strictEqual(s.size, 50);
  assert.strictEqual(s.offsetX, 30);
  assert.strictEqual(s.offsetY, 5);
  // Dragged up and to the left: the same result.
  assert.deepStrictEqual(G.gridFromRect({ x: 178, y: 257, w: -48, h: -52 }, { type: 'square', size: 10 }), Object.assign({ type: 'square' }, { size: 50, offsetX: 30, offsetY: 5 }));
  const h = G.gridFromRect({ x: 100, y: 100, w: 60, h: 52 }, { type: 'hex', orient: 'flat', size: 10 });
  assert.deepStrictEqual([h.size, h.offsetX, h.offsetY], [60, 130, 126]);
  assert.deepStrictEqual(G.cellAt(130, 126, h), { q: 0, r: 0 });
});

test('grid: hex labels count columns and rows from the image\'s top-left hex, as 0101', () => {
  const g = { type: 'hex', orient: 'flat', size: 60, offsetX: 30, offsetY: 26 };
  const origin = G.labelOrigin(g, 600, 400);
  assert.strictEqual(G.hexLabel(G.cellAt(30, 26, g), g, origin), '0101');
  // The next column to the right, and the hex below the first one.
  assert.strictEqual(G.hexLabel(G.cellAt(30 + 45, 26 + 26, g), g, origin), '0201');
  assert.strictEqual(G.hexLabel(G.cellAt(30, 26 + 52, g), g, origin), '0102');
  // Pointy-top: rows first.
  const p = { type: 'hex', orient: 'pointy', size: 52, offsetX: 26, offsetY: 30 };
  const po = G.labelOrigin(p, 600, 400);
  assert.strictEqual(G.hexLabel(G.cellAt(26, 30, p), p, po), '0101');
  assert.strictEqual(G.hexLabel(G.cellAt(26 + 52, 30, p), p, po), '0201');
  assert.strictEqual(G.hexKey({ q: -2, r: 3 }), '-2,3');
  // Offset coordinates are the same hex grid, numbered another way.
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
    const o = G.offsetCoords({ q, r }, g);
    assert.ok(Number.isInteger(o.col) && Number.isInteger(o.row));
  }
});

test('grid: gridFromRect over several cells divides the drag by their number', () => {
  const s = G.gridFromRect({ x: 10, y: 20, w: 180, h: 180 }, { type: 'square' }, 3);
  assert.deepStrictEqual([s.size, s.offsetX, s.offsetY], [60, 10, 20]);
  // 3 flat-top hexes of width 40 in a row span 40 × 2.5 = 100 px; 3 pointy-top ones 120 px.
  const f = G.gridFromRect({ x: 0, y: 0, w: 100, h: 35 }, { type: 'hex', orient: 'flat' }, 3);
  assert.strictEqual(f.size, 40);
  assert.strictEqual(f.offsetX, 20);
  const p = G.gridFromRect({ x: 0, y: 0, w: 120, h: 46 }, { type: 'hex', orient: 'pointy' }, 3);
  assert.strictEqual(p.size, 40);
});
