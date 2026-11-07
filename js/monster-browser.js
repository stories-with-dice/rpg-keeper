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
  // WWN can also show the OSR library's Shadowdark monsters (Settings →
  // "Shadowdark Bestiary in WWN"): the two use the same ascending AC and
  // attack bonus. They stay OSR monsters; this only shows them.
  function monstersForSystem() {
    const sys = OSR.currentSystem ? OSR.currentSystem() : 'osr';
    const sd = sys === 'wwn' && OSR.state.settings && OSR.state.settings.wwnShadowdark === true;
    return OSR.state.monsters.filter(d => (d.system || 'osr') === sys ||
      (sd && (d.system || 'osr') === 'osr' && d.source === 'shadowdark'));
  }

  // The BRP core book's Chapter 10 settings (pp.205-210), in the book's order.
  // A BRP monster's `settings` list holds some of these names (the brp_character
  // repo's tools/monster_settings.py writes them into the content pack and into
  // data/seed-brp.json). A setting not in this list sorts after them, A to Z.
  const BRP_SETTINGS = ['Prehistoric Age', 'Ancient World', 'Early Medieval', 'High Medieval', 'High Fantasy',
    'Imperial Asia', 'Arabian Nights', 'Enlightenment and Renaissance', 'Age of Exploration', 'Age of Sail',
    'Industrial Age', 'Victorian Age', 'Wild West', 'Pulp Era', 'Planetary Adventure', 'World War II', 'Noir',
    'Modern', 'Superworld', 'Postapocalyptic', 'Near-Future/Cyberpunk', 'Space Exploration', 'Space Opera'];

  // Every setting that a monster of `list` has, in BRP_SETTINGS order.
  function monsterSettings(list) {
    const have = new Set();
    list.forEach(d => { if (Array.isArray(d.settings)) d.settings.forEach(x => { if (x) have.add(String(x)); }); });
    const rank = x => { const i = BRP_SETTINGS.indexOf(x); return i < 0 ? BRP_SETTINGS.length : i; };
    return Array.from(have).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }

  // Refill a "Setting" <select> with the settings of `list`. Keeps the chosen
  // value while the list still has it; hides `field` when no monster has one.
  function fillSettingSelect(select, field, list) {
    const settings = monsterSettings(list);
    const cur = settings.includes(select.value) ? select.value : '';
    select.innerHTML = '<option value="">Any setting</option>' +
      settings.map(x => '<option value="' + escapeHtml(x) + '">' + escapeHtml(x) + '</option>').join('');
    select.value = cur;
    field.hidden = !settings.length;
  }

  function browserMatches() {
    return OSR.filterMonsters(monstersForSystem(), {
      q: $('#mb-search').value,
      hdMin: parseFloat($('#mb-hd-min').value),
      hdMax: parseFloat($('#mb-hd-max').value),
      setting: $('#mb-setting').value
    });
  }

  // "Pick random" (BRP only): one monster at random from the monsters that
  // match the toolbar filters (search, EL range, Setting). The pick shows in
  // #mb-pick above the list until it is closed or no longer in the library.
  let pickedId = null;
  let pickMsg = '';
  function pickRandomMonster() {
    const pool = browserMatches();
    if (!pool.length) {
      pickedId = null;
      pickMsg = 'No monster matches the filters.';
    } else {
      // Another monster than the last pick, when the pool has one.
      const others = pool.length > 1 ? pool.filter(d => d.id !== pickedId) : pool;
      pickedId = others[Math.floor(Math.random() * others.length)].id;
      pickMsg = '';
    }
    renderMonsterPick();
    const d = pickedId && OSR.state.monsters.find(x => x.id === pickedId);
    if (d) OSR.pushNote('Bestiary', 'picked ' + d.name + ' at random');
  }
  function renderMonsterPick() {
    const box = $('#mb-pick');
    const d = pickedId && monstersForSystem().find(x => x.id === pickedId);
    const brp = OSR.currentSystem() === 'brp';
    if (!brp || (!d && !pickMsg)) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    if (!d) {
      box.innerHTML = '<span class="hint">' + escapeHtml(pickMsg) + '</span>' +
        '<button class="btn mb-pick-close" type="button" title="Close">&times;</button>';
      return;
    }
    const list = Array.isArray(d.settings) ? d.settings : [];
    const settings = BRP_SETTINGS.every(x => list.includes(x)) ? 'Every setting' : list.join(', ');
    box.innerHTML =
      '<div class="comp-row-head mb-row" data-id="' + escapeHtml(d.id) + '">' +
        '<i class="fa-solid fa-dice"></i> ' +
        '<span class="comp-name">' + escapeHtml(d.name) + '</span>' +
        '<span class="badge">' + escapeHtml(OSR.monsterMetaLine(d)) + '</span>' +
        '<button class="btn mb-pick-add" type="button">Add to Combat</button>' +
        '<button class="btn mb-pick-again" type="button" title="Pick another monster with the same filters">Pick again</button>' +
        '<button class="btn mb-pick-close" type="button" title="Close">&times;</button>' +
      '</div>' +
      (settings ? '<div class="hint mb-pick-settings">' + escapeHtml(settings) + '</div>' : '');
  }
  function onPickClick(e) {
    const d = pickedId && OSR.state.monsters.find(x => x.id === pickedId);
    if (e.target.closest('.mb-pick-close')) {
      pickedId = null; pickMsg = ''; OSR.hideLibPreview(); renderMonsterPick();
    } else if (e.target.closest('.mb-pick-again')) {
      OSR.hideLibPreview(); pickRandomMonster();
    } else if (e.target.closest('.mb-pick-add') && d) {
      OSR.addMonsterEntry(d);
      OSR.pushNote('Bestiary', 'added ' + d.name + ' to combat');
    }
  }

  function renderMonsterBrowser() {
    const list = $('#mb-list');
    if (!list) return; // defensive: called from renderLibrary() before this tab exists
    // The generator follows the Shadowdark core rulebook's tables — it has no
    // Unknown Armies equivalent (no monster stat blocks, GMCs use the same
    // sheet as PCs), so hide it rather than let it add nonsense 'ua3e' monsters.
    const gen = $('#mb-gen');
    if (gen) gen.hidden = (OSR.currentSystem ? OSR.currentSystem() : 'osr') !== 'osr';
    // Fate has its own NPC generator (js/fate-ui.js).
    const fateGen = $('#fate-gen-open');
    if (fateGen) fateGen.hidden = OSR.currentSystem() !== 'fate';
    // Unknown Armies GMCs have no Hit Dice: hide the HD range filter.
    document.querySelectorAll('#tab-bestiary .mb-hd-field').forEach(el => { el.hidden = OSR.currentSystem() === 'ua3e'; });
    // The Setting filter shows when a monster of this System has settings (BRP).
    fillSettingSelect($('#mb-setting'), $('#mb-setting-field'), monstersForSystem());
    $('#mb-pick-random').hidden = OSR.currentSystem() !== 'brp';
    renderMonsterPick();
    OSR.applyLevelLabels();
    const filtered = browserMatches();
    const total = monstersForSystem().length;
    $('#mb-count').textContent = filtered.length + ' / ' + total;
    $('#mb-empty').hidden = total > 0;
    list.innerHTML = filtered.map(d => {
      const meta = OSR.monsterMetaLine(d);
      return '<li class="comp-row mb-row" data-id="' + d.id + '">' +
        '<div class="comp-row-head">' +
          '<span class="comp-name mb-hover-name" title="">' + escapeHtml(d.name) + '</span>' +
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
    $('#mb-setting').addEventListener('change', renderMonsterBrowser);
    $('#mb-pick-random').addEventListener('click', pickRandomMonster);
    $('#mb-pick').addEventListener('click', onPickClick);
    $('#mb-pick').addEventListener('mouseover', e => {
      const row = e.target.closest('.mb-row[data-id]');
      if (row && e.target.closest('.comp-name')) OSR.showLibPreview(row);
    });
    $('#mb-pick').addEventListener('mouseleave', OSR.hideLibPreview);
    $('#mb-list').addEventListener('click', onBrowserListClick);
    // Hovering a monster's name shows its stat-block card (the Add monster modal's hover card).
    $('#mb-list').addEventListener('mouseover', e => {
      const row = e.target.closest('.mb-row[data-id]');
      if (row && e.target.closest('.comp-name')) OSR.showLibPreview(row);
    });
    $('#mb-list').addEventListener('mouseout', e => {
      if (e.target.closest('.comp-name') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.comp-name'))) OSR.hideLibPreview();
    });
    $('#mb-list').addEventListener('mouseleave', OSR.hideLibPreview);
    $('#mb-gen-open').addEventListener('click', () => setGeneratorOpen($('#mb-gen-pop').hidden));
    $('#mb-generate').addEventListener('click', () => {
      const pl = parseInt($('#mb-gen-pl').value, 10) || 0;
      const muts = parseInt($('#mb-gen-mutations').value, 10) || 0;
      setGeneratorOpen(false);
      OSR.openMonsterModal({ prefill: generateMonster(pl, muts) });
    });
    // A mousedown outside the button and its panel closes the panel.
    document.addEventListener('mousedown', e => {
      if (!$('#mb-gen-pop').hidden && !(e.target.closest && e.target.closest('#mb-gen'))) setGeneratorOpen(false);
    });
  }

  // The generator's floating panel, under its toolbar button (#mb-gen-open).
  function setGeneratorOpen(open) {
    $('#mb-gen-pop').hidden = !open;
    $('#mb-gen-open').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) $('#mb-gen-pl').focus();
  }
  function closeMonsterGenerator() { setGeneratorOpen(false); }

  Object.assign(OSR, { monstersForSystem, browserMatches, renderMonsterBrowser, generateMonster, closeMonsterGenerator, wireMonsterBrowser,
    BRP_SETTINGS, monsterSettings, fillSettingSelect, pickRandomMonster });
})(window.OSR = window.OSR || {});
