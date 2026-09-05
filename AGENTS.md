# AGENTS.md

Guidance for AI agents and human contributors working on this repo. Read this before editing.
User-facing docs are in [README.md](README.md).

## What this is

A **static single-page app** — `index.html` + a few plain `.js`/`.css` files. **No build step, no
framework, no bundler, no package to install.** You open `index.html` and it runs, including from
`file://`. It is deployed as-is to GitHub Pages (`.github/workflows/static.yml` uploads the whole
repo on push to `main`).

Keep it that way. Do not introduce a build tool, a framework, TypeScript, JSX, npm runtime
dependencies, or CDN `<script>`/`<link>` tags. Everything third-party is **vendored** (`js/marked.min.js`,
`vendor/fontawesome/`) so the app works fully offline.

## Layout

```
index.html             markup; loads the scripts at the bottom in order
css/app.css             all styles (one file, dark only; palette + fonts are CSS custom properties
                       on :root, re-declared in :root[data-theme="fantasy"|"sf"|"horror"] blocks —
                       style themes chosen in Settings, applied as data-theme on <html> by applyTheme())
js/core.js              window.OSR = {} (created here) + constants, $/$$/escapeHtml/uid, the state
                       model + persistence (STATE_DEFAULTS, load/save/ensureStateShape), applyTheme
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
js/monster-modals.js    the "Add monster" library modal and the monster edit modal
js/compendium.js        Compendium entry CRUD, category/source filters, the default seed, compResolve
js/compendium-popups.js hover popups on [bracketed] refs, and "[" / "$" autocomplete
js/settings.js          the Settings tab
js/io.js                the "paste sheet as text" modal, and whole-state export/import
js/dice-ui.js           the Dice Roller panel (preset grid + custom formula) and the right-click
                       "roll with modifiers" popup
js/seed.js              first-run seeding of example characters + the monster library
js/main.js              composition root: wire() calls every subsystem's wireX(), init(), boot(),
                       and (test builds only) the test seam — loads LAST
js/monsters.js          pure stat-block parser (no DOM, no storage); UMD-ish
js/monsters-data.js     GENERATED: window.MONSTER_LIBRARY = [...245 monsters...]
js/spells-data.js       GENERATED: window.SPELLS_LIBRARY = [...85 spells...] (for file:// — fetch is blocked there)
js/compendium-seed.js   hand-maintained gear + window.COMPENDIUM_SEED / _VERSION; folds in SPELLS_LIBRARY
js/marked.min.js        vendored Markdown parser
js/fuse.min.js          vendored Fuse.js 7 (UMD → window.Fuse) — fuzzy search for the Compendium
vendor/easymde/         vendored EasyMDE 2.18 (js bundles CodeMirror+marked; css) — Compendium editor
data/monsters.json     GENERATED: same content as monsters-data.js (for http fetch / inspection)
data/bestiary_data.json  source data for the converter (Shadowdark core bestiary)
data/spell_data.json   source data for the spell converter (Shadowdark core spells)
data/spells.json       GENERATED: same content as spells-data.js (for http fetch / inspection)
data/*.txt             example character sheets (seeded on first run)
scripts/convert-bestiary.js   CLI: bestiary_data.json -> monsters.json + monsters-data.js
scripts/convert-spells-from-shadowdark-resources.js  CLI: spell_data.json -> data/spells.json +
                       js/spells-data.js, { name, category:"Spells", body } entries compendium-seed.js reads
test/monsters.test.js  node:test suite for the parser + converter
test/logic.test.js     node:test unit tests for the app's internals (dice engine, Scarlet Heroes,
                       state migration, annotate, compendium resolve, combat, …)
test/ui.test.js        node:test integration tests that drive the real DOM (index.html + the app's
                       js/*.js files) through the app's delegated listeners and assert on render + persistence
test/helpers/boot.js   boots the app inside jsdom for the two suites above (EasyMDE omitted → the
                       Journal / Compendium editors fall back to plain <textarea>s, as designed)
vendor/fontawesome/    icons, referenced by index.html via relative url()
```

**No build step means no ES modules either** (`<script type="module">` is blocked by CORS on
`file://`, same as `fetch()` — see "Seeding" below). So the app's own code is split across the
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
`js/characters.js`. `state.compendium`: `{id,name,category,source,body}`, category ∈
`COMPENDIUM_CATEGORIES`, source is free text defaulting to `Unknown`. It's a reference list edited via
an EasyMDE modal, filterable by category and by source — click a checkbox to toggle it, right-click
one to isolate it (unticks every other checkbox in that row, `#comp-cats` or `#comp-sources`). The
entry editor's `Enter` saves (same as clicking Save) and `Shift+Enter` inserts a newline in the body,
via `onSubmit` on the EasyMDE `compMdeInstance()` plus a `#comp-modal` keydown fallback for the
plain-textarea case; `Escape` cancels (the app-wide Escape handler already covers every modal). The
default seed lives in its own file,
`js/compendium-seed.js` (`window.COMPENDIUM_SEED` / `COMPENDIUM_SEED_VERSION`); `seedCompendium()`
adds missing-by-name entries and stamps `state.compendiumSeedVersion`, so raising the version in the
seed file re-seeds on next load. Settings → **Reseed defaults** calls `seedCompendium()` directly;
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
open index.html            # or serve the folder with any static server

# tests (Node's built-in runner; no deps)
npm test                   # === node --test

# rebuild the monster library after editing data/bestiary_data.json or the converter
npm run convert-bestiary   # writes BOTH data/monsters.json and js/monsters-data.js

# rebuild the spell seed after editing data/spell_data.json or the converter
npm run convert-spells     # writes BOTH data/spells.json and js/spells-data.js
```

`data/monsters.json` and `js/monsters-data.js` **must stay in sync** — a test asserts it. Always
run the converter and commit both, never hand-edit either. Same relationship between
`data/spells.json` and `js/spells-data.js` (no test asserts it yet, but treat it the same way).

## State model

- One object, `OSR.state`, shaped by `STATE_DEFAULTS` (both in `js/core.js`).
- `load()` reads `localStorage['osr_manager_v1']`; `save()` writes `JSON.stringify(state)`.
- **`ensureStateShape()`** is the migration hook. It runs after `load()` and after import. When you
  add a new field to `state`, add its default there (and to `STATE_DEFAULTS`) so old saves and
  imported files get backfilled. Per-entry backfills (e.g. `entry.statuses = []`) also go here.
- **Export is automatic.** `exportData()` serialises the whole `state`, so any field you add to
  `state` is included in Export/Import with no extra code.
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
  `wireCompendiumPopups`, `wireRollPopup`, …); handlers use `e.target.closest('.some-class')`. Don't
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

## The converter (`scripts/convert-bestiary.js`)

Reuses `MonsterParse.parseOne` — it rebuilds a Shadowdark stat block from each structured bestiary
entry, parses it, then attaches the entry's `actions` as `abilities` and Title-cases the name. Runs
`main()` only under `require.main === module`; also exports `{convert, titleCase, slug, statLine,
buildRaw}` for tests. Flags: `--dry-run`, `--no-merge` (drop preserved non-Shadowdark entries),
`--out`, `--js-out`.

## Seeding & the `file://` constraint

`fetch()` is blocked on `file://`, so nothing load-bearing may depend on it — this is also *why* the
app's own code can't be split into ES modules (see "Layout"), just plain `<script>`-per-file:

- Monsters: `seedMonsters()` (`js/seed.js`) tries `window.MONSTER_LIBRARY` (from
  `js/monsters-data.js`, a `<script>` tag — works on `file://`), then `fetch('data/monsters.json')`
  (skipped on `file://`), then a tiny inline `MONSTER_SEED_TEXT` parsed on the fly.
- Spells: `loadSpells()` in `js/compendium-seed.js` tries `window.SPELLS_LIBRARY` (from
  `js/spells-data.js`, a `<script>` tag — works on `file://`), then `fetch('data/spells.json')`
  (skipped on `file://`); either way its entries are folded into `COMPENDIUM_SEED` before
  `seedCompendium()` (`js/compendium.js`) reads it.
- Characters: `seed()` (`js/seed.js`) tries `fetch('data/*.txt')` (skipped on `file://`), then inline
  `SEED_WWN` / `SEED_SD` constants.
- `window.MONSTER_LIBRARY` is a shared constant — `seedMonsters()` **deep-clones** it before putting
  it in `state`. Any code that copies a seed/def into mutable state must clone.

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
8. `npm test` must stay green. Manually sanity-check from `file://` (not just a served copy).

## Commit attribution

End commit messages with:

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```
