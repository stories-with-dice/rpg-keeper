# Dice, annotate, variables

## Engine (`js/dice.js`)

- The parser and roller are the library's `RpgDice` (`vendor/rpg-dice-3d/rpg-dice.js`, see AGENTS.md).
  Its grammar: dice with keep/drop (`kh|kl|dh|dl|k`), exploding (`!`), rerolls (`r`, `ro`), `dF`, `d%`,
  `+ - * /`, parentheses, and a test (`<`, `>=`, …). Its random source is `rollDie()`
  (`Math.random`), so the tests script the dice with `rigRandom`.
- `evalFormula(str, base)` → `{ total, detail, normalized, dice, rolled, flat, fate }` or `null`. It adds
  the app's rules on top of `RpgDice`: no dice → `base` + it (`1d20`, 4dF in Fate); `dF` alone is
  `4dF`; text the library cannot parse still rolls the dice and numbers in it (`1d6 fire` → `1d6`,
  `abc` → the base die); a count above 100 is clamped to 100. `dice` = kept dice
  (`{ value, sides, sign }`), `rolled` = every die rolled (`{ value, sides, kept }`, for the 3D dice),
  `flat` = the total minus the signed kept dice (Scarlet Heroes uses both). `detail` lists each term
  of a `+`/`-` chain with all its dice (`2d20kh1 [8, 17] kh1 +2`); other formulas get the library's
  detail (`[(8), 17] + 2 = 19`).
- `doRoll(formula, source, vars)`: `substituteVars` for `$Name`, then eval, `pushLog`, and
  `lastRoll` (drives Apply damage). An unknown `$Name` is rejected (`Invalid: … (unknown $Name)`).
  A `%NN` formula goes to `rollPercent()`.
- 3D dice: the engine is the library's `RpgDice3D` (`vendor/rpg-dice-3d/rpg-dice-3d.js`; its README
  has the API). `js/dice3d.js` is the app side. `doRoll` and `rollPercent` pass every rolled die
  (`res.rolled`: dropped dice too, `kept: false`) to `pushLog(…, { dice })`, which calls
  `OSR.show3dDice(dice, { source, formula, total, detail, onLanded })`. Not the random tables or the
  Combat detail rolls (saves, morale, …): they call `pushLog` without `dice`.
  - `diceToShow(dice)` (pure) maps the dice to the library's list (`RpgDice.dieToDice3D`):
    `{ shape, sides, top, pair, kept }`. `shape` is the body (d3–d30, `dF`, `d10t`/`d10u` for the two
    d% dice, `token` for any other size), `top` the label that lands up. At most 20.
  - The order: `RpgDice3D.loadThree()` loads three.js on the first roll, then `RpgDice3D.throwDice()`
    simulates the throw at once (gravity, bounces, die-to-die hits, friction, in CSS px), and its
    bounces, hits, and face roll-overs become sound events. The frames play back on the library's
    stage (`div.rpg-dice3d`); each die turns so it ends with the rolled face up. At
    `settleTime + 0.15 s` the panel (`.rpg-dice3d-panel`) shows the total, `RpgDiceSound.land()`
    clicks, dropped dice go dim, and `onLanded()` runs. The dice fade 2.2 s later. `css/app.css` fits
    the stage to the theme with the library's `--rpg-dice3d-*` variables.
  - `pushLog` saves the entry at once, but its log line, `showLast()`, and `updateApplyButton()` run in
    `onLanded`. While `OSR.dice3dBusy()` is true, `updateApplyButton()` hides Apply damage.
  - `onLanded` runs exactly once: on landing, on `clearDice()` (Escape, a new roll, 3D dice turned
    off), when three.js or WebGL fails, or from the library's fallback timer (1 s after the reveal
    time) because a hidden browser tab runs no animation frames.
  - The stage has `pointer-events: none` (no `skipOnClick`). Off when
    `osr_dice_3d` is `'off'` (Settings → 3D dice), with `prefers-reduced-motion`, without WebGL, and in
    jsdom: then `show3dDice` returns false and the result shows at once.
- Dice skin (`osr_dice_skin`, Settings → Dice skin, default `'theme'`): the skins are the library's
  14 (`RpgDice3D.SKINS`: body colors, ink, pattern, roughness, metalness, opacity, edge color).
  `skinFor(pref)` gives one die its skin: `'theme'` builds one from `--accent`
  (`RpgDice3D.colorSkin`), `'random'` picks one of the 14 for each die. `DICE_SKINS` is the dropdown
  list (Theme color, the 14, Random). `show3dDice` takes `info.skin` to override the setting (the
  Settings preview throw).
- Dice sound (`osr_roll_sound`, Settings → Dice sound, on): with 3D dice, the library's
  `RpgDiceSound` plays the throw's events (die click, table thud, clack, roll click) and `land()`;
  its AudioContext starts in the rolling click (`show3dDice` calls `context()`). Without 3D dice,
  `pushLog` plays `playRollSound()` (the swoosh).
- `pushLog(source, formula, total, detail)` is a roll line; `pushNote(source, text, detail)` a plain
  line (`{ md: true }` renders Markdown).

## Annotate (`js/annotate.js`)

- `annotate(root, { vars })` wraps `DICE_RE`, `MOD_RE`, `VARREF_RE`, `PCT_RE` matches in
  `<span class="roll" data-formula>` and `[refs]` in `.comp-ref`. It skips `<code>`, `<pre>`, `<a>`.
  Run it after every `marked.parse()` whose dice should roll.
- `DICE_RE` takes chains of dice, integers, and `$Name` (`1d6+$CON+2`, `1d8+1d4`) as one span.
- `VARCHAIN_RE` (runs after `DICE_RE`, before `MOD_RE`) takes a dice-free chain of `$Name`s and signed
  integers that holds at least one `$Name` (`+$STR+$WeaponMastery`, `+2+$DEX`) as one span. Its
  formula has no dice; `evalFormula`'s fallback adds the d20 (4dF in Fate) after `substituteVars`.
- `ADV_TAG`: `DICE_RE`, `VARCHAIN_RE`, and `MOD_RE` take an optional `(adv)`/`(dis)`/`(disadv)` tag
  (`+0(adv)`). `rollFormula()` bakes it into `data-formula` through `OSR.withAdv` (`2d20kh1+0`); the
  label keeps the tag.
- The label drops `$`; the `title` shows `Name (value)` through `formatFormulaDisplay` when `vars`
  are passed. Each call site passes its own character's `charVars()`: per column in
  `renderCharView()`, `combatCharFor(ent)` in Combat, `activeChar()` in Compendium popups.

## Sheet variables

- `scanVariables(text)`: `Name: ±N`; the number stops at a space, `,`, `;`, `|`, or the end
  (`STR: +1 (14)` → 1; `HP: 19/19` does not match). `findMatches()` marks `.var-name` and
  `.var-value` (an unsigned value gets an explicit `+`, so `1d20` + `0` is not `1d200`).
- `charVars(ch)` scans the rendered sheet (so `**CON**: +1` does not count). The last name wins.
- `substituteVars`: a leading sign folds into the value (`+$CON` with −1 → `-1`).
- Which character: sheet rolls → `charViewTarget()`; Combat → `combatCharFor(entry)`; Dice Roller →
  `activeChar()`; map token popups → the linked character.

## Roll-with-modifiers popup (`js/dice-ui.js`)

A right-click on any `.roll` or a Dice Roller preset opens `#roll-popup` (`openRollPopup`): a flat
modifier and the `#rp-adv` Normal/Advantage/Disadvantage `<select>` on one row, plus chained variable
`<select>`s; `rollPopupFormula()` builds the formula.

- Advantage helpers in `js/dice.js`: `advModeOf(f)` reads the first single d20 term (`1d20`, `d20`,
  `2d20kh1`, `2d20kl1`) → `'adv'`/`'dis'`/`''`. `withAdv(f, mode)` rewrites that term
  (`'1d20+2'` + `'adv'` → `'2d20kh1+2'`); a dice-free formula gets `1d20` first. `canAdv(f)` is false
  for `%NN`, for Fate, and for dice without a single d20 (`1d8`, `3d20`); then `#rp-adv` is disabled.
- `#rp-adv` starts at `advModeOf(formula)`, so the sheet's `(adv)` and the **Adv**/**Dis** presets
  preselect it.

Ctrl/Cmd+Enter in a `.edit-col-area` calls `saveEdit()` (`js/characters.js`).
`rollOwnerFor(el)` picks the variables and log source like the click handlers.
