/* js/dice-ui.js — the right-rail Dice Roller (preset grid + custom-formula
 * box) and the right-click "roll with modifiers" popup opened from any
 * .roll span or a preset button.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml } = OSR;

  const DICE_PRESETS = [
    { label: 'd20',    f: '1d20' },
    { label: 'Adv',    f: '2d20kh1' },
    { label: 'Dis',    f: '2d20kl1' },
    { label: 'd4',     f: '1d4' },
    { label: 'd6',     f: '1d6' },
    { label: 'd8',     f: '1d8' },
    { label: 'd10',    f: '1d10' },
    { label: 'd12',    f: '1d12' },
    { label: 'd100',   f: '1d100' },
    { label: '2d6',    f: '2d6' },
    { label: '3d6',    f: '3d6' },
    { label: '4d6kh3', f: '4d6kh3' }
  ];

  function buildDiceGrid() {
    const grid = $('#dice-grid');
    grid.innerHTML = '';
    DICE_PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = p.label;
      b.title = 'Roll ' + p.f;
      b.dataset.formula = p.f; // also read by the right-click "roll with modifiers" popup
      b.addEventListener('click', () => OSR.doRoll(p.f, 'Dice Roller'));
      grid.appendChild(b);
    });
  }

  /* ---- right-click "roll with modifiers" popup ---- */
  // Opened by right-clicking any .roll span (sheet, combat detail, Compendium
  // popups) or a Dice Roller preset button. Lets you add a flat modifier and
  // stack any number of the owning character's detected variables before
  // rolling — none selected by default.
  let rollPop = null; // { formula, source, vars: [{name,value}], picks: [name|null,...] }

  function rollPopupFormula() {
    if (!rollPop) return '';
    let f = rollPop.formula;
    const mod = parseInt($('#rp-mod').value, 10);
    if (!isNaN(mod) && mod !== 0) f += (mod >= 0 ? '+' : '') + mod;
    rollPop.picks.forEach(name => {
      if (!name) return;
      const v = rollPop.vars.find(x => x.name === name);
      if (v) f += (v.value >= 0 ? '+' : '') + v.value;
    });
    return f;
  }
  function renderRollPopup() {
    if (!rollPop) return;
    $('#rp-formula').textContent = rollPop.formula;
    const used = new Set(rollPop.picks.filter(Boolean));
    const rows = rollPop.picks.slice();
    if (rows.length === rows.filter(Boolean).length && used.size < rollPop.vars.length) rows.push(null);
    $('#rp-vars').innerHTML = rows.map((picked, i) => {
      const opts = ['<option value="">— none —</option>'].concat(
        rollPop.vars.filter(v => v.name === picked || !used.has(v.name)).map(v =>
          '<option value="' + escapeHtml(v.name) + '"' + (picked === v.name ? ' selected' : '') + '>' +
          escapeHtml(v.name) + ' (' + (v.value >= 0 ? '+' : '') + v.value + ')</option>')
      );
      return '<div class="rp-var-row"><select class="rp-var-select" data-i="' + i + '">' + opts.join('') + '</select>' +
        (picked ? '<button class="btn rp-var-del" data-i="' + i + '" title="Remove">&times;</button>' : '') + '</div>';
    }).join('');
    $('#rp-preview').textContent = 'Rolling: ' + rollPopupFormula();
  }
  function openRollPopup(x, y, formula, vars, source) {
    if (!formula) return;
    rollPop = { formula: formula, source: source || 'Roll', vars: vars || [], picks: [] };
    const el = $('#roll-popup');
    $('#rp-mod').value = '';
    renderRollPopup();
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 8)) + 'px';
    el.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 8)) + 'px';
    setTimeout(() => { const m = $('#rp-mod'); if (m) m.focus(); }, 0);
  }
  function closeRollPopup() { $('#roll-popup').hidden = true; rollPop = null; }

  // Resolve which character "owns" a right-clicked .roll span (for its
  // detected variables) and what to log the roll under.
  function rollOwnerFor(el) {
    if (el.closest('#mode-view')) {
      const tgt = OSR.charViewTarget(el);
      const ch = tgt && tgt.ch;
      return { vars: OSR.charVars(ch), source: ch ? ch.name : 'Character' };
    }
    if (el.closest('#combatant-detail')) {
      const ent = OSR.selectedEntry();
      return { vars: OSR.charVars(ent ? OSR.combatCharFor(ent) : null), source: ent ? ent.name : 'Combat' };
    }
    return { vars: OSR.charVars(OSR.activeChar()), source: el.closest('.comp-pop') ? 'Compendium' : 'Dice Roller' };
  }

  function wireRollPopup() {
    document.addEventListener('contextmenu', e => {
      const el = e.target.closest('.roll');
      if (el) {
        e.preventDefault();
        const owner = rollOwnerFor(el);
        openRollPopup(e.clientX, e.clientY, el.dataset.formula, owner.vars, owner.source);
        return;
      }
      const btn = e.target.closest('#dice-grid button[data-formula]');
      if (btn) {
        e.preventDefault();
        openRollPopup(e.clientX, e.clientY, btn.dataset.formula, OSR.charVars(OSR.activeChar()), 'Dice Roller');
      }
    });
    $('#rp-mod').addEventListener('input', renderRollPopup);
    $('#rp-vars').addEventListener('change', e => {
      const sel = e.target.closest('.rp-var-select');
      if (!sel || !rollPop) return;
      const i = +sel.dataset.i;
      rollPop.picks[i] = sel.value || null;
      while (rollPop.picks.length && rollPop.picks[rollPop.picks.length - 1] == null) rollPop.picks.pop();
      renderRollPopup();
    });
    $('#rp-vars').addEventListener('click', e => {
      const del = e.target.closest('.rp-var-del');
      if (!del || !rollPop) return;
      rollPop.picks.splice(+del.dataset.i, 1);
      renderRollPopup();
    });
    $('#rp-roll').addEventListener('click', () => {
      if (!rollPop) return;
      const formula = rollPopupFormula(), source = rollPop.source, vars = rollPop.vars;
      closeRollPopup();
      OSR.doRoll(formula, source, vars);
    });
    $('#rp-cancel').addEventListener('click', closeRollPopup);
    document.addEventListener('mousedown', e => {
      if (!$('#roll-popup').hidden && !(e.target instanceof Element && e.target.closest('#roll-popup'))) closeRollPopup();
    });
    document.addEventListener('scroll', closeRollPopup, true);
    window.addEventListener('resize', closeRollPopup);
  }

  /* ---- wiring for the preset grid + custom formula box ---- */
  function wireDicePanel() {
    $('#dice-custom').addEventListener('submit', e => {
      e.preventDefault();
      if (OSR.compAC) return; // Enter/Tab is accepting a $variable suggestion, not submitting
      const v = $('#custom-formula').value.trim();
      if (v) OSR.doRoll(v, 'Dice Roller', OSR.charVars(OSR.activeChar()));
    });
    // "$" autocomplete in the custom formula box
    $('#custom-formula').addEventListener('input', e => OSR.acFromFormulaInput(e.target));
    $('#custom-formula').addEventListener('keyup', e => {
      if (OSR.compAC && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
      if (/^(Arrow|Home|End)/.test(e.key)) OSR.acFromFormulaInput(e.target);
    });
    $('#custom-formula').addEventListener('blur', () => setTimeout(() => {
      if (OSR.compAC && OSR.compAC.ta === $('#custom-formula')) OSR.closeAC();
    }, 120));
  }

  Object.assign(OSR, {
    DICE_PRESETS, buildDiceGrid, openRollPopup, closeRollPopup, wireRollPopup, wireDicePanel,
    get rollPop() { return rollPop; }
  });
})(window.OSR = window.OSR || {});
