# Content pack format

This document is for tools that write files for Keeper's **Import** button. It describes the
**content pack**: one JSON file that adds Compendium entries, Bestiary monsters, and random tables
to a user's Keeper. Two tools write packs today:

- The Silent Legions Foundry VTT system (`module/import/keeper-pack.mjs` in
  `silent_legions_foundry_vtt`). It reads the user's PDF.
- The UA3 data tools (not public). They read the user's Unknown Armies PDFs.

A pack holds book text. Keep packs out of public repositories, this one included. The test fixture
`test/fixtures/sl-pack.json` has the same shape with made-up text: use it as an example.

## What Keeper does with a pack

1. The user clicks **Import** and picks the file. A file with a `pack` object is a content pack.
   Any other JSON is a full campaign export (see "Full exports" at the end).
2. Keeper opens the import picker. The user sees every item of the pack in groups and categories,
   and ticks what to import:
   - **Compendium**, one category per `category` value.
   - **Bestiary**, one category for all monsters.
   - **Tables**, one category per `output` value.
3. An item that the user already has is marked **you have it** (the match rules are below).
   Keeper skips it, unless the user ticks **Replace the items I already have**. A replaced item
   keeps its Keeper id.
4. Keeper adds the ticked items:
   - Compendium entries and monsters go into the current campaign, in the pack's system.
   - Tables go into the table library. Every campaign and every system sees the table library.
5. Keeper also adds the ticked Compendium entries and monsters to the **seed store** of the pack's
   system. The seed store is shared by every campaign on the device (and by every device, through
   Dropbox sync). Other campaigns then offer the pack in Settings (**New defaults**).
6. Keeper switches the System to the pack's system.

An import never deletes anything and never replaces the whole campaign.

## Top level

```json
{
  "pack": { "name": "Silent Legions (from your PDF)", "system": "sl", "version": 3, "createdAt": "2026-10-27T10:00:00.000Z" },
  "compendium": [ ... ],
  "monsters": [ ... ],
  "tables": [ ... ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `pack.name` | yes | Shown in the picker and in the Session Log. It is also the default `origin` of a table. |
| `pack.system` | yes | One of `osr`, `ua3e`, `brp`, `sl` (see "Systems"). An unknown value means the current System. |
| `pack.version`, `pack.createdAt` | no | Keeper ignores them. Useful for your own tracking. |
| `compendium` | no | List of Compendium entries. A missing list counts as empty. |
| `monsters` | no | List of Bestiary monsters. |
| `tables` | no | List of random tables. |

Do not put a `characters` list in a pack. Keeper ignores it.

### Systems

| `system` | Game | Table settings by default |
|---|---|---|
| `osr` | OSR games (Shadowdark, OSE) | Fantasy |
| `ua3e` | Unknown Armies 3rd Ed | Modern |
| `brp` | Basic Roleplaying | Fantasy |
| `sl` | Silent Legions | Modern, Horror |

A Compendium entry or a monster can carry its own `system`. A valid `system` on an item wins over
`pack.system`. Leave it out, unless one pack must fill two systems.

## Compendium entries

```json
{
  "ref": "slpdf:rule:occult-disciplines",
  "name": "Occult Disciplines",
  "category": "Rules",
  "source": "Sorcery",
  "body": "Markdown text. See [Telepathy]. Roll 1d6."
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The title. Other text links to the entry by this name in `[Name]`. |
| `category` | yes | One of `Items`, `Spells`, `Powers`, `Abilities`, `Rules`, `Journal`, `Other`. Keeper changes any other value to `Other` after the import. |
| `source` | no | Free text, shown as a filter (for example "Weapon (Melee)" or "Spell Level 3"). Default `Unknown`. |
| `body` | no | Markdown. `[Name]` links to another entry of the same system (a hover popup). Dice such as `1d6` or `2d8+1` roll when clicked. |
| `ref` | recommended | A stable id that is unique in the pack, for example `<tool>:<kind>:<slug>`. Keep it the same between versions of your pack. |

**Match rule** (an entry "you have"): same system, and the same `ref`, or else the same name (not
case-sensitive) and the same category.

## Monsters

A monster is a Keeper monster def. The fields depend on the system. Every system uses these:

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The name in the Bestiary and in Combat. |
| `ref` | recommended | A stable id, unique in the pack (`slpdf:monster:zombie`). Keeper also uses it as the seed id. |
| `source` | yes | The stat-block shape: `shadowdark`, `ose`, `brp`, `sl`, or `ua3e`. |
| `raw` | recommended | The stat block as text. Keeper shows it, and the edit form can parse it again. |
| `desc` | no | A description. |
| `abilities` | no | A list of `{ "name": "", "text": "Undead" }`. A plain string is changed to `{ name: "", text }`. |

Keeper gives each monster a new `id`. An `id` in the pack is used only as the seed id when there is
no `ref`.

**Match rule**: same system, and the same `ref`, or else the same name (not case-sensitive).

### OSR, Silent Legions (`source`: `shadowdark`, `ose`, `sl`)

```json
{
  "name": "Zombie", "ref": "slpdf:monster:zombie", "source": "sl",
  "ac": { "asc": null, "desc": 7, "thac0": null },
  "hd": "2", "hdNum": 2, "hp": 9,
  "attacks": [{ "label": "rend", "count": 1, "toHit": 1, "damage": "1d6", "note": "", "raw": "" }],
  "attacksText": "rend +1 (1d6)", "atkBonus": 1,
  "move": "30'", "moraleML": 12, "align": "", "xp": null, "stats": null,
  "saveTargets": { "Save": 14 }, "savesText": "14+",
  "abilities": [{ "name": "", "text": "Undead" }],
  "raw": "Zombie\nAC 7, HD 2 (9hp), Atk rend +1 (1d6), ..."
}
```

- `hd` is text (`"2"`, `"½"`, `"9*"`). `hdNum` is its number (`½` is 0.5). Populate by HD uses
  `hdNum`.
- `hp` is a number. Combat starts the monster with it.
- `attacks[].count` is the number of attacks, `toHit` the bonus, `damage` a dice formula (empty for
  "by weapon", with `note: "by weapon"`).
- `attacksText` uses Keeper's format: `2 claw +3 (1d4), bite +3 (1d6)`.
- Silent Legions adds `skill` (number), `madness` (`"None"`, `"1d6"`, `"None / 1d6"`),
  `slaughterDie` (`"1d6"`), and `mundaneImmune` (true shows AC with `*`). `ac.asc` is `null`
  and `ac.desc` is the book's descending AC. `saveTargets` has one key, `Save`.
- Keep `hd`, `hdNum`, `hp`, the saves, `attacksText`, and `raw` consistent with each other.

### Unknown Armies (`source`: `ua3e`)

`raw` is the only source of truth: Keeper parses it each time it shows the monster. Put the name,
the description, `Type:`, `Book:`, `Wound Threshold:`, `Obsession:`, the identities, and an
`Abilities` section in it, as a GMC stat block. `notes` (Markdown) is optional. Set `hd: ""`,
`hdNum: 0`, `hp: 0`, `attacks: []`, `abilities: []`.

### Basic Roleplaying (`source`: `brp`)

The OSR shape, plus `characteristics` (an object such as `{ "STR": 25, "CON": 18, "SIZ": 25, "POW": 7 }`;
leave out the ones the creature does not have), `armor` (a number), `armorNote`, `damageBonus`
(`"+2D6"`), `attacksText` (`"Bite 50%, 1D10+dm"`), and `skillsText`. Leave `hd`, `ac`, `stats`, and
`saveTargets` out. `data/seed-brp.json` has 73 examples.

## Tables

```json
{
  "name": "Cult",
  "origin": "Silent Legions",
  "settings": ["Modern", "Horror"],
  "output": "Group",
  "source": "# Creating Cults: roots, how it manifests, minions, a name, and its god\n1d1\n1: Roots: [Cult: Roots of the Evil]; Name: [Cult Name]\n"
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Unique in the pack (not case-sensitive). No `[` or `]`. Other tables roll on this table by this name. |
| `source` | yes | The table text (see "Table text"). A table without `source` is skipped. |
| `origin` | recommended | Where the table comes from, shown as the **Source** filter. Default: `pack.name`. Use a short book name such as "Silent Legions". |
| `settings` | recommended | A list of `Fantasy`, `Modern`, `Horror`. Default: from `pack.system` (see "Systems"). Unknown values are dropped. |
| `output` | recommended | What the table makes: `Encounter`, `Entity`, `Location`, `Adventure`, `Group`, or `Other` (default). |
| `system` | no | Used only for the default `settings`. |

Keeper reads values without regard to case, and it reads a plural output (`"encounters"` →
`Encounter`). An older pack may have one `setting` string in place of `settings`: Keeper still
reads it.

How to choose `output`:

| Output | For tables that make… | Examples |
|---|---|---|
| `Encounter` | something the party meets now | terrain and city encounter tables |
| `Entity` | one being: a creature, an NPC, a god, an alien | Alien Race, One-Roll Actor, Monster Twist |
| `Group` | an organization or a set of beings | Cult, Pantheon, minions |
| `Location` | a place, a realm, a tag for a place | Kelipah, Location Tags |
| `Adventure` | a plot, a scene, a hook, a crime | Adventure Template, Scene Challenge |
| `Other` | everything else: spells, items, names, effects | Dark Sorcery, Occult Grimoire, Lovecraftian Name |

Give the sub-tables of a generator the output of the generator (the parts of "Alien Race" are
`Entity`). The **Output** filter then shows a generator with its parts.

**Match rule**: the same name (not case-sensitive) in the table library. With **Replace**, Keeper
replaces the text, `origin`, `settings`, and `output` of that table, and keeps its id and name.

### Table text

```
# A comment line. Blank lines are skipped too.
d10
1-2: [Ruin]
3-5: A camp of [1d4+1] [Bandit Kind]
6-7: The [Words.Group] of the [Words.Hue] [Words.Thing]
8-0: [2x Ruin]
```

- **Line 1** (after comments) is the die: `d12`, `1d20`, `2d6`, `d100`, `1d1`. A table that always
  gives its one entry uses `1d1`.
- **Columns**: add names after the die with `|`: `d12 | Group | Hue | Thing`. Then each entry has
  one cell per column, split with `|`: `1: Circle | Grey | Lamp`.
- **Entries**: one line each, `range: text`. A range is `4` or `1-2` (`–` and `—` work too). On a
  d10, `0` is 10; on a d100, `00` is 100. Write a range on every line: a line without one takes the
  next number, and a text that starts with a number and a colon reads as a range.
- **One line per entry**: put no line breaks in an entry. Replace `[` and `]` in book text with
  `(` and `)`, because Keeper reads brackets as lookups.
- The ranges must cover the die once, with no gaps and no overlaps. Keeper warns about gaps and
  overlaps. A table with an error (no die line, no entry, a range that goes down) is imported, but
  it cannot be rolled.

### Lookups (master tables)

An entry can roll on other tables:

| Text | Meaning |
|---|---|
| `[Name]` | Roll on the table `Name` (not case-sensitive). |
| `[Name.Column]` | Roll on a table with columns, and take one column. |
| `[2x Name]`, `[1d4x Name]` | Roll more than once. The results are joined with `, `. |
| `[2d6]` | Roll dice inside the text. |

- A lookup can name a table of the pack, a table the user has, or a built-in table.
- Depth limit: 12 lookups deep. Repeat limit: 20. A table that rolls on itself is an error.
- **Layout**: an entry that is a list of labelled lookups, `Label: [Table]; Label: [Table]`, shows as
  an outline: one line per label, and a sub-table that is such a list goes indented under its
  label. `;` ends a line. `Text — [Table]` puts the sub-table under the text when that sub-table is an outline itself. Text such as
  `A [Color] [Shape]` stays on one line.
- The Tables tab's **Don't show included subtables** filter (on by default) hides every table
  that another table looks up. So the user sees your generators first, and the parts appear when
  they search or click a lookup. Name the parts so that a search finds them (for example
  `Cult: Roots of the Evil`).

## Re-importing a newer version of a pack

- Keep each `ref` and each table `name` the same between versions.
- Without **Replace**, Keeper adds only the new items.
- With **Replace**, Keeper also updates the items the user has. It replaces the user's own edits
  of those items.

## Checklist for a pack writer

1. `pack.name` and `pack.system` are set.
2. Every Compendium entry and monster has a stable, unique `ref`.
3. Every `category` is in the Compendium category list.
4. Every table `name` is unique and has no `[` or `]`.
5. Every table has `origin`, `settings`, and `output` from the lists above.
6. Every table text has a die line, one line per entry, and ranges that cover the die once.
7. Every `[Name]` lookup names a table in the pack (or a table the user has).
8. Monster numbers (`hd`, `hdNum`, `hp`, saves) agree with `raw`.
9. Test: import the pack in Keeper, roll the generators, and import it again (the picker must show
   every item as **you have it**).

## Full exports

Keeper's **Export** writes a full campaign file: Keeper's whole campaign state plus `tables` (the
table library). Its **Import** asks Replace all or Merge, and it has no picker. Write a full
export only to move a whole campaign. To add content, write a content pack.
