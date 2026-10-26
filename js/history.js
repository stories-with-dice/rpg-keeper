/* js/history.js — undo and redo for the Maps tab, one history for each scene.
 *
 * Every change to a scene goes through OSR.saveScene(sc) (js/maps.js,
 * js/tokens.js, js/drawings.js): it saves, then records the scene's editable
 * parts (name, grid, hexcrawl, tokens, drawings, pins) before and after the
 * change. Undo puts "before" back; redo puts "after" back. A new change after
 * an undo drops the redo steps. The histories live in memory only: a reload
 * or another campaign starts them empty.
 *
 * Keys (on the Maps tab, not in a text field): Ctrl/Cmd+Z undo,
 * Ctrl/Cmd+Shift+Z or Ctrl+Y redo.
 */
(function (OSR) {
  'use strict';
  const { $ } = OSR;
  const MAX_STEPS = 200;
  const PARTS = ['name', 'grid', 'hexcrawl', 'tokens', 'drawings', 'pins'];

  const histories = Object.create(null); // scene id -> { past: [], future: [], last }

  const snap = sc => JSON.stringify(PARTS.map(k => sc[k]));
  function hist(sc) {
    let h = histories[sc.id];
    if (!h) h = histories[sc.id] = { past: [], future: [], last: snap(sc) };
    return h;
  }

  // The scene as the history last saw it: call when a scene is opened, so
  // its first change has a "before".
  function trackScene(sc) { if (sc) hist(sc); }

  function saveScene(sc) {
    OSR.save();
    if (!sc) return;
    const h = hist(sc);
    const now = snap(sc);
    if (now === h.last) return;
    h.past.push({ before: h.last, after: now });
    if (h.past.length > MAX_STEPS) h.past.shift();
    h.future = [];
    h.last = now;
  }

  function restore(sc, text) {
    const values = JSON.parse(text);
    PARTS.forEach((k, i) => { sc[k] = values[i]; });
    OSR.ensureSceneShape(sc);
    // A token linked to a combat entry that is gone comes back unlinked.
    const ids = new Set(OSR.state.combat.entries.map(e => e.id));
    sc.tokens.forEach(t => { if (t.link && t.link.kind === 'combat' && !ids.has(t.link.entryId)) t.link = null; });
  }

  function step(sc, from, to, field) {
    const h = hist(sc);
    if (!h[from].length) return false;
    const s = h[from].pop();
    restore(sc, s[field]);
    h[to].push(s);
    h.last = snap(sc);
    OSR.save();
    OSR.renderMaps();
    return true;
  }
  const undo = sc => !!sc && step(sc, 'past', 'future', 'before');
  const redo = sc => !!sc && step(sc, 'future', 'past', 'after');
  const canUndo = sc => !!sc && hist(sc).past.length > 0;
  const canRedo = sc => !!sc && hist(sc).future.length > 0;

  // A change made outside the Maps tab (js/tokens.js's unlinkTokens, from
  // Combat) is not a step: the next step's "before" starts after it.
  function rebaseScene(sc) { const h = histories[sc.id]; if (h) h.last = snap(sc); }

  // A new campaign (or a reload of the state) starts every history again.
  function resetHistories() { Object.keys(histories).forEach(k => delete histories[k]); }

  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    const tab = $('#tab-maps');
    if (!tab || !tab.classList.contains('is-active')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('.modal:not([hidden])')) return;
    const sc = OSR.activeScene();
    if (!sc) return;
    e.preventDefault();
    if (k === 'y' || e.shiftKey) redo(sc); else undo(sc);
  }

  function wireHistory() {
    document.addEventListener('keydown', onKey);
    $('#map-undo').addEventListener('click', () => undo(OSR.activeScene()));
    $('#map-redo').addEventListener('click', () => redo(OSR.activeScene()));
  }

  Object.assign(OSR, { saveScene, trackScene, rebaseScene, undoScene: undo, redoScene: redo, canUndo, canRedo, resetHistories, wireHistory });
})(window.OSR = window.OSR || {});
