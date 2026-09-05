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

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { alert('Import failed: not valid JSON.'); return; }
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
        if (Array.isArray(data.monsters)) data.monsters.forEach(m => { m.id = OSR.uid(); state.monsters.push(m); });
        if (Array.isArray(data.compendium)) data.compendium.forEach(en => {
          const key = String(en.name || '').toLowerCase() + '\0' + en.category;
          if (!state.compendium.some(x => (x.name.toLowerCase() + '\0' + x.category) === key)) {
            state.compendium.push({ id: OSR.uid(), name: String(en.name || ''), category: en.category,
              source: en.source || OSR.COMPENDIUM_DEFAULT_SOURCE,
              body: String(en.body || ''), createdAt: en.createdAt || Date.now(), updatedAt: Date.now() });
          }
        });
        if (typeof data.notes === 'string' && data.notes.trim()) {
          state.notes = (state.notes ? state.notes + '\n\n' : '') + data.notes.trim();
        }
        if (Array.isArray(data.log)) state.log = state.log.concat(data.log).slice(-OSR.MAX_LOG);
      }
      OSR.ensureStateShape();
      if (!OSR.activeChar() && OSR.state.characters.length) OSR.state.activeId = OSR.state.characters[0].id;
      OSR.mode = 'view';
      OSR.save();
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

  Object.assign(OSR, { openPasteModal, closePasteModal, pasteFromClipboard, exportData, importData, wireIO });
})(window.OSR = window.OSR || {});
