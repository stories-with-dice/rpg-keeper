/* js/settings.js — the Settings tab: style theme, Scarlet Heroes toggle,
 * monster-library reload, Compendium reseed/clear.
 */
(function (OSR) {
  'use strict';
  const $ = OSR.$;

  function renderSettings() {
    $('#set-scarlet-heroes').checked = !!(OSR.state.settings && OSR.state.settings.scarletHeroes);
    const sel = $('#set-theme');
    if (sel && !sel.options.length) {
      OSR.THEMES.forEach(t => {
        const o = document.createElement('option');
        o.value = t; o.textContent = OSR.THEME_LABELS[t] || t;
        sel.appendChild(o);
      });
    }
    if (sel) sel.value = (OSR.state.settings && OSR.state.settings.theme) || 'default';
    const sysSel = $('#set-system');
    if (sysSel && !sysSel.options.length) {
      OSR.SYSTEMS.forEach(s => {
        const o = document.createElement('option');
        o.value = s; o.textContent = OSR.SYSTEM_LABELS[s] || s;
        sysSel.appendChild(o);
      });
    }
    if (sysSel) sysSel.value = OSR.currentSystem();
    const mn = OSR.monstersForSystem().length;
    $('#set-lib-count').textContent = mn + ' monster' + (mn === 1 ? '' : 's') +
      ' in the ' + (OSR.SYSTEM_LABELS[OSR.currentSystem()] || OSR.currentSystem()) + ' library.';
    const cn = OSR.compendiumForSystem().length;
    $('#set-comp-count').textContent = cn + ' entr' + (cn === 1 ? 'y' : 'ies') +
      ' in the ' + (OSR.SYSTEM_LABELS[OSR.currentSystem()] || OSR.currentSystem()) + ' Compendium' +
      (OSR.currentSystem() === 'osr' ? ' (' + OSR.COMPENDIUM_SEED.length + ' in the default seed)' : '') + '.';
  }
  function wireSettings() {
    $('#set-system').addEventListener('change', e => {
      const s = OSR.SYSTEMS.indexOf(e.target.value) === -1 ? 'osr' : e.target.value;
      OSR.state.settings.system = s;
      OSR.save();
      OSR.resetCompendiumFilters();
      OSR.renderCompendium();
      OSR.refreshCharUI(); // Character dropdown only lists the active system's characters
      OSR.renderMonsterBrowser(); // ditto the Bestiary tab
      OSR.renderCombat(); // ditto Combat's "+ Add character…"/"+ Add monster…"
      renderSettings();
      OSR.pushNote('Settings', 'System → ' + (OSR.SYSTEM_LABELS[s] || s));
    });
    $('#set-theme').addEventListener('change', e => {
      const t = OSR.THEMES.indexOf(e.target.value) === -1 ? 'default' : e.target.value;
      OSR.state.settings.theme = t;
      OSR.applyTheme();
      OSR.save();
      OSR.pushNote('Settings', 'Style theme → ' + (OSR.THEME_LABELS[t] || t));
    });
    $('#set-scarlet-heroes').addEventListener('change', e => {
      OSR.state.settings.scarletHeroes = e.target.checked;
      OSR.save();
      OSR.updateApplyButton();
      OSR.pushNote('Settings', 'Scarlet Heroes damage resolution ' + (e.target.checked ? 'enabled' : 'disabled'));
    });
    $('#set-reload-monsters').addEventListener('click', async () => {
      if (!confirm('Replace the bundled OSR monster library with the defaults? OSR monsters you added by pasting will be lost ' +
        '(Unknown Armies monsters and existing combat entries are unaffected).')) return;
      OSR.state.monstersSeeded = false;
      await OSR.seedMonsters(); // only ever replaces the 'osr' portion of state.monsters — see js/seed.js
      renderSettings();
      OSR.renderMonsterBrowser();
      OSR.renderCombat();
      OSR.pushNote('Settings', 'Monster library reloaded (' + OSR.monstersForSystem().length + ')');
    });
    $('#set-reseed-compendium').addEventListener('click', () => {
      const added = OSR.seedCompendium();
      renderSettings();
      OSR.pushNote('Settings', 'Compendium reseeded — ' + added + ' added, ' + OSR.state.compendium.length + ' total');
      alert(added
        ? 'Added ' + added + ' default ' + (added === 1 ? 'entry' : 'entries') + '.'
        : 'Every default entry is already in the Compendium.');
    });
    $('#set-clear-compendium').addEventListener('click', () => {
      const sysLabel = OSR.SYSTEM_LABELS[OSR.currentSystem()] || OSR.currentSystem();
      const n = OSR.compendiumForSystem().length;
      if (!n) { alert('The ' + sysLabel + ' Compendium is already empty.'); return; }
      if (!confirm('Delete ALL ' + n + ' ' + sysLabel + ' Compendium entries? This cannot be undone. ' +
        '(Other systems’ entries are untouched. Reseed defaults brings the bundled gear back.)')) return;
      const sys = OSR.currentSystem();
      OSR.state.compendium = OSR.state.compendium.filter(e => (e.system || 'osr') !== sys);
      OSR.resetCompendiumFilters();
      OSR.save();
      OSR.hideCompPopNow();
      OSR.renderCompendium();
      renderSettings();
      OSR.pushNote('Settings', sysLabel + ' Compendium cleared — ' + n + ' entries deleted');
    });
  }

  Object.assign(OSR, { renderSettings, wireSettings });
})(window.OSR = window.OSR || {});
