/* js/core.js — shared constants/DOM helpers, state model + persistence, theme.
 *
 * Creates window.OSR, the namespace every other app file attaches to (see
 * AGENTS.md "Layout" for why: no build step, no ES modules — file:// blocks
 * those — so cross-file calls are OSR.foo(...) / OSR.state.x instead of a
 * shared closure). Load this file first.
 */
(function (OSR) {
  'use strict';

  const STORAGE_KEY = 'osr_manager_v1';
  const MAX_LOG = 500;
  const MAX_DICE = 500;

  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ------------------------------------------------------------------ */
  /* State                                                              */
  /* ------------------------------------------------------------------ */
  const STATE_DEFAULTS = {
    version: 1, activeId: null, activeIdB: null, characters: [], consumables: [], notes: '', log: [],
    monsters: [], monstersSeeded: false, conditions: [],
    compendium: [], compendiumSeeded: false, compendiumSeedVersion: 0,
    settings: { scarletHeroes: false, theme: 'default', system: 'osr' },
    combat: { round: 1, activeId: null, selectedId: null, entries: [] }
  };

  // Compendium entry categories. "Other" is the default for new entries.
  const COMPENDIUM_CATEGORIES = ['Items', 'Spells', 'Abilities', 'Rules', 'Other'];
  const COMPENDIUM_DEFAULT_SOURCE = 'Unknown';

  // Style themes (dark only) — see the theme blocks in css/app.css.
  const THEMES = ['default', 'fantasy', 'sf', 'horror'];
  const THEME_LABELS = { default: 'Default', fantasy: 'Fantasy', sf: 'Sci-fi', horror: 'Horror' };

  // Game system — set via Settings → System, partitions the Compendium
  // (state.compendium entries each carry a `system` field). Everything that
  // predates this feature is 'osr'. See AGENTS.md-style notes in js/settings.js.
  const SYSTEMS = ['osr', 'ua3e'];
  const SYSTEM_LABELS = { osr: 'OSR', ua3e: 'Unknown Armies 3rd Ed' };

  function applyTheme() {
    const t = (OSR.state.settings && OSR.state.settings.theme) || 'default';
    if (t === 'default') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }

  // Prepopulated status conditions (common OSR set). icon = Font Awesome class.
  const CONDITION_SEED = [
    { name: 'Blinded', icon: 'fa-eye-slash', desc: 'The creature has disadvantage on tasks requiring the lost sense. (p55 SD)' },
    { name: 'Charmed', icon: 'fa-heart', desc: "A charmed creature can't attack the charmer or target the charmer with harmful abilities or magical effects. The charmer has advantage on any ability check to interact socially with the creature." },
    { name: 'Deafened', icon: 'fa-ear-deaf', desc: 'The creature has disadvantage on tasks requiring the lost sense. (p55 SD)' },
    { name: 'Exhaustion', icon: 'fa-battery-empty', desc: 'Measured in six levels, with effects ranging from disadvantage on ability checks to hit point maximum halving, speed reduction, disadvantage on attack rolls and saving throws, and even death at the extreme level.' },
    { name: 'Frightened', icon: 'fa-ghost', desc: "A frightened creature has disadvantage on ability checks and attack rolls while the source of its fear is within line of sight. The creature can't willingly move closer to the source of its fear." },
    { name: 'Grappled', icon: 'fa-handcuffs', desc: 'A grappled creature cannot move. The condition ends if the grappler is incapacitated or if an effect removes the grappled creature from the reach of the grappler.' },
    { name: 'Incapacitated', icon: 'fa-ban', desc: "An incapacitated creature can't take actions or reactions." },
    { name: 'Invisible', icon: 'fa-eye-low-vision', desc: 'Impossible to see without the aid of magic or a special sense. Attacks against the invisible creature are at disadvantage. Its location can be detected by any noise it makes or tracks it leaves.' },
    { name: 'Paralyzed', icon: 'fa-bolt', desc: "A paralyzed creature is incapacitated and can't move or speak." },
    { name: 'Petrified', icon: 'fa-cube', desc: 'Transformed, along with any nonmagical object it is wearing or carrying, into a solid inanimate substance (usually stone). Its weight increases by a factor of ten, and it ceases aging.' },
    { name: 'Poisoned', icon: 'fa-skull-crossbones', desc: 'A poisoned creature has disadvantage on attack rolls and ability checks.' },
    { name: 'Prone', icon: 'fa-person-falling', desc: "A prone creature's only movement option is to crawl Near unless it stands up and thereby ends the condition. It has disadvantage on attack rolls. An attack roll against it has advantage if the attacker is Near, otherwise disadvantage." },
    { name: 'Restrained', icon: 'fa-link', desc: "A restrained creature cannot move. Attack rolls against it have advantage, and its attack rolls have disadvantage. It has disadvantage on Dexterity saving throws." },
    { name: 'Stunned', icon: 'fa-face-dizzy', desc: "A stunned creature is incapacitated, can't move, and can speak only falteringly. It automatically fails Strength and Dexterity saving throws. Attack rolls against it have advantage." },
    { name: 'Unconscious', icon: 'fa-bed', desc: "Incapacitated, can't move or speak, and unaware of its surroundings. Can't take actions or reactions." },
    { name: 'Concentrating', icon: 'fa-brain', desc: 'Maintaining an ongoing effect. Taking damage may force a check to keep concentration.' }
  ];
  const DEFAULT_STATUS_ICON = 'fa-circle-exclamation';

  // OSR.state is reassigned in a few places (load(), importData(), the test
  // seam's reset()) — every read elsewhere goes through OSR.state.x (never a
  // locally-cached reference) so reassignment is seen everywhere.
  OSR.state = JSON.parse(JSON.stringify(STATE_DEFAULTS));
  OSR.mode = 'view'; // 'view' | 'edit'

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          OSR.state = Object.assign(JSON.parse(JSON.stringify(STATE_DEFAULTS)), parsed);
        }
        ensureStateShape();
        return true;
      }
    } catch (e) { console.warn('load failed', e); }
    return false;
  }

  function ensureStateShape() {
    const state = OSR.state;
    if (!Array.isArray(state.characters)) state.characters = [];
    if (!Array.isArray(state.monsters)) state.monsters = [];
    if (!Array.isArray(state.log)) state.log = [];
    state.settings = Object.assign({ scarletHeroes: false, theme: 'default', system: 'osr' }, state.settings || {});
    if (THEMES.indexOf(state.settings.theme) === -1) state.settings.theme = 'default';
    if (SYSTEMS.indexOf(state.settings.system) === -1) state.settings.system = 'osr';
    if (!Array.isArray(state.conditions) || !state.conditions.length) {
      state.conditions = CONDITION_SEED.map(c => Object.assign({ id: uid() }, c));
    }
    state.conditions.forEach(c => { if (!c.id) c.id = uid(); if (!c.icon) c.icon = DEFAULT_STATUS_ICON; });
    state.characters.forEach(ensureCharShape);
    ensureConsumablesShape();
    if (state.activeIdB && (state.activeIdB === state.activeId ||
        !state.characters.some(c => c.id === state.activeIdB))) {
      state.activeIdB = null;
    }
    state.monsters.forEach(m => {
      if (!m.id) m.id = uid();
      m.system = SYSTEMS.indexOf(m.system) === -1 ? 'osr' : m.system;
    });
    // Notes are campaign-global. Fold any old per-character notes into it once.
    if (typeof state.notes !== 'string') state.notes = '';
    state.characters.forEach(ch => {
      if (typeof ch.notes === 'string' && ch.notes.trim()) {
        state.notes += (state.notes ? '\n\n' : '') + '## ' + (ch.name || 'Character') + '\n\n' + ch.notes.trim();
      }
      delete ch.notes;
    });
    if (!Array.isArray(state.compendium)) state.compendium = [];
    state.compendium.forEach(en => {
      if (!en.id) en.id = uid();
      en.name = en.name == null ? '' : String(en.name);
      en.category = COMPENDIUM_CATEGORIES.indexOf(en.category) === -1 ? 'Other' : en.category;
      en.source = en.source == null || String(en.source).trim() === '' ? COMPENDIUM_DEFAULT_SOURCE : String(en.source).trim();
      en.body = en.body == null ? '' : String(en.body);
      en.system = SYSTEMS.indexOf(en.system) === -1 ? 'osr' : en.system;
      if (!en.createdAt) en.createdAt = Date.now();
    });
    if (!state.combat || typeof state.combat !== 'object') state.combat = {};
    state.combat = Object.assign({ round: 1, activeId: null, selectedId: null, entries: [] }, state.combat);
    if (!Array.isArray(state.combat.entries)) state.combat.entries = [];
    state.combat.entries.forEach(e => {
      if (!e.id) e.id = uid();
      if (e.side !== 'ally' && e.side !== 'enemy' && e.side !== 'neutral') {
        e.side = e.kind === 'character' ? 'ally' : 'enemy';
      }
      if (e.hd == null) e.hd = '';
      if (e.hp == null) e.hp = 0;
      if (!Array.isArray(e.statuses)) e.statuses = [];
    });
  }

  // Backfill fields added in later versions so older saves keep working.
  function ensureCharShape(ch) {
    return ch;
  }

  // Trackers ("consumables") are campaign-global, not per-character. Every
  // OSR character gets one "HP (Name)" tracker, seeded at 0/0 — Unknown
  // Armies characters (charSystemKey(ch) === 'ua3e', see js/characters.js —
  // a ```ua fence in the body, independent of whichever System is currently
  // selected) get a "Wounds (Name)" tracker instead, via ensureWoundTracker
  // below. Bug fix: this used to fire unconditionally for every character.
  function hpTrackerLabel(ch) { return 'HP (' + (ch ? ch.name : '') + ')'; }

  function ensureHpTracker(ch) {
    if (!ch) return;
    if (OSR.charSystemKey && OSR.charSystemKey(ch) !== 'osr') return;
    const state = OSR.state;
    const label = hpTrackerLabel(ch);
    if (!state.consumables.some(c => c.name === label)) {
      state.consumables.push({ id: uid(), name: label, value: 0, max: 0 });
    }
  }

  // Unknown Armies characters track Wound Threshold instead of HP. Same
  // campaign-global consumable mechanism as ensureHpTracker(), but only ever
  // created for a character once a ```ua statblock with a Wound Threshold is
  // found (see js/characters.js) — plain OSR characters never get one.
  function woundTrackerLabel(ch) { return 'Wounds (' + (ch ? ch.name : '') + ')'; }

  function ensureWoundTracker(ch, threshold) {
    if (!ch || threshold == null || !isFinite(threshold)) return;
    const state = OSR.state;
    const label = woundTrackerLabel(ch);
    let c = state.consumables.find(x => x.name === label);
    if (!c) { c = { id: uid(), value: 0, max: 0 }; state.consumables.push(c); }
    c.name = label;
    c.max = Math.max(0, Math.round(threshold));
  }

  function ensureConsumablesShape() {
    const state = OSR.state;
    if (!Array.isArray(state.consumables)) state.consumables = [];
    // Migrate the old per-character `ch.consumables` into the shared list.
    state.characters.forEach(ch => {
      if (!Array.isArray(ch.consumables)) return;
      ch.consumables.forEach(c => {
        if (/^\s*hp\s*$/i.test(c.name || '')) {
          const label = hpTrackerLabel(ch);
          const ex = state.consumables.find(x => x.name === label);
          if (ex) { if (!ex.value && !ex.max) { ex.value = Number(c.value) || 0; ex.max = Number(c.max) || 0; } }
          else state.consumables.push({ id: uid(), name: label, value: Number(c.value) || 0, max: Number(c.max) || 0 });
        } else {
          state.consumables.push({ id: c.id || uid(), name: String(c.name || ''), value: Number(c.value) || 0, max: Number(c.max) || 0 });
        }
      });
      delete ch.consumables;
    });
    state.characters.forEach(ensureHpTracker);
    state.consumables.forEach(c => {
      if (!c.id) c.id = uid();
      c.name = c.name == null ? '' : String(c.name);
      c.value = Number(c.value) || 0;
      c.max = Number(c.max) || 0;
    });
  }

  function clampConsumable(c) {
    let v = Math.round(Number(c.value) || 0);
    if (v < 0) v = 0;
    const m = Math.round(Number(c.max) || 0);
    if (m > 0 && v > m) v = m;
    c.value = v;
    c.max = m < 0 ? 0 : m;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(OSR.state)); }
    catch (e) { console.warn('save failed', e); }
  }

  function activeChar() {
    return OSR.state.characters.find(c => c.id === OSR.state.activeId) || null;
  }

  Object.assign(OSR, {
    STORAGE_KEY, MAX_LOG, MAX_DICE, $, $$, uid, escapeHtml,
    STATE_DEFAULTS, COMPENDIUM_CATEGORIES, COMPENDIUM_DEFAULT_SOURCE,
    THEMES, THEME_LABELS, SYSTEMS, SYSTEM_LABELS, CONDITION_SEED, DEFAULT_STATUS_ICON,
    applyTheme, load, ensureStateShape, ensureCharShape,
    hpTrackerLabel, ensureHpTracker, ensureConsumablesShape, clampConsumable,
    woundTrackerLabel, ensureWoundTracker,
    save, activeChar
  });
})(window.OSR = window.OSR || {});
