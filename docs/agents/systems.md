# Game systems

## The System switch

- `state.settings.system`, one of `OSR.SYSTEMS` (`'shadowdark'`, `'ua3e'`, `'brp'`, `'sl'`, `'fate'`, `'wwn'`), set in
  Settings → System (`#set-system`) or the header's `#header-system` (short names); `renderSettings()`
  fills and syncs both. `OSR.setSystem(s)` (`js/settings.js`) is the change handler; a content pack of
  another system calls it too. It re-renders everything the setting gates: `refreshCharUI()` (also
  trackers), `renderMonsterBrowser()`, `renderCompendium()`, `renderCombat()`.
- **The old key `'osr'`.** Shadowdark was the `'osr'` system until 2026-11-09 (label "OSR").
  Saved campaigns, exports, packs, IndexedDB documents, and Dropbox files from before then still
  say `'osr'`. Every read of a system key goes through `OSR.normSystem(s, fallback)` (js/core.js,
  `LEGACY_SYSTEM_KEYS`), which turns `'osr'` into `'shadowdark'`:
  - `ensureStateShape()`: `settings.system`, each monster's and entry's `system`;
    `renameLegacyKeys()` on `activeSceneIds` and `seedVersions`. `ensureSceneShape()` for scenes.
  - `joinState()`: a stored document `'<campaignId>/osr'` is read as `'shadowdark'`;
    `loadCampaign()` then writes it under the new key and deletes the old one (`store.deleteDocKeys`).
  - `loadSeeds()`: `seeds/osr` moves to `seeds/shadowdark` (deleted only after the write succeeds).
  - Dropbox (`js/dropbox.js`): while `/campaigns/<id>/shadowdark.json` or `/seeds/shadowdark.json`
    is missing, `syncFile(path, text, listing, oldPath)` reads the old `osr.json` (with its sync
    record) in its place, and an upload creates the new file. The old file is never written.
  - Imports: `validSystem()` in js/io.js, and table settings in js/tables.js.
  - Seed refs keep the old prefix (`osr:c:<name>`, `refPrefix()` in js/seeds.js): a new prefix would
    make every campaign's seed copies look new and duplicate them.
  Tests: test/rename.test.js.
- **Downtime tab**: shown only while the system is `'shadowdark'` (`applyDowntimeTab()`, called from
  `renderSettings()`). See [downtime.md](downtime.md).
- It filters, never deletes. Always go through the helpers:
  - Compendium: `compendiumForSystem()` (`entry.system`). Used by `compByExactName`, `compFuzzy`,
    `compResolve`, popups, `[` autocomplete, the list, and Settings → Delete all.
  - Bestiary: `monstersForSystem()` (`(m.system || 'shadowdark')`). Used by the Bestiary list, the
    "Add monster" modal, and Populate by HD. New monsters get `currentSystem()`; an edit keeps the
    original `system`. `seedMonsters()` replaces only the `'shadowdark'` slice.
  - Characters: `charactersForSystem()` with `charSystemKey(ch)`: a ` ```ua ` fence, a `[BRP]` (or
    `[Basic Roleplaying]`) tag at the end of the first line, a ` ```sl ` fence, a ` ```fate `
    fence, or a ` ```wwn ` fence in `ch.body` (checked in that order), else `'shadowdark'`. The free-text `ch.system`
    label is never used for filtering. `refreshCharUI()` moves `activeId`/`activeIdB` to the first
    character of the system when they point outside it. **New blank** uses
    `DEFAULT_BLANK_SHADOWDARK`, `DEFAULT_BLANK_UA/BRP/SL/FATE/WWN` so the new character has the right fence or tag.
  - Trackers: `consumablesForSystem()` hides a character's HP/Wounds/Madness tracker unless that
    character is in the current system. Other trackers always show.
  - Scenes: each has a `system`; `state.activeSceneIds[system]` is the open one.
- The PL generator (`#mb-gen`) is hidden unless the system is `'shadowdark'`.
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
- `ensureHpTracker(ch)`: every system except `ua3e` and `fate` (Fate has stress boxes in its fence).
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
  `armor`, `armorNote`, `damageBonus`, `attacksText`, `skillsText`, and optional `settings` (names of
  the core book's Chapter 10 settings, `BRP_SETTINGS` in js/monster-browser.js; the Bestiary's Setting
  filter, Pick random, and Populate by EL read it). `ac`/`stats`/`saveTargets`
  are empty; generic code already guards on them. `hd`/`hdNum` hold the optional Encounter Level
  (also `encounterLevel`; `''`/`null` = unrated). `OSR.levelLabel()` (js/monster-modals.js) is `'EL'`
  for BRP, else `'HD'`; `applyLevelLabels()` writes it into every `.hd-label` (Bestiary and modal
  filters, the Populate button and modal), called from `renderMonsterBrowser`, `renderLibrary`,
  `renderCombatBar`, and `openPopulateHdModal`. The meta line, hover card, and `brpDetailHtml()` show
  `EL` when set.
- `data/seed-brp.json` powers have the full Chapter 4 text, and the monsters their `settings`. The
  `brp_character` repo's `tools/update_keeper_seed.py` writes both from the core book PDF and raises
  `version`. Run it there; do not edit those fields by hand.
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

## Fate Core (`fate`)

- **Text format** (`js/fate.js`, pure, `window.FateSheet`): one `Key: value` per line, shared by a
  PC's ` ```fate ` fence and a Fate NPC's `raw` (name on the first line). `FateSheet.parse(text)` →
  `{ aspects, skills (highest first), stunts, refresh, stress: [{ name, boxes: [bool] }],
  consequences: [{ label, value, text }], mob, weapon, armor, notes, extra }`. Skills come from
  ladder lines (`Good (+3): Fight, Will`, ladder names only) or `Name: ±N` pairs (several per line
  with `;`). Keys with a number that are not skills: `NUMBER_KEYS`. A stress line is any key ending
  in `Stress`; `[x]` is checked, `[ ]` / `[1]` empty. A consequence is a key starting with
  Mild/Moderate/Severe/Extreme (`Mild (physical)` too). Rewriters: `setStressBox`, `setConsequence`,
  `clearStress` (text in, text out). `sheetHtml(def, { fence, readOnly })` is the panel: skills are
  `.roll` spans (`data-formula="4dF+N"`), boxes `.fate-box[data-track][data-box]`, consequences
  `input.fate-cons[data-i]`, labels `.no-annotate` (annotate() skips them).
- **PC**: `charSystemKey` → `'fate'` for a ` ```fate ` fence (checked after `sl`). `renderUABlocks`
  also turns each fence into `sheetHtml` (with `fence` = its index). `#mode-view` click on
  `.fate-box` → `setFateStress(ch, fence, track, box, checked)`; `change` on `.fate-cons` →
  `setFateConsequence`. Both rewrite the fence (`patchFateFence`), log, and re-render; the fence is
  the only source of truth. `fateFenceDefs(ch)` parses every fence; `charVars` adds the fence
  skills as variables. No HP tracker (`ensureHpTracker` skips `fate`); `Fate Points: 3/3` outside the
  fence is a sheet resource. `DEFAULT_BLANK_FATE`; pregens `data/*-fate.txt`.
- **Dice** (`js/dice.js`): `rollTerm('4df')` rolls faces −1/0/+1 (`sides: 'F'`, text `[+ 0 − +]`).
  `defaultDie()` is `4dF` in Fate, else `1d20`: `evalFormula(f, base)` uses it for a bare modifier,
  and `annotate`'s `findMatches` for `+N` and `Name: N` rolls. `DICE_RE` accepts `NdF`. A Fate roll
  adds `→ Ladder (+N)` to the detail and sets `OSR.lastFate { formula, total, source }` (cleared by
  `pushLog`). `#dice-fate-actions`: `invokeLast()` (+2, logged) and `rerollLast()`.
  `buildDiceGrid()` shows one `4dF` button with a −/+ modifier (`#dice-fate-mod`, not persisted) in Fate; `renderSettings()` calls it (every load path does).
  `updateApplyButton` hides **Apply damage** in Fate.
- **Aspect tracker** (`js/fate-ui.js`, `#fate-aspects-panel` above Trackers, shown only in Fate,
  rendered from `renderConsumables`): `state.fateScene = { aspects: [{ id, text, kind, invokes }],
  gmPoints }`, kinds `situation | scene | boost | game`. `invokeAspect(a)`: a free invoke if any (a
  boost at 0 is removed), else a fate point; `invokeLast` when there is a `lastFate`. `newScene()`
  keeps `game` aspects and sets `gmPoints = scenePcCount()` (Fate characters in Combat, else all).
- **NPC generator** (`js/fate-npc.js`, `window.FateNpc`): the Fate NPC Generator engine from the
  `fate-rpg-foundry` repo (`src/engine.mjs`) without ES module syntax and the Foundry export. Data:
  `OSR.data.fate = { rules, genres, archetypes, stunts, aspectLists }` from `data/fate/*.json`
  (`js/data.js`). Copy a newer engine the same way: remove `export`, drop the
  "Export: Fate Core Official" section, keep the UMD footer. `generateNpc(data, opts)`,
  `generateEncounter(data, opts)`; seeded (same seed, same NPC). Keeper uses `ruleSet: 'core'`.
- **Bestiary def** (`source: 'fate'`): `FateSheet.npcDef(text, extra)` → `{ name, source, raw, hdNum:
  peak rank, hd: '', hp: 0, … }` plus the generator's `importance, quality, threat, role, genre,
  archetype, seed`. `raw` is the only source of truth (like UA). `npcText(npc)` (js/fate-ui.js) writes
  the generator's NPC as that text. `PASTE_ONLY_SOURCES` has `fate`; `parseAndAdd` splits on `---`;
  `saveMonsterEdit` keeps the metadata. `levelLabel('fate')` is `Peak` (the HD filter reads `hdNum`).
  `monsterMetaLine` / `monsterCardHtml` have a Fate branch.
- **Combat** (`js/combat.js`): `isFateEntry(e)`, `fateDefOf(e)` (a monster: its own copy
  `e.monster.raw`; a character: fence 0). `fateRowLine2` (`.cbt-fate-box`, Cons chip, peak, mob,
  `.cbt-takenout`), `fateDetailHtml` (Taken out, **Clear stress** → `clearCombatFateStress()`, the
  sheet). `setFateEntryStress` / `setFateEntryConsequence` write the character's fence or the
  entry's `raw`. `entryDown` = `e.takenOut`. No turn-order sort. In Fate, `#cb-populate-hd` reads
  "+ Populate encounter…" and a capture listener in js/fate-ui.js opens `#fate-enc-modal`
  (`generateEncounter` → `addEncounter`: every member to Combat, optionally the Bestiary,
  `gmPoints = gmFatePoints`). `#fate-gen-modal` is the Bestiary's single-NPC generator.
- **Compendium**: categories `Aspects` and `Stunts`; optional entry fields `skill` (a stunt's skill,
  or an aspect's kind such as `Trouble`) and `settings` (`['Fantasy', 'Sci-fi']`). The filter rows
  **Skill / kind** (`#comp-skill`) and **Setting** (`#comp-settings`) show when an entry of the
  system has the field; the editor shows the two fields in Fate. Seed: `data/seed-fate.json`, made
  by `npm run convert-fate` (`scripts/convert-fate.js`) from `data/fate/stunts.json` and
  `aspect-lists.json`; every entry has a `ref` (`fate-stunt:<id>`, `fate-aspect:<list>:<n>`) because
  names repeat. `seedFateCompendium()` (from `seedMissing`, flag `fateCompendiumSeeded`) matches by
  `seedRef`.

## Worlds Without Number (`wwn`)

- **Bundled content** (the free edition, by the owner's decision; see AGENTS.md "Hard rules"):
  `data/seed-wwn.json` (`OSR.data.seeds.wwn`) has the spells (High Magic, Elementalist,
  Necromancer; `ref` `wwn:spell:<slug>`), the arts of each tradition (`Abilities`, source
  `<Tradition> Art`), the Foci (`Abilities`, source `Focus`), and the monster stat lines of the
  core book. `seedWwn()` (`js/wwn-ui.js`, from `seedMissing`, flag `state.wwnSeeded`) copies new
  items by seedRef. The encounter tables are `data/tables/wwn_*.csv` (origin "Worlds Without
  Number" in `scripts/convert-tables.js`). The owner's private `book-extracts/build_wwn.js` writes
  all of these and the private packs (Atlas monsters, The Monster Overhaul, condensed spells).
- **PC sheet**: a ` ```wwn ` fence. `WwnSheet.parse(text)` (`js/wwn.js`, pure) reads `Class:`,
  `Level:`, the six attributes (`STR 14  DEX 9 …`), `Attack:`, `Skills: Notice-1, Sneak-0 (DEX)`,
  `Foci:`, `Effort:`; other `Key: value` lines become chips. `sheetHtml(def)` derives the
  modifiers and the four saves (16 − level − the better modifier of the pair; Luck has none).
  Saves are `.roll` spans with `data-formula="1d20>=N"`; a skill rolls `2d6 + skill + attribute`
  (the skill's usual attribute from `SKILL_ATTR`, or the one in parentheses). Foci render as
  `[Name]` links. `HP: 8/8; System Strain: 0/14` stay outside the fence: two resource trackers.
- **Target rolls** (every system): `doRoll` (`js/dice.js`) reads a trailing `>=N` (or `≥N`) as a
  target; modifiers after it (`1d20>=14+2`, from the roll popup) move onto the dice. The log shows
  `→ vs N: Success (+margin)` or `Failure`.
- **Monsters**: the OSR def shape with `source: 'wwn'`, ascending AC, one save
  (`saveTargets: { Save: N }`), plus `skill`, `instinct` (1–10), `shock` (book text: `2/13`,
  `Wpn+1`, `None`), `armored` (the book's `a`), `statLine`, `desc`, `group`, `origin`. `raw` is
  `monsterText(def)`: the name, the keyed stat line, the description. WWN monsters are paste-only
  (`PASTE_ONLY_SOURCES`): `WwnSheet.parseMonsters` takes "Name" + "HD 3, AC 15a, Atk +4, …" or
  book table rows; the edit modal re-parses `raw` and keeps `ref`, `origin`, `group`, `abilities`.
- **Combat**: `wwnDetailHtml` adds Skill (2d6 + skill), Instinct (1d10, at or under the score acts
  on instinct), and Shock. An attack's log says `hits AC N or less` and the Shock on a miss
  (`wwnHitNote`).
- **Condensed spells**: a pack entry with `altOf` (the book spell's `ref`) and `aka` (its name).
  Settings → **WWN spell text** (`state.settings.wwnSpellText`, `'book'` or `'condensed'`) picks
  which of the pair `compendiumForSystem()` shows; `compByExactName` also matches `aka`, so a
  `[Book Name]` link finds the condensed entry. Pack import matches `altOf` entries by `ref` only
  (their name often equals the book name).
- Tests: `test/wwn.test.js`.

