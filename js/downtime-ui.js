/* js/downtime-ui.js — the Downtime tab (Shadowdark only): carousing, downtime
 * activities, gambling, and the full rules text.
 *
 * The party is the campaign's Shadowdark characters. Level, XP, luck tokens,
 * stat modifiers, and the class come from each sheet (OSR.Downtime.readSheet).
 * Luck tokens and wealth come from the character's "Luck (Name)" and
 * "GP (Name)" trackers when the sheet has them ("**Luck** 0/1 · **GP** 5/0",
 * see syncResourceTrackers in js/core.js). Without a tracker, luck tokens are
 * in the sheet text and wealth in the record. XP is in the sheet text (or the
 * record). Everything else (renown, failed attempts, lasting effects, the
 * log) is in state.downtime.records[charId].
 * state.downtime.ui holds the form choices. Results and Undo are per page load.
 */
(function (OSR) {
  'use strict';

  const $ = OSR.$;
  const esc = OSR.escapeHtml;
  const D = () => OSR.Downtime;
  const data = () => OSR.data.downtime;
  const REC_FIELDS = ['gp', 'renown', 'failures', 'ongoing', 'log', 'carouseMod', 'nextCarouse', 'benefitAdv',
    'cancelMishap', 'usedDowntime', 'bardAdv', 'jeweledEye'];
  const VIEWS = [['party', 'Party'], ['carousing', 'Carousing'], ['activities', 'Activities'], ['gambling', 'Gambling'], ['rules', 'All rules']];
  const VIEW_KEY = 'osr_downtime_view';

  let view = 'party';
  try { view = localStorage.getItem(VIEW_KEY) || 'party'; } catch (e) { /* the first view */ }
  let results = [];        // the last carousing roll, per PC
  let checkResult = null;  // the last activity check: { title, lines }
  let undo = null;         // { label, records, bodies, trackers } before the last automated change
  let wt = null;           // the last Wizards and Thieves game
  let tableRolls = {};     // table id → the row of its last roll

  const dt = () => OSR.state.downtime;
  const ui = () => dt().ui;
  const isShadowdark = () => OSR.currentSystem() === 'shadowdark';
  const party = () => OSR.state.characters.filter(c => OSR.charSystemKey(c) === 'shadowdark');
  const md = s => esc(String(s || '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  const fmtMod = n => D().fmtMod(n);
  const gp = n => D().gp(n);
  const srcBadge = (source, page) => '<span class="dt-src" title="' + esc((data().sources || {})[source] || source) + '">' +
    esc(({ core: 'Core', wrpg: 'WR Player', wrgm: 'WR GM', gmc: 'GM Comp.', pc: 'Player Comp.' })[source] || source) + (page ? ' p. ' + page : '') + '</span>';

  /* ---- PCs: sheet + record ---- */

  function record(id) {
    return Object.assign(D().newRecord(), dt().records[id] || {});
  }

  // The character's "Luck (Name)" or "GP (Name)" tracker, or undefined.
  const TRACKED = { luck: 'Luck', gp: 'GP' };
  function tracker(ch, key) {
    const label = TRACKED[key] + ' (' + ch.name + ')';
    return OSR.state.consumables.find(c => c.name === label);
  }

  function pcOf(ch) {
    const sheet = D().readSheet(ch.body, data().classes);
    const rec = record(ch.id);
    const luckT = tracker(ch, 'luck'), gpT = tracker(ch, 'gp');
    return Object.assign({}, sheet, rec, {
      id: ch.id, name: ch.name || 'Character',
      hd: rec.hd || sheet.hd, caster: rec.caster || sheet.caster,
      renown: rec.renown == null ? sheet.mods.CHA : rec.renown,
      xp: D().sheetHas(ch.body, 'XP') ? sheet.xp : (rec.xp || 0),
      luck: luckT ? luckT.value : D().sheetHas(ch.body, 'Luck') ? sheet.luck : (rec.luck || 0),
      gp: gpT ? gpT.value : rec.gp
    });
  }

  function snapshot(label) {
    const bodies = {}, trackers = {};
    party().forEach(c => {
      bodies[c.id] = c.body;
      Object.keys(TRACKED).forEach(k => { const t = tracker(c, k); if (t) trackers[t.id] = t.value; });
    });
    undo = { label, records: JSON.parse(JSON.stringify(dt().records)), bodies, trackers };
  }

  // Writes a changed PC back: luck tokens and wealth into their trackers;
  // XP and luck tokens without a tracker into the sheet (or the record); the
  // rest into the record. A tracker clamps to its max (luck tokens: 1, core p. 79).
  function commit(pc) {
    const ch = OSR.state.characters.find(c => c.id === pc.id);
    if (!ch) return;
    const rec = record(pc.id);
    let body = ch.body;
    if (D().sheetHas(body, 'XP')) body = D().writeSheetNumber(body, 'XP', pc.xp); else rec.xp = pc.xp;
    const luckT = tracker(ch, 'luck'), gpT = tracker(ch, 'gp');
    if (luckT) { luckT.value = pc.luck; OSR.clampConsumable(luckT); pc.luck = luckT.value; }
    else if (D().sheetHas(body, 'Luck')) body = D().writeSheetNumber(body, 'Luck', pc.luck); else rec.luck = pc.luck;
    if (gpT) { gpT.value = pc.gp; OSR.clampConsumable(gpT); pc.gp = gpT.value; }
    REC_FIELDS.forEach(k => { rec[k] = pc[k]; });
    dt().records[pc.id] = rec;
    if (body !== ch.body) { ch.body = body; ch.updatedAt = Date.now(); }
  }

  function finish(note) {
    OSR.save();
    if (note) OSR.pushNote('Downtime', note);
    if (OSR.refreshCharUI) OSR.refreshCharUI(); // the sheet shows the new XP and luck
    if (OSR.renderConsumables) OSR.renderConsumables(); // the Luck and GP trackers
    renderDowntime();
  }

  function setRec(id, f) {
    const pc = pcOf(OSR.state.characters.find(c => c.id === id));
    f(pc);
    commit(pc);
  }

  /* ---- the tab button (Shadowdark only) ---- */

  function applyDowntimeTab() {
    const btn = document.querySelector('.tab-btn[data-tab="downtime"]');
    if (!btn) return;
    btn.hidden = !isShadowdark();
    if (!btn.hidden) return;
    if (OSR.splitTab && OSR.splitTab() === 'downtime') OSR.setSplit(null);
    if (btn.classList.contains('is-active')) OSR.showTab('character');
  }

  /* ---- render ---- */

  function renderDowntime() {
    const root = $('#dt-root');
    if (!root) return;
    if (!data()) { root.innerHTML = '<p class="hint">The downtime rules did not load (data/downtime-shadowdark.json).</p>'; return; }
    if (!VIEWS.some(v => v[0] === view)) view = 'party';
    const body = view === 'carousing' ? carousingHtml() : view === 'activities' ? activitiesHtml()
      : view === 'gambling' ? gamblingHtml() : view === 'rules' ? rulesHtml() : partyHtml();
    root.innerHTML =
      '<div class="dt-head">' +
        '<div class="dt-views">' + VIEWS.map(v => '<button type="button" class="btn' + (v[0] === view ? ' btn-primary' : '') + '" data-dt-view="' + v[0] + '">' + v[1] + '</button>').join('') + '</div>' +
        (undo ? '<button type="button" class="btn" data-act="undo"><i class="fa-solid fa-rotate-left"></i> Undo ' + esc(undo.label) + '</button>' : '') +
      '</div>' +
      '<p class="hint">Between adventures, each PC does <b>one</b> downtime activity (core p. 91). The tab rolls the outcome tables and applies XP, gp, renown, luck tokens, next-roll bonuses, and treasure. XP and luck tokens go into the character sheet.</p>' +
      '<div class="dt-opts-row">' +
        '<label class="comp-cat"><input type="checkbox" data-ui="wr"' + (ui().wr ? ' checked' : '') + ' /> Western Reaches rules (renown, settlement limits, activities)</label>' +
        '<label class="comp-cat"><input type="checkbox" data-ui="oneToOne"' + (ui().oneToOne ? ' checked' : '') + ' /> 1:1 time (show how many days each activity takes)</label>' +
      '</div>' +
      body;
  }

  function linesHtml(lines) {
    return '<ul class="dt-lines">' + lines.map(l =>
      '<li class="dt-' + l.kind + '">' +
        (l.roll !== undefined ? '<span class="dt-roll">' + esc(String(l.roll)) + '</span>' : '') +
        '<span>' + (l.kind === 'benefit' ? '<b>Benefit: </b>' : l.kind === 'mishap' ? '<b>Mishap: </b>' : l.kind === 'treasure' ? '<b>Gain: </b>' : '') +
        esc(l.text) + (l.tableId && data().tables[l.tableId] ? ' <span class="hint">(' + esc(data().tables[l.tableId].title) + ')</span>' : '') + '</span>' +
      '</li>').join('') + '</ul>';
  }

  const numIn = (attrs, value, w) => '<input type="number" class="dt-num" style="width:' + (w || 56) + 'px" value="' + esc(String(value)) + '" ' + attrs + ' />';
  const check = (attrs, on, label) => '<label class="comp-cat"><input type="checkbox" ' + attrs + (on ? ' checked' : '') + ' /> ' + label + '</label>';

  function partyHtml() {
    const list = party();
    if (!list.length) return '<p class="hint">No Shadowdark characters in this campaign. Add one on the Character tab.</p>';
    const wr = ui().wr;
    return '<div class="dt-toolbar"><button type="button" class="btn" data-act="new-break" title="Every PC gets one downtime activity again">New break between adventures</button></div>' +
      '<div class="dt-grid">' + list.map(ch => {
        const p = pcOf(ch);
        const need = D().xpToLevel(p.level);
        const id = esc(p.id);
        return '<section class="dt-card" data-id="' + id + '">' +
          '<div class="dt-card-head"><h3>' + esc(p.name) + '</h3>' +
            '<span class="badge' + (p.usedDowntime ? ' dt-used' : '') + '">' + (p.usedDowntime ? 'Downtime used' : 'Downtime free') + '</span></div>' +
          '<div class="hint">' + esc(p.className || 'Class not found on the sheet') + ' · Level ' + p.level + ' · XP ' + p.xp + '/' + need + ' · Luck ' + p.luck + ' · ' +
            D().STATS.map(s => s + ' ' + fmtMod(p.mods[s])).join(' ') + '</div>' +
          (p.xp >= need ? '<div class="dt-levelup">Ready to level up. <button type="button" class="btn btn-primary" data-act="levelup" data-id="' + id + '">Level up' + (wr ? ' (+1 renown)' : '') + '</button></div>' : '') +
          '<div class="dt-fields">' +
            '<label>Wealth (gp) ' + numIn('data-rec="gp" data-id="' + id + '" min="0"', p.gp, 80) + '</label>' +
            (wr ? '<label>Renown ' + numIn('data-rec="renown" data-id="' + id + '"', p.renown) + '</label>' +
              '<button type="button" class="btn" data-act="renown-cha" data-id="' + id + '" title="Start value: CHA modifier (PGWR p. 233)">= CHA mod</button>' : '') +
            '<label>Hit die <select data-rec="hd" data-id="' + id + '">' + ['', 'd4', 'd6', 'd8'].map(h => '<option value="' + h + '"' + (record(p.id).hd === h ? ' selected' : '') + '>' + (h ? (h === 'd8' ? 'd8+' : h) : 'From class (' + p.hd + ')') + '</option>').join('') + '</select></label>' +
            '<label>Spellcasting <select data-rec="caster" data-id="' + id + '">' + ['', 'none', 'INT', 'WIS', 'CHA'].map(h => '<option value="' + h + '"' + (record(p.id).caster === h ? ' selected' : '') + '>' + (h ? (h === 'none' ? 'None' : h) : 'From class (' + p.caster + ')') + '</option>').join('') + '</select></label>' +
          '</div>' +
          (wr ? '<div class="hint">Carousing ' + fmtMod(D().renownBonus(p.renown)) + '. ' + esc(D().renownLabel(p.renown)) + '</div>' : '') +
          '<details class="dt-more"><summary>Bonuses and talents</summary><div class="dt-fields">' +
            check('data-rec="bardAdv" data-id="' + id + '"', p.bardAdv, 'Bard talent: ADV on downtime checks') +
            check('data-rec="jeweledEye" data-id="' + id + '"', p.jeweledEye, 'Jeweled Eye: ADV on learning') +
            '<label title="For example −2 from a cursed armor (GMC p. 109)">Standing carousing mod ' + numIn('data-rec="carouseMod" data-id="' + id + '"', p.carouseMod) + '</label>' +
            '<label title="One time. Benefits and mishaps set it. The Bards faction gives +2 (PGWR p. 92).">Next carousing roll ' + numIn('data-rec="nextCarouse" data-id="' + id + '"', p.nextCarouse) + '</label>' +
            check('data-rec="benefitAdv" data-id="' + id + '"', p.benefitAdv, 'Next benefit roll has ADV') +
            check('data-rec="cancelMishap" data-id="' + id + '"', p.cancelMishap, 'Cancel next mishap') +
            check('data-rec="usedDowntime" data-id="' + id + '"', p.usedDowntime, 'Downtime used this break') +
          '</div></details>' +
          '<details class="dt-more"' + (p.ongoing.length && p.ongoing.length <= 6 ? ' open' : '') + '><summary>Contacts, debts, items, and lasting effects (' + p.ongoing.length + ')</summary>' +
            '<ul class="dt-ongoing">' + p.ongoing.map((o, i) => '<li><span>' + esc(o) + '</span><button type="button" class="btn row-del" data-act="ongoing-del" data-id="' + id + '" data-i="' + i + '" title="Remove">&times;</button></li>').join('') + '</ul>' +
            '<form class="dt-inline" data-form="ongoing" data-id="' + id + '"><input type="text" placeholder="Add a note" /><button class="btn">Add</button></form>' +
          '</details>' +
          (p.log.length ? '<details class="dt-more"><summary>Log (' + p.log.length + ')</summary><ul class="dt-log">' +
            p.log.map(l => '<li><span class="hint">' + esc(new Date(l.ts).toLocaleDateString()) + '</span> ' + esc(l.text) + '</li>').join('') + '</ul></details>' : '') +
        '</section>';
      }).join('') + '</div>';
  }

  function currentSet() {
    const sets = data().eventSets.filter(s => ui().wr || (s.source !== 'wrpg'));
    return { sets, set: sets.find(s => s.kind === ui().kind) || sets[0] };
  }

  function settlementLimit() {
    if (!ui().wr) return Infinity;
    const s = data().settlements.find(x => x.key === ui().settlement) || data().settlements[0];
    return s.limit == null ? Infinity : s.limit;
  }

  function carouseSetup() {
    const { sets, set } = currentSet();
    const ev = set.events[Math.min(ui().eventIdx, set.events.length - 1)];
    const ids = ui().ids.filter(id => party().some(c => c.id === id));
    const chosen = set.solo ? ids.slice(0, 1) : ids;
    const share = Math.ceil(ev.cost / Math.max(1, chosen.length));
    const carousing = set.kind === 'core' || set.kind === 'wr';
    const wr = ui().wr && carousing; // renown, the bard talent, and the brewery modify carousing only
    const group = [];
    if (wr && ui().bardGroup) group.push({ label: 'bard', value: 2 });
    if (wr && ui().brewery && ui().settlement === 'bastion') group.push({ label: 'brewery', value: 1 });
    if (ui().other) group.push({ label: 'other', value: ui().other });
    return { sets, set, ev, chosen, share, group, useRenown: wr && ui().useRenown, wr };
  }

  function carousingHtml() {
    const c = carouseSetup();
    const limit = settlementLimit();
    const pcs = party().map(pcOf);
    const broke = pcs.filter(p => c.chosen.indexOf(p.id) !== -1 && p.gp < c.share);
    const groupTotal = c.group.reduce((a, b) => a + b.value, 0);
    return '<div class="dt-views dt-sets">' + c.sets.map(s => '<button type="button" class="btn' + (s.kind === c.set.kind ? ' btn-primary' : '') + '" data-act="set" data-kind="' + esc(s.kind) + '">' + esc(s.name) + '</button>').join('') + '</div>' +
      '<p>' + esc(c.set.intro) + ' ' + srcBadge(c.set.source, c.set.page) + '</p>' +
      '<div class="dt-carouse">' +
        '<section class="dt-card"><h3>1. Event</h3>' +
          (ui().wr ? '<label class="dt-field">Where (WR GM p. 30 limits) <select data-ui="settlement">' + data().settlements.map(s => '<option value="' + esc(s.key) + '"' + (s.key === ui().settlement ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') + '</select></label>' : '') +
          '<table class="dt-table"><thead><tr><th></th><th>Cost</th><th>Bonus</th><th>Event</th></tr></thead><tbody>' +
          c.set.events.map((e, i) => {
            const off = e.cost > limit;
            return '<tr class="' + (e === c.ev ? 'is-on' : '') + (off ? ' is-off' : '') + '" data-act="event" data-i="' + i + '"' + (off ? ' data-off="1"' : '') + '>' +
              '<td><input type="radio" ' + (e === c.ev ? 'checked ' : '') + (off ? 'disabled ' : '') + 'tabindex="-1" /></td><td>' + gp(e.cost) + '</td><td>' + fmtMod(e.bonus) + '</td><td>' + esc(e.text) + (off ? ' <span class="dt-warn">over the limit</span>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></section>' +
        '<section class="dt-card"><h3>2. Who ' + (c.set.solo ? 'studies (one PC)' : 'takes part') + '</h3>' +
          (pcs.length ? '<table class="dt-table"><thead><tr><th></th><th>PC</th><th>Pays</th><th>Roll</th></tr></thead><tbody>' + pcs.map(p => {
            const on = c.chosen.indexOf(p.id) !== -1;
            const rb = c.useRenown ? D().renownBonus(p.renown) : 0;
            const mod = c.ev.bonus + groupTotal + rb + p.nextCarouse + p.carouseMod;
            return '<tr class="' + (on ? '' : 'is-off') + '"><td><input type="' + (c.set.solo ? 'radio' : 'checkbox') + '" data-act="who" data-id="' + esc(p.id) + '"' + (on ? ' checked' : '') + ' /></td>' +
              '<td>' + esc(p.name) + ' <span class="hint">' + gp(p.gp) + '</span>' + (p.usedDowntime ? ' <span class="badge dt-used">used</span>' : '') + '</td>' +
              '<td class="' + (on && p.gp < c.share ? 'dt-warn' : '') + '">' + (on ? gp(c.share) : '—') + '</td><td>1d8 ' + fmtMod(mod) + '</td></tr>';
          }).join('') + '</tbody></table>' : '<p class="hint">No Shadowdark characters in this campaign.</p>') +
          (!c.set.solo && pcs.length > 1 ? '<button type="button" class="btn" data-act="who-all">Select all</button>' : '') +
        '</section>' +
        '<section class="dt-card"><h3>3. Bonuses</h3>' +
          (c.wr ? check('data-ui="bardGroup"', ui().bardGroup, 'A bard in the group has the +2 talent (PGWR p. 34)') : '') +
          (c.wr && ui().settlement === 'bastion' ? check('data-ui="brewery"', ui().brewery, 'The bastion has a brewery (+1, PGWR p. 247)') : '') +
          (c.wr ? check('data-ui="useRenown"', ui().useRenown, 'Add each PC\'s renown bonus (PGWR p. 233)') : '') +
          '<label class="dt-field">Other group bonus (holiday, garb, site) ' + numIn('data-ui="other"', ui().other) + '</label>' +
          '<label class="dt-field">Treasure tables for item results <select data-ui="treasureRules"><option value="core"' + (ui().treasureRules === 'core' ? ' selected' : '') + '>Core (p. 270)</option><option value="gmc"' + (ui().treasureRules === 'gmc' ? ' selected' : '') + '>GM Companion (p. 80)</option></select></label>' +
          '<p class="hint">Per-PC bonuses (cursed armor, one-time bonuses from earlier benefits) are on the Party view. The tab adds them and clears the one-time ones.</p>' +
          (broke.length ? '<p class="dt-warn">' + esc(broke.map(p => p.name).join(', ')) + ' cannot pay the ' + gp(c.share) + ' share.</p>' : '') +
          '<button type="button" class="btn btn-primary dt-go" data-act="carouse"' + (!c.chosen.length || broke.length ? ' disabled' : '') + '>Roll ' + esc(c.set.name.toLowerCase()) + ' for ' + (c.chosen.length || 'no') + ' PC' + (c.chosen.length === 1 ? '' : 's') + '</button>' +
          (ui().oneToOne ? '<p class="hint">1:1 time: carouse at most once every two weeks of real time (WR GM p. 34).</p>' : '') +
        '</section>' +
      '</div>' +
      (results.length ? '<div class="dt-grid dt-results">' + results.map(r =>
        '<section class="dt-card"><h3>' + esc(r.name) + '</h3><p class="hint">XP +' + r.xp + ' · ' + gp(r.gpBefore) + ' → ' + gp(r.gpAfter) +
          (r.renownBefore !== r.renownAfter ? ' · renown ' + r.renownBefore + ' → ' + r.renownAfter : '') + '</p>' + linesHtml(r.lines) + '</section>').join('') + '</div>' : '') +
      '<details class="dt-more"><summary>Outcome tables</summary>' +
        [c.set.outcome].concat(c.set.kind === 'wr' ? ['wrpg-carousing-benefit-benefit', 'wrpg-carousing-mishap-mishap'] : []).map(tableHtml).join('') +
      '</details>';
  }

  function activitiesHtml() {
    const chars = party();
    if (!chars.length) return '<p class="hint">No Shadowdark characters in this campaign.</p>';
    const ch = chars.find(c => c.id === ui().checkPc) || chars[0];
    const pc = pcOf(ch);
    const wr = ui().wr;
    const acts = data().activities.filter(a => wr || a.source === 'core');
    const wLimit = wr ? data().warbandLimit[ui().settlement] : null;
    const maxLv = Math.min(pc.level, wLimit == null ? 99 : wLimit);
    return '<div class="dt-toolbar">' +
        '<label class="dt-field">Character <select data-ui="checkPc">' + chars.map(c => '<option value="' + esc(c.id) + '"' + (c === ch ? ' selected' : '') + '>' + esc(c.name) + (record(c.id).usedDowntime ? ' (downtime used)' : '') + '</option>').join('') + '</select></label>' +
        '<span class="hint">LV ' + pc.level + ' · ' + gp(pc.gp) + ' · hit die ' + pc.hd + ' · spellcasting ' + pc.caster + ' · ' + D().STATS.map(s => s + ' ' + fmtMod(pc.mods[s])).join(' ') + '</span>' +
        (wr ? check('data-ui="library"', ui().library, 'Bastion library (+1 learning, PGWR p. 247)') : '') +
      '</div>' +
      (pc.usedDowntime ? '<p class="dt-warn">' + esc(pc.name) + ' already used downtime this break. Start a new break on the Party view, or continue if the GM allows it.</p>' : '') +
      (wr ? '<p class="hint">PGWR p. 234: no luck tokens on these checks. A failure lowers the DC one step for the next attempt; a success resets it. Options with a cost charge 50 gp per attempt. The tab uses the best allowed stat.</p>' : '') +
      (checkResult ? '<section class="dt-card dt-checkres"><h3>' + esc(checkResult.title) + '</h3>' + linesHtml(checkResult.lines) + '</section>' : '') +
      '<div class="dt-grid dt-acts">' + acts.map((a, ai) =>
        '<section class="dt-card"><div class="dt-card-head"><h3>' + esc(a.name) + '</h3>' + srcBadge(a.source, a.page) + '</div><p class="hint">' + esc(a.text) + '</p>' +
        a.groups.filter(g => D().groupApplies(g, pc)).map(g => '<h4>' + esc(g.label) + '</h4><table class="dt-table"><tbody>' + g.options.map(o => {
          const dc = D().checkDc(pc, a, o);
          const st = D().bestStat(pc, o);
          const m = D().checkMods(pc, a, ui().library && wr);
          const p = D().chance(st.mod + m.bonus, dc.dc, m.adv.length > 0);
          return '<tr><td class="dt-dc">DC ' + dc.dc + (dc.failures ? ' <s class="hint">' + o.dc + '</s>' : '') + '</td><td>' + esc(o.text) + (o.cost ? ' <b>' + gp(o.cost) + '.</b>' : '') +
            (o.rumor ? ' <select data-ui="rumorId"><option value="">Someone outside the party</option>' + chars.map(c => '<option value="' + esc(c.id) + '"' + (ui().rumorId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select>' +
              '<select data-ui="rumorDir"><option value="1"' + (ui().rumorDir === 1 ? ' selected' : '') + '>+1</option><option value="-1"' + (ui().rumorDir === -1 ? ' selected' : '') + '>−1</option></select>' : '') +
            '<div class="hint">' + esc(st.stat) + ' ' + fmtMod(st.mod) + (m.bonus ? ' +1 library' : '') + (m.adv.length ? ' · ADV (' + esc(m.adv.join(', ')) + ')' : '') + ' · ' + Math.round(p * 100) + '% to succeed</div></td>' +
            '<td><button type="button" class="btn" data-act="attempt" data-a="' + ai + '" data-o="' + esc(o.key) + '"' + (o.cost && pc.gp < o.cost ? ' disabled' : '') + '>Attempt</button></td></tr>';
        }).join('') + '</tbody></table>').join('') +
        (a.key === 'research' && pc.caster === 'none' ? '<p class="hint">This class has no spellcasting stat. Set one on the Party view to see these options.</p>' : '') +
        '</section>').join('') +
      (wr ? '<section class="dt-card"><div class="dt-card-head"><h3>Recruit a warband</h3>' + srcBadge('wrpg', 248) + '</div>' +
        '<p class="hint">Recruit a warband of your level or less. CHA check vs 10 + the warband level. Settlement limit: ' + (wLimit == null ? 'none set' : 'LV ' + wLimit) + ' (set "Where" on the Carousing view).</p>' +
        '<div class="dt-inline"><label>Warband LV ' + numIn('data-ui="warbandLv" min="1"', ui().warbandLv) + '</label>' +
        '<span class="hint">DC ' + (10 + ui().warbandLv) + ' · CHA ' + fmtMod(pc.mods.CHA) + ' · ' + Math.round(D().chance(pc.mods.CHA, 10 + ui().warbandLv, pc.bardAdv) * 100) + '%</span>' +
        '<button type="button" class="btn" data-act="warband"' + (ui().warbandLv > maxLv ? ' disabled' : '') + '>Attempt</button></div>' +
        (ui().warbandLv > maxLv ? '<p class="dt-warn">The warband level is over ' + (ui().warbandLv > pc.level ? 'your level' : 'the settlement limit') + '.</p>' : '') +
      '</section>' : '') +
      '</div>' +
      '<p class="hint">The core Learning DC lowers by one step per failure (core p. 91). The lowest DC is 9. Learning, Martial Training, and Magical Research count as learning for the Jeweled Eye ADV and the library +1.</p>';
  }

  function gamblingHtml() {
    const chars = party();
    return '<section class="dt-card"><div class="dt-card-head"><h3>Wizards and Thieves</h3>' + srcBadge('core', 94) + '</div>' +
        '<p class="hint">The tab plays a full game. Each active player calls wizard or thief at random. Use it when a carousing result needs the winner of a bet.</p>' +
        '<div class="dt-inline">' + chars.map(c => check('data-act="wt-who" data-id="' + esc(c.id) + '"', ui().wtIds.indexOf(c.id) !== -1, esc(c.name))).join('') +
          '<label>Other players <input type="text" data-ui="wtOthers" value="' + esc(ui().wtOthers) + '" placeholder="Rival, Barkeep" /></label>' +
          '<label>Coins each ' + numIn('data-ui="wtCoins" min="6"', ui().wtCoins) + '</label>' +
          '<label>1 coin = gp ' + numIn('data-ui="wtValue" min="0"', ui().wtValue) + '</label>' +
          '<button type="button" class="btn btn-primary" data-act="wt-play">Play a game</button>' +
        '</div>' +
        (wt ? '<p><b>' + esc(wt.winner) + '</b> wins after ' + wt.turns + ' turns. ' + wt.final.map(f => esc(f.name) + ': ' + f.coins + ' (' + fmtMod(f.coins - wt.coins) + ')').join(' · ') + '</p>' +
          (wt.ids.length && ui().wtValue > 0 && !wt.applied ? '<button type="button" class="btn" data-act="wt-apply">Apply the result to party wealth</button>' : '') +
          '<details class="dt-more"><summary>Game log (' + wt.log.length + ')</summary><ol class="dt-log">' + wt.log.map(l => '<li>' + esc(l) + '</li>').join('') + '</ol></details>' : '') +
        '<div class="dt-grid">' + ['low', 'mid', 'high', 'epic'].map(k => tableHtml('core-wizards-and-thieves-' + k + '-stakes')).join('') + '</div>' +
      '</section>' +
      (data().rules.some(r => r.id === 'gmc-farkle') ? '<section class="dt-card"><div class="dt-card-head"><h3>Farkle</h3>' + srcBadge('gmc', 31) + '</div>' +
        blocksHtml(data().rules.find(r => r.id === 'gmc-farkle').blocks) +
        '<p class="hint">The book shows the two scoring dice faces as pictures, so the text above has no die value before "is worth". Check the book.</p></section>' : '');
  }

  function tableHtml(id) {
    const t = data().tables[id];
    if (!t) return '';
    const res = tableRolls[id];
    return '<div class="dt-rtable"><div class="dt-card-head"><b>' + esc(t.title) + '</b> ' + srcBadge(t.source, t.page) +
      '<button type="button" class="btn" data-act="roll-table" data-t="' + esc(id) + '">Roll ' + esc(t.dice || '') + '</button></div>' +
      '<table class="dt-table"><thead><tr><th>' + esc(t.dice || '') + '</th>' + t.columns.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
      t.rows.map((r, i) => '<tr class="' + (res === i ? 'is-on' : '') + '"><td>' + esc(r.range) + '</td>' + t.columns.map((c, j) => '<td>' + md(r.cells[j] || '') + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }

  function blocksHtml(blocks) {
    let out = '', list = '';
    const flush = () => { if (list) { out += '<ul>' + list + '</ul>'; list = ''; } };
    blocks.forEach(b => {
      if (b.t === 'li') { list += '<li>' + md(b.text) + '</li>'; return; }
      flush();
      if (b.t === 'p') out += '<p>' + md(b.text) + '</p>';
      else if (b.t === 'h') out += '<h4>' + esc(b.text) + '</h4>';
      else if (b.t === 'quote') out += '<blockquote>' + md(b.text) + '</blockquote>';
      else if (b.t === 'table') out += tableHtml(b.ref);
    });
    flush();
    return out;
  }

  function rulesHtml() {
    return '<p class="hint">The full printed text of every carousing and downtime section. The event cost tables print badly in the extracted text; the Carousing view has the clean versions.</p>' +
      '<h3>Related rules in other chapters</h3><ul class="dt-related">' + data().related.map(r => '<li>' + srcBadge(r.source, r.page) + ' ' + esc(r.text) + '</li>').join('') + '</ul>' +
      data().rules.map(r => '<details class="dt-rule"><summary><b>' + esc(r.title) + '</b> ' + srcBadge(r.source, r.page) + '</summary><div class="markdown-body">' + blocksHtml(r.blocks) + '</div></details>').join('');
  }

  /* ---- actions ---- */

  function doCarouse() {
    const c = carouseSetup();
    if (!c.chosen.length) return;
    snapshot(c.set.name.toLowerCase());
    const out = D().carouse({
      data: data(), set: c.set, event: c.ev, pcs: party().map(pcOf), ids: c.chosen, group: c.group,
      useRenown: c.useRenown, treasureRules: ui().treasureRules, oneToOne: ui().oneToOne
    });
    out.pcs.forEach(p => { if (c.chosen.indexOf(p.id) !== -1) commit(p); });
    results = out.results;
    finish(c.set.name + ' (' + gp(c.ev.cost) + '): ' + out.results.map(r => r.name + ' rolled ' + r.total + ', +' + r.xp + ' XP').join('; '));
  }

  function applyCheck(title, out) {
    commit(out.pc);
    if (out.rumor) setRec(out.rumor.id, p => { p.renown += out.rumor.dir; p.log = [{ ts: Date.now(), text: fmtMod(out.rumor.dir) + ' renown from a rumor by ' + out.pc.name }].concat(p.log); });
    checkResult = { title: out.pc.name + ': ' + title, lines: out.lines };
    finish(out.pc.name + ': ' + title + ' — ' + (out.success ? 'success' : 'failure'));
  }

  function onClick(e) {
    const v = e.target.closest('[data-dt-view]');
    if (v) { view = v.dataset.dtView; try { localStorage.setItem(VIEW_KEY, view); } catch (err) { /* this page only */ } renderDowntime(); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act, id = el.dataset.id;
    if (act === 'undo' && undo) {
      dt().records = undo.records;
      party().forEach(c => { if (undo.bodies[c.id] != null && c.body !== undo.bodies[c.id]) { c.body = undo.bodies[c.id]; c.updatedAt = Date.now(); } });
      OSR.state.consumables.forEach(t => { if (undo.trackers[t.id] != null) t.value = undo.trackers[t.id]; });
      const label = undo.label;
      undo = null; results = []; checkResult = null;
      finish('Undid ' + label);
    } else if (act === 'new-break') {
      party().forEach(c => setRec(c.id, p => { p.usedDowntime = false; }));
      finish('New break between adventures: every PC has a downtime activity again');
    } else if (act === 'levelup') {
      const ch = OSR.state.characters.find(c => c.id === id);
      const pc = pcOf(ch);
      snapshot('level up');
      pc.xp = 0;
      if (ui().wr) pc.renown += 1;
      pc.log = [{ ts: Date.now(), text: 'Level up to ' + (pc.level + 1) + (ui().wr ? ', +1 renown' : '') }].concat(pc.log);
      ch.body = D().writeLevel(ch.body, pc.level + 1);
      commit(pc);
      finish(pc.name + ' reaches level ' + (pc.level + 1) + '. Roll HP and a talent on the Character tab.');
    } else if (act === 'renown-cha') {
      setRec(id, p => { p.renown = p.mods.CHA; });
      finish();
    } else if (act === 'ongoing-del') {
      setRec(id, p => { p.ongoing.splice(+el.dataset.i, 1); });
      finish();
    } else if (act === 'set') {
      ui().kind = el.dataset.kind; ui().eventIdx = 0; results = [];
      OSR.save(); renderDowntime();
    } else if (act === 'event') {
      if (el.dataset.off) return;
      ui().eventIdx = +el.dataset.i;
      OSR.save(); renderDowntime();
    } else if (act === 'who-all') {
      ui().ids = party().map(c => c.id);
      OSR.save(); renderDowntime();
    } else if (act === 'carouse') {
      doCarouse();
    } else if (act === 'attempt') {
      const chars = party();
      const ch = chars.find(c => c.id === ui().checkPc) || chars[0];
      const a = data().activities.filter(x => ui().wr || x.source === 'core')[+el.dataset.a];
      const o = a && a.groups.reduce((f, g) => f || g.options.find(x => x.key === el.dataset.o), null);
      if (!ch || !o) return;
      snapshot(a.name.toLowerCase());
      applyCheck(a.name, D().downtimeCheck({
        pc: pcOf(ch), activity: a, option: o, library: ui().wr && ui().library, oneToOne: ui().oneToOne,
        rumorTarget: o.rumor ? { id: ui().rumorId, dir: ui().rumorDir } : undefined
      }));
    } else if (act === 'warband') {
      const chars = party();
      const ch = chars.find(c => c.id === ui().checkPc) || chars[0];
      if (!ch) return;
      const pc = pcOf(ch);
      snapshot('warband');
      applyCheck('Recruit warband', D().recruitWarband({ pc, level: ui().warbandLv, adv: pc.bardAdv }));
    } else if (act === 'wt-play') {
      const ids = ui().wtIds.filter(x => party().some(c => c.id === x));
      const names = party().filter(c => ids.indexOf(c.id) !== -1).map(c => c.name)
        .concat(String(ui().wtOthers || '').split(',').map(s => s.trim()).filter(Boolean));
      if (names.length < 2) { alert('Pick at least two players.'); return; }
      wt = Object.assign(D().wizardsAndThieves(names.map(n => ({ name: n, coins: ui().wtCoins }))), { coins: ui().wtCoins, ids });
      OSR.pushNote('Downtime', 'Wizards and Thieves: ' + wt.winner + ' wins (' + wt.final.map(f => f.name + ' ' + f.coins).join(', ') + ')');
      renderDowntime();
    } else if (act === 'wt-apply' && wt && !wt.applied) {
      snapshot('gambling');
      party().filter(c => wt.ids.indexOf(c.id) !== -1).forEach(c => {
        const f = wt.final.find(x => x.name === c.name);
        if (!f) return;
        const delta = (f.coins - wt.coins) * ui().wtValue;
        setRec(c.id, p => { p.gp = Math.max(0, p.gp + delta); p.log = [{ ts: Date.now(), text: 'Wizards and Thieves: ' + (delta >= 0 ? '+' : '') + gp(delta) }].concat(p.log); });
      });
      wt.applied = true;
      finish('Wizards and Thieves result applied to party wealth');
    } else if (act === 'roll-table') {
      const t = data().tables[el.dataset.t];
      if (!t) return;
      const sides = Number((/d(\d+)/.exec(t.dice || '') || [])[1]) || t.rows.length;
      const value = Math.floor(Math.random() * sides) + 1;
      const row = D().rowAt(t, value);
      tableRolls[t.id] = t.rows.indexOf(row);
      OSR.pushNote(t.title, value + ': ' + D().withDice(row.cells.filter(Boolean).join(' — ')));
      OSR.save(); renderDowntime();
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.dataset.act === 'who') {
      const { set } = currentSet();
      const id = el.dataset.id;
      const ids = ui().ids.filter(x => x !== id);
      ui().ids = set.solo ? (el.checked ? [id] : []) : (el.checked ? ids.concat(id) : ids);
      OSR.save(); renderDowntime();
      return;
    }
    if (el.dataset.act === 'wt-who') {
      const id = el.dataset.id;
      ui().wtIds = ui().wtIds.filter(x => x !== id).concat(el.checked ? [id] : []);
      OSR.save();
      return;
    }
    if (el.dataset.ui) {
      const k = el.dataset.ui;
      let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (Number(el.value) || 0) : el.value;
      if (k === 'rumorDir') v = Number(v) < 0 ? -1 : 1;
      if (k === 'checkPc') checkResult = null;
      ui()[k] = v;
      OSR.save(); renderDowntime();
      return;
    }
    if (el.dataset.rec) {
      const k = el.dataset.rec;
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (Number(el.value) || 0) : el.value;
      if (k === 'hd' || k === 'caster') {
        const rec = record(el.dataset.id);
        rec[k] = v;
        dt().records[el.dataset.id] = rec;
      } else setRec(el.dataset.id, p => { p[k] = k === 'gp' ? Math.max(0, v) : v; });
      finish();
    }
  }

  function onSubmit(e) {
    const f = e.target.closest('form[data-form="ongoing"]');
    if (!f) return;
    e.preventDefault();
    const input = f.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    setRec(f.dataset.id, p => { p.ongoing.push(text); });
    finish();
  }

  function wireDowntime() {
    const root = $('#dt-root');
    if (!root) return;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('submit', onSubmit);
  }

  Object.assign(OSR, { renderDowntime, wireDowntime, applyDowntimeTab, downtimePc: pcOf, downtimeCommit: commit });
})(window.OSR = window.OSR || {});
