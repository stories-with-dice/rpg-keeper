/* js/brp-seed.js — first-run seeding of the BRP Compendium (Powers +
 * Equipment) and Bestiary, both from data/seed-brp.json (OSR.seeds.brp,
 * js/seeds.js).
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
    const defs = OSR.seeds.brp.monsters.map(m => OSR.monsterCopy('brp', m));
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
    const SEED = OSR.seeds.brp.compendium;
    const have = new Set(OSR.state.compendium.filter(e => e.system === 'brp').map(e => (e.name || '').toLowerCase()));
    let added = 0;
    SEED.forEach(e => {
      if (!e || !e.name || have.has(String(e.name).toLowerCase())) return;
      OSR.state.compendium.push(OSR.compCopy('brp', e));
      have.add(String(e.name).toLowerCase());
      added++;
    });
    OSR.state.brpCompendiumSeeded = true;
    OSR.save();
    return added;
  }

  Object.assign(OSR, { seedBrpMonsters, seedBrpCompendium });
})(window.OSR = window.OSR || {});
