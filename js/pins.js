/* js/pins.js — location notes (pins) and hexcrawl mode on the scenes of the
 * Maps tab (js/maps.js).
 *
 * A pin is in its scene's `pins` list: { id, x, y, compendiumId }. Its note
 * is an ordinary Compendium entry (js/compendium.js) of category 'Journal'
 * in the current system, so the Compendium lists, searches, and links it like
 * any entry. The pin tool makes both and opens the entry's editor. With the
 * hand tool, a hover on a pin opens the note's popup (js/compendium-popups.js),
 * a click pins it open, a double-click opens its editor, a drag moves it, and
 * a right-click opens pinMenu() (delete the pin, with or without the note).
 *
 * Hexcrawl mode (`scene.hexcrawl`, hex grids only): { on, explored: ['q,r', …],
 * coords }. The explore tool marks a hex explored or not; unexplored hexes
 * are shaded, and `coords` shows each hex's label (js/grid.js's hexLabel,
 * "0412" = column 4, row 12). In hexcrawl mode a pin snaps to its hex's
 * center and its note is named after the hex.
 *
 * Every change goes through OSR.saveScene (js/history.js). Undo brings a pin
 * back, but not a note deleted with "Delete pin and note".
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, uid } = OSR;
  const G = window.MapGrid;
  const MAX_LABELS = 1500;

  let selectedPin = null;

  const hexcrawlOn = sc => !!(sc.hexcrawl && sc.hexcrawl.on && sc.grid.type === 'hex');
  const noteOf = pin => OSR.state.compendium.find(e => e.id === pin.compendiumId) || null;
  const num = n => +n.toFixed(2);

  function ensurePinShape(p) {
    if (!p.id) p.id = uid();
    p.x = Number(p.x) || 0;
    p.y = Number(p.y) || 0;
    p.compendiumId = p.compendiumId == null ? '' : String(p.compendiumId);
    return p;
  }

  /* ---- Hexcrawl ---- */

  function toggleExplored(sc, p) {
    const key = G.hexKey(G.cellAt(p.x, p.y, sc.grid));
    const list = sc.hexcrawl.explored;
    const i = list.indexOf(key);
    if (i === -1) list.push(key); else list.splice(i, 1);
    OSR.saveScene(sc);
    OSR.renderMaps();
    return i === -1;
  }

  // The shade over unexplored hexes and the hex labels, for the visible part.
  function hexcrawlMarkup(sc, v, stroke) {
    if (!hexcrawlOn(sc)) return '';
    const g = sc.grid;
    const cells = G.cellsIn({ x: v.x, y: v.y, w: v.w, h: v.h }, g, 4000);
    if (!cells) return '';
    const explored = new Set(sc.hexcrawl.explored);
    const hex = c => 'M' + G.cellCorners(c, g).map(q => num(q.x) + ' ' + num(q.y)).join('L') + 'Z';
    let out = '<path class="map-unexplored" clip-path="url(#map-clip)" d="' + cells.filter(c => !explored.has(G.hexKey(c))).map(hex).join('') + '"/>';
    // Labels only when a hex is big enough on screen to read one.
    if (sc.hexcrawl.coords && g.size / stroke >= 34 && cells.length <= MAX_LABELS) {
      const origin = G.labelOrigin(g, sc.width, sc.height);
      const fs = g.size * 0.18;
      out += '<g class="map-hex-labels" font-size="' + num(fs) + '">' + cells.map(c => {
        const ctr = G.cellCenter(c, g);
        const o = G.offsetCoords(c, g);
        // Cut-off hexes at the edge (column or row 00) get no number.
        if (ctr.x < 0 || ctr.y < 0 || ctr.x > sc.width || ctr.y > sc.height || o.col < origin.col || o.row < origin.row) return '';
        return '<text x="' + num(ctr.x) + '" y="' + num(ctr.y - g.size * 0.3) + '">' + G.hexLabel(c, g, origin) + '</text>';
      }).join('') + '</g>';
    }
    return out;
  }

  /* ---- Pins ---- */

  function pinMarkup(sc, pin, stroke) {
    const s = stroke * 14;
    const note = noteOf(pin);
    const cls = 'map-pin' + (pin.id === selectedPin ? ' is-selected' : '') + (note ? '' : ' is-orphan');
    // A teardrop with its point on (x, y).
    return '<g class="' + cls + '" data-pin="' + escapeHtml(pin.id) + '" transform="translate(' + num(pin.x) + ' ' + num(pin.y) + ')">' +
      '<path d="M0 0 C' + num(-s * 0.15) + ' ' + num(-s * 0.6) + ' ' + num(-s * 0.7) + ' ' + num(-s * 0.9) + ' ' + num(-s * 0.7) + ' ' + num(-s * 1.4) +
      ' A' + num(s * 0.7) + ' ' + num(s * 0.7) + ' 0 1 1 ' + num(s * 0.7) + ' ' + num(-s * 1.4) +
      ' C' + num(s * 0.7) + ' ' + num(-s * 0.9) + ' ' + num(s * 0.15) + ' ' + num(-s * 0.6) + ' 0 0Z" stroke-width="' + num(stroke * 1.5) + '"/>' +
      '<circle cy="' + num(-s * 1.4) + '" r="' + num(s * 0.28) + '"/>' +
      (note ? '' : '<title>Note deleted</title>') + '</g>'; // a note shows its popup on hover
  }
  function pinsMarkup(sc, stroke) { return sc.pins.map(p => pinMarkup(sc, p, stroke)).join(''); }

  // A name no Compendium entry of this system has yet.
  function uniqueNoteName(base) {
    const taken = new Set(OSR.compendiumForSystem().map(e => e.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    let n = 2;
    while (taken.has((base + ' (' + n + ')').toLowerCase())) n++;
    return base + ' (' + n + ')';
  }

  // The pin tool: a pin at `p` (a hex center in hexcrawl mode), a Journal
  // entry for it, and that entry's editor. Returns the pin. The entry's body
  // starts with the map's name and, on a hex grid, the hex's number. They
  // are written once: a rename of the scene or a move of the pin does not
  // change them.
  function addPin(sc, p, openEditor) {
    let at = p, where;
    const hex = sc.grid.type === 'hex' ? G.hexLabel(G.cellAt(p.x, p.y, sc.grid), sc.grid, G.labelOrigin(sc.grid, sc.width, sc.height)) : '';
    if (hexcrawlOn(sc)) {
      at = G.cellCenter(G.cellAt(p.x, p.y, sc.grid), sc.grid);
      where = 'Hex ' + hex;
    } else {
      where = 'Location ' + (sc.pins.length + 1);
    }
    const now = Date.now();
    const body = '**Map:** ' + sc.name + (hex ? '\n**Hex:** ' + hex : '') + '\n\n';
    const entry = {
      id: uid(), name: uniqueNoteName(sc.name + ' — ' + where), category: 'Journal', source: 'Maps',
      system: OSR.currentSystem(), body, createdAt: now, updatedAt: now
    };
    OSR.state.compendium.push(entry);
    const pin = ensurePinShape({ id: uid(), x: at.x, y: at.y, compendiumId: entry.id });
    sc.pins.push(pin);
    selectedPin = pin.id;
    OSR.saveScene(sc);
    OSR.renderMaps();
    OSR.renderCompendium();
    if (openEditor !== false) OSR.openCompEntry(entry.id);
    return pin;
  }

  // Deletes a pin; with `withNote`, its Journal entry too (after a confirm).
  function deletePin(sc, id, withNote) {
    const pin = sc.pins.find(p => p.id === id);
    if (!pin) return false;
    const note = noteOf(pin);
    if (withNote && note) {
      if (!confirm('Delete the pin and its note “' + note.name + '”? Undo brings the pin back, but not the note.')) return false;
      OSR.state.compendium = OSR.state.compendium.filter(e => e !== note);
      OSR.renderCompendium();
    }
    sc.pins = sc.pins.filter(p => p !== pin);
    if (selectedPin === id) selectedPin = null;
    OSR.saveScene(sc);
    OSR.renderMaps();
    return true;
  }

  // A click: the note's popup, pinned so it stays when the pointer leaves.
  function openNote(pin, anchor) {
    const note = noteOf(pin);
    if (!note) { OSR.setMapStatus('The note of this pin was deleted from the Compendium.'); return null; }
    const pop = OSR.openCompPop(note.name, anchor);
    if (pop) OSR.setPopPinned(pop, true);
    return pop;
  }
  // A hover: the same popup, not pinned (its pin button pins it).
  function hoverNote(pin, anchor) {
    const note = noteOf(pin);
    if (!note) return null;
    OSR.closeUnpinnedCompPops(note.name);
    return OSR.openCompPop(note.name, anchor);
  }

  // A right-click on a pin: edit the note, or delete the pin with or without
  // its Journal entry.
  function pinMenu(sc, id, x, y) {
    const pin = sc.pins.find(p => p.id === id);
    if (!pin) return;
    selectedPin = id;
    OSR.closeUnpinnedCompPops();
    OSR.renderMaps();
    const note = noteOf(pin);
    OSR.openMapMenu(x, y,
      '<div class="ctx-head">' + escapeHtml(note ? note.name : 'Note deleted') + '</div>' +
      (note ? '<button class="ctx-item" type="button" data-act="edit"><i class="fa-solid fa-pen"></i><span>Edit journal entry</span></button>' : '') +
      (note ? '<button class="ctx-item ctx-delete" type="button" data-act="delete-note"><i class="fa-solid fa-trash"></i><span>Delete pin and journal entry</span></button>' : '') +
      '<button class="ctx-item ctx-delete" type="button" data-act="delete"><i class="fa-solid fa-location-dot"></i><span>Delete pin' + (note ? ', keep journal entry' : '') + '</span></button>',
      el => {
        const act = el.dataset.act;
        if (act === 'edit') { const n = noteOf(pin); if (n) OSR.openCompEntry(n.id); return true; }
        if (act === 'delete-note') { deletePin(sc, id, true); return true; }
        if (act === 'delete') { deletePin(sc, id, false); return true; }
        return false;
      });
  }

  /* ---- Pointer (hand tool, called by js/maps.js) ---- */

  function pinPointerDown(e, sc, p) {
    const hit = e.target && e.target.closest ? e.target.closest('[data-pin]') : null;
    if (!hit) { if (selectedPin) { selectedPin = null; OSR.renderPinBar(); } return null; }
    const pin = sc.pins.find(x => x.id === hit.getAttribute('data-pin'));
    if (!pin) return null;
    selectedPin = pin.id;
    if (e.detail >= 2) { const note = noteOf(pin); if (note) OSR.openCompEntry(note.id); return { kind: 'none' }; }
    return { kind: 'pin', id: pin.id, a: p, start: { x: pin.x, y: pin.y }, moved: false, el: hit };
  }
  function pinPointerMove(d, sc, p) {
    const pin = sc.pins.find(x => x.id === d.id);
    if (!pin) return;
    if (!d.moved && Math.hypot(p.x - d.a.x, p.y - d.a.y) < 2) return;
    d.moved = true;
    pin.x = d.start.x + p.x - d.a.x;
    pin.y = d.start.y + p.y - d.a.y;
  }
  function pinPointerUp(d, sc) {
    const pin = sc.pins.find(x => x.id === d.id);
    if (!pin) return;
    if (d.moved) {
      if (hexcrawlOn(sc)) Object.assign(pin, G.cellCenter(G.cellAt(pin.x, pin.y, sc.grid), sc.grid));
      OSR.saveScene(sc);
      OSR.renderMaps();
      return;
    }
    OSR.renderMaps();
    const el = $('#map-svg [data-pin="' + pin.id + '"]');
    openNote(pin, el || d.el);
  }

  function pinKey(e, sc) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPin && sc.pins.some(p => p.id === selectedPin)) {
      e.preventDefault();
      deletePin(sc, selectedPin, false);
      return true;
    }
    return false;
  }

  function renderPinBar() {
    const bar = $('#pin-edit');
    if (!bar) return;
    const sc = OSR.activeScene();
    const pin = sc && selectedPin ? sc.pins.find(p => p.id === selectedPin) : null;
    bar.hidden = !pin;
    if (!pin) return;
    const note = noteOf(pin);
    $('#pin-edit-title').textContent = note ? note.name : 'Note deleted';
    $('#pin-open').disabled = !note;
    $('#pin-delete-note').disabled = !note;
  }

  function wirePins() {
    $('#pin-open').addEventListener('click', () => {
      const sc = OSR.activeScene();
      const pin = sc && sc.pins.find(p => p.id === selectedPin);
      const note = pin && noteOf(pin);
      if (note) OSR.openCompEntry(note.id);
    });
    $('#pin-delete').addEventListener('click', () => { const sc = OSR.activeScene(); if (sc && selectedPin) deletePin(sc, selectedPin, false); });
    $('#pin-delete-note').addEventListener('click', () => { const sc = OSR.activeScene(); if (sc && selectedPin) deletePin(sc, selectedPin, true); });
    const svg = $('#map-svg');
    svg.addEventListener('mouseover', e => {
      const hit = e.target.closest && e.target.closest('[data-pin]');
      const sc = OSR.activeScene();
      if (!hit || !sc || e.buttons || !$('#map-menu').hidden) return; // not during a drag or over the menu
      const pin = sc.pins.find(p => p.id === hit.getAttribute('data-pin'));
      if (pin) hoverNote(pin, hit);
    });
    svg.addEventListener('mouseout', e => {
      if (!(e.target.closest && e.target.closest('[data-pin]'))) return;
      const to = e.relatedTarget;
      if (!(to && to.closest && to.closest('.comp-pop'))) OSR.scheduleHideAllPops();
    });
  }

  Object.assign(OSR, {
    hexcrawlOn, toggleExplored, hexcrawlMarkup, ensurePinShape, pinsMarkup, addPin, deletePin, openPinNote: openNote,
    pinPointerDown, pinPointerMove, pinPointerUp, pinKey, pinMenu, renderPinBar, wirePins,
    selectedPinId: () => selectedPin
  });
})(window.OSR = window.OSR || {});
