/* js/dice3d.js — 3D dice thrown over the page for every dice roll.
 *
 * Ported from the owner's Wox dice roller (overlay/render.js). js/dice.js's
 * pushLog() calls OSR.show3dDice(dice, info) for a roll that has dice (doRoll
 * and the percentile roll; not the random tables). `dice` is the roll's kept
 * dice, [{ sides, value }] (sides 'F' for a Fate die, 100 for d%).
 *
 * The order of one roll:
 *   1. The throw is simulated at once (bounces, die-to-die hits, friction),
 *      and every bounce, hit, and roll-over becomes a sound event.
 *   2. The dice fly in from one side of the window, tumble, and settle with
 *      the rolled face toward the viewer. The sounds play with them
 *      (js/dice-sound.js).
 *   3. When the dice settle, a panel shows the total at the bottom of the
 *      window, a short click plays, and info.onLanded() runs: js/dice.js then
 *      shows the roll in the Session Log and the Dice Roller's result box.
 *   4. The dice and the panel stay a moment, then fade.
 * Escape, a new roll, or turning 3D dice off ends the show at once; onLanded
 * still runs (once), so a roll is never lost.
 *
 * three.js (vendor/three/three.min.js, r159, the last release with a classic
 * script build) loads on the first 3D roll, not at boot, from this site.
 *
 * Settings → "3D dice" turns it off for this browser (localStorage
 * osr_dice_3d, on by default). It is also off with "reduce motion" in the
 * operating system, without WebGL, and in jsdom (the tests). Off: the result
 * shows at once.
 */
(function (OSR) {
  'use strict';

  const KEY = 'osr_dice_3d';
  const MAX_DICE = 20;
  const DT = 1 / 120;          // simulation step, s
  const HOLD = 2.2;            // s the dice stay after they settle
  const FADE = 450;            // ms
  const DIE_PX = 64;           // die size in CSS px (fewer than 10 dice)

  function dice3dOn() {
    try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; }
  }
  function setDice3d(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* this page only */ }
    if (!on) clearDice();
  }

  /* ---- dice skins ---- */
  // Settings → "Dice skin" (localStorage osr_dice_skin, per device):
  // 'theme' (default, the theme's accent), one of the 12 skins, or 'random'
  // (each die of a roll gets its own random skin).
  const SKIN_KEY = 'osr_dice_skin';
  function skinDef(o) {
    return Object.assign({
      pattern: 'plain', body2: o.body, body3: o.body, vein: '#000000', nebula: [], glow: null,
      roughness: 0.38, metalness: 0.02, opacity: 1, edge: 0x000000, edgeOpacity: 0.22
    }, o);
  }
  const SKINS = [
    { id: 'ivory', label: 'Ivory', body: '#efe6d2', body2: '#fffaf0', ink: '#2b2620', pattern: 'gem' },
    { id: 'obsidian', label: 'Obsidian', body: '#18181c', body2: '#3a3a44', ink: '#e9c46a', pattern: 'gem', roughness: 0.22, edge: 0xe9c46a, edgeOpacity: 0.35 },
    { id: 'crimson', label: 'Crimson', body: '#8f0f24', body2: '#d0243f', ink: '#ffffff', pattern: 'gem', roughness: 0.25 },
    { id: 'sapphire', label: 'Sapphire', body: '#163d8a', body2: '#3a78e0', ink: '#ffffff', pattern: 'gem', roughness: 0.2 },
    { id: 'emerald', label: 'Emerald', body: '#0b5c40', body2: '#1fa877', ink: '#f3d27a', pattern: 'gem', roughness: 0.22 },
    { id: 'amethyst', label: 'Amethyst', body: '#4e2a7c', body2: '#9a62d6', ink: '#ffffff', pattern: 'gem', roughness: 0.22 },
    { id: 'marble', label: 'Marble', body: '#d9d6d0', body2: '#f7f5f1', vein: '#5b5f66', ink: '#1c1c1c', pattern: 'marble', roughness: 0.3 },
    { id: 'galaxy', label: 'Galaxy', body: '#0d0b24', body2: '#2a1d5c', nebula: ['rgba(160,70,220,.45)', 'rgba(40,140,230,.4)', 'rgba(230,80,160,.3)'], ink: '#ffffff', glow: 'rgba(0,0,0,.8)', pattern: 'galaxy', roughness: 0.25, edge: 0xb9a8ff, edgeOpacity: 0.3 },
    { id: 'dragonfire', label: 'Dragonfire', body: '#d9480f', body2: '#7a1405', body3: '#ffb400', vein: '#ffe08a', ink: '#1a0a02', glow: 'rgba(255,230,160,.7)', pattern: 'flame', roughness: 0.35 },
    { id: 'frost', label: 'Frost', body: '#9cc9e8', body2: '#e8f6ff', ink: '#12324f', pattern: 'frost', roughness: 0.15, opacity: 0.9, edge: 0xffffff, edgeOpacity: 0.45 },
    { id: 'oak', label: 'Oak', body: '#8a5a2e', vein: '#3d2410', ink: '#f6e7c8', glow: 'rgba(0,0,0,.6)', pattern: 'wood', roughness: 0.6 },
    { id: 'gold', label: 'Gold', body: '#c9962c', body2: '#f6d77a', body3: '#fff3c4', ink: '#2a1d05', pattern: 'metal', roughness: 0.28, metalness: 0.35 }
  ].map(skinDef);
  // [{ id, label }] for the Settings dropdown, in order.
  const DICE_SKINS = [{ id: 'theme', label: 'Theme color' }]
    .concat(SKINS.map(s => ({ id: s.id, label: s.label })), [{ id: 'random', label: 'Random (each die)' }]);

  function diceSkin() {
    let v = null;
    try { v = localStorage.getItem(SKIN_KEY); } catch (e) { /* blocked storage: the default */ }
    return DICE_SKINS.some(s => s.id === v) ? v : 'theme';
  }
  function setDiceSkin(id) {
    if (!DICE_SKINS.some(s => s.id === id)) id = 'theme';
    try { localStorage.setItem(SKIN_KEY, id); } catch (e) { /* this page only */ }
  }
  // The skin of one die for the setting `pref` ('random' picks one of the 12 each time).
  function skinFor(pref) {
    if (pref === 'random') return SKINS[Math.floor(Math.random() * SKINS.length)];
    return SKINS.find(s => s.id === pref) || themeSkin();
  }

  // Sizes with their own solid. d3, d5, and d7 use the d6, d10, and d14
  // bodies with each number twice. Any other size is a coin with the number on top.
  const SOLIDS = [3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 30];

  // The dice to draw for a roll's dice. Pure (no DOM): js/dice.js's result
  // shape in, [{ key, sides, top, pair }] out. `key` is the body (d4…d30,
  // dF, d10t/d10u for the d% tens and units dice, token), `top` the label that
  // lands up. d% is two d10s: tens "00"–"90" and units "0"–"9" (100 = "00" + "0").
  // At most MAX_DICE.
  function diceToShow(dice) {
    const out = [];
    (dice || []).forEach(d => {
      const v = Number(d.value);
      if (d.sides === 'F') {
        out.push({ key: 'dF', sides: 6, top: v > 0 ? '+' : v < 0 ? '−' : ' ' });
      } else if (d.sides === 100) {
        const tens = Math.floor((v % 100) / 10), ones = v % 10;
        out.push({ key: 'd10t', sides: 10, top: tens === 0 ? '00' : tens + '0', pair: true });
        out.push({ key: 'd10u', sides: 10, top: String(ones), pair: true });
      } else if (SOLIDS.indexOf(d.sides) !== -1) {
        out.push({ key: 'd' + d.sides, sides: d.sides, top: String(v) });
      } else if (Number(d.sides) >= 1) {
        out.push({ key: 'token', sides: Number(d.sides), top: String(v) });
      }
    });
    return out.slice(0, MAX_DICE);
  }

  // The face labels of a body, in the order buildShape() gives them out.
  function labelsFor(key, sides) {
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => String(a + k));
    switch (key) {
      case 'd3': return range(1, 3).concat(range(1, 3));
      case 'd5': return range(1, 5).concat(range(1, 5));
      case 'd7': return range(1, 7).concat(range(1, 7));
      case 'dF': return ['+', '+', '−', '−', ' ', ' '];
      case 'd10u': return range(0, 9);
      case 'd10t': return range(0, 9).map(d => (d === '0' ? '00' : d + '0'));
      case 'token': return [String(sides || '?')];
      default: return range(1, Number(key.slice(1)) || 6);
    }
  }

  /* ---- three.js, loaded on first use ---- */
  let loading = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/three/three.min.js';
      s.onload = () => (window.THREE ? resolve(window.THREE) : reject(new Error('three.js did not load')));
      s.onerror = () => reject(new Error('three.js did not load'));
      document.head.appendChild(s);
    });
    loading.catch(() => { loading = null; });
    return loading;
  }

  function canShow() {
    if (!dice3dOn()) return false;
    if (/jsdom/i.test(navigator.userAgent || '')) return false;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* no media queries */ }
    return true;
  }

  const between = (a, b) => a + (b - a) * Math.random();

  /* ---- shapes ---- */
  const PHI = (1 + Math.sqrt(5)) / 2;
  const GEOM = {
    d3: 'd6', d4: 'd4', d5: 'trap5', d6: 'd6', dF: 'd6', d7: 'trap7', d8: 'd8',
    d10: 'trap5', d10t: 'trap5', d10u: 'trap5', d12: 'd12', d14: 'trap7', d16: 'trap8',
    d20: 'd20', d24: 'd24', d30: 'd30', token: 'token'
  };
  const SCALE = {
    d3: 1.12, d4: 1.25, d5: 1.02, d6: 1.12, dF: 1.12, d7: 1.12, d8: 1.08, d10: 1.02, d10t: 1.02, d10u: 1.02,
    d12: 1.0, d14: 1.12, d16: 1.14, d20: 1.04, d24: 1.06, d30: 1.08, token: 0.9
  };
  // Faces a die tips over per turn: one soft click each (the rolling sound).
  const FACES_PER_TURN = { d3: 4, d4: 3, d5: 5, d6: 4, dF: 4, d7: 7, d8: 5, d10: 5, d10t: 5, d10u: 5, d12: 6, d14: 7, d16: 8, d20: 8, d24: 9, d30: 10, token: 3 };

  function shapeVertices(THREE, geom) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const out = [];
    // n-gonal trapezohedron (d10 for n=5, d14 for n=7, d16 for n=8).
    const trap = (n, stretch) => {
      const c = Math.cos(Math.PI / n);
      const e = (1 - c) / (1 + c); // makes the kite faces planar
      const v = [V(0, 0, stretch), V(0, 0, -stretch)];
      for (let k = 0; k < n; k++) {
        const a = (k * 2 * Math.PI) / n, b = a + Math.PI / n;
        v.push(V(Math.cos(a), Math.sin(a), e * stretch), V(Math.cos(b), Math.sin(b), -e * stretch));
      }
      return v;
    };
    const dodeca = () => {
      const v = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push(V(x, y, z));
      for (const a of [-1, 1]) for (const b of [-1, 1]) v.push(V(0, a / PHI, b * PHI), V(a / PHI, b * PHI, 0), V(a * PHI, 0, b / PHI));
      return v;
    };
    switch (geom) {
      case 'd4': return [V(1, 1, 1), V(1, -1, -1), V(-1, 1, -1), V(-1, -1, 1)];
      case 'd6':
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(V(x, y, z));
        return out;
      case 'd8': return [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)];
      case 'trap5': return trap(5, 1);
      case 'trap7': return trap(7, 1.35);
      case 'trap8': return trap(8, 1.4);
      case 'd12': return dodeca();
      case 'd20':
        for (const a of [-1, 1]) for (const b of [-1, 1]) out.push(V(0, a, b * PHI), V(a, b * PHI, 0), V(a * PHI, 0, b));
        return out;
      case 'd24': { // deltoidal icositetrahedron: 24 kites
        const r = Math.SQRT1_2, a = (1 + 2 * Math.SQRT2) / 7;
        for (const s of [-1, 1]) out.push(V(s, 0, 0), V(0, s, 0), V(0, 0, s));
        for (const s of [-1, 1]) for (const t of [-1, 1]) out.push(V(0, s * r, t * r), V(s * r, 0, t * r), V(s * r, t * r, 0));
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(V(x * a, y * a, z * a));
        return out;
      }
      case 'd30': { // rhombic triacontahedron: dodecahedron + icosahedron vertices
        out.push.apply(out, dodeca());
        for (const s of [-1, 1]) for (const t of [-1, 1]) out.push(V(0, s * PHI, t), V(s * PHI, t, 0), V(s, 0, t * PHI));
        return out;
      }
      default: // token: a thick coin
        for (let k = 0; k < 24; k++) {
          const a = (k * 2 * Math.PI) / 24;
          out.push(V(Math.cos(a), Math.sin(a), 0.22), V(Math.cos(a), Math.sin(a), -0.22));
        }
        return out;
    }
  }

  // Brute-force convex hull: every plane through three vertices with all
  // vertices on one side is a face. Fine for at most 48 vertices.
  function hullFaces(THREE, verts) {
    const faces = [];
    const n = verts.length, eps = 1e-6;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
      const nrm = new THREE.Vector3().subVectors(verts[b], verts[a]).cross(new THREE.Vector3().subVectors(verts[c], verts[a]));
      if (nrm.lengthSq() < 1e-10) continue;
      nrm.normalize();
      let d = nrm.dot(verts[a]);
      let pos = 0, neg = 0;
      for (const v of verts) {
        const s = nrm.dot(v) - d;
        if (s > eps) pos++;
        else if (s < -eps) neg++;
      }
      if (pos && neg) continue;
      if (pos) { nrm.negate(); d = -d; }
      if (faces.some(f => f.normal.dot(nrm) > 0.9999)) continue;
      const idx = [];
      verts.forEach((v, k) => { if (Math.abs(nrm.dot(v) - d) < 1e-4) idx.push(k); });
      const center = new THREE.Vector3();
      idx.forEach(k => center.add(verts[k]));
      center.divideScalar(idx.length);
      const u0 = new THREE.Vector3().subVectors(verts[idx[0]], center).normalize();
      const w0 = new THREE.Vector3().crossVectors(nrm, u0);
      const ang = k => {
        const p = new THREE.Vector3().subVectors(verts[k], center);
        return Math.atan2(p.dot(w0), p.dot(u0));
      };
      idx.sort((x, y) => ang(x) - ang(y));
      faces.push({ normal: nrm, center: center, idx: idx });
    }
    return faces;
  }

  const textureCache = new Map();
  const shapeCache = new Map();

  // The face background of a skin: a color, a gradient, or a pattern
  // (marble veins, stars, wood grain, flames, frost, a metal sheen).
  function paintSkin(g, skin) {
    const S = 256, rnd = between;
    const radial = (c1, c2) => {
      const gr = g.createRadialGradient(S * 0.38, S * 0.32, S * 0.05, S / 2, S / 2, S * 0.75);
      gr.addColorStop(0, c1); gr.addColorStop(1, c2);
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
    };
    g.fillStyle = skin.body;
    g.fillRect(0, 0, S, S);
    switch (skin.pattern) {
      case 'gem': radial(skin.body2, skin.body); break;
      case 'marble':
        radial(skin.body2, skin.body);
        g.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          g.strokeStyle = skin.vein;
          g.globalAlpha = rnd(0.25, 0.7);
          g.lineWidth = rnd(1, 4.5);
          g.beginPath();
          const y = rnd(-40, S + 40);
          g.moveTo(-10, y);
          g.bezierCurveTo(S * 0.3, y + rnd(-90, 90), S * 0.7, y + rnd(-90, 90), S + 10, y + rnd(-60, 60));
          g.stroke();
        }
        g.globalAlpha = 1;
        break;
      case 'galaxy':
        radial(skin.body2, skin.body);
        skin.nebula.forEach(c => {
          const x = rnd(0, S), y = rnd(0, S), r = rnd(50, 120);
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.fillRect(0, 0, S, S);
        });
        g.fillStyle = '#ffffff';
        for (let i = 0; i < 70; i++) {
          g.globalAlpha = rnd(0.3, 1);
          g.beginPath();
          g.arc(rnd(0, S), rnd(0, S), rnd(0.5, 1.8), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
        break;
      case 'wood':
        g.strokeStyle = skin.vein;
        for (let i = 0; i < 26; i++) {
          g.globalAlpha = rnd(0.15, 0.45);
          g.lineWidth = rnd(1, 3.5);
          g.beginPath();
          const y = (i / 26) * S + rnd(-4, 4), a = rnd(3, 9), f = rnd(0.01, 0.03), ph = rnd(0, 6);
          for (let x = 0; x <= S; x += 8) g.lineTo(x, y + Math.sin(x * f + ph) * a);
          g.stroke();
        }
        g.globalAlpha = 1;
        break;
      case 'flame': {
        const gr = g.createLinearGradient(0, S, 0, 0);
        gr.addColorStop(0, skin.body2); gr.addColorStop(0.55, skin.body); gr.addColorStop(1, skin.body3);
        g.fillStyle = gr; g.fillRect(0, 0, S, S);
        g.fillStyle = skin.vein;
        for (let i = 0; i < 9; i++) {
          g.globalAlpha = rnd(0.15, 0.35);
          const x = rnd(0, S), w = rnd(14, 40), h = rnd(80, 200);
          g.beginPath();
          g.moveTo(x - w, S);
          g.quadraticCurveTo(x - w * 0.2, S - h * 0.6, x + rnd(-15, 15), S - h);
          g.quadraticCurveTo(x + w * 0.2, S - h * 0.6, x + w, S);
          g.fill();
        }
        g.globalAlpha = 1;
        break;
      }
      case 'frost':
        radial(skin.body2, skin.body);
        g.strokeStyle = '#ffffff';
        for (let i = 0; i < 16; i++) {
          g.globalAlpha = rnd(0.15, 0.45);
          g.lineWidth = rnd(0.6, 1.6);
          const x = rnd(0, S), y = rnd(0, S), r = rnd(8, 26);
          g.beginPath();
          for (let k = 0; k < 3; k++) { // a six-pointed crystal
            const a = (k * Math.PI) / 3;
            g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
            g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          }
          g.stroke();
        }
        g.globalAlpha = 1;
        break;
      case 'metal': {
        const gr = g.createLinearGradient(0, 0, S, S);
        gr.addColorStop(0, skin.body2); gr.addColorStop(0.45, skin.body);
        gr.addColorStop(0.55, skin.body3); gr.addColorStop(1, skin.body);
        g.fillStyle = gr; g.fillRect(0, 0, S, S);
        break;
      }
      default: break; // plain
    }
  }

  function faceTexture(THREE, skin, draw, cacheKey) {
    const key = skin.id + '|' + skin.body + '|' + cacheKey;
    if (textureCache.has(key)) return textureCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    paintSkin(g, skin);
    g.fillStyle = skin.ink;
    g.strokeStyle = skin.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (skin.glow) { g.shadowColor = skin.glow; g.shadowBlur = 8; } // keeps numbers readable on a pattern
    draw(g);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    textureCache.set(key, tex);
    return tex;
  }

  function drawLabel(g, text, x, y, px, angle, underline) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.font = '700 ' + px + 'px -apple-system, "Helvetica Neue", "Segoe UI", Arial, sans-serif';
    if (text === '+' || text === '−') {
      const L = px * 0.42;
      g.lineWidth = px * 0.16;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-L, 0); g.lineTo(L, 0);
      if (text === '+') { g.moveTo(0, -L); g.lineTo(0, L); }
      g.stroke();
    } else {
      g.fillText(text, 0, px * 0.04);
      if (underline) g.fillRect(-px * 0.28, px * 0.42, px * 0.56, px * 0.07);
    }
    g.restore();
  }

  // The geometry data and face labels of one body (cached).
  function buildShape(THREE, key, sides) {
    const ck = key === 'token' ? 'token' + sides : key;
    if (shapeCache.has(ck)) return shapeCache.get(ck);
    const geom = GEOM[key] || 'token';
    const verts = shapeVertices(THREE, geom);
    const maxLen = Math.max.apply(null, verts.map(v => v.length()));
    verts.forEach(v => v.multiplyScalar((SCALE[key] || 1) / maxLen));
    const faces = hullFaces(THREE, verts);
    const labels = labelsFor(key, sides);

    // Face axes for the texture: v points to the "up" of the label.
    faces.forEach(f => {
      let far = f.idx[0], farLen = -1;
      for (const k of f.idx) {
        const l = verts[k].distanceTo(f.center);
        if (l > farLen + 1e-6) { farLen = l; far = k; }
      }
      // Kites and rhombi point their label to the far vertex, squares to an edge, others to a vertex.
      let upPoint = verts[f.idx[0]];
      if (geom.indexOf('trap') === 0 || geom === 'd24' || geom === 'd30') upPoint = verts[far];
      else if (f.idx.length === 4) upPoint = verts[f.idx[0]].clone().add(verts[f.idx[1]]).multiplyScalar(0.5);
      f.v = new THREE.Vector3().subVectors(upPoint, f.center).normalize();
      f.u = new THREE.Vector3().crossVectors(f.v, f.normal).normalize();
      f.radius = farLen;
      f.inradius = Math.min.apply(null, f.idx.map((k, j) => {
        const a = verts[k], b = verts[f.idx[(j + 1) % f.idx.length]];
        const ab = new THREE.Vector3().subVectors(b, a);
        const ac = new THREE.Vector3().subVectors(f.center, a);
        return ac.clone().sub(ab.clone().multiplyScalar(ac.dot(ab) / ab.lengthSq())).length();
      }));
    });

    // Labels: opposite faces sum to n+1 where the die has opposite faces.
    if (key === 'token') {
      faces.forEach(f => { f.label = null; });
      const caps = faces.filter(f => Math.abs(f.normal.z) > 0.9);
      caps.sort((a, b) => b.normal.z - a.normal.z);
      caps[0].label = 'TOP';
      caps[1].label = 'd' + sides;
    } else if (key !== 'd4') {
      const N = labels.length;
      let k = 0;
      faces.forEach(f => {
        if (f.label !== undefined) return;
        f.label = labels[k];
        const opp = faces.find(o => o.label === undefined && o.normal.dot(f.normal) < -0.999);
        if (opp) opp.label = labels[N - 1 - k];
        k++;
      });
    }
    const shape = { key: key, verts: verts, faces: faces, labels: labels, sides: sides };
    shapeCache.set(ck, shape);
    return shape;
  }

  function buildMesh(THREE, shape, skin, topLabel) {
    const colors = skin;
    const key = shape.key, verts = shape.verts, faces = shape.faces;
    const pos = [], nor = [], uv = [], mats = [];
    const geo = new THREE.BufferGeometry();
    const sixNine = shape.labels.indexOf('6') !== -1 && shape.labels.indexOf('9') !== -1;
    const plain = faceTexture(THREE, colors, () => {}, 'plain');

    faces.forEach((f, fi) => {
      const toUV = p => {
        const d = new THREE.Vector3().subVectors(p, f.center);
        return [0.5 + (0.5 * d.dot(f.u)) / f.radius, 0.5 + (0.5 * d.dot(f.v)) / f.radius];
      };
      const start = pos.length / 3;
      const ring = f.idx.map(k => verts[k]);
      for (let j = 0; j < ring.length; j++) {
        [f.center, ring[j], ring[(j + 1) % ring.length]].forEach(p => {
          pos.push(p.x, p.y, p.z);
          nor.push(f.normal.x, f.normal.y, f.normal.z);
          uv.push.apply(uv, toUV(p));
        });
      }
      geo.addGroup(start, pos.length / 3 - start, fi);

      const inUV = (0.5 * f.inradius) / f.radius;
      let tex = plain;
      if (key === 'd4') { // a d4 has its numbers at the corners
        const corner = f.idx.map(k => ({ k: k, uv: toUV(verts[k]) }));
        const lbl = corner.map(c => shape.labels[c.k]).join('');
        tex = faceTexture(THREE, colors, g => {
          corner.forEach(c => {
            const du = c.uv[0] - 0.5, dv = c.uv[1] - 0.5;
            drawLabel(g, shape.labels[c.k], 128 + 256 * 0.56 * du, 128 - 256 * 0.56 * dv, 256 * inUV * 0.8, Math.atan2(du, dv), false);
          });
        }, 'd4:' + lbl);
      } else if (f.label) {
        const text = f.label === 'TOP' ? topLabel : f.label;
        const isSide = key === 'token' && f.label !== 'TOP';
        const px = 256 * inUV * (text.length >= 3 ? 0.9 : text.length === 2 ? 1.15 : 1.45) * (isSide ? 0.75 : 1);
        tex = faceTexture(THREE, colors, g => drawLabel(g, text, 128, 128, px, 0, sixNine && (text === '6' || text === '9')),
          key + ':' + text + ':' + Math.round(px));
      }
      mats.push(new THREE.MeshStandardMaterial({
        map: tex, roughness: skin.roughness, metalness: skin.metalness,
        transparent: skin.opacity < 1, opacity: skin.opacity
      }));
    });

    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow = true;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 10),
      new THREE.LineBasicMaterial({ color: skin.edge, transparent: true, opacity: skin.edgeOpacity })));
    return mesh;
  }

  // The local direction that must point at the camera, and the label "up" on it.
  function topOf(THREE, shape, top) {
    if (shape.key === 'd4') {
      const k = shape.labels.indexOf(top);
      const dir = shape.verts[Math.max(0, k)].clone().normalize();
      const up = new THREE.Vector3(0, 0, 1).cross(dir);
      if (up.lengthSq() < 1e-6) up.set(1, 0, 0);
      return { dir: dir, up: up.normalize() };
    }
    let candidates = shape.faces.filter(f => (shape.key === 'token' ? f.label === 'TOP' : f.label === top));
    if (!candidates.length) candidates = [shape.faces[0]];
    const f = candidates[Math.floor(Math.random() * candidates.length)];
    return { dir: f.normal.clone(), up: f.v.clone() };
  }

  // "Theme color": the theme's accent; the ink is dark or light, whichever reads better.
  function themeSkin() {
    let body = '#c8a15a';
    try {
      const v = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) body = v;
    } catch (e) { /* no styles: the default gold */ }
    const n = parseInt(body.slice(1), 16);
    const lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return skinDef({ id: 'theme', label: 'Theme color', body: body, ink: lum > 0.55 ? '#1e1a14' : '#ffffff' });
  }

  /* ---- the throw (precomputed) ---- */
  // Simulates the throw in CSS px (y up, 0 = the bottom of the window).
  // Returns { bodies, steps, settleTime, soundEvents }. The bottom FLOOR_Y px
  // stay free for the result panel.
  function simulate(dice, W, H, size) {
    const G = 2600;
    const n = dice.length;
    const from = ['bottom', 'left', 'right', 'bottomLeft', 'bottomRight'][Math.floor(Math.random() * 5)];
    const origin = {
      bottom: [W * between(0.3, 0.7), -H * 0.15],
      left: [-W * 0.08, H * between(0.25, 0.6)],
      right: [W * 1.08, H * between(0.25, 0.6)],
      bottomLeft: [-W * 0.05, -H * 0.1],
      bottomRight: [W * 1.05, -H * 0.1]
    }[from];
    const FLOOR_Y = Math.min(200, H * 0.26);
    const spreadX = Math.min(W * 0.3, 60 + size * 1.4 * Math.sqrt(n));
    const spreadY = Math.min((H - FLOOR_Y) * 0.3, 40 + size * Math.sqrt(n));
    const centerY = FLOOR_Y + (H - FLOOR_Y) * 0.5;

    const bodies = dice.map((d, k) => {
      const pair = d.spec.key === 'd10u' && k > 0 && dice[k - 1].spec.key === 'd10t';
      const sx = origin[0] + between(-60, 60) + (pair ? d.r * 2.2 : 0);
      const sy = origin[1] + between(-60, 60);
      const tx = W / 2 + between(-spreadX, spreadX);
      const ty = centerY + between(-spreadY, spreadY);
      const flight = between(0.95, 1.25);
      const vx = (tx - sx) / flight, vy = (ty - sy) / flight;
      return {
        r: d.r, x: sx, y: sy, z: between(d.r * 1.5, d.r * 3.5),
        vx: vx, vy: vy, vz: between(350, 750),
        inside: false, settled: false, path: 0,
        axis: [-vy, vx], axis2: [between(-1, 1), between(-1, 1), between(-0.3, 0.3)],
        frames: []
      };
    });

    // { t, type: 'impact'|'clack'|'roll', s (0..1), x, k (die index), k2 }
    const soundEvents = [];
    const lastClack = new Map();
    const maxSteps = Math.round(4.2 / DT);
    let step = 0;
    for (; step < maxSteps; step++) {
      const forceStop = step > maxSteps - 2;
      for (let k = 0; k < bodies.length; k++) {
        const b = bodies[k];
        if (b.settled) continue;
        b.vz -= G * DT;
        b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
        b.path += Math.hypot(b.vx, b.vy) * DT;
        if (b.z <= 0) {
          b.z = 0;
          if (b.vz < -120) {
            soundEvents.push({ t: step * DT, type: 'impact', s: Math.min(1, -b.vz / 1400), x: b.x, k: k });
            b.vz = -b.vz * 0.38; b.vx *= 0.82; b.vy *= 0.82;
          } else b.vz = 0;
        }
        if (b.z === 0) {
          const f = Math.exp(-2.6 * DT);
          b.vx *= f; b.vy *= f;
        }
        const r = b.r, lowY = FLOOR_Y + r;
        if (!b.inside && ((b.x > r && b.x < W - r && b.y > lowY && b.y < H - r) || step * DT > 0.8)) b.inside = true;
        if (b.inside) {
          if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * 0.5; }
          if (b.x > W - r) { b.x = W - r; b.vx = -Math.abs(b.vx) * 0.5; }
          if (b.y < lowY) { b.y = lowY; b.vy = Math.abs(b.vy) * 0.5; }
          if (b.y > H - r) { b.y = H - r; b.vy = -Math.abs(b.vy) * 0.5; }
        }
        if ((b.z === 0 && Math.hypot(b.vx, b.vy) < 18) || forceStop) {
          b.settled = true; b.vx = b.vy = b.vz = 0; b.z = 0;
        }
      }
      // Die-to-die hits.
      for (let a = 0; a < bodies.length; a++) for (let c = a + 1; c < bodies.length; c++) {
        const p = bodies[a], q = bodies[c];
        const dx = q.x - p.x, dy = q.y - p.y;
        const min = p.r + q.r;
        const dist = Math.hypot(dx, dy);
        if (dist >= min || dist < 1e-6 || Math.abs(p.z - q.z) > min) continue;
        const nx = dx / dist, ny = dy / dist;
        const overlap = min - dist;
        const wp = p.settled && !q.settled ? 0.15 : q.settled && !p.settled ? 0.85 : 0.5;
        p.x -= nx * overlap * wp; p.y -= ny * overlap * wp;
        q.x += nx * overlap * (1 - wp); q.y += ny * overlap * (1 - wp);
        const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
        const pairKey = a * 1000 + c;
        const last = lastClack.has(pairKey) ? lastClack.get(pairKey) : -1;
        if (rel < -50 && step * DT - last > 0.04) {
          lastClack.set(pairKey, step * DT);
          soundEvents.push({ t: step * DT, type: 'clack', s: Math.min(1, -rel / 900), x: (p.x + q.x) / 2, k: a, k2: c });
        }
        if (rel < 0) {
          const j = -rel * 0.75;
          if (!p.settled) { p.vx -= nx * j; p.vy -= ny * j; }
          if (!q.settled) { q.vx += nx * j; q.vy += ny * j; }
          if (p.settled && rel < -60) { p.settled = false; p.vx -= nx * j * 0.4; p.vy -= ny * j * 0.4; }
          if (q.settled && rel < -60) { q.settled = false; q.vx += nx * j * 0.4; q.vy += ny * j * 0.4; }
        }
      }
      bodies.forEach(b => b.frames.push(b.x, b.y, b.z, b.path));
      if (bodies.every(b => b.settled)) break;
    }
    const steps = step + 1;
    bodies.forEach(b => { b.total = b.frames[b.frames.length - 1]; });

    // Rolling clicks: one soft click each time a die tips onto its next face.
    bodies.forEach((b, k) => {
      const stepAngle = (2 * Math.PI) / (FACES_PER_TURN[dice[k].spec.key] || 5);
      let lastIndex = 0;
      for (let f = 1; f < steps; f++) {
        const z = b.frames[f * 4 + 2], path = b.frames[f * 4 + 3];
        const index = Math.floor((path / b.r) * 1.1 / stepAngle);
        if (index === lastIndex) continue;
        lastIndex = index;
        const speed = (path - b.frames[(f - 1) * 4 + 3]) / DT;
        if (z > 1 || speed < 25) continue;
        soundEvents.push({ t: f * DT, type: 'roll', s: Math.min(1, speed / 900) * 0.55, x: b.frames[f * 4], k: k });
      }
    });
    return { bodies: bodies, steps: steps, settleTime: steps * DT, soundEvents: soundEvents, floorY: FLOOR_Y };
  }

  /* ---- the overlay ---- */
  let view = null; // { renderer, canvas, panel }
  let show = null; // the roll on screen: { scene, dice, raf, onLanded, landed, fadeTimer }

  function ensureView(THREE) {
    if (view) return view;
    const canvas = document.createElement('canvas');
    canvas.className = 'dice3d-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.hidden = true;
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const panel = document.createElement('div');
    panel.className = 'dice3d-panel';
    panel.setAttribute('aria-hidden', 'true'); // the Session Log has the same text
    panel.hidden = true;
    panel.innerHTML = '<div class="dice3d-label"></div><div class="dice3d-total"></div><div class="dice3d-detail"></div>';
    document.body.appendChild(panel);
    view = { renderer: renderer, canvas: canvas, panel: panel };
    return view;
  }

  // Ends the roll on screen at once. Its result shows now if it has not yet.
  function clearDice() {
    const s = show;
    if (!s) return;
    show = null;
    cancelAnimationFrame(s.raf);
    clearTimeout(s.fadeTimer);
    clearTimeout(s.safety);
    s.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); // textures stay cached
    });
    if (view) {
      view.canvas.hidden = true;
      view.canvas.classList.remove('is-out');
      view.panel.hidden = true;
      view.panel.classList.remove('is-shown', 'is-out');
    }
    if (!s.landed) { s.landed = true; s.onLanded(); }
  }

  function startShow(THREE, specs, info) {
    const v = ensureView(THREE);
    const W = window.innerWidth, H = window.innerHeight;
    v.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    v.renderer.setSize(W, H, false);

    const scene = new THREE.Scene();
    const FOV = 30;
    const camDist = H / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 10, camDist * 3);
    camera.position.set(W / 2, H / 2, camDist);
    camera.lookAt(W / 2, H / 2, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a99, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(W / 2 - W * 0.25, H / 2 + H * 0.45, 1600);
    sun.target.position.set(W / 2, H / 2, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -W * 0.75; sc.right = W * 0.75; sc.top = H * 0.9; sc.bottom = -H * 0.9;
    sc.near = 100; sc.far = 4000;
    sun.shadow.radius = 5;
    scene.add(sun, sun.target);
    // An invisible table that shows only the shadows of the dice.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 3, H * 3), new THREE.ShadowMaterial({ opacity: 0.32 }));
    floor.position.set(W / 2, H / 2, 0);
    floor.receiveShadow = true;
    scene.add(floor);

    const pref = info.skin || diceSkin(); // info.skin: the Settings preview
    const size = Math.min(DIE_PX, W / 12) * Math.min(1, Math.sqrt(10 / Math.max(specs.length, 1)));
    const dice = specs.map(spec => {
      const shape = buildShape(THREE, spec.key, spec.sides);
      const mesh = buildMesh(THREE, shape, skinFor(pref), spec.top);
      mesh.scale.setScalar(size);
      scene.add(mesh);
      const t = topOf(THREE, shape, spec.top);
      const qa = new THREE.Quaternion().setFromUnitVectors(t.dir, new THREE.Vector3(0, 0, 1));
      const up = t.up.clone().applyQuaternion(qa);
      const spin = Math.atan2(up.x, up.y) + between(-0.4, 0.4);
      const qFinal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin).multiply(qa);
      return { spec: spec, shape: shape, mesh: mesh, qFinal: qFinal, r: size * (SCALE[shape.key] || 1) };
    });

    const sim = simulate(dice, W, H, size);
    sim.bodies.forEach(b => {
      b.axisV = new THREE.Vector3(b.axis[0], b.axis[1], 0).normalize();
      b.axis2V = new THREE.Vector3(b.axis2[0], b.axis2[1], b.axis2[2]).normalize();
    });

    const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3();
    function pose(k, t) {
      const d = dice[k], b = sim.bodies[k];
      const f = Math.min(sim.steps - 1, Math.max(0, Math.floor(t / DT))) * 4;
      const remaining = (b.total - b.frames[f + 3]) / d.r;
      tmpQ.setFromAxisAngle(b.axisV, -remaining * 1.1);
      tmpQ2.setFromAxisAngle(b.axis2V, -remaining * 0.35);
      d.mesh.quaternion.copy(tmpQ).multiply(tmpQ2).multiply(d.qFinal);
      // Keep the lowest vertex on the table.
      let low = Infinity;
      for (const vv of d.shape.verts) {
        tmpV.copy(vv).applyQuaternion(d.mesh.quaternion);
        if (tmpV.z < low) low = tmpV.z;
      }
      d.mesh.position.set(b.frames[f], b.frames[f + 1], b.frames[f + 2] - low * size);
    }

    // The result panel, in the free strip at the bottom of the window.
    const p = v.panel;
    p.querySelector('.dice3d-label').textContent = [info.source, info.formula].filter(Boolean).join(' · ');
    p.querySelector('.dice3d-total').textContent = String(info.total);
    p.querySelector('.dice3d-detail').textContent = info.detail || '';
    p.classList.remove('is-shown', 'is-out');
    p.hidden = false;
    v.canvas.classList.remove('is-out');
    v.canvas.hidden = false;

    // The sounds of the throw, timed with the simulation.
    if (OSR.rollSoundOn && OSR.rollSoundOn() && OSR.diceSound) {
      const pitch = dice.map(d => (OSR.diceSound.PITCH[d.shape.key] || 3000) * Math.pow(70 / size, 0.25) * between(0.92, 1.08));
      OSR.diceSound.play(sim.soundEvents, k => pitch[k], W);
    }

    const s = { scene: scene, dice: dice, raf: 0, onLanded: info.onLanded, landed: false, fadeTimer: 0, safety: 0 };
    show = s;
    const land = () => {
      if (show !== s || s.landed) return;
      s.landed = true;
      const ph = p.offsetHeight || 120;
      p.style.top = Math.max(20, H - sim.floorY + (sim.floorY - ph) / 2) + 'px';
      p.classList.add('is-shown');
      if (OSR.rollSoundOn && OSR.rollSoundOn() && OSR.diceSound) OSR.diceSound.land();
      s.onLanded();
    };
    // A hidden browser tab runs no animation frames: the result still shows,
    // at most 1 s after the dice should have landed.
    s.safety = setTimeout(land, (sim.settleTime + 1.15) * 1000);
    const t0 = performance.now();
    let fading = false;
    const frame = now => {
      if (show !== s) return;
      const t = (now - t0) / 1000;
      for (let k = 0; k < dice.length; k++) pose(k, t);
      const since = t - sim.settleTime - 0.15;
      if (since > 0) land();
      v.renderer.render(scene, camera);
      if (!fading && since > HOLD) {
        fading = true;
        v.canvas.classList.add('is-out');
        p.classList.add('is-out');
        s.fadeTimer = setTimeout(() => { if (show === s) clearDice(); }, FADE);
      }
      s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
  }

  // Throw the dice of one roll. info: { source, formula, total, detail,
  // onLanded }. Returns true when the dice will show: then onLanded() runs
  // once, when they settle (or at once if the show fails or ends early).
  // Returns false (and never calls onLanded) when no dice show.
  function show3dDice(dice, info) {
    if (!canShow()) return false;
    const specs = diceToShow(dice);
    if (!specs.length) return false;
    info = info || {};
    let done = false;
    const once = () => { if (!done) { done = true; if (info.onLanded) info.onLanded(); } };
    clearDice(); // a roll still on screen shows its result now
    // Start the sound in this click: a browser starts audio only after a user action.
    if (OSR.rollSoundOn && OSR.rollSoundOn() && OSR.diceSound) OSR.diceSound.context();
    // Until three.js loads, this placeholder lets a new roll or Escape reveal this one.
    const pending = { scene: { traverse() {} }, dice: [], raf: 0, onLanded: once, landed: false, fadeTimer: 0 };
    show = pending;
    loadThree().then(THREE => {
      if (show !== pending) return; // ended before three.js loaded
      show = null;
      try { startShow(THREE, specs, Object.assign({}, info, { onLanded: once })); }
      catch (e) { // no WebGL: show the result at once
        clearDice();
        if (view) { view.canvas.hidden = true; view.panel.hidden = true; }
        once();
      }
    }).catch(() => { if (show === pending) clearDice(); once(); });
    return true;
  }

  // True while dice are in the air (their result is not shown yet).
  function dice3dBusy() { return !!show && !show.landed; }

  // Escape ends the show at once. The dice never block the page: the canvas
  // and the panel let the mouse through.
  function wireDice3d() {
    document.addEventListener('keydown', e => { if (e.key === 'Escape') clearDice(); });
  }

  Object.assign(OSR, { show3dDice, diceToShow, dice3dOn, setDice3d, dice3dBusy, clearDice3d: clearDice, wireDice3d,
    DICE_SKINS, diceSkin, setDiceSkin, skinFor });
})(window.OSR = window.OSR || {});
