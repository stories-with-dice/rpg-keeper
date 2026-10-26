/* js/tables.js — the Tables tab: a filterable, rollable list of random
 * tables. Two kinds:
 *   built-in  OSR.data.tables (loaded by js/data.js from data/tables.json,
 *             converted from data/tables/*.csv by scripts/convert-tables.js).
 *             Read-only; Duplicate copies one into a user table.
 *   user      state.tables ({ id, name, tag, system, source }), one System
 *             each. `source` is the text format of js/table-syntax.js.
 * A table's entries can roll on other tables by name ([Name], [Name.Col],
 * [2x Name], [2d6]). A user table hides a built-in one with the same name.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml } = OSR;
  const TS = window.TableSyntax;
  const DEFAULT_TAG = 'Custom';

  function tablesForSystem() {
    const sys = OSR.currentSystem();
    return OSR.state.tables.filter(t => (t.system || 'osr') === sys);
  }

  // Parsed user tables, cached by id while the source does not change.
  const parseCache = new Map();
  function parsedUser(t) {
    let c = parseCache.get(t.id);
    if (!c || c.source !== t.source) {
      c = { source: t.source, parsed: TS.parseTable(t.source) };
      parseCache.set(t.id, c);
    }
    return Object.assign({}, c.parsed, { id: t.id, name: t.name, tag: t.tag || DEFAULT_TAG, user: true, source: t.source });
  }

  function builtin(t) {
    return { id: t.id, name: t.name, tag: t.tag, formula: t.formula, columns: [], user: false,
      entries: t.entries.map(en => Object.assign({ cells: [] }, en)), problems: [] };
  }

  // Every table the current System sees: user tables first, then the built-in
  // ones no user table hides.
  function library() {
    const user = tablesForSystem().map(parsedUser);
    const names = new Set(user.map(t => t.name.toLowerCase()));
    return user.concat(OSR.data.tables.filter(t => !names.has(t.name.toLowerCase())).map(builtin));
  }

  function findTable(id) { return library().find(t => t.id === id) || null; }

  // Name → table for the roller. `extra` (the editor's draft) wins.
  function resolver(extra) {
    const list = library();
    return name => {
      const n = String(name || '').trim().toLowerCase();
      if (!n) return null;
      if (extra && extra.name.toLowerCase() === n) return extra;
      return list.find(t => t.name.toLowerCase() === n && (!extra || t.id !== extra.id)) || null;
    };
  }

  function rollCtx(extra) {
    return {
      resolve: resolver(extra),
      roll: f => { const r = OSR.evalFormula(f); return r ? { total: r.total, detail: r.detail } : null; }
    };
  }

  function tableTags() {
    return Array.from(new Set(library().map(t => t.tag))).sort();
  }

  let tblTagOff = new Set();        // tags the user unticked
  let tblOpenIds = new Set();       // ids of currently-expanded <details> rows
  let tblLastRoll = Object.create(null); // id -> { tree } (js/table-syntax.js node)

  // Cleared by the test seam's reset() — see js/main.js.
  function resetTableFilters() { tblTagOff = new Set(); tblOpenIds = new Set(); tblLastRoll = Object.create(null); }

  function renderTableTags() {
    $('#tbl-tags').innerHTML = tableTags().map(t =>
      '<label class="comp-cat"><input type="checkbox" data-tag="' + escapeHtml(t) + '"' +
      (tblTagOff.has(t) ? '' : ' checked') + ' /> ' + escapeHtml(t) + '</label>').join('');
  }

  function tblMatches(list) {
    list = list.filter(t => !tblTagOff.has(t.tag));
    const term = $('#tbl-search').value.trim().toLowerCase();
    if (term) list = list.filter(t => t.name.toLowerCase().indexOf(term) !== -1);
    return list.slice().sort((a, b) => a.tag.localeCompare(b.tag) || a.name.localeCompare(b.name));
  }

  // Entry text with each [ref] as a chip; a chip to a listed table opens it.
  function refsHtml(text, resolve) {
    let out = '', last = 0, m;
    const re = new RegExp(TS.REF_RE.source, 'g');
    while ((m = re.exec(text))) {
      out += escapeHtml(text.slice(last, m.index));
      const l = TS.lookup(m[1], resolve);
      if (l.kind === 'table') {
        out += '<span class="tbl-ref" data-ref-id="' + escapeHtml(l.table.id) + '" title="Open ' + escapeHtml(l.table.name) + '">' + escapeHtml(m[0]) + '</span>';
      } else {
        out += '<span class="tbl-ref' + (l.kind === 'bad' ? ' is-bad' : ' is-dice') + '"' +
          (l.error ? ' title="' + escapeHtml(l.error) + '"' : '') + '>' + escapeHtml(m[0]) + '</span>';
      }
      last = re.lastIndex;
    }
    return out + escapeHtml(text.slice(last));
  }

  function entryRowHtml(t, en, idx, resolve) {
    const last = tblLastRoll[t.id];
    const hit = last && last.tree.entryIdx === idx;
    const cells = t.columns.length
      ? en.cells.map(c => '<td>' + refsHtml(c, resolve) + '</td>').join('')
      : '<td>' + refsHtml(en.text, resolve) + '</td>';
    return '<tr class="tbl-entry' + (hit ? ' is-hit' : '') + '">' +
      '<td class="tbl-range">' + escapeHtml(en.range) + '</td>' + cells + '</tr>';
  }

  // A roll result as HTML: each sub-roll is a .tbl-sub span (click → re-roll
  // that part only). `path` locates the node for TableSyntax.nodeAt().
  function nodeHtml(node, path) {
    if (typeof node === 'string') return escapeHtml(node);
    const p = path.join('.');
    const sub = (cls, title, inner) => '<span class="tbl-sub' + cls + '" data-path="' + p + '" title="' +
      escapeHtml(title + ' · click to roll again') + '">' + inner + '</span>';
    if (node.kind === 'dice') return sub(' is-dice', node.formula + ': ' + node.detail, escapeHtml(String(node.roll)));
    if (node.kind === 'error') return sub(' is-error', node.error, escapeHtml(TS.nodeText(node)));
    if (node.kind === 'repeat') {
      return sub(' is-repeat', node.count + '× ' + (node.items[0] ? node.items[0].name : node.src),
        node.items.map((it, i) => nodeHtml(it, path.concat(i))).join(', '));
    }
    const label = node.name + (node.column ? '.' + node.column : '');
    if (node.error) return path.length ? sub(' is-error', label + ': ' + node.error, escapeHtml(TS.nodeText(node))) : escapeHtml(node.error);
    const inner = node.parts.map((x, i) => nodeHtml(x, path.concat(i))).join('');
    return path.length ? sub('', label + ' (' + node.formula + ' → ' + node.roll + ')', inner) : inner;
  }

  function tableRowHtml(t, resolve) {
    const open = tblOpenIds.has(t.id);
    const last = tblLastRoll[t.id];
    const id = escapeHtml(t.id);
    const subs = TS.refNames(t, resolve).size;
    const bad = t.problems.some(p => p.level === 'error');
    const head = t.columns.length
      ? '<thead><tr><th></th>' + t.columns.map(c => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr></thead>' : '';
    return '<li class="tbl-row' + (t.user ? ' is-user' : '') + '" data-id="' + id + '">' +
      '<details' + (open ? ' open' : '') + '>' +
        '<summary>' +
          '<span class="tbl-name">' + escapeHtml(t.name) + '</span>' +
          '<span class="badge">' + escapeHtml(t.tag) + '</span>' +
          (t.user ? '<span class="badge tbl-mine" title="Your table (this campaign)">mine</span>' : '') +
          (subs ? '<span class="hint tbl-subs" title="Rolls on other tables"><i class="fa-solid fa-diagram-project"></i> ' + subs + '</span>' : '') +
          '<span class="hint tbl-formula">' + escapeHtml(t.formula) + ' &middot; ' + t.entries.length + ' entries</span>' +
        '</summary>' +
        '<div class="tbl-body">' +
          '<div class="tbl-actions">' +
            '<button class="btn btn-primary tbl-roll" data-id="' + id + '"' + (bad ? ' disabled' : '') + '>' +
              '<i class="fa-solid fa-dice-d20"></i> Roll ' + escapeHtml(t.formula) +
            '</button>' +
            (t.user ? '<button class="btn tbl-edit" data-id="' + id + '"><i class="fa-solid fa-pen"></i> Edit</button>' : '') +
            '<button class="btn tbl-dup" data-id="' + id + '"><i class="fa-solid fa-copy"></i> Duplicate</button>' +
            (t.user ? '<button class="btn btn-danger tbl-del" data-id="' + id + '"><i class="fa-solid fa-trash"></i></button>' : '') +
          '</div>' +
          (last ? '<div class="tbl-result" data-id="' + id + '"><span class="tbl-roll-result">Rolled <b>' +
            escapeHtml(String(last.tree.roll == null ? '?' : last.tree.roll)) + '</b></span> ' +
            '<span class="tbl-result-text">' + nodeHtml(last.tree, []) + '</span></div>' : '') +
          '<table class="tbl-entries">' + head + '<tbody>' +
            t.entries.map((en, idx) => entryRowHtml(t, en, idx, resolve)).join('') +
          '</tbody></table>' +
        '</div>' +
      '</details>' +
    '</li>';
  }

  function renderTables() {
    renderTableTags();
    const all = library();
    const list = tblMatches(all);
    const resolve = resolver();
    $('#tbl-count').textContent = list.length + ' / ' + all.length;
    $('#tbl-empty').hidden = all.length > 0;
    $('#tbl-list').innerHTML = list.map(t => tableRowHtml(t, resolve)).join('');
  }

  function rollTable(id) {
    const t = findTable(id);
    if (!t || !t.entries.length) return;
    const tree = TS.rollTable(t, rollCtx());
    if (tree.roll == null) return;
    tblLastRoll[id] = { tree };
    tblOpenIds.add(id);
    OSR.pushLog(t.name, t.formula, tree.roll, tree.entryIdx === -1 ? '(no matching entry)' : TS.nodeText(tree));
    renderTables();
  }

  // Roll one part of the last result again (a click on a .tbl-sub span).
  function rerollPart(id, pathStr) {
    const last = tblLastRoll[id], t = findTable(id);
    if (!last || !t) return;
    const path = pathStr.split('.').map(Number);
    const fresh = TS.rerollAt(last.tree, path, rollCtx());
    if (!fresh) return;
    const text = TS.nodeText(last.tree);
    const what = fresh.kind === 'dice' ? fresh.formula : (fresh.name || fresh.src);
    OSR.pushLog(t.name + ' (again: ' + what + ')', fresh.formula || '', fresh.roll == null ? '' : fresh.roll, text);
    renderTables();
  }

  /* ---- editor (#tbl-modal) ---- */

  let editId = null;   // id of the user table in the editor, or null for a new one

  function draftTable() {
    const parsed = TS.parseTable($('#tbl-f-src').value);
    return Object.assign(parsed, { id: editId || '__draft__', name: $('#tbl-f-name').value.trim() || 'This table', user: true });
  }

  // Redraws the highlight layer and the problem list from the textarea.
  function refreshEditor() {
    const ta = $('#tbl-f-src');
    const draft = draftTable();
    const resolve = resolver(draft);
    $('#tbl-hl').innerHTML = TS.highlight(ta.value, resolve);
    syncScroll();
    const problems = draft.problems.concat(TS.refProblems(draft, resolve));
    $('#tbl-problems').innerHTML = problems.map(p =>
      '<li class="is-' + p.level + '">' + escapeHtml(p.msg) + '</li>').join('');
    $('#tbl-problems').hidden = !problems.length;
  }

  function syncScroll() {
    const ta = $('#tbl-f-src'), hl = $('#tbl-hl');
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  }

  // opts: { name, tag, source } prefills a new table (Duplicate).
  function openTableEditor(id, opts) {
    const t = id ? OSR.state.tables.find(x => x.id === id) : null;
    editId = t ? t.id : null;
    const o = opts || {};
    $('#tbl-modal-title').textContent = t ? 'Edit table' : 'New table';
    $('#tbl-f-name').value = t ? t.name : (o.name || '');
    $('#tbl-f-tag').value = t ? (t.tag || DEFAULT_TAG) : (o.tag || DEFAULT_TAG);
    $('#tbl-f-src').value = t ? t.source : (o.source || 'd6\n1: \n');
    $('#tbl-tag-list').innerHTML = tableTags().map(g => '<option value="' + escapeHtml(g) + '"></option>').join('');
    $('#tbl-f-delete').hidden = !t;
    $('#tbl-msg').textContent = '';
    $('#tbl-test-out').innerHTML = '';
    $('#tbl-modal').hidden = false;
    refreshEditor();
    $('#tbl-f-name').focus();
  }

  function closeTableEditor() {
    const m = $('#tbl-modal');
    if (m) m.hidden = true;
    editId = null;
  }

  function testRoll() {
    const draft = draftTable();
    if (draft.problems.some(p => p.level === 'error')) {
      $('#tbl-test-out').textContent = 'Fix the errors first.';
      return;
    }
    const tree = TS.rollTable(draft, rollCtx(draft));
    $('#tbl-test-out').innerHTML = '<b>' + escapeHtml(String(tree.roll == null ? '?' : tree.roll)) + '</b> ' +
      escapeHtml(tree.error && tree.entryIdx === -1 ? tree.error : TS.nodeText(tree));
  }

  function saveTable() {
    const name = $('#tbl-f-name').value.trim();
    const tag = $('#tbl-f-tag').value.trim() || DEFAULT_TAG;
    const source = $('#tbl-f-src').value;
    const msg = $('#tbl-msg');
    if (!name) { msg.textContent = 'Give the table a name.'; $('#tbl-f-name').focus(); return; }
    if (/[[\]]/.test(name)) { msg.textContent = 'A name cannot contain [ or ].'; return; }
    const clash = tablesForSystem().find(x => x.id !== editId && x.name.toLowerCase() === name.toLowerCase());
    if (clash) { msg.textContent = 'You already have a table named "' + clash.name + '".'; return; }
    const parsed = TS.parseTable(source);
    if (parsed.problems.some(p => p.level === 'error')) { msg.textContent = 'Fix the errors first.'; return; }
    const now = Date.now();
    let t = editId ? OSR.state.tables.find(x => x.id === editId) : null;
    if (t) {
      const old = t.name;
      if (old.toLowerCase() !== name.toLowerCase()) {
        // Keep the tables that roll on this one working.
        tablesForSystem().forEach(x => { if (x !== t) x.source = TS.renameRefs(x.source, old, name); });
      }
      Object.assign(t, { name, tag, source: TS.renameRefs(source, old, name), updatedAt: now });
    } else {
      t = { id: OSR.uid(), name, tag, system: OSR.currentSystem(), source, createdAt: now, updatedAt: now };
      OSR.state.tables.push(t);
    }
    OSR.save();
    closeTableEditor();
    tblOpenIds.add(t.id);
    tblTagOff.delete(tag);
    renderTables();
  }

  function deleteTable(id) {
    const t = OSR.state.tables.find(x => x.id === id);
    if (!t || !confirm('Delete the table "' + t.name + '"?')) return;
    OSR.state.tables = OSR.state.tables.filter(x => x.id !== id);
    delete tblLastRoll[id];
    tblOpenIds.delete(id);
    OSR.save();
    if (editId === id) closeTableEditor();
    renderTables();
  }

  function duplicateTable(id) {
    const t = findTable(id);
    if (!t) return;
    let name = t.name + ' (copy)', n = 2;
    const taken = new Set(tablesForSystem().map(x => x.name.toLowerCase()));
    while (taken.has(name.toLowerCase())) name = t.name + ' (copy ' + n++ + ')';
    openTableEditor(null, { name, tag: t.tag, source: t.user ? t.source : TS.toSource(t) });
  }

  // "[" autocomplete items for the editor (js/compendium-popups.js shows them):
  // table names, or after "Name." that table's columns.
  function tableAcItems(q) {
    const resolve = resolver(draftTable());
    const dot = q.lastIndexOf('.');
    if (dot > 0) {
      const base = resolve(q.slice(0, dot));
      if (base && base.columns.length) {
        const c = q.slice(dot + 1).toLowerCase();
        return base.columns.filter(col => col.toLowerCase().indexOf(c) === 0)
          .map(col => ({ name: base.name + '.' + col, badge: 'column', insert: base.name + '.' + col + ']' }));
      }
    }
    const t = q.trim().toLowerCase();
    const starts = [], has = [];
    library().filter(x => x.id !== editId).forEach(x => {
      const i = x.name.toLowerCase().indexOf(t);
      if (i === 0) starts.push(x); else if (i > 0) has.push(x);
    });
    const byName = (a, b) => a.name.localeCompare(b.name);
    return starts.sort(byName).concat(has.sort(byName)).slice(0, 8)
      .map(x => ({ name: x.name, badge: x.tag, insert: x.name + (x.columns.length ? '.' : ']') }));
  }

  function wireTables() {
    $('#tbl-search').addEventListener('input', renderTables);
    $('#tbl-new').addEventListener('click', () => openTableEditor(null));
    $('#tbl-tags').addEventListener('change', e => {
      const cb = e.target.closest('input[data-tag]');
      if (!cb) return;
      if (cb.checked) tblTagOff.delete(cb.dataset.tag); else tblTagOff.add(cb.dataset.tag);
      renderTables();
    });
    // Right-click a tag to isolate it: only that one stays ticked. See the
    // matching comment in js/compendium.js's wireCompendiumEntries() — some
    // input methods (e.g. a trackpad's two-finger-tap right-click) also fire
    // this checkbox's own native toggle + 'change', racing this isolate
    // logic. Deferring the actual isolate via `setTimeout(…, 0)` makes it the
    // final word regardless: every event from a single physical gesture
    // (however it's reported) dispatches synchronously in the same task,
    // before this callback's task runs.
    $('#tbl-tags').addEventListener('contextmenu', e => {
      const lbl = e.target.closest('label.comp-cat');
      const cb = lbl && lbl.querySelector('input[data-tag]');
      if (!cb) return;
      e.preventDefault();
      const target = cb.dataset.tag;
      setTimeout(() => { tblTagOff = new Set(tableTags().filter(g => g !== target)); renderTables(); }, 0);
    });
    $('#tbl-list').addEventListener('click', e => {
      const sub = e.target.closest('.tbl-sub');
      if (sub) { rerollPart(sub.closest('.tbl-result').dataset.id, sub.dataset.path); return; }
      const ref = e.target.closest('.tbl-ref[data-ref-id]');
      if (ref) {
        const rid = ref.dataset.refId;
        tblOpenIds.add(rid);
        tblTagOff.delete((findTable(rid) || {}).tag);
        $('#tbl-search').value = '';
        renderTables();
        const li = Array.from(document.querySelectorAll('#tbl-list .tbl-row')).find(x => x.dataset.id === rid);
        if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
        return;
      }
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      if (btn.classList.contains('tbl-roll')) rollTable(btn.dataset.id);
      else if (btn.classList.contains('tbl-edit')) openTableEditor(btn.dataset.id);
      else if (btn.classList.contains('tbl-dup')) duplicateTable(btn.dataset.id);
      else if (btn.classList.contains('tbl-del')) deleteTable(btn.dataset.id);
    });
    // <details>'s "toggle" event doesn't bubble — a capture listener on an
    // ancestor still sees it (capture doesn't require bubbling). Keeps
    // tblOpenIds in sync with rows the user expands/collapses by hand, so a
    // re-render from search/tag filtering (or another row's roll) doesn't
    // collapse rows the user left open.
    $('#tbl-list').addEventListener('toggle', e => {
      const det = e.target.closest('details');
      const li = det && det.closest('.tbl-row');
      if (!li) return;
      if (det.open) tblOpenIds.add(li.dataset.id); else tblOpenIds.delete(li.dataset.id);
    }, true);

    const ta = $('#tbl-f-src');
    ta.addEventListener('input', () => { refreshEditor(); OSR.acFromTableEditor(ta); });
    ta.addEventListener('scroll', syncScroll);
    ta.addEventListener('click', () => OSR.acFromTableEditor(ta));
    ta.addEventListener('keyup', e => {
      if (OSR.compAC && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
      if (/^(Arrow|Home|End)/.test(e.key)) OSR.acFromTableEditor(ta);
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (OSR.compAC && OSR.compAC.ta === ta) OSR.closeAC(); }, 120));
    $('#tbl-f-name').addEventListener('input', refreshEditor);
    $('#tbl-f-test').addEventListener('click', testRoll);
    $('#tbl-f-save').addEventListener('click', saveTable);
    $('#tbl-f-cancel').addEventListener('click', closeTableEditor);
    $('#tbl-close').addEventListener('click', closeTableEditor);
    $('#tbl-f-delete').addEventListener('click', () => { if (editId) deleteTable(editId); });
  }

  Object.assign(OSR, { tablesForSystem, renderTables, wireTables, resetTableFilters, openTableEditor, closeTableEditor, tableAcItems });
})(window.OSR = window.OSR || {});
