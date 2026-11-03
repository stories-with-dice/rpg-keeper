/* js/fate-npc.js — the Fate NPC and encounter generator (FateNpc).
 * Ported from the Fate NPC Generator (fate-rpg-foundry repo, src/engine.mjs):
 * the same code without its ES module syntax and its Foundry VTT export. Pure,
 * no DOM. Every function takes the data bundle OSR.data.fate =
 * { rules, genres, archetypes, stunts, aspectLists } (data/fate/*.json, js/data.js).
 *   FateNpc.generateNpc(data, opts) -> one NPC; FateNpc.generateEncounter(data, opts)
 * js/fate-ui.js turns an NPC into a Bestiary def (FateNpc.toFateText).
 */
(function (root) {
  'use strict';
  // Fate NPC Generator engine.
  // Pure functions: no DOM, no Foundry globals. The web app and a Foundry module both import this file.
  // Every function takes the loaded data bundle `data = {rules, genres, archetypes, stunts, aspectLists}`.

  const ENGINE_VERSION = 1;
  const FLAG_SCOPE = "fate-solo-companion";

  // ---------------------------------------------------------------------------
  // Random numbers (seeded, so a seed always gives the same NPC)
  // ---------------------------------------------------------------------------

  function hashSeed(text) {
    let h = 1779033703 ^ text.length;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  function randomSeed() {
    const words = ["ash", "brass", "crow", "dusk", "ember", "fang", "gale", "hollow", "iron", "jade", "knot", "lark", "moth", "nettle", "onyx", "pike", "quill", "rune", "salt", "thorn", "umber", "vale", "wick", "yew"];
    const w = () => words[Math.floor(Math.random() * words.length)];
    return `${w()}-${w()}-${Math.floor(Math.random() * 1000)}`;
  }

  function createRng(seed) {
    let a = hashSeed(String(seed));
    const next = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Close seeds ("x#1", "x#2") give close first values; drop a few draws to separate them.
    for (let i = 0; i < 4; i++) next();
    const rng = {
      seed: String(seed),
      next,
      int: (min, max) => min + Math.floor(next() * (max - min + 1)),
      chance: (p) => next() < p,
      pick: (list) => (list && list.length ? list[Math.floor(next() * list.length)] : undefined),
      shuffle: (list) => {
        const out = [...list];
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
      },
      weighted: (entries) => {
        const total = entries.reduce((s, e) => s + e.weight, 0);
        let r = next() * total;
        for (const e of entries) {
          if ((r -= e.weight) < 0) return e.value;
        }
        return entries[entries.length - 1]?.value;
      },
    };
    return rng;
  }

  // ---------------------------------------------------------------------------
  // Ladder and dice math
  // ---------------------------------------------------------------------------

  function formatRank(n) {
    return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "+0";
  }

  function ladderName(rules, n) {
    return rules.ladder[String(n)] ?? (n > 8 ? "Beyond Legendary" : "Abysmal");
  }

  function ladderLabel(rules, n) {
    return `${ladderName(rules, n)} (${formatRank(n)})`;
  }

  // Distribution of the sum of `count` Fate dice, as {total: probability}.
  function fateDice(count) {
    let dist = { 0: 1 };
    for (let i = 0; i < count; i++) {
      const nextDist = {};
      for (const [k, p] of Object.entries(dist)) {
        for (const face of [-1, 0, 1]) {
          const key = Number(k) + face;
          nextDist[key] = (nextDist[key] ?? 0) + p / 3;
        }
      }
      dist = nextDist;
    }
    return dist;
  }

  // Chance that side A (rank a) beats, ties, or loses to side B (rank b) when both roll 4dF.
  function opposedOdds(a, b) {
    const diff = fateDice(8); // 4dF - 4dF has the same distribution as 8dF
    let win = 0, tie = 0;
    for (const [k, p] of Object.entries(diff)) {
      const margin = Number(k) + a - b;
      if (margin > 0) win += p;
      else if (margin === 0) tie += p;
    }
    return { win, tie, lose: 1 - win - tie };
  }

  // ---------------------------------------------------------------------------
  // Option handling
  // ---------------------------------------------------------------------------

  const DEFAULT_OPTIONS = {
    seed: null,
    ruleSet: "core",
    genre: "fantasy",
    archetype: "auto",
    importance: "supporting",
    quality: "fair",
    threat: "auto",
    role: "auto",
    disposition: "hostile",
    pcPeak: null,
    mobSize: 1,
    monster: "auto",
    scaleStep: 0,
    contentFilter: "all", // "all" | "cc-by" (only stunts under CC BY 3.0)
    context: null, // {faction, place, person, thing} to tie several NPCs together
  };

  function byId(list, id) {
    return list.find((x) => x.id === id);
  }

  function resolveOptions(data, opts = {}) {
    const o = { ...DEFAULT_OPTIONS, ...opts };
    const rng = createRng(o.seed ?? randomSeed());
    o.seed = rng.seed;
    const ruleSet = data.rules.ruleSets[o.ruleSet] ? o.ruleSet : "core";
    o.ruleSet = ruleSet;
    if (!byId(data.genres.genres, o.genre)) o.genre = "generic";
    if (o.pcPeak == null || o.pcPeak === "auto" || o.pcPeak === "") o.pcPeak = data.rules.ruleSets[ruleSet].defaultPcPeak;
    o.pcPeak = Number(o.pcPeak);
    o.mobSize = Math.max(1, Math.min(12, Number(o.mobSize) || 1));
    o.scaleStep = Number(o.scaleStep) || 0;
    return { o, rng };
  }

  function pickArchetype(data, o, rng) {
    if (o.archetype !== "auto") return byId(data.archetypes.archetypes, o.archetype) ?? data.archetypes.archetypes[0];
    const genre = byId(data.genres.genres, o.genre);
    const pool = data.archetypes.archetypes.filter((a) => {
      if (a.monster && o.monster === "no") return false;
      if (!a.monster && o.monster === "yes") return false;
      return true;
    });
    return rng.weighted(pool.map((a) => {
      let weight = 1;
      if (o.disposition === "hostile" && ["combat", "creature", "skulduggery"].includes(a.group)) weight += 1;
      if (o.disposition === "ally" && ["civilian", "knowledge", "social"].includes(a.group)) weight += 1;
      if (a.monster) weight *= genre?.monsterBias ? 1 + genre.monsterBias * 6 : 0.4;
      if (o.importance === "main" && a.role === "boss") weight += 1;
      return { value: a, weight };
    }));
  }

  function pickRole(o, arch) {
    if (o.role !== "auto") return o.role;
    if (o.importance === "nameless") return "filler";
    if (o.importance === "main") return o.disposition === "hostile" ? "boss" : "balanced";
    if (arch.role === "boss") return o.disposition === "hostile" ? "threat" : "balanced";
    return arch.role;
  }

  function pickThreat(o) {
    if (o.threat !== "auto") return o.threat;
    if (o.disposition === "ally" || o.disposition === "neutral") return "peer";
    if (o.disposition === "rival") return o.importance === "main" ? "strong" : "peer";
    return o.importance === "main" ? "deadly" : "strong";
  }

  // ---------------------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------------------

  function skillPriority(data, o, arch, role, rng) {
    const rs = data.rules.ruleSets[o.ruleSet];
    const list = data.rules.skillLists[rs.skillList];
    const fallback = data.rules.skillFallbacks[rs.skillList] ?? {};
    const roleDef = data.rules.roles[role] ?? {};
    let order = arch.skills.map((s) => (list.includes(s) ? s : fallback[s])).filter(Boolean);
    order = [...new Set(order)];
    if (roleDef.avoidSkills) order = order.filter((s) => !roleDef.avoidSkills.includes(s));
    if (role === "threat") {
      // Adversary Toolkit: a physical threat prioritizes Physique, a social threat prioritizes Will.
      const social = ["social", "knowledge", "civilian"].includes(arch.group);
      const key = social ? "Will" : "Physique";
      order = [order[0], key, ...order.slice(1)].filter((s, i, arr) => arr.indexOf(s) === i);
      if (order[0] !== key && rng.chance(0.4)) order = [key, ...order.filter((s) => s !== key)];
    }
    if (role === "support") {
      const prefs = roleDef.preferSkills.map((s) => (list.includes(s) ? s : fallback[s])).filter(Boolean);
      const extra = prefs.filter((s) => !order.includes(s));
      order = [...order, ...rng.shuffle(extra).slice(0, 2)];
    }
    // Light shuffle below the apex so two NPCs of one archetype differ.
    for (let i = 1; i < order.length - 1; i++) {
      if (rng.chance(0.3)) [order[i], order[i + 1]] = [order[i + 1], order[i]];
    }
    // Creatures only use their own skills, so a boss monster never gets Resources or Contacts.
    const rest = arch.monster ? [] : rng.shuffle(list.filter((s) => !order.includes(s) && !(roleDef.avoidSkills ?? []).includes(s)));
    return { order: [...order, ...rest], list: arch.monster ? order : list };
  }

  function rankSlots(data, o, role, threatOffset, rng) {
    const peak = Math.max(1, o.pcPeak + threatOffset);
    if (o.importance === "nameless") {
      const q = data.rules.importance.nameless.qualities[o.quality] ?? data.rules.importance.nameless.qualities.fair;
      const extra = rng.int(q.extraAverage[0], q.extraAverage[1]);
      return [...q.skills, ...Array(extra).fill(1)];
    }
    if (o.importance === "supporting") {
      if (role === "threat" || role === "hitter") {
        // Adversary Toolkit: apex, two skills one step lower, and (if well defined) three more one step below that.
        const slots = [peak, peak - 1, peak - 1];
        if (threatOffset >= 1) slots.push(peak - 2, peak - 2, peak - 2);
        return slots.filter((r) => r >= 1);
      }
      // Fate Core: one column, one skill per step below the peak, four or five skills.
      const max = data.rules.importance.supporting.maxColumnSkills;
      const slots = [];
      for (let r = peak; r >= 1 && slots.length < max; r--) slots.push(r);
      return slots;
    }
    // Main NPC.
    const slots = [];
    if (role === "boss") {
      // Adversary Toolkit: one apex skill, or two apex skills one step lower; then one more skill per step down to Fair; the rest Average.
      let top = peak, count = 1;
      if (threatOffset >= 2 && rng.chance(0.5)) { top = peak - 1; count = 2; }
      for (let r = top; r >= 2; r--, count++) for (let i = 0; i < count; i++) slots.push(r);
      for (let i = 0; i < 3; i++) slots.push(1);
      return slots;
    }
    // Peer: a PC-style pyramid that peaks at the NPC peak.
    for (let r = peak, count = 1; r >= 1; r--, count++) for (let i = 0; i < count; i++) slots.push(r);
    return slots;
  }

  function buildSkills(data, o, arch, role, threatOffset, rng) {
    const rs = data.rules.ruleSets[o.ruleSet];
    if (rs.skillList === "approaches") return buildApproaches(data, o, arch, threatOffset);
    const { order, list } = skillPriority(data, o, arch, role, rng);
    let slots = rankSlots(data, o, role, threatOffset, rng);
    if (slots.length > list.length) slots = slots.slice(0, list.length);
    return slots.map((rank, i) => ({ name: order[i], rank }));
  }

  // Fate Accelerated: nameless NPCs get "Skilled at / Bad at"; others get all six approaches.
  function buildApproaches(data, o, arch, threatOffset) {
    if (o.importance === "nameless") {
      const q = data.rules.importance.nameless.qualities[o.quality] ?? data.rules.importance.nameless.qualities.fair;
      return [
        { name: `Skilled at ${arch.skilledAt}`, rank: q.rank, freeform: true },
        { name: `Bad at ${arch.badAt}`, rank: -2, freeform: true },
      ];
    }
    const base = [3, 2, 2, 1, 1, 0];
    const shift = o.pcPeak + threatOffset - 3;
    return arch.approaches.map((name, i) => ({ name, rank: Math.max(0, base[i] + shift) }));
  }

  // ---------------------------------------------------------------------------
  // Aspects and names
  // ---------------------------------------------------------------------------

  function genreTables(data, genreId) {
    const genre = byId(data.genres.genres, genreId) ?? data.genres.genres[0];
    const common = data.genres.common;
    const merge = (key) => [...(genre[key] ?? []), ...(common[key] ?? [])];
    return { genre, common, merge };
  }

  function fillTemplate(text, genre, context, rng) {
    return text.replace(/\{(faction|place|person|thing)\}/g, (_, key) => {
      if (context?.[key]) return context[key];
      const plural = { faction: "factions", place: "places", person: "people", thing: "things" }[key];
      return rng.pick(genre[plural]) ?? key;
    });
  }

  function titleCase(text) {
    const small = new Set(["of", "the", "a", "an", "and", "in", "on", "at"]);
    return text.split(" ").map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  }

  function pickConcept(arch, genreId, rng) {
    return rng.pick(arch.concepts[genreId] ?? arch.concepts.generic) ?? arch.label;
  }

  function buildAspects(data, o, arch, role, monster, rng) {
    const { genre, common, merge } = genreTables(data, o.genre);
    const lists = data.aspectLists?.lists ?? {};
    const used = new Set();
    const take = (candidates) => {
      const pool = candidates.filter((c) => c && !used.has(c));
      const value = fillTemplate(rng.pick(pool) ?? "", genre, o.context, rng);
      used.add(value);
      return value;
    };
    const concept = pickConcept(arch, o.genre, rng);
    const adjective = rng.pick(rng.chance(0.6) && genre.adjectives.length ? genre.adjectives : common.adjectives);
    const highConcept = `${adjective} ${concept}`;
    used.add(highConcept);
    const aspects = [];

    if (o.importance === "nameless") {
      aspects.push({ label: "High Concept", text: highConcept });
      const q = data.rules.importance.nameless.qualities[o.quality];
      const count = q ? rng.int(q.aspects[0], q.aspects[1]) : 1;
      if (count > 1) aspects.push({ label: "Aspect", text: take([...merge("troubles"), ...(lists.dispositions ?? [])]) });
      if (monster) aspects.push({ label: "Instinct", text: take(genre.instincts ?? []), instinct: true });
      return { aspects, concept, highConcept };
    }

    aspects.push({ label: "High Concept", text: highConcept });
    if (role === "boss") {
      aspects.push({ label: "Trouble", text: take(common.bossTroubles), note: "Secret weakness the PCs can find and exploit." });
    } else {
      const rpgnet = rng.chance(0.25) ? lists.troubles ?? [] : [];
      aspects.push({ label: "Trouble", text: take([...merge("troubles"), ...rpgnet]) });
    }
    if (monster) aspects.push({ label: "Instinct", text: take(genre.instincts ?? []), instinct: true });
    const wanted = data.rules.importance[o.importance].aspects;
    const fillers = [
      { label: "Motivation", from: () => merge("motivations") },
      { label: "Relationship", from: () => merge("relationships") },
      { label: "Belief", from: () => lists.beliefs ?? common.motivations },
      { label: "Edge", from: () => lists.expertise ?? common.adjectives },
      { label: "Disposition", from: () => lists.dispositions ?? common.troubles },
    ];
    for (const f of fillers) {
      if (aspects.length >= wanted) break;
      aspects.push({ label: f.label, text: take(f.from()) });
    }
    return { aspects, concept, highConcept };
  }

  function buildName(data, o, arch, concept, highConcept, rng) {
    const { genre } = genreTables(data, o.genre);
    if (o.importance === "nameless") return { name: highConcept, personalName: null };
    // Beasts never get a personal name; other monsters sometimes do (a vampire can be called Silas).
    if (arch.monster && (arch.id === "beast" || rng.chance(0.6))) {
      const place = o.context?.place ?? rng.pick(genre.places);
      return { name: titleCase(`The ${concept} of ${place.replace(/^the /i, "")}`), personalName: null };
    }
    const name = `${rng.pick(genre.names.first)} ${rng.pick(genre.names.last)}`;
    return { name, personalName: name };
  }

  // ---------------------------------------------------------------------------
  // Stunts
  // ---------------------------------------------------------------------------

  function cleanStuntName(name) {
    return name.split("/")[0].trim();
  }

  function libraryStunts(data, o, skills, used, rng) {
    const { genre } = genreTables(data, o.genre);
    const tags = new Set(genre.stuntTags ?? ["generic"]);
    const skillNames = skills.map((s) => s.name);
    const pool = (data.stunts?.stunts ?? []).filter((s) => {
      if (s.requires) return false;
      if (used.has(cleanStuntName(s.name))) return false;
      if (!s.tags.some((t) => tags.has(t))) return false;
      if (o.contentFilter === "cc-by" && !s.license.startsWith("CC-BY-3.0")) return false;
      if (!skillNames.includes(s.skill)) return false;
      if (/because you are|requires/i.test(s.text)) return false; // stunts tied to a named aspect or another stunt
      return s.text.length < 420;
    });
    return pool.map((s) => {
      const index = skillNames.indexOf(s.skill);
      const weight = Math.max(1, 6 - index) * (s.bonus ? 1.5 : 1) * (s.tags.includes("generic") ? 1 : 1.6);
      return { value: s, weight };
    });
  }

  function quickStunt(data, id, apex) {
    const q = data.rules.quickEnemyStunts.stunts.find((s) => s.id === id);
    if (!q) return null;
    return {
      name: q.name,
      text: q.text.replace(/\{apex\}/g, apex?.name ?? "your best skill"),
      skill: q.skill ?? (q.apex ? apex?.name : null) ?? null,
      bonus: q.bonus ?? 0,
      weapon: q.weapon ?? 0,
      armor: q.armor ?? 0,
      actions: { overcome: false, caa: !!q.caa, attack: !!q.attack, defend: !!q.defend },
      source: "Fate Adversary Toolkit",
      license: data.rules.quickEnemyStunts.license,
    };
  }

  function fromLibrary(s) {
    return {
      name: cleanStuntName(s.name),
      text: s.text,
      skill: s.skill,
      bonus: s.bonus,
      weapon: 0,
      armor: 0,
      actions: { ...s.actions },
      source: s.source,
      license: s.license,
    };
  }

  const FAE_ACTIONS = ["attack", "defend", "create advantages", "overcome obstacles"];
  const FAE_CIRCUMSTANCES = ["in a fight", "against someone who underestimates me", "on my home ground", "when I am outnumbered", "in a crowd", "in the dark", "when someone threatens my allies", "when I have time to prepare"];
  const ADVERBS = { Careful: "Carefully", Clever: "Cleverly", Flashy: "Flashily", Forceful: "Forcefully", Quick: "Quickly", Sneaky: "Sneakily" };

  function faeStunt(o, concept, approaches, rng, index) {
    const approach = approaches[Math.min(index, approaches.length - 1)]?.name ?? "Forceful";
    const action = rng.pick(FAE_ACTIONS);
    const when = rng.pick(FAE_CIRCUMSTANCES);
    const key = action.split(" ")[0];
    return {
      name: `${ADVERBS[approach] ?? approach} ${titleCase(key)}`,
      text: `Because I am a ${concept}, I get +2 when I ${ADVERBS[approach]?.toLowerCase() ?? approach} ${action} ${when}.`,
      skill: approach,
      bonus: 2,
      weapon: 0,
      armor: 0,
      actions: { overcome: key === "overcome", caa: key === "create", attack: key === "attack", defend: key === "defend" },
      source: "Fate Accelerated stunt template",
      license: "CC-BY-3.0 (Evil Hat Productions)",
    };
  }

  function stuntCount(o, role, threatOffset) {
    if (o.importance === "nameless") return 0;
    if (o.importance === "supporting") return 1;
    if (role === "boss") return threatOffset >= 2 ? 3 : 2;
    return 3;
  }

  function buildStunts(data, o, role, skills, concept, threatOffset, rng) {
    const count = stuntCount(o, role, threatOffset);
    if (!count) return [];
    const apex = skills[0];
    const rs = data.rules.ruleSets[o.ruleSet];
    const stunts = [];
    const used = new Set();
    const add = (s) => { if (s && !used.has(s.name)) { used.add(s.name); stunts.push(s); } };

    // Role stunt first (Adversary Toolkit).
    if (role === "hitter") {
      const shootApex = apex?.name === "Shoot";
      const stealthy = skills.some((s) => s.name === "Stealth");
      add(quickStunt(data, shootApex ? "sniper" : stealthy && rng.chance(0.35) ? "sneak-attack" : "apex-weapon", apex));
    } else if (role === "threat") {
      const options = ["apex-armor", "bodyguard", "apex-zone"];
      if (skills.some((s) => s.name === "Provoke")) options.push("naysayer");
      if (["modern", "scifi", "cyberpunk", "pulp", "postapoc", "supers"].includes(o.genre)) options.push("grenadier");
      add(quickStunt(data, rng.pick(options), apex));
    } else if (role === "boss") {
      const options = ["escape-plan", "mook-shield"];
      if (skills.some((s) => s.name === "Contacts")) options.push("connected");
      add(quickStunt(data, rng.pick(options), apex));
      if (count > 2) add(quickStunt(data, rng.pick(["apex-weapon", "apex-armor", "apex-zone", "apex-any"]), apex));
    }

    let guard = 0;
    while (stunts.length < count && guard++ < 20) {
      if (rs.skillList === "approaches") {
        add(faeStunt(o, concept, skills, rng, stunts.length));
        continue;
      }
      const pool = libraryStunts(data, o, skills, used, rng);
      if (!pool.length) {
        add(quickStunt(data, rng.pick(["apex-weapon", "apex-armor", "apex-any"]), apex));
        continue;
      }
      add(fromLibrary(rng.weighted(pool)));
    }
    return stunts;
  }

  function buildMonster(data, o, rng) {
    const { genre } = genreTables(data, o.genre);
    const ability = rng.pick(data.rules.monsters.abilities);
    const weaknessLevel = rng.pick(["lesser", "greater", "greater"]);
    return {
      ability: { ...ability },
      weakness: rng.pick(genre.weaknesses ?? ["Fire"]),
      weaknessLevel,
      weaknessRule: data.rules.monsters.weaknessRules[weaknessLevel],
      instinctInvoke: data.rules.monsters.instinctInvoke,
    };
  }

  // ---------------------------------------------------------------------------
  // Stress and consequences
  // ---------------------------------------------------------------------------

  function buildStress(data, o, role, skills, monster) {
    const rs = data.rules.ruleSets[o.ruleSet];
    const st = rs.stress;
    const tracks = [];
    const consequences = [];
    const rankOf = (name) => skills.find((s) => s.name === name)?.rank ?? 0;

    if (o.importance === "nameless") {
      const boxes = st.namelessBoxes[o.quality] ?? 0;
      if (boxes > 0) tracks.push({ id: "stress", name: "Stress", style: st.style, boxes });
      return { tracks, consequences, extraMild: [] };
    }

    const extraMild = [];
    for (const t of st.tracks) {
      let boxes = st.baseBoxes;
      if (t.skill) {
        const rank = rankOf(t.skill);
        for (const b of st.skillBonus) {
          if (rank >= b.minRank) {
            boxes = b.boxes;
            if (b.extraMild) extraMild.push(t.id);
          }
        }
      }
      if (monster?.ability.effect?.extraBoxes && (t.id === "physical" || t.id === "stress")) boxes += monster.ability.effect.extraBoxes;
      tracks.push({ id: t.id, name: t.name, style: st.style, boxes });
    }

    const threatOffset = data.rules.threatLevels[o._threat]?.offset ?? 0;
    let ids;
    if (o.importance === "main") {
      ids = role === "boss" && threatOffset < 2 ? ["mild", "moderate"] : ["mild", "moderate", "severe"];
    } else if (role === "hitter") {
      ids = threatOffset >= 1 ? ["mild"] : [];
    } else if (role === "threat") {
      ids = threatOffset >= 1 ? ["mild", "moderate"] : ["mild"];
    } else {
      ids = threatOffset >= 2 ? ["mild", "moderate"] : ["mild"];
    }
    for (const id of ids) consequences.push({ ...data.rules.consequences.find((c) => c.id === id) });
    for (const trackId of extraMild) {
      const label = trackId === "physical" ? "Physical" : "Mental";
      consequences.push({ id: `mild-${trackId}`, name: `${label} Mild Consequence`, value: 2, only: trackId });
    }
    return { tracks, consequences, extraMild };
  }

  // ---------------------------------------------------------------------------
  // Notes for the GM
  // ---------------------------------------------------------------------------

  function buildNotes(data, o, npc) {
    const notes = [];
    const rules = data.rules;
    const roleDef = rules.roles[npc.role];
    if (roleDef?.tactics) notes.push({ kind: "tactics", text: roleDef.tactics });
    const imp = rules.importance[o.importance];
    if (imp?.concedes) notes.push({ kind: "concede", text: imp.concedes });

    if (o.importance === "nameless") {
      const q = rules.importance.nameless.qualities[o.quality];
      notes.push({ kind: "purpose", text: q?.purpose ?? "" });
      notes.push({ kind: "obstacle", text: `Shortcut: treat as an obstacle. One overcome roll against ${ladderLabel(rules, npc.peak)} gets the PC past them (Fate Core, nameless NPCs as obstacles).` });
      if (npc.mob.size > 1) {
        notes.push({ kind: "mob", text: `Mob of ${npc.mob.size}: roll once at ${ladderLabel(rules, npc.peak)} +${npc.mob.bonus} for helpers = ${ladderLabel(rules, npc.mob.roll)}. ${rules.mobs.overflow} Adversary Toolkit option: cap a group's skills at Great (+4).` });
      }
      if (npc.role === "hitter" || o.role === "hitter") notes.push({ kind: "weapon", text: "Dangerous filler option: give them Weapon:1 (Adversary Toolkit)." });
    }
    if (npc.monster) {
      const m = npc.monster;
      notes.push({ kind: "monster", text: `Instinct aspect: invoke for +${m.instinctInvoke} instead of +2 (Fate System Toolkit).` });
      notes.push({ kind: "monster", text: `${m.ability.name}: ${m.ability.text} Weakness (${m.weaknessLevel}): ${m.weakness}. ${m.weaknessRule}` });
    }
    if (o.scaleStep) {
      const steps = Math.abs(o.scaleStep);
      const bigger = o.scaleStep > 0 ? "the NPC" : "the PCs";
      notes.push({ kind: "scale", text: `Scale: ${steps} step(s) in favor of ${bigger}. Per step, the larger side gets +1 to attack or defense rolls, or +2 shifts of harm dealt / 2 less harm taken (Fate System Toolkit).` });
    }
    return notes;
  }

  // ---------------------------------------------------------------------------
  // Public: generate one NPC
  // ---------------------------------------------------------------------------

  function generateNpc(data, opts = {}) {
    const { o, rng } = resolveOptions(data, opts);
    const arch = pickArchetype(data, o, rng);
    const role = pickRole(o, arch);
    const threat = o.importance === "nameless" ? null : pickThreat(o);
    o._threat = threat;
    const threatOffset = threat ? data.rules.threatLevels[threat].offset : 0;
    const isMonster = o.monster === "yes" || (o.monster === "auto" && !!arch.monster);
    const monster = isMonster ? buildMonster(data, o, rng) : null;

    const skills = buildSkills(data, o, arch, role, threatOffset, rng);
    const { aspects, concept, highConcept } = buildAspects(data, o, arch, role, isMonster, rng);
    const { name, personalName } = buildName(data, o, arch, concept, highConcept, rng);
    const stunts = buildStunts(data, o, role, skills, concept, threatOffset, rng);
    const { tracks, consequences } = buildStress(data, o, role, skills, monster);

    const peak = Math.max(...skills.map((s) => s.rank), 0);
    const mobSize = o.importance === "nameless" ? o.mobSize : 1;
    const mobBonus = mobSize - 1;
    const npc = {
      engineVersion: ENGINE_VERSION,
      seed: o.seed,
      name: mobSize > 1 ? `${name} ×${mobSize}` : name,
      baseName: name,
      personalName,
      ruleSet: o.ruleSet,
      genre: o.genre,
      archetype: arch.id,
      archetypeLabel: arch.label,
      concept,
      importance: o.importance,
      quality: o.importance === "nameless" ? o.quality : null,
      threat,
      role,
      disposition: o.disposition,
      pcPeak: o.pcPeak,
      peak,
      scaleStep: o.scaleStep,
      aspects,
      skills,
      stunts,
      stress: tracks,
      consequences,
      monster,
      mob: { size: mobSize, bonus: mobBonus, roll: peak + mobBonus },
      weapon: Math.max(0, ...stunts.map((s) => s.weapon || 0)),
      armor: Math.max(0, ...stunts.map((s) => s.armor || 0)),
      odds: opposedOdds(peak + mobBonus, o.pcPeak),
      options: { ...o, _threat: undefined },
    };
    npc.notes = buildNotes(data, o, npc);
    return npc;
  }

  // ---------------------------------------------------------------------------
  // Public: generate an encounter (a group of NPCs from one faction)
  // ---------------------------------------------------------------------------

  const ROLE_ARCHETYPES = {
    threat: ["soldier", "brute", "zealot", "beast"],
    hitter: ["marksman", "assassin", "mystic", "thief"],
    boss: ["leader", "noble", "horror", "mystic"],
    filler: ["soldier", "brute", "zealot", "beast", "thief"],
  };

  function generateEncounter(data, opts = {}) {
    const o = {
      seed: opts.seed ?? randomSeed(),
      ruleSet: opts.ruleSet ?? "core",
      genre: opts.genre ?? "fantasy",
      level: opts.level ?? "standard",
      pcCount: Math.max(1, Number(opts.pcCount) || 3),
      pcPeak: opts.pcPeak,
      monster: opts.monster ?? "auto",
      contentFilter: opts.contentFilter ?? "all",
    };
    const rng = createRng(o.seed);
    const level = data.rules.encounters.levels[o.level] ?? data.rules.encounters.levels.standard;
    const genre = byId(data.genres.genres, o.genre) ?? data.genres.genres[0];
    const context = { faction: rng.pick(genre.factions), place: rng.pick(genre.places) };

    let threats = o.pcCount <= 2 ? Math.max(1, level.threats[0] - 1) : o.pcCount >= 4 ? level.threats[1] : level.threats[0];
    if (level.boss) threats = Math.max(2, threats);
    const fillerQuality = { easy: "average", standard: "fair", climactic: "good" }[o.level] ?? "fair";

    const base = { ruleSet: o.ruleSet, genre: o.genre, pcPeak: o.pcPeak, disposition: "hostile", monster: o.monster, contentFilter: o.contentFilter, context };
    const archFor = (role) => {
      let ids = ROLE_ARCHETYPES[role];
      if (o.monster === "no") ids = ids.filter((id) => !byId(data.archetypes.archetypes, id)?.monster);
      if (o.monster === "yes") ids = ids.filter((id) => byId(data.archetypes.archetypes, id)?.monster).concat(ids.length ? [] : ["beast"]);
      if (!genre.monsterBias && o.monster === "auto" && rng.chance(0.75)) ids = ids.filter((id) => !byId(data.archetypes.archetypes, id)?.monster);
      return rng.pick(ids.length ? ids : ROLE_ARCHETYPES[role]);
    };

    const members = [];
    const firstNames = new Set();
    let n = 0;
    // Each member gets its own seed. A member whose first name is taken is generated again with the next seed.
    const add = (extra) => {
      let npc;
      for (let tries = 0; tries < 5; tries++) {
        npc = generateNpc(data, { ...base, ...extra, seed: `${o.seed}#${++n}` });
        const first = npc.personalName?.split(" ")[0];
        if (!first || !firstNames.has(first)) break;
      }
      if (npc.personalName) firstNames.add(npc.personalName.split(" ")[0]);
      members.push(npc);
    };
    if (level.boss) add({ importance: "main", role: "boss", threat: "deadly", archetype: archFor("boss") });
    for (let i = 0; i < threats; i++) add({ importance: "supporting", role: "threat", threat: "strong", archetype: archFor("threat") });
    for (let i = 0; i < level.hitters; i++) add({ importance: "supporting", role: "hitter", threat: "strong", archetype: archFor("hitter") });
    for (let i = 0; i < level.fillerMobs; i++) add({ importance: "nameless", quality: fillerQuality, mobSize: Math.max(2, o.pcCount), archetype: archFor("filler") });
    return {
      engineVersion: ENGINE_VERSION,
      seed: o.seed,
      level: o.level,
      levelLabel: level.label,
      summary: level.summary,
      pcCount: o.pcCount,
      context,
      gmFatePoints: o.pcCount,
      rules: data.rules.encounters.rules,
      members,
    };
  }

  // ---------------------------------------------------------------------------
  // Export: plain text stat block (Markdown)
  // ---------------------------------------------------------------------------

  function boxesText(track) {
    if (!track.boxes) return "none";
    if (track.style === "escalating") return Array.from({ length: track.boxes }, (_, i) => `[${i + 1}]`).join(" ");
    return Array(track.boxes).fill("[1]").join(" ");
  }

  function toMarkdown(npc, data) {
    const rules = data.rules;
    const lines = [];
    const imp = rules.importance[npc.importance].label;
    const tag = npc.importance === "nameless" ? `${imp} (${rules.importance.nameless.qualities[npc.quality]?.label})` : `${imp}, ${rules.threatLevels[npc.threat]?.label}`;
    lines.push(`### ${npc.name}`);
    lines.push(`*${npc.archetypeLabel} · ${tag} · ${rules.roles[npc.role]?.label ?? npc.role}*`);
    lines.push("");
    lines.push(`**Aspects:** ${npc.aspects.map((a) => `*${a.text}*${a.label === "High Concept" ? "" : ` (${a.label.toLowerCase()})`}`).join("; ")}`);
    const groups = {};
    for (const s of npc.skills) (groups[s.rank] ??= []).push(s.name);
    const skillText = Object.keys(groups).map(Number).sort((a, b) => b - a).map((r) => `${ladderLabel(rules, r)} ${groups[r].join(", ")}`).join("; ");
    lines.push(`**${npc.ruleSet === "accelerated" ? "Approaches" : "Skills"}:** ${skillText}`);
    if (npc.mob.size > 1) lines.push(`**Mob:** ${npc.mob.size} members, roll at ${ladderLabel(rules, npc.mob.roll)}`);
    if (npc.stunts.length) {
      lines.push(`**Stunts:**`);
      for (const s of npc.stunts) lines.push(`- **${s.name}.** ${s.text}`);
    }
    if (npc.monster) lines.push(`**Monster:** ${npc.monster.ability.name}. Weakness (${npc.monster.weaknessLevel}): ${npc.monster.weakness}.`);
    const stress = npc.stress.map((t) => `${t.name} ${boxesText(t)}`).join("; ") || "no stress boxes (one hit takes them out)";
    lines.push(`**Stress:** ${stress}${npc.mob.size > 1 ? " (each member)" : ""}`);
    if (npc.consequences.length) lines.push(`**Consequences:** ${npc.consequences.map((c) => `${c.name.replace(" Consequence", "")} (${c.value})`).join(", ")}`);
    if (npc.weapon || npc.armor) lines.push(`**Gear:** ${npc.weapon ? `Weapon:${npc.weapon}` : ""}${npc.weapon && npc.armor ? ", " : ""}${npc.armor ? `Armor:${npc.armor}` : ""}`);
    lines.push("");
    for (const n of npc.notes) lines.push(`> ${n.text}`);
    return lines.join("\n");
  }

  const api = { ENGINE_VERSION, FLAG_SCOPE, randomSeed, createRng, formatRank, ladderName, ladderLabel, fateDice, opposedOdds, DEFAULT_OPTIONS, resolveOptions, generateNpc, generateEncounter, boxesText, toMarkdown };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FateNpc = api;
})(typeof window !== 'undefined' ? window : globalThis);
