/* js/store.js — local persistence in IndexedDB, and the split of OSR.state
 * into documents.
 *
 * The IndexedDB database `osr_store` has three object stores (out-of-line
 * string keys):
 *   docs   one JSON string per document:
 *            '<campaignId>/campaign'  log, Journal, conditions, settings,
 *                                     combat, seed flags, trackers that no
 *                                     character owns, and the order of
 *                                     characters and trackers
 *            '<campaignId>/<system>'  that system's characters, monsters,
 *                                     Compendium entries, map scenes, and the
 *                                     HP/Wounds/Madness trackers of its characters
 *   blobs  binary data by blob id: { bytes: ArrayBuffer, type, width, height }
 *          (map images; token icons from PR 9 on)
 *   meta   per-device values: 'campaigns' ([{ id, name, createdAt, primary }])
 *          and 'activeCampaignId'
 *
 * OSR.state stays one object in memory. splitState() cuts it into documents
 * for a save; joinState() puts them back together for a load. js/core.js's
 * save()/load() call into here. See AGENTS.md "State model".
 */
(function (OSR) {
  'use strict';

  const DB_NAME = 'osr_store';
  const DB_VERSION = 1;
  const STORES = ['docs', 'blobs', 'meta'];

  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('This browser has no IndexedDB.')); return; }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          STORES.forEach(s => { if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB did not open.'));
        req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab. Close the other tabs of the app and reload.'));
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  // Runs fn(store) in one transaction; resolves with fn's request result (if
  // any) when the transaction commits, so a write is on disk when it resolves.
  async function tx(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const req = fn(t.objectStore(storeName));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error || (req && req.error) || new Error('IndexedDB write failed.'));
      t.onabort = () => reject(t.error || new Error('IndexedDB write was aborted (is the storage full?).'));
    });
  }

  const getMeta = key => tx('meta', 'readonly', s => s.get(key));
  const setMeta = (key, value) => tx('meta', 'readwrite', s => s.put(value, key));

  // { key: jsonString } for every document of one campaign.
  async function getDocs(campaignId) {
    const prefix = campaignId + '/';
    const db = await open();
    return new Promise((resolve, reject) => {
      const out = {};
      const t = db.transaction('docs', 'readonly');
      const req = t.objectStore('docs').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (String(c.key).startsWith(prefix)) out[String(c.key).slice(prefix.length)] = c.value;
        c.continue();
      };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  }

  // Writes { key: jsonString } for one campaign in one transaction: either
  // every document is written, or none is.
  function putDocs(campaignId, docs) {
    return tx('docs', 'readwrite', s => {
      Object.keys(docs).forEach(k => s.put(docs[k], campaignId + '/' + k));
    });
  }

  async function deleteDocs(campaignId) {
    const prefix = campaignId + '/';
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('docs', 'readwrite');
      const req = t.objectStore('docs').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (String(c.key).startsWith(prefix)) c.delete();
        c.continue();
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  /* ---- split / join ---- */

  // Which system each character's HP/Wounds/Madness tracker belongs to, by label.
  function trackerOwners(characters) {
    const owners = new Map();
    characters.forEach(ch => {
      const sys = OSR.charSystemKey(ch);
      [OSR.hpTrackerLabel(ch), OSR.woundTrackerLabel(ch), OSR.madnessTrackerLabel(ch)].forEach(label => {
        if (!owners.has(label)) owners.set(label, sys);
      });
    });
    return owners;
  }

  // OSR.state → { campaign: {...}, osr: {...}, ua3e: {...}, brp: {...}, sl: {...} }.
  // Every system gets a document, even an empty one.
  function splitState(state) {
    const docs = {};
    OSR.SYSTEMS.forEach(s => { docs[s] = { characters: [], monsters: [], compendium: [], consumables: [], scenes: [] }; });
    const sysOf = x => (OSR.SYSTEMS.indexOf(x) === -1 ? 'osr' : x);
    const characters = state.characters || [];
    characters.forEach(ch => docs[sysOf(OSR.charSystemKey(ch))].characters.push(ch));
    (state.monsters || []).forEach(m => docs[sysOf(m.system)].monsters.push(m));
    (state.compendium || []).forEach(e => docs[sysOf(e.system)].compendium.push(e));
    (state.scenes || []).forEach(sc => docs[sysOf(sc.system)].scenes.push(sc));
    const owners = trackerOwners(characters);
    const shared = [];
    (state.consumables || []).forEach(c => {
      const sys = owners.get(c.name);
      if (sys) docs[sysOf(sys)].consumables.push(c); else shared.push(c);
    });
    const campaign = Object.assign({}, state);
    delete campaign.characters; delete campaign.monsters; delete campaign.compendium; delete campaign.scenes;
    campaign.consumables = shared;
    campaign.order = {
      characters: characters.map(c => c.id),
      consumables: (state.consumables || []).map(c => c.id)
    };
    docs.campaign = campaign;
    return docs;
  }

  // The reverse of splitState(). Characters and trackers come back in their
  // saved order; monsters and Compendium entries in system order (every list
  // that shows them is filtered to one system, so only the order inside a
  // system matters, and that is kept).
  function joinState(docs) {
    const campaign = Object.assign({}, docs.campaign || {});
    const order = campaign.order || {};
    delete campaign.order;
    const state = campaign;
    const all = key => OSR.SYSTEMS.reduce((acc, s) => acc.concat((docs[s] && docs[s][key]) || []), []);
    const byOrder = (list, ids) => {
      if (!Array.isArray(ids)) return list;
      const pos = new Map(ids.map((id, i) => [id, i]));
      return list.map((x, i) => [x, pos.has(x.id) ? pos.get(x.id) : ids.length + i])
        .sort((a, b) => a[1] - b[1]).map(p => p[0]);
    };
    state.characters = byOrder(all('characters'), order.characters);
    state.monsters = all('monsters');
    state.compendium = all('compendium');
    state.scenes = all('scenes');
    state.consumables = byOrder((campaign.consumables || []).concat(all('consumables')), order.consumables);
    return state;
  }

  // splitState() as JSON strings, the form the docs store keeps.
  function serialize(state) {
    const docs = splitState(state);
    const out = {};
    Object.keys(docs).forEach(k => { out[k] = JSON.stringify(docs[k]); });
    return out;
  }

  function parseDocs(raw) {
    const docs = {};
    Object.keys(raw).forEach(k => { docs[k] = JSON.parse(raw[k]); });
    return docs;
  }

  const getBlob = id => tx('blobs', 'readonly', s => s.get(id));
  const putBlob = (id, value) => tx('blobs', 'readwrite', s => s.put(value, id));
  const deleteBlob = id => tx('blobs', 'readwrite', s => s.delete(id));

  OSR.store = { open, getMeta, setMeta, getDocs, putDocs, deleteDocs, getBlob, putBlob, deleteBlob };
  Object.assign(OSR, { splitState, joinState, serializeState: serialize, parseDocs });
})(window.OSR = window.OSR || {});
