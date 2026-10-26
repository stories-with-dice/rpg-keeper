# AGENTS.md

Rules for AI agents and contributors. The user guide is [README.md](README.md). Notes on each
subsystem are in [docs/agents/](docs/agents/): read the one for the code you change.

| Note | Covers |
|---|---|
| [storage.md](docs/agents/storage.md) | `OSR.state`, IndexedDB, campaigns, Export/Import, content packs, seeding, the seed store, Dropbox sync |
| [systems.md](docs/agents/systems.md) | the System switch, character classification, HP/Wounds/Madness trackers, Unknown Armies, BRP, Silent Legions |
| [compendium.md](docs/agents/compendium.md) | Compendium entries, hover popups (also the map's), `[`/`$` autocomplete, the sheet-selection menu |
| [dice.md](docs/agents/dice.md) | the dice engine, `annotate()`, sheet variables and `$Name`, the roll-with-modifiers popup |
| [monsters.md](docs/agents/monsters.md) | the stat-block parser, Bestiary tab, monster modals and form, PL generator, Populate by HD, converters, Tables tab and user tables |
| [combat.md](docs/agents/combat.md) | the Combat tracker: entries, statuses, the right-click menu, the detail panel |
| [maps.md](docs/agents/maps.md) | Maps tab: scenes, view, tokens, drawings, pins, hexcrawl, toolbar, hotkeys, pop-out, undo |

## Hard rules

- **Static single-page app**: `index.html`, `css/app.css`, `js/*.js`. No build step, framework,
  bundler, TypeScript, JSX, ES modules (jsdom does not run them), runtime npm dependencies, or
  CDN `<script>`/`<link>` tags. Third-party code is vendored: `js/marked.min.js`, `js/fuse.min.js`,
  `vendor/fflate/`, `vendor/easymde/`, `vendor/fontawesome/`.
- **http(s) only**: GitHub Pages (`.github/workflows/static.yml` publishes `main`) or a local static
  server. `file://` is not supported because boot `fetch()`es `data/`. Do not add workarounds.
- **Network**: only two uses. (1) `js/icons.js` fetches one game-icons SVG from jsDelivr
  (`ICON_URL`) when the user picks a search result; results show lazy preview `<img>`s from the
  same host. (2) Opt-in Dropbox sync (`js/dropbox.js`), nothing before the user clicks Connect.
  Add no other network use.
- **No book text in the repo** (the repo is public). Silent Legions data is paraphrased; the SL PDF
  is gitignored. Unknown Armies content comes only from the user's private content pack.
- **Generated files**: never edit `data/monsters.json`, `data/spells.json`, `data/tables.json`,
  `data/game-icons-index.json` by hand. Edit the source data or the script, run it, commit both.

## Code layout

Every `js/*.js` file (except vendored ones) is an IIFE: `(function (OSR) {…})(window.OSR = window.OSR || {})`.
`js/core.js` loads first and `js/main.js` last (`index.html` order). Cross-file calls are `OSR.foo()`,
resolved at call time. Keep a helper local to its file unless another file or a test calls it.
Pure modules (`js/monsters.js`, `js/grid.js`, `js/ua-statblock.js`, `js/icons.js`, `js/table-syntax.js`) are UMD-ish:
they also `module.exports` for Node.

| File | Contents |
|---|---|
| `js/core.js` | creates `OSR`; constants, `$`/`$$`/`escapeHtml`/`uid`, `STATE_DEFAULTS`, `load`/`save`/`ensureStateShape`, `CONDITION_SEED`, trackers, `applyTheme` |
| `js/store.js` | IndexedDB (`OSR.store`), `splitState`/`joinState` |
| `js/seeds.js` | the seed store (`OSR.seeds`), seed copies, Settings → New defaults |
| `js/data.js` | `OSR.loadData()`: fetches every `data/` file into `OSR.data` |
| `js/campaigns.js` | campaign selector and Settings → Campaign |
| `js/dice.js`, `js/annotate.js`, `js/dice-ui.js` | dice engine and log; sheet text → roll spans; Dice Roller panel and roll popup |
| `js/characters.js` | character CRUD, View/Edit, UA statblock panel, sheet-selection menu |
| `js/consumables.js`, `js/notes.js`, `js/mde.js` | trackers; the Journal; the shared EasyMDE builder |
| `js/combat.js`, `js/combat-populate.js` | Combat tracker; Populate by HD |
| `js/monsters.js`, `js/monster-form.js`, `js/monster-modals.js`, `js/monster-browser.js` | parser; fields form; add/edit modals; Bestiary tab and PL generator |
| `js/ua-statblock.js`, `js/brp-seed.js`, `js/sl-seed.js`, `js/seed.js` | UA parser and rules; BRP/SL/OSR seeding and pregens |
| `js/compendium.js`, `js/compendium-popups.js` | Compendium CRUD and filters; hover popups and autocomplete |
| `js/maps.js`, `js/grid.js`, `js/tokens.js`, `js/drawings.js`, `js/pins.js`, `js/history.js`, `js/icons.js` | Maps tab |
| `js/tables.js`, `js/table-syntax.js` | Tables tab and table editor; table text parser and master-table roller |
| `js/settings.js`, `js/io.js`, `js/dropbox.js` | Settings; paste modal, Export/Import, packs; Dropbox |
| `js/main.js` | `wire()` calls every `wireX()`, `init()`, `boot()`, the test seam, the last-tab memory |
| `scripts/*.js` | CLI converters (bestiary, spells, tables, token icons, icon index) |
| `test/*.test.js`, `test/helpers/boot.js` | `node:test` suites; boots the app in jsdom |

## Run and test

```
python3 -m http.server       # then http://localhost:8000/
npm test                     # node --test; also runs in CI (.github/workflows/test.yml)
npm run convert-bestiary     # data/bestiary_data.json → data/monsters.json
npm run convert-spells       # data/spell_data.json → data/spells.json
npm run convert-tables       # data/tables/*.csv → data/tables.json
```

- `jsdom` and `fake-indexeddb` are the only (dev) dependencies.
- `test/helpers/boot.js` boots `index.html` with the app's scripts in jsdom. It serves `data/` from
  disk in place of `fetch`, gives each boot a fresh fake IndexedDB (pass `indexedDB` from an earlier
  boot to reload), and omits EasyMDE (editors fall back to `<textarea>`). Options: `url`,
  `session`, `extraStorage`, `beforeScripts`, `opener`. `savedState(T)` reads the saved campaign.
- The test seam: when `window.__OSR_ENABLE_TEST_SEAM__` is set, `js/main.js` sets
  `window.__OSR_TEST__ = OSR` and adds `reset()` and `renderAll()`. Anything on `OSR` is testable.
- Values from the app live in jsdom's realm: use `node:assert` (`deepEqual`), not `assert/strict`.
- jsdom has no layout: map tests replace `OSR.mapRect()`.

## Conventions

- **Rendering**: no virtual DOM. `render*()` rebuilds `innerHTML` from `state`. After a change:
  `save()`, then the narrowest `render*()` that covers it. A scene change uses `OSR.saveScene(sc)`
  (undo history) in place of `save()`.
- **Escape** every value from user input or data files with `escapeHtml()`, attributes too.
- **Events**: delegated listeners on stable containers, attached once in a `wireX()`. Never attach
  listeners inside `render*()`.
- **Visibility**: `el.hidden = true/false`, not `style.display`. If CSS gives the element a
  `display`, add `.thing[hidden] { display: none }`.
- **Popups and menus** that close on an outside `mousedown`/`scroll` must whitelist their own
  subtree in those capture listeners. Escape closes everything through `wireEscape()` in `js/main.js`.
- **State**: a new persisted field goes in `STATE_DEFAULTS` and gets a backfill in
  `ensureStateShape()`. Entries made at runtime (`addCharEntry`, `addMonsterEntry`) must have every
  field `ensureStateShape` expects. Everything in `state` is exported and synced: per-device or
  secret data goes in `localStorage` (`osr_map_sticky`, `osr_map_rclick_pan`, `osr_map_views`, `osr_map_pops`, `osr_last_tab`,
  `osr_dropbox_*`).
- **System scoping**: lists of characters, monsters, Compendium entries, and trackers go through
  the per-system helpers (`charactersForSystem`, `monstersForSystem`, `compendiumForSystem`,
  `consumablesForSystem`, `tablesForSystem`), never the bare `state` arrays. Scenes use `scene.system`. See systems.md.
- **Shared data**: `OSR.data` and `OSR.seeds` are read-only. Deep-clone before you put a def in `state`.

## Checklist for a change

1. New persisted field: `STATE_DEFAULTS` and `ensureStateShape()`.
2. New DOM: in `index.html`; add the `[hidden]` guard if CSS sets `display`.
3. Listeners by delegation in the right `wireX()`; escape interpolated text.
4. After a state change: `save()` (or `saveScene()`), then the narrowest render.
5. New outside-click popup: whitelist its subtree.
6. Parser change: update `test/monsters.test.js`, run `npm run convert-bestiary`, commit the output.
7. New behavior: add a test (`test/ui.test.js`, `test/logic.test.js`, or the subsystem's suite).
   A new UI surface that lists characters, monsters, or Compendium entries also goes in the
   "System switch" tests of `test/ui.test.js`.
8. `npm test` passes. Check the change by hand in a browser over http.
9. Update README.md for user-visible changes and the docs/agents note for design changes.
