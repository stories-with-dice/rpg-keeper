# Compendium, popups, autocomplete

## Entries (`js/compendium.js`)

- `state.compendium`: `{ id, name, category, source, system, body, createdAt, updatedAt }`.
  `category` ∈ `OSR.COMPENDIUM_CATEGORIES` (includes `'Spells'`, `'Powers'`, `'Journal'`); `source`
  is free text (default `OSR.COMPENDIUM_DEFAULT_SOURCE`, "Unknown"); `system` is set at creation
  from `currentSystem()` and never changed by an edit.
- Filters: category and source checkboxes (`#comp-cats`, `#comp-sources`). A right-click isolates
  one (deferred with `setTimeout(…, 0)` so a stray `change` cannot win).
- Editor: `openCompEntry(id | null, prefill)`, an EasyMDE modal (`compMdeInstance()`). Enter saves,
  Shift+Enter is a newline, Escape cancels.
- `seedCompendium()` adds missing-by-name entries on first run. Settings → Reseed defaults calls it;
  Delete all clears only the current system.
- `compResolve(name)` → `{ items, fuzzy, scores }`: exact name first, else Fuse.js fuzzy matches,
  within `compendiumForSystem()`.

## Hover popups (`js/compendium-popups.js`)

- `annotate()` wraps `[bracketed]` text in `<span class="comp-ref" data-name>` (not short
  all-caps tags). A `mouseover` on a ref calls `openCompPop(name, anchor)`.
- A popup is at most `min(280px, 60vh)` high: the header stays and `.cpop-body` scrolls.
- Each popup is its own `.comp-pop` node on `<body>`, tracked in `compPops`
  (`{ el, name, matches, idx, pinned, parentEl, anchor, hideT, combat, source? }`). Links inside a popup
  open more popups; the chain stays while the pointer is in any of them
  (`cancelHideAllPops`/`scheduleHideAllPops`, 180 ms grace).
- The 📌 button (`setPopPinned(pop, on)`) keeps a popup open and makes its `.cpop-head` a drag
  handle. `closePop(pop, cascade)` drops a popup and its unpinned children.
- `renderPop()` adds a `.cpop-resize` grip in the corner. A drag on it sets inline `width`/`height`
  (minimum 200 × 100, inside the window), adds `.is-sized` (no `max-height`; the body fills), and
  pins the popup.
- `pop.combat` is set when the anchor is in `#tab-combat` (or the parent popup has it). The tab
  click handler in `js/main.js` calls `syncCompPopsToTab(tab)`, which sets `hidden` on those popups
  on every other tab.
  `closeUnpinnedCompPops(exceptName)`, `closeAllCompPops()` (Escape). A `mousedown` outside popups
  and refs closes the unpinned ones.
- Several matches: `‹ ›` buttons, or ↑/↓ over the popup. `refreshCompPop()` re-resolves after an edit.
- Popup bodies are `marked` + `annotate()` with the active character's variables; dice roll.
- **Source popups** (`openSourcePop(key, anchor, source)`) are not Compendium entries. `source` is
  `{ render() → { title, badges, html } | null, vars?(), rollSource?(), onClick?(e, pop) → true if
  handled }`. One popup per `key`. `refreshSourcePops()` re-renders them (called by
  `renderTracker()`). The map's linked tokens use this (`js/tokens.js`, key `actor:<link>`).

## Autocomplete

- `[` + 2 chars in the sheet editor, the Journal, or the entry editor opens `#comp-ac`
  (`acFromTextarea`, `acFromCM`). ↑/↓/Enter/Tab/click → `acAccept()` inserts `Name]`.
- `$` opens variable autocomplete at once (`compAC.mode: 'var'`) in the sheet editor and
  `#custom-formula` only (`acFromTextarea`, `acFromFormulaInput`). It inserts the name without spaces.
- Textarea inserts go through `execCommand('insertText')` to keep native undo.

## Sheet-selection menu (`js/characters.js`)

Right-click a text selection in `#mode-view` → `openSelMenu`: `compResolve` matches first
(`data-act="link"`, with a `≈NN%` badge for fuzzy), then "Add … to Compendium" / "Create new entry…".
A match calls `linkSelToExisting(entry)`; create stores `pendingCompLink` and opens the editor;
`saveCompEntry` then calls `applyPendingCompLink(name)`, which replaces the selection with `[name]`
in the right character's body (`charViewTarget(node)`). A right-click on a `.roll` goes to the roll
popup instead.
