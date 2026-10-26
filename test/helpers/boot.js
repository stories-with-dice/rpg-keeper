'use strict';

/*
 * Boots the real app (index.html + the js/*.js app files, all attaching to
 * window.OSR — see AGENTS.md "Layout") inside jsdom and returns handles to
 * drive it. Used by test/ui.test.js and test/logic.test.js.
 *
 * EasyMDE / CodeMirror is deliberately NOT loaded — it needs layout APIs jsdom
 * lacks, and the app already falls back to plain <textarea>s when EasyMDE is
 * absent (buildMDE() returns null). Everything else is the shipping code.
 */

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// index.html order, minus the EasyMDE bundle.
const SCRIPTS = [
  'js/marked.min.js',
  'js/fuse.min.js',
  'vendor/fflate/fflate.min.js',
  'js/monsters.js',
  'js/ua-statblock.js',
  'js/core.js',
  'js/data.js',
  'js/store.js',
  'js/seeds.js',
  'js/dice.js',
  'js/annotate.js',
  'js/mde.js',
  'js/characters.js',
  'js/consumables.js',
  'js/notes.js',
  'js/combat.js',
  'js/monster-form.js',
  'js/monster-modals.js',
  'js/monster-browser.js',
  'js/combat-populate.js',
  'js/grid.js',
  'js/maps.js',
  'js/tokens.js',
  'js/icons.js',
  'js/drawings.js',
  'js/pins.js',
  'js/history.js',
  'js/compendium.js',
  'js/compendium-popups.js',
  'js/tables.js',
  'js/settings.js',
  'js/dropbox.js',
  'js/io.js',
  'js/campaigns.js',
  'js/dice-ui.js',
  'js/seed.js',
  'js/brp-seed.js',
  'js/sl-seed.js',
  'js/main.js',
];

const STORAGE_KEY = 'osr_manager_v1';
const APP_ORIGIN = 'https://osr.test';

// The app fetch()es data/*.json and data/*.txt at boot (js/data.js). Serve them
// from disk, read once per test process. `missing` lists paths that answer 404.
const fileCache = new Map();
function serveDataFile(pathname, missing) {
  const rel = pathname.replace(/^\//, '');
  const res = (status, text) => ({
    ok: status === 200, status,
    headers: { get: () => null },
    text: async () => text,
    json: async () => JSON.parse(text),
  });
  if (missing && missing.includes(rel)) return res(404, 'Not Found');
  if (!fileCache.has(rel)) {
    try { fileCache.set(rel, read(rel)); } catch (e) { fileCache.set(rel, null); }
  }
  const text = fileCache.get(rel);
  return text == null ? res(404, 'Not Found') : res(200, text);
}

// A minimal already-migrated save. With this present, init() does no async
// seeding: load() returns had=true, monstersSeeded short-circuits seedMonsters(),
// and the high seed version short-circuits seedCompendium().
function blankSave() {
  return JSON.stringify({
    version: 1, activeId: null, activeIdB: null,
    characters: [], consumables: [], notes: '', log: [],
    monsters: [], monstersSeeded: true, brpMonstersSeeded: true, slMonstersSeeded: true, conditions: [],
    compendium: [], compendiumSeeded: true, compendiumSeedVersion: 9999, brpCompendiumSeeded: true, slCompendiumSeeded: true,
    settings: { scarletHeroes: false, theme: 'default' },
    combat: { round: 1, activeId: null, selectedId: null, entries: [] },
  });
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.freshSeed]  skip the blank save + reset(): let init()
 *                                    run its real first-run seeding.
 * @param {string}  [opts.storage]    raw localStorage value to preload instead.
 * @param {string|null} [opts.promptValue]  what window.prompt() returns.
 * @param {object} [opts.extraStorage]  more localStorage keys to preload ({key: string}).
 * @param {function} [opts.beforeScripts]  called with `window` before the app's scripts
 *                                        run (e.g. to stub window.fetch for boot-time work).
 *                                        Requests for the app's own data/ files never reach
 *                                        that stub: boot() serves them from disk.
 * @param {string}  [opts.url]           page URL (default https://osr.test/), e.g. with a
 *                                        Dropbox ?code= reply.
 * @param {object}  [opts.session]        sessionStorage keys to preload ({key: string}).
 * @param {string[]} [opts.missingData]   data/ paths that answer 404 (load-error tests).
 * @param {IDBFactory} [opts.indexedDB]  the IndexedDB to use (default: a new, empty one) —
 *                                        pass the one from an earlier boot to "reload".
 * @param {Window} [opts.opener]        the main window, for a pop-out map window
 *                                        (opts.url ending in ?view=map): no reset(), since
 *                                        its state is the main window's.
 * @param {boolean} [opts.allowLoadError] return right after init(), with no reset(): for
 *                                        tests of the load-error state.
 */
async function boot(opts = {}) {
  const html = read('index.html')
    .replace(/<script\b[^>]*><\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');

  // Forward page console output, but drop jsdom's own "Not implemented" /
  // CSS-parse errors for layout APIs the app calls and the tests don't need.
  const virtualConsole = new VirtualConsole();
  virtualConsole.forwardTo(console, { jsdomErrors: 'none' });

  const dom = new JSDOM(html, {
    url: opts.url || APP_ORIGIN + '/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const { document } = window;

  // --- jsdom gaps the app touches ---
  window.Element.prototype.scrollIntoView = function () {};
  window.URL.createObjectURL = () => 'blob:osr-test';
  window.URL.revokeObjectURL = () => {};
  // Real enough for the app's two uses: 'insertText' (autocomplete accept —
  // acAccept in js/compendium-popups.js) actually inserts at the focused
  // input/textarea's selection, since some tests drive that flow through it; anything else
  // (e.g. 'copy', used as a clipboard-API fallback) is a harmless no-op.
  document.execCommand = (cmd, _ui, value) => {
    if (cmd === 'insertText') {
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && 'selectionStart' in el))) {
        const s = el.selectionStart, e = el.selectionEnd, v = el.value;
        el.value = v.slice(0, s) + value + v.slice(e);
        el.setSelectionRange(s + value.length, s + value.length);
      }
    }
    return true;
  };
  if (!window.navigator.clipboard) {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => {}, readText: async () => '' },
    });
  }
  window.confirm = () => true;
  window.alert = () => {};
  window.prompt = (_msg, def) =>
    (Object.prototype.hasOwnProperty.call(opts, 'promptValue') ? opts.promptValue : def);

  window.__OSR_ENABLE_TEST_SEAM__ = true;   // opt in to window.__OSR_TEST__
  // jsdom has no IndexedDB: a fresh in-memory one per boot (opts.indexedDB
  // shares one between boots, as one browser profile would).
  window.indexedDB = opts.indexedDB || new IDBFactory();
  window.IDBKeyRange = IDBKeyRange;

  if (opts.storage != null) window.localStorage.setItem(STORAGE_KEY, opts.storage);
  else if (!opts.freshSeed && !opts.indexedDB) window.localStorage.setItem(STORAGE_KEY, blankSave());
  Object.entries(opts.extraStorage || {}).forEach(([k, v]) => window.localStorage.setItem(k, v));
  Object.entries(opts.session || {}).forEach(([k, v]) => window.sessionStorage.setItem(k, v));
  if (opts.opener) window.opener = opts.opener;
  if (opts.beforeScripts) opts.beforeScripts(window);
  // jsdom has no fetch. Serve the app's data/ files, and hand anything else to
  // the test's own stub (if any) — looked up per call, so a test may replace
  // window.fetch later and still get data/ served.
  const testFetch = window.fetch;
  const appFetch = (url, init) => {
    const u = new URL(url, window.location.href);
    if (u.origin === APP_ORIGIN && u.pathname.startsWith('/data/')) return Promise.resolve(serveDataFile(u.pathname, opts.missingData));
    if (typeof testFetch !== 'function') return Promise.reject(new TypeError('fetch: no stub for ' + u.href));
    return testFetch(url, init);
  };
  window.fetch = appFetch;

  for (const src of SCRIPTS) {
    const el = document.createElement('script');
    el.textContent = read(src);
    document.body.appendChild(el);
  }

  // js/main.js runs init() either now (readyState !== 'loading') or on DOMContentLoaded.
  if (document.readyState === 'loading') {
    await new Promise((res) => window.addEventListener('load', res, { once: true }));
  }

  const T = window.__OSR_TEST__;
  if (!T) throw new Error('test seam missing — expected window.__OSR_TEST__ (see js/main.js installTestSeam)');
  await (T.ready || Promise.resolve());
  if (opts.allowLoadError) return { dom, window, document, T, STORAGE_KEY, indexedDB: window.indexedDB };

  if (!opts.freshSeed && opts.storage == null && !opts.indexedDB && !opts.opener) T.reset();
  await T.flushSave();

  return { dom, window, document, T, STORAGE_KEY, indexedDB: window.indexedDB };
}

/** Force Math.random to walk `fractions` (looping). Returns a restore fn. */
function rigRandom(window, fractions) {
  const orig = window.Math.random;
  let i = 0;
  const arr = Array.isArray(fractions) ? fractions : [fractions];
  window.Math.random = () => arr[i++ % arr.length];
  return () => { window.Math.random = orig; };
}

/** Fraction that makes rollDie(sides) land on exactly `face`. */
function face(faceValue, sides) {
  return (faceValue - 1) / sides + 1 / (2 * sides); // mid-bucket, robust to rounding
}

/** Dispatch a bubbling, cancelable Event of `type` (e.g. 'submit', 'change'). */
function fire(el, type, init) {
  const Ev = el.ownerDocument.defaultView.Event;
  el.dispatchEvent(new Ev(type, Object.assign({ bubbles: true, cancelable: true }, init)));
}

function click(el) {
  el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true }));
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

function key(el, k, init) {
  el.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown',
    Object.assign({ key: k, bubbles: true, cancelable: true }, init)));
}

/** The current campaign as saved in IndexedDB (after every queued write). */
async function savedState(T) {
  await T.flushSave();
  const raw = await T.store.getDocs(T.campaignId);
  return T.joinState(T.parseDocs(raw));
}

module.exports = { savedState, boot, blankSave, rigRandom, face, fire, click, setValue, key };
