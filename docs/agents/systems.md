# Game systems

## The System switch

- `state.settings.system`, one of `OSR.SYSTEMS` (`'osr'`, `'ua3e'`, `'brp'`, `'sl'`), set in
  Settings → System. `OSR.setSystem(s)` (`js/settings.js`) is the change handler; a content pack of
  another system calls it too. It re-renders everything the setting gates: `refreshCharUI()` (also
  trackers), `renderMonsterBrowser()`, `renderCompendium()`, `renderCombat()`.
- It filters, never deletes. Always go through the helpers:
  - Compendium: `compendiumForSystem()` (`entry.system`). Used by `compByExactName`, `compFuzzy`,
    `compResolve`, popups, `[` autocomplete, the list, and Settings → Delete all.
  - Bestiary: `monstersForSystem()` (`(m.system || 'osr')`). Used by the Bestiary list, the
    "Add monster" modal, and Populate by HD. New monsters get `currentSystem()`; an edit keeps the
    original `system`. `seedMonsters()` replaces only the `'osr'` slice.
  - Characters: `charactersForSystem()` with `charSystemKey(ch)`: a ` ```ua ` fence, a `[BRP]` (or
    `[Basic Roleplaying]`) tag at the end of the first line, or a ` ```sl ` fence in `ch.body`
    (checked in that order), else `'osr'`. The free-text `ch.system`
    label is never used for filtering. `refreshCharUI()` moves `activeId`/`activeIdB` to the first
    character of the system when they point outside it. **New blank** uses
    `DEFAULT_BLANK_OSR/UA/BRP/SL` so the new character has the right fence or tag.
  - Trackers: `consumablesForSystem()` hides a character's HP/Wounds/Madness tracker unless that
    character is in the current system. Other trackers always show.
  - Scenes: each has a `system`; `state.activeSceneIds[system]` is the open one.
- The PL generator (`#mb-gen`) is hidden unless the system is `'osr'`.
- Tests: "System switch: …" in `test/ui.test.js` (one per system) switch back and forth and check
  every panel and that no array shrinks. Add a new listing surface there.

## Trackers per system (`js/core.js`, `js/characters.js`)

- Sheet resources (every system but `ua3e`): `sheetResources(body)` finds each `Name: cur/max`
  (line start or after `;` `|` `,`; not inside a code fence). `syncResourceTrackers(ch)` (from
  `createCharacter` and `saveEdit`) makes a `"Name (Character)"` tracker for each
  (`resourceTrackerLabel`; `HP`/`Hit Points` → the HP tracker). New: the sheet's value and max.
  Existing: the sheet sets only `max` (an untouched 0/0 takes both). `renameResourceTrackers` (from
  `saveEdit`) moves them on a rename; `deleteChar` removes them (`resourceTrackerLabels`);
  `consumablesForSystem` counts them as the character's.
- Ownership and grouping (js/consumables.js): `trackerOwner(c)` says a tracker named
  `"<label> (<character name>)"` belongs to that character (longest name wins). `consumablesForSystem`
  hides a character's trackers outside its system; `renderConsumables` groups them under a
  `.cons-group[data-char-id]` heading with the short label (`HP`, `PP`), one line each, then the
  other trackers under "Shared". Editing a short label keeps the `" (Name)"` suffix. Each row's
  `data-name` holds the full tracker name.
- `ensureHpTracker(ch)`: every system except `ua3e`.
- UA: `"Wounds (Name)"` (`ensureWoundTracker`/`syncWoundTracker`), created only once the ` ```ua `
  fence has a Wound Threshold; its `max` follows the sheet, its `value` is never touched by the sheet.
- SL: also `"Madness (Name)"` (`ensureMadnessTracker`, 0..`MADNESS_MAX` 100), started once from
  `slFenceMadness(ch)`; after that the tracker holds the value. Renamed with `renameMadnessTracker`,
  removed by `deleteChar`.

## Percentile rolls (all systems)

`annotate.js`'s `PCT_RE` makes every bare `NN%` (0–100) a roll with `data-formula="%NN"` (plus
`[+-]N` modifiers). `doRoll()` sends it to `rollPercent()`: 1d100 ≤ target, with Success/Failure,
Crit (1), Fumble (100), Matched Success/Failure (doubles). It sets `OSR.lastPercent`.

## Unknown Armies 3rd Edition (`ua3e`)

- **PC sheet**: a ` ```ua ` fence. `UAStatblock.parseUAStatblock(text)` (`js/ua-statblock.js`, pure)
  reads Identities, Passions, Relationships, Wound Threshold, Shock.
  `computeAllAbilities(shock)` derives the ten abilities (p.30: upbeat 65 − 5×hardened, downbeat
  15 + 5×hardened). Abilities are never typed in.
- `renderCharMarkdown(body)` = `marked.parse(renderUABlocks(body))`: each fence becomes a
  `uaStatblockHtml(def)` panel. Use it everywhere a character body renders (View, split view, Combat
  detail, map popups). Edit mode shows the raw text.
- `uaStatblockHtml` shows: section headers; identity features classified by `parseFeatures()`
  (verb spans `.ua-feature-{kind}`); Substitutes-for overrides (`computeSubstitutions`, display only,
  `.ua-sub`); one `.ua-meter-row` per Shock meter with its Relationship (`METER_RELATIONSHIP`,
  `normalizeRole`; check `rel.name`, not `rel.text`, for a blank line), defend/attack tooltip
  (`METER_DEFEND_ATTACK`), a syndrome badge at 5 failed, a Burnout banner at 25 hardened.
- **Shock dots** are click-to-edit (`#mode-view` click, before `.roll`): dot N sets the track to N;
  the top filled dot again drops to N−1. `setUAShockValue` → `patchUAFence` →
  `UAStatblock.setShockValue` (a pure text rewrite of the meter line). The fence text is the only
  source of truth. Each change logs `'<Meter> Hardened|Failed <before> → <after>'`.
- **GMCs** (Bestiary): a def with `source: 'ua3e'`; `raw` is the only source of truth, parsed with
  `parseUAMonster(def.raw)` wherever shown. Header lines (name, description, `Type:`, `Book:`,
  `Wound Threshold:`, `Obsession:`), the PC sections, ranged identities (`3d10+40%` → `pct: null`,
  `value`), and an `Abilities` section. `abilityValues(def)`: book value, then a substitution, then
  the gauge (none without Shock). Optional `notes` (Markdown) and `ref`.
- Modals: `PASTE_ONLY_SOURCES = ['ua3e']` hides "Fill in fields"; `parseAndAdd` splits on `---`
  lines and builds with `uaMonsterDef`; `saveMonsterEdit` keeps `notes`/`ref`. HD filters hide.
- **Combat**: `isUaEntry(e)`. Wounds count up to the threshold (`e.wounds`/`e.woundThreshold` for a
  monster, the Wounds tracker for a character; `setEntryWounds` clamps). Row: wounds stepper, wound
  state chip (`woundState`, p.63 bands), Init chip (`initiativeOf`). `entryDown` = unconscious or
  worse. `renderUaDamage` shows `#dice-apply-ua` buttons from `damageOptions(roll)` after a percent
  roll. Populate by HD is hidden (`#cb-ua-hint`). Nothing UA is bundled.

## Basic Roleplaying (`brp`)

- PC: `# Name [BRP]` (the tag classifies it; `stripTitleTag()` hides it in View mode), then one
  line of characteristics as sheet variables (`STR: 13; CON: 14; …; DEX: 12`), one line of
  resources (`HP: 13/13; PP: 17/17; FP: …; SAN: …`, see Sheet resources below), one line of
  single values (`Major Wound: 7; Move: 10; Damage Modifier: None; Experience Bonus: 6`), then
  prose. No code fence, no table: both break the `Name: N` variables. Skills are bare `NN%`
  (rolled through `PCT_RE`). Derived stats are typed into the data, not computed. The
  `brp_character` repo's Markdown export writes this layout.
- `migrateBrpSheet(body)` (js/core.js), from `ensureCharShape` and `createCharacter`, rewrites old
  sheets: a ` ```brp ` fence or a characteristics table becomes the `STR: 12; DEX: 9` line, and a
  sheet without the tag gets `[BRP]`.
- Bundled data (`data/seed-brp.json`) comes only from the core book (ORC license): Chapter 11
  creatures and NPCs, Chapter 4 powers, Chapter 8 equipment. Check values against the core book;
  a book average that ends in a half point (printed as a range, `10–11`) is stored as the lower
  value (10), in characteristics and hit points. The Creatures book is for the user's own
  content pack only (the `brp_character` repo's `tools/extract_monsters.py`).
- Monster def: the OSR `def` shape plus `source: 'brp'`, `characteristics` (omitted ones left out),
  `armor`, `armorNote`, `damageBonus`, `attacksText`, `skillsText`. `ac`/`stats`/`saveTargets`
  are empty; generic code already guards on them. `hd`/`hdNum` hold the optional Encounter Level
  (also `encounterLevel`; `''`/`null` = unrated). `OSR.levelLabel()` (js/monster-modals.js) is `'EL'`
  for BRP, else `'HD'`; `applyLevelLabels()` writes it into every `.hd-label` (Bestiary and modal
  filters, the Populate button and modal), called from `renderMonsterBrowser`, `renderLibrary`,
  `renderCombatBar`, and `openPopulateHdModal`. The meta line, hover card, and `brpDetailHtml()` show
  `EL` when set.
- Seeding: `js/brp-seed.js`, from `data/seed-brp.json` (73 monsters; Compendium `source` is the
  power or equipment type; category `'Powers'`).
- Form: `.mf-schema-block[data-schema="brp"]`; `.mf-nonbrp` hides OSR-only fields. `.mf-f-brp-el`
  is the EL: `collectMonsterForm` sets `hd`, `hdNum`, `encounterLevel` from it (blank: `''`, `null`). No paste parser:
  `FIELDS_ONLY_SOURCES` (`['brp','sl']`) opens add/edit in fields mode.
- Combat: no HD stepper; Armor/DB chips; detail from `brpDetailHtml()` (attacks one per line: `splitAttacks()` splits at `;`
  outside parentheses). Initiative is a rank
  (core book pp.123-124): `brpRankKey()` is `'DEX'` or `'INT'` from `state.settings.brpInitiative`
  (`'dex'` default, `'int'`; Settings → BRP combat order, `#set-brp-initiative`, shown only for BRP;
  a change calls `sortByRank()`). `entryRank(e, key)`: the override `e.dexRank` / `e.intRank`, else
  the characteristic from `characteristics` or the sheet's `DEX: N` via `charCharacteristic(ch, key)`;
  a monster with no DEX is DEX rank 1 (core book p.222), no INT is `null` (last). `isBrpEntry(e)`.
  While System is BRP, `insertEntry()` puts a new BRP entry after the entries with the same or a
  higher rank (stable: the GM's tie order stays). Row: `brpRankChips()` (editable `.cbt-rank` with
  `data-key`, a chip for the other rank). `#cb-sort-rank` ("Sort by DEX/INT") → `sortByRank()`;
  `#cb-brp-hint` explains it. Scarlet Heroes damage is
  bypassed for BRP. `brpResolveDb(text, damageBonus)` turns `+dm`/`+½dm` into dice (first signed
  term of `damageBonus`; `½` halves the die count) in the row chip, the detail, and
  `monsterCardHtml()`, not in Compendium weapons. `DICE_RE` accepts chains of dice terms so
  `1d8+1d4` is one roll.

## Silent Legions (`sl`)

- Monsters use the OSR `def` shape (HD stepper, Populate by HD, Scarlet Heroes, attack/save/morale
  buttons all work). `source: 'sl'` adds `skill`, `madness` (`'None'`, `'1d6'`, `'None / 1d6'`),
  `slaughterDie`, `mundaneImmune` (AC `*`). `ac.asc` is `null`; `acDisplay()` shows the descending
  number. One save: `saveTargets: { Save: N }` (⌈15 − HD/2⌉ for templates). "1d4 hp" is HD `'½'`,
  "1 hp" is `'0'`; else hp = ⌊4.5 × HD⌋. Keep `hdNum`, `hp`, saves, `attacksText`, `raw` consistent.
- Combat: `slHitNote()` ("hits AC N or higher", N = 20 − total); `slDetailHtml()` adds Skill
  (2d6 + skill), Slaughter (6+ → triple), Madness buttons, checked before `.roll` in
  `onDetailClick`. Row chip `Mad …`.
- Form: `data-schema="sl"`; `.mf-nonsl` hides Alignment/XP.
- Characters: ` ```sl ` fence (attributes + `Madness: N`); HP and Madness trackers.
- Nothing Silent Legions is bundled except the pregens. The content pack comes from the
  Silent Legions Foundry VTT system (`module/import/keeper-pack.mjs` in that repo): Compendium
  entries with `slpdf:` refs, monsters in the shape above (`abilities` as `{ name, text }`,
  `attacksText` as `2 claw +3 (1d4)`), and `tables` in the `js/table-syntax.js` format
  (`{ name, origin: "Silent Legions", settings: ["Modern", "Horror"], output, system, source }`;
  they go to the shared table library).
  `test/fixtures/sl-pack.json` (made-up text, `slPack()` in `test/helpers/boot.js`) has that shape;
  that repo's `tools/keeper-fixture.mjs` writes it.
  The pregens' `[Name]` links are names of that pack (`SL_PREGEN_LINKS` in `test/logic.test.js`).
- The old built-in seed (`data/seed-sl.json`, removed) left seedRefs `sl:c:<name>` and monster ids
  `sl-<name>`. `cleanSeed()` (js/seeds.js) drops them from the stored seed; `dropLegacySlSeed()`
  (from `ensureStateShape()`) drops a campaign's unedited copies once, while the campaign still
  has `slCompendiumSeeded`/`slMonstersSeeded`, then deletes those flags. `fixAbilities()`
  (js/core.js) turns string abilities from early packs into `{ name: '', text }`.
