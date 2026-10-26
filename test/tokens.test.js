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
  // A square grid (a new scene has hexes), with no undo step for it.
  setValue(env.$('#grid-type'), 'square');
  T.resetHistories();
  T.renderMaps();
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
  const pop = window.document.querySelector('.comp-pop');
  assert.ok(pop, 'a linked token opens a popup');
  assert.match(pop.textContent, /^Goblin.*enemy[\s\S]*AC 13[\s\S]*HP 2 \/ 6/);
  assert.ok($('#token-card').hidden);
  T.closeAllCompPops();
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

test('tokens: a right-click on a token changes its color, links and unlinks it, or deletes it', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  T.createCharacter('# Brannoc\nHP 7/7');
  T.addMonsterEntry({ name: 'Goblin', hd: '1', hp: 6, attacks: [], source: 'shadowdark' });
  const t = T.addToken(sc, { iconId: 'lorc/werewolf', x: 125, y: 125 });
  T.addToken(sc, { iconId: 'lorc/werewolf', x: 325, y: 125 });
  const menuOn = tok => tokenEl(env, tok).dispatchEvent(new window.MouseEvent('contextmenu', { clientX: 40, clientY: 40, button: 2, bubbles: true, cancelable: true }));
  menuOn(t);
  assert.strictEqual($('#map-menu').hidden, false);
  assert.deepEqual(T.selectedTokenIds(sc), [t.id], 'the token is selected');
  assert.match($('#map-menu .ctx-head').textContent, /Werewolf/);
  assert.strictEqual($('#map-menu [data-act="unlink"]'), null, 'no Unlink while not linked');
  click($('#map-menu [data-color="#6fcf6f"]'));
  assert.strictEqual(t.color, '#6fcf6f');
  assert.strictEqual($('#map-menu').hidden, true);

  menuOn(t);
  const goblin = T.state.combat.entries[0];
  click($('#map-menu [data-link="combat:' + goblin.id + '"]'));
  assert.deepEqual(t.link, { kind: 'combat', entryId: goblin.id });
  assert.strictEqual(T.tokenName(t), 'Goblin');
  menuOn(t);
  assert.ok($('#map-menu [data-link="combat:' + goblin.id + '"]').classList.contains('is-on'), 'the link has a check');
  click($('#map-menu [data-link="character:' + T.state.characters[0].id + '"]'));
  assert.strictEqual(T.tokenName(t), 'Brannoc');
  menuOn(t);
  click($('#map-menu [data-act="unlink"]'));
  assert.strictEqual(t.link, null);
  assert.strictEqual(T.tokenName(t), 'Brannoc', 'it keeps the name it showed');

  menuOn(t);
  env.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.strictEqual($('#map-menu').hidden, true, 'Escape closes it');
  menuOn(t);
  click($('#map-menu [data-act="delete"]'));
  assert.strictEqual(sc.tokens.length, 1);
  T.undoScene(sc);
  assert.strictEqual(sc.tokens.length, 2, 'undo brings it back');
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

test('tokens: a right-click edits the label: Enter, a change, or closing the menu saves it; Escape drops it; the default color is black', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  const t = T.addToken(sc, { iconId: 'lorc/werewolf', x: 125, y: 125 });
  assert.strictEqual(t.color, '#000000');
  assert.strictEqual($('#token-color').value, '#000000');
  const menuOn = () => tokenEl(env, t).dispatchEvent(new window.MouseEvent('contextmenu', { clientX: 40, clientY: 40, button: 2, bubbles: true, cancelable: true }));
  const key = (target, k) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const field = () => $('#map-menu input[data-act="label"]');

  menuOn();
  assert.strictEqual(field().value, '');
  assert.strictEqual(field().placeholder, 'Werewolf');
  field().value = 'Alpha';
  key(field(), 'Enter');
  assert.strictEqual(t.label, 'Alpha');
  assert.strictEqual($('#map-menu').hidden, true, 'Enter closes the menu');
  assert.strictEqual(T.tokenName(t), 'Alpha');

  menuOn();
  assert.strictEqual(field().value, 'Alpha');
  field().value = 'Beta';
  field().dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.strictEqual(t.label, 'Beta');
  assert.strictEqual($('#map-menu').hidden, false, 'a change keeps the menu open');
  field().value = 'Gamma';
  pointer(window, $('#map-svg'), 'pointerdown', 900, 600);
  pointer(window, window, 'pointerup', 900, 600);
  assert.strictEqual($('#map-menu').hidden, true);
  assert.strictEqual(t.label, 'Gamma', 'a click outside the menu saves it');

  menuOn();
  field().value = 'Delta';
  key(field(), 'Escape');
  assert.strictEqual($('#map-menu').hidden, true);
  assert.strictEqual(t.label, 'Gamma', 'Escape drops the change');
  T.undoScene(sc);
  assert.strictEqual(T.activeScene().tokens[0].label, 'Beta', 'each save is one undo step');
  window.close();
});

test('tokens: the popup of a linked token shows the stat block and combat statuses, removes a status, pins, and follows combat', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  const doc = window.document;
  const over = el => el.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
  T.addMonsterEntry({ name: 'Goblin', hd: '1', hp: 6, ac: { asc: 13 }, attacksText: '1 club +1 (1d6)', attacks: [], abilities: [{ name: 'Sneaky', text: 'Hides well.' }], source: 'shadowdark' });
  const gob = T.state.combat.entries[0];
  T.toggleStatus(gob.id, 'Prone');
  T.toggleStatus(gob.id, 'Blinded');
  const t = T.addTokenForEntry(sc, gob.id, { x: 125, y: 125 });
  over(tokenEl(env, t));
  const pop = doc.querySelector('.comp-pop');
  assert.match(pop.textContent, /Attacks:[\s\S]*1 club \+1 \(1d6\)[\s\S]*Sneaky/);
  assert.ok(pop.querySelector('.roll'), 'the dice in the stat block roll');
  assert.deepEqual(Array.from(pop.querySelectorAll('.status-tag')).map(x => x.dataset.name), ['Prone', 'Blinded']);
  click(pop.querySelector('.status-tag[data-name="Prone"] .status-x'));
  assert.deepEqual(gob.statuses.map(x => x.name), ['Blinded'], 'the ✕ removes the status in Combat');
  assert.deepEqual(Array.from(doc.querySelectorAll('.comp-pop .status-tag')).map(x => x.dataset.name), ['Blinded']);
  click(doc.querySelector('.comp-pop [data-act="pin"]'));
  assert.ok(doc.querySelector('.comp-pop').classList.contains('is-pinned'));
  T.toggleStatus(gob.id, 'Stunned');
  assert.deepEqual(Array.from(doc.querySelectorAll('.comp-pop .status-tag')).map(x => x.dataset.name), ['Blinded', 'Stunned'], 'a pinned popup follows combat');
  T.closeAllCompPops();

  // A character token: the sheet, and the statuses of the character's combat entry.
  T.createCharacter('# Aria\nHP 8/8\nAC 14\n\nSword 1d8');
  const ch = T.state.characters[0];
  const ct = T.addToken(sc, { iconId: T.data.tokenIcons[0].id, x: 325, y: 125 });
  ct.link = { kind: 'character', charId: ch.id };
  T.addCharEntry(ch.id);
  T.toggleStatus(T.state.combat.entries[1].id, 'Prone');
  T.renderMaps();
  over(tokenEl(env, ct));
  const cp = doc.querySelector('.comp-pop');
  assert.match(cp.textContent, /Aria[\s\S]*Sword 1d8/);
  assert.deepEqual(Array.from(cp.querySelectorAll('.status-tag')).map(x => x.dataset.name), ['Prone']);

  // Another token replaces an unpinned popup; an unlinked token shows the small card.
  over(tokenEl(env, t));
  assert.strictEqual(doc.querySelectorAll('.comp-pop').length, 1);
  const u = T.addToken(sc, { iconId: T.data.tokenIcons[0].id, x: 525, y: 125 });
  T.renderMaps();
  over(tokenEl(env, u));
  assert.ok(!$('#token-card').hidden);
  assert.match($('#token-card').textContent, /not linked/);
  window.close();
});

test('tokens: on the Maps tab, the Dice Roller\'s "Apply damage" hits the selected token\'s combat entry', async () => {
  const env = await setup();
  const { T, window, $, sc } = env;
  T.addMonsterEntry({ name: 'Goblin', hd: '1', hp: 6, ac: { asc: 13 }, attacks: [], source: 'shadowdark' });
  T.addMonsterEntry({ name: 'Orc', hd: '1', hp: 9, ac: { asc: 13 }, attacks: [], source: 'shadowdark' });
  const [gob, orc] = T.state.combat.entries;
  T.setSelected(orc.id);
  const tg = T.addTokenForEntry(sc, gob.id, { x: 125, y: 125 });
  T.selectTokens(sc, []);
  T.renderMaps();
  const apply = $('#dice-apply');
  T.lastRoll = null;
  T.updateApplyButton();
  assert.ok(apply.hidden, 'no roll yet');
  window.Math.random = () => 0.5; // 1d4 → 3
  setValue($('#custom-formula'), '1d4');
  $('#dice-custom').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.ok(!apply.hidden, 'shows on the Maps tab');
  assert.match(apply.textContent, /Orc/, 'no token selected: the selected combatant');
  T.selectTokens(sc, [tg.id]);
  T.renderMaps();
  assert.match(apply.textContent, /Apply damage to Goblin/);
  click(apply);
  assert.strictEqual(T.entryHp(gob), 3);
  assert.strictEqual(T.entryHp(orc), 9);
  window.close();
});

