'use strict';

/*
 * Google Drive sync (js/gdrive.js). Each test boots its own app (sync state is
 * per-device localStorage, so tests must not share it) with two fakes:
 *   - fakeGis: window.google.accounts.oauth2, answering requestAccessToken at once
 *     (the real one opens Google's popup);
 *   - fakeDrive: window.fetch serving the few Drive v3 REST calls the app makes,
 *     with an in-memory file list and real md5Checksum values.
 * Nothing here talks to Google.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const crypto = require('node:crypto');
const { boot, blankSave, click, setValue } = require('./helpers/boot.js');

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const tick = () => new Promise(r => setTimeout(r, 0)); // lets an un-awaited fetch chain finish

function fakeGis(window) {
  const gis = { requests: [], respond: () => ({ access_token: 'tok-' + gis.requests.length, expires_in: 3599, scope: SCOPE }) };
  window.google = { accounts: { oauth2: {
    initTokenClient(cfg) {
      gis.cfg = cfg;
      return { requestAccessToken(o) {
        gis.requests.push(o || {});
        const r = gis.respond(o);
        if (r.type) cfg.error_callback(r); else cfg.callback(r);
      } };
    },
    hasGrantedAllScopes: (resp, scope) => String(resp.scope || '').split(' ').includes(scope)
  } } };
  return gis;
}

function fakeDrive(window) {
  const drive = { files: new Map(), calls: [], nextId: 1, fail401: false };
  const res = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const meta = f => ({ id: f.id, name: f.name, md5Checksum: md5(f.content), modifiedTime: f.modifiedTime, trashed: !!f.trashed });
  drive.put = (content, extra) => {
    const id = 'file' + drive.nextId++;
    drive.files.set(id, Object.assign({ id, name: 'Character Keeper campaign.json', content,
      appProperties: { osrKeeper: 'campaign' }, modifiedTime: new Date().toISOString() }, extra));
    return id;
  };
  drive.edit = (id, content) => { const f = drive.files.get(id); f.content = content; f.modifiedTime = new Date().toISOString(); };
  drive.only = () => { assert.strictEqual(drive.files.size, 1, 'exactly one file in Drive'); return [...drive.files.values()][0]; };
  drive.writes = () => drive.calls.filter(c => /^(POST|PATCH) /.test(c));

  window.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    const ut = u.searchParams.get('uploadType');
    drive.calls.push(method + ' ' + u.pathname + (ut ? '?uploadType=' + ut : u.searchParams.get('alt') ? '?alt=media' : ''));
    if (drive.fail401) return res(401, { error: { message: 'Invalid Credentials' } });
    assert.match(opts.headers.Authorization, /^Bearer tok-\d+$/);
    let m;
    if (method === 'GET' && u.pathname === '/drive/v3/about') return res(200, { user: { emailAddress: 'gm@example.com' } });
    if (method === 'GET' && u.pathname === '/drive/v3/files') {
      assert.match(u.searchParams.get('q'), /appProperties has \{ key='osrKeeper' and value='campaign' \}/);
      const list = [...drive.files.values()].filter(f => !f.trashed && f.appProperties && f.appProperties.osrKeeper === 'campaign');
      return res(200, { files: list.map(meta) });
    }
    if (method === 'GET' && (m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
      const f = drive.files.get(decodeURIComponent(m[1]));
      if (!f) return res(404, { error: { message: 'File not found' } });
      if (u.searchParams.get('alt') !== 'media') return res(200, meta(f));
      const content = f.content;
      if (drive.onDownload) drive.onDownload();
      return res(200, content);
    }
    if (method === 'POST' && u.pathname === '/upload/drive/v3/files' && ut === 'multipart') {
      const boundary = /boundary=(.+)$/.exec(opts.headers['Content-Type'])[1];
      const parts = opts.body.split('--' + boundary).slice(1, -1)
        .map(p => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''));
      const fm = JSON.parse(parts[0]);
      const id = drive.put(parts[1], { name: fm.name, appProperties: fm.appProperties });
      return res(200, meta(drive.files.get(id)));
    }
    if (method === 'PATCH' && (m = u.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)) && ut === 'media') {
      drive.edit(decodeURIComponent(m[1]), opts.body);
      return res(200, meta(drive.files.get(decodeURIComponent(m[1]))));
    }
    return res(500, { error: { message: 'fake Drive: unhandled ' + method + ' ' + url } });
  };
  return drive;
}

async function setup(opts) {
  const env = await boot(opts);
  const { window, document } = env;
  env.$ = s => document.querySelector(s);
  env.drive = fakeDrive(window);
  env.gis = fakeGis(window);
  setValue(env.$('#gd-client-id'), CLIENT_ID);
  return env;
}

// A copy of `state` as another device would have saved it, with one more character.
function withCharacter(T, name) {
  const s = JSON.parse(JSON.stringify(T.state));
  s.characters.push({ id: 'remote-' + name, name, system: '', body: '# ' + name + '\n' });
  return JSON.stringify(s);
}
const names = T => T.state.characters.map(c => c.name);

test('Drive sync: decideSync picks create / link / noop / upload / pull / conflict', async () => {
  const { T, window } = await boot();
  const m = { fileId: 'f1', remoteMd5: 'aaa', syncedHash: 'h1' };
  assert.strictEqual(T.decideSync(null, m, 'h1'), 'create');
  assert.strictEqual(T.decideSync({ id: 'f2', md5Checksum: 'aaa' }, m, 'h1'), 'link', 'another file than the one this device synced');
  assert.strictEqual(T.decideSync({ id: 'f1', md5Checksum: 'aaa' }, { fileId: 'f1', remoteMd5: '', syncedHash: '' }, 'h1'), 'link', 'never synced');
  assert.strictEqual(T.decideSync({ id: 'f1', md5Checksum: 'aaa' }, m, 'h1'), 'noop');
  assert.strictEqual(T.decideSync({ id: 'f1', md5Checksum: 'aaa' }, m, 'h2'), 'upload');
  assert.strictEqual(T.decideSync({ id: 'f1', md5Checksum: 'bbb' }, m, 'h1'), 'pull');
  assert.strictEqual(T.decideSync({ id: 'f1', md5Checksum: 'bbb' }, m, 'h2'), 'conflict');
  assert.strictEqual(T.hashText('abc'), T.hashText('abc'));
  assert.notStrictEqual(T.hashText('abc'), T.hashText('abd'));
  assert.strictEqual(T.driveSupported('file:'), false, 'Google sign-in needs an http(s) origin');
  assert.strictEqual(T.driveSupported('http:'), true);
  assert.strictEqual(T.driveSupported('https:'), true);
  window.close();
});

test('Drive sync: Connect creates the campaign file, then a save uploads it again; the token never enters the campaign', async () => {
  const { T, window, $, drive, gis } = await setup();
  T.createCharacter('# Aria\nHP 5/5');
  assert.ok($('#gd-status').hidden, 'no header status while sync is off');
  assert.strictEqual($('#gd-connect').textContent, 'Connect');

  await T.gdriveConnect(false);
  assert.deepEqual(gis.requests, [{}], 'first connect: Google picks the account (default prompt)');
  const f = drive.only();
  assert.strictEqual(f.name, 'Character Keeper campaign.json');
  assert.deepEqual(f.appProperties, { osrKeeper: 'campaign' });
  assert.deepEqual(JSON.parse(f.content).characters.map(c => c.name), ['Aria']);
  const st = T.gdriveState();
  assert.strictEqual(st.status, 'synced');
  assert.strictEqual(st.meta.email, 'gm@example.com');
  assert.strictEqual(st.meta.fileId, f.id);
  assert.ok(!$('#gd-status').hidden);
  assert.match($('#gd-status').textContent, /Synced/);
  assert.match($('#gd-hint').textContent, /Connected as gm@example\.com/);
  assert.ok($('#gd-connect').hidden && !$('#gd-sync').hidden && !$('#gd-disconnect').hidden);

  const saved = window.localStorage.getItem(T.STORAGE_KEY);
  assert.ok(!/tok-\d|osr_gdrive|gm@example\.com/.test(saved), 'token and sync bookkeeping stay out of OSR.state');
  assert.ok(!/tok-\d/.test(f.content), 'and out of the Drive file');

  T.createCharacter('# Brannoc\nHP 7/7');
  assert.strictEqual(T.gdriveState().status, 'pending', 'a save queues an upload');
  await T.gdriveFlush();
  assert.deepEqual(JSON.parse(drive.only().content).characters.map(c => c.name), ['Aria', 'Brannoc']);
  assert.strictEqual(drive.calls[drive.calls.length - 1], 'PATCH /upload/drive/v3/files/' + f.id + '?uploadType=media');
  assert.strictEqual(T.gdriveState().status, 'synced');

  const writes = drive.writes().length;
  await T.gdriveSyncNow();
  assert.strictEqual(drive.writes().length, writes, 'nothing changed: no upload');
  window.close();
});

test('Drive sync: a change made on another device is pulled when this browser has no changes', async () => {
  const { T, window, $, drive } = await setup();
  T.createCharacter('# Aria');
  await T.gdriveConnect(false);
  const id = drive.only().id;
  drive.edit(id, withCharacter(T, 'Corvin'));

  const writes = drive.writes().length;
  await T.gdriveSyncNow();
  assert.deepEqual(names(T), ['Aria', 'Corvin']);
  assert.strictEqual(T.gdriveState().status, 'synced');
  assert.ok($('#gd-modal').hidden, 'no question when only Drive changed');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(T.STORAGE_KEY)).characters.map(c => c.name), ['Aria', 'Corvin'], 'saved locally');
  await T.gdriveSyncNow();
  assert.strictEqual(drive.writes().length, writes, 'the pull itself is not uploaded back');
  window.close();
});

test('Drive sync: an edit made while a pull downloads is not lost: the pull becomes a question', async () => {
  const { T, window, $, drive } = await setup();
  T.createCharacter('# Aria');
  await T.gdriveConnect(false);
  drive.edit(drive.only().id, withCharacter(T, 'Corvin'));
  drive.onDownload = () => { drive.onDownload = null; T.createCharacter('# Mid-pull'); };
  await T.gdriveSyncNow();
  assert.strictEqual(T.gdriveState().status, 'conflict');
  assert.strictEqual(T.gdriveState().conflict.mode, 'conflict');
  assert.ok(!$('#gd-modal').hidden);
  assert.deepEqual(names(T), ['Aria', 'Mid-pull']);
  window.close();
});

test('Drive sync: both sides changed → the dialog asks; "Keep this browser\'s copy" overwrites Drive', async () => {
  const { T, window, $, drive } = await setup();
  T.createCharacter('# Aria');
  await T.gdriveConnect(false);
  const id = drive.only().id;
  drive.edit(id, withCharacter(T, 'Remote Only'));
  T.createCharacter('# Local Only');
  await T.gdriveFlush();

  assert.strictEqual(T.gdriveState().status, 'conflict');
  assert.ok(!$('#gd-modal').hidden);
  assert.strictEqual($('#gd-modal-title').textContent, 'Google Drive copy changed');
  assert.match($('#gd-modal-compare').textContent, /Google Drive.*2 characters.*Only here: Remote Only\.[\s\S]*This browser: 2 characters.*Only here: Local Only\./);
  assert.match($('#gd-status').textContent, /Resolve/);
  assert.ok(/Remote Only/.test(drive.only().content), 'nothing is overwritten before the user decides');

  T.createCharacter('# Later');
  await T.gdriveFlush();
  assert.strictEqual(T.gdriveState().status, 'conflict', 'saves wait while the question is open');

  click($('#gd-use-local'));
  await tick();
  const remote = JSON.parse(drive.only().content).characters.map(c => c.name);
  assert.deepEqual(remote, ['Aria', 'Local Only', 'Later']);
  assert.ok($('#gd-modal').hidden);
  assert.strictEqual(T.gdriveState().status, 'synced');
  window.close();
});

test('Drive sync: "Use the Drive copy" replaces this browser\'s campaign', async () => {
  const { T, window, $, drive } = await setup();
  T.createCharacter('# Aria');
  await T.gdriveConnect(false);
  drive.edit(drive.only().id, withCharacter(T, 'Remote Only'));
  T.createCharacter('# Local Only');
  await T.gdriveFlush();
  assert.strictEqual(T.gdriveState().status, 'conflict');

  click($('#gd-use-drive'));
  assert.deepEqual(names(T), ['Aria', 'Remote Only']);
  assert.ok($('#gd-modal').hidden);
  assert.strictEqual($('#char-select').selectedOptions[0].textContent.trim().length > 0, true, 'Character tab re-rendered');
  await T.gdriveFlush(); // the "Replaced…" log line is a local change: it uploads
  assert.deepEqual(JSON.parse(drive.only().content).characters.map(c => c.name), ['Aria', 'Remote Only']);
  assert.strictEqual(T.gdriveState().status, 'synced');
  window.close();
});

test('Drive sync: a browser connecting to an existing Drive campaign is asked first, and nothing is uploaded', async () => {
  const { T, window, $, drive } = await setup();
  T.createCharacter('# Local Hero');
  drive.put(withCharacter(T, 'Drive Hero').replace('"Local Hero"', '"Old Hero"'));

  await T.gdriveConnect(false);
  assert.strictEqual(T.gdriveState().status, 'conflict');
  assert.strictEqual(T.gdriveState().conflict.mode, 'link');
  assert.strictEqual($('#gd-modal-title').textContent, 'Campaign found in Google Drive');
  assert.ok($('#gd-use-drive').classList.contains('btn-primary'));
  assert.deepEqual(drive.writes(), []);

  click($('#gd-use-drive'));
  assert.deepEqual(names(T), ['Old Hero', 'Drive Hero']);
  window.close();
});

test('Drive sync: an expired sign-in stops uploads until Reconnect; local changes are kept and then synced', async () => {
  const { T, window, $, drive, gis } = await setup();
  T.createCharacter('# Aria');
  await T.gdriveConnect(false);

  drive.fail401 = true;
  T.createCharacter('# Offline Edit');
  await T.gdriveFlush();
  assert.strictEqual(T.gdriveState().status, 'signed-out');
  assert.strictEqual(window.localStorage.getItem(T.GDRIVE_TOKEN_KEY), null, 'the dead token is dropped');
  assert.match($('#gd-status').textContent, /Reconnect/);
  assert.ok(!$('#gd-connect').hidden);
  assert.strictEqual($('#gd-connect').textContent, 'Reconnect');
  assert.deepEqual(names(T), ['Aria', 'Offline Edit']);

  drive.fail401 = false;
  click($('#gd-status'));
  await tick();
  assert.deepEqual(gis.requests[gis.requests.length - 1], { prompt: '', login_hint: 'gm@example.com' },
    'reconnect skips the account picker when Google can');
  assert.strictEqual(T.gdriveState().status, 'synced');
  assert.deepEqual(JSON.parse(drive.only().content).characters.map(c => c.name), ['Aria', 'Offline Edit']);
  window.close();
});

test('Drive sync: a closed sign-in popup or a refused Drive permission leaves sync off', async () => {
  const { T, window, $, drive, gis } = await setup();
  let alerted = '';
  window.alert = m => { alerted = m; };
  gis.respond = () => ({ type: 'popup_closed' });
  await T.gdriveConnect(false);
  assert.match(alerted, /sign-in window was closed/);
  assert.strictEqual(T.gdriveState().status, 'off');
  assert.ok($('#gd-status').hidden);

  gis.respond = () => ({ access_token: 'tok-9', expires_in: 3599, scope: 'openid' });
  await T.gdriveConnect(false);
  assert.match(alerted, /Drive access was not allowed/);
  assert.strictEqual(T.gdriveState().meta.enabled, false);
  assert.deepEqual(drive.calls, []);
  window.close();
});

test('Drive sync: Disconnect forgets the token and the file link, keeps the client ID, and leaves both copies', async () => {
  const { T, window, $, drive } = await setup();
  T.createCharacter('# Aria');
  await T.gdriveConnect(false);
  click($('#gd-disconnect'));
  const st = T.gdriveState();
  assert.strictEqual(st.status, 'off');
  assert.strictEqual(st.meta.enabled, false);
  assert.strictEqual(st.meta.fileId, '');
  assert.strictEqual(st.meta.clientId, CLIENT_ID);
  assert.strictEqual(window.localStorage.getItem(T.GDRIVE_TOKEN_KEY), null);
  assert.ok($('#gd-status').hidden);
  assert.strictEqual(drive.files.size, 1, 'the Drive file stays');
  assert.deepEqual(names(T), ['Aria'], 'the local campaign stays');
  T.createCharacter('# After');
  await T.gdriveFlush();
  assert.strictEqual(drive.writes().length, 1, 'no uploads after Disconnect');
  window.close();
});

test('Drive sync: a reload with sync on and a live token pulls a newer Drive copy at boot; without a token it asks to reconnect', async () => {
  // This browser's campaign as it was last synced (an already-migrated state, so boot leaves it as is).
  const first = await boot();
  const localText = JSON.stringify(first.T.state);
  const syncedHash = first.T.hashText(localText);
  first.window.close();

  const remote = JSON.parse(localText);
  remote.characters = [{ id: 'c1', name: 'From Drive', system: '', body: '# From Drive\n' }];
  let drive;
  const env = await boot({
    storage: localText,
    extraStorage: {
      osr_gdrive_v1: JSON.stringify({ enabled: true, clientId: CLIENT_ID, fileId: 'file1', remoteMd5: 'older', syncedHash, email: 'gm@example.com' }),
      osr_gdrive_token: JSON.stringify({ token: 'tok-1', expiresAt: Date.now() + 3600e3 })
    },
    beforeScripts(window) { drive = fakeDrive(window); drive.put(JSON.stringify(remote)); }
  });
  await tick();
  assert.strictEqual(env.T.gdriveState().status, 'synced');
  assert.deepEqual(names(env.T), ['From Drive']);
  assert.deepEqual(drive.writes(), [], 'pulled, not uploaded');
  env.window.close();

  const env2 = await boot({
    extraStorage: {
      osr_gdrive_v1: JSON.stringify({ enabled: true, clientId: CLIENT_ID, fileId: 'file1', remoteMd5: 'x', syncedHash: 'h' })
    },
    beforeScripts(window) { window.fetch = () => { throw new Error('no fetch without a token'); }; }
  });
  assert.strictEqual(env2.T.gdriveState().status, 'signed-out');
  assert.match(env2.document.querySelector('#gd-status').textContent, /Reconnect/);
  env2.window.close();
});
