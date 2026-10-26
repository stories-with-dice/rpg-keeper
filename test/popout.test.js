'use strict';

/*
 * The pop-out map window (js/maps.js's popOut / attachToMain, js/main.js's
 * initPopout): index.html?view=map with window.opener = the main window.
 * Two jsdom windows: `main` and `pop`. The pop-out has no state of its own;
 * changes in either window show in both.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, click, savedState } = require('./helpers/boot.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };
const RECT = { left: 0, top: 0, width: 1000, height: 700 };

function prep(env) {
  const { T, window, document } = env;
  T.mapRect = () => RECT;
  env.$ = s => document.querySelector(s);
  const close = window.close.bind(window);
  window.close = () => { T.mapsIdle().then(() => setTimeout(close, 0)); };
  return env;
}

async function setupPair() {
  const main = prep(await boot());
  click(main.$('#tabs .tab-btn[data-tab="maps"]'));
  const { scene } = await main.T.createScene({ name: 'Shared Map' });
  scene.grid.type = 'square'; // a new scene has hexes
  main.T.resetHistories();
  main.T.renderMaps();
  main.T.addToken(scene, { iconId: 'lorc/ghost', x: 125, y: 125 });
  const pop = prep(await boot({ url: 'https://osr.test/?view=map', opener: main.window }));
  pop.T.renderMaps();
  return { main, pop, scene };
}

const pointer = (window, target, type, x, y, extra) =>
  target.dispatchEvent(new window.MouseEvent(type, Object.assign({ clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }, extra)));
function toScreen(env, x, y) {
  const v = env.$('#map-svg').getAttribute('viewBox').split(' ').map(Number);
  return [(x - v[0]) * RECT.width / v[2], (y - v[1]) * RECT.height / v[3]];
}

test('pop-out: shows only the Maps tab, with the main window\'s scene; it has no campaign of its own', async () => {
  const { main, pop, scene } = await setupPair();
  assert.ok(pop.document.body.classList.contains('map-popout'));
  assert.ok(pop.$('#tab-maps').classList.contains('is-active'));
  assert.ok(!pop.$('#tab-character').classList.contains('is-active'), 'the other tabs are not shown');
  assert.strictEqual(pop.T.state, main.T.state, 'one state');
  assert.strictEqual(pop.T.activeScene().id, scene.id);
  assert.ok(pop.$('#map-svg [data-token]'), 'the token is drawn');
  assert.strictEqual(pop.document.title, 'Shared Map — Map — Character Keeper');
  assert.ok(pop.$('#map-popout-closed').hidden);
  pop.window.close();
  main.window.close();
});

test('pop-out: a token moved there moves in the main window and is saved there; a drawing made in the main window shows there', async () => {
  const { main, pop, scene } = await setupPair();
  const t = scene.tokens[0];
  const el = pop.$('#map-svg [data-token="' + t.id + '"]');
  const a = toScreen(pop, 125, 125), b = toScreen(pop, 325, 225);
  pointer(pop.window, el, 'pointerdown', a[0], a[1]);
  pointer(pop.window, pop.window, 'pointermove', b[0], b[1]);
  pointer(pop.window, pop.window, 'pointerup', b[0], b[1]);
  assert.deepEqual([t.x, t.y], [325, 225]);
  await settle();
  const saved = await savedState(main.T);
  assert.deepEqual(saved.scenes[0].tokens.map(x => [x.x, x.y]), [[325, 225]], 'saved by the main window');
  const g = main.$('#map-svg [data-token="' + t.id + '"]').getAttribute('transform');
  assert.strictEqual(g, 'translate(325 225)', 'the main window redrew its map');

  main.T.addDrawing(scene, { kind: 'rect', x: 10, y: 10, w: 50, h: 50 });
  await settle();
  assert.ok(pop.$('#map-svg rect.map-drawing'), 'the pop-out redrew too');
  pop.window.close();
  main.window.close();
});

test('pop-out: undo there undoes the main window\'s last map step, in both windows; its log lines go to the main window', async () => {
  const { main, pop, scene } = await setupPair();
  main.T.addDrawing(scene, { kind: 'line', points: [[0, 0], [10, 10]] });
  await settle();
  pop.document.body.dispatchEvent(new pop.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.deepEqual(main.T.activeScene().drawings, []);
  await settle();
  assert.strictEqual(main.$('#map-svg .map-drawing'), null);
  assert.strictEqual(pop.$('#map-svg .map-drawing'), null);
  click(pop.$('#map-redo'));
  assert.strictEqual(main.T.activeScene().drawings.length, 1);

  pop.T.pushNote('Maps', 'From the pop-out');
  assert.match(main.document.querySelector('#log-list').textContent, /From the pop-out/);
  pop.window.close();
  main.window.close();
});

test('pop-out: the main window\'s Pop out opens and registers it; a blocked window says so', async () => {
  const main = prep(await boot());
  click(main.$('#tabs .tab-btn[data-tab="maps"]'));
  await main.T.createScene({ name: 'Map' });
  let drawn = 0;
  const fake = { closed: false, focus() {}, OSR: { renderMaps() { drawn++; } } };
  let opened = null;
  main.window.open = (url, name) => { opened = [url, name]; return fake; };
  click(main.$('#map-popout'));
  assert.deepEqual(opened, ['/?view=map', 'osr-map']);
  main.T.addDrawing(main.T.activeScene(), { kind: 'line', points: [[0, 0], [5, 5]] });
  await settle();
  assert.ok(drawn >= 1, 'a save redraws the pop-out');
  fake.closed = true;
  const before = drawn;
  main.T.save();
  await settle();
  assert.strictEqual(drawn, before, 'a closed pop-out is forgotten');

  main.window.open = () => null;
  click(main.$('#map-popout'));
  assert.match(main.$('#map-status').textContent, /blocked the new window/);
  main.window.close();
});

test('pop-out: when the main window closes, or was never there, the pop-out says so and offers the full app', async () => {
  const { main, pop } = await setupPair();
  pop.T.mainWindowClosed();
  assert.ok(!pop.$('#map-popout-closed').hidden);
  assert.match(pop.$('#map-popout-closed').textContent, /main window .* was closed/);
  pop.window.close();
  main.window.close();

  const lone = prep(await boot({ url: 'https://osr.test/?view=map', opener: { closed: false } }));
  assert.ok(!lone.$('#map-popout-closed').hidden);
  assert.strictEqual(typeof lone.$('#map-popout-reopen').onclick, 'function', 'its button works with nothing else wired');
  lone.window.close();
});
