/* js/downtime.js — Shadowdark carousing and downtime rules (pure; also a Node module).
 *
 * The rules data is data/downtime-shadowdark.json (OSR.data.downtime), written by
 * the shadowdark_companion repo's tools/export_keeper_downtime.ts. This file
 * rolls the outcome tables and applies the effects (XP, gp, renown, luck
 * tokens, next-roll bonuses, treasure, rumors) to plain PC objects:
 *
 *   { id, name, level, xp, luck, mods: { STR, DEX, CON, INT, WIS, CHA }, hd, caster,
 *     gp, renown, failures, ongoing, log, carouseMod, nextCarouse, benefitAdv,
 *     cancelMishap, usedDowntime, bardAdv, jeweledEye }
 *
 * js/downtime-ui.js builds them from a character's sheet (readSheet) and its
 * downtime record (state.downtime.records[id]), and writes them back.
 * Every function takes `rng` (default Math.random) so tests can fix the dice.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.OSR = root.OSR || {}; root.OSR.Downtime = api; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const BANDS = ['0-3', '4-6', '7-9', '10'];

  const die = (sides, rng) => Math.floor((rng || Math.random)() * sides) + 1;
  const fmtMod = n => (n >= 0 ? '+' + n : String(n));
  const gp = n => Number(n).toLocaleString('en-US') + ' gp';
  const clone = p => Object.assign({}, p, { mods: Object.assign({}, p.mods), failures: Object.assign({}, p.failures), ongoing: (p.ongoing || []).slice(), log: (p.log || []).slice() });

  /* ---- small rules ---- */

  // PGWR p. 233.
  function renownBonus(r) { return r >= 12 ? 3 : r >= 8 ? 2 : r >= 4 ? 1 : 0; }
  function renownLabel(r) {
    if (r >= 12) return 'Celebrity. Welcome in the most luxurious places.';
    if (r >= 8) return 'A known name. High-status people treat you as a peer.';
    if (r >= 4) return 'Regular folk view you favorably. High-status people ignore you.';
    return 'Mostly invisible. Not welcome in upscale places.';
  }
  // A failure lowers a downtime DC one step (18 → 15 → 12 → 9); it stops at 9.
  function loweredDc(dc, failures) { return Math.max(Math.min(dc, 9), dc - 3 * (failures || 0)); }
  // Core p. 39: XP to the next level is the level × 10 (a 0-level PC needs 10).
  function xpToLevel(level) { return Math.max(1, level) * 10; }
  function groupApplies(g, pc) {
    if (!g.when) return true;
    if (g.when.hd && g.when.hd.indexOf(pc.hd) === -1) return false;
    if (g.when.caster && g.when.caster.indexOf(pc.caster) === -1) return false;
    return true;
  }

  // renown null = not set yet: it starts at the CHA modifier (PGWR p. 233).
  function newRecord() {
    return {
      gp: 0, renown: null, failures: {}, ongoing: [], log: [], carouseMod: 0, nextCarouse: 0,
      benefitAdv: false, cancelMishap: false, usedDowntime: false, bardAdv: false, jeweledEye: false,
      hd: '', caster: ''
    };
  }

  /* ---- the character sheet (Shadowdark layout, data/gulzund-blize-shadowdark.txt) ---- */

  const XP_RE = /(\*\*XP:?\*\*:?[ \t]*)(\d+)/g;
  const XP_PLAIN_RE = /(\bXP:[ \t]*)(\d+)/g;
  const LUCK_RE = /(\*\*Luck:?\*\*:?[ \t]*(?:\u{1F340}[ \t]*)?)(\d+)/gu;
  const LUCK_PLAIN_RE = /(\bLuck( tokens?)?:[ \t]*)(\d+)/gi;

  function statMod(body, s) {
    let m = new RegExp('\\|\\s*' + s + '\\s*\\|\\s*\\d+\\s*\\|\\s*([+\\-−]?\\d+)\\s*\\|').exec(body);
    if (!m) m = new RegExp('\\b' + s + '\\b\\**\\s*:?\\s*\\**\\s*([+\\-−]\\d+)').exec(body);
    if (!m) {
      const score = new RegExp('\\b' + s + '\\b\\**\\s*:?\\s*\\**\\s*(\\d{1,2})\\b').exec(body);
      return score ? Math.floor((+score[1] - 10) / 2) : 0;
    }
    return parseInt(m[1].replace('−', '-'), 10);
  }

  // Level, XP, luck tokens, stat modifiers, and the class (hit die and
  // spellcasting stat from `classes`, the data file's class table).
  function readSheet(body, classes) {
    const text = String(body || '');
    const num = (re, i) => { re.lastIndex = 0; const m = re.exec(text); return m ? +m[i] : null; };
    const level = /\bLevel[ \t]+(\d+)/i.exec(text);
    const mods = {};
    STATS.forEach(s => { mods[s] = statMod(text, s); });
    let className = '';
    const head = text.split('\n').slice(0, 4).join(' ');
    Object.keys(classes || {}).forEach(c => {
      if (new RegExp('\\b' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(head) && c.length > className.length) className = c;
    });
    const cls = (classes || {})[className] || {};
    const xp = num(XP_RE, 2);
    const luck = num(LUCK_RE, 2);
    return {
      level: level ? +level[1] : 1,
      xp: xp != null ? xp : (num(XP_PLAIN_RE, 2) || 0),
      luck: luck != null ? luck : (num(LUCK_PLAIN_RE, 3) || 0),
      mods, className, hd: cls.hd || 'd6', caster: cls.caster || 'none'
    };
  }

  // The sheet with every XP (or luck token) number set to `value`. A sheet
  // without one is returned unchanged; the UI keeps the value in the record then.
  function writeSheetNumber(body, key, value) {
    const text = String(body || '');
    if (key === 'XP') {
      if (XP_RE.test(text)) { XP_RE.lastIndex = 0; return text.replace(XP_RE, (m, a) => a + value); }
      XP_PLAIN_RE.lastIndex = 0;
      return text.replace(XP_PLAIN_RE, (m, a) => a + value);
    }
    if (key === 'Luck') {
      LUCK_RE.lastIndex = 0;
      if (LUCK_RE.test(text)) { LUCK_RE.lastIndex = 0; return text.replace(LUCK_RE, (m, a) => a + value); }
      LUCK_PLAIN_RE.lastIndex = 0;
      return text.replace(LUCK_PLAIN_RE, (m, a) => a + value);
    }
    return text;
  }
  function sheetHas(body, key) {
    const re = key === 'XP' ? [XP_RE, XP_PLAIN_RE] : [LUCK_RE, LUCK_PLAIN_RE];
    return re.some(r => { r.lastIndex = 0; const ok = r.test(String(body || '')); r.lastIndex = 0; return ok; });
  }
  function writeLevel(body, level) {
    return String(body || '').replace(/(\bLevel[ \t]+)(\d+)/i, (m, a) => a + level);
  }

  /* ---- tables and text ---- */

  function rowAt(t, value) {
    let i = t.rows.findIndex(r => r.min != null && r.max != null && value >= r.min && value <= r.max);
    if (i < 0) i = value < (t.rows[0] && t.rows[0].min != null ? t.rows[0].min : 1) ? 0 : t.rows.length - 1;
    return t.rows[i];
  }

  const DICE_RE = /\b(\d{0,3})d(\d{1,3})(?:\s*([+\-−])\s*(\d+)(?!d))?\b/gi;
  function rollExpr(m, rng) {
    const count = m[1] ? +m[1] : 1;
    let total = 0;
    for (let i = 0; i < count; i++) total += die(+m[2], rng);
    if (m[3]) total += (m[3] === '+' ? 1 : -1) * +m[4];
    return total;
  }
  // Each dice expression in a text gets its rolled total: '1d4 days' → '1d4 [3] days'.
  function withDice(text, rng) {
    return String(text || '').replace(/\*/g, '').replace(DICE_RE, function (m) {
      return m + ' [' + rollExpr(arguments, rng) + ']';
    });
  }

  /* ---- effects ---- */

  function treasureLine(data, pc, band, mod, range, rules, ctx) {
    const r = rules || ctx.treasureRules;
    const t = data.tables[r + '-treasure-' + band] || data.tables['core-treasure-' + band];
    if (!t) return { kind: 'note', text: 'Treasure ' + band + ' table not found' };
    const value = range ? range[0] + die(range[1] - range[0] + 1, ctx.rng) - 1 : Math.min(100, die(100, ctx.rng) + mod);
    const text = withDice(rowAt(t, value).cells.filter(Boolean).join(' — '), ctx.rng);
    pc.ongoing.push('Treasure: ' + text);
    return { kind: 'treasure', text, tableId: t.id, roll: value + (mod && !range ? ' (incl. ' + fmtMod(mod) + ')' : '') };
  }

  // Applies every effect the text names. Returns the lines that say what changed.
  function applyText(data, pc, raw, ctx) {
    const text = String(raw || '').replace(/\*/g, '');
    const out = [];
    const auto = t => out.push({ kind: 'auto', text: t });
    let m;
    if ((m = /\bgain (\d+) XP\b/i.exec(text))) { pc.xp += +m[1]; auto('+' + m[1] + ' XP'); }
    if ((m = /(\d+)% of your (?:total |remaining )?(?:wealth|gold pieces|gold|gp)/i.exec(text)) && !/increase the value/i.test(text)) {
      const loss = Math.floor(pc.gp * +m[1] / 100);
      pc.gp -= loss;
      auto('−' + gp(loss) + ' (' + m[1] + '% of wealth)');
    }
    if (/debt equal to half of your remaining gp/i.test(text)) {
      const d = Math.floor(pc.gp / 2);
      pc.ongoing.push('Debt: ' + gp(d) + ' (' + ctx.tag + ')');
      auto('Debt of ' + gp(d) + ' added to the lasting effects');
    }
    if ((m = /borrowed (\d+) gp/i.exec(text))) { pc.ongoing.push('Debt: ' + gp(+m[1]) + ' to a loan shark'); auto('Debt of ' + gp(+m[1]) + ' added to the lasting effects'); }
    if ((m = /\b(?:lose|lost|for|guard|gave|spent|fined you|dropped) (\d+) gp\b/i.exec(text)) && !/borrowed/i.test(text)) {
      const loss = Math.min(pc.gp, +m[1]);
      pc.gp -= loss;
      auto('−' + gp(loss));
    }
    if ((m = /\bwon (\d+) gp\b/i.exec(text))) { pc.gp += +m[1]; auto('+' + gp(+m[1])); }
    if (((m = /([+\-−]\d+) renown/i.exec(text)) || (m = /renown increases by (\d+)/i.exec(text))) && !/if anyone sees/i.test(text)) {
      const n = parseInt(m[1].replace('−', '-'), 10);
      pc.renown += n;
      auto(fmtMod(n) + ' renown (now ' + pc.renown + ')');
    }
    if (/\b(?:gain|and) a luck token/i.test(text)) { pc.luck += 1; auto('+1 luck token (now ' + pc.luck + ')'); }
    if (/lose all luck tokens/i.test(text)) { pc.luck = 0; auto('Lost all luck tokens'); }
    if ((m = /([+\-−]\d+) (?:on|to) (?:your )?next carousing event roll/i.exec(text))) {
      const n = parseInt(m[1].replace('−', '-'), 10);
      pc.nextCarouse += n;
      auto(fmtMod(n) + ' on the next carousing roll');
    }
    if (/roll your next benefit with ADV/i.test(text)) { pc.benefitAdv = true; auto('Next carousing benefit roll has ADV'); }
    if (/cancel your next mishap/i.test(text)) { pc.cancelMishap = true; auto('The next carousing mishap is canceled'); }

    const band = BANDS[pc.level <= 3 ? 0 : pc.level <= 6 ? 1 : pc.level <= 9 ? 2 : 3];
    if ((m = /(\d+)-\s?(\d+) item from your treasure table/i.exec(text))) out.push(treasureLine(data, pc, band, 0, [+m[1], +m[2]], null, ctx));
    else if ((m = /(\d+)x rolls on Treasure (\d+-\d+)/i.exec(text))) { for (let i = 0; i < +m[1]; i++) out.push(treasureLine(data, pc, m[2], 0, null, 'gmc', ctx)); }
    else if ((m = /roll on the Treasure (\d+-\d+) Table/i.exec(text))) out.push(treasureLine(data, pc, m[1], 0, null, null, ctx));
    else if ((m = /roll at \+(\d+) on the Treasure Table one up from your LV/i.exec(text))) out.push(treasureLine(data, pc, BANDS[Math.min(3, BANDS.indexOf(band) + 1)], +m[1], null, null, ctx));
    else if ((m = /roll at \+(\d+) on the LV 10\+ Treasure Table/i.exec(text))) out.push(treasureLine(data, pc, '10', +m[1], null, null, ctx));
    else if ((m = /roll at \+(\d+) on your level's Treasure Table/i.exec(text))) out.push(treasureLine(data, pc, band, +m[1], null, null, ctx));
    else if (/roll on your level's Treasure Table/i.test(text)) out.push(treasureLine(data, pc, band, 0, null, null, ctx));

    if (/two random magic potions/i.test(text) && data.potions && data.potions.length) {
      for (let i = 0; i < 2; i++) {
        const p = data.potions[die(data.potions.length, ctx.rng) - 1].name;
        pc.ongoing.push('Item: ' + p);
        out.push({ kind: 'treasure', text: p });
      }
    }
    if (/a random rumor/i.test(text)) {
      const t = data.tables[ctx.wr ? 'wrgm-rumors-in-the-reaches-rumors' : 'core-rumors'] || data.tables['core-rumors'];
      if (t) {
        const v = die(100, ctx.rng);
        const r = withDice(rowAt(t, v).cells[0], ctx.rng);
        pc.ongoing.push('Rumor: ' + r);
        out.push({ kind: 'treasure', text: 'Rumor: ' + r, tableId: t.id, roll: v });
      }
    }
    return out;
  }

  /* ---- carousing ---- */

  const num = s => { const v = parseInt(String(s || '').replace('−', '-').replace('+', ''), 10); return isFinite(v) ? v : 0; };

  function resolveD100(data, pc, kind, mod, ctx, lines, depth) {
    depth = depth || 0;
    const id = kind === 'benefit' ? 'wrpg-carousing-benefit-benefit' : 'wrpg-carousing-mishap-mishap';
    const t = data.tables[id];
    if (!t) return;
    if (kind === 'mishap' && pc.cancelMishap) {
      pc.cancelMishap = false;
      lines.push({ kind: 'auto', text: 'Mishap canceled (the Thieves\' Guild helps you)' });
      return;
    }
    const adv = kind === 'benefit' && pc.benefitAdv;
    if (adv) pc.benefitAdv = false;
    const a = die(100, ctx.rng), b = adv ? die(100, ctx.rng) : 0;
    const value = Math.max(1, Math.min(100, Math.max(a, b) + mod));
    const detail = adv || mod ? (adv ? 'ADV ' + a + '/' + b : String(a)) + (mod ? ' ' + fmtMod(mod) : '') + ' = ' + value : String(value);
    const text = withDice(rowAt(t, value).cells[0], ctx.rng);
    lines.push({ kind, text, tableId: id, roll: detail });
    if (depth < 3 && /re-roll this benefit as a mishap/i.test(text)) return resolveD100(data, pc, 'mishap', mod, ctx, lines, depth + 1);
    if (depth < 3 && /re-roll this mishap as a benefit/i.test(text)) return resolveD100(data, pc, 'benefit', mod, ctx, lines, depth + 1);
    lines.push.apply(lines, applyText(data, pc, text, Object.assign({}, ctx, { tag: text })));
    pc.ongoing.push((kind === 'benefit' ? 'Benefit: ' : 'Mishap: ') + text);
  }

  // input: { data, set, event, pcs, ids, group: [{label, value}], useRenown,
  //          treasureRules ('core'|'gmc'), oneToOne, rng }
  // → { pcs (copies, changed), results: [{ pcId, name, total, lines, xp, gpBefore, gpAfter, renownBefore, renownAfter }], share }
  function carouse(input) {
    const data = input.data, set = input.set, event = input.event, ids = input.ids || [];
    const rng = input.rng || Math.random;
    const group = input.group || [];
    const share = Math.ceil(event.cost / Math.max(1, ids.length));
    const groupTotal = group.reduce((a, b) => a + b.value, 0);
    const outcome = data.tables[set.outcome];
    const results = [];
    const pcs = input.pcs.map(p => {
      if (ids.indexOf(p.id) === -1) return p;
      const pc = clone(p);
      const lines = [];
      const before = { gp: pc.gp, renown: pc.renown, xp: pc.xp };
      const ctx = { rng, treasureRules: input.treasureRules || 'core', wr: set.kind === 'wr', tag: set.name };

      const paid = Math.min(pc.gp, share);
      pc.gp -= paid;
      lines.push({ kind: paid < share ? 'fail' : 'auto', text: 'Paid ' + gp(paid) + (paid < share ? ' (short by ' + gp(share - paid) + ')' : '') });

      const parts = [{ label: 'event', value: event.bonus }].concat(group);
      const rb = input.useRenown ? renownBonus(pc.renown) : 0;
      if (rb) parts.push({ label: 'renown', value: rb });
      if (pc.nextCarouse) parts.push({ label: 'one-time', value: pc.nextCarouse });
      if (pc.carouseMod) parts.push({ label: 'standing', value: pc.carouseMod });
      const d8 = die(8, rng);
      const total = d8 + event.bonus + groupTotal + rb + pc.nextCarouse + pc.carouseMod;
      pc.nextCarouse = 0;
      lines.push({ kind: 'roll', roll: total, text: '1d8 (' + d8 + ') ' + parts.filter(x => x.value).map(x => fmtMod(x.value) + ' ' + x.label).join(' ') + ' = ' + total });

      if (outcome) {
        const row = rowAt(outcome, total);
        if (set.kind === 'wr') {
          const v = row.cells.map(num); // Mishap, Benefit, d100 Modifier, XP
          const mis = v[0], ben = v[1], mod = v[2], xp = v[3];
          pc.xp += xp;
          lines.push({ kind: 'outcome', tableId: outcome.id, roll: row.range, text: xp + ' XP · ' + ben + ' benefit' + (ben === 1 ? '' : 's') + ' · ' + mis + ' mishap' + (mis === 1 ? '' : 's') + (mod ? ' · d100 ' + fmtMod(mod) : '') });
          lines.push({ kind: 'auto', text: '+' + xp + ' XP' });
          for (let i = 0; i < ben; i++) resolveD100(data, pc, 'benefit', mod, ctx, lines);
          for (let i = 0; i < mis; i++) resolveD100(data, pc, 'mishap', mod, ctx, lines);
        } else {
          const story = withDice(row.cells[0], rng).trim().replace(/\.+$/, '');
          const benefit = withDice(row.cells[1], rng).trim().replace(/\.+$/, '');
          lines.push({ kind: 'outcome', tableId: outcome.id, roll: row.range, text: story + '. ' + benefit + '.' });
          lines.push.apply(lines, applyText(data, pc, story + '. ' + benefit, Object.assign({}, ctx, { tag: story })));
          pc.ongoing.push(set.name + ': ' + story + ' (' + benefit + ')');
        }
      }
      if (set.kind === 'training' && total >= 14) lines.push({ kind: 'note', text: 'The duel uses a random character of your class and level.' });
      if (input.oneToOne) lines.push({ kind: 'note', text: '1:1 time (WR GM p. 34): takes ' + Math.max(1, event.bonus) + ' day' + (event.bonus > 1 ? 's' : '') + '.' });

      pc.usedDowntime = true;
      pc.log = [{ ts: Date.now(), text: set.name + ', ' + gp(event.cost) + ' event, roll ' + total + ': ' + lines.filter(l => l.kind !== 'roll').map(l => l.text).join(' | ') }].concat(pc.log).slice(0, 100);
      results.push({ pcId: pc.id, name: pc.name, total, lines, xp: pc.xp - before.xp, gpBefore: before.gp, gpAfter: pc.gp, renownBefore: before.renown, renownAfter: pc.renown });
      return pc;
    });
    // Combat Training +6: the PC with the highest outcome becomes castellan (GMC p. 34).
    if (set.kind === 'training' && event.bonus === 6 && results.length) {
      const best = results.slice().sort((a, b) => b.total - a.total)[0];
      best.lines.push({ kind: 'auto', text: 'Highest outcome: you become castellan of the new keep and gain a baronial title.' });
      const pc = pcs.find(p => p.id === best.pcId);
      if (pc) pc.ongoing.push('Castellan of a new keep, baronial title (Combat Training)');
    }
    return { pcs, results, share };
  }

  /* ---- downtime checks ---- */

  function bestStat(pc, option) {
    if (option.stats === 'spell') {
      const s = pc.caster === 'none' || !pc.caster ? 'INT' : pc.caster;
      return { stat: s + ' (spellcasting)', mod: pc.mods[s] || 0 };
    }
    return option.stats.reduce((best, s) => ((pc.mods[s] || 0) > best.mod ? { stat: s, mod: pc.mods[s] || 0 } : best),
      { stat: option.stats[0], mod: pc.mods[option.stats[0]] || 0 });
  }
  function checkDc(pc, activity, option) {
    const failures = (pc.failures || {})[activity.key + '.' + option.key] || 0;
    return { dc: activity.stepDown ? loweredDc(option.dc, failures) : option.dc, failures };
  }
  function checkMods(pc, activity, library) {
    const adv = [];
    if (pc.bardAdv) adv.push('Bard talent');
    if (activity.learning && pc.jeweledEye) adv.push('Jeweled Eye');
    return { adv, bonus: activity.learning && library ? 1 : 0 };
  }
  // P(d20 + mod ≥ dc), with advantage if asked.
  function chance(mod, dc, adv) {
    const need = Math.min(21, Math.max(1, dc - mod));
    const p = Math.max(0, (21 - need) / 20);
    return adv ? 1 - Math.pow(1 - p, 2) : p;
  }

  // input: { pc, activity, option, library, rumorTarget: { id, dir }, oneToOne, rng }
  // → { pc, rumor: { id, dir } | undefined, lines, success }
  function downtimeCheck(input) {
    const activity = input.activity, option = input.option, rng = input.rng || Math.random;
    const pc = clone(input.pc);
    const lines = [];
    const key = activity.key + '.' + option.key;
    const dcInfo = checkDc(pc, activity, option);
    const st = bestStat(pc, option);
    const mods = checkMods(pc, activity, input.library);
    if (option.cost) {
      const paid = Math.min(pc.gp, option.cost);
      pc.gp -= paid;
      lines.push({ kind: paid < option.cost ? 'fail' : 'auto', text: 'Paid ' + gp(paid) + ' for the attempt' });
    }
    const a = die(20, rng), b = mods.adv.length ? die(20, rng) : 0;
    const nat = Math.max(a, b);
    const total = nat + st.mod + mods.bonus;
    const success = total >= dcInfo.dc;
    lines.push({
      kind: 'roll', roll: total,
      text: 'd20 ' + (mods.adv.length ? 'ADV (' + mods.adv.join(', ') + ') ' + a + '/' + b : '(' + a + ')') + ' ' + fmtMod(st.mod) + ' ' + st.stat +
        (mods.bonus ? ' +1 library' : '') + ' = ' + total + ' vs DC ' + dcInfo.dc +
        (dcInfo.failures ? ' (lowered from ' + option.dc + ' after ' + dcInfo.failures + ' failure' + (dcInfo.failures > 1 ? 's' : '') + ')' : '')
    });
    let rumor;
    if (success) {
      pc.failures[key] = 0;
      lines.push({ kind: 'ok', text: 'Success. ' + option.text });
      if (option.xp) { pc.xp += option.xp; lines.push({ kind: 'auto', text: '+' + option.xp + ' XP' }); }
      if (option.renown) { pc.renown += option.renown; lines.push({ kind: 'auto', text: fmtMod(option.renown) + ' renown (now ' + pc.renown + ')' }); }
      if (option.rumor && input.rumorTarget) {
        const t = input.rumorTarget;
        if (t.id === pc.id) { pc.renown += t.dir; lines.push({ kind: 'auto', text: fmtMod(t.dir) + ' renown (now ' + pc.renown + ')' }); }
        else if (t.id) { rumor = { id: t.id, dir: t.dir }; lines.push({ kind: 'auto', text: fmtMod(t.dir) + ' renown to the rumor target' }); }
        else lines.push({ kind: 'note', text: 'The rumor target (outside the party) gets ' + fmtMod(t.dir) + ' renown.' });
      }
      if (!option.xp && !option.renown && !option.rumor) pc.ongoing.push(activity.name + ': ' + option.text);
    } else {
      if (activity.stepDown) pc.failures[key] = dcInfo.failures + 1;
      lines.push({ kind: 'fail', text: 'Failure.' + (option.fail ? ' ' + option.fail : '') + (activity.stepDown ? ' Next attempt: DC ' + loweredDc(option.dc, dcInfo.failures + 1) + '.' : '') });
    }
    if (option.stats === 'spell' && nat === 1) lines.push({ kind: 'note', text: 'Natural 1 on a spellcasting check: check your class for a mishap or penance.' });
    if (input.oneToOne) {
      const d = die(6, rng) + die(6, rng);
      lines.push({ kind: 'note', text: '1:1 time (WR GM p. 34): takes 2d6 = ' + d + ' days.' });
    }
    pc.usedDowntime = true;
    pc.log = [{ ts: Date.now(), text: activity.name + ' (DC ' + dcInfo.dc + '): ' + lines.filter(l => l.kind !== 'roll').map(l => l.text).join(' | ') }].concat(pc.log).slice(0, 100);
    return { pc, rumor, lines, success };
  }

  // PGWR p. 248: a CHA check vs 10 + the warband's level.
  function recruitWarband(input) {
    const rng = input.rng || Math.random;
    const pc = clone(input.pc);
    const dc = 10 + input.level;
    const a = die(20, rng), b = input.adv ? die(20, rng) : 0;
    const total = Math.max(a, b) + (pc.mods.CHA || 0);
    const success = total >= dc;
    const lines = [
      { kind: 'roll', roll: total, text: 'd20 ' + (input.adv ? 'ADV (Bard talent) ' + a + '/' + b : '(' + a + ')') + ' ' + fmtMod(pc.mods.CHA || 0) + ' CHA = ' + total + ' vs DC ' + dc },
      success ? { kind: 'ok', text: 'Success. You recruit a level ' + input.level + ' warband.' } : { kind: 'fail', text: 'Failure. The warband does not join you.' }
    ];
    if (success) pc.ongoing.push('Warband (LV ' + input.level + ')');
    pc.usedDowntime = true;
    pc.log = [{ ts: Date.now(), text: 'Recruit warband LV ' + input.level + ': ' + (success ? 'recruited' : 'failed') }].concat(pc.log).slice(0, 100);
    return { pc, lines, success };
  }

  /* ---- Wizards and Thieves (core p. 94) ---- */

  // A whole game. Each active player calls wizard or thief at random.
  function wizardsAndThieves(players, ante, rng) {
    rng = rng || Math.random;
    ante = ante || 6;
    const ps = players.map(p => ({ name: p.name, coins: p.coins, out: false }));
    const log = [];
    let pot = 0;
    ps.forEach(p => { const a = Math.min(ante, p.coins); p.coins -= a; pot += a; });
    log.push('Each player adds ' + ante + ' coins. Pot: ' + pot + '.');
    const three = () => die(6, rng) + die(6, rng) + die(6, rng);
    const start = ps.map(p => ({ p, r: three() })).sort((a, b) => b.r - a.r);
    let cur = ps.indexOf(start[0].p);
    log.push(ps[cur].name + ' rolls highest and goes first.');
    const alive = () => ps.filter(p => !p.out);
    const nextIdx = i => { for (let k = 1; k <= ps.length; k++) { const j = (i + k) % ps.length; if (!ps[j].out) return j; } return i; };
    let turns = 0;
    while (pot > 0 && turns < 400) {
      turns++;
      const me = ps[cur];
      const decl = rng() < 0.5 ? 'wizard' : 'thief';
      const dice = [die(6, rng), die(6, rng), die(6, rng)];
      const w = dice.filter(d => d === 6).length, t = dice.filter(d => d === 1).length;
      const head = me.name + ' declares ' + decl + ', rolls ' + dice.join(' ') + ':';
      if (w === 3) { me.coins += pot; log.push(head + ' three wizards! Takes the whole pot (' + pot + ').'); pot = 0; break; }
      if (t === 3) {
        const others = alive().filter(p => p !== me);
        const each = others.length ? Math.floor(pot / others.length) : 0;
        others.forEach(p => { p.coins += each; });
        me.coins += pot - each * others.length;
        log.push(head + ' three thieves! The pot splits ' + each + ' each; ' + me.name + ' keeps ' + (pot - each * others.length) + ' (honor among thieves).');
        pot = 0; break;
      }
      const major = w > t ? 'wizards' : t > w ? 'thieves' : null;
      if (!major) { log.push(head + ' no majority. Play passes.'); cur = nextIdx(cur); continue; }
      let rest = dice.filter(d => d !== 1 && d !== 6);
      if (!rest.length) rest = [major === 'wizards' ? 6 : 1];
      const amt = Math.min.apply(null, rest);
      let again = false;
      if (decl === 'thief' && major === 'thieves') {
        const take = Math.min(amt, pot); me.coins += take; pot -= take;
        log.push(head + ' thieves majority. Takes ' + take + '. Pot: ' + pot + '. Goes again.'); again = true;
      } else if (decl === 'wizard' && major === 'wizards') {
        let added = 0;
        alive().forEach(p => { if (p === me) return; const a = Math.min(amt, p.coins); p.coins -= a; added += a; });
        pot += added;
        log.push(head + ' wizards majority. Everyone else adds ' + amt + '. Pot: ' + pot + '. Goes again.'); again = true;
      } else {
        const a = Math.min(amt, me.coins); me.coins -= a; pot += a;
        log.push(head + ' ' + major + ' majority against the call. Adds ' + a + '. Pot: ' + pot + '. Play passes.');
      }
      ps.forEach(p => { if (!p.out && p.coins <= 0) { p.out = true; log.push(p.name + ' is out of coins.'); } });
      if (alive().length <= 1) {
        const heir = alive()[0] || ps[nextIdx(cur)];
        heir.coins += pot;
        log.push('Only ' + heir.name + ' has coins left and takes the pot (' + pot + ').');
        pot = 0; break;
      }
      if (!again || me.out) cur = nextIdx(cur);
    }
    log.push(pot > 0 ? 'Stopped after ' + turns + ' turns. Pot of ' + pot + ' left on the table.' : 'The pot is empty. The game ends.');
    const final = ps.map(p => ({ name: p.name, coins: p.coins }));
    const winner = final.slice().sort((a, b) => b.coins - a.coins)[0];
    return { final, log, winner: winner ? winner.name : '', turns };
  }

  return {
    STATS, fmtMod, gp, renownBonus, renownLabel, loweredDc, xpToLevel, groupApplies, newRecord,
    readSheet, writeSheetNumber, sheetHas, writeLevel, rowAt, withDice, applyText,
    carouse, bestStat, checkDc, checkMods, chance, downtimeCheck, recruitWarband, wizardsAndThieves
  };
});
