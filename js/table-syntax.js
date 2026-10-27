/* js/table-syntax.js — the text format of user-made random tables (Tables
 * tab, js/tables.js) and the roller for master tables that roll on other
 * tables. Pure: no DOM, no storage. Exposes window.TableSyntax /
 * module.exports.
 *
 * Source text:
 *   d12 | Group | Hue       line 1: the die formula, then optional column names
 *   1: Academy | Argent     `range: text`. A range is "5" or "1-2" (also – or —).
 *   2-3: Circle | Azure     An all-zero bound ("0", "00") is the top of a d10/d100.
 *   Rite | Black            a line without a range takes the next number
 *   # a comment             blank lines and "#" lines are skipped
 *
 * Lookups in an entry's text (or in one cell):
 *   [Table]        roll on another table (name is case-insensitive)
 *   [Table.Col]    roll on a table with columns, take one column
 *   [2x Table]     roll more than once (the count can be dice: [1d4x Table]);
 *                  the results are joined with ", "
 *   [2d6]          roll dice inline
 *
 * The roller takes a ctx: { resolve(name) → parsed table or null,
 * roll(formula) → { total, detail } or null }. A parsed table is
 * { name, formula, columns, entries: [{ range, lo, hi, text, cells }] }.
 */
(function (root) {
  'use strict';

  const MAX_DEPTH = 12, MAX_REPEAT = 20;
  const RANGE_RE = /^(\d+)\s*(?:[-–—]\s*(\d+)\s*)?:\s?(.*)$/;
  const TERM = '\\d*d(?:\\d+|%)(?:(?:kh|kl|dh|dl)\\d+)?';
  const DICE_RE = new RegExp('^\\s*' + TERM + '(?:\\s*[+-]\\s*(?:' + TERM + '|\\d+))*\\s*$', 'i');
  const COUNT_RE = new RegExp('^(' + TERM + '|\\d+)\\s*[x×]\\s+(.+)$', 'i');
  const REF_RE = /\[([^[\]\n]+)\]/g;

  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // { min, max } of a dice formula ("d12", "2d6+1", "4d6kh3"), or null.
  function formulaRange(formula) {
    const f = String(formula || '');
    if (!DICE_RE.test(f)) return null;
    const re = /([+-]?)(?:(\d*)d(\d+|%)(?:(kh|kl|dh|dl)(\d+))?|(\d+))/gi;
    let m, min = 0, max = 0;
    while ((m = re.exec(f.replace(/\s+/g, '')))) {
      const sign = m[1] === '-' ? -1 : 1;
      let lo, hi;
      if (m[6] != null) { lo = hi = Number(m[6]); }
      else {
        const n = m[2] ? Number(m[2]) : 1, sides = m[3] === '%' ? 100 : Number(m[3]);
        let kept = n;
        if (m[4]) kept = /^k/i.test(m[4]) ? Math.min(n, Number(m[5])) : Math.max(0, n - Number(m[5]));
        lo = kept; hi = kept * sides;
      }
      if (sign > 0) { min += lo; max += hi; } else { min -= hi; max -= lo; }
    }
    return { min, max };
  }

  // A run of numbers as "3", "3–5", joined by ", ".
  function runs(nums) {
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      out.push(i === j ? String(nums[i]) : nums[i] + '–' + nums[j]);
      i = j;
    }
    return out.join(', ');
  }

  function parseTable(source) {
    const out = { formula: '', columns: [], entries: [], problems: [], min: null, max: null };
    const problem = (line, level, msg) => out.problems.push({ line, level, msg });
    let head = false, next = null;
    String(source || '').split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim(), n = i + 1;
      if (!line || line[0] === '#') return;
      if (!head) {
        head = true;
        const cells = line.split('|').map(s => s.trim());
        out.formula = cells[0];
        out.columns = cells.slice(1);
        const r = formulaRange(out.formula);
        if (!r) problem(n, 'error', 'Line ' + n + ' must start with a die, for example d12 or 2d6.');
        else { out.min = r.min; out.max = r.max; next = r.min; }
        if (out.columns.some(c => !c)) problem(n, 'error', 'Line ' + n + ' has an empty column name.');
        return;
      }
      const bound = s => (/^0+$/.test(s) && out.max && out.max % 10 === 0 ? out.max : parseInt(s, 10));
      const m = RANGE_RE.exec(line);
      let lo, hi, range, text;
      if (m) {
        lo = bound(m[1]); hi = m[2] != null ? bound(m[2]) : lo;
        range = m[2] != null ? m[1] + '–' + m[2] : m[1];
        text = m[3].trim();
      } else {
        lo = hi = next == null ? 1 : next;
        range = String(lo);
        text = line;
      }
      if (hi < lo) problem(n, 'error', 'Line ' + n + ': the range ' + range + ' goes down.');
      next = Math.max(lo, hi) + 1;
      let cells = [];
      if (out.columns.length) {
        cells = text.split('|').map(s => s.trim());
        if (cells.length !== out.columns.length) {
          problem(n, 'warn', 'Line ' + n + ' has ' + cells.length + ' cells; line 1 has ' + out.columns.length + ' columns.');
        }
        while (cells.length < out.columns.length) cells.push('');
        cells = cells.slice(0, out.columns.length);
      }
      out.entries.push({ range, lo: Math.min(lo, hi), hi: Math.max(lo, hi), text, cells, line: n });
    });
    if (!head) problem(1, 'error', 'Line 1 must be a die, for example d12 or 2d6.');
    else if (!out.entries.length) problem(1, 'error', 'The table has no entries.');
    if (out.min != null && out.entries.length && out.max - out.min <= 1000) {
      const owner = new Map(), gaps = [], outside = [];
      out.entries.forEach(en => {
        for (let v = en.lo; v <= en.hi; v++) {
          if (v < out.min || v > out.max) { outside.push(v); continue; }
          if (owner.has(v) && owner.get(v) !== en.line) {
            problem(en.line, 'warn', 'Line ' + en.line + ' overlaps line ' + owner.get(v) + ' at ' + v + '.');
            return;
          }
          owner.set(v, en.line);
        }
      });
      for (let v = out.min; v <= out.max; v++) if (!owner.has(v)) gaps.push(v);
      if (gaps.length) problem(0, 'warn', 'No entry for ' + runs(gaps) + '.');
      if (outside.length) problem(0, 'warn', runs(outside) + ' is outside ' + out.formula + ' (' + out.min + '–' + out.max + ').');
    }
    return out;
  }

  // "[2x Name.Col]" inner text → { count, name } or { dice }.
  function parseRef(inner) {
    let s = String(inner).trim(), count = null;
    const m = COUNT_RE.exec(s);
    if (m) { count = m[1]; s = m[2].trim(); }
    return { count, name: s, dice: !count && DICE_RE.test(s) };
  }

  // A name (maybe "Table.Column") → { table, col } (col: index or null),
  // { error } when it names nothing, or null when it is not a table at all.
  function resolveName(name, resolve) {
    const t = resolve(name);
    if (t) return { table: t, col: null };
    const dot = name.lastIndexOf('.');
    if (dot > 0) {
      const base = resolve(name.slice(0, dot).trim());
      if (base) {
        const want = name.slice(dot + 1).trim().toLowerCase();
        const col = (base.columns || []).findIndex(c => c.toLowerCase() === want);
        if (col !== -1) return { table: base, col };
        return { error: base.name + ' has no column "' + name.slice(dot + 1).trim() + '"' };
      }
    }
    return { error: 'no table named "' + name + '"' };
  }

  // What one [ref] points at, for the editor and the entry list:
  // { kind: 'dice' } | { kind: 'table', table, col } | { kind: 'bad', error }.
  function lookup(inner, resolve) {
    const ref = parseRef(inner);
    const r = resolveName(ref.name, resolve);
    if (r.table) return { kind: 'table', table: r.table, col: r.col, count: ref.count };
    if (ref.dice) return { kind: 'dice' };
    return { kind: 'bad', error: r.error };
  }

  // Every [ref] in a parsed table that does not resolve, as problems.
  function refProblems(parsed, resolve) {
    const out = [];
    parsed.entries.forEach(en => {
      let m;
      REF_RE.lastIndex = 0;
      while ((m = REF_RE.exec(en.text))) {
        const l = lookup(m[1], resolve);
        if (l.kind === 'bad') out.push({ line: en.line, level: 'warn', msg: 'Line ' + en.line + ': ' + l.error + '.' });
      }
    });
    return out;
  }

  // Lower-case names of the tables a parsed table rolls on.
  function refNames(parsed, resolve) {
    const names = new Set();
    parsed.entries.forEach(en => {
      let m;
      REF_RE.lastIndex = 0;
      while ((m = REF_RE.exec(en.text))) {
        const l = lookup(m[1], resolve);
        if (l.kind === 'table') names.add(l.table.name.toLowerCase());
      }
    });
    return names;
  }

  /* ---- rolling ---- */

  // Roll a whole table (the Roll button). The result is a node tree:
  //   table  { kind, src, name, column, formula, roll, range, entryIdx, parts, error }
  //   dice   { kind, src, formula, roll, detail }
  //   repeat { kind, src, count, items: [table nodes] }
  //   error  { kind, src, error }
  // `parts` mixes strings and child nodes. `src` is the [ref] text a node came
  // from (null for the top), and `depth`/`stack` let rerollRef() roll it again.
  function rollTable(table, ctx, col) {
    return rollOn(table, col == null ? null : col, ctx, null, 0, []);
  }

  function rollOn(table, col, ctx, src, depth, stack) {
    const node = { kind: 'table', src, depth, stack, name: table.name, column: col == null ? null : table.columns[col],
      formula: table.formula, roll: null, range: '', entryIdx: -1, parts: [], error: '' };
    const key = String(table.name).toLowerCase();
    if (depth > MAX_DEPTH) { node.error = 'too many nested tables'; return node; }
    if (stack.indexOf(key) !== -1) { node.error = table.name + ' rolls on itself'; return node; }
    const res = ctx.roll(table.formula);
    if (!res) { node.error = 'bad die "' + table.formula + '"'; return node; }
    node.roll = res.total;
    node.entryIdx = table.entries.findIndex(en => res.total >= en.lo && res.total <= en.hi);
    if (node.entryIdx === -1) { node.error = 'no entry for ' + res.total; return node; }
    const en = table.entries[node.entryIdx];
    node.range = en.range;
    const text = col != null ? en.cells[col] : (table.columns && table.columns.length ? en.cells.join(' / ') : en.text);
    node.parts = expand(text, ctx, depth + 1, stack.concat(key));
    return node;
  }

  function expand(text, ctx, depth, stack) {
    const parts = [];
    let last = 0, m;
    const re = new RegExp(REF_RE.source, 'g');
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(rerollRef(m[1], ctx, depth, stack));
      last = re.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  // Roll one [ref] (its inner text) — also how a sub-result is rolled again.
  function rerollRef(src, ctx, depth, stack) {
    const ref = parseRef(src);
    const r = resolveName(ref.name, ctx.resolve);
    if (!r.table && ref.dice) {
      const res = ctx.roll(ref.name);
      if (res) return { kind: 'dice', src, depth, stack, formula: ref.name, roll: res.total, detail: res.detail || '' };
    }
    if (!r.table) return { kind: 'error', src, depth, stack, error: r.error };
    if (ref.count == null) return rollOn(r.table, r.col, ctx, src, depth, stack);
    let n = Number(ref.count);
    if (!/^\d+$/.test(ref.count)) { const res = ctx.roll(ref.count); n = res ? res.total : 0; }
    n = Math.max(0, Math.min(MAX_REPEAT, n));
    const items = [];
    for (let i = 0; i < n; i++) items.push(rollOn(r.table, r.col, ctx, ref.name, depth, stack));
    return { kind: 'repeat', src, depth, stack, count: n, items };
  }

  function nodeText(node) {
    if (typeof node === 'string') return node;
    if (node.kind === 'dice') return String(node.roll);
    if (node.kind === 'repeat') return node.items.map(nodeText).join(', ');
    if (node.kind === 'error' || node.error) return '[' + (node.src || node.name) + '?]';
    return node.parts.map(nodeText).join('');
  }

  /* ---- result layout ---- */

  // A result can show as an outline: a sub-table after a label ("Origin: [Artifact
  // Origin]; Curse: [Artifact Curse]") gets its own line, and a sub-table that has
  // lines of its own is indented under its label. Text such as "A [Color] cat"
  // stays on one line. nodeLines(node) gives the lines of a table node, or null
  // for one line:
  //   [{ label: [{ part, i }], child, i, tail: [{ part, i }] }]   i: the index in node.parts
  // `tail` is the text after the last sub-table when it stays on that line;
  // `child` is null for a line of only text after an indented group.
  const isSub = p => p && typeof p === 'object' && (p.kind === 'table' || p.kind === 'repeat');
  function hasLines(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.kind === 'repeat') return node.items.some(hasLines);
    return !!nodeLines(node);
  }
  function nodeLines(node) {
    if (!node || node.kind !== 'table' || node.error || !node.parts.some(isSub)) return null;
    const lines = [];
    let buf = [], afterSemi = false, labelled = 0;
    // The label: the parts since the last line, without the separator before
    // it ("; ") and the colon or dash after it.
    const label = (re) => {
      const out = buf.slice();
      if (typeof out[0].part === 'string') out[0] = { part: out[0].part.replace(/^[\s;,]+/, ''), i: out[0].i };
      const last = out[out.length - 1];
      if (typeof last.part === 'string') out[out.length - 1] = { part: last.part.replace(re, ''), i: last.i };
      return out.filter(x => typeof x.part !== 'string' || x.part !== '');
    };
    // Text since the last line: the end of that line (no "; " in between, and
    // that line has no lines of its own), else a line of its own.
    const flush = () => {
      if (buf.length && buf.some(x => typeof x.part !== 'string' || /[^\s;,.]/.test(x.part))) {
        const last = lines[lines.length - 1];
        if (last && !afterSemi && !hasLines(last.child)) last.tail = buf;
        else lines.push({ label: label(/[\s;,]+$/), child: null, i: -1, tail: [] });
      }
      buf = [];
    };
    node.parts.forEach((p, i) => {
      if (typeof p === 'string' && p.indexOf(';') !== -1) {
        const k = p.lastIndexOf(';');
        if (k > 0) buf.push({ part: p.slice(0, k), i });
        flush();
        afterSemi = true;
        if (p.slice(k + 1)) buf.push({ part: p.slice(k + 1), i });
        return;
      }
      const prev = buf.length ? buf[buf.length - 1].part : null;
      if (isSub(p) && typeof prev === 'string') {
        const colon = /:\s*$/.test(prev), dash = /\s[—–-]\s*$/.test(prev) && hasLines(p);
        if (colon || dash) {
          lines.push({ label: label(colon ? /\s*:\s*$/ : /\s*[—–-]\s*$/), child: p, i, tail: [] });
          buf = []; afterSemi = false; labelled++;
          return;
        }
      }
      buf.push({ part: p, i });
    });
    flush();
    return labelled ? lines : null;
  }

  // The result as plain text: one line per outline line, two spaces of
  // indent per level (the session log). One-line results equal nodeText().
  function nodeOutline(node, depth) {
    depth = depth || 0;
    const lines = nodeLines(node);
    if (!lines) return nodeText(node);
    const pad = '  '.repeat(depth);
    const text = parts => parts.map(x => nodeText(x.part)).join('');
    return lines.map(l => {
      const head = text(l.label);
      if (!l.child) return pad + head;
      if (!hasLines(l.child)) return pad + (head ? head + ': ' : '') + nodeText(l.child) + text(l.tail);
      const items = l.child.kind === 'repeat' ? l.child.items : [l.child];
      return (head ? pad + head + '\n' : '') + items.map(it => nodeOutline(it, depth + (head ? 1 : 0))).join('\n');
    }).join('\n');
  }

  // The result for the clipboard: one line as is; an outline as a fenced
  // block (```), so the indents survive a paste into Markdown.
  function copyText(node) {
    const text = nodeOutline(node);
    return text.indexOf('\n') === -1 ? text : '```\n' + text + '\n```';
  }

  // The child node at `path` (a list of indexes into parts/items), or null.
  function nodeAt(rootNode, path) {
    let n = rootNode;
    for (const i of path) {
      const list = n && (n.kind === 'repeat' ? n.items : n.parts);
      n = list ? list[i] : null;
      if (!n || typeof n === 'string') return null;
    }
    return n;
  }

  // A copy of the tree with the node at `path` rolled again.
  function rerollAt(rootNode, path, ctx) {
    if (!path.length) return null;
    const parent = nodeAt(rootNode, path.slice(0, -1));
    const old = nodeAt(rootNode, path);
    if (!parent || !old) return null;
    const list = parent.kind === 'repeat' ? parent.items : parent.parts;
    const fresh = rerollRef(old.src, ctx, old.depth, old.stack);
    list[path[path.length - 1]] = fresh;
    return fresh;
  }

  /* ---- editor ---- */

  // The source as HTML for the highlight layer behind the editor's textarea.
  // The text is the same character for character (only spans are added).
  function highlight(source, resolve) {
    let head = false, cols = false;
    const refHtml = text => {
      let out = '', last = 0, m;
      const re = new RegExp(REF_RE.source, 'g');
      while ((m = re.exec(text))) {
        out += plain(text.slice(last, m.index));
        const l = lookup(m[1], resolve);
        const cls = l.kind === 'table' ? 'hl-ref' : l.kind === 'dice' ? 'hl-dice' : 'hl-bad';
        out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
        last = re.lastIndex;
      }
      return out + plain(text.slice(last));
    };
    const plain = s => (cols ? esc(s).replace(/\|/g, '<span class="hl-pipe">|</span>') : esc(s));
    return String(source || '').split('\n').map(line => {
      const t = line.trim();
      if (!t) return esc(line);
      if (t[0] === '#') return '<span class="hl-comment">' + esc(line) + '</span>';
      if (!head) {
        head = true;
        cols = line.indexOf('|') !== -1;
        return '<span class="hl-head">' + plain(line) + '</span>';
      }
      const lead = line.match(/^\s*/)[0];
      const m = RANGE_RE.exec(line.slice(lead.length));
      if (!m) return esc(lead) + refHtml(line.slice(lead.length));
      const prefix = line.slice(lead.length, lead.length + line.slice(lead.length).length - m[3].length);
      return esc(lead) + '<span class="hl-range">' + esc(prefix) + '</span>' + refHtml(m[3]);
    }).join('\n') + '\n';
  }

  // A table from data/tables.json (or any parsed table) as source text.
  function toSource(table) {
    const head = [table.formula].concat(table.columns || []).join(' | ');
    return [head].concat(table.entries.map(en =>
      en.range + ': ' + (table.columns && table.columns.length ? en.cells.join(' | ') : en.text))).join('\n') + '\n';
  }

  // Rewrites every [ref] to table `from` (any case) so it names `to`.
  function renameRefs(source, from, to) {
    const f = String(from).toLowerCase();
    return String(source || '').replace(new RegExp(REF_RE.source, 'g'), (whole, inner) => {
      const m = COUNT_RE.exec(inner.trim());
      const count = m ? m[1] + 'x ' : '';
      const name = m ? m[2].trim() : inner.trim();
      if (name.toLowerCase() === f) return '[' + count + to + ']';
      const dot = name.lastIndexOf('.');
      if (dot > 0 && name.slice(0, dot).trim().toLowerCase() === f) return '[' + count + to + name.slice(dot) + ']';
      return whole;
    });
  }

  const api = { formulaRange, parseTable, parseRef, lookup, refProblems, refNames, rollTable, rerollRef, rerollAt,
    nodeAt, nodeText, nodeLines, hasLines, nodeOutline, copyText, highlight, toSource, renameRefs, REF_RE, COUNT_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TableSyntax = api;
})(typeof window !== 'undefined' ? window : globalThis);
