/* js/main.js — composition root: wires every subsystem's delegated event
 * listeners, boots the app, and (in test builds only) installs the test seam.
 * Loads last — every other js/*.js file attaches its pieces to window.OSR
 * before this runs. See AGENTS.md "Layout" for the full file list.
 */
(function (OSR) {
  'use strict';
  const { $, $$ } = OSR;

  function wire() {
    // Tabs
    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('.tab-btn');
      if (!b) return;
      $$('.tab-btn').forEach(x => x.classList.toggle('is-active', x === b));
      $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === 'tab-' + b.dataset.tab));
      if (b.dataset.tab === 'combat') OSR.renderCombat();
      if (b.dataset.tab === 'bestiary') OSR.renderMonsterBrowser();
      if (b.dataset.tab === 'compendium') OSR.renderCompendium();
      if (b.dataset.tab === 'character' && OSR.notesMDE) setTimeout(() => OSR.notesMDE.codemirror.refresh(), 0);
    });

    // Escape closes whatever popup/modal/menu happens to be open — the one
    // place that legitimately needs to know about every subsystem's closer.
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        OSR.closeAC(); OSR.closeSelMenu(); OSR.closeRollPopup(); OSR.closePasteModal();
        OSR.closeMonsterEdit(); OSR.closeMonsterModal(); OSR.closeCtxMenu();
        OSR.closeCompEntry(); OSR.closeAllCompPops();
      }
    });

    OSR.wireCharacters();
    OSR.wireIO();
    OSR.wireDicePanel();
    OSR.wireLog();
    OSR.wireConsumables();
    OSR.wireNotes();
    OSR.wireCombat();
    OSR.wireMonsterBrowser();
    OSR.wireCompendiumEntries();
    OSR.wireCompendiumPopups();
    OSR.wireSettings();
    OSR.wireRollPopup();
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                               */
  /* ------------------------------------------------------------------ */
  async function init() {
    if (typeof marked !== 'undefined') {
      marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
    }
    const had = OSR.load();
    OSR.applyTheme();
    OSR.buildDiceGrid();
    OSR.renderLog();
    OSR.refreshCharUI();
    OSR.renderCombat();
    OSR.renderMonsterBrowser();
    OSR.renderCompendium();
    OSR.renderSettings();
    wire();
    if (!had && !OSR.state.characters.length) await OSR.seed();
    if (!OSR.state.monsters.length && !OSR.state.monstersSeeded) await OSR.seedMonsters();
    if ((OSR.state.compendiumSeedVersion || 0) < OSR.COMPENDIUM_SEED_VERSION) {
      await OSR.COMPENDIUM_SEED_READY; // let the optional data/spells.json fetch settle first
      OSR.seedCompendium();
    }
    OSR.renderCombat();
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
      OSR.renderSettings(); OSR.renderLog(); OSR.renderConsumables();
    };

    // Wipe to an already-migrated empty state (no async seeding) and clear the
    // transient UI/filter state that lives outside `state`. Tests that want the
    // real seed data call seed()/seedMonsters()/seedCompendium().
    OSR.reset = function () {
      OSR.state = JSON.parse(JSON.stringify(OSR.STATE_DEFAULTS));
      OSR.state.monstersSeeded = true;
      OSR.state.compendiumSeeded = true;
      OSR.state.compendiumSeedVersion = OSR.COMPENDIUM_SEED_VERSION;
      OSR.ensureStateShape();
      OSR.lastRoll = null;
      OSR.mode = 'view';
      OSR.resetCompendiumFilters();
      OSR.closeCompEntry();
      OSR.closeSelMenu();
      OSR.closeCtxMenu();
      OSR.closeAC();
      OSR.closeRollPopup();
      ['#comp-search', '#comp-fulltext', '#comp-fuzzy', '#custom-formula',
        '#notes-area', '#paste-area', '#mm-search', '#mm-hd-min', '#mm-hd-max',
        '#mb-search', '#mb-hd-min', '#mb-hd-max']
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
