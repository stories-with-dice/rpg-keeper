'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseUAStatblock, computeAbilityPair, computeAllAbilities, METER_ORDER,
  METER_RELATIONSHIP, normalizeRole, setShockValue,
  parseUAMonster, uaMonsterDef, abilityValues, woundState, initiativeOf, damageOptions, computeSubstitutions
} = require('../js/ua-statblock.js');

// Kevin Johnson, from the UA3e "Karmic Ties and Fifth Wheels" starter kit —
// used here as a regression anchor for the ability formula (p.30: upbeat =
// 65 − 5×hardened, downbeat = 15 + 5×hardened).
const KEVIN = `
Identities
Civil War Re-Enactor 65%* — Provides Initiative, Substitutes for Dodge, Substitutes for Fitness
Father 35% — Coerces Connect, Evaluates Helplessness, Substitutes for Secrecy
School Custodian 20% — Evaluates Isolation, Substitutes for Knowledge, Substitutes for Notice

Passions
Fear (Isolation): Dying alone and unloved.
Noble: Reconciliation with his ex-wife.
Rage: Bullies of any kind, especially family members.

Relationships
Responsibility: Rachel 45%
Favorite: __ %

Wound Threshold: 50

Shock
Helplessness: 1 hardened / 1 failed
Isolation: 3 hardened / 2 failed
Self: 2 hardened / 0 failed
Unnatural: 1 hardened / 2 failed
Violence: 2 hardened / 3 failed
`;

test('computeAbilityPair matches the p.30 formula', () => {
  assert.deepEqual(computeAbilityPair(0), { upbeat: 65, downbeat: 15 });
  assert.deepEqual(computeAbilityPair(1), { upbeat: 60, downbeat: 20 });
  assert.deepEqual(computeAbilityPair(3), { upbeat: 50, downbeat: 30 });
  assert.deepEqual(computeAbilityPair(9), { upbeat: 20, downbeat: 60 });
  // out-of-range input is clamped rather than producing nonsense
  assert.deepEqual(computeAbilityPair(-3), { upbeat: 65, downbeat: 15 });
  assert.deepEqual(computeAbilityPair(20), { upbeat: 20, downbeat: 60 });
});

test('parseUAStatblock: Kevin Johnson — computed abilities match the sourcebook sheet exactly', () => {
  const def = parseUAStatblock(KEVIN);
  assert.equal(def.abilities.Helplessness.upbeatName, 'Fitness');
  assert.equal(def.abilities.Helplessness.upbeatPct, 60);
  assert.equal(def.abilities.Helplessness.downbeatName, 'Dodge');
  assert.equal(def.abilities.Helplessness.downbeatPct, 20);

  assert.equal(def.abilities.Isolation.upbeatPct, 50);  // Status
  assert.equal(def.abilities.Isolation.downbeatPct, 30); // Pursuit

  assert.equal(def.abilities.Self.upbeatPct, 55);   // Knowledge
  assert.equal(def.abilities.Self.downbeatPct, 25);  // Lie

  assert.equal(def.abilities.Unnatural.upbeatPct, 60); // Notice
  assert.equal(def.abilities.Unnatural.downbeatPct, 20); // Secrecy

  assert.equal(def.abilities.Violence.upbeatPct, 55); // Connect
  assert.equal(def.abilities.Violence.downbeatPct, 25); // Struggle
});

test('parseUAStatblock: identities', () => {
  const def = parseUAStatblock(KEVIN);
  assert.equal(def.identities.length, 3);
  const re = def.identities[0];
  assert.equal(re.name, 'Civil War Re-Enactor');
  assert.equal(re.pct, 65);
  assert.equal(re.obsession, true);
  assert.match(re.features, /Provides Initiative/);
  assert.equal(def.identities[1].obsession, false);
});

test('parseUAStatblock: passions', () => {
  const def = parseUAStatblock(KEVIN);
  assert.equal(def.passions.fear.meter, 'Isolation');
  assert.match(def.passions.fear.text, /Dying alone/);
  assert.match(def.passions.noble.text, /Reconciliation/);
  assert.match(def.passions.rage.text, /Bullies/);
});

test('parseUAStatblock: relationships — filled and blank placeholder', () => {
  const def = parseUAStatblock(KEVIN);
  const resp = def.relationships.find(r => r.role === 'Responsibility');
  assert.equal(resp.name, 'Rachel');
  assert.equal(resp.pct, 45);
  const fav = def.relationships.find(r => r.role === 'Favorite');
  assert.equal(fav.name, '');
  assert.equal(fav.pct, null);
});

test('parseUAStatblock: wound threshold', () => {
  assert.equal(parseUAStatblock(KEVIN).woundThreshold, 50);
  assert.equal(parseUAStatblock('').woundThreshold, null);
});

test('parseUAStatblock: shock meters, alternate separators', () => {
  const def = parseUAStatblock('Shock\nViolence: 2 hardened, 3 failed\nSelf 4/1');
  assert.deepEqual(def.shock.Violence, { hardened: 2, failed: 3 });
  // "Self 4/1" has no colon and no section keyword before it while already
  // inside the Shock section — still parses since the meter-name match only
  // requires the line to start with a known meter name.
  assert.deepEqual(def.shock.Self, { hardened: 4, failed: 1 });
});

test('parseUAStatblock: missing meters default to 0/0 in computed abilities, all 5 meters always present', () => {
  const def = parseUAStatblock('Shock\nViolence: 2 hardened / 0 failed');
  assert.deepEqual(METER_ORDER, Object.keys(def.abilities));
  assert.equal(def.abilities.Self.hardened, 0);
  assert.equal(def.abilities.Self.upbeatPct, 65);
});

test('parseUAStatblock: malformed/empty input never throws', () => {
  assert.doesNotThrow(() => parseUAStatblock(''));
  assert.doesNotThrow(() => parseUAStatblock(null));
  assert.doesNotThrow(() => parseUAStatblock('garbage\nnot a statblock at all'));
  const def = parseUAStatblock('garbage\nnot a statblock at all');
  assert.equal(def.identities.length, 0);
  assert.equal(def.woundThreshold, null);
});

test('computeAllAbilities is keyed by all 5 canonical meters in order', () => {
  const abilities = computeAllAbilities({});
  assert.deepEqual(Object.keys(abilities), METER_ORDER);
});

test('METER_RELATIONSHIP: p.41\'s meter <-> relationship linkage, one entry per meter', () => {
  assert.deepEqual(METER_RELATIONSHIP, {
    Helplessness: 'Protégé', Isolation: 'Favorite', Self: 'Responsibility',
    Unnatural: 'Guru', Violence: 'Mentor'
  });
  assert.deepEqual(Object.keys(METER_RELATIONSHIP), METER_ORDER);
});

test('normalizeRole: case/diacritic-insensitive so "Protege" matches "Protégé"', () => {
  assert.equal(normalizeRole('Protégé'), normalizeRole('Protege'));
  assert.equal(normalizeRole(' Favorite '), 'favorite');
});

test('setShockValue: rewrites just the target number, preserving the rest of the line', () => {
  const inner = 'Shock\nHelplessness: 1 hardened / 1 failed\nIsolation: 3 hardened / 2 failed';
  assert.equal(
    setShockValue(inner, 'Helplessness', 'hardened', 5),
    'Shock\nHelplessness: 5 hardened / 1 failed\nIsolation: 3 hardened / 2 failed'
  );
  assert.equal(
    setShockValue(inner, 'Helplessness', 'failed', 3),
    'Shock\nHelplessness: 1 hardened / 3 failed\nIsolation: 3 hardened / 2 failed'
  );
  // Isolation is untouched by a Helplessness edit
  assert.match(setShockValue(inner, 'Helplessness', 'hardened', 9), /Isolation: 3 hardened \/ 2 failed/);
});

test('setShockValue: clamps to 0-9 (hardened) / 0-5 (failed)', () => {
  const inner = 'Shock\nSelf: 2 hardened / 0 failed';
  assert.match(setShockValue(inner, 'Self', 'hardened', 99), /Self: 9 hardened/);
  assert.match(setShockValue(inner, 'Self', 'hardened', -5), /Self: 0 hardened/);
  assert.match(setShockValue(inner, 'Self', 'failed', 99), /\/ 5 failed/);
  assert.match(setShockValue(inner, 'Self', 'failed', -5), /\/ 0 failed/);
});

test('setShockValue: a meter with no existing Shock line gets one appended; a missing Shock section gets created', () => {
  const withSection = setShockValue('Shock\nViolence: 2 hardened / 0 failed', 'Self', 'hardened', 2);
  assert.match(withSection, /Self: 2 hardened \/ 0 failed/);
  assert.match(withSection, /Violence: 2 hardened \/ 0 failed/); // untouched
  const def = parseUAStatblock(withSection);
  assert.deepEqual(def.shock.Self, { hardened: 2, failed: 0 });

  const noSection = setShockValue('Identities\nFather 35% — Coerces Connect', 'Self', 'hardened', 2);
  assert.match(noSection, /Shock\nSelf: 2 hardened \/ 0 failed/);
  const def2 = parseUAStatblock(noSection);
  assert.deepEqual(def2.shock.Self, { hardened: 2, failed: 0 });
  assert.equal(def2.identities.length, 1); // Identities section survives untouched
});

/* ---- Bestiary GMCs (an invented one: the repo holds no book text) ---- */

const CLERK = `
Night Clerk
Sees everything, says nothing
Type: GMC
Book: Homebrew, p. 1
Wound Threshold: 45
Obsession: Knowing who checks in.

Identities
Night Clerk 55%* — Substitutes for Notice, Provides Initiative
Lucky Guess 3d10+20% — Specific Information
Old Hand 20-80%

Abilities
Struggle 70% — Keeps a bat under the desk

Passions
Fear (Isolation): Being forgotten.
Noble: Nobody gets hurt on the night shift.

Shock
Violence: 2 hardened / 1 failed
Unnatural: 4 hardened
`;

test('parseUAStatblock: an identity rating can be a range or dice (pct null, value kept); features are optional', () => {
  const def = parseUAStatblock(CLERK);
  assert.deepEqual(def.identities.map(i => [i.name, i.pct, i.value, i.obsession, i.features]), [
    ['Night Clerk', 55, '55', true, 'Substitutes for Notice, Provides Initiative'],
    ['Lucky Guess', null, '3d10+20', false, 'Specific Information'],
    ['Old Hand', null, '20-80', false, '']
  ]);
});

test('parseUAStatblock: an Abilities section, an Obsession line, and a Shock line with only hardened notches', () => {
  const def = parseUAStatblock(CLERK);
  assert.deepEqual(def.abilityOverrides, { Struggle: { pct: 70, obsession: false, note: 'Keeps a bat under the desk' } });
  assert.equal(def.obsession, 'Knowing who checks in.');
  assert.deepEqual(def.shock.Violence, { hardened: 2, failed: 1 });
  assert.deepEqual(def.shock.Unnatural, { hardened: 4, failed: 0 });
});

test('parseUAMonster: header lines give name, description, type, book; a text wound threshold is kept as text', () => {
  const m = parseUAMonster(CLERK);
  assert.equal(m.name, 'Night Clerk');
  assert.equal(m.desc, 'Sees everything, says nothing');
  assert.equal(m.type, 'GMC');
  assert.equal(m.book, 'Homebrew, p. 1');
  assert.equal(m.woundThreshold, 45);
  assert.equal(m.woundThresholdText, '');
  assert.equal(m.hasShock, true);
  const ghost = parseUAMonster('Echo\nWound Threshold: Equal to its host\n\nIdentities\nMimic 2d10+40% — Substitutes for Lie');
  assert.equal(ghost.woundThreshold, null);
  assert.equal(ghost.woundThresholdText, 'Equal to its host');
  assert.equal(ghost.hasShock, false);
});

test('uaMonsterDef: a Bestiary def with the text as raw, or null without a name', () => {
  const d = uaMonsterDef(CLERK);
  assert.equal(d.name, 'Night Clerk');
  assert.equal(d.source, 'ua3e');
  assert.equal(d.raw, CLERK.trim());
  assert.equal(d.hd, '');
  assert.equal(uaMonsterDef('\n\nIdentities\nX 50%'), null);
});

test('abilityValues: the book value wins over a substitution, which wins over the shock gauge', () => {
  const v = abilityValues(parseUAMonster(CLERK));
  assert.deepEqual(v.Struggle, { value: '70', from: 'book' });
  assert.deepEqual(v.Notice, { value: '55', from: 'identity', identityName: 'Night Clerk' });
  assert.deepEqual(v.Connect, { value: '55', from: 'shock' }, 'Violence 2 hardened → Connect 65 − 10');
  // Without a Shock section the gauge gives nothing: only what the book says.
  const ghost = abilityValues(parseUAMonster('Echo\n\nIdentities\nMimic 2d10+40% — Substitutes for Lie'));
  assert.deepEqual(Object.keys(ghost), ['Lie']);
  assert.equal(ghost.Lie.value, '2d10+40');
});

test('computeSubstitutions: a dice-rated identity substitutes with its value text', () => {
  const subs = computeSubstitutions([{ name: 'Mimic', pct: null, value: '2d10+40', features: 'Substitutes for Lie' }]);
  assert.deepEqual(subs.Lie, { pct: null, value: '2d10+40', identityName: 'Mimic', obsession: false });
});

test('woundState: p.63 bands at ½, ¾, 90% and 100% of the wound threshold', () => {
  const at = w => woundState(w, 50).key;
  assert.equal(at(0), 'ok');
  assert.equal(woundState(0, 50).label, 'Unhurt');
  assert.equal(woundState(24, 50).label, 'Wounded');
  assert.equal(at(25), 'hurt');
  assert.equal(at(37), 'hurt');
  assert.equal(at(38), 'badly-hurt', '¾ of 50 is 37.5: 38 or more (the book: "38 or more for most people")');
  assert.equal(at(45), 'unconscious');
  assert.equal(at(50), 'dead');
  assert.equal(woundState(80, 0).key, 'ok', 'no threshold, no band');
});

test('initiativeOf: the identity with Provides Initiative, or null', () => {
  assert.equal(initiativeOf(parseUAMonster(CLERK).identities).name, 'Night Clerk');
  assert.equal(initiativeOf([{ name: 'Cook', pct: 40, features: 'Substitutes for Status' }]), null);
});

test('damageOptions: sum of the dice for fists, +3/+6/+9 for weapons, the roll itself for a gun', () => {
  assert.deepEqual(damageOptions(34).map(o => o.wounds), [7, 10, 13, 16, 34]);
  assert.deepEqual(damageOptions(100).map(o => o.wounds), [0, 3, 6, 9, 100], '"00": both dice are 0');
  assert.equal(damageOptions(5)[0].wounds, 5);
});
