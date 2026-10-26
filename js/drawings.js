/* js/drawings.js — drawing on a scene of the Maps tab (js/maps.js).
 *
 * A drawing is in its scene's `drawings` list:
 *   { id, kind: 'pen' | 'line' | 'rect' | 'ellipse' | 'polygon' | 'text',
 *     points: [[x, y], …] (pen, line, polygon), x, y, w, h (rect, ellipse),
 *     x, y, text, size (text), stroke, fill, width, opacity }
 * in map pixels: drawings move and zoom with the map. `width` and a text's
 * `size` are set from the current zoom when drawn, so a 4 px line looks 4 px
 * wide at that zoom.
 *
 * Tools (js/maps.js's `tool`): pen, line, rect, ellipse (drag), polygon (click
 * each corner; click the first corner, double-click, or Enter to close;
 * Escape cancels), text (click, then type), eraser (click or drag over
 * drawings). With the hand tool, a click on a drawing selects it and a drag
 * moves it. Every change goes through OSR.saveScene (js/history.js), so it
 * can be undone.
 */
(function (OSR) {
  'use strict';
  const { $, $$, escapeHtml, uid } = OSR;

  const TOOLS = ['pen', 'line', 'rect', 'ellipse', 'polygon', 'text', 'eraser'];
  const SWATCHES = ['#e05252', '#e3c04d', '#6fcf6f', '#6ea8fe', '#c77dff', '#ffffff', '#000000', '#8a6a3f'];
  const KINDS = ['pen', 'line', 'rect', 'ellipse', 'polygon', 'text'];

  let style = { stroke: SWATCHES[0], width: 4, fill: false, opacity: 1 };
  let selectedId = null;
  let polygon = null;   // { sceneId, points, cursor } while a polygon is being drawn
  let polygonStroke = 1; // one screen px in map units when that polygon started
  let draft = null;     // the drawing a drag is making

  const isDrawTool = t => TOOLS.indexOf(t) !== -1;

  function ensureDrawingShape(d) {
    if (!d.id) d.id = uid();
    if (KINDS.indexOf(d.kind) === -1) d.kind = 'line';
    if (!/^#[0-9a-f]{6}$/i.test(d.stroke || '')) d.stroke = SWATCHES[0];
    d.width = Number(d.width) > 0 ? Number(d.width) : 2;
    d.opacity = Math.min(1, Math.max(0.1, Number(d.opacity) || 1));
    d.fill = !!d.fill;
    if (Array.isArray(d.points)) d.points = d.points.filter(p => Array.isArray(p) && p.length === 2).map(p => [Number(p[0]) || 0, Number(p[1]) || 0]);
    ['x', 'y', 'w', 'h', 'size'].forEach(k => { if (d[k] != null) d[k] = Number(d[k]) || 0; });
    if (d.kind === 'text') d.text = String(d.text || '');
    return d;
  }

  /* ---- Geometry ---- */

  // Ramer–Douglas–Peucker: drops the points of a freehand line that lie
  // within `eps` of the simplified line.
  function simplify(points, eps) {
    if (points.length < 3) return points.slice();
    const [ax, ay] = points[0], [bx, by] = points[points.length - 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let max = 0, at = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const [px, py] = points[i];
      const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (dist > max) { max = dist; at = i; }
    }
    if (max <= eps) return [points[0], points[points.length - 1]];
    return simplify(points.slice(0, at + 1), eps).slice(0, -1).concat(simplify(points.slice(at), eps));
  }

  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
  const num = n => +n.toFixed(2);
  const pts = list => list.map(p => num(p[0]) + ',' + num(p[1])).join(' ');

  function moveBy(d, dx, dy) {
    if (d.points) d.points = d.points.map(p => [p[0] + dx, p[1] + dy]);
    if (d.x != null) { d.x += dx; d.y += dy; }
  }

  /* ---- Render ---- */

  function drawingMarkup(d, stroke) {
    const sel = d.id === selectedId;
    const common = ' data-drawing="' + escapeHtml(d.id) + '" class="map-drawing' + (sel ? ' is-selected' : '') +
      '" stroke="' + d.stroke + '" stroke-width="' + num(d.width) + '" opacity="' + d.opacity +
      '" fill="' + (d.fill ? d.stroke : 'none') + '"' + (d.fill ? ' fill-opacity="0.35"' : '');
    let el;
    switch (d.kind) {
      case 'pen': el = '<polyline' + common + ' points="' + pts(d.points) + '"/>'; break;
      case 'line': el = '<line' + common + ' x1="' + num(d.points[0][0]) + '" y1="' + num(d.points[0][1]) + '" x2="' + num(d.points[1][0]) + '" y2="' + num(d.points[1][1]) + '"/>'; break;
      case 'polygon': el = '<polygon' + common + ' points="' + pts(d.points) + '"/>'; break;
      case 'rect': el = '<rect' + common + ' x="' + num(d.x) + '" y="' + num(d.y) + '" width="' + num(d.w) + '" height="' + num(d.h) + '"/>'; break;
      case 'ellipse': el = '<ellipse' + common + ' cx="' + num(d.x + d.w / 2) + '" cy="' + num(d.y + d.h / 2) + '" rx="' + num(d.w / 2) + '" ry="' + num(d.h / 2) + '"/>'; break;
      case 'text':
        el = '<text data-drawing="' + escapeHtml(d.id) + '" class="map-drawing map-drawing-text' + (sel ? ' is-selected' : '') + '" x="' + num(d.x) + '" y="' + num(d.y) +
          '" font-size="' + num(d.size) + '" fill="' + d.stroke + '" opacity="' + d.opacity + '">' + escapeHtml(d.text) + '</text>';
        break;
      default: el = '';
    }
    return el;
  }

  function drawingsMarkup(sc, stroke) {
    let out = sc.drawings.map(d => drawingMarkup(d, stroke)).join('');
    if (draft && draft.sceneId === sc.id) out += drawingMarkup(Object.assign({ id: '' }, draft.d), stroke);
    if (polygon && polygon.sceneId === sc.id && polygon.points.length) {
      out += '<polyline class="map-drawing map-drawing-draft" points="' + pts(polygon.points.concat(polygon.cursor ? [polygon.cursor] : [])) +
        '" stroke="' + style.stroke + '" stroke-width="' + num(style.width * stroke) + '" fill="none"/>' +
        '<circle class="map-polygon-start" cx="' + num(polygon.points[0][0]) + '" cy="' + num(polygon.points[0][1]) + '" r="' + num(stroke * 6) + '"/>';
    }
    return out;
  }

  function renderDrawBar(tool) {
    const bar = $('#map-draw-bar');
    if (!bar) return;
    bar.hidden = !isDrawTool(tool) || tool === 'eraser';
    const sw = $('#draw-swatches');
    if (!sw.children.length) {
      sw.innerHTML = SWATCHES.map(c => '<button type="button" class="draw-swatch" data-color="' + c + '" style="background:' + c + '" title="' + c + '" aria-label="Color ' + c + '"></button>').join('');
    }
    $$('#draw-swatches .draw-swatch').forEach(b => b.classList.toggle('is-active', b.dataset.color === style.stroke));
    const set = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.value = v; };
    set('#draw-color', style.stroke);
    set('#draw-width', String(style.width));
    set('#draw-opacity', String(style.opacity));
    $('#draw-fill').checked = style.fill;
    $('#draw-fill-label').hidden = !(tool === 'rect' || tool === 'ellipse' || tool === 'polygon');
    const sc = OSR.activeScene();
    $('#draw-clear').disabled = !sc || !sc.drawings.length;
  }

  /* ---- Changes ---- */

  // Adds a finished drawing (in map units) and records it for undo.
  function addDrawing(sc, d) {
    const out = ensureDrawingShape(Object.assign({ id: uid() }, d));
    sc.drawings.push(out);
    OSR.saveScene(sc);
    OSR.renderMaps();
    return out;
  }

  function deleteDrawing(sc, id) {
    const before = sc.drawings.length;
    sc.drawings = sc.drawings.filter(d => d.id !== id);
    if (selectedId === id) selectedId = null;
    if (sc.drawings.length === before) return false;
    OSR.saveScene(sc);
    OSR.renderMaps();
    return true;
  }

  function clearDrawings(sc) {
    if (!sc || !sc.drawings.length || !confirm('Delete every drawing on this scene? You can undo it (Ctrl+Z).')) return false;
    sc.drawings = [];
    selectedId = null;
    OSR.saveScene(sc);
    OSR.renderMaps();
    return true;
  }

  function finishPolygon(sc) {
    if (!polygon || polygon.sceneId !== sc.id) return;
    const points = polygon.points;
    polygon = null;
    if (points.length >= 3) addDrawing(sc, { kind: 'polygon', points, stroke: style.stroke, width: style.width * polygonStroke, fill: style.fill, opacity: style.opacity });
    else OSR.renderMaps();
  }

  /* ---- Pointer (called by js/maps.js) ---- */

  // `stroke` = one screen pixel in map units. Returns a drag, or null.
  function drawPointerDown(e, sc, p, tool, stroke) {
    if (tool === 'eraser') {
      const hit = e.target && e.target.closest ? e.target.closest('[data-drawing]') : null;
      if (hit && hit.getAttribute('data-drawing')) deleteDrawing(sc, hit.getAttribute('data-drawing'));
      return { kind: 'erase' };
    }
    if (tool === 'text') {
      const text = prompt('Text:', '');
      if (text && text.trim()) addDrawing(sc, { kind: 'text', x: p.x, y: p.y, text: text.trim(), size: stroke * 16, stroke: style.stroke, opacity: style.opacity });
      return { kind: 'none' };
    }
    if (tool === 'polygon') {
      if (!polygon || polygon.sceneId !== sc.id) { polygon = { sceneId: sc.id, points: [] }; polygonStroke = stroke; }
      const first = polygon.points[0];
      if (first && polygon.points.length >= 3 && Math.hypot(p.x - first[0], p.y - first[1]) <= stroke * 8) { finishPolygon(sc); return { kind: 'none' }; }
      if (e.detail >= 2 && polygon.points.length >= 3) { finishPolygon(sc); return { kind: 'none' }; }
      polygon.points.push([p.x, p.y]);
      OSR.renderScene();
      return { kind: 'none' };
    }
    const base = { stroke: style.stroke, width: style.width * stroke, opacity: style.opacity };
    if (tool === 'pen') draft = { sceneId: sc.id, d: Object.assign({ kind: 'pen', points: [[p.x, p.y]] }, base), eps: stroke * 1.5 };
    else if (tool === 'line') draft = { sceneId: sc.id, d: Object.assign({ kind: 'line', points: [[p.x, p.y], [p.x, p.y]] }, base) };
    else draft = { sceneId: sc.id, d: Object.assign({ kind: tool, x: p.x, y: p.y, w: 0, h: 0, fill: style.fill }, base), a: p };
    return { kind: 'draw' };
  }

  function drawPointerMove(d, sc, p, e) {
    if (d.kind === 'erase') {
      const hit = e && e.target && e.target.closest ? e.target.closest('[data-drawing]') : null;
      if (hit && hit.getAttribute('data-drawing')) deleteDrawing(sc, hit.getAttribute('data-drawing'));
      return;
    }
    if (d.kind !== 'draw' || !draft) return;
    const dr = draft.d;
    if (dr.kind === 'pen') dr.points.push([p.x, p.y]);
    else if (dr.kind === 'line') dr.points[1] = [p.x, p.y];
    else Object.assign(dr, rectOf(draft.a, p));
  }

  function drawPointerUp(d, sc) {
    if (d.kind !== 'draw' || !draft) return;
    const dr = draft.d, eps = draft.eps;
    draft = null;
    if (dr.kind === 'pen') {
      dr.points = simplify(dr.points, eps);
      if (dr.points.length < 2) dr.points.push(dr.points[0].slice()); // a dot
    }
    const tooSmall = (dr.kind === 'rect' || dr.kind === 'ellipse') ? (dr.w < 1 && dr.h < 1)
      : dr.kind === 'line' ? Math.hypot(dr.points[1][0] - dr.points[0][0], dr.points[1][1] - dr.points[0][1]) < 1 : false;
    if (tooSmall) { OSR.renderMaps(); return; }
    addDrawing(sc, dr);
  }

  function polygonMove(sc, p) {
    if (!polygon || polygon.sceneId !== sc.id || !polygon.points.length) return false;
    polygon.cursor = [p.x, p.y];
    return true;
  }

  // Enter closes a polygon; Escape cancels it. Delete removes the selected drawing.
  function drawKey(e, sc) {
    if (polygon && polygon.sceneId === sc.id) {
      if (e.key === 'Enter') { e.preventDefault(); finishPolygon(sc); return true; }
      if (e.key === 'Escape') { polygon = null; OSR.renderMaps(); return true; }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && sc.drawings.some(d => d.id === selectedId)) {
      e.preventDefault();
      deleteDrawing(sc, selectedId);
      return true;
    }
    return false;
  }

  /* ---- Select and move (hand tool) ---- */

  function selectPointerDown(e, sc, p) {
    const hit = e.target && e.target.closest ? e.target.closest('[data-drawing]') : null;
    const id = hit && hit.getAttribute('data-drawing');
    if (!id) { if (selectedId) { selectedId = null; OSR.renderMaps(); } return null; }
    selectedId = id;
    const d = sc.drawings.find(x => x.id === id);
    OSR.renderMaps();
    return d ? { kind: 'move-drawing', a: p, start: JSON.stringify(d), id, moved: false } : null;
  }
  function selectPointerMove(m, sc, p) {
    const d = sc.drawings.find(x => x.id === m.id);
    if (!d) return;
    const orig = JSON.parse(m.start);
    Object.assign(d, orig);
    moveBy(d, p.x - m.a.x, p.y - m.a.y);
    m.moved = true;
  }
  function selectPointerUp(m, sc) {
    if (m.moved) OSR.saveScene(sc);
    OSR.renderMaps();
  }

  // Leaving a tool, or another scene, drops what was half drawn.
  function cancelDraft() { polygon = null; draft = null; }

  function wireDrawings() {
    $('#draw-swatches').addEventListener('click', e => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      style.stroke = b.dataset.color;
      OSR.renderMaps();
    });
    $('#map-draw-bar').addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'draw-color' && /^#[0-9a-f]{6}$/i.test(t.value)) style.stroke = t.value;
      else if (t.id === 'draw-width') style.width = Number(t.value) || 4;
      else if (t.id === 'draw-fill') style.fill = t.checked;
      else if (t.id === 'draw-opacity') style.opacity = Math.min(1, Math.max(0.1, Number(t.value) || 1));
      else return;
      OSR.renderMaps();
    });
    $('#draw-clear').addEventListener('click', () => clearDrawings(OSR.activeScene()));
  }

  const drawingState = () => ({ style: Object.assign({}, style), selectedId, polygon: polygon && { points: polygon.points.slice() } });

  Object.assign(OSR, {
    DRAW_TOOLS: TOOLS, isDrawTool, ensureDrawingShape, simplifyLine: simplify, drawingsMarkup, renderDrawBar,
    addDrawing, deleteDrawing, clearDrawings, drawPointerDown, drawPointerMove, drawPointerUp, drawPolygonMove: polygonMove,
    drawKey, drawSelectDown: selectPointerDown, drawSelectMove: selectPointerMove, drawSelectUp: selectPointerUp,
    cancelDrawDraft: cancelDraft, wireDrawings, drawingState
  });
})(window.OSR = window.OSR || {});
