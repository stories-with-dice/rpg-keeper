/* js/monster-form.js — the schema-aware "fill in fields" monster form,
 * shared by both the add modal (js/monster-modals.js's #monster-modal) and
 * the edit modal (#monster-edit-modal), and pre-filled by the generator
 * (js/monster-browser.js). Produces/consumes exactly the `def` shape from
 * js/monsters.js (see its header comment) so everything downstream — combat
 * rendering, the raw-text parser round-trip — keeps working unmodified.
 *
 * The template is injected into whichever container the caller supplies
 * (there are two: one per modal) via plain class selectors scoped to that
 * root, so the same markup works in both places with no id collisions and
 * no need for a per-instance id prefix.
 */
(function (OSR) {
  'use strict';
  const { escapeHtml } = OSR;
  const fmtMod = n => (n >= 0 ? '+' : '') + n;

  function attackRowHtml(a) {
    a = a || {};
    return '<div class="mf-atk-row">' +
      '<input type="text" class="mf-atk-label" placeholder="claw" value="' + escapeHtml(a.label || '') + '" />' +
      '<input type="number" class="mf-atk-count" placeholder="#" min="1" step="1" value="' + (a.count || 1) + '" />' +
      '<input type="number" class="mf-atk-tohit" placeholder="to-hit" step="1" value="' + (a.toHit != null ? a.toHit : '') + '" />' +
      '<input type="text" class="mf-atk-damage" placeholder="2d6" value="' + escapeHtml(a.damage || '') + '" />' +
      '<input type="text" class="mf-atk-note" placeholder="note" value="' + escapeHtml(a.note || '') + '" />' +
      '<button type="button" class="btn mf-atk-del" title="Remove">&times;</button>' +
      '</div>';
  }
  function abilityRowHtml(a) {
    a = a || {};
    return '<div class="mf-abil-row">' +
      '<input type="text" class="mf-abil-name" placeholder="Name" value="' + escapeHtml(a.name || '') + '" />' +
      '<input type="text" class="mf-abil-text" placeholder="Description" value="' + escapeHtml(a.text || '') + '" />' +
      '<button type="button" class="btn mf-abil-del" title="Remove">&times;</button>' +
      '</div>';
  }

  function monsterFormHtml() {
    return '<div class="mf">' +
      '<div class="mf-row">' +
        '<label class="field mf-name"><span>Name</span><input type="text" class="mf-f-name" autocomplete="off" /></label>' +
        '<label class="field mf-schema"><span>Format</span><select class="mf-f-schema">' +
          '<option value="shadowdark">Shadowdark</option>' +
          '<option value="ose">Old-School Essentials</option>' +
          '<option value="brp">Basic Roleplaying (BRP)</option>' +
        '</select></label>' +
      '</div>' +
      '<label class="field mf-desc"><span>Description</span><textarea class="mf-f-desc" rows="2"></textarea></label>' +
      '<div class="mf-row">' +
        '<span class="mf-nonbrp"><label class="field"><span>HD / LV</span><input type="text" class="mf-f-hd" placeholder="e.g. 3, 9*, &frac12;" /></label></span>' +
        '<label class="field"><span>HP</span><input type="number" class="mf-f-hp" step="1" /></label>' +
        '<label class="field"><span>Move</span><input type="text" class="mf-f-move" placeholder="near (climb)" /></label>' +
        '<span class="mf-nonbrp"><label class="field"><span>Alignment</span><input type="text" class="mf-f-align" /></label></span>' +
        '<span class="mf-nonbrp"><label class="field"><span>XP</span><input type="number" class="mf-f-xp" step="1" /></label></span>' +
        '<span class="mf-nonbrp"><label class="field"><span>Attack bonus</span><input type="number" class="mf-f-atkbonus" step="1" /></label></span>' +
      '</div>' +
      '<div class="mf-schema-block" data-schema="shadowdark">' +
        '<div class="mf-row">' +
          '<label class="field"><span>AC</span><input type="number" class="mf-f-ac-asc" step="1" /></label>' +
          '<label class="field mf-stat"><span>S</span><input type="number" class="mf-f-stat-S" step="1" /></label>' +
          '<label class="field mf-stat"><span>D</span><input type="number" class="mf-f-stat-D" step="1" /></label>' +
          '<label class="field mf-stat"><span>C</span><input type="number" class="mf-f-stat-C" step="1" /></label>' +
          '<label class="field mf-stat"><span>I</span><input type="number" class="mf-f-stat-I" step="1" /></label>' +
          '<label class="field mf-stat"><span>W</span><input type="number" class="mf-f-stat-W" step="1" /></label>' +
          '<label class="field mf-stat"><span>Ch</span><input type="number" class="mf-f-stat-Ch" step="1" /></label>' +
        '</div>' +
      '</div>' +
      '<div class="mf-schema-block" data-schema="ose">' +
        '<div class="mf-row">' +
          '<label class="field"><span>AC (descending)</span><input type="number" class="mf-f-ac-desc" step="1" /></label>' +
          '<label class="field"><span>THAC0</span><input type="number" class="mf-f-thac0" step="1" /></label>' +
          '<label class="field"><span>Morale</span><input type="number" class="mf-f-ml" step="1" /></label>' +
        '</div>' +
        '<div class="mf-row">' +
          '<label class="field mf-sv"><span>Sv D</span><input type="number" class="mf-f-sv-D" step="1" /></label>' +
          '<label class="field mf-sv"><span>Sv W</span><input type="number" class="mf-f-sv-W" step="1" /></label>' +
          '<label class="field mf-sv"><span>Sv P</span><input type="number" class="mf-f-sv-P" step="1" /></label>' +
          '<label class="field mf-sv"><span>Sv B</span><input type="number" class="mf-f-sv-B" step="1" /></label>' +
          '<label class="field mf-sv"><span>Sv S</span><input type="number" class="mf-f-sv-S" step="1" /></label>' +
        '</div>' +
      '</div>' +
      '<div class="mf-schema-block" data-schema="brp">' +
        '<div class="mf-row">' +
          '<label class="field mf-stat"><span>STR</span><input type="number" class="mf-f-brp-STR" step="1" /></label>' +
          '<label class="field mf-stat"><span>CON</span><input type="number" class="mf-f-brp-CON" step="1" /></label>' +
          '<label class="field mf-stat"><span>SIZ</span><input type="number" class="mf-f-brp-SIZ" step="1" /></label>' +
          '<label class="field mf-stat"><span>INT</span><input type="number" class="mf-f-brp-INT" step="1" /></label>' +
          '<label class="field mf-stat"><span>POW</span><input type="number" class="mf-f-brp-POW" step="1" /></label>' +
          '<label class="field mf-stat"><span>DEX</span><input type="number" class="mf-f-brp-DEX" step="1" /></label>' +
          '<label class="field mf-stat"><span>CHA</span><input type="number" class="mf-f-brp-CHA" step="1" /></label>' +
        '</div>' +
        '<div class="mf-row">' +
          '<label class="field"><span>Armor</span><input type="number" class="mf-f-brp-armor" step="1" /></label>' +
          '<label class="field"><span>Armor note</span><input type="text" class="mf-f-brp-armor-note" placeholder="hide, may wear armor" /></label>' +
          '<label class="field"><span>Damage Bonus</span><input type="text" class="mf-f-brp-db" placeholder="+1D4, None" /></label>' +
        '</div>' +
        '<label class="field mf-desc"><span>Attacks</span><textarea class="mf-f-brp-attacks" rows="2" placeholder="Bite 45%, 1D6+dm; Claw 45%, 1D4+dm"></textarea></label>' +
        '<label class="field mf-desc"><span>Skills</span><textarea class="mf-f-brp-skills" rows="2" placeholder="Dodge 35%, Listen 60%, Spot 60%"></textarea></label>' +
      '</div>' +
      '<div class="mf-sec mf-nonbrp-sec">' +
        '<div class="mf-sec-head"><span>Attacks</span><button type="button" class="btn mf-atk-add">+ Add attack</button></div>' +
        '<div class="mf-atks"></div>' +
      '</div>' +
      '<div class="mf-sec">' +
        '<div class="mf-sec-head"><span class="mf-abils-label">Abilities</span><button type="button" class="btn mf-abil-add">+ Add ability</button></div>' +
        '<div class="mf-abils"></div>' +
      '</div>' +
    '</div>';
  }

  function showSchemaBlock(root, schema) {
    root.querySelectorAll('.mf-schema-block').forEach(el => { el.hidden = el.dataset.schema !== schema; });
    const isBrp = schema === 'brp';
    root.querySelectorAll('.mf-nonbrp').forEach(el => { el.hidden = isBrp; });
    const atkSec = root.querySelector('.mf-nonbrp-sec');
    if (atkSec) atkSec.hidden = isBrp;
    const abilsLabel = root.querySelector('.mf-abils-label');
    if (abilsLabel) abilsLabel.textContent = isBrp ? 'Powers / Special Abilities' : 'Abilities';
  }

  // Fills the form from a `def` (see js/monsters.js), or blank defaults for
  // a brand-new monster. One starter attack row is shown even when blank
  // (fully-empty rows are dropped again on collect) — abilities start empty.
  function populateMonsterForm(root, def) {
    def = def || {};
    const q = sel => root.querySelector(sel);
    q('.mf-f-name').value = def.name || '';
    const schema = def.source === 'ose' ? 'ose' : def.source === 'brp' ? 'brp' : 'shadowdark';
    q('.mf-f-schema').value = schema;
    q('.mf-f-desc').value = def.desc || '';
    q('.mf-f-hd').value = def.hd || '';
    q('.mf-f-hp').value = def.hp || '';
    q('.mf-f-move').value = def.move || '';
    q('.mf-f-align').value = def.align || '';
    q('.mf-f-xp').value = def.xp != null ? def.xp : '';
    q('.mf-f-atkbonus').value = def.atkBonus != null ? def.atkBonus : '';
    const ac = def.ac || {};
    q('.mf-f-ac-asc').value = ac.asc != null ? ac.asc : '';
    q('.mf-f-ac-desc').value = ac.desc != null ? ac.desc : '';
    q('.mf-f-thac0').value = ac.thac0 != null ? ac.thac0 : '';
    const stats = def.stats || {};
    ['S', 'D', 'C', 'I', 'W', 'Ch'].forEach(k => { q('.mf-f-stat-' + k).value = stats[k] != null ? stats[k] : ''; });
    q('.mf-f-ml').value = def.moraleML != null ? def.moraleML : '';
    const sv = def.saveTargets || {};
    ['D', 'W', 'P', 'B', 'S'].forEach(k => { q('.mf-f-sv-' + k).value = sv[k] != null ? sv[k] : ''; });
    const brpChar = def.characteristics || {};
    ['STR', 'CON', 'SIZ', 'INT', 'POW', 'DEX', 'CHA'].forEach(k => { q('.mf-f-brp-' + k).value = brpChar[k] != null ? brpChar[k] : ''; });
    q('.mf-f-brp-armor').value = def.armor != null ? def.armor : '';
    q('.mf-f-brp-armor-note').value = def.armorNote || '';
    q('.mf-f-brp-db').value = def.damageBonus || '';
    q('.mf-f-brp-attacks').value = def.attacksText && schema === 'brp' ? def.attacksText : '';
    q('.mf-f-brp-skills').value = def.skillsText || '';
    showSchemaBlock(root, schema);
    q('.mf-atks').innerHTML = (def.attacks && def.attacks.length ? def.attacks : [null]).map(attackRowHtml).join('');
    q('.mf-abils').innerHTML = (def.abilities || []).map(abilityRowHtml).join('');
  }

  // Best-effort stat-block text reconstruction, close enough to what a
  // pasted block of this schema looks like that re-parsing it (switching to
  // "Paste text" mode, or a later plain-text edit) recovers equivalent data.
  function buildRawFromDef(def) {
    const lines = [def.name];
    if (def.desc) lines.push(def.desc);
    if (def.source === 'ose') {
      const ac = def.ac || {};
      let line = 'AC ' + (ac.desc != null ? ac.desc + (ac.asc != null ? ' [' + ac.asc + ']' : '') : (ac.asc != null ? ac.asc : '?'));
      if (def.hd) line += ' Hd ' + def.hd + (def.hp ? ' (' + def.hp + 'hp)' : '');
      if (def.attacksText) line += ' Att ' + def.attacksText;
      if (ac.thac0 != null) line += ' THAC0 ' + ac.thac0 + ' [' + fmtMod(def.atkBonus || 0) + ']';
      if (def.move) line += ' Mv ' + def.move;
      if (def.saveTargets) {
        const sv = def.saveTargets;
        line += ' sv D' + (sv.D || 0) + ' W' + (sv.W || 0) + ' P' + (sv.P || 0) + ' B' + (sv.B || 0) + ' S' + (sv.S || 0);
      }
      if (def.moraleML != null) line += ' ML ' + def.moraleML;
      if (def.align) line += ' AL ' + def.align;
      if (def.xp != null) line += ' XP ' + def.xp;
      lines.push(line);
      (def.abilities || []).forEach(a => lines.push('▶ ' + (a.name ? a.name + ': ' : '') + a.text));
    } else if (def.source === 'brp') {
      const c = def.characteristics || {};
      const charLine = ['STR', 'CON', 'SIZ', 'INT', 'POW', 'DEX', 'CHA']
        .filter(k => c[k] != null).map(k => k + ' ' + c[k]).join(', ');
      if (charLine) lines.push(charLine);
      let line = 'HP ' + (def.hp || 0);
      if (def.move) line += ', Move ' + def.move;
      if (def.damageBonus) line += ', Damage Bonus ' + def.damageBonus;
      if (def.armor != null) line += ', Armor ' + def.armor + (def.armorNote ? ' (' + def.armorNote + ')' : '');
      lines.push(line);
      if (def.attacksText) lines.push('Attacks: ' + def.attacksText);
      if (def.skillsText) lines.push('Skills: ' + def.skillsText);
      (def.abilities || []).forEach(a => lines.push((a.name ? a.name + '. ' : '') + a.text));
    } else {
      let line = 'AC ' + (def.ac && def.ac.asc != null ? def.ac.asc : '?') + ', HP ' + (def.hp || 0);
      if (def.attacksText) line += ', ATK ' + def.attacksText;
      if (def.move) line += ', MV ' + def.move;
      if (def.stats) line += ', ' + ['S', 'D', 'C', 'I', 'W', 'Ch'].map(k => k + ' ' + fmtMod(def.stats[k])).join(', ');
      if (def.align) line += ', AL ' + def.align;
      line += ', LV ' + (def.hd || '0');
      lines.push(line);
      (def.abilities || []).forEach(a => lines.push((a.name ? a.name + '. ' : '') + a.text));
    }
    return lines.join('\n');
  }

  // Reads the form back into a `def`. attacksText/savesText are derived from
  // the structured rows/stat inputs (same shape the parser itself produces),
  // and `raw` is synthesized via buildRawFromDef — so a field-built monster
  // displays and round-trips the same as a pasted one.
  function collectMonsterForm(root) {
    const q = sel => root.querySelector(sel);
    const num = sel => { const v = q(sel).value; return v === '' ? null : parseFloat(v); };
    const schemaSel = q('.mf-f-schema').value;
    const schema = schemaSel === 'ose' ? 'ose' : schemaSel === 'brp' ? 'brp' : 'shadowdark';

    const attacks = Array.from(root.querySelectorAll('.mf-atk-row')).map(row => {
      const label = row.querySelector('.mf-atk-label').value.trim();
      const countRaw = row.querySelector('.mf-atk-count').value;
      const toHitRaw = row.querySelector('.mf-atk-tohit').value;
      return {
        label: label || 'attack',
        count: countRaw === '' ? 1 : (parseInt(countRaw, 10) || 1),
        toHit: toHitRaw === '' ? null : parseInt(toHitRaw, 10),
        damage: row.querySelector('.mf-atk-damage').value.trim(),
        note: row.querySelector('.mf-atk-note').value.trim(),
        raw: ''
      };
    }).filter(a => a.label !== 'attack' || a.damage);
    const abilities = Array.from(root.querySelectorAll('.mf-abil-row')).map(row => ({
      name: row.querySelector('.mf-abil-name').value.trim(),
      text: row.querySelector('.mf-abil-text').value.trim()
    })).filter(a => a.name || a.text);

    const attacksTextStructured = attacks.map(a =>
      (a.count > 1 ? a.count + ' ' : '') + a.label +
      (a.toHit != null ? ' ' + fmtMod(a.toHit) : '') +
      (a.damage ? ' (' + a.damage + (a.note ? ' ' + a.note : '') + ')' : '')
    ).join(' + ');
    // BRP attacks/skills are free text (skill % + damage, not a to-hit bonus),
    // so they use their own textareas instead of the structured attack rows.
    const attacksText = schema === 'brp' ? q('.mf-f-brp-attacks').value.trim() : attacksTextStructured;

    const def = {
      name: q('.mf-f-name').value.trim() || 'Unnamed',
      source: schema,
      desc: q('.mf-f-desc').value.trim(),
      raw: '',
      ac: { asc: null, desc: null, thac0: null },
      hd: schema === 'brp' ? '' : q('.mf-f-hd').value.trim(),
      hp: parseInt(q('.mf-f-hp').value, 10) || 0,
      move: q('.mf-f-move').value.trim(),
      align: schema === 'brp' ? '' : q('.mf-f-align').value.trim(),
      xp: schema === 'brp' ? null : num('.mf-f-xp'),
      moraleML: null,
      atkBonus: schema === 'brp' ? null : num('.mf-f-atkbonus'),
      attacksText, attacks: schema === 'brp' ? [] : attacks,
      stats: null, saveTargets: null, savesText: '',
      abilities
    };

    if (schema === 'shadowdark') {
      def.ac.asc = num('.mf-f-ac-asc');
      const stats = {};
      let any = false;
      ['S', 'D', 'C', 'I', 'W', 'Ch'].forEach(k => {
        const v = num('.mf-f-stat-' + k);
        stats[k] = v == null ? 0 : v;
        if (v != null) any = true;
      });
      if (any) {
        def.stats = stats;
        def.savesText = ['S', 'D', 'C', 'I', 'W', 'Ch'].map(k => k + ' ' + fmtMod(stats[k])).join('  ');
      }
    } else if (schema === 'brp') {
      const characteristics = {};
      ['STR', 'CON', 'SIZ', 'INT', 'POW', 'DEX', 'CHA'].forEach(k => {
        const v = num('.mf-f-brp-' + k);
        if (v != null) characteristics[k] = v;
      });
      def.characteristics = characteristics;
      def.armor = num('.mf-f-brp-armor');
      def.armorNote = q('.mf-f-brp-armor-note').value.trim();
      def.damageBonus = q('.mf-f-brp-db').value.trim() || 'None';
      def.skillsText = q('.mf-f-brp-skills').value.trim();
    } else {
      def.ac.desc = num('.mf-f-ac-desc');
      if (def.ac.desc != null) def.ac.asc = 19 - def.ac.desc;
      def.ac.thac0 = num('.mf-f-thac0');
      def.moraleML = num('.mf-f-ml');
      const sv = {};
      let any = false;
      ['D', 'W', 'P', 'B', 'S'].forEach(k => {
        const v = num('.mf-f-sv-' + k);
        if (v != null) { sv[k] = v; any = true; }
      });
      if (any) {
        def.saveTargets = sv;
        def.savesText = ['D', 'W', 'P', 'B', 'S'].filter(k => sv[k] != null).map(k => k + sv[k]).join(' ');
      }
    }
    def.hdNum = schema === 'brp' ? 0 : (window.MonsterParse ? MonsterParse.hdNum(def.hd) : 0);
    def.raw = buildRawFromDef(def);
    return def;
  }

  function wireMonsterForm(root) {
    root.querySelector('.mf-f-schema').addEventListener('change', e => showSchemaBlock(root, e.target.value));
    root.querySelector('.mf-atk-add').addEventListener('click', () => {
      root.querySelector('.mf-atks').insertAdjacentHTML('beforeend', attackRowHtml());
    });
    root.querySelector('.mf-abil-add').addEventListener('click', () => {
      root.querySelector('.mf-abils').insertAdjacentHTML('beforeend', abilityRowHtml());
    });
    root.addEventListener('click', e => {
      const atkDel = e.target.closest('.mf-atk-del');
      if (atkDel) { atkDel.closest('.mf-atk-row').remove(); return; }
      const abilDel = e.target.closest('.mf-abil-del');
      if (abilDel) abilDel.closest('.mf-abil-row').remove();
    });
  }

  Object.assign(OSR, { monsterFormHtml, populateMonsterForm, collectMonsterForm, wireMonsterForm, buildRawFromDef });
})(window.OSR = window.OSR || {});
