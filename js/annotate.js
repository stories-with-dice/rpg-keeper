/* js/annotate.js — character/monster text -> clickable dice, $variable refs,
 * and [Compendium] links. See AGENTS.md "Character-sheet variables" section.
 */
(function (OSR) {
  'use strict';

  // Dice chains may end in either a signed integer or a signed $VarName
  // reference (see VARREF_RE / scanVariables below) — "1d6+$CON+2" is one
  // clickable formula, resolved at roll time via substituteVars().
  const DICE_RE = /\b\d*d\d+(?:(?:kh|kl|dh|dl)\d+)?(?:\s*[+-]\s*(?:\d+|\$[A-Za-z][A-Za-z0-9]*))*\b/gi;
  const MOD_RE  = /(?<![\w.])[+-]\d+(?![\w.\d])/g;
  // A bare (optionally signed) $VarName reference not already consumed as
  // part of a dice chain above — e.g. "Melee bonus: $STR" rolls 1d20+STR
  // (evalFormula's own "no dice -> d20" fallback, once $STR is substituted).
  const VARREF_RE = /(?<![\w.$])[+-]?\$([A-Za-z][A-Za-z0-9]*)/g;
  // Bracketed compendium references: [Longsword], [Bless]. Skipped: short
  // all-caps/system tags like [WWN], [SD], and anything with markdown link
  // punctuation left in it.
  const COMP_RE = /\[([^\[\]\n]{1,60})\]/g;
  function isSystemTag(s) { return /^[A-Z0-9][A-Z0-9 .+\-/]{0,7}$/.test(s.trim()); }

  // "Name: value" variable declarations — same-line fields can be separated
  // by a comma, semicolon, or pipe (e.g. "HP: 10 | AC: 14"), in addition to
  // the start/end of the string being scanned (normally one line — see
  // charVars()). The name is whatever sits between the previous such
  // boundary and the colon. The value is the optionally-signed integer right
  // after the colon; parsing of that field STOPS at the first space after
  // it, same as it stops at a boundary or the end of the string — so
  // "STR: +1 (14)" is STR=+1 (the "(14)" is simply never looked at), and
  // "Cost: 5 gp" is Cost=5. Only a number glued directly onto more text with
  // no separating space (e.g. "19/19") fails to match at all.
  // Returns [{name, value, nameStart, nameEnd, valStart, valEnd}].
  const VAR_BOUNDARY_RE = /[,;|\n]/;
  const VAR_NUM_RE = /:[ \t]*([+-]?\d+)/g;
  function trimmedRange(text, start, end) {
    let s = start, e = end;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    return [s, e];
  }
  function scanVariables(text) {
    const out = [];
    let m;
    VAR_NUM_RE.lastIndex = 0;
    while ((m = VAR_NUM_RE.exec(text))) {
      const colonIdx = m.index;
      const valStart = colonIdx + m[0].length - m[1].length;
      const valEnd = valStart + m[1].length;
      const next = valEnd < text.length ? text[valEnd] : '';
      if (next && !VAR_BOUNDARY_RE.test(next) && !/\s/.test(next)) continue;
      let back = colonIdx;
      while (back > 0 && !VAR_BOUNDARY_RE.test(text[back - 1])) back--;
      const [nameStart, nameEnd] = trimmedRange(text, back, colonIdx);
      if (nameEnd <= nameStart) continue;
      const rawName = text.slice(nameStart, nameEnd);
      if (rawName.length > 40 || !/[A-Za-z]/.test(rawName) || rawName.indexOf(':') !== -1) continue;
      out.push({ name: rawName, value: parseInt(m[1], 10), nameStart, nameEnd, valStart, valEnd });
    }
    return out;
  }

  function findMatches(text, opts) {
    const spans = [];
    let m;
    if (!(opts && opts.noComp)) {
      COMP_RE.lastIndex = 0;
      while ((m = COMP_RE.exec(text))) {
        const inner = m[1].trim();
        if (!inner || isSystemTag(inner)) continue;
        spans.push({ kind: 'comp', start: m.index, end: m.index + m[0].length, label: m[0], name: inner });
      }
    }
    // Detected "Name: ±N" variables: the name is highlighted on its own; the
    // value keeps working as a normal bare-modifier roll (1d20+N) but gets
    // an extra flag/class marking it as a tracked variable.
    scanVariables(text).forEach(v => {
      if (!spans.some(sp => v.nameStart < sp.end && v.nameEnd > sp.start)) {
        spans.push({ kind: 'varname', start: v.nameStart, end: v.nameEnd, label: text.slice(v.nameStart, v.nameEnd), varName: v.name });
      }
      if (!spans.some(sp => v.valStart < sp.end && v.valEnd > sp.start)) {
        // Unlike a bare modifier (always signed — see MOD_RE), a variable's
        // value can be a plain unsigned integer ("Survive: 0", "STR: 14") —
        // without a "+" that would concatenate into "1d20" + "0" = "1d200"
        // (a d200!) instead of "1d20+0".
        const valText = text.slice(v.valStart, v.valEnd).replace(/\s+/g, '');
        spans.push({
          kind: 'roll', start: v.valStart, end: v.valEnd,
          formula: '1d20' + (/^[+-]/.test(valText) ? valText : '+' + valText),
          label: valText, isVar: true, varName: v.name
        });
      }
    });
    DICE_RE.lastIndex = 0;
    while ((m = DICE_RE.exec(text))) {
      const raw = m[0];
      if (!/d\d/i.test(raw)) continue;
      const s = m.index, e = m.index + raw.length;
      if (spans.some(sp => s < sp.end && e > sp.start)) continue;
      // Displayed label drops the "$" (data-formula keeps it, for rolling) —
      // "1d20+$AB+$STR" reads as "1d20+AB+STR".
      spans.push({ kind: 'roll', start: s, end: e, formula: raw.replace(/\s+/g, ''), label: raw.replace(/\$/g, '') });
    }
    MOD_RE.lastIndex = 0;
    while ((m = MOD_RE.exec(text))) {
      const s = m.index, e = m.index + m[0].length;
      if (spans.some(sp => s < sp.end && e > sp.start)) continue;
      spans.push({ kind: 'roll', start: s, end: e, formula: '1d20' + m[0], label: m[0] });
    }
    VARREF_RE.lastIndex = 0;
    while ((m = VARREF_RE.exec(text))) {
      const s = m.index, e = m.index + m[0].length;
      if (spans.some(sp => s < sp.end && e > sp.start)) continue;
      spans.push({ kind: 'roll', start: s, end: e, formula: m[0].replace(/\s+/g, ''), label: m[0].replace(/\$/g, '') });
    }
    spans.sort((a, b) => a.start - b.start);
    return spans;
  }

  function processTextNode(node, opts) {
    const text = node.nodeValue;
    const spans = findMatches(text, opts);
    if (!spans.length) return;
    const frag = document.createDocumentFragment();
    let pos = 0;
    spans.forEach(sp => {
      if (sp.start < pos) return;
      if (sp.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, sp.start)));
      const el = document.createElement('span');
      if (sp.kind === 'comp') {
        el.className = 'comp-ref';
        el.textContent = sp.label;
        el.dataset.name = sp.name;
        el.title = sp.name + ' — hover for the Compendium entry';
      } else if (sp.kind === 'varname') {
        el.className = 'var-name';
        el.textContent = sp.label;
        el.dataset.varName = sp.varName;
        el.title = 'Variable — use $' + OSR.normVarKey(sp.varName) + ' in dice formulas';
      } else {
        el.className = 'roll' + (sp.isVar ? ' var-value' : '');
        el.textContent = sp.label;
        el.dataset.formula = sp.formula;
        // The tooltip shows each $Name's current value (e.g. "1d20+AB (0)")
        // when the caller passed the relevant character's vars (see
        // charVars() / annotate() callers) — the same is never shown in the
        // rendered text itself (see the "$" stripped from sp.label above).
        const display = sp.formula.indexOf('$') !== -1 && opts && opts.vars
          ? OSR.formatFormulaDisplay(sp.formula, opts.vars) : sp.formula;
        el.title = sp.isVar ? ('Roll ' + display + ' — variable ' + sp.varName) : ('Roll ' + display);
        if (sp.isVar) el.dataset.varName = sp.varName;
      }
      frag.appendChild(el);
      pos = sp.end;
    });
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }

  // Shared by annotate() (renders into the live sheet) and charVars() (scans
  // an offscreen render just to collect variables) — same skip rules either
  // way: no CODE/PRE/A ancestor, and don't re-walk already-processed spans.
  function walkAnnotatableTextNodes(root, cb) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        let p = node.parentNode;
        while (p && p !== root) {
          const t = p.nodeName;
          if (t === 'CODE' || t === 'PRE' || t === 'A') return NodeFilter.FILTER_REJECT;
          if (p.classList && (p.classList.contains('roll') || p.classList.contains('comp-ref'))) return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(cb);
  }

  function annotate(root, opts) {
    walkAnnotatableTextNodes(root, n => processTextNode(n, opts));
  }

  // Detected "Name: ±N" variables for a character, scanned the same way the
  // rendered sheet is (findMatches/scanVariables applied per rendered text
  // node) — so a name split from its colon by markdown emphasis (e.g.
  // "**CON**: +1", where "CON" and ": +1" land in separate DOM nodes) isn't
  // picked up, matching what View mode actually highlights. Last occurrence
  // of a name wins. Returns [] without js/marked.min.js loaded.
  function charVars(ch) {
    if (!ch || typeof marked === 'undefined') return [];
    const host = document.createElement('div');
    host.innerHTML = marked.parse(ch.body || '');
    const byKey = new Map();
    walkAnnotatableTextNodes(host, node => {
      scanVariables(node.nodeValue).forEach(v => byKey.set(OSR.normVarKey(v.name), { name: v.name, value: v.value }));
    });
    return Array.from(byKey.values());
  }

  Object.assign(OSR, {
    isSystemTag, scanVariables, findMatches, processTextNode,
    walkAnnotatableTextNodes, annotate, charVars
  });
})(window.OSR = window.OSR || {});
