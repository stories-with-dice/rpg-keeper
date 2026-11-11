/* js/dice.js — dice engine (on the rpg-dice-3d library's RpgDice) + roll/session-log rendering.
 * See AGENTS.md "The dice engine" and "Character-sheet variables" sections.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, MAX_LOG } = OSR;

  function rollDie(sides) { return 1 + Math.floor(Math.random() * sides); }

  // Fate dice faces as the log shows them.
  const FATE_FACE = { '-1': '−', '0': '0', '1': '+' };

  // The parser and roller are the rpg-dice-3d library's RpgDice
  // (vendor/rpg-dice-3d/rpg-dice.js). evalFormula() keeps this app's rules on
  // top of it:
  //   - a formula without dice is a modifier on the base die ("+3" → 1d20+3, 4dF in Fate);
  //   - "dF" alone is 4dF (4 Fate dice);
  //   - text the library cannot parse is not an error: the dice and numbers
  //     in it still roll ("1d6 fire" → 1d6), and text with none → the base die;
  //   - a die count above the library's limit (100) is clamped to it.
  // The library's random source is rollDie() (Math.random), so the tests can script it.
  const TERM_RE = /([+-]?)(\d*d(?:\d+|%|f)(?:(?:kh|kl|dh|dl|k)\d+)?|\d+)/g;
  const MAX_GROUP = 100;

  function parseLoose(expr) {
    try { return RpgDice.parse(expr); } catch (e) { /* the loose way below */ }
    const terms = expr.match(TERM_RE);
    if (!terms) return null;
    let joined = terms.join('');
    if (!/^[+-]/.test(joined)) joined = '+' + joined;
    try { return RpgDice.parse(joined.replace(/^\+/, '')); } catch (e) { return null; }
  }

  // The die a bare modifier ("+2") rolls: 4dF in Fate, else 1d20.
  function defaultDie() { return OSR.currentSystem && OSR.currentSystem() === 'fate' ? '4dF' : '1d20'; }

  // Evaluate a whole formula string -> { total, detail, normalized, dice, rolled, flat, fate } or null.
  //   dice:   [{ value, sides, sign }] for every kept die (sides 'F' for a Fate die)
  //   rolled: [{ value, sides, kept }] for every die rolled, dropped ones too (the 3D dice show them all)
  //   flat:   signed sum of all constant terms
  //   fate:   true when the formula has Fate dice
  //   detail: each term with its dice, "2d20kh1 [8, 17] kh1 +2" (dropped dice are listed too)
  // `base` is the die a bare modifier rolls (default 1d20; doRoll passes defaultDie()).
  //   evalFormula('2d20kh1+2') with dice 8, 17 → { total: 19, normalized: '2d20kh1+2',
  //     dice: [{ value: 17, sides: 20, sign: 1 }], rolled: [{ value: 8, …, kept: false }, { value: 17, …, kept: true }], flat: 2 }
  function evalFormula(formula, base) {
    let expr = String(formula || '').trim().toLowerCase().replace(/\s+/g, '').replace(/−/g, '-');
    if (!expr) return null;
    // Bare modifier (e.g. "+3", "-1", "2") -> roll a d20 (or 4dF) modified by it.
    if (!/d(\d+|%|f)/.test(expr)) {
      expr = String(base || '1d20').toLowerCase() + (/^[+-]/.test(expr) ? expr : '+' + expr);
    }
    expr = expr.replace(/(^|[^\d])df/g, '$14df')
      .replace(/(\d+)d/g, (m, n) => Math.max(1, Math.min(parseInt(n, 10), MAX_GROUP)) + 'd');
    const parsed = parseLoose(expr);
    if (!parsed) return null;
    let res;
    try { res = RpgDice.roll(parsed, rollDie); } catch (e) { return null; }

    const dice = [], rolled = [];
    let diceSum = 0;
    res.groups.forEach(g => {
      const sides = g.kind === 'fudge' ? 'F' : g.sides;
      g.dice.forEach(d => {
        rolled.push({ value: d.value, sides: sides, kept: d.kept });
        if (!d.kept) return;
        dice.push({ value: d.value, sides: sides, sign: g.sign });
        diceSum += g.sign * d.value;
      });
    });
    const normalized = parsed.source.replace(/df/g, 'dF');
    return {
      total: res.total, detail: termDetail(normalized, res) || res.detail, normalized: normalized,
      dice: dice, rolled: rolled, flat: res.total - diceSum, fate: res.groups.some(g => g.kind === 'fudge')
    };
  }

  // The log's detail for a +/- chain: each term in order, a dice term with
  // every die it rolled ("1d20 [12] +3", "4d6kh3 [1, 2, 5, 6] kh3",
  // "4dF [+ 0 − +] +2"). Null for anything else (parentheses, * and /):
  // then the library's own detail shows.
  function termDetail(normalized, res) {
    const expr = normalized.toLowerCase();
    if (/[()*/<>=!r]/.test(expr.replace(/d%/g, 'd100'))) return null;
    const parts = [];
    let gi = 0, m, pos = 0;
    TERM_RE.lastIndex = 0;
    while ((m = TERM_RE.exec(expr))) {
      if (m.index !== pos) return null;
      pos = m.index + m[0].length;
      const sign = m[1] === '-' ? '-' : (parts.length ? '+' : '');
      if (/d/.test(m[2])) {
        const g = res.groups[gi++];
        if (!g) return null;
        const keep = (m[2].match(/(kh|kl|dh|dl|k)\d+$/) || [''])[0];
        const vals = g.kind === 'fudge' ? '[' + g.dice.map(d => FATE_FACE[d.value]).join(' ') + ']'
          : '[' + g.dice.map(d => d.value).join(', ') + ']' + (keep ? ' ' + keep : '');
        parts.push(sign + m[2].replace(/df$/, 'dF') + ' ' + vals);
      } else parts.push(sign + m[2]);
    }
    return pos === expr.length && gi === res.groups.length ? parts.join(' ') : null;
  }

  // Advantage / disadvantage. The "single d20" of a formula is its first
  // d20 term rolled as one die ("1d20", "d20") or as an advantage pair
  // ("2d20kh1", "2d20kl1"). advModeOf() reads that term: 'adv', 'dis', or ''.
  // withAdv() rewrites it: 'adv' → 2d20kh1, 'dis' → 2d20kl1, '' → 1d20.
  // A formula with no dice at all ("+2", "+$STR") gets a 1d20 first (but not
  // in Fate, which rolls 4dF). Without a single d20, both leave it as it is.
  //   withAdv('1d20+2', 'adv')    → '2d20kh1+2'
  //   withAdv('+$STR', 'dis')     → '2d20kl1+$STR'
  //   withAdv('2d20kh1+1', '')    → '1d20+1'
  //   withAdv('1d8+2', 'adv')     → '1d8+2'
  const D20_TERM_RE = /(^|[+-])(1?d20|2d20k[hl]1)(?![\dkKdD])/i;
  function advModeOf(formula) {
    const m = String(formula || '').match(D20_TERM_RE);
    if (!m) return '';
    const t = m[2].toLowerCase();
    return t === '2d20kh1' ? 'adv' : t === '2d20kl1' ? 'dis' : '';
  }
  function canAdv(formula) {
    const f = String(formula || '');
    if (f.charAt(0) === '%') return false;
    if (!/d(\d+|%|f)/i.test(f)) return defaultDie() === '1d20';
    return D20_TERM_RE.test(f);
  }
  function withAdv(formula, mode) {
    let f = String(formula || '');
    if (!canAdv(f)) return f;
    if (!/d(\d+|%|f)/i.test(f)) {
      if (!mode) return f;
      f = '1d20' + (/^[+-]/.test(f) ? f : '+' + f);
    }
    const die = mode === 'adv' ? '2d20kh1' : mode === 'dis' ? '2d20kl1' : '1d20';
    return f.replace(D20_TERM_RE, (w, sign) => sign + die);
  }

  // Case/whitespace-insensitive key for matching a $Token against a detected
  // variable's (possibly multi-word) name.
  function normVarKey(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

  // $VarName references in a dice formula, resolved against `vars`
  // ([{name,value}], see charVars()) before evalFormula ever sees the
  // string. A leading sign (if any) is folded into the variable's own value
  // rather than duplicated — "+$CON" with CON=-1 becomes "-1", not "+-1".
  // Unresolved references are left as literal "$Name" text, which
  // evalFormula then fails to parse (surfaced via the usual "Invalid: …").
  const VAR_TOKEN_RE = /([+-]?)\$([A-Za-z][A-Za-z0-9]*)/g;
  function substituteVars(formula, vars) {
    const map = new Map((vars || []).map(v => [normVarKey(v.name), v.value]));
    const missing = [];
    const text = String(formula || '').replace(VAR_TOKEN_RE, (whole, sign, tok) => {
      const key = normVarKey(tok);
      if (!map.has(key)) { missing.push(tok); return whole; }
      const raw = map.get(key);
      const val = sign === '-' ? -raw : raw;
      return (val < 0 ? '-' : '+') + Math.abs(val);
    });
    return { text, missing };
  }

  // Human-readable version of a formula for tooltips: "$Name" -> "Name
  // (value)", keeping the surrounding text (signs, other terms) exactly as
  // written — unlike substituteVars(), this never touches evalFormula, so no
  // sign-folding is needed. An unresolved reference shows "Name (?)".
  const VAR_DISPLAY_RE = /\$([A-Za-z][A-Za-z0-9]*)/g;
  function formatFormulaDisplay(formula, vars) {
    const map = new Map((vars || []).map(v => [normVarKey(v.name), v.value]));
    return String(formula || '').replace(VAR_DISPLAY_RE, (whole, tok) => {
      const key = normVarKey(tok);
      return tok + ' (' + (map.has(key) ? map.get(key) : '?') + ')';
    });
  }

  /* ------------------------------------------------------------------ */
  /* Roll + log                                                         */
  /* ------------------------------------------------------------------ */
  OSR.lastRoll = null; // structured result of the most recent Dice Roller roll (for "Apply damage")
  // The most recent percentile roll ({ roll, target, verdict, source }): an
  // Unknown Armies attack, whose wounds depend on the weapon (js/combat.js).
  OSR.lastPercent = null;
  // The most recent Fate roll ({ formula, total, source }), for "Invoke +2" and "Reroll".
  OSR.lastFate = null;

  // A short "swoosh" on a roll without 3D dice (3D dice have their own sounds, the library's rpg-dice-sound.js): white noise through a band-pass filter
  // that sweeps down, with a quick fade in and out. Made with the Web Audio
  // API, so there is no sound file and no network use. On by default; the
  // Settings tab's "Roll sound" turns it off for this browser
  // (localStorage, like the other per-device settings).
  const ROLL_SOUND_KEY = 'osr_roll_sound';
  let audioCtx = null;
  function rollSoundOn() {
    try { return localStorage.getItem(ROLL_SOUND_KEY) !== 'off'; } catch (e) { return true; }
  }
  function setRollSound(on) {
    try { localStorage.setItem(ROLL_SOUND_KEY, on ? 'on' : 'off'); } catch (e) { /* this page only */ }
  }
  function playRollSound() {
    if (!rollSoundOn()) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
      const ctx = audioCtx, now = ctx.currentTime, dur = 0.28;
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(2600, now);
      filter.frequency.exponentialRampToValueAtTime(500, now + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.35, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      src.start(now);
      src.stop(now + dur);
      return true;
    } catch (e) {
      return false; // no audio: the roll still works
    }
  }

  // A roll line in the Session Log. Every roll goes through here (dice, % rolls,
  // tables); notes do not.
  // opts.quiet: log only, leave the Dice Roller's last-roll box (and its apply context) as it is.
  // opts.dice: the roll's dice ([{ sides, value, kept }], dropped ones with
  // kept: false). With 3D dice on, they are thrown first (js/dice3d.js) and the log line and the result box show when
  // they land. The entry is saved at once either way.
  function pushLog(source, formula, total, detail, opts) {
    const state = OSR.state;
    const entry = { id: OSR.uid(), ts: Date.now(), source: source || 'Roll', formula: formula, total: total, detail: detail || '' };
    state.log.push(entry);
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    OSR.save();
    const quiet = !!(opts && opts.quiet);
    const reveal = () => {
      // renderLog() may have drawn it already (a campaign switch while the dice rolled).
      if (state.log.indexOf(entry) !== -1 && !$('#log-list').querySelector('[data-id="' + entry.id + '"]')) appendLogEntry(entry);
      if (!quiet) showLast(total, formula, detail);
      OSR.updateApplyButton();
    };
    const thrown = !!(opts && opts.dice && OSR.show3dDice &&
      OSR.show3dDice(opts.dice, { source: entry.source, formula: formula, total: total, detail: detail, onLanded: reveal }));
    if (!thrown) { playRollSound(); reveal(); }
    if (quiet) return entry;
    // Any roll that isn't from the Dice Roller replaces what's shown, so retire the apply context.
    OSR.lastRoll = null;
    OSR.lastPercent = null;
    OSR.lastFate = null;
    OSR.updateApplyButton();
    if (OSR.renderFateDiceActions) OSR.renderFateDiceActions();
    return entry;
  }

  // A non-roll log line (status changes, journal entries, …) — no "= total".
  // opts.md renders `text` as Markdown in the log.
  function pushNote(source, text, detail, opts) {
    const state = OSR.state;
    const entry = { id: OSR.uid(), ts: Date.now(), source: source || '—', formula: text, total: '', detail: detail || '' };
    if (opts && opts.md && typeof marked !== 'undefined') entry.md = marked.parse(String(text || ''));
    state.log.push(entry);
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    OSR.save();
    appendLogEntry(entry);
    return entry;
  }

  // doRoll's optional third argument resolves $Name references in `formula`
  // against `vars` ([{name,value}], see charVars()) before evalFormula ever
  // sees the string — its own dice grammar doesn't need to know about them.
  // An unresolved reference is rejected explicitly here rather than handed
  // to evalFormula: its regex scan skips over unmatched text instead of
  // failing, so "1d6+$NOPE" would otherwise silently roll just "1d6".
  // Unknown Armies-style percentile roll: "%65" (a target rating, optionally
  // followed by signed flat modifiers, e.g. "%65+10-5" from the right-click
  // roll-with-modifiers popup or a $variable substitution) rolls 1d100 and
  // succeeds on a result <= the (modified) target. Always logs the actual
  // roll, plus RAW's special results (p.14-15): 00 is always a Fumble, 01 is
  // always a Crit, and any other doubled roll (11, 22, …) is Matched.
  function rollPercent(resolved, source) {
    const m = String(resolved || '').match(/^%(-?\d+)((?:[+-]\d+)*)$/);
    if (!m) { showLast('—', 'Invalid: ' + resolved, ''); return null; }
    let target = parseInt(m[1], 10);
    (m[2].match(/[+-]\d+/g) || []).forEach(mod => { target += parseInt(mod, 10); });
    target = Math.max(0, Math.min(100, target));
    const roll = rollDie(100); // 1-100, 100 standing in for "00"
    const tens = Math.floor((roll % 100) / 10), ones = roll % 10;
    let verdict = roll <= target ? 'Success' : 'Failure';
    if (roll === 100) verdict = 'Fumble';
    else if (roll === 1) verdict = 'Crit';
    else if (tens === ones) verdict = 'Matched ' + verdict;
    const entry = pushLog(source || 'Roll', '≤' + target + '%', roll, verdict, { dice: [{ sides: 100, value: roll }] });
    // pushLog cleared lastRoll — a % roll isn't "damage" itself, but an
    // Unknown Armies attack's wounds come from it (see js/combat.js).
    OSR.lastPercent = { roll: roll, target: target, verdict: verdict, source: source || 'Roll' };
    OSR.updateApplyButton();
    return entry;
  }

  function doRoll(formula, source, vars) {
    const raw = String(formula || '');
    let resolved = raw;
    if (raw.indexOf('$') !== -1) {
      const sub = substituteVars(raw, vars);
      if (sub.missing.length) {
        showLast('—', 'Invalid: ' + raw + ' (unknown $' + sub.missing.join(', $') + ')', '');
        return null;
      }
      resolved = sub.text;
    }
    if (resolved.charAt(0) === '%') return rollPercent(resolved, source);
    // A target: "1d20>=14" (a WWN save) or "2d6+1>=8" succeeds on a total of
    // the target or more. Modifiers from the roll popup come after the target
    // ("1d20>=14+2"), so they are moved onto the dice.
    let target = null;
    const tm = resolved.match(/^(.*?)\s*(?:>=|≥)\s*(-?\d+)((?:\s*[+-]\s*\d+)*)\s*$/);
    if (tm) { target = parseInt(tm[2], 10); resolved = tm[1] + tm[3].replace(/\s+/g, ''); }
    const res = evalFormula(resolved, defaultDie());
    if (!res) { showLast('—', 'Invalid: ' + raw, ''); return null; }
    // A Fate roll shows its result on the ladder: "4dF [+ 0 − +] +3 → Good (+4)".
    let detail = res.fate && window.FateSheet ? res.detail + ' → ' + FateSheet.ladderLabel(res.total) : res.detail;
    if (target != null) detail += ' → vs ' + target + ': ' + (res.total >= target ? 'Success' : 'Failure') + ' (' + (res.total - target >= 0 ? '+' : '') + (res.total - target) + ')';
    const entry = pushLog(source || 'Roll', res.normalized + (target != null ? ' ≥ ' + target : ''), res.total, detail, { dice: res.rolled });
    // pushLog cleared lastRoll; a Dice Roller roll is applyable, so set it now.
    OSR.lastRoll = { total: res.total, dice: res.dice, flat: res.flat, normalized: res.normalized };
    // The Fate dice actions (invoke +2, reroll) act on this roll (js/fate-ui.js).
    if (res.fate) OSR.lastFate = { formula: res.normalized, total: res.total, source: source || 'Roll' };
    OSR.updateApplyButton();
    if (OSR.renderFateDiceActions) OSR.renderFateDiceActions();
    return entry;
  }

  function showLast(total, formula, detail) {
    $('#dice-last').innerHTML =
      '<div><span class="total">' + escapeHtml(String(total)) + '</span> ' +
      '<span class="detail">' + escapeHtml(formula) + '</span></div>' +
      (detail ? '<div class="detail">' + escapeHtml(detail) + '</div>' : '');
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function appendLogEntry(e) {
    const list = $('#log-list');
    const empty = list.querySelector('.log-empty');
    if (empty) empty.remove();
    const hasTotal = e.total !== '' && e.total != null;
    const li = document.createElement('li');
    li.dataset.id = e.id;
    if (!hasTotal) li.className = 'log-note';
    li.innerHTML =
      '<span class="log-time">' + fmtTime(e.ts) + '</span>' +
      '<span class="log-src">' + escapeHtml(e.source) + '</span>' +
      (e.md
        ? '<span class="log-formula log-md markdown-body">' + e.md + '</span>'
        : '<span class="log-formula">' + escapeHtml(e.formula) + '</span>') +
      (hasTotal ? '<span class="log-total">= ' + escapeHtml(String(e.total)) + '</span>' : '') +
      (e.detail ? '<span class="log-detail' + (e.detail.indexOf('\n') !== -1 ? ' is-lines' : '') + '">' + escapeHtml(e.detail) + '</span>' : '');
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }

  function renderLog() {
    const list = $('#log-list');
    list.innerHTML = '';
    if (!OSR.state.log.length) { list.innerHTML = '<li class="log-empty">No rolls yet.</li>'; return; }
    OSR.state.log.forEach(appendLogEntry);
  }

  function logToText() {
    return OSR.state.log.map(e => {
      const hasTotal = e.total !== '' && e.total != null;
      return fmtTime(e.ts) + '  ' + e.source + '  ' + e.formula +
        (hasTotal ? ' = ' + e.total : '') +
        (e.detail ? '   (' + e.detail + ')' : '');
    }).join('\n');
  }

  function wireLog() {
    $('#btn-log-clear').addEventListener('click', () => {
      if (!OSR.state.log.length || confirm('Clear the session log?')) {
        OSR.state.log = [];
        OSR.save();
        renderLog();
      }
    });
    $('#btn-log-copy').addEventListener('click', () => copyText(logToText()));
  }

  // Copy text to the clipboard; falls back to execCommand where the Clipboard API is missing.
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
  }

  Object.assign(OSR, { playRollSound, rollSoundOn, setRollSound,
    rollDie, evalFormula, defaultDie, advModeOf, canAdv, withAdv, normVarKey, substituteVars, formatFormulaDisplay,
    pushLog, pushNote, doRoll, rollPercent, showLast, fmtTime, appendLogEntry, renderLog, logToText, wireLog, copyText
  });
})(window.OSR = window.OSR || {});
