/* js/settings.js — the Settings tab: system, style theme, BRP combat order, Scarlet Heroes toggle,
 * monster-library reload, Compendium reseed/clear, add missing example characters.
 * The Dropbox sync row has its own file, js/dropbox.js.
 */
(function (OSR) {
  'use strict';
  const $ = OSR.$;

  // Short System names for the header selector (the header has little room).
  const HEADER_SYSTEM_LABELS = { osr: 'OSR', ua3e: 'Unknown Armies', brp: 'BRP', sl: 'Silent Legions', fate: 'Fate', wwn: 'WWN' };

  function renderSettings() {
    $('#set-scarlet-heroes').checked = !!(OSR.state.settings && OSR.state.settings.scarletHeroes);
    $('#set-roll-sound').checked = OSR.rollSoundOn();
    $('#set-dice-3d').checked = OSR.dice3dOn();
    const skinSel = $('#set-dice-skin');
    if (!skinSel.options.length) {
      OSR.DICE_SKINS.forEach(s => {
        const o = document.createElement('option');
        o.value = s.id; o.textContent = s.label;
        skinSel.appendChild(o);
      });
    }
    skinSel.value = OSR.diceSkin();
    skinSel.disabled = !OSR.dice3dOn();
    const sel = $('#set-theme');
    if (sel && !sel.options.length) {
      OSR.THEMES.forEach(t => {
        const o = document.createElement('option');
        o.value = t; o.textContent = OSR.THEME_LABELS[t] || t;
        sel.appendChild(o);
      });
    }
    if (sel) sel.value = (OSR.state.settings && OSR.state.settings.theme) || 'default';
    // Two System selectors: Settings → System and the header's (short names).
    [['#set-system', OSR.SYSTEM_LABELS], ['#header-system', HEADER_SYSTEM_LABELS]].forEach(([id, labels]) => {
      const sysSel = $(id);
      if (!sysSel) return;
      if (!sysSel.options.length) {
        OSR.SYSTEMS.forEach(s => {
          const o = document.createElement('option');
          o.value = s; o.textContent = labels[s] || OSR.SYSTEM_LABELS[s] || s;
          sysSel.appendChild(o);
        });
      }
      sysSel.value = OSR.currentSystem();
    });
    $('#set-brp-initiative-row').hidden = OSR.currentSystem() !== 'brp';
    $('#set-brp-initiative').value = OSR.state.settings.brpInitiative === 'int' ? 'int' : 'dex';
    OSR.renderWwnSettings();
    const mn = OSR.monstersForSystem().length;
    $('#set-lib-count').textContent = mn + ' monster' + (mn === 1 ? '' : 's') +
      ' in the ' + (OSR.SYSTEM_LABELS[OSR.currentSystem()] || OSR.currentSystem()) + ' library.';
    const cn = OSR.compendiumForSystem().length;
    $('#set-comp-count').textContent = cn + ' entr' + (cn === 1 ? 'y' : 'ies') +
      ' in the ' + (OSR.SYSTEM_LABELS[OSR.currentSystem()] || OSR.currentSystem()) + ' Compendium' +
      (OSR.currentSystem() === 'osr' ? ' (' + OSR.data.seeds.osr.compendium.length + ' in the default seed)' : '') + '.';
    const total = OSR.data.pregens.length;
    const missing = OSR.missingPregens();
    $('#set-pregen-count').textContent = (total - missing.length) + ' of ' + total +
      ' example characters (OSR, Unknown Armies, Silent Legions, Fate, WWN) are in this campaign' +
      (missing.length ? '; missing: ' + missing.join(', ') + '.' : '.');
    $('#set-add-pregens').disabled = !missing.length;
    OSR.renderSeedNotice();
    // The System sets the dice presets (Fate rolls 4dF, js/dice-ui.js). Every
    // load path (boot, a campaign switch, an import) calls renderSettings().
    OSR.buildDiceGrid();
    OSR.renderFateDiceActions();
    if (OSR.renderTokenCredits) OSR.renderTokenCredits();
    OSR.renderDropbox();
  }
  // Settings → System, and an imported pack of another system (js/io.js):
  // re-render everything the system partitions (see AGENTS.md "Game system").
  function setSystem(value) {
    const s = OSR.SYSTEMS.indexOf(value) === -1 ? 'osr' : value;
    OSR.state.settings.system = s;
    OSR.save();
    OSR.resetCompendiumFilters();
    OSR.renderCompendium();
    OSR.refreshCharUI(); // Character dropdown only lists the active system's characters
    OSR.renderMonsterBrowser(); // ditto the Bestiary tab
    OSR.renderCombat(); // ditto Combat's "+ Add character…"/"+ Add monster…"
    OSR.renderMaps(); // scenes belong to one system too
    OSR.renderTables(); // ditto user-made tables
    renderSettings();
    OSR.pushNote('Settings', 'System → ' + (OSR.SYSTEM_LABELS[s] || s));
  }

  function wireSettings() {
    $('#set-system').addEventListener('change', e => setSystem(e.target.value));
    $('#header-system').addEventListener('change', e => setSystem(e.target.value));
    $('#set-theme').addEventListener('change', e => {
      const t = OSR.THEMES.indexOf(e.target.value) === -1 ? 'default' : e.target.value;
      OSR.state.settings.theme = t;
      OSR.applyTheme();
      OSR.save();
      OSR.pushNote('Settings', 'Style theme → ' + (OSR.THEME_LABELS[t] || t));
    });
    // BRP combat order: re-sorts a running combat at once.
    $('#set-brp-initiative').addEventListener('change', e => {
      OSR.state.settings.brpInitiative = e.target.value === 'int' ? 'int' : 'dex';
      OSR.save();
      if (OSR.currentSystem() === 'brp') OSR.sortByRank(); else OSR.renderCombat();
      OSR.pushNote('Settings', 'BRP combat order → ' + (e.target.value === 'int' ? 'INT rank' : 'DEX rank'));
    });
    $('#set-dice-3d').addEventListener('change', e => {
      OSR.setDice3d(e.target.checked);
      $('#set-dice-skin').disabled = !e.target.checked;
    });
    // Dice skin: a sample throw shows the new skin (no log line).
    $('#set-dice-skin').addEventListener('change', e => {
      OSR.setDiceSkin(e.target.value);
      const label = (OSR.DICE_SKINS.find(s => s.id === OSR.diceSkin()) || {}).label || '';
      const d20 = 1 + Math.floor(Math.random() * 20), d6 = 1 + Math.floor(Math.random() * 6);
      OSR.show3dDice([{ sides: 20, value: d20 }, { sides: 6, value: d6 }],
        { source: 'Dice skin', formula: label, total: d20 + d6, detail: '', onLanded() {} });
    });
    $('#set-roll-sound').addEventListener('change', e => {
      OSR.setRollSound(e.target.checked);
      if (e.target.checked) OSR.playRollSound(); // a sample
      if (e.target.checked && OSR.diceSound) OSR.diceSound.land(); // and the 3D dice's result click
    });
    $('#set-scarlet-heroes').addEventListener('change', e => {
      OSR.state.settings.scarletHeroes = e.target.checked;
      OSR.save();
      OSR.updateApplyButton();
      OSR.pushNote('Settings', 'Scarlet Heroes damage resolution ' + (e.target.checked ? 'enabled' : 'disabled'));
    });
    $('#set-reload-monsters').addEventListener('click', () => {
      if (!confirm('Replace the bundled OSR monster library with the defaults? OSR monsters you added by pasting will be lost ' +
        '(Unknown Armies monsters and existing combat entries are unaffected).')) return;
      OSR.state.monstersSeeded = false;
      OSR.seedMonsters(); // only ever replaces the 'osr' portion of state.monsters — see js/seed.js
      renderSettings();
      OSR.renderMonsterBrowser();
      OSR.renderCombat();
      OSR.pushNote('Settings', 'Monster library reloaded (' + OSR.monstersForSystem().length + ')');
    });
    $('#set-reseed-compendium').addEventListener('click', () => {
      const sys = OSR.currentSystem();
      const added = sys === 'fate' ? OSR.seedFateCompendium() : sys === 'wwn' ? OSR.seedWwn() : OSR.seedCompendium();
      renderSettings();
      OSR.pushNote('Settings', 'Compendium reseeded — ' + added + ' added, ' + OSR.state.compendium.length + ' total');
      alert(added
        ? 'Added ' + added + ' default ' + (added === 1 ? 'entry' : 'entries') + '.'
        : 'Every default entry is already in the Compendium.');
    });
    $('#set-add-pregens').addEventListener('click', () => {
      const added = OSR.addMissingPregens();
      renderSettings();
      OSR.renderCombat(); // Combat's "+ Add character…" picker lists characters too
      OSR.pushNote('Settings', 'Example characters — ' + added + ' added');
      alert(added
        ? 'Added ' + added + ' example character' + (added === 1 ? '' : 's') +
          '. Each one shows under its own System (Settings → System).'
        : 'Every example character is already in the campaign.');
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

  Object.assign(OSR, { renderSettings, setSystem, wireSettings });
})(window.OSR = window.OSR || {});
