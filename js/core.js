/* js/core.js — shared constants/DOM helpers, state model + persistence, theme.
 *
 * Creates window.OSR, the namespace every other app file attaches to (see
 * AGENTS.md "Layout" for why: no build step, and no ES modules because the
 * jsdom tests cannot run them — so cross-file calls are OSR.foo(...) /
 * OSR.state.x instead of a shared closure). Load this file first.
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
    monsters: [], monstersSeeded: false, brpMonstersSeeded: false, conditions: [],
    compendium: [], compendiumSeeded: false, compendiumSeedVersion: 0, brpCompendiumSeeded: false,
    scenes: [], activeSceneIds: {},
    settings: { scarletHeroes: false, theme: 'default', system: 'osr', brpInitiative: 'dex' },
    combat: { round: 1, activeId: null, selectedId: null, entries: [] }
  };

  // Compendium entry categories. "Other" is the default for new entries.
  // "Powers" covers BRP's magic/mutations/psychic abilities/sorcery/superpowers.
  // "Journal" holds the notes of map pins (js/pins.js).
  const COMPENDIUM_CATEGORIES = ['Items', 'Spells', 'Powers', 'Abilities', 'Rules', 'Journal', 'Other'];
  const COMPENDIUM_DEFAULT_SOURCE = 'Unknown';

  // Style themes (dark only) — see the theme blocks in css/app.css.
  const THEMES = ['default', 'fantasy', 'sf', 'horror'];
  const THEME_LABELS = { default: 'Default', fantasy: 'Fantasy', sf: 'Sci-fi', horror: 'Horror' };

  // Game system — set via Settings → System, partitions the Compendium
  // (state.compendium entries each carry a `system` field). Everything that
  // predates this feature is 'osr'. See AGENTS.md-style notes in js/settings.js.
  const SYSTEMS = ['osr', 'ua3e', 'brp', 'sl'];
  const SYSTEM_LABELS = { osr: 'OSR', ua3e: 'Unknown Armies 3rd Ed', brp: 'Basic Roleplaying (BRP)', sl: 'Silent Legions' };

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

  // Campaigns (js/campaigns.js has the UI). Each one is a set of documents in
  // IndexedDB (js/store.js). OSR.campaignId is the one in OSR.state. The
  // list is per device: IndexedDB meta 'campaigns' / 'activeCampaignId'.
  OSR.campaigns = [];   // [{ id, name, createdAt, primary }]
  OSR.campaignId = null;

  const defaults = () => JSON.parse(JSON.stringify(STATE_DEFAULTS));

  // Loads the active campaign into OSR.state. Resolves to true when it had
  // saved data (false = a fresh install: init() then seeds the pregens).
  // The first run after the move to IndexedDB migrates the old
  // localStorage[STORAGE_KEY] save into a campaign named "Default"; the old
  // key is removed only after that campaign is written (see writeDocs).
  // Rejects when IndexedDB does not open.
  async function load() {
    const campaigns = await OSR.store.getMeta('campaigns');
    if (Array.isArray(campaigns) && campaigns.length) {
      OSR.campaigns = campaigns;
      const active = await OSR.store.getMeta('activeCampaignId');
      OSR.campaignId = campaigns.some(c => c.id === active) ? active : campaigns[0].id;
      return loadCampaign(OSR.campaignId);
    }
    OSR.campaigns = [{ id: uid(), name: 'Default', createdAt: Date.now(), primary: true }];
    OSR.campaignId = OSR.campaigns[0].id;
    campaignsDirty = true;
    lastWritten = {};
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { console.warn('old save unreadable', e); }
    OSR.state = Object.assign(defaults(), parsed && typeof parsed === 'object' ? parsed : {});
    ensureStateShape();
    if (!parsed) return false;
    migrateOldKey = true;
    await saveNow();
    return true;
  }

  // Makes campaign `id` the current one: OSR.state becomes its saved
  // documents (an empty campaign gets the defaults). OSR.campaignId and
  // OSR.state change in the same tick, so a save never writes one
  // campaign's state under the other's id. Resolves to whether it had any.
  async function loadCampaign(id) {
    const raw = await OSR.store.getDocs(id);
    const had = Object.keys(raw).length > 0;
    OSR.campaignId = id;
    lastWritten = Object.assign({}, raw);
    OSR.state = Object.assign(defaults(), had ? OSR.joinState(OSR.parseDocs(raw)) : {});
    ensureStateShape();
    return had;
  }

  // A monster's abilities as { name, text } objects (a plain string becomes
  // the text). Returns true when it changed something.
  function fixAbilities(m) {
    if (!Array.isArray(m.abilities) || !m.abilities.some(a => typeof a === 'string')) return false;
    m.abilities = m.abilities.map(a => (typeof a === 'string' ? { name: '', text: a } : a));
    return true;
  }

  function ensureStateShape() {
    const state = OSR.state;
    if (!Array.isArray(state.characters)) state.characters = [];
    if (!Array.isArray(state.monsters)) state.monsters = [];
    if (!Array.isArray(state.log)) state.log = [];
    state.settings = Object.assign({ scarletHeroes: false, theme: 'default', system: 'osr', brpInitiative: 'dex' }, state.settings || {});
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
      // Early Silent Legions packs wrote abilities as strings. A copy that was
      // unedited before the fix stays unedited (js/seeds.js).
      const unedited = m.seedHash && OSR.contentHash && OSR.contentHash(m) === m.seedHash;
      if (fixAbilities(m) && unedited) m.seedHash = OSR.contentHash(m);
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
    // A campaign's own random tables (older saves) move to the table library
    // that every campaign shares (js/tables.js).
    if (OSR.adoptCampaignTables) OSR.adoptCampaignTables(state);
    if (!state.combat || typeof state.combat !== 'object') state.combat = {};
    state.combat = Object.assign({ round: 1, activeId: null, selectedId: null, entries: [] }, state.combat);
    if (!Array.isArray(state.combat.entries)) state.combat.entries = [];
    if (OSR.dropLegacySlSeed) OSR.dropLegacySlSeed(state); // js/seeds.js
    if (OSR.linkSeeds && OSR.seeds && Object.keys(OSR.seeds).length) OSR.linkSeeds(state); // js/seeds.js
    if (!Array.isArray(state.scenes)) state.scenes = [];
    if (!state.activeSceneIds || typeof state.activeSceneIds !== 'object') state.activeSceneIds = {};
    if (OSR.ensureSceneShape) state.scenes.forEach(OSR.ensureSceneShape); // js/maps.js
    if (OSR.ensureCustomIcons) OSR.ensureCustomIcons(state); // js/icons.js
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
    if (ch && typeof ch.body === 'string') ch.body = migrateBrpSheet(ch.body);
    return ch;
  }

  // BRP sheets once held their characteristics in a ```brp fence (or, briefly,
  // a Markdown table), which only marked the sheet as BRP. Now the "[BRP]" tag
  // of the first line marks it (charSystemKey, js/characters.js) and the
  // characteristics are one "STR: 12; DEX: 9" line, so each is a sheet
  // variable ($STR) and Combat reads DEX from it. This rewrites an old sheet:
  //   # Brakka\n```brp\nSTR: 12\nDEX 9\n```   → # Brakka [BRP]\nSTR: 12; DEX: 9
  //   | STR | DEX |\n|---|---|\n| 12 | 9 |       → STR: 12; DEX: 9
  // and adds " [BRP]" to the first line when it has no tag.
  const OLD_BRP_FENCE_RE = /```brp[ \t]*\r?\n([\s\S]*?)\r?\n```/;
  const CHARACTERISTIC_KEYS = ['STR', 'CON', 'SIZ', 'INT', 'POW', 'DEX', 'CHA', 'EDU'];
  const BRP_TABLE_RE = /^\|((?:\s*(?:STR|CON|SIZ|INT|POW|DEX|CHA|EDU)\s*\|)+)[ \t]*\r?\n\|[\s|:-]+\r?\n\|([^\n]*)\|[ \t]*$/m;
  const charLine = pairs => pairs.map(p => p[0] + ': ' + p[1]).join('; ');
  function migrateBrpSheet(body) {
    const m = body.match(OLD_BRP_FENCE_RE);
    if (m) {
      const pairs = m[1].split(/\r?\n/).map(l => l.match(/^\s*([A-Za-z]+)\s*:?\s*(\S+)\s*$/)).filter(Boolean).map(x => [x[1], x[2]]);
      body = body.replace(OLD_BRP_FENCE_RE, () => charLine(pairs));
      const lines = body.split('\n');
      const i = lines.findIndex(l => l.trim());
      if (i >= 0 && !/\[(?:BRP|Basic Roleplaying)\]\W*$/i.test(lines[i])) lines[i] = lines[i].replace(/\s*$/, ' [BRP]');
      body = lines.join('\n');
    }
    return body.replace(BRP_TABLE_RE, (all, head, row) => {
      const keys = head.split('|').map(x => x.trim()).filter(Boolean);
      const vals = row.split('|').map(x => x.trim());
      return keys.length === vals.length && keys.every(k => CHARACTERISTIC_KEYS.includes(k))
        ? charLine(keys.map((k, i) => [k, vals[i]])) : all;
    });
  }

  // Sheet resources: every "Name: current/max" on a sheet ("HP: 13/13; PP: 17/17",
  // one per line or separated by ";" "|" ","), outside code fences. Each one
  // gets a "Name (Character)" tracker; "HP" and "Hit Points" use the HP tracker.
  // Returns [{ name, value, max }].
  const RESOURCE_RE = /(?:^|[;|,])[ \t]*\**[ \t]*([A-Za-z][A-Za-z .'()-]{0,29}?)[ \t]*\**[ \t]*:[ \t]*\**[ \t]*(\d+)[ \t]*\/[ \t]*(\d+)(?=[ \t]*\**[ \t]*(?:[;|,]|\r?$))/gm;
  function sheetResources(body) {
    const text = String(body || '').replace(/```[\s\S]*?```/g, '');
    const out = [], seen = new Set();
    let m;
    RESOURCE_RE.lastIndex = 0;
    while ((m = RESOURCE_RE.exec(text))) {
      const name = m[1].replace(/^[-*>#\s]+/, '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, value: +m[2], max: +m[3] });
    }
    return out;
  }
  const isHpName = name => /^(?:HP|Hit Points)$/i.test(name);
  function resourceTrackerLabel(ch, name) {
    return isHpName(name) ? hpTrackerLabel(ch) : name + ' (' + (ch ? ch.name : '') + ')';
  }
  // Creates a tracker for each sheet resource, starting at the sheet's values.
  // After that the tracker holds the current value; the sheet sets only its
  // max (an untouched 0/0 HP tracker takes both).
  function syncResourceTrackers(ch) {
    if (!ch || (OSR.charSystemKey && OSR.charSystemKey(ch) === 'ua3e')) return;
    const state = OSR.state;
    sheetResources(ch.body).forEach(r => {
      const label = resourceTrackerLabel(ch, r.name);
      const c = state.consumables.find(x => x.name === label);
      if (!c) state.consumables.push({ id: uid(), name: label, value: Math.min(r.value, r.max || r.value), max: r.max });
      else if (!c.value && !c.max) { c.value = r.value; c.max = r.max; }
      else { c.max = r.max; clampConsumable(c); }
    });
  }
  // The labels of a character's resource trackers, for rename and delete.
  function resourceTrackerLabels(ch) {
    return sheetResources(ch && ch.body).map(r => resourceTrackerLabel(ch, r.name));
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
    // BRP (from CON+SIZ) and Silent Legions characters use Hit Points too — only Unknown Armies
    // (charSystemKey 'ua3e', tracked via ensureWoundTracker instead) opts out.
    if (OSR.charSystemKey && OSR.charSystemKey(ch) === 'ua3e') return;
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

  // Silent Legions characters (charSystemKey 'sl' — a ```sl fence) also get a
  // "Madness (Name)" tracker, 0–100 (at 100 the character is lost to
  // insanity). Created once, starting from the fence's "Madness: N" line
  // (OSR.slFenceMadness, js/characters.js); after that the tracker is the
  // source of truth, the same as HP's current value.
  const MADNESS_MAX = 100;
  function madnessTrackerLabel(ch) { return 'Madness (' + (ch ? ch.name : '') + ')'; }

  function ensureMadnessTracker(ch) {
    if (!ch || !OSR.charSystemKey || OSR.charSystemKey(ch) !== 'sl') return;
    const state = OSR.state;
    const label = madnessTrackerLabel(ch);
    if (state.consumables.some(c => c.name === label)) return;
    const start = OSR.slFenceMadness ? OSR.slFenceMadness(ch) : 0;
    state.consumables.push({ id: uid(), name: label, value: Math.min(MADNESS_MAX, Math.max(0, start)), max: MADNESS_MAX });
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
    state.characters.forEach(ensureMadnessTracker);
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

  /* ---- Saving ---- */
  // save() is synchronous for its many callers: it queues a write of the
  // documents that changed (compared with what was last written) and a
  // Dropbox upload when sync is on (js/dropbox.js — a no-op otherwise).
  // Saves in the same tick share one write. Callers that must know the write
  // worked (Import, a Dropbox pull) await saveNow() instead.
  let lastWritten = {};      // document key -> JSON string, for OSR.campaignId
  let dirty = false;
  let flushing = null;
  let lastOk = true;
  let campaignsDirty = false; // OSR.campaigns / campaignId not yet in IndexedDB
  let migrateOldKey = false;  // remove localStorage[STORAGE_KEY] after the next good write

  function save() {
    dirty = true;
    if (!flushing) flushing = runFlush();
    if (OSR.dropboxNoteSave) OSR.dropboxNoteSave();
    if (OSR.notifyMapViews) OSR.notifyMapViews(); // pop-out map windows draw the change (js/maps.js)
    return true;
  }

  async function runFlush() {
    await Promise.resolve(); // let the rest of this tick's saves join in
    try {
      while (dirty) { dirty = false; lastOk = await writeDocs(); }
    } finally { flushing = null; }
    return lastOk;
  }

  // Resolves to true when every queued write is on disk, false when the last
  // one failed (storage full, blocked storage).
  function flushSave() { return flushing || Promise.resolve(lastOk); }
  function saveNow() { save(); return flushSave(); }

  async function writeDocs() {
    const id = OSR.campaignId;
    if (!id) return false;
    const docs = OSR.serializeState(OSR.state);
    const changed = {};
    Object.keys(docs).forEach(k => { if (docs[k] !== lastWritten[k]) changed[k] = docs[k]; });
    try {
      if (Object.keys(changed).length) await OSR.store.putDocs(id, changed);
      Object.assign(lastWritten, changed);
      if (campaignsDirty) { await writeCampaigns(); }
    } catch (e) { console.warn('save failed', e); return false; }
    if (migrateOldKey) {
      migrateOldKey = false;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* blocked storage: harmless */ }
    }
    return true;
  }

  // Gives campaign `oldId` the id `newId` (js/dropbox.js: a fresh browser's
  // first campaign takes the id of the campaign in Dropbox). Moves its
  // documents in IndexedDB.
  async function rekeyCampaign(oldId, newId) {
    await flushSave();
    const raw = await OSR.store.getDocs(oldId);
    if (Object.keys(raw).length) await OSR.store.putDocs(newId, raw);
    OSR.campaigns.forEach(c => { if (c.id === oldId) c.id = newId; });
    if (OSR.campaignId === oldId) {
      // A save made while the copy above ran went to the old id: write the
      // whole campaign again under the new one.
      OSR.campaignId = newId;
      lastWritten = {};
      save();
      await flushSave();
    }
    await OSR.store.deleteDocs(oldId);
    await writeCampaigns();
  }

  async function writeCampaigns() {
    await OSR.store.setMeta('campaigns', OSR.campaigns);
    await OSR.store.setMeta('activeCampaignId', OSR.campaignId);
    campaignsDirty = false;
  }

  function activeChar() {
    return OSR.state.characters.find(c => c.id === OSR.state.activeId) || null;
  }

  Object.assign(OSR, {
    STORAGE_KEY, MAX_LOG, MAX_DICE, $, $$, uid, escapeHtml,
    STATE_DEFAULTS, COMPENDIUM_CATEGORIES, COMPENDIUM_DEFAULT_SOURCE,
    THEMES, THEME_LABELS, SYSTEMS, SYSTEM_LABELS, CONDITION_SEED, DEFAULT_STATUS_ICON,
    applyTheme, load, loadCampaign, writeCampaigns, rekeyCampaign, flushSave, saveNow, ensureStateShape, ensureCharShape, migrateBrpSheet, fixAbilities,
    hpTrackerLabel, ensureHpTracker, ensureConsumablesShape, clampConsumable,
    sheetResources, resourceTrackerLabel, syncResourceTrackers, resourceTrackerLabels,
    woundTrackerLabel, ensureWoundTracker, MADNESS_MAX, madnessTrackerLabel, ensureMadnessTracker,
    save, activeChar
  });
})(window.OSR = window.OSR || {});
