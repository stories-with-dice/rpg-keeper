/* js/compendium.js — Compendium entries: CRUD, category/source filters, the
 * default seed, and name resolution (compResolve, shared with the hover
 * popups and "$" -> nothing, "[" autocomplete in js/compendium-popups.js).
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, uid, COMPENDIUM_CATEGORIES, COMPENDIUM_DEFAULT_SOURCE } = OSR;

  // The Compendium is partitioned by game system (Settings → System) — every
  // entry carries a `system` field ('osr' | 'ua3e', backfilled to 'osr' by
  // ensureStateShape for anything that predates this). Only the entries for
  // the currently active system are ever listed, resolved, or searched.
  function currentSystem() {
    return (OSR.state.settings && OSR.state.settings.system) || 'osr';
  }
  function compendiumForSystem() {
    const sys = currentSystem();
    return OSR.state.compendium.filter(e => (e.system || 'osr') === sys);
  }

  // Resolve a name to compendium entries: exact (case-insensitive) matches
  // first; if none, the best fuzzy matches (needs js/fuse.min.js).
  function compByExactName(q) {
    const n = String(q || '').trim().toLowerCase();
    if (!n) return [];
    return compendiumForSystem().filter(e => e.name.trim().toLowerCase() === n);
  }
  // Returns Fuse results: [{ item, score }] (score 0 = perfect, 1 = worst).
  function compFuzzy(q, fullText) {
    const term = String(q || '').trim();
    const pool = compendiumForSystem();
    if (!term || !pool.length || typeof Fuse === 'undefined') return [];
    const fuse = new Fuse(pool, {
      keys: fullText ? ['name', 'body'] : ['name'],
      threshold: 0.45, ignoreLocation: true, includeScore: true
    });
    return fuse.search(term);
  }
  // { fuzzy, items:[entry…], scores:[0..1 | null …] }. Exact name matches win.
  function compResolve(name) {
    const exact = compByExactName(name);
    if (exact.length) return { fuzzy: false, items: exact, scores: exact.map(() => null) };
    const res = compFuzzy(name, false).slice(0, 8);
    return { fuzzy: true, items: res.map(r => r.item), scores: res.map(r => (typeof r.score === 'number' ? r.score : null)) };
  }

  /* ---- Compendium tab ---- */
  let compCatFilter = null;          // Set of enabled categories (lazily = all)
  const compSrcOff = new Set();      // Set of DISABLED sources (new sources default on)
  // Cleared by the test seam's reset() — see js/main.js.
  function resetCompendiumFilters() { compCatFilter = null; compSrcOff.clear(); }
  function compCats() {
    if (!compCatFilter) compCatFilter = new Set(COMPENDIUM_CATEGORIES);
    return compCatFilter;
  }
  function compSources() {
    return Array.from(new Set(compendiumForSystem().map(e => e.source || COMPENDIUM_DEFAULT_SOURCE)))
      .sort((a, b) => a.localeCompare(b));
  }
  function renderCompCats() {
    const on = compCats();
    $('#comp-cats').innerHTML = COMPENDIUM_CATEGORIES.map(c =>
      '<label class="comp-cat"><input type="checkbox" data-cat="' + escapeHtml(c) + '"' +
      (on.has(c) ? ' checked' : '') + ' /> ' + escapeHtml(c) + '</label>').join('');
    const srcs = compSources();
    $('#comp-sources').innerHTML = srcs.length
      ? srcs.map(s =>
        '<label class="comp-cat"><input type="checkbox" data-src="' + escapeHtml(s) + '"' +
        (compSrcOff.has(s) ? '' : ' checked') + ' /> ' + escapeHtml(s) + '</label>').join('')
      : '<span class="hint">—</span>';
  }
  function compExcerpt(body) {
    const line = String(body || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
    return line.replace(/[#>*_`~[\]]/g, '').slice(0, 140);
  }
  function compListMatches() {
    const on = compCats();
    let list = compendiumForSystem().filter(e =>
      on.has(e.category) && !compSrcOff.has(e.source || COMPENDIUM_DEFAULT_SOURCE));
    const term = $('#comp-search').value.trim();
    if (term) {
      const fullText = $('#comp-fulltext').checked;
      if ($('#comp-fuzzy').checked) {
        const ids = new Set(compFuzzy(term, fullText).map(r => r.item.id));
        list = list.filter(e => ids.has(e.id));
      } else {
        const t = term.toLowerCase();
        list = list.filter(e => e.name.toLowerCase().indexOf(t) !== -1 ||
          (fullText && e.body.toLowerCase().indexOf(t) !== -1));
      }
    }
    return list.slice().sort((a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }
  function renderCompendium() {
    renderCompCats();
    updateCompSrcDatalist();
    const list = compListMatches();
    const total = compendiumForSystem().length;
    $('#comp-count').textContent = list.length + ' / ' + total;
    $('#comp-empty').hidden = total > 0;
    $('#comp-list').innerHTML = list.map(e =>
      '<li class="comp-row" data-id="' + e.id + '">' +
        '<div class="comp-row-head">' +
          '<span class="comp-name">' + escapeHtml(e.name || '(unnamed)') + '</span>' +
          '<span class="badge">' + escapeHtml(e.category) + '</span>' +
          '<span class="badge comp-src-badge">' + escapeHtml(e.source || COMPENDIUM_DEFAULT_SOURCE) + '</span>' +
          '<button class="btn comp-row-edit">Edit</button>' +
          '<button class="btn btn-danger comp-row-del" title="Delete">&times;</button>' +
        '</div>' +
        (compExcerpt(e.body) ? '<div class="comp-excerpt">' + escapeHtml(compExcerpt(e.body)) + '</div>' : '') +
      '</li>').join('');
  }

  /* ---- Compendium entry editor (EasyMDE) ---- */
  let compMDE = null;
  let compEditId = null;
  function compMdeInstance() {
    if (compMDE) return compMDE;
    compMDE = OSR.buildMDE($('#comp-f-body'), {
      minHeight: '240px', placeholder: 'Describe this entry in Markdown…',
      onSubmit: () => saveCompEntry()
    });
    return compMDE;
  }
  function compEditorValue() { return compMDE ? compMDE.value() : $('#comp-f-body').value; }
  function updateCompSrcDatalist() {
    const dl = $('#comp-src-list');
    if (!dl) return;
    const opts = compSources().slice();
    if (opts.indexOf(COMPENDIUM_DEFAULT_SOURCE) === -1) opts.unshift(COMPENDIUM_DEFAULT_SOURCE);
    dl.innerHTML = opts.map(s => '<option value="' + escapeHtml(s) + '"></option>').join('');
  }
  function openCompEntry(id, opts) {
    opts = opts || {};
    compEditId = id || null;
    const en = id ? OSR.state.compendium.find(e => e.id === id) : null;
    $('#comp-modal-title').textContent = en ? 'Edit Compendium entry' : 'New Compendium entry';
    $('#comp-f-name').value = en ? en.name : (opts.name || '');
    $('#comp-f-cat').innerHTML = COMPENDIUM_CATEGORIES.map(c =>
      '<option' + ((en ? en.category : 'Other') === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>').join('');
    updateCompSrcDatalist();
    $('#comp-f-src').value = en ? (en.source || COMPENDIUM_DEFAULT_SOURCE) : COMPENDIUM_DEFAULT_SOURCE;
    $('#comp-msg').textContent = '';
    $('#comp-delete').hidden = !en;
    $('#comp-modal').hidden = false;
    const mde = compMdeInstance();
    if (mde) { mde.value(en ? en.body : ''); setTimeout(() => mde.codemirror.refresh(), 0); }
    else { $('#comp-f-body').value = en ? en.body : ''; }
    setTimeout(() => $('#comp-f-name').focus(), 0);
  }
  function closeCompEntry() { $('#comp-modal').hidden = true; compEditId = null; OSR.pendingCompLink = null; }
  function saveCompEntry() {
    const name = $('#comp-f-name').value.trim();
    if (!name) { $('#comp-msg').textContent = 'Name is required.'; return; }
    const category = $('#comp-f-cat').value;
    const source = $('#comp-f-src').value.trim() || COMPENDIUM_DEFAULT_SOURCE;
    const body = compEditorValue();
    let en = compEditId ? OSR.state.compendium.find(e => e.id === compEditId) : null;
    const creating = !en;
    if (en) {
      en.name = name; en.category = category; en.source = source; en.body = body; en.updatedAt = Date.now();
    } else {
      en = { id: uid(), name: name, category: category, source: source, body: body, system: currentSystem(), createdAt: Date.now(), updatedAt: Date.now() };
      OSR.state.compendium.push(en);
    }
    OSR.save();
    renderCompendium();
    OSR.refreshCompPop();
    OSR.pushNote('Compendium', (creating ? 'created' : 'updated') + ' "' + name + '" (' + category + ' · ' + source + ')');
    OSR.applyPendingCompLink(en.name);
    closeCompEntry();
  }
  function deleteCompEntry() {
    if (!compEditId) return;
    const en = OSR.state.compendium.find(e => e.id === compEditId);
    if (!en || !confirm('Delete "' + (en.name || 'this entry') + '" from the Compendium?')) return;
    OSR.state.compendium = OSR.state.compendium.filter(e => e.id !== compEditId);
    OSR.save();
    renderCompendium();
    OSR.refreshCompPop();
    closeCompEntry();
  }

  /* ---- default seed ---- */
  // Lives in its own file, js/compendium-seed.js (loaded before this one). It
  // exposes window.COMPENDIUM_SEED (array of { name, category, body }),
  // window.COMPENDIUM_SEED_VERSION, and window.COMPENDIUM_SEED_READY — a
  // promise that resolves once compendium-seed.js's attempt to fetch + fold
  // in the optional data/spells.json has settled (COMPENDIUM_SEED is the
  // same array either way, so nothing here needs to change to pick up the
  // extra entries).
  const COMPENDIUM_SEED = (typeof window !== 'undefined' && Array.isArray(window.COMPENDIUM_SEED))
    ? window.COMPENDIUM_SEED : [];
  const COMPENDIUM_SEED_VERSION = (typeof window !== 'undefined' && Number(window.COMPENDIUM_SEED_VERSION)) || 1;
  const COMPENDIUM_SEED_READY = (typeof window !== 'undefined' && window.COMPENDIUM_SEED_READY &&
    typeof window.COMPENDIUM_SEED_READY.then === 'function') ? window.COMPENDIUM_SEED_READY : Promise.resolve();

  // Add every default entry not already present (matched by name, case-insensitive),
  // using each entry's own `category` (default "Items") and source "Shadowdark
  // Core". Returns the count added. Runs on first load (version bump) and from
  // Settings → Reseed defaults.
  function seedCompendium() {
    const have = new Set(OSR.state.compendium.map(e => (e.name || '').toLowerCase()));
    let added = 0;
    COMPENDIUM_SEED.forEach(e => {
      if (!e || !e.name || have.has(String(e.name).toLowerCase())) return;
      OSR.state.compendium.push({
        id: uid(), name: e.name,
        category: COMPENDIUM_CATEGORIES.indexOf(e.category) === -1 ? 'Items' : e.category,
        source: 'Shadowdark Core', system: 'osr',
        body: e.body || '', createdAt: Date.now(), updatedAt: Date.now()
      });
      added++;
    });
    OSR.state.compendiumSeeded = true;
    OSR.state.compendiumSeedVersion = COMPENDIUM_SEED_VERSION;
    OSR.save();
    renderCompendium();
    return added;
  }

  function wireCompendiumEntries() {
    $('#comp-new').addEventListener('click', () => openCompEntry(null, {}));
    $('#comp-search').addEventListener('input', renderCompendium);
    $('#comp-fulltext').addEventListener('change', renderCompendium);
    $('#comp-fuzzy').addEventListener('change', renderCompendium);
    $('#comp-cats').addEventListener('change', e => {
      const cb = e.target.closest('input[data-cat]');
      if (!cb) return;
      const on = compCats();
      if (cb.checked) on.add(cb.dataset.cat); else on.delete(cb.dataset.cat);
      renderCompendium();
    });
    $('#comp-sources').addEventListener('change', e => {
      const cb = e.target.closest('input[data-src]');
      if (!cb) return;
      if (cb.checked) compSrcOff.delete(cb.dataset.src); else compSrcOff.add(cb.dataset.src);
      renderCompendium();
    });
    // Right-click a Category/Source filter to isolate it: only that one stays
    // ticked, so the list shows just its entries.
    $('#comp-cats').addEventListener('contextmenu', e => {
      const lbl = e.target.closest('label.comp-cat');
      const cb = lbl && lbl.querySelector('input[data-cat]');
      if (!cb) return;
      e.preventDefault();
      compCatFilter = new Set([cb.dataset.cat]);
      renderCompendium();
    });
    $('#comp-sources').addEventListener('contextmenu', e => {
      const lbl = e.target.closest('label.comp-cat');
      const cb = lbl && lbl.querySelector('input[data-src]');
      if (!cb) return;
      e.preventDefault();
      const target = cb.dataset.src;
      compSrcOff.clear();
      compSources().forEach(s => { if (s !== target) compSrcOff.add(s); });
      renderCompendium();
    });
    $('#comp-list').addEventListener('click', e => {
      const row = e.target.closest('.comp-row');
      if (!row) return;
      if (e.target.closest('.comp-row-del')) {
        const en = OSR.state.compendium.find(x => x.id === row.dataset.id);
        if (en && confirm('Delete "' + (en.name || 'this entry') + '"?')) {
          OSR.state.compendium = OSR.state.compendium.filter(x => x.id !== en.id);
          OSR.save(); renderCompendium(); OSR.refreshCompPop();
        }
        return;
      }
      openCompEntry(row.dataset.id);
    });

    $('#comp-close').addEventListener('click', closeCompEntry);
    $('#comp-cancel').addEventListener('click', closeCompEntry);
    $('#comp-save').addEventListener('click', saveCompEntry);
    $('#comp-delete').addEventListener('click', deleteCompEntry);
    $('#comp-modal').addEventListener('click', e => { if (e.target === $('#comp-modal')) closeCompEntry(); });
    // Enter saves (Shift+Enter is a newline in the body). When EasyMDE is
    // loaded, its CodeMirror instance has the same onSubmit wired directly
    // (see compMdeInstance) — skip it here to avoid saving twice.
    $('#comp-modal').addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest('.CodeMirror')) return;
      e.preventDefault();
      saveCompEntry();
    });
  }

  Object.assign(OSR, {
    currentSystem, compendiumForSystem,
    compByExactName, compFuzzy, compResolve, compExcerpt, compListMatches,
    resetCompendiumFilters, renderCompendium,
    openCompEntry, closeCompEntry, saveCompEntry, deleteCompEntry,
    COMPENDIUM_SEED, COMPENDIUM_SEED_VERSION, COMPENDIUM_SEED_READY, seedCompendium,
    wireCompendiumEntries
  });
})(window.OSR = window.OSR || {});
