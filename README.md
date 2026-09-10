# Character Keeper

A single-page app for keeping **tabletop RPG characters** — OSR / old-school systems (Shadowdark,
Worlds Without Number, OSE, …) and **Unknown Armies 3rd Edition** — and running **basic combat**.
Settings → **System** switches which ruleset's characters and Compendium you're looking at. Plain
HTML/CSS/JS — no build step, no server required, no account, nothing leaves your browser.

- **Live:** deployed to GitHub Pages from `main` (see the repo's Pages settings for the URL).
- **Local:** just open `index.html` in a browser. Everything works from `file://`, including the
  bundled monster library. (Serving over a local web server also works and is slightly cleaner.)

---

## Your data

Everything is stored in your browser's **`localStorage`** (key `osr_manager_v1`). It survives
reloads and browser restarts, but it is per-browser and per-machine.

- **Export** (top bar) downloads a single `osr-manager-YYYYMMDD.json` with *all* your data —
  characters, notes, consumables, the monster library, the current encounter, settings and the log.
- **Import** offers **Replace all** or **Merge** (adds the file's characters + monsters to what you have).

Use Export/Import to back up, move between machines, or share a party.

---

## Character tab

- Pick a character from the **Character** dropdown. Create one with **New blank**, **Paste from
  clipboard** (reads a sheet off your clipboard), or **New from text…** (paste into a box). The first
  heading or line becomes the name; `[WWN]` / "Shadowdark" in the text sets a system badge.
- A campaign can hold several characters. The **Character B** dropdown puts a second character
  side by side, one per column. With **Character B** set to *— none —*, the single sheet is split
  into two columns at the first standalone `---` line in its Markdown (text before it on the left,
  text after it on the right); with two characters shown, `---` is just a normal rule.
- **View / Edit** toggle. View renders the sheet as Markdown; Edit is the raw Markdown source
  (Edit always acts on **Character**, not Character B).
- In View mode, **dice formulas and modifiers are underlined and clickable** (blue, dotted):
  - `2d6+3`, `1d20+4`, `4d6kh3`, `1d8 + 2` → rolled as written.
  - A bare `+1` / `-2` / `+0` → rolled as `1d20 ± that`.
  - Every click is logged under the character's name.
- Also in View mode, **names in `[square brackets]` are underlined (violet, dashed)** and looked up
  in the **Compendium** on hover — see that tab. Short all-caps tags like `[WWN]` are left alone.
- **Rename** / **Delete** act on the selected character.

### Character-sheet variables
Write `Name: value` anywhere in a sheet — `value` a plain, optionally-signed integer — and it's
picked up as a **variable** you can reference in dice formulas. In View mode the name is highlighted
in its own colour and the value keeps its usual blue, clickable-roll underline:

```
CON: -1, STR: 0, DEX: +1
```

detects `CON` = -1, `STR` = 0, `DEX` = +1. Several fields can share a line, separated by a comma,
semicolon, or `|` (in addition to each just being its own line) — e.g. `HP: 10 | AC: 14 | AB: +0`
detects `AC` and `AB`.

A value can have more after it, as long as a space separates them — parsing simply **stops at the
first number**, so a common "modifier with the score in parentheses" layout works too:

```
ATTRIBUTES
STR: +1 (14)
DEX: +0 (9)
CON: +1 (14)
```

detects `STR` = +1, `DEX` = +0, `CON` = +1 (the `(14)`, `(9)` are never looked at). The same rule
applies whichever number comes first — `STR: 14 (+1)` instead detects `STR` = 14. A number with
*no* separating space, like the `19` in `HP: 19/19`, doesn't count — only `HP: 19` (or `HP: 19,
…`) would.

**Use a variable in a dice formula** with `$Name` — e.g. `1d6+$CON+2` rolls `1d6` plus that
character's current `CON` plus 2. The rendered formula shows just the name (`1d6+CON+2`); **hover**
it to see each variable's current value in the tooltip (`1d6+CON (-1)+2`). Typing `$` in the sheet
editor or the Dice Roller's custom-formula box pops up a list of that character's detected variables
to pick from. If a name changes or a sheet is edited, `$Name` always resolves against whatever the
sheet says *right now*.

**Right-click any dice roll** (in a sheet, in Combat, in a Compendium popup, or a Dice Roller preset)
to open a small popup with a flat **modifier** field and a dropdown to add one of the character's
variables to the roll — picking one adds another dropdown so you can stack several — before rolling.

### Journal
A **campaign-wide** Markdown composer below the sheet (a proper editor —
[EasyMDE](https://github.com/Ionaru/easy-markdown-editor), with the `[` Compendium autocomplete).
Press **Enter** to log the current text to the **Session Log** as a *Journal* entry (rendered as
Markdown there) and clear the box; **Shift+Enter** inserts a new line. The unsent draft is saved and
survives reloads.

### Consumables (right side)
Campaign-wide trackers with **− / value / +** and an optional **max**, shared across every character.
Each character gets an **HP (Name)** line (starts `0 / 0`; auto-filled from that character's
sheet `HP: x/y` when you add them to combat, and renamed if you rename the character).
Add lines for rations, torches, arrows, rage uses… Delete a line with **✕**.
Blank or `0` max means "no upper limit".

---

## Dice roller (right side, always visible)

Preset buttons: `d20`, `Adv` (2d20 keep-highest), `Dis` (2d20 keep-lowest), `d4`–`d12`, `d100`,
`2d6`, `3d6`, `4d6kh3`. Plus a **custom formula** field.

Formula grammar: `NdM` (e.g. `3d6`), `+`/`-` chains (`2d6+3`, `1d8-1`), keep/drop
(`kh`/`kl`/`dh`/`dl` + number, e.g. `4d6kh3`), and `d%`. Typing a bare number/modifier rolls a d20.

After a roll, an **Apply damage** button appears — it subtracts the result from the **currently
selected combatant** (HP, or HD/HP under Scarlet Heroes rules — see Settings).

---

## Session log (bottom, always visible)

Every roll, status change, side change and library roll is logged with a timestamp (and, in combat,
the round number). **Copy** puts the log on your clipboard; **Clear** empties it. Capped at 500 lines.

---

## Combat tab

### The tracker
- **Add character…** (dropdown of your characters) or **Add monster…** (opens the library, below).
  A second copy of the same name gets a `(1)`, `(2)`… suffix.
- Combatants are shown top-to-bottom in initiative order. **Drag rows** to reorder. **Initiative is
  entered manually** — the app never rolls it.
- **Round** counter with **− / +**. **Next ›** / **‹ Prev** move the active-turn marker (`◀ turn`)
  through the order; going past the end bumps the round.
- **Hotkeys** (while the Combat tab is focused and you're not typing in a field):
  `↑` / `↓` move the selection, `N` / `P` advance / rewind the turn.
- Per row: a **side dot** (click to cycle neutral → ally → enemy), name, and **✕** to remove.
  Second line: **HD** stepper (monsters only), **HP** stepper with `/ max`, **AC**, saves and
  attacks (monsters), and **status tags**.
- **HD / HP steppers**: `−` / `+` adjust by 1; you can also type directly. HD keeps any `*` / `+`
  suffix.
- A combatant at **HP 0** is greyed out with its name struck through.
- **Sides**: allies get a faint green row, enemies a faint red one. Characters default to ally,
  monsters to enemy.

### Right-click a combatant
Opens a menu with:
- **Change side → ally / enemy** — flips the side (logged).
- A scrollable list of **status conditions** — click to add/remove. Hover a tag on the row to see
  its description and an **✕** to clear it. Comes prepopulated with the common OSR set (Blinded,
  Charmed, Frightened, Grappled, Paralyzed, Poisoned, Prone, Stunned, Unconscious, …).
- **New condition…** — name + description; added to the library and applied.

All status add/removes are logged with the round they happened.

### Selected combatant detail (below the tracker)
- **Monster**: AC / THAC0 / HD / HP / MV / AL / XP chips; clickable **attacks** (a *to-hit* button
  rolls `1d20 + bonus`; a *damage* button rolls just the damage dice and enables **Apply damage**);
  clickable **saves** and a **Morale** roll; special abilities (dice inside them are clickable); and
  the raw stat block.
- **Character**: the rendered character sheet, with its dice/modifiers clickable.

### Monster library
Reached via **Add monster…**. Seeded on first run with the full Shadowdark core bestiary (Title Case)
plus a couple of Old-School Essentials examples.

- **Search** by name and filter by **HD** (min / max). The count shows `matches / total`.
- **Roll** picks a random monster from the filtered list, highlights it and scrolls it into view
  (logged).
- **Hover** a row for a stat-block popup.
- Per row: **Add** (to combat), **Edit** (opens the stat block in an editor — saving re-parses it),
  **✕** (remove from library).
- **Paste** pane (right): paste one or more stat blocks and send them to the library, optionally
  also dropping them straight into combat. A **Paste text / Fill in fields** toggle above it switches
  to a structured form instead (see the **Bestiary** tab below) — the same toggle appears when you
  **Edit** a monster, so editing isn't raw-text-only either.

---

## Bestiary tab

A persistent, filterable view of the whole monster library — same idea as the Compendium tab, but for
monsters. **+ New monster** and Combat's own **+ Add monster…** open the exact same modal described
above; **Search** and **HD** min/max filter the list the same way the modal's own do. Per row:
**Add to Combat**, **Edit**, **✕** (remove from library).

### Fill in fields
Instead of pasting a stat block, switch the add/edit modal to **Fill in fields** and pick a **Format**
— **Shadowdark** (a single AC, and S/D/C/I/W/Ch stat modifiers) or **Old-School Essentials** (a
descending AC — the matching ascending AC is derived automatically — THAC0, D/W/P/B/S save targets,
and Morale). Add as many **Attacks** (label, count, to-hit, damage, note) and **Abilities**
(name + description) rows as the monster needs with **+ Add**; **✕** removes a row. Saving builds the
monster's stat-block text from whatever you entered, so it displays (and can be switched back to
**Paste text**) just like a pasted one.

### Random monster generator
Rolls a monster following the Shadowdark core rulebook's Monster Generator and Monster Mutations
tables, for a given **Party Level**:

- Its AC is `Party Level + 10`; a **Combat** roll sets its Level (and attack bonus) somewhere around
  that Party Level, and picks a flavor **Quality** (e.g. *Draconic*, *Undead*, *Ooze*) with a
  matching **Strength** and **Weakness**.
- Its HP is rolled from its Level (in d8s); it has a random number of attacks (1-4), each a d8.
- The **Mutations** stepper (0-3) adds that many extra special abilities, each from the rulebook's
  own numbered mutation table.

**Generate…** doesn't add the result straight to the library — it lands in the add modal's **Fill in
fields** form (with an editable placeholder name like "PL 3 Draconic Creature") so you can review,
rename, or tweak anything before saving it for real.

---

## Compendium tab

A personal reference of **Items, Spells, Abilities, Rules** and **Other** entries. Each entry has a
name, a **category**, a **source**, and a Markdown body edited in a proper Markdown editor
([EasyMDE](https://github.com/Ionaru/easy-markdown-editor), vendored). It comes seeded with the
**Shadowdark RPG core gear** (weapons, armor, basic gear) as Items sourced *Shadowdark Core*.

- **+ New entry** opens the editor modal — category defaults to **Other**, source to **Unknown**
  (the source box offers your existing sources as suggestions).
- **Filter**: tick/untick the **Category** and **Source** checkboxes; type in **Search** to match
  entry *names*. **Full text** also searches the body; **Fuzzy** switches to approximate matching
  ([Fuse.js](https://fusejs.io/), vendored). The count shows *matches / total*.
- Click a row (or its **Edit**) to edit; **✕** deletes.

### Bracket lookup
Put an entry's name in `[square brackets]` in a sheet (View mode), the Journal, or **another
Compendium entry's body**. It renders underlined in violet; **hover** it for a popup:

- **Match found** — the entry's Markdown rendered as HTML, plus an **Edit** button. Bare dice
  formulas in the description (`1d6`, `2d6+3` — not in backticks) are clickable and logged under the
  **entry's name**. Nested `[refs]` in the body are themselves hoverable. Matching is
  case-insensitive exact first, then fuzzy; with several matches, the `‹ n / N ›` arrows in the
  header (or **↑ / ↓** while hovering) page through them. The body scrolls normally when it's long.
- **Fuzzy match** (no exact name) — a line at the top says so, with the match confidence (e.g.
  *88%*), and a **New** button sits next to **Edit** to create the entry you actually meant.
- **No match** — a note and a **Create entry** button (pre-fills the name; category **Other**).

**Make a link from the sheet:** in View mode, select some text, **right-click → "Add … to
Compendium"**. The editor opens with that text as the name; on **Save**, the sheet's Markdown source
has that text replaced with `[Entry Name]`, so it becomes a live link.

Popups **stack** — hovering a link inside a popup opens another, and the whole chain stays while the
mouse is anywhere in it. Each popup has a **📌 pin** (keeps it open after the mouse leaves) and an
**×**. **Esc** closes every popup; clicking elsewhere closes the unpinned ones. A **pinned** popup
can be **dragged by its header** to reposition it.

### `[` autocomplete
In the sheet editor, the Journal, and the Compendium entry editor, typing `[` followed by **2+
characters** pops a search of Compendium entry names. **↑ / ↓** to move, **Enter / Tab** or click to
insert `[Name]`, **Esc** to dismiss. With text selected, pressing `[` or `]` in any of those editors
wraps the selection in `[ ]` instead of replacing it.

---

## Settings tab

- **Style theme** (default **Default**). Recolours and re-fonts the whole app; dark mode only.
  **Fantasy** — parchment & gold on mahogany, serif type. **Sci-fi** — cyan on cold slate, wide
  caps. **Horror** — bone & blood on near-black. The choice is saved with your data and included in
  Export/Import.
- **Scarlet Heroes damage resolution** (default **off**). When on, **Apply damage** translates
  *each* damage die individually — `1 → 0`, `2–5 → 1`, `6–9 → 2`, `10+ → 4` — sums the results, and
  applies that to a **monster's HD** or a **character's HP**. A flat damage bonus is folded into the
  single highest die before translating. If a monster is already at 0 HD but still has HP, the hit
  drops its HP to 0. Off: the raw rolled total comes off HP.
- **Monster library → Reload defaults** — replaces the library with the bundled set (your
  pasted-in monsters are lost; combatants already in the tracker are untouched).
- **Compendium → Reseed defaults** — adds back any bundled entry (the Shadowdark core gear) that
  isn't already present, matched by name; your own entries and edits are left alone.
- **Compendium → Delete all** — clears every Compendium entry after a confirmation. They don't come
  back on reload; use **Reseed defaults** to restore the bundled gear.

---

## Supported stat-block formats

Pasted monsters (and the character-sheet examples) are parsed automatically. Two monster formats:

**Shadowdark**

```
BEAR, POLAR
A mighty, white bear that thrives in arctic environments.
AC 13, HP 34, ATK 2 claw +6 (2d6), MV near (climb), S +4, D +1, C +3, I -2, W +1, Ch -2, AL N, LV 7
Crush. Deals an extra die of damage if it hits the same target with both claws.
Thick Fur. Cold immune.
```

**Old-School Essentials**

```
Bulette
15′ long, hard-shelled reptiles with huge maws...
AC 0 [19] Hd 9* (40hp) Att Bite (4d12) + 2 × claw (3d6) THAC0 12 [+7] Mv 150′ (50′) sv D8 W9 P10 B10 S12 (9) ML 11 AL Neutral XP 1,600 TT None
▶ Ravenous: Will attack anything living.
▶ Leap: If cornered, can leap forward 20′, attacking with all 4 claws.
```

Paste several at once — a blank line between them is ideal, but back-to-back blocks are handled too.

---

## Credits

- Monster data: the **Shadowdark RPG** core bestiary (© The Arcane Library) — see
  `data/bestiary_data.json`.
- Bundled libraries (no CDN, works offline): [marked](https://marked.js.org/) for Markdown,
  [Font Awesome Free 6.5.2](https://fontawesome.com/) for icons.

See [AGENTS.md](AGENTS.md) if you want to work on the code.
