/* js/tokens.js — map tokens on the scenes of the Maps tab (js/maps.js).
 *
 * A token is in its scene's `tokens` list:
 *   { id, iconId, x, y, size, color, label,
 *     link: null | { kind: 'combat', entryId } | { kind: 'character', charId } }
 * (x, y) is its center in map pixels; `size` is how many cells it covers
 * across (squares) or 1 + its rings (hexes); `iconId` is one of
 * OSR.data.tokenIcons (data/token-icons.json, game-icons.net, path data only).
 *
 * A token linked to a combat entry (js/combat.js) shows its name, HP, side,
 * and turn. When the entry leaves combat, unlinkTokens() keeps the token: a
 * character's token links to the character instead, any other token keeps
 * the entry's name as its label.
 *
 * js/maps.js draws tokensMarkup() into the tokens layer and sends pointer
 * events here (tokenPointerDown / tokenPointerMove / tokenPointerUp). A
 * right-click on a token opens tokenMenu(): color, link, unlink, delete.
 */
(function (OSR) {
  'use strict';
  const { $, $$, escapeHtml, uid } = OSR;
  const G = window.MapGrid;

  const SIDE_COLOR = { ally: '#4caf50', enemy: '#e05252', neutral: '#9e9e9e' };
  const DEFAULT_COLOR = '#5b4a33';
  const CHARACTER_ICON = 'delapouite/barbarian';
  const MONSTER_ICON = 'delapouite/orc-head';

  let selected = new Set();   // token ids selected in the open scene
  let selectedScene = null;

  const icons = () => OSR.allIcons(); // presets + this campaign's downloads (js/icons.js)
  const iconOf = id => icons().find(i => i.id === id) || icons()[0] || { id: '', name: 'Token', paths: [] };

  function ensureTokenShape(t) {
    if (!t.id) t.id = uid();
    t.x = Number(t.x) || 0;
    t.y = Number(t.y) || 0;
    t.size = Math.min(6, Math.max(1, Math.round(Number(t.size) || 1)));
    if (!/^#[0-9a-f]{6}$/i.test(t.color || '')) t.color = DEFAULT_COLOR;
    t.label = t.label == null ? '' : String(t.label);
    if (!t.link || (t.link.kind !== 'combat' && t.link.kind !== 'character')) t.link = null;
    return t;
  }

  /* ---- Geometry ---- */

  // Radius in map pixels: a size-n token on squares is n cells wide; on
  // hexes it covers its hex and the n − 1 rings around it.
  function tokenRadius(sc, size) {
    const g = sc.grid;
    if (g.type === 'hex') return (size - 0.5) * g.size * 0.86;
    return size * g.size / 2 * 0.92;
  }

  // Where a token of `size` dropped at (x, y) sits: an odd size on squares
  // centers on a cell, an even size on a cell corner; on hexes, a hex center.
  function snapPoint(sc, x, y, size) {
    const g = sc.grid;
    if (g.type === 'hex') return G.cellCenter(G.cellAt(x, y, g), g);
    if (size % 2) return G.cellCenter(G.cellAt(x, y, g), g);
    return {
      x: g.offsetX + Math.round((x - g.offsetX) / g.size) * g.size,
      y: g.offsetY + Math.round((y - g.offsetY) / g.size) * g.size
    };
  }

  /* ---- Linked actors ---- */

  const combatEntry = t => (t.link && t.link.kind === 'combat' ? OSR.state.combat.entries.find(e => e.id === t.link.entryId) || null : null);
  const linkedChar = t => {
    if (!t.link) return null;
    if (t.link.kind === 'character') return OSR.state.characters.find(c => c.id === t.link.charId) || null;
    const e = combatEntry(t);
    return e && e.kind === 'character' ? OSR.combatCharFor(e) : null;
  };

  // The name a token shows: its actor's, else its label, else its icon's.
  function tokenName(t) {
    const e = combatEntry(t);
    if (e) return e.name;
    const ch = linkedChar(t);
    if (ch) return ch.name;
    return t.label || iconOf(t.iconId).name;
  }

  // What the hover card shows.
  function tokenInfo(t) {
    const e = combatEntry(t);
    const ch = linkedChar(t);
    const info = { name: tokenName(t), hp: null, maxHp: null, ac: null, statuses: [], side: null, active: false, down: false, kind: t.link ? t.link.kind : null };
    if (e) {
      info.hp = OSR.entryHp(e);
      info.maxHp = OSR.entryMaxHp(e) || null;
      info.ac = e.kind === 'monster' ? OSR.acDisplay(e.monster) : (ch ? OSR.charQuickAC(ch) || null : null);
      info.statuses = (e.statuses || []).map(s => s.name || s);
      info.side = e.side;
      info.active = OSR.state.combat.activeId === e.id;
      info.down = OSR.entryDown(e);
    } else if (ch) {
      // The HP tracker, or the sheet's HP while the tracker is unused (0/0;
      // Combat fills it from the sheet the same way when the character joins).
      const hpc = OSR.hpConsumable(ch);
      const det = OSR.charDetectHp(ch);
      if (hpc && (hpc.value || hpc.max)) { info.hp = hpc.value; info.maxHp = hpc.max || null; }
      else if (det) { info.hp = det.value; info.maxHp = det.max || null; }
      info.ac = OSR.charQuickAC(ch) || null;
    }
    return info;
  }

  // A first guess at an icon for a combat entry: an icon whose name is in
  // the entry's name ("Goblin 2" → Goblin), else a default.
  function iconFor(e) {
    const name = String(e.name || '').toLowerCase();
    const hit = icons().find(i => i.name.toLowerCase().split(' ').some(w => w.length > 2 && name.indexOf(w) !== -1));
    return hit ? hit.id : (e.kind === 'character' ? CHARACTER_ICON : MONSTER_ICON);
  }

  /* ---- Changes ---- */

  // Adds a token to scene `sc`, snapped (unless `free`), and selects it.
  function addToken(sc, opts) {
    const o = opts || {};
    const size = Math.max(1, Math.round(o.size || 1));
    const at = o.free ? { x: o.x, y: o.y } : snapPoint(sc, o.x, o.y, size);
    const t = ensureTokenShape({ id: uid(), iconId: o.iconId || icons()[0].id, x: at.x, y: at.y, size, color: o.color, label: o.label, link: o.link || null });
    sc.tokens.push(t);
    selectOnly(sc, [t.id]);
    OSR.saveScene(sc);
    OSR.renderMaps();
    return t;
  }

  // A token for a combat entry, at the view's center, linked to it.
  function addTokenForEntry(sc, entryId, at) {
    const e = OSR.state.combat.entries.find(x => x.id === entryId);
    if (!e) return null;
    return addToken(sc, { iconId: iconFor(e), x: at.x, y: at.y, size: Number($('#token-size').value) || 1, color: currentColor(), link: { kind: 'combat', entryId } });
  }

  function deleteTokens(sc, ids) {
    const gone = new Set(ids);
    if (!gone.size) return 0;
    const before = sc.tokens.length;
    sc.tokens = sc.tokens.filter(t => !gone.has(t.id));
    ids.forEach(id => selected.delete(id));
    OSR.saveScene(sc);
    OSR.renderMaps();
    return before - sc.tokens.length;
  }

  // Called by js/combat.js when entries leave combat (one removed, or Clear),
  // while the entries are still in state.combat.entries.
  function unlinkTokens(entryIds) {
    const ids = new Set(entryIds);
    const entries = new Map(OSR.state.combat.entries.map(e => [e.id, e]));
    let changed = false;
    (OSR.state.scenes || []).forEach(sc => {
      let here = false;
      sc.tokens.forEach(t => {
        if (!t.link || t.link.kind !== 'combat' || !ids.has(t.link.entryId)) return;
        const e = entries.get(t.link.entryId);
        t.label = e ? e.name : t.label;
        t.link = e && e.kind === 'character' && e.charId ? { kind: 'character', charId: e.charId } : null;
        here = changed = true;
      });
      if (here && OSR.rebaseScene) OSR.rebaseScene(sc);
    });
    return changed;
  }

  /* ---- Selection ---- */

  function syncSelection(sc) {
    if (!sc || selectedScene !== sc.id) { selected = new Set(); selectedScene = sc ? sc.id : null; }
    if (sc) selected.forEach(id => { if (!sc.tokens.some(t => t.id === id)) selected.delete(id); });
  }
  function selectOnly(sc, ids) { syncSelection(sc); selected = new Set(ids); selectedScene = sc.id; }
  function toggleSelect(sc, id) { syncSelection(sc); if (selected.has(id)) selected.delete(id); else selected.add(id); }
  const selectedIds = sc => { syncSelection(sc); return Array.from(selected); };

  /* ---- Render ---- */

  const num = n => +n.toFixed(2);

  function tokenMarkup(sc, t, stroke) {
    const r = tokenRadius(sc, t.size);
    const info = tokenInfo(t);
    const icon = iconOf(t.iconId);
    const ring = info.side ? SIDE_COLOR[info.side] : 'rgba(0,0,0,.65)';
    const k = r * 1.25 / 512;
    let out = '<g class="map-token' + (selected.has(t.id) ? ' is-selected' : '') + (info.down ? ' is-down' : '') +
      '" data-token="' + escapeHtml(t.id) + '" transform="translate(' + num(t.x) + ' ' + num(t.y) + ')">';
    if (info.active) out += '<circle class="map-token-turn" r="' + num(r + stroke * 7) + '" stroke-width="' + num(stroke * 3) + '"/>';
    if (selected.has(t.id)) out += '<circle class="map-token-sel" r="' + num(r + stroke * 4) + '" stroke-width="' + num(stroke * 2) + '"/>';
    out += '<circle class="map-token-body" r="' + num(r) + '" fill="' + t.color + '" stroke="' + ring + '" stroke-width="' + num(Math.max(stroke * 3, r * 0.08)) + '"/>';
    out += '<g transform="scale(' + num(k * 1000) / 1000 + ') translate(-256 -256)">' +
      icon.paths.map(d => '<path class="map-token-icon" d="' + escapeHtml(d) + '"/>').join('') + '</g>';
    if (info.hp != null && info.maxHp) {
      // The HP ring: the part of a circle that is the HP left.
      const f = Math.max(0, Math.min(1, info.hp / info.maxHp));
      const rr = r - Math.max(stroke * 3, r * 0.08) * 1.5;
      const c = 2 * Math.PI * rr;
      const col = f > 0.5 ? '#6fcf6f' : f > 0.25 ? '#e3c04d' : '#e05252';
      out += '<circle class="map-token-hp" r="' + num(rr) + '" stroke="' + col + '" stroke-width="' + num(Math.max(stroke * 2, r * 0.06)) +
        '" stroke-dasharray="' + num(c * f) + ' ' + num(c) + '" transform="rotate(-90)"/>';
    }
    const fs = Math.max(stroke * 12, r * 0.42);
    out += '<text class="map-token-label" y="' + num(r + fs * 1.05) + '" font-size="' + num(fs) + '">' + escapeHtml(info.name) + '</text>';
    return out + '</g>';
  }

  function tokensMarkup(sc, stroke) {
    syncSelection(sc);
    return sc.tokens.map(t => tokenMarkup(sc, t, stroke)).join('');
  }

  const currentColor = () => { const el = $('#token-color'); return el && /^#[0-9a-f]{6}$/i.test(el.value) ? el.value : DEFAULT_COLOR; };

  function renderTokenPanel() {
    const panel = $('#map-token-panel');
    if (!panel) return;
    const sc = OSR.activeScene();
    panel.hidden = !sc;
    if (!sc) return;
    const pal = $('#token-palette');
    if (pal.children.length !== icons().length) {
      pal.innerHTML = icons().map(i =>
        '<button class="token-icon-btn" type="button" data-icon="' + escapeHtml(i.id) + '" title="' + escapeHtml(i.name + ' — ' + i.author) + '" aria-label="' + escapeHtml(i.name) + '">' +
        '<svg viewBox="0 0 512 512" aria-hidden="true">' + i.paths.map(d => '<path d="' + escapeHtml(d) + '"/>').join('') + '</svg></button>').join('');
    }
    // Combat entries with no token on this scene yet.
    const placed = new Set(sc.tokens.filter(t => t.link && t.link.kind === 'combat').map(t => t.link.entryId));
    const free = OSR.state.combat.entries.filter(e => !placed.has(e.id));
    $('#token-from-combat').innerHTML = free.length
      ? '<span class="hint">From combat:</span> ' + free.map(e =>
        '<button class="btn token-entry-btn side-' + escapeHtml(e.side) + '" type="button" data-entry="' + escapeHtml(e.id) + '">' + escapeHtml(e.name) + '</button>').join('')
      : '';
    const ids = selectedIds(sc);
    const edit = $('#token-edit');
    edit.hidden = !ids.length;
    if (!ids.length) return;
    const one = ids.length === 1 ? sc.tokens.find(t => t.id === ids[0]) : null;
    $('#token-edit-title').textContent = one ? tokenName(one) : ids.length + ' tokens';
    $$('#token-edit .token-one').forEach(el => { el.hidden = !one; });
    if (!one) return;
    const set = (sel, v) => { const el = $(sel); if (document.activeElement !== el) el.value = v; };
    set('#token-label', one.label);
    set('#token-edit-size', String(one.size));
    set('#token-edit-color', one.color);
    const opts = ['<option value="">No link</option>'];
    OSR.state.combat.entries.forEach(e => opts.push('<option value="combat:' + escapeHtml(e.id) + '">Combat: ' + escapeHtml(e.name) + '</option>'));
    OSR.charactersForSystem().forEach(c => opts.push('<option value="character:' + escapeHtml(c.id) + '">Character: ' + escapeHtml(c.name) + '</option>'));
    $('#token-link').innerHTML = opts.join('');
    $('#token-link').value = one.link ? one.link.kind + ':' + (one.link.entryId || one.link.charId) : '';
    if ($('#token-link').value === '' && one.link) $('#token-link').value = ''; // a link to someone gone
  }

  /* ---- Hover card ---- */

  function showCard(t, clientX, clientY) {
    const card = $('#token-card');
    const i = tokenInfo(t);
    const rows = [];
    if (i.hp != null) rows.push('HP ' + i.hp + (i.maxHp ? ' / ' + i.maxHp : ''));
    if (i.ac != null && i.ac !== '') rows.push('AC ' + i.ac);
    if (i.side) rows.push(i.side.charAt(0).toUpperCase() + i.side.slice(1) + (i.active ? ' · their turn' : ''));
    if (i.down) rows.push('Down');
    if (i.statuses.length) rows.push(i.statuses.join(', '));
    if (!t.link) rows.push(iconOf(t.iconId).name + ' · not linked');
    card.innerHTML = '<b>' + escapeHtml(i.name) + '</b>' + rows.map(r => '<div>' + escapeHtml(r) + '</div>').join('');
    card.style.left = (clientX + 14) + 'px';
    card.style.top = (clientY + 14) + 'px';
    card.hidden = false;
  }
  function hideCard() { const c = $('#token-card'); if (c) c.hidden = true; }

  /* ---- Right-click menu ---- */

  const linkKey = l => (l ? l.kind + ':' + (l.entryId || l.charId) : '');

  function tokenMenu(sc, id, x, y) {
    const t = sc.tokens.find(z => z.id === id);
    if (!t) return;
    selectOnly(sc, [id]);
    hideCard();
    OSR.renderMaps();
    const cur = linkKey(t.link);
    const item = (key, icon, label) => '<button class="ctx-item' + (key === cur ? ' is-on' : '') + '" type="button" data-act="link" data-link="' + escapeHtml(key) + '">' +
      '<i class="fa-solid ' + icon + '"></i><span>' + escapeHtml(label) + '</span>' + (key === cur ? '<i class="fa-solid fa-check ctx-check"></i>' : '') + '</button>';
    const links = OSR.state.combat.entries.map(e => item('combat:' + e.id, 'fa-khanda', 'Combat: ' + e.name))
      .concat(OSR.charactersForSystem().map(c => item('character:' + c.id, 'fa-user', 'Character: ' + c.name)));
    OSR.openMapMenu(x, y,
      '<div class="ctx-head">' + escapeHtml(tokenName(t)) + '</div>' +
      '<div class="ctx-sub">Color</div>' + OSR.menuSwatches(t.color) +
      '<div class="ctx-sub">Link</div>' +
      '<div class="ctx-list">' + (links.join('') || '<span class="hint map-menu-none">No combatants or characters.</span>') + '</div>' +
      (t.link ? '<button class="ctx-item" type="button" data-act="unlink"><i class="fa-solid fa-link-slash"></i><span>Unlink</span></button>' : '') +
      '<button class="ctx-item ctx-delete" type="button" data-act="delete"><i class="fa-solid fa-trash"></i><span>Delete token</span></button>',
      el => {
        const one = sc.tokens.find(z => z.id === id);
        if (!one) return true;
        const act = el.dataset.act;
        if (act === 'delete') { deleteTokens(sc, [id]); return true; }
        if (act === 'color') {
          const c = el.dataset.color || el.value;
          if (!/^#[0-9a-f]{6}$/i.test(c)) return false;
          one.color = c;
        } else if (act === 'unlink') {
          // Like a combatant leaving combat: the token keeps the name it showed.
          one.label = tokenName(one);
          one.link = null;
        } else if (act === 'link') {
          const [kind, lid] = el.dataset.link.split(':');
          one.link = kind === 'combat' ? { kind, entryId: lid } : { kind, charId: lid };
        } else return false;
        OSR.saveScene(sc);
        OSR.renderMaps();
        return true;
      });
  }

  /* ---- Pointer (called by js/maps.js) ---- */

  // Pointer down on the map. Returns a drag for js/maps.js, or null when the
  // event is not for tokens. `p` is the map point.
  function tokenPointerDown(e, sc, p) {
    const hit = e.target && e.target.closest ? e.target.closest('[data-token]') : null;
    if (hit) {
      const id = hit.getAttribute('data-token');
      if (e.shiftKey) { toggleSelect(sc, id); OSR.renderMaps(); return { kind: 'none' }; }
      if (!selected.has(id) || selectedScene !== sc.id) selectOnly(sc, [id]);
      const start = {};
      sc.tokens.forEach(t => { if (selected.has(t.id)) start[t.id] = { x: t.x, y: t.y }; });
      hideCard();
      OSR.renderMaps();
      return { kind: 'tokens', a: p, start, lead: id, free: !!e.altKey, moved: false };
    }
    if (e.shiftKey) return { kind: 'box', a: p, b: p };
    if (selectedIds(sc).length) { selected = new Set(); OSR.renderMaps(); }
    return null;
  }

  function tokenPointerMove(d, sc, p) {
    if (d.kind === 'box') { d.b = p; return; }
    if (d.kind !== 'tokens') return;
    d.moved = true;
    sc.tokens.forEach(t => {
      const s = d.start[t.id];
      if (s) { t.x = s.x + p.x - d.a.x; t.y = s.y + p.y - d.a.y; }
    });
  }

  function tokenPointerUp(d, sc) {
    if (d.kind === 'box') {
      const x0 = Math.min(d.a.x, d.b.x), x1 = Math.max(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), y1 = Math.max(d.a.y, d.b.y);
      selectOnly(sc, sc.tokens.filter(t => t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1).map(t => t.id));
      OSR.renderMaps();
      return;
    }
    if (d.kind !== 'tokens' || !d.moved) return;
    // Snap the group by the token under the pointer, so the tokens keep
    // their places to each other.
    const lead = sc.tokens.find(t => t.id === d.lead);
    if (lead && !d.free) {
      const at = snapPoint(sc, lead.x, lead.y, lead.size);
      const dx = at.x - lead.x, dy = at.y - lead.y;
      sc.tokens.forEach(t => { if (d.start[t.id]) { t.x += dx; t.y += dy; } });
    }
    OSR.saveScene(sc);
    OSR.renderMaps();
  }

  // Alt+click on an empty part of the map: a pulse that fades in 2 s (not saved).
  function ping(sc, p, stroke) {
    const layer = $('#map-svg .map-layer-overlay');
    if (!layer) return;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('class', 'map-ping');
    el.setAttribute('cx', num(p.x));
    el.setAttribute('cy', num(p.y));
    el.setAttribute('r', num(Math.max(sc.grid.size, stroke * 30)));
    el.setAttribute('stroke-width', num(stroke * 4));
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  /* ---- Wire ---- */

  function wireTokens() {
    const viewCenter = sc => {
      const v = OSR.mapView(sc);
      return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
    };
    $('#token-palette').addEventListener('click', e => {
      const b = e.target.closest('[data-icon]');
      const sc = OSR.activeScene();
      if (!b || !sc) return;
      const c = viewCenter(sc);
      addToken(sc, { iconId: b.dataset.icon, x: c.x, y: c.y, size: Number($('#token-size').value) || 1, color: currentColor() });
    });
    $('#token-from-combat').addEventListener('click', e => {
      const b = e.target.closest('[data-entry]');
      const sc = OSR.activeScene();
      if (b && sc) addTokenForEntry(sc, b.dataset.entry, viewCenter(sc));
    });
    $('#token-edit').addEventListener('change', e => {
      const sc = OSR.activeScene();
      if (!sc) return;
      const one = selectedIds(sc).length === 1 ? sc.tokens.find(t => t.id === selectedIds(sc)[0]) : null;
      if (!one) return;
      if (e.target.id === 'token-label') one.label = e.target.value.trim();
      else if (e.target.id === 'token-edit-size') { one.size = Number(e.target.value) || 1; Object.assign(one, snapPoint(sc, one.x, one.y, one.size)); }
      else if (e.target.id === 'token-edit-color') one.color = /^#[0-9a-f]{6}$/i.test(e.target.value) ? e.target.value : one.color;
      else if (e.target.id === 'token-link') {
        const [kind, id] = e.target.value.split(':');
        one.link = kind === 'combat' ? { kind, entryId: id } : kind === 'character' ? { kind, charId: id } : null;
      } else return;
      OSR.saveScene(sc);
      OSR.renderMaps();
    });
    $('#token-delete').addEventListener('click', () => {
      const sc = OSR.activeScene();
      if (sc) deleteTokens(sc, selectedIds(sc));
    });
    const svg = $('#map-svg');
    svg.addEventListener('mouseover', e => {
      const hit = e.target.closest && e.target.closest('[data-token]');
      const sc = OSR.activeScene();
      if (!hit || !sc) return;
      const t = sc.tokens.find(x => x.id === hit.getAttribute('data-token'));
      if (t) showCard(t, e.clientX, e.clientY);
    });
    svg.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('[data-token]')) hideCard(); });
    renderTokenCredits();
  }

  // Settings: the authors of every icon this campaign can use.
  function renderTokenCredits() {
    const credits = $('#set-token-credits');
    if (!credits) return;
    const authors = Array.from(new Set(icons().map(i => i.author))).sort();
    credits.textContent = 'Map token icons: ' + authors.join(', ') + ', from game-icons.net (CC BY 3.0).';
  }

  Object.assign(OSR, {
    ensureTokenShape, tokenRadius, snapTokenPoint: snapPoint, tokenName, tokenInfo, tokenIconFor: iconFor,
    addToken, addTokenForEntry, deleteTokens, unlinkTokens, tokenMenu, selectTokens: selectOnly, selectedTokenIds: selectedIds,
    tokensMarkup, renderTokenPanel, renderTokenCredits, tokenPointerDown, tokenPointerMove, tokenPointerUp, tokenPing: ping, hideTokenCard: hideCard, wireTokens
  });
})(window.OSR = window.OSR || {});
