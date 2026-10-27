'use strict';

/*
 * The seed store (js/seeds.js): seed refs on every copy, a newer code seed
 * offered through Settings → New defaults, content packs added to the seed,
 * and the Merge import rule for seeded items. No Dropbox here (see
 * test/dropbox.test.js for the /seeds files).
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, click, setValue } = require('./helpers/boot.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };

test('seed copies: every seeded entry and monster carries its seedRef and seedHash; the seeds are in IndexedDB', async () => {
  const { T, window } = await boot({ freshSeed: true });
  const torch = T.state.compendium.find(e => e.name === 'Torch');
  assert.strictEqual(torch.seedRef, 'osr:c:torch');
  assert.strictEqual(torch.seedHash, T.contentHash(torch), 'an unedited copy');
  const aboleth = T.state.monsters.find(m => m.id === 'sd-aboleth');
  assert.strictEqual(aboleth.seedRef, 'sd-aboleth');
  assert.strictEqual(aboleth.seedHash, T.contentHash(aboleth));
  assert.ok(T.state.compendium.filter(e => e.system === 'brp').every(e => e.seedRef && e.seedRef.startsWith('brp:c:')));
  const stored = await T.store.getDocs('seeds');
  assert.deepEqual(Object.keys(stored).sort(), ['brp', 'osr'], 'Unknown Armies and Silent Legions have no code seed: only a pack makes one');
  assert.strictEqual(JSON.parse(stored.osr).codeVersion, T.data.seeds.osr.version);
  assert.ok(window.document.querySelector('#set-seed-row').hidden, 'nothing new on a fresh install');
  window.close();
});

test('a newer code seed is offered in Settings: Apply adds new items and updates changed ones, and keeps the ones you edited', async () => {
  const { T, window, document } = await boot({ freshSeed: true });
  const $ = s => document.querySelector(s);
  // You edit the Torch; then a code update changes the Torch and the Lantern, and adds a Tent.
  const torch = T.state.compendium.find(e => e.name === 'Torch');
  torch.body = 'My own torch rules.';
  T.save();
  const code = T.data.seeds.osr;
  code.version += 1;
  code.compendium = code.compendium.map(e => (e.name === 'Torch' || e.name === 'Lantern') ? Object.assign({}, e, { body: e.body + ' (revised)' }) : e)
    .concat([{ name: 'Tent', category: 'Items', body: 'Sleeps two.' }]);
  await T.loadSeeds();
  T.checkSeeds();
  click($('#tabs .tab-btn[data-tab="settings"]'));
  assert.ok(!$('#set-seed-row').hidden);
  assert.match($('#set-seed-text').textContent, /OSR defaults changed: 1 new, 1 changed, and 1 changed that you also edited/);
  assert.ok(!$('#set-seed-overwrite').hidden);

  click($('#set-seed-apply'));
  const byName = n => T.state.compendium.find(e => e.name === n);
  assert.ok(byName('Tent'), 'new item added');
  assert.match(byName('Lantern').body, /\(revised\)$/, 'unedited item updated');
  assert.strictEqual(byName('Torch').body, 'My own torch rules.', 'edited item kept');
  assert.ok($('#set-seed-row').hidden);
  assert.strictEqual(T.state.seedVersions.osr, T.seeds.osr.version);
  assert.strictEqual(T.state.compendium.filter(e => e.name === 'Tent').length, 1);
  window.close();
});

test('"Apply and overwrite my edits" replaces edited items too; "Skip" hides the notice and changes nothing', async () => {
  const { T, window, document } = await boot({ freshSeed: true });
  const $ = s => document.querySelector(s);
  const torch = T.state.compendium.find(e => e.name === 'Torch');
  const torchId = torch.id;
  torch.body = 'Mine.';
  T.save();
  const code = T.data.seeds.osr;
  code.version += 1;
  code.compendium = code.compendium.map(e => e.name === 'Torch' ? Object.assign({}, e, { body: 'New torch.' }) : e);
  await T.loadSeeds();
  T.checkSeeds();
  window.confirm = () => true;
  click($('#set-seed-overwrite'));
  const t = T.state.compendium.find(e => e.name === 'Torch');
  assert.strictEqual(t.body, 'New torch.');
  assert.strictEqual(t.id, torchId, 'the same entry, updated in place');
  assert.strictEqual(t.seedHash, T.contentHash(t));

  code.version += 1;
  code.compendium = code.compendium.concat([{ name: 'Skipped Gear', category: 'Items', body: 'x' }]);
  await T.loadSeeds();
  T.checkSeeds();
  assert.ok(!$('#set-seed-row').hidden);
  click($('#set-seed-skip'));
  assert.ok($('#set-seed-row').hidden);
  assert.ok(!T.state.compendium.some(e => e.name === 'Skipped Gear'));
  window.close();
});

test('items from before seed refs are linked to the seed by name; an item that differs counts as edited', async () => {
  const { T, window } = await boot();
  T.state.compendium = [
    { id: 'a', name: 'Torch', category: 'Items', source: 'Shadowdark Core', system: 'osr', body: T.seeds.osr.compendium.find(e => e.name === 'Torch').body },
    { id: 'b', name: 'Lantern', category: 'Items', source: 'Shadowdark Core', system: 'osr', body: 'Changed by hand.' },
    { id: 'c', name: 'Homebrew', category: 'Rules', source: 'Me', system: 'osr', body: '' }
  ];
  delete T.state.seedVersions;
  T.ensureStateShape();
  const [torch, lantern, home] = T.state.compendium;
  assert.strictEqual(torch.seedRef, 'osr:c:torch');
  assert.strictEqual(T.contentHash(torch), torch.seedHash, 'same as the seed: unedited');
  assert.strictEqual(lantern.seedRef, 'osr:c:lantern');
  assert.notStrictEqual(T.contentHash(lantern), lantern.seedHash, 'differs: edited');
  assert.strictEqual(home.seedRef, undefined, 'the user\'s own entry is not linked');
  assert.strictEqual(T.state.seedVersions.osr, T.seeds.osr.version, 'an old save counts as up to date');
  window.close();
});

const uaPack = () => ({
  pack: { name: 'Night Pack', system: 'ua3e' },
  compendium: [{ ref: 'np-1', name: 'Night Shift', category: 'Rules', body: 'Work at night.' }],
  monsters: [{ ref: 'np-m1', name: 'Night Clerk', source: 'ua3e', desc: 'Tired.' }]
});

test('a content pack goes into the system\'s seed too; another campaign is offered it', async () => {
  const { T, window, document } = await boot();
  const $ = s => document.querySelector(s);
  await T.importData(new window.File([JSON.stringify(uaPack())], 'pack.json', { type: 'application/json' }));
  const added = T.state.compendium.find(e => e.name === 'Night Shift');
  assert.strictEqual(added.seedRef, 'np-1');
  assert.strictEqual(added.seedHash, T.contentHash(added));
  assert.strictEqual(T.state.monsters.find(m => m.name === 'Night Clerk').seedRef, 'np-m1');
  assert.deepEqual(T.seeds.ua3e.compendium.map(e => e.seedRef), ['np-1']);
  assert.deepEqual(JSON.parse((await T.store.getDocs('seeds')).ua3e).monsters.map(m => m.name), ['Night Clerk']);
  setValue($('#set-system'), 'ua3e');
  assert.ok($('#set-seed-row').hidden, 'this campaign already has the pack');

  window.prompt = () => 'Second';
  setValue($('#campaign-select'), '__new');
  await settle();
  setValue($('#set-system'), 'ua3e');
  assert.ok(!$('#set-seed-row').hidden);
  assert.match($('#set-seed-text').textContent, /Unknown Armies 3rd Ed defaults changed: 2 new, 0 changed/);
  click($('#set-seed-apply'));
  assert.deepEqual(T.state.compendium.filter(e => e.system === 'ua3e').map(e => e.name), ['Night Shift']);
  assert.deepEqual(T.state.monsters.filter(m => m.system === 'ua3e').map(m => m.name), ['Night Clerk']);
  window.close();
});

test('Merge import: an imported seeded item replaces the campaign\'s copy with the same seedRef; your own item with that name stays', async () => {
  const { T, window } = await boot({ freshSeed: true });
  const torch = T.state.compendium.find(e => e.name === 'Torch');
  T.state.compendium.push({ id: 'mine', name: 'Torch', category: 'Rules', source: 'Me', system: 'osr', body: 'House rule.' });
  T.save();
  const exported = JSON.parse(JSON.stringify(T.state));
  const newer = exported.compendium.find(e => e.id === torch.id);
  newer.body = 'Newer torch text.';
  exported.compendium = [newer, exported.compendium.find(e => e.id === 'mine')];
  exported.characters = [];
  window.confirm = () => false; // Cancel = Merge
  await T.importData(new window.File([JSON.stringify(exported)], 'export.json', { type: 'application/json' }));
  const torches = T.state.compendium.filter(e => e.name === 'Torch');
  assert.strictEqual(torches.length, 2, 'no duplicate');
  assert.strictEqual(torches.find(e => e.id === torch.id).body, 'Newer torch text.');
  assert.strictEqual(torches.find(e => e.id === 'mine').body, 'House rule.');
  window.close();
});
