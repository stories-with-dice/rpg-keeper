'use strict';

/*
 * Dropbox sync (js/dropbox.js). Each test boots its own app (sync state is
 * per-device localStorage and IndexedDB, so tests must not share it) with
 * these fakes (test/helpers/fake-dropbox.js):
 *   - window.open: records the Dropbox consent URL of "Connect with a code";
 *   - T.dropboxRedirect: records the consent URL of the redirect flow;
 *   - fakeDropbox: window.fetch serving the OAuth token endpoint and the
 *     Dropbox v2 calls the app makes, with an in-memory app folder, real
 *     revs, and real content_hash values. Two windows can share one.
 * Nothing here talks to Dropbox.
 *
 * Layout in Dropbox: /campaigns/index.json, /campaigns/<id>/shared.json and
 * /campaigns/<id>/<system>.json, /seeds/<system>.json.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const crypto = require('node:crypto');
const { boot, blankSave, click, setValue, savedState } = require('./helpers/boot.js');
const { APP_KEY, GOOD_CODE, fakeOpen, fakeDropbox, newDropbox } = require('./helpers/fake-dropbox.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await tick(); };

async function setup(opts = {}) {
  const env = await boot(opts);
  const { window, document } = env;
  env.$ = s => document.querySelector(s);
  env.dbx = fakeDropbox(window, opts.dbx);
  env.opened = fakeOpen(window);
  setValue(env.$('#dbx-app-key'), APP_KEY);
  return env;
}

// "Connect with a code" → the user clicks Allow on Dropbox → pastes the code → Finish.
async function connect(env, code = GOOD_CODE) {
  await env.T.dropboxConnectWithCode();
  const url = new URL(env.opened[env.opened.length - 1].location.href);
  env.dbx.challenge = url.searchParams.get('code_challenge'); // the "plain" method in jsdom (no crypto.subtle)
  setValue(env.$('#dbx-code'), code);
  click(env.$('#dbx-finish'));
  await settle();
  return url;
}

const names = T => T.state.characters.map(c => c.name);
const docPath = (cid, key) => '/campaigns/' + cid + '/' + (key === 'campaign' ? 'shared' : key) + '.json';
// A campaign as Dropbox has it (its documents joined, like js/store.js does).
function remoteCampaign(T, dbx, cid = T.campaignId) {
  const docs = {};
  ['campaign', 'osr', 'ua3e', 'brp', 'sl'].forEach(k => { const j = dbx.json(docPath(cid, k)); if (j) docs[k] = j; });
  return T.joinState(JSON.parse(JSON.stringify(docs)));
}
const remoteNames = (T, dbx, cid) => remoteCampaign(T, dbx, cid).characters.map(c => c.name);

// Another device adds an OSR character to the campaign in Dropbox.
function addRemoteCharacter(T, dbx, name, cid = T.campaignId) {
  const f = dbx.file(docPath(cid, 'osr'));
  const doc = JSON.parse(f.content);
  doc.characters.push({ id: 'remote-' + name, name, system: '', body: '# ' + name + '\n' });
  dbx.edit(f.id, JSON.stringify(doc));
}

// A whole campaign file in the format of the versions before the split.
function legacyText(T, extraName) {
  const s = JSON.parse(JSON.stringify(T.state));
  if (extraName) s.characters.push({ id: 'remote-' + extraName, name: extraName, system: '', body: '# ' + extraName + '\n' });
  return JSON.stringify(s);
}

test('Dropbox sync: decideSync picks create / link / noop / upload / pull / conflict; PKCE pairs are valid', async () => {
  const { T, window } = await boot();
  const m = { fileId: 'id:1', remoteHash: 'aaa', syncedHash: 'h1' };
  assert.strictEqual(T.decideSync(null, m, 'h1'), 'create');
  assert.strictEqual(T.decideSync({ id: 'id:2', hash: 'aaa' }, m, 'h1'), 'link', 'another file than the one this device synced');
  assert.strictEqual(T.decideSync({ id: 'id:1', hash: 'aaa' }, { fileId: 'id:1', remoteHash: '', syncedHash: '' }, 'h1'), 'link', 'never synced');
  assert.strictEqual(T.decideSync({ id: 'id:1', hash: 'aaa' }, m, 'h1'), 'noop');
  assert.strictEqual(T.decideSync({ id: 'id:1', hash: 'aaa' }, m, 'h2'), 'upload');
  assert.strictEqual(T.decideSync({ id: 'id:1', hash: 'bbb' }, m, 'h1'), 'pull');
  assert.strictEqual(T.decideSync({ id: 'id:1', hash: 'bbb' }, m, 'h2'), 'conflict');
  assert.strictEqual(T.hashText('abc'), T.hashText('abc'));
  assert.notStrictEqual(T.hashText('abc'), T.hashText('abd'));

  const s256 = await T.pkcePair(crypto.webcrypto.subtle);
  assert.strictEqual(s256.method, 'S256');
  assert.match(s256.verifier, /^[A-Za-z0-9_-]{43,128}$/, 'RFC 7636 verifier');
  assert.strictEqual(s256.challenge, crypto.createHash('sha256').update(s256.verifier).digest('base64url'));
  const plain = await T.pkcePair(undefined);
  assert.strictEqual(plain.method, 'plain');
  assert.strictEqual(plain.challenge, plain.verifier);
  window.close();
});

test('Dropbox sync: "Connect with a code" opens Dropbox; the first sync writes the index, one file per document, and the seeds; a save uploads only what changed; tokens never enter a file', async () => {
  const env = await setup();
  const { T, window, $, dbx, opened } = env;
  T.createCharacter('# Aria\nHP 5/5');
  assert.ok($('#dbx-status').hidden, 'no header status while sync is off');
  assert.strictEqual($('#dbx-connect').textContent, 'Connect');
  assert.ok($('#dbx-code-row').hidden);

  await T.dropboxConnectWithCode();
  assert.strictEqual(opened.length, 1);
  assert.strictEqual(opened[0].opener, null, 'the Dropbox tab cannot reach back into the app');
  const url = new URL(opened[0].location.href);
  assert.strictEqual(url.origin + url.pathname, 'https://www.dropbox.com/oauth2/authorize');
  assert.strictEqual(url.searchParams.get('client_id'), APP_KEY);
  assert.strictEqual(url.searchParams.get('response_type'), 'code');
  assert.strictEqual(url.searchParams.get('token_access_type'), 'offline', 'asks for a refresh token');
  assert.ok(!url.searchParams.has('redirect_uri'), 'no redirect: Dropbox shows the code to paste');
  assert.ok(!$('#dbx-code-row').hidden, 'the paste box is shown');
  assert.strictEqual($('#dbx-open').href, url.href, 'Open Dropbox link, for blocked pop-ups');
  assert.ok($('#dbx-connect').hidden);

  dbx.challenge = url.searchParams.get('code_challenge');
  setValue($('#dbx-code'), '  ' + GOOD_CODE + '  ');
  click($('#dbx-finish'));
  await settle();
  const cid = T.campaignId;
  assert.deepEqual(dbx.paths(), [
    '/campaigns/' + cid + '/brp.json', '/campaigns/' + cid + '/osr.json', '/campaigns/' + cid + '/shared.json',
    '/campaigns/' + cid + '/sl.json', '/campaigns/' + cid + '/ua3e.json', '/campaigns/index.json',
    '/seeds/brp.json', '/seeds/osr.json'
  ].sort(), 'no seed file for a system with an empty seed (ua3e, sl)');
  assert.deepEqual(dbx.json('/campaigns/index.json').map(c => [c.id, c.name, c.primary]), [[cid, 'Default', true]]);
  assert.deepEqual(remoteNames(T, dbx), ['Aria']);
  assert.strictEqual(dbx.json('/seeds/osr.json').monsters.length, T.data.seeds.osr.monsters.length);
  const st = T.dropboxState();
  assert.strictEqual(st.status, 'synced');
  assert.strictEqual(st.auth, null);
  assert.ok($('#dbx-code-row').hidden);
  assert.ok(!$('#dbx-status').hidden);
  assert.match($('#dbx-status').textContent, /Synced/);
  assert.match($('#dbx-hint').textContent, /Connected/);
  assert.ok($('#dbx-connect').hidden && !$('#dbx-sync').hidden && !$('#dbx-disconnect').hidden);

  const tok = JSON.parse(window.localStorage.getItem(T.DROPBOX_TOKEN_KEY));
  assert.match(tok.refresh, /^ref-/);
  const saved = JSON.stringify(await savedState(T));
  assert.ok(!/tok-\d|ref-\d|osr_dropbox/.test(saved), 'tokens and sync bookkeeping stay out of OSR.state');
  dbx.files.forEach(f => assert.ok(!/tok-\d|ref-\d/.test(f.content), 'and out of ' + f.path));

  // An edit to the OSR character: only the OSR document is uploaded.
  const before = dbx.writes().length;
  T.state.characters[0].body += '\nA scar.';
  T.save();
  assert.strictEqual(T.dropboxState().status, 'pending', 'a save queues an upload');
  await T.dropboxFlush();
  assert.deepEqual(dbx.writes().slice(before), ['files/upload update /campaigns/' + cid + '/osr.json']);
  assert.ok(dbx.calls.some(c => c === 'files/list_folder/continue'), 'reads every page of the listing');
  assert.strictEqual(T.dropboxState().status, 'synced');

  const writes = dbx.writes().length;
  await T.dropboxSyncNow();
  assert.strictEqual(dbx.writes().length, writes, 'nothing changed: no upload');
  window.close();
});

test('Dropbox sync: a wrong code is refused and sync stays off; no app key means no Connect', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  let alerted = '';
  window.alert = m => { alerted = m; };
  await connect(env, 'typo');
  assert.match(alerted, /did not accept the code/);
  assert.strictEqual(T.dropboxState().status, 'off');
  assert.strictEqual(T.dropboxState().meta.enabled, false);
  assert.ok(T.dropboxState().auth, 'the paste box stays, to try again');
  assert.strictEqual(dbx.files.size, 0);

  click($('#dbx-cancel'));
  assert.ok($('#dbx-code-row').hidden);
  setValue($('#dbx-app-key'), '');
  assert.ok($('#dbx-connect').disabled);
  assert.match($('#dbx-hint').textContent, /app key/);
  window.close();
});

test('Dropbox sync: an expired access token is refreshed without asking; a revoked refresh token asks to reconnect, and local changes then sync', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);

  // 4 hours later: the stored access token is out of date.
  const tok = JSON.parse(window.localStorage.getItem(T.DROPBOX_TOKEN_KEY));
  tok.expiresAt = Date.now() - 1000;
  window.localStorage.setItem(T.DROPBOX_TOKEN_KEY, JSON.stringify(tok));
  T.createCharacter('# Brannoc');
  await T.dropboxFlush();
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.ok(dbx.calls.includes('token refresh_token'));
  assert.deepEqual(remoteNames(T, dbx), ['Aria', 'Brannoc']);

  // The access token is revoked in the middle of a pass: a 401 triggers one refresh, then the pass goes on.
  T.createCharacter('# Corvin');
  dbx.before = endpoint => { if (endpoint === 'files/upload') { dbx.before = null; dbx.live.clear(); } };
  await T.dropboxFlush();
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.deepEqual(remoteNames(T, dbx), ['Aria', 'Brannoc', 'Corvin']);

  // The user removes the app from their Dropbox account: refresh fails too.
  dbx.live.clear();
  dbx.refresh.clear();
  T.createCharacter('# Offline Edit');
  await T.dropboxFlush();
  assert.strictEqual(T.dropboxState().status, 'signed-out');
  assert.strictEqual(window.localStorage.getItem(T.DROPBOX_TOKEN_KEY), null, 'the dead tokens are dropped');
  assert.match($('#dbx-status').textContent, /Reconnect/);
  assert.strictEqual($('#dbx-connect').textContent, 'Reconnect');
  assert.deepEqual(names(T), ['Aria', 'Brannoc', 'Corvin', 'Offline Edit']);

  // Reconnect in the header sends the tab to Dropbox, which redirects back.
  const sent = [];
  T.dropboxRedirect = u => sent.push(u);
  click($('#dbx-status'));
  await settle(5);
  assert.strictEqual(sent.length, 1, 'Reconnect goes to Dropbox');
  const auth = new URL(sent[0]);
  dbx.challenge = auth.searchParams.get('code_challenge');
  window.history.replaceState(null, '', '/?code=' + GOOD_CODE + '&state=' + auth.searchParams.get('state'));
  await T.dropboxFinishRedirect();
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.deepEqual(remoteNames(T, dbx), ['Aria', 'Brannoc', 'Corvin', 'Offline Edit']);
  window.close();
});

test('Dropbox sync: a change made on another device is pulled when this browser has no changes; only that file is downloaded', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  addRemoteCharacter(T, dbx, 'Corvin');

  const writes = dbx.writes().length;
  const downloads = dbx.calls.filter(c => c === 'files/download').length;
  await T.dropboxSyncNow();
  assert.deepEqual(names(T), ['Aria', 'Corvin']);
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.ok($('#dbx-modal').hidden, 'no question when only Dropbox changed');
  assert.strictEqual(dbx.calls.filter(c => c === 'files/download').length - downloads, 1, 'only the changed file');
  assert.deepEqual((await savedState(T)).characters.map(c => c.name), ['Aria', 'Corvin'], 'saved locally');
  await T.dropboxSyncNow();
  assert.strictEqual(dbx.writes().length - writes, 1, 'the pull adds an HP tracker here, once; it is not a loop');
  const again = dbx.writes().length;
  await T.dropboxSyncNow();
  assert.strictEqual(dbx.writes().length, again, 'then nothing');
  window.close();
});

test('Dropbox sync: an edit made while a pull downloads is not lost: the pull becomes a question', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  addRemoteCharacter(T, dbx, 'Corvin');
  dbx.onDownload = () => { dbx.onDownload = null; T.createCharacter('# Mid-pull'); };
  await T.dropboxSyncNow();
  assert.strictEqual(T.dropboxState().status, 'conflict');
  assert.strictEqual(T.dropboxState().conflict.mode, 'conflict');
  assert.ok(!$('#dbx-modal').hidden);
  assert.deepEqual(names(T), ['Aria', 'Mid-pull']);
  window.close();
});

test('Dropbox sync: another device writing between the listing and the upload is caught by the rev, not overwritten', async () => {
  const env = await setup();
  const { T, window, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  T.createCharacter('# Local Only');
  // The other device writes right after this pass listed the folder.
  dbx.before = endpoint => { if (endpoint === 'files/upload') { dbx.before = null; addRemoteCharacter(T, dbx, 'Remote Only'); } };
  await T.dropboxFlush();
  await settle();
  assert.ok(dbx.calls.includes('files/upload update /campaigns/' + T.campaignId + '/osr.json'));
  assert.ok(remoteNames(T, dbx).includes('Remote Only'), 'the other device\'s write survives');
  assert.ok(T.dropboxState().status === 'conflict' || T.dropboxState().status === 'pending');
  window.close();
});

test('Dropbox sync: both sides changed → the dialog asks once for the campaign; "Keep this browser\'s copy" overwrites Dropbox', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  addRemoteCharacter(T, dbx, 'Remote Only');
  T.createCharacter('# Local Only');
  await T.dropboxFlush();

  assert.strictEqual(T.dropboxState().status, 'conflict');
  assert.ok(!$('#dbx-modal').hidden);
  assert.strictEqual($('#dbx-modal-title').textContent, 'Dropbox copy changed');
  assert.match($('#dbx-modal-text').textContent, /Files: osr\.json\./);
  assert.match($('#dbx-modal-compare').textContent, /Dropbox.*2 characters.*Only here: Remote Only\.[\s\S]*This browser: 2 characters.*Only here: Local Only\./);
  assert.match($('#dbx-status').textContent, /Resolve/);
  assert.ok(remoteNames(T, dbx).includes('Remote Only'), 'nothing is overwritten before the user decides');

  T.createCharacter('# Later');
  await T.dropboxFlush();
  assert.strictEqual(T.dropboxState().status, 'conflict', 'saves wait while the question is open');

  click($('#dbx-use-local'));
  await settle();
  assert.deepEqual(remoteNames(T, dbx), ['Aria', 'Local Only', 'Later']);
  assert.ok($('#dbx-modal').hidden);
  assert.strictEqual(T.dropboxState().status, 'synced');
  window.close();
});

test('Dropbox sync: "Use the Dropbox copy" replaces this browser\'s documents', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  addRemoteCharacter(T, dbx, 'Remote Only');
  T.createCharacter('# Local Only');
  await T.dropboxFlush();
  assert.strictEqual(T.dropboxState().status, 'conflict');

  click($('#dbx-use-remote'));
  await settle(5);
  assert.deepEqual(names(T), ['Aria', 'Remote Only']);
  assert.ok($('#dbx-modal').hidden);
  await T.dropboxFlush(); // the "Replaced…" log line and the new HP tracker are local changes: they upload
  assert.deepEqual(remoteNames(T, dbx), ['Aria', 'Remote Only']);
  assert.strictEqual(T.dropboxState().status, 'synced');
  window.close();
});

test('Dropbox sync: Disconnect revokes and forgets the tokens and the file records, keeps the app key, and leaves both copies', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  const files = dbx.files.size;
  click($('#dbx-disconnect'));
  await tick();
  const st = T.dropboxState();
  assert.strictEqual(st.status, 'off');
  assert.strictEqual(st.meta.enabled, false);
  assert.deepEqual(st.meta.files, {});
  assert.strictEqual(st.meta.appKey, APP_KEY);
  assert.strictEqual(window.localStorage.getItem(T.DROPBOX_TOKEN_KEY), null);
  assert.ok(dbx.calls.includes('auth/token/revoke'));
  assert.ok($('#dbx-status').hidden);
  assert.strictEqual(dbx.files.size, files, 'the Dropbox files stay');
  assert.deepEqual(names(T), ['Aria'], 'the local campaign stays');
  const writes = dbx.writes().length;
  T.createCharacter('# After');
  await T.dropboxFlush();
  assert.strictEqual(dbx.writes().length, writes, 'no uploads after Disconnect');
  window.close();
});

test('Dropbox sync: a reload with sync on pulls newer Dropbox files at boot; without tokens it asks to reconnect; old Google Drive keys are removed', async () => {
  const shared = newDropbox();
  const first = await setup({ dbx: shared });
  first.T.createCharacter('# Aria');
  await connect(first);
  const ls = {};
  ['osr_dropbox_v1', 'osr_dropbox_token'].forEach(k => { ls[k] = first.window.localStorage.getItem(k); });
  const idb = first.indexedDB;
  const cid = first.T.campaignId;
  first.window.close();

  addRemoteCharacter(first.T, shared, 'From Dropbox', cid);
  const env = await boot({
    indexedDB: idb,
    extraStorage: Object.assign({ osr_gdrive_v1: JSON.stringify({ enabled: true }), osr_gdrive_token: JSON.stringify({ token: 'old' }) }, ls),
    beforeScripts(window) { fakeDropbox(window, shared); }
  });
  await settle();
  assert.strictEqual(env.T.dropboxState().status, 'synced');
  assert.deepEqual(names(env.T), ['Aria', 'From Dropbox']);
  assert.strictEqual(env.window.localStorage.getItem('osr_gdrive_v1'), null);
  assert.strictEqual(env.window.localStorage.getItem('osr_gdrive_token'), null);
  env.window.close();

  const env2 = await boot({
    indexedDB: idb,
    extraStorage: { osr_dropbox_v1: ls.osr_dropbox_v1 },
    beforeScripts(window) { window.fetch = () => { throw new Error('no fetch without a token'); }; }
  });
  assert.strictEqual(env2.T.dropboxState().status, 'signed-out');
  assert.match(env2.document.querySelector('#dbx-status').textContent, /Reconnect/);
  env2.window.close();
});

/* ---- Redirect sign-in ---- */

// Connect (redirect flow) in one tab, then boot the app again at the URL Dropbox
// redirects back to, with that tab's sessionStorage. Returns the second boot.
async function redirectRoundTrip({ code = GOOD_CODE, state, error, keepPending = true } = {}) {
  const env = await setup();
  const { T, window, $ } = env;
  const sent = [];
  T.dropboxRedirect = u => sent.push(u);
  click($('#dbx-connect'));
  await settle(5);
  assert.strictEqual(sent.length, 1);
  const auth = new URL(sent[0]);
  const pending = window.sessionStorage.getItem(T.DROPBOX_PENDING_KEY);
  window.close();

  const q = new URLSearchParams();
  if (error) q.set('error', error); else q.set('code', code);
  q.set('state', state == null ? auth.searchParams.get('state') : state);
  let dbx;
  const back = await boot({
    url: 'https://osr.test/?' + q + '#settings',
    storage: blankSave(), // a saved campaign: no reset() after boot, which would queue another upload
    session: keepPending ? { [T.DROPBOX_PENDING_KEY]: pending } : {},
    beforeScripts(w) { dbx = fakeDropbox(w); dbx.challenge = auth.searchParams.get('code_challenge'); }
  });
  await settle();
  return Object.assign(back, { auth, dbx, $: s => back.document.querySelector(s) });
}

test('Dropbox sync: Connect sends the tab to Dropbox with a redirect back to the app; the reply connects, syncs, and leaves a clean URL', async () => {
  const env = await setup();
  assert.strictEqual(env.$('#dbx-redirect-uri').textContent, 'https://osr.test/', 'Setup shows the redirect URI to register');
  env.window.close();

  const back = await redirectRoundTrip();
  const { T, window, dbx, auth } = back;
  assert.strictEqual(auth.origin + auth.pathname, 'https://www.dropbox.com/oauth2/authorize');
  assert.strictEqual(auth.searchParams.get('redirect_uri'), 'https://osr.test/');
  assert.strictEqual(auth.searchParams.get('token_access_type'), 'offline');
  assert.match(auth.searchParams.get('state'), /^[A-Za-z0-9_-]{16,}$/);

  assert.strictEqual(dbx.tokenParams.get('redirect_uri'), 'https://osr.test/', 'the token request repeats the redirect URI');
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.strictEqual(T.dropboxState().meta.enabled, true);
  assert.ok(dbx.file('/campaigns/index.json'));
  assert.strictEqual(window.location.search, '', 'the code is removed from the address bar');
  assert.strictEqual(window.location.hash, '#settings', 'the rest of the URL stays');
  assert.strictEqual(window.sessionStorage.getItem(T.DROPBOX_PENDING_KEY), null, 'the verifier is used once');
  window.close();
});

test('Dropbox sync: a redirect reply with the wrong state, without a pending sign-in, or with an error does not connect', async () => {
  const wrong = await redirectRoundTrip({ state: 'not-the-one' });
  assert.strictEqual(wrong.T.dropboxState().meta.enabled, false);
  assert.ok(!wrong.dbx.calls.some(c => c.startsWith('token')), 'the code is never traded');
  assert.strictEqual(wrong.window.location.search, '');
  wrong.window.close();

  const stale = await redirectRoundTrip({ keepPending: false });
  assert.strictEqual(stale.T.dropboxState().meta.enabled, false);
  assert.deepEqual(stale.dbx.calls, [], 'a copied or old link does nothing');
  assert.strictEqual(stale.window.location.search, '');
  stale.window.close();

  const denied = await redirectRoundTrip({ error: 'access_denied' });
  assert.strictEqual(denied.T.dropboxState().meta.enabled, false);
  assert.deepEqual(denied.dbx.calls, []);
  assert.strictEqual(denied.window.location.search, '');
  denied.window.close();
});

test('Dropbox sync: a refused redirect code shows the sign-in message and keeps sync off', async () => {
  let alerted = '';
  const env = await setup();
  const sent = [];
  env.T.dropboxRedirect = u => sent.push(u);
  click(env.$('#dbx-connect'));
  await settle(5);
  const auth = new URL(sent[0]);
  env.window.alert = m => { alerted = m; };
  env.dbx.challenge = auth.searchParams.get('code_challenge');
  env.window.history.replaceState(null, '', '/?code=expired&state=' + auth.searchParams.get('state'));
  await env.T.dropboxFinishRedirect();
  assert.match(alerted, /did not accept the sign-in/);
  assert.strictEqual(env.T.dropboxState().meta.enabled, false);
  assert.strictEqual(env.window.location.search, '');
  env.window.close();
});

/* ---- The old single file (versions before the split) ---- */

test('Dropbox sync: an old campaign file this browser synced is moved aside and split into per-system files, with no question', async () => {
  const shared = newDropbox();
  const prep = await boot();
  prep.T.createCharacter('# Aria');
  prep.T.createCharacter('# Kevin\n```ua\nWound Threshold: 50\n```');
  await prep.T.flushSave();
  const text = legacyText(prep.T);
  const fileId = shared.put(text);
  const f = shared.files.get(fileId);
  const remoteHash = require('./helpers/fake-dropbox.js').contentHash(text);
  const idb = prep.indexedDB;
  prep.window.close();

  // This browser last synced exactly that file (the flat record of the oldest version).
  const env = await boot({
    indexedDB: idb,
    extraStorage: {
      osr_dropbox_v1: JSON.stringify({ enabled: true, appKey: APP_KEY, fileId, remoteHash, syncedHash: prep.T.hashText(text) }),
      osr_dropbox_token: JSON.stringify({ token: 'tok-1', expiresAt: Date.now() + 3600e3, refresh: 'ref-1', appKey: APP_KEY })
    },
    beforeScripts(window) { fakeDropbox(window, shared); shared.live.add('tok-1'); }
  });
  await settle();
  const { T } = env;
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.ok(env.document.querySelector('#dbx-modal').hidden, 'no question');
  assert.strictEqual(f.path, '/Character Keeper campaign (before split).json', 'the old file is kept under a new name');
  assert.strictEqual(f.content, text, 'unchanged');
  assert.deepEqual(remoteNames(T, shared), ['Aria', 'Kevin']);
  assert.deepEqual(shared.json(docPath(T.campaignId, 'ua3e')).characters.map(c => c.name), ['Kevin']);
  const st = T.dropboxState().meta;
  assert.ok(st.migrated[T.campaignId]);
  assert.deepEqual(st.legacy, {});
  assert.ok(!('fileId' in st));
  env.window.close();
});

test('Dropbox sync: a first connect to a Dropbox with a different old campaign file asks; "Use the Dropbox copy" then splits it', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Local Hero');
  const oldId = dbx.put(legacyText(T, 'Dropbox Hero').replace('"Local Hero"', '"Old Hero"'));

  await connect(env);
  assert.strictEqual(T.dropboxState().status, 'conflict');
  assert.strictEqual(T.dropboxState().conflict.mode, 'link');
  assert.strictEqual($('#dbx-modal-title').textContent, 'Campaign found in Dropbox');
  assert.ok($('#dbx-use-remote').classList.contains('btn-primary'));
  assert.deepEqual(dbx.writes(), [], 'nothing is uploaded before the user decides');

  click($('#dbx-use-remote'));
  await settle(5);
  assert.deepEqual(names(T), ['Old Hero', 'Dropbox Hero']);
  await T.dropboxFlush();
  await settle();
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.strictEqual(dbx.files.get(oldId).path, '/Character Keeper campaign (before split).json');
  assert.deepEqual(remoteNames(T, dbx), ['Old Hero', 'Dropbox Hero']);
  window.close();
});

test('Dropbox sync: the per-campaign file of the previous version (/campaigns/<id>/campaign.json) is split too', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  window.prompt = () => 'Second Game';
  setValue($('#campaign-select'), '__new');
  await settle();
  const second = T.campaignId;
  T.createCharacter('# Brannoc');
  await T.flushSave();
  // That version synced the second campaign as one file, recorded by campaign id.
  const text = legacyText(T);
  const id = dbx.put(text, '/campaigns/' + second + '/campaign.json');
  const metaNow = JSON.parse(window.localStorage.getItem(T.DROPBOX_META_KEY) || '{}');
  metaNow.files = { [second]: { fileId: id, remoteHash: require('./helpers/fake-dropbox.js').contentHash(text), syncedHash: T.hashText(text) } };
  window.close();

  const again = await boot({
    indexedDB: env.indexedDB,
    extraStorage: { [T.DROPBOX_META_KEY]: JSON.stringify(metaNow) },
    beforeScripts(w) { fakeDropbox(w, dbx); }
  });
  const T2 = again.T;
  assert.deepEqual(T2.dropboxState().meta.legacy[second].fileId, id, 'the old record moved to meta.legacy');
  setValue(again.document.querySelector('#dbx-app-key'), APP_KEY);
  const opened = fakeOpen(again.window);
  await T2.dropboxConnectWithCode();
  dbx.challenge = new URL(opened[0].location.href).searchParams.get('code_challenge');
  await T2.dropboxFinishConnect(GOOD_CODE);
  await settle();
  assert.strictEqual(T2.campaignId, second);
  assert.strictEqual(T2.dropboxState().status, 'synced');
  assert.strictEqual(dbx.files.get(id).path, '/campaigns/' + second + '/campaign (before split).json');
  assert.deepEqual(remoteNames(T2, dbx), ['Brannoc']);
  again.window.close();
});

/* ---- Campaigns across devices ---- */

test('Dropbox sync: each campaign has its own folder; a pending upload goes to the campaign it belongs to', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  const first = T.campaignId;

  window.prompt = () => 'Second Game';
  setValue($('#campaign-select'), '__new');
  await settle();
  const second = T.campaignId;
  await T.dropboxFlush();
  assert.ok(dbx.file(docPath(second, 'osr')), 'the new campaign gets its own files');
  assert.deepEqual(remoteNames(T, dbx, second), []);
  assert.deepEqual(dbx.json('/campaigns/index.json').map(c => c.name), ['Default', 'Second Game']);

  // An edit, then a switch before the upload ran: it goes to the second campaign's files.
  T.createCharacter('# Brannoc');
  assert.strictEqual(T.dropboxState().status, 'pending');
  setValue($('#campaign-select'), first);
  await settle();
  assert.deepEqual(remoteNames(T, dbx, second), ['Brannoc']);
  assert.deepEqual(remoteNames(T, dbx, first), ['Aria']);
  assert.deepEqual(names(T), ['Aria']);
  window.close();
});

test('Dropbox sync: a second device takes over the campaign in Dropbox, sees the other campaigns, and downloads one when it opens it', async () => {
  const shared = newDropbox();
  const a = await setup({ dbx: shared });
  a.T.createCharacter('# Aria');
  await connect(a);
  a.window.prompt = () => 'Second Game';
  setValue(a.$('#campaign-select'), '__new');
  await settle();
  a.T.createCharacter('# Brannoc');
  await a.T.dropboxFlush();
  const [aFirst, aSecond] = a.T.campaigns.map(c => c.id);
  a.window.close();

  // A fresh device: one blank campaign of its own.
  const b = await setup({ dbx: shared });
  const { T } = b;
  await connect(b);
  assert.strictEqual(T.campaignId, aFirst, 'its first campaign took the id of the one in Dropbox');
  assert.deepEqual(T.campaigns.map(c => c.name), ['Default', 'Second Game']);
  // Its blank campaign differs from Aria's: it asks once.
  assert.strictEqual(T.dropboxState().status, 'conflict');
  assert.strictEqual(T.dropboxState().conflict.mode, 'link');
  click(b.$('#dbx-use-remote'));
  await settle();
  assert.deepEqual(names(T), ['Aria']);

  setValue(b.$('#campaign-select'), aSecond);
  await settle();
  assert.strictEqual(T.campaignId, aSecond);
  assert.deepEqual(names(T), ['Brannoc'], 'downloaded, not seeded empty');
  await T.dropboxFlush();
  await settle();
  assert.strictEqual(T.dropboxState().status, 'synced', 'no question: it is the same campaign');
  b.window.close();
});

test('Dropbox sync: a campaign deleted in this browser does not come back from the index', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  await connect(env);
  window.prompt = () => 'Doomed';
  setValue($('#campaign-select'), '__new');
  await settle();
  const doomed = T.campaignId;
  await T.dropboxFlush();
  window.confirm = () => true;
  click($('#set-campaign-delete'));
  await settle();
  assert.deepEqual(T.campaigns.map(c => c.name), ['Default']);
  assert.ok(T.dropboxState().meta.hidden[doomed]);
  await T.dropboxSyncNow();
  assert.deepEqual(T.campaigns.map(c => c.name), ['Default']);
  assert.ok(dbx.file(docPath(doomed, 'osr')), 'its Dropbox files stay');
  window.close();
});

/* ---- Seeds ---- */

test('Dropbox sync: a content pack imported on one device reaches the seed of another, which offers it in Settings', async () => {
  const shared = newDropbox();
  const a = await setup({ dbx: shared });
  await connect(a);
  const pack = { pack: { name: 'Night Pack', system: 'ua3e' },
    compendium: [{ ref: 'np-1', name: 'Night Shift', category: 'Rules', body: 'Work at night.' }],
    monsters: [{ ref: 'np-m1', name: 'Night Clerk', source: 'ua3e', desc: 'Tired.' }] };
  await a.T.importData(new a.window.File([JSON.stringify(pack)], 'pack.json', { type: 'application/json' }));
  await a.T.dropboxFlush();
  await settle();
  const seed = shared.json('/seeds/ua3e.json');
  assert.deepEqual(seed.compendium.map(e => e.seedRef), ['np-1']);
  assert.deepEqual(seed.monsters.map(m => m.seedRef), ['np-m1']);
  const cid = a.T.campaignId;
  a.window.close();

  const b = await setup({ dbx: shared });
  await connect(b);
  click(b.$('#dbx-use-remote')); // its blank campaign → the one in Dropbox
  await settle();
  assert.strictEqual(b.T.campaignId, cid);
  assert.deepEqual(b.T.seeds.ua3e.compendium.map(e => e.name), ['Night Shift'], 'the seed came from Dropbox');
  // A new campaign on this device is offered the pack.
  b.window.prompt = () => 'Fresh';
  setValue(b.$('#campaign-select'), '__new');
  await settle();
  setValue(b.$('#set-system'), 'ua3e');
  assert.ok(!b.$('#set-seed-row').hidden);
  assert.match(b.$('#set-seed-text').textContent, /1 new|2 new/);
  click(b.$('#set-seed-apply'));
  assert.deepEqual(b.T.state.compendium.filter(e => e.system === 'ua3e').map(e => e.name), ['Night Shift']);
  assert.ok(b.$('#set-seed-row').hidden);
  b.window.close();
});

test('Dropbox sync: seeds changed on both devices are merged without a question', async () => {
  const env = await setup();
  const { T, window, dbx } = env;
  await connect(env);
  const remote = dbx.json('/seeds/osr.json');
  remote.version += 1;
  remote.compendium.push({ name: 'Remote Gear', category: 'Items', body: 'From the other device.', seedRef: 'osr:c:remote gear' });
  dbx.edit(dbx.file('/seeds/osr.json').id, JSON.stringify(remote));
  await T.addToSeed('osr', [{ name: 'Local Gear', category: 'Items', body: 'From here.' }], []);
  await T.dropboxFlush();
  await settle();
  const names2 = dbx.json('/seeds/osr.json').compendium.map(e => e.name);
  assert.ok(names2.includes('Remote Gear') && names2.includes('Local Gear'));
  assert.ok(T.seeds.osr.compendium.some(e => e.name === 'Remote Gear'));
  assert.strictEqual(T.dropboxState().status, 'synced');
  window.close();
});

test('Dropbox sync: the flat sync record of the oldest version and the per-campaign records of the previous one move to meta.legacy', async () => {
  const env = await boot({
    extraStorage: {
      osr_dropbox_v1: JSON.stringify({ enabled: true, appKey: APP_KEY, fileId: 'id:f1', remoteHash: 'r', syncedHash: 's', lastSync: 5, files: { abc: { fileId: 'id:f2' } } })
    },
    beforeScripts(window) { fakeDropbox(window); } // no token: boot asks to reconnect, no API call
  });
  const stored = JSON.parse(env.window.localStorage.getItem('osr_dropbox_v1'));
  const primary = env.T.campaigns.find(c => c.primary);
  assert.ok(!('fileId' in stored));
  assert.strictEqual(stored.legacy[primary.id].fileId, 'id:f1');
  assert.strictEqual(stored.legacy[primary.id].syncedHash, 's');
  assert.strictEqual(stored.legacy.abc.fileId, 'id:f2');
  assert.deepEqual(stored.files, {});
  env.window.close();
});

test('Dropbox sync: a pull that the browser storage refuses is not recorded, so a reload cannot upload the old copy over it', async () => {
  const env = await setup();
  const { T, window, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  addRemoteCharacter(T, dbx, 'Corvin');
  const path = '/campaigns/' + T.campaignId + '/osr.json';
  const before = T.dropboxState().meta.files[path.toLowerCase()];
  const putDocs = T.store.putDocs;
  T.store.putDocs = () => Promise.reject(new window.DOMException('quota', 'QuotaExceededError'));
  await T.dropboxSyncNow();
  assert.strictEqual(T.dropboxState().status, 'error');
  assert.match(T.dropboxState().message, /storage is full/);
  assert.deepEqual(T.dropboxState().meta.files[path.toLowerCase()], before, 'the record is unchanged');

  T.store.putDocs = putDocs;
  await T.dropboxSyncNow();
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.deepEqual(names(T), ['Aria', 'Corvin']);
  window.close();
});

/* ---- Map images (js/maps.js) ---- */

test('Dropbox sync: a map image is uploaded once to the campaign\'s maps folder; another device downloads it when it shows the scene', async () => {
  const shared = newDropbox();
  const a = await setup({ dbx: shared });
  a.T.decodeImage = async blob => ({ blob: new a.window.Blob([await blob.arrayBuffer()], { type: 'image/webp' }), width: 300, height: 200 });
  await connect(a);
  const { scene } = await a.T.createScene({ name: 'Shared Map', file: new a.window.File([new Uint8Array([9, 8, 7, 6])], 'm.png', { type: 'image/png' }) });
  await a.T.dropboxFlush();
  await settle();
  const cid = a.T.campaignId;
  const path = '/campaigns/' + cid + '/maps/' + scene.imageBlobId + '.webp';
  const f = shared.file(path);
  assert.ok(f, 'uploaded');
  assert.deepEqual(Array.from(f.content), [9, 8, 7, 6]);
  assert.deepEqual(shared.json(docPath(cid, 'osr')).scenes.map(s => s.name), ['Shared Map']);
  const uploads = shared.writes().filter(w => w.includes('/maps/')).length;
  a.T.createCharacter('# Later');
  await a.T.dropboxFlush();
  assert.strictEqual(shared.writes().filter(w => w.includes('/maps/')).length, uploads, 'not uploaded again');
  a.window.close();

  const b = await setup({ dbx: shared });
  b.T.mapRect = () => ({ left: 0, top: 0, width: 1000, height: 700 });
  await connect(b);
  click(b.$('#dbx-use-remote'));
  await settle();
  assert.strictEqual(await b.T.store.getBlob(scene.imageBlobId), undefined, 'not downloaded before it is needed');
  click(b.$('#tabs .tab-btn[data-tab="maps"]'));
  await settle();
  const rec = await b.T.store.getBlob(scene.imageBlobId);
  assert.deepEqual(Array.from(new Uint8Array(rec.bytes)), [9, 8, 7, 6]);
  assert.ok(b.$('#map-svg image'), 'shown');
  await settle();
  b.window.close();
});
