/* js/seed.js — first-run seeding of example characters and the monster
 * library. Canonical character sheets live in data/*.txt; canonical monster
 * data lives in data/monsters.json / js/monsters-data.js (see AGENTS.md
 * "Seeding & the file:// constraint" — fetch() is blocked on file://, so
 * nothing here is load-bearing on it).
 */
(function (OSR) {
  'use strict';
  const MONSTERS_URL = 'data/monsters.json';

  const SEED_FILES = [
    'data/garrick-wwn.txt', 'data/gulzund-blize-shadowdark.txt',
    'data/kevin-johnson-ua3e.txt', 'data/lucinda-adams-ua3e.txt',
    'data/dee-okafor-sl.txt', 'data/miriam-castell-sl.txt',
    'data/vivian-sato-sl.txt', 'data/ray-kowalczyk-sl.txt'
  ];

  // Used only when data/*.txt can't be fetched (e.g. page opened via file://).
  const SEED_WWN = `Garrick [WWN]
Level 1 Heroic Expert | Barbarian Background

HP: 17/19 | AC: 14 | AB: +0

ATTRIBUTES
STR: 14 (+1)
DEX: 9 (+0)
CON: 14 (+1)
INT: 9 (+0)
WIS: 14 (+1)
CHA: 11 (+0)

SAVING THROWS
Physical: 14+ | Evasion: 15+ | Mental: 14+ | Luck: 15+

SKILLS
Survive-0, Sneak-0, Stab-0, Heal-0, Notice-0, Convince-4

FOCI
Poisoner (Lvl 1), Spirit Familiar (Lvl 1)

EQUIPMENT
Readied: Sword, Short, Throwing Blade, Small Shield, Linothorax
Stowed: Backpack, Rations (1 week), Waterskin, Tinder Box, Torches (3), Grappling Hook, Rope (50 ft)
Stored: None
Credits: 0`;

  const SEED_SD = `# Gulzund Blize
*Human Witch — Level 1 Lawful*

> **AC** 11 · **HP** 5/5 · **Luck** 🍀 0 · **XP** 0

## Abilities
|     | Score | Mod |
| --- | ----- | --- |
| STR | 8 | -1 |
| DEX | 12 | +1 |
| CON | 16 | +3 |
| INT | 10 | +0 |
| WIS | 10 | +0 |
| CHA | 19 | +4 |

## Attacks & weapons
- **Dagger (OBSIDIAN)** — +1 (N), 1d6 (BREAKABLE, FIN)
- **Spells** — To cast a Witch spell, roll 1d20+4 vs a DC equal to 10 + the spell's tier.

## Talents
- **Ambitious** — Gain one additional talent roll at 1st level.
- **Learn Extra Spell** — Learn an additional witch spell of any tier you can cast
- **+2 CHA or +1 Casting** — +2 to Charisma stat or +1 to witch spellcasting checks
- **Cauldron**
- **Stat Bonus**

## Spells
- Cauldron
- Charm Person
- Eyebite
- Willowman

## Gear (slots: 10)

| Slot # | Item | Slot # | Item |
| --- | --- | --- | --- |
| 1 | Dagger (obsidian) | 11 |  |
| 2 | Backpack (free) | 12 |  |
| 3 | Flint and steel | 13 |  |
| 4 | Torch | 14 |  |
| 5 | Torch | 15 |  |
| 6 | Iron spikes | 16 |  |
| 7 |  | 17 |  |
| 8 |  | 18 |  |
| 9 |  | 19 |  |
| 10 |  | 20 |  |

## Languages
- Common
- Diabolic
- Elvish
- Primordial
- Sylvan

## Advancement
- **XP:** 0 · **Next level:** roll HP, gain a talent on the level-up table.

## Bonds / notes
- Background: Drawn.`;

  const SEED_KJ = `# Kevin Johnson [Unknown Armies]

*Civil War re-enactor, father, school custodian — the Fifth Wheels*

Kevin is an older man with dark skin and close-cropped hair, of average height and size, in his mid to late fifties. He dresses plainly and enjoys wearing comfortable shoes and button-down shirts.

**Obsession:** Kevin is obsessed with reconstructing key battles of the past in minute detail, because the Civil War was a struggle worth fighting.

**Possessions:** Collects self-help audiotapes by Tony Robbins and Shonda Rhimes that he plays whenever he's feeling low. Carries an impressive (and extremely valuable) set of Civil War-era surgeon's tools and apothecary jars filled with whiskey, opium, chloroform, and quinine, locked in the trunk of his 2001 Chevy Malibu.

**Important Locations:** Big Bay State Park.

Kevin realized the supernatural was real after he lost time for an hour in 2006 during his last trip to Big Bay State Park on Madeline Island with his then-wife, Nikki, and their daughter, Rachel. He currently lives in San Mateo, California and works as a school custodian. During the summer months, Kevin devotes his energy to filling the shoes of Civil War surgeons, like Jonathan Letterman, and travels thousands of miles to amputate limbs and save dying soldiers. Kevin blames himself for his family problems and takes the brunt of the abuse for his ex-wife's mysterious departure — until he doesn't.

\`\`\`ua
Identities
Veteran 65%* — Substitutes for Fitness, Resists Violence, Provides Firearm Attacks
Caring 35% — Substitutes for Connect, Substitutes for Status, Resists Isolation
Autodidact 20% — Substitutes for Knowledge, Substitutes for Notice, Resists Unnatural

Passions
Fear (Isolation): Dying alone and unloved.
Noble: Reconciliation with his ex-wife.
Rage: Bullies of any kind, especially family members.

Relationships
Responsibility: Rachel 45%
Favorite: __%
Guru: __%
Mentor: __%
Protégé: __%

Wound Threshold: 50

Shock
Helplessness: 1 hardened / 1 failed
Isolation: 3 hardened / 2 failed
Self: 2 hardened / 0 failed
Unnatural: 1 hardened / 2 failed
Violence: 2 hardened / 3 failed
\`\`\`

## Book references

- **Veteran** 65%: [Veteran], [Resists Shocks to a Meter], [Provides Firearm Attacks]
- **Caring** 35%: [Caring], [Resists Shocks to a Meter]
- **Autodidact** 20%: [Autodidact], [Resists Shocks to a Meter]
`;

  const SEED_LA = `# Lucinda Adams [Unknown Armies]

*Biblioklept grad student — the Fifth Wheels*

Lucinda is curvy, pale, wears stylish glasses, and sports shockingly vibrant green hair. She's a twenty-something with more bright colors in her wardrobe than a box of Crayola crayons, and just as many shoes to match.

**Obsession:** Books are alive and must be listened to.

**Possessions:** Wears a pewter replica of the Libra Negra around her neck and has a tattoo of a ritual found in *The Key of Solomon* (Clavicula Salomonis) on her hip. Despite her desire to collect other occult artifacts featured in the books she reads, she's afraid to start — so she frequents oddball museums, like the American Museum of Magic in Marshall, Michigan, and buys refrigerator magnets instead.

**Important Locations:** Big Bay State Park.

After witnessing a bibliomancer performing magick, Lucinda rationalized that souls become trapped in books, and it's her duty to collect and listen to them. Her nose firmly planted in the tomes she steals, Lucinda is a grad student at Loyola University Chicago, well on her way to achieving yet another degree no one has heard of. She's got a bit of a mouth on her, and has no problem standing up for the other outcasts in her family. If no one else steps forward, Lucinda would make an excellent ringleader for the group.

\`\`\`ua
Identities
Occultist 65%* — Substitutes for Knowledge, Casts Rituals, Evaluates Unnatural
Troll 55% — Substitutes for Lie, Coerces Helplessness, Reads Rage

Passions
Fear (Helplessness): Losing her connection to reality.
Noble: Using magickal knowledge to help people.
Rage: Those who prey upon the weak or innocent.

Relationships
Responsibility: The Fifth Wheels 45%
Favorite: __%
Guru: __%
Mentor: __%
Protégé: __%

Wound Threshold: 50

Shock
Helplessness: 1 hardened / 0 failed
Isolation: 3 hardened / 1 failed
Self: 2 hardened / 1 failed
Unnatural: 1 hardened / 0 failed
Violence: 1 hardened / 0 failed
\`\`\`

## Book references

- **Occultist** 65%: [Occultist], [Casts Rituals], [Evaluates a Meter]
- **Troll** 55%: [Troll], [Coerces a Meter], [Read Passion or Obsession]
`;

  // Silent Legions pregens, one per class (Investigator, Scholar, Socialite,
  // Tough) — each has a ```sl fence, so they show only under System = sl.
  const SEED_SL_DEE = `# Dee Okafor [Silent Legions]

*Investigator — Level 1 · Private Eye background · Average wealth*

\`\`\`sl
STR  9 (+0)  INT 12 (+0)  WIS 16 (+1)
DEX 13 (+0)  CON 11 (+0)  CHA 14 (+1)
Madness: 0
\`\`\`

> **AC** 9 · **HP** 5/5 · **Attack** +1 · **Expertise** 2/2

## Saving throws

Physical Effect 15+ · Mental Effect 14+ · Evasion 12+ · Magic 16+ · Luck 13+

## Skills

A check is \`2d6\` + attribute modifier + skill level, against a difficulty the GM sets.

- Perception-1 (Wis) 2d6+2
- Culture/Boston-0 (Cha) 2d6+1
- Law-0 (Int) 2d6+0
- Research-0 (Int) 2d6+0
- Security-0 (Dex) 2d6+0
- Stealth-0 (Dex) 2d6+0
- Combat/Projectile-0 — in the attack below

## Attacks

A hit is \`1d20\` + bonus + the target's AC; 20 or more hits.

- **[Revolver]** — hit 1d20+1 · damage 1d8 · Slaughter 1d6 · 30/100 m · 6 shots

## Class abilities

- **Leading Whispers** (1 Expertise) — Never wholly stuck on a case: gain a hunch or a contact that leads further on a chosen topic or person. Neither is guaranteed to be clear or easy to reach.
- **Reliable Skill** (1 Expertise) — Reroll a failed check with an Investigator skill: Computer, Culture, Language, Law, Navigation, Perception, Persuade, Profession, Research, Security, Stealth, or Vehicle. Once per roll.

## Gear

- **Readied:** flashlight, lockpick set, camera with a long lens
- **Stowed:** revolver in a concealed ankle holster, 20 rounds, emergency first aid kit
- **Also:** a tired Crown Victoria, a smartphone full of case photos

## Languages

English

## Background

Dee spent eight years with the Boston PD. A missing-person case ended in a basement covered in chalk sigils, with a witness who would not stop smiling, and the department closed the file the next morning. She now runs a one-woman agency in Dorchester and takes the cases other PIs turn down.

**Connection:** Miriam Castell — her former teacher. Dee took Miriam's night course on New England folklore while she was still on the force.
`;

  const SEED_SL_MIRIAM = `# Miriam Castell [Silent Legions]

*Scholar — Level 1 · Professor background · Affluent wealth*

\`\`\`sl
STR  8 (+0)  INT 16 (+1)  WIS 14 (+1)
DEX 10 (+0)  CON  9 (+0)  CHA 13 (+0)
Madness: 10
\`\`\`

> **AC** 9 · **HP** 3/3 · **Attack** +0 · **Expertise** 2/2

Affluent wealth: she starts with 10 Madness, as her sheltered life left her unready for the truth.

## Saving throws

Physical Effect 16+ · Mental Effect 14+ · Evasion 15+ · Magic 12+ · Luck 13+

## Skills

A check is \`2d6\` + attribute modifier + skill level, against a difficulty the GM sets.

- History-1 (Int) 2d6+2
- Research-1 (Int) 2d6+2
- Language-0 (Int) 2d6+1
- Occult-0 (Int) 2d6+1
- Religion-0 (Int) 2d6+1
- Culture/Boston-0 (Cha) 2d6+0

## Attacks

A hit is \`1d20\` + bonus + the target's AC; 20 or more hits. She has no Combat skill (−2 to hit).

- **Walking stick** (a [Club]) — hit 1d20-2 · damage 1d4 · no Slaughter die

## Class abilities

- **Deep Gnosis** (1 Expertise, once per day) — Automatically succeed at a check with a knowledge skill she has, such as History or Research. It doesn't work for Occult or other alien or magical lore.
- **Reliable Skill** (1 Expertise) — Reroll a failed check with a Scholar skill: Art, Computer, Culture, Engineering, History, Language, Law, Medicine, Occult, Profession, Research, or Science. Once per roll.

## Gear

- **Readied:** walking stick, reading glasses
- **Stowed:** laptop computer, photocopies from a 17th-century trial record
- **Also:** a house in Cambridge, a Volvo, a library card for every archive in the state

## Languages

English, Latin

## Sorcery

The trial record describes [Whispers of the Scribe] in enough detail to learn it. She hasn't tried yet — see [Casting Spells] for what it would cost.

## Background

Miriam is a tenured professor of medieval history at a small college outside Boston. Her field is heresy trials, and one set of records described a rite in close detail. Last spring she watched three strangers perform it in a parking garage. She has stopped telling colleagues about her research.

**Connection:** Vivian Sato — someone who helped her out of a crisis. Vivian once sold her a forged letter; when the buyer of the real one turned up dead, Vivian got her out of town for a week.
`;

  const SEED_SL_VIVIAN = `# Vivian Sato [Silent Legions]

*Socialite — Level 1 · Con Man background · Struggling wealth*

\`\`\`sl
STR 10 (+0)  INT 12 (+0)  WIS  9 (+0)
DEX 15 (+1)  CON  7 (-1)  CHA 14 (+1)
Madness: 0
\`\`\`

> **AC** 8 · **HP** 3/3 · **Attack** +1 · **Expertise** 2/2

Struggling wealth: one extra skill pick (Perception).

## Saving throws

Physical Effect 15+ · Mental Effect 12+ · Evasion 16+ · Magic 14+ · Luck 13+

## Skills

A check is \`2d6\` + attribute modifier + skill level, against a difficulty the GM sets.

- Persuade-1 (Cha) 2d6+2
- Culture/Boston-1 (Cha) 2d6+2
- Culture/Criminal-0 (Cha) 2d6+1
- Stealth-0 (Dex) 2d6+1
- Gambling-0 (Int) 2d6+0
- Language-0 (Int) 2d6+0
- Perception-0 (Wis) 2d6+0

## Attacks

A hit is \`1d20\` + bonus + the target's AC; 20 or more hits. She has no Combat skill (−2 to hit).

- **[Knife]** — hit 1d20+0 · damage 1d4+1 · Slaughter 1d6 · thrown 6/9 m

## Class abilities

- **Folie a Deux** (1 Expertise) — Make a human react to her as a friend, or be cowed by her, if either is remotely plausible. A human tainted by the supernatural can resist for an hour with a Mental Effect save, and may play along to hide it.
- **Reliable Skill** (1 Expertise) — Reroll a failed check with a Socialite skill: Art, Business, Culture, Gambling, Language, Law, Leadership, Perception, Persuade, Profession, or Vehicle. Once per roll.

## Gear

- **Readied:** knife, a deck of marked cards
- **Stowed:** two poor-quality fake IDs, a secondhand smartphone
- **Also:** a room in a weekly-rent motel in Revere

## Languages

English, Japanese

## Background

Vivian ran short cons on rich marks until one of them introduced her to his family charity. The donors at its gala all had the same smile, and some of them had the faces of people she knew were dead. She got out with her life and a ledger in a script she can't read.

**Connection:** Ray Kowalczyk — a childhood companion. They grew up on the same block in South Boston.
`;

  const SEED_SL_RAY = `# Ray Kowalczyk [Silent Legions]

*Tough — Level 1 · Soldier background · Average wealth*

\`\`\`sl
STR 14 (+1)  INT  9 (+0)  WIS 12 (+0)
DEX 13 (+0)  CON 16 (+1)  CHA  6 (-1)
Madness: 0
\`\`\`

> **AC** 9 · **HP** 7/7 · **Attack** +1 · **Expertise** 2/2

## Saving throws

Physical Effect 12+ · Mental Effect 16+ · Evasion 14+ · Magic 15+ · Luck 13+

## Skills

A check is \`2d6\` + attribute modifier + skill level, against a difficulty the GM sets.

- Athletics-1 (Str) 2d6+2
- Medicine-0 (Int) 2d6+0
- Tactics-0 (Int) 2d6+0
- Vehicle/Land-0 (Dex) 2d6+0
- Leadership-0 (Cha) 2d6-1
- Combat/Projectile-1 — in the attacks below

## Attacks

A hit is \`1d20\` + bonus + the target's AC; 20 or more hits.

- **[Semi-auto Pistol]** — hit 1d20+2 · damage 1d6+1 · Slaughter 1d6 · 30/100 m · 12 rounds
- **[Shotgun, Pump]** — hit 1d20+2 · damage 3d4 · Slaughter 1d10 · 10/30 m · 6 shells (kept in the truck)
- **Fists** — hit 1d20+0 (no Combat/Unarmed: −2) · damage 1d2+1 · no Slaughter die

## Class abilities

- **Ravenous for Life** — At 0 HP he stabilizes on his own, and survives a wound that would otherwise kill him.
- **Reliable Skill** (1 Expertise) — Reroll a failed check with a Tough skill (Athletics, Combat, Gambling, Leadership, Profession, Stealth, Survival, Tactics, or Vehicle), or a failed attack roll. Once per roll.

## Gear

- **Readied:** semi-auto pistol in a custom holster, flashlight
- **Stowed:** two spare magazines, emergency first aid kit, nylon rope (20 m)
- **Also:** a pickup truck with the pump shotgun behind the seat, a toolbox

## Languages

English

## Background

Ray did two tours with the Army infantry and came home to work night security at the Port of Boston. One night a container came off a ship with no manifest, nothing inside but wet sand, and a sound like breathing. His partner went in to look. Ray didn't, and he hasn't slept well since.

**Connection:** Dee Okafor — someone who saved his life. Dee was at the port that night on a case, and she dragged him out of the harbor.
`;

  // Same order as SEED_FILES. A test (test/logic.test.js) checks each one
  // matches its data/*.txt file byte for byte.
  const SEED_FALLBACK = [SEED_WWN, SEED_SD, SEED_KJ, SEED_LA, SEED_SL_DEE, SEED_SL_MIRIAM, SEED_SL_VIVIAN, SEED_SL_RAY];

  // Every example sheet's text, in SEED_FILES order: data/*.txt when fetch()
  // works, else the inline SEED_FALLBACK copy.
  async function loadSeedSheets() {
    const isFile = location.protocol === 'file:';
    const texts = [];
    for (let i = 0; i < SEED_FILES.length; i++) {
      let text = null;
      // fetch() is blocked on file:// and the browser logs the failed
      // request to the console regardless of the try/catch — skip it there.
      if (!isFile) {
        try {
          const res = await fetch(SEED_FILES[i]);
          if (res.ok) text = await res.text();
        } catch (e) { /* offline — use fallback */ }
      }
      texts.push(text && text.trim() ? text : SEED_FALLBACK[i]);
    }
    return texts;
  }

  async function seed() {
    (await loadSeedSheets()).forEach(text => OSR.createCharacter(text));
    if (OSR.state.characters.length) {
      OSR.state.activeId = OSR.state.characters[0].id;
      OSR.save();
      OSR.refreshCharUI();
    }
  }

  // The example characters' names (from the inline copies, so Settings can
  // count them without a fetch) and which of them the campaign lacks —
  // matched by name, case-insensitive.
  function missingPregens() {
    const have = new Set(OSR.state.characters.map(c => String(c.name || '').toLowerCase()));
    return SEED_FALLBACK.map(t => OSR.detectNameSystem(t).name).filter(n => !have.has(n.toLowerCase()));
  }

  // Settings → "Add missing pregens": seed() only runs on a fresh install, so
  // this adds every example character the campaign lacks (one made before a
  // pregen existed, or after one was deleted), across all systems. The active
  // character(s) stay selected. Returns the count added.
  async function addMissingPregens() {
    const missing = new Set(missingPregens().map(n => n.toLowerCase()));
    const keepA = OSR.state.activeId, keepB = OSR.state.activeIdB;
    let added = 0;
    (await loadSeedSheets()).forEach(text => {
      const key = OSR.detectNameSystem(text).name.toLowerCase();
      if (!missing.has(key)) return;
      missing.delete(key);
      OSR.createCharacter(text);
      added++;
    });
    if (added) {
      OSR.state.activeId = keepA;
      OSR.state.activeIdB = keepB;
      OSR.save();
      OSR.refreshCharUI();
    }
    return added;
  }

  const MONSTER_SEED_TEXT = [
    'Bear, Polar',
    'A mighty, white bear that thrives in arctic environments.',
    'AC 13, HP 34, ATK 2 claw +6 (2d6), MV near (climb), S +4, D +1, C +3, I -2, W +1, Ch -2, AL N, LV 7',
    'Crush. Deals an extra die of damage if it hits the same target with both claws.',
    'Thick Fur. Cold immune.',
    '',
    'Couatl',
    'A human-sized snake with scales made of jewels and a corona of iridescent feathers.',
    'AC 16, HP 42, ATK 3 bite +6 (2d6 + poison), MV near (fly), S +2, D +3, C +2, I +4, W +4, Ch +5, AL L, LV 9',
    'Change Shape. In place of attacks, transform into any similarly-sized creature.',
    'Poison. DC 15 CON or fall into natural, deep sleep for 1d8 hours.',
    'Restore. In place of attacks, touch one creature to remove a curse, affliction, or heal 3d8 HP.',
    '',
    'Brownie',
    '1½′ tall humanoids, related to pixies and halflings. They are shy, but friendly with other Lawful creatures.',
    'AC 3 [16] Hd ½ (2hp) Att Knife (1d3) THAC0 19 [0] Mv 120′ (40′) sv D6 W7 P9 B11 S9 (Cleric 9) ML 7 AL Lawful XP 5 nA 3d6 (5d8) TT S',
    '▶ Surprise: Never surprised.',
    '▶ Dimension door: Once per day, can teleport to a known location within 360′.',
    '▶ Ventriloquism: Can cause their voice to emanate from anywhere within 60′.',
    '',
    'Bulette',
    '15′ long, hard-shelled reptiles with huge maws, tiny eyes, and a shark-like crest upon the back.',
    'AC 0 [19] Hd 9* (40hp) Att Bite (4d12) + 2 × claw (3d6) THAC0 12 [+7] Mv 150′ (50′) / 30′ (10′) burrowing sv D8 W9 P10 B10 S12 (9) ML 11 AL Neutral XP 1,600 nA 0 (1d2) TT None',
    '▶ Ravenous: Will attack anything living.',
    '▶ Leap: If cornered, can leap forward 20′, attacking with all 4 claws.',
    '▶ Armour plates: Neck plates can be fashioned into magical shields.',
    '',
    'Kobold, Sorcerer',
    'A scaly dog-lizard painted with colorful stripes and rattling a hefty leg bone strung with beads and feathers.',
    'AC 13 (leather), HP 13, ATK 1 club +1 (1d4) or 1 spell +2, MV near, S -2, D +2, C +0, I -1, W +1, Ch +2, AL C, LV 3',
    'Dodge. 1/day, an attack that would hit misses instead.',
    'Scorpion Sting (CHA Spell). DC 11. Near range, one target. 1d6 damage and target has DISADV on next attack roll or check.',
    'Spider Swarm (CHA Spell). DC 12. A spider swarm appears within near. Stays 1d4 rounds. Follows sorcerer\'s commands.'
  ].join('\n');

  async function seedMonsters() {
    let defs = null;
    // 1) bundled <script> copy — works over file:// where fetch() is blocked
    if (Array.isArray(window.MONSTER_LIBRARY) && window.MONSTER_LIBRARY.length) {
      defs = window.MONSTER_LIBRARY;
    }
    // 2) fetch the JSON (fine when served over http; skipped on file:// —
    // fetch() is blocked there and the browser logs the failed request to
    // the console regardless of the try/catch)
    if (!defs && location.protocol !== 'file:') {
      try {
        const r = await fetch(MONSTERS_URL);
        if (r.ok) defs = await r.json();
      } catch (e) { /* offline */ }
    }
    // 3) last resort: parse the tiny inline sample
    if (!Array.isArray(defs) || !defs.length) {
      defs = window.MonsterParse ? MonsterParse.parseMonsters(MONSTER_SEED_TEXT) : [];
    }
    // clone so state mutations never touch the shared constant
    defs = JSON.parse(JSON.stringify(defs));
    defs.forEach(d => { if (!d.id) d.id = OSR.uid(); d.system = 'osr'; }); // the bundled library is all OSR (Shadowdark/OSE)
    // Reseeding only ever replaces the OSR-tagged portion of the library —
    // monsters belonging to another system are preserved (mirrors how the
    // Compendium's Reseed/Delete all stay scoped to the active system).
    OSR.state.monsters = OSR.state.monsters.filter(m => (m.system || 'osr') !== 'osr').concat(defs);
    OSR.state.monstersSeeded = true;
    OSR.save();
    OSR.renderLibrary();
    OSR.renderCombatBar();
    OSR.renderSettings();
  }

  Object.assign(OSR, { SEED_FILES, SEED_FALLBACK, loadSeedSheets, seed, missingPregens, addMissingPregens, seedMonsters });
})(window.OSR = window.OSR || {});
