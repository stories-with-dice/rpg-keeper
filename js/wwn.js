/* js/wwn.js — Worlds Without Number: the character sheet block and the
 * monster stat line. Pure (no DOM, no OSR): the browser gets window.WwnSheet,
 * Node gets module.exports.
 *
 * A PC's sheet has a ```wwn fence (js/characters.js charSystemKey → 'wwn'):
 *
 *   Class: Expert
 *   Level: 1
 *   STR 14  DEX 9  CON 14  INT 9  WIS 14  CHA 11
 *   Attack: +0
 *   Skills: Notice-1, Sneak-0 (DEX), Convince-0
 *   Foci: Alert-1, Poisoner-1
 *   Effort: 1
 *
 * parse(text) → { cls, level, attrs: { STR: 14, … }, attack, skills: [{ name,
 * level, attr }], foci: [{ name, level }], effort, extra: [{ key, value }] }.
 * The panel (sheetHtml) adds what the rules derive: attribute modifiers
 * (3 = −2, 4–7 = −1, 8–13 = 0, 14–17 = +1, 18 = +2) and the saves
 * (16 − level − the better modifier of the pair; Luck has none).
 * HP and System Strain stay outside the fence as "HP: 8/8" and
 * "System Strain: 0/14", so each gets a tracker (OSR.syncResourceTrackers).
 *
 * A monster is the OSR def shape with source 'wwn' plus skill, instinct and
 * shock (see docs/content-pack-format.md). parseStatLine() reads the book's
 * table row: "Name  HD  AC  Atk.  Dmg.  Shock  Move  ML  Inst.  Skill  Save".
 */
(function (root) {
  'use strict';

  const ATTRS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  // The attribute a skill check usually adds. The GM may pick another.
  const SKILL_ATTR = {
    administer: 'INT', connect: 'CHA', convince: 'CHA', craft: 'INT', exert: 'STR', heal: 'INT',
    know: 'INT', lead: 'CHA', magic: 'INT', notice: 'WIS', perform: 'CHA', pray: 'WIS',
    punch: 'STR', ride: 'DEX', sail: 'DEX', shoot: 'DEX', sneak: 'DEX', stab: 'STR',
    survive: 'WIS', trade: 'CHA', work: 'STR'
  };
  const SAVES = [['Physical', ['STR', 'CON']], ['Evasion', ['DEX', 'INT']], ['Mental', ['WIS', 'CHA']], ['Luck', []]];

  function attrMod(score) {
    const s = Number(score);
    if (!isFinite(s)) return 0;
    if (s <= 3) return -2;
    if (s <= 7) return -1;
    if (s <= 13) return 0;
    if (s <= 17) return 1;
    return 2;
  }
  const fmtMod = n => (n >= 0 ? '+' : '') + n;

  // "Notice-1", "Sneak-0 (DEX)", "Stab 2", "Convince +1/CHA", "Alert"
  function listItems(value, withAttr) {
    return String(value || '').split(/[,;]/).map(s => s.trim()).filter(Boolean).map(s => {
      let attr = null;
      const a = s.match(/(?:\(\s*|\/\s*)(STR|DEX|CON|INT|WIS|CHA)\s*\)?\s*$/i);
      if (a && withAttr) { attr = a[1].toUpperCase(); s = s.slice(0, a.index).trim(); }
      const m = s.match(/^(.*?)(?:\s*[-–]\s*|\s+\+?)(-?\d+)$/);
      const name = (m ? m[1] : s).trim();
      const level = m ? parseInt(m[2], 10) : null;
      return withAttr ? { name, level: level == null ? 0 : level, attr } : { name, level };
    }).filter(x => x.name);
  }

  function parse(text) {
    const def = { cls: '', level: 1, attrs: {}, attack: null, skills: [], foci: [], effort: null, extra: [] };
    String(text || '').split(/\r?\n/).forEach(raw => {
      const line = raw.trim();
      if (!line) return;
      const attrHits = line.match(/\b(STR|DEX|CON|INT|WIS|CHA)\b\s*:?\s*(\d+)/gi);
      if (attrHits && !/^[A-Za-z ]+:/.test(line.replace(/^(STR|DEX|CON|INT|WIS|CHA)\s*:/i, ''))) {
        attrHits.forEach(h => {
          const m = h.match(/(STR|DEX|CON|INT|WIS|CHA)\s*:?\s*(\d+)/i);
          def.attrs[m[1].toUpperCase()] = parseInt(m[2], 10);
        });
        return;
      }
      const kv = line.match(/^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/);
      if (!kv) { def.extra.push({ key: '', value: line }); return; }
      const key = kv[1].trim().toLowerCase(), value = kv[2].trim();
      if (key === 'class') def.cls = value;
      else if (key === 'level') def.level = parseInt(value, 10) || 1;
      else if (key === 'attack' || key === 'attack bonus') def.attack = parseInt(value, 10) || 0;
      else if (key === 'skills') def.skills = def.skills.concat(listItems(value, true));
      else if (key === 'foci' || key === 'focus') def.foci = def.foci.concat(listItems(value, false));
      else if (key === 'effort') def.effort = value;
      else def.extra.push({ key: kv[1].trim(), value });
    });
    return def;
  }

  function mods(def) {
    const out = {};
    ATTRS.forEach(a => { out[a] = def.attrs[a] != null ? attrMod(def.attrs[a]) : 0; });
    return out;
  }
  function saves(def) {
    const m = mods(def);
    return SAVES.map(([name, pair]) => ({
      name, target: 16 - (def.level || 1) - (pair.length ? Math.max(m[pair[0]], m[pair[1]]) : 0)
    }));
  }
  // The skill check of one skill: 2d6 + skill level + the attribute's modifier
  // (−1 for an untrained "-1" skill is the user's own number).
  function skillCheck(def, sk) {
    const attr = sk.attr || SKILL_ATTR[sk.name.toLowerCase()] || null;
    const mod = attr ? mods(def)[attr] : 0;
    return { attr, formula: '2d6' + fmtMod(sk.level + mod) };
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const roll = (formula, label, title, cls) =>
    '<span class="roll' + (cls ? ' ' + cls : '') + '" data-formula="' + esc(formula) + '" title="' + esc(title || ('Roll ' + formula)) + '">' + esc(label) + '</span>';

  // The View-mode panel. Rolls are .roll spans: a save is "1d20>=N" (the dice
  // log says Success or Failure), a skill is "2d6+N".
  function sheetHtml(def) {
    const m = mods(def);
    let h = '<div class="wwn-sheet">';
    const head = [def.cls, 'Level ' + (def.level || 1)].filter(Boolean).join(' · ');
    h += '<div class="wwn-head no-annotate">' + esc(head) + '</div>';
    h += '<div class="wwn-sec"><h4>Attributes</h4><div class="wwn-attrs">' + ATTRS.map(a =>
      '<span class="wwn-attr"><span class="wwn-attr-k no-annotate">' + a + '</span> ' +
      '<span class="no-annotate">' + esc(def.attrs[a] != null ? def.attrs[a] : '—') + '</span> ' +
      roll('2d6' + fmtMod(m[a]), fmtMod(m[a]), 'Roll 2d6' + fmtMod(m[a]) + ' (' + a + ' modifier, no skill)', 'wwn-mod') + '</span>').join('') + '</div></div>';
    h += '<div class="wwn-sec"><h4>Saves</h4><div class="wwn-saves">' + saves(def).map(s =>
      roll('1d20>=' + s.target, s.name + ' ' + s.target + '+', 'Roll 1d20, ' + s.target + ' or more saves', 'wwn-save')).join(' ') + '</div></div>';
    if (def.attack != null) {
      h += '<div class="wwn-sec"><h4>Attack</h4>' + roll('1d20' + fmtMod(def.attack), 'Hit ' + fmtMod(def.attack),
        'Roll 1d20' + fmtMod(def.attack) + ' (add the weapon attribute and skill); hits when the total is the target AC or more', 'wwn-atk') + '</div>';
    }
    if (def.skills.length) {
      h += '<div class="wwn-sec"><h4>Skills</h4><div class="wwn-skills">' + def.skills.map(sk => {
        const c = skillCheck(def, sk);
        return roll(c.formula, sk.name + '-' + sk.level + (c.attr ? ' · ' + c.attr : ''),
          'Roll ' + c.formula + ' (' + sk.name + '-' + sk.level + (c.attr ? ' + ' + c.attr : '') + '). Difficulty 6 easy, 8 normal, 10 hard, 12 very hard.', 'wwn-skill');
      }).join(' ') + '</div></div>';
    }
    if (def.foci.length) {
      h += '<div class="wwn-sec"><h4>Foci</h4><div class="wwn-foci">' + def.foci.map(f =>
        '[' + esc(f.name) + ']' + (f.level != null ? ' ' + f.level : '')).join(', ') + '</div></div>';
    }
    const chips = [];
    if (def.effort) chips.push('Effort ' + def.effort);
    def.extra.forEach(x => chips.push(x.key ? x.key + ': ' + x.value : x.value));
    if (chips.length) h += '<div class="wwn-chips">' + chips.map(c => '<span class="chip">' + esc(c) + '</span>').join('') + '</div>';
    return h + '</div>';
  }

  /* ---- Monsters ---- */

  // "13a" → { ac: 13, armored: true }; "18*" → { ac: 18, mundaneImmune: true }
  function parseAc(s) {
    const m = String(s || '').match(/(\d+)\s*([a*]*)/i);
    if (!m) return { ac: null };
    return { ac: parseInt(m[1], 10), armored: /a/i.test(m[2]), mundaneImmune: /\*/.test(m[2]) };
  }
  const HD_HP = 4.5; // a d8 per hit die

  // A monster def from the book's columns. cols: { name, hd, ac, atk, dmg,
  // shock, move, ml, inst, skill, save } as text. Returns null when the
  // numbers do not read.
  function monsterFromCols(c, extra) {
    const hdM = String(c.hd).match(/^(\d+(?:\.\d+)?|½)/);
    if (!hdM) return null;
    const hdNum = hdM[1] === '½' ? 0.5 : parseFloat(hdM[1]);
    const ac = parseAc(c.ac);
    const atkM = String(c.atk || '').match(/([+-]?\d+)(?:\s*x\s*(\d+))?/i);
    const toHit = atkM ? parseInt(atkM[1], 10) : 0;
    const count = atkM && atkM[2] ? parseInt(atkM[2], 10) : 1;
    const dmg = String(c.dmg || '').trim();
    const dice = /^\d*d\d+([+-]\d+)?$/i.test(dmg) ? dmg : '';
    const note = dice ? '' : (/^wpn/i.test(dmg) ? 'by weapon' + dmg.replace(/^wpn/i, '') : dmg);
    const atkNone = /none/i.test(String(c.atk || ''));
    const attacks = atkNone ? [] : [{ label: 'attack', count, toHit, damage: dice, note, raw: String(c.atk || '') + ' ' + dmg }];
    const saveN = parseInt(String(c.save || '').replace(/\D/g, ''), 10);
    const def = Object.assign({
      name: c.name, source: 'wwn',
      ac: { asc: ac.ac, desc: null, thac0: null },
      hd: hdM[1], hdNum, hp: Math.max(1, Math.floor(hdNum * HD_HP)),
      attacks,
      attacksText: attacks.map(a => (a.count > 1 ? a.count + ' ' : '') + a.label + ' ' + fmtMod(a.toHit) + ' (' + (a.damage || a.note || '—') + ')').join(', '),
      atkBonus: toHit,
      move: String(c.move || '').replace(/’/g, "'").trim(),
      moraleML: parseInt(c.ml, 10) || null,
      align: '', xp: null, stats: null,
      saveTargets: isFinite(saveN) ? { Save: saveN } : {},
      savesText: isFinite(saveN) ? saveN + '+' : '',
      skill: parseInt(c.skill, 10) || 0,
      instinct: parseInt(c.inst, 10),
      shock: String(c.shock || '').trim().replace(/^-$/, 'None'),
      abilities: []
    }, extra || {});
    if (!isFinite(def.instinct)) def.instinct = null;
    if (ac.armored) def.armored = true;
    if (ac.mundaneImmune) def.mundaneImmune = true;
    def.statLine = ['HD ' + c.hd, 'AC ' + c.ac, 'Atk ' + c.atk, 'Dmg ' + dmg, 'Shock ' + (c.shock || '-'),
      'Move ' + def.move, 'ML ' + c.ml, 'Inst ' + c.inst, 'Skill ' + c.skill, 'Save ' + c.save].join(', ');
    def.raw = monsterText(def);
    return def;
  }

  // The text the Bestiary shows and the edit box takes: the name, the keyed
  // stat line, then the description.
  function monsterText(def) {
    return [def.name, def.statLine || '', def.desc ? '\n' + def.desc : ''].filter(s => s !== '').join('\n');
  }
  const KEYS = { hd: /\bHD\s*:?\s*([\d½.]+)/i, ac: /\bAC\s*:?\s*(\d+\s*[a*]*)/i, atk: /\bAtk\.?\s*:?\s*([^,]+)/i,
    dmg: /\bDmg\.?\s*:?\s*([^,]+)/i, shock: /\bShock\s*:?\s*([^,]+)/i, move: /\bMove\s*:?\s*([^,]+)/i,
    ml: /\bML\s*:?\s*(\d+)/i, inst: /\bInst(?:inct)?\.?\s*:?\s*(\d+)/i, skill: /\bSkill\s*:?\s*([+-]?\d+)/i, save: /\bSave\s*:?\s*(\d+\+?)/i };
  // "Name\nHD 1, AC 13a, Atk +1, Dmg Wpn, Shock Wpn, Move 30', ML 8, Inst 4, Skill +1, Save 15+\nText…"
  // or "Name\n<a book table row>". Returns a def, or null.
  function parseMonsterText(text, extra) {
    const lines = String(text || '').split(/\r?\n/);
    while (lines.length && !lines[0].trim()) lines.shift();
    if (!lines.length) return null;
    const row = parseStatLine(lines[0]);
    if (row) {
      row.desc = lines.slice(1).join('\n').trim();
      if (row.desc) row.raw = monsterText(row);
      return Object.assign(row, extra || {});
    }
    const name = lines[0].trim();
    const at = lines.findIndex((l, i) => i > 0 && KEYS.hd.test(l) && KEYS.ac.test(l));
    if (at === -1) return null;
    const stat = lines[at], c = { name };
    Object.keys(KEYS).forEach(k => { const m = stat.match(KEYS[k]); c[k] = m ? m[1].trim() : ''; });
    const def = monsterFromCols(c, extra);
    if (!def) return null;
    def.desc = lines.slice(at + 1).join('\n').trim();
    def.raw = monsterText(def);
    return def;
  }
  // Pasted text: monsters split by a line of ---, or one book table row per line.
  function parseMonsters(text) {
    const out = [];
    String(text || '').split(/^\s*-{3,}\s*$/m).forEach(chunk => {
      const lines = chunk.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) return;
      const rows = lines.map(parseStatLine);
      if (rows.every(Boolean)) { rows.forEach(r => out.push(r)); return; }
      const d = parseMonsterText(chunk);
      if (d) out.push(d);
    });
    return out;
  }

  // One table row as the book prints it, columns split by 2+ spaces or tabs:
  // "Thug or Militia  1  13a  +1  Wpn  Wpn  30'  8  4  +1  15+". The name may
  // be first; the 10 stat columns are the last ten cells.
  function parseStatLine(line) {
    const cells = String(line || '').trim().split(/\t+|\s{2,}/).map(s => s.trim()).filter(Boolean);
    if (cells.length < 11) return null;
    const v = cells.slice(-10);
    const name = cells.slice(0, cells.length - 10).join(' ');
    return monsterFromCols({ name, hd: v[0], ac: v[1], atk: v[2], dmg: v[3], shock: v[4], move: v[5], ml: v[6], inst: v[7], skill: v[8], save: v[9] });
  }

  // "2/13" → { dmg: 2, ac: 13 }; "4/-" → { dmg: 4, ac: null } (any AC);
  // "Wpn+1" → { weapon: true, bonus: 1 }; "None"/"-" → null.
  function parseShock(s) {
    const t = String(s || '').trim();
    if (!t || /^(none|-|n\/a)$/i.test(t)) return null;
    const w = t.match(/^wpn\s*([+-]\d+)?/i);
    if (w) return { weapon: true, bonus: w[1] ? parseInt(w[1], 10) : 0, anyAc: /\/\s*-/.test(t) };
    const m = t.match(/^(\d+)\s*\/\s*(?:AC\s*)?(\d+|-)/i);
    if (!m) return null;
    return { dmg: parseInt(m[1], 10), ac: m[2] === '-' ? null : parseInt(m[2], 10) };
  }
  function shockText(s) {
    const p = parseShock(s);
    if (!p) return 'None';
    if (p.weapon) return 'weapon Shock' + (p.bonus ? fmtMod(p.bonus) : '') + (p.anyAc ? ', any AC' : '');
    return p.dmg + ' damage on a miss' + (p.ac == null ? ', any AC' : ' vs AC ' + p.ac + ' or less');
  }

  const api = { ATTRS, SKILL_ATTR, attrMod, parse, mods, saves, skillCheck, sheetHtml, parseAc, monsterFromCols, parseStatLine, parseMonsterText, parseMonsters, monsterText, parseShock, shockText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.WwnSheet = api;
})(this);
