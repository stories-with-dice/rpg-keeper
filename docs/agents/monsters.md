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
on `#php-confirm-add`. `#php-total-hd` has no default.

## Converters

- `scripts/convert-bestiary.js`: rebuilds a Shadowdark stat block per entry, parses it with
  `MonsterParse.parseOne`, adds `actions` as abilities. Exports `{ convert, titleCase, slug,
  statLine, buildRaw }`. Flags `--dry-run`, `--no-merge`, `--out`, `--js-out`.
- `scripts/convert-spells-from-shadowdark-resources.js`: `data/spell_data.json` → `data/spells.json`.
- `scripts/convert-tables.js`: `data/tables/*.csv` → `data/tables.json`. `TAG_MAP` maps each file to
  a tag (the script throws on a missing one). `parseRange`: `"00"` after `"98-99"` is 100.
- `scripts/build-token-icons.js`, `scripts/build-icon-index.js`: see maps.md.

## Tables tab (`js/tables.js`)

Read-only over `OSR.data.tables`: `{ id, name, tag, formula, entries: [{ range, lo, hi, text }] }`. No
state. Tags come from the data (keep 10 or fewer). `rollTable` uses `evalFormula(t.formula)` and
`pushLog`. Rows are `<details>`; `tblOpenIds` keeps open rows across renders (capture-phase
`toggle` listener). `test/tables.test.js` checks each table covers 1..N of its die.
