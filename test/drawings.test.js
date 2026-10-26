'use strict';

/*
 * Drawing on a map scene (js/drawings.js) and undo/redo of every scene change
 * (js/history.js). Same jsdom stand-ins as test/maps.test.js.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, click, setValue } = require('./helpers/boot.js');

const RECT = { left: 0, top: 0, width: 1000, height: 700 };

async function setup() {
  const env = await boot();
  const { T, window, document } = env;
  T.mapRect = () => RECT;
  env.$ = s => document.querySelector(s);
  env.$$ = s => Array.from(document.querySelectorAll(s));
  click(env.$('#tabs .tab-btn[data-tab="maps"]'));
  const { scene } = await T.createScene({ name: 'Sketch' });
  env.sc = scene;
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
// A pointer path over map points: down at the first, moves, up at the last.
function stroke(env, points, target, extra) {
  const { window } = env;
  const s = points.map(p => toScreen(env, p[0], p[1]));
  pointer(window, target || env.$('#map-svg'), 'pointerdown', s[0][0], s[0][1], extra);
  s.slice(1).forEach(p => pointer(window, window, 'pointermove', p[0], p[1], extra));
  pointer(window, window, 'pointerup', s[s.length - 1][0], s[s.length - 1][1], extra);
}
function clickAt(env, x, y, extra) {
  const s = toScreen(env, x, y);
  pointer(env.window, env.$('#map-svg'), 'pointerdown', s[0], s[1], extra);
  pointer(env.window, env.window, 'pointerup', s[0], s[1], extra);
}
const useTool = (env, t) => click(env.$('.map-tool[data-tool="' + t + '"]'));
const key = (env, target, k, extra) => target.dispatchEvent(new env.window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
const near = (a, b) => Math.abs(a - b) < 0.01;

test('drawings: the RDP simplification keeps the corners of a freehand line and drops the noise', async () => {
  const { T, window } = await setup();
  const line = [[0, 0], [1, 0.1], [2, -0.1], [3, 0], [3.1, 1], [2.9, 2], [3, 3]];
  assert.deepEqual(T.simplifyLine(line, 0.5), [[0, 0], [3, 0], [3, 3]]);
  assert.deepEqual(T.simplifyLine([[0, 0], [5, 5]], 1), [[0, 0], [5, 5]]);
  window.close();
});

test('drawings: pen, line, rectangle, and ellipse by drag; the draw bar sets color, width, fill, and opacity', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  assert.ok($('#map-draw-bar').hidden, 'no draw bar with the hand tool');
  useTool(env, 'pen');
  assert.ok(!$('#map-draw-bar').hidden);
  assert.match($('#map-status').textContent, /Drag to draw/);
  stroke(env, [[100, 100], [150, 102], [200, 99], [250, 101], [300, 100]]);
  const pen = sc.drawings[0];
  assert.strictEqual(pen.kind, 'pen');
  assert.ok(pen.points.length >= 2 && pen.points.length < 5, 'simplified: ' + pen.points.length);
  assert.ok($('#map-svg polyline.map-drawing'));
  const zoom = T.mapView(sc).w / RECT.width;
  assert.ok(near(pen.width, 4 * zoom), 'a 4 px line at this zoom');

  click($('#draw-swatches [data-color="#6ea8fe"]'));
  setValue($('#draw-width'), '8');
  setValue($('#draw-opacity'), '0.5');
  useTool(env, 'line');
  stroke(env, [[100, 300], [400, 350]]);
  const line = sc.drawings[1];
  assert.deepEqual([line.kind, line.stroke, line.opacity], ['line', '#6ea8fe', 0.5]);
  assert.ok(near(line.width, 8 * zoom));
  assert.deepEqual(line.points.map(p => p.map(Math.round)), [[100, 300], [400, 350]]);

  useTool(env, 'rect');
  assert.ok(!$('#draw-fill-label').hidden, 'Fill shows for shapes');
  $('#draw-fill').checked = true;
  $('#draw-fill').dispatchEvent(new window.Event('change', { bubbles: true }));
  stroke(env, [[500, 500], [450, 420]]);
  const rect = sc.drawings[2];
  assert.deepEqual([rect.kind, rect.fill].concat(['x', 'y', 'w', 'h'].map(k => Math.round(rect[k]))), ['rect', true, 450, 420, 50, 80]);
  assert.strictEqual($('#map-svg rect.map-drawing').getAttribute('fill'), '#6ea8fe');

  useTool(env, 'ellipse');
  stroke(env, [[600, 100], [700, 160]]);
  assert.strictEqual(sc.drawings[3].kind, 'ellipse');
  assert.ok($('#map-svg ellipse.map-drawing'));

  // A click without a drag draws nothing (but a pen dot is a dot).
  useTool(env, 'rect');
  stroke(env, [[800, 800], [800, 800]]);
  assert.strictEqual(sc.drawings.length, 4);
  window.close();
});

test('drawings: a polygon closes on its first corner, on a double-click, or with Enter; Escape cancels', async () => {
  const env = await setup();
  const { window, $, sc } = env;
  useTool(env, 'polygon');
  clickAt(env, 100, 100); clickAt(env, 300, 100); clickAt(env, 200, 300);
  assert.ok($('#map-svg .map-drawing-draft'), 'the corners so far show');
  clickAt(env, 101, 101);
  assert.strictEqual(sc.drawings.length, 1);
  assert.deepEqual(sc.drawings[0].points.map(p => p.map(Math.round)), [[100, 100], [300, 100], [200, 300]]);

  // A double-click is two presses: the first adds the corner, the second (detail 2) closes.
  clickAt(env, 500, 500); clickAt(env, 700, 500); clickAt(env, 600, 700, { detail: 1 }); clickAt(env, 600, 700, { detail: 2 });
  assert.strictEqual(sc.drawings.length, 2, 'a double-click on the last corner closes it');

  clickAt(env, 500, 100); clickAt(env, 700, 100); clickAt(env, 600, 200);
  key(env, $('#map-wrap'), 'Enter');
  assert.strictEqual(sc.drawings.length, 3);
  assert.strictEqual(sc.drawings[2].points.length, 3);

  clickAt(env, 900, 900); clickAt(env, 950, 900);
  key(env, $('#map-wrap'), 'Escape');
  clickAt(env, 0, 0);
  assert.strictEqual(sc.drawings.length, 3, 'cancelled');
  void window;
  window.close();
});

test('drawings: text goes where you click, typed in a box on the map; its name is escaped', async () => {
  const env = await setup();
  const { window, $, sc } = env;
  window.prompt = () => { throw new Error('no prompt()'); };
  useTool(env, 'text');
  clickAt(env, 300, 200);
  const input = $('#map-text-input');
  assert.strictEqual(input.hidden, false, 'the text box shows');
  input.value = '<b>Secret door</b>';
  key(env, input, 'Enter');
  assert.strictEqual(input.hidden, true);
  const t = sc.drawings[0];
  assert.deepEqual([t.kind, t.text, Math.round(t.x), Math.round(t.y)], ['text', '<b>Secret door</b>', 300, 200]);
  assert.strictEqual($('#map-svg text.map-drawing').textContent, '<b>Secret door</b>');
  assert.strictEqual($('#map-svg b'), null);

  clickAt(env, 400, 200);
  key(env, input, 'Enter');
  assert.strictEqual(sc.drawings.length, 1, 'no text: nothing');

  clickAt(env, 400, 200);
  input.value = 'Gone';
  key(env, input, 'Escape');
  assert.strictEqual(sc.drawings.length, 1, 'Escape writes nothing');

  clickAt(env, 400, 200);
  input.value = 'First';
  clickAt(env, 500, 300);             // a second click writes the first text
  assert.deepEqual(sc.drawings.map(d => d.text), ['<b>Secret door</b>', 'First']);
  assert.strictEqual(input.hidden, false, 'and opens a new box');
  input.value = 'Kept';
  useTool(env, 'pan');                // another tool writes it too
  assert.deepEqual(sc.drawings.map(d => d.text), ['<b>Secret door</b>', 'First', 'Kept']);
  window.close();
});

test('drawings: sticky mode keeps the tool; off, the hand tool comes back after one use', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  assert.strictEqual(T.mapsState().sticky, true, 'on by default');
  assert.ok($('#map-sticky').classList.contains('is-active'));
  useTool(env, 'rect');
  stroke(env, [[100, 100], [200, 200]]);
  assert.strictEqual(T.mapsState().tool, 'rect');

  click($('#map-sticky'));
  assert.strictEqual(T.mapsState().sticky, false);
  assert.ok(!$('#map-sticky').classList.contains('is-active'));
  assert.strictEqual(window.localStorage.getItem('osr_map_sticky'), 'off', 'kept in this browser');
  stroke(env, [[300, 300], [400, 400]]);
  assert.strictEqual(sc.drawings.length, 2);
  assert.strictEqual(T.mapsState().tool, 'pan', 'back to the hand');

  useTool(env, 'measure');
  stroke(env, [[0, 0], [200, 0]]);
  assert.strictEqual(T.mapsState().tool, 'pan');
  assert.match($('#map-status').textContent, /cells/, 'the measure stays in the status');

  useTool(env, 'text');
  clickAt(env, 100, 100);
  $('#map-text-input').value = 'Hi';
  key(env, $('#map-text-input'), 'Enter');
  assert.strictEqual(T.mapsState().tool, 'pan');
  T.setMapSticky(true);
  window.close();
});

test('drawings: Alt + a number chooses a tool; Alt+S toggles sticky mode; never in a text field', async () => {
  const env = await setup();
  const { T, window, document, $ } = env;
  const alt = (code, target) => key(env, target || document.body, '', { code, altKey: true });
  alt('Digit6');
  assert.strictEqual(T.mapsState().tool, 'pen');
  alt('Digit2');
  assert.strictEqual(T.mapsState().tool, 'measure');
  alt('Equal');
  assert.strictEqual(T.mapsState().tool, 'eraser');
  alt('Digit5');
  assert.strictEqual(T.mapsState().tool, 'eraser', 'the hidden explore tool is not chosen');
  alt('Digit1', $('#grid-size'));
  assert.strictEqual(T.mapsState().tool, 'eraser', 'not from a field');
  alt('Digit1');
  assert.strictEqual(T.mapsState().tool, 'pan');
  assert.match($('.map-tool[data-tool="pen"]').title, /Alt\+6/, 'the key shows on hover');
  alt('KeyS');
  assert.strictEqual(T.mapsState().sticky, false);
  alt('KeyS');
  assert.strictEqual(T.mapsState().sticky, true);
  alt('KeyG');
  assert.strictEqual($('#map-grid-panel').open, true);
  alt('KeyK');
  window.close();
});

test('drawings: a right-click on a drawing changes its color and thickness, or deletes it', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  const d = T.addDrawing(sc, { kind: 'line', points: [[100, 100], [300, 100]], stroke: '#e05252', width: 2 });
  const stroke1 = T.mapView(sc).w / RECT.width;
  const menuOn = id => $('#map-svg [data-drawing="' + id + '"]').dispatchEvent(new window.MouseEvent('contextmenu', { clientX: 50, clientY: 50, button: 2, bubbles: true, cancelable: true }));
  menuOn(d.id);
  assert.strictEqual($('#map-menu').hidden, false);
  click($('#map-menu [data-color="#6ea8fe"]'));
  assert.strictEqual(sc.drawings[0].stroke, '#6ea8fe');
  assert.strictEqual($('#map-menu').hidden, true, 'a choice closes the menu');
  menuOn(d.id);
  click($('#map-menu [data-act="size"][data-n="16"]'));
  assert.ok(near(sc.drawings[0].width, 16 * stroke1), '16 screen px at this zoom');
  T.undoScene(sc);
  assert.strictEqual(sc.drawings[0].width, 2, 'one undo step');
  menuOn(d.id);
  click($('#map-menu [data-act="delete"]'));
  assert.strictEqual(sc.drawings.length, 0);

  const t = T.addDrawing(sc, { kind: 'text', x: 100, y: 100, text: 'Hi', size: 16, stroke: '#e05252' });
  menuOn(t.id);
  assert.match($('#map-menu').textContent, /Size/);
  click($('#map-menu [data-act="size"][data-n="32"]'));
  assert.ok(near(sc.drawings[0].size, 32 * stroke1));
  window.close();
});

test('drawings: the eraser removes the drawing it touches; the hand tool selects and moves a drawing; Delete removes it', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  const a = T.addDrawing(sc, { kind: 'rect', x: 100, y: 100, w: 50, h: 50, stroke: '#e05252', width: 2 });
  const b = T.addDrawing(sc, { kind: 'line', points: [[300, 300], [400, 300]], stroke: '#e05252', width: 2 });
  const c = T.addDrawing(sc, { kind: 'line', points: [[500, 300], [600, 300]], stroke: '#e05252', width: 2 });
  const el = id => $('#map-svg [data-drawing="' + id + '"]');

  useTool(env, 'eraser');
  assert.ok($('#map-draw-bar').hidden, 'no style bar for the eraser');
  stroke(env, [[310, 300], [350, 300]], el(b.id));
  assert.deepEqual(sc.drawings.map(d => d.id), [a.id, c.id]);

  useTool(env, 'pan');
  stroke(env, [[120, 120], [220, 170]], el(a.id));
  assert.deepEqual([a.x, a.y].map(Math.round), [200, 150], 'moved by the drag');
  assert.ok(el(a.id).classList.contains('is-selected'));
  assert.strictEqual(env.document.activeElement, $('#map-wrap'), 'a click on the map gives the map the keys');
  key(env, env.document.activeElement, 'Delete');
  assert.deepEqual(sc.drawings.map(d => d.id), [c.id]);
  void window;
  window.close();
});

test('drawings: "Clear drawings" asks, and one undo brings them all back', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  T.addDrawing(sc, { kind: 'line', points: [[0, 0], [10, 10]] });
  T.addDrawing(sc, { kind: 'line', points: [[20, 0], [30, 10]] });
  useTool(env, 'pen');
  window.confirm = () => false;
  click($('#draw-clear'));
  assert.strictEqual(sc.drawings.length, 2);
  window.confirm = () => true;
  click($('#draw-clear'));
  assert.deepEqual(sc.drawings, []);
  assert.ok($('#draw-clear').disabled);
  click($('#map-undo'));
  assert.strictEqual(T.activeScene().drawings.length, 2);
  window.close();
});

test('undo/redo: every kind of scene change — tokens, drawings, grid, name — undoes and redoes to the same state', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  const sc = () => T.activeScene();
  const states = [JSON.stringify(sc())];
  const step = fn => { fn(); states.push(JSON.stringify(sc())); };
  step(() => T.addToken(sc(), { iconId: 'lorc/ghost', x: 125, y: 125 }));
  step(() => stroke(env, [[125, 125], [325, 225]], $('#map-svg [data-token]')));
  step(() => setValue($('#token-edit-size'), '2'));
  step(() => setValue($('#token-label'), 'Boo'));
  step(() => T.addDrawing(sc(), { kind: 'rect', x: 10, y: 10, w: 40, h: 40 }));
  step(() => setValue($('#grid-size'), '70'));
  step(() => { window.prompt = () => 'Renamed'; click($('#map-rename')); });
  step(() => T.deleteTokens(sc(), sc().tokens.map(t => t.id)));
  const strip = s => { const o = JSON.parse(s); return JSON.stringify([o.name, o.grid, o.tokens, o.drawings]); };
  assert.strictEqual(new Set(states.map(strip)).size, states.length, 'each step changed the scene');

  for (let i = states.length - 1; i > 0; i--) {
    assert.ok(!$('#map-undo').disabled);
    click($('#map-undo'));
    assert.strictEqual(strip(JSON.stringify(sc())), strip(states[i - 1]), 'undo to step ' + (i - 1));
  }
  assert.ok($('#map-undo').disabled, 'nothing left to undo');
  for (let i = 1; i < states.length; i++) {
    click($('#map-redo'));
    assert.strictEqual(strip(JSON.stringify(sc())), strip(states[i]), 'redo to step ' + i);
  }
  assert.ok($('#map-redo').disabled);
  window.close();
});

test('undo/redo: a new change drops the redo steps; each scene has its own history; keys work but not in a text field', async () => {
  const env = await setup();
  const { T, window, document, $ } = env;
  const first = T.activeScene();
  T.addDrawing(first, { kind: 'line', points: [[0, 0], [10, 10]] });
  T.addDrawing(first, { kind: 'line', points: [[20, 0], [30, 10]] });
  key(env, document.body, 'z', { ctrlKey: true });
  assert.strictEqual(first.drawings.length, 1);
  T.addDrawing(first, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 });
  assert.ok($('#map-redo').disabled, 'the new change dropped the redo step');

  const { scene: second } = await T.createScene({ name: 'Second' });
  T.addDrawing(second, { kind: 'line', points: [[1, 1], [2, 2]] });
  setValue($('#map-scene'), first.id);
  key(env, document.body, 'z', { metaKey: true });
  assert.deepEqual(T.activeScene().drawings.map(d => d.kind), ['line'], 'undid the first scene\'s own last step');
  setValue($('#map-scene'), second.id);
  assert.strictEqual(T.activeScene().drawings.length, 1, 'the second scene is untouched');
  key(env, document.body, 'z', { ctrlKey: true });
  assert.strictEqual(T.activeScene().drawings.length, 0);
  key(env, document.body, 'z', { ctrlKey: true, shiftKey: true });
  assert.strictEqual(T.activeScene().drawings.length, 1, 'Ctrl+Shift+Z redoes');
  key(env, document.body, 'z', { ctrlKey: true });
  key(env, document.body, 'y', { ctrlKey: true });
  assert.strictEqual(T.activeScene().drawings.length, 1, 'Ctrl+Y redoes too');

  key(env, $('#grid-unit'), 'z', { ctrlKey: true });
  assert.strictEqual(T.activeScene().drawings.length, 1, 'a text field keeps its own undo');
  click($('#tabs .tab-btn[data-tab="character"]'));
  key(env, document.body, 'z', { ctrlKey: true });
  assert.strictEqual(T.activeScene().drawings.length, 1, 'not on another tab');
  window.close();
});

test('undo: a deleted token comes back linked if its combat entry still exists, else unlinked; an unlink from Combat is not an undo step', async () => {
  const env = await setup();
  const { T, window } = env;
  const sc = T.activeScene();
  T.addMonsterEntry({ name: 'Goblin', hd: '1', hp: 6, attacks: [], source: 'shadowdark' });
  T.addMonsterEntry({ name: 'Orc', hd: '1', hp: 6, attacks: [], source: 'shadowdark' });
  const [gob, orc] = T.state.combat.entries;
  const tg = T.addTokenForEntry(sc, gob.id, { x: 125, y: 125 });
  T.addTokenForEntry(sc, orc.id, { x: 225, y: 125 });
  T.removeEntry(orc.id);
  const orcToken = sc.tokens[1];
  assert.deepEqual([orcToken.link, orcToken.label], [null, 'Orc']);
  T.undoScene(sc);
  assert.strictEqual(sc.tokens.length, 1, 'the undo removed the Orc token (its add), not the unlink');

  T.deleteTokens(sc, [tg.id]);
  T.removeEntry(gob.id);
  T.undoScene(sc);
  const back = sc.tokens.find(t => t.id === tg.id);
  assert.ok(back, 'the Goblin token is back');
  assert.strictEqual(back.link, null, 'its entry is gone: unlinked');
  window.close();
});
