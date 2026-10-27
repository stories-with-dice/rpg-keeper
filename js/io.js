/* js/io.js — the "paste sheet as text" modal, and whole-state export/import
 * (.json, or a .zip with the map images: see exportData / importZip). */
(function (OSR) {
  'use strict';
  const { $, $$, escapeHtml } = OSR;

  /* ---- Clipboard / paste modal ---- */
  function openPasteModal(text) {
    $('#paste-area').value = text || '';
    $('#paste-modal').hidden = false;
    $('#paste-area').focus();
  }
  function closePasteModal() { $('#paste-modal').hidden = true; }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) OSR.createCharacter(text);
      else openPasteModal('');
    } catch (e) {
      openPasteModal('');
    }
  }

  /* ---- Export / import ---- */
  // Export: a .json of OSR.state, or, when the campaign has map images and
  // "Include map images" is on, a .zip (vendor/fflate) with that JSON as
  // campaign.json and each image as maps/<blobId>.<ext>.
  const IMAGE_EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };
  const IMAGE_TYPE = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

  function sceneImages() {
    const seen = new Map();
    (OSR.state.scenes || []).forEach(sc => { if (sc.imageBlobId && !seen.has(sc.imageBlobId)) seen.set(sc.imageBlobId, sc.imageType); });
    return seen;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function stamp() {
    const d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  function exportData() {
    if (sceneImages().size) { $('#export-modal').hidden = false; return; }
    exportJson();
  }
  function closeExportModal() { const m = $('#export-modal'); if (m) m.hidden = true; }

  // The campaign, plus the shared random tables (js/tables.js): an Import of
  // the file adds the tables that the table library does not have.
  function exportText() {
    return JSON.stringify(Object.assign({}, OSR.state, { tables: OSR.tableLib.tables }), null, 2);
  }

  function exportJson() {
    download(new Blob([exportText()], { type: 'application/json' }), 'osr-manager-' + stamp() + '.json');
  }

  // Resolves to the zip's bytes (tests read them back).
  async function exportZip() {
    const files = { 'campaign.json': [fflate.strToU8(exportText()), { level: 6 }] };
    for (const [id, type] of sceneImages()) {
      const rec = await OSR.store.getBlob(id);
      // Images are compressed already: stored as they are.
      if (rec) files['maps/' + id + '.' + (IMAGE_EXT[rec.type || type] || 'bin')] = [new Uint8Array(rec.bytes), { level: 0 }];
    }
    const zip = fflate.zipSync(files);
    download(new Blob([zip], { type: 'application/zip' }), 'osr-manager-' + stamp() + '.zip');
    return zip;
  }

  async function submitExport() {
    const withImages = $('#export-images').checked;
    closeExportModal();
    if (withImages) await exportZip(); else exportJson();
  }

  // Merge helpers, shared by a plain merge and a content pack. An entry or a
  // monster with a `ref` (a stable id from the pack that made it) is skipped
  // when one with the same ref is already there, so importing a pack twice
  // adds nothing; a Compendium entry without one is matched by name and
  // category. Both stay inside their own system (see AGENTS.md "Game system").
  // An item with a `seedRef` (a seeded item, from an export) replaces the
  // campaign's item with the same seedRef instead (js/seeds.js). With
  // `fromPack`, every added item becomes a seed copy (seedRef + seedHash).
  // With opts.replace (the import picker's "Replace"), a match is replaced in
  // place (same id) instead of skipped; its id goes into opts.replaced.
  const validSystem = (s, fallback) => (OSR.SYSTEMS.indexOf(s) === -1 ? fallback : s);
  const lc = s => String(s || '').trim().toLowerCase();
  const inSystem = (x, system) => (x.system || 'osr') === system;
  function replaceSeeded(list, item, system) {
    if (!item.seedRef) return false;
    const i = list.findIndex(x => (x.system || 'osr') === system && x.seedRef === item.seedRef);
    if (i === -1) return false;
    item.id = list[i].id;
    item.system = system;
    list[i] = item;
    return true;
  }
  // The index of the campaign's Compendium entry or monster that an imported
  // one matches (same ref, else same name — and category for an entry), or -1.
  function compIndex(en, system) {
    return OSR.state.compendium.findIndex(x => inSystem(x, system) &&
      ((en.ref && x.ref === en.ref) || (lc(x.name) === lc(en.name) && x.category === en.category)));
  }
  function monsterIndex(m, system) {
    return OSR.state.monsters.findIndex(x => inSystem(x, system) && ((m.ref && x.ref === m.ref) || lc(x.name) === lc(m.name)));
  }
  function mergeCompendium(list, fallbackSystem, fromPack, opts) {
    const o = opts || {};
    const state = OSR.state;
    const added = [];
    list.forEach(en => {
      if (!en) return;
      const system = validSystem(en.system, fallbackSystem);
      if (!fromPack && replaceSeeded(state.compendium, Object.assign({}, en), system)) return;
      const at = compIndex(en, system);
      if (at !== -1 && !o.replace) return;
      const item = { id: at === -1 ? OSR.uid() : state.compendium[at].id, name: String(en.name || ''), category: en.category,
        source: en.source || OSR.COMPENDIUM_DEFAULT_SOURCE, system: system,
        body: String(en.body || ''), createdAt: en.createdAt || Date.now(), updatedAt: Date.now() };
      if (en.ref) item.ref = String(en.ref);
      if (fromPack) { item.seedRef = OSR.seedRefOf(system, 'c', en); item.seedHash = OSR.contentHash(item); }
      else if (en.seedRef) { item.seedRef = en.seedRef; if (en.seedHash) item.seedHash = en.seedHash; }
      if (at === -1) { state.compendium.push(item); added.push(item.id); }
      else { state.compendium[at] = item; if (o.replaced) o.replaced.push(item.id); }
    });
    return added;
  }
  // Without opts.replace, only a monster with the same ref is skipped (a
  // monster's name is not unique: an export can carry two "Goblin"s).
  function mergeMonsters(list, fallbackSystem, fromPack, opts) {
    const o = opts || {};
    const state = OSR.state;
    const added = [];
    list.forEach(m => {
      if (!m) return;
      const system = validSystem(m.system, fallbackSystem);
      if (!fromPack && replaceSeeded(state.monsters, m, system)) return;
      const at = o.replace ? monsterIndex(m, system) : -1;
      if (at === -1 && m.ref && state.monsters.some(x => x.ref === m.ref && inSystem(x, system))) return;
      if (fromPack) { const copy = OSR.monsterCopy(system, m); Object.keys(copy).forEach(k => { m[k] = copy[k]; }); }
      m.system = system;
      if (at === -1) { m.id = OSR.uid(); state.monsters.push(m); added.push(m.id); }
      else { m.id = state.monsters[at].id; state.monsters[at] = m; if (o.replaced) o.replaced.push(m.id); }
    });
    return added;
  }

  /* ---- The import picker (#import-modal) ---- */

  // A content pack's items in groups (Compendium, Bestiary, Tables) and
  // categories, each with a checkbox. `picker` while the modal is open:
  //   items   [{ group, cat, name, exists, on, src }]; `exists` = the campaign
  //           (or the table library) has one with that name; `on` = ticked
  //   cats    [{ group, name, items: [index] }]
  //   replace the "Replace" option; while off, an existing item is skipped
  //   resolve the promise of choosePackItems()
  let picker = null;
  const IMPORT_GROUPS = [['compendium', 'Compendium'], ['monsters', 'Bestiary'], ['tables', 'Tables']];

  function pickerModel(system, origin, comp, mons, tbls) {
    const items = [];
    comp.forEach(en => items.push({ group: 'compendium', cat: en.category || 'Other', name: String(en.name || ''),
      exists: compIndex(en, system) !== -1, src: en }));
    mons.forEach(m => items.push({ group: 'monsters', cat: 'Monsters', name: String(m.name || ''),
      exists: monsterIndex(m, system) !== -1, src: m }));
    tbls.forEach(t => {
      if (!t || typeof t.source !== 'string') return;
      const c = OSR.cleanTable(t, { system, origin });
      items.push({ group: 'tables', cat: c.output, name: c.name, exists: !!OSR.tableByName(c.name), src: t });
    });
    items.forEach(it => { it.on = true; });
    const cats = [];
    IMPORT_GROUPS.forEach(([g]) => {
      const byName = new Map();
      items.forEach((it, i) => {
        if (it.group !== g) return;
        if (!byName.has(it.cat)) byName.set(it.cat, { group: g, name: it.cat, items: [] });
        byName.get(it.cat).items.push(i);
      });
      Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)).forEach(c => cats.push(c));
    });
    return { items, cats, replace: false };
  }

  const willImport = it => it.on && (!it.exists || picker.replace);
  const canPick = it => !it.exists || picker.replace;

  function renderPicker() {
    const caret = (key, open) => '<button class="imp-caret" data-toggle="' + key + '" aria-expanded="' + open + '">' + (open ? '\u25BE' : '\u25B8') + '</button>';
    $('#import-list').innerHTML = IMPORT_GROUPS.map(([g, label]) => {
      const cats = picker.cats.map((c, ci) => [c, ci]).filter(([c]) => c.group === g);
      if (!cats.length) return '';
      return '<div class="imp-group">' +
        '<div class="imp-head">' + caret('g', true) + '<label><input type="checkbox" data-group="' + g + '" /> <b>' + label + '</b></label>' +
          '<span class="hint imp-count" data-count-group="' + g + '"></span></div>' +
        '<div class="imp-body">' + cats.map(([c, ci]) =>
          '<div class="imp-cat">' +
            '<div class="imp-head">' + caret('c', false) + '<label><input type="checkbox" data-cat="' + ci + '" /> ' + escapeHtml(c.name) + '</label>' +
              '<span class="hint imp-count" data-count-cat="' + ci + '"></span></div>' +
            '<ul class="imp-items" hidden>' + c.items.map(i => {
              const it = picker.items[i];
              return '<li><label><input type="checkbox" data-item="' + i + '" /> ' + escapeHtml(it.name) + '</label>' +
                (it.exists ? ' <span class="badge imp-have" title="You have one with this name">you have it</span>' : '') + '</li>';
            }).join('') + '</ul>' +
          '</div>').join('') + '</div>' +
      '</div>';
    }).join('');
    syncPicker();
  }

  // Sets every checkbox, count, and the summary from `picker`, without
  // rebuilding the list (so open categories stay open).
  function syncPicker() {
    const box = (list, cb, count) => {
      const on = list.filter(it => canPick(it) && it.on).length, can = list.filter(canPick).length;
      cb.checked = can > 0 && on === can;
      cb.indeterminate = on > 0 && on < can;
      cb.disabled = can === 0;
      count.textContent = list.filter(willImport).length + ' / ' + list.length;
    };
    $$('#import-list input[data-item]').forEach(cb => {
      const it = picker.items[+cb.dataset.item];
      cb.checked = willImport(it);
      cb.disabled = !canPick(it);
    });
    $$('#import-list input[data-cat]').forEach(cb => {
      const ci = cb.dataset.cat;
      box(picker.cats[+ci].items.map(i => picker.items[i]), cb, $('#import-list [data-count-cat="' + ci + '"]'));
    });
    $$('#import-list input[data-group]').forEach(cb => {
      const g = cb.dataset.group;
      box(picker.items.filter(it => it.group === g), cb, $('#import-list [data-count-group="' + g + '"]'));
    });
    const add = picker.items.filter(it => willImport(it) && !it.exists).length;
    const rep = picker.items.filter(it => willImport(it) && it.exists).length;
    const skip = picker.items.filter(it => it.exists && !picker.replace).length;
    $('#import-summary').textContent = 'Add ' + add + (picker.replace ? ', replace ' + rep : '') +
      (skip ? ' · ' + skip + ' you have are skipped' : '');
    $('#import-go').disabled = add + rep === 0;
  }

  // Opens the picker. Resolves to { replace, compendium, monsters, tables }
  // (the source objects to import) or null (Cancel, ×, Escape).
  function choosePackItems(name, system, comp, mons, tbls) {
    if (picker) closeImportModal();
    return new Promise(resolve => {
      picker = Object.assign(pickerModel(system, name, comp, mons, tbls), { resolve });
      $('#import-title').textContent = 'Import "' + name + '"';
      $('#import-intro').textContent = 'Into ' + (OSR.SYSTEM_LABELS[system] || system) +
        ' (tables go to every campaign). Untick what you do not want. Items you already have (same name) are skipped, unless you tick Replace.';
      $('#import-replace').checked = false;
      renderPicker();
      $('#import-modal').hidden = false;
    });
  }

  function finishPicker(go) {
    const p = picker;
    if (!p) return;
    picker = null;
    $('#import-modal').hidden = true;
    $('#import-list').innerHTML = '';
    if (!go) { p.resolve(null); return; }
    const out = { replace: p.replace, compendium: [], monsters: [], tables: [] };
    p.items.forEach(it => { if (it.on && (!it.exists || p.replace)) out[it.group].push(it.src); });
    p.resolve(out);
  }
  function closeImportModal() { finishPicker(false); }

  function wireImportModal() {
    const list = $('#import-list');
    list.addEventListener('change', e => {
      const cb = e.target;
      if (!picker || !cb.matches('input[type="checkbox"]')) return;
      let items = [];
      if (cb.dataset.item != null) items = [picker.items[+cb.dataset.item]];
      else if (cb.dataset.cat != null) items = picker.cats[+cb.dataset.cat].items.map(i => picker.items[i]);
      else if (cb.dataset.group != null) items = picker.items.filter(it => it.group === cb.dataset.group);
      items.filter(canPick).forEach(it => { it.on = cb.checked; });
      syncPicker();
    });
    list.addEventListener('click', e => {
      const btn = e.target.closest('.imp-caret');
      if (!btn) return;
      const body = btn.parentElement.nextElementSibling;
      body.hidden = !body.hidden;
      btn.textContent = body.hidden ? '\u25B8' : '\u25BE';
      btn.setAttribute('aria-expanded', String(!body.hidden));
    });
    $('#import-replace').addEventListener('change', e => { if (picker) { picker.replace = e.target.checked; syncPicker(); } });
    $('#import-all').addEventListener('click', () => { if (picker) { picker.items.forEach(it => { it.on = true; }); syncPicker(); } });
    $('#import-none').addEventListener('click', () => { if (picker) { picker.items.forEach(it => { it.on = false; }); syncPicker(); } });
    $('#import-go').addEventListener('click', () => finishPicker(true));
    $('#import-cancel').addEventListener('click', closeImportModal);
    $('#import-close').addEventListener('click', closeImportModal);
  }

  // A content pack — { pack: { name, system }, compendium: [...], monsters: [...], tables: [...] },
  // for example the Unknown Armies catalog that the UA3 data tools write — is
  // only ever merged into what is there, so the Replace/Merge question of a
  // full export is not asked. The import picker chooses the items, and
  // whether an item you have (same name) is replaced or skipped.
  async function importPack(data) {
    const pack = data.pack || {};
    const system = validSystem(pack.system, OSR.currentSystem());
    const mons = (Array.isArray(data.monsters) ? data.monsters : []).filter(Boolean);
    mons.forEach(OSR.fixAbilities);
    const name = String(pack.name || 'content pack');
    const pick = await choosePackItems(name, system, (Array.isArray(data.compendium) ? data.compendium : []).filter(Boolean),
      mons, Array.isArray(data.tables) ? data.tables : []);
    if (!pick) return;
    const comp = pick.compendium;
    const picked = pick.monsters;
    // A copy of what the import may change, to put back if the write fails.
    const before = { compendium: OSR.state.compendium.slice(), monsters: OSR.state.monsters.slice(),
      tables: OSR.tableLib.tables.map(t => Object.assign({}, t)) };
    const replaced = [];
    const opts = { replace: pick.replace, replaced };
    const addedC = mergeCompendium(comp, system, true, opts);
    const addedM = mergeMonsters(picked.map(m => JSON.parse(JSON.stringify(m))), system, true, opts);
    // Tables go to the table library that every campaign shares (js/tables.js).
    const addedT = OSR.addTables(pick.tables, { system, origin: name, replace: pick.replace, replaced });
    OSR.ensureStateShape();
    const tablesChanged = addedT.length || pick.tables.length;
    if (!(await OSR.saveNow()) || (tablesChanged && !(await OSR.saveTables()))) {
      // The browser storage refused the write (full or blocked): keep the
      // app as it was instead of holding data that a reload would lose.
      OSR.state.compendium = before.compendium;
      OSR.state.monsters = before.monsters;
      OSR.tableLib.tables = before.tables;
      OSR.save();
      OSR.saveTables();
      alert('Import failed: the browser storage is full, so "' + name + '" was not added.');
      return;
    }
    // The pack also goes into the system's seed, so every other campaign
    // (and every device, through Dropbox) is offered it (js/seeds.js).
    try { await OSR.addToSeed(system, comp, picked); } catch (e) { console.warn('seed write failed', e); }
    OSR.pushNote('Import', 'added ' + addedC.length + ' Compendium entries, ' + addedM.length +
      ' monsters, and ' + addedT.length + ' tables' + (replaced.length ? ', and replaced ' + replaced.length + ' items' : '') +
      ' from "' + name + '"');
    if (OSR.currentSystem() !== system) OSR.setSystem(system);
    else { OSR.renderCompendium(); OSR.renderMonsterBrowser(); OSR.renderTables(); OSR.renderSettings(); }
  }

  // Resolves once the file is read and handled (tests await it; the file
  // input ignores it). FileReader finishes after an unknown delay.
  function importData(file) {
    if (/\.zip$/i.test(file.name || '') || /zip/.test(file.type || '')) return importZip(file);
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => { handleImport(reader.result).catch(e => console.warn('import failed', e)).finally(resolve); };
      reader.onerror = () => { alert('Import failed: the file could not be read.'); resolve(); };
      reader.readAsText(file);
    });
  }

  // A .zip from Export: its map images go into IndexedDB first (under their
  // own blob ids), then campaign.json is imported like a .json file.
  async function importZip(file) {
    let files;
    try { files = fflate.unzipSync(new Uint8Array(await file.arrayBuffer())); }
    catch (e) { alert('Import failed: the file is not a valid .zip.'); return; }
    if (!files['campaign.json']) { alert('Import failed: the .zip has no campaign.json.'); return; }
    for (const name of Object.keys(files)) {
      const m = /^maps\/([A-Za-z0-9_-]+)\.([a-z0-9]+)$/.exec(name);
      if (!m) continue;
      const u8 = files[name];
      try {
        await OSR.store.putBlob(m[1], { bytes: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), type: IMAGE_TYPE[m[2]] || 'application/octet-stream' });
      } catch (e) { alert(STORAGE_FULL_MSG); return; }
    }
    await handleImport(fflate.strFromU8(files['campaign.json']));
  }

  async function handleImport(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { alert('Import failed: not valid JSON.'); return; }
    if (data && data.pack && typeof data.pack === 'object') { await importPack(data); return; }
    if (!data || !Array.isArray(data.characters)) { alert('Import failed: no "characters" array.'); return; }
    const replace = confirm('OK = Replace ALL current data with the imported file.\nCancel = Merge imported characters + monsters into current data.');
    if (replace) {
      if (!(await replaceState(data))) alert(STORAGE_FULL_MSG);
    } else {
      const state = OSR.state;
      data.characters.forEach(c => { c.id = OSR.uid(); state.characters.push(c); });
      if (Array.isArray(data.consumables)) data.consumables.forEach(c => {
        if (!state.consumables.some(x => x.name === c.name)) {
          state.consumables.push({ id: OSR.uid(), name: String(c.name || ''), value: Number(c.value) || 0, max: Number(c.max) || 0 });
        }
      });
      if (Array.isArray(data.monsters)) mergeMonsters(data.monsters, 'osr');
      if (Array.isArray(data.compendium)) mergeCompendium(data.compendium, 'osr');
      if (OSR.addTables(data.tables).length) OSR.saveTables();
      if (Array.isArray(data.scenes)) data.scenes.forEach(sc => {
        if (!sc) return;
        sc.id = OSR.uid();
        sc.system = validSystem(sc.system, 'osr');
        state.scenes.push(OSR.ensureSceneShape(sc));
      });
      if (typeof data.notes === 'string' && data.notes.trim()) {
        state.notes = (state.notes ? state.notes + '\n\n' : '') + data.notes.trim();
      }
      if (Array.isArray(data.log)) state.log = state.log.concat(data.log).slice(-OSR.MAX_LOG);
      if (!(await finishLoad())) alert(STORAGE_FULL_MSG);
    }
  }

  const STORAGE_FULL_MSG = 'The browser storage is full: the imported data is not saved and is lost when you reload. Export it, or delete data you do not need.';

  // Replaces the whole campaign with `data` (a full export): Import → Replace
  // all, and a pull from Dropbox (js/dropbox.js). OSR.state changes at once;
  // the returned promise resolves to whether the write reached the storage.
  function replaceState(data) {
    OSR.state = Object.assign(JSON.parse(JSON.stringify(OSR.STATE_DEFAULTS)), data);
    return finishLoad();
  }

  // After OSR.state was replaced or merged into: migrate, save, re-render.
  // Resolves to OSR.saveNow()'s result.
  function finishLoad() {
    OSR.ensureStateShape();
    if (OSR.resetHistories) OSR.resetHistories(); // the scenes are new objects: their undo steps no longer apply
    if (!OSR.activeChar() && OSR.state.characters.length) OSR.state.activeId = OSR.state.characters[0].id;
    OSR.mode = 'view';
    const ok = OSR.saveNow();
    OSR.applyTheme();
    OSR.refreshCharUI();
    OSR.renderNotes();
    OSR.renderLog();
    OSR.renderCombat();
    OSR.renderMonsterBrowser();
    OSR.renderCompendium();
    OSR.renderTables();
    OSR.renderMaps();
    OSR.renderSettings();
    return ok;
  }

  function wireIO() {
    wireImportModal();
    $('#btn-paste-create').addEventListener('click', () => {
      const t = $('#paste-area').value;
      if (t && t.trim()) { OSR.createCharacter(t); closePasteModal(); }
      else closePasteModal();
    });
    $('#btn-paste-close').addEventListener('click', closePasteModal);
    $('#paste-modal').addEventListener('click', e => { if (e.target === $('#paste-modal')) closePasteModal(); });

    $('#btn-export').addEventListener('click', exportData);
    $('#export-go').addEventListener('click', submitExport);
    $('#export-cancel').addEventListener('click', closeExportModal);
    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#file-import').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) importData(f);
      e.target.value = '';
    });
  }

  Object.assign(OSR, { openPasteModal, closePasteModal, pasteFromClipboard, exportData, exportJson, exportZip, closeExportModal, mergeCompendium, mergeMonsters, importPack, closeImportModal, importData, replaceState, wireIO });
})(window.OSR = window.OSR || {});
