/* js/dropbox.js — optional Dropbox sync of the whole campaign (OSR.state).
 *
 * Off until the user clicks Settings → Dropbox sync → Connect. Then the
 * campaign is one JSON file in the app's Dropbox folder (Apps/<app name>/
 * "Character Keeper campaign.json", the same shape as Export, so Import reads
 * it too), and every save() (js/core.js calls OSR.dropboxNoteSave) uploads it
 * again a few seconds later.
 *
 * Sign-in is Dropbox OAuth 2 with PKCE: Connect sends this tab to Dropbox,
 * and Dropbox redirects back to the app's own URL with ?code=…, which
 * initDropbox() reads on the next boot. The fallback, "Connect with a code",
 * asks for no redirect: Dropbox shows a code and the user pastes it back. The
 * code buys a refresh token (token_access_type=offline) that does not expire,
 * so the app gets new 4-hour access tokens by itself, with no backend and no
 * app secret. The calls are plain fetch to
 * api.dropboxapi.com / content.dropboxapi.com — the app's one network
 * dependency (see AGENTS.md "Dropbox sync"). The app is an "App folder" app:
 * it sees only its own folder.
 *
 * Per-device bookkeeping and the tokens live in their own localStorage keys,
 * never in OSR.state — so Export and the synced file never carry them.
 */
(function (OSR) {
  'use strict';
  const $ = OSR.$;

  // App key of a Dropbox "Scoped access / App folder" app. Not a secret.
  // Empty = each user enters their own in Settings (stored per device).
  const DEFAULT_APP_KEY = '';
  const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
  const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
  const API = 'https://api.dropboxapi.com/2';
  const CONTENT_API = 'https://content.dropboxapi.com/2';
  const META_KEY = 'osr_dropbox_v1';
  const TOKEN_KEY = 'osr_dropbox_token';
  // The PKCE verifier between Connect and the redirect back (sessionStorage:
  // this tab only, gone when it closes).
  const PENDING_KEY = 'osr_dropbox_pending';
  // Left behind by the Google Drive sync this file replaced.
  const OLD_KEYS = ['osr_gdrive_v1', 'osr_gdrive_token'];
  const FILE_NAME = 'Character Keeper campaign.json';
  const FILE_PATH = '/' + FILE_NAME;
  const UPLOAD_DELAY = 4000;     // quiet time after the last save before uploading
  const MAX_WAIT = 30000;        // ...but never hold back changes longer than this
  const FOCUS_CHECK_MS = 60000;  // re-check Dropbox at most this often when the tab regains focus
  const TOKEN_MARGIN = 60000;    // treat an access token as expired a minute early

  const META_DEFAULTS = { enabled: false, appKey: '', fileId: '', remoteHash: '', syncedHash: '', lastSync: 0 };

  function readJson(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function writeJson(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { console.warn('dropbox: storage write failed', e); }
  }

  let meta = Object.assign({}, META_DEFAULTS, readJson(META_KEY) || {});
  function saveMeta() { writeJson(META_KEY, meta); }

  // Runtime state (not persisted).
  const dbx = {
    status: meta.enabled ? 'signed-out' : 'off', // off | signed-out | pending | syncing | synced | conflict | error
    message: '',
    busy: false,
    again: false,      // a save happened during a sync pass: run another one after it
    applying: false,   // a pull is writing OSR.state: its own save() is not a local change
    timer: null,
    firstPendingAt: 0,
    lastCheck: 0,
    auth: null,        // { verifier, appKey } while the user copies the code from Dropbox
    conflict: null     // { mode: 'link'|'conflict', remote, text }
  };

  function appKey() { return String(meta.appKey || '').trim() || DEFAULT_APP_KEY; }

  // FNV-1a over the UTF-16 code units, plus the length. Only compares a
  // state with the one this device last synced; not a security hash.
  function hashText(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + ':' + s.length;
  }

  // What one sync pass does, from the Dropbox file's metadata (null = no file
  // yet), this device's bookkeeping, and a hash of the current local state:
  //   create   — no file in Dropbox: upload this browser's campaign.
  //   link     — a file exists, but this device never synced with it: ask.
  //   noop / upload / pull — at most one side changed since the last sync.
  //   conflict — both sides changed: ask.
  // Dropbox's content_hash changes only with the content (not on a rename/move).
  function decideSync(remote, m, localHash) {
    if (!remote) return 'create';
    if (remote.id !== m.fileId || !m.remoteHash) return 'link';
    const remoteChanged = remote.hash !== m.remoteHash;
    const localChanged = localHash !== m.syncedHash;
    if (remoteChanged && localChanged) return 'conflict';
    if (remoteChanged) return 'pull';
    if (localChanged) return 'upload';
    return 'noop';
  }

  /* ---- PKCE sign-in ---- */
  function base64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // A verifier and its challenge. S256 needs crypto.subtle; where a browser
  // has none, Dropbox also accepts the "plain" method (challenge = verifier).
  async function pkcePair(subtle) {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
    if (!subtle) return { verifier, challenge: verifier, method: 'plain' };
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: base64url(new Uint8Array(digest)), method: 'S256' };
  }

  // With redirectUri, Dropbox sends the browser back there with ?code=&state=;
  // without it, Dropbox shows the code for the user to paste.
  function authUrl(key, pair, redirectUri, state) {
    const p = {
      client_id: key, response_type: 'code', token_access_type: 'offline',
      code_challenge: pair.challenge, code_challenge_method: pair.method
    };
    if (redirectUri) Object.assign(p, { redirect_uri: redirectUri, state });
    return AUTH_URL + '?' + new URLSearchParams(p);
  }

  // The app's own URL, without query or hash. It must be in the Dropbox app's
  // list of redirect URIs.
  function redirectUri() { return location.origin + location.pathname; }

  /* ---- Tokens ---- */
  function dbxError(status, message, summary) {
    const e = new Error(message); e.status = status; e.summary = summary || ''; return e;
  }
  function tokens() { return readJson(TOKEN_KEY); }
  function hasToken() { const t = tokens(); return !!(t && t.refresh); }
  function clearToken() { writeJson(TOKEN_KEY, null); }

  async function tokenRequest(params) {
    let res;
    try {
      res = await window.fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString()
      });
    } catch (e) { throw dbxError(0, 'Cannot reach Dropbox. Are you offline?'); }
    let j = null;
    try { j = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || !j || !j.access_token) {
      const why = (j && (j.error_description || j.error)) || 'HTTP ' + res.status;
      // 400/401 = the code or the refresh token is no good: sign in again.
      throw dbxError(res.status === 400 || res.status === 401 ? 401 : res.status, 'Dropbox sign-in failed (' + why + ').');
    }
    return j;
  }

  function storeTokens(j, refresh, key) {
    writeJson(TOKEN_KEY, {
      token: j.access_token,
      expiresAt: Date.now() + (Number(j.expires_in) || 14400) * 1000,
      refresh: j.refresh_token || refresh,
      appKey: key
    });
    return j.access_token;
  }

  // Concurrent callers share one refresh.
  let refreshing = null;
  function refreshAccess(t) {
    if (!refreshing) {
      refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.appKey || appKey() })
        .then(j => storeTokens(j, t.refresh, t.appKey || appKey()))
        .catch(e => { if (e.status === 401) clearToken(); throw e; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function accessToken(forceRefresh) {
    const t = tokens();
    if (!t || !t.refresh) throw dbxError(401, 'Not signed in to Dropbox.');
    if (!forceRefresh && t.token && Date.now() < t.expiresAt - TOKEN_MARGIN) return t.token;
    return refreshAccess(t);
  }

  /* ---- Dropbox API calls (plain fetch; no Dropbox SDK) ---- */
  // Dropbox-API-Arg is an HTTP header: non-ASCII must be \u-escaped.
  const headerJson = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));

  async function dbxFetch(url, opts, retried) {
    const o = Object.assign({}, opts);
    o.method = 'POST';
    o.headers = Object.assign({ Authorization: 'Bearer ' + await accessToken(retried) }, opts && opts.headers);
    let res;
    try { res = await window.fetch(url, o); }
    catch (e) { throw dbxError(0, 'Cannot reach Dropbox. Are you offline?'); }
    // An access token can be revoked before it expires: refresh once, then give up.
    if (res.status === 401 && !retried) return dbxFetch(url, opts, true);
    if (res.status === 401) { clearToken(); throw dbxError(401, 'Dropbox sign-in expired.'); }
    if (!res.ok) {
      let msg = 'Dropbox returned HTTP ' + res.status + '.', summary = '';
      try {
        const j = JSON.parse(await res.text());
        summary = (j && j.error_summary) || '';
        if (summary) msg = 'Dropbox: ' + summary;
      } catch (e) { /* not JSON */ }
      throw dbxError(res.status, msg, summary);
    }
    return res;
  }

  function apiCall(endpoint, arg) {
    return dbxFetch(API + '/' + endpoint, {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arg)
    }).then(r => r.json());
  }

  // Dropbox's file metadata, cut down to what the sync uses.
  function toRemote(f) {
    return { id: f.id, rev: f.rev, hash: f.content_hash || '', path: f.path_lower || FILE_PATH, modified: f.server_modified || '' };
  }

  // The campaign file: the one this device synced with (by id, so a rename or
  // move inside the app folder doesn't lose it), else the default path.
  async function findRemote() {
    const paths = meta.fileId ? [meta.fileId, FILE_PATH] : [FILE_PATH];
    for (const path of paths) {
      try {
        const f = await apiCall('files/get_metadata', { path });
        if (f && f['.tag'] === 'file') return toRemote(f);
      } catch (e) { if (!/not_found/.test(e.summary)) throw e; }
    }
    return null;
  }

  // By rev, so the text always matches the metadata the pass decided on.
  async function downloadRemote(remote) {
    return (await dbxFetch(CONTENT_API + '/files/download', {
      headers: { 'Dropbox-API-Arg': headerJson({ path: 'rev:' + remote.rev }) }
    })).text();
  }

  // Creates the file, or replaces it only if it is still at `remote.rev`:
  // Dropbox refuses (409 conflict) when another device wrote in between.
  async function uploadText(text, remote) {
    const arg = remote
      ? { path: remote.path, mode: { '.tag': 'update', update: remote.rev }, autorename: false, mute: true }
      : { path: FILE_PATH, mode: 'add', autorename: false, mute: true };
    return toRemote(await (await dbxFetch(CONTENT_API + '/files/upload', {
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': headerJson(arg) },
      body: text
    })).json());
  }

  /* ---- Sync ---- */
  function setStatus(status, message) {
    dbx.status = status;
    dbx.message = message || '';
    renderDropbox();
  }

  function recordSynced(remote, hash) {
    meta.fileId = remote.id;
    meta.remoteHash = remote.hash;
    meta.syncedHash = hash;
    meta.lastSync = Date.now();
    saveMeta();
  }

  // Replaces this browser's campaign with the Dropbox copy (same path as
  // Import → Replace all), then records the result as synced.
  function applyRemote(text, remote) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw dbxError(0, 'The Dropbox file is not valid JSON.'); }
    if (!data || !Array.isArray(data.characters)) throw dbxError(0, 'The Dropbox file has no "characters" array.');
    dbx.applying = true;
    let saved;
    try { saved = OSR.replaceState(data); } finally { dbx.applying = false; }
    // Not saved = a reload brings back the old campaign: don't record a sync
    // that would then upload it over the Dropbox copy.
    if (!saved) throw dbxError(0, 'The browser storage is full, so the Dropbox copy could not be saved here.');
    recordSynced(remote, hashText(JSON.stringify(OSR.state)));
  }

  async function syncNow() {
    clearTimeout(dbx.timer);
    dbx.timer = null;
    if (!meta.enabled || dbx.status === 'conflict') return;
    if (dbx.busy) { dbx.again = true; return; }
    if (!hasToken()) { setStatus('signed-out'); return; }
    dbx.busy = true;
    dbx.firstPendingAt = 0;
    dbx.lastCheck = Date.now();
    setStatus('syncing');
    try {
      const text = JSON.stringify(OSR.state);
      const hash = hashText(text);
      const remote = await findRemote();
      const action = decideSync(remote, meta, hash);
      if (action === 'create' || action === 'upload') {
        recordSynced(await uploadText(text, action === 'upload' ? remote : null), hash);
      } else if (action !== 'noop') { // pull, link, conflict
        const remoteText = await downloadRemote(remote);
        // An edit made during the download turns a pull into a conflict.
        const mode = action === 'pull' && hashText(JSON.stringify(OSR.state)) !== hash ? 'conflict' : action;
        if (mode === 'pull') applyRemote(remoteText, remote);
        else if (hashText(remoteText) === hash) recordSynced(remote, hash); // already the same campaign
        else { dbx.conflict = { mode, remote, text: remoteText }; setStatus('conflict'); openDropboxModal(); return; }
      }
      setStatus('synced');
    } catch (e) {
      if (e.status === 401) setStatus('signed-out');
      // Another device wrote between our check and our upload: the next pass sees it.
      else if (/conflict/.test(e.summary)) { setStatus('pending'); dbx.again = true; }
      else setStatus('error', e.message);
    } finally {
      dbx.busy = false;
      if (dbx.again) { dbx.again = false; schedule(0); }
    }
  }

  function schedule(delay) {
    const now = Date.now();
    if (!dbx.firstPendingAt) dbx.firstPendingAt = now;
    const wait = Math.max(0, Math.min(delay, dbx.firstPendingAt + MAX_WAIT - now));
    clearTimeout(dbx.timer);
    dbx.timer = setTimeout(syncNow, wait);
  }

  // Called by OSR.save() (js/core.js) after every successful write.
  function dropboxNoteSave() {
    if (!meta.enabled || dbx.applying || dbx.status === 'conflict') return;
    if (dbx.busy) { dbx.again = true; return; }
    if (dbx.status === 'synced') setStatus('pending');
    schedule(UPLOAD_DELAY);
  }

  // Runs a pending upload now (tests, and the tab going to the background).
  function dropboxFlush() {
    if (!dbx.timer) return Promise.resolve();
    return syncNow();
  }

  function requireAppKey() {
    const key = appKey();
    if (!key) {
      alert('Enter your Dropbox app key first (Settings → Dropbox sync → Setup).');
      const d = $('#dbx-setup'); if (d) d.open = true;
    }
    return key;
  }

  // Step 1: send this tab to Dropbox's consent page. Dropbox redirects back
  // to redirectUri() and initDropbox() finishes there.
  async function connect() {
    const key = requireAppKey();
    if (!key) return;
    const pair = await pkcePair(window.crypto && crypto.subtle);
    const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
    const uri = redirectUri();
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier: pair.verifier, appKey: key, state, redirectUri: uri }));
    } catch (e) { alert('This browser blocks session storage, so the Dropbox sign-in cannot finish. Use "Connect with a code" under Setup.'); return; }
    OSR.dropboxRedirect(authUrl(key, pair, uri, state));
  }

  // Back from Dropbox (initDropbox at boot): ?code=&state= or ?error=.
  // Removes them from the address bar, checks the state against this tab's
  // pending sign-in, and trades the code. Returns false when the URL has no
  // sign-in reply.
  async function finishRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return false;
    const code = q.get('code'), state = q.get('state'), error = q.get('error');
    ['code', 'state', 'error', 'error_description'].forEach(k => q.delete(k));
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_KEY));
      sessionStorage.removeItem(PENDING_KEY);
    } catch (e) { /* none */ }
    if (!pending) return true; // not this tab's sign-in (a stale or copied link): ignore it
    if (error) { if (error !== 'access_denied') alert('Dropbox sign-in failed (' + error + ').'); return true; }
    if (state !== pending.state) { alert('The Dropbox sign-in reply does not match this tab. Click Connect again.'); return true; }
    return (await finishConnect(code, pending)) ? 'connected' : true;
  }

  // Fallback (Setup → "Connect with a code"): open Dropbox's consent page in a
  // new tab with no redirect; Dropbox shows a code to paste. The tab is opened
  // before the async PKCE work, so pop-up blockers see the click.
  async function connectWithCode() {
    const key = requireAppKey();
    if (!key) return;
    const tab = window.open('', '_blank');
    const pair = await pkcePair(window.crypto && crypto.subtle);
    const url = authUrl(key, pair);
    // Pop-ups blocked: the "Open Dropbox" link in the code row still works.
    if (tab) { tab.opener = null; tab.location.href = url; }
    dbx.auth = { verifier: pair.verifier, appKey: key, url };
    renderDropbox();
    const input = $('#dbx-code');
    if (input) { input.value = ''; input.focus(); }
  }

  // Step 2: trade the code (pasted, or from the redirect) for tokens, then sync.
  // `a` is the pending sign-in: { verifier, appKey, redirectUri? }.
  async function finishConnect(code, a = dbx.auth) {
    code = String(code || '').trim();
    if (!a || !code) return;
    let j;
    try {
      const params = { grant_type: 'authorization_code', code, code_verifier: a.verifier, client_id: a.appKey };
      // Dropbox checks that it matches the redirect_uri of the consent page.
      if (a.redirectUri) params.redirect_uri = a.redirectUri;
      j = await tokenRequest(params);
    } catch (e) {
      alert(e.status === 401 ? (a.redirectUri ? 'Dropbox did not accept the sign-in. Click Connect again.'
        : 'Dropbox did not accept the code. Click Connect again and paste the new code.') : e.message);
      return;
    }
    if (!j.refresh_token) { alert('Dropbox sent no refresh token. Click Connect again.'); return; }
    dbx.auth = null;
    storeTokens(j, '', a.appKey);
    const first = !meta.enabled;
    meta.enabled = true;
    saveMeta();
    if (first) OSR.pushNote('Dropbox', 'Connected');
    await syncNow();
    return true;
  }

  function cancelConnect() { dbx.auth = null; renderDropbox(); }

  function disconnect() {
    if (!confirm('Stop syncing this browser with Dropbox?\n\nThe campaign stays in this browser, and the file stays in your Dropbox.')) return;
    clearTimeout(dbx.timer);
    dbx.timer = null;
    const t = tokens();
    clearToken();
    // Revoke the token too, so it stops working everywhere. Best effort.
    if (t && t.token) window.fetch(API + '/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + t.token } }).catch(() => {});
    meta = Object.assign({}, META_DEFAULTS, { appKey: meta.appKey });
    saveMeta();
    dbx.conflict = null;
    dbx.auth = null;
    closeDropboxModal();
    setStatus('off');
    OSR.pushNote('Dropbox', 'Disconnected');
  }

  /* ---- Conflict / first-link dialog ---- */
  function summarize(s) {
    const n = (arr, one, many) => { const k = Array.isArray(arr) ? arr.length : 0; return k + ' ' + (k === 1 ? one : many); };
    return [n(s.characters, 'character', 'characters'), n(s.compendium, 'Compendium entry', 'Compendium entries'),
      n(s.monsters, 'monster', 'monsters'), n(s.log, 'log line', 'log lines')].join(', ');
  }
  function fmtTime(t) {
    const d = new Date(t);
    return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function openDropboxModal() {
    const c = dbx.conflict;
    if (!c) return;
    let remoteState = {};
    try { remoteState = JSON.parse(c.text) || {}; } catch (e) { /* summarized as empty */ }
    $('#dbx-modal-title').textContent = c.mode === 'link' ? 'Campaign found in Dropbox' : 'Dropbox copy changed';
    $('#dbx-modal-text').textContent = c.mode === 'link'
      ? 'Your Dropbox already has a Character Keeper campaign, and it is different from the one in this browser. Choose which one to keep. The other one is replaced.'
      : 'The Dropbox copy changed on another device, and this browser has changes too. Choose which one to keep. The other one is replaced.';
    // Counts alone often match (one character added on each side), so also
    // name the characters that only one copy has.
    const charNames = s => (Array.isArray(s.characters) ? s.characters : []).map(ch => String((ch && ch.name) || ''));
    const remoteNames = charNames(remoteState), localNames = charNames(OSR.state);
    const onlyIn = (a, b) => {
      const only = a.filter(x => b.indexOf(x) === -1);
      return only.length ? ' Only here: ' + only.join(', ') + '.' : '';
    };
    $('#dbx-modal-compare').innerHTML =
      '<li><b>Dropbox</b> (saved ' + OSR.escapeHtml(fmtTime(c.remote.modified)) + '): ' +
        OSR.escapeHtml(summarize(remoteState) + '.' + onlyIn(remoteNames, localNames)) + '</li>' +
      '<li><b>This browser</b>: ' + OSR.escapeHtml(summarize(OSR.state) + '.' + onlyIn(localNames, remoteNames)) + '</li>';
    $('#dbx-use-remote').classList.toggle('btn-primary', c.mode === 'link');
    $('#dbx-modal').hidden = false;
  }
  function closeDropboxModal() { const m = $('#dbx-modal'); if (m) m.hidden = true; }

  function useRemoteCopy() {
    const c = dbx.conflict;
    if (!c) return;
    try { applyRemote(c.text, c.remote); }
    catch (e) { alert(e.message); return; }
    dbx.conflict = null;
    closeDropboxModal();
    setStatus('synced');
    OSR.pushNote('Dropbox', 'Replaced this browser’s campaign with the Dropbox copy');
  }

  async function useLocalCopy() {
    const c = dbx.conflict;
    if (!c) return;
    dbx.conflict = null;
    closeDropboxModal();
    // Make the next pass see "only this browser changed": it uploads over the file.
    meta.fileId = c.remote.id;
    meta.remoteHash = c.remote.hash;
    meta.syncedHash = '';
    saveMeta();
    setStatus('pending');
    OSR.pushNote('Dropbox', 'Replaced the Dropbox copy with this browser’s campaign'); // saves → schedules
    await syncNow();
  }

  /* ---- Render ---- */
  const STATUS_VIEW = {
    synced:       { icon: 'fa-cloud', label: 'Synced', cls: '' },
    pending:      { icon: 'fa-cloud-arrow-up', label: 'Saving…', cls: '' },
    syncing:      { icon: 'fa-cloud-arrow-up', label: 'Syncing…', cls: '' },
    'signed-out': { icon: 'fa-cloud', label: 'Reconnect', cls: 'is-warn' },
    conflict:     { icon: 'fa-triangle-exclamation', label: 'Resolve', cls: 'is-warn' },
    error:        { icon: 'fa-cloud-bolt', label: 'Sync error', cls: 'is-error' }
  };

  function statusText() {
    const last = meta.lastSync ? ' Last synced ' + fmtTime(meta.lastSync) + '.' : '';
    switch (dbx.status) {
      case 'synced': return 'Connected. The campaign is saved in your Dropbox app folder as “' + FILE_NAME + '”.' + last;
      case 'pending':
      case 'syncing': return 'Connected. Saving changes to Dropbox…';
      case 'signed-out': return 'Dropbox access was removed or expired. Your changes stay in this browser. Click Reconnect to sync them.' + last;
      case 'conflict': return 'The Dropbox copy and this browser both have changes. Click Resolve to choose which one to keep.';
      case 'error': return 'Sync failed: ' + dbx.message + last;
      default: return 'Off. Connect to save this campaign in your Dropbox and keep it the same in every browser where you connect.';
    }
  }

  function renderDropbox() {
    const uriEl = $('#dbx-redirect-uri');
    if (uriEl) uriEl.textContent = redirectUri();
    const btn = $('#dbx-status');
    if (btn) {
      const v = meta.enabled && STATUS_VIEW[dbx.status];
      btn.hidden = !v;
      if (v) {
        btn.className = 'btn dbx-status' + (v.cls ? ' ' + v.cls : '');
        btn.innerHTML = '<i class="fa-solid ' + v.icon + '"></i>' + OSR.escapeHtml(v.label);
        btn.title = statusText();
      }
    }
    const hint = $('#dbx-hint');
    if (!hint) return;
    if (dbx.auth) hint.textContent = 'Dropbox opened in a new tab. Click Allow there, then copy the code that Dropbox shows and paste it here. If no tab opened, click Open Dropbox.';
    else if (!appKey() && !meta.enabled) hint.textContent = 'Set your Dropbox app key under Setup first.';
    else hint.textContent = statusText();
    $('#dbx-code-row').hidden = !dbx.auth;
    $('#dbx-open').href = dbx.auth ? dbx.auth.url : '#';
    const connectBtn = $('#dbx-connect');
    connectBtn.hidden = !!dbx.auth || (meta.enabled && dbx.status !== 'signed-out');
    connectBtn.textContent = meta.enabled ? 'Reconnect' : 'Connect';
    connectBtn.disabled = !appKey();
    $('#dbx-resolve').hidden = dbx.status !== 'conflict';
    $('#dbx-sync').hidden = !meta.enabled || dbx.status === 'signed-out' || dbx.status === 'conflict';
    $('#dbx-sync').disabled = dbx.status === 'syncing';
    $('#dbx-disconnect').hidden = !meta.enabled;
    const input = $('#dbx-app-key');
    if (input && document.activeElement !== input) input.value = meta.appKey || '';
    if (input) input.placeholder = DEFAULT_APP_KEY || 'a1b2c3d4e5f6g7h';
  }

  // Called at the end of init() (js/main.js), after seeding.
  async function initDropbox() {
    OLD_KEYS.forEach(k => writeJson(k, null));
    renderDropbox();
    if ((await finishRedirect()) === 'connected') return; // finishConnect already synced
    if (!meta.enabled) return;
    if (hasToken()) syncNow();
    else setStatus('signed-out');
  }

  function wireDropbox() {
    $('#dbx-connect').addEventListener('click', () => connect());
    $('#dbx-connect-code').addEventListener('click', () => connectWithCode());
    $('#dbx-finish').addEventListener('click', () => finishConnect($('#dbx-code').value));
    $('#dbx-code').addEventListener('keydown', e => { if (e.key === 'Enter') finishConnect(e.target.value); });
    $('#dbx-cancel').addEventListener('click', cancelConnect);
    $('#dbx-sync').addEventListener('click', () => syncNow());
    $('#dbx-resolve').addEventListener('click', openDropboxModal);
    $('#dbx-disconnect').addEventListener('click', disconnect);
    $('#dbx-app-key').addEventListener('change', e => {
      meta.appKey = e.target.value.trim();
      saveMeta();
      renderDropbox();
    });
    $('#dbx-status').addEventListener('click', () => {
      if (dbx.status === 'signed-out') connect();
      else if (dbx.status === 'conflict') openDropboxModal();
      else syncNow();
    });
    $('#dbx-use-remote').addEventListener('click', useRemoteCopy);
    $('#dbx-use-local').addEventListener('click', useLocalCopy);
    $('#dbx-export').addEventListener('click', () => OSR.exportData());
    $('#dbx-later').addEventListener('click', closeDropboxModal);
    // Another device may have changed the file: check when the tab comes back.
    // Going to the background flushes a pending upload instead of waiting.
    document.addEventListener('visibilitychange', () => {
      if (!meta.enabled || !hasToken()) return;
      if (document.visibilityState === 'hidden') dropboxFlush();
      else if (Date.now() - dbx.lastCheck > FOCUS_CHECK_MS) syncNow();
    });
    window.addEventListener('online', () => { if (meta.enabled && hasToken()) syncNow(); });
  }

  // Test-only view of the per-device bookkeeping.
  function dropboxState() { return { status: dbx.status, message: dbx.message, meta: Object.assign({}, meta), conflict: dbx.conflict, auth: dbx.auth }; }

  Object.assign(OSR, {
    DROPBOX_FILE_NAME: FILE_NAME, DROPBOX_META_KEY: META_KEY, DROPBOX_TOKEN_KEY: TOKEN_KEY,
    hashText, decideSync, pkcePair, dropboxNoteSave, dropboxFlush, dropboxSyncNow: syncNow,
    dropboxConnect: connect, dropboxConnectWithCode: connectWithCode, dropboxFinishConnect: finishConnect,
    dropboxFinishRedirect: finishRedirect, DROPBOX_PENDING_KEY: PENDING_KEY,
    // Leaves the app for Dropbox's consent page. Tests replace it.
    dropboxRedirect: url => location.assign(url), dropboxDisconnect: disconnect,
    dropboxUseRemoteCopy: useRemoteCopy, dropboxUseLocalCopy: useLocalCopy,
    openDropboxModal, closeDropboxModal, renderDropbox, initDropbox, wireDropbox, dropboxState
  });
})(window.OSR = window.OSR || {});
