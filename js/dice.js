/* js/dice.js — dice engine (pure) + roll/session-log rendering.
 * See AGENTS.md "The dice engine" and "Character-sheet variables" sections.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, MAX_DICE, MAX_LOG } = OSR;

  function rollDie(sides) { return 1 + Math.floor(Math.random() * sides); }

  // Roll one term: "2d10", "d20", "4d6kh3", "d%", or a plain integer.
  function rollTerm(token) {
    token = token.trim().toLowerCase();
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

  // Evaluate a whole formula string -> { total, detail, normalized, dice, flat } or null.
  //   dice: [{ value, sides, sign }] for every individual die kept
  //   flat: signed sum of all constant terms
  function evalFormula(formula) {
    let expr = String(formula || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!expr) return null;
    // Bare modifier (e.g. "+3", "-1", "2") -> roll a d20 modified by it.
    if (!/d(\d+|%)/.test(expr)) {
      expr = '1d20' + (/^[+-]/.test(expr) ? expr : '+' + expr);
    }
    const re = /([+-]?)(\d*d(?:\d+|%)(?:(?:kh|kl|dh|dl)\d+)?|\d+)/g;
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
      parts.push(/d/.test(m[2]) ? (s + m[2] + ' ' + r.text) : (s + r.text));
    }
    if (!matched) return null;
    return { total, detail: parts.join(' '), normalized: expr, dice, flat };
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

  function pushLog(source, formula, total, detail) {
    const state = OSR.state;
    const entry = { id: OSR.uid(), ts: Date.now(), source: source || 'Roll', formula: formula, total: total, detail: detail || '' };
    state.log.push(entry);
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    OSR.save();
    appendLogEntry(entry);
    showLast(total, formula, detail);
    // Any roll that isn't from the Dice Roller replaces what's shown, so retire the apply context.
    OSR.lastRoll = null;
    OSR.updateApplyButton();
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
    const res = evalFormula(resolved);
    if (!res) { showLast('—', 'Invalid: ' + raw, ''); return null; }
    const entry = pushLog(source || 'Roll', res.normalized, res.total, res.detail);
    // pushLog cleared lastRoll; a Dice Roller roll is applyable, so set it now.
    OSR.lastRoll = { total: res.total, dice: res.dice, flat: res.flat, normalized: res.normalized };
    OSR.updateApplyButton();
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
      (e.detail ? '<span class="log-detail">' + escapeHtml(e.detail) + '</span>' : '');
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
    $('#btn-log-copy').addEventListener('click', async () => {
      const text = logToText();
      try { await navigator.clipboard.writeText(text); }
      catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      }
    });
  }

  Object.assign(OSR, {
    rollDie, rollTerm, evalFormula, normVarKey, substituteVars, formatFormulaDisplay,
    pushLog, pushNote, doRoll, showLast, fmtTime, appendLogEntry, renderLog, logToText, wireLog
  });
})(window.OSR = window.OSR || {});
