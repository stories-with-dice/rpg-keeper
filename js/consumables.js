/* js/consumables.js — campaign-global trackers (rations, torches, ammo, …
 * plus each character's linked "HP (Name)" tracker — see core.js).
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, uid } = OSR;

  function renderConsumables() {
    const state = OSR.state;
    const list = $('#consumables-list');
    $('#consumables-empty').hidden = state.consumables.length > 0;
    $('#btn-cons-add').disabled = false;
    list.innerHTML = '';

    state.consumables.forEach(c => {
      const row = document.createElement('div');
      row.className = 'cons-row';
      row.dataset.id = c.id;
      row.innerHTML =
        '<input class="cons-name" type="text" placeholder="Name" value="' + escapeHtml(c.name) + '" />' +
        '<button class="cons-del" type="button" title="Delete">&times;</button>' +
        '<div class="cons-ctl">' +
          '<button class="cons-btn cons-dec" type="button" aria-label="Decrease">&minus;</button>' +
          '<input class="cons-val-input" type="number" step="1" value="' + c.value + '" />' +
          '<span class="cons-sep">/</span>' +
          '<input class="cons-max-input" type="number" step="1" min="0" placeholder="∞ none" title="Max (optional — blank or 0 = no limit)" value="' + (c.max || 0) + '" />' +
          '<button class="cons-btn cons-inc" type="button" aria-label="Increase">+</button>' +
        '</div>';
      list.appendChild(row);
    });
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
      if (e.target.classList.contains('cons-name')) c.name = e.target.value;
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

  Object.assign(OSR, { renderConsumables, wireConsumables });
})(window.OSR = window.OSR || {});
