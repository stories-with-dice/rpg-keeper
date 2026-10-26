/* js/sl-seed.js — first-run seeding of the Silent Legions Compendium
 * (Spells/Disciplines/Rules/Equipment) and Bestiary, both from
 * data/seed-sl.json (OSR.data.seeds.sl, loaded by js/data.js). Same mechanism as js/brp-seed.js: each
 * entry keeps its own `category`/`source`, and everything is tagged
 * `system: 'sl'` — see AGENTS.md "Silent Legions (SL)".
 */
(function (OSR) {
  'use strict';

  // Reseeding only ever replaces the 'sl'-tagged slice of state.monsters —
  // other systems' monsters are preserved (same pattern as seedBrpMonsters()).
  function seedSlMonsters() {
    const defs = JSON.parse(JSON.stringify(OSR.data.seeds.sl.monsters));
    defs.forEach(d => { if (!d.id) d.id = OSR.uid(); d.system = 'sl'; });
    OSR.state.monsters = OSR.state.monsters.filter(m => (m.system || 'osr') !== 'sl').concat(defs);
    OSR.state.slMonstersSeeded = true;
    OSR.save();
  }

  // Add every default SL entry not already present, matched by name against
  // the SL slice of the Compendium only (see seedBrpCompendium() for why —
  // "Knife", "Shield", … also exist in other systems' seeds). Returns the
  // count added.
  function seedSlCompendium() {
    const SEED = OSR.data.seeds.sl.compendium;
    const have = new Set(OSR.state.compendium.filter(e => e.system === 'sl').map(e => (e.name || '').toLowerCase()));
    let added = 0;
    SEED.forEach(e => {
      if (!e || !e.name || have.has(String(e.name).toLowerCase())) return;
      OSR.state.compendium.push({
        id: OSR.uid(), name: e.name,
        category: OSR.COMPENDIUM_CATEGORIES.indexOf(e.category) === -1 ? 'Other' : e.category,
        source: e.source || OSR.COMPENDIUM_DEFAULT_SOURCE, system: 'sl',
        body: e.body || '', createdAt: Date.now(), updatedAt: Date.now()
      });
      have.add(String(e.name).toLowerCase());
      added++;
    });
    OSR.state.slCompendiumSeeded = true;
    OSR.save();
    return added;
  }

  Object.assign(OSR, { seedSlMonsters, seedSlCompendium });
})(window.OSR = window.OSR || {});
