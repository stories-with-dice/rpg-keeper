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

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// index.html order, minus the EasyMDE bundle.
const SCRIPTS = [
  'js/marked.min.js',
  'js/fuse.min.js',
  'js/monsters.js',
  'js/monsters-data.js',
  'js/spells-data.js',
  'js/compendium-seed.js',
  'js/core.js',
  'js/dice.js',
  'js/annotate.js',
  'js/mde.js',
  'js/characters.js',
  'js/consumables.js',
  'js/notes.js',
  'js/combat.js',
  'js/monster-modals.js',
  'js/compendium.js',
  'js/compendium-popups.js',
  'js/settings.js',
  'js/io.js',
  'js/dice-ui.js',
  'js/seed.js',
  'js/main.js',
];

const STORAGE_KEY = 'osr_manager_v1';

// A minimal already-migrated save. With this present, init() does no async
// seeding: load() returns had=true, monstersSeeded short-circuits seedMonsters(),
// and the high seed version short-circuits seedCompendium().
function blankSave() {
  return JSON.stringify({
    version: 1, activeId: null, activeIdB: null,
    characters: [], consumables: [], notes: '', log: [],
    monsters: [], monstersSeeded: true, conditions: [],
    compendium: [], compendiumSeeded: true, compendiumSeedVersion: 9999,
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
    url: 'https://osr.test/',
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

  if (opts.storage != null) window.localStorage.setItem(STORAGE_KEY, opts.storage);
  else if (!opts.freshSeed) window.localStorage.setItem(STORAGE_KEY, blankSave());

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

  if (!opts.freshSeed && opts.storage == null) T.reset();

  return { dom, window, document, T, STORAGE_KEY };
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

module.exports = { boot, rigRandom, face, fire, click, setValue, key };
