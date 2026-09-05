/* js/monster-modals.js — the "Add monster" library modal (search/filter,
 * roll-random, hover preview, paste-to-parse) and the monster edit modal.
 * Split out of the combat tracker (js/combat.js), which still owns the
 * "+ Add monster…" button that opens this.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, uid } = OSR;

  /* ---- monster library modal ---- */
  let libFiltered = [];   // monsters matching the current filters (render order)
  let libRolledId = null;  // last "Roll" result, highlighted

  function openMonsterModal() {
    $('#monster-modal').hidden = false;
    $('#mm-msg').textContent = '';
    libRolledId = null;
    renderLibrary();
    $('#mm-search').focus();
  }
  function closeMonsterModal() {
    $('#monster-modal').hidden = true;
    hideLibPreview();
  }

  function libMatches() {
    const q = ($('#mm-search').value || '').toLowerCase().trim();
    const mn = parseFloat($('#mm-hd-min').value);
    const mx = parseFloat($('#mm-hd-max').value);
    return OSR.state.monsters.filter(d => {
      if (q && !(d.name || '').toLowerCase().includes(q)) return false;
      const h = d.hdNum != null ? d.hdNum : MonsterParse.hdNum(d.hd);
      if (!isNaN(mn) && h < mn) return false;
      if (!isNaN(mx) && h > mx) return false;
      return true;
    }).sort((a, b) => (a.hdNum || 0) - (b.hdNum || 0) || String(a.name).localeCompare(b.name));
  }

  function renderLibrary() {
    libFiltered = libMatches();
    const list = $('#mm-lib-list');
    $('#mm-roll').disabled = libFiltered.length < 1;
    $('#mm-count').textContent = libFiltered.length + ' / ' + OSR.state.monsters.length;
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
    const text = $('#me-area').value;
    const parsed = window.MonsterParse ? MonsterParse.parseOne(text) : null;
    if (!parsed) {
      $('#me-msg').textContent = 'Could not parse — needs a name line, an "AC …" line, and stats.';
      return;
    }
    parsed.id = editMonsterId;
    parsed.raw = text.trim();
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
    defs.forEach(d => { d.id = uid(); OSR.state.monsters.push(d); added.push(d); });
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

    // monster edit modal
    $('#me-close').addEventListener('click', closeMonsterEdit);
    $('#me-cancel').addEventListener('click', closeMonsterEdit);
    $('#me-save').addEventListener('click', saveMonsterEdit);
    $('#monster-edit-modal').addEventListener('click', e => { if (e.target === $('#monster-edit-modal')) closeMonsterEdit(); });
  }

  Object.assign(OSR, {
    openMonsterModal, closeMonsterModal, libMatches, renderLibrary, rollLibrary, onLibClick,
    monsterCardHtml, showLibPreview, hideLibPreview,
    openMonsterEdit, closeMonsterEdit, saveMonsterEdit, parseAndAdd, wireMonsterModals
  });
})(window.OSR = window.OSR || {});
