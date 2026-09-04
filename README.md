# OSR Manager

A single-page app for keeping **OSR / old-school RPG characters** and running **basic combat**.
Plain HTML/CSS/JS — no build step, no server required, no account, nothing leaves your browser.

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

### Notes
A per-character Markdown scratchpad below the sheet. Autosaves as you type.

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
  also dropping them straight into combat.

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

### Bracket lookup from a character sheet
Put an entry's name in `[square brackets]` anywhere in a sheet (View mode). It renders underlined in
violet; **hover** it to get a popup:

- **Match found** — the entry's Markdown rendered as HTML, plus an **Edit** button. Any dice
  formula in the description (bare, e.g. `1d6` or `2d6+3` — not in backticks) is clickable just like
  on a character sheet; the roll is logged under the **entry's name**. Matching is case-insensitive
  exact first; if nothing matches exactly, the best fuzzy matches are offered and you **scroll**
  inside the popup to page through them (a `n / N` counter shows in the corner).
- **No match** — a note and a **Create entry** button (pre-fills the name; category **Other**).

The pure-hover popup closes when the mouse leaves it; clicking **Edit** / **Create** opens the
full editor modal instead.

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
