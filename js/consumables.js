/* js/consumables.js — campaign-global trackers (rations, torches, ammo, …
 * plus each character's linked "HP (Name)" tracker — see core.js).
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, uid } = OSR;

  // A tracker named "<label> (<character name>)" belongs to that character:
  // its "HP (Name)"/"Wounds (Name)"/"Madness (Name)" tracker, a sheet
  // resource's ("PP (Name)", see syncResourceTrackers), or one the user named
  // that way ("Arrows (Name)"). Returns { ch, label } or null; the longest
  // matching character name wins ("HP (Ada Vance)" is Ada Vance's, not Vance's).
  function trackerOwner(c, characters) {
    let best = null;
    (characters || OSR.state.characters).forEach(ch => {
      const tail = ' (' + ch.name + ')';
      const name = c.name || '';
      if (ch.name && name.length > tail.length && name.endsWith(tail) && (!best || ch.name.length > best.ch.name.length)) {
        best = { ch, label: name.slice(0, -tail.length) };
      }
    });
    return best;
  }

  // A character's trackers only make sense while that character's own system
  // (charSystemKey — a ```ua or ```sl fence or a "[BRP]" title tag, not the
  // globally-selected one) matches the active System. Filtered from view
  // only, never deleted — switching System back shows them again exactly as
  // they were, same as the Compendium/Bestiary/Character partitioning.
  // Trackers that don't belong to any character (Rations, Torches, …) always show.
  function consumablesForSystem() {
    const sys = OSR.currentSystem ? OSR.currentSystem() : 'osr';
    return OSR.state.consumables.filter(c => {
      const owner = trackerOwner(c);
      return !owner || (OSR.charSystemKey ? OSR.charSystemKey(owner.ch) : 'osr') === sys;
    });
  }

  function consRowHtml(c, label) {
    return '<div class="cons-row" data-id="' + escapeHtml(c.id) + '" data-name="' + escapeHtml(c.name) + '">' +
        '<input class="cons-name" type="text" placeholder="Name" value="' + escapeHtml(label) + '" />' +
        '<button class="cons-del" type="button" title="Delete">&times;</button>' +
        '<div class="cons-ctl">' +
          '<button class="cons-btn cons-dec" type="button" aria-label="Decrease">&minus;</button>' +
          '<input class="cons-val-input" type="number" step="1" value="' + c.value + '" />' +
          '<span class="cons-sep">/</span>' +
          '<input class="cons-max-input" type="number" step="1" min="0" placeholder="∞ none" title="Max (optional — blank or 0 = no limit)" value="' + (c.max || 0) + '" />' +
          '<button class="cons-btn cons-inc" type="button" aria-label="Increase">+</button>' +
        '</div>' +
      '</div>';
  }

  // Grouped by character, in character order: a heading with the character's
  // name, then its trackers by their short label ("HP", "PP"). Trackers of no
  // character follow under "Shared" (no heading when no character has any).
  function renderConsumables() {
    const list = $('#consumables-list');
    const visible = consumablesForSystem();
    $('#consumables-empty').hidden = visible.length > 0;
    $('#btn-cons-add').disabled = false;
    const groups = new Map(), shared = [];
    visible.forEach(c => {
      const owner = trackerOwner(c);
      if (!owner) { shared.push(c); return; }
      if (!groups.has(owner.ch.id)) groups.set(owner.ch.id, []);
      groups.get(owner.ch.id).push({ c, label: owner.label });
    });
    let h = '';
    OSR.state.characters.filter(ch => groups.has(ch.id)).forEach(ch => {
      h += '<div class="cons-group" data-char-id="' + escapeHtml(ch.id) + '">' +
        '<div class="cons-group-head">' + escapeHtml(ch.name) + '</div>' +
        groups.get(ch.id).map(x => consRowHtml(x.c, x.label)).join('') + '</div>';
    });
    if (shared.length) {
      h += '<div class="cons-group cons-group-shared">' +
        (groups.size ? '<div class="cons-group-head">Shared</div>' : '') +
        shared.map(c => consRowHtml(c, c.name)).join('') + '</div>';
    }
    list.innerHTML = h;
  }

  function consFor(el) {
    const row = el.closest('.cons-row');
    if (!row) return {};
    return { row, c: OSR.state.consumables.find(x => x.id === row.dataset.id) };
  }

  function bump(el, delta) {
    const { c, row } = consFor(el);
    if (!c) return;
    c.value += delta;
    OSR.clampConsumable(c);
    row.querySelector('.cons-val-input').value = c.value;
    OSR.save();
  }

  function wireConsumables() {
    $('#btn-cons-add').addEventListener('click', () => {
      OSR.state.consumables.push({ id: uid(), name: '', value: 0, max: 0 });
      OSR.save();
      renderConsumables();
      const rows = $('#consumables-list').querySelectorAll('.cons-name');
      if (rows.length) rows[rows.length - 1].focus();
    });

    const list = $('#consumables-list');
    list.addEventListener('click', e => {
      if (e.target.closest('.cons-inc')) bump(e.target, +1);
      else if (e.target.closest('.cons-dec')) bump(e.target, -1);
      else if (e.target.closest('.cons-del')) {
        const { c } = consFor(e.target);
        if (!c) return;
        if (OSR.state.consumables.length === 1 || confirm('Delete "' + (c.name || 'this tracker') + '"?')) {
          OSR.state.consumables = OSR.state.consumables.filter(x => x.id !== c.id);
          OSR.save();
          renderConsumables();
        }
      }
    });
    list.addEventListener('input', e => {
      const { c } = consFor(e.target);
      if (!c) return;
      if (e.target.classList.contains('cons-name')) {
        // A character's tracker keeps its "(Name)" suffix, so it stays in the group.
        const group = e.target.closest('.cons-group[data-char-id]');
        const ch = group && OSR.state.characters.find(x => x.id === group.dataset.charId);
        c.name = ch ? e.target.value + ' (' + ch.name + ')' : e.target.value;
      }
      else if (e.target.classList.contains('cons-val-input')) c.value = e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0;
      else if (e.target.classList.contains('cons-max-input')) c.max = e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0;
      OSR.save();
    });
    list.addEventListener('change', e => {
      if (e.target.classList.contains('cons-val-input') || e.target.classList.contains('cons-max-input')) {
        const { c } = consFor(e.target);
        if (!c) return;
        OSR.clampConsumable(c);
        OSR.save();
        renderConsumables();
      }
    });
  }

  Object.assign(OSR, { trackerOwner, consumablesForSystem, renderConsumables, wireConsumables });
})(window.OSR = window.OSR || {});
