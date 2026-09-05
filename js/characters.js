/* js/characters.js — character CRUD, View/Edit mode rendering, and the
 * View-mode text-selection -> "Add/link to Compendium" context menu.
 */
(function (OSR) {
  'use strict';
  const { $, $$, escapeHtml, uid } = OSR;

  function detectNameSystem(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let name = 'Untitled', system = '';
    if (lines.length) {
      let first = lines[0].replace(/^#+\s*/, '').replace(/^\*+|\*+$/g, '').trim();
      const sysM = first.match(/\[([^\]]+)\]\s*$/);
      if (sysM) { system = sysM[1].trim(); first = first.replace(/\[[^\]]+\]\s*$/, '').trim(); }
      name = first || 'Untitled';
    }
    if (!system) {
      if (/shadowdark/i.test(text)) system = 'Shadowdark';
      else if (/\bWWN\b|worlds without number/i.test(text)) system = 'WWN';
    }
    return { name, system };
  }

  function createCharacter(body, opts) {
    opts = opts || {};
    const state = OSR.state;
    const det = detectNameSystem(body || '');
    const ch = {
      id: uid(),
      name: opts.name || det.name,
      system: opts.system || det.system,
      nameLocked: !!opts.name,
      body: body != null ? body : '# New Character\n\n*System — Level 1*\n\n> **AC** 10 · **HP** 6/6\n\n## Abilities\n\n- STR +0\n- DEX +0\n',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.characters.push(ch);
    OSR.ensureHpTracker(ch);
    state.activeId = ch.id;
    OSR.mode = 'view';
    OSR.save();
    refreshCharUI();
  }

  // Second column character, if one is selected and it isn't the same as A.
  function charB() {
    const state = OSR.state;
    if (!state.activeIdB || state.activeIdB === state.activeId) return null;
    return state.characters.find(c => c.id === state.activeIdB) || null;
  }

  function fillCharOptions(sel, selectedId, opts) {
    opts = opts || {};
    sel.innerHTML = '';
    if (opts.noneLabel != null) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = opts.noneLabel;
      if (!selectedId) o.selected = true;
      sel.appendChild(o);
    }
    OSR.state.characters.forEach(c => {
      if (opts.exclude && c.id === opts.exclude) return;
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name + (c.system ? ' (' + c.system + ')' : '');
      if (c.id === selectedId) o.selected = true;
      sel.appendChild(o);
    });
  }

  function refreshCharUI() {
    const state = OSR.state;
    if (state.characters.length && !OSR.activeChar()) state.activeId = state.characters[0].id;
    if (state.activeIdB && (state.activeIdB === state.activeId ||
        !state.characters.some(c => c.id === state.activeIdB))) {
      state.activeIdB = null;
    }

    fillCharOptions($('#char-select'), state.activeId, {});
    fillCharOptions($('#char-select-b'), state.activeIdB, { noneLabel: '— none —', exclude: state.activeId });
    $('#char-select-b').disabled = state.characters.length < 2;

    const ch = OSR.activeChar();
    const b = charB();
    const has = state.characters.length > 0;
    $('#char-empty').hidden = has;
    $('#char-view').hidden = !ch;
    $('#btn-rename').disabled = !ch;
    $('#btn-delete').disabled = !ch;

    // The single header meta only makes sense for one character; two-character
    // mode labels each column instead.
    const meta = $('#char-meta');
    if (ch && !b) {
      meta.hidden = false;
      $('#view-name').textContent = ch.name;
      const sb = $('#view-system');
      sb.hidden = !ch.system;
      sb.textContent = ch.system || '';
    } else {
      meta.hidden = true;
    }

    if (ch) setMode(OSR.mode);
    OSR.renderNotes();
    OSR.renderConsumables();
  }

  // Split a sheet body at the FIRST standalone `---` line: text before it goes
  // in the left column, text after it in the right. Returns [left, null] when
  // there is no such line.
  function splitBodyColumns(body) {
    const lines = String(body || '').split(/\r?\n/);
    const idx = lines.findIndex(l => /^\s*---\s*$/.test(l));
    if (idx === -1) return [body || '', null];
    return [lines.slice(0, idx).join('\n'), lines.slice(idx + 1).join('\n')];
  }

  function charColHtml(md, head) {
    return '<div class="char-col">' +
      (head || '') +
      '<div class="char-col-body markdown-body">' + marked.parse(md || '') + '</div>' +
      '</div>';
  }

  function charColHead(ch) {
    return '<div class="char-col-head"><span class="char-name">' + escapeHtml(ch.name) + '</span>' +
      (ch.system ? '<span class="badge">' + escapeHtml(ch.system) + '</span>' : '') + '</div>';
  }

  function renderCharView() {
    const host = $('#mode-view');
    const a = OSR.activeChar();
    const b = charB();
    if (!a) { host.innerHTML = ''; host.classList.remove('has-cols'); return; }
    if (b) {
      // Two characters — one per column. Any `---` in a body is a plain rule.
      host.classList.add('has-cols');
      host.innerHTML = '<div class="char-cols">' +
        charColHtml(a.body, charColHead(a)) +
        charColHtml(b.body, charColHead(b)) + '</div>';
      // Annotate per column so each side's $refs resolve (and show values on
      // hover) against its own character's variables, not the other's.
      const cols = $$('.char-cols > .char-col', host);
      OSR.annotate(cols[0], { vars: OSR.charVars(a) });
      OSR.annotate(cols[1], { vars: OSR.charVars(b) });
    } else {
      const parts = splitBodyColumns(a.body);
      const vars = OSR.charVars(a);
      if (parts[1] == null) {
        host.classList.remove('has-cols');
        host.innerHTML = marked.parse(a.body || '');
        OSR.annotate(host, { vars: vars });
      } else {
        host.classList.add('has-cols');
        host.innerHTML = '<div class="char-cols">' +
          charColHtml(parts[0]) + charColHtml(parts[1]) + '</div>';
        $$('.char-cols > .char-col', host).forEach(col => OSR.annotate(col, { vars: vars }));
      }
    }
  }

  // Edit mode mirrors View mode's layout: one textarea per selected character,
  // side by side in two columns when Character B is also selected.
  function renderCharEdit() {
    const host = $('#edit-host');
    const a = OSR.activeChar();
    const b = charB();
    if (!a) { host.innerHTML = ''; host.classList.remove('has-cols'); return; }
    const areaHtml = ch =>
      '<textarea class="edit-col-area" spellcheck="false" data-id="' + ch.id + '">' +
      escapeHtml(ch.body || '') + '</textarea>';
    if (b) {
      host.classList.add('has-cols');
      host.innerHTML = '<div class="char-cols">' +
        '<div class="char-col">' + charColHead(a) + areaHtml(a) + '</div>' +
        '<div class="char-col">' + charColHead(b) + areaHtml(b) + '</div>' +
        '</div>';
    } else {
      host.classList.remove('has-cols');
      host.innerHTML = areaHtml(a);
    }
  }

  function setMode(m) {
    OSR.mode = m;
    const ch = OSR.activeChar();
    $('#btn-mode-view').classList.toggle('is-active', m === 'view');
    $('#btn-mode-edit').classList.toggle('is-active', m === 'edit');
    $('#mode-view').hidden = m !== 'view';
    $('#mode-edit').hidden = m !== 'edit';
    if (!ch) return;
    if (m === 'view') renderCharView();
    else renderCharEdit();
  }

  // Keep the character's "HP (Name)" tracker label in sync when the name changes.
  function renameHpTracker(oldLabel, ch) {
    if (OSR.hpTrackerLabel(ch) === oldLabel) return;
    const hpc = OSR.state.consumables.find(c => c.name === oldLabel);
    if (hpc) hpc.name = OSR.hpTrackerLabel(ch);
    OSR.ensureHpTracker(ch);
  }

  function saveEdit() {
    const areas = $$('#edit-host .edit-col-area');
    if (!areas.length) return;
    areas.forEach(area => {
      const ch = OSR.state.characters.find(c => c.id === area.dataset.id);
      if (!ch) return;
      const oldLabel = OSR.hpTrackerLabel(ch);
      ch.body = area.value;
      ch.updatedAt = Date.now();
      const det = detectNameSystem(ch.body);
      if (!ch.nameLocked) ch.name = det.name;
      if (det.system) ch.system = det.system;
      renameHpTracker(oldLabel, ch);
    });
    OSR.save();
    setMode('view');
    refreshCharUI();
  }

  function renameChar() {
    const ch = OSR.activeChar();
    if (!ch) return;
    const n = prompt('Character name:', ch.name);
    if (n == null) return;
    const oldLabel = OSR.hpTrackerLabel(ch);
    ch.name = n.trim() || ch.name;
    ch.nameLocked = true;
    renameHpTracker(oldLabel, ch);
    OSR.save();
    refreshCharUI();
  }

  function deleteChar() {
    const ch = OSR.activeChar();
    if (!ch) return;
    if (!confirm('Delete "' + ch.name + '"? This cannot be undone.')) return;
    const state = OSR.state;
    const label = OSR.hpTrackerLabel(ch);
    state.characters = state.characters.filter(c => c.id !== ch.id);
    state.consumables = state.consumables.filter(c => c.name !== label);
    if (state.activeIdB === ch.id) state.activeIdB = null;
    state.activeId = state.characters.length ? state.characters[0].id : null;
    OSR.save();
    refreshCharUI();
  }

  /* ---- View-mode selection -> new/existing Compendium entry (rewrites the sheet) ---- */
  // Set by the "Add to Compendium" context-menu item; consumed by saveCompEntry
  // (js/compendium.js) — cross-file, so it lives on OSR rather than as a
  // module-local variable.
  OSR.pendingCompLink = null;  // { charId, part: 0|1|null, find: <selected text> }
  let selMenuData = null;      // { text, tgt } while #sel-menu is open

  // Which character (and, for a split single-char view, which half) owns the
  // node the selection sits in.
  function charViewTarget(node) {
    const a = OSR.activeChar();
    if (!a) return null;
    const el = node && node.nodeType === 1 ? node : (node && node.parentNode);
    const col = el && el.closest ? el.closest('#mode-view .char-cols > .char-col') : null;
    if (charB()) {
      if (!col) return { ch: a, part: null };
      const cols = $$('#mode-view .char-cols > .char-col');
      return { ch: cols[1] === col ? charB() : a, part: null };
    }
    if (col) {
      const cols = $$('#mode-view .char-cols > .char-col');
      return { ch: a, part: cols[1] === col ? 1 : 0 };
    }
    return { ch: a, part: null };
  }

  // Replace the first occurrence of `find` in `text` with `link`. Falls back to
  // a whitespace-tolerant match (a rendered selection can collapse newlines /
  // markdown punctuation). Returns { ok, text }.
  function linkifyInText(text, find, link) {
    const src = String(text || '');
    const i = src.indexOf(find);
    if (i !== -1) return { ok: true, text: src.slice(0, i) + link + src.slice(i + find.length) };
    const toks = find.trim().split(/\s+/).filter(Boolean)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!toks.length) return { ok: false, text: src };
    const m = src.match(new RegExp(toks.join('[\\s\\S]{0,3}?')));
    if (m) return { ok: true, text: src.slice(0, m.index) + link + src.slice(m.index + m[0].length) };
    return { ok: false, text: src };
  }

  function applyPendingCompLink(entryName) {
    const p = OSR.pendingCompLink;
    OSR.pendingCompLink = null;
    if (!p) return;
    const ch = OSR.state.characters.find(c => c.id === p.charId);
    if (!ch) return;
    const link = '[' + entryName + ']';
    let res;
    if (p.part == null) {
      res = linkifyInText(ch.body || '', p.find, link);
      if (res.ok) ch.body = res.text;
    } else {
      const lines = String(ch.body || '').split(/\r?\n/);
      const si = lines.findIndex(l => /^\s*---\s*$/.test(l));
      if (si === -1) {
        res = linkifyInText(ch.body || '', p.find, link);
        if (res.ok) ch.body = res.text;
      } else {
        let left = lines.slice(0, si).join('\n'), right = lines.slice(si + 1).join('\n');
        res = linkifyInText(p.part === 1 ? right : left, p.find, link);
        if (res.ok) {
          if (p.part === 1) right = res.text; else left = res.text;
          ch.body = left + '\n' + lines[si] + '\n' + right;
        }
      }
    }
    if (!res || !res.ok) {
      OSR.pushNote('Compendium', 'created "' + entryName + '" (couldn\'t locate the selected text to link)');
      return;
    }
    ch.updatedAt = Date.now();
    OSR.save();
    refreshCharUI();
  }

  function openSelMenu(x, y, text, tgt) {
    const m = $('#sel-menu');
    const short = text.length > 44 ? text.slice(0, 42) + '…' : text;
    const r = OSR.compResolve(text);
    const matches = r.items;
    let html = '<div class="ctx-head">Add &ldquo;' + escapeHtml(short) + '&rdquo;</div>';
    if (matches.length) {
      html += '<div class="ctx-sub">' + (r.fuzzy ? 'Similar entries' : 'Matching entries') + '</div>' +
        '<div class="ctx-list">' + matches.map((en, i) => {
          const sc = r.scores && r.scores[i];
          const pct = r.fuzzy && typeof sc === 'number'
            ? '<span class="ctx-check">&asymp;' + Math.round((1 - sc) * 100) + '%</span>' : '';
          return '<button class="ctx-item" data-act="link" data-id="' + en.id + '" type="button">' +
            '<i class="fa-solid fa-book"></i><span>' + escapeHtml(en.name) + '</span>' +
            '<span class="badge">' + escapeHtml(en.category) + '</span>' + pct + '</button>';
        }).join('') + '</div>';
    }
    html += '<button class="ctx-item ctx-new" data-act="add-comp" type="button">' +
      '<i class="fa-solid fa-plus"></i><span>' +
      (matches.length ? 'Create new entry&hellip;' : 'Add &ldquo;' + escapeHtml(short) + '&rdquo; to Compendium') +
      '</span></button>';
    m.innerHTML = html;
    m.hidden = false;
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - m.offsetWidth - 8)) + 'px';
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - m.offsetHeight - 8)) + 'px';
    selMenuData = { text: text, tgt: tgt };
  }
  // Link the current selection to an existing Compendium entry (no editor):
  // the selected text is replaced with [entry.name], even when that name
  // differs from what was selected.
  function linkSelToExisting(en) {
    const d = selMenuData;
    if (!d || !en) return;
    OSR.pendingCompLink = { charId: d.tgt.ch.id, part: d.tgt.part, find: d.text };
    OSR.pushNote('Compendium', 'linked "' + d.text + '" to "' + en.name + '" (' + en.category + ' · ' +
      (en.source || OSR.COMPENDIUM_DEFAULT_SOURCE) + ')');
    applyPendingCompLink(en.name);
  }
  function closeSelMenu() { $('#sel-menu').hidden = true; selMenuData = null; }

  function wireCharacters() {
    $('#char-select').addEventListener('change', e => {
      OSR.state.activeId = e.target.value;
      if (OSR.state.activeIdB === OSR.state.activeId) OSR.state.activeIdB = null;
      OSR.mode = 'view';
      OSR.save();
      refreshCharUI();
    });
    $('#char-select-b').addEventListener('change', e => {
      OSR.state.activeIdB = e.target.value || null;
      OSR.mode = 'view';
      OSR.save();
      refreshCharUI();
    });
    $('#btn-new-blank').addEventListener('click', () => createCharacter(null));
    $('#btn-new-paste').addEventListener('click', OSR.pasteFromClipboard);
    $('#btn-new-text').addEventListener('click', () => OSR.openPasteModal(''));
    $('#btn-rename').addEventListener('click', renameChar);
    $('#btn-delete').addEventListener('click', deleteChar);

    // View / edit
    $('#btn-mode-view').addEventListener('click', () => setMode('view'));
    $('#btn-mode-edit').addEventListener('click', () => setMode('edit'));
    $('#btn-save').addEventListener('click', saveEdit);
    $('#btn-cancel').addEventListener('click', () => setMode('view'));

    // In the character editor, typing "[" or "]" while text is selected wraps
    // the selection in brackets instead of replacing it.
    $('#edit-host').addEventListener('keydown', e => {
      if (e.key !== '[' && e.key !== ']') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ta = e.target;
      if (!ta.classList || !ta.classList.contains('edit-col-area')) return;
      const s = ta.selectionStart, en = ta.selectionEnd;
      if (s == null || s === en) return; // nothing selected — insert normally
      e.preventDefault();
      const v = ta.value;
      ta.value = v.slice(0, s) + '[' + v.slice(s, en) + ']' + v.slice(en);
      ta.selectionStart = s + 1;
      ta.selectionEnd = en + 1;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Clickable rolls inside the rendered sheet. In two-character mode a click
    // in the right column is logged under (and rolls $variables from)
    // character B.
    $('#mode-view').addEventListener('click', e => {
      const el = e.target.closest('.roll');
      if (!el) return;
      const tgt = charViewTarget(e.target);
      const ch = tgt && tgt.ch;
      OSR.doRoll(el.dataset.formula, ch ? ch.name : 'Character', OSR.charVars(ch));
    });

    // Right-click a text selection in View mode → "Add … to Compendium".
    // Right-clicking a dice-formula span itself instead opens the roll
    // popup (js/dice-ui.js's document-level contextmenu handler).
    $('#mode-view').addEventListener('contextmenu', e => {
      if (e.target.closest('.roll')) return;
      const sel = window.getSelection();
      const text = sel ? sel.toString().replace(/\s+$/, '').replace(/^\s+/, '') : '';
      if (!text || !sel.anchorNode || !$('#mode-view').contains(sel.anchorNode)) return;
      e.preventDefault();
      const tgt = charViewTarget(sel.anchorNode);
      if (!tgt || !tgt.ch) return;
      openSelMenu(e.clientX, e.clientY, text, tgt);
    });
    $('#sel-menu').addEventListener('click', e => {
      const item = e.target.closest('.ctx-item');
      if (!item || !selMenuData) return;
      const d = selMenuData;
      if (item.dataset.act === 'link') {
        const en = OSR.state.compendium.find(x => x.id === item.dataset.id);
        linkSelToExisting(en);
        closeSelMenu();
        return;
      }
      if (item.dataset.act === 'add-comp') {
        closeSelMenu();
        OSR.pendingCompLink = { charId: d.tgt.ch.id, part: d.tgt.part, find: d.text };
        OSR.openCompEntry(null, { name: d.text.replace(/\s+/g, ' ').trim() });
      }
    });
    document.addEventListener('mousedown', e => {
      if (!$('#sel-menu').hidden && !(e.target instanceof Element && e.target.closest('#sel-menu'))) closeSelMenu();
    });
    document.addEventListener('scroll', closeSelMenu, true);
    window.addEventListener('resize', closeSelMenu);
  }

  Object.assign(OSR, {
    detectNameSystem, createCharacter, charB, fillCharOptions, refreshCharUI,
    splitBodyColumns, charColHtml, charColHead, renderCharView, renderCharEdit,
    setMode, renameHpTracker, saveEdit, renameChar, deleteChar,
    charViewTarget, linkifyInText, applyPendingCompLink,
    openSelMenu, closeSelMenu, linkSelToExisting, wireCharacters,
    get selMenuData() { return selMenuData; }
  });
})(window.OSR = window.OSR || {});
