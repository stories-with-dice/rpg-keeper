'use strict';

/*
 * UI / integration tests: they drive the real DOM in index.html through the
 * app's delegated event listeners (clicks, input/change events, keydown) and
 * assert on rendered output + persisted state.
 *
 * EasyMDE is not loaded (see test/helpers/boot.js), so the Journal and the
 * Compendium body editor are plain <textarea>s here — the app's documented
 * fallback.
 */

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const { boot, rigRandom, face, click, setValue, key } = require('./helpers/boot.js');

let window, document, T;

before(async () => {
  ({ window, document, T } = await boot());
});
beforeEach(() => {
  if (T._restoreRandom) { T._restoreRandom(); T._restoreRandom = null; }
  window.confirm = () => true;
  window.prompt = (_m, d) => d;
  T.reset();
});

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const logText = () => $$('#log-list li').map(li => li.textContent).join('\n');
const logCount = () => $$('#log-list li:not(.log-empty)').length;
const savedState = () => JSON.parse(window.localStorage.getItem('osr_manager_v1'));
function rig(f) { T._restoreRandom = rigRandom(window, f); }
function tab(name) { click($$('#tabs .tab-btn').find(b => b.dataset.tab === name)); }
function submit(form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

/* ================================================================== */
/* Tabs                                                               */
/* ================================================================== */

test('tabs: clicking a tab button activates that button and its panel only', () => {
  tab('combat');
  assert.ok($('#tab-combat').classList.contains('is-active'));
  assert.ok(!$('#tab-character').classList.contains('is-active'));
  assert.ok($$('#tabs .tab-btn').find(b => b.dataset.tab === 'combat').classList.contains('is-active'));
  tab('compendium');
  assert.ok($('#tab-compendium').classList.contains('is-active'));
  assert.equal($$('.tab-panel.is-active').length, 1);
});

/* ================================================================== */
/* Dice roller                                                        */
/* ================================================================== */

test('dice grid: renders the 12 presets and a click logs a roll', () => {
  const btns = $$('#dice-grid button');
  assert.equal(btns.length, 12);
  rig(face(20, 20));
  click(btns.find(b => b.textContent === 'd20'));
  assert.equal(logCount(), 1);
  assert.match(logText(), /Dice Roller/);
  assert.match(logText(), /= 20/);
});

test('dice custom form: a valid formula rolls, an invalid one only shows "Invalid"', () => {
  rig(face(3, 6));
  setValue($('#custom-formula'), '2d6+1');
  submit($('#dice-custom'));
  assert.equal(logCount(), 1);
  assert.match($('#dice-last').textContent, /7/);

  setValue($('#custom-formula'), '1d0');   // a malformed die — evalFormula returns null
  submit($('#dice-custom'));
  assert.equal(logCount(), 1, 'invalid formula is not logged');
  assert.match($('#dice-last').textContent, /Invalid/);
});

test('apply-damage button: hidden until a Dice Roller roll, then applies to the selected combatant', () => {
  const apply = $('#dice-apply');
  assert.equal(apply.hidden, true);

  T.addMonsterEntry({ name: 'Troll', hd: '6', hp: 30, ac: { asc: 15 }, attacks: [], abilities: [] });
  T.setSelected(T.state.combat.entries[0].id);

  rig(face(5, 6));
  setValue($('#custom-formula'), '2d6');   // total 10
  submit($('#dice-custom'));
  assert.equal(apply.hidden, false);
  assert.equal(apply.disabled, false);
  assert.match(apply.textContent, /Troll/);

  click(apply);
  assert.equal(T.entryHp(T.state.combat.entries[0]), 20);
});

/* ================================================================== */
/* Session log                                                        */
/* ================================================================== */

test('session log: Clear empties the list back to the empty-state row', () => {
  rig(face(1, 20));
  click($$('#dice-grid button').find(b => b.textContent === 'd20'));
  assert.equal(logCount(), 1);
  click($('#btn-log-clear'));            // confirm() stubbed true
  assert.equal(logCount(), 0);
  assert.ok($('#log-list .log-empty'));
  assert.deepEqual(savedState().log, []);
});

/* ================================================================== */
/* Character tab                                                      */
/* ================================================================== */

test('New blank: creates a character, shows the sheet, hides the empty state', () => {
  assert.equal($('#char-empty').hidden, false);
  click($('#btn-new-blank'));
  assert.equal(T.state.characters.length, 1);
  assert.equal($('#char-empty').hidden, true);
  assert.equal($('#char-view').hidden, false);
  assert.equal($$('#char-select option').length, 1);
});

test('New from text: modal → Create builds a character with the detected name', () => {
  click($('#btn-new-text'));
  assert.equal($('#paste-modal').hidden, false);
  setValue($('#paste-area'), '# Brother Cadfael\nA cleric of the abbey.');
  click($('#btn-paste-create'));
  assert.equal($('#paste-modal').hidden, true);
  assert.equal(T.activeChar().name, 'Brother Cadfael');
  assert.match($('#view-name').textContent, /Brother Cadfael/);
});

test('Rename: updates the name and renames the linked HP tracker', () => {
  click($('#btn-new-blank'));
  window.prompt = () => 'Sir Kay';
  click($('#btn-rename'));
  assert.equal(T.activeChar().name, 'Sir Kay');
  assert.ok(T.state.consumables.some(c => c.name === 'HP (Sir Kay)'));
  assert.match($('#view-name').textContent, /Sir Kay/);
});

test('Delete: removes the active character and its HP tracker', () => {
  click($('#btn-new-blank'));
  const name = T.activeChar().name;
  click($('#btn-delete'));               // confirm() stubbed true
  assert.equal(T.state.characters.length, 0);
  assert.equal(T.state.consumables.some(c => c.name === `HP (${name})`), false);
  assert.equal($('#char-empty').hidden, false);
});

test('Edit → Save: the raw markdown textarea persists changes and returns to View', () => {
  T.createCharacter('# Hero\nHP 6/6');
  T.renderAll();
  click($('#btn-mode-edit'));
  assert.equal($('#mode-edit').hidden, false);
  const area = $('#edit-host .edit-col-area');
  assert.match(area.value, /# Hero/);
  setValue(area, '# Hero\nHP 6/6\n\nWields a 1d8 mace.');
  click($('#btn-save'));
  assert.equal($('#mode-edit').hidden, true);
  assert.match(T.activeChar().body, /1d8 mace/);
  assert.equal(T.mode, 'view');
});

test('View mode: a dice formula in the sheet renders a clickable .roll span logged under the character', () => {
  T.createCharacter('# Archer\n\nShortbow attack for 1d6+2 damage.');
  T.renderAll();
  const roll = $('#mode-view .roll');
  assert.ok(roll, 'a .roll span was produced');
  assert.equal(roll.dataset.formula, '1d6+2');
  rig(face(4, 6));
  click(roll);
  assert.equal(logCount(), 1);
  assert.match(logText(), /Archer/);
});

test('View mode: [bracketed] names render as .comp-ref, short system tags do not', () => {
  T.createCharacter('# Knight [SD]\n\nCarries a [Longsword] and a [Shield].');
  T.renderAll();
  const refs = $$('#mode-view .comp-ref');
  assert.deepEqual(refs.map(r => r.dataset.name).sort(), ['Longsword', 'Shield']);
});

test('View mode: a "Name: ±N" declaration highlights as .var-name + .roll.var-value; a $ref in a formula uses it', () => {
  T.createCharacter('# Hero\n\nCON: -1\n\nAttack: 1d6+$CON+2');
  T.renderAll();
  const varName = $('#mode-view .var-name');
  assert.ok(varName, 'the variable name is highlighted');
  assert.equal(varName.textContent, 'CON');
  const varValue = $('#mode-view .roll.var-value');
  assert.ok(varValue, 'the value stays a clickable roll, flagged as a variable');
  assert.equal(varValue.dataset.formula, '1d20-1');
  const dice = $$('#mode-view .roll').find(el => el.dataset.formula === '1d6+$CON+2');
  assert.ok(dice, 'the $CON reference stays part of the same dice span');
  assert.equal(dice.textContent, '1d6+CON+2', 'the "$" is not shown, only used internally for rolling');
  assert.match(dice.title, /1d6\+CON \(-1\)\+2/, 'hovering shows the variable\'s current value');
  rig(face(4, 6));
  click(dice);
  assert.match(logText(), /1d6-1\+2/, 'CON (-1) was substituted before rolling');
});

test('Dice Roller: typing "$" suggests detected variables; picking one inserts the identifier', () => {
  T.createCharacter('# Hero\n\nCON: -1, Heal: +2');
  T.renderAll();
  const inp = $('#custom-formula');
  setValue(inp, '1d6+$CO');
  assert.equal($('#comp-ac').hidden, false, 'the $ suggestion popup opened');
  const item = $('#comp-ac .ac-item');
  assert.match(item.textContent, /CON/);
  item.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.equal(inp.value, '1d6+$CON', 'the "$" stays; only the typed query is corrected/completed');
  assert.equal($('#comp-ac').hidden, true);
});

test('Right-click a dice formula opens the roll popup; a modifier and stacked variables all roll together', () => {
  T.createCharacter('# Hero\n\nCON: -1, STR: +2\n\nAttack: 1d6');
  T.renderAll();
  const dice = $$('#mode-view .roll').find(el => el.dataset.formula === '1d6');
  dice.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.equal($('#roll-popup').hidden, false, 'the roll popup opened');
  assert.equal($('#sel-menu').hidden, true, '"Add to Compendium" did not also open');
  assert.equal($('#rp-formula').textContent, '1d6');

  setValue($('#rp-mod'), '3');
  const selects = () => $$('#rp-vars .rp-var-select');
  assert.equal(selects().length, 1, 'one empty variable picker to start, none selected by default');
  setValue(selects()[0], 'CON');
  assert.equal(selects().length, 2, 'picking one adds a second picker to stack another');
  setValue(selects()[1], 'STR');

  rig(face(4, 6));
  click($('#rp-roll'));
  assert.equal($('#roll-popup').hidden, true);
  assert.match(logText(), /1d6\+3-1\+2/, 'base formula + modifier + CON(-1) + STR(+2)');
});

test('Right-click "Add to Compendium" with an existing match: links the selection, replacing text with the entry\'s title', () => {
  T.state.compendium = [
    { id: 'lant1', name: 'Lantern', category: 'Items', source: 'Core', body: 'Sheds light.', createdAt: 1 },
  ];
  T.createCharacter('# Hero\n\nCarries a lit lantern for the dungeon.');
  T.renderAll();
  const tgt = T.charViewTarget(null);
  T.openSelMenu(10, 10, 'lantern', tgt);
  assert.equal($('#sel-menu').hidden, false);
  const matchBtn = $('#sel-menu [data-act="link"][data-id="lant1"]');
  assert.ok(matchBtn, 'the matching entry is offered first');
  assert.ok($('#sel-menu [data-act="add-comp"]'), 'a "create new entry" option is still offered');
  click(matchBtn);
  assert.equal($('#sel-menu').hidden, true);
  assert.match(T.activeChar().body, /\[Lantern\]/);
  assert.doesNotMatch(T.activeChar().body, /lit lantern for/);
  assert.match(logText(), /linked "lantern" to "Lantern"/);
});

test('Right-click "Add to Compendium" with no match: only offers "create new"; saving still links it', () => {
  T.createCharacter('# Hero\n\nWields a Frostbrand.');
  T.renderAll();
  const tgt = T.charViewTarget(null);
  T.openSelMenu(10, 10, 'Frostbrand', tgt);
  assert.equal($$('#sel-menu [data-act="link"]').length, 0, 'no matches to offer');
  const createBtn = $('#sel-menu [data-act="add-comp"]');
  assert.match(createBtn.textContent, /Add.*Frostbrand.*to Compendium/);
  click(createBtn);
  assert.equal($('#comp-modal').hidden, false);
  assert.equal($('#comp-f-name').value, 'Frostbrand');
  $('#comp-f-body').value = 'A blade of ice.';
  click($('#comp-save'));
  assert.match(T.activeChar().body, /\[Frostbrand\]/);
});

test('Character B dropdown: enabled once two characters exist, shows both columns', () => {
  T.createCharacter('# Alpha\nHP 5/5');
  T.createCharacter('# Beta\nHP 5/5');
  T.renderAll();
  assert.equal($('#char-select-b').disabled, false);
  const alphaId = T.state.characters.find(c => c.name === 'Alpha').id;
  T.state.activeId = T.state.characters.find(c => c.name === 'Beta').id;
  setValue($('#char-select-b'), alphaId);
  assert.equal(T.state.activeIdB, alphaId);
  assert.ok($('#mode-view .char-cols'));
});

test('Character B dropdown: $refs in each column resolve against that column\'s own character', () => {
  T.createCharacter('# Alpha\n\nCON: +2\n\nAttack: 1d6+$CON');
  T.createCharacter('# Beta\n\nCON: -3\n\nAttack: 1d6+$CON');
  T.renderAll(); // Beta is active (created last); no need to switch it
  const alphaId = T.state.characters.find(c => c.name === 'Alpha').id;
  setValue($('#char-select-b'), alphaId);
  const cols = $$('#mode-view .char-cols > .char-col');
  const rollIn = col => Array.from(col.querySelectorAll('.roll')).find(el => el.dataset.formula === '1d6+$CON');
  assert.match(rollIn(cols[0]).title, /CON \(-3\)/, 'left column (Beta, active) shows its own CON');
  assert.match(rollIn(cols[1]).title, /CON \(2\)/, 'right column (Alpha, B) shows its own CON');
});

/* ================================================================== */
/* Journal                                                            */
/* ================================================================== */

test('Journal: Enter logs the entry as a Journal note and clears the box; Shift+Enter does not', () => {
  const area = $('#notes-area');
  setValue(area, 'The party makes camp.');
  key(area, 'Enter', { shiftKey: true });
  assert.equal(logCount(), 0, 'Shift+Enter is a newline, not a submit');

  setValue(area, 'The party makes camp.');
  key(area, 'Enter');
  assert.equal(logCount(), 1);
  assert.match(logText(), /Journal/);
  assert.match(logText(), /makes camp/);
  assert.equal(area.value, '');
});

/* ================================================================== */
/* Consumables                                                        */
/* ================================================================== */

test('Consumables: + Add appends a row; steppers bump and clamp; ✕ deletes', () => {
  const row = () => $('#consumables-list .cons-row');   // re-query: renders rebuild the list

  click($('#btn-cons-add'));
  assert.equal($$('#consumables-list .cons-row').length, 1);

  setValue(row().querySelector('.cons-name'), 'Torches');   // name edit does not re-render
  click(row().querySelector('.cons-inc'));
  click(row().querySelector('.cons-inc'));
  click(row().querySelector('.cons-inc'));
  assert.equal(row().querySelector('.cons-val-input').value, '3');
  assert.equal(T.state.consumables[0].value, 3);

  setValue(row().querySelector('.cons-max-input'), '2');    // change → clamp + re-render
  assert.equal(row().querySelector('.cons-val-input').value, '2', 'value clamped down to the new max');
  assert.equal(T.state.consumables[0].value, 2);

  click(row().querySelector('.cons-dec'));
  click(row().querySelector('.cons-dec'));
  click(row().querySelector('.cons-dec'));                  // clamped at 0
  assert.equal(T.state.consumables[0].value, 0);

  click(row().querySelector('.cons-del'));                  // last tracker deletes without a prompt
  assert.equal($$('#consumables-list .cons-row').length, 0);
});

/* ================================================================== */
/* Combat tab                                                         */
/* ================================================================== */

test('Combat: add a character combatant via the dropdown', () => {
  T.createCharacter('# Fighter\n> **HP** 8/8');
  T.renderAll();
  tab('combat');
  const sel = $('#cb-add-char');
  const opt = $$('#cb-add-char option').find(o => o.textContent.includes('Fighter'));
  setValue(sel, opt.value);
  const rows = $$('#tracker-list .cbt-row');
  assert.equal(rows.length, 1);
  assert.match(rows[0].querySelector('.cbt-name').textContent, /Fighter/);
  assert.equal($('#tracker-empty').hidden, true);
});

test('Combat: round +/- and Next/Prev turn move the markers', () => {
  T.addMonsterEntry({ name: 'A', hd: '1', hp: 5, ac: { asc: 12 }, attacks: [], abilities: [] });
  T.addMonsterEntry({ name: 'B', hd: '1', hp: 5, ac: { asc: 12 }, attacks: [], abilities: [] });
  tab('combat');

  click($('#cb-round-inc'));
  assert.equal($('#cb-round').textContent, '2');
  click($('#cb-round-dec'));
  assert.equal($('#cb-round').textContent, '1');

  const ids = T.state.combat.entries.map(e => e.id);
  T.state.combat.activeId = ids[0];
  T.renderAll();
  click($('#cb-turn-next'));
  assert.equal(T.state.combat.activeId, ids[1]);
  assert.match($('#cb-turn-name').textContent, /B/);
  click($('#cb-turn-prev'));
  assert.equal(T.state.combat.activeId, ids[0]);
});

test('Combat: clicking a row selects it; the HP stepper adjusts that combatant', () => {
  T.addMonsterEntry({ name: 'Gnoll', hd: '2', hp: 9, ac: { asc: 13 }, attacks: [], abilities: [] });
  tab('combat');
  const row = $('#tracker-list .cbt-row');
  click(row.querySelector('.cbt-name'));
  assert.equal(T.state.combat.selectedId, T.state.combat.entries[0].id);
  assert.ok($('#tracker-list .cbt-row').classList.contains('is-selected'));

  click($('#tracker-list .cbt-hp-dec'));
  assert.equal(T.entryHp(T.state.combat.entries[0]), 8);
  assert.match($('#combatant-detail').textContent, /Gnoll/);
});

test('Combat: ✕ removes a row; Clear empties the tracker', () => {
  T.addMonsterEntry({ name: 'X', hd: '1', hp: 3, ac: { asc: 10 }, attacks: [], abilities: [] });
  T.addMonsterEntry({ name: 'Y', hd: '1', hp: 3, ac: { asc: 10 }, attacks: [], abilities: [] });
  tab('combat');
  click($('#tracker-list .cbt-row .cbt-remove'));
  assert.equal($$('#tracker-list .cbt-row').length, 1);
  click($('#cb-clear'));                 // confirm() stubbed true
  assert.equal(T.state.combat.entries.length, 0);
  assert.equal($('#tracker-empty').hidden, false);
});

/* ================================================================== */
/* Bestiary tab                                                       */
/* ================================================================== */

test('Bestiary tab: lists monsters, filters by name and HD, shows a count', () => {
  T.state.monsters = [
    { id: 'm1', name: 'Goblin', source: 'shadowdark', hd: '1', hdNum: 1, hp: 4, ac: { asc: 12 }, attacks: [], abilities: [] },
    { id: 'm2', name: 'Bear', source: 'shadowdark', hd: '5', hdNum: 5, hp: 30, ac: { asc: 13 }, attacks: [], abilities: [] },
  ];
  tab('bestiary');
  T.renderAll();
  assert.equal($$('#mb-list .mb-row').length, 2);
  assert.match($('#mb-count').textContent, /2 \/ 2/);
  setValue($('#mb-search'), 'gob');
  assert.deepEqual($$('#mb-list .comp-name').map(n => n.textContent), ['Goblin']);
  setValue($('#mb-search'), '');
  setValue($('#mb-hd-min'), '5');
  assert.deepEqual($$('#mb-list .comp-name').map(n => n.textContent), ['Bear']);
});

test('Bestiary "+ New monster" and Combat\'s "+ Add monster…" open the same shared modal', () => {
  tab('bestiary');
  click($('#mb-new'));
  assert.equal($('#monster-modal').hidden, false);
  click($('#mm-close'));
  tab('combat');
  click($('#cb-add-monster'));
  assert.equal($('#monster-modal').hidden, false);
});

test('Bestiary: "Fill in fields" builds a monster and adds it to the library', () => {
  T.state.monsters = [];
  tab('bestiary');
  T.renderAll();
  click($('#mb-new'));
  click($('#mm-mode .mm-mode-btn[data-mode="fields"]'));
  assert.equal($('#mm-mode .mm-mode-fields').hidden, false);
  const host = $('#mm-fields-host');
  setValue(host.querySelector('.mf-f-name'), 'Field Beastie');
  setValue(host.querySelector('.mf-f-hd'), '2');
  setValue(host.querySelector('.mf-f-hp'), '9');
  setValue(host.querySelector('.mf-f-ac-asc'), '13');
  click($('#mm-fields-lib'));
  const added = T.state.monsters.find(m => m.name === 'Field Beastie');
  assert.ok(added, 'the monster was added to the library');
  assert.equal(added.hd, '2');
  assert.equal(added.hp, 9);
  assert.equal(added.ac.asc, 13);
  assert.equal(added.source, 'shadowdark');
  assert.ok($$('#mb-list .comp-name').some(n => n.textContent === 'Field Beastie'), 'appears in the Bestiary list');
});

test('Bestiary generator: rolls a monster and lands it in the fields form for review before saving', () => {
  T.state.monsters = [];
  tab('bestiary');
  T.renderAll();
  setValue($('#mb-gen-pl'), '2');
  setValue($('#mb-gen-mutations'), '1');
  click($('#mb-generate'));
  assert.equal($('#monster-modal').hidden, false);
  assert.equal($('#mm-mode .mm-mode-fields').hidden, false, 'opens straight into "Fill in fields"');
  const host = $('#mm-fields-host');
  const name = host.querySelector('.mf-f-name').value;
  assert.match(name, /^PL 2 .+ Creature$/);
  assert.equal(host.querySelector('.mf-f-schema').value, 'shadowdark');
  const abilityNames = $$('.mf-abil-row .mf-abil-name').map(el => el.value);
  assert.deepEqual(abilityNames, ['Strength', 'Weakness', 'Mutation']);
  // Rename it, then save — the review step lets the roll be edited first.
  setValue(host.querySelector('.mf-f-name'), 'My Named Horror');
  click($('#mm-fields-lib'));
  const saved = T.state.monsters.find(m => m.name === 'My Named Horror');
  assert.ok(saved, 'saved under the edited name');
  assert.equal(saved.source, 'shadowdark');
});

test('Bestiary: Edit switches an existing (pasted) monster to "Fill in fields", prefilled, and saves changes', () => {
  T.state.monsters = [
    { id: 'm1', name: 'Ogre', source: 'shadowdark', desc: 'A brute.', raw: 'Ogre\nAC 12, HP 20, LV 4',
      ac: { asc: 12, desc: null, thac0: null }, hd: '4', hdNum: 4, hp: 20, move: 'near', align: 'C',
      xp: null, moraleML: null, atkBonus: 4, attacksText: '1 club +4 (1d10)',
      attacks: [{ label: 'club', count: 1, toHit: 4, damage: '1d10', note: '', raw: '' }],
      stats: null, saveTargets: null, savesText: '', abilities: [] },
  ];
  tab('bestiary');
  T.renderAll();
  click($('.mb-row[data-id="m1"] .mb-edit'));
  assert.equal($('#monster-edit-modal').hidden, false);
  click($('#me-mode .mm-mode-btn[data-mode="fields"]'));
  const host = $('#me-fields-host');
  assert.equal(host.querySelector('.mf-f-name').value, 'Ogre');
  assert.equal(host.querySelector('.mf-f-hp').value, '20');
  setValue(host.querySelector('.mf-f-hp'), '25');
  click($('#me-save'));
  const updated = T.state.monsters.find(m => m.id === 'm1');
  assert.equal(updated.hp, 25);
  assert.equal(updated.name, 'Ogre');
});

/* ================================================================== */
/* Compendium tab                                                     */
/* ================================================================== */

test('Compendium: + New entry → fill the form → Save adds a row and updates the count', () => {
  tab('compendium');
  assert.equal($('#comp-empty').hidden, false);
  click($('#comp-new'));
  assert.equal($('#comp-modal').hidden, false);
  setValue($('#comp-f-name'), 'Potion of Healing');
  $('#comp-f-cat').value = 'Items';
  setValue($('#comp-f-src'), 'Homebrew');
  $('#comp-f-body').value = 'Drink to restore 2d4+2 HP.';
  click($('#comp-save'));
  assert.equal($('#comp-modal').hidden, true);
  assert.equal(T.state.compendium.length, 1);
  const rows = $$('#comp-list .comp-row');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Potion of Healing/);
  assert.match($('#comp-count').textContent, /1 \/ 1/);
});

test('Compendium: name search + Fuzzy toggle filter the visible rows', () => {
  T.state.compendium = [
    { id: '1', name: 'Longsword', category: 'Items', source: 'Core', body: 'A blade.', createdAt: 1 },
    { id: '2', name: 'Torch', category: 'Items', source: 'Core', body: 'It burns.', createdAt: 2 },
  ];
  tab('compendium');
  T.renderAll();
  assert.equal($$('#comp-list .comp-row').length, 2);

  setValue($('#comp-search'), 'sword');
  assert.equal($$('#comp-list .comp-row').length, 1);
  assert.match($('#comp-list .comp-row').textContent, /Longsword/);

  setValue($('#comp-search'), 'longswrd');           // typo → nothing with substring match
  assert.equal($$('#comp-list .comp-row').length, 0);
  $('#comp-fuzzy').checked = true;
  $('#comp-fuzzy').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal($$('#comp-list .comp-row').length, 1, 'fuzzy match finds Longsword');
});

test('Compendium: unticking a Category checkbox hides entries in that category', () => {
  T.state.compendium = [
    { id: '1', name: 'Longsword', category: 'Items', source: 'Core', body: '', createdAt: 1 },
    { id: '2', name: 'Bless', category: 'Spells', source: 'Core', body: '', createdAt: 2 },
  ];
  tab('compendium');
  T.renderAll();
  assert.equal($$('#comp-list .comp-row').length, 2);
  const items = $('#comp-cats input[data-cat="Items"]');
  items.checked = false;
  items.dispatchEvent(new window.Event('change', { bubbles: true }));
  const shown = $$('#comp-list .comp-row').map(r => r.querySelector('.comp-name').textContent);
  assert.deepEqual(shown, ['Bless']);
});

test('Compendium: right-clicking a Category (or Source) filter isolates it', () => {
  T.state.compendium = [
    { id: '1', name: 'Longsword', category: 'Items', source: 'Core', body: '', createdAt: 1 },
    { id: '2', name: 'Bless', category: 'Spells', source: 'Core', body: '', createdAt: 2 },
    { id: '3', name: 'Potion', category: 'Items', source: 'Homebrew', body: '', createdAt: 3 },
  ];
  tab('compendium');
  T.renderAll();
  assert.equal($$('#comp-list .comp-row').length, 3);

  const rightClick = (el) => el.dispatchEvent(new window.Event('contextmenu', { bubbles: true, cancelable: true }));
  const checkedCats = () => $$('#comp-cats input[data-cat]').filter(cb => cb.checked).map(cb => cb.dataset.cat);
  const checkedSrcs = () => $$('#comp-sources input[data-src]').filter(cb => cb.checked).map(cb => cb.dataset.src);
  const names = () => $$('#comp-list .comp-row .comp-name').map(n => n.textContent);

  rightClick($$('#comp-cats .comp-cat').find(l => l.textContent.trim() === 'Spells'));
  assert.deepEqual(checkedCats(), ['Spells'], 'only the right-clicked category stays ticked');
  assert.deepEqual(names(), ['Bless']);

  rightClick($$('#comp-cats .comp-cat').find(l => l.textContent.trim() === 'Items'));
  assert.deepEqual(checkedCats(), ['Items'], 'right-clicking another category re-isolates to just that one');

  rightClick($$('#comp-sources .comp-cat').find(l => l.textContent.trim() === 'Homebrew'));
  assert.deepEqual(checkedSrcs(), ['Homebrew'], 'only the right-clicked source stays ticked');
  assert.deepEqual(names(), ['Potion'], 'list narrows to Items + Homebrew');
});

test('Compendium: clicking a row opens the editor populated; ✕ deletes the entry', () => {
  T.state.compendium = [
    { id: 'e1', name: 'Rope', category: 'Items', source: 'Core', body: '60 feet of hemp.', createdAt: 1 },
  ];
  tab('compendium');
  T.renderAll();
  click($('#comp-list .comp-row .comp-name'));
  assert.equal($('#comp-modal').hidden, false);
  assert.equal($('#comp-f-name').value, 'Rope');
  assert.equal($('#comp-f-body').value, '60 feet of hemp.');
  click($('#comp-cancel'));

  click($('#comp-list .comp-row .comp-row-del'));    // confirm() stubbed true
  assert.equal(T.state.compendium.length, 0);
  assert.equal($$('#comp-list .comp-row').length, 0);
});

test('Compendium editor: Enter (incl. in the body) saves; Shift+Enter in the body is a newline; Escape cancels', () => {
  tab('compendium');
  click($('#comp-new'));
  assert.equal($('#comp-modal').hidden, false);
  setValue($('#comp-f-name'), 'Torch');
  setValue($('#comp-f-body'), 'Line one');
  key($('#comp-f-body'), 'Enter', { shiftKey: true });
  assert.equal($('#comp-modal').hidden, false, 'Shift+Enter in the body must not save/close');
  assert.equal(T.state.compendium.length, 0);

  key($('#comp-f-body'), 'Enter');
  assert.equal($('#comp-modal').hidden, true, 'Enter in the body saves and closes, same as clicking Save');
  assert.equal(T.state.compendium.length, 1);
  assert.equal(T.state.compendium[0].name, 'Torch');

  click($('#comp-new'));
  setValue($('#comp-f-name'), 'Unsaved Item');
  key($('#comp-f-name'), 'Escape');
  assert.equal($('#comp-modal').hidden, true, 'Escape cancels the editor');
  assert.equal(T.state.compendium.length, 1, 'Escape did not create a second entry');
});

/* ================================================================== */
/* Settings tab                                                       */
/* ================================================================== */

test('Settings: Style theme select recolours (data-theme on <html>) and is persisted', () => {
  tab('settings');
  setValue($('#set-theme'), 'fantasy');
  assert.equal(document.documentElement.dataset.theme, 'fantasy');
  assert.equal(savedState().settings.theme, 'fantasy');
  assert.match(logText(), /Style theme/);

  setValue($('#set-theme'), 'default');
  assert.equal(document.documentElement.dataset.theme, undefined);
});

test('Settings: Scarlet Heroes checkbox toggles the setting and logs it', () => {
  tab('settings');
  const cb = $('#set-scarlet-heroes');
  assert.equal(cb.checked, false);
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(T.state.settings.scarletHeroes, true);
  assert.equal(savedState().settings.scarletHeroes, true);
  assert.match(logText(), /Scarlet Heroes/);
});

test('Settings: Compendium "Reseed defaults" adds the bundled gear; "Delete all" clears it', () => {
  tab('settings');
  click($('#set-reseed-compendium'));
  const seeded = T.state.compendium.length;
  assert.ok(seeded > 0);
  assert.match($('#set-comp-count').textContent, new RegExp(`${seeded} entr`));

  click($('#set-clear-compendium'));     // confirm() stubbed true
  assert.equal(T.state.compendium.length, 0);
});

test('Settings: Monster library "Reload defaults" repopulates state.monsters', async () => {
  T.state.monsters = [];
  T.state.monstersSeeded = false;
  tab('settings');
  click($('#set-reload-monsters'));      // confirm() stubbed true; seedMonsters() is async
  await new Promise(r => setTimeout(r, 30));
  assert.ok(T.state.monsters.length > 0);
  assert.match($('#set-lib-count').textContent, /monster/);
});

/* ================================================================== */
/* Persistence & export                                               */
/* ================================================================== */

test('persistence: an action writes the new state straight to localStorage', () => {
  click($('#btn-new-blank'));
  assert.equal(savedState().characters.length, 1);
  assert.equal(savedState().activeId, T.state.activeId);
});

test('export: clicking Export builds a JSON object URL and an <a download>', () => {
  const urls = [];
  const realCreate = window.URL.createObjectURL;
  window.URL.createObjectURL = (blob) => { urls.push(blob); return 'blob:osr-export'; };
  try {
    click($('#btn-new-blank'));
    click($('#btn-export'));
    assert.equal(urls.length, 1);
    assert.equal(urls[0].type, 'application/json');
  } finally {
    window.URL.createObjectURL = realCreate;
  }
});
