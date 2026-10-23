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
    renderUaDamage();
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
    if (isUaEntry(ent)) { btn.textContent = 'Apply ' + Math.max(0, OSR.lastRoll.total) + ' wounds to ' + ent.name; return; }
    const isBrpMonster = ent.kind === 'monster' && ent.monster && ent.monster.source === 'brp';
    const shActive = sh && !isBrpMonster;
    const unit = (shActive && ent.kind === 'monster') ? 'HD' : 'HP';
    btn.textContent = 'Apply ' + (shActive ? 'SH ' : '') + 'damage to ' + ent.name + ' (' + unit + ')';
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
    // Unknown Armies: damage is wounds taken, counting up (no HP, no HD).
    if (isUaEntry(ent)) { applyWoundsToSelected(Math.max(0, lastRoll.total), lastRoll.normalized || ''); return; }
    const round = OSR.state.combat.round || 1;
    // Scarlet Heroes translates damage into Hit Dice loss — meaningless for a
    // BRP monster (no HD at all, see js/brp-monsters-data.js), so it always
    // applies plain HP damage instead, even with the setting on.
    const isBrpMonster = ent.kind === 'monster' && ent.monster && ent.monster.source === 'brp';
    const sh = !isBrpMonster && !!(OSR.state.settings && OSR.state.settings.scarletHeroes);

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
    if (isUaEntry(e)) {
      const t = entryWoundThreshold(e);
      return t > 0 && entryWounds(e) >= UAStatblock.woundBand(t, 0.9); // unconscious or dead (p.63)
    }
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
    // Silent Legions uses descending AC on its own (no ascending pair); the
    // book's "*" marks a creature that ordinary harm doesn't work on.
    if (m.source === 'sl') return m.ac.desc != null ? m.ac.desc + (m.mundaneImmune ? '*' : '') : '—';
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

  /* ---- BRP: "+dm"/"+½dm" -> the creature's actual Damage Bonus dice ---- */
  // A BRP def's damageBonus is the book's own shorthand text, e.g. "+1D4",
  // "None", or (for a few creatures with form-dependent bonuses, e.g. the
  // Centaur/Werewolf/Giant) "+1D4 (human); +2D6 (horse)" — pull out just the
  // first dice term (with its sign) as the one used for "+dm" substitution;
  // "−" is the Unicode minus sign the sourcebook text uses for negative
  // bonuses (e.g. "−1D6"), normalized to an ASCII "-".
  function brpDbDiceTerm(damageBonus) {
    const m = String(damageBonus || '').match(/([+−-])\s*(\d*d\d+)/i);
    if (!m) return null; // "None", or no dice term found
    return (m[1] === '−' ? '-' : m[1]) + m[2].toLowerCase();
  }
  // Approximates BRP's "half damage bonus" weapons (thrown/missile, etc.) by
  // halving the die count (min 1) — the rulebook's actual rule is to roll the
  // full bonus and halve the *result*, which the dice engine has no division
  // operator to express as a single clickable formula.
  function brpHalveDiceTerm(term) {
    const m = String(term || '').match(/^([+-])(\d*)d(\d+)$/);
    if (!m) return term;
    const count = Math.max(1, Math.floor((parseInt(m[2] || '1', 10)) / 2));
    return m[1] + count + 'd' + m[3];
  }
  // Replaces every "+dm"/"+½dm" placeholder in a BRP creature's attacksText/
  // skillsText with its actual Damage Bonus dice — e.g. "1D8+dm" becomes
  // "1D8+1D4" for a Knight (damageBonus "+1D4") — so the combined roll (one
  // clickable span, see annotate.js's DICE_RE) rolls the real damage
  // including the bonus, instead of leaving "dm" as inert unclickable text.
  // "None" (no dice term) contributes "+0". Never mutates the stored def —
  // called fresh at render time in combat.js/monster-modals.js.
  function brpResolveDb(text, damageBonus) {
    if (!text) return text;
    const dbTerm = brpDbDiceTerm(damageBonus);
    return String(text).replace(/([+−-])(½)?dm\b/gi, (whole, sign, half) => {
      const normSign = sign === '−' ? '-' : sign;
      if (!dbTerm) return normSign === '-' ? '-0' : '+0';
      let term = half ? brpHalveDiceTerm(dbTerm) : dbTerm;
      // Combine the placeholder's own sign with the damage bonus's sign —
      // "-dm" (rare) flips it; "+dm" (the overwhelming majority) keeps it.
      if (normSign === '-') term = (term[0] === '-' ? '+' : '-') + term.slice(1);
      return term;
    });
  }
  /* ---- Silent Legions: hit verdict, Skill / Slaughter / Madness rolls ---- */
  function isSlMonster(e) { return e.kind === 'monster' && !!e.monster && e.monster.source === 'sl'; }
  // An SL attack hits when 1d20 + bonus + the target's (descending) AC is 20
  // or more, so the roll's total says which ACs it hits. A natural 1 always
  // misses and a natural 20 always hits; AC runs from 9 (unarmored, the
  // worst) down to about 0.
  function slHitNote(r) {
    const nat = r.dice && r.dice[0] ? r.dice[0].value : null;
    if (nat === 20) return 'natural 20 — hits';
    if (nat === 1) return 'natural 1 — misses';
    const need = 20 - r.total;
    if (need <= 0) return 'hits any AC of 0 or higher';
    if (need > 9) return 'misses AC 9 or better (needs AC ' + need + ')';
    return 'hits AC ' + need + ' or higher';
  }
  const DIE_RE = /^(\d*)d(\d+)$/i;
  // The rollable part of a Madness entry: the true-form value after a "/"
  // ("None / 1d6" -> "1d6"), or null when there's nothing to roll ("None", "1").
  function slMadnessDice(m) {
    const last = String((m && m.madness) || '').split('/').pop().trim();
    return DIE_RE.test(last) ? last : null;
  }
  function slSlaughterDie(m) {
    const d = String((m && m.slaughterDie) || '').trim();
    return DIE_RE.test(d) ? d : null;
  }
  function slDetailHtml(m) {
    const sd = slSlaughterDie(m);
    const mad = slMadnessDice(m);
    return '<div class="cd-sec"><span class="cd-lbl">Skill</span><button class="btn cbt-skill" title="Roll a skill check">2d6' +
        fmtMod(m.skill || 0) + '</button></div>' +
      '<div class="cd-sec"><span class="cd-lbl">Slaughter</span>' +
        (sd ? '<button class="btn cbt-slaughter" title="6+ triples the damage">' + escapeHtml(sd) + '</button>'
          : '<span class="chip">' + escapeHtml(m.slaughterDie || 'None') + '</span>') + '</div>' +
      '<div class="cd-sec"><span class="cd-lbl">Madness</span>' +
        (mad ? '<button class="btn cbt-madness" title="Roll the Madness its presence inflicts">' + escapeHtml(m.madness) + '</button>'
          : '<span class="chip">' + escapeHtml(m.madness || 'None') + '</span>') + '</div>';
  }
  function rollEntrySkill(e) {
    const s = (e.monster && e.monster.skill) || 0;
    const r = OSR.evalFormula('2d6' + fmtMod(s));
    OSR.pushLog(e.name, 'Skill check 2d6' + fmtMod(s), r.total, r.detail + ' — GM sets the difficulty');
  }
  function rollEntrySlaughter(e) {
    const d = slSlaughterDie(e.monster);
    if (!d) return;
    const r = OSR.evalFormula(d);
    OSR.pushLog(e.name, 'Slaughter ' + d, r.total, r.detail + (r.total >= 6 ? ' → Slaughter: triple the damage' : ' → normal damage'));
  }
  // A PC can never take more Madness from one kind of creature than the
  // die's maximum, however often they meet it — noted in the log line.
  function rollEntryMadness(e) {
    const d = slMadnessDice(e.monster);
    if (!d) return;
    const m = d.match(DIE_RE);
    const max = (parseInt(m[1] || '1', 10)) * parseInt(m[2], 10);
    const r = OSR.evalFormula(d);
    OSR.pushLog(e.name, 'Madness ' + d, r.total, r.detail + ' — at most ' + max + ' in total from this kind of creature');
  }

  /* ---- Unknown Armies: wounds count up to the wound threshold ---- */
  // A UA combatant — a 'ua3e' Bestiary GMC, or a character whose sheet has a
  // ```ua fence — tracks wounds taken (0 up to its Wound Threshold) instead of
  // HP and HD. A monster keeps them on its entry (`e.wounds`,
  // `e.woundThreshold`); a character on its campaign-global "Wounds (Name)"
  // tracker, the same way an OSR character's HP lives on "HP (Name)".
  function isUaEntry(e) {
    if (!e) return false;
    if (e.kind === 'monster') return !!e.monster && e.monster.source === 'ua3e';
    const ch = combatCharFor(e);
    return !!ch && OSR.charSystemKey(ch) === 'ua3e';
  }
  function woundConsumable(ch) {
    if (!ch) return null;
    return OSR.state.consumables.find(c => c.name === OSR.woundTrackerLabel(ch)) || null;
  }
  function entryWounds(e) {
    if (e.kind === 'character') { const c = woundConsumable(combatCharFor(e)); return c ? c.value : 0; }
    return Number(e.wounds) || 0;
  }
  function entryWoundThreshold(e) {
    if (e.kind === 'character') { const c = woundConsumable(combatCharFor(e)); return c ? c.max || 0 : 0; }
    return Number(e.woundThreshold) || 0;
  }
  function setEntryWounds(e, v) {
    v = Math.max(0, Math.round(Number(v) || 0));
    if (e.kind === 'character') {
      const c = woundConsumable(combatCharFor(e));
      if (c) { c.value = v; OSR.clampConsumable(c); OSR.save(); OSR.renderConsumables(); }
      return;
    }
    const t = Number(e.woundThreshold) || 0;
    e.wounds = t > 0 ? Math.min(t, v) : v;
    OSR.save();
  }
  // The parsed statblock behind a UA entry: a GMC's `raw` text, or a
  // character's ```ua fence (null when there is none).
  function uaStatsFor(e) {
    if (e.kind === 'monster') return UAStatblock.parseUAMonster(e.monster.raw || '');
    return OSR.uaFenceDef(combatCharFor(e));
  }
  function uaInitChip(stats) {
    const id = stats && UAStatblock.initiativeOf(stats.identities);
    if (!id) return '';
    return '<span class="chip chip-dim" title="Provides Initiative: when it matters who acts first, ' +
      escapeHtml(id.name) + '\'s rating counts (Book One, p. 62)">Init ' + escapeHtml(id.value) + '%</span>';
  }
  function uaStateChip(e) {
    const st = UAStatblock.woundState(entryWounds(e), entryWoundThreshold(e));
    return st.key === 'ok' ? '' : '<span class="chip ua-wstate ua-wstate-' + st.key + '">' + escapeHtml(st.label) + '</span>';
  }
  // "Hurt at 25 · badly hurt at 38 · unconscious at 45 · dead at 50"
  function uaBandsText(t) {
    if (!(t > 0)) return '';
    return UAStatblock.WOUND_BANDS.slice().reverse().map(b => b.label.toLowerCase() + ' at ' + UAStatblock.woundBand(t, b.at)).join(' · ');
  }
  function uaWoundsChips(e) {
    const t = entryWoundThreshold(e);
    return chip('Wounds', entryWounds(e) + ' / ' + (t || '—')) + uaStateChip(e);
  }
  function applyWoundsToSelected(amount, how) {
    const ent = selectedEntry();
    if (!ent || !isUaEntry(ent)) return;
    amount = Math.max(0, Math.round(Number(amount) || 0));
    const before = entryWounds(ent);
    setEntryWounds(ent, before + amount);
    const after = entryWounds(ent), t = entryWoundThreshold(ent);
    const st = UAStatblock.woundState(after, t);
    OSR.pushNote(ent.name, amount + ' wounds → ' + before + '→' + after + (t ? ' / ' + t : '') +
      (st.key !== 'ok' ? ' · ' + st.label : ''),
      (how ? how + '  ·  ' : '') + 'round ' + (OSR.state.combat.round || 1));
    renderCombat();
  }
  // What a result means for damage, by Book One's attack rules (p.62-65).
  const UA_VERDICT_NOTE = {
    Crit: 'Crit: a punch knocks out or kills, a melee weapon kills, a gun does its damage cap.',
    'Matched Success': 'Matched success: a melee weapon does the roll, like a gun. Fists get nothing extra.',
    Failure: 'A miss does no damage, but a sharp weapon still does 1 wound.',
    'Matched Failure': 'A miss. With a weapon: it is out of your hands.',
    Fumble: 'Fumble: no damage to the target. A melee weapon hits you for 1d10; a gun jams.'
  };
  // The Dice Roller's "wounds from the last percentile roll" choices — one
  // button per weapon kind (UAStatblock.damageOptions), shown while a UA
  // combatant is selected and the last roll was a d100.
  function renderUaDamage() {
    const box = $('#dice-apply-ua');
    if (!box) return;
    const p = OSR.lastPercent;
    const ent = selectedEntry();
    if (!p || !ent || !isUaEntry(ent)) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<div class="dau-head">' + escapeHtml(p.source) + ' rolled <b>' + p.roll + '</b> (' + escapeHtml(p.verdict) +
        ') → wounds to <b>' + escapeHtml(ent.name) + '</b></div>' +
      '<div class="dau-btns">' + UAStatblock.damageOptions(p.roll).map(o =>
        '<button class="btn dau-btn" type="button" data-wounds="' + o.wounds + '" data-how="' + escapeHtml(o.label + ', roll ' + p.roll) + '">' +
          escapeHtml(o.label) + ' <b>' + o.wounds + '</b></button>').join('') + '</div>' +
      (UA_VERDICT_NOTE[p.verdict] ? '<div class="dau-note">' + escapeHtml(UA_VERDICT_NOTE[p.verdict]) + '</div>' : '');
  }
  function onUaDamageClick(e) {
    const b = e.target.closest('.dau-btn');
    if (b) applyWoundsToSelected(Number(b.dataset.wounds), b.dataset.how);
  }
  // A Bestiary GMC's panel: wounds, identities, abilities, passions, shock,
  // and the book text. Percentages and dice values become rolls (annotate).
  function uaMonsterDetailHtml(ent) {
    const m = ent.monster;
    const st = UAStatblock.parseUAMonster(m.raw || '');
    const t = entryWoundThreshold(ent);
    let h = '<div class="cd-head"><b>' + escapeHtml(ent.name) + '</b> <span class="cd-src">ua3e' +
      (st.type ? ' · ' + escapeHtml(st.type) : '') + '</span></div>';
    h += '<div class="cd-stats">' + uaWoundsChips(ent) + uaInitChip(st) + '</div>';
    if (t) h += '<p class="cd-desc ua-bands">' + escapeHtml(uaBandsText(t)) + '</p>';
    if (st.woundThresholdText) h += '<p class="cd-desc"><i>Wound threshold:</i> ' + escapeHtml(st.woundThresholdText) + '</p>';
    if (st.desc) h += '<p class="cd-desc">' + escapeHtml(st.desc) + '</p>';
    const subs = new Set(Object.keys(UAStatblock.computeSubstitutions(st.identities)));
    if (st.identities.length) {
      h += '<div class="cd-sec cd-ua-top"><span class="cd-lbl">Identities</span><ul class="ua-identities cd-ua-ids">' +
        st.identities.map(id => '<li><b>' + escapeHtml(id.name) + '</b> ' + escapeHtml(id.value) + '%' +
          (id.obsession ? ' <span class="badge">Obsession</span>' : '') +
          (id.features ? ': ' + OSR.uaFeaturesHtml(id.features, subs) : '') + '</li>').join('') + '</ul></div>';
    }
    const abil = UAStatblock.abilityValues(st);
    const names = UAStatblock.ALL_ABILITIES.filter(a => abil[a]);
    if (names.length) {
      const FROM = { shock: 'from the shock gauge', identity: 'substituted by ', book: 'as the book gives it' };
      h += '<div class="cd-sec"><span class="cd-lbl">Abilities</span><span class="cd-ua-abils">' + names.map(a => {
        const v = abil[a];
        const title = a + ' ' + v.value + '%: ' + FROM[v.from] + (v.identityName || '');
        return '<span class="ua-abil' + (v.from === 'identity' ? ' ua-sub' : '') + '" title="' + escapeHtml(title) + '">' +
          escapeHtml(a) + ' ' + escapeHtml(v.value) + '%</span>';
      }).join('') + '</span></div>';
    }
    const pas = st.passions;
    if (pas.fear || pas.noble || pas.rage || st.obsession) {
      const row = (label, p) => p ? '<div class="ua-passion"><b>' + label + '</b>' + (p.meter ? ' (' + escapeHtml(p.meter) + ')' : '') +
        ': ' + escapeHtml(p.text) + '</div>' : '';
      h += '<div class="cd-sec cd-ua-top cd-ua-passions"><span class="cd-lbl">Passions</span><div>' + row('Fear', pas.fear) +
        row('Noble', pas.noble) + row('Rage', pas.rage) +
        (st.obsession ? '<div class="ua-passion"><b>Obsession</b>: ' + escapeHtml(st.obsession) + '</div>' : '') + '</div></div>';
    }
    if (st.hasShock) {
      h += '<div class="cd-sec"><span class="cd-lbl">Shock</span><span class="cd-ua-shock">' + UAStatblock.METER_ORDER
        .filter(k => st.shock[k]).map(k => '<span class="chip chip-dim" title="hardened / failed">' + k + ' ' +
          st.shock[k].hardened + '/' + st.shock[k].failed + '</span>').join('') + '</span></div>';
    }
    if (st.book) h += '<p class="hint">' + escapeHtml(st.book) + '</p>';
    if (m.notes) h += '<details class="cd-raw"><summary>Book text</summary><div class="cd-notes markdown-body">' + marked.parse(String(m.notes)) + '</div></details>';
    if (m.raw) h += '<details class="cd-raw"><summary>Statblock</summary><pre>' + escapeHtml(m.raw) + '</pre></details>';
    return h;
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
    const isUa = OSR.charSystemKey(ch) === 'ua3e';
    if (isUa) {
      // The "Wounds (Name)" tracker comes from the sheet's Wound Threshold;
      // without one, the book's default of 50 (Book One, p. 63).
      OSR.syncWoundTracker(ch);
      if (!woundConsumable(ch)) OSR.ensureWoundTracker(ch, 50);
      OSR.save();
      OSR.renderConsumables();
    }
    // Seed the linked HP tracker from the sheet if it's still the untouched 0/0 default.
    const det = isUa ? null : charDetectHp(ch);
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
    if (def.source === 'ua3e') {
      // A formula threshold ("Equal to its host") parses to null: 0 = not set yet, the GM types it in.
      const wt = UAStatblock.parseUAMonster(def.raw || '').woundThreshold;
      e.wounds = 0;
      e.woundThreshold = wt != null ? wt : 0;
    }
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
    OSR.pushLog(e.name, (atk.label || 'attack') + ' to-hit ' + fmtMod(bonus), r.total,
      isSlMonster(e) ? r.detail + ' → ' + slHitNote(r) : r.detail);
  }
  function rollEntrySave(e, key) {
    const m = e.monster;
    if (m && m.saveTargets && m.saveTargets[key] != null) {
      const tgt = m.saveTargets[key];
      const r = OSR.evalFormula('1d20');
      // Silent Legions' single save target is keyed plain "Save".
      OSR.pushLog(e.name, key === 'Save' ? 'Save' : 'Save ' + key, r.total, 'vs ' + tgt + ' → ' + (r.total >= tgt ? 'SAVE' : 'FAIL'));
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
    // Unknown Armies has no Hit Dice to spend, and no initiative roll (p.62).
    const ua = OSR.currentSystem() === 'ua3e';
    $('#cb-populate-hd').hidden = ua;
    $('#cb-ua-hint').hidden = !ua;
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
    const isBrp = !!(m && m.source === 'brp');
    const ac = m ? acDisplay(m) : (ch ? (charQuickAC(ch) || '—') : '—');
    const sv = m ? (m.savesText || '') : '';
    const atk = m ? (isBrp ? brpResolveDb(m.attacksText, m.damageBonus) : m.attacksText) || '' : '';
    const maxHp = entryMaxHp(e);
    const line2 = isUaEntry(e) ? uaRowLine2(e) : null;
    return '<li class="' + cls.join(' ') + '" data-id="' + e.id + '" draggable="true">' +
      '<div class="cbt-line1">' +
        '<span class="cbt-drag" title="Drag to reorder">⠿</span>' +
        '<button class="cbt-side" title="Ally / Enemy / Neutral — click to cycle">●</button>' +
        '<span class="cbt-name">' + escapeHtml(e.name) + '</span>' +
        '<span class="cbt-kind">' + e.kind + '</span>' +
        (e.id === OSR.state.combat.activeId ? '<span class="cbt-turnflag">◀ turn</span>' : '') +
        '<button class="cbt-remove" title="Remove from combat">✕</button>' +
      '</div>' +
      (line2 != null ? '<div class="cbt-line2">' + line2 + '</div>' : '<div class="cbt-line2">' +
        (e.kind === 'monster' && !isBrp
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
        (isBrp
          ? '<span class="chip">Armor ' + escapeHtml(String(m.armor != null ? m.armor : '—')) + '</span>' +
            (m.damageBonus ? '<span class="chip chip-dim">DB ' + escapeHtml(m.damageBonus) + '</span>' : '')
          : '<span class="chip">AC ' + escapeHtml(String(ac)) + '</span>' +
            (sv ? '<span class="chip chip-dim">Sv ' + escapeHtml(sv) + '</span>' : '')) +
        (m && m.source === 'sl' && m.madness && m.madness !== 'None'
          ? '<span class="chip chip-dim">Mad ' + escapeHtml(m.madness) + '</span>' : '') +
        (atk ? '<span class="chip chip-dim">' + escapeHtml(atk) + '</span>' : '') +
        statusTagsHtml(e) +
      '</div>') +
    '</li>';
  }
  // A UA row: a wounds stepper (up to the threshold — a monster's threshold
  // is editable, a character's comes from its sheet), the wound state, and the
  // Provides Initiative rating. No HD, AC or saves.
  function uaRowLine2(e) {
    const t = entryWoundThreshold(e);
    const st = uaStatsFor(e);
    const max = e.kind === 'monster'
      ? '<input class="cbt-wt" type="number" min="0" step="1" value="' + (t || '') + '" placeholder="?" title="Wound threshold" />'
      : '<span class="cbt-max">' + (t || '—') + '</span>';
    return '<span class="chip cbt-step"><span class="chip-l">Wounds</span>' +
        '<button class="cbt-stepbtn cbt-wd-dec" type="button" aria-label="Wounds −1">&minus;</button>' +
        '<input class="cbt-wounds" type="number" min="0" step="1" value="' + entryWounds(e) + '" />' +
        '<span class="cbt-max">/</span>' + max +
        '<button class="cbt-stepbtn cbt-wd-inc" type="button" aria-label="Wounds +1">+</button></span>' +
      uaStateChip(e) + uaInitChip(st) +
      (e.kind === 'monster' && st && st.type ? '<span class="chip chip-dim">' + escapeHtml(st.type) + '</span>' : '') +
      statusTagsHtml(e);
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
    if (ent.kind === 'monster' && ent.monster.source === 'ua3e') {
      h += uaMonsterDetailHtml(ent);
    } else if (ent.kind === 'monster' && ent.monster.source === 'brp') {
      const m = ent.monster;
      const c = m.characteristics || {};
      h += '<div class="cd-head"><b>' + escapeHtml(ent.name) + '</b> <span class="cd-src">brp</span></div>';
      const majorWound = entryMaxHp(ent) ? Math.ceil(entryMaxHp(ent) / 2) : null;
      h += '<div class="cd-stats">' +
        chip('HP', entryHp(ent) + ' / ' + (entryMaxHp(ent) || '—')) +
        (majorWound != null ? chip('Major Wound', majorWound) : '') +
        chip('Armor', m.armor != null ? m.armor : '—') +
        chip('DB', m.damageBonus || 'None') +
        (m.move ? chip('Move', m.move) : '') +
        ['STR', 'CON', 'SIZ', 'INT', 'POW', 'DEX', 'CHA'].filter(k => c[k] != null).map(k => chip(k, c[k])).join('') +
      '</div>';
      if (m.armorNote) h += '<p class="cd-desc"><i>Armor:</i> ' + escapeHtml(m.armorNote) + '</p>';
      if (m.attacksText) h += '<div class="cd-sec"><span class="cd-lbl">Attacks</span><p>' + escapeHtml(brpResolveDb(m.attacksText, m.damageBonus)) + '</p></div>';
      if (m.skillsText) h += '<div class="cd-sec"><span class="cd-lbl">Skills</span><p>' + escapeHtml(m.skillsText) + '</p></div>';
      if (m.abilities && m.abilities.length) {
        h += '<div class="cd-abils">' + m.abilities.map(a =>
          '<p>' + (a.name ? '<b>' + escapeHtml(a.name) + '.</b> ' : '') + escapeHtml(a.text) + '</p>').join('') + '</div>';
      }
      if (m.desc) h += '<p class="cd-desc">' + escapeHtml(m.desc) + '</p>';
    } else if (ent.kind === 'monster') {
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
      if (m.source === 'sl') h += slDetailHtml(m);
      if (m.abilities && m.abilities.length) {
        h += '<div class="cd-abils">' + m.abilities.map(a =>
          '<p>' + (a.name ? '<b>' + escapeHtml(a.name) + '.</b> ' : '') + escapeHtml(a.text) + '</p>').join('') + '</div>';
      }
      if (m.desc) h += '<p class="cd-desc">' + escapeHtml(m.desc) + '</p>';
      if (m.raw) h += '<details class="cd-raw"><summary>Raw stat block</summary><pre>' + escapeHtml(m.raw) + '</pre></details>';
    } else {
      const ch = combatCharFor(ent);
      h += '<div class="cd-head"><b>' + escapeHtml(ent.name) + '</b> <span class="cd-src">character' +
        (ch && ch.system ? ' · ' + escapeHtml(ch.system) : '') + '</span></div>';
      if (isUaEntry(ent)) {
        h += '<div class="cd-stats">' + uaWoundsChips(ent) + uaInitChip(uaStatsFor(ent)) + '</div>';
        if (entryWoundThreshold(ent)) h += '<p class="cd-desc ua-bands">' + escapeHtml(uaBandsText(entryWoundThreshold(ent))) + ' (linked to the Wounds tracker)</p>';
      } else {
        h += '<div class="cd-stats">' +
          chip('HP', entryHp(ent) + ' / ' + (entryMaxHp(ent) || '—') + '  (linked to sheet)') + '</div>';
      }
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
    if (e.target.closest('.cbt-wd-inc')) { stepEntry(id, 'wounds', +1); return; }
    if (e.target.closest('.cbt-wd-dec')) { stepEntry(id, 'wounds', -1); return; }
    setSelected(id);
  }
  function stepEntry(id, field, delta) {
    const ent = OSR.state.combat.entries.find(x => x.id === id);
    if (!ent) return;
    OSR.state.combat.selectedId = id;
    if (field === 'hp') setEntryHp(ent, entryHp(ent) + delta);
    else if (field === 'wounds') setEntryWounds(ent, entryWounds(ent) + delta);
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
    else if (e.target.classList.contains('cbt-wounds')) { setEntryWounds(ent, e.target.value); }
    else if (e.target.classList.contains('cbt-wt')) { ent.woundThreshold = Math.max(0, Math.round(Number(e.target.value) || 0)); saveDebounced(); }
  }
  function onTrackerChange(e) {
    if (/\bcbt-(hd|hp|wounds|wt)\b/.test(e.target.className)) {
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
    if (e.target.closest('.cbt-skill')) { rollEntrySkill(ent); return; }
    if (e.target.closest('.cbt-slaughter')) { rollEntrySlaughter(ent); return; }
    if (e.target.closest('.cbt-madness')) { rollEntryMadness(ent); return; }
    if (e.target.closest('.cbt-atkroll')) {
      const b = (ent.monster && ent.monster.atkBonus) || 0;
      const r = OSR.evalFormula('1d20' + fmtMod(b));
      OSR.pushLog(ent.name, 'Attack ' + fmtMod(b), r.total, isSlMonster(ent) ? r.detail + ' → ' + slHitNote(r) : r.detail);
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
    $('#dice-apply-ua').addEventListener('click', onUaDamageClick);
  }

  Object.assign(OSR, {
    shDie, updateApplyButton, setEntryHd, applyEntryDamage, applyDamageToSelected,
    combatCharFor, hpConsumable, entryHp, entryMaxHp, setEntryHp, entryDown,
    charQuickAC, charDetectHp, acDisplay, atkHitLabel, atkDmgLabel,
    brpDbDiceTerm, brpHalveDiceTerm, brpResolveDb, selectedEntry,
    uniqueName, addCharEntry, addMonsterEntry, removeEntry, cycleSide, toggleSide, setSelected,
    statusIconOf, statusDescOf, toggleStatus, removeStatus, defineCondition,
    closeCtxMenu, openCtxMenu, onCtxMenuClick,
    turnIndex, nextTurn, prevTurn, setRound, moveSelection,
    rollEntryAttack, rollEntrySave, rollEntryMorale, rollEntrySkill, rollEntrySlaughter, rollEntryMadness,
    slHitNote, slMadnessDice, slSlaughterDie,
    isUaEntry, entryWounds, entryWoundThreshold, setEntryWounds, applyWoundsToSelected, renderUaDamage, uaRowLine2, uaMonsterDetailHtml,
    renderCombat, renderCombatBar, statusTagsHtml, rowHtml, renderTracker, chip, renderCombatantDetail,
    onTrackerClick, stepEntry, onTrackerContextMenu, onTrackerInput, onTrackerChange, onDetailClick, onCombatKey,
    wireCombat
  });
})(window.OSR = window.OSR || {});
