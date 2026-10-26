'use strict';

/*
 * Hexcrawl mode and location notes (js/pins.js): explored hexes, hex
 * numbers, pins whose notes are Compendium "Journal" entries. Same jsdom
 * stand-ins as test/maps.test.js.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, click, setValue } = require('./helpers/boot.js');

const RECT = { left: 0, top: 0, width: 1000, height: 700 };

async function setup(hex) {
  const env = await boot();
  const { T, window, document } = env;
  T.mapRect = () => RECT;
  env.$ = s => document.querySelector(s);
  env.$$ = s => Array.from(document.querySelectorAll(s));
  click(env.$('#tabs .tab-btn[data-tab="maps"]'));
  const { scene } = await T.createScene({ name: 'Wilds' });
  env.sc = scene;
  if (hex) {
    Object.assign(scene.grid, { type: 'hex', orient: 'flat', size: 100, offsetX: 50, offsetY: 44 });
    T.saveScene(scene);
    T.renderMaps();
  }
  const close = window.close.bind(window);
  window.close = () => { T.mapsIdle().then(() => setTimeout(close, 0)); };
  return env;
}

const pointer = (window, target, type, x, y, extra) =>
  target.dispatchEvent(new window.MouseEvent(type, Object.assign({ clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }, extra)));
function toScreen(env, x, y) {
  const v = env.$('#map-svg').getAttribute('viewBox').split(' ').map(Number);
  return [(x - v[0]) * RECT.width / v[2], (y - v[1]) * RECT.height / v[3]];
}
function clickAt(env, x, y, target, extra) {
  const s = toScreen(env, x, y);
  pointer(env.window, target || env.$('#map-svg'), 'pointerdown', s[0], s[1], extra);
  pointer(env.window, env.window, 'pointerup', s[0], s[1], extra);
}
const useTool = (env, t) => click(env.$('.map-tool[data-tool="' + t + '"]'));
const check = (env, sel, on) => { const el = env.$(sel); el.checked = on; el.dispatchEvent(new env.window.Event('change', { bubbles: true })); };

test('pins: "Journal" is a Compendium category, and old entries keep theirs', async () => {
  const { T, window } = await setup();
  assert.ok(T.COMPENDIUM_CATEGORIES.includes('Journal'));
  T.state.compendium = [{ id: 'a', name: 'Note', category: 'Journal', system: 'osr', body: '' }, { id: 'b', name: 'Rule', category: 'Rules', system: 'osr', body: '' }];
  T.ensureStateShape();
  assert.deepEqual(T.state.compendium.map(e => e.category), ['Journal', 'Rules']);
  window.close();
});

test('hexcrawl: only on a hex grid; then the binoculars mark hexes explored (undo too), and the rest is shaded', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  assert.ok($('#hexcrawl-on').disabled, 'squares: no hexcrawl');
  assert.ok($('.map-tool[data-tool="explore"]').hidden);
  setValue($('#grid-type'), 'hex');
  assert.ok(!$('#hexcrawl-on').disabled);
  check(env, '#hexcrawl-on', true);
  assert.ok(sc.hexcrawl.on);
  assert.ok(!$('.map-tool[data-tool="explore"]').hidden);
  const shade = () => $('#map-svg .map-unexplored').getAttribute('d').split('Z').length;
  const before = shade();
  useTool(env, 'explore');
  const c = window.MapGrid.cellCenter({ q: 2, r: 1 }, sc.grid);
  clickAt(env, c.x, c.y);
  assert.deepEqual(sc.hexcrawl.explored, ['2,1']);
  assert.strictEqual(shade(), before - 1, 'one hex less in the shade');
  clickAt(env, c.x + 3, c.y - 3);
  assert.deepEqual(sc.hexcrawl.explored, [], 'a second click un-marks it');
  click($('#map-undo'));
  assert.deepEqual(T.activeScene().hexcrawl.explored, ['2,1']);
  setValue($('#grid-type'), 'square');
  assert.strictEqual($('#map-svg .map-unexplored'), null, 'no shade without hexes');
  assert.ok($('.map-tool[data-tool="explore"]').hidden);
  assert.ok($('.map-tool[data-tool="pan"]').classList.contains('is-active'), 'the explore tool falls back to the hand');
  window.close();
});

test('hexcrawl: hex numbers match js/grid.js, skip cut-off edge hexes, and hide when too small to read', async () => {
  const env = await setup(true);
  const { T, window, $, sc } = env;
  check(env, '#hexcrawl-on', true);
  check(env, '#hexcrawl-coords', true);
  const labels = env.$$('#map-svg .map-hex-labels text');
  assert.ok(labels.length > 10);
  const G = window.MapGrid;
  const origin = G.labelOrigin(sc.grid, sc.width, sc.height);
  const first = labels.find(t => t.textContent === '0101');
  assert.ok(first, 'starts at 0101');
  const at = G.cellAt(Number(first.getAttribute('x')), Number(first.getAttribute('y')) + sc.grid.size * 0.3, sc.grid);
  assert.strictEqual(G.hexLabel(at, sc.grid, origin), '0101');
  assert.ok(!labels.some(t => /^00|^\d\d00$/.test(t.textContent)), 'no 00 column or row');
  // Zoomed far out, a hex is a few screen pixels: no numbers.
  T.zoomAt(sc, 5, 1000, 750);
  assert.strictEqual($('#map-svg .map-hex-labels'), null);
  window.close();
});

test('pins: the pin tool adds a pin and a Journal note in this System, named after the scene, and opens its editor', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  useTool(env, 'pin');
  clickAt(env, 300, 200);
  assert.strictEqual(sc.pins.length, 1);
  const pin = sc.pins[0];
  assert.deepEqual([Math.round(pin.x), Math.round(pin.y)], [300, 200], 'no snapping outside hexcrawl');
  const note = T.state.compendium.find(e => e.id === pin.compendiumId);
  assert.deepEqual([note.name, note.category, note.system, note.source], ['Wilds — Location 1', 'Journal', 'osr', 'Maps']);
  assert.ok(!$('#comp-modal').hidden, 'the editor opens');
  assert.strictEqual($('#comp-f-name').value, 'Wilds — Location 1');
  click($('#comp-cancel'));
  assert.ok($('#comp-modal').hidden);
  clickAt(env, 400, 200);
  assert.strictEqual(T.state.compendium.find(e => e.id === sc.pins[1].compendiumId).name, 'Wilds — Location 2');
  assert.ok($('#map-svg [data-pin="' + pin.id + '"]'));

  setValue($('#set-system'), 'ua3e');
  assert.ok(!T.compendiumForSystem().some(e => e.category === 'Journal'), 'another System does not see the notes');
  window.close();
});

test('pins: in hexcrawl mode a pin snaps to its hex and its note is named after the hex', async () => {
  const env = await setup(true);
  const { T, window, sc } = env;
  T.closeCompEntry();
  check(env, '#hexcrawl-on', true);
  useTool(env, 'pin');
  const G = window.MapGrid;
  const ctr = G.cellCenter({ q: 3, r: 1 }, sc.grid);
  clickAt(env, ctr.x + 10, ctr.y - 8);
  const pin = sc.pins[0];
  assert.ok(Math.abs(pin.x - ctr.x) < 1e-6 && Math.abs(pin.y - ctr.y) < 1e-6, 'on the hex center');
  const label = G.hexLabel({ q: 3, r: 1 }, sc.grid, G.labelOrigin(sc.grid, sc.width, sc.height));
  assert.strictEqual(T.state.compendium.find(e => e.id === pin.compendiumId).name, 'Wilds — Hex ' + label);
  T.closeCompEntry();
  clickAt(env, ctr.x, ctr.y);
  assert.strictEqual(T.state.compendium.find(e => e.id === sc.pins[1].compendiumId).name, 'Wilds — Hex ' + label + ' (2)', 'a second pin in the hex gets its own name');
  window.close();
});

test('pins: with the hand tool a click opens the note\'s popup, a double-click its editor, and a drag moves the pin', async () => {
  const env = await setup();
  const { T, window, document, $, sc } = env;
  const pin = T.addPin(sc, { x: 300, y: 300 }, false);
  const note = T.state.compendium.find(e => e.id === pin.compendiumId);
  note.body = 'A **ruined** chapel.';
  const el = () => $('#map-svg [data-pin="' + pin.id + '"]');
  clickAt(env, 300, 295, el());
  const pop = document.querySelector('.comp-pop');
  assert.ok(pop, 'the popup opens');
  assert.match(pop.textContent, /Wilds — Location 1[\s\S]*ruined chapel/);
  assert.ok(!$('#pin-edit').hidden);
  assert.strictEqual($('#pin-edit-title').textContent, 'Wilds — Location 1');
  T.closeAllCompPops();

  const s = toScreen(env, 300, 295);
  pointer(window, el(), 'pointerdown', s[0], s[1], { detail: 2 });
  pointer(window, window, 'pointerup', s[0], s[1], { detail: 2 });
  assert.ok(!$('#comp-modal').hidden, 'a double-click opens the editor');
  T.closeCompEntry();

  const a = toScreen(env, 300, 295), b = toScreen(env, 500, 395);
  pointer(window, el(), 'pointerdown', a[0], a[1]);
  pointer(window, window, 'pointermove', b[0], b[1]);
  pointer(window, window, 'pointerup', b[0], b[1]);
  assert.deepEqual([Math.round(pin.x), Math.round(pin.y)], [500, 400]);
  assert.strictEqual(document.querySelector('.comp-pop'), null, 'a drag opens no popup');
  click($('#map-undo'));
  assert.deepEqual([Math.round(T.activeScene().pins[0].x), Math.round(T.activeScene().pins[0].y)], [300, 300]);
  window.close();
});

test('pins: "Delete pin" keeps the note; "Delete pin and note" asks and removes both; Delete removes the selected pin; a pin whose note is gone says so', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  const p1 = T.addPin(sc, { x: 100, y: 100 }, false);
  const n1 = p1.compendiumId;
  click($('#pin-delete'));
  assert.deepEqual(sc.pins, []);
  assert.ok(T.state.compendium.some(e => e.id === n1), 'the note stays');

  const p2 = T.addPin(sc, { x: 200, y: 100 }, false);
  window.confirm = () => false;
  click($('#pin-delete-note'));
  assert.strictEqual(sc.pins.length, 1, 'Cancel keeps both');
  window.confirm = () => true;
  click($('#pin-delete-note'));
  assert.deepEqual(sc.pins, []);
  assert.ok(!T.state.compendium.some(e => e.id === p2.compendiumId));

  const p3 = T.addPin(sc, { x: 300, y: 100 }, false);
  $('#map-wrap').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  assert.deepEqual(sc.pins, []);
  click($('#map-undo'));
  const back = T.activeScene().pins[0];
  assert.strictEqual(back.id, p3.id, 'undo brings the pin back');

  T.state.compendium = T.state.compendium.filter(e => e.id !== back.compendiumId);
  T.renderMaps();
  assert.ok($('#map-svg [data-pin="' + back.id + '"]').classList.contains('is-orphan'));
  clickAt(env, 300, 95, $('#map-svg [data-pin="' + back.id + '"]'));
  assert.match($('#map-status').textContent, /note of this pin was deleted/);
  assert.strictEqual($('#pin-edit-title').textContent, 'Note deleted');
  assert.ok($('#pin-open').disabled);
  window.close();
});
