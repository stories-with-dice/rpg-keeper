'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseOne, parseMonsters, hdNum } = require('../js/monsters.js');

/* ------------------------------------------------------------------ */
/* Raw stat blocks — kept with their original mid-sentence line wraps */
/* so the tests exercise the parser's line-joining.                   */
/* ------------------------------------------------------------------ */

const BEAR_POLAR = `BEAR, POLAR
A mighty, white bear that
thrives in arctic environments.
AC 13, HP 34, ATK 2 claw +6 (2d6),
MV near (climb), S +4, D +1, C +3, I
-2, W +1, Ch -2, AL N, LV 7
Crush. Deals an extra die of
damage if it hits the same target
with both claws.
Thick Fur. Cold immune.`;

const COUATL = `COUATL
A human-sized snake with
scales made of jewels and a
corona of iridescent feathers.
AC 16, HP 42, ATK 3 bite +6 (2d6 +
poison), MV near (fly), S +2, D +3,
C +2, I +4, W +4, Ch +5, AL L, LV 9
Change Shape. In place of
attacks, transform into any
similarly-sized creature.
Poison. DC 15 CON or fall into
natural, deep sleep for 1d8 hours.
Restore. In place of attacks,
touch one creature to remove a
curse, affliction, or heal 3d8 HP.`;

// The one the parser originally choked on: "(leather)" note on AC, an "or"
// between two attacks, and abilities titled "Name (CHA Spell). ...".
const KOBOLD_SORCERER = `KOBOLD, SORCERER
A scaly dog-lizard painted with
colorful stripes and rattling
a hefty leg bone strung with
beads and feathers.
AC 13 (leather), HP 13, ATK 1 club
+1 (1d4) or 1 spell +2, MV near, S
-2, D +2, C +0, I -1, W +1, Ch +2, AL
C, LV 3
Dodge. 1/day, an attack that
would hit misses instead.
Scorpion Sting (CHA Spell). DC
11. Near range, one target. 1d6
damage and target has DISADV
on next attack roll or check.
Spider Swarm (CHA Spell).
DC 12. A spider swarm appears
within near. Stays 1d4 rounds.
Follows sorcerer's commands.`;

const BROWNIE = `Brownie
1½′ tall humanoids, related to pixies and
halflings. They are shy, but friendly with
other Lawful creatures. Dwell in peaceful
meadows.
AC 3 [16] Hd ½ (2hp) Att Knife (1d3)
THAC0 19 [0] Mv 120′ (40′) sv D6 W7 P9
B11 S9 (Cleric 9) ML 7 AL Lawful XP 5 nA
3d6 (5d8) TT S
▶ Surprise: Never surprised.
▶ Dimension door: Once per day, can
teleport to a known location within 360′.
▶ Ventriloquism: Can cause their voice
to emanate from anywhere within 60′
(e.g. a statue, a tapestry, an animal).
▶ Dancing lights: Can conjure bobbing
lights within 60′.`;

const BULETTE = `Bulette
15′ long, hard-shelled reptiles with huge
maws, tiny eyes, and a shark-like crest
upon the back. Have a ravenous appetite
for the flesh of horses and humanoids
(except elves). Love to dig halflings and
gnomes out of their burrows.
AC 0 [19] Hd 9* (40hp) Att Bite (4d12) + 2
× claw (3d6) THAC0 12 [+7] Mv 150′ (50′)
/ 30′ (10′) burrowing sv D8 W9 P10 B10 S12
(9) ML 11 AL Neutral XP 1,600 nA 0 (1d2)
TT None
▶ Ravenous: Will attack anything living.
▶ Leap: If cornered, can leap forward
20′, attacking with all 4 claws.
▶ Armour plates: Neck plates can be
fashioned into magical shields.
▶ Origin: Rumoured to be the result of
a wizard’s experiments in cross-breeding
turtles, armadillos, and demons.`;

const names = defs => defs.map(d => d.name);
const abilityNames = d => d.abilities.map(a => a.name);

/* ------------------------------------------------------------------ */
/* Per-monster expectations                                           */
/* ------------------------------------------------------------------ */

test('Shadowdark: BEAR, POLAR', () => {
  const d = parseOne(BEAR_POLAR);
  assert.equal(d.name, 'BEAR, POLAR');
  assert.equal(d.source, 'shadowdark');
  assert.deepEqual(d.ac, { asc: 13, desc: null, thac0: null });
  assert.equal(d.hd, '7');
  assert.equal(d.hdNum, 7);
  assert.equal(d.hp, 34);
  assert.equal(d.move, 'near (climb)');
  assert.equal(d.align, 'N');
  assert.equal(d.moraleML, null);
  assert.equal(d.atkBonus, 6);
  assert.equal(d.attacksText, '2 claw +6 (2d6)');
  assert.deepEqual(d.attacks, [
    { label: 'claw', count: 2, toHit: 6, damage: '2d6', note: '', raw: '2 claw +6 (2d6)' }
  ]);
  assert.deepEqual(d.stats, { S: 4, D: 1, C: 3, I: -2, W: 1, Ch: -2 });
  assert.equal(d.saveTargets, null);
  assert.deepEqual(abilityNames(d), ['Crush', 'Thick Fur']);
});

test('Shadowdark: COUATL (poison note on damage, 3 abilities)', () => {
  const d = parseOne(COUATL);
  assert.equal(d.source, 'shadowdark');
  assert.deepEqual(d.ac, { asc: 16, desc: null, thac0: null });
  assert.equal(d.hd, '9');
  assert.equal(d.hp, 42);
  assert.equal(d.move, 'near (fly)');
  assert.equal(d.align, 'L');
  assert.deepEqual(d.attacks, [
    { label: 'bite', count: 3, toHit: 6, damage: '2d6', note: 'poison', raw: '3 bite +6 (2d6 + poison)' }
  ]);
  assert.deepEqual(d.stats, { S: 2, D: 3, C: 2, I: 4, W: 4, Ch: 5 });
  assert.deepEqual(abilityNames(d), ['Change Shape', 'Poison', 'Restore']);
});

test('Shadowdark: KOBOLD, SORCERER — "(leather)" AC, "or" between attacks, "(CHA Spell)" ability titles', () => {
  const d = parseOne(KOBOLD_SORCERER);
  assert.equal(d.name, 'KOBOLD, SORCERER');
  assert.equal(d.source, 'shadowdark');
  assert.deepEqual(d.ac, { asc: 13, desc: null, thac0: null }); // "(leather)" ignored
  assert.equal(d.hd, '3');
  assert.equal(d.hdNum, 3);
  assert.equal(d.hp, 13);
  assert.equal(d.move, 'near');
  assert.equal(d.align, 'C');
  assert.equal(d.attacksText, '1 club +1 (1d4) or 1 spell +2');
  assert.deepEqual(d.attacks, [
    { label: 'club', count: 1, toHit: 1, damage: '1d4', note: '', raw: '1 club +1 (1d4)' },
    { label: 'spell', count: 1, toHit: 2, damage: '', note: '', raw: '1 spell +2' }
  ]);
  assert.deepEqual(d.stats, { S: -2, D: 2, C: 0, I: -1, W: 1, Ch: 2 });
  assert.deepEqual(abilityNames(d), ['Dodge', 'Scorpion Sting (CHA Spell)', 'Spider Swarm (CHA Spell)']);
  assert.match(d.abilities[1].text, /^DC 11\. Near range/);
  assert.match(d.abilities[2].text, /Follows sorcerer's commands\.$/);
});

test('OSE: Brownie (½ HD, descending + ascending AC, save categories)', () => {
  const d = parseOne(BROWNIE);
  assert.equal(d.source, 'ose');
  assert.deepEqual(d.ac, { asc: 16, desc: 3, thac0: 19 });
  assert.equal(d.hd, '½');
  assert.equal(d.hdNum, 0.5);
  assert.equal(d.hp, 2);
  assert.equal(d.move, '120′ (40′)');
  assert.equal(d.align, 'Lawful');
  assert.equal(d.xp, 5);
  assert.equal(d.moraleML, 7);
  assert.equal(d.atkBonus, 0);
  assert.deepEqual(d.attacks, [
    { label: 'Knife', count: 1, toHit: 0, damage: '1d3', note: '', raw: 'Knife (1d3)' }
  ]);
  assert.deepEqual(d.saveTargets, { D: 6, W: 7, P: 9, B: 11, S: 9 });
  assert.equal(d.savesText, 'D6 W7 P9 B11 S9');
  assert.equal(d.stats, null);
  assert.deepEqual(abilityNames(d), ['Surprise', 'Dimension door', 'Ventriloquism', 'Dancing lights']);
});

test('OSE: Bulette (9* HD, THAC0 [+7] bonus, multi-attack "+")', () => {
  const d = parseOne(BULETTE);
  assert.equal(d.source, 'ose');
  assert.deepEqual(d.ac, { asc: 19, desc: 0, thac0: 12 });
  assert.equal(d.hd, '9*');
  assert.equal(d.hdNum, 9);
  assert.equal(d.hp, 40);
  assert.equal(d.move, '150′ (50′) / 30′ (10′) burrowing');
  assert.equal(d.align, 'Neutral');
  assert.equal(d.xp, 1600);
  assert.equal(d.moraleML, 11);
  assert.equal(d.atkBonus, 7);
  assert.deepEqual(d.attacks, [
    { label: 'Bite', count: 1, toHit: 7, damage: '4d12', note: '', raw: 'Bite (4d12)' },
    { label: 'claw', count: 2, toHit: 7, damage: '3d6', note: '', raw: '2 × claw (3d6)' }
  ]);
  assert.deepEqual(d.saveTargets, { D: 8, W: 9, P: 10, B: 10, S: 12 });
  assert.deepEqual(abilityNames(d), ['Ravenous', 'Leap', 'Armour plates', 'Origin']);
});

/* ------------------------------------------------------------------ */
/* Multi-monster parsing                                              */
/* ------------------------------------------------------------------ */

test('parseMonsters: Shadowdark sample, blank line between monsters', () => {
  const defs = parseMonsters(BEAR_POLAR + '\n\n' + COUATL + '\n\n' + KOBOLD_SORCERER);
  assert.deepEqual(names(defs), ['BEAR, POLAR', 'COUATL', 'KOBOLD, SORCERER']);
});

test('parseMonsters: OSE sample with NO blank line between monsters', () => {
  const defs = parseMonsters(BROWNIE + '\n' + BULETTE);
  assert.deepEqual(names(defs), ['Brownie', 'Bulette']);
  // The second monster must own its own text, not inherit Brownie's.
  assert.equal(defs[1].hd, '9*');
  assert.equal(defs[1].hp, 40);
  assert.deepEqual(abilityNames(defs[1]), ['Ravenous', 'Leap', 'Armour plates', 'Origin']);
  assert.ok(!/Dancing lights/.test(defs[1].raw));
});

test('parseMonsters: mixed Shadowdark + OSE, mixed separators', () => {
  const defs = parseMonsters(
    BEAR_POLAR + '\n\n' + COUATL + '\n\n' + KOBOLD_SORCERER + '\n\n' + BROWNIE + '\n' + BULETTE
  );
  assert.deepEqual(names(defs), ['BEAR, POLAR', 'COUATL', 'KOBOLD, SORCERER', 'Brownie', 'Bulette']);
  assert.deepEqual(defs.map(d => d.source), ['shadowdark', 'shadowdark', 'shadowdark', 'ose', 'ose']);
});

/* ------------------------------------------------------------------ */
/* hdNum                                                              */
/* ------------------------------------------------------------------ */

test('hdNum: fractions, asterisks, blanks', () => {
  assert.equal(hdNum('½'), 0.5);
  assert.equal(hdNum('1/2'), 0.5);
  assert.equal(hdNum('9*'), 9);
  assert.equal(hdNum('7'), 7);
  assert.equal(hdNum(''), 0);
  assert.equal(hdNum(null), 0);
});

/* ------------------------------------------------------------------ */
/* Attack parsing edge cases (Shadowdark bestiary shapes)            */
/* ------------------------------------------------------------------ */

const sdBlock = (name, atk) =>
  `${name}\nflavor\nAC 12, HP 10, ATK ${atk}, MV near, S +0, D +0, C +0, I +0, W +0, Ch +0, AL N, LV 3`;

test('parseAttacks: range parens like "(near)" are skipped for damage', () => {
  const d = parseOne(sdBlock('Aboleth', '2 tentacle (near) +5 (1d8 + curse) or 1 tail +5 (3d6)'));
  assert.deepEqual(d.attacks, [
    { label: 'tentacle', count: 2, toHit: 5, damage: '1d8', note: 'curse', raw: '2 tentacle (near) +5 (1d8 + curse)' },
    { label: 'tail', count: 1, toHit: 5, damage: '3d6', note: '', raw: '1 tail +5 (3d6)' }
  ]);
});

test('parseAttacks: " and " separates attacks', () => {
  const d = parseOne(sdBlock('Cave Brute', '2 claw +5 (1d8) and 1 mandible +5 (1d10)'));
  assert.deepEqual(d.attacks.map(a => [a.label, a.count, a.toHit, a.damage]), [
    ['claw', 2, 5, '1d8'],
    ['mandible', 1, 5, '1d10']
  ]);
});

test('parseAttacks: "close/near" range + flat "(1d6 + 1)" damage', () => {
  const d = parseOne(sdBlock('Beastman', '1 spear (close/near) +2 (1d6 + 1)'));
  assert.deepEqual(d.attacks, [
    { label: 'spear', count: 1, toHit: 2, damage: '1d6+1', note: '', raw: '1 spear (close/near) +2 (1d6 + 1)' }
  ]);
});

test('parseAttacks: spaced to-hit sign "bite + 9" normalizes; not confused with " + " separator', () => {
  const d = parseOne(sdBlock('Obe', '4 greatsword (near) +11 (1d12 + 2) and 1 bite + 9 (1d8 + drain)'));
  assert.equal(d.attacks.length, 2);
  assert.deepEqual(d.attacks.map(a => [a.label, a.count, a.toHit, a.damage]), [
    ['greatsword', 4, 11, '1d12+2'],
    ['bite', 1, 9, '1d8']
  ]);
});

/* ------------------------------------------------------------------ */
/* Bestiary converter                                                 */
/* ------------------------------------------------------------------ */

const path = require('node:path');
const fs = require('node:fs');
const { convert, titleCase, slug } = require('../scripts/convert-bestiary.js');

test('convert-bestiary: titleCase / slug', () => {
  assert.equal(titleCase('BEAR, POLAR'), 'Bear, Polar');
  assert.equal(titleCase('KOBOLD, SORCERER'), 'Kobold, Sorcerer');
  assert.equal(titleCase('obe-ixx of azarumme'), 'Obe-Ixx of Azarumme');
  assert.equal(slug('Angel, Domini'), 'angel-domini');
});

test('convert-bestiary: converts a full bestiary entry into the internal def shape', () => {
  const entry = {
    name: 'ABOLETH',
    description: 'Enormous, antediluvian catfish.',
    level: 8, alignment: 'Chaotic', ac: 16, armor_type: '', hp: 39,
    movement: 'near (swim)',
    attack: '2 tentacle (near) +5 (1d8 + curse) or 1 tail +5 (3d6)',
    stats: { str: '+4', dex: '-1', con: '+3', int: '+4', wis: '+2', cha: '+2' },
    actions: [{ name: 'Curse', description: 'DC 15 CON or gain a curse.' }],
    source: 'Core'
  };
  const d = convert(entry);
  assert.equal(d.name, 'Aboleth');            // Title Case, not ALL CAPS
  assert.equal(d.id, 'sd-aboleth');
  assert.equal(d.source, 'shadowdark');
  assert.equal(d.ac.asc, 16);
  assert.equal(d.hd, '8');
  assert.equal(d.hdNum, 8);
  assert.equal(d.hp, 39);
  assert.equal(d.move, 'near (swim)');
  assert.equal(d.align, 'Chaotic');
  assert.deepEqual(d.stats, { S: 4, D: -1, C: 3, I: 4, W: 2, Ch: 2 });
  assert.equal(d.attacks.length, 2);
  assert.deepEqual(d.attacks[0], { label: 'tentacle', count: 2, toHit: 5, damage: '1d8', note: 'curse', raw: '2 tentacle (near) +5 (1d8 + curse)' });
  assert.deepEqual(d.abilities, [{ name: 'Curse', text: 'DC 15 CON or gain a curse.' }]);
});

test('data/monsters.json seed: every entry parseable, Title Case, has id', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'monsters.json'), 'utf8'));
  assert.ok(seed.length >= 200, 'expected the full bestiary to be seeded');
  for (const m of seed) {
    assert.ok(m.id, 'missing id: ' + m.name);
    assert.ok(m.name && m.name.length, 'missing name');
    assert.notEqual(m.name, m.name.toUpperCase(), 'name is ALL CAPS: ' + m.name);
    assert.ok(['shadowdark', 'ose', 'unknown'].includes(m.source), 'bad source: ' + m.source);
    assert.ok(m.ac && m.ac.asc != null, 'no AC: ' + m.name);
  }
});

test('js/monsters-data.js: <script>-loadable copy matches data/monsters.json (for file://)', () => {
  const jsonSeed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'monsters.json'), 'utf8'));
  const jsSeed = require('../js/monsters-data.js');
  assert.ok(Array.isArray(jsSeed) && jsSeed.length >= 200);
  assert.equal(jsSeed.length, jsonSeed.length);
  assert.deepEqual(jsSeed.map(m => m.id), jsonSeed.map(m => m.id));
});
