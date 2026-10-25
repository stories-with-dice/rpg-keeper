/* js/gdrive.js — optional Google Drive sync of the whole campaign (OSR.state).
 *
 * Off until the user clicks Settings → Google Drive sync → Connect. Then the
 * campaign is one JSON file in their Drive ("Character Keeper campaign.json",
 * the same shape as Export, so Import reads it too), and every save()
 * (js/core.js calls OSR.gdriveNoteSave) uploads it again a few seconds later.
 *
 * Sign-in is Google Identity Services' token model: a popup gives the page a
 * short-lived (about 1 h) access token, with no backend and no refresh token.
 * The GIS script is loaded from accounts.google.com only when the user turns
 * sync on — the app's one network dependency (see AGENTS.md "Google Drive
 * sync"). The scope is drive.file: the app sees only the files it created.
 *
 * Needs an http(s) page (GitHub Pages, or a local server on localhost) whose
 * origin is listed in the OAuth client; a file:// page has no origin Google
 * accepts, so the Settings section is disabled there.
 *
 * Per-device bookkeeping and the token live in their own localStorage keys,
 * never in OSR.state — so Export and the synced file never carry them.
 */
(function (OSR) {
  'use strict';
  const $ = OSR.$;

  // OAuth client ID ("Web application" type) from Google Cloud. Not a secret.
  // Empty = each user enters their own in Settings (stored per device).
  const DEFAULT_CLIENT_ID = '';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  const META_KEY = 'osr_gdrive_v1';
  const TOKEN_KEY = 'osr_gdrive_token';
  const FILE_NAME = 'Character Keeper campaign.json';
  const FILE_FIELDS = 'id,name,md5Checksum,modifiedTime,trashed';
  // appProperties mark our file, so a rename or move in Drive doesn't lose it.
  const APP_PROP = 'osrKeeper';
  const APP_PROP_VALUE = 'campaign';
  const UPLOAD_DELAY = 4000;     // quiet time after the last save before uploading
  const MAX_WAIT = 30000;        // ...but never hold back changes longer than this
  const FOCUS_CHECK_MS = 60000;  // re-check Drive at most this often when the tab regains focus
  const TOKEN_MARGIN = 60000;    // treat a token as expired a minute early

  const META_DEFAULTS = { enabled: false, clientId: '', fileId: '', remoteMd5: '', syncedHash: '', lastSync: 0, email: '' };

  function readJson(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function writeJson(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { console.warn('gdrive: storage write failed', e); }
  }

  let meta = Object.assign({}, META_DEFAULTS, readJson(META_KEY) || {});
  function saveMeta() { writeJson(META_KEY, meta); }

  // Runtime state (not persisted).
  const gd = {
    status: meta.enabled ? 'signed-out' : 'off', // off | signed-out | pending | syncing | synced | conflict | error
    message: '',
    busy: false,
    again: false,      // a save happened during a sync pass: run another one after it
    applying: false,   // a pull is writing OSR.state: its own save() is not a local change
    timer: null,
    firstPendingAt: 0,
    lastCheck: 0,
    conflict: null     // { mode: 'link'|'conflict', remote, text }
  };

  function clientId() { return String(meta.clientId || '').trim() || DEFAULT_CLIENT_ID; }

  // Google sign-in needs a real http(s) origin; file:// pages have none.
  function driveSupported(protocol) {
    return /^https?:$/.test(protocol == null ? location.protocol : protocol);
  }

  // FNV-1a over the UTF-16 code units, plus the length. Only compares a
  // state with the one this device last synced; not a security hash.
  function hashText(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + ':' + s.length;
  }

  // What one sync pass does, from the Drive file's metadata (null = no file
  // yet), this device's bookkeeping, and a hash of the current local state:
  //   create   — no file in Drive: upload this browser's campaign.
  //   link     — a file exists, but this device never synced with it: ask.
  //   noop / upload / pull — at most one side changed since the last sync.
  //   conflict — both sides changed: ask.
  // Drive's md5Checksum changes only with the content (not on a rename/move).
  function decideSync(remote, m, localHash) {
    if (!remote) return 'create';
    if (remote.id !== m.fileId || !m.remoteMd5) return 'link';
    const remoteChanged = remote.md5Checksum !== m.remoteMd5;
    const localChanged = localHash !== m.syncedHash;
    if (remoteChanged && localChanged) return 'conflict';
    if (remoteChanged) return 'pull';
    if (localChanged) return 'upload';
    return 'noop';
  }

  /* ---- Token ---- */
  function token() {
    const t = readJson(TOKEN_KEY);
    return t && t.token && Date.now() < t.expiresAt - TOKEN_MARGIN ? t.token : null;
  }
  function clearToken() { writeJson(TOKEN_KEY, null); }

  const gisReady = () => !!(window.google && google.accounts && google.accounts.oauth2);
  let gisPromise = null, gisPreloaded = false;
  function loadGis() {
    if (gisReady()) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => (gisReady() ? resolve() : reject(new Error('Google sign-in did not load.')));
      s.onerror = () => { gisPromise = null; s.remove(); reject(new Error('Cannot load Google sign-in. Are you offline?')); };
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  function tokenErrorText(code) {
    if (code === 'popup_closed') return 'The Google sign-in window was closed.';
    if (code === 'popup_failed_to_open') return 'The browser blocked the Google sign-in window. Allow pop-ups for this site.';
    if (code === 'access_denied') return 'Google access was denied.';
    return 'Google sign-in failed (' + (code || 'unknown') + ').';
  }

  let tokenClient = null, tokenClientId = '', tokenWaiter = null;
  function settleToken(resp) {
    const w = tokenWaiter;
    tokenWaiter = null;
    if (!w) return;
    if (!resp || resp.error || !resp.access_token) { w.reject(new Error(tokenErrorText(resp && resp.error))); return; }
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
      w.reject(new Error('Google Drive access was not allowed. Tick the Drive permission on the Google screen.'));
      return;
    }
    writeJson(TOKEN_KEY, { token: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
    w.resolve(resp.access_token);
  }
  // Opens Google's popup, so call it from a click. When GIS is already loaded
  // (it is preloaded as soon as a client ID is set), requestAccessToken runs
  // synchronously inside the click, which keeps pop-up blockers happy.
  function requestToken(opts) {
    const exec = (resolve, reject) => {
      const id = clientId();
      if (!tokenClient || tokenClientId !== id) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: id, scope: SCOPE,
          callback: settleToken,
          error_callback: err => settleToken({ error: (err && err.type) || 'unknown' })
        });
        tokenClientId = id;
      }
      if (tokenWaiter) tokenWaiter.reject(new Error('Replaced by a newer sign-in request.'));
      tokenWaiter = { resolve, reject };
      tokenClient.requestAccessToken(opts || {});
    };
    if (gisReady()) return new Promise(exec);
    return loadGis().then(() => new Promise(exec));
  }

  /* ---- Drive REST calls (plain fetch; no Google API client library) ---- */
  function driveError(status, message) { const e = new Error(message); e.status = status; return e; }

  async function driveFetch(url, opts) {
    const t = token();
    if (!t) throw driveError(401, 'Not signed in to Google.');
    const o = Object.assign({}, opts);
    o.headers = Object.assign({ Authorization: 'Bearer ' + t }, opts && opts.headers);
    let res;
    try { res = await window.fetch(url, o); }
    catch (e) { throw driveError(0, 'Cannot reach Google Drive. Are you offline?'); }
    if (res.status === 401) { clearToken(); throw driveError(401, 'Google sign-in expired.'); }
    if (!res.ok) {
      let msg = 'Google Drive returned HTTP ' + res.status + '.';
      try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) { /* not JSON */ }
      throw driveError(res.status, msg);
    }
    return res;
  }

  // The campaign file: the one this device synced with, else the newest file
  // carrying our appProperties (the app only ever sees files it created).
  async function findRemote() {
    if (meta.fileId) {
      try {
        const f = await (await driveFetch(API + '/files/' + encodeURIComponent(meta.fileId) + '?fields=' + FILE_FIELDS)).json();
        if (f && !f.trashed) return f;
      } catch (e) { if (e.status !== 404) throw e; }
    }
    const q = "appProperties has { key='" + APP_PROP + "' and value='" + APP_PROP_VALUE + "' } and trashed = false";
    const res = await driveFetch(API + '/files?spaces=drive&orderBy=modifiedTime%20desc&pageSize=10' +
      '&fields=' + encodeURIComponent('files(' + FILE_FIELDS + ')') + '&q=' + encodeURIComponent(q));
    const list = (await res.json()).files || [];
    return list[0] || null;
  }

  async function downloadRemote(id) {
    return (await driveFetch(API + '/files/' + encodeURIComponent(id) + '?alt=media')).text();
  }

  // Creates the file (multipart: metadata + content) or replaces its content.
  async function uploadText(text, fileId) {
    if (fileId) {
      return (await driveFetch(UPLOAD_API + '/files/' + encodeURIComponent(fileId) + '?uploadType=media&fields=' + FILE_FIELDS, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text
      })).json();
    }
    const boundary = 'osr-keeper-' + OSR.uid();
    const fileMeta = { name: FILE_NAME, mimeType: 'application/json', appProperties: { [APP_PROP]: APP_PROP_VALUE } };
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(fileMeta) +
      '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + boundary + '--';
    return (await driveFetch(UPLOAD_API + '/files?uploadType=multipart&fields=' + FILE_FIELDS, {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
    })).json();
  }

  async function fetchEmail() {
    try {
      const j = await (await driveFetch(API + '/about?fields=user(emailAddress)')).json();
      return (j && j.user && j.user.emailAddress) || '';
    } catch (e) { return ''; }
  }

  /* ---- Sync ---- */
  function setStatus(status, message) {
    gd.status = status;
    gd.message = message || '';
    renderGdrive();
  }

  function recordSynced(file, hash) {
    meta.fileId = file.id;
    meta.remoteMd5 = file.md5Checksum || '';
    meta.syncedHash = hash;
    meta.lastSync = Date.now();
    saveMeta();
  }

  // Replaces this browser's campaign with the Drive copy (same path as
  // Import → Replace all), then records the result as synced.
  function applyRemote(text, remote) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw driveError(0, 'The Drive file is not valid JSON.'); }
    if (!data || !Array.isArray(data.characters)) throw driveError(0, 'The Drive file has no "characters" array.');
    gd.applying = true;
    let saved;
    try { saved = OSR.replaceState(data); } finally { gd.applying = false; }
    // Not saved = a reload brings back the old campaign: don't record a sync
    // that would then upload it over the Drive copy.
    if (!saved) throw driveError(0, 'The browser storage is full, so the Drive copy could not be saved here.');
    recordSynced(remote, hashText(JSON.stringify(OSR.state)));
  }

  async function syncNow() {
    clearTimeout(gd.timer);
    gd.timer = null;
    if (!meta.enabled || gd.status === 'conflict') return;
    if (gd.busy) { gd.again = true; return; }
    if (!clientId()) { setStatus('error', 'No OAuth client ID is set.'); return; }
    if (!token()) { setStatus('signed-out'); return; }
    gd.busy = true;
    gd.firstPendingAt = 0;
    gd.lastCheck = Date.now();
    setStatus('syncing');
    try {
      const text = JSON.stringify(OSR.state);
      const hash = hashText(text);
      const remote = await findRemote();
      const action = decideSync(remote, meta, hash);
      if (action === 'create' || action === 'upload') {
        recordSynced(await uploadText(text, action === 'upload' ? remote.id : null), hash);
      } else if (action !== 'noop') { // pull, link, conflict
        const remoteText = await downloadRemote(remote.id);
        // An edit made during the download turns a pull into a conflict.
        const mode = action === 'pull' && hashText(JSON.stringify(OSR.state)) !== hash ? 'conflict' : action;
        if (mode === 'pull') applyRemote(remoteText, remote);
        else if (hashText(remoteText) === hash) recordSynced(remote, hash); // already the same campaign
        else { gd.conflict = { mode, remote, text: remoteText }; setStatus('conflict'); openGdriveModal(); return; }
      }
      setStatus('synced');
    } catch (e) {
      if (e.status === 401) setStatus('signed-out');
      else setStatus('error', e.message);
    } finally {
      gd.busy = false;
      if (gd.again) { gd.again = false; schedule(0); }
    }
  }

  function schedule(delay) {
    const now = Date.now();
    if (!gd.firstPendingAt) gd.firstPendingAt = now;
    const wait = Math.max(0, Math.min(delay, gd.firstPendingAt + MAX_WAIT - now));
    clearTimeout(gd.timer);
    gd.timer = setTimeout(syncNow, wait);
  }

  // Called by OSR.save() (js/core.js) after every successful write.
  function gdriveNoteSave() {
    if (!meta.enabled || gd.applying || gd.status === 'conflict') return;
    if (gd.busy) { gd.again = true; return; }
    if (gd.status === 'synced') setStatus('pending');
    schedule(UPLOAD_DELAY);
  }

  // Runs a pending upload now (tests, and the tab going to the background).
  function gdriveFlush() {
    if (!gd.timer) return Promise.resolve();
    return syncNow();
  }

  async function connect(reconnect) {
    if (!driveSupported()) return;
    if (!clientId()) {
      alert('Enter your Google OAuth client ID first (Settings → Google Drive sync → Setup).');
      const d = $('#gd-setup'); if (d) d.open = true;
      return;
    }
    try {
      await requestToken(reconnect && meta.email ? { prompt: '', login_hint: meta.email } : {});
    } catch (e) {
      setStatus(meta.enabled ? 'signed-out' : 'off', e.message);
      alert(e.message);
      return;
    }
    const first = !meta.enabled;
    meta.enabled = true;
    if (first || !meta.email) meta.email = await fetchEmail();
    saveMeta();
    // No email in the log line: the log is campaign data (exported, synced, shared).
    if (first) OSR.pushNote('Google Drive', 'Connected');
    await syncNow();
  }

  function disconnect() {
    if (!confirm('Stop syncing this browser with Google Drive?\n\nThe campaign stays in this browser, and the file stays in your Drive.')) return;
    clearTimeout(gd.timer);
    gd.timer = null;
    clearToken();
    meta = Object.assign({}, META_DEFAULTS, { clientId: meta.clientId });
    saveMeta();
    gd.conflict = null;
    closeGdriveModal();
    setStatus('off');
    OSR.pushNote('Google Drive', 'Disconnected');
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

  function openGdriveModal() {
    const c = gd.conflict;
    if (!c) return;
    let remoteState = {};
    try { remoteState = JSON.parse(c.text) || {}; } catch (e) { /* summarized as empty */ }
    $('#gd-modal-title').textContent = c.mode === 'link' ? 'Campaign found in Google Drive' : 'Google Drive copy changed';
    $('#gd-modal-text').textContent = c.mode === 'link'
      ? 'Your Google Drive already has a Character Keeper campaign, and it is different from the one in this browser. Choose which one to keep. The other one is replaced.'
      : 'The Drive copy changed on another device, and this browser has changes too. Choose which one to keep. The other one is replaced.';
    // Counts alone often match (one character added on each side), so also
    // name the characters that only one copy has.
    const charNames = s => (Array.isArray(s.characters) ? s.characters : []).map(ch => String((ch && ch.name) || ''));
    const remoteNames = charNames(remoteState), localNames = charNames(OSR.state);
    const onlyIn = (a, b) => {
      const only = a.filter(x => b.indexOf(x) === -1);
      return only.length ? ' Only here: ' + only.join(', ') + '.' : '';
    };
    $('#gd-modal-compare').innerHTML =
      '<li><b>Google Drive</b> (saved ' + OSR.escapeHtml(fmtTime(c.remote.modifiedTime)) + '): ' +
        OSR.escapeHtml(summarize(remoteState) + '.' + onlyIn(remoteNames, localNames)) + '</li>' +
      '<li><b>This browser</b>: ' + OSR.escapeHtml(summarize(OSR.state) + '.' + onlyIn(localNames, remoteNames)) + '</li>';
    $('#gd-use-drive').classList.toggle('btn-primary', c.mode === 'link');
    $('#gd-modal').hidden = false;
  }
  function closeGdriveModal() { const m = $('#gd-modal'); if (m) m.hidden = true; }

  function useDriveCopy() {
    const c = gd.conflict;
    if (!c) return;
    try { applyRemote(c.text, c.remote); }
    catch (e) { alert(e.message); return; }
    gd.conflict = null;
    closeGdriveModal();
    setStatus('synced');
    OSR.pushNote('Google Drive', 'Replaced this browser’s campaign with the Drive copy');
  }

  async function useLocalCopy() {
    const c = gd.conflict;
    if (!c) return;
    gd.conflict = null;
    closeGdriveModal();
    // Make the next pass see "only this browser changed": it uploads over the file.
    meta.fileId = c.remote.id;
    meta.remoteMd5 = c.remote.md5Checksum || '';
    meta.syncedHash = '';
    saveMeta();
    setStatus('pending');
    OSR.pushNote('Google Drive', 'Replaced the Drive copy with this browser’s campaign'); // saves → schedules
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
    const who = meta.email ? ' as ' + meta.email : '';
    const last = meta.lastSync ? ' Last synced ' + fmtTime(meta.lastSync) + '.' : '';
    switch (gd.status) {
      case 'synced': return 'Connected' + who + '. The campaign is saved in your Drive as “' + FILE_NAME + '”.' + last;
      case 'pending':
      case 'syncing': return 'Connected' + who + '. Saving changes to Drive…';
      case 'signed-out': return 'Google sign-in expired (it lasts about an hour). Your changes stay in this browser. Click Reconnect to sync them.' + last;
      case 'conflict': return 'The Drive copy and this browser both have changes. Click Resolve to choose which one to keep.';
      case 'error': return 'Sync failed: ' + gd.message + last;
      default: return 'Off. Connect to save this campaign in your Google Drive and keep it the same in every browser where you connect.';
    }
  }

  function renderGdrive() {
    const btn = $('#gd-status');
    if (btn) {
      const v = meta.enabled && STATUS_VIEW[gd.status];
      btn.hidden = !v;
      if (v) {
        btn.className = 'btn gd-status' + (v.cls ? ' ' + v.cls : '');
        btn.innerHTML = '<i class="fa-solid ' + v.icon + '"></i>' + OSR.escapeHtml(v.label);
        btn.title = statusText();
      }
    }
    const hint = $('#gd-hint');
    if (!hint) return;
    const supported = driveSupported();
    if (!supported) {
      hint.textContent = 'Needs the app on a web address: GitHub Pages, or a local server such as “python3 -m http.server”. Google sign-in does not work from a file:// page.';
    } else if (!clientId() && !meta.enabled) {
      hint.textContent = 'Set your OAuth client ID under Setup first.';
    } else {
      hint.textContent = statusText();
    }
    const connectBtn = $('#gd-connect');
    connectBtn.hidden = meta.enabled && gd.status !== 'signed-out';
    connectBtn.textContent = meta.enabled ? 'Reconnect' : 'Connect';
    connectBtn.disabled = !supported || !clientId();
    $('#gd-resolve').hidden = gd.status !== 'conflict';
    $('#gd-sync').hidden = !meta.enabled || gd.status === 'signed-out' || gd.status === 'conflict';
    $('#gd-sync').disabled = gd.status === 'syncing';
    $('#gd-disconnect').hidden = !meta.enabled;
    const input = $('#gd-client-id');
    if (input && document.activeElement !== input) input.value = meta.clientId || '';
    if (input) input.placeholder = DEFAULT_CLIENT_ID || '1234567890-abc123.apps.googleusercontent.com';
    const origin = $('#gd-origin');
    if (origin) origin.textContent = supported ? location.origin : '(none: file:// page)';
    // Preload once, so Connect opens its popup inside the click (see requestToken).
    if (supported && clientId() && !gisPreloaded) { gisPreloaded = true; loadGis().catch(() => {}); }
  }

  // Called at the end of init() (js/main.js), after seeding.
  function initGdrive() {
    renderGdrive();
    if (!meta.enabled || !driveSupported()) return;
    if (token()) syncNow();
    else setStatus('signed-out');
  }

  function wireGdrive() {
    $('#gd-connect').addEventListener('click', () => connect(meta.enabled));
    $('#gd-sync').addEventListener('click', () => syncNow());
    $('#gd-resolve').addEventListener('click', openGdriveModal);
    $('#gd-disconnect').addEventListener('click', disconnect);
    $('#gd-client-id').addEventListener('change', e => {
      meta.clientId = e.target.value.trim();
      saveMeta();
      renderGdrive();
    });
    $('#gd-status').addEventListener('click', () => {
      if (gd.status === 'signed-out') connect(true);
      else if (gd.status === 'conflict') openGdriveModal();
      else syncNow();
    });
    $('#gd-use-drive').addEventListener('click', useDriveCopy);
    $('#gd-use-local').addEventListener('click', useLocalCopy);
    $('#gd-export').addEventListener('click', () => OSR.exportData());
    $('#gd-later').addEventListener('click', closeGdriveModal);
    // Another device may have changed the file: check when the tab comes back.
    // Going to the background flushes a pending upload instead of waiting.
    document.addEventListener('visibilitychange', () => {
      if (!meta.enabled || !token()) return;
      if (document.visibilityState === 'hidden') gdriveFlush();
      else if (Date.now() - gd.lastCheck > FOCUS_CHECK_MS) syncNow();
    });
    window.addEventListener('online', () => { if (meta.enabled && token()) syncNow(); });
  }

  // Test-only view of the per-device bookkeeping.
  function gdriveState() { return { status: gd.status, message: gd.message, meta: Object.assign({}, meta), conflict: gd.conflict }; }
  function gdriveReload() { meta = Object.assign({}, META_DEFAULTS, readJson(META_KEY) || {}); gd.status = meta.enabled ? 'signed-out' : 'off'; }

  Object.assign(OSR, {
    GDRIVE_SCOPE: SCOPE, GDRIVE_FILE_NAME: FILE_NAME, GDRIVE_META_KEY: META_KEY, GDRIVE_TOKEN_KEY: TOKEN_KEY,
    driveSupported, hashText, decideSync, gdriveNoteSave, gdriveFlush, gdriveSyncNow: syncNow,
    gdriveConnect: connect, gdriveDisconnect: disconnect, gdriveUseDriveCopy: useDriveCopy, gdriveUseLocalCopy: useLocalCopy,
    openGdriveModal, closeGdriveModal, renderGdrive, initGdrive, wireGdrive, gdriveState, gdriveReload
  });
})(window.OSR = window.OSR || {});
