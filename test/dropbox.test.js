'use strict';

/*
 * Dropbox sync (js/dropbox.js). Each test boots its own app (sync state is
 * per-device localStorage, so tests must not share it) with two fakes:
 *   - window.open: records the Dropbox consent URL (the real one opens a tab
 *     where the user clicks Allow and copies a code);
 *   - fakeDropbox: window.fetch serving the OAuth token endpoint and the few
 *     Dropbox v2 calls the app makes, with an in-memory app folder, real revs,
 *     and real content_hash values.
 * Nothing here talks to Dropbox.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const crypto = require('node:crypto');
const { boot, blankSave, click, setValue } = require('./helpers/boot.js');

const APP_KEY = 'testappkey123';
const GOOD_CODE = 'code-ok';
const tick = () => new Promise(r => setTimeout(r, 0)); // lets an un-awaited fetch chain finish

// Dropbox's content_hash: SHA-256 of the concatenated SHA-256s of each 4 MB block.
function contentHash(s) {
  const buf = Buffer.from(s, 'utf8'), parts = [];
  for (let i = 0; i < buf.length; i += 4 * 1024 * 1024) parts.push(crypto.createHash('sha256').update(buf.subarray(i, i + 4 * 1024 * 1024)).digest());
  return crypto.createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}

function fakeOpen(window) {
  const opened = [];
  window.open = () => { const tab = { opener: window, location: { href: '' } }; opened.push(tab); return tab; };
  return opened;
}

function fakeDropbox(window) {
  const dbx = { files: new Map(), calls: [], nextId: 1, nextRev: 1, nextTok: 1, live: new Set(), refresh: new Set(), challenge: null };
  const res = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: k => headers[k.toLowerCase()] || null },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const err = summary => res(409, { error_summary: summary + '/..', error: {} });
  const meta = f => ({ '.tag': 'file', id: f.id, name: f.name, path_lower: f.path.toLowerCase(), path_display: f.path,
    rev: f.rev, content_hash: contentHash(f.content), server_modified: f.modified, size: f.content.length });
  const bump = (f, content) => {
    f.content = content; f.rev = 'r' + dbx.nextRev++; f.modified = new Date().toISOString(); f.revs[f.rev] = content;
  };
  dbx.put = (content, path = '/Character Keeper campaign.json') => {
    const f = { id: 'id:f' + dbx.nextId++, name: path.slice(1), path, revs: {} };
    bump(f, content);
    dbx.files.set(f.id, f);
    return f.id;
  };
  dbx.edit = (id, content) => bump(dbx.files.get(id), content);
  dbx.only = () => { assert.strictEqual(dbx.files.size, 1, 'exactly one file in Dropbox'); return [...dbx.files.values()][0]; };
  dbx.writes = () => dbx.calls.filter(c => c.startsWith('files/upload'));
  const byPath = p => p.startsWith('id:') ? dbx.files.get(p)
    : [...dbx.files.values()].find(f => f.path.toLowerCase() === p.toLowerCase());
  const issue = () => { const t = 'tok-' + dbx.nextTok++; dbx.live.add(t); return t; };

  window.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname === '/oauth2/token') {
      const p = new URLSearchParams(opts.body);
      dbx.calls.push('token ' + p.get('grant_type'));
      dbx.tokenParams = p;
      assert.strictEqual(p.get('client_id'), APP_KEY);
      assert.ok(!p.has('client_secret'), 'PKCE: no app secret');
      if (p.get('grant_type') === 'authorization_code') {
        if (p.get('code') !== GOOD_CODE || p.get('code_verifier') !== dbx.challenge) return res(400, { error: 'invalid_grant', error_description: 'code doesn\'t exist or has expired' });
        const refresh = 'ref-' + dbx.nextTok;
        dbx.refresh.add(refresh);
        return res(200, { access_token: issue(), expires_in: 14400, token_type: 'bearer', refresh_token: refresh, account_id: 'dbid:1' });
      }
      if (!dbx.refresh.has(p.get('refresh_token'))) return res(400, { error: 'invalid_grant', error_description: 'refresh token is malformed' });
      return res(200, { access_token: issue(), expires_in: 14400, token_type: 'bearer' });
    }
    const endpoint = u.pathname.replace(/^\/2\//, '');
    const token = /^Bearer (.+)$/.exec(opts.headers.Authorization)[1];
    if (!dbx.live.has(token)) { dbx.calls.push(endpoint + ' 401'); return res(401, { error_summary: 'expired_access_token/' }); }
    const arg = JSON.parse(opts.headers['Dropbox-API-Arg'] || opts.body || '{}');
    dbx.calls.push(endpoint + (arg.mode ? ' ' + (arg.mode['.tag'] || arg.mode) : ''));
    if (endpoint === 'auth/token/revoke') { dbx.live.delete(token); return res(200, null); }
    if (endpoint === 'files/get_metadata') {
      const f = byPath(arg.path);
      return f ? res(200, meta(f)) : err('path/not_found');
    }
    if (endpoint === 'files/download') {
      const rev = /^rev:(.+)$/.exec(arg.path)[1];
      const f = [...dbx.files.values()].find(x => rev in x.revs);
      if (!f) return err('path/not_found');
      const content = f.revs[rev];
      if (dbx.onDownload) dbx.onDownload();
      return res(200, content, { 'dropbox-api-result': JSON.stringify(meta(f)) });
    }
    if (endpoint === 'files/upload') {
      assert.strictEqual(opts.headers['Content-Type'], 'application/octet-stream');
      const f = byPath(arg.path);
      if (arg.mode === 'add') {
        if (f) return err('path/conflict/file');
        const id = dbx.put(opts.body, arg.path);
        return res(200, meta(dbx.files.get(id)));
      }
      if (!f) return err('path/not_found');
      if (f.rev !== arg.mode.update) return err('path/conflict/file');
      bump(f, opts.body);
      return res(200, meta(f));
    }
    return res(500, { error_summary: 'fake Dropbox: unhandled ' + url });
  };
  return dbx;
}

async function setup(opts) {
  const env = await boot(opts);
  const { window, document } = env;
  env.$ = s => document.querySelector(s);
  env.dbx = fakeDropbox(window);
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
  for (let i = 0; i < 20; i++) await tick();
  return url;
}

// A copy of `state` as another device would have saved it, with one more character.
function withCharacter(T, name) {
  const s = JSON.parse(JSON.stringify(T.state));
  s.characters.push({ id: 'remote-' + name, name, system: '', body: '# ' + name + '\n' });
  return JSON.stringify(s);
}
const names = T => T.state.characters.map(c => c.name);
const remoteNames = dbx => JSON.parse(dbx.only().content).characters.map(c => c.name);

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

test('Dropbox sync: "Connect with a code" opens Dropbox, the pasted code creates the campaign file, then a save uploads it again; tokens never enter the campaign', async () => {
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
  for (let i = 0; i < 20; i++) await tick();
  const f = dbx.only();
  assert.strictEqual(f.path, '/Character Keeper campaign.json');
  assert.deepEqual(remoteNames(dbx), ['Aria']);
  assert.ok(dbx.calls.includes('files/upload add'));
  const st = T.dropboxState();
  assert.strictEqual(st.status, 'synced');
  assert.strictEqual(st.meta.fileId, f.id);
  assert.strictEqual(st.auth, null);
  assert.ok($('#dbx-code-row').hidden);
  assert.ok(!$('#dbx-status').hidden);
  assert.match($('#dbx-status').textContent, /Synced/);
  assert.match($('#dbx-hint').textContent, /Connected/);
  assert.ok($('#dbx-connect').hidden && !$('#dbx-sync').hidden && !$('#dbx-disconnect').hidden);

  const tok = JSON.parse(window.localStorage.getItem(T.DROPBOX_TOKEN_KEY));
  assert.match(tok.refresh, /^ref-/);
  const saved = window.localStorage.getItem(T.STORAGE_KEY);
  assert.ok(!/tok-\d|ref-\d|osr_dropbox/.test(saved), 'tokens and sync bookkeeping stay out of OSR.state');
  assert.ok(!/tok-\d|ref-\d/.test(f.content), 'and out of the Dropbox file');

  T.createCharacter('# Brannoc\nHP 7/7');
  assert.strictEqual(T.dropboxState().status, 'pending', 'a save queues an upload');
  await T.dropboxFlush();
  assert.deepEqual(remoteNames(dbx), ['Aria', 'Brannoc']);
  assert.strictEqual(dbx.calls[dbx.calls.length - 1], 'files/upload update');
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
  assert.deepEqual(remoteNames(dbx), ['Aria', 'Brannoc']);

  // The access token is revoked early: a 401 triggers one refresh, then the call works.
  dbx.live.clear();
  T.createCharacter('# Corvin');
  await T.dropboxFlush();
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.deepEqual(remoteNames(dbx), ['Aria', 'Brannoc', 'Corvin']);

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
  for (let i = 0; i < 5; i++) await tick();
  assert.strictEqual(sent.length, 1, 'Reconnect goes to Dropbox');
  const auth = new URL(sent[0]);
  dbx.challenge = auth.searchParams.get('code_challenge');
  window.history.replaceState(null, '', '/?code=' + GOOD_CODE + '&state=' + auth.searchParams.get('state'));
  await T.dropboxFinishRedirect();
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.deepEqual(remoteNames(dbx), ['Aria', 'Brannoc', 'Corvin', 'Offline Edit']);
  window.close();
});

test('Dropbox sync: a change made on another device is pulled when this browser has no changes', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  dbx.edit(dbx.only().id, withCharacter(T, 'Corvin'));

  const writes = dbx.writes().length;
  await T.dropboxSyncNow();
  assert.deepEqual(names(T), ['Aria', 'Corvin']);
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.ok($('#dbx-modal').hidden, 'no question when only Dropbox changed');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(T.STORAGE_KEY)).characters.map(c => c.name), ['Aria', 'Corvin'], 'saved locally');
  await T.dropboxSyncNow();
  assert.strictEqual(dbx.writes().length, writes, 'the pull itself is not uploaded back');
  window.close();
});

test('Dropbox sync: an edit made while a pull downloads is not lost: the pull becomes a question', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  dbx.edit(dbx.only().id, withCharacter(T, 'Corvin'));
  dbx.onDownload = () => { dbx.onDownload = null; T.createCharacter('# Mid-pull'); };
  await T.dropboxSyncNow();
  assert.strictEqual(T.dropboxState().status, 'conflict');
  assert.strictEqual(T.dropboxState().conflict.mode, 'conflict');
  assert.ok(!$('#dbx-modal').hidden);
  assert.deepEqual(names(T), ['Aria', 'Mid-pull']);
  window.close();
});

test('Dropbox sync: another device writing between the check and the upload is caught by the rev, not overwritten', async () => {
  const env = await setup();
  const { T, window, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  const id = dbx.only().id;
  T.createCharacter('# Local Only');
  // The other device writes right after this pass read the metadata.
  const fetch = window.fetch;
  window.fetch = async (url, opts) => {
    const r = await fetch(url, opts);
    if (/get_metadata/.test(url) && dbx.files.get(id).content.indexOf('Remote Only') === -1) dbx.edit(id, withCharacter(T, 'Remote Only'));
    return r;
  };
  await T.dropboxFlush();
  for (let i = 0; i < 20; i++) await tick();
  assert.ok(dbx.calls.includes('files/upload update'));
  assert.ok(/Remote Only/.test(dbx.only().content), 'the other device\'s write survives');
  assert.ok(T.dropboxState().status === 'conflict' || T.dropboxState().status === 'pending');
  window.close();
});

test('Dropbox sync: both sides changed → the dialog asks; "Keep this browser\'s copy" overwrites Dropbox', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  dbx.edit(dbx.only().id, withCharacter(T, 'Remote Only'));
  T.createCharacter('# Local Only');
  await T.dropboxFlush();

  assert.strictEqual(T.dropboxState().status, 'conflict');
  assert.ok(!$('#dbx-modal').hidden);
  assert.strictEqual($('#dbx-modal-title').textContent, 'Dropbox copy changed');
  assert.match($('#dbx-modal-compare').textContent, /Dropbox.*2 characters.*Only here: Remote Only\.[\s\S]*This browser: 2 characters.*Only here: Local Only\./);
  assert.match($('#dbx-status').textContent, /Resolve/);
  assert.ok(/Remote Only/.test(dbx.only().content), 'nothing is overwritten before the user decides');

  T.createCharacter('# Later');
  await T.dropboxFlush();
  assert.strictEqual(T.dropboxState().status, 'conflict', 'saves wait while the question is open');

  click($('#dbx-use-local'));
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(remoteNames(dbx), ['Aria', 'Local Only', 'Later']);
  assert.ok($('#dbx-modal').hidden);
  assert.strictEqual(T.dropboxState().status, 'synced');
  window.close();
});

test('Dropbox sync: "Use the Dropbox copy" replaces this browser\'s campaign', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  dbx.edit(dbx.only().id, withCharacter(T, 'Remote Only'));
  T.createCharacter('# Local Only');
  await T.dropboxFlush();
  assert.strictEqual(T.dropboxState().status, 'conflict');

  click($('#dbx-use-remote'));
  assert.deepEqual(names(T), ['Aria', 'Remote Only']);
  assert.ok($('#dbx-modal').hidden);
  await T.dropboxFlush(); // the "Replaced…" log line is a local change: it uploads
  assert.deepEqual(remoteNames(dbx), ['Aria', 'Remote Only']);
  assert.strictEqual(T.dropboxState().status, 'synced');
  window.close();
});

test('Dropbox sync: a browser connecting to an existing Dropbox campaign is asked first, and nothing is uploaded', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Local Hero');
  dbx.put(withCharacter(T, 'Dropbox Hero').replace('"Local Hero"', '"Old Hero"'));

  await connect(env);
  assert.strictEqual(T.dropboxState().status, 'conflict');
  assert.strictEqual(T.dropboxState().conflict.mode, 'link');
  assert.strictEqual($('#dbx-modal-title').textContent, 'Campaign found in Dropbox');
  assert.ok($('#dbx-use-remote').classList.contains('btn-primary'));
  assert.deepEqual(dbx.writes(), []);

  click($('#dbx-use-remote'));
  assert.deepEqual(names(T), ['Old Hero', 'Dropbox Hero']);
  window.close();
});

test('Dropbox sync: a renamed file is still found by its id', async () => {
  const env = await setup();
  const { T, window, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  const f = dbx.only();
  f.path = '/Old campaigns/Renamed.json';
  T.createCharacter('# Brannoc');
  await T.dropboxFlush();
  assert.strictEqual(T.dropboxState().status, 'synced');
  assert.deepEqual(remoteNames(dbx), ['Aria', 'Brannoc'], 'updated in place, no second file');
  window.close();
});

test('Dropbox sync: Disconnect revokes and forgets the tokens and the file link, keeps the app key, and leaves both copies', async () => {
  const env = await setup();
  const { T, window, $, dbx } = env;
  T.createCharacter('# Aria');
  await connect(env);
  click($('#dbx-disconnect'));
  await tick();
  const st = T.dropboxState();
  assert.strictEqual(st.status, 'off');
  assert.strictEqual(st.meta.enabled, false);
  assert.strictEqual(st.meta.fileId, '');
  assert.strictEqual(st.meta.appKey, APP_KEY);
  assert.strictEqual(window.localStorage.getItem(T.DROPBOX_TOKEN_KEY), null);
  assert.ok(dbx.calls.includes('auth/token/revoke'));
  assert.ok($('#dbx-status').hidden);
  assert.strictEqual(dbx.files.size, 1, 'the Dropbox file stays');
  assert.deepEqual(names(T), ['Aria'], 'the local campaign stays');
  T.createCharacter('# After');
  await T.dropboxFlush();
  assert.strictEqual(dbx.writes().length, 1, 'no uploads after Disconnect');
  window.close();
});

test('Dropbox sync: a reload with sync on pulls a newer Dropbox copy at boot; without tokens it asks to reconnect; old Google Drive keys are removed', async () => {
  // This browser's campaign as it was last synced (an already-migrated state, so boot leaves it as is).
  const first = await boot();
  const localText = JSON.stringify(first.T.state);
  const syncedHash = first.T.hashText(localText);
  first.window.close();

  const remote = JSON.parse(localText);
  remote.characters = [{ id: 'c1', name: 'From Dropbox', system: '', body: '# From Dropbox\n' }];
  let dbx;
  const env = await boot({
    storage: localText,
    extraStorage: {
      osr_dropbox_v1: JSON.stringify({ enabled: true, appKey: APP_KEY, fileId: 'id:f1', remoteHash: 'older', syncedHash }),
      osr_dropbox_token: JSON.stringify({ token: 'tok-1', expiresAt: Date.now() + 3600e3, refresh: 'ref-1', appKey: APP_KEY }),
      osr_gdrive_v1: JSON.stringify({ enabled: true }),
      osr_gdrive_token: JSON.stringify({ token: 'old' })
    },
    beforeScripts(window) { dbx = fakeDropbox(window); dbx.live.add('tok-1'); dbx.put(JSON.stringify(remote)); }
  });
  for (let i = 0; i < 20; i++) await tick();
  assert.strictEqual(env.T.dropboxState().status, 'synced');
  assert.deepEqual(names(env.T), ['From Dropbox']);
  assert.deepEqual(dbx.writes(), [], 'pulled, not uploaded');
  assert.strictEqual(env.window.localStorage.getItem('osr_gdrive_v1'), null);
  assert.strictEqual(env.window.localStorage.getItem('osr_gdrive_token'), null);
  env.window.close();

  const env2 = await boot({
    extraStorage: {
      osr_dropbox_v1: JSON.stringify({ enabled: true, appKey: APP_KEY, fileId: 'id:f1', remoteHash: 'x', syncedHash: 'h' })
    },
    beforeScripts(window) { window.fetch = () => { throw new Error('no fetch without a token'); }; }
  });
  assert.strictEqual(env2.T.dropboxState().status, 'signed-out');
  assert.match(env2.document.querySelector('#dbx-status').textContent, /Reconnect/);
  env2.window.close();
});

// Connect (redirect flow) in one tab, then boot the app again at the URL Dropbox
// redirects back to, with that tab's sessionStorage. Returns the second boot.
async function redirectRoundTrip({ code = GOOD_CODE, state, error, keepPending = true } = {}) {
  const env = await setup();
  const { T, window, $ } = env;
  const sent = [];
  T.dropboxRedirect = u => sent.push(u);
  click($('#dbx-connect'));
  for (let i = 0; i < 5; i++) await tick();
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
  for (let i = 0; i < 20; i++) await tick();
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
  assert.strictEqual(dbx.only().path, '/Character Keeper campaign.json');
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
  for (let i = 0; i < 5; i++) await tick();
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
