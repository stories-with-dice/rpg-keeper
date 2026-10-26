# Maps tab

Files: `js/maps.js` (scenes, view, tools, menus), `js/grid.js` (pure geometry, `window.MapGrid`),
`js/tokens.js`, `js/drawings.js`, `js/pins.js`, `js/history.js`, `js/icons.js`. Design history:
[docs/maps-plan.md](../maps-plan.md).

## Scenes and images

- `state.scenes` (`ensureSceneShape()`): `{ id, name, system, imageBlobId, imageType, imageUrl,
  width, height, grid, hexcrawl, tokens, drawings, pins }`. `grid` = `{ type: 'square' | 'hex',
  orient: 'flat' | 'pointy', size, offsetX, offsetY, unitsPerCell, unit, show, locked }`
  (`GRID_DEFAULTS`: flat hexes, 50 px). A scene shows only under its System;
  `state.activeSceneIds[system]` is the open one.
- Images are IndexedDB blobs: `OSR.store.putBlob(id, { bytes: ArrayBuffer, type, width, height })`
  (fake-indexeddb cannot store a jsdom Blob). `storeImage()` → `OSR.decodeImage()` (WebP or PNG,
  `MAX_SIDE` 8192). Sources: file (`#scene-modal`), paste, drop, address (`fetch`; on failure only
  `imageUrl` is kept, with a warning). Duplicate shares the blob; the last scene deletes it.
  `imageHref()` caches object URLs; a missing blob comes from `OSR.dropboxFetchBlob()`.

## Rendering and view

- One `<svg id="map-svg">`, rebuilt by `renderScene()` only while the tab shows. Layers: image,
  grid (a `<pattern>` for squares; `MapGrid.cellsIn()` paths for hexes, at most `MAX_GRID_CELLS`),
  drawings, pins, tokens, overlay. Line widths are one screen pixel in map units.
- `views[sceneId]` (memory) is the viewBox at the box's aspect ratio (`viewOf()`).
  `screenToMap(x, y, rect, view)`. `OSR.mapRect()` is the SVG box (tests replace it). Pan: hand
  tool, middle button, Space, or (option) right button. Zoom: wheel around the pointer, limited by
  `zoomLimits()`. Fit (`fitScene()`) fits the view again.
- `renderScene()` saves the view (`rememberView()`) in `localStorage['osr_map_views']`: scene id →
  `{ cx, cy, s }`, the map point at the center and map px per screen px, so another window size
  keeps the zoom. `viewOf()` starts from it (`savedView()`), else `fitView()`. `writeView()` reads
  the key again before it writes (pop-outs share it). Delete scene removes the row.
- `renderMaps()` ends with `OSR.showScenePops(id)` (the scene's pinned popups, compendium.md) and
  `OSR.updateApplyButton()`: on the Maps tab, "Apply damage" hits `OSR.selectedTokenEntry()` (the
  one selected token's `actorEntry`), else the selected combatant (`damageTarget()`, `js/combat.js`).

## Tokens (`js/tokens.js`)

- `scene.tokens`: `{ id, iconId, x, y, size, color, label, link }`; `link` is `null`,
  `{ kind: 'combat', entryId }`, or `{ kind: 'character', charId }`. Icons are path data only
  (`OSR.allIcons()` = `OSR.data.tokenIcons` + `state.customIcons`), drawn white on a circle of
  `color` (default `#000000`).
- Add: palette click, **From combat** (`addTokenForEntry()`, icon guessed by `tokenIconFor()`), or
  an icon search result. `snapTokenPoint()`: odd sizes on a cell center, even on a corner, hexes
  on a hex center.
- Hand tool: `tokenPointerDown/Move/Up`. Drag moves (snapped on release; Alt free), Shift+click
  adds to the selection (memory only), Shift+drag selects a box, Alt+click pings (overlay CSS
  animation, not saved). Delete/Backspace on `#map-wrap` deletes the selection. `#token-edit` bar.
- A linked token shows the actor's name, side ring, HP ring (`.map-token-hp`), turn ring, down
  state, read live from Combat. `tokenInfo(t)` collects them. `actorEntry(t)` is the token's combat
  entry, or for a character link that character's entry in combat (for statuses).
- **Hover**: a linked token opens a source popup (`openActorPop` → `OSR.openSourcePop`, key
  `actor:<kind>:<id>`, compendium.md): HP/AC chips (not for monsters, whose stat block has them),
  statuses with ✕ (`OSR.removeStatus`), and `OSR.actorStatHtml(entry)` or the character sheet
  (`renderCharMarkdown`). It is pinnable like a Compendium popup, and `renderTracker()` refreshes
  it. Opening one closes other unpinned popups. An unlinked token shows `#token-card` (name only).
  No popup while a mouse button is down or `#map-menu` is open (the map re-renders under the pointer).
- `unlinkTokens(entryIds)` (from `removeEntry()` and Clear): a character's token links to the
  character, another keeps the entry's name as `label`.
- **More icons** (`js/icons.js`): `#icon-search` loads `data/game-icons-index.json` on first use
  (`searchIcons()`, at most 40). `useIcon()` fetches `ICON_URL + id + '.svg'`, keeps path data
  (`iconFromSvg`, refuses transforms or other viewBoxes), stores it in `state.customIcons`. Settings
  credits the authors (`#set-token-credits`).

## Drawings (`js/drawings.js`)

`scene.drawings`: `{ id, kind, points | x,y,w,h | x,y,text,size, stroke, fill, width, opacity }` in
map px. Tools: pen (`simplifyLine`, RDP, ε 1.5 screen px), line, rect, ellipse, polygon (first
corner, double-click, or Enter closes), text (`#map-text-input`), eraser. With the hand tool,
`drawSelectDown` selects and drags one. **Clear drawings** asks and is one undo step. The draw bar
`#map-draw-bar` style is in memory.

## Pins and hexcrawl (`js/pins.js`)

- `scene.pins`: `{ id, x, y, compendiumId }`. `addPin()` makes a pin and a Compendium entry
  `{ category: 'Journal', source: 'Maps', system: currentSystem() }` named "<scene> — Location N"
  (or "— Hex 0412" in hexcrawl mode, snapped to the hex center), unique in the system. Its body
  starts with `**Map:**` and `**Hex:**` lines, written once.
- Hand tool: hover opens the note's popup (`hoverNote`, unpinned); click opens it pinned
  (`openNote` → `setPopPinned`); double-click opens the editor; drag moves. A pin with a note has no
  SVG `<title>`. An orphan pin (entry gone) is gray (`.is-orphan`).
- Right-click: `pinMenu()`: Edit journal entry, Delete pin and journal entry (asks; undo brings the
  pin back, not the entry), Delete pin and keep the journal entry. `#pin-edit` (bottom bar) has the
  same actions; Delete removes the selected pin.
- Hexcrawl (`scene.hexcrawl = { on, explored: ['q,r'], coords }`, hex grids only): unexplored hexes
  are shaded (`.map-unexplored`); the explore tool runs `toggleExplored()`. `coords` labels hexes
  with `MapGrid.hexLabel()` from `MapGrid.labelOrigin()` when a hex is at least 34 screen px.

## Menus

`OSR.openMapMenu(x, y, html, onPick, onClose)` shows `#map-menu`: items have `data-act`;
`onPick(el, e)` returns true to close. Text fields answer Enter and `change`; Escape restores
`defaultValue`; `onClose()` runs before it closes. `onContextMenu` (`MAP_ELEMENTS` = tokens,
drawings, pins): a pin → `pinMenu()`, a token → `tokenMenu()` (label, color, link, unlink,
delete), a drawing → `drawingMenu()` (color, thickness, delete), the map itself → `mapMenu()` (Add a
pin here; Mark hex explored) unless right-click pan is on. Each change is one `saveScene()` step.

## Toolbar, modes, hotkeys

- Order: tools, sticky, right-click pan, undo, redo, fit, pop out, then the **Grid**, **Tokens**,
  and **?** menus (`<details class="map-drop">`, one open at a time, `closeMapPanels()`), then scene
  controls. `#map-status` floats bottom-right. Nothing that opens moves the map.
- Tools: `measure` (`measureText()`, `MapGrid.distance`), `calibrate` (drag `#grid-span` cells →
  `MapGrid.gridFromRect()`; arrow keys nudge the offset, Shift 10 px). `grid.locked` blocks both.
- Sticky (`osr_map_sticky`, on): off → `toolUsed()` returns to the hand tool after one use.
- Right-click pan (`osr_map_rclick_pan`, off): on → a right drag on the map itself pans.
- `onPointerDown` focuses `#map-wrap` (`preventScroll`) so Delete reaches `onMapKey`.
- Hotkeys (`onHotkey`, Maps tab only, not in fields or modals): Alt + `KeyboardEvent.code`.
  `Digit1`…`Digit0`, `Minus`, `Equal` click the `.map-tool` with that `data-key`; `KeyS` sticky,
  `KeyF` fit, `KeyO` pop out, `KeyG`/`KeyK` the Grid/Tokens menu.

## Undo (`js/history.js`)

Every scene change goes through `OSR.saveScene(sc)`: it saves and records `{ before, after }` JSON of
`name, grid, hexcrawl, tokens, drawings, pins` (`trackScene()` takes the first "before"). One
history per scene, in memory, 200 steps. `rebaseScene()` (from `unlinkTokens()`) keeps undo from
re-linking a token. `finishLoad()` and a campaign switch call `resetHistories()`. Keys: Ctrl/Cmd+Z,
Ctrl/Cmd+Shift+Z, Ctrl+Y (Maps tab, no field or modal).

## Pop-out window

`#map-popout` → `popOut()` opens `?view=map`. There `init()` runs `initPopout()` (`js/main.js`): no
data fetch, `load()`, seeding, or Dropbox. `attachToMain(window.opener.OSR)` makes `OSR.state`,
`OSR.campaigns`, `OSR.campaignId` getters onto the main window and forwards `save`, `saveNow`,
`flushSave`, `pushNote`, history, `dropboxFetchBlob`, `renderCompendium`. `wirePopout()` wires only
Escape, Compendium editor and popups, and the map modules. `notifyMapViews()` (from `save()`)
redraws the other windows (once per tick, never during a drag). When the main window closes,
`mainWindowClosed()` shows `#map-popout-closed`. Test: `test/popout.test.js` (boot's `opener`).
