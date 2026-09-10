'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseUAStatblock, computeAbilityPair, computeAllAbilities, METER_ORDER,
  METER_RELATIONSHIP, normalizeRole, setShockValue
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
