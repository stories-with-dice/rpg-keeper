# Combat (`js/combat.js`)

## Entries

`state.combat` = `{ round, activeId, selectedId, entries }`. An entry is
`{ id, kind: 'character' | 'monster', charId?, monster?, name, hd, hp, maxHp, side, statuses }`, made
by `addCharEntry(charId)` or `addMonsterEntry(def)` (both set every field `ensureStateShape`
expects). `uniqueName()` numbers duplicates.

- HP: `entryHp`/`entryMaxHp`/`setEntryHp`. A character's HP is its `HP (Name)` tracker
  (`hpConsumable`); while that tracker is 0/0 it comes from the sheet (`charDetectHp`).
- `entryDown(e)`, `acDisplay(m)`, `charQuickAC(ch)`.
- `removeEntry()` and **Clear** call `OSR.unlinkTokens(ids)` first (maps.md).
- Scarlet Heroes damage (`applyDamageToSelected`, `shDie`) turns damage into HD loss; not for BRP.
- System-specific rows and details: systems.md.

## Statuses

- `state.conditions`: `{ id, name, icon, desc }`, seeded from `OSR.CONDITION_SEED` (`js/core.js`).
  `defineCondition(name, desc)` adds one (sorted by name).
- `e.statuses`: `[{ name, icon, round, ts }]`. `toggleStatus(entryId, name)` and
  `removeStatus(entryId, name)` log the change with the round, save, and render.
- `statusTagsHtml(e)` (row) and `statusListHtml(e)` (detail panel, map popups) render tags; the
  `.status-x` button removes one.

## Right-click menu (`#ctx-menu`)

`openCtxMenu(x, y, entryId)`: Change side, the condition list, **More**, New condition…

- A condition the user added (name not in `CONDITION_SEED`) that the entry does not have goes in
  the **More** flyout (`.ctx-more` > `.ctx-submenu`; hover, or a click on `.ctx-more-btn` toggles
  `.is-open`). `.ctx-flip` / `.ctx-up` open it to the left or upward when it would leave the window.
- `#ctx-menu` has `overflow: visible` (its `.ctx-list` scrolls) so the flyout shows.
- Closes on an outside `mousedown`, a scroll outside it, resize, Escape.

## Rendering

`renderCombat()` = bar + `renderTracker()` + `renderCombatantDetail()` + `updateApplyButton()`.
Use the narrower ones for local changes. `renderTracker()` also calls `OSR.refreshSourcePops()`
so the map's token popups follow HP and statuses. `actorStatHtml(ent)` is the read-only stat block
for those popups (no roll buttons; `annotate()` makes the dice roll).

Tracker: drag rows to reorder; ↑/↓ select, N/P next/previous turn (`onCombatKey`). Detail buttons
(`.cbt-atk`, `.cbt-save`, `.cbt-morale`, SL buttons) are handled in `onDetailClick` before `.roll`.
