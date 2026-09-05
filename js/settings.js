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
    $('#set-lib-count').textContent = OSR.state.monsters.length + ' monster' +
      (OSR.state.monsters.length === 1 ? '' : 's') + ' in the library.';
    const cn = OSR.state.compendium.length;
    $('#set-comp-count').textContent = cn + ' entr' + (cn === 1 ? 'y' : 'ies') +
      ' in the Compendium (' + OSR.COMPENDIUM_SEED.length + ' in the default seed).';
  }
  function wireSettings() {
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
      if (!confirm('Replace the monster library with the bundled defaults? Monsters you added by pasting will be lost (combat entries are unaffected).')) return;
      OSR.state.monstersSeeded = false;
      OSR.state.monsters = [];
      await OSR.seedMonsters();
      renderSettings();
      OSR.renderCombat();
      OSR.pushNote('Settings', 'Monster library reloaded (' + OSR.state.monsters.length + ')');
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
      if (!OSR.state.compendium.length) { alert('The Compendium is already empty.'); return; }
      const n = OSR.state.compendium.length;
      if (!confirm('Delete ALL ' + n + ' Compendium entries? This cannot be undone. (Reseed defaults brings the bundled gear back.)')) return;
      OSR.state.compendium = [];
      OSR.resetCompendiumFilters();
      OSR.save();
      OSR.hideCompPopNow();
      OSR.renderCompendium();
      renderSettings();
      OSR.pushNote('Settings', 'Compendium cleared — ' + n + ' entries deleted');
    });
  }

  Object.assign(OSR, { renderSettings, wireSettings });
})(window.OSR = window.OSR || {});
