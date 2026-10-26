'use strict';

/*
 * The Maps tab (js/maps.js): scenes, images (file, paste, address, drop),
 * the SVG view (pan, zoom), the grid (squares, hexes, calibration, lock),
 * the measure tool, and the .zip export/import of map images (js/io.js).
 *
 * jsdom has no canvas and no layout, so each test replaces:
 *   T.decodeImage     → returns the bytes as a 1200 × 800 WebP
 *   T.mapRect         → a 1000 × 700 box at the page origin
 *   T.measureImageUrl → 640 × 480
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, click, setValue, savedState } = require('./helpers/boot.js');
const fflate = require('../vendor/fflate/fflate.min.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };
const RECT = { left: 0, top: 0, width: 1000, height: 700 };

async function setup(opts) {
  const env = await boot(opts);
  const { T, window, document } = env;
  T.decodeImage = async blob => ({ blob: new window.Blob([await blob.arrayBuffer()], { type: 'image/webp' }), width: 1200, height: 800 });
  T.mapRect = () => RECT;
  T.measureImageUrl = async () => ({ width: 640, height: 480 });
  env.$ = s => document.querySelector(s);
  env.$$ = s => Array.from(document.querySelectorAll(s));
  env.png = (name = 'map.png', bytes = [137, 80, 78, 71, 1, 2, 3]) => new window.File([new Uint8Array(bytes)], name, { type: 'image/png' });
  click(env.$('#tabs .tab-btn[data-tab="maps"]'));
  // A map image loads from IndexedDB after the test's last step: close later,
  // so that load does not render into a closed window.
  const close = window.close.bind(window);
  window.close = () => { setTimeout(close, 50); };
  return env;
}

// A pointer event at a screen point (jsdom has no PointerEvent constructor; the type is what counts).
function pointer(window, target, type, x, y, extra) {
  target.dispatchEvent(new window.MouseEvent(type, Object.assign({ clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }, extra)));
}
function dragOn(env, from, to) {
  const { window, $ } = env;
  pointer(window, $('#map-svg'), 'pointerdown', from[0], from[1]);
  pointer(window, window, 'pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  pointer(window, window, 'pointerup', to[0], to[1]);
}
// The screen point of a map point, in the current view.
function toScreen(env, x, y) {
  const v = env.$('#map-svg').getAttribute('viewBox').split(' ').map(Number);
  return [(x - v[0]) * RECT.width / v[2], (y - v[1]) * RECT.height / v[3]];
}
const viewBox = env => env.$('#map-svg').getAttribute('viewBox').split(' ').map(Number);

test('Maps: the tab shows an empty state, and "+ New scene…" with a file creates a scene with its image in IndexedDB', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  assert.ok(!$('#map-empty').hidden);
  assert.ok($('#map-svg').hidden);
  assert.deepEqual(env.$$('#map-scene option').map(o => o.textContent), ['+ New scene…']);

  setValue($('#map-scene'), '__new');
  assert.ok(!$('#scene-modal').hidden);
  setValue($('#scene-name'), 'Crypt');
  Object.defineProperty($('#scene-file'), 'files', { configurable: true, value: [env.png()] });
  click($('#scene-create'));
  await settle();
  assert.ok($('#scene-modal').hidden);
  const sc = T.activeScene();
  assert.strictEqual(sc.name, 'Crypt');
  assert.strictEqual(sc.system, 'osr');
  assert.deepEqual([sc.width, sc.height, sc.imageType], [1200, 800, 'image/webp']);
  const rec = await T.store.getBlob(sc.imageBlobId);
  assert.deepEqual(Array.from(new Uint8Array(rec.bytes)), [137, 80, 78, 71, 1, 2, 3]);
  assert.strictEqual(rec.type, 'image/webp');
  assert.ok($('#map-empty').hidden);
  assert.strictEqual($('#map-svg image').getAttribute('href'), 'blob:osr-test');
  assert.deepEqual(env.$$('#map-svg > g').map(g => g.getAttribute('class')),
    ['map-layer-image', 'map-layer-grid', 'map-layer-drawings', 'map-layer-pins', 'map-layer-tokens', 'map-layer-overlay']);
  assert.deepEqual((await savedState(T)).scenes.map(s => s.name), ['Crypt']);
  assert.strictEqual(T.state.activeSceneIds.osr, sc.id);
  window.close();
});

test('Maps: a scene with no image is a blank 2000 × 1500 map; a file that is not an image is refused in the dialog', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  setValue($('#map-scene'), '__new');
  Object.defineProperty($('#scene-file'), 'files', { configurable: true, value: [new window.File(['hello'], 'notes.txt', { type: 'text/plain' })] });
  click($('#scene-create'));
  await settle();
  assert.ok(!$('#scene-modal').hidden, 'the dialog stays open');
  assert.match($('#scene-error').textContent, /not an image/);
  assert.strictEqual(T.state.scenes.length, 0);

  Object.defineProperty($('#scene-file'), 'files', { configurable: true, value: [] });
  setValue($('#scene-name'), 'Overland');
  click($('#scene-create'));
  await settle();
  const sc = T.activeScene();
  assert.deepEqual([sc.name, sc.width, sc.height, sc.imageBlobId], ['Overland', 2000, 1500, undefined]);
  assert.strictEqual($('#map-svg image'), null);
  assert.ok($('#map-svg .map-backdrop'));
  window.close();
});

test('Maps: Ctrl+V of an image on the Maps tab creates a scene; a paste in a text field or on another tab does not', async () => {
  const env = await setup();
  const { T, window, document, $ } = env;
  const paste = (target, files) => {
    const ev = new window.Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { files, items: [] };
    target.dispatchEvent(ev);
    return ev;
  };
  paste($('#grid-unit'), [env.png()]);
  await settle();
  assert.strictEqual(T.state.scenes.length, 0, 'a text field keeps its paste');

  const ev = paste(document.body, [env.png()]);
  await settle();
  assert.ok(ev.defaultPrevented);
  assert.deepEqual(T.state.scenes.map(s => s.name), ['Pasted map']);
  assert.ok(T.activeScene().imageBlobId);

  click($('#tabs .tab-btn[data-tab="character"]'));
  paste(document.body, [env.png()]);
  await settle();
  assert.strictEqual(T.state.scenes.length, 1, 'not on another tab');
  window.close();
});

test('Maps: an image dropped on the map becomes a scene named after the file', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  ev.dataTransfer = { files: [env.png('Goblin Warren.png')] };
  $('#map-wrap').dispatchEvent(ev);
  await settle();
  assert.deepEqual(T.state.scenes.map(s => s.name), ['Goblin Warren']);
  window.close();
});

test('Maps: an image address is downloaded and stored; when the download fails, the scene keeps the address and warns', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  window.fetch = async url => {
    if (url === 'https://maps.example/ok.png') return { ok: true, status: 200, blob: async () => env.png() };
    throw new TypeError('Failed to fetch');
  };
  await T.createScene({ name: 'Remote', url: 'https://maps.example/ok.png' });
  assert.ok(T.activeScene().imageBlobId, 'stored as a blob');
  assert.strictEqual(T.activeScene().imageUrl, undefined);

  setValue($('#map-scene'), '__new');
  setValue($('#scene-url'), 'https://other.example/cors.jpg');
  click($('#scene-create'));
  await settle();
  const sc = T.activeScene();
  assert.strictEqual(sc.imageUrl, 'https://other.example/cors.jpg');
  assert.strictEqual(sc.imageBlobId, undefined);
  assert.deepEqual([sc.width, sc.height], [640, 480]);
  assert.match($('#map-status').textContent, /could not be downloaded \(Failed to fetch\).*not saved/);
  assert.strictEqual($('#map-svg image').getAttribute('href'), 'https://other.example/cors.jpg');
  window.close();
});

test('Maps: rename, duplicate (sharing the image), switch, and delete scenes; the open scene is kept after a reload', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  await T.createScene({ name: 'Cave', file: env.png() });
  const cave = T.activeScene();
  window.prompt = () => 'Deep Cave';
  click($('#map-rename'));
  assert.strictEqual(cave.name, 'Deep Cave');
  click($('#map-duplicate'));
  await settle();
  const copy = T.activeScene();
  assert.strictEqual(copy.name, 'Deep Cave (copy)');
  assert.strictEqual(copy.imageBlobId, cave.imageBlobId);
  assert.deepEqual(env.$$('#map-scene option').map(o => o.textContent), ['Deep Cave', 'Deep Cave (copy)', '+ New scene…']);

  setValue($('#map-scene'), cave.id);
  assert.strictEqual(T.activeScene().id, cave.id);
  window.confirm = () => true;
  click($('#map-delete'));
  await settle();
  assert.deepEqual(T.state.scenes.map(s => s.name), ['Deep Cave (copy)']);
  assert.ok(await T.store.getBlob(cave.imageBlobId), 'the copy still shows the image');
  await T.flushSave();
  const idb = env.indexedDB;
  const copyId = copy.id;
  window.close();

  const again = await setup({ indexedDB: idb });
  assert.strictEqual(again.T.activeScene().id, copyId);
  again.window.confirm = () => true;
  click(again.$('#map-delete'));
  await settle();
  assert.deepEqual(again.T.state.scenes, []);
  assert.strictEqual(await again.T.store.getBlob(copy.imageBlobId), undefined, 'the last scene with the image takes it along');
  assert.ok(!again.$('#map-empty').hidden);
  again.window.close();
});

test('Maps: scenes belong to their System', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  await T.createScene({ name: 'OSR Dungeon' });
  setValue($('#set-system'), 'ua3e');
  assert.deepEqual(env.$$('#map-scene option').map(o => o.textContent), ['+ New scene…']);
  assert.ok(!$('#map-empty').hidden);
  await T.createScene({ name: 'Motel' });
  assert.strictEqual(T.activeScene().system, 'ua3e');
  setValue($('#set-system'), 'osr');
  assert.deepEqual(env.$$('#map-scene option').map(o => o.textContent), ['OSR Dungeon', '+ New scene…']);
  assert.deepEqual(T.splitState(T.state).ua3e.scenes.map(s => s.name), ['Motel'], 'saved in the system document');
  window.close();
});

test('Maps: squares draw as a pattern; hexes as a path that changes with the orientation', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  await T.createScene({ name: 'Grid', file: env.png() });
  const pat = $('#map-grid-pat');
  assert.ok(pat);
  assert.deepEqual(['x', 'y', 'width'].map(a => pat.getAttribute(a)), ['0', '0', '50']);
  setValue($('#grid-type'), 'hex');
  assert.strictEqual($('#map-grid-pat'), null);
  assert.ok(!$('#grid-orient-label').hidden);
  const flat = $('#map-svg path.map-grid').getAttribute('d');
  assert.match(flat, /^M[\d. -]+(L[\d. -]+){5}Z/);
  setValue($('#grid-orient'), 'pointy');
  assert.notStrictEqual($('#map-svg path.map-grid').getAttribute('d'), flat);
  $('#grid-show').checked = false;
  $('#grid-show').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.strictEqual($('#map-svg .map-grid'), null);
  window.close();
});

test('Maps: dragging with the grid tool sets the grid; arrow keys move it; the fields set it by hand; a locked grid stays', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  await T.createScene({ name: 'Calibrate', file: env.png() });
  click($('.map-tool[data-tool="calibrate"]'));
  // One 60 px cell of the image, from (130, 140) to (190, 200).
  dragOn(env, toScreen(env, 130, 140), toScreen(env, 190, 200));
  const g = T.activeScene().grid;
  assert.ok(Math.abs(g.size - 60) < 1e-6, 'size ' + g.size);
  assert.ok(Math.abs(g.offsetX - 10) < 1e-6 && Math.abs(g.offsetY - 20) < 1e-6, g.offsetX + ',' + g.offsetY);
  assert.match($('#map-status').textContent, /Grid set: 60 px/);
  assert.strictEqual($('#grid-size').value, '60');

  // Over three cells: the drag is divided by 3.
  setValue($('#grid-span'), '3');
  dragOn(env, toScreen(env, 130, 140), toScreen(env, 310, 320));
  assert.ok(Math.abs(T.activeScene().grid.size - 60) < 1e-6);

  const wrap = $('#map-wrap');
  wrap.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  wrap.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
  assert.ok(Math.abs(T.activeScene().grid.offsetX - 11) < 1e-6);
  assert.ok(Math.abs(T.activeScene().grid.offsetY - 30) < 1e-6);

  setValue($('#grid-size'), '72.5');
  assert.strictEqual(T.activeScene().grid.size, 72.5);
  setValue($('#grid-units'), '10');
  setValue($('#grid-unit'), 'm');
  assert.deepEqual([T.activeScene().grid.unitsPerCell, T.activeScene().grid.unit], [10, 'm']);

  $('#grid-lock').checked = true;
  $('#grid-lock').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok($('#grid-size').disabled && $('#grid-type').disabled && $('#grid-ox').disabled);
  const before = JSON.stringify(T.activeScene().grid);
  dragOn(env, toScreen(env, 0, 0), toScreen(env, 100, 100));
  wrap.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.strictEqual(JSON.stringify(T.activeScene().grid), before);
  assert.match($('#map-status').textContent, /locked/);
  window.close();
});

test('Maps: a drag too small to be a cell does not change the grid', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  await T.createScene({ name: 'Tiny', file: env.png() });
  click($('.map-tool[data-tool="calibrate"]'));
  const before = JSON.stringify(T.activeScene().grid);
  dragOn(env, toScreen(env, 100, 100), toScreen(env, 101, 101));
  assert.strictEqual(JSON.stringify(T.activeScene().grid), before);
  assert.match($('#map-status').textContent, /Drag over a whole cell/);
  window.close();
});

test('Maps: the measure tool shows the distance in cells and units', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  await T.createScene({ name: 'Measure', file: env.png() });
  click($('.map-tool[data-tool="measure"]'));
  // Default grid: 50 px squares at 0,0, 5 ft per cell. From cell 0,0 to cell 3,1.
  dragOn(env, toScreen(env, 25, 25), toScreen(env, 175, 75));
  assert.strictEqual($('#map-status').textContent, '3 cells · 15 ft');
  assert.ok($('#map-svg line.map-measure'));
  assert.strictEqual($('#map-svg text.map-measure-label').textContent, '3 cells · 15 ft');
  setValue($('#grid-type'), 'hex');
  assert.strictEqual(T.measureText(T.activeScene(), { x: 0, y: 0 }, { x: 0, y: 0 }), '0 cells · 0 ft');
  window.close();
});

test('Maps: dragging with the hand tool pans; the wheel zooms around the pointer, within limits; the fit button resets', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  await T.createScene({ name: 'View', file: env.png() });
  const v0 = viewBox(env);
  assert.ok(Math.abs(v0[2] / v0[3] - 1000 / 700) < 1e-3, 'the view has the box\'s aspect ratio');
  dragOn(env, [500, 350], [400, 300]);
  const v1 = viewBox(env);
  assert.ok(Math.abs(v1[0] - v0[0] - 100 * v0[2] / 1000) < 0.02, 'panned right by 100 screen px');
  assert.ok(Math.abs(v1[1] - v0[1] - 50 * v0[3] / 700) < 0.02);
  assert.strictEqual(v1[2], v0[2], 'same zoom');

  const wheel = (dy, x = 500, y = 350) => $('#map-svg').dispatchEvent(new window.WheelEvent('wheel', { deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const under = T.screenToMap(500, 350, RECT, { x: v1[0], y: v1[1], w: v1[2], h: v1[3] });
  wheel(-100);
  const v2 = viewBox(env);
  assert.ok(v2[2] < v1[2], 'zoomed in');
  const still = T.screenToMap(500, 350, RECT, { x: v2[0], y: v2[1], w: v2[2], h: v2[3] });
  assert.ok(Math.abs(still.x - under.x) < 0.05 && Math.abs(still.y - under.y) < 0.05, 'the point under the pointer stays');
  for (let i = 0; i < 60; i++) wheel(-600);
  assert.ok(viewBox(env)[2] >= 20 - 1e-6, 'zoom-in limit');
  for (let i = 0; i < 60; i++) wheel(600);
  assert.ok(viewBox(env)[2] <= 1200 * 6 + 1e-6, 'zoom-out limit');
  click($('#map-fit'));
  assert.deepEqual(viewBox(env), v0);
  window.close();
});

test('Maps: scene names are escaped', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  await T.createScene({ name: '<img src=x onerror=alert(1)>' });
  assert.strictEqual($('#map-scene img'), null);
  assert.strictEqual($('#map-scene').selectedOptions[0].textContent, '<img src=x onerror=alert(1)>');
  window.close();
});

/* ---- Export and import ---- */

test('Export: with map images it asks; "Include map images" makes a .zip that a fresh app imports with its images', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  T.createCharacter('# Aria');
  await T.createScene({ name: 'Zip Map', file: env.png('z.png', [1, 2, 3, 4, 5]) });
  const sc = T.activeScene();
  const made = [];
  window.URL.createObjectURL = b => { made.push(b); return 'blob:x'; };
  click($('#btn-export'));
  assert.ok(!$('#export-modal').hidden);
  assert.ok($('#export-images').checked);
  click($('#export-go'));
  await settle();
  assert.ok($('#export-modal').hidden);
  const zips = made.filter(b => b.type === 'application/zip'); // the map on screen makes object URLs too
  assert.strictEqual(zips.length, 1);
  const zip = new Uint8Array(await zips[0].arrayBuffer());
  const files = fflate.unzipSync(zip);
  assert.deepEqual(Object.keys(files).sort(), ['campaign.json', 'maps/' + sc.imageBlobId + '.webp']);
  assert.deepEqual(Array.from(files['maps/' + sc.imageBlobId + '.webp']), [1, 2, 3, 4, 5]);
  assert.deepEqual(JSON.parse(fflate.strFromU8(files['campaign.json'])).scenes.map(s => s.name), ['Zip Map']);
  window.close();

  const fresh = await setup();
  fresh.window.confirm = () => true; // Replace all
  await fresh.T.importData(new fresh.window.File([zip], 'osr-manager-20261026.zip', { type: 'application/zip' }));
  await settle();
  assert.deepEqual(fresh.T.state.characters.map(c => c.name), ['Aria']);
  assert.strictEqual(fresh.T.activeScene().name, 'Zip Map');
  const rec = await fresh.T.store.getBlob(sc.imageBlobId);
  assert.deepEqual(Array.from(new Uint8Array(rec.bytes)), [1, 2, 3, 4, 5]);
  assert.strictEqual(rec.type, 'image/webp');
  fresh.window.close();
});

test('Export: without map images it is the .json, with no question when there are none; a Merge import adds the scenes', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  const made = [];
  window.URL.createObjectURL = b => { made.push(b); return 'blob:x'; };
  await T.createScene({ name: 'Blank' });
  const jsons = () => made.filter(b => b.type === 'application/json');
  click($('#btn-export'));
  assert.ok($('#export-modal').hidden, 'no images: no question');
  assert.strictEqual(jsons().length, 1);

  await T.createScene({ name: 'Pictured', file: env.png() });
  click($('#btn-export'));
  assert.ok(!$('#export-modal').hidden);
  $('#export-images').checked = false;
  click($('#export-go'));
  await settle();
  assert.strictEqual(jsons().length, 2);
  assert.strictEqual(made.filter(b => b.type === 'application/zip').length, 0);
  const text = await jsons()[1].text();
  window.close();

  const other = await setup();
  await other.T.createScene({ name: 'Mine' });
  other.window.confirm = () => false; // Merge
  await other.T.importData(new other.window.File([text], 'export.json', { type: 'application/json' }));
  assert.deepEqual(other.T.state.scenes.map(s => s.name), ['Mine', 'Blank', 'Pictured']);
  assert.strictEqual(new Set(other.T.state.scenes.map(s => s.id)).size, 3, 'merged scenes get new ids');
  other.window.close();
});

test('Import: a broken .zip, or one without campaign.json, is refused', async () => {
  const env = await setup();
  const { T, window } = env;
  const alerts = [];
  window.alert = m => alerts.push(m);
  await T.importData(new window.File(['not a zip'], 'bad.zip', { type: 'application/zip' }));
  await T.importData(new window.File([fflate.zipSync({ 'other.txt': fflate.strToU8('x') })], 'empty.zip', { type: 'application/zip' }));
  assert.match(alerts[0], /not a valid \.zip/);
  assert.match(alerts[1], /no campaign\.json/);
  window.close();
});
