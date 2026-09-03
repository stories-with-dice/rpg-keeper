/* OSR Character & Combat Manager
 * Vanilla JS. Persists to localStorage. Markdown via marked (js/marked.min.js).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'osr_manager_v1';
  const MONSTERS_URL = 'data/monsters.json';
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
  const STATE_DEFAULTS = {
    version: 1, activeId: null, characters: [], log: [],
    monsters: [], monstersSeeded: false, conditions: [],
    combat: { round: 1, activeId: null, selectedId: null, entries: [] }
  };

  // Prepopulated status conditions (common OSR set). icon = Font Awesome class.
  const CONDITION_SEED = [
    { name: 'Blinded', icon: 'fa-eye-slash', desc: 'The creature has disadvantage on tasks requiring the lost sense. (p55 SD)' },
    { name: 'Charmed', icon: 'fa-heart', desc: "A charmed creature can't attack the charmer or target the charmer with harmful abilities or magical effects. The charmer has advantage on any ability check to interact socially with the creature." },
    { name: 'Deafened', icon: 'fa-ear-deaf', desc: 'The creature has disadvantage on tasks requiring the lost sense. (p55 SD)' },
    { name: 'Exhaustion', icon: 'fa-battery-empty', desc: 'Measured in six levels, with effects ranging from disadvantage on ability checks to hit point maximum halving, speed reduction, disadvantage on attack rolls and saving throws, and even death at the extreme level.' },
    { name: 'Frightened', icon: 'fa-ghost', desc: "A frightened creature has disadvantage on ability checks and attack rolls while the source of its fear is within line of sight. The creature can't willingly move closer to the source of its fear." },
    { name: 'Grappled', icon: 'fa-handcuffs', desc: 'A grappled creature cannot move. The condition ends if the grappler is incapacitated or if an effect removes the grappled creature from the reach of the grappler.' },
    { name: 'Incapacitated', icon: 'fa-ban', desc: "An incapacitated creature can't take actions or reactions." },
    { name: 'Invisible', icon: 'fa-eye-low-vision', desc: 'Impossible to see without the aid of magic or a special sense. Attacks against the invisible creature are at disadvantage. Its location can be detected by any noise it makes or tracks it leaves.' },
    { name: 'Paralyzed', icon: 'fa-bolt', desc: "A paralyzed creature is incapacitated and can't move or speak." },
    { name: 'Petrified', icon: 'fa-cube', desc: 'Transformed, along with any nonmagical object it is wearing or carrying, into a solid inanimate substance (usually stone). Its weight increases by a factor of ten, and it ceases aging.' },
    { name: 'Poisoned', icon: 'fa-skull-crossbones', desc: 'A poisoned creature has disadvantage on attack rolls and ability checks.' },
    { name: 'Prone', icon: 'fa-person-falling', desc: "A prone creature's only movement option is to crawl Near unless it stands up and thereby ends the condition. It has disadvantage on attack rolls. An attack roll against it has advantage if the attacker is Near, otherwise disadvantage." },
    { name: 'Restrained', icon: 'fa-link', desc: "A restrained creature cannot move. Attack rolls against it have advantage, and its attack rolls have disadvantage. It has disadvantage on Dexterity saving throws." },
    { name: 'Stunned', icon: 'fa-face-dizzy', desc: "A stunned creature is incapacitated, can't move, and can speak only falteringly. It automatically fails Strength and Dexterity saving throws. Attack rolls against it have advantage." },
    { name: 'Unconscious', icon: 'fa-bed', desc: "Incapacitated, can't move or speak, and unaware of its surroundings. Can't take actions or reactions." },
    { name: 'Concentrating', icon: 'fa-brain', desc: 'Maintaining an ongoing effect. Taking damage may force a check to keep concentration.' }
  ];
  const DEFAULT_STATUS_ICON = 'fa-circle-exclamation';

  let state = JSON.parse(JSON.stringify(STATE_DEFAULTS));
  let mode = 'view'; // 'view' | 'edit'

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          state = Object.assign(JSON.parse(JSON.stringify(STATE_DEFAULTS)), parsed);
        }
        ensureStateShape();
        return true;
      }
    } catch (e) { console.warn('load failed', e); }
    return false;
  }

  function ensureStateShape() {
    if (!Array.isArray(state.characters)) state.characters = [];
    if (!Array.isArray(state.monsters)) state.monsters = [];
    if (!Array.isArray(state.log)) state.log = [];
    if (!Array.isArray(state.conditions) || !state.conditions.length) {
      state.conditions = CONDITION_SEED.map(c => Object.assign({ id: uid() }, c));
    }
    state.conditions.forEach(c => { if (!c.id) c.id = uid(); if (!c.icon) c.icon = DEFAULT_STATUS_ICON; });
    state.characters.forEach(ensureCharShape);
    state.monsters.forEach(m => { if (!m.id) m.id = uid(); });
    if (!state.combat || typeof state.combat !== 'object') state.combat = {};
    state.combat = Object.assign({ round: 1, activeId: null, selectedId: null, entries: [] }, state.combat);
    if (!Array.isArray(state.combat.entries)) state.combat.entries = [];
    state.combat.entries.forEach(e => {
      if (!e.id) e.id = uid();
      if (e.side !== 'ally' && e.side !== 'enemy' && e.side !== 'neutral') {
        e.side = e.kind === 'character' ? 'ally' : 'enemy';
      }
      if (e.hd == null) e.hd = '';
      if (e.hp == null) e.hp = 0;
      if (!Array.isArray(e.statuses)) e.statuses = [];
    });
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
  function pushLog(source, formula, total, detail) {
    const entry = { id: uid(), ts: Date.now(), source: source || 'Roll', formula: formula, total: total, detail: detail || '' };
    state.log.push(entry);
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save();
    appendLogEntry(entry);
    showLast(total, formula, detail);
    return entry;
  }

  // A non-roll log line (status changes, etc.) — no "= total" column.
  function pushNote(source, text, detail) {
    const entry = { id: uid(), ts: Date.now(), source: source || '—', formula: text, total: '', detail: detail || '' };
    state.log.push(entry);
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    save();
    appendLogEntry(entry);
    return entry;
  }

  function doRoll(formula, source) {
    const res = evalFormula(formula);
    if (!res) { showLast('—', 'Invalid: ' + formula, ''); return null; }
    return pushLog(source || 'Roll', res.normalized, res.total, res.detail);
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
    const hasTotal = e.total !== '' && e.total != null;
    const li = document.createElement('li');
    if (!hasTotal) li.className = 'log-note';
    li.innerHTML =
      '<span class="log-time">' + fmtTime(e.ts) + '</span>' +
      '<span class="log-src">' + escapeHtml(e.source) + '</span>' +
      '<span class="log-formula">' + escapeHtml(e.formula) + '</span>' +
      (hasTotal ? '<span class="log-total">= ' + escapeHtml(String(e.total)) + '</span>' : '') +
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
    return state.log.map(e => {
      const hasTotal = e.total !== '' && e.total != null;
      return fmtTime(e.ts) + '  ' + e.source + '  ' + e.formula +
        (hasTotal ? ' = ' + e.total : '') +
        (e.detail ? '   (' + e.detail + ')' : '');
    }).join('\n');
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

  /* ================================================================== */
  /* Combat tracker                                                      */
  /* ================================================================== */
  let saveT = null;
  function saveDebounced() { clearTimeout(saveT); saveT = setTimeout(save, 250); }
  const fmtMod = n => (n >= 0 ? '+' : '') + n;

  function combatCharFor(e) {
    return e.kind === 'character' ? state.characters.find(c => c.id === e.charId) || null : null;
  }
  function hpConsumable(ch) {
    if (!ch || !Array.isArray(ch.consumables)) return null;
    return ch.consumables.find(c => /^\s*hp\s*$/i.test(c.name || '')) || null;
  }
  function entryHp(e) {
    if (e.kind === 'character') {
      const hpc = hpConsumable(combatCharFor(e));
      if (hpc) return hpc.value;
    }
    return Number(e.hp) || 0;
  }
  function entryMaxHp(e) {
    if (e.kind === 'character') {
      const hpc = hpConsumable(combatCharFor(e));
      if (hpc) return hpc.max || 0;
    }
    return Number(e.maxHp) || 0;
  }
  function setEntryHp(e, v) {
    v = Math.round(Number(v) || 0);
    if (e.kind === 'character') {
      const hpc = hpConsumable(combatCharFor(e));
      if (hpc) { hpc.value = v; clampConsumable(hpc); save(); renderConsumables(); return; }
    }
    e.hp = v < 0 ? 0 : v;
    save();
  }
  function entryDown(e) {
    if (entryHp(e) <= 0) return true;
    const hd = String(e.hd == null ? '' : e.hd).trim();
    return hd !== '' && MonsterParse.hdNum(hd) === 0;
  }
  function charQuickAC(ch) {
    const m = (ch && ch.body || '').match(/\bAC\b[^0-9\n]{0,4}(\d{1,2})/i);
    return m ? m[1] : '';
  }
  function charDetectHp(ch) {
    const body = ch && ch.body || '';
    let m = body.match(/\bHP\b[^0-9\n]{0,4}(\d+)\s*\/\s*(\d+)/i);
    if (m) return { value: +m[1], max: +m[2] };
    m = body.match(/\bHP\b[^0-9\n]{0,4}(\d+)/i);
    if (m) return { value: +m[1], max: +m[1] };
    return null;
  }
  function acDisplay(m) {
    if (!m || !m.ac) return '—';
    if (m.ac.asc != null && m.ac.desc != null) return m.ac.asc + ' [' + m.ac.desc + ']';
    if (m.ac.asc != null) return String(m.ac.asc);
    if (m.ac.desc != null) return '[' + m.ac.desc + ']';
    return '—';
  }
  function atkLabel(a) {
    return (a.label || 'attack') + (a.count > 1 ? ' ×' + a.count : '') + ' ' + fmtMod(a.toHit || 0) +
      (a.damage ? ' · ' + a.damage : '') + (a.note ? ' (' + a.note + ')' : '');
  }
  function selectedEntry() {
    return state.combat.entries.find(e => e.id === state.combat.selectedId) || null;
  }

  function uniqueName(base) {
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('^' + esc + '(?: \\((\\d+)\\))?$');
    const same = state.combat.entries.filter(e => rx.test(e.name));
    if (!same.length) return base;
    const bare = same.find(e => e.name === base);
    if (bare) bare.name = base + ' (1)';
    const taken = new Set(state.combat.entries.map(e => e.name));
    let n = 2;
    while (taken.has(base + ' (' + n + ')')) n++;
    return base + ' (' + n + ')';
  }

  function addCharEntry(charId) {
    const ch = state.characters.find(c => c.id === charId);
    if (!ch) return;
    // Seed the linked HP consumable from the sheet if it's still the untouched 0/0 default.
    const det = charDetectHp(ch);
    if (det) {
      const hpc = hpConsumable(ch);
      if (hpc) {
        if ((hpc.value || 0) === 0 && (hpc.max || 0) === 0) { hpc.value = det.value; hpc.max = det.max; }
      } else {
        ch.consumables.push({ id: uid(), name: 'HP', value: det.value, max: det.max });
      }
      save();
      renderConsumables();
    }
    const e = { id: uid(), kind: 'character', charId: ch.id, name: uniqueName(ch.name), hd: '', hp: 0, side: 'ally', statuses: [] };
    state.combat.entries.push(e);
    if (!state.combat.activeId) state.combat.activeId = e.id;
    state.combat.selectedId = e.id;
    save();
    renderCombat();
  }
  function addMonsterEntry(def) {
    const e = {
      id: uid(), kind: 'monster', name: uniqueName(def.name),
      monster: JSON.parse(JSON.stringify(def)),
      hd: def.hd || '', hp: def.hp || 0, maxHp: def.hp || 0, side: 'enemy', statuses: []
    };
    state.combat.entries.push(e);
    if (!state.combat.activeId) state.combat.activeId = e.id;
    state.combat.selectedId = e.id;
    save();
    renderCombat();
  }
  function removeEntry(id) {
    const ents = state.combat.entries;
    const i = ents.findIndex(x => x.id === id);
    if (i < 0) return;
    ents.splice(i, 1);
    const fallback = ents.length ? ents[Math.min(i, ents.length - 1)].id : null;
    if (state.combat.activeId === id) state.combat.activeId = fallback;
    if (state.combat.selectedId === id) state.combat.selectedId = fallback;
    save();
    renderCombat();
  }
  function cycleSide(id) {
    const e = state.combat.entries.find(x => x.id === id);
    if (!e) return;
    e.side = e.side === 'ally' ? 'enemy' : (e.side === 'enemy' ? 'neutral' : 'ally');
    save();
    renderTracker();
  }
  function setSelected(id) {
    state.combat.selectedId = id;
    saveDebounced();
    renderTracker();
    renderCombatantDetail();
  }

  /* ---- status conditions ---- */
  function statusIconOf(name) {
    const c = state.conditions.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    return (c && c.icon) || DEFAULT_STATUS_ICON;
  }
  function statusDescOf(name) {
    const c = state.conditions.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    return (c && c.desc) || '';
  }
  function toggleStatus(entryId, name) {
    const e = state.combat.entries.find(x => x.id === entryId);
    if (!e) return;
    if (!Array.isArray(e.statuses)) e.statuses = [];
    const round = state.combat.round || 1;
    const i = e.statuses.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) {
      e.statuses.splice(i, 1);
      pushNote(e.name, 'lost "' + name + '"', 'round ' + round);
    } else {
      e.statuses.push({ name: name, icon: statusIconOf(name), round: round, ts: Date.now() });
      pushNote(e.name, 'gained "' + name + '"', 'round ' + round);
    }
    save();
    renderTracker();
    renderCombatantDetail();
  }
  function removeStatus(entryId, name) {
    const e = state.combat.entries.find(x => x.id === entryId);
    if (!e || !Array.isArray(e.statuses)) return;
    const i = e.statuses.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
    if (i < 0) return;
    e.statuses.splice(i, 1);
    pushNote(e.name, 'lost "' + name + '"', 'round ' + (state.combat.round || 1));
    save();
    renderTracker();
    renderCombatantDetail();
  }
  function defineCondition(name, desc) {
    name = String(name || '').trim();
    if (!name) return null;
    let c = state.conditions.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (c) { if (desc) c.desc = desc; }
    else {
      c = { id: uid(), name: name, icon: DEFAULT_STATUS_ICON, desc: String(desc || '').trim() };
      state.conditions.push(c);
      state.conditions.sort((a, b) => a.name.localeCompare(b.name));
    }
    save();
    return c;
  }

  /* ---- right-click context menu ---- */
  let ctxEntryId = null;
  function closeCtxMenu() {
    const m = $('#ctx-menu');
    m.hidden = true;
    m.innerHTML = '';
    ctxEntryId = null;
  }
  function openCtxMenu(x, y, entryId) {
    const e = state.combat.entries.find(en => en.id === entryId);
    if (!e) return;
    ctxEntryId = entryId;
    const active = new Set((e.statuses || []).map(s => s.name.toLowerCase()));
    const items = state.conditions
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => {
        const on = active.has(c.name.toLowerCase());
        return '<button class="ctx-item' + (on ? ' is-on' : '') + '" data-name="' + escapeHtml(c.name) + '" title="' + escapeHtml(c.desc) + '">' +
          '<i class="fa-solid ' + escapeHtml(c.icon || DEFAULT_STATUS_ICON) + '"></i>' +
          '<span>' + escapeHtml(c.name) + '</span>' +
          (on ? '<i class="fa-solid fa-check ctx-check"></i>' : '') +
          '</button>';
      }).join('');
    const m = $('#ctx-menu');
    m.innerHTML =
      '<div class="ctx-head">' + escapeHtml(e.name) + ' &middot; status</div>' +
      '<div class="ctx-list">' + items + '</div>' +
      '<button class="ctx-item ctx-new"><i class="fa-solid fa-plus"></i><span>New condition&hellip;</span></button>';
    m.hidden = false;
    // position within viewport
    const mw = m.offsetWidth, mh = m.offsetHeight;
    const px = Math.min(x, window.innerWidth - mw - 8);
    const py = Math.min(y, window.innerHeight - mh - 8);
    m.style.left = Math.max(8, px) + 'px';
    m.style.top = Math.max(8, py) + 'px';
  }
  function onCtxMenuClick(e) {
    const item = e.target.closest('.ctx-item');
    if (!item || ctxEntryId == null) return;
    if (item.classList.contains('ctx-new')) {
      const name = prompt('New condition name:');
      if (name && name.trim()) {
        const desc = prompt('Description for "' + name.trim() + '":') || '';
        defineCondition(name.trim(), desc);
        toggleStatus(ctxEntryId, name.trim());
      }
      closeCtxMenu();
      return;
    }
    toggleStatus(ctxEntryId, item.dataset.name);
    closeCtxMenu();
  }

  function turnIndex() {
    return state.combat.entries.findIndex(e => e.id === state.combat.activeId);
  }
  function nextTurn() {
    const ents = state.combat.entries;
    if (!ents.length) return;
    let i = turnIndex();
    if (i < 0) { state.combat.activeId = ents[0].id; save(); renderCombat(); return; }
    i++;
    if (i >= ents.length) { i = 0; state.combat.round = (state.combat.round || 1) + 1; }
    state.combat.activeId = ents[i].id;
    save();
    renderCombat();
  }
  function prevTurn() {
    const ents = state.combat.entries;
    if (!ents.length) return;
    let i = turnIndex();
    if (i <= 0) {
      if ((state.combat.round || 1) > 1) { state.combat.round--; i = ents.length - 1; }
      else i = 0;
    } else i--;
    state.combat.activeId = ents[i].id;
    save();
    renderCombat();
  }
  function setRound(delta) {
    state.combat.round = Math.max(1, (state.combat.round || 1) + delta);
    save();
    renderCombatBar();
  }
  function moveSelection(dir) {
    const ents = state.combat.entries;
    if (!ents.length) return;
    let i = ents.findIndex(e => e.id === state.combat.selectedId);
    if (i < 0) i = dir > 0 ? -1 : 0;
    i = (i + dir + ents.length) % ents.length;
    state.combat.selectedId = ents[i].id;
    saveDebounced();
    renderTracker();
    renderCombatantDetail();
    const row = $('#tracker-list [data-id="' + ents[i].id + '"]');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  /* ---- combat rolls ---- */
  function rollEntryAttack(e, atk) {
    const bonus = atk.toHit != null ? atk.toHit : (e.monster && e.monster.atkBonus) || 0;
    const n = Math.max(1, atk.count || 1);
    const bits = [];
    let firstTotal = null;
    for (let k = 0; k < n; k++) {
      const hit = evalFormula('1d20' + fmtMod(bonus));
      let s = (n > 1 ? '#' + (k + 1) + ' ' : '') + 'to-hit ' + hit.total;
      if (atk.damage) { const dmg = evalFormula(atk.damage); if (dmg) s += ', dmg ' + dmg.total + ' [' + atk.damage + ']'; }
      if (firstTotal == null) firstTotal = hit.total;
      bits.push(s);
    }
    pushLog(e.name, (atk.label || 'attack') + ' ' + fmtMod(bonus) + (atk.damage ? ' (' + atk.damage + ')' : ''), firstTotal, bits.join('  |  '));
  }
  function rollEntrySave(e, key) {
    const m = e.monster;
    if (m && m.saveTargets && m.saveTargets[key] != null) {
      const tgt = m.saveTargets[key];
      const r = evalFormula('1d20');
      pushLog(e.name, 'Save ' + key, r.total, 'vs ' + tgt + ' → ' + (r.total >= tgt ? 'SAVE' : 'FAIL'));
    } else if (m && m.stats && m.stats[key] != null) {
      const mod = m.stats[key];
      const r = evalFormula('1d20' + fmtMod(mod));
      pushLog(e.name, 'Save ' + key + ' ' + fmtMod(mod), r.total, r.detail + ' — GM sets DC');
    } else {
      const r = evalFormula('1d20');
      pushLog(e.name, 'Save ' + key, r.total, r.detail);
    }
  }
  function rollEntryMorale(e) {
    const ml = e.monster && e.monster.moraleML;
    const r = evalFormula('2d6');
    if (ml != null) pushLog(e.name, 'Morale', r.total, r.detail + ' vs ML ' + ml + ' → ' + (r.total <= ml ? 'holds' : 'breaks'));
    else pushLog(e.name, 'Morale', r.total, r.detail + ' (2d6 — set ML to auto-judge)');
  }

  /* ---- combat render ---- */
  function renderCombat() {
    renderCombatBar();
    renderTracker();
    renderCombatantDetail();
  }
  function renderCombatBar() {
    $('#cb-round').textContent = state.combat.round || 1;
    const act = state.combat.entries.find(e => e.id === state.combat.activeId);
    $('#cb-turn-name').textContent = act ? act.name : '—';
    const sel = $('#cb-add-char');
    sel.innerHTML = '<option value="">+ Add character…</option>' +
      state.characters.map(c => '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>').join('');
    sel.value = '';
  }
  function statusTagsHtml(e) {
    if (!Array.isArray(e.statuses) || !e.statuses.length) return '';
    return '<span class="cbt-tags">' + e.statuses.map(s => {
      const desc = statusDescOf(s.name);
      const tip = (desc ? desc + '  ·  ' : '') + 'added round ' + (s.round || '?');
      return '<span class="status-tag" data-name="' + escapeHtml(s.name) + '" tabindex="0">' +
        '<i class="fa-solid ' + escapeHtml(s.icon || statusIconOf(s.name)) + '"></i>' +
        '<span class="status-name">' + escapeHtml(s.name) + '</span>' +
        '<button class="status-x" title="Remove ' + escapeHtml(s.name) + '" aria-label="Remove">✕</button>' +
        '<span class="status-tip">' + escapeHtml(tip) + '</span>' +
      '</span>';
    }).join('') + '</span>';
  }
  function rowHtml(e) {
    const cls = ['cbt-row', 'side-' + e.side];
    if (e.id === state.combat.activeId) cls.push('is-active');
    if (e.id === state.combat.selectedId) cls.push('is-selected');
    if (entryDown(e)) cls.push('is-down');
    const m = e.kind === 'monster' ? e.monster : null;
    const ch = e.kind === 'character' ? combatCharFor(e) : null;
    const ac = m ? acDisplay(m) : (ch ? (charQuickAC(ch) || '—') : '—');
    const sv = m ? (m.savesText || '') : '';
    const atk = m ? (m.attacksText || '') : '';
    const maxHp = entryMaxHp(e);
    return '<li class="' + cls.join(' ') + '" data-id="' + e.id + '" draggable="true">' +
      '<div class="cbt-line1">' +
        '<span class="cbt-drag" title="Drag to reorder">⠿</span>' +
        '<button class="cbt-side" title="Ally / Enemy / Neutral — click to cycle">●</button>' +
        '<span class="cbt-name">' + escapeHtml(e.name) + '</span>' +
        '<span class="cbt-kind">' + e.kind + '</span>' +
        (e.id === state.combat.activeId ? '<span class="cbt-turnflag">◀ turn</span>' : '') +
        '<button class="cbt-remove" title="Remove from combat">✕</button>' +
      '</div>' +
      '<div class="cbt-line2">' +
        '<label class="chip">HD <input class="cbt-hd" type="text" value="' + escapeHtml(String(e.hd || '')) + '" /></label>' +
        '<label class="chip">HP <input class="cbt-hp" type="number" step="1" value="' + entryHp(e) + '" />' +
          '<span class="cbt-max">/ ' + (maxHp || '—') + '</span></label>' +
        '<span class="chip">AC ' + escapeHtml(String(ac)) + '</span>' +
        (sv ? '<span class="chip chip-dim">Sv ' + escapeHtml(sv) + '</span>' : '') +
        (atk ? '<span class="chip chip-dim">' + escapeHtml(atk) + '</span>' : '') +
        statusTagsHtml(e) +
      '</div>' +
    '</li>';
  }
  function renderTracker() {
    const list = $('#tracker-list');
    const ents = state.combat.entries;
    $('#tracker-empty').hidden = ents.length > 0;
    list.innerHTML = ents.map(rowHtml).join('');
  }
  function chip(l, v) {
    return '<span class="chip"><span class="chip-l">' + escapeHtml(l) + '</span> ' + escapeHtml(String(v)) + '</span>';
  }
  function renderCombatantDetail() {
    const host = $('#combatant-detail');
    const ent = selectedEntry();
    if (!ent) { host.innerHTML = '<p class="hint">Select a combatant for details, attacks &amp; saves.</p>'; return; }
    let h = '';
    if (ent.kind === 'monster') {
      const m = ent.monster;
      h += '<div class="cd-head"><b>' + escapeHtml(ent.name) + '</b> <span class="cd-src">' + escapeHtml(m.source || 'monster') + '</span></div>';
      h += '<div class="cd-stats">' +
        chip('AC', acDisplay(m)) +
        (m.ac && m.ac.thac0 != null ? chip('THAC0', m.ac.thac0) : '') +
        chip('HD', ent.hd || '—') +
        chip('HP', entryHp(ent) + ' / ' + (entryMaxHp(ent) || '—')) +
        (m.move ? chip('MV', m.move) : '') +
        (m.align ? chip('AL', m.align) : '') +
        (m.xp != null ? chip('XP', m.xp) : '') +
      '</div>';
      if (m.attacks && m.attacks.length) {
        h += '<div class="cd-sec"><span class="cd-lbl">Attacks</span>' +
          m.attacks.map((a, i) => '<button class="btn cbt-atk" data-i="' + i + '">' + escapeHtml(atkLabel(a)) + '</button>').join('') +
          '<button class="btn cbt-atkroll">d20' + fmtMod(m.atkBonus || 0) + '</button></div>';
      }
      const sk = m.saveTargets ? Object.keys(m.saveTargets) : (m.stats ? ['S', 'D', 'C', 'I', 'W', 'Ch'] : []);
      if (sk.length) {
        h += '<div class="cd-sec"><span class="cd-lbl">Saves</span>' +
          sk.map(k => {
            const v = m.saveTargets ? m.saveTargets[k] : fmtMod(m.stats[k]);
            return '<button class="btn cbt-save" data-k="' + k + '">' + k + ' ' + v + '</button>';
          }).join('') + '</div>';
      }
      h += '<div class="cd-sec"><span class="cd-lbl">Morale</span><button class="btn cbt-morale">2d6' +
        (m.moraleML != null ? ' vs ML ' + m.moraleML : '') + '</button></div>';
      if (m.abilities && m.abilities.length) {
        h += '<div class="cd-abils">' + m.abilities.map(a =>
          '<p>' + (a.name ? '<b>' + escapeHtml(a.name) + '.</b> ' : '') + escapeHtml(a.text) + '</p>').join('') + '</div>';
      }
      if (m.desc) h += '<p class="cd-desc">' + escapeHtml(m.desc) + '</p>';
      h += '<details class="cd-raw"><summary>Raw stat block</summary><pre>' + escapeHtml(m.raw || '') + '</pre></details>';
    } else {
      const ch = combatCharFor(ent);
      h += '<div class="cd-head"><b>' + escapeHtml(ent.name) + '</b> <span class="cd-src">character' +
        (ch && ch.system ? ' · ' + escapeHtml(ch.system) : '') + '</span></div>';
      h += '<div class="cd-stats">' + chip('HD', ent.hd || '—') +
        chip('HP', entryHp(ent) + ' / ' + (entryMaxHp(ent) || '—') + '  (linked to sheet)') + '</div>';
      if (ch) h += '<div class="cd-sheet markdown-body">' + marked.parse(ch.body || '') + '</div>';
      else h += '<p class="hint">Character not found — it may have been deleted.</p>';
    }
    if (Array.isArray(ent.statuses) && ent.statuses.length) {
      h += '<div class="cd-sec"><span class="cd-lbl">Status</span><span class="cd-statuses">' +
        ent.statuses.map(s =>
          '<span class="status-tag" data-name="' + escapeHtml(s.name) + '" tabindex="0">' +
          '<i class="fa-solid ' + escapeHtml(s.icon || statusIconOf(s.name)) + '"></i>' +
          '<span class="status-name">' + escapeHtml(s.name) + '</span>' +
          '<button class="status-x" title="Remove ' + escapeHtml(s.name) + '">✕</button>' +
          '<span class="status-tip">' + escapeHtml((statusDescOf(s.name) ? statusDescOf(s.name) + '  ·  ' : '') + 'added round ' + (s.round || '?')) + '</span>' +
          '</span>').join('') +
        '</span></div>';
    }
    h += '<p class="hint cd-ctx-hint">Right-click a combatant in the tracker to add a status.</p>';
    host.innerHTML = h;
    annotate(host);
  }

  /* ---- drag & drop ---- */
  let dragId = null;
  function clearDropMarks() {
    $$('#tracker-list .cbt-row').forEach(r => r.classList.remove('drop-before', 'drop-after'));
  }
  function onDragStart(e) {
    const row = e.target.closest('.cbt-row');
    if (!row) return;
    dragId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    row.classList.add('dragging');
  }
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest('.cbt-row');
    clearDropMarks();
    if (!row || row.dataset.id === dragId) return;
    const rect = row.getBoundingClientRect();
    row.classList.add(e.clientY > rect.top + rect.height / 2 ? 'drop-after' : 'drop-before');
  }
  function onDrop(e) {
    e.preventDefault();
    const row = e.target.closest('.cbt-row');
    clearDropMarks();
    if (!row || !dragId) return;
    const ents = state.combat.entries;
    const from = ents.findIndex(x => x.id === dragId);
    if (from < 0) return;
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const [moved] = ents.splice(from, 1);
    let to = ents.findIndex(x => x.id === row.dataset.id);
    if (to < 0) to = ents.length;
    else if (after) to++;
    ents.splice(to, 0, moved);
    save();
    renderCombat();
  }
  function onDragEnd() {
    dragId = null;
    $$('#tracker-list .cbt-row').forEach(r => r.classList.remove('drop-before', 'drop-after', 'dragging'));
  }

  /* ---- tracker events ---- */
  function onTrackerClick(e) {
    const row = e.target.closest('.cbt-row');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('.status-x')) {
      removeStatus(id, e.target.closest('.status-tag').dataset.name);
      return;
    }
    if (e.target.closest('.status-tag')) { setSelected(id); return; }
    if (e.target.closest('.cbt-remove')) { removeEntry(id); return; }
    if (e.target.closest('.cbt-side')) { cycleSide(id); return; }
    setSelected(id);
  }
  function onTrackerContextMenu(e) {
    const row = e.target.closest('.cbt-row');
    if (!row) return;
    e.preventDefault();
    setSelected(row.dataset.id);
    openCtxMenu(e.clientX, e.clientY, row.dataset.id);
  }
  function onTrackerInput(e) {
    const row = e.target.closest('.cbt-row');
    if (!row) return;
    const ent = state.combat.entries.find(x => x.id === row.dataset.id);
    if (!ent) return;
    if (e.target.classList.contains('cbt-hd')) { ent.hd = e.target.value; saveDebounced(); }
    else if (e.target.classList.contains('cbt-hp')) { setEntryHp(ent, e.target.value); }
  }
  function onTrackerChange(e) {
    if (e.target.classList.contains('cbt-hd') || e.target.classList.contains('cbt-hp')) {
      renderTracker();
      renderCombatantDetail();
    }
  }
  function onDetailClick(e) {
    const ent = selectedEntry();
    if (!ent) return;
    if (e.target.closest('.status-x')) {
      removeStatus(ent.id, e.target.closest('.status-tag').dataset.name);
      return;
    }
    const atkBtn = e.target.closest('.cbt-atk');
    if (atkBtn && ent.monster) { const a = ent.monster.attacks[+atkBtn.dataset.i]; if (a) rollEntryAttack(ent, a); return; }
    if (e.target.closest('.cbt-save')) { rollEntrySave(ent, e.target.closest('.cbt-save').dataset.k); return; }
    if (e.target.closest('.cbt-morale')) { rollEntryMorale(ent); return; }
    if (e.target.closest('.cbt-atkroll')) {
      const b = (ent.monster && ent.monster.atkBonus) || 0;
      const r = evalFormula('1d20' + fmtMod(b));
      pushLog(ent.name, 'Attack ' + fmtMod(b), r.total, r.detail);
      return;
    }
    const roll = e.target.closest('.roll');
    if (roll) doRoll(roll.dataset.formula, ent.name);
  }
  function onCombatKey(e) {
    if (!$('#tab-combat').classList.contains('is-active')) return;
    if (!$('#monster-modal').hidden || !$('#paste-modal').hidden) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); nextTurn(); }
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); prevTurn(); }
  }

  /* ---- monster library modal ---- */
  function openMonsterModal() {
    $('#monster-modal').hidden = false;
    $('#mm-msg').textContent = '';
    renderLibrary();
    $('#mm-search').focus();
  }
  function closeMonsterModal() { $('#monster-modal').hidden = true; }

  function renderLibrary() {
    const q = ($('#mm-search').value || '').toLowerCase().trim();
    const mn = parseFloat($('#mm-hd-min').value);
    const mx = parseFloat($('#mm-hd-max').value);
    const list = $('#mm-lib-list');
    const items = state.monsters.filter(d => {
      if (q && !(d.name || '').toLowerCase().includes(q)) return false;
      const h = d.hdNum != null ? d.hdNum : MonsterParse.hdNum(d.hd);
      if (!isNaN(mn) && h < mn) return false;
      if (!isNaN(mx) && h > mx) return false;
      return true;
    }).sort((a, b) => (a.hdNum || 0) - (b.hdNum || 0) || String(a.name).localeCompare(b.name));
    if (!items.length) {
      list.innerHTML = '<li class="mm-empty hint">No monsters match. Paste a stat block on the right to add one.</li>';
      return;
    }
    list.innerHTML = items.map(d => {
      const meta = ['HD ' + (d.hd || '?'), 'AC ' + (d.ac && d.ac.asc != null ? d.ac.asc : '?'), 'HP ' + (d.hp || '?'), d.source].join(' · ');
      return '<li data-id="' + d.id + '"><div class="mm-li-main"><b>' + escapeHtml(d.name) + '</b>' +
        '<span class="mm-li-meta">' + escapeHtml(meta) + '</span></div>' +
        '<div class="mm-li-actions"><button class="btn mm-add">Add</button>' +
        '<button class="btn mm-del" title="Remove from library">✕</button></div></li>';
    }).join('');
  }
  function onLibClick(e) {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const d = state.monsters.find(x => x.id === li.dataset.id);
    if (!d) return;
    if (e.target.closest('.mm-add')) {
      addMonsterEntry(d);
      $('#mm-msg').textContent = 'Added ' + d.name + ' to combat.';
    } else if (e.target.closest('.mm-del')) {
      if (confirm('Remove "' + d.name + '" from the library?')) {
        state.monsters = state.monsters.filter(x => x.id !== d.id);
        save();
        renderLibrary();
      }
    }
  }
  function parseAndAdd(text, alsoCombat) {
    const defs = (window.MonsterParse ? MonsterParse.parseMonsters(text || '') : []);
    if (!defs.length) {
      $('#mm-msg').textContent = 'No stat blocks found — each needs an "AC …" line, blank line between monsters.';
      return;
    }
    const added = [];
    defs.forEach(d => { d.id = uid(); state.monsters.push(d); added.push(d); });
    save();
    if (alsoCombat) added.forEach(addMonsterEntry);
    renderLibrary();
    renderCombat();
    $('#mm-paste-area').value = '';
    $('#mm-msg').textContent = 'Added ' + added.length + ' monster' + (added.length > 1 ? 's' : '') +
      ' to the library' + (alsoCombat ? ' and to combat.' : '.');
  }

  function wireCombat() {
    $('#cb-round-dec').addEventListener('click', () => setRound(-1));
    $('#cb-round-inc').addEventListener('click', () => setRound(1));
    $('#cb-turn-prev').addEventListener('click', prevTurn);
    $('#cb-turn-next').addEventListener('click', nextTurn);
    $('#cb-add-char').addEventListener('change', e => { if (e.target.value) { addCharEntry(e.target.value); e.target.value = ''; } });
    $('#cb-add-monster').addEventListener('click', openMonsterModal);
    $('#cb-clear').addEventListener('click', () => {
      if (!state.combat.entries.length || confirm('Clear all combatants and reset to round 1?')) {
        state.combat = { round: 1, activeId: null, selectedId: null, entries: [] };
        save();
        renderCombat();
      }
    });

    const list = $('#tracker-list');
    list.addEventListener('click', onTrackerClick);
    list.addEventListener('input', onTrackerInput);
    list.addEventListener('change', onTrackerChange);
    list.addEventListener('contextmenu', onTrackerContextMenu);
    list.addEventListener('dragstart', onDragStart);
    list.addEventListener('dragover', onDragOver);
    list.addEventListener('drop', onDrop);
    list.addEventListener('dragend', onDragEnd);

    $('#combatant-detail').addEventListener('click', onDetailClick);

    // context menu
    $('#ctx-menu').addEventListener('click', onCtxMenuClick);
    document.addEventListener('mousedown', e => {
      if (!$('#ctx-menu').hidden && !e.target.closest('#ctx-menu')) closeCtxMenu();
    });
    document.addEventListener('scroll', closeCtxMenu, true);
    window.addEventListener('resize', closeCtxMenu);

    $('#mm-close').addEventListener('click', closeMonsterModal);
    $('#monster-modal').addEventListener('click', e => { if (e.target === $('#monster-modal')) closeMonsterModal(); });
    $('#mm-search').addEventListener('input', renderLibrary);
    $('#mm-hd-min').addEventListener('input', renderLibrary);
    $('#mm-hd-max').addEventListener('input', renderLibrary);
    $('#mm-lib-list').addEventListener('click', onLibClick);
    $('#mm-parse-add').addEventListener('click', () => parseAndAdd($('#mm-paste-area').value, true));
    $('#mm-parse-lib').addEventListener('click', () => parseAndAdd($('#mm-paste-area').value, false));

    document.addEventListener('keydown', onCombatKey);
  }

  const MONSTER_SEED_TEXT = [
    'BEAR, POLAR',
    'A mighty, white bear that thrives in arctic environments.',
    'AC 13, HP 34, ATK 2 claw +6 (2d6), MV near (climb), S +4, D +1, C +3, I -2, W +1, Ch -2, AL N, LV 7',
    'Crush. Deals an extra die of damage if it hits the same target with both claws.',
    'Thick Fur. Cold immune.',
    '',
    'COUATL',
    'A human-sized snake with scales made of jewels and a corona of iridescent feathers.',
    'AC 16, HP 42, ATK 3 bite +6 (2d6 + poison), MV near (fly), S +2, D +3, C +2, I +4, W +4, Ch +5, AL L, LV 9',
    'Change Shape. In place of attacks, transform into any similarly-sized creature.',
    'Poison. DC 15 CON or fall into natural, deep sleep for 1d8 hours.',
    'Restore. In place of attacks, touch one creature to remove a curse, affliction, or heal 3d8 HP.',
    '',
    'Brownie',
    '1½′ tall humanoids, related to pixies and halflings. They are shy, but friendly with other Lawful creatures.',
    'AC 3 [16] Hd ½ (2hp) Att Knife (1d3) THAC0 19 [0] Mv 120′ (40′) sv D6 W7 P9 B11 S9 (Cleric 9) ML 7 AL Lawful XP 5 nA 3d6 (5d8) TT S',
    '▶ Surprise: Never surprised.',
    '▶ Dimension door: Once per day, can teleport to a known location within 360′.',
    '▶ Ventriloquism: Can cause their voice to emanate from anywhere within 60′.',
    '',
    'Bulette',
    '15′ long, hard-shelled reptiles with huge maws, tiny eyes, and a shark-like crest upon the back.',
    'AC 0 [19] Hd 9* (40hp) Att Bite (4d12) + 2 × claw (3d6) THAC0 12 [+7] Mv 150′ (50′) / 30′ (10′) burrowing sv D8 W9 P10 B10 S12 (9) ML 11 AL Neutral XP 1,600 nA 0 (1d2) TT None',
    '▶ Ravenous: Will attack anything living.',
    '▶ Leap: If cornered, can leap forward 20′, attacking with all 4 claws.',
    '▶ Armour plates: Neck plates can be fashioned into magical shields.'
  ].join('\n');

  async function seedMonsters() {
    let defs = null;
    try {
      const r = await fetch(MONSTERS_URL);
      if (r.ok) defs = await r.json();
    } catch (e) { /* file:// or offline */ }
    if (!Array.isArray(defs) || !defs.length) {
      defs = window.MonsterParse ? MonsterParse.parseMonsters(MONSTER_SEED_TEXT) : [];
    }
    defs.forEach(d => { d.id = d.id || uid(); });
    state.monsters = defs;
    state.monstersSeeded = true;
    save();
    renderLibrary();
    renderCombatBar();
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
      const replace = confirm('OK = Replace ALL current data with the imported file.\nCancel = Merge imported characters + monsters into current data.');
      if (replace) {
        state = Object.assign(JSON.parse(JSON.stringify(STATE_DEFAULTS)), data);
      } else {
        data.characters.forEach(c => { c.id = uid(); state.characters.push(c); });
        if (Array.isArray(data.monsters)) data.monsters.forEach(m => { m.id = uid(); state.monsters.push(m); });
        if (Array.isArray(data.log)) state.log = state.log.concat(data.log).slice(-MAX_LOG);
      }
      ensureStateShape();
      if (!activeChar() && state.characters.length) state.activeId = state.characters[0].id;
      mode = 'view';
      save();
      refreshCharUI();
      renderLog();
      renderCombat();
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
      if (b.dataset.tab === 'combat') renderCombat();
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
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closePasteModal(); closeMonsterModal(); closeCtxMenu(); }
    });

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
    wireCombat();
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                               */
  /* ------------------------------------------------------------------ */
  async function init() {
    if (typeof marked !== 'undefined') {
      marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
    }
    const had = load();
    buildDiceGrid();
    renderLog();
    refreshCharUI();
    renderCombat();
    wire();
    if (!had && !state.characters.length) await seed();
    if (!state.monsters.length && !state.monstersSeeded) await seedMonsters();
    renderCombat();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
