# Maps, campaigns, and per-system Dropbox files: plan

Status: planned, no code yet. Each section below is one PR, in order. Every PR keeps `npm test` green
and adds the tests listed in its "Tests" part.

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Fog of war / player view | No. The pop-out is a copy of the GM view. |
| 2 | Hexcrawl | A toggle for each scene, off by default, hex grids only. Explored hexes and hex coordinates inside this mode. |
| 2 | Location notes | Pins in every mode. A pin opens a Compendium entry with category `Journal`. |
| 3 | Hex orientation | Flat-top and pointy-top, a scene setting. |
| 4 | Measure tool | Yes, with units per cell for each scene. |
| 5 | Area templates | Later, not in this plan. |
| 6 | Combat on the map | Highlight the active entry's token, HP ring, ring color by side. |
| 7 | Combat entry → token | Drag a combat entry onto the map to make a linked token. |
| 8 | Pings | Yes. |
| 9 | Lock layers | Lock the map image and the grid. |
| 10 | Undo history | Memory only, one stack for each scene, lost on reload. |
| 11 | Seeds | One seed file for each system in Dropbox (`seeds/<system>.json`). A campaign keeps its own copy of what it adds. |
| 11 | Pack import | A content pack writes into `seeds/<system>.json` (replace by `ref`) and into the current campaign. |
| 11 | Campaign import | Changes only the current campaign. Merge replaces items with the same `seedRef`. |
| 12 | Scenes | In `<system>.json` for each campaign. |
| 13 | Export | Vendored zip library (fflate). Checkbox "Include map images". Import reads `.json` and `.zip`. |
| 14 | Local storage | `OSR.state` moves from `localStorage` to IndexedDB. |
| 15 | Icon search | Fetches SVGs from the network only when the user searches. |
| 16 | `file://` | Not supported any more. The app runs over http(s) only. |
| — | Standalone release | Remove `release.yml` and `scripts/bundle-standalone.js`. |
| — | ES modules | No. Keep the `window.OSR` namespace (jsdom does not run `<script type="module">`). |
| — | Dropbox sign-in | Redirect flow. Pasting the code stays as a fallback. |

## Shared test infrastructure (PR 1, extended in later PRs)

- `test/helpers/fake-dropbox.js`: move `fakeDropbox` and `fakeOpen` out of `test/dropbox.test.js`.
  Extend the fake with:
  - `files/list_folder` and `files/list_folder/continue` (returns `content_hash` for each file, with a cursor).
  - Folder paths (`/campaigns/<id>/osr.json`, `/seeds/osr.json`, `/campaigns/<id>/maps/<blob>.webp`).
  - Binary upload and download bodies (`ArrayBuffer`/`Blob`), with the real `content_hash`.
  - The redirect sign-in (`/oauth2/authorize` with `redirect_uri`, then `?code=` on the app URL).
  - Fault hooks: `onDownload`, `failNext(endpoint, status)`, and edits from a "second device" between calls.
- `test/helpers/boot.js`:
  - Serve `data/*.json` and `data/*.txt` through a `fetch` stub that reads from disk. It hands any other URL to the Dropbox fake.
  - Load `fake-indexeddb` (new devDependency, like `jsdom`) before the app scripts.
  - A `boot({ url })` option so a test can start the app at `index.html?view=map` or at a redirect URL with `?code=`.
- `test/helpers/fake-image.js`: replaces the image decoder and the WebP encoder (jsdom has no canvas). The app calls them through one function, `OSR.decodeImage(blob)`, so tests can replace it.

---

## PR 1: remove `file://` support

**Code**
- Load the data with `fetch()`:
  - Load `data/monsters.json`, `data/spells.json`, and `data/tables.json`.
  - Remove `js/monsters-data.js`, `js/spells-data.js`, and `js/tables-data.js`.
  - The converters in `scripts/` write only the JSON files.
- Move the hand-written seeds to `data/*.json`:
  - Move `js/brp-monsters-data.js`, `js/brp-compendium-seed.js`, `js/sl-monsters-data.js`, `js/sl-compendium-seed.js`, and the gear part of `js/compendium-seed.js`.
  - Each file gets `{ system, version, compendium, monsters }`.
- Load the pregen sheets with `fetch()` from `data/*.txt`:
  - `seed()` and `addMissingPregens()` in `js/seed.js` read them that way.
  - Remove `SEED_FALLBACK` and the inline sheet constants.
  - `missingPregens()` reads the names from a small `data/pregens.json` index.
- `init()` in `js/main.js` waits for the data with `Promise.all` before the first render. The app shows a loading state until then.
- Dropbox sign-in: `connect()` in `js/dropbox.js` sends `redirect_uri` = the app URL. `initDropbox()` reads `?code=` on boot, calls `finishConnect()`, and removes the code from the URL with `history.replaceState`. The `#dbx-code` paste field stays as a fallback.
- Remove `.github/workflows/release.yml`, `scripts/bundle-standalone.js`, `test/bundle-standalone.test.js`, and the `bundle-standalone` npm script.
- Update `AGENTS.md` ("What this is", "Layout", "Seeding & the `file://` constraint", "Dropbox sync") and `README.md`.

**Tests**
- Logic test: every seed file in `data/` parses, and has `system`, `version`, and unique `ref` values.
- Logic test: a fresh boot seeds the same characters, monsters, and Compendium entries as before. Use counts, plus a few named items for each system.
- Logic test: `addMissingPregens()` still adds only missing pregens, and keeps `activeId`/`activeIdB`.
- Logic test: a failed data `fetch()` shows an error state and does not write an empty state over saved data.
- Tests for `test/tables.test.js` and the converters, without the `*-data.js` sync checks.
- Dropbox test: redirect sign-in, from a consent URL with `redirect_uri`, then a boot with `?code=`, to signed in, with the code removed from the URL.
- Dropbox test: the paste fallback still works.
- Dropbox test: a bad `?code=` shows the error and stays signed out.

## PR 2: local storage in IndexedDB, and campaigns

**Code**
- New file `js/store.js`. It is the IndexedDB database `osr_store`, with three object stores:
  - `docs`: one record for each JSON document. The key is `<campaign-id>/campaign`, `<campaign-id>/<system>`, or `seeds/<system>`.
  - `blobs`: map images and token SVGs. The key is the blob id, and the value is `{ blob, type, size }`.
  - `meta`: per-device data, for example the active campaign and the Dropbox sync records.
- `load()` and `save()` in `js/core.js` become async and go through `js/store.js`.
  - `save()` writes only the documents that changed. It keeps a dirty set for each document.
  - `OSR.state` stays one object in memory, so `render*()` code does not change. A split function maps it to documents and back:

    ```js
    splitState(state)   // → { campaign: {...}, systems: { osr: {...}, ua3e: {...} } }
    joinState(docs)     // → state
    ```

- Split rules:
  - Characters go by `charSystemKey()`.
  - Monsters and Compendium entries go by `system`.
  - Combat and scenes go to the active system.
  - Trackers go to the owner's system when they are an HP, Wounds, or Madness tracker (`consumablesForSystem()`), or to `campaign` otherwise.
  - Log, Journal, conditions, and settings go to `campaign`.
- Campaigns:
  - `meta.campaigns` holds `[{ id, name, createdAt }]` and `meta.activeCampaignId`.
  - A Campaign selector in the header lets you switch, create, rename, and delete a campaign. Delete asks for confirmation, and it is not possible on the last campaign.
- Migration on the first boot: `localStorage['osr_manager_v1']` → campaign "Default". The migration keeps the old key until the first save succeeds, then removes it.

**Tests**
- Logic test: `splitState(joinState(x))` round-trips for a state with characters, monsters, Compendium entries, and trackers in all four systems.
- Logic test: each item ends in the right document, for example an `sl` character with its HP and Madness trackers goes to `sl`, and `Rations` goes to `campaign`.
- Logic test: a save after one edit writes only the changed document. The test counts the IndexedDB writes.
- Logic test: migration from an old `localStorage` save gives the same `OSR.state`, and removes the old key only after the write.
- Logic test: a failed migration write keeps the old key.
- UI test: create, switch, rename, and delete a campaign. Each campaign shows only its own characters.
- UI test: a campaign switch re-renders every tab.
- UI test: the existing "System switch: …" tests still pass inside one campaign. Add the Maps tab to them in PR 4.

**Done (differs from the plan above)**
- Combat stays in the campaign document, not in a system document. There is one combat tracker for each campaign, as before.
- Per-device values stay small and synchronous: the campaign list and the active campaign are in the IndexedDB `meta` store, but the Dropbox sync records stay in `localStorage['osr_dropbox_v1']`, now as `files[campaignId]`.
- Until PR 3, Dropbox keeps one file for each campaign: the primary campaign keeps `/Character Keeper campaign.json`, and every other campaign uses `/campaigns/<id>/campaign.json`.

## PR 3: Dropbox sync of many files, and seed files

**Code**
- `syncNow()` syncs a list of files. Each file has its own record in `meta`: `fileId`, `remoteHash`, and `syncedHash`.
- `decideSync()` runs for each file and does not change.
- Boot:
  1. Make one `files/list_folder` on `/campaigns/<id>/` and one on `/seeds/`.
  2. Download only the files whose `content_hash` changed.
  3. Load `campaign.json` and the active `<system>.json` first.
  4. Load the other system files and the seeds after the first render.
- Save: `dropboxNoteSave(docKey)` uploads only the dirty documents, with the same debounce (`UPLOAD_DELAY`, `MAX_WAIT`).
- Blobs:
  - Upload a blob if it is missing in Dropbox. Download a blob when a scene needs it.
  - A blob never changes after the upload, so blobs have no conflict check.
- Conflicts: `#dbx-modal` shows the file name, and you choose one copy for each file.
- Migration: an existing `/Character Keeper campaign.json` becomes campaign "Default" in Dropbox, split into files. The app keeps the old file and renames it to `/Character Keeper campaign (before split).json`.
- Campaign list in Dropbox: `/campaigns/index.json`, so a new device sees all campaigns.
- Seeds:
  - A code seed version higher than the version in `seeds/<system>.json` updates that file.
  - Settings shows "OSR seed: N new, M changed. Apply?" when the campaign's copies are behind the seed.
  - **Apply** adds the new items. It updates changed items, except items you edited (the item's hash differs from its `seedHash`). A second button also overwrites edited items.
- Content-pack import (`importPack` in `js/io.js`): writes the pack items into `seeds/<system>.json` (replace by `ref`) and adds them to the current campaign.
- Campaign import, Merge: an imported item with a `seedRef` replaces the campaign item with the same `seedRef`.

**Tests** (all with the fake Dropbox)
- First connect with an empty Dropbox:
  - Creates `campaigns/index.json`, `campaign.json`, one file for each non-empty system, and the seed files.
- First connect with an old single file:
  - Splits the file.
  - Keeps the renamed old file.
  - Gives the same `OSR.state` as before.
- Boot with nothing changed: the fake records the `list_folder` calls and no `files/download`.
- Boot after a second device edits `osr.json`: downloads only `osr.json`.
- Edit one character: uploads only that system's file, once, after the debounce (`T.dropboxFlush()`).
- Conflict on one file:
  - `ua3e.json` changes on both sides, so the modal names that file.
  - Each choice (Dropbox copy, this browser's copy, decide later) gives the right result.
  - The other files keep syncing.
- A blob upload that fails with an error: retried on the next pass. The scene still shows the local image.
- A missing blob on a new device: downloaded when the scene opens.
- Seed update:
  - Raise the code seed version. The test checks that Settings shows the counts.
  - **Apply** adds new items and skips edited ones.
  - **Overwrite** replaces them too.
- Two campaigns of the same system:
  - Each keeps its own copy.
  - An edit in one does not change the other.
- Pack import:
  - Writes `seeds/ua3e.json`.
  - A second campaign shows the notice and gets the items on **Apply**.
- Campaign Merge import with a newer seeded item: replaces the old copy. A user item with the same name stays.
- 401 during a multi-file pass: refreshes once and continues. A second 401 signs out without partial writes to `meta`.
- Storage full (fake IndexedDB quota error): no sync record is written, and the next reload does not upload the old data.

**Done (differs from the plan above)**
- The campaign document is `/campaigns/<id>/shared.json`, not `campaign.json`: PR 2 already used `/campaigns/<id>/campaign.json` for a whole non-primary campaign, and that old file must stay recognizable for the split.
- One question for each campaign, not one for each file: the dialog names the files and one choice applies to all.
- Files are found by path; the "find a renamed file by its id" feature is gone.
- Blob sync moves to PR 4, where the first blobs (map images) appear.
- A campaign deleted in one browser is hidden there (`meta.hidden`); other browsers keep it, and it stays in the index.
- A new code seed version no longer re-seeds by itself; Settings → New defaults offers it, also for an older campaign.

## PR 4: Maps tab, scenes, images, grid, zip export

**Code**
- New file `js/maps.js` with `wireMaps()`, `renderMaps()`, and `renderScene()`.
- New tab `data-tab="maps"` and `#tab-maps` in `index.html`.
- Scene shape in `<system>.json`:

  ```js
  { id, name, imageBlobId, imageUrl, width, height, locked: { image, grid },
    grid: { type: 'square' | 'hex', orient: 'flat' | 'pointy', size, offsetX, offsetY, unitsPerCell, unit },
    hexcrawl: { on: false, explored: [], coords: false },
    tokens: [], drawings: [], pins: [] }
  ```

- Scene list: add, rename, duplicate, delete, and switch. `state.activeSceneId` is stored for each system.
- Rendering: one `<svg>` with these layers, in order: image, grid, drawings, pins, tokens, and an overlay for the tools. Pan with a drag on an empty area or with Space+drag, and zoom with the wheel. Both change the `viewBox`.
- The grid is an SVG `<pattern>` for squares. For hexes it is a generated path, limited to the visible area.
- Pure geometry in `js/grid.js`: `cellAt(x, y, grid)`, `cellCenter(cell, grid)`, `cellsCovered(cell, size, grid)`, `distance(a, b, grid)`, and hex axial math for both orientations. No DOM.
- Coordinates: `screenToMap(evt, svgRect, viewBox)` is a pure function, because jsdom has no `getScreenCTM`.
- Image input:
  - File picker and drag-and-drop.
  - Ctrl/Cmd+V of an image on the Maps tab.
  - URL field: try `fetch()`. If CORS blocks it, keep `imageUrl` only and show a warning.
  - `OSR.decodeImage()` converts to WebP with a maximum side of 8192 px and stores the result in `blobs`.
- Grid calibration: the "Set grid" tool is a drag over one cell → `size`, `offsetX`, `offsetY`. Arrow keys nudge by 1 px. A size field gives manual entry.
- Measure tool: drag to show the distance in cells and in `unit`.
- Lock: the image and the grid ignore drags while they are locked.
- Export:
  - Vendor fflate in `vendor/fflate/`.
  - Export with "Include map images" writes a `.zip` with `campaign.json`, `<system>.json` files, `maps/`, and `tokens/`.
  - Import accepts `.json` and `.zip` files.

**Tests**
- `test/grid.test.js` (pure):
  - `cellAt`/`cellCenter` round-trip for squares, flat hexes, and pointy hexes, with offsets.
  - `cellsCovered` for sizes 1–3 on each grid type.
  - `distance` for known pairs.
- UI test: add a scene from a file. The blob is in IndexedDB, the scene has `imageBlobId`, and `<image>` is in the SVG.
- UI test: paste an image (fake `paste` event with a file item). The test checks the same result.
- UI test: the URL field when `fetch()` works stores a blob. When `fetch()` fails, the test checks `imageUrl` and the warning.
- UI test: rename, duplicate, delete (with confirm), and switch scenes. The active scene persists after a reload.
- UI test: grid calibration drag sets `size`/`offset`. Arrow keys nudge. The manual field overrides.
- UI test: square and hex grids render, and the orientation switch changes the hex path.
- UI test: pan and zoom change the `viewBox`, inside limits.
- UI test: lock blocks image and grid drags.
- UI test: the measure tool shows the right distance in cells and units.
- UI test: the "System switch: …" tests now also check that the Maps tab shows only the active system's scenes.
- Logic test: export without images gives JSON. Export with images gives a zip that holds every blob. Importing that zip into a fresh app gives the same scenes and blobs.
- Dropbox test: a new scene uploads its blob to `maps/` and its `<system>.json`.

**Done (differs from the plan above)**
- Only the grid can be locked: the image cannot be moved, so an image lock had nothing to do.
- New: **Drag covers N cells** for calibration, because a one-cell drag was off by about 0.4 px, and that adds up across a map.
- Wheel zoom follows the wheel distance, so mice and trackpads zoom at the same speed.
- The zip's `campaign.json` is the whole state (the same as the .json Export), not one file per system.
- Blob sync is here: images upload in pass step 5 and download only when their scene shows.
- The Maps tab draws only while it shows.

## PR 5: tokens and combat links

**Code**
- 30 preset icons from game-icons.net in `data/token-icons.json` (`{ id, name, author, svg }`). A token is a circle with the icon and a colored ring.
- Token shape:

  ```js
  { id, iconId, x, y, size, color, label, link: null | { kind: 'combat', entryId } | { kind: 'character', charId } }
  ```

- Add a token from the icon palette, with size 1–4 cells. On hexes, size N covers N−1 rings around the center hex.
- Move: drag with snap to the grid. Alt+drag places the token without snap. You can select several tokens with Shift+click or a box, and move them together.
- Link: a link picker in the token panel. A drag from a combat entry (`js/combat.js`) onto the map makes a linked token.
- Unlink: `removeEntry()` in `js/combat.js` calls `OSR.unlinkTokens(entryId)`. Example: before `{ link: { kind: 'combat', entryId: 'k3x' }, label: null }`, after `{ link: null, label: 'Goblin 2' }`.
- Labels: the name always shows. It is the linked actor's name, else the label, else the icon name.
- Hover card: HP, AC, statuses, and side, from the combat entry or the character.
- Combat state on the map: the token of `state.combat.activeId` has a highlight, an HP ring, and a ring color by side.
- Ping: Alt+click shows a pulse for 2 s. Pings are not saved.
- Delete: select the token, then press Delete or Backspace.
- Credits: Settings lists the game-icons.net authors (CC BY 3.0).

**Tests**
- UI test: add a token of each size on squares and on hexes. The token snaps to the right cell center.
- UI test: drag a token. Snap and Alt without snap give the right `x`/`y`.
- UI test: a group move moves all the selected tokens.
- UI test: a link to a combat entry shows the entry's name and the hover card values. Changing the entry's HP updates the ring.
- UI test: `removeEntry()` keeps the token, sets `link: null`, and keeps the last name as `label`.
- UI test: a link to a character survives the end of combat.
- UI test: a drag from a combat entry makes a linked token.
- UI test: the active combat entry's token has the highlight. **Next turn** moves it.
- UI test: a token with no link shows the icon name.
- UI test: delete a token.
- UI test: hover card text goes through `escapeHtml()`. A monster named `<img onerror>` shows as text.
- UI test: the ping shows and is not in the state.
- Logic test: the 30 preset icons have unique ids, valid SVG, and an author.

**Done (differs from the plan above)**
- No drag from a combat entry to the map: the Combat and Maps tabs never show together. The token panel's **From combat** list places a linked token in one click instead.
- When a character's combat entry is removed, its token links to the character (it keeps showing HP and AC) instead of losing its link.
- The icons are kept as path data only (`scripts/build-token-icons.js` refuses anything else), so the app never inserts a downloaded SVG. PR 9 should keep this rule.
- The game-icons GitHub repository layout is verified: `<author>/<name>.svg`, served by jsDelivr at `https://cdn.jsdelivr.net/gh/game-icons/icons@master/<author>/<name>.svg`; the file list is `https://data.jsdelivr.com/v1/packages/gh/game-icons/icons@master?structure=flat` (4,229 icons, 6.8 MB).
- The selected-token bar sits over the map, so selecting does not move the map during a drag.

## PR 6: drawing, delete, undo and redo

**Code**
- Tools:
  - Pen (freehand, simplified with Ramer–Douglas–Peucker).
  - Line.
  - Rectangle.
  - Ellipse.
  - Polygon.
  - Text.
  - Eraser (deletes whole shapes).
- Style:
  - Color swatches and a color picker.
  - Stroke width.
  - Fill on or off.
  - Opacity.
- Drawing shape:

  ```js
  { id, kind, points, x, y, w, h, text, stroke, fill, width, opacity }
  ```

- Select, move, and delete drawings. "Clear drawings" asks for confirmation.
- Undo is a command stack for each scene, in memory. Each command has `do()` and `undo()`.
  - It covers token add, move, resize, link, and delete, drawing add, move, and delete, pin changes, grid changes, and scene rename.
  - A group move is one command.
- Keys:
  - Ctrl/Cmd+Z undoes.
  - Ctrl/Cmd+Shift+Z and Ctrl+Y redo.
  - The keys are active only on the Maps tab or in the pop-out, and not in a text field or in the Compendium modal.

**Tests**
- UI test: draw each shape kind. The test checks the drawing record and the SVG element.
- UI test: style controls apply to the next shape.
- UI test: the eraser removes the shape under the pointer.
- UI test: undo and redo for each command type. Undo then redo gives the same state as before, compared with deep equality.
- UI test: a new action after undo clears the redo stack.
- UI test: undo stacks are separate for each scene. A scene switch keeps each stack.
- UI test: Ctrl/Cmd+Z in the Journal editor or a text field does not undo the map.
- UI test: undo of a token delete restores its link if the combat entry still exists. If the entry is gone, the token comes back unlinked.
- UI test: "Clear drawings" is one undo step.

**Done (differs from the plan above)**
- Undo uses before/after snapshots of the scene's editable parts, not one `do()`/`undo()` command per action: every change goes through `OSR.saveScene()`, so no action type can be forgotten.
- A change made from Combat (a token unlinked when its entry leaves) is not an undo step.
- The tool buttons are in two groups; the click handler listens on the whole toolbar.

## PR 7: hexcrawl mode and location notes

**Code**
- Hexcrawl toggle in the scene settings, enabled only on hex grids:
  - Click a hex to mark it explored or not explored.
  - Unexplored hexes show a light shade.
  - A coordinate toggle shows the hex labels (column-row, for example `0412`).
- Pins work in every mode. In hexcrawl mode a pin snaps to the hex center.
- `COMPENDIUM_CATEGORIES` in `js/core.js` gets `'Journal'`.
- A new pin creates a Compendium entry: `{ category: 'Journal', name: '<scene> — <hex or "Location">', system: currentSystem() }`. The pin stores `compendiumId`.
- Click a pin to open the entry in the popup from `js/compendium-popups.js`. Double-click opens the Compendium editor.
- Delete a pin: the app asks if it should delete the entry too.

**Tests**
- UI test: the hexcrawl toggle is disabled on a square grid.
- UI test: mark and unmark explored hexes, with undo.
- UI test: coordinate labels for both orientations match `js/grid.js`.
- UI test: a new pin creates a `Journal` entry in the active system. The entry shows in the Compendium list with the Journal filter.
- UI test: a pin in hexcrawl mode snaps to the hex center.
- UI test: clicking a pin opens the popup with the entry text.
- UI test: delete a pin, both with and without deleting the entry.
- UI test: the "System switch: …" test now also checks that a Journal entry from `osr` does not show under `ua3e`.
- Logic test: `ensureStateShape()` accepts `Journal` and keeps older entries' categories.

**Done (differs from the plan above)**
- Hex numbers count from the first whole hex in the image's top-left (cut-off edge hexes get none), and show only when a hex is at least 34 screen px wide.
- The pin bar has three actions: Edit note, Delete pin (keeps the note), Delete pin and note (asks). Undo brings a pin back, not a deleted note.
- A second pin in the same hex gets a numbered note name ("… (2)"), so note names stay unique for `[links]`.

## PR 8: pop-out window

**Code**
- **Pop out** opens `index.html?view=map` with `window.open`.
- In that mode, `boot()` in `js/main.js` shows only the map view. It reads and writes through `window.opener.OSR` (same origin), so it uses one state and needs no sync.
- The main window calls `OSR.renderMapViews()` after each change, and that re-renders every open map view.
- When the opener closes, the pop-out shows "Main window closed" with a **Reopen** button.
- Pop-out tools: pan, zoom, move tokens, draw, and ping, with the same undo stack.

**Tests**
- Boot a main app and a second jsdom window with `opener` set to the first and `?view=map` in its URL.
- UI test: moving a token in the pop-out updates the main window's state and SVG.
- UI test: drawing in the main window shows in the pop-out.
- UI test: undo in the pop-out undoes the main window's last map action.
- UI test: closing the opener shows the message in the pop-out.
- UI test: the pop-out does not render the other tabs.

**Done (differs from the plan above)**
- The pop-out wires only the map, the Compendium editor and popups, and Escape. It never wires Dropbox: the Dropbox settings in `localStorage` are shared, so a second sync pass would collide with the main window's.
- With no main window, the pop-out shows **Open the app here**, which loads the full app in that window.
- The Claude built-in browser opens `window.open` in the same tab, so the two-window flow was tested only in jsdom.

## PR 9: icon search and download

**Code**
- Vendor a search index of the game-icons.net icon names, authors, and paths in `data/game-icons-index.json`. Search runs locally with Fuse (`js/fuse.min.js`).
- **Use** fetches the SVG from the game-icons GitHub repository through jsDelivr. The exact URL layout is not verified yet: check it first. The app stores the SVG in `blobs` and adds it to `state.tokenIcons` for each campaign. Dropbox sync uploads it to `tokens/`.
- Errors: when you are offline or the fetch fails, the app shows a message, and the preset icons still work.
- Credits list in Settings includes downloaded icons.

**Tests**
- Logic test: search finds icons by name and by author.
- UI test: **Use** with a fake `fetch` returning an SVG stores the blob, adds the icon to the palette, and uploads it to the fake Dropbox `tokens/`.
- UI test: a failed fetch shows the message and adds nothing.
- UI test: a downloaded SVG with `<script>` or `on*` attributes is cleaned before use.
- UI test: a second device downloads the icon from `tokens/` when a token uses it.

**Done (differs from the plan above)**
- Downloaded icons are kept as path data in `state.customIcons` (the campaign document), not as blobs in IndexedDB and a Dropbox `tokens/` folder: a few KB each, synced with the campaign, and no second-device download step.
- A click on a result downloads the icon and places a token in one step.
- A hostile SVG is reduced to its path data (other elements and attributes are dropped); odd path data, a transform, or another viewBox is refused with a message.
