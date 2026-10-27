'use strict';

/*
 * The app's static data (js/data.js): every data/ file it fetch()es at boot,
 * the seeds built from them, and the error state when a file is missing.
 * boot() (test/helpers/boot.js) serves data/ from disk.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { boot, blankSave } = require('./helpers/boot.js');

const DATA = path.join(__dirname, '..', 'data');
const readJson = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

test('data/seed-<system>.json: each parses, names its own system, has a version, and its names are unique', () => {
  ['osr', 'brp'].forEach(sys => {
    const f = 'seed-' + sys + '.json';
    const seed = readJson(f);
    assert.strictEqual(seed.system, sys, f + ': system');
    assert.ok(Number.isInteger(seed.version) && seed.version >= 1, f + ': version');
    assert.ok(Array.isArray(seed.compendium) && seed.compendium.length, f + ': compendium');
    seed.compendium.forEach(e => {
      assert.ok(e.name && typeof e.name === 'string', f + ': entry name');
      assert.ok(typeof e.body === 'string' && e.body.length, f + ': ' + e.name + ' has a body');
      assert.ok(typeof e.category === 'string', f + ': ' + e.name + ' has a category');
    });
    const names = seed.compendium.map(e => e.name.toLowerCase());
    assert.strictEqual(new Set(names).size, names.length, f + ': Compendium names are unique');
    if (sys === 'osr') return; // the OSR bestiary is data/monsters.json (generated)
    assert.ok(Array.isArray(seed.monsters) && seed.monsters.length, f + ': monsters');
    const mnames = seed.monsters.map(m => m.name);
    assert.strictEqual(new Set(mnames).size, mnames.length, f + ': monster names are unique');
  });
});

test('OSR.loadData: builds the seeds and pregens from data/, with the spells folded into the OSR Compendium seed', async () => {
  const { T, window } = await boot();
  const gear = readJson('seed-osr.json').compendium;
  const spells = readJson('spells.json');
  const osr = T.data.seeds.osr;
  assert.strictEqual(osr.version, readJson('seed-osr.json').version);
  assert.strictEqual(osr.compendium.length, gear.length + spells.length, 'no spell shares a name with the gear');
  assert.deepEqual(osr.compendium.slice(0, gear.length).map(e => e.name), gear.map(e => e.name), 'gear first');
  assert.ok(osr.compendium.some(e => e.name === spells[0].name && e.category === 'Spells'));
  assert.strictEqual(osr.monsters.length, readJson('monsters.json').length);
  assert.strictEqual(T.data.tables.length, readJson('tables.json').length);
  assert.strictEqual(T.data.seeds.brp.monsters.length, readJson('seed-brp.json').monsters.length);
  assert.strictEqual(T.data.seeds.sl, undefined, 'no built-in Silent Legions data: it comes from a content pack');
  assert.deepEqual(T.data.pregens.map(p => p.file), Array.from(T.PREGEN_FILES));
  T.data.pregens.forEach(p => assert.strictEqual(p.text, fs.readFileSync(path.join(DATA, '..', p.file), 'utf8'), p.file));
  window.close();
});

test('first run: seeds every system from data/ (characters, Bestiary, Compendium)', async () => {
  const { T, window } = await boot({ freshSeed: true });
  const count = (arr, sys) => arr.filter(x => (x.system || 'osr') === sys).length;
  assert.strictEqual(T.state.characters.length, T.PREGEN_FILES.length);
  assert.deepEqual(T.state.characters.map(c => c.name).slice(0, 2), ['Garrick', 'Gulzund Blize']);
  assert.strictEqual(count(T.state.monsters, 'osr'), readJson('monsters.json').length);
  assert.strictEqual(count(T.state.monsters, 'brp'), readJson('seed-brp.json').monsters.length);
  assert.strictEqual(count(T.state.monsters, 'sl'), 0);
  assert.strictEqual(count(T.state.compendium, 'osr'), T.data.seeds.osr.compendium.length);
  assert.strictEqual(count(T.state.compendium, 'brp'), readJson('seed-brp.json').compendium.length);
  assert.strictEqual(count(T.state.compendium, 'sl'), 0);
  assert.ok(T.state.compendium.some(e => e.name === 'Torch' && e.source === 'Shadowdark Core'));
  assert.strictEqual(T.state.compendiumSeedVersion, T.data.seeds.osr.version);
  window.close();
});

test('a data file that fails to load shows the error, starts nothing, and leaves the saved campaign as it was', async () => {
  const saved = JSON.parse(blankSave());
  saved.characters = [{ id: 'c1', name: 'Kept', system: '', body: '# Kept\n' }];
  const text = JSON.stringify(saved);
  const { window, document, STORAGE_KEY } = await boot({
    storage: text, missingData: ['data/seed-brp.json', 'data/ray-kowalczyk-sl.txt'], allowLoadError: true
  });
  const box = document.querySelector('#load-error');
  assert.ok(!box.hidden, 'the error is shown');
  assert.match(box.textContent, /could not start/);
  assert.match(box.textContent, /data\/seed-brp\.json: HTTP 404/);
  assert.match(box.textContent, /data\/ray-kowalczyk-sl\.txt: HTTP 404/);
  assert.ok(document.querySelector('.main').hidden, 'the app is not shown');
  assert.strictEqual(document.querySelector('#char-select').options.length, 0, 'nothing rendered');
  assert.strictEqual(window.localStorage.getItem(STORAGE_KEY), text, 'nothing saved over the campaign');
  window.close();
});

test('OSR.loadData: a network error (fetch rejects) names the file and the reason', async () => {
  const { window, document } = await boot();
  window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(window.OSR.loadData(), /Could not load data\/monsters\.json: Failed to fetch/);
  assert.ok(document.querySelector('#load-error').hidden, 'the running app is untouched');
  window.close();
});
