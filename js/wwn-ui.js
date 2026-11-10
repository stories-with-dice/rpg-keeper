/* js/wwn-ui.js — Worlds Without Number in the app: the first-run seed
 * (data/seed-wwn.json: the free-edition Compendium and Bestiary) and
 * Settings → Spell text (the book text or a condensed pack's text, see
 * compendiumForSystem in js/compendium.js).
 */
(function (OSR) {
  'use strict';
  const { $ } = OSR;

  // Adds every default WWN Compendium entry and monster not already present,
  // matched by seedRef (like seedFateCompendium). Returns the count added.
  function seedWwn() {
    const seed = OSR.seeds.wwn || { compendium: [], monsters: [] };
    const st = OSR.state;
    const haveC = new Set(st.compendium.filter(e => e.system === 'wwn' && e.seedRef).map(e => e.seedRef));
    const haveM = new Set(st.monsters.filter(m => m.system === 'wwn' && m.seedRef).map(m => m.seedRef));
    let added = 0;
    (seed.compendium || []).forEach(e => {
      if (!e || !e.name) return;
      const item = OSR.compCopy('wwn', e);
      if (haveC.has(item.seedRef)) return;
      st.compendium.push(item); haveC.add(item.seedRef); added++;
    });
    (seed.monsters || []).forEach(m => {
      if (!m || !m.name) return;
      const d = OSR.monsterCopy('wwn', m);
      if (haveM.has(d.seedRef)) return;
      d.id = OSR.uid();
      st.monsters.push(d); haveM.add(d.seedRef); added++;
    });
    st.wwnSeeded = true;
    OSR.save();
    return added;
  }

  // How many condensed spells (pack entries with `altOf`) the campaign has.
  function wwnCondensedCount() {
    return OSR.state.compendium.filter(e => e.system === 'wwn' && e.altOf).length;
  }

  function renderWwnSettings() {
    renderWwnSdSetting();
    const row = $('#set-wwn-spells-row');
    if (!row) return;
    row.hidden = OSR.currentSystem() !== 'wwn';
    $('#set-wwn-spells').value = OSR.state.settings.wwnSpellText === 'condensed' ? 'condensed' : 'book';
    const n = wwnCondensedCount();
    $('#set-wwn-spells-count').textContent = n
      ? n + ' condensed spell' + (n === 1 ? '' : 's') + ' in this campaign.'
      : 'No condensed spells yet: import the condensed spell pack first.';
  }

  function renderWwnSdSetting() {
    const row = $('#set-wwn-sd-row');
    if (!row) return;
    row.hidden = OSR.currentSystem() !== 'wwn';
    $('#set-wwn-sd').checked = OSR.state.settings.wwnShadowdark === true;
    const n = OSR.state.monsters.filter(m => (m.system || 'shadowdark') === 'shadowdark' && m.source === 'shadowdark').length;
    $('#set-wwn-sd-count').textContent = n
      ? n + ' Shadowdark monster' + (n === 1 ? '' : 's') + ' in this campaign.'
      : 'This campaign has no Shadowdark monsters: switch to Shadowdark and use Settings → Reload defaults for the monster library.';
  }

  function wireWwn() {
    $('#set-wwn-sd').addEventListener('change', e => {
      OSR.state.settings.wwnShadowdark = e.target.checked;
      OSR.save();
      OSR.renderLibrary();
      OSR.renderCombatBar();
      OSR.renderSettings();
      OSR.pushNote('Settings', 'Shadowdark Bestiary in WWN → ' + (e.target.checked ? 'on' : 'off'));
    });
    $('#set-wwn-spells').addEventListener('change', e => {
      OSR.state.settings.wwnSpellText = e.target.value === 'condensed' ? 'condensed' : 'book';
      OSR.save();
      OSR.renderCompendium();
      OSR.refreshCharUI();
      renderWwnSettings();
      OSR.pushNote('Settings', 'WWN spell text → ' + (OSR.state.settings.wwnSpellText === 'condensed' ? 'condensed' : 'book'));
    });
  }

  Object.assign(OSR, { seedWwn, renderWwnSettings, wireWwn });
})(window.OSR = window.OSR || {});
