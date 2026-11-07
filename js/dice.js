/* js/dice.js — dice engine (pure) + roll/session-log rendering.
 * See AGENTS.md "The dice engine" and "Character-sheet variables" sections.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, MAX_DICE, MAX_LOG } = OSR;

  function rollDie(sides) { return 1 + Math.floor(Math.random() * sides); }

  // Fate dice faces as the log shows them.
  const FATE_FACE = { '-1': '−', '0': '0', '1': '+' };

  // Roll one term: "2d10", "d20", "4d6kh3", "d%", "4dF" (Fate dice: −1, 0,
  // +1 each), or a plain integer.
  function rollTerm(token) {
    token = token.trim().toLowerCase();
    const fm = token.match(/^(\d*)df$/);
    if (fm) {
      const count = Math.max(1, Math.min(parseInt(fm[1] || '4', 10), MAX_DICE));
      const rolls = [];
      for (let i = 0; i < count; i++) rolls.push(rollDie(3) - 2);
      return { value: rolls.reduce((a, b) => a + b, 0), text: '[' + rolls.map(v => FATE_FACE[v]).join(' ') + ']', rolls: rolls, sides: 'F' };
    }
    const dm = token.match(/^(\d*)d(\d+|%)((?:kh|kl|dh|dl)\d+)?$/);
    if (dm) {
      const count = Math.max(1, Math.min(parseInt(dm[1] || '1', 10), MAX_DICE));
      const sides = dm[2] === '%' ? 100 : parseInt(dm[2], 10);
      if (!sides) return null;
      const rolls = [];
      for (let i = 0; i < count; i++) rolls.push(rollDie(sides));
      let kept = rolls.slice();
      let note = '';
      if (dm[3]) {
        const kind = dm[3].slice(0, 2);
        const n = parseInt(dm[3].slice(2), 10);
        const sorted = rolls.slice().sort((a, b) => a - b);
        if (kind === 'kh') kept = sorted.slice(-n);
        else if (kind === 'kl') kept = sorted.slice(0, n);
        else if (kind === 'dh') kept = sorted.slice(0, Math.max(0, sorted.length - n));
        else if (kind === 'dl') kept = sorted.slice(n);
        note = ' ' + dm[3];
      }
      const sum = kept.reduce((a, b) => a + b, 0);
      return { value: sum, text: '[' + rolls.join(', ') + ']' + note, rolls: kept, sides: sides };
    }
    if (/^\d+$/.test(token)) return { value: parseInt(token, 10), text: token };
    return null;
  }

  // The die a bare modifier ("+2") rolls: 4dF in Fate, else 1d20.
  function defaultDie() { return OSR.currentSystem && OSR.currentSystem() === 'fate' ? '4dF' : '1d20'; }

  // Evaluate a whole formula string -> { total, detail, normalized, dice, flat, fate } or null.
  //   dice: [{ value, sides, sign }] for every individual die kept (sides 'F' for a Fate die)
  //   flat: signed sum of all constant terms
  //   fate: true when the formula has Fate dice
  // `base` is the die a bare modifier rolls (default 1d20; doRoll passes defaultDie()).
  function evalFormula(formula, base) {
    let expr = String(formula || '').trim().toLowerCase().replace(/\s+/g, '').replace(/−/g, '-');
    if (!expr) return null;
    // Bare modifier (e.g. "+3", "-1", "2") -> roll a d20 (or 4dF) modified by it.
    if (!/d(\d+|%|f)/.test(expr)) {
      expr = String(base || '1d20').toLowerCase() + (/^[+-]/.test(expr) ? expr : '+' + expr);
    }
    const re = /([+-]?)(\d*d(?:\d+|%|f)(?:(?:kh|kl|dh|dl)\d+)?|\d+)/g;
    let m, total = 0, parts = [], matched = false;
    const dice = [];
    let flat = 0;
    while ((m = re.exec(expr))) {
      matched = true;
      const sign = m[1] === '-' ? -1 : 1;
      const r = rollTerm(m[2]);
      if (!r) return null;
      total += sign * r.value;
      if (r.rolls) r.rolls.forEach(v => dice.push({ value: v, sides: r.sides, sign: sign }));
      else flat += sign * r.value;
      const s = sign < 0 ? '-' : (parts.length ? '+' : '');
      parts.push(/d/.test(m[2]) ? (s + m[2].replace(/df$/, 'dF') + ' ' + r.text) : (s + r.text));
    }
    if (!matched) return null;
    const fate = dice.some(d => d.sides === 'F');
    return { total, detail: parts.join(' '), normalized: expr.replace(/df/g, 'dF'), dice, flat, fate };
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

  // opts.quiet: log only, leave the Dice Roller's last-roll box (and its apply context) as it is.
  // A short "swoosh" on every roll: white noise through a band-pass filter
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

  function pushLog(source, formula, total, detail, opts) {
    const state = OSR.state;
    playRollSound(); // every roll goes through here (dice, % rolls, tables); notes do not
    const entry = { id: OSR.uid(), ts: Date.now(), source: source || 'Roll', formula: formula, total: total, detail: detail || '' };
    state.log.push(entry);
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    OSR.save();
    appendLogEntry(entry);
    if (opts && opts.quiet) return entry;
    showLast(total, formula, detail);
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
    const entry = pushLog(source || 'Roll', '≤' + target + '%', roll, verdict);
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
    const entry = pushLog(source || 'Roll', res.normalized + (target != null ? ' ≥ ' + target : ''), res.total, detail);
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
    rollDie, rollTerm, evalFormula, defaultDie, normVarKey, substituteVars, formatFormulaDisplay,
    pushLog, pushNote, doRoll, rollPercent, showLast, fmtTime, appendLogEntry, renderLog, logToText, wireLog, copyText
  });
})(window.OSR = window.OSR || {});
