/* js/combat.js — the combat tracker: entries, HP/HD, status conditions,
 * turn order, drag-to-reorder, the right-click status menu, rolls, and
 * Scarlet Heroes damage translation (all tightly coupled to combat entries,
 * so it lives here rather than with the plain dice engine in js/dice.js).
 * The add-monster / edit-monster modals are a separate file, js/monster-modals.js.
 */
(function (OSR) {
  'use strict';
  const { $, $$, escapeHtml, uid } = OSR;

  /* ---- Scarlet Heroes damage translation ---- */
  function shDie(v) {
    if (v <= 1) return 0;
    if (v <= 5) return 1;
    if (v <= 9) return 2;
    return 4;
  }

  function updateApplyButton() {
    const btn = $('#dice-apply');
    if (!btn) return;
    if (!OSR.lastRoll) { btn.hidden = true; return; }
    btn.hidden = false;
    const ent = selectedEntry();
    const sh = !!(OSR.state.settings && OSR.state.settings.scarletHeroes);
    if (!ent) {
      btn.textContent = 'Apply damage — select a combatant';
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    const unit = (sh && ent.kind === 'monster') ? 'HD' : 'HP';
    btn.textContent = 'Apply ' + (sh ? 'SH ' : '') + 'damage to ' + ent.name + ' (' + unit + ')';
  }

  // Set a monster's HD, keeping any "*"/"+" suffix and half-HD steps.
  function setEntryHd(ent, n) {
    n = Math.max(0, Math.round(Number(n) * 2) / 2);
    const suffix = (String(ent.hd).match(/[*+]/g) || []).join('');
    ent.hd = n === 0 ? '0' : String(n) + suffix;
    OSR.save();
  }

  function applyEntryDamage(ent, amount, target) {
    amount = Math.max(0, Math.round(amount));
    if (target === 'hd') {
      const before = MonsterParse.hdNum(ent.hd);
      setEntryHd(ent, before - amount);
      return { before: before, after: Math.max(0, before - amount), unit: 'HD' };
    }
    const before = entryHp(ent);
    const after = Math.max(0, before - amount);
    setEntryHp(ent, after); // handles character consumable link + save + renderConsumables
    return { before: before, after: after, unit: 'HP' };
  }

  function applyDamageToSelected() {
    const ent = selectedEntry();
    if (!ent || !OSR.lastRoll) return;
    const lastRoll = OSR.lastRoll;
    const round = OSR.state.combat.round || 1;
    const sh = !!(OSR.state.settings && OSR.state.settings.scarletHeroes);

    if (!sh) {
      const dmg = Math.max(0, lastRoll.total);
      const res = applyEntryDamage(ent, dmg, 'hp');
      OSR.pushNote(ent.name, 'damage ' + dmg + ' → ' + res.unit + ' ' + res.before + '→' + res.after,
        (lastRoll.normalized || '') + ' = ' + lastRoll.total + '  ·  round ' + round);
      renderCombat();
      return;
    }

    // Scarlet Heroes: translate each die, bonus onto the single highest die first.
    let vals = (lastRoll.dice || []).filter(d => d.sign > 0).map(d => d.value);
    let flatNote = '';
    if (lastRoll.flat) {
      if (vals.length) {
        let mi = 0;
        for (let i = 1; i < vals.length; i++) if (vals[i] > vals[mi]) mi = i;
        const boosted = vals[mi] + lastRoll.flat;
        flatNote = 'bonus ' + (lastRoll.flat >= 0 ? '+' : '') + lastRoll.flat +
          ' on highest die (' + vals[mi] + '→' + boosted + '); ';
        vals[mi] = boosted;
      } else {
        vals = [lastRoll.flat];
        flatNote = 'no dice — treating flat ' + lastRoll.flat + ' as one die; ';
      }
    }
    const perDie = vals.map(v => v + '→' + shDie(v));
    const shTotal = vals.reduce((a, v) => a + shDie(v), 0);

    let res, extra = '';
    if (ent.kind === 'monster' && shTotal > 0 &&
        MonsterParse.hdNum(ent.hd) <= 0 && entryHp(ent) > 0) {
      // No hit dice left but still standing on HP — this SH hit finishes it.
      const before = entryHp(ent);
      setEntryHp(ent, 0);
      res = { before: before, after: 0, unit: 'HP' };
      extra = '  (0 HD → HP to 0)';
    } else {
      res = applyEntryDamage(ent, shTotal, ent.kind === 'monster' ? 'hd' : 'hp');
    }
    OSR.pushNote(ent.name,
      'SH damage ' + shTotal + ' → ' + res.unit + ' ' + res.before + '→' + res.after + extra,
      'roll ' + (lastRoll.normalized || '') + ' dice [' + vals.join(', ') + ']; ' + flatNote +
      'per-die [' + perDie.join(', ') + ']; sum ' + shTotal + '  ·  round ' + round);
    renderCombat();
  }

  let saveT = null;
  function saveDebounced() { clearTimeout(saveT); saveT = setTimeout(OSR.save, 250); }
  const fmtMod = n => (n >= 0 ? '+' : '') + n;

  function combatCharFor(e) {
    return e.kind === 'character' ? OSR.state.characters.find(c => c.id === e.charId) || null : null;
  }
  function hpConsumable(ch) {
    if (!ch) return null;
    return OSR.state.consumables.find(c => c.name === OSR.hpTrackerLabel(ch)) || null;
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
      if (hpc) { hpc.value = v; OSR.clampConsumable(hpc); OSR.save(); OSR.renderConsumables(); return; }
    }
    e.hp = v < 0 ? 0 : v;
    OSR.save();
  }
  function entryDown(e) {
    return entryHp(e) <= 0;
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
  function atkHitLabel(a) {
    return (a.label || 'attack') + (a.count > 1 ? ' ×' + a.count : '') + ' ' + fmtMod(a.toHit || 0);
  }
  function atkDmgLabel(a) {
    return 'dmg ' + a.damage + (a.note ? ' (' + a.note + ')' : '');
  }
  function selectedEntry() {
    return OSR.state.combat.entries.find(e => e.id === OSR.state.combat.selectedId) || null;
  }

  function uniqueName(base) {
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('^' + esc + '(?: \\((\\d+)\\))?$');
    const same = OSR.state.combat.entries.filter(e => rx.test(e.name));
    if (!same.length) return base;
    const bare = same.find(e => e.name === base);
    if (bare) bare.name = base + ' (1)';
    const taken = new Set(OSR.state.combat.entries.map(e => e.name));
    let n = 2;
    while (taken.has(base + ' (' + n + ')')) n++;
    return base + ' (' + n + ')';
  }

  function addCharEntry(charId) {
    const ch = OSR.state.characters.find(c => c.id === charId);
    if (!ch) return;
    // Seed the linked HP tracker from the sheet if it's still the untouched 0/0 default.
    const det = charDetectHp(ch);
    if (det) {
      OSR.ensureHpTracker(ch);
      const hpc = hpConsumable(ch);
      if (hpc && (hpc.value || 0) === 0 && (hpc.max || 0) === 0) { hpc.value = det.value; hpc.max = det.max; }
      OSR.save();
      OSR.renderConsumables();
    }
    const e = { id: uid(), kind: 'character', charId: ch.id, name: uniqueName(ch.name), hd: '', hp: 0, side: 'ally', statuses: [] };
    OSR.state.combat.entries.push(e);
    if (!OSR.state.combat.activeId) OSR.state.combat.activeId = e.id;
    OSR.state.combat.selectedId = e.id;
    OSR.save();
    renderCombat();
  }
  function addMonsterEntry(def) {
    const e = {
      id: uid(), kind: 'monster', name: uniqueName(def.name),
      monster: JSON.parse(JSON.stringify(def)),
      hd: def.hd || '', hp: def.hp || 0, maxHp: def.hp || 0, side: 'enemy', statuses: []
    };
    OSR.state.combat.entries.push(e);
    if (!OSR.state.combat.activeId) OSR.state.combat.activeId = e.id;
    OSR.state.combat.selectedId = e.id;
    OSR.save();
    renderCombat();
  }
  function removeEntry(id) {
    const ents = OSR.state.combat.entries;
    const i = ents.findIndex(x => x.id === id);
    if (i < 0) return;
    ents.splice(i, 1);
    const fallback = ents.length ? ents[Math.min(i, ents.length - 1)].id : null;
    if (OSR.state.combat.activeId === id) OSR.state.combat.activeId = fallback;
    if (OSR.state.combat.selectedId === id) OSR.state.combat.selectedId = fallback;
    OSR.save();
    renderCombat();
  }
  function cycleSide(id) {
    const e = OSR.state.combat.entries.find(x => x.id === id);
    if (!e) return;
    e.side = e.side === 'ally' ? 'enemy' : (e.side === 'enemy' ? 'neutral' : 'ally');
    OSR.save();
    renderTracker();
  }
  function toggleSide(id) {
    const e = OSR.state.combat.entries.find(x => x.id === id);
    if (!e) return;
    e.side = e.side === 'ally' ? 'enemy' : 'ally';
    OSR.pushNote(e.name, 'side → ' + e.side, 'round ' + (OSR.state.combat.round || 1));
    OSR.save();
    renderTracker();
    renderCombatantDetail();
  }
  function setSelected(id) {
    OSR.state.combat.selectedId = id;
    saveDebounced();
    renderTracker();
    renderCombatantDetail();
    updateApplyButton();
  }

  /* ---- status conditions ---- */
  function statusIconOf(name) {
    const c = OSR.state.conditions.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    return (c && c.icon) || OSR.DEFAULT_STATUS_ICON;
  }
  function statusDescOf(name) {
    const c = OSR.state.conditions.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    return (c && c.desc) || '';
  }
  function toggleStatus(entryId, name) {
    const e = OSR.state.combat.entries.find(x => x.id === entryId);
    if (!e) return;
    if (!Array.isArray(e.statuses)) e.statuses = [];
    const round = OSR.state.combat.round || 1;
    const i = e.statuses.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) {
      e.statuses.splice(i, 1);
      OSR.pushNote(e.name, 'lost "' + name + '"', 'round ' + round);
    } else {
      e.statuses.push({ name: name, icon: statusIconOf(name), round: round, ts: Date.now() });
      OSR.pushNote(e.name, 'gained "' + name + '"', 'round ' + round);
    }
    OSR.save();
    renderTracker();
    renderCombatantDetail();
  }
  function removeStatus(entryId, name) {
    const e = OSR.state.combat.entries.find(x => x.id === entryId);
    if (!e || !Array.isArray(e.statuses)) return;
    const i = e.statuses.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
    if (i < 0) return;
    e.statuses.splice(i, 1);
    OSR.pushNote(e.name, 'lost "' + name + '"', 'round ' + (OSR.state.combat.round || 1));
    OSR.save();
    renderTracker();
    renderCombatantDetail();
  }
  function defineCondition(name, desc) {
    name = String(name || '').trim();
    if (!name) return null;
    let c = OSR.state.conditions.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (c) { if (desc) c.desc = desc; }
    else {
      c = { id: uid(), name: name, icon: OSR.DEFAULT_STATUS_ICON, desc: String(desc || '').trim() };
      OSR.state.conditions.push(c);
      OSR.state.conditions.sort((a, b) => a.name.localeCompare(b.name));
    }
    OSR.save();
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
    const e = OSR.state.combat.entries.find(en => en.id === entryId);
    if (!e) return;
    ctxEntryId = entryId;
    const active = new Set((e.statuses || []).map(s => s.name.toLowerCase()));
    const items = OSR.state.conditions
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => {
        const on = active.has(c.name.toLowerCase());
        return '<button class="ctx-item' + (on ? ' is-on' : '') + '" data-name="' + escapeHtml(c.name) + '" title="' + escapeHtml(c.desc) + '">' +
          '<i class="fa-solid ' + escapeHtml(c.icon || OSR.DEFAULT_STATUS_ICON) + '"></i>' +
          '<span>' + escapeHtml(c.name) + '</span>' +
          (on ? '<i class="fa-solid fa-check ctx-check"></i>' : '') +
          '</button>';
      }).join('');
    const other = e.side === 'ally' ? 'enemy' : 'ally';
    const m = $('#ctx-menu');
    m.innerHTML =
      '<div class="ctx-head">' + escapeHtml(e.name) + '</div>' +
      '<button class="ctx-item ctx-side">' +
        '<i class="fa-solid ' + (other === 'ally' ? 'fa-shield-halved' : 'fa-skull') + '"></i>' +
        '<span>Change side &rarr; ' + other + '</span></button>' +
      '<div class="ctx-sub">Status</div>' +
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
    if (item.classList.contains('ctx-side')) {
      toggleSide(ctxEntryId);
      closeCtxMenu();
      return;
    }
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
    return OSR.state.combat.entries.findIndex(e => e.id === OSR.state.combat.activeId);
  }
  function nextTurn() {
    const ents = OSR.state.combat.entries;
    if (!ents.length) return;
    let i = turnIndex();
    if (i < 0) { OSR.state.combat.activeId = ents[0].id; OSR.save(); renderCombat(); return; }
    i++;
    if (i >= ents.length) { i = 0; OSR.state.combat.round = (OSR.state.combat.round || 1) + 1; }
    OSR.state.combat.activeId = ents[i].id;
    OSR.save();
    renderCombat();
  }
  function prevTurn() {
    const ents = OSR.state.combat.entries;
    if (!ents.length) return;
    let i = turnIndex();
    if (i <= 0) {
      if ((OSR.state.combat.round || 1) > 1) { OSR.state.combat.round--; i = ents.length - 1; }
      else i = 0;
    } else i--;
    OSR.state.combat.activeId = ents[i].id;
    OSR.save();
    renderCombat();
  }
  function setRound(delta) {
    OSR.state.combat.round = Math.max(1, (OSR.state.combat.round || 1) + delta);
    OSR.save();
    renderCombatBar();
  }
  function moveSelection(dir) {
    const ents = OSR.state.combat.entries;
    if (!ents.length) return;
    let i = ents.findIndex(e => e.id === OSR.state.combat.selectedId);
    if (i < 0) i = dir > 0 ? -1 : 0;
    i = (i + dir + ents.length) % ents.length;
    OSR.state.combat.selectedId = ents[i].id;
    saveDebounced();
    renderTracker();
    renderCombatantDetail();
    updateApplyButton();
    const row = $('#tracker-list [data-id="' + ents[i].id + '"]');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  /* ---- combat rolls ---- */
  function rollEntryAttack(e, atk) {
    const bonus = atk.toHit != null ? atk.toHit : (e.monster && e.monster.atkBonus) || 0;
    const r = OSR.evalFormula('1d20' + fmtMod(bonus));
    OSR.pushLog(e.name, (atk.label || 'attack') + ' to-hit ' + fmtMod(bonus), r.total, r.detail);
  }
  function rollEntrySave(e, key) {
    const m = e.monster;
    if (m && m.saveTargets && m.saveTargets[key] != null) {
      const tgt = m.saveTargets[key];
      const r = OSR.evalFormula('1d20');
      OSR.pushLog(e.name, 'Save ' + key, r.total, 'vs ' + tgt + ' → ' + (r.total >= tgt ? 'SAVE' : 'FAIL'));
    } else if (m && m.stats && m.stats[key] != null) {
      const mod = m.stats[key];
      const r = OSR.evalFormula('1d20' + fmtMod(mod));
      OSR.pushLog(e.name, 'Save ' + key + ' ' + fmtMod(mod), r.total, r.detail + ' — GM sets DC');
    } else {
      const r = OSR.evalFormula('1d20');
      OSR.pushLog(e.name, 'Save ' + key, r.total, r.detail);
    }
  }
  function rollEntryMorale(e) {
    const ml = e.monster && e.monster.moraleML;
    const r = OSR.evalFormula('2d6');
    if (ml != null) OSR.pushLog(e.name, 'Morale', r.total, r.detail + ' vs ML ' + ml + ' → ' + (r.total <= ml ? 'holds' : 'breaks'));
    else OSR.pushLog(e.name, 'Morale', r.total, r.detail + ' (2d6 — set ML to auto-judge)');
  }

  /* ---- combat render ---- */
  function renderCombat() {
    renderCombatBar();
    renderTracker();
    renderCombatantDetail();
    updateApplyButton();
  }
  function renderCombatBar() {
    $('#cb-round').textContent = OSR.state.combat.round || 1;
    const act = OSR.state.combat.entries.find(e => e.id === OSR.state.combat.activeId);
    $('#cb-turn-name').textContent = act ? act.name : '—';
    const sel = $('#cb-add-char');
    sel.innerHTML = '<option value="">+ Add character…</option>' +
      OSR.charactersForSystem().map(c => '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>').join('');
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
    if (e.id === OSR.state.combat.activeId) cls.push('is-active');
    if (e.id === OSR.state.combat.selectedId) cls.push('is-selected');
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
        (e.id === OSR.state.combat.activeId ? '<span class="cbt-turnflag">◀ turn</span>' : '') +
        '<button class="cbt-remove" title="Remove from combat">✕</button>' +
      '</div>' +
      '<div class="cbt-line2">' +
        (e.kind === 'monster'
          ? '<span class="chip cbt-step"><span class="chip-l">HD</span>' +
              '<button class="cbt-stepbtn cbt-hd-dec" type="button" aria-label="HD −1">&minus;</button>' +
              '<input class="cbt-hd" type="text" inputmode="decimal" value="' + escapeHtml(String(e.hd || '')) + '" />' +
              '<button class="cbt-stepbtn cbt-hd-inc" type="button" aria-label="HD +1">+</button></span>'
          : '') +
        '<span class="chip cbt-step"><span class="chip-l">HP</span>' +
          '<button class="cbt-stepbtn cbt-hp-dec" type="button" aria-label="HP −1">&minus;</button>' +
          '<input class="cbt-hp" type="number" step="1" value="' + entryHp(e) + '" />' +
          '<span class="cbt-max">/ ' + (maxHp || '—') + '</span>' +
          '<button class="cbt-stepbtn cbt-hp-inc" type="button" aria-label="HP +1">+</button></span>' +
        '<span class="chip">AC ' + escapeHtml(String(ac)) + '</span>' +
        (sv ? '<span class="chip chip-dim">Sv ' + escapeHtml(sv) + '</span>' : '') +
        (atk ? '<span class="chip chip-dim">' + escapeHtml(atk) + '</span>' : '') +
        statusTagsHtml(e) +
      '</div>' +
    '</li>';
  }
  function renderTracker() {
    const list = $('#tracker-list');
    const ents = OSR.state.combat.entries;
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
          m.attacks.map((a, i) =>
            '<span class="cd-atk-pair">' +
              '<button class="btn cbt-atk" data-i="' + i + '" title="Roll 1d20 to hit">' + escapeHtml(atkHitLabel(a)) + '</button>' +
              (a.damage ? '<button class="btn cbt-dmg" data-i="' + i + '" title="Roll damage only">' + escapeHtml(atkDmgLabel(a)) + '</button>' : '') +
            '</span>').join('') +
          '<button class="btn cbt-atkroll" title="Roll 1d20 to hit">d20' + fmtMod(m.atkBonus || 0) + '</button></div>';
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
      h += '<div class="cd-stats">' +
        chip('HP', entryHp(ent) + ' / ' + (entryMaxHp(ent) || '—') + '  (linked to sheet)') + '</div>';
      if (ch) h += '<div class="cd-sheet markdown-body">' + OSR.renderCharMarkdown(ch.body) + '</div>';
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
    OSR.annotate(host, { vars: OSR.charVars(combatCharFor(ent)) }); // [] for a monster entry
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
    const ents = OSR.state.combat.entries;
    const from = ents.findIndex(x => x.id === dragId);
    if (from < 0) return;
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const [moved] = ents.splice(from, 1);
    let to = ents.findIndex(x => x.id === row.dataset.id);
    if (to < 0) to = ents.length;
    else if (after) to++;
    ents.splice(to, 0, moved);
    OSR.save();
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
    if (e.target.closest('.cbt-hp-inc')) { stepEntry(id, 'hp', +1); return; }
    if (e.target.closest('.cbt-hp-dec')) { stepEntry(id, 'hp', -1); return; }
    if (e.target.closest('.cbt-hd-inc')) { stepEntry(id, 'hd', +1); return; }
    if (e.target.closest('.cbt-hd-dec')) { stepEntry(id, 'hd', -1); return; }
    setSelected(id);
  }
  function stepEntry(id, field, delta) {
    const ent = OSR.state.combat.entries.find(x => x.id === id);
    if (!ent) return;
    OSR.state.combat.selectedId = id;
    if (field === 'hp') setEntryHp(ent, entryHp(ent) + delta);
    else if (ent.kind === 'monster') setEntryHd(ent, MonsterParse.hdNum(ent.hd) + delta);
    renderTracker();
    renderCombatantDetail();
    updateApplyButton();
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
    const ent = OSR.state.combat.entries.find(x => x.id === row.dataset.id);
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
    const dmgBtn = e.target.closest('.cbt-dmg');
    if (dmgBtn && ent.monster) {
      const a = ent.monster.attacks[+dmgBtn.dataset.i];
      if (a && a.damage) OSR.doRoll(a.damage, ent.name); // rolls damage only; enables "Apply damage"
      return;
    }
    const atkBtn = e.target.closest('.cbt-atk');
    if (atkBtn && ent.monster) { const a = ent.monster.attacks[+atkBtn.dataset.i]; if (a) rollEntryAttack(ent, a); return; }
    if (e.target.closest('.cbt-save')) { rollEntrySave(ent, e.target.closest('.cbt-save').dataset.k); return; }
    if (e.target.closest('.cbt-morale')) { rollEntryMorale(ent); return; }
    if (e.target.closest('.cbt-atkroll')) {
      const b = (ent.monster && ent.monster.atkBonus) || 0;
      const r = OSR.evalFormula('1d20' + fmtMod(b));
      OSR.pushLog(ent.name, 'Attack ' + fmtMod(b), r.total, r.detail);
      return;
    }
    const roll = e.target.closest('.roll');
    if (roll) OSR.doRoll(roll.dataset.formula, ent.name, OSR.charVars(combatCharFor(ent)));
  }
  function onCombatKey(e) {
    if (!$('#tab-combat').classList.contains('is-active')) return;
    if (!$('#monster-modal').hidden || !$('#monster-edit-modal').hidden || !$('#paste-modal').hidden) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); nextTurn(); }
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); prevTurn(); }
  }

  function wireCombat() {
    $('#cb-round-dec').addEventListener('click', () => setRound(-1));
    $('#cb-round-inc').addEventListener('click', () => setRound(1));
    $('#cb-turn-prev').addEventListener('click', prevTurn);
    $('#cb-turn-next').addEventListener('click', nextTurn);
    $('#cb-add-char').addEventListener('change', e => { if (e.target.value) { addCharEntry(e.target.value); e.target.value = ''; } });
    $('#cb-add-monster').addEventListener('click', OSR.openMonsterModal);
    $('#cb-clear').addEventListener('click', () => {
      if (!OSR.state.combat.entries.length || confirm('Clear all combatants and reset to round 1?')) {
        OSR.state.combat = { round: 1, activeId: null, selectedId: null, entries: [] };
        OSR.save();
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
    document.addEventListener('scroll', e => {
      // ignore scrolling that happens *inside* the menu itself
      if (e.target instanceof Element && e.target.closest('#ctx-menu')) return;
      closeCtxMenu();
    }, true);
    window.addEventListener('resize', closeCtxMenu);

    OSR.wireMonsterModals();

    document.addEventListener('keydown', onCombatKey);

    $('#dice-apply').addEventListener('click', applyDamageToSelected);
  }

  Object.assign(OSR, {
    shDie, updateApplyButton, setEntryHd, applyEntryDamage, applyDamageToSelected,
    combatCharFor, hpConsumable, entryHp, entryMaxHp, setEntryHp, entryDown,
    charQuickAC, charDetectHp, acDisplay, atkHitLabel, atkDmgLabel, selectedEntry,
    uniqueName, addCharEntry, addMonsterEntry, removeEntry, cycleSide, toggleSide, setSelected,
    statusIconOf, statusDescOf, toggleStatus, removeStatus, defineCondition,
    closeCtxMenu, openCtxMenu, onCtxMenuClick,
    turnIndex, nextTurn, prevTurn, setRound, moveSelection,
    rollEntryAttack, rollEntrySave, rollEntryMorale,
    renderCombat, renderCombatBar, statusTagsHtml, rowHtml, renderTracker, chip, renderCombatantDetail,
    onTrackerClick, stepEntry, onTrackerContextMenu, onTrackerInput, onTrackerChange, onDetailClick, onCombatKey,
    wireCombat
  });
})(window.OSR = window.OSR || {});
