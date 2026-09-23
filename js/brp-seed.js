/* js/brp-seed.js — first-run seeding of the BRP Compendium (Powers +
 * Equipment, js/brp-compendium-seed.js) and Bestiary (js/brp-monsters-data.js).
 * Mirrors js/seed.js's seedMonsters()/js/compendium.js's seedCompendium(), but
 * unlike the OSR-only seedCompendium() (which hardcodes source/system to
 * "Shadowdark Core"/'osr'), these use each entry's own `category`/`source`
 * and tag everything `system: 'brp'` — see AGENTS.md "Game system".
 */
(function (OSR) {
  'use strict';

  // Reseeding only ever replaces the 'brp'-tagged slice of state.monsters —
  // other systems' monsters are preserved (same pattern as seedMonsters()).
  function seedBrpMonsters() {
    const defs = (typeof window !== 'undefined' && Array.isArray(window.BRP_MONSTER_LIBRARY))
      ? JSON.parse(JSON.stringify(window.BRP_MONSTER_LIBRARY)) : [];
    defs.forEach(d => { if (!d.id) d.id = OSR.uid(); d.system = 'brp'; });
    OSR.state.monsters = OSR.state.monsters.filter(m => (m.system || 'osr') !== 'brp').concat(defs);
    OSR.state.brpMonstersSeeded = true;
    OSR.save();
  }

  // Add every default BRP entry not already present (matched by name,
  // case-insensitive, against the *BRP* slice of the Compendium only — unlike
  // seedCompendium()'s whole-Compendium check, BRP shares plenty of names
  // with the OSR gear/spell seed ("Dagger", "Heal", …) that must not
  // suppress the BRP entry, since compByExactName/etc. already scope lookups
  // to compendiumForSystem() and would never see the OSR one anyway while
  // System = brp). Returns the count added.
  function seedBrpCompendium() {
    const SEED = (typeof window !== 'undefined' && Array.isArray(window.BRP_COMPENDIUM_SEED))
      ? window.BRP_COMPENDIUM_SEED : [];
    const have = new Set(OSR.state.compendium.filter(e => e.system === 'brp').map(e => (e.name || '').toLowerCase()));
    let added = 0;
    SEED.forEach(e => {
      if (!e || !e.name || have.has(String(e.name).toLowerCase())) return;
      OSR.state.compendium.push({
        id: OSR.uid(), name: e.name,
        category: OSR.COMPENDIUM_CATEGORIES.indexOf(e.category) === -1 ? 'Other' : e.category,
        source: e.source || OSR.COMPENDIUM_DEFAULT_SOURCE, system: 'brp',
        body: e.body || '', createdAt: Date.now(), updatedAt: Date.now()
      });
      have.add(String(e.name).toLowerCase());
      added++;
    });
    OSR.state.brpCompendiumSeeded = true;
    OSR.save();
    return added;
  }

  Object.assign(OSR, { seedBrpMonsters, seedBrpCompendium });
})(window.OSR = window.OSR || {});
