# AGENTS.md

Guidance for AI agents and human contributors working on this repo. Read this before editing.
User-facing docs are in [README.md](README.md).

## What this is

A **static single-page app** — `index.html` + a few plain `.js`/`.css` files. **No build step, no
framework, no bundler, no package to install.** It runs over http(s) only: GitHub Pages
(`.github/workflows/static.yml` uploads the whole repo on push to `main`), or any static server for
local work (`python3 -m http.server`, `npx serve`). Opening `index.html` from `file://` is **not
supported**: the app `fetch()`es its data files at boot (see "Seeding" below), and `file://` blocks
that. Do not add code paths or inline copies to make `file://` work.

Keep it that way. Do not introduce a build tool, a framework, TypeScript, JSX, npm runtime
dependencies, or CDN `<script>`/`<link>` tags. Everything third-party is **vendored** (`js/marked.min.js`,
`vendor/fontawesome/`), so the app needs no host other than its own.

`.github/workflows/test.yml` runs `npm test` on every push and pull request.

**A second network use: icon downloads** (`js/icons.js`). When the user clicks a result of the
Maps tab's icon search, the app fetches that one SVG from jsDelivr (`ICON_URL`, the game-icons
GitHub repository). Nothing else in the app loads from another host, and the search itself runs on
the bundled `data/game-icons-index.json`.

**One opt-in exception: Dropbox sync** (`js/dropbox.js`, see "Dropbox sync" below).
When the user turns it on, the app calls the Dropbox HTTP API (`api.dropboxapi.com`,
`content.dropboxapi.com`) with `fetch`. It loads no third-party script. Nothing goes to the network
until the user clicks **Connect**, and the app works without it. Don't add other
runtime network dependencies on the back of this one.

## Layout

```
index.html             markup; loads the scripts at the bottom in order
css/app.css             all styles (one file, dark only; palette + fonts are CSS custom properties
                       on :root, re-declared in :root[data-theme="fantasy"|"sf"|"horror"] blocks —
                       style themes chosen in Settings, applied as data-theme on <html> by applyTheme())
js/core.js              window.OSR = {} (created here) + constants, $/$$/escapeHtml/uid, the state
                       model + persistence (STATE_DEFAULTS, load/save/ensureStateShape), applyTheme
js/store.js             IndexedDB persistence (OSR.store: open/getDocs/putDocs/deleteDocs/getMeta/
                       setMeta) + splitState/joinState, the cut of OSR.state into one document per
                       system plus a campaign document — see "State model"
js/seeds.js             the seed store (OSR.seeds, one per system, shared by every campaign; packs add
                       to it), seed copies with seedRef/seedHash, and Settings → New defaults — see
                       "Seeding"
js/campaigns.js         the Campaign selector (#campaign-select) and Settings → Campaign: switch,
                       create, rename, delete (each campaign is its own set of documents)
js/data.js              OSR.loadData(): fetch()es every data/ file init() needs (monsters, spells,
                       tables, the seed-<system>.json files, the pregen sheets) into OSR.data — see
                       "Seeding" below
js/dice.js              dice engine (evalFormula, rollTerm/rollDie) + $Name substitution + roll/session-log
js/annotate.js          sheet-text -> clickable dice/$refs/[Compendium] spans (annotate, findMatches,
                       scanVariables, charVars) — see "Character-sheet variables" below
js/mde.js               the shared EasyMDE builder (buildMDE), used by js/notes.js and js/compendium.js
js/characters.js        character CRUD, View/Edit rendering, and the sheet-selection ->
                       "Add/link to Compendium" context menu (openSelMenu et al.)
js/consumables.js       campaign-global trackers (rations, torches, … + each character's HP tracker)
js/notes.js             the campaign Journal (EasyMDE via js/mde.js)
js/combat.js            the combat tracker: entries, HP/HD, status conditions, turn order, drag-to-
                       reorder, rolls, and Scarlet Heroes damage translation
js/monster-form.js      the schema-aware (Shadowdark | OSE | BRP | SL) "fill in fields" monster form, shared by
                       both monster modals — template, populate from a def, collect back into one
js/monster-modals.js    the "Add monster" modal (shared by Combat and the Bestiary tab) and the
                       monster edit modal — each has a "Paste text" / "Fill in fields" toggle
js/monster-browser.js   the Bestiary tab (filterable library list, mirrors js/compendium.js) and the
                       Party-Level random monster generator (Shadowdark core rules)
js/combat-populate.js   Combat's "+ Populate by HD…" modal: spends a total HD budget (with an
                       optional exact monster count) on monsters from the current Bestiary,
                       always exactly, then confirms before adding to combat
js/ua-statblock.js      pure parser for a Unknown Armies 3rd Edition character's ```ua fenced
                       statblock (identities/passions/relationships/shock meters) + the p.30
                       computed-ability formula, the Bestiary GMC statblock (parseUAMonster), and
                       UA Combat's pure rules (wound bands, initiative, damage by weapon) — no
                       DOM, UMD-ish like js/monsters.js
js/brp-seed.js          seedBrpMonsters()/seedBrpCompendium() — like js/seed.js's seedMonsters() and
                       js/compendium.js's seedCompendium(), but for the BRP system, from
                       OSR.data.seeds.brp (see "Basic Roleplaying (BRP)" below); called from
                       js/main.js's init()
js/sl-seed.js           seedSlMonsters()/seedSlCompendium() — same mechanism as js/brp-seed.js, for
                       system 'sl', from OSR.data.seeds.sl; called from js/main.js's init()
js/compendium.js        Compendium entry CRUD, category/source/system filters, the default seed, compResolve
js/compendium-popups.js hover popups on [bracketed] refs, and "[" / "$" autocomplete
js/grid.js              pure map grid geometry (window.MapGrid / module.exports): squares and flat/pointy
                       hexes — cellAt, cellCenter, cellCorners, distance, cellsCovered, cellsIn, gridFromRect,
                       offsetCoords, labelOrigin, hexLabel, hexKey
js/maps.js              the Maps tab: scenes (state.scenes), the SVG view (pan, zoom), images in IndexedDB
                       blobs, grid settings and calibration, the measure tool — see "The Maps tab"
js/tokens.js            map tokens on a scene: add/snap/move/select/delete, links to combat entries and
                       characters (unlinkTokens from js/combat.js), the hover card, pings — see
                       "The Maps tab"
js/drawings.js          drawing on a scene: pen (RDP-simplified), line, rect, ellipse, polygon, text, eraser;
                       the draw bar; select and move with the hand tool
js/pins.js              location pins (notes = Compendium 'Journal' entries) and hexcrawl mode (explored
                       hexes, hex numbers) on a scene
js/history.js           undo/redo of scene changes (OSR.saveScene records before/after); Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y
js/icons.js             game-icons.net icons (UMD-ish; Node requires it too): iconFromSvg (path data only),
                       and in the app the icon search and download into state.customIcons
js/tables.js            the Tables tab: tag filter + name search over OSR.data.tables, expand a
                       table (<details>) and roll its formula — read-only, no state/CRUD
js/settings.js          the Settings tab
js/dropbox.js           optional Dropbox sync of the whole state (PKCE sign-in with a redirect back to
                       the app + Dropbox HTTP API via fetch); its Settings row, header status button,
                       and conflict dialog — see
                       "Dropbox sync" below
js/io.js                the "paste sheet as text" modal, whole-state export/import, and
                       content-pack import (see "State model")
js/dice-ui.js           the Dice Roller panel (preset grid + custom formula) and the right-click
                       "roll with modifiers" popup
js/seed.js              first-run seeding of example characters + the monster library
js/main.js              composition root: wire() calls every subsystem's wireX(), init(), boot(),
                       and (test builds only) the test seam — loads LAST
js/monsters.js          pure stat-block parser (no DOM, no storage); UMD-ish
js/marked.min.js        vendored Markdown parser
js/fuse.min.js          vendored Fuse.js 7 (UMD → window.Fuse) — fuzzy search for the Compendium
vendor/fflate/           vendored fflate 0.8.2 (UMD → window.fflate; MIT, LICENSE next to it) — the .zip
                       Export/Import with map images (js/io.js)
vendor/easymde/         vendored EasyMDE 2.18 (js bundles CodeMirror+marked; css) — Compendium editor
data/monsters.json     GENERATED: the OSR bestiary (scripts/convert-bestiary.js)
data/bestiary_data.json  source data for the converter (Shadowdark core bestiary)
data/spell_data.json   source data for the spell converter (Shadowdark core spells)
data/spells.json       GENERATED: the Shadowdark core spells, folded into the OSR Compendium seed by
                       js/data.js
data/tables/*.csv      source data for the random tables (one file per table, "range,Details" rows)
data/tables.json       GENERATED: the random tables (scripts/convert-tables.js)
data/token-icons.json  the 30 preset map tokens: [{ id: '<author>/<name>', name, author, paths: [d…] }], made
                       by scripts/build-token-icons.js from game-icons.net SVGs (CC BY 3.0)
data/game-icons-index.json  GENERATED: [{ id, name, author }] for every game-icons.net icon (the search list;
                       fetched on the first search), by scripts/build-icon-index.js
data/seed-osr.json     hand-maintained Shadowdark core gear: { system, version, compendium }
data/seed-brp.json     hand-maintained BRP seed: { system, version, compendium, monsters } — Chapter 11
                       creatures/NPCs and the Powers/Equipment of Chapters 4 and 8
data/seed-sl.json      hand-maintained Silent Legions seed: { system, version, compendium, monsters } —
                       the creature templates and Nefarious Entities, Gray Path spells, Disciplines,
                       rules notes, and the weapon/armor/gear/vehicle tables
data/*.txt             example character sheets (seeded on first run)
scripts/convert-bestiary.js   CLI: bestiary_data.json -> data/monsters.json
scripts/convert-spells-from-shadowdark-resources.js  CLI: spell_data.json -> data/spells.json,
                       { name, category:"Spells", body } entries js/data.js folds into the OSR seed
scripts/build-token-icons.js  CLI: a folder of game-icons.net <author>/<name>.svg files -> data/token-icons.json
                       (path data only; refuses any other element, a transform, or another viewBox)
scripts/build-icon-index.js   CLI: the jsDelivr listing of game-icons/icons -> data/game-icons-index.json
scripts/icon-authors.js       game-icons.net folder -> credited author name (both icon scripts)
scripts/convert-tables.js     CLI: data/tables/*.csv -> data/tables.json (see "Tables tab" below
                       for the table shape and the per-file tag mapping)
test/monsters.test.js  node:test suite for the parser + converter
test/grid.test.js      node:test suite for js/grid.js (pure)
test/drawings.test.js  node:test suite for js/drawings.js and js/history.js: each tool, the draw bar,
                       eraser, select/move, Clear, and undo/redo of every kind of scene change
test/pins.test.js      node:test suite for js/pins.js: hexcrawl toggle, explored hexes, hex numbers, pins
                       and their Journal notes (popup, editor, move, delete)
test/popout.test.js    node:test suite for the pop-out map window: two jsdom windows, the second booted at
                       ?view=map with boot's `opener` option (no reset(): its state is the first's)
test/icons.test.js     node:test suite for js/icons.js and scripts/build-icon-index.js: the SVG check, the
                       search, and a download through a fake jsDelivr
test/tokens.test.js    node:test suite for js/tokens.js: icons, snapping, moving and selecting, combat
                       links and unlinking, the bar, Delete, pings
test/maps.test.js      node:test suite for js/maps.js and the .zip Export/Import: scenes, images (file,
                       paste, address, drop), grid, calibration, measure, pan/zoom
test/tables.test.js    node:test suite for scripts/convert-tables.js (CSV parsing, range parsing,
                       every table's coverage of its die, 1..N)
test/logic.test.js     node:test unit tests for the app's internals (dice engine, Scarlet Heroes,
                       state migration, annotate, compendium resolve, combat, …)
test/ui.test.js        node:test integration tests that drive the real DOM (index.html + the app's
                       js/*.js files) through the app's delegated listeners and assert on render + persistence
test/campaigns.test.js node:test suite for js/store.js and js/campaigns.js: split/join, writes of only
                       the changed documents, reload, the localStorage migration, and the Campaign UI
test/seeds.test.js     node:test suite for js/seeds.js: seed refs, a newer code seed offered and
                       applied, packs into the seed, and the Merge rule for seeded items
test/data.test.js      node:test suite for js/data.js: the data/ files' shape, the seeds built from
                       them, first-run seeding, and the load-error state
test/dropbox.test.js   node:test suite for js/dropbox.js, against a fake window.open, a fake
                       redirect (OSR.dropboxRedirect), and a fake Dropbox API + token endpoint
                       (test/helpers/fake-dropbox.js, on window.fetch) — nothing talks to Dropbox
test/helpers/boot.js   boots the app inside jsdom for the suites above (EasyMDE omitted → the
                       Journal / Compendium editors fall back to plain <textarea>s, as designed).
                       jsdom has no fetch: boot() serves the app's data/ files from disk and hands
                       every other request to the test's own window.fetch stub. jsdom has no
                       IndexedDB either: each boot gets a fresh fake-indexeddb (devDependency);
                       pass `indexedDB` from an earlier boot to reload. `savedState(T)` reads the
                       current campaign back from IndexedDB
vendor/fontawesome/    icons, referenced by index.html via relative url()
```

**No ES modules either.** jsdom, which runs `test/ui.test.js` and the other DOM suites, does not
run `<script type="module">`. So the app's own code is split across the
`js/*.js` files above the vendored libraries in that list, each a small IIFE that attaches its
pieces to one shared namespace object, `window.OSR` (created by `js/core.js`, which must load
first — every other file just does `(function (OSR) {...})(window.OSR = window.OSR || {})`, so load
order among the rest doesn't matter: cross-file calls are `OSR.foo(...)` / `OSR.state.x`, resolved
at call time, not at parse time). This is an *organisational* split, not a strict-encapsulation one —
the app's internals are heavily interconnected (one mutable `state`, shared `save()`/`render*()`
calls from nearly every file), so most functions end up on `OSR.*` rather than staying private to
their file. Find the right file (by subsystem, above) before adding code; keep a new function local
to its file (a plain `function`/`const`, not attached to `OSR`) unless another file — or a test —
actually needs to call it.

`test/logic.test.js` and `test/ui.test.js` reach into the app through a test seam installed by
`js/main.js`: `installTestSeam()` sets `window.__OSR_TEST__ = window.OSR` **only** when the harness
has set `window.__OSR_ENABLE_TEST_SEAM__` first, so a normal page load is untouched — since nearly
everything is already on `OSR`, there's no separate list of internals to keep in sync; only a couple
of test-only extras (`reset()`, `renderAll()`) are added on top. `T.reset()` wipes to a clean
already-migrated state between tests. `jsdom` is the one **dev** dependency (`npm install`
once); the shipped app still has zero runtime deps and no build step. Values returned from the app
live in jsdom's realm — compare them with the non-strict `assert`, not `assert/strict`.

The **Compendium** spans three files — entry CRUD/filters in `js/compendium.js`, hover popups and
autocomplete in `js/compendium-popups.js`, and the sheet-selection "Add/link to Compendium" menu in
`js/characters.js`. `state.compendium`: `{id,name,category,source,system,body}`, category ∈
`COMPENDIUM_CATEGORIES`, source is free text defaulting to `Unknown`, system ∈ `SYSTEMS` (see
"Game system" below — everything is `'osr'` unless created while System is set to something else).
It's a reference list edited via
an EasyMDE modal, filterable by category and by source — click a checkbox to toggle it, right-click
one to isolate it (unticks every other checkbox in that row, `#comp-cats` or `#comp-sources`). The
entry editor's `Enter` saves (same as clicking Save) and `Shift+Enter` inserts a newline in the body,
via `onSubmit` on the EasyMDE `compMdeInstance()` plus a `#comp-modal` keydown fallback for the
plain-textarea case; `Escape` cancels (the app-wide Escape handler already covers every modal). The
default seed is `OSR.seeds.osr` (`js/seeds.js`): the gear in `data/seed-osr.json` plus the spells
in `data/spells.json`, plus any OSR content pack. `seedCompendium()` adds missing-by-name entries
(first run only, `state.compendiumSeeded`). Raising `version` in `data/seed-osr.json` does not
re-seed by itself: Settings → **New defaults** offers the change (see "Seeding" below). Settings →
**Reseed defaults** calls `seedCompendium()` directly;
**Delete all** empties `state.compendium` (version left as-is, so it does not auto-return).
`annotate()` also wraps bare `[bracketed]` text in `<span class="comp-ref">` (skipping short
all-caps system tags). Hovering one calls `openCompPop(name, ref)`, which creates a **fresh
`.comp-pop` node** (they stack) appended to `<body>`, tracked in `compPops`. Popup bodies are run
through plain `annotate()` (dice roll, nested `[refs]` hover-spawn more popups). The whole chain
lives/dies together — `cancelHideAllPops()` / `scheduleHideAllPops()` on hover in/out of any popup
or ref; `pop.pinned` (📌) exempts one from auto-close and makes its `.cpop-head` a drag handle;
`closePop(pop, cascade)` drops a popup and
its unpinned descendants; Esc / `closeAllCompPops()`. Match navigation is the header `‹ ›` buttons
and ↑/↓ on `compPopActive` (no wheel hijack — the popup scrolls natively). `refreshCompPop()`
re-resolves every open popup after an edit.

**Game system** (Settings → System, `OSR.SYSTEMS` = `['osr','ua3e','brp','sl']` in `js/core.js`) is a single
global switch, `state.settings.system`, that partitions the **Compendium only** — `compByExactName`,
`compFuzzy` (and therefore `compResolve`, hover popups, `[` autocomplete, the sheet-selection "Add to
Compendium" menu) and `renderCompendium`'s list/count all filter to `entry.system === currentSystem()`
(`js/compendium.js`), as does `acSearch()`'s `[` autocomplete pool (`js/compendium-popups.js`) and
Settings → **Delete all**, which only clears the active system's entries (the other system's are left
alone — everything above must stay scoped to `compendiumForSystem()`, never a bare `state.compendium`,
or an entry from one system silently leaks into the other's view/search/wipe). New entries are tagged
with whatever system is active when they're saved; editing an existing entry never changes its system.

The **Bestiary**/`state.monsters` is partitioned the same way — every def carries a `system` field,
backfilled to `'osr'` for anything that predates this. `monstersForSystem()` (`js/monster-browser.js`,
exported on `OSR`) filters to `(m.system || 'osr') === currentSystem()`; the Bestiary tab's own list
(`browserMatches`/`renderMonsterBrowser`) and the shared "Add monster" modal's library list
(`libMatches`/`renderLibrary`, `js/monster-modals.js`) both go through it, never a bare
`state.monsters`. A monster added via any path (paste, "Fill in fields", the PL generator's
save-from-prefill, all of which funnel through `addFromFields`/`parseAndAdd`) is tagged with
`currentSystem()`; `saveMonsterEdit` preserves the *original* monster's `system` on top of whatever it
re-parses, so editing one never silently reclassifies it. `seedMonsters()` (`js/seed.js`) tags its
output `'osr'` (the bundled library is Shadowdark/OSE only) and — since it's also Settings → **Reload
defaults** — only ever *replaces* the `'osr'`-tagged slice of `state.monsters` (filter out `'osr'`,
concat the fresh defs), preserving any other system's monsters exactly like the Compendium's
Delete-all staying scoped to the active system. Unknown Armies GMCs have their own
schema — the same shock-meter statblock as PCs, kept as text — and their own Combat display; see
"Unknown Armies: Bestiary GMCs and Combat" below. Nothing UA is bundled: the Bestiary under
System=ua3e is empty until someone pastes a GMC or imports a content pack. **BRP** also has its own
monster schema and its own bundled bestiary; see "Basic Roleplaying (BRP)" below.
The **PL random monster
generator** (`#mb-gen`, top of the Bestiary tab) is pure Shadowdark-core-rulebook tables though, with no
Unknown Armies equivalent at all — `renderMonsterBrowser()` hides it outright (`el.hidden`, not a
filter) whenever `currentSystem() !== 'osr'`, rather than let it roll nonsense `'ua3e'`-tagged HD/AC
monsters. Same `[hidden]`-not-`display` rule as everywhere else (see "Rendering & DOM conventions") —
`.mb-gen` has no competing `display` CSS, so no `[hidden]` guard rule was needed for it.

Settings' `#set-system` change handler is the one place that must re-render everything this setting
gates — `OSR.refreshCharUI()` (which itself also calls `OSR.renderConsumables()` — see below),
`OSR.renderMonsterBrowser()`, `OSR.renderCompendium()`, and `OSR.renderCombat()` (for Combat's own
`#cb-add-char`/`#cb-add-monster…` pickers, which also read `charactersForSystem()`/go through the same
monster modal) — since switching tabs alone doesn't re-render the Character/Bestiary tabs on its own
(see `js/main.js`'s tab-click handler).

The per-character **"HP (Name)"/"Wounds (Name)" trackers** (`js/core.js`) are likewise gated:
`ensureHpTracker(ch)` now bails only when `charSystemKey(ch) === 'ua3e'` (it used to fire
unconditionally for every character — a real bug, since Unknown Armies characters have no use for HP;
BRP characters use ordinary Hit Points too, so they keep the same tracker as OSR) — Unknown Armies
characters get a `"Wounds (Name)"` tracker instead, from `ensureWoundTracker`/`syncWoundTracker`
(`js/characters.js`), which only ever fires off an actual Wound Threshold in a ` ```ua ` fence. Beyond
creation, `consumablesForSystem()` (`js/consumables.js`) also **filters which trackers `renderConsumables`
shows**: for each consumable, it looks up whether the consumable's name matches some character's
`hpTrackerLabel`/`woundTrackerLabel` — if it does, the tracker only shows while that character's own
`charSystemKey` matches the active System (filtered from view, never deleted, same as everywhere else
this pattern appears); a tracker that isn't any character's HP/Wounds/Madness label (Rations, Torches, a
manually-renamed one, …) always shows. Silent Legions characters keep their HP tracker and also get a
`"Madness (Name)"` one (`madnessTrackerLabel`/`ensureMadnessTracker`, max `MADNESS_MAX` = 100), part of
the same owner lookup — see "Silent Legions (SL)" below. This filter is also what makes any *pre-existing* stray tracker
from before the `ensureHpTracker` fix harmless — e.g. a UA character's leftover `"HP (Name)"` tracker
from an older save simply never displays in either System view, without needing a destructive migration
to remove it.

`OSR.setSystem(s)` (`js/settings.js`) is that handler's body — Settings' `#set-system` change calls
it, and so does a content-pack import of another system (`js/io.js`'s `importPack`).

`test/ui.test.js`'s **"System switch: Compendium, Bestiary, Character dropdown, Combat pickers, and
Consumables all partition together…"** is the consolidated regression test for this whole feature area —
one OSR + one Unknown Armies character/compendium-entry/monster/tracker, switched back and forth twice
through the real `#set-system` control, asserting every one of the panels above shows only the active
system's data each time and that `state.characters`/`compendium`/`monsters`/`consumables` never shrink.
Its sibling **"System switch: Silent Legions gets its own …"** does the same for an `'sl'` character
(with its HP + Madness trackers), compendium entry, and monster.
Any new UI surface that lists characters, monsters, or compendium entries should be added to both this
test and its own narrower one (the individual tests above target one bug/feature each and pin down
*why*; this one exists to catch a regression in how they compose).

The **Character** dropdown (`#char-select`/`#char-select-b`) is partitioned too, but by a different
signal than `entry.system`: `charSystemKey(ch)` (`js/characters.js`) classifies a character as `'ua3e'`,
`'brp'`, or `'sl'` purely by whether its `body` has a ` ```ua `, ` ```brp `, or ` ```sl ` fence (checked
in that order, falling back to `'osr'` when none is present) — not by its free-text `ch.system` display label (`"Shadowdark"`,
`"Unknown Armies"`, …), which is unvalidated and can't be trusted for filtering. A BRP character's
` ```brp ` fence is just a plain-text characteristics block (STR/CON/SIZ/INT/POW/DEX/CHA) for quick
reference — unlike the UA3E fence, nothing parses or renders it specially, so it's left inside a
`<pre><code>` block by `marked.parse()` same as any other fenced code (and thus not annotate()'d — see
"Basic Roleplaying (BRP)" below for why that's fine).
`charactersForSystem()` filters to `charSystemKey(c) === currentSystem()`; `fillCharOptions` (both
selects) and `refreshCharUI`'s active-character bookkeeping all go through it — `refreshCharUI` falls
back to the first in-system character (or `null`) whenever `activeId`/`activeIdB` point outside the
current bucket, same mechanism that already handled a dangling id, now also firing on a System switch
or right after creating a character whose fence-status doesn't match the system it was created under.
Settings' `#set-system` change handler calls `OSR.refreshCharUI()` for exactly that reason — switching
System from the Settings tab must update the Character tab's dropdown/active character immediately, not
just lazily next time something else re-renders it. `createCharacter`'s four "blank" templates
(`DEFAULT_BLANK_OSR`/`DEFAULT_BLANK_UA`/`DEFAULT_BLANK_BRP`/`DEFAULT_BLANK_SL`) exist so **New blank**
creates a character that actually belongs to the system it was created under — the UA template carries a
near-empty ` ```ua ` fence (all-zero Shock), the BRP template a ` ```brp ` characteristics fence, and the
SL template a ` ```sl ` attributes + `Madness: 0` fence, for exactly this reason; without it a blank
character made while System is `ua3e`/`brp`/`sl` would vanish from its own dropdown the instant it's
created.

**Unknown Armies 3rd Edition** character sheets embed their mechanical statblock as a fenced
` ```ua ` code block (anywhere in `ch.body`, alongside ordinary prose/Markdown). `js/ua-statblock.js`
is a pure, DOM-free parser (`UAStatblock.parseUAStatblock(text) -> def`, mirroring `js/monsters.js`'s
shape) for the block's `Identities` / `Passions` / `Relationships` / `Wound Threshold` / `Shock`
sections; `UAStatblock.computeAllAbilities(shock)` derives all ten Abilities from the five Shock
meters' hardened-notch counts per the rulebook's p.30 formula (upbeat = `65 − 5×hardened`, downbeat =
`15 + 5×hardened`) — ability percentages are **never** hand-entered, only computed, so they can't drift
out of sync with the Shock numbers. `js/characters.js`'s `renderUABlocks(body)` replaces every ` ```ua `
fence with its rendered `<div class="ua-block">` panel (`uaStatblockHtml(def)`), wrapped in blank lines
so `marked.parse()` (no `sanitize` option — see `js/main.js`) passes the raw HTML block through
untouched; `renderCharMarkdown(body)` (`marked.parse(renderUABlocks(body))`) replaces every bare
`marked.parse(ch.body)` call site for a character body (View mode, the two-character split, Combat's
combatant detail) so the fence renders consistently everywhere, in View mode only — Edit mode is just
the plain textarea echoing `ch.body`, so it always shows the raw fenced text. A malformed/absent fence
falls through to marked's normal `<pre><code>` rendering. `syncWoundTracker(ch)` re-parses every ` ```ua `
fence on save/create and syncs the campaign-global `"Wounds (Name)"` consumable's `max` (via
`OSR.ensureWoundTracker`, `js/core.js`) to the last Wound Threshold found — same mechanism as the
existing per-character `"HP (Name)"` tracker (`ensureHpTracker`), but only ever created once a Wound
Threshold actually exists; plain OSR characters never get one. Current wounds taken (`value`) is left
alone, same as HP's `value` is untouched by anything sheet-driven.

`uaStatblockHtml(def, opts)` (`js/characters.js`) renders several things beyond the raw parsed fields:
- An `<h4>` section header before Identities/Passions/Shock (only when that section has content).
- Each identity's `features` string, split and classified by `UAStatblock.parseFeatures()` into feature
  clauses (`{raw,kind,verb,target}` — `kind` ∈ `substitutes`/`coerces`/`evaluates`/`protects`/`resists`/
  `provides`/`casts-rituals`/`gutter-magick`/`medical`/`therapeutic`/`unique`/`other`, matched against
  p.44-45's feature-verb list plus the sheets' `Protects` shorthand for Resists-Shocks-to-a-Meter); each
  clause's verb is wrapped in `<span class="ua-feature-kw ua-feature-{kind}">`.
- A live "Substitutes for `<Ability>`" link: `UAStatblock.computeSubstitutions(identities)` resolves
  every identity that Substitutes for one of the 10 real ability names into `{AbilityName: {pct,
  identityName, obsession}}` (last identity wins on a same-ability collision). That ability's label
  shows the *identity's* percentage instead of the computed one (with a title tooltip giving the
  computed value too), and that label, the feature-clause target, and the identity's own name (wherever
  it's the source of a substitution) all share the `.ua-sub` class/color — the visual thread from "this
  identity" to "the ability it overrides." **This override is presentation-only** — it's recomputed
  fresh from `def.identities` on every render, never written back into the Shock-dot click flow below,
  so it always tracks whatever the identity's own `Substitutes for` feature currently says.
- **The Shock section is one `.ua-meter-row` per meter** (`.ua-meters`), not a table — laid out
  left-to-right like the physical sample sheets (relationship | meter name | Hardened dots + ability |
  Failed dots + ability), each piece pulled from a different part of `def`:
  - `.ua-meter-rel`: the one Relationship linked to this meter per p.41's fixed table
    (`UAStatblock.METER_RELATIONSHIP`), looked up in `def.relationships` via `UAStatblock.normalizeRole`
    (case/diacritic-insensitive, so "Protege"/"Protégé" both match). Shows `<i>unfilled</i>` when
    there's no relationship for that role *or* when there is one but it's a blank placeholder line
    (`rel.name === ''` — check `.name`, not `.text`: `.text` is still the truthy literal `"__%"` for an
    unfilled line, only `.name` is empty for it — this was a real bug, now covered by a test).
  - The meter's own name (`.ua-meter-name`) carries a title tooltip with
    `UAStatblock.METER_DEFEND_ATTACK[meter]`'s `defend`/`coerce` ability pair (p.19's "Defend Against
    Challenges To… With…" table, cross-checked against every sample sheet's identical per-meter "Defend
    with X / Attack with Y" block — a fixed, universal mapping); a `.ua-badge-syndrome` badge appears
    when `failed >= 5` (p.27's Insanity Syndrome).
  - **Hardened/Failed dot tracks** (`uaDotsHtml`): 9 and 5 `<button class="ua-dot">`s respectively (the
    meters' actual maximums), `.is-filled` up to the current count, each carrying `data-n` (its own
    1-based position). The wrapping `<span class="ua-dots" data-meter data-field data-fence
    data-value>` records everything the click handler needs. A `.ua-burnout` banner appears at the top
    of the block when the sum of all 5 meters' hardened notches reaches 25 (p.30's Burnout).
  - **Click-to-edit**: `#mode-view`'s click handler (`js/characters.js`'s `wireCharacters`) checks
    `.ua-dot` before `.roll`. Clicking dot N sets that track to N; clicking the *currently topmost
    filled* dot again (`n === wrap.dataset.value`) drops it to N-1 — the same "fill up to here"
    interaction as the physical sheet. `setUAShockValue(ch, fenceIndex, meter, field, value)` calls
    `patchUAFence(ch.body, fenceIndex, inner => UAStatblock.setShockValue(inner, meter, field, value))` —
    `setShockValue` is a **pure text rewrite**: it finds that meter's line inside the fence's inner text
    and replaces just the target number (hardened is the 1st digit run on the line, failed the 2nd),
    preserving everything else about the line's formatting; if the meter has no line yet it appends one
    (creating a `Shock` section too, if even that is missing) rather than silently no-op'ing.
    `patchUAFence` splices that back into the *Nth* fence in `ch.body` (`data-fence`, 0-indexed —
    matters only if a sheet somehow has more than one ` ```ua ` fence). There is **no separate
    structured state for Shock** — the fence text is the only source of truth, exactly like Wound
    Threshold; Abilities (computed *and* Substituted-for-overridden) simply reflect whatever the next
    `parseUAStatblock` sees, same as every other click-driven number in this app (no virtual DOM — see
    "Rendering & DOM conventions"). `setUAShockValue` also reads the *pre*-patch value (a throwaway
    `parseUAStatblock` of that fence's current inner text) purely to log it: `OSR.pushNote(ch.name,
    '<Meter> Hardened|Failed <before> → <after>')`, skipped when `before === after` (can't happen from a
    dot click itself, but can from a direct `setUAShockValue` call) so no-op edits don't clutter the log.

**Unknown Armies: Bestiary GMCs and Combat.** A GMC or unnatural entity is a `state.monsters` def
with `source: 'ua3e'` whose **`raw` text is the only source of truth** — like a PC's ` ```ua ` fence,
it is parsed again wherever it is shown (`UAStatblock.parseUAMonster(def.raw)`), so nothing derived
can drift. The text is a short header — the name on the first line, any other plain line as the
description, optional `Type:` / `Book:` / `Wound Threshold:` (a number, or the book's formula text,
kept as `woundThresholdText`) / `Obsession:` lines — then the PC fence's sections, plus two things
GMC entries need: an identity rated with a range or dice (`3d10+40%` → `pct: null`, `value:
'3d10+40'`; `computeSubstitutions` carries `value` so the PC panel shows it too), and an
`Abilities` section (`Struggle 70%`, `abilityOverrides`). A Shock line with only hardened notches
reads failed as 0. The generic def fields stay empty (`hd: ''`, no AC/attacks), and a UA def may
also carry `notes` (Markdown book text, shown in Combat) and `ref` (the content pack's stable id).
`UAStatblock.abilityValues(def)` merges a GMC's abilities: the book's `Abilities` value, then a
Substitutes-for identity, then the shock gauge — and without a Shock section the gauge gives
nothing (the book doesn't say), rather than the misleading 0-notch 65%/15%.
- **The modals** (`js/monster-modals.js`): `PASTE_ONLY_SOURCES = ['ua3e']` is the reverse of
  `FIELDS_ONLY_SOURCES` — the "Fill in fields" button is hidden (`setFieldsModeAllowed`), the paste
  hint/placeholder switch to a GMC example, `parseAndAdd` splits the text on `---` lines and builds
  each def with `UAStatblock.uaMonsterDef`, and `saveMonsterEdit` re-parses with it, keeping the
  original's `notes`/`ref` (they aren't in the text). `monsterMetaLine`/`monsterCardHtml` have UA
  branches. Both HD range filters (`.mm-hd-field`, `.mb-hd-field`) are hidden under System=ua3e.
- **Combat** (`js/combat.js`): `isUaEntry(e)` is a `ua3e` monster or a character whose
  `charSystemKey` is `'ua3e'`. A UA entry counts **wounds up** to its wound threshold instead of HP
  and HD: a monster on the entry (`e.wounds`, `e.woundThreshold` — set by `addMonsterEntry` from the
  parsed threshold, 0 when it's a formula, editable in the row as `.cbt-wt`), a character on its
  `"Wounds (Name)"` tracker (`addCharEntry` syncs it from the sheet, or creates it at the book's
  default 50). `setEntryWounds` clamps to the threshold. The row (`uaRowLine2`) is a wounds stepper,
  the wound state chip (`UAStatblock.woundState`: p.63's hurt ½ / badly hurt ¾ / unconscious 90% /
  dead 100%, `Math.ceil` per `woundBand`), and an **Init** chip — p.62 has no initiative roll, only
  a tie-break by the rating used, where a *Provides Initiative* identity always counts
  (`UAStatblock.initiativeOf`). `entryDown` is unconscious or worse. `uaMonsterDetailHtml` lists
  identities (feature verbs highlighted via `OSR.uaFeaturesHtml`, shared with the PC panel),
  abilities, passions, obsession, shock, and the `notes` book text (`marked` + `annotate`, so
  `[links]` and `NN%` work). **Damage**: `rollPercent` (`js/dice.js`) records `OSR.lastPercent`
  (`pushLog` clears it, like `lastRoll`), and `updateApplyButton` → `renderUaDamage` shows
  `#dice-apply-ua` under the Dice Roller while a UA combatant is selected: one button per
  `UAStatblock.damageOptions(roll)` (fists = sum of the dice, weapon +3/+6/+9, gun = the roll,
  p.63-65) plus a note for the verdict (crit, matched, miss, fumble). A plain dice roll's **Apply
  damage** adds wounds (`applyWoundsToSelected`); Scarlet Heroes never applies. `renderCombatBar`
  hides **Populate by HD** and shows `#cb-ua-hint` under System=ua3e.

Separately (not `ua`-fence-specific), `annotate.js`'s `PCT_RE` turns any bare `NN%` (0-100) anywhere in
the Character Viewer into a clickable roll, same as dice/`$var` spans — `data-formula="%NN"` (plus any
trailing `[+-]N` flat modifiers, e.g. from the roll-with-modifiers popup or a substituted `$var`) is a
sentinel `doRoll()` (`js/dice.js`) detects and routes to `rollPercent()` instead of `evalFormula()`:
rolls `1d100`, succeeds on a result ≤ the (modifier-adjusted, 0-100-clamped) target, and always logs
the actual roll plus a verdict — `Success`/`Failure`, `Fumble` (100), `Crit` (1), or `Matched
Success`/`Matched Failure` (any other doubled roll, 11/22/…/99). Because the routing lives inside
`doRoll()` itself, every existing `.roll`-click call site (View mode, Combat's combatant detail, the
right-click modifier popup, Compendium hover popups) gets percentile rolls for free.

**Basic Roleplaying (BRP)** (`system: 'brp'`) is *Basic Roleplaying: Universal Game Engine* (Chaosium,
2023) — percentile skills, seven characteristics (STR/CON/SIZ/INT/POW/DEX/CHA), and Hit Points instead
of levels/AC/HD. Unlike Unknown Armies, it ships with a real, populated Bestiary and Compendium, and
its own monster schema and Combat display (see below) — not visibility-only.

- **Player characters** get no dedicated statblock renderer — a BRP sheet is just prose plus a
  ` ```brp ` fence (`DEFAULT_BLANK_BRP` in `js/characters.js`) holding a plain-text characteristics
  block, used *only* to classify the character (`charSystemKey`, see above); nothing parses or
  displays it specially, and being inside a fence it's correctly left out of `annotate()` (characteristics
  aren't rolled directly in BRP — see "Characteristic Roll" below). Skills, by contrast, are written
  as ordinary prose outside the fence (`Dodge 22%`, `Brawl 25%`) so `annotate.js`'s `PCT_RE` (see the
  paragraph above) auto-links every bare `NN%` into a clickable `1d100` roll, and any `1d6`-style
  damage next to it is auto-linked by `DICE_RE` — for BRP this is the *entire* rolling mechanism, no
  bespoke code needed. A **Characteristic Roll** (e.g. INT×5%) is just written as a plain `NN%` too.
- **Derived stats**, per the rulebook (Chapter 2), computed by hand when authoring a sheet or a
  monster def (nothing in the app computes these live — they're baked into the data, same as an OSR
  monster's HP is a fixed number, not `HD` re-rolled on the fly):
  - Hit Points = ⌈(CON + SIZ) / 2⌉; Major Wound = ⌈HP / 2⌉ (shown as a chip in Combat, see below).
  - Damage Modifier/Bonus (`dm`/`db` in the book's own shorthand, kept verbatim in `attacksText`):
    keyed off STR+SIZ on a banded table (2–12 → −1D6 … 153–168 → +9D6, +1D6 per extra +16) — see
    p.20 of the rulebook if a new monster/NPC needs one computed from scratch.
  - Power Points = POW; Move (MOV) = 10 for an average human.
- **The monster/NPC schema** (`data/seed-brp.json`'s `monsters`, 73 entries —
  Natural Animals, Fantasy Creatures, Summoned Creatures, Science Fiction Creatures, and the Nonplayer
  Character Digest, all from Chapter 11) extends the OSR `def` shape from `js/monsters.js` with BRP-only
  fields rather than replacing it, so generic code that reads `def.hp`/`def.move`/`def.abilities`
  keeps working untouched: `source: 'brp'`, `characteristics: {STR,CON,SIZ,INT,POW,DEX,CHA}` (any the
  book omits — e.g. INT/CHA for a plain animal — are left out, not zeroed), `armor` (a flat number) +
  `armorNote` (free text, e.g. `"chain and a light helm"`), `damageBonus` (the book's own string, e.g.
  `"+1D4"`/`"None"`), `attacksText`/`skillsText` (free text, e.g. `"Bite 45%, 1D6+dm"` — deliberately
  *not* the structured `{label,count,toHit,damage,note}` shape OSR attacks use, since a BRP attack's
  "to-hit" is a skill percentage rolled on `1d100`, not a d20 bonus). `def.hd`/`ac`/`stats`/`saveTargets`
  are simply left blank/null on a BRP def — every generic call site already guards on them
  (`m.ac && …`, `if (m.attacks && m.attacks.length)`, etc.), so nothing needs an `if (system !== 'brp')`
  everywhere *except* the few places that render a monster's stats directly (below).
- **Seeding** (`js/brp-seed.js`) mirrors `js/seed.js`/`js/compendium.js` but is a separate, always-on
  mechanism rather than reusing `seedMonsters()`/`seedCompendium()` — those two hardcode
  `source:'Shadowdark Core'`/`system:'osr'`, so they can't seed BRP's own per-entry `source`
  (`data/seed-brp.json`'s `compendium` uses `source` to mean *power type*
  (`Magic`/`Mutation`/`Psychic Ability`/`Sorcery`/`Superpower`) or *equipment type*
  (`Weapon (Primitive|Historic|Modern|Advanced)`/`Armor`/`Shield`/`Medical Gear`/`Other Gear`) — it
  doubles as the Compendium's per-system Source filter, same mechanism the OSR seed's `source` powers,
  just genuinely populated per entry instead of one constant) or `system:'brp'`. `seedBrpMonsters()`
  replaces only the `'brp'`-tagged slice of `state.monsters` on every call (same
  preserve-other-systems rule as `seedMonsters()`); `seedBrpCompendium()` adds missing-by-name entries
  once, gated by `state.brpCompendiumSeeded` (mirrors `compendiumSeedVersion`, but there's only ever
  one version of this hand-maintained seed, so a bool suffices). Both are called unconditionally from
  `js/main.js`'s `init()` (no user action needed, unlike OSR's Settings → Reload/Reseed buttons) so a
  fresh install — or an old save missing the flag — gets the BRP content for free. Powers use a new
  Compendium category, `'Powers'` (`OSR.COMPENDIUM_CATEGORIES`), alongside the existing `'Spells'` —
  they're conceptually the same (a rollable ability with a body of rules text) but distinct enough
  in BRP's own terms (and shared across none of the OSR content) to warrant their own filter checkbox.
- **The shared monster modal** (`js/monster-form.js`) gained a third `.mf-schema-block[data-schema="brp"]`
  alongside `shadowdark`/`ose` — seven characteristic inputs, Armor/Armor note/Damage Bonus, and two
  free-text `<textarea>`s for Attacks/Skills (deliberately *not* the shared `.mf-atk-row` structured rows,
  which assume a to-hit bonus) — plus a new `.mf-nonbrp` class on the shared HD/LV, Alignment, XP, and
  Attack bonus fields so `showSchemaBlock()` can hide the OSR-only fields entirely for BRP (the shared
  Abilities section stays visible under both a relabeled heading, "Powers / Special Abilities", since
  BRP's Powers are free-text name+description pairs — the same shape). `collectMonsterForm`/
  `populateMonsterForm` branch on the schema the same way they already did for `shadowdark` vs `ose`.
  BRP has no "Paste text" parser (`js/monsters.js`'s `parseOne` requires an `AC …` line no BRP block
  has), so: `openMonsterModal()` opens straight into "Fill in fields" (Format preselected to BRP) when
  `currentSystem() === 'brp'`, and `openMonsterEdit()` does the same whenever the monster being edited
  is itself `source === 'brp'` — landing a user on an empty paste textarea would otherwise be a dead end.
- **Combat's tracker row and combatant detail** (`js/combat.js`) branch on `m.source === 'brp'`: the
  row drops the HD stepper (BRP has no Hit Dice) and shows `Armor`/`DB` chips instead of `AC`/`Sv`; the
  detail panel shows HP + computed Major Wound, Armor (+ its note), Damage Bonus, Move, and every
  characteristic the def has, then Attacks/Skills/Powers as plain paragraphs — no OSR-style
  attack/save/morale buttons, since `attacksText`/`skillsText` render as plain annotated text and the
  bare `NN%`/`1d6` inside them are *already* clickable rolls via the same `OSR.annotate(host, {…})`
  call every other branch uses (see the `PCT_RE` paragraph above) — no bespoke BRP roll handler needed.
  Scarlet Heroes damage translation (`applyDamageToSelected`/`updateApplyButton`) is explicitly bypassed
  for a BRP monster entry (falls through to plain HP damage even with the setting on) since it
  translates damage into Hit Dice loss, which BRP monsters don't have (`ent.monster.source === 'brp'` →
  `MonsterParse.hdNum(ent.hd)` is always `0`, which would otherwise read as "no HD left" and zero the
  monster's HP on any hit, regardless of damage rolled).
- **`brpResolveDb(text, damageBonus)`** (`js/combat.js`, exported on `OSR`) resolves the book's own
  `"+dm"`/`"+½dm"` damage-bonus shorthand in a BRP creature's `attacksText` into its actual Damage Bonus
  dice before display — e.g. a Knight's `"Long Sword 75%, 1D8+dm"` (its `damageBonus` is `"+1D4"`)
  renders and rolls as `"1D8+1d4"`, not `"1D8"` plus inert unclickable `"dm"` text. Applied wherever a
  BRP def's `attacksText` is shown: the Combat tracker row's attack chip, `renderCombatantDetail()`'s
  Attacks section (both `js/combat.js`), and the "Add monster" library hover preview
  (`monsterCardHtml()`, `js/monster-modals.js`) — **not** the Compendium's own generic weapon entries
  (`data/seed-brp.json`), which keep `"+dm"` literal since a weapon's damage bonus depends on
  whoever wields it, not a fixed creature. `brpDbDiceTerm()` pulls the *first* signed dice term out of
  `damageBonus` (handling the sourcebook's Unicode minus sign, `−`, alongside ASCII `-`) — for the
  handful of creatures with a form-dependent compound value (Centaur, Werewolf, Giant — e.g.
  `"+1D4 (human); +2D6 (horse)"`), every attack uses that first-listed value, which isn't always the
  textually-correct one for every individual attack (a known, documented approximation rather than
  hand-curating a per-attack override for a handful of entries). `brpHalveDiceTerm()` approximates
  BRP's "half damage bonus" weapons (page 21's `+½dm`) by halving the *die count* (minimum 1) rather
  than the rulebook's actual "roll the full bonus, halve the result" — the dice engine has no division
  operator to express that as a single clickable formula. Making the combined result (e.g. `"1d8+1d4"`)
  click as **one** roll (instead of `annotate.js` finding "1d8" and a separate stray "1d4") required
  extending `annotate.js`'s `DICE_RE` itself: its continuation group already allowed a trailing signed
  integer or `$Var` after the leading dice term (for `"1d6+$CON+2"`) and now also allows another full
  dice term, so any chain of dice/flat/`$var` terms — however many — is one span; `evalFormula`
  (`js/dice.js`) already summed multiple `NdM` terms correctly, this only taught the *text-matching*
  regex to recognize the same chains as one clickable unit. This is a general improvement (any sheet
  text with two dice terms glued by `+`/`-` benefits), not BRP-specific, even though BRP's own data —
  several creatures already had a literal `"1D3+1D6+dm"` in the book — is what surfaced the gap.

**Silent Legions (SL)** (`system: 'sl'`) is Kevin Crawford's Lovecraftian investigation game (Sine
Nomine): 3d6 attributes, descending AC, d8 Hit Dice, a d20 hit roll, 2d6 skill checks, a Slaughter
die, and a 0–100 Madness score. Its source PDF is **not** in the repo (`*.pdf` is gitignored) and the
repo is public, so the bundled data keeps the book's numbers but every description, ability, spell,
and rule body is a short paraphrase — never paste the book's prose in.

- **Monsters use the OSR `def` shape, not a BRP-style one of their own.** An SL stat block maps
  cleanly onto it (`ac.desc`, `hd`/`hdNum`, structured `attacks` with `toHit`, `moraleML`), so the
  Combat HD stepper, Populate by HD, Scarlet Heroes, and the generic attack/save/morale buttons all
  work unchanged. `source: 'sl'` adds four fields: `skill` (flat bonus to 2d6 checks), `madness` (the
  book's string — `'None'`, `'1'`, `'1d6'`, or `'None / 1d6'` for disguised / true form),
  `slaughterDie` (`'1d6'` default, `'None'` for attacks that never Slaughter), and `mundaneImmune`
  (the book's AC asterisk; each such def in `data/seed-sl.json` also starts with an `AC*` ability
  explaining it).
  `ac.asc` stays `null` — `acDisplay()` shows the descending number (plus `*`) for SL, and the shared
  `monsterMetaLine()` (`js/monster-modals.js`, used by both library lists) does the same.
- **Saves**: every SL monster saves on one target, `saveTargets: { Save: N }` / `savesText: 'N+'`.
  The templates use the book's formula, ⌈15 − HD/2⌉; the named entities keep the printed value even
  where it disagrees (Vampire, Cancer Man, Slasher). The fields form fills a blank Save from the
  formula.
- **HD/HP**: "1d4 hp" is stored as HD `'½'` (hp 2) and "1 hp" as `'0'` (hp 1) so `MonsterParse.hdNum`
  and Populate by HD treat them like other sub-1-HD monsters; otherwise `hp` is ⌊4.5 × HD⌋.
  `data/seed-sl.json` stores every field expanded (it used to be built from compact specs in a
  `.js` file). When you edit a def, keep `hdNum`, `hp`, `saveTargets`/`savesText`, `attacksText`, and
  `raw` consistent with each other; the "SL data" logic test checks the main ones.
- **Combat** (`js/combat.js`): `slHitNote()` appends "hits AC N or higher" (N = 20 − total, since SL
  hits on 1d20 + bonus + target AC ≥ 20; natural 1/20 override) to an SL monster's to-hit log line;
  `slDetailHtml()` adds **Skill** (`rollEntrySkill`, 2d6 + skill), **Slaughter** (`rollEntrySlaughter`,
  6+ → triple damage), and **Madness** (`rollEntryMadness`, rolls the value after any `/`, and notes
  the per-creature-type cap) after Morale; the tracker row gets a `Mad …` chip. These button classes
  are checked before `.roll` in `onDetailClick`, since `annotate()` also wraps the dice inside them.
- **Monster form**: a `data-schema="sl"` block (AC, Morale, Skill, Save, Madness, Slaughter die, an
  `AC*` checkbox). It keeps the shared HD and Attack-bonus fields and the structured attack rows;
  Alignment/XP carry `.mf-nonsl` and are hidden. SL has no paste parser, so `FIELDS_ONLY_SOURCES`
  (`['brp','sl']`, `js/monster-modals.js`) opens the add/edit modal in fields mode, same as BRP. The
  attack text now keeps a damage-less note (`"weapon +3 (by weapon)"`) for every format.
- **Characters**: a ` ```sl ` fence (attributes + `Madness: N`, plain text, not parsed for display)
  classifies the sheet. `ensureMadnessTracker(ch)` (`js/core.js`) creates `"Madness (Name)"` once,
  0..100, starting from `slFenceMadness(ch)` (`js/characters.js`); after that the tracker, not the
  fence, holds the current value. It's created from `createCharacter`, `saveEdit`/`renameChar` (via
  `renameMadnessTracker`, which also covers a sheet that just gained the fence), and
  `ensureConsumablesShape` (old saves); `deleteChar` removes it.
- **Compendium** (`data/seed-sl.json`'s `compendium`): Spells (`source` `'Spell Level 1'`…`'5'`), Disciplines
  (`'Powers'`/`'Discipline'`, one bullet per level), Rules (`'Sorcery'`/`'Combat'`/`'Vehicle'`), and
  Items (`'Weapon (Melee|Ranged|Firearm|Heavy)'`/`'Armor'`/`'Gear'`/`'Vehicle'`). Bodies link each
  other with `[Name]` refs; a logic test asserts every ref resolves to an SL entry.
- **Seeding** (`js/sl-seed.js`): `seedSlMonsters()`/`seedSlCompendium()`, gated by
  `state.slMonstersSeeded`/`state.slCompendiumSeeded`, exactly like the BRP pair.

Typing `[` + ≥2 chars in the sheet editor, `#notes-area`, or the entry's EasyMDE editor opens
`#comp-ac`, a name-substring autocomplete (`acFromTextarea` / `acFromCM`); ↑/↓/Enter/Tab/click →
`acAccept()` inserts `[Name]`.

Right-clicking a text selection in the rendered sheet (`#mode-view`) calls `openSelMenu`, which runs
the selection through `compResolve` (same exact→fuzzy lookup the hover popups use) and shows
`#sel-menu`: any matching entries first (each a `data-act="link"` item, with a `≈NN%` badge when it's
a fuzzy match), then an always-present `data-act="add-comp"` item ("Create new entry…" if there were
matches, else the original "Add … to Compendium"). Picking a match calls `linkSelToExisting(entry)`
directly — no editor. Picking "add-comp" stashes `pendingCompLink` ({charId, part, find}) and opens
the entry editor instead; `saveCompEntry` then calls `applyPendingCompLink(name)`. Either path ends
in `applyPendingCompLink(name)`, which `linkifyInText`-replaces the selected text in that character's
`body` (or the correct half of a `---`-split view) with `[name]` — using the entry's actual name, so
picking a match whose title differs from the selected text still relinks it correctly — and
re-renders. `charViewTarget(node)` maps a selection node to its character/column.

## Run / test / regenerate

```
# run the app
python3 -m http.server     # then open http://localhost:8000/ (file:// is not supported)

# tests (Node's built-in runner; no deps)
npm test                   # === node --test

# rebuild the monster library after editing data/bestiary_data.json or the converter
npm run convert-bestiary   # writes data/monsters.json

# rebuild the spell seed after editing data/spell_data.json or the converter
npm run convert-spells     # writes data/spells.json

# rebuild the table library after adding/editing a data/tables/*.csv
npm run convert-tables     # writes data/tables.json
```

Never hand-edit the generated files (`data/monsters.json`, `data/spells.json`, `data/tables.json`):
edit the source data or the converter, run it, and commit the result.

## State model

- One object, `OSR.state`, shaped by `STATE_DEFAULTS` (both in `js/core.js`). It is the current
  **campaign** (`OSR.campaignId`, one of `OSR.campaigns`).
- **Storage is IndexedDB** (`js/store.js`, database `osr_store`): the `docs` store keeps each
  campaign as documents (JSON strings), `'<campaignId>/campaign'` plus one `'<campaignId>/<system>'`
  for each of `OSR.SYSTEMS`; the `meta` store keeps the per-device campaign list (`'campaigns'`:
  `[{ id, name, createdAt, primary }]`) and `'activeCampaignId'`; the `blobs` store is for the Maps
  PRs. `splitState(state)` cuts `OSR.state` into those documents: characters (by
  `charSystemKey()`), monsters and Compendium entries (by `system`), and the HP/Wounds/Madness
  trackers of each character go to their system's document; everything else — log, Journal,
  conditions, settings, combat, seed flags, trackers no character owns — goes to `campaign`, with
  `order: { characters, consumables }` (ids). `joinState(docs)` reverses it: characters and trackers
  come back in their saved order, monsters and Compendium entries in system order (every list of
  them is filtered to one system, so only the order inside a system matters).
- **`load()` is async** (`init()` awaits it). It reads the campaign list, then the active campaign's
  documents (`loadCampaign(id)`, which also sets `OSR.campaignId` in the same tick as `OSR.state`).
  The first run after the move to IndexedDB migrates the old `localStorage['osr_manager_v1']` into a
  campaign "Default" (`primary: true`). The old key, and the campaign list, are written only after
  that campaign's documents are on disk; if the write fails, the next boot migrates again. If
  IndexedDB does not open, `init()` shows `#load-error` and stops.
- **`save()` stays synchronous** and returns `true`: it queues one write (saves in the same tick
  share it) of only the documents whose JSON changed since the last write (`lastWritten`), in one
  IndexedDB transaction. Code that must know the write worked awaits **`saveNow()`** (Promise of a
  boolean) or `flushSave()` (waits for queued writes): Import, a content pack, a pull from Dropbox,
  and a campaign switch. A failed write logs a warning; it does not alert.
- **`ensureStateShape()`** is the migration hook. It runs after `load()` and after import. When you
  add a new field to `state`, add its default there (and to `STATE_DEFAULTS`) so old saves and
  imported files get backfilled. Per-entry backfills (e.g. `entry.statuses = []`) also go here.
- **Export is automatic.** `exportData()` serialises the whole `state`, so any field you add to
  `state` is included in Export/Import with no extra code — and in the Dropbox files. So never
  put per-device or secret data in `state` (the Dropbox sync keeps its own keys, see below).
  When the campaign has map images, Export first asks (`#export-modal`): with **Include map
  images**, `exportZip()` writes a .zip (vendor/fflate) with that JSON as `campaign.json` and each
  image as `maps/<blobId>.<ext>`; without, it is the plain .json. Import of a .zip
  (`importZip()`) stores the images under their own blob ids first, then imports `campaign.json`
  like a .json file. A Merge import adds the file's scenes with new ids.
- `save()` also calls `OSR.dropboxNoteSave()` (`js/dropbox.js` — a no-op unless Dropbox sync is on).
  **Replace-all** loads — Import → Replace all and a pull from Dropbox — go through
  `OSR.replaceState(data)` (`js/io.js`), which shares `finishLoad()` (migrate, save, re-render every
  panel, the Journal editor included) with a merge import. Both return a promise of `saveNow()`'s
  result.
- **Campaigns** (`js/campaigns.js`): the header's `#campaign-select` switches, and its last option
  "+ New campaign…" creates one (named with `prompt()`); Settings → Campaign has Rename and Delete
  (never the last campaign). `switchCampaign(id)` awaits `flushSave()` and
  `dropboxBeforeCampaignSwitch()`, then `loadCampaign(id)`, seeds an empty campaign with
  `seedMissing(false)` (`js/seed.js`: every system's Bestiary and Compendium, no pregens), and
  re-renders every panel. Theme and System are in `state.settings`, so they are per campaign.
- **Merge import** (`importData`, Cancel on its Replace/Merge question) goes through
  `mergeCompendium`/`mergeMonsters` (`js/io.js`): each item keeps its own `system` (missing → `'osr'`),
  and a duplicate is skipped only inside the same system — same `ref` (a content pack's stable id),
  or for a Compendium entry the same name + category. An item with a `seedRef` (a seeded item in an
  export) replaces the campaign's item with the same `seedRef` instead (`replaceSeeded()`), so an
  export with newer seeded items updates them; the user's own item with the same name stays.
- **Content packs**: a file with a `pack: { name, system }` header (plus `compendium`/`monsters`) is
  handled by `importPack` instead — merge only, never the Replace question, one confirm, then
  `OSR.setSystem(pack.system)`. `OSR.saveNow()` resolves to `false` when the browser refuses (storage full);
  `importPack` then removes what it added and alerts, rather than keep data a reload would lose.
  A pack's items become seed copies (`seedRef` = the item's `ref`), and `OSR.addToSeed()` adds the
  pack to the system's seed store too, so every other campaign (and every device, through Dropbox)
  is offered it under Settings → New defaults. The UA3 data tools (a separate, private project that reads
  the user's own PDFs) write such a pack for `ua3e`; its book text must never be committed here.
- Entries created at runtime (`addCharEntry`, `addMonsterEntry`) must include every field
  `ensureStateShape` expects — it only runs on load/import, not on new entries.
- **Trackers ("consumables") are campaign-global**: `state.consumables`, not `character.consumables`
  (older per-character saves are migrated by `ensureConsumablesShape()`). Each character owns one
  `HP (Name)` tracker — `hpTrackerLabel()` / `ensureHpTracker()` create it, rename/edit keep the
  label in sync, delete removes it. Combat HP for a character reads/writes that tracker via
  `hpConsumable()`.
- **The Journal is campaign-global** too: `state.notes` (old `character.notes` folded in by
  `ensureStateShape`). It's an EasyMDE editor (`js/notes.js`'s `wireNotes` → `buildMDE` in
  `js/mde.js`, the shared builder also used by the Compendium editor). Plain Enter → `submitNote()`
  (logs the text via `pushNote('Journal', …,
  {md:true})` and clears); Shift-Enter is a newline; the unsent draft persists in `state.notes`.
  `pushNote`'s `{md:true}` renders the entry as Markdown in the log (`.log-md`).
- The Character tab can show two characters at once (`state.activeId` + `state.activeIdB`), rendered
  one per column by `renderCharView()`; a lone character's sheet is split into two columns at the
  first `---` line.

## Rendering & DOM conventions

- **No virtual DOM.** `render*()` functions rebuild `innerHTML` from `state`. After mutating state,
  call `save()` then the relevant `render*()`. In combat, `renderCombat()` = bar + tracker + detail
  + apply-button; call it after structural changes, or the narrower `renderTracker()` /
  `renderCombatantDetail()` for local ones.
- **HTML is built by string concatenation.** Any value derived from user input or data files MUST go
  through `escapeHtml()`. Attribute values too.
- **Event handling is delegation.** Listeners are attached once to stable containers in `js/main.js`'s
  `wire()`, which calls each subsystem's own `wireX()` (`wireCombat`, `wireConsumables`, `wireNotes`,
  `wireSettings`, `wireCharacters`, `wireIO`, `wireDicePanel`, `wireCompendiumEntries`,
  `wireCompendiumPopups`, `wireRollPopup`, `wireMonsterBrowser`, …); handlers use
  `e.target.closest('.some-class')`. Don't
  attach per-element listeners inside `render*()`.
- **Visibility is toggled with `el.hidden = true/false`**, not `style.display`. Gotcha: the `[hidden]`
  attribute loses to any CSS rule that sets `display:` (this bit us with `.modal { display:flex }`).
  If you give an element an explicit `display` in CSS, also add `.thing[hidden] { display:none }`.
- Popups (`#ctx-menu`, `#mm-preview`) are closed by capture-phase `document` listeners
  (`scroll`, `mousedown`). Those listeners **must whitelist the popup's own subtree**
  (`e.target.closest('#ctx-menu')`) or interacting with the popup dismisses it.

## The dice engine (`js/dice.js`)

- `evalFormula(str)` → `{ total, detail, normalized, dice, flat }` or `null`.
  Grammar: `NdM`, `+`/`-` chains, `kh|kl|dh|dl` + count, `d%`. A string with no dice becomes
  `1d20 + <it>`. `dice` is every individual die kept (`{value, sides, sign}`); `flat` is the signed
  sum of constant terms — both used by Scarlet Heroes translation.
- `doRoll(formula, source, vars)` = resolve `$Name` refs against `vars` (`substituteVars`) + eval +
  `pushLog` + set `lastRoll` (drives the "Apply damage" button). An unresolved `$Name` is rejected
  explicitly (`Invalid: … (unknown $Name)`) rather than handed to `evalFormula` — its regex scan
  skips over unmatched text instead of failing, so `1d6+$NOPE` would otherwise silently roll `1d6`.
- `pushLog(source, formula, total, detail)` — a roll line. `pushNote(source, text, detail)` — a
  non-roll line (status/side/library events), rendered without the `= total` column.
- Character-sheet auto-linking: `annotate(rootEl)` walks text nodes and wraps matches of `DICE_RE`
  / `MOD_RE` / `VARREF_RE` in `<span class="roll" data-formula>`. It skips `<code>`, `<pre>`, `<a>`.
  Run it after any `marked.parse()` whose output should have clickable dice.

### Character-sheet variables (`Name: ±N`) and `$Name` in formulas

`scanVariables`/`findMatches`/`charVars`/`annotate` live in `js/annotate.js`; `substituteVars` and
`doRoll`'s `$`-handling live here in `js/dice.js`; the `$` autocomplete (`acFromTextarea` /
`acFromFormulaInput`) lives in `js/compendium-popups.js`.

- `scanVariables(text)` finds `Name: ±N` declarations in a string: the value is the optionally-signed
  integer right after the colon; parsing it stops at the first space — or a boundary (a comma,
  semicolon, `|`) or the string's end — so `STR: +1 (14)` is `STR` = +1 (the `(14)` is never looked
  at) and `Cost: 5 gp` is `Cost` = 5. Only a number glued directly onto more text with **no**
  separating space (`19` in `HP: 19/19`) fails to match at all. The name is whatever sits between the
  previous such boundary and the colon. `findMatches()` calls `scanVariables` to add a
  `<span class="var-name">` for the name and flag the value's `<span class="roll">` with `.var-value`
  (it's still a normal `1d20+N` roll, per the existing bare-modifier rule — just visually flagged as
  a tracked variable too; note the value may be a plain unsigned integer, e.g. `Survive: 0`, so the
  roll's formula gets an explicit `+` prefixed when the value itself has no sign — `'1d20' + '0'`
  would otherwise concatenate into `1d200`, a d200).
- `charVars(ch)` returns a character's variables as `[{name, value}]`, scanned the same way the
  rendered sheet is (`marked.parse(ch.body)` into a detached element, then `scanVariables` per text
  node) — so a name split from its colon by markdown emphasis (`**CON**: +1`, where "CON" and ": +1"
  land in separate DOM nodes) isn't picked up, matching what View mode actually highlights. Last
  occurrence of a name wins.
- `$Name` in a formula (e.g. `1d6+$CON+2`) is resolved by `substituteVars(formula, vars)` before
  `evalFormula` ever sees the string; a leading sign folds into the variable's own value rather than
  duplicating it (`+$CON` with CON=-1 → `-1`, not `+-1`). In sheet text, `DICE_RE`'s chain accepts a
  signed `$Name` alongside a signed integer (so `1d6+$CON+2` is one span); a bare `$Name` on its own
  (no dice) is `VARREF_RE`, relying on `evalFormula`'s own "no dice → 1d20 + it" fallback.
- Which character's variables apply: sheet-embedded rolls use `charViewTarget()`'s character (so
  column B in two-character view rolls column B's variables); combat detail rolls use
  `combatCharFor(entry)` (`null`/`[]` for a monster); the Dice Roller's custom-formula box and preset
  grid use the primary "Character" (A) slot (`activeChar()`).
- `$` autocomplete: `acFromTextarea` (sheet editor) and `acFromFormulaInput` (`#custom-formula`) open
  `#comp-ac` in `compAC.mode: 'var'` the moment a `$` is typed (0 chars needed, unlike `[`'s 2). Note
  the sheet editor is always a plain `<textarea>` (never CodeMirror), so `$` is handled only in
  `acFromTextarea`/`acFromFormulaInput` — `acFromCM` (Notes / Compendium body, both CodeMirror via
  `buildMDE`) stays `[`-only, out of `$`'s scope. `acAccept` keeps the mode's own insert shape: `[Name`
  → `Name]`; `$Name` → replace the typed query with the corrected identifier (spaces stripped, case
  as detected) — the `$` itself is left in place, it's not part of the replaced range.
- A `.roll` span's rendered *label* always has the `$` stripped (`findMatches()` strips it when
  building `label`, separately from `formula`, which keeps it — see "the `$` is stripped..." test) —
  `1d20+$AB+$STR` reads as `1d20+AB+STR`. Its `title` tooltip instead expands each `$Name` to
  `Name (value)` via `formatFormulaDisplay(formula, vars)` (an unresolved one shows `Name (?)`) — but
  only when the caller passed the relevant `vars` to `annotate(root, opts)`; `opts.vars` threads
  through to `processTextNode`, which is where the tooltip text is actually built. Every `annotate()`
  call site passes the right character's `charVars()`: `characters.js`'s `renderCharView()` annotates
  each column **separately** with that column's own character (so two-character view doesn't leak
  Character A's variables into Character B's tooltips, or vice versa); `combat.js`'s
  `renderCombatantDetail()` uses `charVars(combatCharFor(ent))` (`[]` for a monster); the Compendium
  hover popups (`compendium-popups.js`'s `renderPop()`) fall back to `charVars(activeChar())`.

### Right-click "roll with modifiers" popup (`js/dice-ui.js`)

Right-clicking any `<span class="roll">` (sheet, combat detail, Compendium hover popups) or a Dice
Roller preset button opens `#roll-popup` (`openRollPopup` / `wireRollPopup`) instead of rolling
immediately: a flat modifier field, plus a `<select>` per stacked variable (none picked by default) —
picking one appends another `<select>` (excluding already-picked names) so they chain; `rollPopupFormula()`
appends the modifier then each pick's signed value to the base formula before `doRoll`. `rollOwnerFor(el)`
picks the variable pool + log source the same way the plain-click handlers do (`#mode-view` →
`charViewTarget`, `#combatant-detail` → `combatCharFor(selectedEntry())`, else `activeChar()`). In
`#mode-view`, right-clicking a `.roll` span is handled here, *not* by the selection-based "Add … to
Compendium" menu — that handler bails immediately when the target is inside `.roll`.

## The monster parser (`js/monsters.js`)

Pure — no DOM, no `state`, no storage. Exposes `MonsterParse` on `window` and `module.exports`:

- `parseMonsters(text)` → `[def, …]`. Splits on blank lines **and** on detected name lines
  (`splitBlock`), so back-to-back stat blocks parse.
- `parseOne(block)` → one `def` or `null`. Auto-detects `shadowdark` / `ose` / `unknown`.
- `hdNum(hd)` → number (`'½'`→0.5, `'9*'`→9, `''`→0).

`def` shape: `{ id?, name, source, desc, raw, ac:{asc,desc,thac0}, hd, hdNum, hp, move, align, xp,
moraleML, atkBonus, attacksText, attacks:[{label,count,toHit,damage,note,raw}], stats|null,
saveTargets|null, savesText, abilities:[{name,text}] }`.

Notes on the tricky bits (there are tests for all of these):
- Attacks split on `" + "`, `" or "`, `" and "`. A spaced sign (`bite + 9`) is normalised without
  breaking the `" + "` separator. The damage `(...)` is the one containing dice, so `(near)` /
  `(close/near)` range annotations are skipped.
- Shadowdark abilities are split by a Title-case-name heuristic that tolerates a parenthetical
  (`Scorpion Sting (CHA Spell). …`). OSE abilities split on `▶`.
- If you change parsing behaviour, update `test/monsters.test.js` and re-run `npm run convert-bestiary`
  (the seed is produced by this parser).

## The Bestiary tab, the shared monster modal, and the PL generator

The **Bestiary** tab (`js/monster-browser.js`, `#tab-bestiary`) is a persistent, filterable view of
`state.monsters` — same pattern as the Compendium tab (`filterMonsters()` factored out of the old
`libMatches()` so both this tab's inputs and the modal's own `#mm-search`/`#mm-hd-min`/`#mm-hd-max`
share one filter+sort implementation). Its **+ New monster**, and Combat's own **+ Add monster…**,
both open the *same* `#monster-modal` (`OSR.openMonsterModal()`) — there is only one add flow.

**The shared modal's two input modes** (`js/monster-modals.js`): a `.mm-mode-toggle` switches between
`.mm-mode-paste` (the original raw-stat-block textarea + `MonsterParse.parseOne`/`parseMonsters`) and
`.mm-mode-fields` (`js/monster-form.js`'s structured form). `setMonsterMode(root, mode)` /
`activeMonsterMode(root)` operate on whichever `.mm-mode` wrapper is passed (`#mm-mode` for add,
`#me-mode` for edit) — the same toggle code serves both modals. `openMonsterEdit(id)` populates
**both** the raw textarea and the fields form from the monster's current `def`, defaulting to paste
mode (today's behavior) but letting you switch either way; `saveMonsterEdit()` reads whichever mode
is active. `ensureMonsterFormBuilt(host)` injects `OSR.monsterFormHtml()` into a host div and wires it
exactly once (`host.dataset.built`) — `populateMonsterForm`/`collectMonsterForm` are called on every
open/save after that, never touching the listeners again.

**`js/monster-form.js`** is schema-aware (a `<select>` toggles Shadowdark vs OSE field blocks via
`.mf-schema-block[data-schema]`) and produces/consumes exactly the `def` shape from `js/monsters.js`.
Attacks and abilities are dynamic rows (`.mf-atk-row`/`.mf-abil-row`, `+ Add` buttons, delegated
`✕` removal) — `collectMonsterForm` *derives* `attacksText`/`savesText` from those rows/stat inputs
(same formatting the parser itself produces) and synthesizes a best-effort `raw` stat-block string
(`buildRawFromDef`) so a field-built monster displays, and round-trips through "Paste text" mode,
the same as a pasted one. The form's markup uses **class selectors, not ids** (`.mf-f-name`, etc.) —
since `populateMonsterForm`/`collectMonsterForm` always take a `root` element, the identical template
can be injected into both `#mm-fields-host` (add) and `#me-fields-host` (edit) with no id collisions.

**The generator** (`js/monster-browser.js`'s `generateMonster(pl, mutationCount)`) implements the
Shadowdark core rulebook's "Monster Generator" (pg 190, a d20 table of `{offset, quality, strength,
weakness}` — `LV = max(0, pl + offset)`, `atkBonus = LV`, `AC = pl + 10`, HP = `LV`d8 rolled (min 1),
one attack entry with a rolled `1d4` count dealing `1d8`) and "Monster Mutations" (pg 191, **three**
separate d12 columns — `MUTATION_TABLES[0..2]` — rolling N mutations uses columns `1..N` in that
order, per the rulebook's "Mutation 1/2/3" headers). Quality becomes part of `desc`; Strength,
Weakness, and any mutations become `abilities` entries so they render like any other special ability.
Generating never adds to the library directly — it calls `OSR.openMonsterModal({ prefill: generateMonster(pl, n) })`,
landing the roll in the fields form (with an editable placeholder name) for review before Save.

## Combat's "+ Populate by HD…" (`js/combat-populate.js`)

Combat's `#cb-populate-hd` button opens `#populate-hd-modal`, which spends a total Hit Dice budget on
monsters drawn from `OSR.monstersForSystem()` (the same library the Bestiary tab and the "Add
monster…" modal read), with an optional exact monster count; if the count is left blank, the
algorithm decides how many monsters to use. The budget is always spent **exactly** — never rounded or
left over — or the modal reports why it can't (e.g. asking for an exact count the library's HD values
can't reach) rather than silently fudging the numbers.

Everything is tracked in half-HD **integer units** (`effectiveHdUnits(d) = round(hdNum * 2)`, floored
at 1) instead of floats, so the planner is exact-integer coin-change, not floating-point accumulation.
This is also where "a 0 HD monster counts as 0.5 HD" lives: `Math.max(1, …)` means a monster whose own
HD is literally `"0"` (Shadowdark/OSE's weakest tier) still costs 1 unit. `monstersByUnit()` groups the
current library by that cost; `pickUnitPlan()` backtracks a random combination of units off a
feasibility table (`feasibleSums`/`feasibleSumsWithCount` — classic unbounded coin-change DP, with a
count dimension added only when an exact monster count was requested) until it lands on the budget
exactly, then a random monster sharing each picked unit's HD is chosen (so same-HD monsters mix
species rather than always repeating one). `buildHdPopulatePlan()` is the pure entry point (`monsters,
totalHd, count -> {ok:true, picks, totalHd, count} | {ok:false, reason}`) — the modal calls it and
renders one proposal row per pick (`#php-confirm`/`renderPlanList()`, not grouped, so each monster gets
its own controls). `#php-total-hd` has no default value — the budget is never silently prefilled.

Each proposal row hovers into the same library preview card the "Add monster" modal's list uses
(`li.dataset.id` + `OSR.showLibPreview()`/`hideLibPreview()`, `js/monster-modals.js` — shared, not
duplicated) and carries its own reroll button (`.php-row-reroll`, a dice-d20 icon) that calls
`rerollPick(idx)`: swaps just that one pick for a different monster sharing the same effective HD
(`effectiveHdUnits` match, excluding the current monster itself), re-rendering only the list — the
overall budget/count never change since the replacement costs the same HD. The button is disabled when
no other monster shares that HD. `OSR.addMonsterEntry()` is only called per pick once the user confirms
(`#php-confirm-add`) — the top-level Reroll/Back regenerate the whole plan or return to the inputs
without touching combat.

## The converter (`scripts/convert-bestiary.js`)

Reuses `MonsterParse.parseOne` — it rebuilds a Shadowdark stat block from each structured bestiary
entry, parses it, then attaches the entry's `actions` as `abilities` and Title-cases the name. Runs
`main()` only under `require.main === module`; also exports `{convert, titleCase, slug, statLine,
buildRaw}` for tests. Flags: `--dry-run`, `--no-merge` (drop preserved non-Shadowdark entries),
`--out`, `--js-out`.

## The Maps tab (`js/maps.js`, `js/grid.js`)

- **Scenes** are `state.scenes` (`ensureSceneShape()` from `ensureStateShape()`):
  `{ id, name, system, imageBlobId, imageType, imageUrl, width, height, grid, hexcrawl, tokens,
  drawings, pins }`, where `grid` is `{ type: 'square'|'hex', orient: 'flat'|'pointy', size,
  offsetX, offsetY, unitsPerCell, unit, show, locked }`. Each belongs to one system
  (`splitState` puts it in that system's document) and shows only under that System;
  `state.activeSceneIds[system]` is the open one.
- **Images** are blobs in IndexedDB (`OSR.store.putBlob(id, { bytes, type, width, height })`,
  `bytes` an ArrayBuffer — fake-indexeddb cannot store a jsdom Blob). `storeImage()` runs
  `OSR.decodeImage()` first (canvas: scaled to `MAX_SIDE` 8192 px, encoded as WebP, or PNG where the
  browser cannot). A scene is made from a file (`#scene-modal`), a paste (Ctrl/Cmd+V on the Maps
  tab, not in a text field), a drop on `#map-wrap`, or an address: `fetch()` it, and if that fails
  (CORS, a dead link) keep only `imageUrl` with a warning in `#map-status` — that image is in no
  storage. Duplicate shares the blob; Delete removes it with the last scene that shows it.
  `imageHref()` makes one object URL per blob (`images` map); a blob missing here is fetched with
  `OSR.dropboxFetchBlob()` (`js/dropbox.js`).
- **Rendering** is one `<svg id="map-svg" preserveAspectRatio="none">`, rebuilt by `renderScene()`
  only while the tab shows (a hidden SVG has no size, and an image downloads only when it shows):
  layers image, grid, drawings, pins, tokens, overlay. The grid is a `<pattern>` for squares, and a
  path of `MapGrid.cellsIn()` (the visible hexes, at most `MAX_GRID_CELLS`) clipped to the image for
  hexes. Line widths are one screen pixel in map units (`viewBox` width / box width).
- **View**: `views[sceneId]` (memory only) = the viewBox, kept at the box's aspect ratio
  (`viewOf()`), so `screenToMap(clientX, clientY, rect, view)` is a plain scale. `OSR.mapRect()` is
  the SVG's box (tests replace it: jsdom has no layout). Pan: drag with the hand tool, the middle
  button, or Space held. Zoom: the wheel, by its distance (`Math.pow(1.0015, deltaY)`), around the
  pointer, between 20 map px and 6 × the image (`zoomLimits()`). **Fit** forgets the view.
- **Tokens** (`js/tokens.js`) are in `scene.tokens`: `{ id, iconId, x, y, size, color, label, link }`,
  `(x, y)` the center in map px, `link` null, `{ kind: 'combat', entryId }`, or
  `{ kind: 'character', charId }`. The icons are `OSR.data.tokenIcons` (path data only, drawn in
  the app's own SVG with `fill: #fff` on a circle of `color` — never a downloaded SVG). A palette
  click (`#token-palette`) or a **From combat** button (`#token-from-combat`: the combat entries
  with no token on this scene, `addTokenForEntry()`, icon guessed by name with `tokenIconFor()`)
  adds one at the view's center. `snapTokenPoint()`: an odd size on squares centers on a cell, an
  even size on a corner, hexes on a hex center. With the hand tool, `js/maps.js` hands pointer
  events to `tokenPointerDown/Move/Up`: press a token to select and drag it (snapped on release by
  the token under the pointer, so a group keeps its shape; Alt: free), Shift+click to add to the
  selection, Shift+drag on the map for a box, Alt+click on the map for a ping (`tokenPing()`, a
  CSS animation in the overlay, removed after 2 s, never saved). The selection is in memory
  (`selectedTokenIds()`). `#token-edit` sits over the map (absolute), so showing it on
  pointer-down does not move the map under the pointer; the map's key handler ignores keys from
  its fields. Delete/Backspace on `#map-wrap` deletes the selection.
- **More icons** (`js/icons.js`): the search box (`#icon-search`) loads
  `data/game-icons-index.json` on first use and ranks matches with `searchIcons()` (every word in
  name, id, or author; a name that starts with the query first; at most 40). A click on a result
  (`useIcon()`) fetches `ICON_URL + id + '.svg'`, keeps only its path data with
  `iconFromSvg(text, id, false)` (other elements and attributes dropped; a transform, another
  viewBox, or odd path data refused with a message), stores `{ id, name, author, paths }` in
  `state.customIcons` (the campaign document, so it syncs), and adds a token. `OSR.allIcons()` =
  presets + custom icons is what tokens, the palette, and the Settings credits use;
  `ensureCustomIcons()` drops malformed entries from imports. A preset or an icon already stored
  is never fetched.
- **Linked tokens** show the entry's name, side (ring color), HP (`.map-token-hp`, a dashed
  circle), turn (`.map-token-turn`), and down state, read live from `state.combat` with the combat
  helpers (`entryHp`, `entryMaxHp`, `entryDown`, `acDisplay`, `charQuickAC`). A character token's
  HP is its HP tracker, or the sheet's HP while the tracker is 0/0. `removeEntry()` and
  **Clear** (`js/combat.js`) call `OSR.unlinkTokens(ids)` before the entries go: a character's
  token links to the character, any other keeps the entry's name as its `label`. The hover card
  (`#token-card`) shows the same data on `mouseover`. Settings credits the icon authors
  (`#set-token-credits`).
- **Drawings** (`js/drawings.js`) are in `scene.drawings`: `{ id, kind, points | x,y,w,h | x,y,text,size,
  stroke, fill, width, opacity }` in map px, so they move and zoom with the map; `width` and a
  text's `size` come from the draw bar's px times the zoom at the time. The draw tools hand pointer
  events to `drawPointerDown/Move/Up`: pen (simplified on release with `simplifyLine`, Ramer–
  Douglas–Peucker, ε = 1.5 screen px), line, rect, ellipse (drag), polygon (click corners; the first
  corner, a double-click — `detail` 2 — or Enter closes; Escape cancels), text (`prompt()`), eraser
  (deletes the drawing under the pointer on down and on each move). With the hand tool, tokens come
  first, then `drawSelectDown` selects and drags a drawing; Delete removes it. **Clear drawings**
  asks, and is one undo step. The draw bar (`#map-draw-bar`) shows for the draw tools but not the
  eraser; its style is in memory.
- **Pins** (`js/pins.js`) are in `scene.pins`: `{ id, x, y, compendiumId }`. The pin tool
  (`addPin()`) makes a pin and a Compendium entry `{ category: 'Journal', source: 'Maps', system:
  currentSystem() }` named "<scene> — Location N" (or "— Hex 0412" in hexcrawl mode, where the
  pin snaps to the hex center), unique in the system, then opens its editor (`openCompEntry`). So a
  note is listed, searched, and `[linked]` like any entry. With the hand tool (after tokens): a click
  opens the note's popup (`openCompPop(name, pinElement)`, pinned so it stays), a double-click
  (`detail` 2) its editor, a drag moves the pin. `#pin-edit` (over the map's bottom edge): **Edit
  note**, **Delete pin** (also Delete), **Delete pin and note** (asks; undo brings the pin back, not
  the note). A pin whose entry is gone draws gray (`.is-orphan`) and says so.
- **Hexcrawl mode** (`scene.hexcrawl = { on, explored: ['q,r', …], coords }`, hex grids only —
  the grid panel's checkboxes are disabled on squares, and the explore tool hides): unexplored
  visible hexes get a shade (`.map-unexplored`, under the grid lines); the binoculars tool
  (`toggleExplored()`) marks a hex explored or not. **Hex numbers** (`coords`) label each visible
  hex with `MapGrid.hexLabel()`, counted from `MapGrid.labelOrigin()` (the first whole hex in the
  image's top-left, so cut-off edge hexes get no number), only when a hex is at least 34 screen px.
- **Pop-out window** (`#map-popout` → `popOut()`): `window.open('?view=map', 'osr-map', 'popup,…')`,
  registered in `mapWindows`. There, `init()` runs `initPopout()` (`js/main.js`) instead: no data
  fetch, no `load()`, no seeding, no Dropbox. `attachToMain(window.opener.OSR)` makes `OSR.state`,
  `OSR.campaigns`, and `OSR.campaignId` getters onto the main window's, shares `OSR.data`/`OSR.seeds`,
  and forwards `save`, `saveNow`, `flushSave`, `pushNote`, the history functions, `dropboxFetchBlob`,
  and `renderCompendium` to it. So both windows edit one state, saved and synced by the main window
  only, with one undo history. `wirePopout()` wires only Escape, the Compendium editor and popups,
  and the map modules — never `wireDropbox`, because the Dropbox settings in `localStorage` are shared
  and a second sync pass would collide. Every `save()` in the main window calls `notifyMapViews()`
  (`js/core.js`), which redraws each open pop-out and, for a change made in a pop-out, the main
  window's own map (coalesced to one redraw per tick, never during a drag). The main window's
  `pagehide`, or a pop-out's once-a-second check of `opener.closed`, calls `mainWindowClosed()`:
  `#map-popout-closed` covers the map and offers **Open the app here** (wired by that function
  itself, since with no main window nothing else is wired). CSS `.map-popout` hides the tabs, the
  header actions, the rail, and the log.
- **Undo/redo** (`js/history.js`): every scene change goes through `OSR.saveScene(sc)` instead of
  `OSR.save()`: it saves and records `{ before, after }` as JSON of the scene's `name, grid,
  hexcrawl, tokens, drawings, pins` (`trackScene()` from `renderMaps()` takes the first "before").
  Undo/redo restore one of them (a token linked to a combat entry that is gone comes back
  unlinked). A new change drops the redo steps; at most 200 steps; one history for each scene, in
  memory. `rebaseScene()` (from `unlinkTokens()`) moves "before" past a change made from Combat, so
  undo never re-links a token. `finishLoad()` and a campaign switch call `resetHistories()`. The
  keys are on `document`, only on the Maps tab, never in a form field or with a modal open. The keys
  and buttons call `OSR.undoScene`/`OSR.redoScene`, so a pop-out uses the main window's history.
- **Tools** (`.map-tool` buttons anywhere in `.map-toolbar`, `tool`): pointer events on the SVG, moves and ups on `window`.
  `measure` draws a line and puts `measureText()` ("3 cells · 15 ft", `MapGrid.distance`: a square
  diagonal counts 1) in `#map-status`. `calibrate` drags a rectangle over `#grid-span` × `#grid-span`
  cells and sets the grid from it (`MapGrid.gridFromRect()`); then arrow keys on the focused
  `#map-wrap` move the offset by 1 px (Shift: 10). `grid.locked` blocks both and disables the grid
  fields. The grid fields (`#map-grid-panel`) change the grid by hand.

## The Tables tab (`js/tables.js`)

Read-only, filterable browser over a static random-table library — no `state` field, no CRUD, unlike
the Bestiary/Compendium above. `OSR.data.tables` (`data/tables.json`, GENERATED from
`data/tables/*.csv` by `scripts/convert-tables.js` — see "The converter" pattern above) is read
directly by `library()` in `js/tables.js`; there's nothing to seed into `state` and nothing to
export/import. Each table def is `{id, name, tag, formula, entries:[{range, lo, hi, text}]}` — `id`
is the CSV's filename slug (e.g. `"river_and_coast"`), `formula` is a dice-engine formula string taken
verbatim from the CSV's header cell (`"d100,Details"` → `"d100"` — not hardcoded to d100, so a future
table CSV can use any formula `OSR.evalFormula` understands, e.g. `"2d6"`), and each entry's `lo`/`hi`
are the inclusive roll range that row covers (a bare `"01"` → `lo:hi:1`; `"00"`, seen after `"98-99"`,
is percentile-dice shorthand for the *top* of a d100 range and parses to `100`, never `0` — see
`parseRange` in `scripts/convert-tables.js`).

**Tags** (`renderTableTags`) are derived at render time — `Array.from(new Set(library().map(t =>
t.tag))).sort()` — not hand-maintained as a separate constant, so the tag-checkbox filter row
(`#tbl-tags`, same checkbox/right-click-to-isolate pattern as the Compendium's `#comp-cats` — see
"The Compendium" above) always exactly matches what the data actually uses. Keep it at **10 tags
or fewer** (an explicit design constraint, not enforced elsewhere) — this repo's own table set uses
6 (`Wilderness`, `Aquatic`, `Underground`, `City`, `Tavern`, and `Silent Legions` for the one d20 table,
`sl_monster_qualities.csv` — `test/tables.test.js` checks each table covers 1..N of its own single
die, not a hardcoded d100); the per-CSV mapping to a tag lives in
`TAG_MAP` inside `scripts/convert-tables.js`, so adding a table CSV means adding it there too (the
converter throws if a filename has no `TAG_MAP` entry).

**Rolling** (`rollTable`): `OSR.evalFormula(t.formula)` (the same engine as the Dice Roller/sheet
rolls) gives the total; the matching entry is whichever `lo <= total <= hi`; the result is logged via
`OSR.pushLog(t.name, t.formula, total, entry.text)` — same Session Log every other roll in the app
uses. Each `<details>` row (`.tbl-row`) is native HTML, not a JS accordion — expand/collapse is the
browser's own summary-click behavior. `tblOpenIds` (a `Set`, module-scoped like the Compendium's
filter state — cleared by the test seam's `reset()` via `resetTableFilters()`) tracks which rows are
expanded via a **capture-phase** `'toggle'` listener on `#tbl-list` (`<details>`'s `toggle` event
doesn't bubble, but capture-phase delegation doesn't need bubbling — it walks down to the target
regardless), so a re-render from typing in the search box or rolling a different table never
collapses a row the user left open. The Roll button only exists inside the expanded body (after
`<summary>`), which sidesteps the alternative problem of a click on an in-summary button also
toggling the `<details>` — no `stopPropagation()` needed.

## Seeding

`init()` (`js/main.js`) first awaits `OSR.loadData()` (`js/data.js`). It `fetch()`es every data file
in parallel and fills `OSR.data`:

- `OSR.data.monsters` ← `data/monsters.json` (the OSR bestiary).
- `OSR.data.tables` ← `data/tables.json`.
- `OSR.data.seeds.osr` ← `data/seed-osr.json` (gear) + every spell in `data/spells.json` whose name
  the gear does not use, + `data/monsters.json`.
- `OSR.data.seeds.brp` / `.sl` ← `data/seed-brp.json` / `data/seed-sl.json`.
- `OSR.data.pregens` ← the sheets in `OSR.PREGEN_FILES` (`data/*.txt`), as `[{ file, text }]`.

If any file fails, `loadData()` rejects with every failed file's name, and `showLoadError()` shows
`#load-error` and hides `.main`. `init()` then stops: it never calls `load()` or `save()`, so the
saved campaign is not touched.

**The seed store** (`js/seeds.js`). `init()` then awaits `OSR.loadSeeds()`, before `load()`.
`OSR.seeds[system]` = `{ system, version, codeVersion, compendium, monsters }`, one for each of
`OSR.SYSTEMS`, shared by every campaign on the device. It is stored in IndexedDB as the documents
`seeds/<system>` and in Dropbox as `/seeds/<system>.json`. It starts as the code's seed
(`codeSeed()` from `OSR.data.seeds`); a higher `version` in `OSR.data` (a new `data/seed-*.json`
version) is merged in at boot (`codeVersion` tracks it), and content packs add to it
(`addToSeed()`). `version` goes up on every change. Every seed item has a `seedRef` (`seedRefOf()`):
a pack's `ref`, a monster's own `id` (`sd-aboleth`), or `"<system>:c:<lower-case name>"`.

A campaign keeps its own copies (`compCopy()` / `monsterCopy()`), each with `seedRef` and
`seedHash` = `contentHash()` of the copy as it came from the seed (all fields but ids, times, system,
and the seed fields). `linkSeeds()` (from `ensureStateShape()`) gives older items their `seedRef` by
name (monsters by id first). `state.seedVersions[system]` is the seed version the campaign has seen:
a save from before it existed counts as up to date; a new campaign starts at `{}`. `seedStatus(sys)`
sorts the seed against the campaign into `added`, `changed` (the seed item changed and the copy is
unedited: `contentHash(copy) === copy.seedHash`), and `edited` (both changed). While `seen <
version`, Settings shows `#set-seed-row` ("New defaults") for the current system: **Apply**
(`applySeed(sys)`: adds, updates `changed`, keeps `edited`), **Apply and overwrite my edits**, or
**Skip**. `checkSeeds()` moves `seen` up silently when nothing differs.

After a successful load, everything that seeds reads `OSR.seeds` synchronously:

- Monsters: `seedMonsters()` (`js/seed.js`) copies `OSR.seeds.osr.monsters`.
- Spells and gear: `seedCompendium()` (`js/compendium.js`) reads `OSR.seeds.osr`.
- BRP and SL: `seedBrpMonsters()`/`seedBrpCompendium()` and `seedSlMonsters()`/`seedSlCompendium()`
  read `OSR.seeds.brp` / `.sl`.
- Characters: `seed()` (`js/seed.js`) creates one character for each `OSR.data.pregens` sheet.
  Garrick and Gulzund are the OSR examples. Kevin Johnson and Lucinda Adams (both from the UA3e
  "Karmic Ties and Fifth Wheels" starter kit) are the Unknown Armies examples, each with a ```ua fence
  (see "Unknown Armies 3rd Edition" above). Their starter-kit identities are swapped for the nearest
  book identities (Veteran, Caring, Autodidact; Occultist, Troll), with each book identity's
  substitution and features and the kit's ratings, so a "Book references" list after the fence can
  link them — the same layout as a sheet from the UA3 data tools' generator. Those entries come from
  the private content pack (see "State model"), so the logic test checks the link names against a
  fixed list (`UA_PREGEN_LINKS`). Dee Okafor, Miriam Castell, Vivian Sato, and Ray Kowalczyk are the
  Silent Legions pregens, one per class (Investigator, Scholar, Socialite, Tough), built by the book's
  level-1 rules and linked into one Boston party by their Connections. Each has a ```sl fence, so it
  shows only under System = sl, and Miriam's Affluent wealth starts her Madness tracker at 10.
  `seed()` only runs on a fresh install (no characters yet). For existing saves, Settings → **Add
  missing pregens** (`#set-add-pregens`) calls `addMissingPregens()`: it adds every example whose
  name (`detectNameSystem`, case-insensitive) no character has yet, across all systems, and restores
  `activeId`/`activeIdB` afterwards so the user's selection doesn't jump to a new pregen. A renamed
  pregen counts as missing and is added again. `missingPregens()` drives the Settings hint and
  disables the button when nothing is missing. `seed()`, `missingPregens()`, and
  `addMissingPregens()` all read the sheets through `loadSeedSheets()` (= `OSR.data.pregens` texts). The Settings
  tab re-renders when opened (`js/main.js`'s tab handler), so its counts stay current.
- `OSR.data` is shared, read-only data — `seedMonsters()` **deep-clones** it before putting
  it in `state`. Any code that copies a seed/def into mutable state must clone.

## Dropbox sync (`js/dropbox.js`)

Optional, off by default. It keeps the campaigns and the seeds in the user's Dropbox, one file for
each document, and keeps them in sync. It replaced a Google Drive sync: Google gives a static app
only a one-hour token with no refresh. There is no backend, so:

- **Sign-in is OAuth 2 with PKCE and a redirect back to the app.** `connect()` makes a verifier with
  `pkcePair()` (S256 with `crypto.subtle`, else `plain`) and a random `state`, stores
  `{ verifier, appKey, state, redirectUri }` in `sessionStorage['osr_dropbox_pending']` (this tab
  only), and sends the tab to `/oauth2/authorize` with `token_access_type=offline` and
  `redirect_uri` = `redirectUri()` (the app's URL without query or hash), through
  `OSR.dropboxRedirect(url)` (tests replace it). Dropbox sends the browser back with `?code=&state=`
  (or `?error=`). On that boot, `initDropbox()` calls `finishRedirect()`: it removes the reply from
  the address bar (`history.replaceState`), reads and deletes the pending sign-in, ignores a reply
  with no pending sign-in (a stale or copied link), refuses a wrong `state`, and calls
  `finishConnect(code, pending)`. That trades the code at `/oauth2/token` (with the same
  `redirect_uri`) for a 4-hour access token and a refresh token that does not expire.
  `accessToken()` refreshes by itself (`grant_type=refresh_token`, app key only, no secret;
  concurrent callers share one refresh). Each address where the app runs (the GitHub Pages URL,
  `http://localhost:<port>/`) must be in the Dropbox app's **Redirect URIs**; Setup shows the current
  one in `#dbx-redirect-uri`.
- **Fallback: "Connect with a code"** (`#dbx-connect-code`, `connectWithCode()`) is the old flow, for
  a copy of the app at an address that is not registered. It opens a blank tab inside the click (so
  pop-up blockers allow it) and sends it to `/oauth2/authorize` with no `redirect_uri`. Dropbox shows
  a code, the user pastes it into `#dbx-code`, and `finishConnect()` trades it. `#dbx-open` links the
  same URL when the tab was blocked.
- **The app is a Dropbox "App folder" app** with `files.content.read` and `files.content.write`. It
  sees only `Apps/<app name>/`. The app key comes from Settings (`meta.appKey`) or
  `DEFAULT_APP_KEY`. It is not a secret; never put the app secret in the code.
- **API calls** are plain `fetch` (`dbxFetch` adds the bearer token and always uses `POST`). A 401
  refreshes once and retries; a second 401, or a refused refresh, drops the tokens and sets the status
  to `signed-out`. Errors carry Dropbox's `error_summary` (`e.summary`). Metadata comes from one
  `files/list_folder` (`path: ''`, `recursive: true`, then `files/list_folder/continue`) per pass
  (`listAll()`), cut down by `toRemote()` to `{ id, rev, hash, path, modified }`, where `hash` is
  Dropbox's `content_hash` and `path` is `path_lower`. Files are found by path, not by id. `files/download` asks for `rev:<rev>`, so the text always
  matches the metadata. `files/upload` uses `mode: add` to create and `mode: update` with the rev
  to replace: Dropbox refuses (409 `path/conflict`) if another device wrote in between, and the
  next pass then sees the change. `Dropbox-API-Arg` is a header, so `headerJson()` escapes non-ASCII.
- **Layout in the app folder**:
  - `/campaigns/index.json` — the campaign list, `[{ id, name, createdAt, primary }]` (`indexText()`).
  - `/campaigns/<id>/shared.json` — the campaign's `campaign` document; `/campaigns/<id>/<system>.json`
    — one for each of `OSR.SYSTEMS` (`docPath()`; the documents of `js/store.js`'s `splitState`).
  - `/campaigns/<id>/maps/<blobId>.<ext>` — the map images of the campaign's scenes (`blobPath()`).
  - `/seeds/<system>.json` — the seed store of `js/seeds.js` (`seedPath()`); none for a system whose
    seed is empty.
  - Older versions: `/Character Keeper campaign.json` (`LEGACY_FILE`, the whole primary campaign) and
    `/campaigns/<id>/campaign.json` (a whole non-primary campaign). The first pass of a campaign
    moves its old file to `… (before split).json` (`backupPath()`).
- **Per-device data stays out of `state`**: `sessionStorage['osr_dropbox_pending']` (above),
  `localStorage['osr_dropbox_v1']`, and `localStorage['osr_dropbox_token']` (`token`, `expiresAt`,
  `refresh`, `appKey`). `osr_dropbox_v1` has `enabled`, `appKey`, and:
  - `files[<lower-case path>]` — one sync record for each file: `fileId`, `remoteHash`,
    `syncedHash`, `lastSync` (`rec()` reads without creating, `setRec()`/`recordFile()` write);
  - `legacy[<campaignId>]` — the record of a campaign's old whole-campaign file; `migrateMeta()` (in
    `initDropbox()`) moves the flat record of the oldest version and the per-campaign records of the
    previous one here;
  - `migrated[<campaignId>]` — set once that campaign's old file was split;
  - `hidden[<campaignId>]` — a campaign deleted in this browser (`dropboxForgetCampaign()`); a pull
    of the index does not bring it back here. Its Dropbox files stay.

  So Export, Import, and the Dropbox files never carry a token or another device's file id.
  `initDropbox()` also removes the old `osr_gdrive_*` keys.
- **One sync pass** (`syncNow()`) lists the app folder once, then:
  1. `legacyStep()` — the current campaign's old whole-campaign file, if it has one and is not
     `migrated`. It syncs with the old rules against `meta.legacy[id]` (`pull` replaces the whole
     campaign through `applyLegacy()`; `link`/`conflict` with different text open `#dbx-modal`
     and stop the pass), then `files/move_v2` moves the file aside and the pass lists again.
  2. `syncIndex()` — `/campaigns/index.json`. A pull adds the campaigns this browser lacks and takes
     their names; a link or conflict keeps both lists (union) and uploads. A fresh browser's
     primary campaign that has no document records takes the id of the primary campaign in Dropbox
     (`OSR.rekeyCampaign()`, `js/core.js`), so its documents then sync or ask like any device's.
  3. `syncSeeds()` — `/seeds/<system>.json`. A pull replaces the local seed (`OSR.setSeed()`); both
     changed → `OSR.mergeSeeds()` (union by `seedRef`, the higher `version` wins) and upload. Never asks.
  4. `syncDocs()` — the current campaign's documents (`OSR.serializeState`). Each goes through
     `syncFile()`: `decideSync(remote, rec(path), hashText(text))` returns `create`, `link` (a file
     this device never synced with), `noop`, `upload`, `pull`, or `conflict`; "Dropbox changed"
     means its `content_hash` differs from `remoteHash`, "local changed" means the text's hash
     differs from `syncedHash`. `create`/`upload` send the text; a download with the same text is
     only recorded. Pulled documents replace their part of `OSR.state` together (`applyDocs()` →
     `withDocs()` → `OSR.replaceState()`), unless the document changed during the download: then it
     is a `conflict`. Conflicts of all documents go to one question for the campaign.
  5. `syncBlobs()` — uploads each map image of the campaign's scenes that the
     listing lacks, as `/campaigns/<id>/maps/<blobId>.<ext>` (`blobPath()`, `uploadBytes()`: mode
     `add`, no record — an image never changes). A missing local image is downloaded by
     `dropboxFetchBlob()` when its scene shows, not in the pass.

  A pull records the hash of the document *after* `ensureStateShape`, so a migrated copy isn't
  uploaded back (it can upload once, for example the HP tracker `ensureStateShape` adds for a pulled
  character). A pull also writes no log line: otherwise two devices would pull each other's log line
  forever. If the browser storage refuses the write, `replaceAndWait()` puts the previous campaign
  back and throws instead of recording the sync, so the next pass sees the same pull again and a
  reload can't upload the old campaign over the Dropbox copy.
- **Campaigns**: only the current campaign's documents sync in a pass. `dropboxBeforeCampaignSwitch()`
  runs a queued upload and waits for a running pass (`dbx.pass`), so no pass mixes two campaigns; an
  open question is dropped and comes back when that campaign is active again.
  `dropboxCampaignChanged()` then syncs the new campaign. A campaign this browser has no documents
  for (one another device made) is downloaded by `dropboxFetchCampaign(id)` before `switchCampaign`
  opens it (`js/campaigns.js`), so it is not seeded empty.
- **When it runs**: `dropboxNoteSave()` (from every `save()`) debounces an upload by `UPLOAD_DELAY`
  (4 s), but never longer than `MAX_WAIT` (30 s) after the first unsynced save. `initDropbox()` (end
  of `init()`) syncs at boot. The tab returning to the foreground re-checks Dropbox (at most once a
  minute), and going to the background flushes a pending upload. The `online` event also syncs.
  While `#dbx-modal` is open (status `conflict`), saves don't sync. It names the files in question
  and compares the two campaigns. The user chooses **Use the Dropbox copy** (`dropboxUseRemoteCopy`),
  **Keep this browser's copy** (`dropboxUseLocalCopy`: it records the remote hashes so the next pass
  is a plain `upload` of each file), **Export**, or **Decide later**
  (Escape too). The header button and the Settings row's **Resolve** reopen it. **Disconnect**
  revokes the token (best effort) and forgets it.
- **Tests** (`test/dropbox.test.js`) boot a fresh app per test, because the sync keys are
  per-device `localStorage` and IndexedDB. `test/helpers/fake-dropbox.js` has `fakeOpen` (records
  the consent URL of the code flow) and `fakeDropbox(window, shared)`: the token endpoint and the API
  calls above in memory (`files/list_folder` pages of 4, so `/continue` runs too; `files/move_v2`;
  `dbx.before(endpoint, arg)` runs before each call, to change Dropbox mid-pass), with revs and real
  `content_hash` values. Pass the `dbx` of one window as `shared` to give a second device the same
  Dropbox. The redirect tests replace `T.dropboxRedirect`, then boot a second app at the reply URL
  with the first tab's `sessionStorage` (boot's `url` and `session` options). jsdom has
  no `crypto.subtle`, so the flow runs with `plain`; `pkcePair` is tested with Node's S256 too.
  `T.dropboxFlush()` runs a debounced upload now. The boot helper's `extraStorage`/`beforeScripts`
  options preload the sync keys and stub `fetch` before `init()`. Not covered: the real Dropbox
  consent page. Check it by hand with a real app key.

## Adding a feature — checklist

1. New persisted field → add to `STATE_DEFAULTS` **and** backfill in `ensureStateShape()`.
2. New DOM → add to `index.html`; if it needs an explicit CSS `display`, add the `[hidden]` guard.
3. Wire listeners via delegation in the relevant `wire*()`; escape all interpolated text.
4. After mutating `state`: `save()` then the narrowest `render*()` that covers it.
5. New close-on-outside-click popup → whitelist its subtree in the global capture listeners.
6. Parser change → update `test/monsters.test.js`, run `npm test`, run `npm run convert-bestiary`,
   commit both generated files.
7. New app logic or UI behaviour → add coverage in `test/logic.test.js` / `test/ui.test.js`. No
   separate test-seam export to update — `window.__OSR_TEST__` is `window.OSR` itself (see
   "Layout"), so a new function is visible to tests the moment it's attached to `OSR`.
8. `npm test` must stay green. Sanity-check by hand in a browser, served over http (for example
   `python3 -m http.server`).

## Commit attribution

End commit messages with:

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```
