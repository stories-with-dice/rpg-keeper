/* js/tables.js — the Tables tab: a filterable, rollable browser over the
 * static random-table library (js/tables-data.js's window.TABLES_LIBRARY,
 * converted from data/tables/*.csv by scripts/convert-tables.js — see
 * AGENTS.md). Read-only reference data, same pattern as the Bestiary's PL
 * generator tables — no state persistence, no CRUD.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml } = OSR;

  function library() {
    return Array.isArray(window.TABLES_LIBRARY) ? window.TABLES_LIBRARY : [];
  }

  function tableTags() {
    return Array.from(new Set(library().map(t => t.tag))).sort();
  }

  let tblTagFilter = null;  // Set of enabled tags (lazily = all)
  let tblOpenIds = new Set();      // ids of currently-expanded <details> rows
  let tblLastRoll = Object.create(null); // id -> { roll, entryIdx }

  // Cleared by the test seam's reset() — see js/main.js.
  function resetTableFilters() { tblTagFilter = null; tblOpenIds = new Set(); tblLastRoll = Object.create(null); }

  function tblTags() {
    if (!tblTagFilter) tblTagFilter = new Set(tableTags());
    return tblTagFilter;
  }

  function renderTableTags() {
    const on = tblTags();
    $('#tbl-tags').innerHTML = tableTags().map(t =>
      '<label class="comp-cat"><input type="checkbox" data-tag="' + escapeHtml(t) + '"' +
      (on.has(t) ? ' checked' : '') + ' /> ' + escapeHtml(t) + '</label>').join('');
  }

  function tblMatches() {
    const on = tblTags();
    let list = library().filter(t => on.has(t.tag));
    const term = $('#tbl-search').value.trim().toLowerCase();
    if (term) list = list.filter(t => t.name.toLowerCase().indexOf(term) !== -1);
    return list.slice().sort((a, b) => a.tag.localeCompare(b.tag) || a.name.localeCompare(b.name));
  }

  function entryRowHtml(t, en, idx) {
    const last = tblLastRoll[t.id];
    const hit = last && last.entryIdx === idx;
    return '<tr class="tbl-entry' + (hit ? ' is-hit' : '') + '">' +
      '<td class="tbl-range">' + escapeHtml(en.range) + '</td>' +
      '<td>' + escapeHtml(en.text) + '</td>' +
    '</tr>';
  }

  function tableRowHtml(t) {
    const open = tblOpenIds.has(t.id);
    const last = tblLastRoll[t.id];
    return '<li class="tbl-row" data-id="' + escapeHtml(t.id) + '">' +
      '<details' + (open ? ' open' : '') + '>' +
        '<summary>' +
          '<span class="tbl-name">' + escapeHtml(t.name) + '</span>' +
          '<span class="badge">' + escapeHtml(t.tag) + '</span>' +
          '<span class="hint tbl-formula">' + escapeHtml(t.formula) + ' &middot; ' + t.entries.length + ' entries</span>' +
        '</summary>' +
        '<div class="tbl-body">' +
          '<div class="tbl-actions">' +
            '<button class="btn btn-primary tbl-roll" data-id="' + escapeHtml(t.id) + '">' +
              '<i class="fa-solid fa-dice-d20"></i> Roll ' + escapeHtml(t.formula) +
            '</button>' +
            (last ? '<span class="tbl-roll-result">Rolled <b>' + escapeHtml(String(last.roll)) + '</b></span>' : '') +
          '</div>' +
          '<table class="tbl-entries"><tbody>' +
            t.entries.map((en, idx) => entryRowHtml(t, en, idx)).join('') +
          '</tbody></table>' +
        '</div>' +
      '</details>' +
    '</li>';
  }

  function renderTables() {
    renderTableTags();
    const list = tblMatches();
    const total = library().length;
    $('#tbl-count').textContent = list.length + ' / ' + total;
    $('#tbl-empty').hidden = total > 0;
    $('#tbl-list').innerHTML = list.map(tableRowHtml).join('');
  }

  function rollTable(id) {
    const t = library().find(x => x.id === id);
    if (!t || !t.entries.length) return;
    const res = OSR.evalFormula(t.formula);
    const roll = res ? res.total : null;
    if (roll == null) return;
    const entryIdx = t.entries.findIndex(en => roll >= en.lo && roll <= en.hi);
    tblLastRoll[id] = { roll: roll, entryIdx: entryIdx };
    tblOpenIds.add(id);
    const entry = entryIdx !== -1 ? t.entries[entryIdx] : null;
    OSR.pushLog(t.name, t.formula, roll, entry ? entry.text : '(no matching entry)');
    renderTables();
  }

  function wireTables() {
    $('#tbl-search').addEventListener('input', renderTables);
    $('#tbl-tags').addEventListener('change', e => {
      const cb = e.target.closest('input[data-tag]');
      if (!cb) return;
      const on = tblTags();
      if (cb.checked) on.add(cb.dataset.tag); else on.delete(cb.dataset.tag);
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
      setTimeout(() => { tblTagFilter = new Set([target]); renderTables(); }, 0);
    });
    $('#tbl-list').addEventListener('click', e => {
      const btn = e.target.closest('.tbl-roll');
      if (btn) rollTable(btn.dataset.id);
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
  }

  Object.assign(OSR, { renderTables, wireTables, resetTableFilters });
})(window.OSR = window.OSR || {});
