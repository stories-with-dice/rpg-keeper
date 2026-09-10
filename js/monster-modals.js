/* js/monster-modals.js — the "Add monster" library modal (search/filter,
 * roll-random, hover preview, paste-to-parse) and the monster edit modal.
 * Split out of the combat tracker (js/combat.js), which still owns the
 * "+ Add monster…" button that opens this.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, uid } = OSR;

  /* ---- shared "fill in fields" host: build once per modal, then just
     populate/collect against it (see js/monster-form.js) ---- */
  function ensureMonsterFormBuilt(host) {
    if (host.dataset.built) return;
    host.innerHTML = OSR.monsterFormHtml();
    OSR.wireMonsterForm(host);
    host.dataset.built = '1';
  }
  // The "Paste text" / "Fill in fields" toggle shared by both monster
  // modals: `root` is the .mm-mode wrapper (#mm-mode or #me-mode).
  function setMonsterMode(root, mode) {
    root.querySelectorAll('.mm-mode-btn').forEach(b => b.classList.toggle('is-active', b.dataset.mode === mode));
    root.querySelector('.mm-mode-paste').hidden = mode !== 'paste';
    root.querySelector('.mm-mode-fields').hidden = mode !== 'fields';
  }
  function activeMonsterMode(root) {
    const btn = root.querySelector('.mm-mode-btn.is-active');
    return btn ? btn.dataset.mode : 'paste';
  }
  function wireMonsterModeToggle(root) {
    root.querySelectorAll('.mm-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setMonsterMode(root, btn.dataset.mode));
    });
  }

  /* ---- monster library modal ---- */
  let libFiltered = [];   // monsters matching the current filters (render order)
  let libRolledId = null;  // last "Roll" result, highlighted

  // opts.prefill (a def — see the generator in js/monster-browser.js) opens
  // straight into "Fill in fields", pre-populated, for review before saving;
  // a plain call opens today's default "browse + paste" view.
  function openMonsterModal(opts) {
    opts = opts || {};
    $('#monster-modal').hidden = false;
    $('#mm-msg').textContent = '';
    libRolledId = null;
    renderLibrary();
    ensureMonsterFormBuilt($('#mm-fields-host'));
    if (opts.prefill) {
      OSR.populateMonsterForm($('#mm-fields-host'), opts.prefill);
      setMonsterMode($('#mm-mode'), 'fields');
    } else {
      $('#mm-paste-area').value = '';
      OSR.populateMonsterForm($('#mm-fields-host'), {});
      setMonsterMode($('#mm-mode'), 'paste');
      $('#mm-search').focus();
    }
  }
  function closeMonsterModal() {
    $('#monster-modal').hidden = true;
    hideLibPreview();
  }
  function addFromFields(alsoCombat) {
    const def = OSR.collectMonsterForm($('#mm-fields-host'));
    if (!def.name || def.name === 'Unnamed') { $('#mm-msg').textContent = 'Name is required.'; return; }
    def.id = uid();
    def.system = OSR.currentSystem();
    OSR.state.monsters.push(def);
    OSR.save();
    if (alsoCombat) OSR.addMonsterEntry(def);
    renderLibrary();
    OSR.renderCombat();
    OSR.populateMonsterForm($('#mm-fields-host'), {});
    $('#mm-msg').textContent = 'Added ' + def.name + ' to the library' + (alsoCombat ? ' and to combat.' : '.');
  }

  // Shared by this modal's library list and the Bestiary tab
  // (js/monster-browser.js) — each has its own search/HD inputs but the same
  // filter+sort logic.
  function filterMonsters(list, opts) {
    opts = opts || {};
    const q = String(opts.q || '').toLowerCase().trim();
    const mn = opts.hdMin, mx = opts.hdMax;
    return list.filter(d => {
      if (q && !(d.name || '').toLowerCase().includes(q)) return false;
      const h = d.hdNum != null ? d.hdNum : MonsterParse.hdNum(d.hd);
      if (!isNaN(mn) && h < mn) return false;
      if (!isNaN(mx) && h > mx) return false;
      return true;
    }).sort((a, b) => (a.hdNum || 0) - (b.hdNum || 0) || String(a.name).localeCompare(b.name));
  }

  function libMatches() {
    return filterMonsters(OSR.monstersForSystem(), {
      q: $('#mm-search').value,
      hdMin: parseFloat($('#mm-hd-min').value),
      hdMax: parseFloat($('#mm-hd-max').value)
    });
  }

  function renderLibrary() {
    if (OSR.renderMonsterBrowser) OSR.renderMonsterBrowser(); // keep the Bestiary tab in sync
    libFiltered = libMatches();
    const list = $('#mm-lib-list');
    $('#mm-roll').disabled = libFiltered.length < 1;
    $('#mm-count').textContent = libFiltered.length + ' / ' + OSR.monstersForSystem().length;
    if (!libFiltered.length) {
      list.innerHTML = '<li class="mm-empty hint">No monsters match. Paste a stat block on the right to add one.</li>';
      return;
    }
    list.innerHTML = libFiltered.map(d => {
      const meta = ['HD ' + (d.hd || '?'), 'AC ' + (d.ac && d.ac.asc != null ? d.ac.asc : '?'), 'HP ' + (d.hp || '?'), d.source].join(' · ');
      return '<li data-id="' + d.id + '"' + (d.id === libRolledId ? ' class="is-rolled"' : '') + '>' +
        '<div class="mm-li-main"><b>' + escapeHtml(d.name) + '</b>' +
        '<span class="mm-li-meta">' + escapeHtml(meta) + '</span></div>' +
        '<div class="mm-li-actions">' +
          '<button class="btn mm-add">Add</button>' +
          '<button class="btn mm-edit">Edit</button>' +
          '<button class="btn mm-del" title="Remove from library">✕</button>' +
        '</div></li>';
    }).join('');
  }

  function rollLibrary() {
    if (!libFiltered.length) return;
    const d = libFiltered[Math.floor(Math.random() * libFiltered.length)];
    libRolledId = d.id;
    renderLibrary();
    const li = $('#mm-lib-list [data-id="' + d.id + '"]');
    if (li) li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('#mm-msg').textContent = 'Rolled → ' + d.name + '  (HD ' + (d.hd || '?') + ', ' + libFiltered.length + ' options)';
    OSR.pushNote('Library', 'rolled → ' + d.name, 'HD ' + (d.hd || '?') + ', ' + libFiltered.length + ' options');
  }

  function onLibClick(e) {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const d = OSR.state.monsters.find(x => x.id === li.dataset.id);
    if (!d) return;
    if (e.target.closest('.mm-add')) {
      OSR.addMonsterEntry(d);
      $('#mm-msg').textContent = 'Added ' + d.name + ' to combat.';
    } else if (e.target.closest('.mm-edit')) {
      openMonsterEdit(d.id);
    } else if (e.target.closest('.mm-del')) {
      if (confirm('Remove "' + d.name + '" from the library?')) {
        OSR.state.monsters = OSR.state.monsters.filter(x => x.id !== d.id);
        if (libRolledId === d.id) libRolledId = null;
        OSR.save();
        renderLibrary();
      }
    }
  }

  /* ---- library hover preview ---- */
  function monsterCardHtml(d) {
    const bits = [
      'AC ' + (d.ac ? OSR.acDisplay(d) : '?'),
      'HD ' + (d.hd || '?'),
      'HP ' + (d.hp || '?')
    ];
    if (d.move) bits.push('MV ' + d.move);
    if (d.align) bits.push('AL ' + d.align);
    if (d.moraleML != null) bits.push('ML ' + d.moraleML);
    let h = '<div class="mmp-head"><b>' + escapeHtml(d.name) + '</b> <span>' + escapeHtml(d.source || '') + '</span></div>' +
      '<div class="mmp-line">' + escapeHtml(bits.join('  ·  ')) + '</div>';
    if (d.attacksText) h += '<div class="mmp-line"><span>ATK</span> ' + escapeHtml(d.attacksText) + '</div>';
    if (d.savesText) h += '<div class="mmp-line"><span>SV</span> ' + escapeHtml(d.savesText) + '</div>';
    if (Array.isArray(d.abilities) && d.abilities.length) {
      h += '<div class="mmp-abils">' + d.abilities.map(a =>
        '<p>' + (a.name ? '<b>' + escapeHtml(a.name) + '.</b> ' : '') + escapeHtml(a.text) + '</p>').join('') + '</div>';
    }
    if (d.desc) h += '<p class="mmp-desc">' + escapeHtml(d.desc) + '</p>';
    return h;
  }
  let libPreviewId = null;
  function showLibPreview(li) {
    if (li.dataset.id === libPreviewId && !$('#mm-preview').hidden) return;
    const d = OSR.state.monsters.find(x => x.id === li.dataset.id);
    if (!d) return;
    libPreviewId = li.dataset.id;
    const pop = $('#mm-preview');
    pop.innerHTML = monsterCardHtml(d);
    pop.hidden = false;
    const r = li.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.right + 10;
    if (left + pw > window.innerWidth - 8) left = r.left - pw - 10;
    if (left < 8) left = 8;
    let top = r.top;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function hideLibPreview() { $('#mm-preview').hidden = true; libPreviewId = null; }

  /* ---- monster edit modal ---- */
  let editMonsterId = null;
  function openMonsterEdit(id) {
    const d = OSR.state.monsters.find(x => x.id === id);
    if (!d) return;
    editMonsterId = id;
    hideLibPreview();
    $('#me-name').textContent = d.name;
    $('#me-area').value = d.raw || '';
    $('#me-msg').textContent = '';
    ensureMonsterFormBuilt($('#me-fields-host'));
    OSR.populateMonsterForm($('#me-fields-host'), d);
    setMonsterMode($('#me-mode'), 'paste');
    $('#monster-edit-modal').hidden = false;
    $('#me-area').focus();
  }
  function closeMonsterEdit() {
    $('#monster-edit-modal').hidden = true;
    editMonsterId = null;
  }
  function saveMonsterEdit() {
    if (editMonsterId == null) return;
    const idx = OSR.state.monsters.findIndex(x => x.id === editMonsterId);
    if (idx < 0) { closeMonsterEdit(); return; }
    let parsed;
    if (activeMonsterMode($('#me-mode')) === 'fields') {
      parsed = OSR.collectMonsterForm($('#me-fields-host'));
      if (!parsed.name || parsed.name === 'Unnamed') { $('#me-msg').textContent = 'Name is required.'; return; }
    } else {
      const text = $('#me-area').value;
      parsed = window.MonsterParse ? MonsterParse.parseOne(text) : null;
      if (!parsed) {
        $('#me-msg').textContent = 'Could not parse — needs a name line, an "AC …" line, and stats.';
        return;
      }
      parsed.raw = text.trim();
    }
    parsed.id = editMonsterId;
    parsed.system = OSR.state.monsters[idx].system || 'osr'; // editing never reclassifies a monster's system
    OSR.state.monsters[idx] = parsed;
    OSR.save();
    hideLibPreview();
    renderLibrary();
    closeMonsterEdit();
    $('#mm-msg').textContent = 'Saved ' + parsed.name + '.';
  }
  function parseAndAdd(text, alsoCombat) {
    const defs = (window.MonsterParse ? MonsterParse.parseMonsters(text || '') : []);
    if (!defs.length) {
      $('#mm-msg').textContent = 'No stat blocks found — each needs an "AC …" line, blank line between monsters.';
      return;
    }
    const added = [];
    defs.forEach(d => { d.id = uid(); d.system = OSR.currentSystem(); OSR.state.monsters.push(d); added.push(d); });
    OSR.save();
    if (alsoCombat) added.forEach(OSR.addMonsterEntry);
    renderLibrary();
    OSR.renderCombat();
    $('#mm-paste-area').value = '';
    $('#mm-msg').textContent = 'Added ' + added.length + ' monster' + (added.length > 1 ? 's' : '') +
      ' to the library' + (alsoCombat ? ' and to combat.' : '.');
  }

  function wireMonsterModals() {
    $('#mm-close').addEventListener('click', closeMonsterModal);
    $('#monster-modal').addEventListener('click', e => { if (e.target === $('#monster-modal')) closeMonsterModal(); });
    const rerenderLib = () => { libRolledId = null; renderLibrary(); };
    $('#mm-search').addEventListener('input', rerenderLib);
    $('#mm-hd-min').addEventListener('input', rerenderLib);
    $('#mm-hd-max').addEventListener('input', rerenderLib);
    $('#mm-roll').addEventListener('click', rollLibrary);
    $('#mm-lib-list').addEventListener('click', onLibClick);
    $('#mm-lib-list').addEventListener('mouseover', e => {
      const li = e.target.closest('li[data-id]');
      if (li) showLibPreview(li);
    });
    $('#mm-lib-list').addEventListener('mouseleave', hideLibPreview);
    $('#mm-lib-list').addEventListener('scroll', hideLibPreview);
    $('#mm-parse-add').addEventListener('click', () => parseAndAdd($('#mm-paste-area').value, true));
    $('#mm-parse-lib').addEventListener('click', () => parseAndAdd($('#mm-paste-area').value, false));
    wireMonsterModeToggle($('#mm-mode'));
    $('#mm-fields-add').addEventListener('click', () => addFromFields(true));
    $('#mm-fields-lib').addEventListener('click', () => addFromFields(false));

    // monster edit modal
    $('#me-close').addEventListener('click', closeMonsterEdit);
    $('#me-cancel').addEventListener('click', closeMonsterEdit);
    $('#me-save').addEventListener('click', saveMonsterEdit);
    $('#monster-edit-modal').addEventListener('click', e => { if (e.target === $('#monster-edit-modal')) closeMonsterEdit(); });
    wireMonsterModeToggle($('#me-mode'));
  }

  Object.assign(OSR, {
    filterMonsters, openMonsterModal, closeMonsterModal, libMatches, renderLibrary, rollLibrary, onLibClick,
    monsterCardHtml, showLibPreview, hideLibPreview,
    openMonsterEdit, closeMonsterEdit, saveMonsterEdit, parseAndAdd, wireMonsterModals
  });
})(window.OSR = window.OSR || {});
