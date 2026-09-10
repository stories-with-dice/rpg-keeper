/* js/monster-browser.js — the Bestiary tab: a persistent, filterable view of
 * the whole monster library (mirrors js/compendium.js's tab pattern), plus a
 * Party-Level random monster generator following the Shadowdark core
 * rulebook's "Monster Generator" (d20 Combat/Quality/Strength/Weakness,
 * keyed off Party Level) and "Monster Mutations" (3×d12 columns) tables.
 * Adding/editing here reuses the same modals as Combat's "+ Add monster…"
 * (js/monster-modals.js) — this file only renders/filters the list and rolls
 * the generator, then hands off to OSR.openMonsterModal()/openMonsterEdit().
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml } = OSR;

  // The monster library is partitioned by System (Settings → System), same
  // mechanism as the Compendium (compendiumForSystem in js/compendium.js) —
  // every def carries a `system` field, backfilled to 'osr' for anything
  // that predates this (see ensureStateShape). Filtered from view, never
  // deleted — switching System back brings them right back.
  function monstersForSystem() {
    const sys = OSR.currentSystem ? OSR.currentSystem() : 'osr';
    return OSR.state.monsters.filter(d => (d.system || 'osr') === sys);
  }

  function browserMatches() {
    return OSR.filterMonsters(monstersForSystem(), {
      q: $('#mb-search').value,
      hdMin: parseFloat($('#mb-hd-min').value),
      hdMax: parseFloat($('#mb-hd-max').value)
    });
  }

  function renderMonsterBrowser() {
    const list = $('#mb-list');
    if (!list) return; // defensive: called from renderLibrary() before this tab exists
    // The generator follows the Shadowdark core rulebook's tables — it has no
    // Unknown Armies equivalent (no monster stat blocks, GMCs use the same
    // sheet as PCs), so hide it rather than let it add nonsense 'ua3e' monsters.
    const gen = $('#mb-gen');
    if (gen) gen.hidden = (OSR.currentSystem ? OSR.currentSystem() : 'osr') !== 'osr';
    const filtered = browserMatches();
    const total = monstersForSystem().length;
    $('#mb-count').textContent = filtered.length + ' / ' + total;
    $('#mb-empty').hidden = total > 0;
    list.innerHTML = filtered.map(d => {
      const meta = ['HD ' + (d.hd || '?'), 'AC ' + (d.ac && d.ac.asc != null ? d.ac.asc : '?'), 'HP ' + (d.hp || '?'), d.source].join(' · ');
      return '<li class="comp-row mb-row" data-id="' + d.id + '">' +
        '<div class="comp-row-head">' +
          '<span class="comp-name">' + escapeHtml(d.name) + '</span>' +
          '<span class="badge">' + escapeHtml(meta) + '</span>' +
          '<button class="btn mb-add-combat">Add to Combat</button>' +
          '<button class="btn mb-edit">Edit</button>' +
          '<button class="btn btn-danger mb-del" title="Remove from library">&times;</button>' +
        '</div>' +
      '</li>';
    }).join('');
  }

  function onBrowserListClick(e) {
    const row = e.target.closest('.mb-row');
    if (!row) return;
    const d = OSR.state.monsters.find(x => x.id === row.dataset.id);
    if (!d) return;
    if (e.target.closest('.mb-add-combat')) {
      OSR.addMonsterEntry(d);
      OSR.pushNote('Bestiary', 'added ' + d.name + ' to combat');
    } else if (e.target.closest('.mb-edit')) {
      OSR.openMonsterEdit(d.id);
    } else if (e.target.closest('.mb-del')) {
      if (confirm('Remove "' + d.name + '" from the library?')) {
        OSR.state.monsters = OSR.state.monsters.filter(x => x.id !== d.id);
        OSR.save();
        renderMonsterBrowser();
        OSR.renderSettings();
      }
    }
  }

  /* ---- PL-based random monster generator (Shadowdark core rules, pg 190-191) ---- */
  // d20 "Monster Generator" table: `offset` is added to Party Level for both
  // the monster's LV and its attack bonus (its AC is always PL + 10).
  const GEN_TABLE = [
    { offset: -3, quality: 'Beastlike',   strength: '+1 attack',          weakness: 'Cold' },
    { offset: -3, quality: 'Avian',       strength: 'Absorbs magic',      weakness: 'Greedy' },
    { offset: -2, quality: 'Amphibious',  strength: 'Swarm',              weakness: 'Light' },
    { offset: -2, quality: 'Demonic',     strength: '1d10 damage',        weakness: 'Salt' },
    { offset: -1, quality: 'Arachnid',    strength: 'Poison sting',       weakness: 'Vain' },
    { offset: -1, quality: 'Ooze',        strength: 'Confusing gaze',     weakness: 'Mirrors' },
    { offset: 0,  quality: 'Insectoid',   strength: 'Eats metal',         weakness: 'Electricity' },
    { offset: 0,  quality: 'Draconic',    strength: 'Ranged attacks',     weakness: 'Fragile body' },
    { offset: 0,  quality: 'Plantlike',   strength: 'Highly intelligent', weakness: 'Sunlight' },
    { offset: 0,  quality: 'Elephantine', strength: 'Crushing grasp',     weakness: 'Silver' },
    { offset: 0,  quality: 'Undead',      strength: 'Psychic blast',      weakness: 'Fire' },
    { offset: 0,  quality: 'Crystalline', strength: 'Stealthy',           weakness: 'Food' },
    { offset: 0,  quality: 'Humanoid',    strength: 'Petrifying gaze',    weakness: 'Acid' },
    { offset: 1,  quality: 'Angelic',     strength: '1d12 damage',        weakness: 'Garlic' },
    { offset: 1,  quality: 'Spectral',    strength: 'Impersonation',      weakness: 'Iron' },
    { offset: 2,  quality: 'Stonecarved', strength: 'Blinding aura',      weakness: 'Water' },
    { offset: 2,  quality: 'Serpentine',  strength: 'Turns invisible',    weakness: 'Its True Name' },
    { offset: 3,  quality: 'Elemental',   strength: '2d6 damage',         weakness: 'Loud sounds' },
    { offset: 3,  quality: 'Piscine',     strength: 'Swallows whole',     weakness: 'Holy water' },
    { offset: 4,  quality: 'Reptilian',   strength: '+2 attacks',         weakness: 'Music' }
  ];
  // "Monster Mutations": 3 separate d12 columns. Rolling N mutations (0-3)
  // uses columns 1..N in order, per the rulebook's "Mutation 1/2/3" headers.
  const MUTATION_TABLES = [
    ['Shapechanger', 'Fins and gills', 'Insulating fur', 'Ironlike scales', 'Extra limbs', 'Tentacles',
     'Boneless', 'Gigantic', 'Flings spikes', 'Two heads', 'Burrows', 'Wings'],
    ['Double damage', 'Breathes fire', 'Fast healing', '+1 attack', '+2 AC', '+2 levels',
     '+1d6 damage', 'Life-draining touch', 'Very fast', 'Reflects spells', 'Electrified weapon', 'Acidic saliva'],
    ['Speaks Common', 'Knows 1d4 spells', 'Telepathic', 'Toxic spores', 'Sonic blasts', 'Can teleport in bursts',
     'Paralytic touch', 'Genius intellect', 'Antimagic field', 'Blood-draining bite', 'Has swamp fever', 'Blessed by a god']
  ];

  function rollDie(sides) { return 1 + Math.floor(Math.random() * sides); }

  const fmtMod = n => (n >= 0 ? '+' : '') + n;

  // Pure aside from Math.random, so it's easy to test with a rigged RNG.
  // mutationCount is clamped to 0-3; the Nth mutation rolled uses
  // MUTATION_TABLES[N-1].
  function generateMonster(pl, mutationCount) {
    pl = Math.max(0, Math.round(Number(pl) || 0));
    mutationCount = Math.max(0, Math.min(3, Math.round(Number(mutationCount) || 0)));
    const row = GEN_TABLE[rollDie(20) - 1];
    const lv = Math.max(0, pl + row.offset);
    const atkBonus = lv;
    let hp = 0;
    for (let i = 0; i < lv; i++) hp += rollDie(8);
    hp = Math.max(1, hp); // every monster has at least 1 HP, even at LV 0
    const attackCount = rollDie(4);
    const abilities = [
      { name: 'Strength', text: row.strength },
      { name: 'Weakness', text: row.weakness }
    ];
    for (let i = 0; i < mutationCount; i++) {
      abilities.push({ name: 'Mutation', text: MUTATION_TABLES[i][rollDie(12) - 1] });
    }
    const attacksText = (attackCount > 1 ? attackCount + ' ' : '') + 'attack ' + fmtMod(atkBonus) + ' (1d8)';
    return {
      name: 'PL ' + pl + ' ' + row.quality + ' Creature',
      source: 'shadowdark',
      desc: row.quality + ' creature generated for Party Level ' + pl + '.',
      raw: '',
      ac: { asc: pl + 10, desc: null, thac0: null },
      hd: String(lv), hdNum: lv, hp,
      move: 'near', align: '', xp: null, moraleML: null,
      atkBonus, attacksText,
      attacks: [{ label: 'attack', count: attackCount, toHit: atkBonus, damage: '1d8', note: '', raw: '' }],
      stats: null, saveTargets: null, savesText: '',
      abilities
    };
  }

  function wireMonsterBrowser() {
    $('#mb-new').addEventListener('click', () => OSR.openMonsterModal());
    $('#mb-search').addEventListener('input', renderMonsterBrowser);
    $('#mb-hd-min').addEventListener('input', renderMonsterBrowser);
    $('#mb-hd-max').addEventListener('input', renderMonsterBrowser);
    $('#mb-list').addEventListener('click', onBrowserListClick);
    $('#mb-generate').addEventListener('click', () => {
      const pl = parseInt($('#mb-gen-pl').value, 10) || 0;
      const muts = parseInt($('#mb-gen-mutations').value, 10) || 0;
      OSR.openMonsterModal({ prefill: generateMonster(pl, muts) });
    });
  }

  Object.assign(OSR, { monstersForSystem, browserMatches, renderMonsterBrowser, generateMonster, wireMonsterBrowser });
})(window.OSR = window.OSR || {});
