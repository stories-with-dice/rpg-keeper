/* js/seed.js — first-run seeding of example characters and the monster
 * library. The character sheets are data/*.txt and the monsters are
 * data/monsters.json; js/data.js fetches both before init() (see AGENTS.md
 * "Seeding").
 */
(function (OSR) {
  'use strict';
  // Every example sheet's text, in OSR.PREGEN_FILES order (js/data.js
  // fetched them before init()).
  function loadSeedSheets() {
    return OSR.data.pregens.map(p => p.text);
  }

  function seed() {
    loadSeedSheets().forEach(text => OSR.createCharacter(text));
    if (OSR.state.characters.length) {
      OSR.state.activeId = OSR.state.characters[0].id;
      OSR.save();
      OSR.refreshCharUI();
    }
  }

  // The example characters' names and which of them the campaign lacks —
  // matched by name, case-insensitive.
  function missingPregens() {
    const have = new Set(OSR.state.characters.map(c => String(c.name || '').toLowerCase()));
    return loadSeedSheets().map(t => OSR.detectNameSystem(t).name).filter(n => !have.has(n.toLowerCase()));
  }

  // Settings → "Add missing pregens": seed() only runs on a fresh install, so
  // this adds every example character the campaign lacks (one made before a
  // pregen existed, or after one was deleted), across all systems. The active
  // character(s) stay selected. Returns the count added.
  function addMissingPregens() {
    const missing = new Set(missingPregens().map(n => n.toLowerCase()));
    const keepA = OSR.state.activeId, keepB = OSR.state.activeIdB;
    let added = 0;
    loadSeedSheets().forEach(text => {
      const key = OSR.detectNameSystem(text).name.toLowerCase();
      if (!missing.has(key)) return;
      missing.delete(key);
      OSR.createCharacter(text);
      added++;
    });
    if (added) {
      OSR.state.activeId = keepA;
      OSR.state.activeIdB = keepB;
      OSR.save();
      OSR.refreshCharUI();
    }
    return added;
  }

  function seedMonsters() {
    // clone so state mutations never touch the shared constant
    const defs = JSON.parse(JSON.stringify(OSR.data.monsters));
    defs.forEach(d => { if (!d.id) d.id = OSR.uid(); d.system = 'osr'; }); // the bundled library is all OSR (Shadowdark/OSE)
    // Reseeding only ever replaces the OSR-tagged portion of the library —
    // monsters belonging to another system are preserved (mirrors how the
    // Compendium's Reseed/Delete all stay scoped to the active system).
    OSR.state.monsters = OSR.state.monsters.filter(m => (m.system || 'osr') !== 'osr').concat(defs);
    OSR.state.monstersSeeded = true;
    OSR.save();
    OSR.renderLibrary();
    OSR.renderCombatBar();
    OSR.renderSettings();
  }

  // Seeds whatever the current campaign lacks: the example characters (only
  // when `withPregens`, i.e. a fresh install), then the Bestiary and
  // Compendium defaults of every system. init() calls it at boot; a new
  // campaign (js/campaigns.js) calls it without the pregens.
  function seedMissing(withPregens) {
    if (withPregens && !OSR.state.characters.length) seed();
    if (!OSR.state.monsters.length && !OSR.state.monstersSeeded) seedMonsters();
    if (!OSR.state.brpMonstersSeeded) OSR.seedBrpMonsters();
    if (!OSR.state.slMonstersSeeded) OSR.seedSlMonsters();
    if ((OSR.state.compendiumSeedVersion || 0) < OSR.data.seeds.osr.version) OSR.seedCompendium();
    if (!OSR.state.brpCompendiumSeeded) OSR.seedBrpCompendium();
    if (!OSR.state.slCompendiumSeeded) OSR.seedSlCompendium();
  }

  Object.assign(OSR, { seedMissing, loadSeedSheets, seed, missingPregens, addMissingPregens, seedMonsters });
})(window.OSR = window.OSR || {});
