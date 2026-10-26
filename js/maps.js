/* js/maps.js — the Maps tab: scenes (a map image with a grid), one SVG view
 * with pan and zoom, the measure tool, and grid calibration.
 *
 * A scene lives in OSR.state.scenes (split by system into the system
 * documents, js/store.js) and is shown only under its own System:
 *   { id, name, system, imageBlobId, imageType, imageUrl, width, height,
 *     grid: { type, orient, size, offsetX, offsetY, unitsPerCell, unit, show, locked },
 *     hexcrawl: { on, explored, coords }, tokens: [], drawings: [], pins: [] }
 * state.activeSceneIds[system] is the open scene of each system. The image
 * itself is a blob in IndexedDB (OSR.store.putBlob, `imageBlobId`), synced to
 * Dropbox by js/dropbox.js; an image that could not be downloaded keeps only
 * its address (`imageUrl`). Grid geometry is js/grid.js (window.MapGrid).
 *
 * The SVG has these layers, in order: image, grid, drawings, pins, tokens,
 * overlay (tool feedback). The view (viewBox) of each scene is kept in memory
 * only. Map coordinates are the image's own pixels.
 *
 * Pop out (#map-popout) opens index.html?view=map in a window of its own. That
 * window loads the app's scripts but no campaign: attachToMain() points its
 * OSR.state at the main window's (window.opener) and sends its saves, log
 * lines, and undo steps there, so both windows edit one state. Every save in
 * the main window calls notifyMapViews(), which redraws each open pop-out
 * (and this window's own map, for a change made in a pop-out).
 */
(function (OSR) {
  'use strict';
  const { $, $$, escapeHtml, uid } = OSR;
  const G = window.MapGrid;

  const NEW = '__new';
  const MAX_SIDE = 8192;                     // images are scaled down to this
  const BLANK = { width: 2000, height: 1500 }; // a scene with no image
  const MAX_GRID_CELLS = 4000;               // more visible cells than this: the grid is not drawn
  const GRID_DEFAULTS = { type: 'hex', orient: 'flat', size: 50, offsetX: 0, offsetY: 0, unitsPerCell: 5, unit: 'ft', show: true, locked: false };

  let tool = 'pan';
  // Sticky mode (on by default, kept in this browser): a tool stays chosen
  // after it is used. Off: the hand tool comes back after one use.
  const STICKY_KEY = 'osr_map_sticky';
  let sticky = (() => { try { return localStorage.getItem(STICKY_KEY) !== 'off'; } catch (e) { return true; } })();
  // Right-click pan (off by default, kept in this browser): a right-button
  // drag on the map moves the view, and the browser's menu does not open.
  // Off: a right-click on the map opens mapMenu().
  const RCLICK_KEY = 'osr_map_rclick_pan';
  let rclickPan = (() => { try { return localStorage.getItem(RCLICK_KEY) === 'on'; } catch (e) { return false; } })();
  // What a right-click on the map treats as an element, not the map itself.
  const MAP_ELEMENTS = '[data-token], [data-drawing], [data-pin]';
  // Alt + a key (KeyboardEvent.code, so it works with any layout and on a Mac,
  // where Alt+1 types a character): the buttons of the toolbar.
  const KEY_CODES = { Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0', Minus: '-', Equal: '=' };
  const KEY_BUTTONS = { KeyS: '#map-sticky', KeyF: '#map-fit', KeyO: '#map-popout' };
  const KEY_PANELS = { KeyG: '#map-grid-panel', KeyK: '#map-token-panel' };
  const TOOL_HINTS = {
    calibrate: 'Drag over one cell of the map to set the grid.', measure: 'Drag to measure.',
    pen: 'Drag to draw.', line: 'Drag to draw a line.', rect: 'Drag to draw a rectangle.', ellipse: 'Drag to draw an ellipse.',
    polygon: 'Click each corner. Click the first corner, double-click, or press Enter to finish. Escape cancels.',
    text: 'Click where the text goes.', eraser: 'Click or drag over drawings to erase them.',
    pin: 'Click where the note goes.', explore: 'Click a hex to mark it explored, or not.'
  };
  const views = Object.create(null);  // scene id -> { x, y, w, h }
  const images = new Map();           // blob id -> object URL | 'loading' | 'missing'
  let drag = null;                    // the pointer drag in progress
  let overlay = null;                 // { kind: 'measure' | 'calibrate', a, b }
  let status = '';
  let pendingImage = null;            // a pasted image waiting in the New scene dialog
  const calibrateSpan = () => Math.max(1, Math.round(Number(($('#grid-span') || {}).value) || 1));

  function ensureSceneShape(sc) {
    if (!sc.id) sc.id = uid();
    sc.name = sc.name == null || String(sc.name).trim() === '' ? 'Scene' : String(sc.name);
    sc.system = OSR.SYSTEMS.indexOf(sc.system) === -1 ? 'osr' : sc.system;
    sc.width = Number(sc.width) > 0 ? Number(sc.width) : BLANK.width;
    sc.height = Number(sc.height) > 0 ? Number(sc.height) : BLANK.height;
    sc.grid = Object.assign({}, GRID_DEFAULTS, sc.grid || {});
    if (sc.grid.type !== 'hex') sc.grid.type = 'square';
    if (sc.grid.orient !== 'pointy') sc.grid.orient = 'flat';
    sc.grid.size = Number(sc.grid.size) >= 4 ? Number(sc.grid.size) : GRID_DEFAULTS.size;
    ['offsetX', 'offsetY'].forEach(k => { sc.grid[k] = Number(sc.grid[k]) || 0; });
    sc.grid.unitsPerCell = Number(sc.grid.unitsPerCell) >= 0 ? Number(sc.grid.unitsPerCell) : GRID_DEFAULTS.unitsPerCell;
    sc.hexcrawl = Object.assign({ on: false, explored: [], coords: false }, sc.hexcrawl || {});
    sc.hexcrawl.on = !!sc.hexcrawl.on;
    sc.hexcrawl.coords = !!sc.hexcrawl.coords;
    sc.hexcrawl.explored = Array.isArray(sc.hexcrawl.explored) ? sc.hexcrawl.explored.filter(k => /^-?\d+,-?\d+$/.test(k)) : [];
    ['tokens', 'drawings', 'pins'].forEach(k => { if (!Array.isArray(sc[k])) sc[k] = []; });
    if (OSR.ensureTokenShape) sc.tokens.forEach(OSR.ensureTokenShape); // js/tokens.js
    if (OSR.ensureDrawingShape) sc.drawings.forEach(OSR.ensureDrawingShape); // js/drawings.js
    if (OSR.ensurePinShape) sc.pins.forEach(OSR.ensurePinShape); // js/pins.js
    return sc;
  }

  const scenesForSystem = () => OSR.state.scenes.filter(sc => sc.system === OSR.currentSystem());
  function activeScene() {
    const list = scenesForSystem();
    const id = OSR.state.activeSceneIds[OSR.currentSystem()];
    return list.find(sc => sc.id === id) || list[0] || null;
  }
  function setActiveScene(id) {
    OSR.state.activeSceneIds = Object.assign({}, OSR.state.activeSceneIds, { [OSR.currentSystem()]: id });
    overlay = null;
    OSR.cancelDrawDraft();
    OSR.save();
    renderMaps();
  }

  /* ---- Images ---- */

  // Browser: decodes the image, scales it to MAX_SIDE, and encodes it as WebP
  // (PNG where the browser cannot encode WebP). Tests replace OSR.decodeImage
  // (jsdom has no canvas).
  async function decodeImage(blob) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const width = Math.round(bmp.width * scale), height = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(bmp, 0, 0, width, height);
    const out = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.9));
    return { blob: out || blob, width, height };
  }

  // The size of an image by its address (a scene that keeps only imageUrl).
  // Tests replace it.
  function measureImageUrl(url) {
    return new Promise(resolve => {
      const img = new Image();
      const done = v => { clearTimeout(t); resolve(v); };
      const t = setTimeout(() => done(null), 15000);
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done(null);
      img.src = url;
    });
  }

  // Stores an image blob in IndexedDB. Resolves to { blobId, type, width, height }.
  async function storeImage(blob) {
    if (!blob || !/^image\//.test(blob.type || '')) throw new Error('That file is not an image.');
    const d = await OSR.decodeImage(blob);
    const id = uid();
    const type = d.blob.type || blob.type;
    await OSR.store.putBlob(id, { bytes: await d.blob.arrayBuffer(), type, width: d.width, height: d.height });
    return { blobId: id, type, width: d.width, height: d.height };
  }

  // Creates a scene in the current system from a file/blob, an address, or
  // nothing (a blank map), and opens it. Resolves to { scene, warning }.
  async function createScene(opts) {
    const o = opts || {};
    const sc = { id: uid(), name: String(o.name || '').trim() || 'Scene', system: OSR.currentSystem() };
    let warning = '';
    if (o.file) {
      const img = await storeImage(o.file);
      Object.assign(sc, { imageBlobId: img.blobId, imageType: img.type, width: img.width, height: img.height });
    } else if (o.url) {
      try {
        const res = await fetch(o.url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const img = await storeImage(await res.blob());
        Object.assign(sc, { imageBlobId: img.blobId, imageType: img.type, width: img.width, height: img.height });
      } catch (e) {
        // CORS or a dead address: show it from the address, but it is not saved.
        const size = await OSR.measureImageUrl(o.url);
        Object.assign(sc, { imageUrl: o.url }, size || BLANK);
        warning = 'The image could not be downloaded (' + e.message + '), so it is shown from its address. It is not saved in this browser or in Dropbox, and it is gone if the address stops working.';
      }
    }
    ensureSceneShape(sc);
    OSR.state.scenes.push(sc);
    OSR.pushNote('Maps', 'New scene “' + sc.name + '”');
    setActiveScene(sc.id);
    if (warning) setStatus(warning);
    return { scene: sc, warning };
  }

  // The object URL of a scene's image, or null while it loads (renderScene
  // runs again when it is ready) or when it is missing.
  const loading = new Set(); // promises of image loads in progress (mapsIdle)
  function imageHref(sc) {
    if (!sc.imageBlobId) return sc.imageUrl || null;
    const v = images.get(sc.imageBlobId);
    if (v && v !== 'loading' && v !== 'missing') return v;
    if (!v) {
      const p = loadImage(sc).finally(() => loading.delete(p));
      loading.add(p);
    }
    return null;
  }
  // Resolves when no image load is in progress (tests close their window then).
  const mapsIdle = () => Promise.all(Array.from(loading)).then(() => (loading.size ? mapsIdle() : undefined));
  async function loadImage(sc) {
    const id = sc.imageBlobId;
    images.set(id, 'loading');
    let rec = null;
    try { rec = await OSR.store.getBlob(id); } catch (e) { /* treated as missing */ }
    if (!rec && OSR.dropboxFetchBlob) {
      try { rec = await OSR.dropboxFetchBlob(id, sc.imageType); } catch (e) { rec = null; }
    }
    images.set(id, rec ? URL.createObjectURL(new Blob([rec.bytes], { type: rec.type })) : 'missing');
    const cur = activeScene();
    if (cur && cur.imageBlobId === id) renderScene();
  }

  /* ---- View ---- */

  // The SVG element's box on screen. Tests replace OSR.mapRect (jsdom has no layout).
  function mapRect() {
    const r = $('#map-svg').getBoundingClientRect();
    return r.width && r.height ? r : { left: r.left, top: r.top, width: 1000, height: 700 };
  }

  // Map point under a screen point. The viewBox always has the element's
  // aspect ratio (preserveAspectRatio="none"), so x and y scale alike.
  function screenToMap(clientX, clientY, rect, v) {
    return { x: v.x + (clientX - rect.left) * v.w / rect.width, y: v.y + (clientY - rect.top) * v.h / rect.height };
  }

  function fitView(sc, rect) {
    const aspect = rect.width / rect.height;
    const margin = 1.05;
    let w = sc.width * margin, h = sc.height * margin;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    return { x: (sc.width - w) / 2, y: (sc.height - h) / 2, w, h };
  }

  // The scene's view, made to match the element's current aspect ratio.
  function viewOf(sc) {
    const rect = OSR.mapRect();
    let v = views[sc.id];
    if (!v) v = views[sc.id] = fitView(sc, rect);
    const h = v.w * rect.height / rect.width;
    if (Math.abs(h - v.h) > 1e-6) { v.y += (v.h - h) / 2; v.h = h; }
    return v;
  }

  const zoomLimits = sc => ({ min: 20, max: Math.max(sc.width, sc.height) * 6 });

  // Zooms by `factor` (< 1 = closer) around the map point (cx, cy).
  function zoomAt(sc, factor, cx, cy) {
    const v = viewOf(sc), lim = zoomLimits(sc);
    const w = Math.min(lim.max, Math.max(lim.min, v.w * factor));
    const f = w / v.w;
    views[sc.id] = { x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f, w, h: v.h * f };
    renderScene();
  }

  /* ---- Pop-out windows ---- */

  const isMapPopout = () => new URLSearchParams(location.search).get('view') === 'map';
  const mapWindows = new Set(); // the pop-outs this (main) window opened
  let notifyT = null;

  function registerMapWindow(w) { if (w) mapWindows.add(w); }

  // Coalesced: one redraw for all the saves of a tick.
  function notifyMapViews() {
    if (notifyT) return;
    notifyT = setTimeout(() => {
      notifyT = null;
      mapWindows.forEach(w => {
        if (w.closed) { mapWindows.delete(w); return; }
        try { if (w.OSR && w.OSR.renderMaps) w.OSR.renderMaps(); } catch (e) { mapWindows.delete(w); }
      });
      if (mapsTabActive() && !drag) renderMaps();
    }, 0);
  }

  function popOut() {
    const w = window.open(location.pathname + '?view=map', 'osr-map', 'popup,width=1200,height=850');
    if (!w) { setStatus('The browser blocked the new window. Allow pop-ups for this site, then click Pop out again.'); return null; }
    registerMapWindow(w);
    if (w.focus) w.focus();
    return w;
  }

  // In a pop-out window: use the main window's state, saves, and history.
  function attachToMain(main) {
    Object.defineProperty(OSR, 'state', { configurable: true, get: () => main.state, set: v => { main.state = v; } });
    Object.defineProperty(OSR, 'campaigns', { configurable: true, get: () => main.campaigns, set: v => { main.campaigns = v; } });
    Object.defineProperty(OSR, 'campaignId', { configurable: true, get: () => main.campaignId, set: v => { main.campaignId = v; } });
    OSR.data = main.data;
    OSR.seeds = main.seeds;
    ['save', 'saveNow', 'flushSave', 'pushNote', 'saveScene', 'trackScene', 'rebaseScene', 'undoScene', 'redoScene',
      'canUndo', 'canRedo', 'resetHistories', 'dropboxFetchBlob', 'renderCompendium']
      .forEach(k => { if (typeof main[k] === 'function') OSR[k] = (...args) => main[k](...args); });
    OSR.notifyMapViews = () => {}; // the main window redraws this one
    main.registerMapWindow(window);
    window.addEventListener('pagehide', () => main.notifyMapViews());
    const watch = setInterval(() => { if (!window.opener || window.opener.closed) { clearInterval(watch); mainWindowClosed(); } }, 1000);
  }

  // The main window is gone: its state with it. Say so; offer the full app.
  // Wires its own button: with no main window at all, initPopout() wires nothing else.
  function mainWindowClosed() {
    const box = $('#map-popout-closed');
    if (box) box.hidden = false;
    const btn = $('#map-popout-reopen');
    if (btn) btn.onclick = () => { location.href = location.pathname; };
    drag = null;
  }

  /* ---- Render ---- */

  function setStatus(text) {
    status = text || '';
    const el = $('#map-status');
    if (el) el.textContent = status;
  }

  /* ---- Tools ---- */

  function setTool(t, keepStatus) {
    tool = t;
    overlay = null;
    OSR.cancelDrawDraft();
    OSR.closeMapTextInput();
    if (!keepStatus) setStatus(TOOL_HINTS[tool] || '');
    renderMaps();
  }

  // A tool was used once (a drawing, a text, a measure, a pin…): without
  // sticky mode, the hand tool comes back. The status stays (a measure's result).
  function toolUsed() {
    if (!sticky && tool !== 'pan') setTool('pan', true);
  }

  function setSticky(on) {
    sticky = !!on;
    try { localStorage.setItem(STICKY_KEY, sticky ? 'on' : 'off'); } catch (e) { /* kept for this page only */ }
    setStatus(sticky ? 'Sticky mode on: a tool stays chosen after you use it.' : 'Sticky mode off: the hand tool comes back after you use a tool.');
    renderMaps();
  }

  function setRclickPan(on) {
    rclickPan = !!on;
    try { localStorage.setItem(RCLICK_KEY, rclickPan ? 'on' : 'off'); } catch (e) { /* kept for this page only */ }
    setStatus(rclickPan ? 'Right-click pan on: drag with the right button to move the view.' : 'Right-click pan off: right-click the map to add a pin or mark a hex.');
    renderMaps();
  }

  // Alt + a key on the Maps tab (or in a pop-out): the toolbar's buttons.
  function onHotkey(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.type !== 'keydown') return;
    if (!mapsTabActive() || isTextField(e.target) || document.querySelector('.modal:not([hidden])')) return;
    // With no code (some keyboards and tools), the key itself: "6", "-", "s".
    const k = String(e.key || '').toLowerCase();
    const code = e.code || (/^[0-9]$/.test(k) ? 'Digit' + k : k === '-' ? 'Minus' : k === '=' ? 'Equal' : /^[a-z]$/.test(k) ? 'Key' + k.toUpperCase() : '');
    let btn = null;
    if (KEY_CODES[code]) btn = $('#tab-maps .map-tool[data-key="' + KEY_CODES[code] + '"]');
    else if (KEY_BUTTONS[code]) btn = $(KEY_BUTTONS[code]);
    else if (KEY_PANELS[code]) {
      const panel = $(KEY_PANELS[code]);
      if (!panel || panel.hidden) return;
      e.preventDefault();
      panel.open = !panel.open;
      return;
    }
    if (!btn) return;
    e.preventDefault();
    if (!btn.hidden && !btn.disabled) btn.click();
  }

  // The Grid and Tokens menus float over the map: one open at a time.
  function onPanelToggle(e) {
    if (!e.target.open) return;
    $$('#tab-maps .map-drop').forEach(d => { if (d !== e.target) d.open = false; });
  }
  function closeMapPanels() { $$('#tab-maps .map-drop').forEach(d => { d.open = false; }); }

  /* ---- Right-click menu (drawings, tokens) ---- */

  let menuHandler = null;
  let menuClose = null;
  // Opens #map-menu at a screen point. `onPick(el, event)` gets each click
  // (and each change of an input in it, and Enter in a text field); it
  // returns true to close the menu. `onClose()`, if given, runs when the
  // menu closes, before its content goes (a text field not committed yet).
  function openMapMenu(x, y, html, onPick, onClose) {
    closeMapMenu();
    const m = $('#map-menu');
    m.innerHTML = html;
    m.hidden = false;
    menuHandler = onPick;
    menuClose = onClose || null;
    const px = Math.min(x, window.innerWidth - m.offsetWidth - 8);
    const py = Math.min(y, window.innerHeight - m.offsetHeight - 8);
    m.style.left = Math.max(8, px) + 'px';
    m.style.top = Math.max(8, py) + 'px';
  }
  function closeMapMenu() {
    const m = $('#map-menu');
    if (!m || m.hidden) return;
    const done = menuClose;
    menuClose = null;
    if (done) done();
    m.hidden = true;
    m.innerHTML = '';
    menuHandler = null;
  }
  function onMenuEvent(e) {
    if (!menuHandler) return;
    if (e.type === 'click' && e.target.tagName === 'INPUT') return; // an input answers with "change"
    const el = e.target.closest('[data-act]');
    if (el && menuHandler(el, e)) closeMapMenu();
  }
  function onMenuKey(e) {
    // Escape (the app-wide handler closes the menu) drops what was typed.
    if (e.key === 'Escape' && isTextField(e.target)) { e.target.value = e.target.defaultValue; return; }
    if (e.key !== 'Enter' || !menuHandler || !isTextField(e.target)) return;
    const el = e.target.closest('[data-act]');
    if (!el) return;
    e.preventDefault();
    if (menuHandler(el, e)) closeMapMenu();
  }

  // A right-click on the map itself (no element under it), right-click pan
  // off: add a pin there, or, in hexcrawl mode, mark its hex explored or not.
  function mapMenu(sc, p, x, y) {
    const items = ['<button class="ctx-item" type="button" data-act="pin"><i class="fa-solid fa-location-dot"></i><span>Add a pin here</span></button>'];
    if (OSR.hexcrawlOn(sc)) {
      const explored = sc.hexcrawl.explored.indexOf(G.hexKey(G.cellAt(p.x, p.y, sc.grid))) !== -1;
      items.push('<button class="ctx-item" type="button" data-act="explore"><i class="fa-solid fa-binoculars"></i><span>' +
        (explored ? 'Mark hex not explored' : 'Mark hex explored') + '</span></button>');
    }
    openMapMenu(x, y, '<div class="ctx-head">Map</div>' + items.join(''), el => {
      if (el.dataset.act === 'pin') OSR.addPin(sc, p);
      else if (el.dataset.act === 'explore') OSR.toggleExplored(sc, p);
      return true;
    });
  }

  function onContextMenu(e) {
    const sc = activeScene();
    if (!sc) return;
    const el = e.target.closest && e.target.closest(MAP_ELEMENTS);
    const hit = el && !el.hasAttribute('data-pin') ? el : null;
    if (!hit) {
      if (el) return; // a pin has no menu: the browser's
      e.preventDefault();
      if (!rclickPan) mapMenu(sc, screenToMap(e.clientX, e.clientY, OSR.mapRect(), viewOf(sc)), e.clientX, e.clientY);
      return;
    }
    e.preventDefault();
    const stroke = viewOf(sc).w / OSR.mapRect().width;
    if (hit.hasAttribute('data-token')) OSR.tokenMenu(sc, hit.getAttribute('data-token'), e.clientX, e.clientY);
    else OSR.drawingMenu(sc, hit.getAttribute('data-drawing'), e.clientX, e.clientY, stroke);
  }

  function renderMaps() {
    const sel = $('#map-scene');
    if (!sel) return;
    const list = scenesForSystem();
    const cur = activeScene();
    sel.innerHTML = list.map(sc => '<option value="' + escapeHtml(sc.id) + '">' + escapeHtml(sc.name) + '</option>').join('') +
      '<option value="' + NEW + '">+ New scene…</option>';
    sel.value = cur ? cur.id : NEW;
    ['#map-rename', '#map-duplicate', '#map-delete', '#map-fit'].forEach(s => { $(s).disabled = !cur; });
    $('#map-sticky').classList.toggle('is-active', sticky);
    $('#map-sticky').setAttribute('aria-pressed', String(sticky));
    $('#map-rclick-pan').classList.toggle('is-active', rclickPan);
    $('#map-rclick-pan').setAttribute('aria-pressed', String(rclickPan));
    if (tool === 'explore' && !(cur && OSR.hexcrawlOn(cur))) tool = 'pan';
    $$('#tab-maps .map-tool').forEach(b => {
      b.classList.toggle('is-active', b.dataset.tool === tool);
      b.disabled = !cur;
    });
    $('.map-tool[data-tool="explore"]').hidden = !(cur && OSR.hexcrawlOn(cur));
    OSR.renderPinBar();
    OSR.trackScene(cur);
    $('#map-undo').disabled = !OSR.canUndo(cur);
    $('#map-redo').disabled = !OSR.canRedo(cur);
    OSR.renderDrawBar(cur ? tool : null);
    $('#map-empty').hidden = !!cur;
    if (isMapPopout()) document.title = (cur ? cur.name + ' — ' : '') + 'Map — Character Keeper';
    $('#map-svg').hidden = !cur;
    renderGridPanel(cur);
    renderScene();
    OSR.renderTokenPanel();
    setStatus(status);
  }

  function renderGridPanel(sc) {
    const g = sc ? sc.grid : GRID_DEFAULTS;
    const set = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.value = v; };
    set('#grid-type', g.type);
    set('#grid-orient', g.orient);
    set('#grid-size', +g.size.toFixed(2));
    set('#grid-ox', +g.offsetX.toFixed(2));
    set('#grid-oy', +g.offsetY.toFixed(2));
    set('#grid-units', g.unitsPerCell);
    set('#grid-unit', g.unit);
    $('#grid-show').checked = !!g.show;
    $('#grid-lock').checked = !!g.locked;
    $('#grid-orient-label').hidden = g.type !== 'hex';
    const hc = sc ? sc.hexcrawl : { on: false, coords: false };
    $('#hexcrawl-on').checked = !!hc.on;
    $('#hexcrawl-coords').checked = !!hc.coords;
    $('#hexcrawl-on').disabled = !sc || g.type !== 'hex';
    $('#hexcrawl-coords').disabled = !sc || g.type !== 'hex';
    ['#grid-type', '#grid-orient', '#grid-size', '#grid-ox', '#grid-oy'].forEach(s => { $(s).disabled = !sc || g.locked; });
    ['#grid-units', '#grid-unit', '#grid-show', '#grid-lock'].forEach(s => { $(s).disabled = !sc; });
  }

  const num = n => +n.toFixed(2);

  function gridMarkup(sc, v, stroke) {
    const g = sc.grid;
    if (!g.show) return '';
    if (g.type === 'square') {
      const s = g.size;
      return '<defs><pattern id="map-grid-pat" patternUnits="userSpaceOnUse" x="' + num(g.offsetX) + '" y="' + num(g.offsetY) +
        '" width="' + num(s) + '" height="' + num(s) + '"><path d="M ' + num(s) + ' 0 L 0 0 0 ' + num(s) +
        '" fill="none" class="map-grid-line" stroke-width="' + num(stroke) + '"/></pattern></defs>' +
        '<rect class="map-grid" x="0" y="0" width="' + sc.width + '" height="' + sc.height + '" fill="url(#map-grid-pat)"/>';
    }
    const cells = G.cellsIn({ x: v.x, y: v.y, w: v.w, h: v.h }, g, MAX_GRID_CELLS);
    if (!cells) return '';
    const d = cells.map(c => {
      const p = G.cellCorners(c, g);
      return 'M' + p.map(q => num(q.x) + ' ' + num(q.y)).join('L') + 'Z';
    }).join('');
    return '<path class="map-grid map-grid-line" clip-path="url(#map-clip)" fill="none" stroke-width="' + num(stroke) + '" d="' + d + '"/>';
  }

  function overlayMarkup(sc, stroke) {
    if (!overlay || overlay.sceneId !== sc.id) return '';
    const a = overlay.a, b = overlay.b;
    if (overlay.kind === 'calibrate' || overlay.kind === 'box') {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      return '<rect class="' + (overlay.kind === 'box' ? 'map-box' : 'map-calibrate') + '" x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h) + '" stroke-width="' + num(stroke * 2) + '"/>';
    }
    const fs = stroke * 16;
    return '<line class="map-measure" x1="' + num(a.x) + '" y1="' + num(a.y) + '" x2="' + num(b.x) + '" y2="' + num(b.y) + '" stroke-width="' + num(stroke * 3) + '"/>' +
      '<text class="map-measure-label" x="' + num(b.x + fs / 2) + '" y="' + num(b.y - fs / 2) + '" font-size="' + num(fs) + '">' + escapeHtml(measureText(sc, a, b)) + '</text>';
  }

  // "4 cells · 20 ft" between two map points.
  function measureText(sc, a, b) {
    const g = sc.grid;
    const n = G.distance(G.cellAt(a.x, a.y, g), G.cellAt(b.x, b.y, g), g);
    const units = g.unitsPerCell ? ' · ' + num(n * g.unitsPerCell) + (g.unit ? ' ' + g.unit : '') : '';
    return n + (n === 1 ? ' cell' : ' cells') + units;
  }

  // Draws only while the Maps tab shows (its tab click draws it): a hidden
  // SVG has no size, and a scene's image is downloaded only when it shows.
  function renderScene() {
    const svg = $('#map-svg');
    const sc = activeScene();
    if (!svg || !sc) { if (svg) svg.innerHTML = ''; return; }
    if (!mapsTabActive()) return;
    const v = viewOf(sc);
    const rect = OSR.mapRect();
    const stroke = v.w / rect.width; // one screen pixel, in map units
    svg.setAttribute('viewBox', [v.x, v.y, v.w, v.h].map(num).join(' '));
    const href = imageHref(sc);
    let image = '<rect class="map-backdrop" x="0" y="0" width="' + sc.width + '" height="' + sc.height + '"/>';
    if (href) image += '<image href="' + escapeHtml(href) + '" x="0" y="0" width="' + sc.width + '" height="' + sc.height + '" preserveAspectRatio="none"/>';
    else if (sc.imageBlobId && images.get(sc.imageBlobId) === 'missing') {
      image += '<text class="map-missing" x="' + sc.width / 2 + '" y="' + sc.height / 2 + '" font-size="' + num(stroke * 18) + '">The image of this scene is not in this browser.</text>';
    }
    svg.innerHTML =
      '<defs><clipPath id="map-clip"><rect x="0" y="0" width="' + sc.width + '" height="' + sc.height + '"/></clipPath></defs>' +
      '<g class="map-layer-image">' + image + '</g>' +
      '<g class="map-layer-grid">' + OSR.hexcrawlMarkup(sc, v, stroke) + gridMarkup(sc, v, stroke) + '</g>' +
      '<g class="map-layer-drawings">' + OSR.drawingsMarkup(sc, stroke) + '</g>' +
      '<g class="map-layer-pins">' + OSR.pinsMarkup(sc, stroke) + '</g>' +
      '<g class="map-layer-tokens">' + OSR.tokensMarkup(sc, stroke) + '</g>' +
      '<g class="map-layer-overlay">' + overlayMarkup(sc, stroke) + '</g>';
  }

  /* ---- Scene list ---- */

  function renameScene() {
    const sc = activeScene();
    if (!sc) return;
    const name = prompt('New name for the scene:', sc.name);
    if (name == null || !name.trim() || name.trim() === sc.name) return;
    sc.name = name.trim();
    OSR.saveScene(sc);
    renderMaps();
  }

  function duplicateScene() {
    const sc = activeScene();
    if (!sc) return null;
    const copy = JSON.parse(JSON.stringify(sc));
    copy.id = uid();
    copy.name = sc.name + ' (copy)';
    OSR.state.scenes.splice(OSR.state.scenes.indexOf(sc) + 1, 0, copy); // shares the image blob
    setActiveScene(copy.id);
    return copy;
  }

  async function deleteScene() {
    const sc = activeScene();
    if (!sc || !confirm('Delete the scene “' + sc.name + '”? Its tokens and drawings are deleted too.')) return false;
    const list = scenesForSystem();
    const next = list[list.indexOf(sc) + 1] || list[list.indexOf(sc) - 1] || null;
    OSR.state.scenes = OSR.state.scenes.filter(x => x !== sc);
    delete views[sc.id];
    // The image goes too, unless another scene (a duplicate) still shows it.
    if (sc.imageBlobId && !OSR.state.scenes.some(x => x.imageBlobId === sc.imageBlobId)) {
      try { await OSR.store.deleteBlob(sc.imageBlobId); } catch (e) { /* stays as an orphan */ }
      const url = images.get(sc.imageBlobId);
      if (url && url.startsWith && url.startsWith('blob:')) URL.revokeObjectURL(url);
      images.delete(sc.imageBlobId);
    }
    OSR.pushNote('Maps', 'Deleted scene “' + sc.name + '”');
    setActiveScene(next ? next.id : null);
    return true;
  }

  /* ---- New scene dialog ---- */

  function openSceneModal(image) {
    pendingImage = image || null;
    $('#scene-name').value = '';
    $('#scene-file').value = '';
    $('#scene-url').value = '';
    $('#scene-error').hidden = true;
    $('#scene-modal').hidden = false;
    $('#scene-name').focus();
    renderMaps(); // the selector goes back from "+ New scene…"
  }
  function closeSceneModal() { const m = $('#scene-modal'); if (m) m.hidden = true; pendingImage = null; }

  async function submitSceneModal() {
    const file = ($('#scene-file').files && $('#scene-file').files[0]) || pendingImage;
    const url = $('#scene-url').value.trim();
    const name = $('#scene-name').value.trim() || (file && file.name ? file.name.replace(/\.[^.]+$/, '') : '') || 'Scene';
    try {
      await createScene({ name, file, url: file ? '' : url });
      closeSceneModal();
    } catch (e) {
      $('#scene-error').textContent = e.message;
      $('#scene-error').hidden = false;
    }
  }

  /* ---- Pointer tools ---- */

  function onPointerDown(e) {
    const sc = activeScene();
    if (!sc) return;
    // A click on the map closes the Grid, Tokens, and hotkeys menus.
    closeMapPanels();
    // Right button: a pan with right-click pan on, on the map itself only.
    const rightPan = e.button === 2 && rclickPan && !(e.target.closest && e.target.closest(MAP_ELEMENTS));
    if (e.button > 1 && !rightPan) return;
    // The map's keys (Delete, Escape, arrows) go to #map-wrap. The hand
    // tool's preventDefault() below stops the browser from focusing it.
    const wrap = $('#map-wrap');
    if (wrap && wrap.focus && document.activeElement !== wrap) wrap.focus({ preventScroll: true });
    const rect = OSR.mapRect();
    const v = viewOf(sc);
    const p = screenToMap(e.clientX, e.clientY, rect, v);
    const kind = e.button === 1 || rightPan || spaceDown ? 'pan' : tool;
    if (kind === 'calibrate' && sc.grid.locked) { setStatus('The grid is locked. Untick Lock grid to set it.'); return; }
    if (kind === 'explore') { if (OSR.hexcrawlOn(sc)) { OSR.toggleExplored(sc, p); toolUsed(); } return; }
    if (kind === 'pin') { OSR.addPin(sc, p); toolUsed(); return; }
    if (OSR.isDrawTool(kind)) {
      const dd = OSR.drawPointerDown(e, sc, p, kind, v.w / OSR.mapRect().width);
      if (e.preventDefault) e.preventDefault();
      if (dd.kind !== 'none') drag = Object.assign(dd, { sceneId: sc.id });
      renderScene();
      return;
    }
    // With the hand tool, tokens come first: select, move, box-select (Shift),
    // or Alt+click on the map for a ping.
    if (kind === 'pan' && e.button === 0 && !spaceDown) {
      const td = OSR.tokenPointerDown(e, sc, p);
      if (td && td.kind === 'none') return;
      if (td) {
        drag = Object.assign(td, { sceneId: sc.id });
        if (td.kind === 'box') overlay = { kind: 'box', sceneId: sc.id, a: p, b: p };
        if (e.preventDefault) e.preventDefault();
        renderScene();
        return;
      }
      if (e.altKey) { OSR.tokenPing(sc, p, v.w / OSR.mapRect().width); return; }
      const pd = OSR.pinPointerDown(e, sc, p);
      if (pd) {
        if (pd.kind !== 'none') drag = Object.assign(pd, { sceneId: sc.id });
        if (e.preventDefault) e.preventDefault();
        renderMaps();
        return;
      }
      const ds = OSR.drawSelectDown(e, sc, p);
      if (ds) { drag = Object.assign(ds, { sceneId: sc.id }); if (e.preventDefault) e.preventDefault(); return; }
    }
    drag = { kind, sceneId: sc.id, startClient: { x: e.clientX, y: e.clientY }, startView: Object.assign({}, v), a: p };
    if (kind === 'measure' || kind === 'calibrate') overlay = { kind, sceneId: sc.id, a: p, b: p };
    if (e.preventDefault) e.preventDefault();
    renderScene();
  }

  function onPointerMove(e) {
    if (!drag) {
      // A polygon being drawn follows the pointer to its next corner.
      const sc = tool === 'polygon' ? activeScene() : null;
      if (sc && OSR.drawPolygonMove(sc, screenToMap(e.clientX, e.clientY, OSR.mapRect(), viewOf(sc)))) renderScene();
      return;
    }
    const sc = activeScene();
    if (!sc || sc.id !== drag.sceneId) { drag = null; return; }
    const rect = OSR.mapRect();
    if (drag.kind === 'draw' || drag.kind === 'erase') {
      OSR.drawPointerMove(drag, sc, screenToMap(e.clientX, e.clientY, rect, viewOf(sc)), e);
    } else if (drag.kind === 'pin') {
      OSR.pinPointerMove(drag, sc, screenToMap(e.clientX, e.clientY, rect, viewOf(sc)));
    } else if (drag.kind === 'move-drawing') {
      OSR.drawSelectMove(drag, sc, screenToMap(e.clientX, e.clientY, rect, viewOf(sc)));
    } else if (drag.kind === 'tokens' || drag.kind === 'box') {
      const p = screenToMap(e.clientX, e.clientY, rect, viewOf(sc));
      OSR.tokenPointerMove(drag, sc, p);
      if (drag.kind === 'box') overlay.b = p;
    } else if (drag.kind === 'pan') {
      const v = drag.startView;
      views[sc.id] = Object.assign({}, v, {
        x: v.x - (e.clientX - drag.startClient.x) * v.w / rect.width,
        y: v.y - (e.clientY - drag.startClient.y) * v.h / rect.height
      });
    } else {
      overlay.b = screenToMap(e.clientX, e.clientY, rect, viewOf(sc));
      if (drag.kind === 'measure') setStatus(measureText(sc, overlay.a, overlay.b));
    }
    renderScene();
  }

  function onPointerUp(e) {
    if (!drag) return;
    if (e && e.clientX != null) onPointerMove(e); // the last position counts
    const d = drag;
    drag = null;
    const sc = activeScene();
    if (sc && d.kind === 'draw') { OSR.drawPointerUp(d, sc); toolUsed(); return; }
    if (sc && d.kind === 'move-drawing') { OSR.drawSelectUp(d, sc); return; }
    if (sc && d.kind === 'pin') { OSR.pinPointerUp(d, sc); return; }
    if (d.kind === 'erase') { toolUsed(); return; }
    if (d.kind === 'measure') { toolUsed(); return; }
    if (sc && (d.kind === 'tokens' || d.kind === 'box')) {
      if (d.kind === 'box') overlay = null;
      OSR.tokenPointerUp(d, sc);
      renderScene();
      return;
    }
    if (!sc || d.kind !== 'calibrate') return;
    const a = overlay.a, b = overlay.b;
    overlay = null;
    if (Math.abs(b.x - a.x) < 4 || Math.abs(b.y - a.y) < 4) { setStatus('Drag over a whole cell to set the grid.'); renderScene(); return; }
    sc.grid = Object.assign(sc.grid, G.gridFromRect({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, sc.grid, calibrateSpan()));
    OSR.saveScene(sc);
    setStatus('Grid set: ' + num(sc.grid.size) + ' px per cell. Arrow keys move it by 1 px.');
    renderMaps();
    toolUsed();
  }

  function onWheel(e) {
    const sc = activeScene();
    if (!sc) return;
    e.preventDefault();
    closeMapMenu();
    OSR.closeMapTextInput();
    const p = screenToMap(e.clientX, e.clientY, OSR.mapRect(), viewOf(sc));
    // By the wheel's distance: one mouse notch (about 100 px) is about 16%,
    // and a trackpad's many small steps add up the same way. deltaMode 1 =
    // lines (Firefox), 2 = pages.
    const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1);
    zoomAt(sc, Math.pow(1.0015, Math.max(-600, Math.min(600, px))), p.x, p.y);
  }

  let spaceDown = false;
  function onMapKey(e) {
    const sc = activeScene();
    // Keys typed in the token bar's fields are text, not map commands.
    if (!sc || isTextField(e.target) || e.target.tagName === 'SELECT') return;
    if (e.key === ' ') { spaceDown = e.type === 'keydown'; if (e.type === 'keydown') e.preventDefault(); return; }
    if (e.type !== 'keydown') return;
    if (OSR.pinKey(e, sc) || OSR.drawKey(e, sc)) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && tool === 'calibrate') {
      if (sc.grid.locked) { setStatus('The grid is locked.'); return; }
      const step = e.shiftKey ? 10 : 1;
      sc.grid.offsetX += arrows[e.key][0] * step;
      sc.grid.offsetY += arrows[e.key][1] * step;
      e.preventDefault();
      OSR.saveScene(sc);
      renderMaps();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && OSR.selectedTokenIds(sc).length) {
      e.preventDefault();
      OSR.deleteTokens(sc, OSR.selectedTokenIds(sc));
    } else if (e.key === 'Escape' && overlay) { overlay = null; setStatus(''); renderScene(); }
    else if (e.key === 'Escape') closeMapPanels();
  }

  /* ---- Paste and drop ---- */

  const mapsTabActive = () => { const t = $('#tab-maps'); return !!t && t.classList.contains('is-active'); };
  const isTextField = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  function imageFrom(list) {
    return Array.from(list || []).map(x => (x.getAsFile ? (x.kind === 'file' ? x.getAsFile() : null) : x))
      .find(f => f && /^image\//.test(f.type || '')) || null;
  }

  // Ctrl/Cmd+V of an image on the Maps tab: a new scene (or, with the New
  // scene dialog open, the dialog's image).
  function onPaste(e) {
    const modalOpen = !$('#scene-modal').hidden;
    if (!modalOpen && (!mapsTabActive() || isTextField(e.target))) return;
    const cd = e.clipboardData;
    const img = cd && (imageFrom(cd.files) || imageFrom(cd.items));
    if (!img) return;
    e.preventDefault();
    if (modalOpen) { pendingImage = img; $('#scene-error').textContent = 'Pasted image ready. Click Create.'; $('#scene-error').hidden = false; return; }
    return createScene({ name: 'Pasted map', file: img }).catch(err => setStatus(err.message));
  }

  function onDrop(e) {
    const img = e.dataTransfer && imageFrom(e.dataTransfer.files);
    if (!img) return;
    e.preventDefault();
    return createScene({ name: (img.name || 'Map').replace(/\.[^.]+$/, ''), file: img }).catch(err => setStatus(err.message));
  }

  /* ---- Grid fields ---- */

  function onGridField(e) {
    const sc = activeScene();
    if (!sc) return;
    const g = sc.grid;
    const v = e.target.value;
    switch (e.target.id) {
      case 'grid-type': g.type = v === 'hex' ? 'hex' : 'square'; break;
      case 'grid-orient': g.orient = v === 'pointy' ? 'pointy' : 'flat'; break;
      case 'grid-size': if (Number(v) >= 4) g.size = Number(v); break;
      case 'grid-ox': g.offsetX = Number(v) || 0; break;
      case 'grid-oy': g.offsetY = Number(v) || 0; break;
      case 'grid-units': g.unitsPerCell = Math.max(0, Number(v) || 0); break;
      case 'grid-unit': g.unit = String(v).trim().slice(0, 12); break;
      case 'grid-show': g.show = e.target.checked; break;
      case 'grid-lock': g.locked = e.target.checked; break;
      case 'hexcrawl-on': sc.hexcrawl.on = e.target.checked; break;
      case 'hexcrawl-coords': sc.hexcrawl.coords = e.target.checked; break;
      default: return;
    }
    OSR.saveScene(sc);
    renderMaps();
  }

  function wireMaps() {
    $('#map-scene').addEventListener('change', e => {
      if (e.target.value === NEW) openSceneModal();
      else setActiveScene(e.target.value);
    });
    $('#map-rename').addEventListener('click', renameScene);
    $('#map-duplicate').addEventListener('click', duplicateScene);
    $('#map-delete').addEventListener('click', deleteScene);
    $('#map-fit').addEventListener('click', () => { const sc = activeScene(); if (sc) { delete views[sc.id]; renderScene(); } });
    $('#map-popout').addEventListener('click', popOut);
    // Closing this window ends what the pop-outs show: tell them.
    if (!isMapPopout()) {
      window.addEventListener('pagehide', () => mapWindows.forEach(w => { try { if (!w.closed && w.OSR) w.OSR.mainWindowClosed(); } catch (e) { /* gone */ } }));
    }
    $('#tab-maps .map-toolbar').addEventListener('click', e => {
      const b = e.target.closest('.map-tool');
      if (!b || b.disabled) return;
      setTool(b.dataset.tool);
    });
    $('#map-sticky').addEventListener('click', () => setSticky(!sticky));
    $('#map-rclick-pan').addEventListener('click', () => setRclickPan(!rclickPan));
    document.addEventListener('keydown', onHotkey);
    $$('#tab-maps .map-drop').forEach(d => d.addEventListener('toggle', onPanelToggle));
    const menu = $('#map-menu');
    menu.addEventListener('click', onMenuEvent);
    menu.addEventListener('change', onMenuEvent);
    menu.addEventListener('keydown', onMenuKey);
    document.addEventListener('pointerdown', e => { if (!(e.target.closest && e.target.closest('#map-menu'))) closeMapMenu(); }, true);
    $('#map-grid-panel').addEventListener('change', onGridField);
    $('#scene-create').addEventListener('click', submitSceneModal);
    $('#scene-cancel').addEventListener('click', closeSceneModal);
    $('#scene-modal').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'file') submitSceneModal(); });
    const svg = $('#map-svg');
    svg.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', onContextMenu);
    const wrap = $('#map-wrap');
    wrap.addEventListener('keydown', onMapKey);
    wrap.addEventListener('keyup', onMapKey);
    wrap.addEventListener('dragover', e => { if (e.dataTransfer) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    wrap.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    window.addEventListener('resize', () => { if (mapsTabActive()) renderScene(); });
  }

  // Test-only view of the in-memory map state.
  const mapsState = () => ({ tool, sticky, rclickPan, views: JSON.parse(JSON.stringify(views)), overlay, status, images: new Map(images) });

  Object.assign(OSR, {
    ensureSceneShape, scenesForSystem, activeScene, setActiveScene, createScene, storeImage, decodeImage, measureImageUrl,
    mapRect, mapView: viewOf, mapsIdle, setMapStatus: setStatus, setMapTool: setTool, mapToolUsed: toolUsed, setMapSticky: setSticky, setMapRclickPan: setRclickPan,
    openMapMenu, closeMapMenu, closeMapPanels, mapMenu,
    isMapPopout, registerMapWindow, notifyMapViews, popOut, attachToMain, mainWindowClosed, screenToMap, zoomAt, measureText, renameScene, duplicateScene, deleteScene,
    openSceneModal, closeSceneModal, renderMaps, renderScene, wireMaps, mapsState
  });
})(window.OSR = window.OSR || {});
