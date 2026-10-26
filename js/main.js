/* js/main.js — composition root: wires every subsystem's delegated event
 * listeners, boots the app, and (in test builds only) installs the test seam.
 * Loads last — every other js/*.js file attaches its pieces to window.OSR
 * before this runs. See AGENTS.md "Layout" for the full file list.
 */
(function (OSR) {
  'use strict';
  const { $, $$ } = OSR;

  // Escape closes whatever popup/modal/menu happens to be open — the one
  // place that legitimately needs to know about every subsystem's closer.
  function wireEscape() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        OSR.closeAC(); OSR.closeSelMenu(); OSR.closeRollPopup(); OSR.closePasteModal();
        OSR.closeMonsterEdit(); OSR.closeMonsterModal(); OSR.closeCtxMenu();
        OSR.closePopulateHdModal(); OSR.closeDropboxModal();
        OSR.closeCompEntry(); OSR.closeAllCompPops(); OSR.closeSceneModal(); OSR.closeExportModal(); OSR.closeMapMenu();
      }
    });
  }

  // A pop-out map window wires only the map and what it opens (note popups,
  // the Compendium editor) — never Dropbox, so only the main window syncs.
  function wirePopout() {
    wireEscape();
    OSR.wireCompendiumEntries();
    OSR.wireCompendiumPopups();
    OSR.wireMaps();
    OSR.wireTokens();
    OSR.wireIcons();
    OSR.wireDrawings();
    OSR.wirePins();
    OSR.wireHistory();
  }

  // The open tab is per device (localStorage, not state), so a reload opens it again.
  const TAB_KEY = 'osr_last_tab';

  function restoreTab() {
    let name = null;
    try { name = localStorage.getItem(TAB_KEY); } catch (e) { /* blocked storage: the first tab */ }
    const b = name && $$('.tab-btn').find(x => x.dataset.tab === name);
    if (b && !b.classList.contains('is-active')) b.click();
  }

  function wire() {
    // Tabs
    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('.tab-btn');
      if (!b) return;
      try { localStorage.setItem(TAB_KEY, b.dataset.tab); } catch (err) { /* kept for this page only */ }
      $$('.tab-btn').forEach(x => x.classList.toggle('is-active', x === b));
      $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === 'tab-' + b.dataset.tab));
      OSR.updateApplyButton(); // "Apply damage" shows only on the Combat tab
      if (b.dataset.tab === 'combat') OSR.renderCombat();
      if (b.dataset.tab === 'bestiary') OSR.renderMonsterBrowser();
      if (b.dataset.tab === 'compendium') OSR.renderCompendium();
      if (b.dataset.tab === 'tables') OSR.renderTables();
      if (b.dataset.tab === 'maps') OSR.renderMaps(); // the SVG has a size only while its tab shows
      if (b.dataset.tab === 'settings') OSR.renderSettings(); // counts change elsewhere (seeding, new characters)
      if (b.dataset.tab === 'character' && OSR.notesMDE) setTimeout(() => OSR.notesMDE.codemirror.refresh(), 0);
    });

    wireEscape();

    OSR.wireCharacters();
    OSR.wireIO();
    OSR.wireDicePanel();
    OSR.wireLog();
    OSR.wireConsumables();
    OSR.wireNotes();
    OSR.wireCombat();
    OSR.wirePopulateHd();
    OSR.wireMonsterBrowser();
    OSR.wireCompendiumEntries();
    OSR.wireCompendiumPopups();
    OSR.wireTables();
    OSR.wireSettings();
    OSR.wireDropbox();
    OSR.wireCampaigns();
    OSR.wireMaps();
    OSR.wireTokens();
    OSR.wireIcons();
    OSR.wireDrawings();
    OSR.wirePins();
    OSR.wireHistory();
    OSR.wireSeeds();
    OSR.wireRollPopup();
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                               */
  /* ------------------------------------------------------------------ */
  // The data files could not load: show why, and start nothing. Nothing runs
  // load()/save(), so the saved campaign stays as it was.
  function showLoadError(err) {
    const box = $('#load-error');
    box.innerHTML = '<b>Character Keeper could not start.</b> ' + OSR.escapeHtml(err.message) +
      '<br>Check your connection and reload the page.';
    box.hidden = false;
    $('.main').hidden = true;
  }

  // A pop-out map window (index.html?view=map, js/maps.js): no campaign of its
  // own — it shows the main window's, and shows only the Maps tab.
  function initPopout() {
    const main = window.opener && !window.opener.closed && window.opener.OSR;
    document.body.classList.add('map-popout');
    $$('.tab-btn').forEach(x => x.classList.toggle('is-active', x.dataset.tab === 'maps'));
    $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === 'tab-maps'));
    if (!main || !main.state || !main.registerMapWindow) { OSR.mainWindowClosed(); return; }
    OSR.attachToMain(main);
    OSR.applyTheme();
    wirePopout();
    OSR.renderMaps();
  }

  async function init() {
    if (OSR.isMapPopout()) { initPopout(); return; }
    try { await OSR.loadData(); }
    catch (e) { showLoadError(e); return; }
    if (typeof marked !== 'undefined') {
      marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
    }
    let had;
    try { await OSR.loadSeeds(); had = await OSR.load(); }
    catch (e) { showLoadError(new Error('The browser storage (IndexedDB) did not open: ' + e.message)); return; }
    OSR.applyTheme();
    OSR.buildDiceGrid();
    OSR.renderLog();
    OSR.refreshCharUI();
    OSR.renderCombat();
    OSR.renderMonsterBrowser();
    OSR.renderCompendium();
    OSR.renderTables();
    OSR.renderSettings();
    OSR.renderCampaigns();
    wire();
    if (!had) OSR.state.seedVersions = {};
    OSR.seedMissing(!had);
    OSR.checkSeeds();
    OSR.renderMonsterBrowser();
    OSR.renderCompendium();
    OSR.renderCombat();
    restoreTab();
    OSR.initDropbox(); // last: syncs the seeded state, if Dropbox sync is on
  }

  /* ------------------------------------------------------------------ */
  /* Test seam                                                          */
  /* ------------------------------------------------------------------ */
  // Exposes internals to test/*.test.js. Inert unless the harness opts in by
  // setting window.__OSR_ENABLE_TEST_SEAM__ before this script runs (see
  // test/helpers/boot.js) — so a normal page load is untouched.
  //
  // window.__OSR_TEST__ IS window.OSR: every js/*.js file already attaches
  // its public functions/constants to OSR, so there's no separate list to
  // keep in sync here — just the handful of test-only extras (reset,
  // renderAll) added below.
  function installTestSeam() {
    if (typeof window === 'undefined' || !window.__OSR_ENABLE_TEST_SEAM__) return;
    window.__OSR_TEST__ = OSR;
    OSR.ready = null;

    OSR.renderAll = function () {
      OSR.refreshCharUI(); OSR.renderCombat(); OSR.renderMonsterBrowser(); OSR.renderCompendium();
      OSR.renderTables(); OSR.renderSettings(); OSR.renderLog(); OSR.renderConsumables(); OSR.renderCampaigns();
      OSR.renderMaps();
    };

    // Wipe to an already-migrated empty state (no async seeding) and clear the
    // transient UI/filter state that lives outside `state`. Tests that want the
    // real seed data call seed()/seedMonsters()/seedCompendium().
    OSR.reset = function () {
      OSR.state = JSON.parse(JSON.stringify(OSR.STATE_DEFAULTS));
      OSR.state.monstersSeeded = true;
      OSR.state.brpMonstersSeeded = true;
      OSR.state.slMonstersSeeded = true;
      OSR.state.compendiumSeeded = true;
      OSR.state.compendiumSeedVersion = OSR.seeds.osr.codeVersion;
      OSR.state.brpCompendiumSeeded = true;
      OSR.state.slCompendiumSeeded = true;
      OSR.ensureStateShape();
      OSR.lastRoll = null;
      OSR.mode = 'view';
      OSR.resetCompendiumFilters();
      OSR.resetTableFilters();
      OSR.closeCompEntry();
      OSR.closeSelMenu();
      OSR.closeCtxMenu();
      OSR.closeAC();
      OSR.closeRollPopup();
      OSR.closePopulateHdModal();
      ['#comp-search', '#comp-fulltext', '#comp-fuzzy', '#custom-formula',
        '#notes-area', '#paste-area', '#mm-search', '#mm-hd-min', '#mm-hd-max',
        '#mb-search', '#mb-hd-min', '#mb-hd-max', '#tbl-search',
        '#php-total-hd', '#php-count']
        .forEach(sel => {
          const el = $(sel);
          if (!el) return;
          if (el.type === 'checkbox') el.checked = false; else el.value = '';
        });
      OSR.save();
      OSR.renderAll();
    };
  }

  function boot() {
    installTestSeam();
    const p = init();
    if (typeof window !== 'undefined' && window.__OSR_TEST__) window.__OSR_TEST__.ready = p;
    return p;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.OSR = window.OSR || {});
