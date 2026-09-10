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
 *
 * def shape:
 *   { identities: [ { name, pct, obsession, features } ],
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
        if (ability) out[ability] = { pct: id.pct, identityName: id.name, obsession: !!id.obsession };
      });
    });
    return out;
  }

  const SECTION_RE = /^(identities|passions|relationships|shock(?:\s+meter)?)\s*:?\s*$/i;

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
    const def = { identities: [], passions: {}, relationships: [], woundThreshold: null, shock: {} };
    let section = '';
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(raw => {
      const line = raw.trim();
      if (!line) return;

      const wtm = line.match(/^wound\s+threshold\s*:?\s*(\d+)/i);
      if (wtm) { def.woundThreshold = parseInt(wtm[1], 10); return; }

      const sm = line.match(SECTION_RE);
      if (sm) { section = sm[1].toLowerCase().replace(/\s+meter$/, ''); return; }

      if (section === 'identities') {
        const m = line.match(/^(.+?)\s+(\d{1,3})%(\*)?\s*(?:[—–-]+|:)\s*(.*)$/);
        if (m) {
          def.identities.push({
            name: m[1].trim(), pct: parseInt(m[2], 10),
            obsession: !!m[3], features: m[4].trim()
          });
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
        if (nums && nums.length >= 2) {
          def.shock[meter] = { hardened: parseInt(nums[0], 10), failed: parseInt(nums[1], 10) };
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

  const api = {
    parseUAStatblock, computeAbilityPair, computeAllAbilities,
    METER_ORDER, METER_ABILITIES, ALL_ABILITIES, METER_DEFEND_ATTACK, METER_RELATIONSHIP, normalizeRole,
    parseFeatureClause, parseFeatures, computeSubstitutions, FEATURE_KEYWORDS, setShockValue
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.UAStatblock = api;
})(typeof window !== 'undefined' ? window : globalThis);
