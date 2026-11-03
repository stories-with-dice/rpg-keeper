/* Fate Core sheet text: parser, rewriters, the ladder, and the sheet panel.
 * Pure — no DOM, no storage. Exposes window.FateSheet / module.exports.
 *
 * One text format is shared by a character's ```fate fence (js/characters.js)
 * and a Fate NPC's `raw` text in the Bestiary (source 'fate'; its first line
 * is the name). One "Key: value" per line:
 *
 *   High Concept: Hedge-Witch of the Salt Marsh
 *   Trouble: Owes the Drowned King a Favor
 *   Aspect: My Brother Is the Mayor          (any number; also Instinct, Motivation, …)
 *   Great (+4): Lore                         (a ladder line: every skill on it)
 *   Good (+3): Will, Empathy
 *   Notice: +2                               (one skill: "Name: +N")
 *   Stunt: Salt Circle. +2 to defend with Will against spirits …
 *   Refresh: 3
 *   Physical Stress: [ ] [ ] [ ]             ([x] = checked; [1] [2] also read as empty)
 *   Mental Stress: [x] [ ] [ ] [ ]
 *   Mild:                                    (a consequence slot; the text is the aspect)
 *   Moderate: Sprained Wrist
 *   Severe:
 *   Mob: 4                                   (NPCs: a group of nameless NPCs)
 *   Note: Concedes once it takes a moderate consequence.
 *
 *   FateSheet.parse(text) -> def (below)
 *   FateSheet.parseNpc(text) -> def plus { name } (first non-key line)
 *   FateSheet.setStressBox(text, track, box, checked) -> new text
 *   FateSheet.setConsequence(text, index, value) -> new text
 *   FateSheet.clearStress(text) -> new text (every box empty)
 *   FateSheet.ladderName(n) / ladderLabel(n) ("Good (+3)") / fmtRank(n)
 *   FateSheet.sheetHtml(def, opts) -> the View-mode panel (escapes every value)
 *   FateSheet.npcDef(text, extra) -> a Bestiary def (source 'fate', raw = text) or null
 *
 * def: { aspects: [{ label, text }], skills: [{ name, rank }] (highest first),
 *        stunts: [{ name, text }], refresh: n|null,
 *        stress: [{ name, boxes: [bool] }], consequences: [{ label, value, text }],
 *        mob: n|null, weapon: n|null, armor: n|null, notes: [string], extra: [{ key, value }] }
 */
(function (root) {
  'use strict';

  const LADDER = {
    '-4': 'Horrifying', '-3': 'Abysmal', '-2': 'Terrible', '-1': 'Poor', '0': 'Mediocre',
    '1': 'Average', '2': 'Fair', '3': 'Good', '4': 'Great', '5': 'Superb', '6': 'Fantastic',
    '7': 'Epic', '8': 'Legendary'
  };
  const LADDER_BY_NAME = {};
  Object.keys(LADDER).forEach(k => { LADDER_BY_NAME[LADDER[k].toLowerCase()] = Number(k); });

  function fmtRank(n) { return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '+0'; }
  function ladderName(n) {
    n = Math.round(Number(n) || 0);
    if (LADDER[String(n)]) return LADDER[String(n)];
    return n > 8 ? 'Beyond Legendary' : 'Below Horrifying';
  }
  function ladderLabel(n) { return ladderName(n) + ' (' + fmtRank(Math.round(Number(n) || 0)) + ')'; }

  // Aspect keys, in display order. "Aspect"/"Aspects" lines are plain aspects.
  const ASPECT_KEYS = ['high concept', 'trouble', 'instinct', 'motivation', 'relationship', 'belief', 'edge', 'disposition', 'aspect', 'aspects'];
  const CONSEQUENCE_VALUES = { mild: 2, moderate: 4, severe: 6, extreme: 8 };
  // Keys with a number value that are not skills.
  const NUMBER_KEYS = ['refresh', 'mob', 'weapon', 'armor', 'fate points', 'peak', 'pc peak'];

  const KEY_RE = /^\s*([^:]{1,40}?)\s*:\s*(.*)$/;
  const RANK_RE = /^([+\-−]?\d{1,2})$/;
  const LADDER_LINE_RE = /^\s*([A-Za-z ]+?)\s*\(\s*([+\-−]?\d{1,2})\s*\)\s*:\s*(.*)$/;
  const BOX_RE = /\[\s*([xX✓✔*]|\d*)\s*\]/g;

  const toInt = s => parseInt(String(s).replace('−', '-'), 10);
  const titleCase = s => s.replace(/\b[a-z]/g, c => c.toUpperCase());

  function isStressKey(k) { return /(^|\s)stress$/i.test(k); }
  function consequenceKind(k) {
    const m = k.toLowerCase().match(/\b(mild|moderate|severe|extreme)\b/);
    return m && /consequence|^(?:physical |mental )?(mild|moderate|severe|extreme)\b/i.test(k) ? m[1] : null;
  }

  // The lines of `text` as { i, key, value } (key null for a line with no
  // "Key:"). A ladder line ("Good (+3): Fight") has key "Good (+3)".
  function lines(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split('\n').map((line, i) => {
      const m = line.match(KEY_RE);
      return m ? { i, line, key: m[1].trim(), value: m[2].trim() } : { i, line, key: null, value: line.trim() };
    });
  }

  function parseBoxes(value) {
    const out = [];
    let m;
    BOX_RE.lastIndex = 0;
    while ((m = BOX_RE.exec(value))) out.push(/[xX✓✔*]/.test(m[1]));
    if (!out.length && /^\d{1,2}$/.test(value)) for (let i = 0; i < +value; i++) out.push(false);
    return out;
  }

  function parse(text) {
    const def = { aspects: [], skills: [], stunts: [], refresh: null, stress: [], consequences: [], mob: null, weapon: null, armor: null, notes: [], extra: [] };
    const seenSkill = new Set();
    const addSkill = (name, rank) => {
      name = name.replace(/^[-*•\s]+/, '').trim();
      if (!name || isNaN(rank) || seenSkill.has(name.toLowerCase())) return;
      seenSkill.add(name.toLowerCase());
      def.skills.push({ name, rank });
    };
    lines(text).forEach(l => {
      if (!l.key) return;
      const k = l.key.toLowerCase();
      const lad = l.line.match(LADDER_LINE_RE);
      if (lad && LADDER_BY_NAME[lad[1].trim().toLowerCase()] != null) {
        const rank = toInt(lad[2]);
        lad[3].split(/[,;]/).forEach(n => addSkill(n, rank));
        return;
      }
      if (ASPECT_KEYS.indexOf(k) !== -1) {
        const label = k === 'aspect' || k === 'aspects' ? 'Aspect' : titleCase(k);
        (k === 'aspects' ? l.value.split(';') : [l.value]).forEach(t => {
          t = t.trim();
          if (t) def.aspects.push({ label, text: t });
        });
        return;
      }
      if (k === 'stunt' || k === 'stunts') {
        if (!l.value) return;
        const sm = l.value.match(/^(.{1,60}?)(?:\.\s+|\s+[—–-]\s+)(.+)$/);
        def.stunts.push(sm ? { name: sm[1].trim(), text: sm[2].trim() } : { name: '', text: l.value });
        return;
      }
      if (isStressKey(l.key)) { def.stress.push({ name: l.key, boxes: parseBoxes(l.value) }); return; }
      const ck = consequenceKind(l.key);
      if (ck) { def.consequences.push({ label: l.key, value: CONSEQUENCE_VALUES[ck], text: l.value }); return; }
      if (k === 'note' || k === 'notes') { if (l.value) def.notes.push(l.value); return; }
      if (NUMBER_KEYS.indexOf(k) !== -1) {
        const n = toInt(l.value);
        if (k === 'refresh') def.refresh = isNaN(n) ? null : n;
        else if (k === 'mob') def.mob = isNaN(n) ? null : n;
        else if (k === 'weapon') def.weapon = isNaN(n) ? null : n;
        else if (k === 'armor') def.armor = isNaN(n) ? null : n;
        return;
      }
      // "Fight: +3; Athletics: +2" — one or more skills on a line.
      const pairs = l.line.split(/[;|]/).map(p => p.match(KEY_RE)).filter(Boolean);
      if (pairs.length && pairs.every(p => RANK_RE.test(p[2].trim()))) {
        pairs.forEach(p => addSkill(p[1], toInt(p[2].trim())));
        return;
      }
      def.extra.push({ key: l.key, value: l.value });
    });
    def.skills.sort((a, b) => b.rank - a.rank);
    return def;
  }

  // An NPC's text: the first line that is not "Key: value" is the name.
  function parseNpc(text) {
    const def = parse(text);
    const first = lines(text).find(l => l.value && !l.key);
    def.name = first ? first.value.replace(/^#+\s*/, '').replace(/^\*+|\*+$/g, '').trim() : '';
    return def;
  }

  // Rewrites the Nth line that `match(line)` accepts.
  function rewriteNth(text, n, match, rewrite) {
    let idx = -1;
    return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(line => {
      const m = line.match(KEY_RE);
      if (!m || !match(m[1].trim())) return line;
      idx++;
      return idx === n ? rewrite(line, m) : line;
    }).join('\n');
  }

  const boxesText = boxes => boxes.map(b => (b ? '[x]' : '[ ]')).join(' ');

  // Checks (or clears) box `box` of the `track`-th stress line.
  //   setStressBox("Physical Stress: [ ] [ ]", 0, 1, true) → "Physical Stress: [ ] [x]"
  function setStressBox(text, track, box, checked) {
    return rewriteNth(text, track, isStressKey, (line, m) => {
      const boxes = parseBoxes(m[2].trim());
      if (box < 0 || box >= boxes.length) return line;
      boxes[box] = !!checked;
      return m[1].trim() + ': ' + boxesText(boxes);
    });
  }
  // Every stress box empty (the end of a conflict).
  function clearStress(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(line => {
      const m = line.match(KEY_RE);
      if (!m || !isStressKey(m[1].trim())) return line;
      return m[1].trim() + ': ' + boxesText(parseBoxes(m[2].trim()).map(() => false));
    }).join('\n');
  }
  // Sets the text of the `index`-th consequence line.
  //   setConsequence("Mild:\nModerate:", 1, "Cracked Ribs") → "Mild:\nModerate: Cracked Ribs"
  function setConsequence(text, index, value) {
    const v = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
    return rewriteNth(text, index, k => !!consequenceKind(k), (line, m) => m[1].trim() + ':' + (v ? ' ' + v : ''));
  }

  /* ---- View-mode panel ---- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const rollFormula = rank => '4dF' + (rank >= 0 ? '+' : '') + rank;

  // opts: { fence: index of the fence/text on its owner (data-fence), readOnly,
  //         name (shown as a header, NPCs) }
  // Skills are .roll spans (data-formula "4dF+N"); stress boxes are .fate-box
  // buttons; consequences are .fate-cons inputs. The owner's click/change
  // handler rewrites the text (js/characters.js, js/combat.js).
  function sheetHtml(def, opts) {
    opts = opts || {};
    const fence = ' data-fence="' + (opts.fence || 0) + '"';
    let h = '<div class="fate-sheet"' + fence + '>';
    if (opts.name) h += '<div class="fate-name">' + esc(opts.name) + '</div>';
    if (def.aspects.length) {
      h += '<div class="fate-sec"><h4>Aspects</h4><ul class="fate-aspects">' + def.aspects.map(a =>
        '<li><span class="fate-aspect-label">' + esc(a.label) + '</span> <span class="fate-aspect">' + esc(a.text) + '</span></li>').join('') + '</ul></div>';
    }
    if (def.skills.length) {
      const groups = [];
      def.skills.forEach(s => {
        const g = groups.find(x => x.rank === s.rank);
        if (g) g.names.push(s.name); else groups.push({ rank: s.rank, names: [s.name] });
      });
      h += '<div class="fate-sec"><h4>Skills</h4><div class="fate-skills">' + groups.map(g =>
        '<div class="fate-skill-row"><span class="fate-rank no-annotate">' + esc(ladderLabel(g.rank)) + '</span> ' +
        g.names.map(n => '<span class="roll fate-skill" data-formula="' + rollFormula(g.rank) + '" data-skill="' + esc(n) + '" title="Roll ' + rollFormula(g.rank) + ' (' + esc(n) + ')">' + esc(n) + '</span>').join(', ') +
        '</div>').join('') + '</div></div>';
    }
    if (def.stunts.length) {
      h += '<div class="fate-sec"><h4>Stunts</h4><ul class="fate-stunts">' + def.stunts.map(s =>
        '<li>' + (s.name ? '<b>' + esc(s.name) + '.</b> ' : '') + esc(s.text) + '</li>').join('') + '</ul></div>';
    }
    const chips = [];
    if (def.refresh != null) chips.push('Refresh ' + def.refresh);
    if (def.mob) chips.push('Mob of ' + def.mob);
    if (def.weapon) chips.push('Weapon:' + def.weapon);
    if (def.armor) chips.push('Armor:' + def.armor);
    def.extra.forEach(x => chips.push(x.key + ': ' + x.value));
    if (chips.length) h += '<div class="fate-chips">' + chips.map(c => '<span class="chip">' + esc(c) + '</span>').join('') + '</div>';
    if (def.stress.length) {
      h += '<div class="fate-sec"><h4>Stress</h4>' + def.stress.map((t, ti) =>
        '<div class="fate-track"><span class="fate-track-name no-annotate">' + esc(t.name.replace(/\s*stress$/i, '') || 'Stress') + '</span>' +
        (t.boxes.length ? t.boxes.map((b, bi) =>
          '<button type="button" class="fate-box' + (b ? ' is-checked' : '') + '" data-track="' + ti + '" data-box="' + bi + '"' +
          (opts.readOnly ? ' disabled' : '') + ' title="' + (b ? 'Clear' : 'Check') + ' the ' + (bi + 1) + '-shift box">' + (bi + 1) + '</button>').join('')
          : '<span class="hint">none — one hit takes them out</span>') +
        '</div>').join('') + '</div>';
    }
    if (def.consequences.length) {
      h += '<div class="fate-sec"><h4>Consequences</h4>' + def.consequences.map((c, ci) =>
        '<label class="fate-cons-row"><span class="fate-cons-label no-annotate">' + esc(c.label) + ' <span class="fate-cons-val">' + c.value + '</span></span>' +
        '<input type="text" class="fate-cons" data-i="' + ci + '" value="' + esc(c.text) + '" placeholder="—"' + (opts.readOnly ? ' disabled' : '') + ' /></label>').join('') + '</div>';
    }
    if (def.notes.length) h += '<div class="fate-notes">' + def.notes.map(n => '<p>' + esc(n) + '</p>').join('') + '</div>';
    return h + '</div>';
  }

  // A Bestiary def for a Fate NPC: `raw` (the text above, name first) is the
  // only source of truth; the rest is metadata from the NPC generator (extra).
  function npcDef(text, extra) {
    const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
    const p = parseNpc(raw);
    if (!p.name) return null;
    const peak = p.skills.length ? p.skills[0].rank : 0;
    return Object.assign({
      name: p.name, source: 'fate', raw, desc: '',
      hd: '', hdNum: peak, hp: 0, attacks: [], abilities: [], attacksText: '', savesText: ''
    }, extra || {});
  }

  const api = {
    LADDER, ASPECT_KEYS, CONSEQUENCE_VALUES, fmtRank, ladderName, ladderLabel,
    parse, parseNpc, parseBoxes, setStressBox, clearStress, setConsequence, sheetHtml, npcDef, rollFormula
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FateSheet = api;
})(typeof window !== 'undefined' ? window : globalThis);
