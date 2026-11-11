/* js/dice3d.js — 3D dice thrown over the page for every dice roll.
 *
 * The 3D dice, their skins, and their sound are the rpg-dice-3d library
 * (vendor/rpg-dice-3d/: RpgDice3D, RpgDiceSound; a vendored copy, see
 * AGENTS.md). This file is the app side: the settings, the skin choice, and
 * the link to the Session Log.
 *
 * js/dice.js's pushLog() calls OSR.show3dDice(dice, info) for a roll that has
 * dice (doRoll and the percentile roll; not the random tables). `dice` is
 * every die the roll rolled, [{ sides, value, kept }] (sides 'F' for a Fate
 * die, 100 for d%; kept: false for a die that keep/drop dropped, which shows
 * dim). The order of one roll:
 *   1. three.js loads (first roll only, vendor/rpg-dice-3d/three/three.min.js).
 *   2. RpgDice3D.throwDice() throws the dice; they settle on the rolled faces.
 *   3. The panel shows the total, a click plays, and info.onLanded() runs:
 *      js/dice.js then shows the roll in the Session Log and the result box.
 *   4. The dice and the panel stay a moment, then fade.
 * Escape, a new roll, or turning 3D dice off ends the show at once; onLanded
 * still runs (once), so a roll is never lost.
 *
 * Settings → "3D dice" turns it off for this browser (localStorage
 * osr_dice_3d, on by default). It is also off with "reduce motion" in the
 * operating system, without WebGL, and in jsdom (the tests). Off: the result
 * shows at once.
 */
(function (OSR) {
  'use strict';

  const KEY = 'osr_dice_3d';
  const SKIN_KEY = 'osr_dice_skin';
  const THREE_URL = 'vendor/rpg-dice-3d/three/three.min.js';
  const MAX_DICE = 20;
  const DIE_PX = 64;  // die size in CSS px (fewer than 10 dice)
  const HOLD = 2.2;   // s the dice stay after they land

  function dice3dOn() {
    try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; }
  }
  function setDice3d(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* this page only */ }
    if (!on) clearDice();
  }

  /* ---- dice skins ---- */
  // Settings → "Dice skin" (localStorage osr_dice_skin, per device): 'theme'
  // (default, the theme's accent), one of the library's skins, or 'random'
  // (each die of a roll gets its own random skin).
  const DICE_SKINS = [{ id: 'theme', label: 'Theme color' }]
    .concat(RpgDice3D.SKINS.map(s => ({ id: s.id, label: s.label })), [{ id: 'random', label: 'Random (each die)' }]);

  function diceSkin() {
    let v = null;
    try { v = localStorage.getItem(SKIN_KEY); } catch (e) { /* blocked storage: the default */ }
    return DICE_SKINS.some(s => s.id === v) ? v : 'theme';
  }
  function setDiceSkin(id) {
    if (!DICE_SKINS.some(s => s.id === id)) id = 'theme';
    try { localStorage.setItem(SKIN_KEY, id); } catch (e) { /* this page only */ }
  }
  // "Theme color": a skin made from the theme's --accent.
  function themeSkin() {
    let accent = '';
    try { accent = getComputedStyle(document.documentElement).getPropertyValue('--accent'); } catch (e) { /* no styles */ }
    return RpgDice3D.colorSkin(accent, 'theme');
  }
  // The skin of one die for the setting `pref` ('random' picks one each time).
  function skinFor(pref) {
    if (pref === 'random') return RpgDice3D.skin('random');
    return RpgDice3D.skin(pref) || themeSkin();
  }

  // The dice to draw for a roll's dice: [{ sides, value, kept }] in, the
  // library's list ([{ shape, top, sides, pair, kept }]) out, at most MAX_DICE.
  // d% is two d10s: tens "00"–"90" and units "0"–"9" (100 = "00" + "0").
  function diceToShow(dice) {
    const out = [];
    (dice || []).forEach(d => {
      RpgDice.dieToDice3D(d.sides, d.value).forEach(x => out.push(Object.assign(x, { kept: d.kept !== false })));
    });
    return out.slice(0, MAX_DICE);
  }

  function canShow() {
    if (!dice3dOn()) return false;
    if (/jsdom/i.test(navigator.userAgent || '')) return false;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* no media queries */ }
    return true;
  }

  // The roll on screen: { run, onLanded, landed } (run is null while three.js loads).
  let show = null;

  // Ends the roll on screen at once. Its result shows now if it has not yet.
  function clearDice() {
    const s = show;
    if (!s) return;
    show = null;
    if (s.run) s.run.stop();
    if (!s.landed) { s.landed = true; s.onLanded(); }
  }

  function soundOn() { return !!(OSR.rollSoundOn && OSR.rollSoundOn() && window.RpgDiceSound); }

  // Throw the dice of one roll. info: { source, formula, total, detail,
  // onLanded, skin }. Returns true when the dice will show: then onLanded()
  // runs once, when they land (or at once if the show fails or ends early).
  // Returns false (and never calls onLanded) when no dice show.
  // info.skin overrides the setting (the Settings preview throw).
  function show3dDice(dice, info) {
    if (!canShow()) return false;
    const specs = diceToShow(dice);
    if (!specs.length) return false;
    info = info || {};
    clearDice(); // a roll still on screen shows its result now
    const s = { run: null, landed: false, onLanded: null };
    s.onLanded = () => { if (info.onLanded) info.onLanded(); };
    const landOnce = () => { if (!s.landed) { s.landed = true; s.onLanded(); } };
    show = s;
    // Start the sound in this click: a browser starts audio only after a user action.
    if (soundOn()) RpgDiceSound.context();
    const pref = info.skin || diceSkin();
    const list = pref === 'random' ? specs.map(d => Object.assign(d, { skin: RpgDice3D.skin('random') })) : specs;
    RpgDice3D.loadThree(THREE_URL).then(() => {
      if (show !== s) return; // ended before three.js loaded
      const run = RpgDice3D.throwDice(list, {
        skin: pref === 'random' ? null : skinFor(pref),
        size: Math.min(DIE_PX, window.innerWidth / 12),
        sound: soundOn(), landSound: true,
        hold: HOLD, maxDice: MAX_DICE,
        panel: { label: [info.source, info.formula].filter(Boolean).join(' · '), total: info.total, detail: info.detail || '' },
        onSettled: landOnce,
        onDone: () => { if (show === s) show = null; }
      });
      if (!run) { if (show === s) show = null; landOnce(); return; } // no WebGL: the result at once
      s.run = run;
    }).catch(() => { if (show === s) show = null; landOnce(); });
    return true;
  }

  // True while dice are in the air (their result is not shown yet).
  function dice3dBusy() { return !!show && !show.landed; }

  // Escape ends the show at once. The dice never block the page: the stage
  // lets the mouse through.
  function wireDice3d() {
    document.addEventListener('keydown', e => { if (e.key === 'Escape') clearDice(); });
  }

  Object.assign(OSR, { show3dDice, diceToShow, dice3dOn, setDice3d, dice3dBusy, clearDice3d: clearDice, wireDice3d,
    DICE_SKINS, diceSkin, setDiceSkin, skinFor });
})(window.OSR = window.OSR || {});
