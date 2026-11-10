/* js/compendium.js — Compendium entries: CRUD, category/source filters, the
 * default seed, and name resolution (compResolve, shared with the hover
 * popups and "$" -> nothing, "[" autocomplete in js/compendium-popups.js).
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, uid, COMPENDIUM_CATEGORIES, COMPENDIUM_DEFAULT_SOURCE } = OSR;

  // The Compendium is partitioned by game system (Settings → System) — every
  // entry carries a `system` field ('shadowdark' | 'ua3e', backfilled to 'shadowdark' by
  // ensureStateShape for anything that predates this). Only the entries for
  // the currently active system are ever listed, resolved, or searched.
  function currentSystem() {
    return (OSR.state.settings && OSR.state.settings.system) || 'shadowdark';
  }
  function compendiumForSystem() {
    const sys = currentSystem();
    const list = OSR.state.compendium.filter(e => (e.system || 'shadowdark') === sys);
    return sys === 'wwn' ? wwnSpellView(list) : list;
  }
  // WWN: a condensed spell (from a pack) has `altOf` (the ref of the book
  // spell) and `aka` (the book name). Settings → Spell text picks which of
  // the pair shows: 'book' hides the condensed entries; 'condensed' hides
  // the book entries that have a condensed one. Entries without a pair
  // always show.
  function wwnSpellView(list) {
    const mode = (OSR.state.settings && OSR.state.settings.wwnSpellText) || 'book';
    if (mode !== 'condensed') return list.filter(e => !e.altOf);
    const replaced = new Set(list.filter(e => e.altOf).map(e => e.altOf));
    return list.filter(e => !(e.ref && replaced.has(e.ref)));
  }

  // Resolve a name to compendium entries: exact (case-insensitive) matches
  // first; if none, the best fuzzy matches (needs js/fuse.min.js).
  function compByExactName(q) {
    const n = String(q || '').trim().toLowerCase();
    if (!n) return [];
    return compendiumForSystem().filter(e => e.name.trim().toLowerCase() === n || (e.aka && e.aka.trim().toLowerCase() === n));
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
  // Fate stunts and aspects (optional fields): one skill / kind ('' = all),
  // and the DISABLED settings ("Fantasy", "Sci-fi"; an entry with no
  // settings always shows).
  let compSkill = '';
  const compSettingOff = new Set();
  // Cleared by the test seam's reset() — see js/main.js.
  function resetCompendiumFilters() { compCatFilter = null; compSrcOff.clear(); compSkill = ''; compSettingOff.clear(); }
  function compSkills() {
    return Array.from(new Set(compendiumForSystem().map(e => e.skill).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }
  function compSettings() {
    const all = new Set();
    compendiumForSystem().forEach(e => (e.settings || []).forEach(x => all.add(x)));
    return Array.from(all).sort((a, b) => a.localeCompare(b));
  }
  // The Skill / kind and Setting filter rows show only when an entry of the system has the field.
  function renderCompFateFilters() {
    const skills = compSkills(), settings = compSettings();
    if (compSkill && skills.indexOf(compSkill) === -1) compSkill = '';
    $('#comp-skill-row').hidden = !skills.length;
    $('#comp-skill').innerHTML = '<option value="">All</option>' + skills.map(k =>
      '<option value="' + escapeHtml(k) + '"' + (k === compSkill ? ' selected' : '') + '>' + escapeHtml(k) + '</option>').join('');
    $('#comp-setting-row').hidden = !settings.length;
    $('#comp-settings').innerHTML = settings.map(x =>
      '<label class="comp-cat"><input type="checkbox" data-setting="' + escapeHtml(x) + '"' +
      (compSettingOff.has(x) ? '' : ' checked') + ' /> ' + escapeHtml(x) + '</label>').join('');
  }
  // An entry passes the Setting filter when one of its settings is on.
  const settingOn = e => !e.settings || !e.settings.length || e.settings.some(x => !compSettingOff.has(x));
  function compCats() {
    if (!compCatFilter) compCatFilter = new Set(COMPENDIUM_CATEGORIES);
    return compCatFilter;
  }
  function compSources() {
    return Array.from(new Set(compendiumForSystem().map(e => e.source || COMPENDIUM_DEFAULT_SOURCE)))
      .sort((a, b) => a.localeCompare(b));
  }
  // Only the categories that an entry of this System has (no Fate Stunts or
  // Aspects in BRP). The Category row hides when no entry has one.
  function compCatsInUse() {
    const have = new Set(compendiumForSystem().map(e => e.category));
    return COMPENDIUM_CATEGORIES.filter(c => have.has(c));
  }
  function renderCompCats() {
    const on = compCats();
    const used = compCatsInUse();
    $('#comp-cats-row').hidden = !used.length;
    $('#comp-sources-row').hidden = !compSources().length;
    $('#comp-cats').innerHTML = used.map(c =>
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
      on.has(e.category) && !compSrcOff.has(e.source || COMPENDIUM_DEFAULT_SOURCE) &&
      (!compSkill || e.skill === compSkill) && settingOn(e));
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
    renderCompFateFilters();
    updateCompSrcDatalist();
    const list = compListMatches();
    const total = compendiumForSystem().length;
    $('#comp-count').textContent = list.length + ' / ' + total;
    $('#comp-empty').hidden = total > 0;
    $('#comp-list').innerHTML = list.map(e =>
      '<li class="comp-row" data-id="' + e.id + '">' +
        '<div class="comp-row-head">' +
          // A .comp-ref: hovering the name opens the shared popup (js/compendium-popups.js),
          // which renders the entry's body as Markdown.
          '<span class="comp-name comp-ref comp-row-ref" data-name="' + escapeHtml(e.name || '') + '">' +
            escapeHtml(e.name || '(unnamed)') + '</span>' +
          '<span class="badge">' + escapeHtml(e.category) + '</span>' +
          '<span class="badge comp-src-badge">' + escapeHtml(e.source || COMPENDIUM_DEFAULT_SOURCE) + '</span>' +
          (e.skill ? '<span class="badge comp-skill-badge">' + escapeHtml(e.skill) + '</span>' : '') +
          '<span class="row-actions">' +
            '<button class="btn comp-row-edit">Edit</button>' +
            '<button class="btn row-del comp-row-del" title="Delete" aria-label="Delete">&times;</button>' +
          '</span>' +
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
    // Skill / kind and Settings: in Fate, or on an entry that has them.
    const fateFields = currentSystem() === 'fate' || !!(en && (en.skill || (en.settings && en.settings.length)));
    $('#comp-f-skill-field').hidden = !fateFields;
    $('#comp-f-settings-field').hidden = !fateFields;
    $('#comp-skill-list').innerHTML = compSkills().map(k => '<option value="' + escapeHtml(k) + '"></option>').join('');
    $('#comp-f-skill').value = en && en.skill ? en.skill : '';
    $('#comp-f-settings').value = en && en.settings ? en.settings.join(', ') : '';
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
    const skill = $('#comp-f-skill-field').hidden ? null : $('#comp-f-skill').value.trim();
    const settings = $('#comp-f-settings-field').hidden ? null
      : $('#comp-f-settings').value.split(',').map(x => x.trim()).filter(Boolean);
    let en = compEditId ? OSR.state.compendium.find(e => e.id === compEditId) : null;
    const creating = !en;
    if (en) {
      en.name = name; en.category = category; en.source = source; en.body = body; en.updatedAt = Date.now();
    } else {
      en = { id: uid(), name: name, category: category, source: source, body: body, system: currentSystem(), createdAt: Date.now(), updatedAt: Date.now() };
      OSR.state.compendium.push(en);
    }
    if (skill != null) { if (skill) en.skill = skill; else delete en.skill; }
    if (settings != null) { if (settings.length) en.settings = settings; else delete en.settings; }
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
  // OSR.seeds.shadowdark (js/seeds.js): the gear from data/seed-shadowdark.json plus the
  // spells from data/spells.json, and any OSR content pack.

  // Add every default entry not already present (matched by name, case-insensitive),
  // using each entry's own `category` (default "Items") and source "Shadowdark
  // Core". Returns the count added. Runs on first load (version bump) and from
  // Settings → Reseed defaults.
  function seedCompendium() {
    const have = new Set(OSR.state.compendium.map(e => (e.name || '').toLowerCase()));
    let added = 0;
    OSR.seeds.shadowdark.compendium.forEach(e => {
      if (!e || !e.name || have.has(String(e.name).toLowerCase())) return;
      OSR.state.compendium.push(OSR.compCopy('shadowdark', e));
      added++;
    });
    OSR.state.compendiumSeeded = true;
    OSR.state.compendiumSeedVersion = OSR.seeds.shadowdark.codeVersion;
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
    $('#comp-skill').addEventListener('change', e => { compSkill = e.target.value; renderCompendium(); });
    $('#comp-settings').addEventListener('change', e => {
      const cb = e.target.closest('input[data-setting]');
      if (!cb) return;
      if (cb.checked) compSettingOff.delete(cb.dataset.setting); else compSettingOff.add(cb.dataset.setting);
      renderCompendium();
    });
    $('#comp-sources').addEventListener('change', e => {
      const cb = e.target.closest('input[data-src]');
      if (!cb) return;
      if (cb.checked) compSrcOff.delete(cb.dataset.src); else compSrcOff.add(cb.dataset.src);
      renderCompendium();
    });
    // Right-click a Category/Source filter to isolate it: only that one stays
    // ticked, so the list shows just its entries. Some input methods (e.g. a
    // laptop trackpad's two-finger-tap right-click gesture) report a right-
    // click to the OS/browser as an ordinary primary-button click that also
    // triggers 'contextmenu', rather than a real button-2 press — so it also
    // fires this checkbox's own native toggle + 'change' (handled above),
    // racing this isolate logic (bug: right-clicking the one remaining
    // checked filter could leave every filter checked again instead of
    // staying isolated, depending on which of the two race first). Since
    // 'contextmenu' is the one signal every such input method reliably fires,
    // read the target name synchronously (before anything else can run) but
    // defer applying it: mousedown/click/'change'/contextmenu for a single
    // physical gesture all dispatch synchronously in the same task, so a
    // `setTimeout(…, 0)` callback always runs after all of them have already
    // fired — making this isolate the final, unconditional word regardless of
    // which spurious event(s) came with it or in what order.
    // A right-click on the only ticked filter ticks every filter again. "Only
    // ticked" means no other filter is ticked: the target's own box is
    // ignored, because a stray toggle can untick it before 'contextmenu'.
    $('#comp-cats').addEventListener('contextmenu', e => {
      const lbl = e.target.closest('label.comp-cat');
      const cb = lbl && lbl.querySelector('input[data-cat]');
      if (!cb) return;
      e.preventDefault();
      const target = cb.dataset.cat;
      const on = compCats();
      const solo = Array.from(on).every(c => c === target);
      setTimeout(() => {
        compCatFilter = solo ? new Set(COMPENDIUM_CATEGORIES) : new Set([target]);
        renderCompendium();
      }, 0);
    });
    $('#comp-sources').addEventListener('contextmenu', e => {
      const lbl = e.target.closest('label.comp-cat');
      const cb = lbl && lbl.querySelector('input[data-src]');
      if (!cb) return;
      e.preventDefault();
      const target = cb.dataset.src;
      const solo = compSources().every(s => s === target || compSrcOff.has(s));
      setTimeout(() => {
        compSrcOff.clear();
        if (!solo) compSources().forEach(s => { if (s !== target) compSrcOff.add(s); });
        renderCompendium();
      }, 0);
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
    seedCompendium,
    wireCompendiumEntries
  });
})(window.OSR = window.OSR || {});
