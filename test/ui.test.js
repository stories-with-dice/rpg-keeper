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
const { boot, rigRandom, face, fire, click, setValue, key, savedState: readSaved, savedTables, slPack } = require('./helpers/boot.js');

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
const savedState = () => readSaved(T); // the current campaign as saved in IndexedDB
// A second rig() in one test restores the real Math.random first (see test/logic.test.js).
function rig(f) { if (T._restoreRandom) T._restoreRandom(); T._restoreRandom = rigRandom(window, f); }
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
  tab('combat');
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

  tab('character');
  assert.equal(apply.hidden, true, 'only on the Combat tab');
  tab('combat');
  assert.equal(apply.hidden, false);

  click(apply);
  assert.equal(T.entryHp(T.state.combat.entries[0]), 20);
});

/* ================================================================== */
/* Session log                                                        */
/* ================================================================== */

test('session log: Clear empties the list back to the empty-state row', async () => {
  rig(face(1, 20));
  click($$('#dice-grid button').find(b => b.textContent === 'd20'));
  assert.equal(logCount(), 1);
  click($('#btn-log-clear'));            // confirm() stubbed true
  assert.equal(logCount(), 0);
  assert.ok($('#log-list .log-empty'));
  assert.deepEqual((await savedState()).log, []);
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

test('View mode: a bare "NN%" renders as a clickable roll; clicking it logs the actual d100 result and a verdict', () => {
  T.createCharacter('# Kevin Johnson\n\nCivil War Re-Enactor 65%');
  T.renderAll();
  const pct = $$('#mode-view .roll').find(el => el.dataset.formula === '%65');
  assert.ok(pct, 'a %65 roll span was produced');
  assert.equal(pct.textContent, '65%');
  rig(face(30, 100));
  click(pct);
  assert.equal(logCount(), 1);
  const last = T.state.log[T.state.log.length - 1];
  assert.equal(last.total, 30);
  assert.equal(last.detail, 'Success');
  assert.match(logText(), /Kevin Johnson/);
});

test('View mode: a ```ua fence renders as a computed statblock panel; Edit mode shows the raw fenced text', () => {
  const body = '# Kevin Johnson [Unknown Armies]\n\n```ua\n' +
    'Identities\n' +
    'Civil War Re-Enactor 65%* — Provides Initiative, Substitutes for Dodge, Substitutes for Fitness\n\n' +
    'Shock\n' +
    'Helplessness: 1 hardened / 1 failed\n' +
    'Isolation: 3 hardened / 2 failed\n' +
    'Self: 2 hardened / 0 failed\n' +
    'Unnatural: 1 hardened / 2 failed\n' +
    'Violence: 2 hardened / 3 failed\n' +
    '```\n';
  T.state.settings.system = 'ua3e'; // the character dropdown only lists the active system's characters
  T.createCharacter(body);
  T.renderAll();
  const block = $('#mode-view .ua-block');
  assert.ok(block, 'the fence rendered as a statblock panel');
  assert.doesNotMatch($('#mode-view').innerHTML, /```/, 'no literal fence markers remain in View mode');
  assert.match(block.textContent, /Identities/, 'section headers render (bug: they were missing)');
  // Isolation: nothing Substitutes for Status/Pursuit -> plain computed values.
  assert.match(block.textContent, /Status 50%/); // Isolation hardened=3 -> 65-15=50
  assert.match(block.textContent, /Pursuit 30%/);
  // the computed ability percentage is itself a clickable roll, same as any other NN%
  const abilityRoll = $$('#mode-view .ua-block .roll').find(el => el.dataset.formula === '%50');
  assert.ok(abilityRoll, 'the computed Status 50% is clickable');
  // Civil War Re-Enactor Substitutes for Dodge and Fitness -> the ability
  // label shows its own 65%, not the plain computed 60%/20%, color-linked via .ua-sub.
  assert.doesNotMatch(block.textContent, /Fitness 60%/);
  const fitnessLink = $$('#mode-view .ua-block .ua-ability-label .ua-sub').find(el => el.textContent === 'Fitness');
  assert.ok(fitnessLink, 'Fitness is color-linked to the substituting identity');
  const identityLink = $$('#mode-view .ua-block .ua-identities .ua-sub').find(el => el.textContent === 'Civil War Re-Enactor');
  assert.ok(identityLink, 'the identity name shares the same .ua-sub link');

  click($('#btn-mode-edit'));
  assert.match($('#edit-host textarea').value, /```ua/, 'Edit mode shows the raw fence, unrendered');
});

test('View mode: clicking a Shock dot sets Hardened/Failed and recomputes the Abilities table live', () => {
  const body = '# Kevin Johnson [Unknown Armies]\n\n```ua\nShock\nHelplessness: 1 hardened / 1 failed\n```\n';
  T.state.settings.system = 'ua3e';
  T.createCharacter(body);
  T.renderAll();

  const dots = () => $$('#mode-view .ua-dots[data-meter="Helplessness"][data-field="hardened"] .ua-dot');
  assert.equal(dots().length, 9);
  assert.equal($$('#mode-view .ua-dots[data-meter="Helplessness"][data-field="hardened"] .ua-dot.is-filled').length, 1);
  assert.match($('#mode-view .ua-block').textContent, /Fitness 60%/); // hardened=1 -> 65-5=60

  click(dots()[4]); // dot 5 -> Hardened 5
  assert.match(T.activeChar().body, /Helplessness: 5 hardened \/ 1 failed/, 'the fence text itself was rewritten');
  assert.equal($$('#mode-view .ua-dots[data-meter="Helplessness"][data-field="hardened"] .ua-dot.is-filled').length, 5);
  assert.match($('#mode-view .ua-block').textContent, /Fitness 40%/); // hardened=5 -> 65-25=40
  assert.doesNotMatch($('#mode-view .ua-block').textContent, /Fitness 60%/);
  assert.equal(logCount(), 1);
  assert.match(logText(), /Kevin Johnson/);
  assert.match(logText(), /Helplessness Hardened 1 → 5/);

  // clicking the currently-topmost filled dot again drops it back by one
  click(dots()[4]);
  assert.match(T.activeChar().body, /Helplessness: 4 hardened \/ 1 failed/);
  assert.equal(logCount(), 2);
  assert.match(logText(), /Helplessness Hardened 5 → 4/);

  // Failed dots are independent, clamp at 5, and flag Insanity Syndrome at 5
  const fDots = () => $$('#mode-view .ua-dots[data-meter="Helplessness"][data-field="failed"] .ua-dot');
  click(fDots()[4]);
  assert.match(T.activeChar().body, /Helplessness: 4 hardened \/ 5 failed/);
  assert.match($('#mode-view .ua-block').textContent, /Insanity syndrome/);
  assert.equal(logCount(), 3);
  assert.match(logText(), /Helplessness Failed 1 → 5/);
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

test('Consumables: grouped by character, each with its short labels; Shared trackers last', () => {
  T.state.settings.system = 'brp';
  T.createCharacter('# Edith Jensen [BRP]\n\nHP: 24/24; PP: 10/10\n');
  T.createCharacter('# Leo Sato [BRP]\n\nHP: 18/18\n');
  T.state.consumables.push({ id: 'r1', name: 'Rations', value: 3, max: 3 });
  T.renderAll();
  const groups = $$('#consumables-list .cons-group').map(g =>
    [g.querySelector('.cons-group-head').textContent].concat(Array.from(g.querySelectorAll('.cons-name')).map(i => i.value)));
  assert.deepEqual(groups, [['Edith Jensen', 'HP', 'PP'], ['Leo Sato', 'HP'], ['Shared', 'Rations']]);

  // Editing a short label keeps the tracker the character's.
  const pp = $$('#consumables-list .cons-group')[0].querySelectorAll('.cons-name')[1];
  setValue(pp, 'Power');
  assert.ok(T.state.consumables.some(c => c.name === 'Power (Edith Jensen)'));
});

test('Consumables: HP/Wounds trackers only show for the active system; switching System toggles them without deleting either', () => {
  T.createCharacter('# Garrick [WWN]\nA warrior.');
  T.createCharacter('```ua\nWound Threshold: 50\n\nShock\n```\n', { name: 'Kevin' });
  T.state.consumables.push({ id: 'r1', name: 'Rations', value: 3, max: 3 });
  T.renderAll();

  const names = () => $$('#consumables-list .cons-row').map(r => r.dataset.name).sort();
  assert.deepEqual(names(), ['HP (Garrick)', 'Rations']);

  tab('settings');
  setValue($('#set-system'), 'ua3e');
  assert.deepEqual(names(), ['Rations', 'Wounds (Kevin)']);

  setValue($('#set-system'), 'osr');
  assert.deepEqual(names(), ['HP (Garrick)', 'Rations']);

  // still never deleted underneath
  assert.equal(T.state.consumables.length, 3);
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

test('Combat: a BRP monster shows Armor/DB/characteristics instead of the OSR AC/HD/Saves/Morale', () => {
  T.addMonsterEntry({
    name: 'Dwarf', source: 'brp', system: 'brp', desc: 'Stout and grudge-bearing.', raw: '',
    ac: { asc: null, desc: null, thac0: null }, hd: '', hdNum: 0, hp: 12, move: '6', align: '', xp: null, moraleML: null,
    atkBonus: null, attacksText: 'Hammer 35%, 1D6+dm; Battleaxe 50%, 1D8+2+dm', attacks: [],
    stats: null, saveTargets: null, savesText: '',
    abilities: [{ name: 'Powers', text: 'Natural Super Sense (Dark Vision) at half POW.' }],
    characteristics: { STR: 14, CON: 15, SIZ: 6, INT: 13, POW: 10, DEX: 10, CHA: 10 },
    armor: 8, armorNote: 'chain and a light helm', damageBonus: 'None', skillsText: 'Appraise 50%, Dodge 40%'
  });
  tab('combat');
  const row = $('#tracker-list .cbt-row');
  assert.match(row.textContent, /Armor 8/);
  assert.match(row.textContent, /DB None/);
  assert.doesNotMatch(row.textContent, /\bAC\b/);
  assert.equal(row.querySelector('.cbt-hd'), null, 'no HD stepper for a system with no Hit Dice');

  click(row.querySelector('.cbt-name'));
  const detail = $('#combatant-detail').textContent;
  assert.match(detail, /Major Wound/);
  assert.match(detail, /STR/);
  assert.match(detail, /14/);
  assert.match(detail, /chain and a light helm/);
  assert.match(detail, /Battleaxe/);
  assert.deepEqual($$('#combatant-detail .cd-lines li').map(li => li.textContent), ['Hammer 35%, 1D6+0', 'Battleaxe 50%, 1D8+2+0'],
    'one attack per line');
  assert.match(detail, /Appraise/);
  assert.match(detail, /Dark Vision/);
  assert.doesNotMatch(detail, /THAC0/);
  assert.doesNotMatch(detail, /Morale/);
  // A "None" damage bonus contributes "+0", not literal "dm" text.
  assert.match(detail, /1D6\+0/);
  assert.doesNotMatch(detail, /dm\b/i);
  // The bare "50%"/"1D6+0" text is still auto-linked into clickable rolls.
  assert.ok($('#combatant-detail .roll'), 'attacks/skills text is annotated for clickable dice/percentage rolls');
});

test('Combat (BRP): rows show the DEX rank; an edited rank and Sort by DEX reorder the tracker', () => {
  T.state.settings.system = 'brp';
  tab('combat');
  T.renderCombat();
  assert.equal($('#cb-sort-rank').hidden, false);
  assert.equal($('#cb-sort-rank').textContent, 'Sort by DEX');
  assert.equal($('#cb-brp-hint').hidden, false);
  const mon = (name, DEX) => ({ name, source: 'brp', system: 'brp', hp: 10, characteristics: { DEX, INT: 7 }, attacks: [], abilities: [] });
  T.addMonsterEntry(mon('Wolf', 13));
  T.addMonsterEntry(mon('Tiger', 19));
  const rows = () => $$('#tracker-list .cbt-row .cbt-name').map(n => n.textContent);
  assert.deepEqual(rows(), ['Tiger', 'Wolf']);
  const wolfDex = $$('#tracker-list .cbt-row')[1].querySelector('.cbt-rank');
  assert.equal(wolfDex.value, '13');
  assert.match($$('#tracker-list .cbt-row')[1].textContent, /INT 7/);
  setValue(wolfDex, '20');
  assert.equal(T.state.combat.entries.find(e => e.name === 'Wolf').dexRank, 20);
  click($('#cb-sort-rank'));
  assert.deepEqual(rows(), ['Wolf', 'Tiger']);
  setValue($$('#tracker-list .cbt-row')[0].querySelector('.cbt-rank'), '');
  assert.equal(T.state.combat.entries.find(e => e.name === 'Wolf').dexRank, null, 'a blank rank goes back to DEX');

  T.state.settings.system = 'osr';
  T.renderCombat();
  assert.equal($('#cb-sort-rank').hidden, true);
});

test('Settings (BRP): "BRP combat order" switches the tracker to INT rank and re-sorts it', () => {
  T.state.settings.system = 'brp';
  T.renderSettings();
  assert.equal($('#set-brp-initiative-row').hidden, false);
  assert.equal($('#set-brp-initiative').value, 'dex');
  const mon = (name, DEX, INT) => ({ name, source: 'brp', system: 'brp', hp: 10, characteristics: { DEX, INT }, attacks: [], abilities: [] });
  T.addMonsterEntry(mon('Sorcerer', 10, 18));
  T.addMonsterEntry(mon('Wolf', 13, 4));
  T.addMonsterEntry(mon('Rat Swarm', 12));                 // no INT
  const rows = () => $$('#tracker-list .cbt-row .cbt-name').map(n => n.textContent);
  assert.deepEqual(rows(), ['Wolf', 'Rat Swarm', 'Sorcerer']);
  $('#set-brp-initiative').value = 'int';
  fire($('#set-brp-initiative'), 'change');
  assert.equal(T.state.settings.brpInitiative, 'int');
  assert.deepEqual(rows(), ['Sorcerer', 'Wolf', 'Rat Swarm'], 'highest INT first; no INT goes last');
  assert.equal($('#cb-sort-rank').textContent, 'Sort by INT');
  const row = $$('#tracker-list .cbt-row')[0];
  assert.equal(row.querySelector('.cbt-rank').dataset.key, 'INT');
  assert.match(row.textContent, /DEX 10/);
  setValue(row.querySelector('.cbt-rank'), '2');
  assert.equal(T.state.combat.entries.find(e => e.name === 'Sorcerer').intRank, 2);
  T.addMonsterEntry(mon('Elf', 14, 17));                  // goes in at its INT rank
  assert.deepEqual(rows(), ['Elf', 'Sorcerer', 'Wolf', 'Rat Swarm'], 'a new entry is placed before the sort; the edited Sorcerer stays until Sort');
  click($('#cb-sort-rank'));
  assert.deepEqual(rows(), ['Elf', 'Wolf', 'Sorcerer', 'Rat Swarm']);

  T.state.settings.system = 'osr';
  T.renderSettings();
  assert.equal($('#set-brp-initiative-row').hidden, true);
});

test('Combat: a BRP monster’s "+dm" attack text rolls as a single formula including its actual Damage Bonus (example: the Knight’s Long Sword)', () => {
  T.addMonsterEntry({
    name: 'Knight', source: 'brp', system: 'brp', desc: '', raw: '',
    ac: { asc: null, desc: null, thac0: null }, hd: '', hdNum: 0, hp: 15, move: '10', align: '', xp: null, moraleML: null,
    atkBonus: null, attacksText: 'Long Sword 75%, 1D8+dm', attacks: [],
    stats: null, saveTargets: null, savesText: '', abilities: [],
    characteristics: { STR: 15, CON: 15, SIZ: 15, INT: 11, POW: 12, DEX: 15, CHA: 14 },
    armor: 10, armorNote: 'plate and heavy helm', damageBonus: '+1D4', skillsText: ''
  });
  tab('combat');
  click($('#tracker-list .cbt-row .cbt-name'));
  const detail = $('#combatant-detail');
  assert.match(detail.textContent, /1D8\+1d4/i, 'the "+dm" placeholder is resolved to the Knight’s actual +1D4 damage bonus');
  const dmgRoll = $$('#combatant-detail .roll').find(el => /^1d8\+1d4$/i.test(el.dataset.formula));
  assert.ok(dmgRoll, 'the combined "1d8+1d4" is one clickable roll, not split into two');
  rig(0.999999); // both dice roll their max face (fraction just under 1, scales to max regardless of sides)
  click(dmgRoll);
  const last = T.state.log[T.state.log.length - 1];
  assert.equal(last.source, 'Knight');
  assert.equal(last.total, 12, '1d8 (max 8) + 1d4 (max 4) = 12');
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

test('Bestiary tab: only shows the active system\'s monsters (bug: OSR monsters showed in UA mode and vice versa)', () => {
  T.state.monsters = [
    { id: 'm1', name: 'Goblin', hd: '1', hdNum: 1, hp: 4, ac: { asc: 12 }, attacks: [], abilities: [], system: 'osr' },
    { id: 'm2', name: 'Denizen', hd: '1', hdNum: 1, hp: 4, ac: { asc: 12 }, attacks: [], abilities: [], system: 'ua3e' },
  ];
  tab('bestiary');
  T.renderAll();
  assert.deepEqual($$('#mb-list .comp-name').map(n => n.textContent), ['Goblin']);
  assert.match($('#mb-count').textContent, /1 \/ 1/);

  T.state.settings.system = 'ua3e';
  T.renderAll();
  assert.deepEqual($$('#mb-list .comp-name').map(n => n.textContent), ['Denizen']);

  // still neither deleted
  assert.equal(T.state.monsters.length, 2);
});

test('Bestiary: the random monster generator (Shadowdark-only rules) is hidden while System is Unknown Armies', () => {
  tab('bestiary');
  T.renderAll();
  assert.equal($('#mb-gen').hidden, false);

  tab('settings');
  setValue($('#set-system'), 'ua3e');
  assert.equal($('#mb-gen').hidden, true);

  setValue($('#set-system'), 'osr');
  assert.equal($('#mb-gen').hidden, false);
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
  assert.equal($('#mb-gen-pop').hidden, true, 'the panel starts closed');
  click($('#mb-gen-open'));
  assert.equal($('#mb-gen-pop').hidden, false, 'the button next to the HD filter opens it');
  assert.equal($('#mb-gen-open').getAttribute('aria-expanded'), 'true');
  fire($('#mb-list'), 'mousedown');
  assert.equal($('#mb-gen-pop').hidden, true, 'a mousedown outside closes it');
  click($('#mb-gen-open'));
  setValue($('#mb-gen-pl'), '2');
  setValue($('#mb-gen-mutations'), '1');
  click($('#mb-generate'));
  assert.equal($('#mb-gen-pop').hidden, true, 'Generate closes the panel');
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

test('Bestiary: "Fill in fields" with Format = BRP builds a monster with characteristics, armor, and free-text attacks/skills', () => {
  T.state.monsters = [];
  T.state.settings.system = 'brp';
  tab('bestiary');
  T.renderAll();
  click($('#mb-new'));
  assert.equal($('#mm-mode .mm-mode-fields').hidden, false, 'BRP has no paste parser — opens straight into fields');
  const host = $('#mm-fields-host');
  assert.equal(host.querySelector('.mf-f-schema').value, 'brp', 'Format preselected for the active system');
  assert.equal(host.querySelector('.mf-nonbrp').hidden, true, 'HD/LV and friends are hidden for BRP');
  setValue(host.querySelector('.mf-f-name'), 'Field Ooze');
  setValue(host.querySelector('.mf-f-hp'), '18');
  setValue(host.querySelector('.mf-f-move'), '6');
  setValue(host.querySelector('.mf-f-brp-STR'), '20');
  setValue(host.querySelector('.mf-f-brp-CON'), '15');
  setValue(host.querySelector('.mf-f-brp-armor'), '2');
  setValue(host.querySelector('.mf-f-brp-armor-note'), 'gelatinous hide');
  setValue(host.querySelector('.mf-f-brp-db'), '+1D4');
  setValue(host.querySelector('.mf-f-brp-attacks'), 'Engulf 50%, 1D6+dm');
  setValue(host.querySelector('.mf-f-brp-skills'), 'Hide 25%, Sense 25%');
  click($('#mm-fields-lib'));
  const added = T.state.monsters.find(m => m.name === 'Field Ooze');
  assert.ok(added, 'the monster was added to the library');
  assert.equal(added.source, 'brp');
  assert.equal(added.system, 'brp');
  assert.equal(added.hp, 18);
  assert.equal(added.move, '6');
  assert.equal(added.characteristics.STR, 20);
  assert.equal(added.characteristics.CON, 15);
  assert.equal(added.armor, 2);
  assert.equal(added.armorNote, 'gelatinous hide');
  assert.equal(added.damageBonus, '+1D4');
  assert.equal(added.attacksText, 'Engulf 50%, 1D6+dm');
  assert.equal(added.skillsText, 'Hide 25%, Sense 25%');
  assert.equal(added.hd, '', 'HD is not a BRP concept');
});

test('Bestiary: editing a BRP monster opens straight into "Fill in fields" (no paste parser) and round-trips its stats', () => {
  T.state.settings.system = 'brp';
  T.state.monsters = [{
    id: 'b1', name: 'Cave Troll', source: 'brp', system: 'brp', desc: 'Big and mean.', raw: '',
    ac: { asc: null, desc: null, thac0: null }, hd: '', hdNum: 0, hp: 20, move: '6', align: '', xp: null, moraleML: null,
    atkBonus: null, attacksText: 'Club 45%, 1D10+2+dm', attacks: [], stats: null, saveTargets: null, savesText: '',
    abilities: [{ name: 'Powers', text: 'Regenerates 1D3 HP/round.' }],
    characteristics: { STR: 23, CON: 13, SIZ: 26, INT: 7, POW: 7, DEX: 10, CHA: 4 },
    armor: 3, armorNote: 'skin', damageBonus: '+2D6', skillsText: 'Dodge 35%'
  }];
  tab('bestiary');
  T.renderAll();
  click($('.mb-row[data-id="b1"] .mb-edit'));
  assert.equal($('#monster-edit-modal').hidden, false);
  assert.equal($('#me-mode .mm-mode-fields').hidden, false, 'defaults to fields, not the empty paste textarea');
  const host = $('#me-fields-host');
  assert.equal(host.querySelector('.mf-f-brp-STR').value, '23');
  assert.equal(host.querySelector('.mf-f-brp-db').value, '+2D6');
  setValue(host.querySelector('.mf-f-brp-armor'), '5');
  click($('#me-save'));
  const updated = T.state.monsters.find(m => m.id === 'b1');
  assert.equal(updated.armor, 5);
  assert.equal(updated.characteristics.STR, 23, 'other characteristics survive the round-trip');
  assert.equal(updated.system, 'brp', 'editing never reclassifies a monster\'s system');
});

test('Bestiary: "Fill in fields" with Format = Silent Legions builds an OSR-shaped monster with Skill, Madness, Slaughter die, and one save', () => {
  T.state.monsters = [];
  T.state.settings.system = 'sl';
  tab('bestiary');
  T.renderAll();
  click($('#mb-new'));
  assert.equal($('#mm-mode .mm-mode-fields').hidden, false, 'Silent Legions has no paste parser — opens straight into fields');
  const host = $('#mm-fields-host');
  assert.equal(host.querySelector('.mf-f-schema').value, 'sl', 'Format preselected for the active system');
  assert.equal(host.querySelector('.mf-f-hd').closest('.mf-nonbrp').hidden, false, 'SL keeps Hit Dice');
  assert.equal(host.querySelector('.mf-f-align').closest('.mf-nonsl').hidden, true, 'but has no Alignment');
  setValue(host.querySelector('.mf-f-name'), 'Pit Thing');
  setValue(host.querySelector('.mf-f-hd'), '4');
  setValue(host.querySelector('.mf-f-hp'), '18');
  setValue(host.querySelector('.mf-f-move'), "30'");
  setValue(host.querySelector('.mf-f-sl-ac'), '5');
  setValue(host.querySelector('.mf-f-sl-ml'), '9');
  setValue(host.querySelector('.mf-f-sl-skill'), '2');
  setValue(host.querySelector('.mf-f-sl-madness'), '1d8');
  setValue(host.querySelector('.mf-f-sl-slaughter'), '1d10');
  host.querySelector('.mf-f-sl-immune').checked = true;
  const atk = host.querySelector('.mf-atk-row');
  setValue(atk.querySelector('.mf-atk-label'), 'claw');
  setValue(atk.querySelector('.mf-atk-count'), '2');
  setValue(atk.querySelector('.mf-atk-tohit'), '4');
  setValue(atk.querySelector('.mf-atk-damage'), '1d6');
  click($('#mm-fields-lib'));
  const added = T.state.monsters.find(m => m.name === 'Pit Thing');
  assert.ok(added, 'the monster was added to the library');
  assert.equal(added.source, 'sl');
  assert.equal(added.system, 'sl');
  assert.deepEqual(added.ac, { asc: null, desc: 5, thac0: null });
  assert.equal(added.mundaneImmune, true);
  assert.equal(added.hdNum, 4);
  assert.equal(added.moraleML, 9);
  assert.equal(added.skill, 2);
  assert.equal(added.madness, '1d8');
  assert.equal(added.slaughterDie, '1d10');
  assert.deepEqual(added.saveTargets, { Save: 13 }, 'a blank Save uses the book formula, 15 − ½HD rounded up');
  assert.equal(added.attacksText, '2 claw +4 (1d6)');
  assert.equal(added.align, '');
  assert.match($('#mb-list').textContent, /AC 5\*/, 'the Bestiary row shows the descending AC and its mark');
});

test('Bestiary: editing a Silent Legions monster opens straight into "Fill in fields" and round-trips its SL fields', () => {
  T.state.settings.system = 'sl';
  T.state.monsters = [JSON.parse(JSON.stringify(slPack().monsters.find(d => d.name === 'Ghoul')))];
  T.state.monsters[0].system = 'sl';
  const id = T.state.monsters[0].id;
  tab('bestiary');
  T.renderAll();
  click($('.mb-row[data-id="' + id + '"] .mb-edit'));
  assert.equal($('#me-mode .mm-mode-fields').hidden, false);
  const host = $('#me-fields-host');
  assert.equal(host.querySelector('.mf-f-schema').value, 'sl');
  assert.equal(host.querySelector('.mf-f-sl-ac').value, '7');
  assert.equal(host.querySelector('.mf-f-sl-madness').value, 'None / 1d6');
  assert.equal(host.querySelector('.mf-f-sl-save').value, '14');
  setValue(host.querySelector('.mf-f-sl-ml'), '10');
  click($('#me-save'));
  const updated = T.state.monsters.find(m => m.id === id);
  assert.equal(updated.moraleML, 10);
  assert.equal(updated.madness, 'None / 1d6', 'other SL fields survive the round-trip');
  assert.deepEqual(updated.saveTargets, { Save: 14 });
  assert.equal(updated.attacksText, '2 claw +3 (1d4)');
  assert.equal(updated.system, 'sl', 'editing never reclassifies a monster\'s system');
});

test('Combat: a Silent Legions monster shows its descending AC, Madness chip, and Skill / Slaughter / Madness rolls', () => {
  T.addMonsterEntry(JSON.parse(JSON.stringify(slPack().monsters.find(d => d.name === 'Vampire'))));
  tab('combat');
  const row = $('#tracker-list .cbt-row');
  assert.match(row.textContent, /AC 6\*/);
  assert.match(row.textContent, /Mad None \/ 1d4/);
  assert.ok(row.querySelector('.cbt-hd'), 'SL monsters keep the HD stepper');

  click(row.querySelector('.cbt-name'));
  const detail = $('#combatant-detail');
  assert.match(detail.textContent, /Save 12/);
  assert.equal(detail.querySelector('.cbt-skill').textContent, '2d6+3');
  rig(face(6, 6));
  click(detail.querySelector('.cbt-slaughter'));
  assert.match(logText(), /Slaughter 1d6/);
  assert.match(logText(), /triple the damage/);
  click(detail.querySelector('.cbt-madness'));
  assert.match(logText(), /Madness 1d4/);
  rig(face(10, 20));
  click(detail.querySelector('.cbt-atk'));
  assert.match(logText(), /hits AC 2 or higher/, '1d20 (10) + 8 = 18 → needs AC ≥ 2');
});

/* ================================================================== */
/* Unknown Armies: Bestiary GMCs and Combat                           */
/* ================================================================== */

// An invented GMC (the repo holds no book text), in the statblock format of
// js/ua-statblock.js's parseUAMonster.
const UA_CLERK = 'Night Clerk\nSees everything, says nothing\nType: GMC\nWound Threshold: 50\n' +
  'Obsession: Knowing who checks in.\n\nIdentities\nNight Clerk 55%* — Substitutes for Notice, Provides Initiative\n' +
  'Lucky Guess 3d10+20% — Specific Information\n\nPassions\nFear (Isolation): Being forgotten.\nRage: Rude guests.\n\n' +
  'Shock\nHelplessness: 1 hardened / 0 failed\nIsolation: 3 hardened / 1 failed\nSelf: 2 hardened / 0 failed\n' +
  'Unnatural: 1 hardened / 0 failed\nViolence: 2 hardened / 1 failed';
function uaSystem() { tab('settings'); setValue($('#set-system'), 'ua3e'); }

test('Bestiary (Unknown Armies): pasting a GMC statblock adds a ua3e monster; no fields form, no HD filter; Edit keeps its book text', () => {
  uaSystem();
  tab('bestiary');
  assert.ok($$('#tab-bestiary .mb-hd-field').every(el => el.hidden), 'no Hit Dice to filter by');
  click($('#mb-new'));
  assert.equal($('#monster-modal').hidden, false);
  assert.equal($('#mm-mode .mm-mode-btn[data-mode="fields"]').hidden, true, 'GMCs are pasted, not filled in');
  assert.match($('#mm-paste-hint').textContent, /GMC/);
  assert.ok($$('#monster-modal .mm-hd-field').every(el => el.hidden));
  setValue($('#mm-paste-area'), UA_CLERK + '\n---\nNight Cook\nType: GMC\n\nIdentities\nCook 40% — Substitutes for Status');
  click($('#mm-parse-lib'));
  assert.deepEqual(T.state.monsters.map(m => [m.name, m.source, m.system]), [['Night Clerk', 'ua3e', 'ua3e'], ['Night Cook', 'ua3e', 'ua3e']]);
  click($('#mm-close'));
  const row = $$('#mb-list .mb-row').find(r => /Night Clerk/.test(r.textContent));
  assert.match(row.textContent, /GMC · WT 50 · 2 identities/);

  const clerk = T.state.monsters.find(m => m.name === 'Night Clerk');
  clerk.notes = 'Book text.'; clerk.ref = 'character:t:clerk';
  click(row.querySelector('.mb-edit'));
  assert.equal($('#me-mode .mm-mode-btn[data-mode="fields"]').hidden, true);
  assert.equal($('#me-area').value, UA_CLERK);
  setValue($('#me-area'), UA_CLERK.replace('Wound Threshold: 50', 'Wound Threshold: 60'));
  click($('#me-save'));
  const saved = T.state.monsters.find(m => m.name === 'Night Clerk');
  assert.match(saved.raw, /Wound Threshold: 60/);
  assert.equal(saved.notes, 'Book text.', 'the book text is not in the statblock, so Edit keeps it');
  assert.equal(saved.ref, 'character:t:clerk');
  assert.equal(saved.system, 'ua3e');
});

test('Combat (Unknown Armies): a GMC counts wounds up to its threshold, shows Init and its sheet; a d100 attack offers wounds by weapon', () => {
  uaSystem();
  const def = Object.assign(T.uaMonsterDef ? T.uaMonsterDef(UA_CLERK) : window.UAStatblock.uaMonsterDef(UA_CLERK),
    { system: 'ua3e', notes: 'Knows about the [Night Shift].' });
  T.addMonsterEntry(def);
  tab('combat');
  assert.equal($('#cb-populate-hd').hidden, true, 'no Hit Dice to spend');
  assert.equal($('#cb-ua-hint').hidden, false);
  let row = $('#tracker-list .cbt-row');
  assert.equal(row.querySelector('.cbt-hd'), null);
  assert.equal(row.querySelector('.cbt-hp'), null);
  assert.doesNotMatch(row.textContent, /\bAC\b/);
  assert.equal(row.querySelector('.cbt-wounds').value, '0');
  assert.equal(row.querySelector('.cbt-wt').value, '50');
  assert.match(row.textContent, /Init 55%/);

  click(row.querySelector('.cbt-wd-inc'));
  const ent = () => T.state.combat.entries[0];
  assert.equal(ent().wounds, 1);
  setValue($('#tracker-list .cbt-wounds'), '38');
  row = $('#tracker-list .cbt-row');
  assert.match(row.textContent, /Badly hurt/);
  assert.ok(!row.classList.contains('is-down'));
  setValue($('#tracker-list .cbt-wounds'), '45');
  row = $('#tracker-list .cbt-row');
  assert.match(row.textContent, /Unconscious/);
  assert.ok(row.classList.contains('is-down'), '90% of the threshold: out of the fight');
  setValue($('#tracker-list .cbt-wounds'), '80');
  assert.equal(ent().wounds, 50, 'clamped to the threshold');
  setValue($('#tracker-list .cbt-wounds'), '0');

  click($('#tracker-list .cbt-name'));
  const detail = $('#combatant-detail');
  assert.match(detail.textContent, /hurt at 25 · badly hurt at 38 · unconscious at 45 · dead at 50/);
  assert.match(detail.textContent, /Lucky Guess 3d10\+20%/);
  assert.match(detail.textContent, /Notice 55%/, 'Night Clerk substitutes for Notice');
  assert.match(detail.textContent, /Struggle 25%/, 'Violence 2 hardened → Struggle 15 + 10');
  assert.match(detail.textContent, /Obsession: Knowing who checks in\./);
  assert.ok(detail.querySelector('.comp-ref'), 'the book text\'s [links] open Compendium entries');
  assert.ok($$('#combatant-detail .roll').some(r => r.dataset.formula === '3d10+20'), 'a dice rating is a roll');

  // A percentile attack: 34, a success → choose the weapon to apply the wounds.
  rig(face(34, 100));
  click($$('#combatant-detail .roll').find(r => r.dataset.formula === '%55'));
  const box = $('#dice-apply-ua');
  assert.equal(box.hidden, false);
  assert.match(box.textContent, /rolled 34 \(Success\)/);
  assert.deepEqual($$('#dice-apply-ua .dau-btn').map(b => Number(b.dataset.wounds)), [7, 10, 13, 16, 34]);
  click($$('#dice-apply-ua .dau-btn')[1]);   // weapon +3: 3 + 4 + 3
  assert.equal(ent().wounds, 10);
  assert.match(logText(), /10 wounds → 0→10 \/ 50/);

  // A plain damage roll still uses "Apply damage", as wounds.
  rig(face(6, 10));
  setValue($('#custom-formula'), '1d10');
  submit($('#dice-custom'));
  assert.equal($('#dice-apply-ua').hidden, true, 'only after a percentile roll');
  assert.match($('#dice-apply').textContent, /Apply 6 wounds to Night Clerk/);
  click($('#dice-apply'));
  assert.equal(ent().wounds, 16);
});

test('Combat (Unknown Armies): a UA character uses its "Wounds (Name)" tracker, up to the sheet\'s Wound Threshold', () => {
  uaSystem();
  T.createCharacter('# Dana [Unknown Armies]\n\n```ua\nIdentities\nBouncer 50% — Substitutes for Struggle, Provides Initiative\n\nWound Threshold: 40\n\nShock\nViolence: 3 hardened / 0 failed\n```\n');
  tab('combat');
  setValue($('#cb-add-char'), T.state.characters[0].id);
  const row = $('#tracker-list .cbt-row');
  assert.ok(row.querySelector('.cbt-wounds'));
  assert.equal(row.querySelector('.cbt-wt'), null, 'a character\'s threshold comes from its sheet');
  assert.match(row.textContent, /\/40/);
  assert.match(row.textContent, /Init 50%/);
  click(row.querySelector('.cbt-wd-inc'));
  assert.equal(T.state.consumables.find(c => c.name === 'Wounds (Dana)').value, 1);
  assert.equal(T.state.consumables.find(c => c.name === 'Wounds (Dana)').max, 40);
  assert.ok(!T.state.consumables.some(c => c.name === 'HP (Dana)'), 'no HP tracker for a UA character');
});

/* ================================================================== */
/* Combat: "+ Populate by HD…"                                        */
/* ================================================================== */

test('Combat "+ Populate by HD…": generate shows a proposal to confirm, then adds the exact monsters to combat', () => {
  T.state.monsters = [
    { id: 'm-rat', name: 'Rat', source: 'shadowdark', desc: '', raw: '', ac: { asc: 12, desc: null, thac0: null },
      hd: '0', hdNum: 0, hp: 1, move: 'near', align: 'N', xp: null, moraleML: null, atkBonus: 0,
      attacksText: '', attacks: [], stats: null, saveTargets: null, savesText: '', abilities: [], system: 'osr' },
    { id: 'm-goblin', name: 'Goblin', source: 'shadowdark', desc: '', raw: '', ac: { asc: 12, desc: null, thac0: null },
      hd: '1', hdNum: 1, hp: 5, move: 'near', align: 'C', xp: null, moraleML: null, atkBonus: 1,
      attacksText: '', attacks: [], stats: null, saveTargets: null, savesText: '', abilities: [], system: 'osr' },
    { id: 'm-ogre', name: 'Ogre', source: 'shadowdark', desc: '', raw: '', ac: { asc: 12, desc: null, thac0: null },
      hd: '4', hdNum: 4, hp: 20, move: 'near', align: 'C', xp: null, moraleML: null, atkBonus: 4,
      attacksText: '', attacks: [], stats: null, saveTargets: null, savesText: '', abilities: [], system: 'osr' },
  ];
  T.state.combat.entries = [];
  T.renderAll();
  tab('combat');

  click($('#cb-populate-hd'));
  assert.equal($('#populate-hd-modal').hidden, false);
  assert.equal($('#php-setup').hidden, false);
  assert.equal($('#php-confirm').hidden, true);

  setValue($('#php-total-hd'), '5');
  setValue($('#php-count'), '2');
  rig([0]); // deterministic: always the first feasible pick -> Goblin (1 HD) + Ogre (4 HD)
  click($('#php-generate'));

  assert.equal($('#php-setup').hidden, true);
  assert.equal($('#php-confirm').hidden, false, 'switches to the confirmation step instead of adding immediately');
  assert.equal(T.state.combat.entries.length, 0, 'nothing added to combat yet — still waiting on confirmation');
  assert.equal($('#php-total-out').textContent, '5');
  assert.equal($('#php-count-out').textContent, '2');
  const proposed = $$('#php-list .comp-name').map(el => el.textContent);
  assert.deepEqual(proposed, ['Goblin', 'Ogre']);

  click($('#php-confirm-add'));
  assert.equal($('#populate-hd-modal').hidden, true);
  assert.equal(T.state.combat.entries.length, 2);
  const names = T.state.combat.entries.map(e => e.name).sort();
  assert.deepEqual(names, ['Goblin', 'Ogre']);
  assert.ok(T.state.combat.entries.every(e => e.kind === 'monster'));
});

test('Combat "+ Populate by HD…": the Total HD field starts empty — nothing is prefilled', () => {
  tab('combat');
  click($('#cb-populate-hd'));
  assert.equal($('#php-total-hd').value, '');
});

test('Combat "+ Populate by HD…": hovering a proposed monster shows its stat-block preview card', () => {
  T.state.monsters = [
    { id: 'm-goblin', name: 'Goblin', source: 'shadowdark', desc: 'A sneaky raider.', raw: '', ac: { asc: 12, desc: null, thac0: null },
      hd: '1', hdNum: 1, hp: 5, move: 'near', align: 'C', xp: null, moraleML: null, atkBonus: 1,
      attacksText: '1 shortsword +1 (1d6)', attacks: [], stats: null, saveTargets: null, savesText: '', abilities: [], system: 'osr' },
  ];
  T.state.combat.entries = [];
  T.renderAll();
  tab('combat');
  click($('#cb-populate-hd'));
  setValue($('#php-total-hd'), '1');
  setValue($('#php-count'), '1');
  click($('#php-generate'));
  const row = $('#php-list .php-row');
  assert.ok(row, 'a proposal row was rendered');
  fire(row, 'mouseover');
  assert.equal($('#mm-preview').hidden, false);
  assert.match($('#mm-preview').innerHTML, /Goblin/);
});

test('Combat "+ Populate by HD…": the dice icon rerolls just that monster for another of the same HD, budget unchanged', () => {
  T.state.monsters = [
    { id: 'm-goblin', name: 'Goblin', source: 'shadowdark', desc: '', raw: '', ac: { asc: 12, desc: null, thac0: null },
      hd: '1', hdNum: 1, hp: 5, move: 'near', align: 'C', xp: null, moraleML: null, atkBonus: 1,
      attacksText: '', attacks: [], stats: null, saveTargets: null, savesText: '', abilities: [], system: 'osr' },
    { id: 'm-orc', name: 'Orc', source: 'shadowdark', desc: '', raw: '', ac: { asc: 13, desc: null, thac0: null },
      hd: '1', hdNum: 1, hp: 6, move: 'near', align: 'C', xp: null, moraleML: null, atkBonus: 1,
      attacksText: '', attacks: [], stats: null, saveTargets: null, savesText: '', abilities: [], system: 'osr' },
  ];
  T.state.combat.entries = [];
  T.renderAll();
  tab('combat');
  click($('#cb-populate-hd'));
  setValue($('#php-total-hd'), '1');
  setValue($('#php-count'), '1');
  rig([0]); // picks the first candidate at every step -> Goblin
  click($('#php-generate'));
  assert.equal($('#php-list .comp-name').textContent, 'Goblin');

  const btn = $('#php-list .php-row-reroll');
  assert.equal(btn.disabled, false, 'Orc shares the same HD, so a reroll is available');
  click(btn);
  assert.equal($('#php-list .comp-name').textContent, 'Orc', 'the only other same-HD monster');
  assert.equal($('#php-total-out').textContent, '1', 'budget unchanged after a same-HD reroll');
  assert.equal($('#php-count-out').textContent, '1');

  click($('#php-confirm-add'));
  assert.equal(T.state.combat.entries.length, 1);
  assert.equal(T.state.combat.entries[0].name, 'Orc');
});

test('Combat "+ Populate by HD…": the dice icon is disabled when no other monster shares that HD', () => {
  T.state.monsters = [
    { id: 'm-goblin', name: 'Goblin', source: 'shadowdark', desc: '', raw: '', ac: { asc: 12, desc: null, thac0: null },
      hd: '1', hdNum: 1, hp: 5, move: 'near', align: 'C', xp: null, moraleML: null, atkBonus: 1,
      attacksText: '', attacks: [], stats: null, saveTargets: null, savesText: '', abilities: [], system: 'osr' },
  ];
  T.state.combat.entries = [];
  T.renderAll();
  tab('combat');
  click($('#cb-populate-hd'));
  setValue($('#php-total-hd'), '1');
  setValue($('#php-count'), '1');
  click($('#php-generate'));
  assert.equal($('#php-list .php-row-reroll').disabled, true);
});

test('Combat "+ Populate by HD…": an infeasible exact count shows an error and adds nothing', () => {
  T.state.monsters = [
    { id: 'm-goblin', name: 'Goblin', source: 'shadowdark', desc: '', raw: '', ac: { asc: 12, desc: null, thac0: null },
      hd: '1', hdNum: 1, hp: 5, move: 'near', align: 'C', xp: null, moraleML: null, atkBonus: 1,
      attacksText: '', attacks: [], stats: null, saveTargets: null, savesText: '', abilities: [], system: 'osr' },
  ];
  T.state.combat.entries = [];
  T.renderAll();
  tab('combat');
  click($('#cb-populate-hd'));
  setValue($('#php-total-hd'), '1'); // only 1 HD monster available; 1 HD across 3 monsters can't work
  setValue($('#php-count'), '3');
  click($('#php-generate'));
  assert.equal($('#php-confirm').hidden, true, 'stays on the setup step');
  assert.match($('#php-setup-msg').textContent, /Can't spend exactly/);
  assert.equal(T.state.combat.entries.length, 0);
});

// A BRP monster as the BRP content pack writes it: the Encounter Level is in hd/hdNum.
function brpMonster(id, name, el) {
  return { id, name, source: 'brp', desc: '', raw: '', characteristics: { STR: 12, CON: 12, SIZ: 12 }, hp: 12,
    move: '10', damageBonus: 'None', armor: 2, armorNote: '', attacksText: 'Club 50%, 1D6+dm', skillsText: '',
    abilities: [], system: 'brp', ...(el != null ? { hd: String(el), hdNum: el, encounterLevel: el } : {}) };
}

test('Populate by EL (BRP): labels read EL, the party calculator fills the total, and only rated monsters are picked', () => {
  T.state.settings.system = 'brp';
  T.state.monsters = [brpMonster('b-orc', 'Orc', 1.5), brpMonster('b-troll', 'Troll', 2),
    brpMonster('b-ghost', 'Ghost', null)];
  T.state.combat.entries = [];
  T.renderAll();
  tab('combat');
  assert.match($('#cb-populate-hd').textContent, /Populate by EL/);
  click($('#cb-populate-hd'));
  assert.equal($('#php-party').hidden, false, 'the party calculator shows for BRP');
  assert.equal($('#php-hint-el').hidden, false);
  assert.equal($('#php-hint-hd').hidden, true);
  assert.equal($('#php-total-hd').value, '', 'nothing is prefilled');
  setValue($('#php-pcs'), '4');
  $('#php-power').value = 'heroic';
  $('#php-difficulty').value = 'hard';
  fire($('#php-difficulty'), 'change');
  assert.equal($('#php-total-hd').value, '7.5', '4 Heroic PCs (1.25) x Hard (1.5)');
  setValue($('#php-total-hd'), '3.5');
  setValue($('#php-count'), '2');
  click($('#php-generate'));
  assert.equal($('#php-confirm').hidden, false);
  assert.deepEqual($$('#php-list .comp-name').map(el => el.textContent).sort(), ['Orc', 'Troll']);
  assert.deepEqual($$('#php-list .badge').map(el => el.textContent).sort(), ['EL 1.5', 'EL 2']);
  click($('#php-confirm-add'));
  assert.match(logText(), /Populate by EL/);

  // The Bestiary filter reads EL too, and a monster without an EL is out of an EL range.
  tab('bestiary');
  assert.equal($$('#tab-bestiary .hd-label')[0].textContent, 'EL');
  setValue($('#mb-hd-min'), '2');
  assert.deepEqual($$('#mb-list .comp-name').map(el => el.textContent), ['Troll']);
  setValue($('#mb-hd-min'), '');
  assert.match($('#mb-list [data-id="b-orc"] .badge').textContent, /^EL 1\.5 · HP 12/);
});

test('Populate by HD: outside BRP the labels read HD and the party calculator is hidden', () => {
  T.state.settings.system = 'osr';
  T.renderAll();
  tab('combat');
  assert.match($('#cb-populate-hd').textContent, /Populate by HD/);
  click($('#cb-populate-hd'));
  assert.equal($('#php-party').hidden, true);
  assert.equal($('#php-hint-hd').hidden, false);
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

test('Compendium: right-clicking a Category (or Source) filter isolates it; a right-click on the only ticked one ticks all again', async () => {
  T.state.compendium = [
    { id: '1', name: 'Longsword', category: 'Items', source: 'Core', body: '', createdAt: 1 },
    { id: '2', name: 'Bless', category: 'Spells', source: 'Core', body: '', createdAt: 2 },
    { id: '3', name: 'Potion', category: 'Items', source: 'Homebrew', body: '', createdAt: 3 },
  ];
  tab('compendium');
  T.renderAll();
  assert.equal($$('#comp-list .comp-row').length, 3);

  // The isolate handler applies on a deferred setTimeout(…, 0) — see
  // js/compendium.js's wireCompendiumEntries() — so every assertion below
  // needs to let that macrotask run first.
  const tick = () => new Promise(r => setTimeout(r, 10));
  const rightClick = async (el) => { el.dispatchEvent(new window.Event('contextmenu', { bubbles: true, cancelable: true })); await tick(); };
  const checkedCats = () => $$('#comp-cats input[data-cat]').filter(cb => cb.checked).map(cb => cb.dataset.cat);
  const checkedSrcs = () => $$('#comp-sources input[data-src]').filter(cb => cb.checked).map(cb => cb.dataset.src);
  const names = () => $$('#comp-list .comp-row .comp-name').map(n => n.textContent);

  await rightClick($$('#comp-cats .comp-cat').find(l => l.textContent.trim() === 'Spells'));
  assert.deepEqual(checkedCats(), ['Spells'], 'only the right-clicked category stays ticked');
  assert.deepEqual(names(), ['Bless']);

  await rightClick($$('#comp-cats .comp-cat').find(l => l.textContent.trim() === 'Items'));
  assert.deepEqual(checkedCats(), ['Items'], 'right-clicking another category re-isolates to just that one');

  await rightClick($$('#comp-sources .comp-cat').find(l => l.textContent.trim() === 'Homebrew'));
  assert.deepEqual(checkedSrcs(), ['Homebrew'], 'only the right-clicked source stays ticked');
  assert.deepEqual(names(), ['Potion'], 'list narrows to Items + Homebrew');

  await rightClick($$('#comp-cats .comp-cat').find(l => l.textContent.trim() === 'Items'));
  assert.deepEqual(checkedCats(), window.OSR.COMPENDIUM_CATEGORIES.slice(), 'a right-click on the only ticked category ticks every category');
  await rightClick($$('#comp-sources .comp-cat').find(l => l.textContent.trim() === 'Homebrew'));
  assert.equal(checkedSrcs().length, $$('#comp-sources input[data-src]').length, 'a right-click on the only ticked source ticks every source');
  assert.equal(names().length, 3);
});

test('Compendium/Tables filter checkboxes: a spurious "change" fired alongside a right-click gesture never beats the (deferred) isolate handler', async () => {
  T.state.compendium = [
    { id: '1', name: 'Longsword', category: 'Items', source: 'Core', body: '', createdAt: 1 },
    { id: '2', name: 'Bless', category: 'Spells', source: 'Core', body: '', createdAt: 2 },
  ];
  tab('compendium');
  T.renderAll();
  const tick = () => new Promise(r => setTimeout(r, 10));
  const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true, cancelable: true }));
  const contextmenu = el => el.dispatchEvent(new window.Event('contextmenu', { bubbles: true, cancelable: true }));
  const checkedCats = () => $$('#comp-cats input[data-cat]').filter(cb => cb.checked).map(cb => cb.dataset.cat);

  // Isolate down to a single checked category first (matches the reported bug's starting state).
  const items = () => $$('#comp-cats input[data-cat]').find(cb => cb.dataset.cat === 'Items');
  contextmenu(items());
  await tick();
  assert.deepEqual(checkedCats(), ['Items']);

  // Simulate a trackpad's two-finger-tap right-click: some input methods
  // report this to the browser as an ordinary primary-button (button 0)
  // click that also fires 'contextmenu' — not a real button-2 press — so it
  // natively toggles the checkbox and fires 'change' too (here landing
  // *before* 'contextmenu', the harder ordering). The deferred isolate must
  // still win as the final word. (A real 'contextmenu' event's target is
  // whatever's actually at that screen position when it's dispatched — so,
  // like a real browser, re-query the checkbox after the phantom change's
  // own re-render, rather than reusing a now-stale element reference.)
  const spells = () => $$('#comp-cats input[data-cat]').find(cb => cb.dataset.cat === 'Spells');
  spells().checked = false; // the phantom native toggle (button 0, indistinguishable from a real click)
  change(spells());
  contextmenu(spells());
  await tick();
  assert.deepEqual(checkedCats(), ['Spells'], 'isolated — the isolate handler is the last word regardless of the spurious change');

  // The same gesture on the only ticked category: the phantom toggle unticks
  // it first, but the right-click still ticks every category again.
  spells().checked = false;
  change(spells());
  contextmenu(spells());
  await tick();
  assert.deepEqual(checkedCats(), window.OSR.COMPENDIUM_CATEGORIES.slice(), 'every category is ticked again');
  contextmenu(items());
  await tick();
  assert.deepEqual(checkedCats(), ['Items']);

  // A genuine left-click change (no accompanying contextmenu) still works normally afterward.
  spells().checked = true;
  change(spells());
  assert.deepEqual(checkedCats().sort(), ['Items', 'Spells'], 'a normal left-click toggle still applies');
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
/* Tables tab                                                         */
/* ================================================================== */

test('Tables tab: lists every seeded table, with Source, Setting, and Output filters and a name search', () => {
  tab('tables');
  const total = window.OSR.data.tables.length;
  assert.ok(total >= 20, 'expected the bundled table library to be loaded');
  assert.equal($$('#tbl-list .tbl-row').length, total);
  assert.match($('#tbl-count').textContent, new RegExp(total + ' / ' + total));

  const values = f => $$('#tbl-filters input[data-filter="' + f + '"]').map(cb => cb.dataset.value);
  assert.deepEqual(values('origin'), ['Shadowdark']);
  assert.deepEqual(values('settings'), ['Fantasy', 'Modern', 'Horror']);
  assert.equal($('#tbl-hide-subs').checked, true, '"Don\'t show included subtables" starts on');
  assert.deepEqual(values('output'), ['Encounter', 'Entity', 'Location', 'Adventure', 'Group', 'Other']);
  assert.ok($$('#tbl-filters input').every(cb => cb.checked), 'every value starts enabled');
  const arctic = $('#tbl-list .tbl-row[data-id="arctic"] summary').textContent;
  assert.match(arctic, /Encounter/);
  assert.match(arctic, /Fantasy/);
  assert.match(arctic, /Shadowdark/);

  setValue($('#tbl-search'), 'arctic');
  assert.deepEqual($$('#tbl-list .tbl-name').map(n => n.textContent), ['Arctic']);
  setValue($('#tbl-search'), '');
  assert.equal($$('#tbl-list .tbl-row').length, total);
});

test('Tables tab: unticking a filter value hides its tables; right-clicking a value isolates it in its row', async () => {
  tab('tables');
  makeTable('Ghost', 'd1\n1: boo\n', { origin: 'My Notes', settings: ['Horror'], output: 'Entity' });
  makeTable('Mall', 'd1\n1: shops\n', { settings: ['Modern'], output: 'Location' });
  makeTable('Arcade', 'd1\n1: neon\n', { settings: ['Modern', 'Horror'], output: 'Location' });
  const total = window.OSR.data.tables.length + 3;
  const box = (f, v) => $('#tbl-filters input[data-filter="' + f + '"][data-value="' + v + '"]');
  const toggle = (f, v) => { const cb = box(f, v); cb.checked = !cb.checked; cb.dispatchEvent(new window.Event('change', { bubbles: true })); };
  assert.deepEqual($$('#tbl-filters input[data-filter="origin"]').map(cb => cb.dataset.value), ['Homebrew', 'My Notes', 'Shadowdark']);

  toggle('origin', 'Shadowdark');
  assert.deepEqual($$('#tbl-list .tbl-name').map(n => n.textContent), ['Arcade', 'Ghost', 'Mall']);
  toggle('output', 'Entity');
  assert.deepEqual($$('#tbl-list .tbl-name').map(n => n.textContent), ['Arcade', 'Mall']);
  toggle('settings', 'Modern');
  assert.deepEqual($$('#tbl-list .tbl-name').map(n => n.textContent), ['Arcade'], 'a table shows while one of its settings is ticked');
  toggle('settings', 'Modern');
  toggle('origin', 'Shadowdark');
  toggle('output', 'Entity');
  assert.equal($$('#tbl-list .tbl-row').length, total);

  // The isolate handler applies on a deferred setTimeout(…, 0) — see
  // js/tables.js's wireTables().
  box('settings', 'Horror').closest('label').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual($$('#tbl-list .tbl-name').map(n => n.textContent), ['Arcade', 'Ghost']);
  assert.deepEqual($$('#tbl-filters input[data-filter="settings"]').filter(cb => cb.checked).map(cb => cb.dataset.value), ['Horror']);
  assert.ok($$('#tbl-filters input[data-filter="output"]').every(cb => cb.checked), 'the other rows do not change');

  // A second right-click on the only ticked value ticks every value in its row again.
  box('settings', 'Horror').closest('label').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 10));
  assert.ok($$('#tbl-filters input[data-filter="settings"]').every(cb => cb.checked), 'every setting is ticked again');
  assert.equal($$('#tbl-list .tbl-row').length, total);
});

test('Tables tab: expanding a table and clicking Roll rolls its formula, highlights the matching row, and logs it', () => {
  tab('tables');
  const row = $('#tbl-list .tbl-row[data-id="arctic"]');
  assert.ok(row, 'expected the Arctic table to be listed');
  click(row.querySelector('summary'));            // native <details> toggle
  assert.equal(row.querySelector('details').open, true);

  const lastBox = $('#dice-last').innerHTML;
  rig(face(42, 100));
  click(row.querySelector('.tbl-roll'));
  assert.equal(logCount(), 1);
  assert.equal($('#dice-last').innerHTML, lastBox, 'a table roll does not show in the Dice Roller box');
  const last = T.state.log[T.state.log.length - 1];
  assert.equal(last.source, 'Arctic');
  assert.equal(last.total, 42);
  assert.equal(last.detail, 'A starving human is trapped in an icy, natural pit');

  const hitRow = $('#tbl-list .tbl-row[data-id="arctic"]');
  const hit = hitRow.querySelector('.tbl-entry.is-hit');
  assert.ok(hit, 'the rolled row is highlighted');
  assert.equal(hit.querySelector('.tbl-range').textContent, '42-43');
  assert.equal(hitRow.querySelector('details').open, true, 'stays expanded across the re-render');

  // Copy puts only the result text (not "Rolled 42") on the clipboard.
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async t => { copied.push(t); } } });
  click(hitRow.querySelector('.tbl-copy'));
  assert.deepEqual(copied, ['A starving human is trapped in an icy, natural pit']);
});

// Fills the table editor (#tbl-modal) and clicks Save. meta: { origin, settings, output }.
function makeTable(name, source, meta) {
  const m = meta || {};
  click($('#tbl-new'));
  setValue($('#tbl-f-name'), name);
  if (m.origin) setValue($('#tbl-f-origin'), m.origin);
  if (m.settings) $$('#tbl-f-settings input').forEach(cb => { cb.checked = m.settings.indexOf(cb.dataset.setting) !== -1; });
  if (m.output) setValue($('#tbl-f-output'), m.output);
  setValue($('#tbl-f-src'), source);
  click($('#tbl-f-save'));
}
const editorSettings = () => $$('#tbl-f-settings input').filter(cb => cb.checked).map(cb => cb.dataset.setting);
const tblRow = name => $$('#tbl-list .tbl-row').find(li => li.querySelector('.tbl-name').textContent === name);

test('Tables tab: New table saves a user table (in the table library) that rolls on sub-tables', async () => {
  tab('tables');
  click($('#tbl-new'));
  assert.equal($('#tbl-f-origin').value, 'Homebrew', 'a new table starts as Homebrew');
  assert.deepEqual(editorSettings(), ['Fantasy'], 'the OSR System gives Fantasy');
  assert.equal($('#tbl-f-output').value, 'Other');
  assert.deepEqual(Array.from($('#tbl-f-output').options).map(o => o.value), ['Encounter', 'Entity', 'Location', 'Adventure', 'Group', 'Other']);
  click($('#tbl-f-cancel'));
  makeTable('Color', 'd2\n1: red\n2: blue\n');
  makeTable('Thing', 'd2 | Shape | Size\n1: cube | small\n2: orb | large\n', { origin: 'Old Zine', output: 'Entity' });
  makeTable('Omen', 'd2\n1: A [Color] [Thing.Shape]\n2: [2x Color] lights\n', { settings: ['Modern', 'Horror'] });
  assert.equal($('#tbl-modal').hidden, true, 'Save closes the editor');
  assert.equal('tables' in T.state, false, 'the campaign keeps no tables');
  const saved = (await savedTables(T)).tables;
  assert.deepEqual(saved.map(t => [t.name, t.origin, t.settings, t.output]), [
    ['Color', 'Homebrew', ['Fantasy'], 'Other'], ['Thing', 'Old Zine', ['Fantasy'], 'Entity'], ['Omen', 'Homebrew', ['Modern', 'Horror'], 'Other']]);

  // Edit opens with the saved values.
  click(tblRow('Thing').querySelector('.tbl-edit'));
  assert.equal($('#tbl-f-origin').value, 'Old Zine');
  assert.equal($('#tbl-f-output').value, 'Entity');
  setValue($('#tbl-f-output'), 'Group');
  $$('#tbl-f-settings input').forEach(cb => { cb.checked = false; });
  click($('#tbl-f-save'));
  assert.match($('#tbl-msg').textContent, /at least one setting/);
  $('#tbl-f-settings input[data-setting="Modern"]').checked = true;
  click($('#tbl-f-save'));
  assert.deepEqual(T.tableLib.tables.find(t => t.name === 'Thing').settings, ['Modern']);
  assert.equal(T.tableLib.tables.find(t => t.name === 'Thing').output, 'Group');

  const omen = tblRow('Omen');
  assert.ok(omen.classList.contains('is-user'));
  assert.equal(omen.querySelector('details').open, true, 'a saved table opens');
  assert.match(omen.querySelector('.tbl-subs').textContent, /2/, 'rolls on 2 tables');
  assert.equal(omen.querySelectorAll('.tbl-ref[data-ref-id]').length, 3);

  rig([face(1, 2), face(2, 2), face(1, 2)]);
  click(omen.querySelector('.tbl-roll'));
  const last = T.state.log[T.state.log.length - 1];
  assert.equal(last.source, 'Omen');
  assert.equal(last.detail, 'A blue cube');
  assert.equal(tblRow('Omen').querySelector('.tbl-result-text').textContent, 'A blue cube');

  // Click the color part: only it rolls again.
  rig(face(1, 2));
  click(tblRow('Omen').querySelector('.tbl-sub[data-path="1"]'));
  assert.equal(tblRow('Omen').querySelector('.tbl-result-text').textContent, 'A red cube');
  assert.equal(T.state.log[T.state.log.length - 1].source, 'Omen (again: Color)');

  // A table with columns shows a header row.
  assert.deepEqual(Array.from(tblRow('Thing').querySelectorAll('.tbl-entries th')).map(th => th.textContent), ['', 'Shape', 'Size']);
});

test('Tables tab: the editor highlights refs, lists problems, blocks errors, and test-rolls the draft', () => {
  tab('tables');
  makeTable('Color', 'd2\n1: red\n2: blue\n');
  click($('#tbl-new'));
  setValue($('#tbl-f-name'), 'Draft');
  setValue($('#tbl-f-src'), 'd4\n1: [Color] fog\n2: [Missing]\n');
  assert.ok($('#tbl-hl .hl-ref'), 'a known ref is marked');
  assert.ok($('#tbl-hl .hl-bad'), 'an unknown ref is marked');
  const problems = $$('#tbl-problems li').map(li => li.textContent);
  assert.ok(problems.some(p => /no table named "Missing"/.test(p)), problems.join('; '));
  assert.ok(problems.some(p => /No entry for 3–4/.test(p)), problems.join('; '));

  rig([face(1, 4), face(2, 2)]);
  click($('#tbl-f-test'));
  assert.equal($('#tbl-test-out').textContent, '1 blue fog');
  assert.equal(logCount(), 0, 'a test roll is not logged');

  setValue($('#tbl-f-src'), 'six\n1: x\n');
  click($('#tbl-f-save'));
  assert.equal($('#tbl-modal').hidden, false, 'an error blocks Save');
  assert.match($('#tbl-msg').textContent, /Fix the errors/);

  setValue($('#tbl-f-src'), 'd1\n1: x\n');
  setValue($('#tbl-f-name'), 'color');
  click($('#tbl-f-save'));
  assert.match($('#tbl-msg').textContent, /already have a table named "Color"/);
  click($('#tbl-f-cancel'));
  assert.equal(T.tableLib.tables.length, 1);
});

test('Tables tab: "[" in the editor lists tables, then the columns of a table with columns', () => {
  tab('tables');
  makeTable('Thing', 'd2 | Shape | Size\n1: cube | small\n2: orb | large\n');
  click($('#tbl-new'));
  const ta = $('#tbl-f-src');
  ta.focus();
  setValue(ta, 'd2\n1: [2x Thi');
  ta.setSelectionRange(ta.value.length, ta.value.length);
  window.OSR.acFromTableEditor(ta);
  assert.equal($('#comp-ac').hidden, false);
  assert.deepEqual($$('#comp-ac .ac-name').map(n => n.textContent), ['Thing']);
  key(ta, 'Enter');
  assert.equal(ta.value, 'd2\n1: [2x Thing.');
  assert.deepEqual($$('#comp-ac .ac-name').map(n => n.textContent), ['Thing.Shape', 'Thing.Size'], 'the column list opens');
  key(ta, 'ArrowDown');
  key(ta, 'Enter');
  assert.equal(ta.value, 'd2\n1: [2x Thing.Size]');
  click($('#tbl-f-cancel'));
});

test('Tables tab: Duplicate copies a built-in table; renaming a table updates the refs to it; Delete removes it', () => {
  tab('tables');
  const arctic = $('#tbl-list .tbl-row[data-id="arctic"]');
  assert.equal(arctic.querySelector('.tbl-edit'), null, 'a built-in table has no Edit');
  click(arctic.querySelector('.tbl-dup'));
  assert.equal($('#tbl-f-name').value, 'Arctic (copy)');
  assert.match($('#tbl-f-src').value, /^d100\n01: /);
  assert.equal($('#tbl-f-origin').value, 'Shadowdark', 'the copy keeps the source, setting, and output');
  assert.equal($('#tbl-f-output').value, 'Encounter');
  click($('#tbl-f-save'));
  const copy = T.tableLib.tables.find(t => t.name === 'Arctic (copy)');
  assert.ok(copy);
  assert.equal(window.TableSyntax.parseTable(copy.source).entries.length, window.OSR.data.tables.find(t => t.id === 'arctic').entries.length);

  makeTable('Weather', 'd1\n1: snow\n');
  makeTable('Day', 'd1\n1: [Weather] and [2x Weather]\n');
  click(tblRow('Weather').querySelector('.tbl-edit'));
  setValue($('#tbl-f-name'), 'Sky');
  click($('#tbl-f-save'));
  assert.equal(T.tableLib.tables.find(t => t.name === 'Day').source, 'd1\n1: [Sky] and [2x Sky]\n');

  click(tblRow('Sky').querySelector('.tbl-del'));
  assert.equal(tblRow('Sky'), undefined);
  assert.ok(tblRow('Day').querySelector('.tbl-ref.is-bad'), 'a ref to a deleted table shows as broken');
});

test('Tables tab: every System sees every table; a user table hides a built-in one with the same name', () => {
  tab('tables');
  const builtins = window.OSR.data.tables.length;
  makeTable('Arctic', 'd1\n1: my own arctic\n');
  assert.equal($$('#tbl-list .tbl-row').length, builtins, 'the user Arctic replaces the built-in one');
  assert.ok(tblRow('Arctic').classList.contains('is-user'));

  window.OSR.setSystem('sl');
  assert.ok(tblRow('Arctic').classList.contains('is-user'), 'Silent Legions sees the user Arctic');
  click($('#tbl-new'));
  assert.deepEqual(editorSettings(), ['Modern', 'Horror'], 'a new table under Silent Legions starts as Modern and Horror');
  click($('#tbl-f-cancel'));
  makeTable('Cult', 'd1\n1: a cult\n');
  assert.ok(tblRow('Cult'));

  window.OSR.setSystem('osr');
  assert.ok(tblRow('Cult'), 'OSR sees the table made under Silent Legions');
  assert.deepEqual(T.tableLib.tables.map(t => [t.name, t.settings]), [['Arctic', ['Fantasy']], ['Cult', ['Modern', 'Horror']]]);
});

test('Tables tab: "Don\'t show included subtables" hides the tables that other tables roll on; search and a ref click still show them', () => {
  tab('tables');
  T.addTables([
    { name: 'Hue', source: 'd1\n1: grey\n' },
    { name: 'Shape', source: 'd1\n1: orb\n' },
    { name: 'Thing', source: 'd1\n1: a [Hue] [Shape]\n' },
    { name: 'Loop', source: 'd1\n1: [Loop]\n' }]);
  T.renderTables();
  const builtins = window.OSR.data.tables.length;
  const mine = () => $$('#tbl-list .tbl-row.is-user .tbl-name').map(n => n.textContent);
  assert.deepEqual(mine(), ['Loop', 'Thing'], 'Hue and Shape are hidden; a table that rolls only on itself is not');
  assert.match($('#tbl-count').textContent, new RegExp((builtins + 2) + ' / ' + (builtins + 4)));

  setValue($('#tbl-search'), 'hue');
  assert.deepEqual(mine(), ['Hue'], 'a search shows a sub-table');
  setValue($('#tbl-search'), '');

  click(tblRow('Thing').querySelector('summary'));
  click(tblRow('Thing').querySelector('.tbl-ref[data-ref-id]'));
  assert.deepEqual(mine(), ['Hue', 'Loop', 'Thing'], 'a ref click opens and shows the sub-table');

  const hide = $('#tbl-hide-subs');
  hide.checked = false;
  hide.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(mine(), ['Hue', 'Loop', 'Shape', 'Thing']);
  T.resetTableFilters();
  assert.equal(hide.checked, true, 'a reset turns it on again');
});

/* ================================================================== */
/* Settings tab                                                       */
/* ================================================================== */

test('Settings: Style theme select recolours (data-theme on <html>) and is persisted', async () => {
  tab('settings');
  setValue($('#set-theme'), 'fantasy');
  assert.equal(document.documentElement.dataset.theme, 'fantasy');
  assert.equal((await savedState()).settings.theme, 'fantasy');
  assert.match(logText(), /Style theme/);

  setValue($('#set-theme'), 'default');
  assert.equal(document.documentElement.dataset.theme, undefined);
});

test('Settings: Scarlet Heroes checkbox toggles the setting and logs it', async () => {
  tab('settings');
  const cb = $('#set-scarlet-heroes');
  assert.equal(cb.checked, false);
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(T.state.settings.scarletHeroes, true);
  assert.equal((await savedState()).settings.scarletHeroes, true);
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

test('Settings: System select partitions the Compendium — an entry created under one system is invisible under the other', async () => {
  tab('settings');
  assert.equal($('#set-system').value, 'osr');

  setValue($('#set-system'), 'ua3e');
  assert.equal(T.state.settings.system, 'ua3e');
  assert.equal((await savedState()).settings.system, 'ua3e');
  assert.match(logText(), /System/);

  tab('compendium');
  click($('#comp-new'));
  setValue($('#comp-f-name'), 'Biblioklept');
  $('#comp-f-cat').value = 'Other';
  click($('#comp-save'));
  assert.match($('#comp-list').textContent, /Biblioklept/);
  const entry = T.state.compendium.find(e => e.name === 'Biblioklept');
  assert.equal(entry.system, 'ua3e');

  tab('settings');
  setValue($('#set-system'), 'osr');
  tab('compendium');
  assert.doesNotMatch($('#comp-list').textContent, /Biblioklept/, 'the ua3e entry is hidden under osr');
  assert.ok(T.state.compendium.some(e => e.name === 'Biblioklept'), 'but it still exists in state');
});

test('Settings: switching System updates the Character dropdown immediately (bug: UA characters showed while in OSR mode)', () => {
  T.createCharacter('# Garrick [WWN]\nA warrior.');
  T.createCharacter(
    '# Kevin Johnson [Unknown Armies]\n\n```ua\nShock\nHelplessness: 1 hardened / 1 failed\n```\n',
    { name: 'Kevin Johnson' }
  );
  tab('character');
  assert.deepEqual($$('#char-select option').map(o => o.textContent), ['Garrick (WWN)']);
  assert.equal($('#view-name').textContent, 'Garrick', 'creating the UA character did not steal focus');

  tab('settings');
  setValue($('#set-system'), 'ua3e');

  tab('character');
  assert.deepEqual($$('#char-select option').map(o => o.textContent), ['Kevin Johnson (Unknown Armies)']);
  assert.equal($('#view-name').textContent, 'Kevin Johnson');

  tab('settings');
  setValue($('#set-system'), 'osr');
  tab('character');
  assert.deepEqual($$('#char-select option').map(o => o.textContent), ['Garrick (WWN)']);
});

test('Settings: Compendium "Delete all" only clears the active system\'s entries (bug: used to wipe every system)', () => {
  T.state.compendium.push(
    { id: 'o1', name: 'Longsword', category: 'Items', source: 'Unknown', body: '', system: 'osr' },
    { id: 'u1', name: 'Biblioklept', category: 'Other', source: 'Unknown', body: '', system: 'ua3e' }
  );
  tab('settings');
  setValue($('#set-system'), 'ua3e');
  click($('#set-clear-compendium'));     // confirm() stubbed true
  assert.equal(T.state.compendium.some(e => e.name === 'Biblioklept'), false, 'the active system was cleared');
  assert.ok(T.state.compendium.some(e => e.name === 'Longsword'), 'the other system was left alone');
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

test('Settings: Monster library "Reload defaults" only replaces the OSR portion (bug: wiped every system)', async () => {
  T.state.monsters = [
    { id: 'm2', name: 'Denizen', hd: '1', hdNum: 1, hp: 4, ac: { asc: 12 }, attacks: [], abilities: [], system: 'ua3e' },
  ];
  T.state.monstersSeeded = false;
  tab('settings');
  click($('#set-reload-monsters'));      // confirm() stubbed true; seedMonsters() is async
  await new Promise(r => setTimeout(r, 30));
  assert.ok(T.state.monsters.some(m => m.name === 'Denizen'), 'the ua3e monster survived the reload');
  assert.ok(T.state.monsters.some(m => (m.system || 'osr') === 'osr'), 'the bundled osr defaults were (re)added');
});

test('Settings: switching System updates the Bestiary tab and Combat\'s add-character/add-monster dropdowns immediately', () => {
  T.createCharacter('# Garrick [WWN]\nA warrior.');
  T.state.monsters = [
    { id: 'm1', name: 'Goblin', hd: '1', hdNum: 1, hp: 4, ac: { asc: 12 }, attacks: [], abilities: [], system: 'osr' },
    { id: 'm2', name: 'Denizen', hd: '1', hdNum: 1, hp: 4, ac: { asc: 12 }, attacks: [], abilities: [], system: 'ua3e' },
  ];
  T.renderAll();
  tab('bestiary');
  assert.deepEqual($$('#mb-list .comp-name').map(n => n.textContent), ['Goblin']);
  assert.deepEqual($$('#cb-add-char option').slice(1).map(o => o.textContent), ['Garrick']);

  tab('settings');
  setValue($('#set-system'), 'ua3e');

  tab('bestiary');
  assert.deepEqual($$('#mb-list .comp-name').map(n => n.textContent), ['Denizen']);
  assert.deepEqual($$('#cb-add-char option').slice(1).map(o => o.textContent), []);
});

test('System switch: Compendium, Bestiary, Character dropdown, Combat pickers, and Consumables all partition together, in one flow, with nothing ever deleted', () => {
  // One of each kind of System-partitioned thing, one per system.
  T.createCharacter('# Garrick [WWN]\nA warrior.'); // -> HP (Garrick)
  T.createCharacter('# Kevin [Unknown Armies]\n\n```ua\nWound Threshold: 50\n\nShock\n```\n'); // -> Wounds (Kevin)
  T.state.compendium.push(
    { id: 'co1', name: 'Longsword', category: 'Items', source: 'Unknown', body: '', system: 'osr' },
    { id: 'cu1', name: 'Biblioklept', category: 'Other', source: 'Unknown', body: '', system: 'ua3e' }
  );
  T.state.monsters.push(
    { id: 'mo1', name: 'Goblin', hd: '1', hdNum: 1, hp: 4, ac: { asc: 12 }, attacks: [], abilities: [], system: 'osr' },
    { id: 'mu1', name: 'Denizen', hd: '1', hdNum: 1, hp: 4, ac: { asc: 12 }, attacks: [], abilities: [], system: 'ua3e' }
  );
  T.state.consumables.push({ id: 'r1', name: 'Rations', value: 3, max: 3 }); // not tied to any character
  T.renderAll();

  function assertOsrView() {
    tab('character');
    assert.deepEqual($$('#char-select option').map(o => o.textContent), ['Garrick (WWN)']);
    assert.equal($('#view-name').textContent, 'Garrick');

    tab('compendium');
    assert.deepEqual($$('#comp-list .comp-name').map(n => n.textContent), ['Longsword']);

    tab('bestiary');
    assert.deepEqual($$('#mb-list .comp-name').map(n => n.textContent), ['Goblin']);

    tab('combat');
    assert.deepEqual($$('#cb-add-char option').slice(1).map(o => o.textContent), ['Garrick']);
    click($('#cb-add-monster'));
    assert.deepEqual($$('#mm-lib-list .mm-li-main b').map(b => b.textContent), ['Goblin']);
    click($('#mm-close'));

    assert.deepEqual($$('#consumables-list .cons-row').map(r => r.dataset.name).sort(), ['HP (Garrick)', 'Rations']);
  }
  function assertUaView() {
    tab('character');
    assert.deepEqual($$('#char-select option').map(o => o.textContent), ['Kevin (Unknown Armies)']);
    assert.equal($('#view-name').textContent, 'Kevin');

    tab('compendium');
    assert.deepEqual($$('#comp-list .comp-name').map(n => n.textContent), ['Biblioklept']);

    tab('bestiary');
    assert.deepEqual($$('#mb-list .comp-name').map(n => n.textContent), ['Denizen']);

    tab('combat');
    assert.deepEqual($$('#cb-add-char option').slice(1).map(o => o.textContent), ['Kevin']);
    click($('#cb-add-monster'));
    assert.deepEqual($$('#mm-lib-list .mm-li-main b').map(b => b.textContent), ['Denizen']);
    click($('#mm-close'));

    assert.deepEqual($$('#consumables-list .cons-row').map(r => r.dataset.name).sort(), ['Rations', 'Wounds (Kevin)']);
  }

  assertOsrView(); // default System is 'osr'

  tab('settings');
  setValue($('#set-system'), 'ua3e');
  assertUaView();

  tab('settings');
  setValue($('#set-system'), 'osr');
  assertOsrView(); // switching back restores the exact same OSR view

  tab('settings');
  setValue($('#set-system'), 'ua3e');
  assertUaView(); // and back again — idempotent, not a one-shot fluke

  // Nothing was ever deleted by any of the switching above.
  assert.equal(T.state.characters.length, 2);
  assert.equal(T.state.compendium.length, 2);
  assert.equal(T.state.monsters.length, 2);
  assert.deepEqual(T.state.consumables.map(c => c.name).sort(), ['HP (Garrick)', 'Rations', 'Wounds (Kevin)']);
});

test('System switch: Silent Legions gets its own Character dropdown, Compendium, Bestiary, and HP + Madness trackers', () => {
  T.createCharacter('# Garrick [WWN]\nA warrior.');
  T.createCharacter('# Mara [Silent Legions]\n\n```sl\nINT 14 (+1)\nMadness: 12\n```\n');
  T.state.compendium.push(
    { id: 'co1', name: 'Longsword', category: 'Items', source: 'Unknown', body: '', system: 'osr' },
    { id: 'cs1', name: 'The Black Lamp', category: 'Spells', source: 'Spell Level 3', body: '', system: 'sl' }
  );
  T.state.monsters.push(
    { id: 'mo1', name: 'Goblin', hd: '1', hdNum: 1, hp: 4, ac: { asc: 12 }, attacks: [], abilities: [], system: 'osr' },
    Object.assign(JSON.parse(JSON.stringify(slPack().monsters.find(d => d.name === 'Zombie'))), { system: 'sl' })
  );
  T.renderAll();

  tab('settings');
  setValue($('#set-system'), 'sl');
  tab('character');
  assert.deepEqual($$('#char-select option').map(o => o.textContent), ['Mara (Silent Legions)']);
  tab('compendium');
  assert.deepEqual($$('#comp-list .comp-name').map(n => n.textContent), ['The Black Lamp']);
  tab('bestiary');
  assert.deepEqual($$('#mb-list .comp-name').map(n => n.textContent), ['Zombie']);
  assert.match($('#mb-list').textContent, /HD 2 · AC 7 · HP 9 · sl/);
  assert.equal($('#mb-gen').hidden, true, 'the Shadowdark PL generator is hidden for Silent Legions');
  assert.deepEqual($$('#consumables-list .cons-row').map(r => r.dataset.name).sort(), ['HP (Mara)', 'Madness (Mara)']);
  const madness = T.state.consumables.find(c => c.name === 'Madness (Mara)');
  assert.equal(madness.value, 12);
  assert.equal(madness.max, 100);

  tab('settings');
  setValue($('#set-system'), 'osr');
  tab('character');
  assert.deepEqual($$('#char-select option').map(o => o.textContent), ['Garrick (WWN)']);
  assert.deepEqual($$('#consumables-list .cons-row').map(r => r.dataset.name).sort(), ['HP (Garrick)']);
  assert.equal(T.state.characters.length, 2, 'nothing deleted by switching');
});

test('Settings → "Add missing pregens": counts the example characters, adds the missing ones, then disables itself', async () => {
  T.createCharacter('# Garrick [WWN]\nA warrior.');
  T.renderAll();
  tab('settings');
  assert.match($('#set-pregen-count').textContent, /^1 of 8 example characters/);
  assert.match($('#set-pregen-count').textContent, /missing: Gulzund Blize, Kevin Johnson, .*Ray Kowalczyk\./);
  assert.equal($('#set-add-pregens').disabled, false);
  click($('#set-add-pregens'));
  await new Promise(r => setTimeout(r, 0)); // the handler awaits loadSeedSheets()
  await new Promise(r => setTimeout(r, 0));
  assert.equal(T.state.characters.length, 8);
  assert.match($('#set-pregen-count').textContent, /^8 of 8 example characters .* are in this campaign\.$/);
  assert.equal($('#set-add-pregens').disabled, true, 'nothing left to add');
  assert.match(logText(), /Example characters — 7 added/);
  tab('character');
  assert.equal($('#view-name').textContent, 'Garrick', 'the active character stays selected');
  setValue($('#set-system'), 'sl');
  assert.deepEqual($$('#char-select option').map(o => o.textContent),
    ['Dee Okafor (Silent Legions)', 'Miriam Castell (Silent Legions)', 'Vivian Sato (Silent Legions)', 'Ray Kowalczyk (Silent Legions)']);
});

/* ================================================================== */
/* Persistence & export                                               */
/* ================================================================== */

test('persistence: an action writes the new state to the campaign in IndexedDB', async () => {
  click($('#btn-new-blank'));
  assert.equal((await savedState()).characters.length, 1);
  assert.equal((await savedState()).activeId, T.state.activeId);
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

test('Combat right-click: a custom condition the combatant does not have goes under "More"; an applied one stays in the main list', async () => {
  T.addMonsterEntry({ name: 'Goblin', hd: '1', hp: 6, attacks: [], source: 'shadowdark' });
  const id = T.state.combat.entries[0].id;
  T.defineCondition('Hexed', 'A witch\'s curse.');
  T.defineCondition('Soaked', '');
  T.toggleStatus(id, 'Soaked');
  T.openCtxMenu(10, 10, id);
  const main = $$('#ctx-menu .ctx-list .ctx-item').map(b => b.dataset.name);
  const more = $$('#ctx-menu .ctx-submenu .ctx-item').map(b => b.dataset.name);
  assert.ok(main.includes('Prone') && main.includes('Soaked'), 'seeded conditions and an applied custom one stay');
  assert.ok(!main.includes('Hexed'));
  assert.deepEqual(more, ['Hexed']);
  click($('#ctx-menu .ctx-more-btn'));
  assert.ok($('#ctx-menu .ctx-more').classList.contains('is-open'), 'a click on More opens it');
  assert.ok(!$('#ctx-menu').hidden, 'and keeps the menu open');
  click($('#ctx-menu .ctx-submenu .ctx-item[data-name="Hexed"]'));
  assert.deepEqual(T.state.combat.entries[0].statuses.map(s => s.name), ['Soaked', 'Hexed']);
  assert.ok($('#ctx-menu').hidden);

  T.openCtxMenu(10, 10, id);
  assert.strictEqual($('#ctx-menu .ctx-more'), null, 'no "More" when every custom condition is applied');
  T.closeCtxMenu();
});

test('a reload opens the tab that was open last (localStorage, per device)', async () => {
  tab('tables');
  assert.strictEqual(window.localStorage.getItem('osr_last_tab'), 'tables');
  const env = await boot({ extraStorage: { osr_last_tab: 'compendium' } });
  const active = env.document.querySelector('.tab-btn.is-active');
  assert.strictEqual(active.dataset.tab, 'compendium');
  assert.ok(env.document.querySelector('#tab-compendium').classList.contains('is-active'));
  env.window.close();
  const bad = await boot({ extraStorage: { osr_last_tab: 'nope' } });
  assert.strictEqual(bad.document.querySelector('.tab-btn.is-active').dataset.tab, 'character', 'an unknown tab: the first tab');
  bad.window.close();
  tab('character');
});

test('Compendium popups: a pinned popup shows only on the tab it was opened from', () => {
  // Open and pin a popup on a ref placed in `host`.
  const openPinned = (host, name) => {
    const ref = document.createElement('span');
    ref.className = 'comp-ref'; ref.dataset.name = name;
    host.appendChild(ref);
    fire(ref, 'mouseover');
    const pop = $$('.comp-pop').pop();
    click(pop.querySelector('[data-act="pin"]'));
    ref.remove();
    return pop;
  };
  tab('combat');
  const combat = openPinned($('#tab-combat'), 'Sleep');
  const rail = openPinned(document.body, 'Light'); // outside every tab panel
  tab('character');
  assert.ok(combat.isConnected, 'a pinned popup stays open');
  assert.strictEqual(combat.hidden, true, 'and hides on another tab');
  assert.strictEqual(rail.hidden, false, 'a popup from outside the tabs shows on every tab');
  const sheet = openPinned($('#tab-character'), 'Charm Person');
  tab('combat');
  assert.strictEqual(combat.hidden, false, 'it shows again on its own tab');
  assert.strictEqual(sheet.hidden, true, 'the Characters popup hides on Combat');
  tab('character');
  assert.strictEqual(combat.hidden, true);
  assert.strictEqual(sheet.hidden, false);
  T.closeAllCompPops();
});

test('Compendium popups: the corner grip resizes a popup and pins it', () => {
  const ref = document.createElement('span');
  ref.className = 'comp-ref'; ref.dataset.name = 'Sleep';
  document.body.appendChild(ref);
  fire(ref, 'mouseover');
  const pop = $('.comp-pop');
  const grip = pop.querySelector('.cpop-resize');
  assert.ok(grip, 'the popup has a resize grip');
  const mouse = (target, type, x, y) => target.dispatchEvent(new window.MouseEvent(type,
    { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
  mouse(grip, 'mousedown', 10, 10);
  mouse(document, 'mousemove', 310, 160);
  mouse(document, 'mouseup', 310, 160);
  assert.strictEqual(pop.style.width, '300px');
  assert.strictEqual(pop.style.height, '150px');
  assert.ok(pop.classList.contains('is-pinned') && pop.classList.contains('is-sized'));
  mouse(grip, 'mousedown', 0, 0);
  mouse(document, 'mousemove', -500, -500);
  mouse(document, 'mouseup', -500, -500);
  assert.strictEqual(pop.style.width, '200px', 'a minimum width');
  assert.strictEqual(pop.style.height, '100px', 'a minimum height');
  T.closeAllCompPops();
  ref.remove();
});
