# Dice, annotate, variables

## Engine (`js/dice.js`)

- `evalFormula(str)` → `{ total, detail, normalized, dice, flat }` or `null`. Grammar: `NdM`, `+`/`-`
  chains, `kh|kl|dh|dl` + count, `d%`. No dice → `1d20 + <it>`. `dice` = kept dice
  (`{ value, sides, sign }`), `flat` = signed constants (Scarlet Heroes uses both).
- `doRoll(formula, source, vars)`: `substituteVars` for `$Name`, then eval, `pushLog`, and
  `lastRoll` (drives Apply damage). An unknown `$Name` is rejected (`Invalid: … (unknown $Name)`).
  A `%NN` formula goes to `rollPercent()`.
- 3D dice (`js/dice3d.js`, ported from the owner's Wox dice roller `overlay/render.js`): `doRoll`
  and `rollPercent` pass the kept dice to `pushLog(…, { dice })`, which calls
  `OSR.show3dDice(dice, { source, formula, total, detail, onLanded })`. Not the random tables or the
  Combat detail rolls (saves, morale, …): they call `pushLog` without `dice`.
  - `diceToShow(dice)` (pure) maps the dice to `{ key, sides, top, pair }`: `key` is the body (d3–d30,
    `dF`, `d10t`/`d10u` for the two d% dice, `token` for any other size), `top` the label that lands
    up. At most 20.
  - The order: the throw is simulated at once (`simulate()`: gravity, bounces, die-to-die hits,
    friction, in CSS px), and its bounces, hits, and face roll-overs become sound events. The frames
    play back on `.dice3d-canvas`; each die turns so it ends with the rolled face up. At
    `settleTime + 0.15 s` the `.dice3d-panel` shows the total, `OSR.diceSound.land()` clicks, and
    `onLanded()` runs. The dice fade 2.2 s later.
  - `pushLog` saves the entry at once, but its log line, `showLast()`, and `updateApplyButton()` run in
    `onLanded`. While `OSR.dice3dBusy()` is true, `updateApplyButton()` hides Apply damage.
  - `onLanded` runs exactly once: on landing, on `clearDice()` (Escape, a new roll, 3D dice turned
    off), when three.js or WebGL fails, or from a fallback timer (`settleTime + 1.15 s`) because a
    hidden browser tab runs no animation frames.
  - three.js loads on the first 3D roll. The canvas and the panel have `pointer-events: none`. Off when
    `osr_dice_3d` is `'off'` (Settings → 3D dice), with `prefers-reduced-motion`, without WebGL, and in
    jsdom: then `show3dDice` returns false and the result shows at once.
- Dice skin (`osr_dice_skin`, Settings → Dice skin, default `'theme'`): `SKINS` in `js/dice3d.js`
  are 12 skin defs (body colors, ink, pattern, roughness, metalness, opacity, edge color);
  `paintSkin()` draws the pattern (`gem`, `marble`, `galaxy`, `flame`, `frost`, `wood`, `metal`) under
  each face label. `skinFor(pref)` gives one die its skin: `'theme'` builds one from `--accent`,
  `'random'` picks one of the 12 for each die. `DICE_SKINS` is the dropdown list (Theme color, the 12,
  Random). `show3dDice` takes `info.skin` to override the setting (the Settings preview throw).
- Dice sound (`osr_roll_sound`, Settings → Dice sound, on): with 3D dice, `js/dice-sound.js` (from
  the Wox `overlay/sound.js`) plays the throw's events (die click, table thud, clack, roll click) and
  `land()`; its AudioContext starts in the rolling click (`show3dDice` calls `context()`). Without
  3D dice, `pushLog` plays `playRollSound()` (the swoosh).
- `pushLog(source, formula, total, detail)` is a roll line; `pushNote(source, text, detail)` a plain
  line (`{ md: true }` renders Markdown).

## Annotate (`js/annotate.js`)

- `annotate(root, { vars })` wraps `DICE_RE`, `MOD_RE`, `VARREF_RE`, `PCT_RE` matches in
  `<span class="roll" data-formula>` and `[refs]` in `.comp-ref`. It skips `<code>`, `<pre>`, `<a>`.
  Run it after every `marked.parse()` whose dice should roll.
- `DICE_RE` takes chains of dice, integers, and `$Name` (`1d6+$CON+2`, `1d8+1d4`) as one span.
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
modifier plus chained variable `<select>`s; `rollPopupFormula()` builds the formula.
`rollOwnerFor(el)` picks the variables and log source like the click handlers.
