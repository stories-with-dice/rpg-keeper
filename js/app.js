/* OSR Character & Combat Manager
 * Vanilla JS. Persists to localStorage. Markdown via marked (js/marked.min.js).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'osr_manager_v1';
  const MAX_LOG = 500;
  const MAX_DICE = 500;

  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ------------------------------------------------------------------ */
  /* State                                                              */
  /* ------------------------------------------------------------------ */
  let state = { version: 1, activeId: null, characters: [], log: [] };
  let mode = 'view'; // 'view' | 'edit'

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          state = Object.assign({ version: 1, activeId: null, characters: [], log: [] }, parsed);
        }
        state.characters.forEach(ensureCharShape);
        return true;
      }
    } catch (e) { console.warn('load failed', e); }
    return false;
  }

  // Backfill fields added in later versions so older saves keep working.
  function ensureCharShape(ch) {
    if (!Array.isArray(ch.consumables)) {
      ch.consumables = [{ id: uid(), name: 'HP', value: 0, max: 0 }];
    }
    ch.consumables.forEach(c => {
      if (!c.id) c.id = uid();
      c.name = c.name == null ? '' : String(c.name);
      c.value = Number(c.value) || 0;
      c.max = Number(c.max) || 0;
    });
    if (typeof ch.notes !== 'string') ch.notes = '';
    return ch;
  }

  function clampConsumable(c) {
    let v = Math.round(Number(c.value) || 0);
    if (v < 0) v = 0;
    const m = Math.round(Number(c.max) || 0);
    if (m > 0 && v > m) v = m;
    c.value = v;
    c.max = m < 0 ? 0 : m;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn('save failed', e); }
  }

  function activeChar() {
    return state.characters.find(c => c.id === state.activeId) || null;
  }

  /* ------------------------------------------------------------------ */
  /* Dice engine                                                        */
  /* ------------------------------------------------------------------ */
  function rollDie(sides) { return 1 + Math.floor(Math.random() * sides); }

  // Roll one term: "2d10", "d20", "4d6kh3", "d%", or a plain integer.
  function rollTerm(token) {
    token = token.trim().toLowerCase();
    const dm = token.match(/^(\d*)d(\d+|%)((?:kh|kl|dh|dl)\d+)?$/);
    if (dm) {
      const count = Math.max(1, Math.min(parseInt(dm[1] || '1', 10), MAX_DICE));
      const sides = dm[2] === '%' ? 100 : parseInt(dm[2], 10);
      if (!sides) return null;
      const rolls = [];
      for (let i = 0; i < count; i++) rolls.push(rollDie(sides));
      let kept = rolls.slice();
      let note = '';
      if (dm[3]) {
        const kind = dm[3].slice(0, 2);
        const n = parseInt(dm[3].slice(2), 10);
        const sorted = rolls.slice().sort((a, b) => a - b);
        if (kind === 'kh') kept = sorted.slice(-n);
        else if (kind === 'kl') kept = sorted.slice(0, n);
        else if (kind === 'dh') kept = sorted.slice(0, Math.max(0, sorted.length - n));
        else if (kind === 'dl') kept = sorted.slice(n);
        note = ' ' + dm[3];
      }
      const sum = kept.reduce((a, b) => a + b, 0);
      return { value: sum, text: '[' + rolls.join(', ') + ']' + note };
    }
    if (/^\d+$/.test(token)) return { value: parseInt(token, 10), text: token };
    return null;
  }

  // Evaluate a whole formula string -> { total, detail, normalized } or null.
  function evalFormula(formula) {
    let expr = String(formula || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!expr) return null;
    // Bare modifier (e.g. "+3", "-1", "2") -> roll a d20 modified by it.
    if (!/d(\d+|%)/.test(expr)) {
      expr = '1d20' + (/^[+-]/.test(expr) ? expr : '+' + expr);
    }
    const re = /([+-]?)(\d*d(?:\d+|%)(?:(?:kh|kl|dh|dl)\d+)?|\d+)/g;
    let m, total = 0, parts = [], matched = false;
    while ((m = re.exec(expr))) {
      matched = true;
      const sign = m[1] === '-' ? -1 : 1;
      const r = rollTerm(m[2]);
      if (!r) return null;
      total += sign * r.value;
      const s = sign < 0 ? '-' : (parts.length ? '+' : '');
      parts.push(/d/.test(m[2]) ? (s + m[2] + ' ' + r.text) : (s + r.text));
    }
    if (!matched) return null;
    return { total, detail: parts.join(' '), normalized: expr };
  }

  /* ------------------------------------------------------------------ */
  /* Roll + log                                                         */
  /* ------------------------------------------------------------------ */
  function doRoll(formula, source) {
    const res = evalFormula(formula);
    if (!res) { showLast('—', 'Invalid: ' + formula, ''); return; }
    const entry = {
      id: uid(), ts: Date.now(), source: source || 'Roll',
      formula: res.normalized, total: res.total, detail: res.detail
    };
    state.log.push(entry);
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save();
    appendLogEntry(entry);
    showLast(res.total, res.normalized, res.detail);
  }

  function showLast(total, formula, detail) {
    $('#dice-last').innerHTML =
      '<div><span class="total">' + escapeHtml(String(total)) + '</span> ' +
      '<span class="detail">' + escapeHtml(formula) + '</span></div>' +
      (detail ? '<div class="detail">' + escapeHtml(detail) + '</div>' : '');
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function appendLogEntry(e) {
    const list = $('#log-list');
    const empty = list.querySelector('.log-empty');
    if (empty) empty.remove();
    const li = document.createElement('li');
    li.innerHTML =
      '<span class="log-time">' + fmtTime(e.ts) + '</span>' +
      '<span class="log-src">' + escapeHtml(e.source) + '</span>' +
      '<span class="log-formula">' + escapeHtml(e.formula) + '</span>' +
      '<span class="log-total">= ' + escapeHtml(String(e.total)) + '</span>' +
      (e.detail ? '<span class="log-detail">' + escapeHtml(e.detail) + '</span>' : '');
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }

  function renderLog() {
    const list = $('#log-list');
    list.innerHTML = '';
    if (!state.log.length) { list.innerHTML = '<li class="log-empty">No rolls yet.</li>'; return; }
    state.log.forEach(appendLogEntry);
  }

  function logToText() {
    return state.log.map(e =>
      fmtTime(e.ts) + '  ' + e.source + '  ' + e.formula + ' = ' + e.total +
      (e.detail ? '   (' + e.detail + ')' : '')
    ).join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Character text -> clickable dice / modifiers                       */
  /* ------------------------------------------------------------------ */
  const DICE_RE = /\b\d*d\d+(?:(?:kh|kl|dh|dl)\d+)?(?:\s*[+-]\s*\d+)*\b/gi;
  const MOD_RE  = /(?<![\w.])[+-]\d+(?![\w.\d])/g;

  function findMatches(text) {
    const spans = [];
    let m;
    DICE_RE.lastIndex = 0;
    while ((m = DICE_RE.exec(text))) {
      const raw = m[0];
      if (!/d\d/i.test(raw)) continue;
      spans.push({ start: m.index, end: m.index + raw.length, formula: raw.replace(/\s+/g, ''), label: raw });
    }
    MOD_RE.lastIndex = 0;
    while ((m = MOD_RE.exec(text))) {
      const s = m.index, e = m.index + m[0].length;
      if (spans.some(sp => s < sp.end && e > sp.start)) continue;
      spans.push({ start: s, end: e, formula: '1d20' + m[0], label: m[0] });
    }
    spans.sort((a, b) => a.start - b.start);
    return spans;
  }

  function processTextNode(node) {
    const text = node.nodeValue;
    const spans = findMatches(text);
    if (!spans.length) return;
    const frag = document.createDocumentFragment();
    let pos = 0;
    spans.forEach(sp => {
      if (sp.start < pos) return;
      if (sp.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, sp.start)));
      const el = document.createElement('span');
      el.className = 'roll';
      el.textContent = sp.label;
      el.dataset.formula = sp.formula;
      el.title = 'Roll ' + sp.formula;
      frag.appendChild(el);
      pos = sp.end;
    });
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }

  function annotate(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        let p = node.parentNode;
        while (p && p !== root) {
          const t = p.nodeName;
          if (t === 'CODE' || t === 'PRE' || t === 'A') return NodeFilter.FILTER_REJECT;
          if (p.classList && p.classList.contains('roll')) return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(processTextNode);
  }

  /* ------------------------------------------------------------------ */
  /* Character CRUD + UI                                                */
  /* ------------------------------------------------------------------ */
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
    const det = detectNameSystem(body || '');
    const ch = {
      id: uid(),
      name: opts.name || det.name,
      system: opts.system || det.system,
      nameLocked: !!opts.name,
      body: body != null ? body : '# New Character\n\n*System — Level 1*\n\n> **AC** 10 · **HP** 6/6\n\n## Abilities\n\n- STR +0\n- DEX +0\n',
      notes: '',
      consumables: [{ id: uid(), name: 'HP', value: 0, max: 0 }],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.characters.push(ch);
    state.activeId = ch.id;
    mode = 'view';
    save();
    refreshCharUI();
  }

  function refreshCharUI() {
    if (state.characters.length && !activeChar()) state.activeId = state.characters[0].id;

    const sel = $('#char-select');
    sel.innerHTML = '';
    state.characters.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name + (c.system ? ' (' + c.system + ')' : '');
      if (c.id === state.activeId) o.selected = true;
      sel.appendChild(o);
    });

    const ch = activeChar();
    const has = state.characters.length > 0;
    $('#char-empty').hidden = has;
    $('#char-view').hidden = !ch;
    $('#notes-section').hidden = !ch;
    $('#btn-rename').disabled = !ch;
    $('#btn-delete').disabled = !ch;

    if (ch) {
      $('#view-name').textContent = ch.name;
      const b = $('#view-system');
      b.hidden = !ch.system;
      b.textContent = ch.system || '';
      setMode(mode);
      renderNotes();
    }
    renderConsumables();
  }

  function setMode(m) {
    mode = m;
    const ch = activeChar();
    $('#btn-mode-view').classList.toggle('is-active', m === 'view');
    $('#btn-mode-edit').classList.toggle('is-active', m === 'edit');
    $('#mode-view').hidden = m !== 'view';
    $('#mode-edit').hidden = m !== 'edit';
    if (!ch) return;
    if (m === 'view') {
      $('#mode-view').innerHTML = marked.parse(ch.body || '');
      annotate($('#mode-view'));
    } else {
      $('#edit-area').value = ch.body || '';
    }
  }

  function saveEdit() {
    const ch = activeChar();
    if (!ch) return;
    ch.body = $('#edit-area').value;
    ch.updatedAt = Date.now();
    const det = detectNameSystem(ch.body);
    if (!ch.nameLocked) ch.name = det.name;
    if (det.system) ch.system = det.system;
    save();
    setMode('view');
    refreshCharUI();
  }

  function renameChar() {
    const ch = activeChar();
    if (!ch) return;
    const n = prompt('Character name:', ch.name);
    if (n == null) return;
    ch.name = n.trim() || ch.name;
    ch.nameLocked = true;
    save();
    refreshCharUI();
  }

  function deleteChar() {
    const ch = activeChar();
    if (!ch) return;
    if (!confirm('Delete "' + ch.name + '"? This cannot be undone.')) return;
    state.characters = state.characters.filter(c => c.id !== ch.id);
    state.activeId = state.characters.length ? state.characters[0].id : null;
    save();
    refreshCharUI();
  }

  /* ------------------------------------------------------------------ */
  /* Consumables (bound to the active character)                        */
  /* ------------------------------------------------------------------ */
  function renderConsumables() {
    const ch = activeChar();
    const list = $('#consumables-list');
    $('#consumables-empty').hidden = !!ch;
    $('#btn-cons-add').disabled = !ch;
    list.innerHTML = '';
    if (!ch) return;

    ch.consumables.forEach(c => {
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
    const ch = activeChar();
    if (!row || !ch) return {};
    return { ch, row, c: ch.consumables.find(x => x.id === row.dataset.id) };
  }

  function bump(el, delta) {
    const { ch, c, row } = consFor(el);
    if (!c) return;
    c.value += delta;
    clampConsumable(c);
    row.querySelector('.cons-val-input').value = c.value;
    save();
  }

  function wireConsumables() {
    $('#btn-cons-add').addEventListener('click', () => {
      const ch = activeChar();
      if (!ch) return;
      ch.consumables.push({ id: uid(), name: '', value: 0, max: 0 });
      save();
      renderConsumables();
      const rows = $('#consumables-list').querySelectorAll('.cons-name');
      if (rows.length) rows[rows.length - 1].focus();
    });

    const list = $('#consumables-list');
    list.addEventListener('click', e => {
      if (e.target.closest('.cons-inc')) bump(e.target, +1);
      else if (e.target.closest('.cons-dec')) bump(e.target, -1);
      else if (e.target.closest('.cons-del')) {
        const { ch, c } = consFor(e.target);
        if (!c) return;
        if (ch.consumables.length === 1 || confirm('Delete "' + (c.name || 'this consumable') + '"?')) {
          ch.consumables = ch.consumables.filter(x => x.id !== c.id);
          save();
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
      save();
    });
    list.addEventListener('change', e => {
      if (e.target.classList.contains('cons-val-input') || e.target.classList.contains('cons-max-input')) {
        const { c } = consFor(e.target);
        if (!c) return;
        clampConsumable(c);
        save();
        renderConsumables();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Notes (Markdown, bound to the active character)                    */
  /* ------------------------------------------------------------------ */
  let notesTimer = null;

  function renderNotes() {
    const ch = activeChar();
    if (!ch) return;
    const area = $('#notes-area');
    if (document.activeElement !== area) area.value = ch.notes || '';
  }

  function wireNotes() {
    const area = $('#notes-area');
    area.addEventListener('input', () => {
      const ch = activeChar();
      if (!ch) return;
      ch.notes = area.value;
      ch.updatedAt = Date.now();
      clearTimeout(notesTimer);
      notesTimer = setTimeout(save, 300);
    });
    area.addEventListener('blur', save);
  }

  /* ------------------------------------------------------------------ */
  /* Clipboard / paste modal                                            */
  /* ------------------------------------------------------------------ */
  function openPasteModal(text) {
    $('#paste-area').value = text || '';
    $('#paste-modal').hidden = false;
    $('#paste-area').focus();
  }
  function closePasteModal() { $('#paste-modal').hidden = true; }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) createCharacter(text);
      else openPasteModal('');
    } catch (e) {
      openPasteModal('');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Export / import                                                    */
  /* ------------------------------------------------------------------ */
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'osr-manager-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { alert('Import failed: not valid JSON.'); return; }
      if (!data || !Array.isArray(data.characters)) { alert('Import failed: no "characters" array.'); return; }
      const replace = confirm('OK = Replace ALL current data with the imported file.\nCancel = Merge imported characters into current data.');
      if (replace) {
        state = Object.assign({ version: 1, activeId: null, characters: [], log: [] }, data);
      } else {
        data.characters.forEach(c => { c.id = uid(); state.characters.push(c); });
        if (Array.isArray(data.log)) state.log = state.log.concat(data.log).slice(-MAX_LOG);
      }
      state.characters.forEach(ensureCharShape);
      if (!activeChar() && state.characters.length) state.activeId = state.characters[0].id;
      mode = 'view';
      save();
      refreshCharUI();
      renderLog();
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ */
  /* Dice panel                                                         */
  /* ------------------------------------------------------------------ */
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
      b.addEventListener('click', () => doRoll(p.f, 'Dice Roller'));
      grid.appendChild(b);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Seed data (first run only) — canonical copies live in data/*.txt   */
  /* ------------------------------------------------------------------ */
  const SEED_FILES = ['data/garrick-wwn.txt', 'data/gulzund-blize-shadowdark.txt'];

  // Used only when data/*.txt can't be fetched (e.g. page opened via file://).
  const SEED_WWN = `Garrick [WWN]
Level 1 Heroic Expert | Barbarian Background

HP: 17/19 | AC: 14 | AB: +0

ATTRIBUTES
STR: 14 (+1)
DEX: 9 (+0)
CON: 14 (+1)
INT: 9 (+0)
WIS: 14 (+1)
CHA: 11 (+0)

SAVING THROWS
Physical: 14+ | Evasion: 15+ | Mental: 14+ | Luck: 15+

SKILLS
Survive-0, Sneak-0, Stab-0, Heal-0, Notice-0, Convince-4

FOCI
Poisoner (Lvl 1), Spirit Familiar (Lvl 1)

EQUIPMENT
Readied: Sword, Short, Throwing Blade, Small Shield, Linothorax
Stowed: Backpack, Rations (1 week), Waterskin, Tinder Box, Torches (3), Grappling Hook, Rope (50 ft)
Stored: None
Credits: 0`;

  const SEED_SD = `# Gulzund Blize
*Human Witch — Level 1 Lawful*

> **AC** 11 · **HP** 5/5 · **Luck** 🍀 0 · **XP** 0

## Abilities
|     | Score | Mod |
| --- | ----- | --- |
| STR | 8 | -1 |
| DEX | 12 | +1 |
| CON | 16 | +3 |
| INT | 10 | +0 |
| WIS | 10 | +0 |
| CHA | 19 | +4 |

## Attacks & weapons
- **Dagger (OBSIDIAN)** — +1 (N), 1d6 (BREAKABLE, FIN)
- **Spells** — To cast a Witch spell, roll 1d20+4 vs a DC equal to 10 + the spell's tier.

## Talents
- **Ambitious** — Gain one additional talent roll at 1st level.
- **Learn Extra Spell** — Learn an additional witch spell of any tier you can cast
- **+2 CHA or +1 Casting** — +2 to Charisma stat or +1 to witch spellcasting checks
- **Cauldron**
- **Stat Bonus**

## Spells
- Cauldron
- Charm Person
- Eyebite
- Willowman

## Gear (slots: 10)

| Slot # | Item | Slot # | Item |
| --- | --- | --- | --- |
| 1 | Dagger (obsidian) | 11 |  |
| 2 | Backpack (free) | 12 |  |
| 3 | Flint and steel | 13 |  |
| 4 | Torch | 14 |  |
| 5 | Torch | 15 |  |
| 6 | Iron spikes | 16 |  |
| 7 |  | 17 |  |
| 8 |  | 18 |  |
| 9 |  | 19 |  |
| 10 |  | 20 |  |

## Languages
- Common
- Diabolic
- Elvish
- Primordial
- Sylvan

## Advancement
- **XP:** 0 · **Next level:** roll HP, gain a talent on the level-up table.

## Bonds / notes
- Background: Drawn.`;

  async function seed() {
    const fallback = [SEED_WWN, SEED_SD];
    for (let i = 0; i < SEED_FILES.length; i++) {
      let text = null;
      try {
        const res = await fetch(SEED_FILES[i]);
        if (res.ok) text = await res.text();
      } catch (e) { /* file:// or offline — use fallback */ }
      createCharacter(text && text.trim() ? text : fallback[i]);
    }
    if (state.characters.length) {
      state.activeId = state.characters[0].id;
      save();
      refreshCharUI();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                             */
  /* ------------------------------------------------------------------ */
  function wire() {
    // Tabs
    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('.tab-btn');
      if (!b) return;
      $$('.tab-btn').forEach(x => x.classList.toggle('is-active', x === b));
      $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === 'tab-' + b.dataset.tab));
    });

    // Character toolbar
    $('#char-select').addEventListener('change', e => {
      state.activeId = e.target.value;
      mode = 'view';
      save();
      refreshCharUI();
    });
    $('#btn-new-blank').addEventListener('click', () => createCharacter(null));
    $('#btn-new-paste').addEventListener('click', pasteFromClipboard);
    $('#btn-new-text').addEventListener('click', () => openPasteModal(''));
    $('#btn-rename').addEventListener('click', renameChar);
    $('#btn-delete').addEventListener('click', deleteChar);

    // View / edit
    $('#btn-mode-view').addEventListener('click', () => setMode('view'));
    $('#btn-mode-edit').addEventListener('click', () => setMode('edit'));
    $('#btn-save').addEventListener('click', saveEdit);
    $('#btn-cancel').addEventListener('click', () => setMode('view'));

    // Clickable rolls inside the rendered sheet
    $('#mode-view').addEventListener('click', e => {
      const el = e.target.closest('.roll');
      if (!el) return;
      const ch = activeChar();
      doRoll(el.dataset.formula, ch ? ch.name : 'Character');
    });

    // Paste modal
    $('#btn-paste-create').addEventListener('click', () => {
      const t = $('#paste-area').value;
      if (t && t.trim()) { createCharacter(t); closePasteModal(); }
      else closePasteModal();
    });
    $('#btn-paste-close').addEventListener('click', closePasteModal);
    $('#paste-modal').addEventListener('click', e => { if (e.target === $('#paste-modal')) closePasteModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePasteModal(); });

    // Dice
    $('#dice-custom').addEventListener('submit', e => {
      e.preventDefault();
      const v = $('#custom-formula').value.trim();
      if (v) doRoll(v, 'Dice Roller');
    });

    // Session log
    $('#btn-log-clear').addEventListener('click', () => {
      if (!state.log.length || confirm('Clear the session log?')) {
        state.log = [];
        save();
        renderLog();
      }
    });
    $('#btn-log-copy').addEventListener('click', async () => {
      const text = logToText();
      try { await navigator.clipboard.writeText(text); }
      catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      }
    });

    // Export / import
    $('#btn-export').addEventListener('click', exportData);
    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#file-import').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) importData(f);
      e.target.value = '';
    });

    wireConsumables();
    wireNotes();
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                               */
  /* ------------------------------------------------------------------ */
  function init() {
    if (typeof marked !== 'undefined') {
      marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
    }
    const had = load();
    buildDiceGrid();
    renderLog();
    refreshCharUI();
    wire();
    if (!had && !state.characters.length) seed();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
