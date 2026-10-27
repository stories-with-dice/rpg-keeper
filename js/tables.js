/* js/tables.js — the Tables tab: a filterable, rollable list of random
 * tables. Every campaign and every System sees the same tables. Two kinds:
 *   built-in  OSR.data.tables (loaded by js/data.js from data/tables.json,
 *             converted from data/tables/*.csv by scripts/convert-tables.js).
 *             Read-only; Duplicate copies one into a user table.
 *   user      the table library OSR.tableLib.tables
 *             ({ id, name, origin, settings, output, source }). `source` is
 *             the text format of js/table-syntax.js; `origin` is where the
 *             table comes from (shown as "Source"); `settings` is a list
 *             (Silent Legions is Modern and Horror).
 * The table library is not part of a campaign: it lives in IndexedDB as the
 * document 'library/tables' (js/store.js) and in Dropbox as /tables.json
 * (js/dropbox.js). OSR.tableLib.deleted ({ id: time }) remembers deleted
 * tables, so a merge with another copy does not bring them back.
 * A table's entries can roll on other tables by name ([Name], [Name.Col],
 * [2x Name], [2d6]). A user table hides a built-in one with the same name.
 * "Don't show included subtables" (on by default) hides every table that
 * another table rolls on, unless the user searches or opens it by a ref.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml } = OSR;
  const TS = window.TableSyntax;
  const TABLE_SETTINGS = ['Fantasy', 'Modern', 'Horror'];
  const TABLE_OUTPUTS = ['Encounter', 'Entity', 'Location', 'Adventure', 'Group', 'Other'];
  const DEFAULT_ORIGIN = 'Homebrew';
  // The settings a table gets when it has none: from the System it was made in.
  const SYSTEM_SETTINGS = { osr: ['Fantasy'], brp: ['Fantasy'], ua3e: ['Modern'], sl: ['Modern', 'Horror'] };
  const FILTERS = ['origin', 'settings', 'output'];
  const FILTER_ROW = { origin: '#tbl-filter-origin', settings: '#tbl-filter-settings', output: '#tbl-filter-output' };

  /* ---- the table library ---- */

  OSR.tableLib = { tables: [], deleted: {} };
  let libLoaded = false;

  // "horror" → "Horror", "Encounters" → "Encounter"; null when not in the list.
  function pick(list, v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return list.find(x => x.toLowerCase() === s || x.toLowerCase() + 's' === s) || null;
  }

  // ["horror", "Modern", "x"] → ["Modern", "Horror"] (list order, no unknowns).
  // A string (the old single `setting`) counts as a list of one.
  function pickSettings(v) {
    const list = (Array.isArray(v) ? v : v == null ? [] : [v]).map(x => pick(TABLE_SETTINGS, x));
    return TABLE_SETTINGS.filter(x => list.indexOf(x) !== -1);
  }

  // A table as the library keeps it. `system` (a campaign table, a pack) only
  // gives the default settings; `origin` is the default source.
  function cleanTable(t, opts) {
    const o = opts || {};
    const now = Date.now();
    return {
      id: t.id ? String(t.id) : OSR.uid(),
      name: String(t.name == null ? '' : t.name).trim(),
      origin: String(t.origin || '').trim() || o.origin || DEFAULT_ORIGIN,
      settings: firstList(pickSettings(t.settings != null ? t.settings : t.setting), SYSTEM_SETTINGS[t.system || o.system], ['Fantasy']),
      output: pick(TABLE_OUTPUTS, t.output) || 'Other',
      source: String(t.source == null ? '' : t.source),
      createdAt: t.createdAt || now,
      updatedAt: t.updatedAt || t.createdAt || now
    };
  }

  const firstList = (...lists) => lists.find(l => l && l.length).slice();

  function cleanLib(lib) {
    lib = lib && typeof lib === 'object' ? lib : {};
    const deleted = lib.deleted && typeof lib.deleted === 'object' ? lib.deleted : {};
    const tables = (Array.isArray(lib.tables) ? lib.tables : [])
      .filter(t => t && typeof t === 'object' && !deleted[t.id]).map(t => cleanTable(t));
    return { tables, deleted };
  }

  const tableByName = name => OSR.tableLib.tables.find(x => x.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null;
  const isNameTaken = (name, exceptId) => OSR.tableLib.tables.some(x => x.id !== exceptId && x.name.toLowerCase() === name.toLowerCase());

  // Adds tables to the library (import, content packs, old campaign tables).
  // A table without text, a deleted one, one the library has (same id), or
  // one whose name the library has is skipped. With opts.replace, a table
  // whose name the library has replaces that table's fields (it keeps its id
  // and name, so lookups to it still work); its id goes into opts.replaced.
  // Returns the added ids; the caller saves.
  function addTables(list, opts) {
    const o = opts || {};
    const added = [];
    (Array.isArray(list) ? list : []).forEach(t => {
      if (!t || typeof t !== 'object' || typeof t.source !== 'string') return;
      if (t.id && (OSR.tableLib.deleted[t.id] || OSR.tableLib.tables.some(x => x.id === t.id))) return;
      const item = cleanTable(t, o);
      if (!item.name || /[[\]]/.test(item.name)) return;
      const had = tableByName(item.name);
      if (had) {
        if (!o.replace) return;
        Object.assign(had, { origin: item.origin, settings: item.settings, output: item.output, source: item.source, updatedAt: Date.now() });
        if (o.replaced) o.replaced.push(had.id);
        return;
      }
      OSR.tableLib.tables.push(item);
      added.push(item.id);
    });
    return added;
  }

  function removeTables(ids) {
    const set = new Set(ids);
    OSR.tableLib.tables = OSR.tableLib.tables.filter(t => !set.has(t.id));
  }

  // Writes the library. Resolves to whether the write reached the storage.
  async function saveTables() {
    if (OSR.dropboxNoteSave) OSR.dropboxNoteSave();
    try { await OSR.store.putDocs('library', { tables: JSON.stringify(OSR.tableLib) }); return true; }
    catch (e) { console.warn('table library write failed', e); return false; }
  }

  // At boot (before load()). The first time, the tables of every campaign on
  // this device (they used to belong to one campaign and System) go in.
  async function loadTables() {
    const raw = await OSR.store.getDocs('library');
    let lib = null;
    try { lib = raw.tables ? JSON.parse(raw.tables) : null; } catch (e) { console.warn('table library unreadable', e); }
    OSR.tableLib = cleanLib(lib);
    libLoaded = true;
    if (lib) return;
    const campaigns = (await OSR.store.getMeta('campaigns')) || [];
    for (const c of campaigns) {
      const docs = await OSR.store.getDocs(c.id);
      OSR.SYSTEMS.forEach(sys => {
        let doc = null;
        try { doc = docs[sys] ? JSON.parse(docs[sys]) : null; } catch (e) { /* skipped */ }
        if (doc && Array.isArray(doc.tables)) addTables(doc.tables, { system: sys });
      });
    }
    await saveTables();
  }

  // ensureStateShape() (js/core.js) hook: a campaign's own tables (an old
  // save, an old export, a Dropbox pull of an old file) move to the library.
  function adoptCampaignTables(state) {
    if (!('tables' in state)) return;
    const list = state.tables;
    delete state.tables;
    if (libLoaded && addTables(list).length) saveTables();
  }

  // Two copies of the library (this device and Dropbox, both changed): every
  // table of both, the later edit winning on the same id, minus the deleted ones.
  function mergeTableLibs(a, b) {
    a = cleanLib(a); b = cleanLib(b);
    const deleted = Object.assign({}, a.deleted);
    Object.keys(b.deleted).forEach(id => { deleted[id] = Math.max(deleted[id] || 0, b.deleted[id]); });
    const byId = new Map();
    a.tables.concat(b.tables).forEach(t => {
      const had = byId.get(t.id);
      if (!had || (t.updatedAt || 0) > (had.updatedAt || 0)) byId.set(t.id, t);
    });
    return { tables: Array.from(byId.values()).filter(t => !deleted[t.id]), deleted };
  }

  // Replaces the library (a pull from Dropbox). Resolves when written.
  async function setTableLibrary(lib) {
    OSR.tableLib = cleanLib(lib);
    libLoaded = true;
    await OSR.store.putDocs('library', { tables: JSON.stringify(OSR.tableLib) });
    renderTables();
  }

  /* ---- the list ---- */

  // Parsed user tables, cached by id while the source does not change.
  const parseCache = new Map();
  function parsedUser(t) {
    let c = parseCache.get(t.id);
    if (!c || c.source !== t.source) {
      c = { source: t.source, parsed: TS.parseTable(t.source) };
      parseCache.set(t.id, c);
    }
    return Object.assign({}, c.parsed, { id: t.id, name: t.name, origin: t.origin, settings: t.settings, output: t.output,
      user: true, source: t.source });
  }

  function builtin(t) {
    return { id: t.id, name: t.name, origin: t.origin, settings: t.settings, output: t.output, formula: t.formula, columns: [], user: false,
      entries: t.entries.map(en => Object.assign({ cells: [] }, en)), problems: [] };
  }

  // Every table: user tables first, then the built-in ones no user table hides.
  function library() {
    const user = OSR.tableLib.tables.map(parsedUser);
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

  function tableOrigins() {
    return Array.from(new Set(library().map(t => t.origin))).sort((a, b) => a.localeCompare(b));
  }

  // The values each filter row shows: every source a table has, and the fixed
  // settings and outputs.
  function filterValues(key) {
    return key === 'origin' ? tableOrigins() : key === 'settings' ? TABLE_SETTINGS : TABLE_OUTPUTS;
  }

  // A table's values for one filter (settings is a list, the others one value).
  const valuesOf = (t, key) => (Array.isArray(t[key]) ? t[key] : [t[key]]);
  const noneOff = () => ({ origin: new Set(), settings: new Set(), output: new Set() });
  let tblOff = noneOff();           // filter values the user unticked, by filter
  let tblOpenIds = new Set();       // ids of currently-expanded <details> rows
  let tblLastRoll = Object.create(null); // id -> { tree } (js/table-syntax.js node)

  // Cleared by the test seam's reset() and a campaign switch.
  let tblShowIds = new Set();       // sub-tables opened by a ref or a save: shown though included
  function resetTableFilters() {
    tblOff = noneOff(); tblOpenIds = new Set(); tblShowIds = new Set(); tblLastRoll = Object.create(null);
    $('#tbl-hide-subs').checked = true;
  }

  // Lower-case names of the tables that another table rolls on.
  function includedNames(list, resolve) {
    const out = new Set();
    list.forEach(t => TS.refNames(t, resolve).forEach(n => { if (n !== t.name.toLowerCase()) out.add(n); }));
    return out;
  }

  function renderTableFilters() {
    const counts = noneOff();
    FILTERS.forEach(k => { counts[k] = new Map(); });
    library().forEach(t => FILTERS.forEach(k => valuesOf(t, k).forEach(v => counts[k].set(v, (counts[k].get(v) || 0) + 1))));
    FILTERS.forEach(k => {
      $(FILTER_ROW[k]).innerHTML = filterValues(k).map(v =>
        '<label class="comp-cat"><input type="checkbox" data-filter="' + k + '" data-value="' + escapeHtml(v) + '"' +
        (tblOff[k].has(v) ? '' : ' checked') + ' /> ' + escapeHtml(v) +
        ' <span class="hint">' + (counts[k].get(v) || 0) + '</span></label>').join('');
    });
  }

  // A table shows when each filter row has one of its values ticked.
  function tblMatches(list, resolve) {
    const all = list;
    list = list.filter(t => FILTERS.every(k => valuesOf(t, k).some(v => !tblOff[k].has(v))));
    const term = $('#tbl-search').value.trim().toLowerCase();
    if (term) list = list.filter(t => t.name.toLowerCase().indexOf(term) !== -1);
    else if ($('#tbl-hide-subs').checked) {
      const inc = includedNames(all, resolve);
      list = list.filter(t => !inc.has(t.name.toLowerCase()) || tblShowIds.has(t.id));
    }
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  // Ticks every filter value of table `t`, so it shows.
  function showTable(t) {
    if (!t) return;
    FILTERS.forEach(k => valuesOf(t, k).forEach(v => tblOff[k].delete(v)));
    tblShowIds.add(t.id);
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

  // A result laid out as lines (TS.nodeLines): "Label: result" per sub-table,
  // and a sub-table with lines of its own indented under its label. The label
  // of an indented group rolls that whole group again.
  function linesHtml(node, path) {
    const partsHtml = list => list.map(x => (typeof x.part === 'string' ? escapeHtml(x.part) : nodeHtml(x.part, path.concat(x.i)))).join('');
    return '<div class="tbl-lines">' + TS.nodeLines(node).map(l => {
      const label = partsHtml(l.label);
      if (!l.child) return '<div class="tbl-line">' + label + '</div>';
      const cp = path.concat(l.i);
      if (!TS.hasLines(l.child)) {
        return '<div class="tbl-line">' + (label ? '<span class="tbl-label">' + label + ':</span> ' : '') + nodeHtml(l.child, cp) + partsHtml(l.tail) + '</div>';
      }
      const c = l.child;
      const title = c.kind === 'repeat' ? c.count + '× ' + (c.items[0] ? c.items[0].name : c.src) : c.name + ' (' + c.formula + ' → ' + c.roll + ')';
      const body = c.kind === 'repeat'
        ? c.items.map((it, k) => (TS.hasLines(it) ? linesHtml(it, cp.concat(k)) : '<div class="tbl-line">' + nodeHtml(it, cp.concat(k)) + '</div>')).join('')
        : linesHtml(c, cp);
      return '<div class="tbl-line is-group"><span class="tbl-sub tbl-label" data-path="' + cp.join('.') + '" title="' +
        escapeHtml(title + ' · click to roll again') + '">' + (label || escapeHtml(c.name || c.src)) + '</span>' + body + '</div>';
    }).join('') + '</div>';
  }

  function resultHtml(t, tree) {
    const range = TS.formulaRange(t.formula);
    const rolled = range && range.min === range.max ? '' : '<span class="tbl-roll-result">Rolled <b>' +
      escapeHtml(String(tree.roll == null ? '?' : tree.roll)) + '</b></span> ';
    const copy = '<button class="btn tbl-copy" title="Copy the result"><i class="fa-solid fa-copy"></i></button>';
    return copy + (TS.nodeLines(tree)
      ? rolled + '<div class="tbl-result-text is-lines">' + linesHtml(tree, []) + '</div>'
      : rolled + '<span class="tbl-result-text">' + nodeHtml(tree, []) + '</span>');
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
          '<span class="badge" title="Output">' + escapeHtml(t.output) + '</span>' +
          t.settings.map(v => '<span class="badge tbl-setting" title="Setting">' + escapeHtml(v) + '</span>').join('') +
          '<span class="hint tbl-origin" title="Source">' + escapeHtml(t.origin) + '</span>' +
          (t.user ? '<span class="badge tbl-mine" title="Your table">mine</span>' : '') +
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
          (last ? '<div class="tbl-result" data-id="' + id + '">' + resultHtml(t, last.tree) + '</div>' : '') +
          '<table class="tbl-entries">' + head + '<tbody>' +
            t.entries.map((en, idx) => entryRowHtml(t, en, idx, resolve)).join('') +
          '</tbody></table>' +
        '</div>' +
      '</details>' +
    '</li>';
  }

  function renderTables() {
    renderTableFilters();
    const all = library();
    const resolve = resolver();
    const list = tblMatches(all, resolve);
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
    OSR.pushLog(t.name, t.formula, tree.roll, tree.entryIdx === -1 ? '(no matching entry)' : TS.nodeOutline(tree), { quiet: true });
    renderTables();
  }

  // Roll one part of the last result again (a click on a .tbl-sub span).
  function rerollPart(id, pathStr) {
    const last = tblLastRoll[id], t = findTable(id);
    if (!last || !t) return;
    const path = pathStr.split('.').map(Number);
    const fresh = TS.rerollAt(last.tree, path, rollCtx());
    if (!fresh) return;
    const text = TS.nodeOutline(last.tree);
    const what = fresh.kind === 'dice' ? fresh.formula : (fresh.name || fresh.src);
    OSR.pushLog(t.name + ' (again: ' + what + ')', fresh.formula || '', fresh.roll == null ? '' : fresh.roll, text, { quiet: true });
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

  const optionsHtml = (list, value) => list.map(v =>
    '<option value="' + escapeHtml(v) + '"' + (v === value ? ' selected' : '') + '>' + escapeHtml(v) + '</option>').join('');

  // opts: { name, origin, settings, output, source } prefills a new table (Duplicate).
  function openTableEditor(id, opts) {
    const t = id ? OSR.tableLib.tables.find(x => x.id === id) : null;
    editId = t ? t.id : null;
    const o = t || Object.assign(cleanTable({ source: '', system: OSR.currentSystem() }), opts || {});
    $('#tbl-modal-title').textContent = t ? 'Edit table' : 'New table';
    $('#tbl-f-name').value = o.name || '';
    $('#tbl-f-origin').value = o.origin;
    $('#tbl-f-settings').innerHTML = TABLE_SETTINGS.map(v =>
      '<label class="comp-cat"><input type="checkbox" data-setting="' + escapeHtml(v) + '"' +
      (o.settings.indexOf(v) !== -1 ? ' checked' : '') + ' /> ' + escapeHtml(v) + '</label>').join('');
    $('#tbl-f-output').innerHTML = optionsHtml(TABLE_OUTPUTS, o.output);
    $('#tbl-f-src').value = t ? t.source : (o.source || 'd6\n1: \n');
    $('#tbl-origin-list').innerHTML = tableOrigins().map(g => '<option value="' + escapeHtml(g) + '"></option>').join('');
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
    const origin = $('#tbl-f-origin').value.trim() || DEFAULT_ORIGIN;
    const settings = Array.from(document.querySelectorAll('#tbl-f-settings input:checked')).map(cb => cb.dataset.setting);
    const output = pick(TABLE_OUTPUTS, $('#tbl-f-output').value) || 'Other';
    const source = $('#tbl-f-src').value;
    const msg = $('#tbl-msg');
    if (!name) { msg.textContent = 'Give the table a name.'; $('#tbl-f-name').focus(); return; }
    if (/[[\]]/.test(name)) { msg.textContent = 'A name cannot contain [ or ].'; return; }
    if (!settings.length) { msg.textContent = 'Tick at least one setting.'; return; }
    const clash = OSR.tableLib.tables.find(x => x.id !== editId && x.name.toLowerCase() === name.toLowerCase());
    if (clash) { msg.textContent = 'You already have a table named "' + clash.name + '".'; return; }
    const parsed = TS.parseTable(source);
    if (parsed.problems.some(p => p.level === 'error')) { msg.textContent = 'Fix the errors first.'; return; }
    const now = Date.now();
    let t = editId ? OSR.tableLib.tables.find(x => x.id === editId) : null;
    if (t) {
      const old = t.name;
      if (old.toLowerCase() !== name.toLowerCase()) {
        // Keep the tables that roll on this one working.
        OSR.tableLib.tables.forEach(x => {
          if (x === t) return;
          const next = TS.renameRefs(x.source, old, name);
          if (next !== x.source) Object.assign(x, { source: next, updatedAt: now });
        });
      }
      Object.assign(t, { name, origin, settings, output, source: TS.renameRefs(source, old, name), updatedAt: now });
    } else {
      t = { id: OSR.uid(), name, origin, settings, output, source, createdAt: now, updatedAt: now };
      OSR.tableLib.tables.push(t);
    }
    saveTables();
    closeTableEditor();
    tblOpenIds.add(t.id);
    showTable(t);
    renderTables();
  }

  function deleteTable(id) {
    const t = OSR.tableLib.tables.find(x => x.id === id);
    if (!t || !confirm('Delete the table "' + t.name + '"? Every campaign loses it.')) return;
    removeTables([id]);
    OSR.tableLib.deleted[id] = Date.now();
    delete tblLastRoll[id];
    tblOpenIds.delete(id);
    saveTables();
    if (editId === id) closeTableEditor();
    renderTables();
  }

  function duplicateTable(id) {
    const t = findTable(id);
    if (!t) return;
    let name = t.name + ' (copy)', n = 2;
    while (isNameTaken(name)) name = t.name + ' (copy ' + n++ + ')';
    openTableEditor(null, { name, origin: t.origin, settings: t.settings.slice(), output: t.output, source: t.user ? t.source : TS.toSource(t) });
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
      .map(x => ({ name: x.name, badge: x.output, insert: x.name + (x.columns.length ? '.' : ']') }));
  }

  function wireTables() {
    $('#tbl-search').addEventListener('input', renderTables);
    $('#tbl-hide-subs').addEventListener('change', renderTables);
    $('#tbl-new').addEventListener('click', () => openTableEditor(null));
    $('#tbl-filters').addEventListener('change', e => {
      const cb = e.target.closest('input[data-filter]');
      if (!cb) return;
      const off = tblOff[cb.dataset.filter];
      if (cb.checked) off.delete(cb.dataset.value); else off.add(cb.dataset.value);
      renderTables();
    });
    // Right-click a value to isolate it: only that one stays ticked in its
    // row; the other rows do not change. See the
    // matching comment in js/compendium.js's wireCompendiumEntries() — some
    // input methods (e.g. a trackpad's two-finger-tap right-click) also fire
    // this checkbox's own native toggle + 'change', racing this isolate
    // logic. Deferring the actual isolate via `setTimeout(…, 0)` makes it the
    // final word regardless: every event from a single physical gesture
    // (however it's reported) dispatches synchronously in the same task,
    // before this callback's task runs.
    $('#tbl-filters').addEventListener('contextmenu', e => {
      const lbl = e.target.closest('label.comp-cat');
      const cb = lbl && lbl.querySelector('input[data-filter]');
      if (!cb) return;
      e.preventDefault();
      const key = cb.dataset.filter, target = cb.dataset.value;
      setTimeout(() => { tblOff[key] = new Set(filterValues(key).filter(g => g !== target)); renderTables(); }, 0);
    });
    $('#tbl-list').addEventListener('click', e => {
      const copy = e.target.closest('.tbl-copy');
      if (copy) {
        const last = tblLastRoll[copy.closest('.tbl-result').dataset.id];
        if (last) OSR.copyText(TS.copyText(last.tree));
        copy.innerHTML = '<i class="fa-solid fa-check"></i>';
        setTimeout(() => { copy.innerHTML = '<i class="fa-solid fa-copy"></i>'; }, 1200);
        return;
      }
      const sub = e.target.closest('.tbl-sub');
      if (sub) { rerollPart(sub.closest('.tbl-result').dataset.id, sub.dataset.path); return; }
      const ref = e.target.closest('.tbl-ref[data-ref-id]');
      if (ref) {
        const rid = ref.dataset.refId;
        tblOpenIds.add(rid);
        showTable(findTable(rid));
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
    // re-render from search/filter changes (or another row's roll) doesn't
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

  Object.assign(OSR, {
    TABLE_SETTINGS, TABLE_OUTPUTS, cleanTable, tableByName, loadTables, saveTables, addTables, removeTables, adoptCampaignTables,
    mergeTableLibs, setTableLibrary, renderTables, wireTables, resetTableFilters, openTableEditor, closeTableEditor, tableAcItems
  });
})(window.OSR = window.OSR || {});
