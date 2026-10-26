'use strict';

/*
 * A fake Dropbox for the jsdom tests: window.fetch serving the OAuth token
 * endpoint and the Dropbox v2 calls js/dropbox.js makes, with an in-memory app
 * folder, real revs, and real content_hash values. Nothing talks to Dropbox.
 *
 * fakeDropbox(window, shared) installs it on one window. Pass the `dbx` of an
 * earlier call as `shared` to give a second window (a second device) the same
 * Dropbox: files, tokens, and calls are shared.
 */

const assert = require('node:assert');
const crypto = require('node:crypto');

const APP_KEY = 'testappkey123';
const GOOD_CODE = 'code-ok';
const PAGE = 4; // files/list_folder page size, so files/list_folder/continue runs too

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

function newDropbox() {
  const dbx = { files: new Map(), calls: [], nextId: 1, nextRev: 1, nextTok: 1, live: new Set(), refresh: new Set(), challenge: null, cursors: new Map() };
  const bump = (f, content) => {
    f.content = content; f.rev = 'r' + dbx.nextRev++; f.modified = new Date().toISOString(); f.revs[f.rev] = content;
  };
  dbx.put = (content, path = '/Character Keeper campaign.json') => {
    const f = { id: 'id:f' + dbx.nextId++, path, revs: {} };
    bump(f, content);
    dbx.files.set(f.id, f);
    return f.id;
  };
  dbx.edit = (id, content) => bump(dbx.files.get(id), content);
  dbx.file = path => [...dbx.files.values()].find(f => f.path.toLowerCase() === path.toLowerCase()) || null;
  dbx.paths = () => [...dbx.files.values()].map(f => f.path).sort();
  dbx.json = path => { const f = dbx.file(path); return f ? JSON.parse(f.content) : null; };
  dbx.writes = () => dbx.calls.filter(c => c.startsWith('files/upload'));
  dbx.bump = bump;
  return dbx;
}

function fakeDropbox(window, shared) {
  const dbx = shared || newDropbox();
  const res = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: k => headers[k.toLowerCase()] || null },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body)),
    arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); }
  });
  // A text body stays a string; a binary one (a map image) becomes a Buffer.
  const bodyOf = b => (typeof b === 'string' ? b : Buffer.from(b instanceof ArrayBuffer || (b && b.byteLength != null && !b.buffer) ? new Uint8Array(b) : b));
  const err = summary => res(409, { error_summary: summary + '/..', error: {} });
  const meta = f => ({ '.tag': 'file', id: f.id, name: f.path.split('/').pop(), path_lower: f.path.toLowerCase(), path_display: f.path,
    rev: f.rev, content_hash: contentHash(f.content), server_modified: f.modified, size: f.content.length });
  const byPath = p => p.startsWith('id:') ? dbx.files.get(p) : dbx.file(p);
  const issue = () => { const t = 'tok-' + dbx.nextTok++; dbx.live.add(t); return t; };
  const page = (entries, from) => {
    const slice = entries.slice(from, from + PAGE);
    const more = from + PAGE < entries.length;
    const cursor = 'cur-' + Math.random().toString(36).slice(2);
    if (more) dbx.cursors.set(cursor, { entries, from: from + PAGE });
    return res(200, { entries: slice, cursor, has_more: more });
  };

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
    dbx.calls.push(endpoint + (arg.mode ? ' ' + (arg.mode['.tag'] || arg.mode) : '') + (arg.path && endpoint === 'files/upload' ? ' ' + arg.path : ''));
    if (dbx.before) await dbx.before(endpoint, arg);
    if (endpoint === 'auth/token/revoke') { dbx.live.delete(token); return res(200, null); }
    if (endpoint === 'files/list_folder') {
      assert.strictEqual(arg.path, '', 'lists the whole app folder');
      assert.strictEqual(arg.recursive, true);
      const entries = [...dbx.files.values()].sort((a, b) => a.path.localeCompare(b.path)).map(meta);
      return page(entries, 0);
    }
    if (endpoint === 'files/list_folder/continue') {
      const c = dbx.cursors.get(arg.cursor);
      if (!c) return err('reset');
      dbx.cursors.delete(arg.cursor);
      return page(c.entries, c.from);
    }
    if (endpoint === 'files/get_metadata') {
      const f = byPath(arg.path);
      return f ? res(200, meta(f)) : err('path/not_found');
    }
    if (endpoint === 'files/move_v2') {
      const f = byPath(arg.from_path);
      if (!f) return err('from_lookup/not_found');
      if (dbx.file(arg.to_path)) return err('to/conflict');
      f.path = arg.to_path;
      return res(200, { metadata: meta(f) });
    }
    if (endpoint === 'files/download') {
      const m = /^rev:(.+)$/.exec(arg.path);
      const f = m ? [...dbx.files.values()].find(x => m[1] in x.revs) : dbx.file(arg.path);
      const rev = f && (m ? m[1] : f.rev);
      if (!f) return err('path/not_found');
      const content = f.revs[rev];
      if (dbx.onDownload) dbx.onDownload(f);
      return res(200, content, { 'dropbox-api-result': JSON.stringify(meta(f)) });
    }
    if (endpoint === 'files/upload') {
      assert.strictEqual(opts.headers['Content-Type'], 'application/octet-stream');
      const f = byPath(arg.path);
      if (arg.mode === 'add') {
        if (f) return err('path/conflict/file');
        const id = dbx.put(bodyOf(opts.body), arg.path);
        return res(200, meta(dbx.files.get(id)));
      }
      if (!f) return err('path/not_found');
      if (f.rev !== arg.mode.update) return err('path/conflict/file');
      dbx.bump(f, bodyOf(opts.body));
      return res(200, meta(f));
    }
    return res(500, { error_summary: 'fake Dropbox: unhandled ' + url });
  };
  return dbx;
}

module.exports = { APP_KEY, GOOD_CODE, contentHash, fakeOpen, fakeDropbox, newDropbox };
