'use strict';

/*
 * More map token icons from game-icons.net (js/icons.js): the SVG check
 * (shared with scripts/build-token-icons.js), the index builder, the search,
 * and "use" — a download from jsDelivr (a fake window.fetch here) kept as
 * path data in the campaign.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, click } = require('./helpers/boot.js');
const icons = require('../js/icons.js');
const { indexFromListing } = require('../scripts/build-icon-index.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };
const SVG = d => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/><path fill="#fff" d="' + d + '"/></svg>';

test('icons: iconFromSvg keeps only the path data; strict mode refuses any other element', () => {
  assert.deepEqual(icons.iconFromSvg(SVG('M10 10h20v20z'), 'a'), ['M10 10h20v20z'], 'without the background square');
  const hostile = '<svg viewBox="0 0 512 512"><script>alert(1)</script><path onload="alert(2)" fill="#fff" d="M1 1h9v9z"/></svg>';
  assert.deepEqual(icons.iconFromSvg(hostile, 'b', false), ['M1 1h9v9z'], 'the script and the handler are dropped');
  assert.throws(() => icons.iconFromSvg(hostile, 'b', true), /<script>/);
  assert.throws(() => icons.iconFromSvg('<svg viewBox="0 0 24 24"><path d="M1 1z"/></svg>'), /not a 512/);
  assert.throws(() => icons.iconFromSvg('<svg viewBox="0 0 512 512"><path transform="scale(2)" d="M1 1z"/></svg>'), /transform/);
  assert.throws(() => icons.iconFromSvg(SVG('M1 1 url(javascript:alert(1))')), /odd path data/);
  assert.throws(() => icons.iconFromSvg('<svg viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/></svg>'), /no icon path/);
});

test('icons: the index builder lists every <author>/<name>.svg with a title-cased name and the credited author', () => {
  const list = indexFromListing({ files: [
    { name: '/lorc/dragon-head.svg' }, { name: '/carl-olsen/spider-alt.svg' }, { name: '/README.md' },
    { name: '/delapouite/ogre.svg' }, { name: '/odd folder/x.svg' }
  ] });
  assert.deepEqual(list, [
    { id: 'carl-olsen/spider-alt', name: 'Spider Alt', author: 'Carl Olsen' },
    { id: 'delapouite/ogre', name: 'Ogre', author: 'Delapouite' },
    { id: 'lorc/dragon-head', name: 'Dragon Head', author: 'Lorc' }
  ]);
  const real = require('../data/game-icons-index.json');
  assert.ok(real.length > 4000);
  assert.strictEqual(new Set(real.map(i => i.id)).size, real.length);
});

async function setup() {
  const env = await boot();
  const { T, window, document } = env;
  T.mapRect = () => ({ left: 0, top: 0, width: 1000, height: 700 });
  env.$ = s => document.querySelector(s);
  env.$$ = s => Array.from(document.querySelectorAll(s));
  click(env.$('#tabs .tab-btn[data-tab="maps"]'));
  await T.createScene({ name: 'Lair' });
  // jsDelivr, faked: data/ files still come from disk (test/helpers/boot.js).
  env.fetched = [];
  env.cdn = url => SVG('M5 5h50v50z');
  const serveData = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).startsWith(T.ICON_URL)) {
      env.fetched.push(String(url));
      const body = env.cdn(String(url));
      if (body instanceof Error) throw body;
      return { ok: body != null, status: body == null ? 404 : 200, text: async () => body };
    }
    return serveData(url, opts);
  };
  const close = window.close.bind(window);
  window.close = () => { T.mapsIdle().then(() => setTimeout(close, 0)); };
  return env;
}

async function search(env, q) {
  const s = env.$('#icon-search');
  s.value = q;
  s.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle();
  return env.$$('#icon-results .icon-result');
}

test('icons: the search finds by name, by author, and by several words; best matches first', async () => {
  const env = await setup();
  const { T, window } = env;
  const list = await T.loadIconIndex();
  const names = q => T.searchIcons(list, q, 100).map(i => i.id);
  assert.strictEqual(names('dragon head')[0].endsWith('/dragon-head'), true);
  assert.ok(names('dragon').every(id => /dragon/.test(id)));
  assert.ok(names('spider olsen').includes('carl-olsen/spider-alt'), 'by author');
  assert.deepEqual(names('   '), []);
  const results = await search(env, 'goblin');
  assert.ok(results.length >= 1 && results.length <= 40);
  assert.match(results[0].textContent, /Goblin/);
  assert.ok((await search(env, 'zzzz-nothing')).length === 0);
  assert.match(env.$('#icon-results').textContent, /No icon matches/);
  window.close();
});

test('icons: a click on a result downloads it, keeps its paths in the campaign, and puts a token on the map', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  const results = await search(env, 'dragon head lorc');
  const btn = results.find(b => b.title === 'lorc/dragon-head');
  click(btn);
  await settle();
  assert.deepEqual(env.fetched, [T.ICON_URL + 'lorc/dragon-head.svg']);
  assert.deepEqual(T.state.customIcons, [{ id: 'lorc/dragon-head', name: 'Dragon Head', author: 'Lorc', paths: ['M5 5h50v50z'] }]);
  const sc = T.activeScene();
  assert.deepEqual(sc.tokens.map(t => t.iconId), ['lorc/dragon-head']);
  assert.ok($('#token-palette [data-icon="lorc/dragon-head"]'), 'in the palette now');
  assert.match($('#map-status').textContent, /Added “Dragon Head” by Lorc/);
  assert.match($('#set-token-credits').textContent, /Lorc/);
  assert.deepEqual(T.splitState(T.state).campaign.customIcons.map(i => i.id), ['lorc/dragon-head'], 'saved with the campaign (and so synced)');

  click(btn);
  await settle();
  assert.strictEqual(env.fetched.length, 1, 'not downloaded twice');
  assert.strictEqual(sc.tokens.length, 2);
  const preset = (await search(env, 'goblin')).find(b => b.title === 'caro-asercion/goblin');
  click(preset);
  await settle();
  assert.strictEqual(env.fetched.length, 1, 'a preset is never downloaded');
  window.close();
});

test('icons: a failed download, or an SVG that fails the check, adds nothing and says why; a hostile SVG is reduced to its paths', async () => {
  const env = await setup();
  const { T, window, $ } = env;
  env.cdn = () => new TypeError('Failed to fetch');
  click((await search(env, 'dragon breath'))[0]);
  await settle();
  assert.match($('#map-status').textContent, /Cannot reach game-icons \(Failed to fetch\)/);
  assert.deepEqual(T.state.customIcons, []);

  env.cdn = () => null;
  click((await search(env, 'dragon breath'))[0]);
  await settle();
  assert.match($('#map-status').textContent, /HTTP 404/);

  env.cdn = () => '<svg viewBox="0 0 512 512"><path d="M1 1 url(x)"/></svg>';
  click((await search(env, 'dragon breath'))[0]);
  await settle();
  assert.match($('#map-status').textContent, /odd path data/);
  assert.deepEqual(T.state.customIcons, []);
  assert.deepEqual(T.activeScene().tokens, []);

  env.cdn = () => '<svg viewBox="0 0 512 512"><script>window.pwned = 1</script><path onload="window.pwned = 2" d="M2 2h9v9z"/></svg>';
  click((await search(env, 'dragon breath'))[0]);
  await settle();
  assert.deepEqual(T.state.customIcons[0].paths, ['M2 2h9v9z']);
  assert.strictEqual($('#map-svg script'), null);
  assert.ok(!/onload/.test($('#map-svg').innerHTML));
  assert.strictEqual(window.pwned, undefined);
  window.close();
});

test('icons: stored icons from an import are checked; malformed ones are dropped', async () => {
  const env = await setup();
  const { T, window } = env;
  T.state.customIcons = [
    { id: 'lorc/ok', name: 'Ok', author: 'Lorc', paths: ['M1 1h2v2z'] },
    { id: 'evil', name: 'x', author: 'y', paths: ['M1 1"/><script>'] },
    { id: 'nopath', paths: [] }, null, 'text'
  ];
  T.ensureStateShape();
  assert.deepEqual(T.state.customIcons.map(i => i.id), ['lorc/ok']);
  window.close();
});
