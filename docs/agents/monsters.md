# Monsters, Bestiary, tables

## Parser (`js/monsters.js`)

Pure (no DOM, no state). `MonsterParse` on `window` and `module.exports`:

- `parseMonsters(text)` → `[def]`: splits on blank lines and detected name lines (`splitBlock`).
- `parseOne(block)` → `def` or `null`; detects `shadowdark` / `ose` / `unknown`. Needs an `AC …` line.
- `hdNum(hd)`: `'½'` → 0.5, `'9*'` → 9, `''` → 0.
- `def`: `{ id?, name, source, desc, raw, ac: { asc, desc, thac0 }, hd, hdNum, hp, move, align, xp,
  moraleML, atkBonus, attacksText, attacks: [{ label, count, toHit, damage, note, raw }], stats | null,
  saveTargets | null, savesText, abilities: [{ name, text }] }`. Systems add fields (systems.md).
- Attacks split on `" + "`, `" or "`, `" and "`; the damage is the `(...)` with dice. Shadowdark
  abilities split on Title-case names; OSE on `▶`.
- A parser change: update `test/monsters.test.js` and run `npm run convert-bestiary`.

## Bestiary tab and modals

- `js/monster-browser.js`: the Bestiary tab (`filterMonsters()`, shared with the modal's list) over
  `monstersForSystem()`. **+ New monster** and Combat's **+ Add monster…** open the same
  `#monster-modal` (`OSR.openMonsterModal()`).
- `js/monster-modals.js`: `.mm-mode-toggle` switches paste (`MonsterParse`) and fields
  (`js/monster-form.js`) modes, with `setMonsterMode(root, mode)` for `#mm-mode` (add) and
  `#me-mode` (edit). `openMonsterEdit(id)` fills both modes; `saveMonsterEdit()` reads the active
  one and keeps the original `system`. `ensureMonsterFormBuilt(host)` wires the form once
  (`host.dataset.built`). `PASTE_ONLY_SOURCES`, `FIELDS_ONLY_SOURCES` pick the mode per system.
  `showLibPreview()`/`hideLibPreview()` show a hover card (`monsterCardHtml`).
- `js/monster-form.js`: schema blocks `.mf-schema-block[data-schema]` (`shadowdark`, `ose`, `brp`,
  `sl`); class selectors only (the template is in both hosts). Dynamic rows `.mf-atk-row`,
  `.mf-abil-row`. `collectMonsterForm` derives `attacksText`/`savesText` and `raw`
  (`buildRawFromDef`) so a fields monster also works in paste mode.

## PL generator (`js/monster-browser.js`)

`generateMonster(pl, mutationCount)`: Shadowdark core p.190 (d20 table of offset, quality,
strength, weakness; LV = max(0, pl + offset), AC = pl + 10, HP = LVd8, one `1d4` × `1d8` attack)
and p.191 mutations (three d12 columns, used in order). It opens the modal with the result as a
prefill; nothing is saved before Save. The panel `#mb-gen-pop` floats under `#mb-gen-open` (right of
the HD filter, in `#mb-gen`, which is hidden unless the system is `'osr'`); `setGeneratorOpen()`,
an outside `mousedown`, Escape (`closeMonsterGenerator`), and Generate close it.

## Populate by HD (`js/combat-populate.js`)

`#populate-hd-modal` spends a total HD budget exactly, with an optional exact count, on
`monstersForSystem()`. Units are half-HD integers (`effectiveHdUnits`, minimum 1, so HD 0 costs
0.5). `buildHdPopulatePlan(monsters, totalHd, count)` (pure) → `{ ok, picks, … }` or
`{ ok: false, reason }`: coin-change feasibility tables plus random backtracking. Each proposal row
has a preview and a reroll (`rerollPick(idx)`: same HD, another monster). Monsters join combat only
on `#php-confirm-add`. `#php-total-hd` has no default. `monstersByUnit` also skips a BRP def without
`hd` (no Encounter Level). For BRP (`OSR.levelLabel()` is `'EL'`) the modal shows `#php-hint-el` and
the party calculator `#php-party` (`#php-pcs`, `#php-power`, `#php-difficulty`); an `input`/`change`
there fills `#php-total-hd` with `partyElBudget(pcs, power, difficulty)` (pure; PCs × `POWER_LEVEL_EL`
× `DIFFICULTY_EL`, rounded to 0.5, minimum 0.5). `#php-pcs` starts at the BRP character count, or 4.

## Converters

- `scripts/convert-bestiary.js`: rebuilds a Shadowdark stat block per entry, parses it with
  `MonsterParse.parseOne`, adds `actions` as abilities. Exports `{ convert, titleCase, slug,
  statLine, buildRaw }`. Flags `--dry-run`, `--no-merge`, `--out`, `--js-out`.
- `scripts/convert-spells-from-shadowdark-resources.js`: `data/spell_data.json` → `data/spells.json`.
- `scripts/convert-tables.js`: `data/tables/*.csv` → `data/tables.json`. `DEFAULT_META` gives every
  table `origin`, `settings` (a list), `output`; `META[slug]` overrides one (the script throws on a setting or
  output not in its `SETTINGS`/`OUTPUTS`, which match `js/tables.js`). `parseRange`: `"00"` after
  `"98-99"` is 100.
- `scripts/build-token-icons.js`, `scripts/build-icon-index.js`: see maps.md.

## Tables tab (`js/tables.js`, `js/table-syntax.js`)

- Tables are not scoped to a campaign or a System: every list shows every table.
- Filter fields on every table: `origin` (the UI says "Source": free text, default `Homebrew`),
  `settings` (a list, in `TABLE_SETTINGS` order: Fantasy, Modern, Horror), `output` (one of
  `TABLE_OUTPUTS`: Encounter, Entity, Location, Adventure, Group, Other). `cleanTable()` fixes case
  and plurals (`encounters` → `Encounter`), drops unknown settings, and reads an old single
  `setting` string; no settings → from the table's `system` (`SYSTEM_SETTINGS`: ua3e Modern, sl
  Modern + Horror, else Fantasy). A table's text stays in `source` (the old field name, which
  packs use), so the origin field is `origin`.
- Two kinds of table. Built-in: `OSR.data.tables`, `{ id, name, origin, settings, output, formula,
  entries: [{ range, lo, hi, text }] }`, read-only. User: the table library `OSR.tableLib =
  { tables: [{ id, name, origin, settings, output, source, createdAt, updatedAt }], deleted: { id: time } }`.
- The table library is shared by every campaign on the device: IndexedDB document `library/tables`,
  Dropbox `/tables.json` (see storage.md). `loadTables()` runs at boot before `load()`; the first
  time (no library document) it collects the `tables` of every campaign's system documents.
  `adoptCampaignTables(state)` (called by `ensureStateShape()`) moves a campaign's old
  `state.tables` (old save, old export, Dropbox pull) into the library and deletes the key.
  `addTables(list, { system, origin })` skips a table without text, a deleted id, a known id, or a
  known name. `saveTables()` writes and calls `dropboxNoteSave()`; callers do not await it, except
  import. Delete adds the id to `deleted`, so `mergeTableLibs()` (union by id, later `updatedAt`
  wins) does not bring it back.
- `library()` gives the user tables (parsed, cached by `source`) and every built-in table that no
  user table hides by name (case-insensitive). Both have the parsed shape
  `{ id, name, origin, settings, output, formula, columns, entries: [{ range, lo, hi, text, cells }], problems, user }`.
- `js/table-syntax.js` (`window.TableSyntax`, pure, also `module.exports`): `parseTable(source)`
  (the format is in its header comment and README.md), `rollTable(table, ctx)` → a node tree,
  `nodeText()`, `rerollAt(tree, path, ctx)`, `highlight(source, resolve)`, `refProblems()`,
  `toSource()`, `renameRefs()`. `ctx` is `{ resolve(name), roll(formula) }`; `js/tables.js` builds it
  from `library()` and `evalFormula`. A ref that names a table wins over a dice reading
  (`[d6]` with a table "d6"). Depth limit 12, repeat limit 20, a table on its own stack is an error.
- Layout: `nodeLines(node)` (pure) splits a node's parts into lines when a sub-table follows
  `Label:` (or `text —` before a sub-table that has lines itself); a `;` in the template text ends
  a line; text after an unlabelled sub-table is that line's `tail`. Null means one line.
  `linesHtml()` (js/tables.js) renders `.tbl-lines`/`.tbl-line`, a group label is the group's
  `.tbl-sub`; `nodeOutline()` is the text form (two-space indents). A `1d1` table hides "Rolled".
- Roll: `pushLog(name, formula, total, nodeOutline(tree), { quiet: true })` (`.log-detail.is-lines` keeps the breaks;
  `quiet` skips `#dice-last`). `.tbl-copy` copies `TS.copyText(tree)` (an outline in a ``` fence) through `OSR.copyText()`. `tblLastRoll[id].tree` keeps the result;
  each sub-node renders as `.tbl-sub[data-path]` and a click calls `rerollAt` (logged as
  "Name (again: Sub)"). Rows are `<details>`; `tblOpenIds` keeps open rows across renders
  (capture-phase `toggle` listener). `tblOff[filter]` holds the unticked values of each filter row
  (`#tbl-filter-origin`, `#tbl-filter-settings`, `#tbl-filter-output` in `#tbl-filters`), so a new
  source shows. A table shows when each row has one of its values ticked (`valuesOf()`: settings
  is a list). Right-click isolates one value in its row only; a right-click when no other value in the row
  is ticked ticks the whole row again.
- `#tbl-hide-subs` "Don't show included subtables" (checked by default and by
  `resetTableFilters()`, not saved): `includedNames()` collects the names that any listed table
  refs (`TS.refNames`, a table's ref to itself does not count); those tables are hidden unless a
  search term is typed or the id is in `tblShowIds`. `showTable()` (Save, a ref click) ticks the
  table's filter values and adds its id to `tblShowIds`.
- Editor `#tbl-modal`: a transparent `<textarea id="tbl-f-src">` over `<pre id="tbl-hl">`; both must
  keep the same font, padding, border, and wrapping (css/app.css). `[` autocomplete is
  `OSR.acFromTableEditor` (mode `'table'` of `OSR.compAC` in js/compendium-popups.js, items from
  `OSR.tableAcItems`). Save is blocked by `error` problems, an empty name, `[`/`]` in the name, or a
  name the library already has. A rename rewrites refs in the other user tables. Fields:
  `#tbl-f-origin` (datalist of the sources in use), `#tbl-f-settings` (checkboxes; Save needs one),
  `#tbl-f-output` (select). A new table starts as Homebrew, the current System's settings, and
  Other; Duplicate copies all three.
- Tests: `test/table-syntax.test.js` (parser, roller), `test/ui.test.js` "Tables tab",
  `test/logic.test.js` "Table library", `test/campaigns.test.js` (shared, first-boot move),
  `test/dropbox.test.js` (`/tables.json`),
  `test/tables.test.js` (each built-in table covers 1..N of its die).
