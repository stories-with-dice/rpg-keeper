'use strict';

/*
 * Unit tests for the app's internal logic (js/*.js, all attached to
 * window.OSR — see AGENTS.md "Layout"), reached through the
 * window.__OSR_TEST__ seam (see js/main.js "Test seam" and test/helpers/boot.js).
 *
 * One jsdom instance is shared per file; T.reset() gives every test a clean,
 * already-migrated blank state.
 *
 * NOTE: values returned from the app are created in jsdom's realm, so their
 * prototypes differ from Node's. Use the non-strict `assert` (which ignores
 * [[Prototype]]) for structural comparisons.
 */

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const { boot, rigRandom, face } = require('./helpers/boot.js');

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

// Rig Math.random to a fixed fraction / sequence for the duration of a test.
function rig(fractions) {
  T._restoreRandom = rigRandom(window, fractions);
}

// Build three real monster combatants; returns their ids [a, b, c].
function threeCombatants() {
  T.state.combat.entries = [];
  for (const name of ['A', 'B', 'C']) {
    T.addMonsterEntry({ name, hd: '1', hp: 5, ac: { asc: 12 }, attacks: [], abilities: [], stats: null, saveTargets: null });
  }
  const ids = T.state.combat.entries.map(e => e.id);
  T.state.combat.activeId = ids[0];
  T.state.combat.selectedId = ids[0];
  T.state.combat.round = 1;
  return ids;
}

/* ================================================================== */
/* Dice engine — evalFormula / rollTerm                                */
/* ================================================================== */

test('evalFormula: NdM sums every die', () => {
  rig(face(4, 6));                       // every d6 shows 4
  const r = T.evalFormula('3d6');
  assert.equal(r.total, 12);
  assert.equal(r.normalized, '3d6');
  assert.equal(r.flat, 0);
  assert.deepEqual(r.dice.map(d => d.value), [4, 4, 4]);
  assert.ok(r.dice.every(d => d.sides === 6 && d.sign === 1));
});

test('evalFormula: +/- chains, flat term tracked separately', () => {
  rig(face(5, 8));
  const r = T.evalFormula('2d8 + 3 - 1');
  assert.equal(r.total, 5 + 5 + 3 - 1);
  assert.equal(r.flat, 2);
  assert.equal(r.dice.length, 2);
});

test('evalFormula: bare modifier becomes 1d20 + it', () => {
  rig(face(11, 20));
  assert.equal(T.evalFormula('+3').total, 14);
  assert.equal(T.evalFormula('+3').normalized, '1d20+3');
  assert.equal(T.evalFormula('-2').total, 9);
});

test('evalFormula: a plain number also rolls a d20', () => {
  rig(face(10, 20));
  const r = T.evalFormula('5');
  assert.equal(r.normalized, '1d20+5');
  assert.equal(r.total, 15);
});

test('evalFormula: whitespace inside a formula is ignored', () => {
  rig(face(6, 8));
  assert.equal(T.evalFormula('1d8 + 2').total, 8);
});

test('evalFormula: keep-highest / keep-lowest', () => {
  // four d6: 1,2,5,6 in roll order
  rig([face(1, 6), face(2, 6), face(5, 6), face(6, 6)]);
  assert.equal(T.evalFormula('4d6kh3').total, 2 + 5 + 6);
  rig([face(1, 6), face(2, 6), face(5, 6), face(6, 6)]);
  assert.equal(T.evalFormula('4d6kl1').total, 1);
});

test('evalFormula: drop-highest / drop-lowest', () => {
  rig([face(1, 6), face(3, 6), face(6, 6)]);
  assert.equal(T.evalFormula('3d6dh1').total, 1 + 3);
  rig([face(1, 6), face(3, 6), face(6, 6)]);
  assert.equal(T.evalFormula('3d6dl1').total, 3 + 6);
});

test('evalFormula: d% resolves to d100', () => {
  rig(face(37, 100));
  const r = T.evalFormula('d%');
  assert.equal(r.total, 37);
  assert.equal(r.dice[0].sides, 100);
});

test('evalFormula: die count is clamped to MAX_DICE (500)', () => {
  rig(face(1, 4));
  const r = T.evalFormula('999d4');
  assert.equal(r.dice.length, 500);
});

test('evalFormula: empty / malformed-die input returns null', () => {
  assert.equal(T.evalFormula(''), null);
  assert.equal(T.evalFormula('   '), null);
  assert.equal(T.evalFormula('1d0'), null);
  assert.equal(T.evalFormula('2d%kh0') && true, true); // sanity: valid shape is non-null
});

test('evalFormula: text with no dice is treated as a d20 modifier (never null)', () => {
  rig(face(10, 20));
  assert.ok(T.evalFormula('abc'));       // -> 1d20+abc, the junk term is ignored
});

test('rollDie: stays within 1..sides', () => {
  const orig = window.Math.random;
  for (const f of [0, 0.001, 0.5, 0.999999]) {
    window.Math.random = () => f;
    const v = T.rollDie(20);
    assert.ok(v >= 1 && v <= 20, `got ${v}`);
  }
  window.Math.random = orig;
});

/* ================================================================== */
/* Character-sheet variables ("Name: ±N") and $Name substitution      */
/* ================================================================== */

test('scanVariables: comma/semicolon/pipe/line-bounded "Name: ±N" pairs; a number glued onto more text is rejected', () => {
  const vars = T.scanVariables('CON: +1, STR: 0, DEX: -1');
  assert.deepEqual(vars.map(v => [v.name, v.value]), [['CON', 1], ['STR', 0], ['DEX', -1]]);

  // "|" is also a field boundary (this app's own seed sheets use it, e.g.
  // "HP: 19/19 | AC: 14 | AB: +0") — "HP: 19/19" has "19" glued straight onto
  // "/19" with no separating space, so it's rejected; "AC: 14" and "AB: +0"
  // are each a clean field.
  const piped = T.scanVariables('HP: 19/19 | AC: 14 | AB: +0');
  assert.deepEqual(piped.map(v => [v.name, v.value]), [['AC', 14], ['AB', 0]]);

  // A space after the number ends the value there — whatever follows in that
  // field is simply not looked at.
  assert.deepEqual(T.scanVariables('Cost: 5 gp'), [{ name: 'Cost', value: 5, nameStart: 0, nameEnd: 4, valStart: 6, valEnd: 7 }]);
});

test('scanVariables: "Name: ±N (extra)" stops at the first number, e.g. an ATTRIBUTES block', () => {
  const block = 'ATTRIBUTES\nSTR: +1 (14)\nDEX: +0 (9)\nCON: +1 (14)\nINT: +0 (9)\nWIS: +1 (14)\nCHA: +0 (11)';
  const byName = Object.fromEntries(T.scanVariables(block).map(v => [v.name, v.value]));
  assert.deepEqual(byName, { STR: 1, DEX: 0, CON: 1, INT: 0, WIS: 1, CHA: 0 });

  // Same stopping rule when the score comes first and the modifier is in
  // parens instead (e.g. the WWN seed sheet) — the *first* number wins.
  assert.deepEqual(T.scanVariables('STR: 14 (+1)').map(v => [v.name, v.value]), [['STR', 14]]);
});

test('charVars: reads a character\'s rendered sheet; last occurrence of a name wins', () => {
  T.createCharacter('# Hero\n\nCON: -1, Heal: 2, Shoot: +2\n\nCON: +3');
  const byName = Object.fromEntries(T.charVars(T.activeChar()).map(v => [v.name, v.value]));
  assert.deepEqual(byName, { CON: 3, Heal: 2, Shoot: 2 });
  assert.deepEqual(T.charVars(null), []);
});

test('findMatches: a "Name: ±N" pair renders as a .var-name span plus a .roll.var-value span', () => {
  const spans = T.findMatches('CON: -1');
  assert.deepEqual(spans.map(s => s.kind), ['varname', 'roll']);
  assert.equal(spans[0].varName, 'CON');
  assert.equal(spans[1].formula, '1d20-1');
  assert.equal(spans[1].isVar, true);
});

test('findMatches: an unsigned variable value gets a "+" so it doesn\'t concatenate into a huge die (e.g. "1d200")', () => {
  const zero = T.findMatches('Survive: 0').find(s => s.kind === 'roll');
  assert.equal(zero.formula, '1d20+0');
  const positive = T.findMatches('STR: 14').find(s => s.kind === 'roll');
  assert.equal(positive.formula, '1d20+14');
});

test('findMatches: "1d6+$CON+2" is one dice span; a bare "$STR" is its own roll span', () => {
  const dice = T.findMatches('Attack: 1d6+$CON+2').find(s => s.kind === 'roll' && /d6/.test(s.formula));
  assert.equal(dice.formula, '1d6+$CON+2');
  const bare = T.findMatches('Melee bonus: $STR').find(s => s.kind === 'roll');
  assert.equal(bare.formula, '$STR');
});

test('findMatches: the "$" is stripped from the displayed label but kept in data-formula', () => {
  const dice = T.findMatches('1d20+$AB+$STR+$Stab').find(s => s.kind === 'roll');
  assert.equal(dice.formula, '1d20+$AB+$STR+$Stab');
  assert.equal(dice.label, '1d20+AB+STR+Stab');
  const bare = T.findMatches('Melee bonus: $STR').find(s => s.kind === 'roll');
  assert.equal(bare.formula, '$STR');
  assert.equal(bare.label, 'STR');
});

test('formatFormulaDisplay: "$Name" -> "Name (value)" for a hover tooltip, missing ones show "(?)"', () => {
  const vars = [{ name: 'AB', value: 0 }, { name: 'STR', value: 1 }, { name: 'Stab', value: 1 }];
  assert.equal(T.formatFormulaDisplay('1d20+$AB+$STR+$Stab', vars), '1d20+AB (0)+STR (1)+Stab (1)');
  assert.equal(T.formatFormulaDisplay('1d20+$NOPE', vars), '1d20+NOPE (?)');
});

test('substituteVars: folds a formula\'s leading sign into the variable\'s own value', () => {
  const vars = [{ name: 'CON', value: -1 }];
  assert.equal(T.substituteVars('1d6+$CON+2', vars).text, '1d6-1+2');
  assert.equal(T.substituteVars('1d6-$CON+2', vars).text, '1d6+1+2');
  assert.equal(T.substituteVars('$CON', vars).text, '-1');
  const missing = T.substituteVars('$NOPE', vars);
  assert.deepEqual(missing.missing, ['NOPE']);
});

test('doRoll: resolves $variables against the passed-in vars before evaluating', () => {
  rig(face(4, 6));
  T.doRoll('1d6+$CON+2', 'Test', [{ name: 'CON', value: -1 }]);
  assert.match(T.logToText(), /1d6-1\+2/);
  // An unresolved reference makes evalFormula fail -> the usual "Invalid: …".
  const before = T.state.log.length;
  T.doRoll('1d6+$NOPE', 'Test', []);
  assert.equal(T.state.log.length, before); // invalid rolls are shown, not logged
});

/* ================================================================== */
/* Scarlet Heroes translation — shDie / setEntryHd / applyEntryDamage  */
/* ================================================================== */

test('shDie: bucket boundaries (1->0, 2..5->1, 6..9->2, 10+->4)', () => {
  assert.deepEqual([1, 2, 5, 6, 9, 10, 20].map(T.shDie), [0, 1, 1, 2, 2, 4, 4]);
});

test('setEntryHd: keeps * / + suffix, half steps, floors at 0', () => {
  const ent = { hd: '9*' };
  T.setEntryHd(ent, 7);
  assert.equal(ent.hd, '7*');
  T.setEntryHd(ent, 2.5);
  assert.equal(ent.hd, '2.5*');
  T.setEntryHd(ent, -3);
  assert.equal(ent.hd, '0');
});

test('applyEntryDamage: HP path clamps at 0 and reports before/after', () => {
  const ent = { kind: 'monster', hp: 10 };
  assert.deepEqual(T.applyEntryDamage(ent, 4, 'hp'), { before: 10, after: 6, unit: 'HP' });
  assert.deepEqual(T.applyEntryDamage(ent, 99, 'hp'), { before: 6, after: 0, unit: 'HP' });
});

test('applyEntryDamage: HD path uses hdNum and clamps at 0', () => {
  const ent = { kind: 'monster', hd: '5' };
  assert.deepEqual(T.applyEntryDamage(ent, 2, 'hd'), { before: 5, after: 3, unit: 'HD' });
  assert.equal(ent.hd, '3');
});

/* ================================================================== */
/* escapeHtml                                                          */
/* ================================================================== */

test('escapeHtml: escapes & < > " \'', () => {
  assert.equal(T.escapeHtml(`<a href="x">& '`), '&lt;a href=&quot;x&quot;&gt;&amp; &#39;');
});

test('escapeHtml: coerces non-strings', () => {
  assert.equal(T.escapeHtml(42), '42');
  assert.equal(T.escapeHtml(null), 'null');
});

/* ================================================================== */
/* State shape / migration — ensureStateShape                          */
/* ================================================================== */

test('ensureStateShape: backfills missing collections and bad theme', () => {
  T.state = { settings: { theme: 'neon' } };
  T.ensureStateShape();
  const s = T.state;
  assert.ok(Array.isArray(s.characters) && Array.isArray(s.monsters) && Array.isArray(s.log));
  assert.equal(s.settings.theme, 'default');
  assert.equal(s.settings.scarletHeroes, false);
  assert.ok(s.conditions.length > 0, 'seeds the OSR condition set');
  assert.ok(s.combat && Array.isArray(s.combat.entries));
});

test('ensureStateShape: folds legacy per-character notes into the global journal', () => {
  T.state = {
    notes: 'Existing.',
    characters: [{ id: 'c1', name: 'Thora', body: '', notes: 'Owes the guild 40gp.' }],
  };
  T.ensureStateShape();
  assert.match(T.state.notes, /Existing\./);
  assert.match(T.state.notes, /## Thora/);
  assert.match(T.state.notes, /Owes the guild 40gp\./);
  assert.equal('notes' in T.state.characters[0], false);
});

test('ensureStateShape: migrates legacy per-character consumables + HP tracker', () => {
  T.state = {
    characters: [{
      id: 'c1', name: 'Thora', body: '',
      consumables: [
        { name: 'HP', value: 7, max: 12 },
        { name: 'Torches', value: 3, max: 5 },
      ],
    }],
  };
  T.ensureStateShape();
  const names = T.state.consumables.map(c => c.name);
  assert.ok(names.includes('HP (Thora)'));
  assert.ok(names.includes('Torches'));
  const hp = T.state.consumables.find(c => c.name === 'HP (Thora)');
  assert.deepEqual([hp.value, hp.max], [7, 12]);
});

test('ensureStateShape: normalizes compendium entries', () => {
  T.state = {
    characters: [],
    compendium: [{ name: 42, category: 'Bogus', source: '   ', body: null }],
  };
  T.ensureStateShape();
  const en = T.state.compendium[0];
  assert.equal(en.name, '42');
  assert.equal(en.category, 'Other');
  assert.equal(en.source, 'Unknown');
  assert.equal(en.body, '');
  assert.ok(en.id && en.createdAt);
});

test('ensureStateShape: drops activeIdB when it equals activeId or dangles', () => {
  T.state = { characters: [{ id: 'a', name: 'A', body: '' }], activeId: 'a', activeIdB: 'a' };
  T.ensureStateShape();
  assert.equal(T.state.activeIdB, null);

  T.state = { characters: [{ id: 'a', name: 'A', body: '' }], activeId: 'a', activeIdB: 'ghost' };
  T.ensureStateShape();
  assert.equal(T.state.activeIdB, null);
});

test('ensureStateShape: backfills combat entry side + statuses', () => {
  T.state = {
    characters: [],
    combat: { entries: [
      { id: 'e1', kind: 'character' },
      { id: 'e2', kind: 'monster' },
    ] },
  };
  T.ensureStateShape();
  assert.equal(T.state.combat.entries[0].side, 'ally');
  assert.equal(T.state.combat.entries[1].side, 'enemy');
  assert.ok(T.state.combat.entries.every(e => Array.isArray(e.statuses)));
});

/* ================================================================== */
/* Consumables — clampConsumable / hpTrackerLabel                      */
/* ================================================================== */

test('clampConsumable: floors at 0, rounds, respects positive max', () => {
  const a = { value: -4, max: 10 };  T.clampConsumable(a);  assert.deepEqual(a, { value: 0, max: 10 });
  const b = { value: 12.6, max: 10 }; T.clampConsumable(b); assert.deepEqual(b, { value: 10, max: 10 });
  const c = { value: 3.2, max: 0 };  T.clampConsumable(c);  assert.deepEqual(c, { value: 3, max: 0 });
  const d = { value: 5, max: -1 };   T.clampConsumable(d);  assert.equal(d.max, 0);
});

test('hpTrackerLabel: "HP (Name)"', () => {
  assert.equal(T.hpTrackerLabel({ name: 'Garrick' }), 'HP (Garrick)');
  assert.equal(T.hpTrackerLabel(null), 'HP ()');
});

test('ensureHpTracker: adds one tracker, never duplicates', () => {
  const ch = { id: 'c1', name: 'Vex' };
  T.ensureHpTracker(ch);
  T.ensureHpTracker(ch);
  assert.equal(T.state.consumables.filter(c => c.name === 'HP (Vex)').length, 1);
});

/* ================================================================== */
/* Character text detection — detectNameSystem / splitBodyColumns      */
/* ================================================================== */

test('detectNameSystem: strips heading + bold, reads trailing [SYSTEM] tag', () => {
  assert.deepEqual(T.detectNameSystem('# Garrick [WWN]\nFighter 1'), { name: 'Garrick', system: 'WWN' });
  assert.deepEqual(T.detectNameSystem('**Thora**'), { name: 'Thora', system: '' });
});

test('detectNameSystem: infers system from body keywords', () => {
  assert.equal(T.detectNameSystem('Kevery\nA Shadowdark thief').system, 'Shadowdark');
  assert.equal(T.detectNameSystem('Bob\nWorlds Without Number pilot').system, 'WWN');
});

test('detectNameSystem: empty text -> Untitled', () => {
  assert.deepEqual(T.detectNameSystem(''), { name: 'Untitled', system: '' });
});

test('splitBodyColumns: splits on the first standalone --- line', () => {
  assert.deepEqual(T.splitBodyColumns('left\n---\nright\n---\nmore'), ['left', 'right\n---\nmore']);
  assert.deepEqual(T.splitBodyColumns('no rule here'), ['no rule here', null]);
});

/* ================================================================== */
/* Sheet annotation — isSystemTag / findMatches / annotate             */
/* ================================================================== */

test('isSystemTag: short all-caps tags yes, real names no', () => {
  assert.equal(T.isSystemTag('WWN'), true);
  assert.equal(T.isSystemTag('SD'), true);
  assert.equal(T.isSystemTag('Longsword'), false);
  assert.equal(T.isSystemTag('Detect Magic'), false);
});

test('findMatches: dice, bare modifiers and [refs]; comp wins overlaps; system tag skipped', () => {
  const spans = T.findMatches('Attack +2 for 1d8+1 damage. See [Longsword] and [WWN].');
  const kinds = spans.map(s => s.kind);
  assert.ok(kinds.includes('roll'));
  assert.ok(kinds.includes('comp'));
  const comp = spans.find(s => s.kind === 'comp');
  assert.equal(comp.name, 'Longsword');
  assert.equal(spans.some(s => s.kind === 'comp' && s.name === 'WWN'), false);
  const mod = spans.find(s => s.label === '+2');
  assert.equal(mod.formula, '1d20+2');
});

test('annotate: wraps dice in span.roll and [refs] in span.comp-ref, skips <code>/<a>', () => {
  const root = document.createElement('div');
  root.innerHTML = 'Roll 2d6+3 now. <code>1d4</code> <a href="#">1d20</a> Use [Bless].';
  T.annotate(root);
  const rolls = root.querySelectorAll('span.roll');
  assert.equal(rolls.length, 1);
  assert.equal(rolls[0].dataset.formula, '2d6+3');
  const refs = root.querySelectorAll('span.comp-ref');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].dataset.name, 'Bless');
  assert.equal(root.querySelector('code').textContent, '1d4', 'code left alone');
});

/* ================================================================== */
/* Small display helpers                                               */
/* ================================================================== */

test('acDisplay: asc+desc, asc only, desc only, none', () => {
  assert.equal(T.acDisplay({ ac: { asc: 16, desc: 3 } }), '16 [3]');
  assert.equal(T.acDisplay({ ac: { asc: 15, desc: null } }), '15');
  assert.equal(T.acDisplay({ ac: { asc: null, desc: 2 } }), '[2]');
  assert.equal(T.acDisplay({ ac: null }), '—');
});

test('charDetectHp / charQuickAC: read numbers off a sheet body', () => {
  assert.deepEqual(T.charDetectHp({ body: '> **AC** 15 · **HP** 9/12' }), { value: 9, max: 12 });
  assert.deepEqual(T.charDetectHp({ body: 'HP 7' }), { value: 7, max: 7 });
  assert.equal(T.charDetectHp({ body: 'no hp' }), null);
  assert.equal(T.charQuickAC({ body: 'AC 14, HP 8/8' }), '14');
});

test('compExcerpt: strips markdown punctuation, first non-blank line, 140-char cap', () => {
  assert.match(T.compExcerpt('\n\n## **Longsword**\n\nA sword.'), /^\s*Longsword$/);
  assert.equal(T.compExcerpt('x'.repeat(300)).length, 140);
});

/* ================================================================== */
/* uniqueName                                                          */
/* ================================================================== */

test('uniqueName: first collision renames the bare entry to (1) and returns (2)', () => {
  T.state.combat.entries = [{ id: 'a', name: 'Goblin' }];
  assert.equal(T.uniqueName('Goblin'), 'Goblin (2)');
  assert.equal(T.state.combat.entries[0].name, 'Goblin (1)');
  T.state.combat.entries.push({ id: 'b', name: 'Goblin (2)' });
  assert.equal(T.uniqueName('Goblin'), 'Goblin (3)');
});

test('uniqueName: unused base is returned unchanged', () => {
  T.state.combat.entries = [{ id: 'a', name: 'Goblin' }];
  assert.equal(T.uniqueName('Orc'), 'Orc');
});

/* ================================================================== */
/* Compendium linkify + resolution                                    */
/* ================================================================== */

test('linkifyInText: exact replace, whitespace-tolerant fallback, miss', () => {
  assert.deepEqual(T.linkifyInText('carry a longsword here', 'longsword', '[Longsword]'),
    { ok: true, text: 'carry a [Longsword] here' });
  // a rendered selection can collapse a newline between the words
  const r = T.linkifyInText('a mighty\nlongsword blade', 'mighty longsword', '[X]');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'a [X] blade');
  assert.deepEqual(T.linkifyInText('nothing to see', 'absent', '[Y]'), { ok: false, text: 'nothing to see' });
});

test('compByExactName: case-insensitive exact match only', () => {
  T.state.compendium = [
    { id: '1', name: 'Bless', category: 'Spells', source: 'x', body: '' },
    { id: '2', name: 'Blessing of Kord', category: 'Spells', source: 'x', body: '' },
  ];
  assert.deepEqual(T.compByExactName('bless').map(e => e.id), ['1']);
  assert.deepEqual(T.compByExactName('  BLESS  ').map(e => e.id), ['1']);
  assert.deepEqual(T.compByExactName('nope'), []);
});

test('compResolve: exact wins (fuzzy:false); otherwise fuzzy results with scores', () => {
  T.state.compendium = [
    { id: '1', name: 'Longsword', category: 'Items', source: 'x', body: 'A blade.' },
    { id: '2', name: 'Shortsword', category: 'Items', source: 'x', body: 'A blade.' },
  ];
  const exact = T.compResolve('longsword');
  assert.equal(exact.fuzzy, false);
  assert.deepEqual(exact.items.map(e => e.id), ['1']);

  const fz = T.compResolve('longswrd');
  assert.equal(fz.fuzzy, true);
  assert.ok(fz.items.length >= 1);
  assert.equal(fz.items[0].name, 'Longsword');
  assert.equal(fz.scores.length, fz.items.length);
});

test('compResolve: empty compendium -> no items', () => {
  T.state.compendium = [];
  const res = T.compResolve('anything');
  assert.equal(res.fuzzy, true);
  assert.deepEqual(res.items, []);
  assert.deepEqual(res.scores, []);
});

/* ================================================================== */
/* seedCompendium                                                     */
/* ================================================================== */

test('seedCompendium: adds the bundled gear once, then is idempotent', () => {
  T.state.compendium = [];
  const added = T.seedCompendium();
  assert.ok(added > 0);
  assert.equal(T.state.compendium.length, added);
  assert.equal(T.state.compendiumSeedVersion, T.COMPENDIUM_SEED_VERSION);
  const en = T.state.compendium[0];
  assert.equal(en.category, 'Items');
  assert.equal(en.source, 'Shadowdark Core');
  assert.equal(T.seedCompendium(), 0, 'second run adds nothing');
});

test('seedCompendium: leaves an existing same-name entry untouched', () => {
  const name = T.COMPENDIUM_SEED[0].name;
  T.state.compendium = [{ id: 'mine', name, category: 'Rules', source: 'Homebrew', body: 'mine' }];
  T.seedCompendium();
  const mine = T.state.compendium.find(e => e.id === 'mine');
  assert.equal(mine.category, 'Rules');
  assert.equal(mine.body, 'mine');
});

/* ================================================================== */
/* Combat: turn order + round counter                                 */
/* ================================================================== */

test('nextTurn: advances, wraps to the top and bumps the round', () => {
  const [a, b, c] = threeCombatants();
  T.nextTurn(); assert.equal(T.state.combat.activeId, b);
  T.nextTurn(); assert.equal(T.state.combat.activeId, c);
  T.nextTurn();
  assert.equal(T.state.combat.activeId, a);
  assert.equal(T.state.combat.round, 2);
});

test('prevTurn: wraps backwards and decrements the round, never below 1', () => {
  const [a, , c] = threeCombatants();
  T.prevTurn();
  assert.equal(T.state.combat.activeId, a, 'round 1 + at top: stays put');
  assert.equal(T.state.combat.round, 1);
  T.state.combat.round = 2;
  T.prevTurn();
  assert.equal(T.state.combat.activeId, c);
  assert.equal(T.state.combat.round, 1);
});

test('setRound: clamps to a minimum of 1', () => {
  T.state.combat.round = 1;
  T.setRound(-5);
  assert.equal(T.state.combat.round, 1);
  T.setRound(3);
  assert.equal(T.state.combat.round, 4);
});

/* ================================================================== */
/* Combat: adding / removing combatants                               */
/* ================================================================== */

test('addCharEntry: seeds the linked HP tracker from the sheet HP', () => {
  T.createCharacter('# Thora\n> **HP** 9/14');
  const ch = T.activeChar();
  T.state.combat.entries = [];
  T.addCharEntry(ch.id);
  const hp = T.state.consumables.find(c => c.name === 'HP (Thora)');
  assert.deepEqual([hp.value, hp.max], [9, 14]);
  assert.equal(T.state.combat.entries[0].kind, 'character');
});

test('addMonsterEntry: deep-clones the def and disambiguates duplicate names', () => {
  const def = { name: 'Kobold', hd: '1', hp: 4, ac: { asc: 12 }, attacks: [], abilities: [] };
  T.addMonsterEntry(def);
  T.addMonsterEntry(def);
  assert.deepEqual(T.state.combat.entries.map(e => e.name), ['Kobold (1)', 'Kobold (2)']);
  T.state.combat.entries[0].monster.hp = 999;
  assert.equal(def.hp, 4, 'source def not mutated');
});

test('removeEntry: keeps active/selected pointers valid', () => {
  const [a, b, c] = threeCombatants();
  T.state.combat.selectedId = b;
  T.state.combat.activeId = b;
  T.removeEntry(b);
  assert.equal(T.state.combat.entries.length, 2);
  assert.ok([a, c].includes(T.state.combat.selectedId));
  assert.ok([a, c].includes(T.state.combat.activeId));
});

test('cycleSide / toggleSide', () => {
  const [a] = threeCombatants();
  assert.equal(T.state.combat.entries[0].side, 'enemy');
  T.cycleSide(a); assert.equal(T.state.combat.entries[0].side, 'neutral');
  T.cycleSide(a); assert.equal(T.state.combat.entries[0].side, 'ally');
  T.toggleSide(a); assert.equal(T.state.combat.entries[0].side, 'enemy');
});

/* ================================================================== */
/* Combat: status conditions                                          */
/* ================================================================== */

test('toggleStatus: adds then removes, stamping the round, and logs both', () => {
  const [a] = threeCombatants();
  T.state.combat.round = 3;
  const before = T.state.log.length;
  T.toggleStatus(a, 'Prone');
  assert.deepEqual(T.state.combat.entries[0].statuses.map(s => s.name), ['Prone']);
  assert.equal(T.state.combat.entries[0].statuses[0].round, 3);
  T.toggleStatus(a, 'Prone');
  assert.deepEqual(T.state.combat.entries[0].statuses, []);
  assert.equal(T.state.log.length, before + 2);
});

test('defineCondition: adds a new condition and updates an existing one', () => {
  const n0 = T.state.conditions.length;
  const c = T.defineCondition('Hexed', 'Bad luck.');
  assert.equal(T.state.conditions.length, n0 + 1);
  assert.equal(c.desc, 'Bad luck.');
  T.defineCondition('hexed', 'Worse luck.');
  assert.equal(T.state.conditions.length, n0 + 1, 'matched case-insensitively, not re-added');
  assert.equal(T.state.conditions.find(x => x.name === 'Hexed').desc, 'Worse luck.');
});

/* ================================================================== */
/* Damage application — applyDamageToSelected (Apply damage button)    */
/* ================================================================== */

test('applyDamageToSelected: plain mode subtracts the rolled total from HP', () => {
  T.addMonsterEntry({ name: 'Ogre', hd: '4', hp: 20, ac: { asc: 14 }, attacks: [], abilities: [] });
  const ent = T.state.combat.entries[0];
  T.setSelected(ent.id);
  rig(face(4, 6));
  T.doRoll('2d6', 'Dice Roller');       // total 8
  T.applyDamageToSelected();
  assert.equal(T.entryHp(ent), 12);
  const note = T.state.log[T.state.log.length - 1];
  assert.equal(note.source, 'Ogre');
  assert.match(note.formula, /20.?12/);  // "HP 20→12"
});

test('applyDamageToSelected: Scarlet Heroes translates dice to HD', () => {
  T.state.settings.scarletHeroes = true;
  T.addMonsterEntry({ name: 'Ogre', hd: '4', hp: 20, ac: { asc: 14 }, attacks: [], abilities: [] });
  const ent = T.state.combat.entries[0];
  T.setSelected(ent.id);
  rig([face(6, 6), face(2, 6)]);        // 6 -> 2 HD, 2 -> 1 HD  => 3 HD off 4
  T.doRoll('2d6', 'Dice Roller');
  T.applyDamageToSelected();
  assert.equal(T.state.combat.entries[0].hd, '1');
});

test('applyDamageToSelected: SH hit on a 0-HD monster that still has HP drops HP to 0', () => {
  T.state.settings.scarletHeroes = true;
  T.addMonsterEntry({ name: 'Husk', hd: '0', hp: 6, ac: { asc: 10 }, attacks: [], abilities: [] });
  const ent = T.state.combat.entries[0];
  T.setSelected(ent.id);
  rig(face(5, 6));
  T.doRoll('1d6', 'Dice Roller');
  T.applyDamageToSelected();
  assert.equal(T.entryHp(T.state.combat.entries[0]), 0);
});

/* ================================================================== */
/* Monster browser: filtering, the fields form, and the PL generator  */
/* ================================================================== */

test('filterMonsters: name substring + HD min/max, sorted by HD then name', () => {
  const list = [
    { name: 'Rat', hd: '1', hdNum: 1 },
    { name: 'Bear', hd: '5', hdNum: 5 },
    { name: 'Goblin', hd: '1', hdNum: 1 },
  ];
  assert.deepEqual(T.filterMonsters(list, { q: 'go' }).map(m => m.name), ['Goblin']);
  assert.deepEqual(T.filterMonsters(list, { hdMin: 1, hdMax: 1 }).map(m => m.name).sort(), ['Goblin', 'Rat']);
  // HD ascending, then name — Goblin/Rat tie at HD 1 so sort alphabetically.
  assert.deepEqual(T.filterMonsters(list, {}).map(m => m.name), ['Goblin', 'Rat', 'Bear']);
});

test('monster-form: populate -> collect round-trips a Shadowdark def', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.innerHTML = T.monsterFormHtml();
  T.wireMonsterForm(host);
  const def = {
    name: 'Test Ooze', source: 'shadowdark', desc: 'A blob.', raw: 'ignored on populate',
    ac: { asc: 12, desc: null, thac0: null }, hd: '3', hp: 15,
    move: 'near', align: 'N', xp: 50, moraleML: null,
    atkBonus: 2, attacksText: 'ignored on populate',
    attacks: [{ label: 'slam', count: 1, toHit: 2, damage: '1d6', note: '', raw: '' }],
    stats: { S: 1, D: 0, C: 2, I: -3, W: 0, Ch: -2 }, saveTargets: null, savesText: '',
    abilities: [{ name: 'Split', text: 'Splits in two when damaged.' }]
  };
  T.populateMonsterForm(host, def);
  const collected = T.collectMonsterForm(host);
  assert.equal(collected.name, 'Test Ooze');
  assert.equal(collected.source, 'shadowdark');
  assert.equal(collected.hd, '3');
  assert.equal(collected.hp, 15);
  assert.equal(collected.ac.asc, 12);
  assert.equal(collected.atkBonus, 2);
  assert.deepEqual(collected.stats, { S: 1, D: 0, C: 2, I: -3, W: 0, Ch: -2 });
  assert.equal(collected.savesText, 'S +1  D +0  C +2  I -3  W +0  Ch -2');
  // attacksText/attacks are *derived* from the attack row, not read back from
  // the input def's own (here deliberately wrong) attacksText.
  assert.equal(collected.attacksText, 'slam +2 (1d6)');
  assert.deepEqual(collected.attacks, [{ label: 'slam', count: 1, toHit: 2, damage: '1d6', note: '', raw: '' }]);
  assert.deepEqual(collected.abilities, [{ name: 'Split', text: 'Splits in two when damaged.' }]);
  host.remove();
});

test('monster-form: OSE schema derives ascending AC from descending, and savesText from save targets', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.innerHTML = T.monsterFormHtml();
  T.wireMonsterForm(host);
  T.populateMonsterForm(host, { name: 'Test Ghoul', source: 'ose' });
  host.querySelector('.mf-f-ac-desc').value = '4';
  host.querySelector('.mf-f-thac0').value = '16';
  host.querySelector('.mf-f-sv-D').value = '10';
  host.querySelector('.mf-f-sv-W').value = '11';
  host.querySelector('.mf-f-sv-P').value = '12';
  host.querySelector('.mf-f-sv-B').value = '13';
  host.querySelector('.mf-f-sv-S').value = '14';
  const collected = T.collectMonsterForm(host);
  assert.equal(collected.source, 'ose');
  assert.equal(collected.ac.desc, 4);
  assert.equal(collected.ac.asc, 15); // 19 - descending AC, matching the parser's own convention
  assert.equal(collected.ac.thac0, 16);
  assert.deepEqual(collected.saveTargets, { D: 10, W: 11, P: 12, B: 13, S: 14 });
  assert.equal(collected.savesText, 'D10 W11 P12 B13 S14');
  host.remove();
});

test('generateMonster: deterministic given a rigged RNG (PL table roll -> LV/AC/HP/attacks/abilities)', () => {
  // d20 -> 7 (row index 6: Insectoid, offset 0); PL 1 -> LV 1 -> one HP die;
  // then the attack-count d4.
  rig([face(7, 20), face(3, 8), face(2, 4)]);
  const def = T.generateMonster(1, 0);
  assert.equal(def.name, 'PL 1 Insectoid Creature');
  assert.equal(def.source, 'shadowdark');
  assert.deepEqual(def.ac, { asc: 11, desc: null, thac0: null });
  assert.equal(def.hd, '1');
  assert.equal(def.hdNum, 1);
  assert.equal(def.hp, 3);
  assert.equal(def.atkBonus, 1);
  assert.equal(def.attacksText, '2 attack +1 (1d8)');
  assert.deepEqual(def.attacks, [{ label: 'attack', count: 2, toHit: 1, damage: '1d8', note: '', raw: '' }]);
  assert.deepEqual(def.abilities, [{ name: 'Strength', text: 'Eats metal' }, { name: 'Weakness', text: 'Electricity' }]);
});

test('generateMonster: LV floors at 0 (min 1 HP); the Nth mutation rolls the Nth "Monster Mutations" column', () => {
  // d20 -> 1 (row index 0: Beastlike, offset -3); PL 3 -> LV 0 -> zero HP
  // dice rolled (floors to 1 HP); then the attack-count d4; then two
  // mutation d12s, one per requested mutation.
  rig([face(1, 20), face(4, 4), face(1, 12), face(12, 12)]);
  const def = T.generateMonster(3, 2);
  assert.equal(def.hd, '0');
  assert.equal(def.hp, 1);
  const mutations = def.abilities.filter(a => a.name === 'Mutation').map(a => a.text);
  assert.deepEqual(mutations, ['Shapechanger', 'Acidic saliva']);
});

/* ================================================================== */
/* Character CRUD                                                     */
/* ================================================================== */

test('createCharacter: detects name/system, adds an HP tracker, becomes active', () => {
  T.createCharacter('# Kagra the Bold [WWN]\nA warrior.');
  const ch = T.activeChar();
  assert.equal(ch.name, 'Kagra the Bold');
  assert.equal(ch.system, 'WWN');
  assert.equal(T.state.activeId, ch.id);
  assert.ok(T.state.consumables.some(c => c.name === 'HP (Kagra the Bold)'));
});

test('deleteChar: removes the character and its HP tracker', () => {
  T.createCharacter('# Solo\nHP 4/4');
  const id = T.state.activeId;
  T.deleteChar();                       // window.confirm stubbed true
  assert.equal(T.state.characters.some(c => c.id === id), false);
  assert.equal(T.state.consumables.some(c => c.name === 'HP (Solo)'), false);
});

/* ================================================================== */
/* Import                                                             */
/* ================================================================== */

test('importData: merge (Cancel) adds characters, monsters and compendium entries', async () => {
  window.confirm = () => false;         // Cancel => merge
  T.createCharacter('# Keeper\nHP 5/5');
  const payload = JSON.stringify({
    characters: [{ id: 'x', name: 'Newcomer', body: '# Newcomer\nHP 3/3' }],
    monsters: [{ name: 'Slime', hd: '1', hp: 4, ac: { asc: 10 }, attacks: [], abilities: [] }],
    compendium: [{ name: 'Mystery Tonic', category: 'Items', source: 'Homebrew', body: 'Glows.' }],
  });
  T.importData(new window.File([payload], 'party.json', { type: 'application/json' }));
  await new Promise(r => setTimeout(r, 30));
  assert.ok(T.state.characters.some(c => c.name === 'Keeper'), 'existing character kept');
  assert.ok(T.state.characters.some(c => c.name === 'Newcomer'));
  assert.ok(T.state.monsters.some(m => m.name === 'Slime'));
  assert.ok(T.state.compendium.some(e => e.name === 'Mystery Tonic'));
});

test('importData: replace (OK) swaps the whole state', async () => {
  window.confirm = () => true;          // OK => replace
  T.createCharacter('# Old\nHP 5/5');
  const payload = JSON.stringify({ characters: [{ id: 'x', name: 'Only', body: '# Only' }] });
  T.importData(new window.File([payload], 'p.json', { type: 'application/json' }));
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(T.state.characters.map(c => c.name), ['Only']);
});

/* ================================================================== */
/* logToText                                                          */
/* ================================================================== */

test('logToText: renders rolls with "= total" and notes without', () => {
  rig(face(10, 20));
  T.doRoll('1d20', 'Dice Roller');
  const [a] = threeCombatants();
  T.toggleStatus(a, 'Prone');
  const lines = T.logToText().split('\n');
  assert.ok(lines.some(l => /Dice Roller/.test(l) && /= 10/.test(l)));
  assert.ok(lines.some(l => /gained "Prone"/.test(l) && !/=/.test(l)));
});
