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
index.html            markup; loads the scripts at the bottom in order
css/app.css            all styles (one file, dark only; palette + fonts are CSS custom properties
                       on :root, re-declared in :root[data-theme="fantasy"|"sf"|"horror"] blocks —
                       style themes chosen in Settings, applied as data-theme on <html> by applyTheme())
js/app.js              the whole application — one IIFE, ~1900 lines, section banners
js/monsters.js         pure stat-block parser (no DOM, no storage); UMD-ish
js/monsters-data.js    GENERATED: window.MONSTER_LIBRARY = [...245 monsters...]
js/compendium-seed.js   hand-maintained: window.COMPENDIUM_SEED / _VERSION (Shadowdark core gear)
js/marked.min.js       vendored Markdown parser
js/fuse.min.js          vendored Fuse.js 7 (UMD → window.Fuse) — fuzzy search for the Compendium
vendor/easymde/         vendored EasyMDE 2.18 (js bundles CodeMirror+marked; css) — Compendium editor
data/monsters.json     GENERATED: same content as monsters-data.js (for http fetch / inspection)
data/bestiary_data.json  source data for the converter (Shadowdark core bestiary)
data/*.txt             example character sheets (seeded on first run)
scripts/convert-bestiary.js   CLI: bestiary_data.json -> monsters.json + monsters-data.js
test/monsters.test.js  node:test suite for the parser + converter
vendor/fontawesome/    icons, referenced by index.html via relative url()
```

`js/app.js` is organised into sections with `/* ---- name ---- */` banner comments (State, Dice
engine, Roll + log, character text annotation, Character CRUD, Consumables, Notes, Combat tracker,
monster library modal, monster edit modal, Compendium, Settings, Clipboard, Export/import, Dice
panel, Seed data, Wiring, Init). Find the right section before adding code.

The **Compendium** (`state.compendium`: `{id,name,category,source,body}`, category ∈
`COMPENDIUM_CATEGORIES`, source is free text defaulting to `Unknown`) is a reference list edited via
an EasyMDE modal, filterable by category and by source. The default seed lives in its own file,
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

Right-clicking a text selection in the rendered sheet (`#mode-view`) shows `#sel-menu`; choosing
"Add … to Compendium" stashes `pendingCompLink` ({charId, part, find}) and opens the entry editor.
`saveCompEntry` then calls `applyPendingCompLink(name)`, which `linkifyInText`-replaces the selected
text in that character's `body` (or the correct half of a `---`-split view) with `[name]` and
re-renders. `charViewTarget(node)` maps a selection node to its character/column.

## Run / test / regenerate

```
# run the app
open index.html            # or serve the folder with any static server

# tests (Node's built-in runner; no deps)
npm test                   # === node --test

# rebuild the monster library after editing data/bestiary_data.json or the converter
npm run convert-bestiary   # writes BOTH data/monsters.json and js/monsters-data.js
```

`data/monsters.json` and `js/monsters-data.js` **must stay in sync** — a test asserts it. Always
run the converter and commit both, never hand-edit either.

## State model

- One object, `state`, shaped by `STATE_DEFAULTS` (top of `app.js`).
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
  `ensureStateShape`). It's an EasyMDE editor (`wireNotes` → `buildMDE`, the shared builder also used
  by the Compendium editor). Plain Enter → `submitNote()` (logs the text via `pushNote('Journal', …,
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
- **Event handling is delegation.** Listeners are attached once to stable containers in `wire()` and
  its helpers (`wireCombat`, `wireConsumables`, `wireNotes`, `wireSettings`); handlers use
  `e.target.closest('.some-class')`. Don't attach per-element listeners inside `render*()`.
- **Visibility is toggled with `el.hidden = true/false`**, not `style.display`. Gotcha: the `[hidden]`
  attribute loses to any CSS rule that sets `display:` (this bit us with `.modal { display:flex }`).
  If you give an element an explicit `display` in CSS, also add `.thing[hidden] { display:none }`.
- Popups (`#ctx-menu`, `#mm-preview`) are closed by capture-phase `document` listeners
  (`scroll`, `mousedown`). Those listeners **must whitelist the popup's own subtree**
  (`e.target.closest('#ctx-menu')`) or interacting with the popup dismisses it.

## The dice engine (`app.js`)

- `evalFormula(str)` → `{ total, detail, normalized, dice, flat }` or `null`.
  Grammar: `NdM`, `+`/`-` chains, `kh|kl|dh|dl` + count, `d%`. A string with no dice becomes
  `1d20 + <it>`. `dice` is every individual die kept (`{value, sides, sign}`); `flat` is the signed
  sum of constant terms — both used by Scarlet Heroes translation.
- `doRoll(formula, source)` = eval + `pushLog` + set `lastRoll` (drives the "Apply damage" button).
- `pushLog(source, formula, total, detail)` — a roll line. `pushNote(source, text, detail)` — a
  non-roll line (status/side/library events), rendered without the `= total` column.
- Character-sheet auto-linking: `annotate(rootEl)` walks text nodes and wraps matches of `DICE_RE`
  / `MOD_RE` in `<span class="roll" data-formula>`. It skips `<code>`, `<pre>`, `<a>`. Run it after
  any `marked.parse()` whose output should have clickable dice.

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

`fetch()` is blocked on `file://`, so nothing load-bearing may depend on it:

- Monsters: `seedMonsters()` tries `window.MONSTER_LIBRARY` (from `js/monsters-data.js`, a
  `<script>` tag — works on `file://`), then `fetch('data/monsters.json')`, then a tiny inline
  `MONSTER_SEED_TEXT` parsed on the fly.
- Characters: `seed()` tries `fetch('data/*.txt')`, then inline `SEED_WWN` / `SEED_SD` constants.
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
7. `npm test` must stay green. Manually sanity-check from `file://` (not just a served copy).

## Commit attribution

End commit messages with:

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```
