/* js/seeds.js — the seed store: one seed for each system, shared by every
 * campaign on this device and, through Dropbox, by every device.
 *
 * OSR.seeds[system] = { system, version, codeVersion, compendium, monsters }.
 * It starts as the code's seed (OSR.data.seeds, from data/seed-*.json and
 * data/monsters.json + data/spells.json), and content packs add to it
 * (js/io.js's importPack). It lives in IndexedDB as the documents
 * 'seeds/<system>' (js/store.js) and in Dropbox as /seeds/<system>.json
 * (js/dropbox.js).
 *   version      goes up on every change (a new code seed, a pack)
 *   codeVersion  the code seed version it holds; a higher one in OSR.data
 *                is merged in at boot (loadSeeds)
 * Every item has a `seedRef`: a pack's `ref`, a monster's own id, or
 * "<system>:c:<name>" for a Compendium entry.
 *
 * A campaign keeps its own copies. Each copied item carries `seedRef` and
 * `seedHash` (the hash of the copy as it came from the seed), so
 * seedStatus() can tell new items, changed items, and items the user edited.
 * state.seedVersions[system] is the seed version the campaign has seen;
 * Settings shows a notice while it is behind (renderSeedNotice).
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, uid } = OSR;

  OSR.seeds = {};

  const emptySeed = sys => ({ system: sys, version: 0, codeVersion: 0, compendium: [], monsters: [] });
  const cleanName = s => String(s || '').trim().toLowerCase();

  function refOf(sys, kind, item) {
    if (item.seedRef) return item.seedRef;
    if (item.ref) return String(item.ref);
    if (kind === 'm' && item.id) return String(item.id);
    return sys + ':' + kind + ':' + cleanName(item.name);
  }

  function codeSeed(sys) {
    const s = OSR.data.seeds && OSR.data.seeds[sys];
    if (!s) return null;
    return {
      system: sys, version: s.version, codeVersion: s.version,
      compendium: s.compendium.map(e => Object.assign({}, e, { seedRef: refOf(sys, 'c', e) })),
      monsters: s.monsters.map(m => Object.assign({}, m, { seedRef: refOf(sys, 'm', m) }))
    };
  }

  // Items of `extra` replace items of `base` with the same seedRef; the rest of
  // both are kept. Returns a new list.
  function mergeItems(base, extra) {
    const out = base.slice();
    const at = new Map(out.map((x, i) => [x.seedRef, i]));
    extra.forEach(x => { if (at.has(x.seedRef)) out[at.get(x.seedRef)] = x; else { at.set(x.seedRef, out.length); out.push(x); } });
    return out;
  }

  // Two copies of a seed (this device and Dropbox, both changed): every item
  // of both, the newer copy winning on the same seedRef, and a version above both.
  function mergeSeeds(a, b) {
    const [older, newer] = (a.version || 0) <= (b.version || 0) ? [a, b] : [b, a];
    return {
      system: newer.system || older.system,
      version: Math.max(a.version || 0, b.version || 0) + 1,
      codeVersion: Math.max(a.codeVersion || 0, b.codeVersion || 0),
      compendium: mergeItems(older.compendium || [], newer.compendium || []),
      monsters: mergeItems(older.monsters || [], newer.monsters || [])
    };
  }

  // At boot (before load()): the stored seeds, with a newer code seed merged in.
  async function loadSeeds() {
    const raw = await OSR.store.getDocs('seeds');
    const writes = {};
    OSR.SYSTEMS.forEach(sys => {
      let seed = raw[sys] ? JSON.parse(raw[sys]) : null;
      const code = codeSeed(sys);
      if (code && (!seed || code.codeVersion > (seed.codeVersion || 0))) {
        seed = seed ? Object.assign(mergeSeeds(seed, code), { codeVersion: code.codeVersion }) : code;
        writes[sys] = JSON.stringify(seed);
      }
      OSR.seeds[sys] = seed || emptySeed(sys);
    });
    // A failed write (storage full) is not fatal: the seeds work from memory,
    // and the next boot writes them again.
    if (Object.keys(writes).length) {
      try { await OSR.store.putDocs('seeds', writes); } catch (e) { console.warn('seed write failed', e); }
    }
  }

  // Replaces one system's seed (a pull from Dropbox, a pack). Resolves when written.
  async function setSeed(sys, seed) {
    OSR.seeds[sys] = seed;
    await OSR.store.putDocs('seeds', { [sys]: JSON.stringify(seed) });
    checkSeeds();
  }

  // Adds a content pack's items to a system's seed (replacing the same seedRef).
  async function addToSeed(sys, compendium, monsters) {
    const s = OSR.seeds[sys] || emptySeed(sys);
    const next = Object.assign({}, s, {
      version: (s.version || 0) + 1,
      compendium: mergeItems(s.compendium, compendium.map(e => Object.assign({}, e, { seedRef: refOf(sys, 'c', e) }))),
      monsters: mergeItems(s.monsters, monsters.map(m => Object.assign({}, m, { seedRef: refOf(sys, 'm', m) })))
    });
    await setSeed(sys, next);
    if (OSR.dropboxNoteSave) OSR.dropboxNoteSave();
  }

  /* ---- Campaign copies ---- */

  // The fields that make an item's content (no ids, times, or seed bookkeeping).
  function contentHash(item) {
    const c = {};
    Object.keys(item).sort().forEach(k => {
      if (['id', 'createdAt', 'updatedAt', 'seedRef', 'seedHash', 'system'].indexOf(k) === -1) c[k] = item[k];
    });
    return OSR.hashText(JSON.stringify(c));
  }

  // A seed item as the campaign keeps it (the same shapes the seed functions
  // in js/compendium.js, js/seed.js, js/brp-seed.js, js/sl-seed.js always made).
  function compCopy(sys, e) {
    const item = {
      id: uid(), name: e.name,
      category: OSR.COMPENDIUM_CATEGORIES.indexOf(e.category) === -1 ? (sys === 'osr' ? 'Items' : 'Other') : e.category,
      source: sys === 'osr' && !e.ref ? 'Shadowdark Core' : (e.source || OSR.COMPENDIUM_DEFAULT_SOURCE),
      system: sys, body: e.body || '', createdAt: Date.now(), updatedAt: Date.now()
    };
    if (e.ref) item.ref = String(e.ref);
    item.seedRef = e.seedRef || refOf(sys, 'c', e);
    item.seedHash = contentHash(item);
    return item;
  }
  function monsterCopy(sys, m) {
    const d = JSON.parse(JSON.stringify(m));
    if (!d.id) d.id = uid();
    d.system = sys;
    d.seedRef = m.seedRef || refOf(sys, 'm', m);
    delete d.seedHash;
    d.seedHash = contentHash(d);
    return d;
  }

  // Older items (from before seed refs) get their seedRef and seedHash by
  // matching the seed by name (monsters: by id first). An item that differs
  // from the seed counts as edited. A save from before seedVersions existed
  // is taken as up to date with the current seeds; a new campaign starts
  // from {} (js/campaigns.js, js/main.js), so it is offered every seed.
  function linkSeeds(state) {
    state = state || OSR.state;
    const old = !state.seedVersions || typeof state.seedVersions !== 'object';
    if (old) state.seedVersions = {};
    OSR.SYSTEMS.forEach(sys => {
      const seed = OSR.seeds[sys];
      if (!seed) return;
      if (old) state.seedVersions[sys] = seed.version;
      const byName = new Map(seed.compendium.map(e => [cleanName(e.name), e]));
      state.compendium.forEach(en => {
        if ((en.system || 'osr') !== sys || en.seedRef) return;
        const s = (en.ref && seed.compendium.find(x => x.seedRef === en.ref)) || byName.get(cleanName(en.name));
        if (!s) return;
        en.seedRef = s.seedRef;
        en.seedHash = compCopy(sys, s).seedHash;
      });
      const monById = new Map(seed.monsters.map(m => [m.id, m]));
      const monByName = new Map(seed.monsters.map(m => [cleanName(m.name), m]));
      state.monsters.forEach(d => {
        if ((d.system || 'osr') !== sys || d.seedRef) return;
        const s = monById.get(d.id) || monByName.get(cleanName(d.name));
        if (!s) return;
        d.seedRef = s.seedRef;
        d.seedHash = monsterCopy(sys, s).seedHash;
      });
    });
  }

  // What applying system `sys`'s seed would do to the current campaign.
  function seedStatus(sys) {
    const seed = OSR.seeds[sys] || emptySeed(sys);
    const st = OSR.state;
    const res = { system: sys, version: seed.version, seen: (st.seedVersions || {})[sys] || 0, added: [], changed: [], edited: [] };
    const sameSys = x => (x.system || 'osr') === sys;
    const comp = st.compendium.filter(sameSys), mons = st.monsters.filter(sameSys);
    const check = (kind, items, mine, copy) => {
      const byRef = new Map(mine.filter(x => x.seedRef).map(x => [x.seedRef, x]));
      const names = new Set(mine.map(x => cleanName(x.name)));
      items.forEach(s => {
        const have = byRef.get(s.seedRef);
        if (!have) {
          if (kind === 'c' && names.has(cleanName(s.name))) return; // the user's own entry of that name
          res.added.push({ kind, seed: s });
          return;
        }
        const fresh = copy(sys, s);
        if (fresh.seedHash === have.seedHash) return; // the seed item did not change
        (contentHash(have) === have.seedHash ? res.changed : res.edited).push({ kind, seed: s, item: have });
      });
    };
    check('c', seed.compendium, comp, compCopy);
    check('m', seed.monsters, mons, monsterCopy);
    return res;
  }

  // Applies system `sys`'s seed: adds new items, updates changed ones the user
  // did not edit (and the edited ones too with `overwrite`). Returns counts.
  function applySeed(sys, overwrite) {
    const res = seedStatus(sys);
    const st = OSR.state;
    res.added.forEach(a => {
      if (a.kind === 'c') st.compendium.push(compCopy(sys, a.seed));
      else st.monsters.push(monsterCopy(sys, a.seed));
    });
    const update = u => {
      const list = u.kind === 'c' ? st.compendium : st.monsters;
      const i = list.indexOf(u.item);
      const fresh = u.kind === 'c' ? compCopy(sys, u.seed) : monsterCopy(sys, u.seed);
      fresh.id = u.item.id;
      if (u.kind === 'c') { fresh.createdAt = u.item.createdAt; fresh.seedHash = contentHash(fresh); }
      list[i] = fresh;
    };
    res.changed.forEach(update);
    if (overwrite) res.edited.forEach(update);
    st.seedVersions = Object.assign({}, st.seedVersions, { [sys]: res.version });
    OSR.save();
    return { added: res.added.length, changed: res.changed.length + (overwrite ? res.edited.length : 0), kept: overwrite ? 0 : res.edited.length };
  }

  // A seed that brings nothing new for this campaign moves its version up
  // silently; otherwise Settings shows the notice.
  function checkSeeds() {
    const st = OSR.state;
    if (!st || !st.compendium) return;
    let moved = false;
    OSR.SYSTEMS.forEach(sys => {
      const r = seedStatus(sys);
      if (r.seen < r.version && !r.added.length && !r.changed.length && !r.edited.length) {
        st.seedVersions = Object.assign({}, st.seedVersions, { [sys]: r.version });
        moved = true;
      }
    });
    if (moved) OSR.save();
    renderSeedNotice();
  }

  function renderSeedNotice() {
    const row = $('#set-seed-row');
    if (!row) return;
    const sys = OSR.currentSystem ? OSR.currentSystem() : 'osr';
    const r = seedStatus(sys);
    const pending = r.seen < r.version && (r.added.length || r.changed.length || r.edited.length);
    row.hidden = !pending;
    if (!pending) return;
    const label = OSR.SYSTEM_LABELS[sys] || sys;
    $('#set-seed-text').innerHTML = escapeHtml('The ' + label + ' defaults changed: ' + r.added.length + ' new, ' +
      r.changed.length + ' changed' + (r.edited.length ? ', and ' + r.edited.length + ' changed that you also edited' : '') + '.') +
      ' <b>Apply</b> adds the new items and updates the changed ones. Items you edited stay as they are, unless you choose to overwrite them.';
    $('#set-seed-overwrite').hidden = !r.edited.length;
  }

  function wireSeeds() {
    const done = (sys, n) => {
      OSR.pushNote('Settings', (OSR.SYSTEM_LABELS[sys] || sys) + ' defaults applied — ' + n.added + ' added, ' + n.changed + ' updated' +
        (n.kept ? ', ' + n.kept + ' edited kept' : ''));
      OSR.renderCompendium(); OSR.renderMonsterBrowser(); OSR.renderSettings();
    };
    $('#set-seed-apply').addEventListener('click', () => { const s = OSR.currentSystem(); done(s, applySeed(s, false)); });
    $('#set-seed-overwrite').addEventListener('click', () => {
      if (!confirm('Overwrite the items you edited with the new defaults?')) return;
      const s = OSR.currentSystem(); done(s, applySeed(s, true));
    });
    $('#set-seed-skip').addEventListener('click', () => {
      const s = OSR.currentSystem();
      OSR.state.seedVersions = Object.assign({}, OSR.state.seedVersions, { [s]: (OSR.seeds[s] || {}).version || 0 });
      OSR.save();
      renderSeedNotice();
    });
  }

  Object.assign(OSR, {
    seedRefOf: refOf, codeSeed, mergeSeeds, loadSeeds, setSeed, addToSeed, contentHash, compCopy, monsterCopy,
    linkSeeds, seedStatus, applySeed, checkSeeds, renderSeedNotice, wireSeeds
  });
})(window.OSR = window.OSR || {});
