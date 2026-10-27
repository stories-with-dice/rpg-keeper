'use strict';

/*
 * Local storage in IndexedDB (js/store.js, js/core.js's load/save) and
 * campaigns (js/campaigns.js). Each test boots its own app with its own fake
 * IndexedDB (fake-indexeddb); passing `indexedDB` from an earlier boot is a
 * reload in the same browser.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, blankSave, click, setValue, savedState, savedTables } = require('./helpers/boot.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };

// One character, monster, Compendium entry, and tracker for each system.
function fourSystems(T) {
  T.createCharacter('# Aria\nHP 5/5');
  T.createCharacter('# Kevin\n```ua\nWound Threshold: 50\n```');
  T.createCharacter('# Brakka\n```brp\nSTR 12\n```');
  T.createCharacter('# Dee\n```sl\nMadness: 4\n```');
  T.state.consumables.push({ id: 'rations', name: 'Rations', value: 3, max: 10 });
  ['osr', 'ua3e', 'brp', 'sl'].forEach(sys => {
    T.state.monsters.push({ id: 'm-' + sys, name: 'Beast ' + sys, system: sys });
    T.state.compendium.push({ id: 'e-' + sys, name: 'Entry ' + sys, category: 'Rules', source: 'Test', system: sys, body: '', createdAt: 1 });
  });
  T.save();
}

test('splitState: each item goes to its system document; shared data and order go to the campaign document', async () => {
  const { T, window } = await boot();
  fourSystems(T);
  const docs = T.splitState(T.state);
  assert.deepEqual(Object.keys(docs).sort(), ['brp', 'campaign', 'osr', 'sl', 'ua3e']);
  const names = (sys, key) => docs[sys][key].map(x => x.name);
  assert.deepEqual(names('osr', 'characters'), ['Aria']);
  assert.deepEqual(names('ua3e', 'characters'), ['Kevin']);
  assert.deepEqual(names('brp', 'characters'), ['Brakka']);
  assert.deepEqual(names('sl', 'characters'), ['Dee']);
  assert.deepEqual(names('sl', 'consumables').sort(), ['HP (Dee)', 'Madness (Dee)']);
  assert.deepEqual(names('ua3e', 'consumables'), ['Wounds (Kevin)']);
  assert.deepEqual(names('osr', 'consumables'), ['HP (Aria)']);
  assert.deepEqual(docs.campaign.consumables.map(c => c.name), ['Rations'], 'a tracker no character owns is shared');
  ['osr', 'ua3e', 'brp', 'sl'].forEach(sys => {
    assert.deepEqual(names(sys, 'monsters'), ['Beast ' + sys]);
    assert.deepEqual(names(sys, 'compendium'), ['Entry ' + sys]);
  });
  assert.ok(!('characters' in docs.campaign) && !('monsters' in docs.campaign) && !('compendium' in docs.campaign));
  assert.deepEqual(docs.campaign.order.characters, T.state.characters.map(c => c.id));
  assert.ok(Array.isArray(docs.campaign.log) && docs.campaign.settings && docs.campaign.combat);
  window.close();
});

test('joinState(splitState(x)) gives x back: characters and trackers in their order, monsters and entries in order inside each system', async () => {
  const { T, window } = await boot();
  fourSystems(T);
  // Mix the cross-system order, which joinState does not keep.
  T.state.monsters.reverse();
  const before = JSON.parse(JSON.stringify(T.state));
  const after = T.joinState(JSON.parse(JSON.stringify(T.splitState(T.state))));
  assert.deepEqual(after.characters, before.characters);
  assert.deepEqual(after.consumables, before.consumables);
  const bySys = list => ['osr', 'ua3e', 'brp', 'sl'].map(s => list.filter(x => x.system === s));
  assert.deepEqual(bySys(after.monsters), bySys(before.monsters));
  assert.deepEqual(bySys(after.compendium), bySys(before.compendium));
  ['log', 'notes', 'settings', 'combat', 'conditions', 'activeId', 'compendiumSeedVersion'].forEach(k =>
    assert.deepEqual(after[k], before[k], k));
  assert.ok(!('order' in after));
  // And the split is stable.
  assert.deepEqual(T.splitState(after), T.splitState(T.joinState(T.splitState(after))));
  window.close();
});

test('save: one edit writes only the documents that changed, in one write', async () => {
  const { T, window } = await boot();
  fourSystems(T);
  await T.flushSave();
  const writes = [];
  const put = T.store.putDocs;
  T.store.putDocs = (id, docs) => { writes.push(Object.keys(docs).sort()); return put(id, docs); };
  const dee = T.state.characters.find(c => c.name === 'Dee');
  dee.body += '\nA note.';
  T.save();
  T.save(); // the same tick: one write
  await T.flushSave();
  assert.deepEqual(writes, [['sl']]);
  T.state.notes = 'Journal text';
  T.save();
  await T.flushSave();
  assert.deepEqual(writes[1], ['campaign']);
  T.save();
  await T.flushSave();
  assert.strictEqual(writes.length, 2, 'nothing changed: no write');
  T.store.putDocs = put;
  window.close();
});

test('reload: a new boot on the same IndexedDB shows the same campaign, without localStorage', async () => {
  const first = await boot();
  fourSystems(first.T);
  first.T.state.notes = 'Remember the bridge.';
  first.T.save();
  await first.T.flushSave();
  const idb = first.indexedDB;
  const before = JSON.parse(JSON.stringify(first.T.state));
  first.window.close();

  const again = await boot({ indexedDB: idb });
  assert.strictEqual(again.window.localStorage.getItem(again.STORAGE_KEY), null);
  assert.deepEqual(again.T.state.characters.map(c => c.name), before.characters.map(c => c.name));
  assert.strictEqual(again.T.state.notes, 'Remember the bridge.');
  assert.deepEqual(again.T.state.consumables, before.consumables);
  assert.strictEqual(again.T.campaigns.length, 1);
  again.window.close();
});

test('migration: the old localStorage save becomes the campaign "Default"; the old key goes only after the write', async () => {
  const old = JSON.parse(blankSave());
  old.characters = [{ id: 'c1', name: 'Old Timer', system: '', body: '# Old Timer\nHP 3/3' }];
  old.notes = 'From before.';
  const { T, window, STORAGE_KEY } = await boot({ storage: JSON.stringify(old) });
  assert.deepEqual(T.state.characters.map(c => c.name), ['Old Timer']);
  assert.strictEqual(T.state.notes, 'From before.');
  assert.deepEqual(T.campaigns.map(c => [c.name, c.primary]), [['Default', true]]);
  assert.strictEqual(window.localStorage.getItem(STORAGE_KEY), null, 'the old key is removed');
  const saved = await savedState(T);
  assert.deepEqual(saved.characters.map(c => c.name), ['Old Timer']);
  assert.deepEqual(await T.store.getMeta('campaigns'), T.campaigns);
  window.close();
});

test('migration: when the first write fails, the old key stays, so the next boot migrates again', async () => {
  const old = JSON.parse(blankSave());
  old.characters = [{ id: 'c1', name: 'Old Timer', system: '', body: '# Old Timer' }];
  const text = JSON.stringify(old);
  const { T, window, STORAGE_KEY, indexedDB } = await boot({
    storage: text,
    beforeScripts(w) {
      // js/store.js assigns OSR.store: make its writes fail (storage full).
      w.OSR = {};
      let real;
      Object.defineProperty(w.OSR, 'store', {
        configurable: true,
        get: () => real,
        set: v => {
          real = v;
          v.putDocs = () => Promise.reject(new w.DOMException('quota', 'QuotaExceededError'));
        }
      });
    }
  });
  assert.deepEqual(T.state.characters.map(c => c.name), ['Old Timer'], 'the app still shows the campaign');
  assert.strictEqual(window.localStorage.getItem(STORAGE_KEY), text, 'the old key stays');
  assert.strictEqual(await T.store.getMeta('campaigns'), undefined, 'no campaign list without its documents');
  window.close();

  const again = await boot({ storage: text, indexedDB });
  assert.deepEqual(again.T.state.characters.map(c => c.name), ['Old Timer']);
  assert.strictEqual(again.window.localStorage.getItem(STORAGE_KEY), null);
  again.window.close();
});

test('IndexedDB that does not open shows the error and starts nothing', async () => {
  const { document, window } = await boot({
    allowLoadError: true,
    beforeScripts(w) { w.indexedDB = { open() { const req = {}; setTimeout(() => { req.error = new Error('denied'); req.onerror && req.onerror(); }, 0); return req; } }; }
  });
  assert.ok(!document.querySelector('#load-error').hidden);
  assert.match(document.querySelector('#load-error').textContent, /IndexedDB.*denied/);
  window.close();
});

/* ---- Campaign UI ---- */

async function setupTwo() {
  const env = await boot();
  const { T, document, window } = env;
  const $ = s => document.querySelector(s);
  env.$ = $;
  T.createCharacter('# Aria\nHP 5/5');
  T.state.notes = 'Campaign one notes';
  T.save();
  window.prompt = () => 'Second Game';
  setValue($('#campaign-select'), '__new');
  await settle();
  return env;
}

test('Campaign selector: "+ New campaign…" creates and opens an empty campaign with the default Bestiary and Compendium', async () => {
  const { T, window, $ } = await setupTwo();
  assert.deepEqual(T.campaigns.map(c => c.name), ['Default', 'Second Game']);
  assert.strictEqual(T.currentCampaign().name, 'Second Game');
  assert.strictEqual(T.currentCampaign().primary, false);
  assert.strictEqual($('#campaign-select').value, T.campaignId);
  assert.deepEqual(Array.from($('#campaign-select').options).map(o => o.textContent),
    ['Default', 'Second Game', '+ New campaign…']);
  assert.deepEqual(T.state.characters, [], 'no example characters in a new campaign');
  assert.strictEqual(T.state.notes, '');
  assert.strictEqual(T.state.monsters.filter(m => m.system === 'osr').length, T.data.seeds.osr.monsters.length);
  assert.strictEqual(T.state.compendium.filter(e => e.system === 'brp').length, T.data.seeds.brp.compendium.length);
  assert.strictEqual(await T.store.getMeta('activeCampaignId'), T.campaignId);
  window.close();
});

test('Table library: every campaign sees the same tables; the first boot after the change moves each campaign\'s tables into it', async () => {
  const env = await setupTwo();
  const { T, window, $ } = env;
  T.addTables([{ id: 't1', name: 'Shared Omen', source: 'd1\n1: crow\n' }]);
  await T.saveTables();
  const first = T.campaigns[0].id, second = T.campaignId;
  setValue($('#campaign-select'), first);
  await settle();
  assert.ok(Array.from(env.document.querySelectorAll('#tbl-list .tbl-name')).some(n => n.textContent === 'Shared Omen'),
    'the other campaign lists the table');

  // An older save: each campaign kept its own tables in its system documents.
  const putOld = async (cid, sys, tables) => {
    const doc = JSON.parse((await T.store.getDocs(cid))[sys]);
    doc.tables = tables;
    await T.store.putDocs(cid, { [sys]: JSON.stringify(doc) });
  };
  await putOld(first, 'osr', [{ id: 'a', name: 'Alpha', tag: 'Custom', system: 'osr', source: 'd1\n1: a\n' }]);
  await putOld(second, 'ua3e', [{ id: 'b', name: 'Beta', tag: 'Custom', system: 'ua3e', source: 'd1\n1: b\n' }]);
  await T.store.deleteDocs('library');
  const indexedDB = window.indexedDB;
  window.close();

  const r = await boot({ indexedDB });
  assert.deepEqual(r.T.tableLib.tables.map(t => [t.name, t.setting]).sort(), [['Alpha', 'Fantasy'], ['Beta', 'Modern']]);
  assert.deepEqual((await savedTables(r.T)).tables.map(t => t.name).sort(), ['Alpha', 'Beta']);
  r.T.save();
  await r.T.flushSave();
  const doc = JSON.parse((await r.T.store.getDocs(r.T.campaignId)).osr);
  assert.equal('tables' in doc, false, 'the campaign no longer keeps tables');
  r.window.close();
});

test('Campaign selector: switching shows each campaign\'s own data in every panel, and keeps both saved', async () => {
  const { T, window, $, document } = await setupTwo();
  const second = T.campaignId;
  T.createCharacter('# Brannoc\nHP 7/7');
  const first = T.campaigns[0].id;
  setValue($('#campaign-select'), first);
  await settle();
  assert.strictEqual(T.campaignId, first);
  assert.deepEqual(T.state.characters.map(c => c.name), ['Aria']);
  assert.strictEqual(T.state.notes, 'Campaign one notes');
  assert.deepEqual(Array.from(document.querySelectorAll('#char-select option')).map(o => o.textContent).filter(t => /Aria|Brannoc/.test(t)).length, 1);
  assert.match(document.querySelector('#view-name').textContent, /Aria/);

  setValue($('#campaign-select'), second);
  await settle();
  assert.deepEqual(T.state.characters.map(c => c.name), ['Brannoc']);
  assert.match(document.querySelector('#view-name').textContent, /Brannoc/);

  const a = T.joinState(T.parseDocs(await T.store.getDocs(first)));
  const b = T.joinState(T.parseDocs(await T.store.getDocs(second)));
  assert.deepEqual(a.characters.map(c => c.name), ['Aria']);
  assert.deepEqual(b.characters.map(c => c.name), ['Brannoc']);
  window.close();
});

test('Campaign selector: an edit made right before a switch is saved to the campaign it was made in', async () => {
  const { T, window, $ } = await setupTwo();
  const second = T.campaignId;
  const first = T.campaigns[0].id;
  T.state.notes = 'Typed just before switching';
  T.save();
  setValue($('#campaign-select'), first);
  await settle();
  const b = T.joinState(T.parseDocs(await T.store.getDocs(second)));
  assert.strictEqual(b.notes, 'Typed just before switching');
  assert.strictEqual(T.state.notes, 'Campaign one notes');
  window.close();
});

test('Settings → Campaign: Rename changes the name everywhere; Delete removes a campaign and its documents, never the last one', async () => {
  const { T, window, $ } = await setupTwo();
  const second = T.campaignId;
  window.prompt = () => 'Renamed Game';
  click($('#set-campaign-rename'));
  await settle();
  assert.strictEqual(T.currentCampaign().name, 'Renamed Game');
  assert.strictEqual($('#campaign-select').selectedOptions[0].textContent, 'Renamed Game');
  assert.deepEqual((await T.store.getMeta('campaigns')).map(c => c.name), ['Default', 'Renamed Game']);

  click($('#set-campaign-delete'));
  await settle();
  assert.deepEqual(T.campaigns.map(c => c.name), ['Default'], 'deleting the active campaign switches to another');
  assert.deepEqual(T.state.characters.map(c => c.name), ['Aria']);
  assert.deepEqual(await T.store.getDocs(second), {}, 'its documents are gone');
  assert.ok($('#set-campaign-delete').disabled, 'the last campaign cannot be deleted');
  assert.strictEqual(await T.deleteCampaign(T.campaignId), false);
  window.close();
});

test('Campaign selector: a cancelled name creates nothing', async () => {
  const { T, window, document } = await boot();
  window.prompt = () => null;
  setValue(document.querySelector('#campaign-select'), '__new');
  await settle();
  assert.strictEqual(T.campaigns.length, 1);
  assert.strictEqual(document.querySelector('#campaign-select').value, T.campaignId);
  window.close();
});

test('Campaign names are escaped in the selector', async () => {
  const { T, window, document } = await boot();
  window.prompt = () => '<img src=x onerror=alert(1)>';
  setValue(document.querySelector('#campaign-select'), '__new');
  await settle();
  assert.strictEqual(document.querySelector('#campaign-select img'), null);
  assert.strictEqual(document.querySelector('#campaign-select').selectedOptions[0].textContent, '<img src=x onerror=alert(1)>');
  assert.ok(T.campaigns.length === 2);
  window.close();
});
