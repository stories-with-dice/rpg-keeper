/* js/dice3d.js — 3D dice over the page for every dice roll.
 *
 * js/dice.js calls OSR.show3dDice(dice) after a roll (doRoll and the
 * percentile roll; not the random tables). `dice` is the roll's kept dice,
 * [{ sides, value }] (sides 'F' for a Fate die, 100 for d%). The dice fly in,
 * tumble, land with the rolled face toward the viewer, stay a moment, and fade.
 * The roll's result does not wait for them: the log and the result box update
 * at once, the dice are only a show.
 *
 * three.js (vendor/three/three.min.js, r159, the last release with a classic
 * script build) loads on the first 3D roll, not at boot, from this site
 * (no network use beyond it). There is no physics: each die follows a path
 * that ends on its rolled face.
 *
 * Settings → "3D dice" turns it off for this browser (localStorage
 * osr_dice_3d, on by default). It is also off with "reduce motion" in the
 * operating system, without WebGL, and in jsdom (the tests).
 */
(function (OSR) {
  'use strict';

  const KEY = 'osr_dice_3d';
  const MAX_DICE = 12;
  const FLY = 1100, HOLD = 1300, FADE = 450; // ms

  function dice3dOn() {
    try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; }
  }
  function setDice3d(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* this page only */ }
    if (!on) clearDice();
  }

  // The dice to draw for a roll's dice: d% is two d10s (tens "00"–"90" and
  // units "0"–"9", 100 = "00" + "0"); a d10 shows 10 as "0". At most MAX_DICE.
  // Pure (no DOM): js/dice.js's result shape in, [{ sides, label, labels }] out,
  // where `labels` are the die's face labels and `label` the one that lands up.
  function diceToShow(dice) {
    const out = [];
    (dice || []).forEach(d => {
      const v = Number(d.value);
      if (d.sides === 'F') {
        out.push({ sides: 'F', labels: ['+', '+', '−', '−', '', ''], label: v > 0 ? '+' : v < 0 ? '−' : '' });
      } else if (d.sides === 100) {
        const tens = Math.floor((v % 100) / 10), ones = v % 10;
        out.push({ sides: 10, labels: ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'], label: tens + '0' === '00' ? '00' : tens + '0' });
        out.push({ sides: 10, labels: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], label: String(ones) });
      } else if ([4, 6, 8, 10, 12, 20].indexOf(d.sides) !== -1) {
        const labels = [];
        for (let i = 1; i <= d.sides; i++) labels.push(d.sides === 10 && i === 10 ? '0' : String(i));
        out.push({ sides: d.sides, labels: labels, label: d.sides === 10 && v === 10 ? '0' : String(v) });
      }
      // Other dice (d3, d7, …) have no solid: they are not drawn.
    });
    return out.slice(0, MAX_DICE);
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

  /* ---- solids with one labelled face per die face ---- */
  // A pentagonal trapezohedron (d10): poles at ±h, ten ring vertices at
  // alternating heights ±d. The kites are flat when h = d(1+cos36°)/(1−cos36°).
  function d10Geometry(THREE) {
    const d = 0.105, c = Math.cos(Math.PI / 5), h = d * (1 + c) / (1 - c);
    const ring = [];
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5;
      ring.push(new THREE.Vector3(Math.cos(a), Math.sin(a), i % 2 === 0 ? d : -d));
    }
    const top = new THREE.Vector3(0, 0, h), bot = new THREE.Vector3(0, 0, -h);
    const tris = [];
    for (let i = 0; i < 10; i += 2) { // upper kites: top, upper i, lower i+1, upper i+2
      const a = ring[i], b = ring[(i + 1) % 10], cc = ring[(i + 2) % 10];
      tris.push([top, a, b], [top, b, cc]);
    }
    for (let i = 1; i < 10; i += 2) { // lower kites: bottom, lower i, upper i+1, lower i+2
      const a = ring[i], b = ring[(i + 1) % 10], cc = ring[(i + 2) % 10];
      tris.push([bot, a, b], [bot, b, cc]);
    }
    const pos = [];
    tris.forEach(t => {
      // Wind each triangle outward.
      const n = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0]));
      const cen = new THREE.Vector3().add(t[0]).add(t[1]).add(t[2]);
      const tri = n.dot(cen) < 0 ? [t[0], t[2], t[1]] : t;
      tri.forEach(v => pos.push(v.x, v.y, v.z));
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }

  function baseGeometry(THREE, sides) {
    switch (sides) {
      case 4: return new THREE.TetrahedronGeometry(1.15);
      case 6: case 'F': return new THREE.BoxGeometry(1.25, 1.25, 1.25);
      case 8: return new THREE.OctahedronGeometry(1.05);
      case 10: return d10Geometry(THREE);
      case 12: return new THREE.DodecahedronGeometry(1.05);
      default: return new THREE.IcosahedronGeometry(1.05);
    }
  }

  // Split a solid's triangles into its faces (same normal), give each face its
  // own material slot and UVs that map a square label texture onto it.
  // Returns { geometry, faces: [{ normal, up }] } in the face order.
  function facedGeometry(THREE, sides) {
    const g = baseGeometry(THREE, sides).toNonIndexed();
    const p = g.getAttribute('position');
    const groups = new Map();
    for (let t = 0; t < p.count; t += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, t);
      const b = new THREE.Vector3().fromBufferAttribute(p, t + 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, t + 2);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      const key = [n.x, n.y, n.z].map(x => Math.round(x * 1000)).join(',');
      if (!groups.has(key)) groups.set(key, { normal: n, tris: [] });
      groups.get(key).tris.push([a, b, c]);
    }
    const pos = [], nor = [], uv = [], faces = [];
    const out = new THREE.BufferGeometry();
    let start = 0;
    Array.from(groups.values()).forEach((grp, fi) => {
      const n = grp.normal;
      const verts = [];
      grp.tris.forEach(t => t.forEach(v => verts.push(v)));
      const center = new THREE.Vector3();
      verts.forEach(v => center.add(v));
      center.divideScalar(verts.length);
      // The face's "up": toward the farthest vertex for a triangle (a d4 or
      // d20 reads with a point up), else any direction in the plane.
      let up = new THREE.Vector3(0, 1, 0);
      if (Math.abs(up.dot(n)) > 0.9) up = new THREE.Vector3(1, 0, 0);
      up = up.sub(n.clone().multiplyScalar(up.dot(n))).normalize();
      if (sides === 10) { // a kite reads along its long axis, toward the pole
        const pole = verts.reduce((m, v) => (Math.abs(v.z) > Math.abs(m.z) ? v : m), verts[0]);
        up = pole.clone().sub(center);
        up = up.sub(n.clone().multiplyScalar(up.dot(n))).normalize();
      }
      const right = new THREE.Vector3().crossVectors(up, n).normalize();
      let r = 0;
      verts.forEach(v => { r = Math.max(r, v.distanceTo(center)); });
      grp.tris.forEach(t => t.forEach(v => {
        const d = v.clone().sub(center);
        pos.push(v.x, v.y, v.z);
        nor.push(n.x, n.y, n.z);
        uv.push(0.5 + d.dot(right) / (2 * r), 0.5 + d.dot(up) / (2 * r));
      }));
      const count = grp.tris.length * 3;
      out.addGroup(start, count, fi);
      start += count;
      faces.push({ normal: n.clone(), up: up.clone(), right: right.clone() });
    });
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return { geometry: out, faces: faces };
  }

  const textures = new Map();
  function labelTexture(THREE, label, body, ink, sides) {
    const key = label + '|' + body + '|' + ink + '|' + sides;
    if (textures.has(key)) return textures.get(key);
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    g.fillStyle = body;
    g.fillRect(0, 0, size, size);
    if (label) {
      // Smaller text on faces with a small inscribed area (triangles, kites).
      const scale = { 4: 0.3, 8: 0.36, 10: 0.36, 20: 0.32, 12: 0.42 }[sides] || 0.5;
      g.font = 'bold ' + Math.round(size * scale) + 'px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0,0,0,.45)';
      const y = sides === 4 || sides === 8 || sides === 20 ? size * 0.56 : size * 0.5;
      g.strokeText(label, size / 2, y);
      g.fillStyle = ink;
      g.fillText(label, size / 2, y);
      if (label === '6' || label === '9') g.fillRect(size * 0.4, y + size * scale * 0.42, size * 0.2, 4); // tell 6 from 9
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    textures.set(key, tex);
    return tex;
  }

  function themeColors() {
    const css = getComputedStyle(document.documentElement);
    const accent = (css.getPropertyValue('--accent') || '').trim() || '#8a5cf6';
    return { body: accent, ink: '#ffffff' };
  }

  // The rotation that turns `face` toward the viewer (+z) with its up along +y,
  // then a small random twist so the dice do not look stamped.
  function landingQuaternion(THREE, face) {
    const m = new THREE.Matrix4().makeBasis(face.right, face.up, face.normal); // local → (x, y, z)
    const q = new THREE.Quaternion().setFromRotationMatrix(m).invert();
    const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (Math.random() - 0.5) * 0.5);
    return twist.multiply(q);
  }

  /* ---- the overlay ---- */
  let view = null; // { renderer, scene, camera, canvas }
  let show = null; // { dice: [...], t0, raf }

  function ensureView(THREE) {
    if (view) return view;
    const canvas = document.createElement('canvas');
    canvas.className = 'dice3d-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-4, 6, 10);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 24);
    view = { renderer: renderer, scene: scene, camera: camera, canvas: canvas };
    window.addEventListener('resize', sizeView);
    return view;
  }
  function sizeView() {
    if (!view) return;
    const w = window.innerWidth, h = window.innerHeight;
    view.renderer.setSize(w, h, false);
    view.camera.aspect = w / h;
    view.camera.updateProjectionMatrix();
  }

  function clearDice() {
    if (!show) return;
    cancelAnimationFrame(show.raf);
    show.dice.forEach(d => {
      view.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.forEach(mat => mat.dispose());
    });
    show = null;
    if (view) view.canvas.hidden = true;
  }

  const easeOut = t => 1 - Math.pow(1 - t, 3);

  function startShow(THREE, specs) {
    clearDice();
    const v = ensureView(THREE);
    sizeView();
    v.canvas.hidden = false;
    const colors = themeColors();
    // Visible half-size of the scene at z = 0.
    const halfH = Math.tan(v.camera.fov * Math.PI / 360) * v.camera.position.z;
    const halfW = halfH * v.camera.aspect;
    const perRow = Math.min(specs.length, Math.max(2, Math.floor(halfW * 2 / 3)));
    const rows = Math.ceil(specs.length / perRow);
    const dice = specs.map((spec, i) => {
      const built = facedGeometry(THREE, spec.sides);
      const labels = spec.labels.slice();
      const mats = built.faces.map((f, fi) => new THREE.MeshStandardMaterial({
        map: labelTexture(THREE, labels[fi % labels.length] || '', colors.body, colors.ink, spec.sides),
        roughness: 0.45, metalness: 0.1, transparent: true, opacity: 1
      }));
      const mesh = new THREE.Mesh(built.geometry, mats);
      mesh.scale.setScalar(1.15);
      // The face that lands up: the first face with the rolled label.
      let fi = labels.indexOf(spec.label);
      if (fi < 0 || fi >= built.faces.length) fi = 0;
      const row = Math.floor(i / perRow), col = i % perRow;
      const inRow = Math.min(perRow, specs.length - row * perRow);
      const target = new THREE.Vector3((col - (inRow - 1) / 2) * 3, ((rows - 1) / 2 - row) * 3, 0);
      // Turn the rolled face toward the camera, not only along +z: a die far
      // from the center would otherwise show it at an angle.
      const toCam = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), v.camera.position.clone().sub(target).normalize());
      const end = toCam.multiply(landingQuaternion(THREE, built.faces[fi]));
      const from = new THREE.Vector3(halfW + 3 + Math.random() * 2, -halfH * 0.6 + Math.random() * halfH * 0.6, 2);
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const spin = Math.PI * (5 + Math.random() * 3);
      v.scene.add(mesh);
      return { mesh: mesh, end: end, target: target, from: from, axis: axis, spin: spin, delay: i * 60 };
    });
    show = { dice: dice, t0: performance.now(), raf: 0 };
    const tick = now => {
      if (!show) return;
      const t = now - show.t0;
      let alive = false;
      show.dice.forEach(d => {
        const k = Math.max(0, Math.min(1, (t - d.delay) / FLY));
        const e = easeOut(k);
        d.mesh.position.lerpVectors(d.from, d.target, e);
        d.mesh.position.y += Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 2.2; // bounces that die down
        const roll = new THREE.Quaternion().setFromAxisAngle(d.axis, d.spin * (1 - e));
        d.mesh.quaternion.copy(d.end).multiply(roll);
        const f = Math.max(0, Math.min(1, (t - d.delay - FLY - HOLD) / FADE));
        d.mesh.material.forEach(mat => { mat.opacity = 1 - f; });
        if (f < 1) alive = true;
      });
      v.renderer.render(v.scene, v.camera);
      if (alive) show.raf = requestAnimationFrame(tick);
      else clearDice();
    };
    show.raf = requestAnimationFrame(tick);
  }

  // Draw the dice of one roll. Returns true when they will show.
  function show3dDice(dice) {
    if (!canShow()) return false;
    const specs = diceToShow(dice);
    if (!specs.length) return false;
    loadThree().then(THREE => {
      try { startShow(THREE, specs); } catch (e) { clearDice(); } // no WebGL: the roll is already logged
    }).catch(() => { /* three.js did not load: no dice, the roll is already logged */ });
    return true;
  }

  // Escape removes the dice at once. They never block the page: the canvas
  // lets the mouse through.
  function wireDice3d() {
    document.addEventListener('keydown', e => { if (e.key === 'Escape') clearDice(); });
  }

  Object.assign(OSR, { show3dDice, diceToShow, dice3dOn, setDice3d, clearDice3d: clearDice, wireDice3d });
})(window.OSR = window.OSR || {});
