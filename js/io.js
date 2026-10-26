/* js/io.js — the "paste sheet as text" modal, and whole-state export/import
 * (.json, or a .zip with the map images: see exportData / importZip). */
(function (OSR) {
  'use strict';
  const $ = OSR.$;

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

  function exportJson() {
    download(new Blob([JSON.stringify(OSR.state, null, 2)], { type: 'application/json' }), 'osr-manager-' + stamp() + '.json');
  }

  // Resolves to the zip's bytes (tests read them back).
  async function exportZip() {
    const files = { 'campaign.json': [fflate.strToU8(JSON.stringify(OSR.state, null, 2)), { level: 6 }] };
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
  const validSystem = (s, fallback) => (OSR.SYSTEMS.indexOf(s) === -1 ? fallback : s);
  function replaceSeeded(list, item, system) {
    if (!item.seedRef) return false;
    const i = list.findIndex(x => (x.system || 'osr') === system && x.seedRef === item.seedRef);
    if (i === -1) return false;
    item.id = list[i].id;
    item.system = system;
    list[i] = item;
    return true;
  }
  function mergeCompendium(list, fallbackSystem, fromPack) {
    const state = OSR.state;
    const added = [];
    list.forEach(en => {
      if (!en) return;
      const system = validSystem(en.system, fallbackSystem);
      if (!fromPack && replaceSeeded(state.compendium, Object.assign({}, en), system)) return;
      const key = String(en.name || '').toLowerCase() + '\0' + en.category;
      if (state.compendium.some(x => (x.system || 'osr') === system &&
          ((en.ref && x.ref === en.ref) || (x.name.toLowerCase() + '\0' + x.category) === key))) return;
      const item = { id: OSR.uid(), name: String(en.name || ''), category: en.category,
        source: en.source || OSR.COMPENDIUM_DEFAULT_SOURCE, system: system,
        body: String(en.body || ''), createdAt: en.createdAt || Date.now(), updatedAt: Date.now() };
      if (en.ref) item.ref = String(en.ref);
      if (fromPack) { item.seedRef = OSR.seedRefOf(system, 'c', en); item.seedHash = OSR.contentHash(item); }
      else if (en.seedRef) { item.seedRef = en.seedRef; if (en.seedHash) item.seedHash = en.seedHash; }
      state.compendium.push(item);
      added.push(item.id);
    });
    return added;
  }
  function mergeMonsters(list, fallbackSystem, fromPack) {
    const state = OSR.state;
    const added = [];
    list.forEach(m => {
      if (!m) return;
      const system = validSystem(m.system, fallbackSystem);
      if (!fromPack && replaceSeeded(state.monsters, m, system)) return;
      if (m.ref && state.monsters.some(x => x.ref === m.ref && (x.system || 'osr') === system)) return;
      if (fromPack) { const copy = OSR.monsterCopy(system, m); Object.keys(copy).forEach(k => { m[k] = copy[k]; }); }
      m.id = OSR.uid();
      m.system = system;
      state.monsters.push(m);
      added.push(m.id);
    });
    return added;
  }

  // A content pack — { pack: { name, system }, compendium: [...], monsters: [...] },
  // for example the Unknown Armies catalog that the UA3 data tools write — is
  // only ever added to what is there. It never replaces the whole state, so
  // the Replace/Merge question of a full export is not asked.
  async function importPack(data) {
    const pack = data.pack || {};
    const system = validSystem(pack.system, OSR.currentSystem());
    const comp = Array.isArray(data.compendium) ? data.compendium : [];
    const mons = Array.isArray(data.monsters) ? data.monsters : [];
    const name = String(pack.name || 'content pack');
    if (!confirm('Add "' + name + '" to ' + (OSR.SYSTEM_LABELS[system] || system) + '?\n\n' +
        comp.length + ' Compendium entries and ' + mons.length + ' Bestiary monsters. ' +
        'Entries you already have are skipped. Nothing is replaced.')) return;
    const addedC = mergeCompendium(comp, system, true);
    const addedM = mergeMonsters(mons.map(m => JSON.parse(JSON.stringify(m))), system, true);
    OSR.ensureStateShape();
    if (!(await OSR.saveNow())) {
      // The browser storage refused the write (full or blocked): keep the
      // app as it was instead of holding data that a reload would lose.
      const c = new Set(addedC), m = new Set(addedM);
      OSR.state.compendium = OSR.state.compendium.filter(e => !c.has(e.id));
      OSR.state.monsters = OSR.state.monsters.filter(d => !m.has(d.id));
      OSR.save();
      alert('Import failed: the browser storage is full, so "' + name + '" was not added.');
      return;
    }
    // The pack also goes into the system's seed, so every other campaign
    // (and every device, through Dropbox) is offered it (js/seeds.js).
    try { await OSR.addToSeed(system, comp, mons); } catch (e) { console.warn('seed write failed', e); }
    OSR.pushNote('Import', 'added ' + addedC.length + ' Compendium entries and ' + addedM.length +
      ' monsters from "' + name + '"');
    if (OSR.currentSystem() !== system) OSR.setSystem(system);
    else { OSR.renderCompendium(); OSR.renderMonsterBrowser(); OSR.renderSettings(); }
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
    OSR.renderMaps();
    OSR.renderSettings();
    return ok;
  }

  function wireIO() {
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

  Object.assign(OSR, { openPasteModal, closePasteModal, pasteFromClipboard, exportData, exportJson, exportZip, closeExportModal, mergeCompendium, mergeMonsters, importPack, importData, replaceState, wireIO });
})(window.OSR = window.OSR || {});
