'use strict';

/*
 * Map tokens (js/tokens.js, drawn and moved through js/maps.js): the preset
 * icons, adding and snapping, moving one or several, links to combat entries
 * and characters, unlinking when an entry leaves combat, the hover card,
 * deleting, and pings. Same jsdom stand-ins as test/maps.test.js.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, click, setValue } = require('./helpers/boot.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };
const RECT = { left: 0, top: 0, width: 1000, height: 700 };

async function setup() {
  const env = await boot();
  const { T, window, document } = env;
  T.mapRect = () => RECT;
  env.$ = s => document.querySelector(s);
  env.$$ = s => Array.from(document.querySelectorAll(s));
  click(env.$('#tabs .tab-btn[data-tab="maps"]'));
  // A blank 2000 × 1500 scene with a 50 px square grid at 0,0.
  const { scene } = await T.createScene({ name: 'Arena' });
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
const tokenEl = (env, t) => env.$('#map-svg [data-token="' + t.id + '"]');
// Drags from map point `from` to `to`, pressing on `target` (a token, or the SVG).
function drag(env, target, from, to, extra) {
  const { window } = env;
  const a = toScreen(env, from.x, from.y), b = toScreen(env, to.x, to.y);
  pointer(window, target, 'pointerdown', a[0], a[1], extra);
  pointer(window, window, 'pointermove', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, extra);
  pointer(window, window, 'pointerup', b[0], b[1], extra);
}

test('tokens: 30 preset icons, path data only, each with its author; Settings credits the authors', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  const icons = T.data.tokenIcons;
  assert.strictEqual(icons.length, 30);
  assert.strictEqual(new Set(icons.map(i => i.id)).size, 30);
  icons.forEach(i => {
    assert.match(i.id, /^[a-z-]+\/[a-z0-9-]+$/);
    assert.ok(i.name && i.author, i.id);
    assert.ok(i.paths.length && i.paths.every(d => /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(d)), i.id + ': path data only');
  });
  assert.strictEqual(env.$$('#token-palette [data-icon]').length, 30);
  assert.match($('#set-token-credits').textContent, /Map token icons: .*Delapouite.*Lorc.*game-icons\.net \(CC BY 3\.0\)/);
  window.close();
});

test('tokens: a palette click puts a token in the middle of the view, snapped: odd sizes on a cell center, even sizes on a corner, hexes on a hex center', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  click($('#token-palette [data-icon="lorc/ghost"]'));
  const v = T.mapView(sc);
  const c = { x: v.x + v.w / 2, y: v.y + v.h / 2 };
  const t = sc.tokens[0];
  assert.strictEqual(t.iconId, 'lorc/ghost');
  assert.deepEqual([t.x, t.y], [Math.floor(c.x / 50) * 50 + 25, Math.floor(c.y / 50) * 50 + 25]);
  assert.ok(tokenEl(env, t), 'drawn');
  assert.deepEqual(T.selectedTokenIds(sc), [t.id], 'and selected');
  assert.strictEqual($('#token-edit-title').textContent, 'Ghost');

  assert.deepEqual(T.snapTokenPoint(sc, 112, 160, 2), { x: 100, y: 150 });
  assert.deepEqual(T.snapTokenPoint(sc, 112, 160, 3), { x: 125, y: 175 });
  sc.grid = Object.assign(sc.grid, { type: 'hex', orient: 'flat', size: 60, offsetX: 0, offsetY: 0 });
  const h = T.snapTokenPoint(sc, 47, 30, 2);
  assert.deepEqual(window.MapGrid.cellAt(h.x, h.y, sc.grid), window.MapGrid.cellAt(47, 30, sc.grid));
  assert.ok(T.tokenRadius(sc, 2) > T.tokenRadius(sc, 1));
  window.close();
});

test('tokens: drag a token to move it (snapped; Alt: free); Shift+click selects a second one, and both move together', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  const a = T.addToken(sc, { iconId: 'lorc/ghost', x: 125, y: 125 });
  const b = T.addToken(sc, { iconId: 'lorc/minotaur', x: 225, y: 125 });
  drag(env, tokenEl(env, a), { x: 125, y: 125 }, { x: 340, y: 260 });
  assert.deepEqual([a.x, a.y], [325, 275], 'snapped to the cell it was dropped in');
  assert.deepEqual([b.x, b.y], [225, 125], 'the other one stays');
  assert.deepEqual(T.selectedTokenIds(sc), [a.id]);

  drag(env, tokenEl(env, a), { x: 325, y: 275 }, { x: 340, y: 260 }, { altKey: true });
  assert.deepEqual([a.x, a.y], [340, 260], 'Alt: no snap');

  pointer(window, tokenEl(env, b), 'pointerdown', ...toScreen(env, 225, 125), { shiftKey: true });
  pointer(window, window, 'pointerup', ...toScreen(env, 225, 125), { shiftKey: true });
  assert.deepEqual(T.selectedTokenIds(sc).sort(), [a.id, b.id].sort());
  assert.strictEqual($('#token-edit-title').textContent, '2 tokens');
  drag(env, tokenEl(env, b), { x: 225, y: 125 }, { x: 325, y: 225 });
  assert.deepEqual([b.x, b.y], [325, 225]);
  assert.deepEqual([a.x, a.y], [440, 360], 'moved by the same amount: the group snaps by the dragged token');
  window.close();
});

test('tokens: Shift+drag on the map selects the tokens in the box; a click on the map clears the selection', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  const a = T.addToken(sc, { iconId: 'lorc/ghost', x: 125, y: 125 });
  const b = T.addToken(sc, { iconId: 'lorc/ghost', x: 225, y: 125 });
  T.addToken(sc, { iconId: 'lorc/ghost', x: 625, y: 525 });
  drag(env, $('#map-svg'), { x: 90, y: 90 }, { x: 260, y: 160 }, { shiftKey: true });
  assert.deepEqual(T.selectedTokenIds(sc).sort(), [a.id, b.id].sort());
  assert.strictEqual($('#map-svg .map-box'), null, 'the box is gone after the drag');
  drag(env, $('#map-svg'), { x: 900, y: 900 }, { x: 900, y: 900 });
  assert.deepEqual(T.selectedTokenIds(sc), []);
  assert.ok($('#token-edit').hidden);
  window.close();
});

test('tokens: "From combat" places a linked token with a matching icon; it shows the entry\'s name, HP, side, and turn', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  T.addMonsterEntry({ name: 'Goblin', hd: '1', hp: 6, ac: { asc: 13 }, attacks: [], source: 'shadowdark' });
  T.addMonsterEntry({ name: 'Cave Bear', hd: '4', hp: 20, ac: { asc: 12 }, attacks: [], source: 'shadowdark' });
  T.renderMaps();
  assert.deepEqual(env.$$('#token-from-combat [data-entry]').map(b => b.textContent), ['Goblin', 'Cave Bear']);
  click($('#token-from-combat [data-entry]'));
  const t = sc.tokens[0];
  const goblin = T.state.combat.entries[0];
  assert.deepEqual(t.link, { kind: 'combat', entryId: goblin.id });
  assert.strictEqual(t.iconId, 'caro-asercion/goblin', 'icon by name');
  assert.deepEqual(env.$$('#token-from-combat [data-entry]').map(b => b.textContent), ['Cave Bear'], 'placed entries leave the list');
  click($('#token-from-combat [data-entry]'));
  assert.strictEqual(sc.tokens[1].iconId, 'delapouite/orc-head', 'no matching icon: the monster default');

  const el = tokenEl(env, t);
  assert.strictEqual(el.querySelector('.map-token-label').textContent, 'Goblin');
  assert.strictEqual(el.querySelector('.map-token-body').getAttribute('stroke'), '#e05252', 'enemy ring');
  assert.ok(el.querySelector('.map-token-turn'), 'the active entry\'s token has the turn ring');
  const full = el.querySelector('.map-token-hp').getAttribute('stroke-dasharray');
  T.setEntryHp(goblin, 2);
  T.renderMaps();
  assert.notStrictEqual(tokenEl(env, t).querySelector('.map-token-hp').getAttribute('stroke-dasharray'), full, 'the HP ring follows the HP');

  T.nextTurn();
  T.renderMaps();
  assert.strictEqual(tokenEl(env, t).querySelector('.map-token-turn'), null);
  assert.ok(tokenEl(env, sc.tokens[1]).querySelector('.map-token-turn'), 'Next turn moves the ring');

  tokenEl(env, t).dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
  const card = $('#token-card');
  assert.ok(!card.hidden);
  assert.match(card.textContent, /^Goblin.*HP 2 \/ 6.*AC 13.*Enemy/);
  tokenEl(env, t).dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
  assert.ok(card.hidden);
  window.close();
});

test('tokens: an entry removed from combat leaves its token, named; a character\'s token links to the character; Clear unlinks every token', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  T.createCharacter('# Aria\nHP 8/8\nAC 14');
  T.addCharEntry(T.state.characters[0].id);
  T.addMonsterEntry({ name: 'Goblin', hd: '1', hp: 6, attacks: [], source: 'shadowdark' });
  T.addMonsterEntry({ name: 'Orc', hd: '1', hp: 6, attacks: [], source: 'shadowdark' });
  const [ariaE, gobE, orcE] = T.state.combat.entries;
  const tAria = T.addTokenForEntry(sc, ariaE.id, { x: 125, y: 125 });
  const tGob = T.addTokenForEntry(sc, gobE.id, { x: 225, y: 125 });
  const tOrc = T.addTokenForEntry(sc, orcE.id, { x: 325, y: 125 });
  assert.strictEqual(tAria.iconId, 'delapouite/barbarian', 'a character without a matching icon: the character default');

  T.removeEntry(gobE.id);
  assert.deepEqual(tGob.link, null);
  assert.strictEqual(tGob.label, 'Goblin');
  assert.strictEqual(T.tokenName(tGob), 'Goblin');
  assert.ok(sc.tokens.includes(tGob), 'the token stays');

  T.removeEntry(ariaE.id);
  assert.deepEqual(tAria.link, { kind: 'character', charId: T.state.characters[0].id });
  assert.strictEqual(T.tokenName(tAria), 'Aria');
  assert.match(T.tokenInfo(tAria).ac, /14/);

  window.confirm = () => true;
  click($('#tabs .tab-btn[data-tab="combat"]'));
  click($('#cb-clear'));
  assert.deepEqual(tOrc.link, null);
  assert.strictEqual(tOrc.label, 'Orc');
  window.close();
});

test('tokens: the bar edits label, size, color, and link; with no link the name is the label, else the icon\'s', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  T.createCharacter('# Brannoc\nHP 7/7');
  const t = T.addToken(sc, { iconId: 'lorc/werewolf', x: 125, y: 125 });
  assert.strictEqual(T.tokenName(t), 'Werewolf');
  setValue($('#token-label'), 'Old Grey');
  assert.strictEqual(t.label, 'Old Grey');
  assert.strictEqual(tokenEl(env, t).querySelector('.map-token-label').textContent, 'Old Grey');
  setValue($('#token-edit-size'), '2');
  assert.deepEqual([t.size, t.x, t.y], [2, 150, 150], 'resized and snapped to a corner');
  setValue($('#token-edit-color'), '#123456');
  assert.strictEqual(t.color, '#123456');
  assert.deepEqual(env.$$('#token-link option').map(o => o.textContent), ['No link', 'Character: Brannoc']);
  setValue($('#token-link'), 'character:' + T.state.characters[0].id);
  assert.strictEqual(T.tokenName(t), 'Brannoc');
  assert.deepEqual(T.tokenInfo(t).hp, 7);
  setValue($('#token-link'), '');
  assert.strictEqual(t.link, null);
  window.close();
});

test('tokens: Delete removes the selection; Backspace typed in the label field does not', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  const a = T.addToken(sc, { iconId: 'lorc/ghost', x: 125, y: 125 });
  const key = (target, k) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key($('#token-label'), 'Backspace');
  assert.strictEqual(sc.tokens.length, 1);
  key($('#map-wrap'), 'Delete');
  assert.deepEqual(sc.tokens, []);
  T.addToken(sc, { iconId: 'lorc/ghost', x: 125, y: 125 });
  click($('#token-delete'));
  assert.deepEqual(sc.tokens, []);
  void a;
  window.close();
});

test('tokens: Alt+click on the map pings a point, which is not saved', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  const before = JSON.stringify(sc);
  const p = toScreen(env, 400, 300);
  pointer(window, $('#map-svg'), 'pointerdown', p[0], p[1], { altKey: true });
  pointer(window, window, 'pointerup', p[0], p[1], { altKey: true });
  const ping = $('#map-svg .map-layer-overlay .map-ping');
  assert.ok(ping);
  assert.deepEqual([Number(ping.getAttribute('cx')), Number(ping.getAttribute('cy'))].map(Math.round), [400, 300]);
  assert.strictEqual(JSON.stringify(sc), before);
  window.close();
});

test('tokens: names are escaped in the label and the hover card; tokens are saved in their system\'s document', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  T.addMonsterEntry({ name: '<img src=x onerror=alert(1)>', hd: '1', hp: 3, attacks: [], source: 'shadowdark' });
  const t = T.addTokenForEntry(sc, T.state.combat.entries[0].id, { x: 125, y: 125 });
  assert.strictEqual($('#map-svg img'), null);
  assert.strictEqual(tokenEl(env, t).querySelector('.map-token-label').textContent, '<img src=x onerror=alert(1)>');
  tokenEl(env, t).dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  assert.strictEqual($('#token-card img'), null);
  await T.flushSave();
  assert.deepEqual(T.splitState(T.state).osr.scenes[0].tokens.map(x => x.id), [t.id]);
  window.close();
});
