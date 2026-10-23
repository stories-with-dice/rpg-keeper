/* Unknown Armies 3rd Edition character statblock parser.
 * Pure — no DOM, no storage. Exposes window.UAStatblock / module.exports.
 *
 *   UAStatblock.parseUAStatblock(text) -> def
 *   UAStatblock.computeAbilityPair(hardened) -> { upbeat, downbeat }
 *   UAStatblock.computeAllAbilities(shock) -> { <Meter>: {...}, ... }
 *   UAStatblock.METER_ORDER   ['Helplessness','Isolation','Self','Unnatural','Violence']
 *   UAStatblock.METER_ABILITIES  { Helplessness: ['Fitness','Dodge'], ... }
 *   UAStatblock.METER_DEFEND_ATTACK  { Helplessness: {defend:'Status',coerce:'Connect'}, ... }
 *   UAStatblock.METER_RELATIONSHIP  { Helplessness: 'Protégé', ... }
 *   UAStatblock.parseFeatures(featuresText) -> [{raw,kind,verb,target}, ...]
 *   UAStatblock.computeSubstitutions(identities) -> { <AbilityName>: {pct,identityName,obsession} }
 *   UAStatblock.setShockValue(innerText, meter, field, value) -> new inner text (see js/characters.js)
 *   UAStatblock.parseUAMonster(text) -> a GMC/entity statblock (see "Bestiary" below)
 *   UAStatblock.uaMonsterDef(text) -> a Bestiary def (source 'ua3e', raw = text) or null
 *   UAStatblock.abilityValues(def) -> { <AbilityName>: { value, from } } for a GMC (Combat)
 *   UAStatblock.woundState(wounds, threshold) -> { key, label } (p.63 wound bands)
 *   UAStatblock.initiativeOf(identities) -> the Provides Initiative identity, or null
 *   UAStatblock.damageOptions(roll) -> wounds from a d100 attack roll, by weapon (p.63-65)
 *
 * def shape:
 *   { identities: [ { name, pct, value, obsession, features } ],   (pct null when value is a
 *                                                                  range or dice, e.g. "3d10+40")
 *     obsession: string,                          ("Obsession: …" line, optional)
 *     abilityOverrides: { <AbilityName>: { pct, obsession, note } },  ("Abilities" section, optional)
 *     passions: { fear?: {meter, text}, noble?: {text}, rage?: {text} },
 *     relationships: [ { role, text, name, pct } ],
 *     woundThreshold: number|null,
 *     shock: { <Meter>: { hardened, failed } },
 *     abilities: { <Meter>: { hardened, failed, upbeatName, upbeatPct, downbeatName, downbeatPct } } }
 *
 * Expected input (inside a ```ua fenced block on a character sheet):
 *
 *   Identities
 *   Civil War Re-Enactor 65%* — Provides Initiative, Substitutes for Dodge, Substitutes for Fitness
 *
 *   Passions
 *   Fear (Isolation): Dying alone and unloved.
 *   Noble: Reconciliation with his ex-wife.
 *   Rage: Bullies of any kind, especially family members.
 *
 *   Relationships
 *   Responsibility: Rachel 45%
 *
 *   Wound Threshold: 50
 *
 *   Shock
 *   Helplessness: 1 hardened / 1 failed
 *   Isolation: 3 hardened / 2 failed
 *   Self: 2 hardened / 0 failed
 *   Unnatural: 1 hardened / 2 failed
 *   Violence: 2 hardened / 3 failed
 *
 * Parsing is line-oriented and forgiving (unmatched lines inside a section
 * are simply skipped), in the same spirit as js/monsters.js.
 */
(function (root) {
  'use strict';

  const METER_ORDER = ['Helplessness', 'Isolation', 'Self', 'Unnatural', 'Violence'];
  // Upbeat (open-notch) ability first, downbeat (hardened-notch) ability second.
  const METER_ABILITIES = {
    Helplessness: ['Fitness', 'Dodge'],
    Isolation: ['Status', 'Pursuit'],
    Self: ['Knowledge', 'Lie'],
    Unnatural: ['Notice', 'Secrecy'],
    Violence: ['Connect', 'Struggle']
  };
  const METER_RE = new RegExp('^(' + METER_ORDER.join('|') + ')\\b', 'i');
  function normalizeMeter(s) {
    const m = String(s || '').trim().match(METER_RE);
    if (!m) return null;
    return METER_ORDER.find(x => x.toLowerCase() === m[1].toLowerCase()) || null;
  }

  // All 10 abilities, upbeat+downbeat flattened.
  const ALL_ABILITIES = METER_ORDER.reduce((a, m) => a.concat(METER_ABILITIES[m]), []);
  // "Struggle 80%* — note": an ability the book gives directly (a GMC's "Abilities" section).
  const ABILITY_LINE_RE = new RegExp('^(' + ALL_ABILITIES.join('|') + ')\\s+(\\d{1,3})%(\\*)?(?:\\s*(?:[—–-]+|:)\\s*(.*))?$', 'i');

  // p.19's "Defend Against Challenges To… With…" table, cross-checked against
  // every sample character sheet's per-meter "Defend with X / Attack with Y"
  // block (identical on all of them — a fixed, universal mapping, not
  // character-specific). "Attack with" is the ability rolled to Coerce (p.38)
  // that meter absent an identity's own Coerces-a-Meter feature; sheets name
  // that ability directly in the feature text ("Coerces Connect" on a Father
  // identity == "this identity coerces Helplessness").
  const METER_DEFEND_ATTACK = {
    Helplessness: { defend: 'Status', coerce: 'Connect' },
    Isolation: { defend: 'Connect', coerce: 'Status' },
    Self: { defend: 'Notice', coerce: 'Knowledge' },
    Unnatural: { defend: 'Knowledge', coerce: 'Secrecy' },
    Violence: { defend: 'Fitness', coerce: 'Struggle' }
  };

  // p.41's "Shock Gauges, Correspondences, and You": each meter is linked to
  // one of the five Relationship roles — used to lay out the sheet with the
  // relationship next to the meter it's tied to, same as the physical sheet.
  const METER_RELATIONSHIP = {
    Helplessness: 'Protégé',
    Isolation: 'Favorite',
    Self: 'Responsibility',
    Unnatural: 'Guru',
    Violence: 'Mentor'
  };
  // Case/diacritic-insensitive compare — a relationship's role is whatever
  // spelling/casing the sheet author typed ("Protege", "Protégé", …).
  function normalizeRole(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  // Identity feature verbs (p.44-45): the clause immediately after the verb
  // is the target (a meter, ability, or free text for Unique/Medical/etc).
  const FEATURE_KEYWORDS = [
    { kind: 'substitutes', re: /^substitutes\s+for\b/i },
    { kind: 'coerces', re: /^coerces\b/i },
    { kind: 'evaluates', re: /^evaluates\b/i },
    { kind: 'protects', re: /^protects\b/i }, // sheet shorthand for "Resists Shocks to a Meter"
    { kind: 'resists', re: /^resists(?:\s+shocks?(?:\s+to)?)?\b/i },
    { kind: 'provides', re: /^provides\b/i },
    { kind: 'casts-rituals', re: /^casts?\s+rituals?\b/i },
    { kind: 'gutter-magick', re: /^use[s]?\s+gutter\s+magick\b/i },
    { kind: 'medical', re: /^medical\b/i },
    { kind: 'therapeutic', re: /^therapeutic\b/i },
    { kind: 'unique', re: /^unique\b/i }
  ];

  // One feature clause ("Substitutes for Dodge") -> { raw, kind, verb, target }.
  // kind is 'other' (verb '', target = the whole clause) when nothing matches.
  function parseFeatureClause(raw) {
    const text = String(raw || '').trim();
    for (let i = 0; i < FEATURE_KEYWORDS.length; i++) {
      const m = text.match(FEATURE_KEYWORDS[i].re);
      if (m) return { raw: text, kind: FEATURE_KEYWORDS[i].kind, verb: m[0].trim(), target: text.slice(m[0].length).trim() };
    }
    return { raw: text, kind: 'other', verb: '', target: text };
  }

  // An identity's raw comma-separated features string -> [{raw,kind,verb,target}].
  function parseFeatures(featuresText) {
    return String(featuresText || '').split(',').map(s => s.trim()).filter(Boolean).map(parseFeatureClause);
  }

  // { <AbilityName>: { pct, identityName, obsession } } for every ability
  // that at least one identity Substitutes For. Last identity in the list
  // wins on a collision (two identities substituting the same ability is not
  // normal, but stay deterministic if it happens).
  function computeSubstitutions(identities) {
    const out = {};
    (identities || []).forEach(id => {
      parseFeatures(id.features).forEach(f => {
        if (f.kind !== 'substitutes') return;
        const ability = ALL_ABILITIES.find(a => a.toLowerCase() === f.target.toLowerCase());
        if (ability) out[ability] = { pct: id.pct, value: id.value != null ? id.value : String(id.pct), identityName: id.name, obsession: !!id.obsession };
      });
    });
    return out;
  }

  const SECTION_RE = /^(identities|passions|relationships|abilities|shock(?:\s+meter)?)\s*:?\s*$/i;
  // An identity's rating: a number, or (for some unnatural entities) a range
  // ("20-80") or dice ("3d10+40") the GM rolls or picks; "?" when unknown.
  const IDENTITY_RE = /^(.+?)\s+(\?|\d[\dd+\-]*)%(\*)?(?:\s*(?:[—–-]+|:)\s*(.*))?$/;

  // p.30: upbeat = 65 − 5×hardened, downbeat = 15 + 5×hardened. Hardened is
  // 0–9; the formula alone keeps upbeat in [20,65] and downbeat in [15,60]
  // over that range, the Math.max/min here are just defensive clamps.
  function computeAbilityPair(hardened) {
    const h = Math.max(0, Math.min(9, Math.round(Number(hardened) || 0)));
    return { upbeat: Math.max(20, 65 - 5 * h), downbeat: Math.min(60, 15 + 5 * h) };
  }

  function computeAllAbilities(shock) {
    const out = {};
    METER_ORDER.forEach(meter => {
      const s = (shock && shock[meter]) || {};
      const hardened = Math.max(0, Math.round(Number(s.hardened) || 0));
      const failed = Math.max(0, Math.round(Number(s.failed) || 0));
      const pair = computeAbilityPair(hardened);
      const names = METER_ABILITIES[meter];
      out[meter] = {
        hardened, failed,
        upbeatName: names[0], upbeatPct: pair.upbeat,
        downbeatName: names[1], downbeatPct: pair.downbeat
      };
    });
    return out;
  }

  function parseUAStatblock(text) {
    const def = { identities: [], passions: {}, relationships: [], woundThreshold: null, shock: {}, obsession: '', abilityOverrides: {} };
    let section = '';
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(raw => {
      const line = raw.trim();
      if (!line) return;

      const wtm = line.match(/^wound\s+threshold\s*:?\s*(\d+)/i);
      if (wtm) { def.woundThreshold = parseInt(wtm[1], 10); return; }

      const sm = line.match(SECTION_RE);
      if (sm) { section = sm[1].toLowerCase().replace(/\s+meter$/, ''); return; }

      const om = line.match(/^obsession\s*:\s*(.+)$/i);
      if (om) { def.obsession = om[1].trim(); return; }

      if (section === 'identities') {
        const m = line.match(IDENTITY_RE);
        if (m) {
          def.identities.push({
            name: m[1].trim(), pct: /^\d{1,3}$/.test(m[2]) ? parseInt(m[2], 10) : null, value: m[2],
            obsession: !!m[3], features: (m[4] || '').trim()
          });
        }
      } else if (section === 'abilities') {
        const m = line.match(ABILITY_LINE_RE);
        if (m) {
          const name = ALL_ABILITIES.find(a => a.toLowerCase() === m[1].toLowerCase());
          def.abilityOverrides[name] = { pct: parseInt(m[2], 10), obsession: !!m[3], note: (m[4] || '').trim() };
        }
      } else if (section === 'passions') {
        const m = line.match(/^(Fear|Noble|Rage)\b\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/i);
        if (m) {
          def.passions[m[1].toLowerCase()] = { meter: m[2] ? m[2].trim() : '', text: m[3].trim() };
        }
      } else if (section === 'relationships') {
        const m = line.match(/^(Favorite|Guru|Mentor|Prot[ée]g[ée]|Responsibility)\s*:\s*(.+)$/i);
        if (m) {
          const text = m[2].trim();
          const pm = text.match(/^(.*?)\s*(\d{1,3})\s*%\s*$/);
          const name = pm ? pm[1].trim() : (/^_+\s*%?$/.test(text) ? '' : text);
          def.relationships.push({ role: m[1], text, name, pct: pm ? parseInt(pm[2], 10) : null });
        }
      } else if (section === 'shock') {
        const meter = normalizeMeter(line);
        if (!meter) return;
        const rest = line.slice(line.indexOf(':') + 1);
        const nums = rest.match(/\d+/g);
        // A GMC's book entry sometimes gives only the hardened notches.
        if (nums && nums.length) {
          def.shock[meter] = { hardened: parseInt(nums[0], 10), failed: nums.length >= 2 ? parseInt(nums[1], 10) : 0 };
        }
      }
    });
    def.abilities = computeAllAbilities(def.shock);
    return def;
  }

  // Click-to-edit support: rewrites one Shock meter's Hardened/Failed count
  // within a ```ua fence's INNER text (the raw content between the
  // backticks — see js/characters.js's patchUAFence, which splices the
  // result back into a character's body). `field` is 'hardened'|'failed';
  // value is clamped to 0-9 (hardened) / 0-5 (failed). Rewrites the number
  // in place, preserving the rest of the line's own formatting/punctuation.
  // If the meter has no Shock line yet, one is appended (creating the Shock
  // section too, if that's missing) rather than silently doing nothing.
  function setShockValue(innerText, meter, field, value) {
    const max = field === 'hardened' ? 9 : 5;
    const clamped = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
    const lines = String(innerText || '').replace(/\r\n?/g, '\n').split('\n');
    let section = '';
    let shockHeaderIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const sm = line.match(SECTION_RE);
      if (sm) {
        section = sm[1].toLowerCase().replace(/\s+meter$/, '');
        if (section === 'shock') shockHeaderIdx = i;
        continue;
      }
      if (section !== 'shock' || normalizeMeter(line) !== meter) continue;
      // Numbers appear in "hardened, failed" order regardless of exact
      // wording/punctuation between them — rewrite only the target one.
      let seen = 0;
      const target = field === 'hardened' ? 1 : 2;
      lines[i] = lines[i].replace(/\d+/g, numStr => (++seen === target ? String(clamped) : numStr));
      return lines.join('\n');
    }
    // No existing line for this meter — synthesize one (0 for the other field).
    const newLine = meter + ': ' + (field === 'hardened' ? clamped : 0) + ' hardened / ' +
      (field === 'failed' ? clamped : 0) + ' failed';
    if (shockHeaderIdx === -1) {
      if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
      lines.push('Shock', newLine);
    } else {
      lines.splice(shockHeaderIdx + 1, 0, newLine);
    }
    return lines.join('\n');
  }

  /* ---- Bestiary: GMCs and unnatural entities (system 'ua3e') ----
   * A GMC uses the same statblock as a PC fence, after a short header:
   *
   *   Night Clerk                         <- name (the first line)
   *   Sees everything, says nothing       <- any other header line: description
   *   Type: GMC                           <- or "Significant Unnatural Entity", …
   *   Book: Homebrew, p. 1
   *   Wound Threshold: 50                 <- or the book's text ("Equal to its host")
   *   Obsession: Knowing who checks in.
   *
   *   Identities / Abilities / Passions / Shock   (as in parseUAStatblock)
   *
   * A Bestiary def keeps this text as `raw` — the only source of truth, parsed
   * again wherever it is shown (Combat, the library preview), the same as a
   * PC's ```ua fence. */
  const HEADER_RE = /^(type|book|wound\s+threshold)\s*:\s*(.*)$/i;

  function parseUAMonster(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());
    const out = { name: '', desc: '', type: '', book: '', woundThresholdText: '' };
    const desc = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (SECTION_RE.test(line)) break; // the header ends at the first section
      const h = line.match(HEADER_RE);
      if (h) {
        const key = h[1].toLowerCase().replace(/\s+/g, ' ');
        if (key === 'type') out.type = h[2].trim();
        else if (key === 'book') out.book = h[2].trim();
        else if (!/^\d+\s*$/.test(h[2])) out.woundThresholdText = h[2].trim();
      } else if (/^obsession\s*:/i.test(line)) {
        continue; // parseUAStatblock reads it
      } else if (!out.name) {
        out.name = line;
      } else {
        desc.push(line);
      }
    }
    out.desc = desc.join(' ');
    const def = parseUAStatblock(text);
    def.hasShock = Object.keys(def.shock).length > 0;
    return Object.assign(def, out);
  }

  // A Bestiary def for a pasted GMC statblock (js/monster-modals.js), or null
  // without a name. The generic def fields stay empty: no HD, AC or attacks.
  function uaMonsterDef(text) {
    const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
    const p = parseUAMonster(raw);
    if (!p.name) return null;
    return {
      name: p.name, source: 'ua3e', raw: raw, desc: p.desc,
      hd: '', hdNum: 0, hp: 0, attacks: [], abilities: [], attacksText: '', savesText: ''
    };
  }

  // A GMC's ten abilities for Combat: the book's own value ("Abilities"
  // section) first, then an identity that Substitutes for it, then the shock
  // gauge formula (p.30). Without a Shock section the gauge gives nothing, so
  // an ability no identity covers is left out (the book does not say).
  // { <AbilityName>: { value: '60' | '3d10+40', from: 'book'|'identity'|'shock', identityName? } }
  function abilityValues(def) {
    const out = {};
    if (def.hasShock !== false && Object.keys(def.shock || {}).length) {
      METER_ORDER.forEach(m => {
        const a = def.abilities[m];
        out[a.upbeatName] = { value: String(a.upbeatPct), from: 'shock' };
        out[a.downbeatName] = { value: String(a.downbeatPct), from: 'shock' };
      });
    }
    const subs = computeSubstitutions(def.identities);
    Object.keys(subs).forEach(a => { out[a] = { value: subs[a].value, from: 'identity', identityName: subs[a].identityName }; });
    Object.keys(def.abilityOverrides || {}).forEach(a => { out[a] = { value: String(def.abilityOverrides[a].pct), from: 'book' }; });
    return out;
  }

  // p.63, "Damage": at half the wound threshold you hurt after the fight, at
  // three quarters you are badly beat up, at 90% you fall unconscious, at the
  // threshold you are dead. Wounds count up from 0.
  const WOUND_BANDS = [
    { key: 'dead', at: 1, label: 'Dead' },
    { key: 'unconscious', at: 0.9, label: 'Unconscious' },
    { key: 'badly-hurt', at: 0.75, label: 'Badly hurt' },
    { key: 'hurt', at: 0.5, label: 'Hurt' }
  ];
  function woundBand(threshold, at) { return Math.ceil(threshold * at); }
  function woundState(wounds, threshold) {
    const w = Math.max(0, Number(wounds) || 0), t = Number(threshold) || 0;
    if (t > 0) {
      const b = WOUND_BANDS.find(x => w >= woundBand(t, x.at));
      if (b) return { key: b.key, label: b.label };
    }
    return { key: 'ok', label: w > 0 ? 'Wounded' : 'Unhurt' };
  }

  // p.62: a tie in who acts first goes to the higher rating used — unless an
  // identity Provides Initiative, then that identity's rating always counts.
  function initiativeOf(identities) {
    return (identities || []).find(id => parseFeatures(id.features).some(f =>
      f.kind === 'provides' && /^initiative$/i.test(f.target))) || null;
  }

  // Wounds from a successful d100 attack roll (p.63-65): fists, kicks and
  // thrown things do the sum of the two dice (32 -> 5); a melee weapon adds
  // +3 for each of sharp, big and heavy; a gun does the roll itself (capped
  // by the weapon), and so does a melee weapon on a matched success.
  function damageOptions(roll) {
    const r = Math.max(1, Math.min(100, Math.round(Number(roll) || 0)));
    const sum = Math.floor((r % 100) / 10) + (r % 10);
    return [
      { key: 'fists', label: 'Fists / thrown', wounds: sum },
      { key: 'melee3', label: 'Weapon +3', wounds: sum + 3 },
      { key: 'melee6', label: 'Weapon +6', wounds: sum + 6 },
      { key: 'melee9', label: 'Weapon +9', wounds: sum + 9 },
      { key: 'gun', label: 'Gun / matched weapon', wounds: r }
    ];
  }

  const api = {
    parseUAStatblock, computeAbilityPair, computeAllAbilities,
    METER_ORDER, METER_ABILITIES, ALL_ABILITIES, METER_DEFEND_ATTACK, METER_RELATIONSHIP, normalizeRole,
    parseFeatureClause, parseFeatures, computeSubstitutions, FEATURE_KEYWORDS, setShockValue,
    parseUAMonster, uaMonsterDef, abilityValues, WOUND_BANDS, woundBand, woundState, initiativeOf, damageOptions
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.UAStatblock = api;
})(typeof window !== 'undefined' ? window : globalThis);
