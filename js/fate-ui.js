/* js/fate-ui.js — Fate Core: the Compendium seed, the Fate dice actions
 * (Invoke +2, Reroll), the aspect tracker above Trackers, and the NPC and
 * encounter generator modals (FateNpc, js/fate-npc.js).
 * The sheet text format is in js/fate.js; Combat rows are in js/combat.js.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, uid } = OSR;

  const isFate = () => OSR.currentSystem && OSR.currentSystem() === 'fate';

  /* ---- Compendium seed (data/seed-fate.json) ---- */

  // Adds every default Fate entry not already present, matched by seedRef
  // (stunt and aspect names repeat across skills and lists). Returns the count added.
  function seedFateCompendium() {
    const seed = (OSR.seeds.fate && OSR.seeds.fate.compendium) || [];
    const have = new Set(OSR.state.compendium.filter(e => e.system === 'fate' && e.seedRef).map(e => e.seedRef));
    let added = 0;
    seed.forEach(e => {
      if (!e || !e.name) return;
      const item = OSR.compCopy('fate', e);
      if (have.has(item.seedRef)) return;
      OSR.state.compendium.push(item);
      have.add(item.seedRef);
      added++;
    });
    OSR.state.fateCompendiumSeeded = true;
    OSR.save();
    return added;
  }

  /* ---- Dice: Invoke +2 and Reroll on the last Fate roll ---- */

  function renderFateDiceActions() {
    const box = $('#dice-fate-actions');
    if (box) box.hidden = !(isFate() && OSR.lastFate);
  }
  // Invoking an aspect after a roll: +2 to it (aspectName is for the log).
  //   last roll 4dF+2 = 3 → "Invoke +2" = 5, Superb (+5)
  function invokeLast(aspectName) {
    const last = OSR.lastFate;
    if (!last) return null;
    const total = last.total + 2;
    OSR.pushLog(last.source, 'Invoke +2' + (aspectName ? ' (' + aspectName + ')' : ''), total, '→ ' + FateSheet.ladderLabel(total));
    OSR.lastFate = Object.assign({}, last, { total });
    renderFateDiceActions();
    return total;
  }
  function rerollLast() {
    const last = OSR.lastFate;
    if (!last) return;
    OSR.doRoll(last.formula, last.source + ' (reroll)');
  }

  /* ---- Aspect tracker (state.fateScene) ---- */

  const KINDS = ['situation', 'scene', 'boost', 'game'];
  const KIND_LABELS = { situation: 'Situation', scene: 'Scene', boost: 'Boost', game: 'Game' };
  const KIND_TIPS = {
    situation: 'A situation aspect: an advantage or a fact of this scene',
    scene: 'A scene aspect: part of the place or the moment',
    boost: 'A boost: one free invoke, then it goes away',
    game: 'A game aspect (a current or impending issue): stays from scene to scene'
  };

  function renderFateAspects() {
    const panel = $('#fate-aspects-panel');
    if (!panel) return;
    panel.hidden = !isFate();
    if (panel.hidden) return;
    const sc = OSR.state.fateScene;
    $('#fate-gm-points').value = sc.gmPoints;
    $('#fate-aspect-empty').hidden = sc.aspects.length > 0;
    $('#fate-aspect-list').innerHTML = sc.aspects.map(a =>
      '<li class="fate-asp fate-asp-' + a.kind + '" data-id="' + escapeHtml(a.id) + '">' +
        '<button type="button" class="fate-asp-kind" title="' + escapeHtml(KIND_TIPS[a.kind]) + ' — click to change">' + KIND_LABELS[a.kind] + '</button>' +
        '<input type="text" class="fate-asp-text" value="' + escapeHtml(a.text) + '" aria-label="Aspect" />' +
        '<button type="button" class="fate-asp-del" title="Remove">&times;</button>' +
        '<span class="fate-asp-ctl" title="Free invokes">' +
          '<button type="button" class="cons-btn fate-asp-dec" aria-label="Free invokes −1">&minus;</button>' +
          '<span class="fate-asp-inv">' + a.invokes + '</span>' +
          '<button type="button" class="cons-btn fate-asp-inc" aria-label="Free invokes +1">+</button>' +
        '</span>' +
        '<button type="button" class="btn fate-asp-invoke" title="Invoke: uses a free invoke if it has one (a boost goes away), else a fate point. +2 to the last Fate roll.">Invoke</button>' +
      '</li>').join('');
  }

  function aspectFor(el) {
    const li = el.closest('.fate-asp');
    return li ? OSR.state.fateScene.aspects.find(a => a.id === li.dataset.id) : null;
  }

  function addAspect(text, kind, invokes) {
    text = String(text || '').trim();
    if (!text) return null;
    kind = KINDS.indexOf(kind) === -1 ? 'situation' : kind;
    const a = { id: uid(), text, kind, invokes: invokes != null ? invokes : (kind === 'boost' ? 1 : 0) };
    OSR.state.fateScene.aspects.push(a);
    OSR.save();
    renderFateAspects();
    return a;
  }

  // Invoking an aspect: a free invoke if it has one (a boost is then gone),
  // else the GM or a player pays a fate point. +2 to the last Fate roll, if any.
  function invokeAspect(a) {
    const sc = OSR.state.fateScene;
    let how = 'fate point';
    if (a.invokes > 0) {
      a.invokes--;
      how = 'free invoke';
      if (a.kind === 'boost' && a.invokes === 0) sc.aspects = sc.aspects.filter(x => x.id !== a.id);
    }
    OSR.save();
    if (OSR.lastFate) invokeLast(a.text + ', ' + how);
    else OSR.pushNote('Aspects', 'Invoked ' + a.text + ' (' + how + ')');
    renderFateAspects();
  }

  // The PCs in this scene: the Fate characters in Combat, else every Fate character.
  function scenePcCount() {
    const inCombat = OSR.state.combat.entries.filter(e => e.kind === 'character' && OSR.isFateEntry(e)).length;
    return inCombat || OSR.charactersForSystem().length;
  }

  // A new scene: the scene and situation aspects and the boosts go; game
  // aspects stay. The GM gets 1 fate point per PC in the scene.
  function newScene() {
    const sc = OSR.state.fateScene;
    const gone = sc.aspects.filter(a => a.kind !== 'game');
    if (gone.length && !confirm('Start a new scene? ' + gone.length + ' scene, situation, or boost aspect(s) go away.')) return;
    sc.aspects = sc.aspects.filter(a => a.kind === 'game');
    sc.gmPoints = scenePcCount();
    OSR.save();
    OSR.pushNote('Aspects', 'New scene — GM fate points: ' + sc.gmPoints);
    renderFateAspects();
  }

  function setGmPoints(v) {
    OSR.state.fateScene.gmPoints = Math.max(0, Math.round(Number(v) || 0));
    OSR.save();
    $('#fate-gm-points').value = OSR.state.fateScene.gmPoints;
  }

  function wireFateAspects() {
    $('#fate-aspect-add').addEventListener('submit', e => {
      e.preventDefault();
      if (addAspect($('#fate-aspect-text').value, $('#fate-aspect-kind').value)) $('#fate-aspect-text').value = '';
    });
    $('#fate-new-scene').addEventListener('click', newScene);
    $('#fate-gm-dec').addEventListener('click', () => setGmPoints(OSR.state.fateScene.gmPoints - 1));
    $('#fate-gm-inc').addEventListener('click', () => setGmPoints(OSR.state.fateScene.gmPoints + 1));
    $('#fate-gm-points').addEventListener('change', e => setGmPoints(e.target.value));
    const list = $('#fate-aspect-list');
    list.addEventListener('click', e => {
      const a = aspectFor(e.target);
      if (!a) return;
      if (e.target.closest('.fate-asp-del')) {
        OSR.state.fateScene.aspects = OSR.state.fateScene.aspects.filter(x => x.id !== a.id);
      } else if (e.target.closest('.fate-asp-kind')) {
        a.kind = KINDS[(KINDS.indexOf(a.kind) + 1) % KINDS.length];
      } else if (e.target.closest('.fate-asp-inc')) {
        a.invokes++;
      } else if (e.target.closest('.fate-asp-dec')) {
        a.invokes = Math.max(0, a.invokes - 1);
      } else if (e.target.closest('.fate-asp-invoke')) {
        invokeAspect(a);
        return;
      } else return;
      OSR.save();
      renderFateAspects();
    });
    list.addEventListener('input', e => {
      if (!e.target.classList.contains('fate-asp-text')) return;
      const a = aspectFor(e.target);
      if (!a) return;
      a.text = e.target.value;
      OSR.save();
    });
    $('#dice-fate-invoke').addEventListener('click', () => invokeLast(''));
    $('#dice-fate-reroll').addEventListener('click', rerollLast);
  }

  /* ---- Generated NPCs → Bestiary defs ---- */

  // A generated NPC (FateNpc.generateNpc) as the Fate text (js/fate.js),
  // name first. Box values are not kept: a box is "[ ]" (Fate Core's boxes
  // are worth 1, 2, 3… by position).
  function npcText(npc) {
    const out = [npc.name];
    npc.aspects.forEach(a => {
      const key = FateSheet.ASPECT_KEYS.indexOf(String(a.label || '').toLowerCase()) !== -1 ? a.label : 'Aspect';
      out.push(key + ': ' + a.text);
      if (a.note) out.push('Note: ' + a.label + ' — ' + a.note);
    });
    const ranks = [];
    npc.skills.forEach(s => { if (ranks.indexOf(s.rank) === -1) ranks.push(s.rank); });
    ranks.sort((a, b) => b - a).forEach(r => {
      out.push(FateSheet.ladderLabel(r).replace('−', '-') + ': ' + npc.skills.filter(s => s.rank === r).map(s => s.name).join(', '));
    });
    npc.stunts.forEach(s => out.push('Stunt: ' + (s.name ? s.name + '. ' : '') + String(s.text || '').replace(/\s+/g, ' ')));
    if (npc.mob && npc.mob.size > 1) out.push('Mob: ' + npc.mob.size);
    if (npc.weapon) out.push('Weapon: ' + npc.weapon);
    if (npc.armor) out.push('Armor: ' + npc.armor);
    if (npc.stress.length) npc.stress.forEach(t => out.push(t.name + ': ' + Array(t.boxes).fill('[ ]').join(' ')));
    else out.push('Stress: none');
    npc.consequences.forEach(c => {
      const kind = String(c.name || '').match(/mild|moderate|severe|extreme/i);
      const k = kind ? kind[0].charAt(0).toUpperCase() + kind[0].slice(1).toLowerCase() : 'Mild';
      out.push((c.only ? k + ' (' + c.only + ')' : k) + ':');
    });
    (npc.notes || []).forEach(n => out.push('Note: ' + n.text));
    return out.join('\n');
  }

  function npcToDef(npc) {
    return FateSheet.npcDef(npcText(npc), {
      importance: npc.importance, quality: npc.quality || null, threat: npc.threat || null, role: npc.role,
      genre: npc.genre, archetype: npc.archetypeLabel, seed: npc.seed
    });
  }

  function addDefToLibrary(def) {
    def.id = uid();
    def.system = 'fate';
    OSR.state.monsters.push(def);
    return def;
  }

  /* ---- The NPC generator modal (Bestiary) ---- */

  let genNpc = null; // the NPC shown in the preview

  function fillGenreSelect(sel) {
    if (sel.options.length) return;
    OSR.data.fate.genres.genres.forEach(g => {
      const o = document.createElement('option');
      o.value = g.id; o.textContent = g.label || g.id;
      sel.appendChild(o);
    });
    sel.value = 'fantasy';
  }

  function openFateGenerator() {
    if (!OSR.data.fate) return;
    fillGenreSelect($('#fg-genre'));
    const arch = $('#fg-archetype');
    if (!arch.options.length) {
      arch.innerHTML = '<option value="auto">Auto</option>' + OSR.data.fate.archetypes.archetypes.map(a =>
        '<option value="' + escapeHtml(a.id) + '">' + escapeHtml(a.label) + '</option>').join('');
    }
    syncGenFields();
    $('#fate-gen-modal').hidden = false;
    $('#fg-msg').textContent = '';
  }
  function closeFateGenerator() { const m = $('#fate-gen-modal'); if (m) m.hidden = true; }

  function syncGenFields() {
    const nameless = $('#fg-importance').value === 'nameless';
    $('#fg-quality-field').hidden = !nameless;
    $('#fg-mob-field').hidden = !nameless;
  }

  function genOptions() {
    return {
      seed: $('#fg-seed').value.trim() || null,
      ruleSet: 'core',
      genre: $('#fg-genre').value,
      importance: $('#fg-importance').value,
      quality: $('#fg-quality').value,
      threat: $('#fg-threat').value,
      role: $('#fg-role').value,
      archetype: $('#fg-archetype').value,
      disposition: $('#fg-disposition').value,
      pcPeak: parseInt($('#fg-pcpeak').value, 10) || 4,
      mobSize: parseInt($('#fg-mob').value, 10) || 1
    };
  }

  function previewHtml(npc) {
    const def = npcToDef(npc);
    const odds = npc.odds ? ' · vs PC peak: wins ' + Math.round(npc.odds.win * 100) + '%, ties ' + Math.round(npc.odds.tie * 100) + '%' : '';
    return '<div class="fate-preview-head"><b>' + escapeHtml(npc.name) + '</b> <span class="hint">' +
      escapeHtml(OSR.monsterMetaLine(def) + odds + ' · seed ' + npc.seed) + '</span></div>' +
      FateSheet.sheetHtml(FateSheet.parseNpc(def.raw), { readOnly: true });
  }

  function generateOne(reroll) {
    const opts = genOptions();
    if (reroll) opts.seed = null;
    genNpc = FateNpc.generateNpc(OSR.data.fate, opts);
    $('#fg-preview').innerHTML = previewHtml(genNpc);
    $('#fg-actions').hidden = false;
    $('#fg-msg').textContent = '';
  }

  function addGenerated(alsoCombat) {
    if (!genNpc) return;
    const def = addDefToLibrary(npcToDef(genNpc));
    OSR.save();
    if (alsoCombat) OSR.addMonsterEntry(def);
    OSR.renderMonsterBrowser();
    OSR.renderCombat();
    $('#fg-msg').textContent = 'Added ' + def.name + ' to the Bestiary' + (alsoCombat ? ' and to Combat.' : '.');
  }

  /* ---- The encounter modal (Combat → Populate encounter) ---- */

  let genEnc = null;

  function openFateEncounter() {
    if (!OSR.data.fate) return;
    fillGenreSelect($('#fe-genre'));
    $('#fe-pcs').value = Math.max(1, scenePcCount() || 3);
    $('#fate-enc-modal').hidden = false;
    $('#fe-msg').textContent = '';
  }
  function closeFateEncounter() { const m = $('#fate-enc-modal'); if (m) m.hidden = true; }

  function generateEncounter(reroll) {
    genEnc = FateNpc.generateEncounter(OSR.data.fate, {
      seed: reroll ? null : ($('#fe-seed').value.trim() || null),
      ruleSet: 'core',
      genre: $('#fe-genre').value,
      level: $('#fe-level').value,
      pcCount: parseInt($('#fe-pcs').value, 10) || 3,
      pcPeak: parseInt($('#fe-pcpeak').value, 10) || 4,
      monster: $('#fe-monster').value
    });
    const ctx = genEnc.context || {};
    $('#fe-preview').innerHTML = '<p class="hint">' + escapeHtml(genEnc.levelLabel + ' · ' + (ctx.faction || '') +
      (ctx.place ? ' at ' + ctx.place : '') + ' · GM fate points ' + genEnc.gmFatePoints + ' · seed ' + genEnc.seed) + '</p>' +
      '<ul class="comp-list">' + genEnc.members.map(n =>
        '<li class="comp-row"><div class="comp-row-head"><span class="comp-name">' + escapeHtml(n.name) + '</span>' +
        '<span class="badge">' + escapeHtml(OSR.monsterMetaLine(npcToDef(n))) + '</span></div>' +
        '<div class="comp-excerpt">' + escapeHtml(n.aspects.map(a => a.text).join(' · ')) + '</div></li>').join('') + '</ul>';
    $('#fe-actions').hidden = false;
    $('#fe-msg').textContent = '';
  }

  // Adds every member to Combat (and the Bestiary, when ticked), and gives
  // the GM the encounter's fate points (1 per PC).
  function addEncounter() {
    if (!genEnc) return;
    const toLib = $('#fe-add-lib').checked;
    genEnc.members.forEach(n => {
      const def = npcToDef(n);
      if (toLib) addDefToLibrary(def); else def.system = 'fate';
      OSR.addMonsterEntry(def);
    });
    OSR.state.fateScene.gmPoints = genEnc.gmFatePoints;
    OSR.save();
    OSR.pushNote('Combat', 'Fate encounter (' + genEnc.levelLabel + '): ' + genEnc.members.map(n => n.name).join(', ') +
      ' — GM fate points: ' + genEnc.gmFatePoints);
    renderFateAspects();
    OSR.renderMonsterBrowser();
    OSR.renderCombat();
    closeFateEncounter();
  }

  function wireFateGenerators() {
    $('#fate-gen-open').addEventListener('click', openFateGenerator);
    $('#fg-close').addEventListener('click', closeFateGenerator);
    $('#fate-gen-modal').addEventListener('click', e => { if (e.target === $('#fate-gen-modal')) closeFateGenerator(); });
    $('#fg-importance').addEventListener('change', syncGenFields);
    $('#fg-generate').addEventListener('click', () => generateOne(false));
    $('#fg-reroll').addEventListener('click', () => generateOne(true));
    $('#fg-add-lib').addEventListener('click', () => addGenerated(false));
    $('#fg-add-combat').addEventListener('click', () => addGenerated(true));

    // In Fate, Combat's "+ Populate encounter…" opens this modal in place of Populate by HD
    // (capture phase: it runs before js/combat-populate.js's own listener).
    $('#cb-populate-hd').addEventListener('click', e => {
      if (!isFate()) return;
      e.stopImmediatePropagation();
      openFateEncounter();
    }, true);
    $('#fe-close').addEventListener('click', closeFateEncounter);
    $('#fate-enc-modal').addEventListener('click', e => { if (e.target === $('#fate-enc-modal')) closeFateEncounter(); });
    $('#fe-generate').addEventListener('click', () => generateEncounter(false));
    $('#fe-reroll').addEventListener('click', () => generateEncounter(true));
    $('#fe-add').addEventListener('click', addEncounter);
  }

  function wireFate() {
    wireFateAspects();
    wireFateGenerators();
  }

  Object.assign(OSR, {
    seedFateCompendium, renderFateDiceActions, invokeLast, rerollLast,
    renderFateAspects, addAspect, invokeAspect, newScene, scenePcCount,
    npcText, npcToDef, openFateGenerator, closeFateGenerator, generateOne, addGenerated,
    openFateEncounter, closeFateEncounter, generateEncounter, addEncounter, wireFate
  });
  // Live getters (Object.assign would copy their value once): the NPC and the
  // encounter the modals show.
  Object.defineProperty(OSR, 'fateGenNpc', { get: () => genNpc, configurable: true });
  Object.defineProperty(OSR, 'fateGenEncounter', { get: () => genEnc, configurable: true });
})(window.OSR = window.OSR || {});
