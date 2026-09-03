/* Monster stat-block parser for OSR formats (Shadowdark, OSE, best-effort generic).
 * Pure — no DOM, no storage. Exposes window.MonsterParse / module.exports.
 *
 *   MonsterParse.parseMonsters(text) -> [def, ...]
 *   MonsterParse.hdNum(hd)           -> number   (½ -> 0.5, "9*" -> 9)
 *
 * def shape:
 *   { name, source: 'shadowdark'|'ose'|'unknown', desc, raw,
 *     ac: { asc, desc, thac0 }, hd, hdNum, hp,
 *     move, align, xp, moraleML,
 *     atkBonus, attacksText, attacks: [ { label, count, toHit, damage, note, raw } ],
 *     stats: { S,D,C,I,W,Ch } | null,          // Shadowdark ability mods
 *     saveTargets: { D,W,P,B,S } | null,       // OSE save target numbers
 *     savesText,
 *     abilities: [ { name, text } ] }
 */
(function (root) {
  'use strict';

  function hdNum(hd) {
    if (hd == null) return 0;
    const s = String(hd).trim();
    if (/^(½|1\/2|\.5)/.test(s)) return 0.5;
    const m = s.match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }

  function firstDice(str) {
    const m = String(str || '').match(/\d*d\d+(?:\s*[+-]\s*\d+)*/i);
    return m ? m[0].replace(/\s+/g, '') : '';
  }

  function splitNameText(s) {
    s = String(s || '').trim();
    const m = s.match(/^(.{1,40}?)[:.]\s+([\s\S]+)$/);
    if (m) return { name: m[1].trim().replace(/[.:]$/, ''), text: m[2].trim() };
    return { name: '', text: s };
  }

  // "2 claw +6 (2d6)"  |  "Bite (4d12) + 2 × claw (3d6)"  |  "3 bite +6 (2d6 + poison)"
  function parseAttacks(text, defaultToHit) {
    const out = [];
    if (!text) return out;
    const parens = [];
    const masked = String(text).replace(/\([^)]*\)/g, m => {
      parens.push(m);
      return '@' + (parens.length - 1) + '@';
    });
    masked.split(/ \+ /).forEach(seg => {
      let g = seg.trim();
      if (!g) return;
      const restore = t => t.replace(/@(\d+)@/g, (_, i) => parens[+i] || '');
      let count = 1;
      const cm = g.match(/^(\d+)\s*(?:×|x|\*)?\s*/);
      if (cm) { count = parseInt(cm[1], 10) || 1; g = g.slice(cm[0].length); }
      let toHit = null;
      const hm = g.match(/([+-]\d+)\s*(?:to\s*hit)?(?=\s|@|$)/i);
      if (hm) toHit = parseInt(hm[1], 10);
      const parenText = (restore(g).match(/\(([^)]*)\)/) || [, ''])[1];
      const damage = firstDice(parenText);
      let note = parenText.replace(/\d*d\d+(?:\s*[+-]\s*\d+)*/i, '').replace(/^[\s+,-]+/, '').replace(/[\s,]+$/, '').trim();
      let label = g.replace(/@\d+@/g, '').replace(/[+-]\d+\s*(?:to\s*hit)?/i, '').trim();
      label = label.replace(/\s{2,}/g, ' ').replace(/[,;]+$/, '').trim() || 'attack';
      out.push({
        label, count,
        toHit: toHit != null ? toHit : (defaultToHit != null ? defaultToHit : null),
        damage, note, raw: restore(seg).trim()
      });
    });
    return out;
  }

  function parseSD(def, rest) {
    let m;
    if ((m = rest.match(/\bAC\s+(\d+)/i))) def.ac.asc = parseInt(m[1], 10);
    if ((m = rest.match(/\bHP\s+(\d+)/i))) def.hp = parseInt(m[1], 10);
    if ((m = rest.match(/\bATK\s+(.+?),\s*MV\b/i)) || (m = rest.match(/\bATK\s+(.+?),\s*S\s*[+-]/i)))
      def.attacksText = m[1].trim();
    if ((m = rest.match(/\bMV\s+(.+?),\s*S\s*[+-]/i))) def.move = m[1].trim();
    if ((m = rest.match(/\bS\s*([+-]?\d+),\s*D\s*([+-]?\d+),\s*C\s*([+-]?\d+),\s*I\s*([+-]?\d+),\s*W\s*([+-]?\d+),\s*Ch\s*([+-]?\d+)/i))) {
      def.stats = { S: +m[1], D: +m[2], C: +m[3], I: +m[4], W: +m[5], Ch: +m[6] };
      def.savesText = ['S', 'D', 'C', 'I', 'W', 'Ch']
        .map(k => k + ' ' + (def.stats[k] >= 0 ? '+' : '') + def.stats[k]).join('  ');
    }
    if ((m = rest.match(/\bAL\s+([A-Za-z]+)/i))) def.align = m[1];
    if ((m = rest.match(/\bLV\s*(\d+)/i))) def.hd = m[1];
    const bm = def.attacksText.match(/\+(\d+)/);
    if (bm) def.atkBonus = parseInt(bm[1], 10);
    def.attacks = parseAttacks(def.attacksText, def.atkBonus);

    const tail = rest.split(/\bLV\s*\d+\s*/i);
    const abText = tail.length > 1 ? tail.slice(1).join(' ').trim() : '';
    const pieces = abText
      ? abText.split(/(?<=\.)\s+(?=[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2}\.(?:\s|$))/)
      : [];
    def.abilities = pieces.map(p => splitNameText(p)).filter(a => a.text);
  }

  function parseOSE(def, rest, block) {
    let m;
    if ((m = rest.match(/\bAC\s+(-?\d+)\s*\[(-?\d+)\]/i))) {
      def.ac.desc = parseInt(m[1], 10);
      def.ac.asc = parseInt(m[2], 10);
    } else if ((m = rest.match(/\bAC\s+(-?\d+)/i))) {
      def.ac.desc = parseInt(m[1], 10);
      def.ac.asc = 19 - def.ac.desc;
    }
    if ((m = rest.match(/\bHd\s+([0-9½/]+\*?)\s*\((\d+)\s*hp\)/i))) {
      def.hd = m[1]; def.hp = parseInt(m[2], 10);
    } else if ((m = rest.match(/\bHd\s+([0-9½/]+\*?)/i))) {
      def.hd = m[1];
    }
    if ((m = rest.match(/\bAtt\s+(.+?)\s+THAC0\b/i)) || (m = rest.match(/\bAtt\s+(.+?)\s+Mv\b/i)))
      def.attacksText = m[1].trim();
    if ((m = rest.match(/\bTHAC0\s+(\d+)\s*\[([+-]?\d+)\]/i))) {
      def.ac.thac0 = parseInt(m[1], 10);
      def.atkBonus = parseInt(m[2], 10);
    }
    if ((m = rest.match(/\bMv\s+(.+?)\s+sv\b/i))) def.move = m[1].trim();
    if ((m = rest.match(/\bsv\s+D\s*(\d+)\s+W\s*(\d+)\s+P\s*(\d+)\s+B\s*(\d+)\s+S\s*(\d+)/i))) {
      def.saveTargets = { D: +m[1], W: +m[2], P: +m[3], B: +m[4], S: +m[5] };
      def.savesText = 'D' + m[1] + ' W' + m[2] + ' P' + m[3] + ' B' + m[4] + ' S' + m[5];
    }
    if ((m = rest.match(/\bML\s+(\d+)/i))) def.moraleML = parseInt(m[1], 10);
    if ((m = rest.match(/\bAL\s+([A-Za-z]+)/i))) def.align = m[1];
    if ((m = rest.match(/\bXP\s+([\d,]+)/i))) def.xp = parseInt(m[1].replace(/,/g, ''), 10);

    def.attacks = parseAttacks(def.attacksText, def.atkBonus);
    def.abilities = String(block).split('▶').slice(1)
      .map(p => splitNameText(p.replace(/\s+/g, ' ').trim()))
      .filter(a => a.text);
  }

  function parseGeneric(def, rest) {
    let m;
    if ((m = rest.match(/\bAC\s+(\d+)/i))) def.ac.asc = parseInt(m[1], 10);
    if ((m = rest.match(/\bHP\s+(\d+)/i))) def.hp = parseInt(m[1], 10);
    if ((m = rest.match(/\b(?:ATK|Att)\s+(.+?)(?:,|;|\.|$)/i))) def.attacksText = m[1].trim();
    if ((m = rest.match(/\b(?:HD|Hd)\s+([0-9½/]+\*?)/))) def.hd = m[1];
    def.attacks = parseAttacks(def.attacksText, def.atkBonus);
  }

  function parseOne(block) {
    const lines = String(block).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return null;
    const acIdx = lines.findIndex(l => /^AC[\s\d]/i.test(l));
    if (acIdx === -1) return null;

    const rest = lines.slice(acIdx).join(' ').replace(/\s+/g, ' ').trim();
    const isOSE = /THAC0/i.test(rest) || /\bsv\s+D\s*\d/i.test(rest) || /\bHd\s+[0-9½]/i.test(rest);
    const isSD = !isOSE && /\bATK\b/i.test(rest) && /\bLV\s*\d/i.test(rest);
    const source = isOSE ? 'ose' : (isSD ? 'shadowdark' : 'unknown');

    const def = {
      name: lines[0].replace(/\s+/g, ' ').trim(),
      source,
      desc: lines.slice(1, acIdx).join(' ').replace(/\s+/g, ' ').trim(),
      raw: String(block).replace(/\r/g, '').trim(),
      ac: { asc: null, desc: null, thac0: null },
      hd: '', hp: 0, move: '', align: '', xp: null, moraleML: null,
      atkBonus: null, attacksText: '', attacks: [],
      stats: null, saveTargets: null, savesText: '',
      abilities: []
    };

    if (source === 'ose') parseOSE(def, rest, block);
    else if (source === 'shadowdark') parseSD(def, rest);
    else parseGeneric(def, rest);

    def.hdNum = hdNum(def.hd);
    if (!def.hp) {
      const m = rest.match(/\bHP\s+(\d+)/i) || rest.match(/\((\d+)\s*hp\)/i);
      if (m) def.hp = parseInt(m[1], 10);
    }
    return def;
  }

  function parseMonsters(text) {
    const blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
    const out = [];
    blocks.forEach(b => {
      if (!b.trim()) return;
      const def = parseOne(b);
      if (def) out.push(def);
      else if (out.length) out[out.length - 1].raw += '\n\n' + b.trim();
    });
    return out;
  }

  const api = { parseMonsters, parseOne, hdNum };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MonsterParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
