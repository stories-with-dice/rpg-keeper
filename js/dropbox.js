/* js/dropbox.js — optional Dropbox sync of the campaigns and the seeds.
 *
 * Off until the user clicks Settings → Dropbox sync → Connect. Then the app
 * folder (Apps/<app name>/) holds:
 *   /campaigns/index.json            the campaign list [{ id, name, createdAt, primary }]
 *   /campaigns/<id>/shared.json      a campaign's 'campaign' document (js/store.js)
 *   /campaigns/<id>/<system>.json    its document for each system
 *   /campaigns/<id>/maps/<blob>.<ext>  a map image (js/maps.js); never changes
 *   /seeds/<system>.json             the seed of each system (js/seeds.js)
 *   /tables.json                     the random tables (js/tables.js)
 * Every save() (js/core.js calls OSR.dropboxNoteSave) uploads the changed
 * files a few seconds later. Each file is synced on its own, by its
 * content_hash. Older versions kept a whole campaign in one file
 * ("Character Keeper campaign.json", or /campaigns/<id>/campaign.json); the
 * first pass moves it aside as "... (before split).json" after syncing it.
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

  const META_DEFAULTS = { enabled: false, appKey: '', files: {}, legacy: {}, migrated: {}, hidden: {} };
  // One sync record for each Dropbox file, by lower-case path, in meta.files.
  // meta.legacy[campaignId] is the record of a campaign's old whole-campaign
  // file, meta.migrated[campaignId] is set once that file is split, and
  // meta.hidden[campaignId] marks a campaign deleted in this browser.
  const FILE_DEFAULTS = { fileId: '', remoteHash: '', syncedHash: '', lastSync: 0 };

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

  let meta = loadMeta();
  function loadMeta() {
    const m = Object.assign({}, META_DEFAULTS, readJson(META_KEY) || {});
    ['files', 'legacy', 'migrated', 'hidden'].forEach(k => { if (!m[k] || typeof m[k] !== 'object') m[k] = {}; });
    return m;
  }
  function saveMeta() { writeJson(META_KEY, meta); }
  // Disconnect: forget every record, keep the app key.
  function loadMetaDefaults(key) {
    return Object.assign({}, META_DEFAULTS, { appKey: key, files: {}, legacy: {}, migrated: {}, hidden: {} });
  }

  const rec = path => meta.files[path.toLowerCase()] || FILE_DEFAULTS;
  function setRec(path, values) {
    const k = path.toLowerCase();
    meta.files[k] = Object.assign({}, FILE_DEFAULTS, meta.files[k], values);
    saveMeta();
  }
  const legacyRec = id => meta.legacy[id] || FILE_DEFAULTS;
  function setLegacyRec(id, values) {
    meta.legacy[id] = Object.assign({}, FILE_DEFAULTS, meta.legacy[id], values);
    saveMeta();
  }

  // Older versions kept a flat record on meta (one campaign, one file), then
  // one record per campaign id in meta.files (one file per campaign). Both
  // describe an old whole-campaign file: they move to meta.legacy.
  function migrateMeta() {
    let changed = false;
    if ('fileId' in meta) {
      const primary = OSR.campaigns.find(c => c.primary) || OSR.campaigns[0];
      if (primary && !meta.legacy[primary.id]) {
        meta.legacy[primary.id] = { fileId: meta.fileId || '', remoteHash: meta.remoteHash || '', syncedHash: meta.syncedHash || '', lastSync: meta.lastSync || 0 };
      }
      ['fileId', 'remoteHash', 'syncedHash', 'lastSync'].forEach(k => delete meta[k]);
      changed = true;
    }
    Object.keys(meta.files).forEach(k => {
      if (k.charAt(0) === '/') return;
      if (!meta.legacy[k]) meta.legacy[k] = meta.files[k];
      delete meta.files[k];
      changed = true;
    });
    if (changed) saveMeta();
  }

  /* ---- Dropbox layout ---- */
  const LEGACY_FILE = FILE_PATH;
  const INDEX_PATH = '/campaigns/index.json';
  const campaignDir = id => '/campaigns/' + id;
  const docPath = (id, key) => campaignDir(id) + '/' + (key === 'campaign' ? 'shared' : key) + '.json';
  const seedPath = sys => '/seeds/' + sys + '.json';
  const TABLES_PATH = '/tables.json';
  const IMAGE_EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };
  const blobPath = (id, blobId, type) => campaignDir(id) + '/maps/' + blobId + '.' + (IMAGE_EXT[type] || 'bin');
  // The old whole-campaign file of a campaign, and where the split moves it.
  const legacyPath = c => (c.primary ? LEGACY_FILE : campaignDir(c.id) + '/campaign.json');
  const backupPath = c => (c.primary ? '/Character Keeper campaign (before split).json' : campaignDir(c.id) + '/campaign (before split).json');
  const hasDocRecords = id => Object.keys(meta.files).some(k => k.startsWith(campaignDir(id).toLowerCase() + '/'));

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
    return { id: f.id, rev: f.rev, hash: f.content_hash || '', path: f.path_lower, modified: f.server_modified || '' };
  }

  // Every file in the app folder, by lower-case path: one listing per pass.
  async function listAll() {
    const out = new Map();
    let r = await apiCall('files/list_folder', { path: '', recursive: true });
    for (;;) {
      (r.entries || []).forEach(e => { if (e['.tag'] === 'file') out.set(e.path_lower, toRemote(e)); });
      if (!r.has_more) return out;
      r = await apiCall('files/list_folder/continue', { cursor: r.cursor });
    }
  }

  // By rev, so the text always matches the metadata the pass decided on.
  async function downloadRemote(remote) {
    return (await dbxFetch(CONTENT_API + '/files/download', {
      headers: { 'Dropbox-API-Arg': headerJson({ path: 'rev:' + remote.rev }) }
    })).text();
  }

  // Binary files (map images) are written once and never change: no rev, no record.
  async function uploadBytes(path, bytes) {
    try {
      await dbxFetch(CONTENT_API + '/files/upload', {
        headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': headerJson({ path, mode: 'add', autorename: false, mute: true }) },
        body: bytes
      });
    } catch (e) { if (!/conflict/.test(e.summary)) throw e; } // already there
  }
  async function downloadBytes(path) {
    return (await dbxFetch(CONTENT_API + '/files/download', {
      headers: { 'Dropbox-API-Arg': headerJson({ path }) }
    })).arrayBuffer();
  }

  // Creates the file at `path`, or replaces it only if it is still at
  // `remote.rev`: Dropbox refuses (409 conflict) when another device wrote in between.
  async function uploadText(path, text, remote) {
    const arg = remote
      ? { path: remote.path, mode: { '.tag': 'update', update: remote.rev }, autorename: false, mute: true }
      : { path, mode: 'add', autorename: false, mute: true };
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

  function recordFile(path, remote, hash) {
    setRec(path, { fileId: remote.id, remoteHash: remote.hash, syncedHash: hash, lastSync: Date.now() });
  }

  // One file against its Dropbox copy: uploads when only this browser changed
  // (or Dropbox has no file), and records a download whose text is the same.
  // Otherwise returns the downloaded text for the caller: action 'pull' (only
  // Dropbox changed), 'link', or 'conflict'.
  async function syncFile(path, localText, listing) {
    const remote = listing.get(path.toLowerCase()) || null;
    const hash = hashText(localText);
    const action = decideSync(remote, rec(path), hash);
    if (action === 'noop') return { action };
    if (action === 'create' || action === 'upload') {
      recordFile(path, await uploadText(path, localText, action === 'upload' ? remote : null), hash);
      return { action };
    }
    const text = await downloadRemote(remote);
    if (action !== 'pull' && hashText(text) === hash) { recordFile(path, remote, hash); return { action: 'noop' }; }
    return { action, text, remote, hash };
  }

  // Step 1: a campaign's old whole-campaign file. Synced with the old rules
  // (a pull replaces the whole campaign; both sides changed → ask), then moved
  // aside, so the split files of step 4 take over. 'conflict' stops the pass.
  async function legacyStep(c, listing) {
    if (!c || meta.migrated[c.id]) return 'done';
    const remote = listing.get(legacyPath(c).toLowerCase());
    if (remote) {
      const hash = hashText(JSON.stringify(OSR.state));
      const action = decideSync(remote, legacyRec(c.id), hash);
      if (action === 'pull' || action === 'link' || action === 'conflict') {
        const text = await downloadRemote(remote);
        const mode = action === 'pull' && hashText(JSON.stringify(OSR.state)) !== hash ? 'conflict' : action;
        if (mode === 'pull') await applyLegacy(c, text, remote);
        else if (hashText(text) !== hash) {
          dbx.conflict = { mode, campaignId: c.id, legacy: true, files: [{ path: remote.path, remote, text }] };
          return 'conflict';
        }
      }
      // In sync, or this browser's copy wins: the split files are made from it.
      await apiCall('files/move_v2', { from_path: remote.path, to_path: backupPath(c), autorename: true });
    }
    meta.migrated[c.id] = true;
    delete meta.legacy[c.id];
    saveMeta();
    return remote ? 'moved' : 'done';
  }

  async function applyLegacy(c, text, remote) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw dbxError(0, 'The Dropbox file is not valid JSON.'); }
    if (!data || !Array.isArray(data.characters)) throw dbxError(0, 'The Dropbox file has no "characters" array.');
    await replaceAndWait(data);
    setLegacyRec(c.id, { fileId: remote.id, remoteHash: remote.hash, syncedHash: hashText(JSON.stringify(OSR.state)), lastSync: Date.now() });
  }

  // replaceState() saves at once (dropboxNoteSave sees `applying` and skips),
  // then resolves when the write reached the storage. Not saved = a reload
  // brings back the old campaign: never record a sync that would then upload
  // it over the Dropbox copy.
  // A refused write puts the previous campaign back, as a refused content
  // pack does (js/io.js), so the next pass sees the same pull again.
  async function replaceAndWait(data) {
    const before = OSR.state;
    dbx.applying = true;
    let written;
    try { written = OSR.replaceState(data); } finally { dbx.applying = false; }
    if (await written) return;
    dbx.applying = true;
    try { OSR.replaceState(before); } finally { dbx.applying = false; }
    throw dbxError(0, 'The browser storage is full, so the Dropbox copy could not be saved here.');
  }

  // Step 2: the campaign list. A pull adds the campaigns this browser lacks
  // and takes their names; both changed → the union, then upload. A fresh
  // browser's first campaign takes the id of the primary campaign in Dropbox
  // (its files then sync, or ask, like any other device's).
  function indexText() {
    return JSON.stringify(OSR.campaigns.map(c => ({ id: c.id, name: c.name, createdAt: c.createdAt, primary: !!c.primary })));
  }
  async function syncIndex(listing) {
    const r = await syncFile(INDEX_PATH, indexText(), listing);
    if (!r.text) return;
    let list = [];
    try { list = JSON.parse(r.text); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    const lp = OSR.campaigns.find(c => c.primary);
    const rp = list.find(c => c && c.primary);
    let adopted = null;
    if (lp && rp && lp.id !== rp.id && !list.some(c => c.id === lp.id) && !OSR.campaigns.some(c => c.id === rp.id) && !hasDocRecords(lp.id)) {
      await OSR.rekeyCampaign(lp.id, rp.id);
      ['legacy', 'migrated'].forEach(k => { if (meta[k][lp.id]) { meta[k][rp.id] = meta[k][lp.id]; delete meta[k][lp.id]; } });
      saveMeta();
      adopted = rp.id;
    }
    list.forEach(rc => {
      if (!rc || !rc.id || meta.hidden[rc.id]) return;
      const lc = OSR.campaigns.find(c => c.id === rc.id);
      if (!lc) OSR.campaigns.push({ id: rc.id, name: String(rc.name || 'Campaign'), createdAt: rc.createdAt || Date.now(), primary: !!rc.primary });
      else if ((r.action === 'pull' || rc.id === adopted) && rc.name) Object.assign(lc, { name: String(rc.name), createdAt: rc.createdAt || lc.createdAt });
    });
    await OSR.writeCampaigns();
    if (OSR.renderCampaigns) OSR.renderCampaigns();
    const merged = indexText();
    recordFile(INDEX_PATH, merged === r.text ? r.remote : await uploadText(INDEX_PATH, merged, r.remote), hashText(merged));
  }

  // Step 3: the seeds. A pull replaces this browser's seed; both changed →
  // merged (js/seeds.js's mergeSeeds), then upload. Never asks.
  async function syncSeeds(listing) {
    for (const sys of OSR.SYSTEMS) {
      const seed = OSR.seeds[sys];
      const path = seedPath(sys);
      if (!seed || (!seed.compendium.length && !seed.monsters.length && !listing.has(path))) continue;
      const r = await syncFile(path, JSON.stringify(seed), listing);
      if (!r.text) continue;
      let remoteSeed;
      try { remoteSeed = JSON.parse(r.text); } catch (e) { continue; }
      const next = r.action === 'pull' ? remoteSeed : OSR.mergeSeeds(seed, remoteSeed);
      await OSR.setSeed(sys, next);
      const text = JSON.stringify(next);
      recordFile(path, r.action === 'pull' ? r.remote : await uploadText(path, text, r.remote), hashText(text));
    }
  }

  // Step 3b: the table library (js/tables.js), shared by every campaign. Like
  // the seeds: a pull replaces it; both changed → merged, then upload.
  async function syncTables(listing) {
    const lib = OSR.tableLib;
    if (!lib.tables.length && !Object.keys(lib.deleted).length && !listing.has(TABLES_PATH)) return;
    const r = await syncFile(TABLES_PATH, JSON.stringify(lib), listing);
    if (!r.text) return;
    let remoteLib;
    try { remoteLib = JSON.parse(r.text); } catch (e) { return; }
    const next = r.action === 'pull' ? remoteLib : OSR.mergeTableLibs(lib, remoteLib);
    await OSR.setTableLibrary(next);
    const text = JSON.stringify(OSR.tableLib);
    recordFile(TABLES_PATH, r.action === 'pull' ? r.remote : await uploadText(TABLES_PATH, text, r.remote), hashText(text));
  }

  // Step 4: the current campaign's documents (js/store.js's splitState).
  // Pulled documents replace their part of OSR.state together; documents
  // changed on both sides (or found in Dropbox before this browser synced
  // them) go to one question for the whole campaign.
  async function syncDocs(c, listing) {
    const docs = OSR.serializeState(OSR.state);
    const pulled = [], conflicts = [];
    for (const key of Object.keys(docs)) {
      const path = docPath(c.id, key);
      const r = await syncFile(path, docs[key], listing);
      if (!r.text) continue;
      // An edit made during the download turns a pull into a conflict.
      const mode = r.action === 'pull' && OSR.serializeState(OSR.state)[key] !== docs[key] ? 'conflict' : r.action;
      (mode === 'pull' ? pulled : conflicts).push({ key, path, mode, remote: r.remote, text: r.text });
    }
    if (pulled.length) await applyDocs(pulled);
    if (!conflicts.length) return 'synced';
    dbx.conflict = { mode: conflicts.every(f => f.mode === 'link') ? 'link' : 'conflict', campaignId: c.id, files: conflicts };
    return 'conflict';
  }

  // Step 5: the map images of the current campaign's scenes that Dropbox lacks
  // are uploaded. A missing local image is downloaded when its scene shows
  // (dropboxFetchBlob), not here.
  async function syncBlobs(c, listing) {
    const done = new Set();
    for (const sc of OSR.state.scenes || []) {
      if (!sc.imageBlobId || done.has(sc.imageBlobId)) continue;
      done.add(sc.imageBlobId);
      const path = blobPath(c.id, sc.imageBlobId, sc.imageType);
      if (listing.has(path.toLowerCase())) continue;
      const rec = await OSR.store.getBlob(sc.imageBlobId);
      if (rec) await uploadBytes(path, rec.bytes);
    }
  }

  // OSR.state with the given Dropbox documents in place of this browser's.
  function withDocs(files) {
    const docs = OSR.splitState(OSR.state);
    files.forEach(f => {
      try { docs[f.key] = JSON.parse(f.text); } catch (e) { throw dbxError(0, 'The Dropbox file ' + f.path + ' is not valid JSON.'); }
    });
    return OSR.joinState(docs);
  }

  async function applyDocs(files) {
    await replaceAndWait(withDocs(files));
    const now = OSR.serializeState(OSR.state);
    files.forEach(f => recordFile(f.path, f.remote, hashText(now[f.key])));
  }

  async function syncNow() {
    clearTimeout(dbx.timer);
    dbx.timer = null;
    if (!meta.enabled || dbx.status === 'conflict') return;
    if (dbx.busy) { dbx.again = true; return; }
    if (!hasToken()) { setStatus('signed-out'); return; }
    dbx.busy = true;
    let passDone;
    dbx.pass = new Promise(r => { passDone = r; }); // awaited by dropboxBeforeCampaignSwitch
    dbx.firstPendingAt = 0;
    dbx.lastCheck = Date.now();
    setStatus('syncing');
    try {
      let listing = await listAll();
      const legacy = await legacyStep(OSR.currentCampaign(), listing);
      if (legacy === 'conflict') { setStatus('conflict'); openDropboxModal(); return; }
      if (legacy === 'moved') listing = await listAll();
      await syncIndex(listing);
      await syncSeeds(listing);
      await syncTables(listing);
      // The index step may have given the current campaign a new id.
      if ((await syncDocs(OSR.currentCampaign(), listing)) === 'conflict') { setStatus('conflict'); openDropboxModal(); return; }
      await syncBlobs(OSR.currentCampaign(), listing);
      setStatus('synced');
    } catch (e) {
      if (e.status === 401) setStatus('signed-out');
      // Another device wrote between our check and our upload: the next pass sees it.
      else if (/conflict/.test(e.summary)) { setStatus('pending'); dbx.again = true; }
      else setStatus('error', e.message);
    } finally {
      dbx.busy = false;
      dbx.pass = null;
      passDone();
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
    meta = loadMetaDefaults(meta.appKey);
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

  // The Dropbox side of an open question, as a whole campaign.
  function conflictRemoteState(c) {
    if (c.legacy) { try { return JSON.parse(c.files[0].text) || {}; } catch (e) { return {}; } }
    try { return withDocs(c.files); } catch (e) { return {}; }
  }

  function openDropboxModal() {
    const c = dbx.conflict;
    if (!c) return;
    const remoteState = conflictRemoteState(c);
    $('#dbx-modal-title').textContent = c.mode === 'link' ? 'Campaign found in Dropbox' : 'Dropbox copy changed';
    $('#dbx-modal-text').textContent = (c.mode === 'link'
      ? 'Your Dropbox already has this Character Keeper campaign, and it is different from the one in this browser. Choose which one to keep. The other one is replaced.'
      : 'The Dropbox copy changed on another device, and this browser has changes too. Choose which one to keep. The other one is replaced.') +
      (c.legacy ? '' : ' Files: ' + c.files.map(f => f.path.split('/').pop()).join(', ') + '.');
    // Counts alone often match (one character added on each side), so also
    // name the characters that only one copy has.
    const charNames = s => (Array.isArray(s.characters) ? s.characters : []).map(ch => String((ch && ch.name) || ''));
    const remoteNames = charNames(remoteState), localNames = charNames(OSR.state);
    const onlyIn = (a, b) => {
      const only = a.filter(x => b.indexOf(x) === -1);
      return only.length ? ' Only here: ' + only.join(', ') + '.' : '';
    };
    const newest = c.files.map(f => f.remote.modified).sort().pop();
    $('#dbx-modal-compare').innerHTML =
      '<li><b>Dropbox</b> (saved ' + OSR.escapeHtml(fmtTime(newest)) + '): ' +
        OSR.escapeHtml(summarize(remoteState) + '.' + onlyIn(remoteNames, localNames)) + '</li>' +
      '<li><b>This browser</b>: ' + OSR.escapeHtml(summarize(OSR.state) + '.' + onlyIn(localNames, remoteNames)) + '</li>';
    $('#dbx-use-remote').classList.toggle('btn-primary', c.mode === 'link');
    $('#dbx-modal').hidden = false;
  }
  function closeDropboxModal() { const m = $('#dbx-modal'); if (m) m.hidden = true; }

  async function useRemoteCopy() {
    const c = dbx.conflict;
    if (!c) return;
    try {
      if (c.legacy) await applyLegacy(OSR.currentCampaign(), c.files[0].text, c.files[0].remote);
      else await applyDocs(c.files);
    } catch (e) { alert(e.message); return; }
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
    // Make the next pass see "only this browser changed": it uploads over the files.
    c.files.forEach(f => {
      const values = { fileId: f.remote.id, remoteHash: f.remote.hash, syncedHash: '' };
      if (c.legacy) setLegacyRec(c.campaignId, values); else setRec(f.path, values);
    });
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
    const lastSync = Object.keys(meta.files).reduce((t, k) => Math.max(t, meta.files[k].lastSync || 0), 0);
    const last = lastSync ? ' Last synced ' + fmtTime(lastSync) + '.' : '';
    switch (dbx.status) {
      case 'synced': return 'Connected. Your campaigns are saved in your Dropbox app folder, in the “campaigns” folder.' + last;
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
    migrateMeta();
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
  function dropboxState() {
    return { status: dbx.status, message: dbx.message, meta: JSON.parse(JSON.stringify(meta)), conflict: dbx.conflict, auth: dbx.auth };
  }

  /* ---- Campaign switch (js/campaigns.js) ---- */
  // Uploads what the current campaign still has queued and waits for a
  // running pass, so no pass mixes two campaigns. A conflict stays unsolved:
  // the dialog comes back when that campaign is active again.
  async function dropboxBeforeCampaignSwitch() {
    for (let i = 0; i < 5 && (dbx.timer || dbx.pass); i++) {
      if (dbx.pass) await dbx.pass; else await syncNow();
    }
    clearTimeout(dbx.timer);
    dbx.timer = null;
    dbx.firstPendingAt = 0;
    dbx.conflict = null;
    closeDropboxModal();
  }
  function dropboxCampaignChanged() {
    if (dbx.status === 'conflict') setStatus('pending');
    if (meta.enabled && hasToken()) syncNow(); else renderDropbox();
  }
  // A campaign deleted in this browser: its records go, and a pull of the
  // index does not bring it back here (its Dropbox files stay).
  function dropboxForgetCampaign(id) {
    const dir = campaignDir(id).toLowerCase() + '/';
    Object.keys(meta.files).forEach(k => { if (k.startsWith(dir)) delete meta.files[k]; });
    delete meta.legacy[id];
    delete meta.migrated[id];
    meta.hidden[id] = true;
    saveMeta();
  }

  // A map image this browser lacks (js/maps.js shows a scene from another
  // device): downloads it from the current campaign's folder into IndexedDB.
  // Resolves to the stored record, or null.
  async function dropboxFetchBlob(blobId, type) {
    if (!meta.enabled || !hasToken() || !OSR.currentCampaign()) return null;
    try {
      const bytes = await downloadBytes(blobPath(OSR.currentCampaign().id, blobId, type));
      const rec = { bytes, type: type || 'application/octet-stream' };
      await OSR.store.putBlob(blobId, rec);
      return rec;
    } catch (e) {
      console.warn('dropbox: could not download the map image', e);
      return null;
    }
  }

  // A campaign this browser has no documents for (one another device made):
  // downloads its files into IndexedDB before js/campaigns.js opens it.
  // Resolves to true when it found any.
  async function dropboxFetchCampaign(id) {
    if (!meta.enabled || !hasToken()) return false;
    try {
      const listing = await listAll();
      const docs = {};
      for (const key of ['campaign'].concat(OSR.SYSTEMS)) {
        const path = docPath(id, key);
        const remote = listing.get(path.toLowerCase());
        if (!remote) continue;
        docs[key] = await downloadRemote(remote);
        recordFile(path, remote, hashText(docs[key]));
      }
      if (!Object.keys(docs).length) return false;
      await OSR.store.putDocs(id, docs);
      return true;
    } catch (e) {
      console.warn('dropbox: could not download the campaign', e);
      return false;
    }
  }

  Object.assign(OSR, {
    DROPBOX_FILE_NAME: FILE_NAME, DROPBOX_META_KEY: META_KEY, DROPBOX_TOKEN_KEY: TOKEN_KEY,
    hashText, decideSync, pkcePair, dropboxNoteSave, dropboxFlush, dropboxSyncNow: syncNow,
    dropboxConnect: connect, dropboxConnectWithCode: connectWithCode, dropboxFinishConnect: finishConnect,
    dropboxFinishRedirect: finishRedirect, DROPBOX_PENDING_KEY: PENDING_KEY,
    dropboxBeforeCampaignSwitch, dropboxCampaignChanged, dropboxForgetCampaign, dropboxFetchCampaign, dropboxFetchBlob,
    dropboxBlobPath: blobPath,
    DROPBOX_INDEX_PATH: INDEX_PATH, dropboxDocPath: docPath, dropboxSeedPath: seedPath,
    // Leaves the app for Dropbox's consent page. Tests replace it.
    dropboxRedirect: url => location.assign(url), dropboxDisconnect: disconnect,
    dropboxUseRemoteCopy: useRemoteCopy, dropboxUseLocalCopy: useLocalCopy,
    openDropboxModal, closeDropboxModal, renderDropbox, initDropbox, wireDropbox, dropboxState
  });
})(window.OSR = window.OSR || {});
