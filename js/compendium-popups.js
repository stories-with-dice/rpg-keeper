/* js/compendium-popups.js — hover popups on [bracketed] Compendium
 * references (stackable, pinnable, draggable-when-pinned) and the "["
 * (Compendium) / "$" (variable) autocomplete used across editing surfaces.
 */
(function (OSR) {
  'use strict';
  const { $, $$, escapeHtml } = OSR;

  /* ---- hover popups on [bracketed] references (stackable, pinnable) ---- */
  // Each popup is its own DOM node so links inside one can spawn another and
  // the whole chain stays open. A pinned popup ignores mouse-leave.
  let compPops = [];         // [{ el, name, matches, idx, pinned, parentEl, anchor, hideT }]
  let compPopActive = null;  // popup the mouse is over — target for ↑/↓ match nav

  function popByName(name) { return compPops.find(p => p.name === name) || null; }
  function popByEl(el) { return compPops.find(p => p.el === el) || null; }

  function popHeadHtml(pop, title, badges) {
    const nav = pop.matches.length > 1
      ? '<span class="cpop-nav"><button class="cpop-navbtn" data-nav="-1" title="Previous match">‹</button>' +
        '<span>' + (pop.idx + 1) + ' / ' + pop.matches.length + '</span>' +
        '<button class="cpop-navbtn" data-nav="1" title="Next match">›</button></span>'
      : '';
    return '<div class="cpop-head"><b>' + title + '</b>' + (badges || '') + nav +
      '<span class="cpop-tools">' +
        '<button class="cpop-icon" data-act="pin" title="Pin open" aria-pressed="' + (pop.pinned ? 'true' : 'false') + '">' +
          '<i class="fa-solid fa-thumbtack"></i></button>' +
        '<button class="cpop-icon" data-act="close" title="Close">×</button>' +
      '</span></div>';
  }
  function compPopBodyHtml(pop) {
    if (!pop.matches.length) {
      return popHeadHtml(pop, escapeHtml(pop.name)) +
        '<p class="cpop-none">No Compendium entry found for this item.</p>' +
        '<div class="cpop-actions"><button class="btn btn-primary" data-act="create">Create entry</button></div>';
    }
    const en = pop.matches[pop.idx];
    let fuzz = '';
    if (pop.fuzzy) {
      const sc = pop.scores && pop.scores[pop.idx];
      fuzz = '<div class="cpop-fuzzy">&asymp; no exact match &mdash; showing a fuzzy match' +
        (typeof sc === 'number' ? ' <b>' + Math.round((1 - sc) * 100) + '%</b>' : '') + '</div>';
    }
    return popHeadHtml(pop, escapeHtml(en.name),
        '<span class="badge">' + escapeHtml(en.category) + '</span>' +
        '<span class="badge comp-src-badge">' + escapeHtml(en.source || OSR.COMPENDIUM_DEFAULT_SOURCE) + '</span>') +
      fuzz +
      '<div class="cpop-body markdown-body">' + marked.parse(en.body || '*(no description yet)*') + '</div>' +
      '<div class="cpop-actions"><button class="btn" data-act="edit">Edit</button>' +
      (pop.fuzzy ? '<button class="btn" data-act="create" title="Create &ldquo;' + escapeHtml(pop.name) + '&rdquo;">New</button>' : '') +
      '</div>';
  }
  // Render + annotate: dice formulas roll, nested [refs] hover-link.
  function renderPop(pop) {
    pop.el.innerHTML = compPopBodyHtml(pop);
    pop.el.classList.toggle('is-pinned', !!pop.pinned);
    const body = pop.el.querySelector('.cpop-body');
    if (body) OSR.annotate(body, { vars: OSR.charVars(OSR.activeChar()) });
  }
  function positionPop(pop, anchor) {
    const el = pop.el;
    el.style.left = '0px'; el.style.top = '0px';
    const r = anchor.getBoundingClientRect();
    const pw = el.offsetWidth, ph = el.offsetHeight;
    let left = r.left + (pop.parentEl ? 14 : 0);
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 8);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
  function openCompPop(name, anchor) {
    const parentEl = anchor.closest ? anchor.closest('.comp-pop') : null;
    cancelHideAllPops();
    let pop = popByName(name);
    if (pop) { pop.anchor = anchor; return pop; }
    const el = document.createElement('div');
    el.className = 'comp-pop';
    document.body.appendChild(el);
    const r = OSR.compResolve(name);
    pop = { el: el, name: name, matches: r.items, fuzzy: r.fuzzy, scores: r.scores,
      idx: 0, pinned: false, parentEl: parentEl, anchor: anchor, hideT: null };
    compPops.push(pop);
    renderPop(pop);
    positionPop(pop, anchor);
    return pop;
  }
  function closePop(pop, cascade) {
    if (!pop) return;
    clearTimeout(pop.hideT);
    if (pop.el && pop.el.parentNode) pop.el.parentNode.removeChild(pop.el);
    compPops = compPops.filter(p => p !== pop);
    if (compPopActive === pop) compPopActive = null;
    if (cascade) {
      compPops.slice().forEach(c => {
        if (c.parentEl === pop.el) { if (c.pinned) c.parentEl = null; else closePop(c, true); }
      });
    }
  }
  function scheduleHidePop(pop) {
    if (!pop || pop.pinned) return;
    clearTimeout(pop.hideT);
    pop.hideT = setTimeout(() => closePop(pop, true), 180);
  }
  // The whole open chain lives or dies together: any hover in it keeps all of
  // it alive; leaving it (to somewhere that isn't a popup or a ref) fades the
  // unpinned ones after a short grace.
  function cancelHideAllPops() { compPops.forEach(p => clearTimeout(p.hideT)); }
  function scheduleHideAllPops() { compPops.forEach(scheduleHidePop); }
  function closeAllCompPops() {
    compPops.slice().forEach(p => { clearTimeout(p.hideT); if (p.el.parentNode) p.el.parentNode.removeChild(p.el); });
    compPops = [];
    compPopActive = null;
  }
  function closeUnpinnedCompPops() {
    compPops.slice().forEach(p => { if (!p.pinned) closePop(p, false); });
  }
  // Kept under the old names used elsewhere (Escape handler, Settings, edits).
  function hideCompPopNow() { closeAllCompPops(); }
  function refreshCompPop() {
    compPops.slice().forEach(pop => {
      const r = OSR.compResolve(pop.name);
      pop.matches = r.items; pop.fuzzy = r.fuzzy; pop.scores = r.scores;
      if (pop.idx >= pop.matches.length) pop.idx = 0;
      renderPop(pop);
    });
  }

  /* ---- "[" / "$" autocomplete across editing surfaces ---- */
  // "[" (compAC.mode 'comp') fires in the character-sheet editor, the
  // campaign Notes editor, and the Compendium entry's EasyMDE editor once
  // ≥2 chars are typed. "$" (compAC.mode 'var') fires in the same sheet
  // editor plus the Dice Roller's custom-formula box, immediately (0 chars
  // needed) — see acFromTextarea / acFromFormulaInput.
  // Cross-file (js/characters.js, js/dice-ui.js, js/mde.js all read it), so
  // it lives on OSR rather than as a module-local variable.
  OSR.compAC = null; // { kind:'ta'|'cm', mode:'comp'|'var', ta, cm, qStart, items, sel }

  function acSearch(q) {
    const t = String(q || '').trim().toLowerCase();
    if (t.length < 2) return [];
    const starts = [], has = [];
    OSR.compendiumForSystem().forEach(e => {
      const i = (e.name || '').toLowerCase().indexOf(t);
      if (i === 0) starts.push(e); else if (i > 0) has.push(e);
    });
    const byName = (a, b) => a.name.localeCompare(b.name);
    return starts.sort(byName).concat(has.sort(byName)).slice(0, 8);
  }
  function acSearchVars(q, vars) {
    const t = OSR.normVarKey(q);
    const starts = [], has = [];
    (vars || []).forEach(v => {
      const i = OSR.normVarKey(v.name).indexOf(t);
      if (i === 0) starts.push(v); else if (i > 0) has.push(v);
    });
    const byName = (a, b) => a.name.localeCompare(b.name);
    return starts.sort(byName).concat(has.sort(byName)).slice(0, 8);
  }
  function acRender() {
    const el = $('#comp-ac');
    if (!OSR.compAC) return;
    if (!OSR.compAC.items.length) { el.innerHTML = '<div class="ac-none">no matches</div>'; return; }
    el.innerHTML = '<ul class="ac-list">' + OSR.compAC.items.map((e, i) => {
      const badge = OSR.compAC.mode === 'var'
        ? '<span class="badge">' + (e.value >= 0 ? '+' : '') + e.value + '</span>'
        : '<span class="badge">' + escapeHtml(e.category) + '</span>';
      return '<li class="ac-item' + (i === OSR.compAC.sel ? ' is-sel' : '') + '" data-i="' + i + '">' +
        '<span class="ac-name">' + escapeHtml(e.name) + '</span>' + badge + '</li>';
    }).join('') + '</ul>';
  }
  function acPlace(x, y, bottom) {
    const el = $('#comp-ac');
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = x; if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8; if (left < 8) left = 8;
    let top = bottom + 4; if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - 4);
    el.style.left = left + 'px'; el.style.top = top + 'px';
  }
  function closeAC() { if (!OSR.compAC) return; OSR.compAC = null; $('#comp-ac').hidden = true; }
  function acMove(d) {
    if (!OSR.compAC || !OSR.compAC.items.length) return;
    const n = OSR.compAC.items.length;
    OSR.compAC.sel = (OSR.compAC.sel + d + n) % n;
    acRender();
    const s = $('#comp-ac .ac-item.is-sel');
    if (s) s.scrollIntoView({ block: 'nearest' });
  }
  function acAccept(item) {
    if (!OSR.compAC || !item) return;
    // $ references can't contain spaces (VAR_TOKEN_RE), so a multi-word
    // variable name has them stripped — case is kept as detected.
    const insert = OSR.compAC.mode === 'var' ? item.name.replace(/\s+/g, '') : item.name + ']';
    if (OSR.compAC.kind === 'cm') {
      // CodeMirror records replaceRange in its own undo history (Ctrl-Z works).
      OSR.compAC.cm.replaceRange(insert, OSR.compAC.qStart, OSR.compAC.cm.getCursor());
      OSR.compAC.cm.focus();
    } else {
      const ta = OSR.compAC.ta, caret = ta.selectionStart;
      ta.focus();
      // Replace via execCommand so it lands on the native undo stack — assigning
      // ta.value directly would wipe it and make Ctrl-Z a no-op.
      ta.setSelectionRange(OSR.compAC.qStart, caret);
      let ok = false;
      try { ok = document.execCommand('insertText', false, insert); } catch (e) { ok = false; }
      if (!ok) {
        const v = ta.value, c = OSR.compAC.qStart + insert.length;
        ta.value = v.slice(0, OSR.compAC.qStart) + insert + v.slice(caret);
        ta.setSelectionRange(c, c);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    closeAC();
  }
  function textareaCaretXY(ta, index) {
    const div = document.createElement('div');
    const cs = getComputedStyle(ta);
    ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
     'textTransform', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
     'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'tabSize']
      .forEach(p => { div.style[p] = cs[p]; });
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.overflowWrap = 'break-word';
    div.style.width = ta.clientWidth + 'px';
    div.textContent = ta.value.slice(0, index);
    const span = document.createElement('span');
    span.textContent = ta.value.slice(index) || '.';
    div.appendChild(span);
    document.body.appendChild(div);
    const r = ta.getBoundingClientRect();
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const xy = { left: r.left + span.offsetLeft - ta.scrollLeft, top: r.top + span.offsetTop - ta.scrollTop };
    div.remove();
    return { left: xy.left, top: xy.top, bottom: xy.top + lh };
  }
  // Which character's $variables apply to a given editor surface: the sheet
  // editor's textarea/CodeMirror carries the owning character's id in
  // data-id (renderCharEdit — one per column); anything else (the Dice
  // Roller box) falls back to the primary "Character" (A) slot.
  function varsForEditorEl(el) {
    const id = el && el.dataset && el.dataset.id;
    const ch = id ? OSR.state.characters.find(c => c.id === id) : OSR.activeChar();
    return OSR.charVars(ch);
  }
  function openVarAC(kind, el, cm, qStart, q, vars) {
    const items = acSearchVars(q, vars);
    OSR.compAC = { kind: kind, mode: 'var', ta: kind === 'ta' ? el : null, cm: kind === 'cm' ? cm : null, qStart: qStart, items: items, sel: items.length ? 0 : -1 };
    acRender();
    if (kind === 'cm') {
      const c = cm.cursorCoords(true, 'window');
      acPlace(c.left, c.top, c.bottom);
    } else {
      const c = textareaCaretXY(el, el.selectionStart);
      acPlace(c.left, c.top, c.bottom);
    }
  }
  function acFromTextarea(ta) {
    if (!ta || ta.selectionStart !== ta.selectionEnd) return closeAC();
    const pos = ta.selectionStart, v = ta.value;
    const mVar = v.slice(0, pos).match(/\$([A-Za-z0-9]*)$/);
    if (mVar) return openVarAC('ta', ta, null, pos - mVar[1].length, mVar[1], varsForEditorEl(ta));
    let i = pos - 1, guard = 0;
    while (i >= 0 && guard++ < 80) {
      const ch = v[i];
      if (ch === '[') break;
      if (ch === ']' || ch === '\n') { i = -1; break; }
      i--;
    }
    if (i < 0 || v[i] !== '[') return closeAC();
    const qStart = i + 1, q = v.slice(qStart, pos);
    if (q.length < 2 || /[[\]\n]/.test(q)) return closeAC();
    const items = acSearch(q);
    OSR.compAC = { kind: 'ta', mode: 'comp', ta: ta, cm: null, qStart: qStart, items: items, sel: items.length ? 0 : -1 };
    acRender();
    const c = textareaCaretXY(ta, pos);
    acPlace(c.left, c.top, c.bottom);
  }
  // The Dice Roller's plain-text custom-formula input: only the "$" trigger
  // is meaningful there (no "[" compendium references in a dice formula).
  function acFromFormulaInput(inp) {
    if (!inp || inp.selectionStart !== inp.selectionEnd) return closeAC();
    const pos = inp.selectionStart, v = inp.value;
    const mVar = v.slice(0, pos).match(/\$([A-Za-z0-9]*)$/);
    if (!mVar) return closeAC();
    openVarAC('ta', inp, null, pos - mVar[1].length, mVar[1], OSR.charVars(OSR.activeChar()));
  }
  // Notes and the Compendium body use CodeMirror (via buildMDE); only "["
  // applies there — $variables are scoped to the sheet editor + Dice Roller
  // (see acFromTextarea / acFromFormulaInput), and the sheet editor is
  // always a plain <textarea>, never CodeMirror.
  function acFromCM(cm) {
    if (!cm || cm.somethingSelected()) return closeAC();
    const cur = cm.getCursor();
    const m = cm.getLine(cur.line).slice(0, cur.ch).match(/\[([^[\]]*)$/);
    if (!m || m[1].length < 2) return closeAC();
    const q = m[1], items = acSearch(q);
    OSR.compAC = { kind: 'cm', mode: 'comp', ta: null, cm: cm, qStart: { line: cur.line, ch: cur.ch - q.length }, items: items, sel: items.length ? 0 : -1 };
    acRender();
    const c = cm.cursorCoords(true, 'window');
    acPlace(c.left, c.top, c.bottom);
  }

  // Drag-a-pinned-popup state, used only by wireCompendiumPopups()'s own
  // mousedown/mousemove/mouseup wiring below.
  let dragPop = null, dragDX = 0, dragDY = 0;

  function wireCompendiumPopups() {
    // --- stackable hover popups: refs live in the sheet or inside popup bodies
    const intoSafe = to => to && to.closest && (to.closest('.comp-pop') || to.closest('.comp-ref'));
    document.addEventListener('mouseover', e => {
      const t = e.target;
      const ref = t.closest && t.closest('.comp-ref');
      if (ref) { openCompPop(ref.dataset.name, ref); return; }
      const popEl = t.closest && t.closest('.comp-pop');
      if (popEl) { compPopActive = popByEl(popEl); cancelHideAllPops(); }
    });
    document.addEventListener('mouseout', e => {
      if (dragPop) return;
      const t = e.target;
      if (!(t.closest && (t.closest('.comp-ref') || t.closest('.comp-pop')))) return;
      if (intoSafe(e.relatedTarget)) return;
      compPopActive = null;
      scheduleHideAllPops();
    });
    document.addEventListener('click', e => {
      const popEl = e.target.closest && e.target.closest('.comp-pop');
      if (!popEl) return;
      const pop = popByEl(popEl);
      if (!pop) return;
      const roll = e.target.closest('.roll');
      if (roll) {
        cancelHideAllPops();
        const en = pop.matches[pop.idx];
        OSR.doRoll(roll.dataset.formula, en ? en.name : (pop.name || 'Compendium'));
        return;
      }
      const navb = e.target.closest('[data-nav]');
      if (navb && pop.matches.length > 1) {
        const n = pop.matches.length;
        pop.idx = (pop.idx + (Number(navb.dataset.nav) || 1) + n) % n;
        renderPop(pop);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'pin') {
        pop.pinned = !pop.pinned;
        pop.el.classList.toggle('is-pinned', pop.pinned);
        act.setAttribute('aria-pressed', pop.pinned ? 'true' : 'false');
        if (pop.pinned) clearTimeout(pop.hideT); else scheduleHidePop(pop);
      } else if (act.dataset.act === 'close') {
        closePop(pop, true);
      } else if (act.dataset.act === 'edit' && pop.matches[pop.idx]) {
        OSR.openCompEntry(pop.matches[pop.idx].id);
        closePop(pop, false);
      } else if (act.dataset.act === 'create') {
        OSR.openCompEntry(null, { name: pop.name });
        closePop(pop, false);
      }
    });
    document.addEventListener('mousedown', e => {
      if (compPops.length && !(e.target.closest && (e.target.closest('.comp-pop') || e.target.closest('.comp-ref') || e.target.closest('#comp-ac')))) {
        closeUnpinnedCompPops();
      }
    });
    // A scroll dismisses popups / autocomplete — but only when it's the page or
    // a panel scrolling, NOT the widget's own body or CodeMirror auto-scrolling
    // as you type (that was closing the "[" search the instant it opened).
    document.addEventListener('scroll', e => {
      const t = e.target, c = t && t.closest ? sel => t.closest(sel) : () => null;
      if (compPops.length && !c('.comp-pop')) closeUnpinnedCompPops();
      if (OSR.compAC && !c('#comp-ac') && !c('.CodeMirror')) closeAC();
    }, true);
    document.addEventListener('keydown', e => {
      if (OSR.compAC || !compPopActive || compPopActive.matches.length < 2) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const n = compPopActive.matches.length;
      compPopActive.idx = (compPopActive.idx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderPop(compPopActive);
    });

    // Drag a pinned popup by its header.
    document.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const head = e.target.closest && e.target.closest('.cpop-head');
      if (!head || e.target.closest('button')) return;
      const pop = popByEl(head.closest('.comp-pop'));
      if (!pop || !pop.pinned) return;
      e.preventDefault();
      cancelHideAllPops();
      dragPop = pop;
      const r = pop.el.getBoundingClientRect();
      dragDX = e.clientX - r.left;
      dragDY = e.clientY - r.top;
      pop.el.classList.add('is-dragging');
    });
    document.addEventListener('mousemove', e => {
      if (!dragPop) return;
      const el = dragPop.el, w = el.offsetWidth, h = el.offsetHeight;
      const left = Math.max(4, Math.min(e.clientX - dragDX, window.innerWidth - w - 4));
      const top = Math.max(4, Math.min(e.clientY - dragDY, window.innerHeight - h - 4));
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragPop) return;
      dragPop.el.classList.remove('is-dragging');
      dragPop = null;
    });

    // --- "[" / "$" autocomplete wiring
    $('#edit-host').addEventListener('input', e => {
      if (e.target.classList && e.target.classList.contains('edit-col-area')) acFromTextarea(e.target);
    });
    $('#edit-host').addEventListener('keyup', e => {
      if (!(e.target.classList && e.target.classList.contains('edit-col-area'))) return;
      // ↑/↓ navigate the open autocomplete (keydown handled it) — don't re-run
      // the search, which would reset the selection to the first row.
      if (OSR.compAC && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
      if (/^(Arrow|Home|End)/.test(e.key)) acFromTextarea(e.target);
    });
    $('#edit-host').addEventListener('blur', () => setTimeout(() => { if (OSR.compAC && OSR.compAC.kind === 'ta') closeAC(); }, 120), true);
    // (Notes is an EasyMDE editor now — its "[" autocomplete is wired in buildMDE.)
    $('#comp-ac').addEventListener('mousedown', e => {
      const li = e.target.closest('.ac-item');
      if (li && OSR.compAC) { e.preventDefault(); acAccept(OSR.compAC.items[Number(li.dataset.i)]); }
    });
    document.addEventListener('keydown', e => {
      if (!OSR.compAC) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); acMove(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); acMove(-1); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && OSR.compAC.sel >= 0) { e.preventDefault(); e.stopPropagation(); acAccept(OSR.compAC.items[OSR.compAC.sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAC(); }
    }, true);
    document.addEventListener('mousedown', e => {
      if (!OSR.compAC) return;
      const inEditor = e.target.closest && (e.target.closest('#comp-ac') || e.target === OSR.compAC.ta ||
        (OSR.compAC.cm && OSR.compAC.cm.getWrapperElement().contains(e.target)));
      if (!inEditor) closeAC();
    });
  }

  Object.assign(OSR, {
    openCompPop, closePop, scheduleHidePop, cancelHideAllPops, scheduleHideAllPops,
    closeAllCompPops, closeUnpinnedCompPops, hideCompPopNow, refreshCompPop,
    acSearch, acSearchVars, closeAC, acFromTextarea, acFromFormulaInput, acFromCM,
    wireCompendiumPopups
  });
})(window.OSR = window.OSR || {});
