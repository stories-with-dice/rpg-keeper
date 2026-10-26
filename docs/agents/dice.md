# Dice, annotate, variables

## Engine (`js/dice.js`)

- `evalFormula(str)` → `{ total, detail, normalized, dice, flat }` or `null`. Grammar: `NdM`, `+`/`-`
  chains, `kh|kl|dh|dl` + count, `d%`. No dice → `1d20 + <it>`. `dice` = kept dice
  (`{ value, sides, sign }`), `flat` = signed constants (Scarlet Heroes uses both).
- `doRoll(formula, source, vars)`: `substituteVars` for `$Name`, then eval, `pushLog`, and
  `lastRoll` (drives Apply damage). An unknown `$Name` is rejected (`Invalid: … (unknown $Name)`).
  A `%NN` formula goes to `rollPercent()`.
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
