/* js/io.js — the "paste sheet as text" modal, and whole-state export/import. */
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
  function exportData() {
    const blob = new Blob([JSON.stringify(OSR.state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'osr-manager-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Merge helpers, shared by a plain merge and a content pack. An entry or a
  // monster with a `ref` (a stable id from the pack that made it) is skipped
  // when one with the same ref is already there, so importing a pack twice
  // adds nothing; a Compendium entry without one is matched by name and
  // category. Both stay inside their own system (see AGENTS.md "Game system").
  const validSystem = (s, fallback) => (OSR.SYSTEMS.indexOf(s) === -1 ? fallback : s);
  function mergeCompendium(list, fallbackSystem) {
    const state = OSR.state;
    const added = [];
    list.forEach(en => {
      if (!en) return;
      const system = validSystem(en.system, fallbackSystem);
      const key = String(en.name || '').toLowerCase() + '\0' + en.category;
      if (state.compendium.some(x => (x.system || 'osr') === system &&
          ((en.ref && x.ref === en.ref) || (x.name.toLowerCase() + '\0' + x.category) === key))) return;
      const item = { id: OSR.uid(), name: String(en.name || ''), category: en.category,
        source: en.source || OSR.COMPENDIUM_DEFAULT_SOURCE, system: system,
        body: String(en.body || ''), createdAt: en.createdAt || Date.now(), updatedAt: Date.now() };
      if (en.ref) item.ref = String(en.ref);
      state.compendium.push(item);
      added.push(item.id);
    });
    return added;
  }
  function mergeMonsters(list, fallbackSystem) {
    const state = OSR.state;
    const added = [];
    list.forEach(m => {
      if (!m) return;
      const system = validSystem(m.system, fallbackSystem);
      if (m.ref && state.monsters.some(x => x.ref === m.ref && (x.system || 'osr') === system)) return;
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
  function importPack(data) {
    const pack = data.pack || {};
    const system = validSystem(pack.system, OSR.currentSystem());
    const comp = Array.isArray(data.compendium) ? data.compendium : [];
    const mons = Array.isArray(data.monsters) ? data.monsters : [];
    const name = String(pack.name || 'content pack');
    if (!confirm('Add "' + name + '" to ' + (OSR.SYSTEM_LABELS[system] || system) + '?\n\n' +
        comp.length + ' Compendium entries and ' + mons.length + ' Bestiary monsters. ' +
        'Entries you already have are skipped. Nothing is replaced.')) return;
    const addedC = mergeCompendium(comp, system);
    const addedM = mergeMonsters(mons, system);
    OSR.ensureStateShape();
    if (!OSR.save()) {
      // The browser keeps all data in one storage entry: if it is full, keep
      // the app as it was instead of holding data that a reload would lose.
      const c = new Set(addedC), m = new Set(addedM);
      OSR.state.compendium = OSR.state.compendium.filter(e => !c.has(e.id));
      OSR.state.monsters = OSR.state.monsters.filter(d => !m.has(d.id));
      OSR.save();
      alert('Import failed: the browser storage is full, so "' + name + '" was not added.');
      return;
    }
    OSR.pushNote('Import', 'added ' + addedC.length + ' Compendium entries and ' + addedM.length +
      ' monsters from "' + name + '"');
    if (OSR.currentSystem() !== system) OSR.setSystem(system);
    else { OSR.renderCompendium(); OSR.renderMonsterBrowser(); OSR.renderSettings(); }
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { alert('Import failed: not valid JSON.'); return; }
      if (data && data.pack && typeof data.pack === 'object') { importPack(data); return; }
      if (!data || !Array.isArray(data.characters)) { alert('Import failed: no "characters" array.'); return; }
      const replace = confirm('OK = Replace ALL current data with the imported file.\nCancel = Merge imported characters + monsters into current data.');
      if (replace) {
        OSR.state = Object.assign(JSON.parse(JSON.stringify(OSR.STATE_DEFAULTS)), data);
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
        if (typeof data.notes === 'string' && data.notes.trim()) {
          state.notes = (state.notes ? state.notes + '\n\n' : '') + data.notes.trim();
        }
        if (Array.isArray(data.log)) state.log = state.log.concat(data.log).slice(-OSR.MAX_LOG);
      }
      OSR.ensureStateShape();
      if (!OSR.activeChar() && OSR.state.characters.length) OSR.state.activeId = OSR.state.characters[0].id;
      OSR.mode = 'view';
      if (!OSR.save()) alert('The browser storage is full: the imported data is not saved and is lost when you reload. Export it, or delete data you do not need.');
      OSR.applyTheme();
      OSR.refreshCharUI();
      OSR.renderLog();
      OSR.renderCombat();
      OSR.renderCompendium();
      OSR.renderSettings();
    };
    reader.readAsText(file);
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
    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#file-import').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) importData(f);
      e.target.value = '';
    });
  }

  Object.assign(OSR, { openPasteModal, closePasteModal, pasteFromClipboard, exportData, mergeCompendium, mergeMonsters, importPack, importData, wireIO });
})(window.OSR = window.OSR || {});
