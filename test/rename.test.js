'use strict';

/*
 * The Shadowdark system was called 'osr' until 2026-11-09. Every place that
 * stored the old key must still load: campaign state, IndexedDB documents,
 * the seed store, content packs, and Dropbox files.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, answerImport } = require('./helpers/boot.js');
const { APP_KEY, GOOD_CODE, fakeOpen, fakeDropbox } = require('./helpers/fake-dropbox.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await tick(); };

test('normSystem: the old key "osr" reads as "shadowdark"; an unknown key falls back', async () => {
  const { T, window } = await boot();
  assert.strictEqual(T.normSystem('osr'), 'shadowdark');
  assert.strictEqual(T.normSystem('shadowdark'), 'shadowdark');
  assert.strictEqual(T.normSystem('wwn'), 'wwn');
  assert.strictEqual(T.normSystem('nope'), 'shadowdark');
  assert.strictEqual(T.normSystem('nope', null), null);
  assert.strictEqual(T.SYSTEM_LABELS.shadowdark, 'Shadowdark');
  assert.ok(!T.SYSTEMS.includes('osr'));
  window.close();
});

test('an old campaign: "osr" documents, items, settings, and seed store load as Shadowdark, then move to the new keys', async () => {
  const { T, window } = await boot();
  T.createCharacter('# Aria\nHP 5/5');
  T.state.monsters.push({ id: 'm-old', name: 'Old Beast', system: 'shadowdark' });
  await T.saveNow();
  const cid = T.campaignId;
  const seedCount = T.seeds.shadowdark.compendium.length;
  const compCount = T.state.compendium.filter(e => e.system === 'shadowdark').length;

  // Rewrite the stored data the way the app wrote it before the rename.
  const raw = await T.store.getDocs(cid);
  const sys = JSON.parse(raw.shadowdark);
  sys.monsters.forEach(m => { m.system = 'osr'; });
  sys.compendium.forEach(e => { e.system = 'osr'; });
  const camp = JSON.parse(raw.campaign);
  camp.settings.system = 'osr';
  camp.activeSceneIds = { osr: 'scene-1' };
  camp.seedVersions = Object.assign({}, camp.seedVersions, { osr: camp.seedVersions.shadowdark });
  delete camp.seedVersions.shadowdark;
  await T.store.putDocs(cid, { osr: JSON.stringify(sys), campaign: JSON.stringify(camp) });
  await T.store.deleteDocKeys(cid, ['shadowdark']);
  const seeds = await T.store.getDocs('seeds');
  const seed = JSON.parse(seeds.shadowdark);
  seed.system = 'osr';
  await T.store.putDocs('seeds', { osr: JSON.stringify(seed) });
  await T.store.deleteDocKeys('seeds', ['shadowdark']);
  const indexedDB = window.indexedDB;
  window.close();

  const r = await boot({ indexedDB });
  await r.T.flushSave();
  assert.strictEqual(r.T.state.settings.system, 'shadowdark');
  assert.ok(r.T.state.characters.some(c => c.name === 'Aria'));
  assert.strictEqual(r.T.state.monsters.find(m => m.id === 'm-old').system, 'shadowdark');
  assert.ok(r.T.state.monsters.every(m => m.system !== 'osr'));
  assert.ok(r.T.state.compendium.every(e => e.system !== 'osr'));
  assert.strictEqual(r.T.state.compendium.filter(e => e.system === 'shadowdark').length, compCount, 'no seed item is added twice');
  assert.deepEqual(r.T.state.activeSceneIds, { shadowdark: 'scene-1' });
  assert.ok(!('osr' in r.T.state.seedVersions) && r.T.state.seedVersions.shadowdark > 0);
  assert.strictEqual(r.T.seeds.shadowdark.system, 'shadowdark');
  assert.strictEqual(r.T.seeds.shadowdark.compendium.length, seedCount);
  assert.ok(r.T.seeds.shadowdark.compendium.some(e => e.seedRef === 'osr:c:torch'), 'seed refs keep the old prefix');

  const after = await r.T.store.getDocs(cid);
  assert.ok(after.shadowdark && !after.osr, 'the campaign document moved to the new key');
  const afterSeeds = await r.T.store.getDocs('seeds');
  assert.ok(afterSeeds.shadowdark && !afterSeeds.osr, 'the seed moved to the new key');
  r.window.close();
});

test('a content pack or an export with system "osr" imports into Shadowdark', async () => {
  const { T, window } = await boot();
  T.setSystem('wwn');
  await answerImport(window, () => T.importPack({
    pack: { name: 'Old pack', system: 'osr' },
    compendium: [{ name: 'Lucky Coin', category: 'Items', source: 'Test', body: 'Shiny.', ref: 'test:coin' }]
  }));
  assert.strictEqual(T.currentSystem(), 'shadowdark');
  assert.strictEqual(T.state.compendium.find(e => e.name === 'Lucky Coin').system, 'shadowdark');
  window.close();
});

test('Dropbox: while the folder has only the old osr.json, sync reads it, and an upload creates shadowdark.json without touching osr.json', async () => {
  const env = await boot();
  const { T, window, document } = env;
  const $ = s => document.querySelector(s);
  const dbx = fakeDropbox(window);
  const opened = fakeOpen(window);
  $('#dbx-app-key').value = APP_KEY;
  $('#dbx-app-key').dispatchEvent(new window.Event('input', { bubbles: true }));
  $('#dbx-app-key').dispatchEvent(new window.Event('change', { bubbles: true }));
  T.createCharacter('# Aria');
  await T.dropboxConnectWithCode();
  dbx.challenge = new URL(opened[opened.length - 1].location.href).searchParams.get('code_challenge');
  $('#dbx-code').value = GOOD_CODE;
  $('#dbx-finish').click();
  await settle();
  const cid = T.campaignId;
  const newPath = '/campaigns/' + cid + '/shadowdark.json';
  const oldPath = '/campaigns/' + cid + '/osr.json';

  // An older version of the app wrote the document as osr.json.
  const f = dbx.file(newPath);
  assert.ok(f, 'the first sync wrote shadowdark.json');
  f.path = oldPath;

  // Another device (old version) adds a character to osr.json: the sync pulls it.
  const doc = JSON.parse(f.content);
  doc.characters.push({ id: 'remote-bree', name: 'Bree', system: '', body: '# Bree\n' });
  dbx.edit(f.id, JSON.stringify(doc));
  await T.dropboxSyncNow();
  await settle();
  assert.ok(T.state.characters.some(c => c.name === 'Bree'), 'pulled from osr.json');
  assert.ok(!dbx.file(newPath), 'a pull does not write');

  // A local change: the upload creates shadowdark.json; osr.json stays as it was.
  const oldText = dbx.file(oldPath).content;
  T.createCharacter('# Cole');
  await T.dropboxFlush();
  await settle();
  assert.ok(dbx.file(newPath), 'shadowdark.json was created');
  assert.ok(dbx.json(newPath).characters.some(c => c.name === 'Cole'));
  assert.strictEqual(dbx.file(oldPath).content, oldText, 'osr.json is never written');
  window.close();
});
