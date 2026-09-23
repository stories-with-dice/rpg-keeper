/* js/brp-compendium-seed.js — hand-authored default Compendium content for
 * the BRP system, from Basic Roleplaying: Universal Game Engine: Chapter 4:
 * Powers (the Magic Spell/Mutation/Psychic Ability/Sorcery Spell/Superpower
 * summaries) and Chapter 8: Equipment (the weapon/armor/shield tables plus
 * the Medical/Other Equipment kits).
 *
 * Loaded by index.html as a <script> (works from file://); read by
 * js/brp-seed.js's seedBrpCompendium(), which — unlike seedCompendium() in
 * js/compendium.js (Shadowdark-only, hardcodes source/system) — uses each
 * entry's own `category`/`source` and tags `system: 'brp'`.
 *
 * Each entry is { name, category: 'Powers'|'Items', source, body }. `source`
 * doubles as the Compendium's per-system Source filter, so it's used here to
 * group by power type (Magic, Mutation, Psychic Ability, Sorcery, Superpower)
 * or equipment type (Weapon (Primitive/Historic/Modern/Advanced), Armor,
 * Shield, Medical Gear, Other Gear) — same mechanism the OSR seed uses
 * (js/compendium-seed.js), just with a real source per entry instead of one
 * constant. Damage/skill numbers are kept in bare dice/percent notation
 * (1D6, 50%) so js/annotate.js's auto-linking picks them up.
 */
(function (root) {
  var POWERS = [
    /* ---- Magic Spells (p.59-64), 1 power point per level unless noted ---- */
    { name: 'Blast', category: 'Powers', source: 'Magic', body: '**Cost** 3 power points/level · **Range** 100m\n\nRanged attack: 1D6 points of magical damage per level. Non-magical armor absorbs the damage as normal, and it can be dodged or parried with a shield (which takes the damage). Countermagic can stop it; Protection and Resistance do not work against it.' },
    { name: 'Change', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level · **Range** 30m · **Duration** 15 minutes\n\nTransforms a willing target (or one whose POW is overcome in a resistance roll) into another creature/object of the same relative type (animal/vegetable/mineral). Each level affects 3 SIZ; characteristics remain unchanged, only outward form/abilities change.' },
    { name: 'Conjure (type) Elemental', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level per point of elemental POW · **Range** 12m · **Duration** 10 combat rounds\n\nSummons or dismisses one of the four elemental types (Air, Earth, Fire, Water). The elemental must be directed by the magician’s full attention for the duration.' },
    { name: 'Control', category: 'Powers', source: 'Magic', body: '**Cost** 3 power points/level · **Range** 100m · **Duration** 10 combat rounds\n\nControls the thoughts/actions of one intelligent being per level (POW vs. POW resistance roll; cannot target unintelligent animals). The magician must concentrate, or the target stands idle.' },
    { name: 'Countermagic', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nReflects an incoming spell of equal or lower level back at its caster.' },
    { name: 'Dark', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nFills an area with darkness, 3 SIZ per level.' },
    { name: 'Diminish', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nReduces one of the target’s characteristics by 1 point per level (resistance roll if unwilling).' },
    { name: 'Dispel', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nEliminates existing spell effects of equal or lower level; may banish supernatural beings.' },
    { name: 'Dull', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nReduces a weapon’s attack chance and damage.' },
    { name: 'Enhance', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nIncreases one of the target’s characteristics by 1 point per level.' },
    { name: 'Fire', category: 'Powers', source: 'Magic', body: '**Cost** 3 power points/level · **Range** 100m\n\nRanged attack: 1D6 points of fire damage per level.' },
    { name: 'Frost', category: 'Powers', source: 'Magic', body: '**Cost** 3 power points/level · **Range** 100m\n\nRanged attack: 1D6 points of frost damage per level.' },
    { name: 'Heal', category: 'Powers', source: 'Magic', body: '**Cost** 3 power points/level\n\nHeals 1D6 points of damage per level.' },
    { name: 'Illusion', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nCreates a visual/audible illusion covering 3 SIZ per level.' },
    { name: 'Invisibility', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nMakes 3 SIZ points of an object or person invisible per level.' },
    { name: 'Lift', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nLifts and moves 3 SIZ points of an object or person per level.' },
    { name: 'Light', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nFills an area with light, 3 SIZ per level.' },
    { name: 'Lightning', category: 'Powers', source: 'Magic', body: '**Cost** 3 power points/level · **Range** 100m\n\nRanged attack: 1D6 points of lightning damage per level.' },
    { name: 'Perception', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nAllows the magician to detect one specific thing within range.' },
    { name: 'Protection', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nAdds 1 point of armor value per level against physical attacks.' },
    { name: 'Resistance', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nReduces damage from heat and/or cold by 1 point per level.' },
    { name: 'Seal', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nJoins two inanimate objects together.' },
    { name: 'Sharpen', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nIncreases a weapon’s attack chance and damage.' },
    { name: 'Speak to Mind', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nAllows mental communication between the magician and a target.' },
    { name: 'Teleport', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nTeleports 3 SIZ points per level anywhere within range.' },
    { name: 'Unseal', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nSeparates two objects joined by Seal (or similar).' },
    { name: 'Vision', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nAllows the magician to see what is happening elsewhere, or in the past.' },
    { name: 'Wall', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nCreates a barrier of 3 SIZ per level to protect the caster.' },
    { name: 'Ward', category: 'Powers', source: 'Magic', body: '**Cost** 1 power point/level\n\nDefines an area automatically protected by Blast and Countermagic.' },
    { name: 'Wounding', category: 'Powers', source: 'Magic', body: '**Cost** 3 power points/level\n\nCauses 1D6 points of damage per level (touch attack).' },

    /* ---- Mutations (p.65-70), d100 table ---- */
    { name: 'Adaptability', category: 'Powers', source: 'Mutation', body: '**Roll** 01-03\n\nInstantly adjusts to (or ignores) one chosen extreme condition; the relevant characteristic is doubled on a resistance roll against it.' },
    { name: 'Allergy (Adverse)', category: 'Powers', source: 'Mutation', body: '**Roll** 04-05\n\nHypersensitive to a chosen substance: minor gives −20% to all skills on contact and for 15 minutes after; major deals 1D6 damage per exposure (armor doesn’t help) plus −40% to all skills.' },
    { name: 'Biped (Quadruped) (Adverse)', category: 'Powers', source: 'Mutation', body: '**Roll** 06-09\n\nForces a four-legged stance instead of two-legged; minor can stand upright for CON rounds, major needs an Agility roll each round upright.' },
    { name: 'Camouflage', category: 'Powers', source: 'Mutation', body: '**Roll** 10-12\n\nUnnatural coloration or texture; +20% to Hide (minor) or +40% and can actively change to match surroundings (major).' },
    { name: 'Coloration (Minor)', category: 'Powers', source: 'Mutation', body: '**Roll** 13-15\n\nStrikingly unnatural skin/scale/fur coloration — cosmetic only.' },
    { name: 'Congenital Disease (Adverse)', category: 'Powers', source: 'Mutation', body: '**Roll** 16-19\n\nAn incurable non-contagious ailment reduces one characteristic (minor) or two (major) by 1D6 points each.' },
    { name: 'Decreased Characteristic (Adverse)', category: 'Powers', source: 'Mutation', body: '**Roll** 20-22\n\nReduces a randomly determined characteristic by 1D6 (minor) or 2D6 (major), never below 1.' },
    { name: 'Disease Carrier (Adverse)', category: 'Powers', source: 'Mutation', body: '**Roll** 23-25\n\nCarries (but is immune to) a disease of POT 2D10 (minor) or 4D10/two diseases (major); exposed targets resist CON vs. POT or contract it.' },
    { name: 'Group Intelligence', category: 'Powers', source: 'Mutation', body: '**Roll** 26-29\n\nPart of a hive mind sharing sensation (minor, CON meters range) or full telepathic communication at unlimited range (major).' },
    { name: 'Hands', category: 'Powers', source: 'Mutation', body: '**Roll** 30\n\nExtra prehensile limb(s) — a tail, extra hands, or similar — usable as an additional limb in combat or tasks; may allow an extra action.' },
    { name: 'Hardy', category: 'Powers', source: 'Mutation', body: '**Roll** 31-33\n\nHalves damage from one chosen damage type (minor); major also lets the mutant keep acting below 0 HP down to a negative threshold.' },
    { name: 'Hybrid', category: 'Powers', source: 'Mutation', body: '**Roll** 34-35\n\nHas one animalistic trait (fur, tail, scales, etc.), cosmetic or minor mechanical benefit.' },
    { name: 'Imitation', category: 'Powers', source: 'Mutation', body: '**Roll** 36-37\n\nImitates an animal’s natural trait (a bird’s call, a chameleon’s color-change, etc.).' },
    { name: 'Increased Characteristic', category: 'Powers', source: 'Mutation', body: '**Roll** 38-44\n\nIncreases a randomly determined characteristic by 1D6 (minor) or 2D6 (major).' },
    { name: 'Keen Sense', category: 'Powers', source: 'Mutation', body: '**Roll** 45-48\n\nOne or more senses become extraordinarily sharp, granting a bonus to related perception skills.' },
    { name: 'Luminescence', category: 'Powers', source: 'Mutation', body: '**Roll** 49-50\n\nEmits light from the body, from a dim glow to enough to read by.' },
    { name: 'Metabolic Improvement', category: 'Powers', source: 'Mutation', body: '**Roll** 51-53\n\nAn unusual but beneficial metabolism — e.g. faster healing, reduced need for food/sleep.' },
    { name: 'Metabolic Weakness (Adverse)', category: 'Powers', source: 'Mutation', body: '**Roll** 54-57\n\nAn unusual, disadvantageous metabolism — e.g. must eat constantly, vulnerable to a common substance.' },
    { name: 'Natural Armor', category: 'Powers', source: 'Mutation', body: '**Roll** 58-60\n\nGrants natural armor (scales, horn, thick hide, etc.) — points of protection scaling with minor/major.' },
    { name: 'Natural Weaponry', category: 'Powers', source: 'Mutation', body: '**Roll** 61-65\n\nGrows a natural weapon (spine, claw, teeth, stinger) usable as a Brawl attack, dealing extra damage.' },
    { name: 'Pain Sensitivity (Adverse)', category: 'Powers', source: 'Mutation', body: '**Roll** 66-67\n\nUnusually low pain tolerance — actions become Difficult while injured (minor) or major wounds incapacitate automatically (major).' },
    { name: 'Pheromone', category: 'Powers', source: 'Mutation', body: '**Roll** 68\n\nEmits chemicals that affect the emotional state or behavior of others nearby.' },
    { name: 'Reduced Sense (Adverse)', category: 'Powers', source: 'Mutation', body: '**Roll** 69-70\n\nA primary sense is impaired (minor) or missing entirely (major).' },
    { name: 'Regeneration', category: 'Powers', source: 'Mutation', body: '**Roll** 71-72\n\nHeals lost hit points at an accelerated rate each combat round.' },
    { name: 'Sensitivity', category: 'Powers', source: 'Mutation', body: '**Roll** 73-74\n\nAn unusual physiological affinity — positive or negative — for a specific substance (blood, silver, sunlight, etc.).' },
    { name: 'Speech (Mimicry)', category: 'Powers', source: 'Mutation', body: '**Roll** 75-76\n\nCan imitate animal noises (minor) or speak clearly despite non-human anatomy (major).' },
    { name: 'Structural Improvement', category: 'Powers', source: 'Mutation', body: '**Roll** 77-81\n\nAn unusual, beneficial body structure — e.g. extra load-bearing limbs, an armored carapace.' },
    { name: 'Structural Weakness (Adverse)', category: 'Powers', source: 'Mutation', body: '**Roll** 82-86\n\nAn unusual, disadvantageous body structure — e.g. brittle bones, a vulnerable exposed organ.' },
    { name: 'Venom', category: 'Powers', source: 'Mutation', body: '**Roll** 87-89\n\nSecretes a natural poison delivered by bite, sting, or touch (see Poisons, p.151).' },
    { name: 'Wings', category: 'Powers', source: 'Mutation', body: '**Roll** 90\n\nGrows wings sufficient to glide (minor) or fly under its own power (major).' },

    /* ---- Psychic Abilities (p.71-77), 1+ power point/use, range usually a multiple of POW ---- */
    { name: 'Astral Projection', category: 'Powers', source: 'Psychic Ability', body: 'Leave the physical body and travel in psychic form.' },
    { name: 'Aura Detection', category: 'Powers', source: 'Psychic Ability', body: 'Perceive the aura emanated by a living being.' },
    { name: 'Clairvoyance', category: 'Powers', source: 'Psychic Ability', body: 'Project awareness into another place.' },
    { name: 'Cryokinesis', category: 'Powers', source: 'Psychic Ability', body: 'Create an area of intense cold on an area, object, or target.' },
    { name: 'Danger Sense', category: 'Powers', source: 'Psychic Ability', body: 'Detect danger from other characters or a situation before it manifests.' },
    { name: 'Dead Calm', category: 'Powers', source: 'Psychic Ability', body: 'Resist mental shock or delay the effects of sanity loss.' },
    { name: 'Divination', category: 'Powers', source: 'Psychic Ability', body: 'Ask a higher power for guidance and insight.' },
    { name: 'Eidetic Memory', category: 'Powers', source: 'Psychic Ability', body: 'Perfect and total recall of previous experiences.' },
    { name: 'Emotion Control', category: 'Powers', source: 'Psychic Ability', body: 'Affect the emotional state of a target or targets.' },
    { name: 'Empathy', category: 'Powers', source: 'Psychic Ability', body: 'Detect the inner feelings of a target or targets.' },
    { name: 'Intuition', category: 'Powers', source: 'Psychic Ability', body: 'Detect a certain person or class of item.' },
    { name: 'Levitation', category: 'Powers', source: 'Psychic Ability', body: 'Floating movement above the ground.' },
    { name: 'Mind Blast', category: 'Powers', source: 'Psychic Ability', body: 'A direct psychic attack against a target (power point vs. power point or POW vs. POW).' },
    { name: 'Mind Control', category: 'Powers', source: 'Psychic Ability', body: 'Control the physical body and will of a target (POW vs. POW resistance roll).' },
    { name: 'Mind Shield', category: 'Powers', source: 'Psychic Ability', body: 'Protection against psychic interference and attacks; each point spent resists power points used against the psychic.' },
    { name: 'Precognition', category: 'Powers', source: 'Psychic Ability', body: 'A brief, intuitive glimpse into the future — more power points spent reaches further ahead.' },
    { name: 'Psychometry', category: 'Powers', source: 'Psychic Ability', body: '‘Read’ past emotions and events associated with an object or place by touch.' },
    { name: 'Pyrokinesis', category: 'Powers', source: 'Psychic Ability', body: 'Heat an area, object, or target to extreme temperatures; 1D6 damage per 3 power points spent.' },
    { name: 'Sensitivity (Psychic Ability)', category: 'Powers', source: 'Psychic Ability', body: 'Detect supernatural or spiritual emanations, or the recent use of psychic abilities, in an area.' },
    { name: 'Telekinesis', category: 'Powers', source: 'Psychic Ability', body: 'Manipulate and move objects mentally at a distance.' },
    { name: 'Telepathy', category: 'Powers', source: 'Psychic Ability', body: 'Read minds, or speak mind-to-mind with a target.' },

    /* ---- Sorcery Spells (p.78-89), 1 power point/level, duration usually POW in combat rounds ---- */
    { name: 'Cloak of Night', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4 · **Range** Touch/Sight\n\nAugmentation. Adds +20% per level to Hide, cumulative for the duration.' },
    { name: 'Leap (Sorcery)', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4\n\nAugmentation. Adds +20% per level to Jump.' },
    { name: 'Sureness', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4\n\nAugmentation. Adds +20% per level to Stealth.' },
    { name: 'Bolster the Soul', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-3\n\nCharacteristic. Adds 3 points per level to POW for the duration.' },
    { name: 'Inhuman Plasticity', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-3\n\nCharacteristic. Adds 3 points per level to SIZ for the duration.' },
    { name: 'Lightning Speed', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-3\n\nCharacteristic. Adds 1 point per level to MOV for the duration.' },
    { name: 'Relentless Vitality', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-3\n\nCharacteristic. Adds 3 points per level to CON for the duration.' },
    { name: 'Suppleness of the Serpent', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-3\n\nCharacteristic. Adds 3 points per level to DEX for the duration.' },
    { name: 'Titan’s Strength', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-3\n\nCharacteristic. Adds 3 points per level to STR for the duration.' },
    { name: 'Unearthly Beauty', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-3\n\nCharacteristic. Adds 3 points per level to CHA for the duration.' },
    { name: 'Wisdom of the Sage', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-3\n\nCharacteristic. Adds 3 points per level to INT for the duration.' },
    { name: 'Hammer of the Gods', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4\n\nCombat. Adds 1 point of damage per level to blunt weapons.' },
    { name: 'Hell’s Razor', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4\n\nCombat. Adds 1 point of damage per level to cutting weapons.' },
    { name: 'Sorcery’s Sharp Flame', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4\n\nCombat. Adds 1 point of damage per level to impaling weapons.' },
    { name: 'Sorcerous Armor', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4\n\nCombat. Adds 1 point of armor per level.' },
    { name: 'Talons of the Beast', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4\n\nCombat. Adds 1 point of damage per level to unarmed/Brawl attacks.' },
    { name: 'Unbreakable Bulwark', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4\n\nCombat. Adds 1 point of armor per level to shields.' },
    { name: 'Make Fast', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nEnhancement. Glues together two inanimate objects.' },
    { name: 'Make Whole', category: 'Powers', source: 'Sorcery', body: '**Level** 3\n\nEnhancement. Repairs a broken item.' },
    { name: 'Midnight', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nEnhancement. Creates an area of darkness.' },
    { name: 'Moonrise', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nEnhancement. Creates a floating globe of light.' },
    { name: 'Bounty of the Sea', category: 'Powers', source: 'Sorcery', body: '**Level** 4\n\nElemental. Fills an area with water.' },
    { name: 'Fires of the Sun', category: 'Powers', source: 'Sorcery', body: '**Level** 4 · **Range** Sight\n\nElemental. A floating, fueless mass of fire hangs in view, about 3m across, igniting adjacent materials for 1D6+2 fire damage/round. Must be known before fire elementals can be summoned. Negated by Wings of the Sky; dispelled by a 4-point Undo Sorcery.' },
    { name: 'Gift of the Earth', category: 'Powers', source: 'Sorcery', body: '**Level** 4\n\nElemental. Fills an area with dirt.' },
    { name: 'Wings of the Sky', category: 'Powers', source: 'Sorcery', body: '**Level** 4\n\nElemental. Fills an area with wind.' },
    { name: 'Curse of Sorcery', category: 'Powers', source: 'Sorcery', body: '**Level** 4 · **Range** Touch\n\nManipulative. On a successful POW vs. POW roll, disfigures part of the target’s body with a gruesome/demonic quality (cosmetic; a second success gives it a monstrous shape). May cost 1D3 CHA if visible. Lasts until the caster dies; can’t be recast on the same target while active.' },
    { name: 'Fury', category: 'Powers', source: 'Sorcery', body: '**Level** 1 · **Range** Touch\n\nManipulative. Induces a berserk rage (power point vs. power point if unwilling): the target fights unceasingly for the duration and gets one extra attack per round.' },
    { name: 'Inescapable Bonds', category: 'Powers', source: 'Sorcery', body: '**Level** 3\n\nManipulative. Immobilizes the target; resistance roll to resist.' },
    { name: 'Liken Shape', category: 'Powers', source: 'Sorcery', body: '**Level** 4\n\nManipulative. Assume the image/appearance of another person.' },
    { name: 'Muddle', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nManipulative. Disorients the target.' },
    { name: 'Pox', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nManipulative. Reduces the target’s power points; resistance roll to resist.' },
    { name: 'Brazier of Power', category: 'Powers', source: 'Sorcery', body: '**Level** 4\n\nOccult. Creates a reservoir of power points other sorcerers can draw from.' },
    { name: 'Chain of Being', category: 'Powers', source: 'Sorcery', body: '**Level** 4\n\nOccult. Creates a shared pool of power points.' },
    { name: 'Undo Sorcery', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4\n\nOccult. Cancels various sorcery spells of equal or lower level (unless protected by Refutation).' },
    { name: 'Ward (Sorcery)', category: 'Powers', source: 'Sorcery', body: '**Level** 3\n\nOccult. Creates a magical alarm over an area.' },
    { name: 'Summon Demon', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nSummoning. Summons a demon (see Chapter 11: Creatures).' },
    { name: 'Summon Elemental', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nSummoning. Summons an elemental (see Chapter 11: Creatures) — requires the matching elemental spell already known.' },
    { name: 'Bird’s Vision', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nUtility. Controls a bird and sees through its eyes.' },
    { name: 'Breath of Life', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nUtility. Provides breathable air underwater or in another hostile environment.' },
    { name: 'Farsight', category: 'Powers', source: 'Sorcery', body: '**Level** 1 · **Range** Sight\n\nUtility. Doubles the closeness of anything seen; repeated castings while active cumulatively double it further.' },
    { name: 'Heal (Sorcery)', category: 'Powers', source: 'Sorcery', body: '**Level** 2\n\nUtility. Restores lost hit points.' },
    { name: 'Keen Ear', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nUtility. Carries spoken words across great distances.' },
    { name: 'Refutation', category: 'Powers', source: 'Sorcery', body: '**Levels** 1-4\n\nUtility. Protects a spell against being cancelled by Undo Sorcery.' },
    { name: 'Vermin’s Vision', category: 'Powers', source: 'Sorcery', body: '**Level** 1\n\nUtility. Controls vermin and sees through their eyes.' },
    { name: 'Witch Sight', category: 'Powers', source: 'Sorcery', body: '**Level** 3\n\nUtility. Determines a target’s POW.' },

    /* ---- Superpowers (p.90-108) ---- */
    { name: 'Absorption', category: 'Powers', source: 'Superpower', body: 'Absorb energy of a chosen type from an attack and turn it into power points; armor reduces the damage before Absorption applies.' },
    { name: 'Adaptation', category: 'Powers', source: 'Superpower', body: 'Each level allows comfortable survival in one hostile environment (cold, heat, vacuum, high pressure, radiation, etc.).' },
    { name: 'Alternate Form', category: 'Powers', source: 'Superpower', body: 'Each level is an alternate body the character can switch into.' },
    { name: 'Armor (Superpower)', category: 'Powers', source: 'Superpower', body: 'Each level provides 1 point of protection against a specific chosen energy type.' },
    { name: 'Barrier', category: 'Powers', source: 'Superpower', body: 'Each level creates a 1-meter-square section of protective wall.' },
    { name: 'Defense', category: 'Powers', source: 'Superpower', body: 'Lowers the character’s chance to be hit by −1% per level.' },
    { name: 'Density Control', category: 'Powers', source: 'Superpower', body: 'Each level adds or subtracts 1 point of density (SIZ), without changing mass/volume proportionally.' },
    { name: 'Diminish/Enhance Characteristic', category: 'Powers', source: 'Superpower', body: 'Lowers or increases a target characteristic by 1D6 per level.' },
    { name: 'Drain', category: 'Powers', source: 'Superpower', body: 'Each level drains 1 hit point, power point, fatigue point, or sanity point from a target, usually transferred to the user.' },
    { name: 'Energy Control', category: 'Powers', source: 'Superpower', body: 'Allows creation of and control over a specific type of energy (fire, cold, electricity, etc.), aside from direct damage.' },
    { name: 'Energy Projection', category: 'Powers', source: 'Superpower', body: 'Allows projection of a focused, damaging beam of a specific energy type.' },
    { name: 'Extra Energy', category: 'Powers', source: 'Superpower', body: 'Each level provides +10 additional power points.' },
    { name: 'Extra Hit Points', category: 'Powers', source: 'Superpower', body: 'Each level provides +1 additional hit point.' },
    { name: 'Flight', category: 'Powers', source: 'Superpower', body: 'Each level allows self-powered flight for 1 SIZ point of the character.' },
    { name: 'Force Field', category: 'Powers', source: 'Superpower', body: 'Each level offers 1 point of protection against a specific type of energy, as an external field rather than worn armor.' },
    { name: 'Intangibility', category: 'Powers', source: 'Superpower', body: 'Allows the character to move through solid objects.' },
    { name: 'Invisibility (Superpower)', category: 'Powers', source: 'Superpower', body: 'Each level turns 1 SIZ point of the character (or another target) invisible.' },
    { name: 'Leap', category: 'Powers', source: 'Superpower', body: 'Adds to the character’s normal jumping distance, horizontally and vertically.' },
    { name: 'Protection (Superpower)', category: 'Powers', source: 'Superpower', body: 'Each level reduces the effective level/potency of an attacking energy type.' },
    { name: 'Regeneration (Superpower)', category: 'Powers', source: 'Superpower', body: 'Each level returns 1 lost hit point per combat round.' },
    { name: 'Resistance (Superpower)', category: 'Powers', source: 'Superpower', body: 'Each level resists 1 point of damage from a single specific energy type.' },
    { name: 'Sidekick', category: 'Powers', source: 'Superpower', body: 'A loyal associated nonplayer character who accompanies and assists the hero.' },
    { name: 'Size Change', category: 'Powers', source: 'Superpower', body: 'Each level adds or subtracts 1 point of SIZ, proportionally affecting mass and reach.' },
    { name: 'Snare Projection', category: 'Powers', source: 'Superpower', body: 'Each level is 1 STR and/or SIZ of a projected net, web, rope, or other confining snare.' },
    { name: 'Stretching', category: 'Powers', source: 'Superpower', body: 'Stretch the body into different sizes and shapes, extending reach or squeezing through gaps.' },
    { name: 'Super Characteristic', category: 'Powers', source: 'Superpower', body: 'Extra points in STR, CON, SIZ, INT, POW, DEX, CHA, or EDU, purchased per point.' },
    { name: 'Super Movement', category: 'Powers', source: 'Superpower', body: 'Each type grants a unique method of movement (wall-crawling, water-walking, burrowing, etc.).' },
    { name: 'Super Sense', category: 'Powers', source: 'Superpower', body: 'Each type improves an existing sense or adds an extraordinary aspect to it (dark vision, infrared vision, super hearing, etc.).' },
    { name: 'Super Skill', category: 'Powers', source: 'Superpower', body: 'Each level adds +20% to one specific skill.' },
    { name: 'Super Speed', category: 'Powers', source: 'Superpower', body: 'Each level adds an additional action or movement each combat round.' },
    { name: 'Teleport (Superpower)', category: 'Powers', source: 'Superpower', body: 'Each level allows instantaneous teleportation of 1 SIZ point of an object or target (including the user).' },
    { name: 'Transfer', category: 'Powers', source: 'Superpower', body: 'Each level allows transfer of 1 hit point, power point, fatigue point, or sanity point to a target.' },
    { name: 'Unarmed Combat', category: 'Powers', source: 'Superpower', body: 'Increases ability in unarmed combat — bonus damage, a skill bonus, and/or a chance to reduce an opponent’s hit chance.' },
    { name: 'Weather Control', category: 'Powers', source: 'Superpower', body: 'Alters or creates weather conditions in an area.' }
  ];

  function w(name, skill, dmg, atk, special, rng, hands, hp, parry, req, cost, enc, extra) {
    var body = '**Skill** ' + skill + ' · **Damage** ' + dmg +
      (atk ? ' · **Attacks/round** ' + atk : '') +
      (special ? ' · **Special** ' + special : '') +
      (rng ? ' · **Range** ' + rng : '') +
      (hands ? ' · **Hands** ' + hands : '') +
      (hp ? ' · **HP** ' + hp : '') +
      (parry != null ? ' · **Parry** ' + (parry ? 'Yes' : 'No') : '') +
      (req ? ' · **STR/DEX req** ' + req : '') +
      (cost ? ' · **Cost** ' + cost : '') +
      (enc ? ' · **Enc** ' + enc : '') +
      (extra ? '\n\n' + extra : '');
    return { name: name, category: 'Items', source: '', body: body };
  }

  var PRIMITIVE_MELEE = [
    w('Axe, Hand Axe', 'Axe', '1D6+1+dm', 1, 'Bleeding', 'Short', '1H', 12, true, '7/9', 'Cheap', 0.5),
    w('Club, Heavy Club', 'Club', '1D8+dm', 1, 'Crushing', 'Medium', '2H', 22, true, '9/7', 'Cheap', 2.0),
    w('Club, Light Club', 'Club', '1D6+dm', 1, 'Crushing', 'Medium', '1H', 15, true, '7/7', 'Cheap', 1.0),
    w('Fist', 'Brawl', '1D3+dm', 1, 'Crushing', 'Short', '1H', null, false, null, null, null),
    w('Grapple', 'Brawl', 'Special', 1, 'Entangle', 'Short', '2H', null, false, null, null, null),
    w('Head Butt', 'Brawl', '1D3+dm', 1, 'Crushing', 'Short', null, null, false, null, null, null),
    w('Kick', 'Brawl', '1D3+dm', 1, 'Crushing', 'Short', null, null, false, null, null, null),
    w('Knife (Primitive)', 'Dagger', '1D3+1+dm', 1, 'Impaling', 'Short', '1H', 15, true, '4/4', 'Cheap', 0.2),
    w('Net', 'Other', 'Special', 1, 'Entangling', 'Medium', '1H or 2H', 6, true, '12/10', 'Cheap', 3.0),
    w('Spear, Long Spear', 'Spear', '1D10+1+dm', 1, 'Impaling', 'Long', '2H', 15, true, '11/9', 'Cheap', 2.0),
    w('Spear, Short Spear', 'Spear', '1D6+1+dm', 1, 'Impaling', 'Long', '1H or 2H', 15, true, '7/8', 'Cheap', 2.0),
    w('Torch (weapon)', 'Club', '1D6+flame', 1, 'Crushing', 'Medium', '1H', 15, true, '6/9', null, 1.0)
  ];
  var PRIMITIVE_MISSILE = [
    w('Axe, Hand (thrown)', 'Axe', '1D6+½dm', 1, 'Bleeding', '20m', '1H', 12, false, '9/11', 'Cheap', 0.5),
    w('Blowgun', 'Blowgun', '1D3', 1, 'Impaling', '30m', '2H', 4, false, '—/11', 'Cheap', 0.5, 'Darts are often poisoned.'),
    w('Bola (damaging)', 'Bola', '1D4+½dm', 1, 'Crushing', '15m', '1H', 1, false, '9/13', 'Cheap', 3.0),
    w('Bola (snaring)', 'Bola', 'Special', 1, 'Entangling', '15m', '1H', 1, false, '9/13', 'Cheap', 3.0),
    w('Boomerang', 'Boomerang', '1D4+½dm', 0.5, 'Crushing', '50m', '1H', 3, false, '9/11', 'Cheap', 0.5),
    w('Bow, Self', 'Bow', '1D6+1+½dm', 1, 'Impaling', '80m', '2H', 6, false, '9/9', 'Cheap', 0.5),
    w('Club, Light (thrown)', 'Throw', '1D6+½dm', 1, 'Crushing', '20m', '1H', 15, false, '9/7', 'Cheap', 1.0),
    w('Dart', 'Dart', '1D6+½dm', 1, 'Impaling', '20m', '1H', 4, false, '—/9', 'Cheap', 0.5, 'Often poisoned.'),
    w('Javelin', 'Javelin', '1D6+½dm', 1, 'Impaling', '25m', '1H', 10, false, '9/9', 'Cheap', 1.5),
    w('Knife (thrown)', 'Throw', '1D3+½dm', 1, 'Impaling', '10m', '1H', 15, false, '7/11', 'Cheap', 0.2),
    w('Lasso', 'Other', 'Special', 0.5, 'Entangling', '10m', '2H', 1, false, '9/13', 'Cheap', 1.0),
    w('Net (thrown)', 'Other', 'Special', 1, 'Entangling', '5m', '1H', 6, false, '9/12', 'Cheap', 3.0),
    w('Rock (thrown)', 'Throw', '1D2+½dm', 2, 'Crushing', '20m', '1H', 20, false, '5/5', null, 0.05),
    w('Sling', 'Sling', '1D8+½dm', 1, 'Crushing', '80m', '1H', 2, false, '7/11', 'Cheap', 0.1),
    w('Spear, Short (thrown)', 'Spear', '1D6+1+½dm', 1, 'Impaling', '15m', '1H', 15, false, '12/10', 'Cheap', 2.0),
    w('Spear, Long (thrown)', 'Spear', '1D10+1+½dm', 1, 'Impaling', '15m', '1H', 15, false, '12/10', 'Cheap', 2.0)
  ];
  var HISTORIC_MELEE = [
    w('Axe, Battle Axe', 'Axe', '1D8+2+dm', 1, 'Bleeding', 'Medium', '1H', 15, true, '9/9', 'Average', 1.0),
    w('Axe, Great Axe', 'Axe', '2D6+2+dm', 1, 'Bleeding', 'Medium', '2H', 15, true, '11/9', 'Average', 2.0),
    w('Axe, Wood Axe', 'Axe', '1D8+2+dm', 1, 'Bleeding', 'Medium', '2H', 20, true, '8/7', 'Inexpensive', 1.5),
    w('Blackjack', 'Hand', '1D8+dm', 1, 'Crushing', 'Short', '1H', 10, false, '7/7', 'Inexpensive', 0.2),
    w('Cestus', 'Hand', '1D3+2+dm', 1, 'Crushing', 'Short', '1H', 10, true, '11/7', 'Average', 0.1),
    w('Claw (weapon)', 'Hand', '1D4+1+dm', 1, 'Bleeding', 'Short', '1H', 10, true, '9/9', 'Average', 0.1),
    w('Dagger', 'Dagger', '1D4+2+dm', 1, 'Impaling', 'Short', '1H', 15, true, '4/4', 'Average', 0.5),
    w('Flail', 'Flail', '1D6+dm', 1, 'Crushing', 'Medium', '1H', 7, true, '7/6', 'Average', 2.0),
    w('Flail, Morningstar', 'Flail', '1D10+1+dm', 1, 'Crushing', 'Medium', '2H', 12, true, '11/7', 'Average', 2.0),
    w('Garrote', 'Hand', 'Special', 1, null, 'Short', '2H', 1, false, '8/12', 'Inexpensive', 0.1, 'See Choking, Drowning, and Asphyxiation.'),
    w('Gauntlet, Armored', 'Hand', '1D3+1+dm', 1, 'Crushing', 'Short', '1H', 7, true, '7/5', 'Average', null),
    w('Halberd', 'Polearm', '3D6+dm', 1, 'Bleeding', 'Long', '2H', 25, true, '13/9', 'Average', 3.0),
    w('Hammer', 'Hammer', '1D6+dm', 1, 'Crushing', 'Medium', '1H', 15, true, '9/7', 'Inexpensive', 1.5),
    w('Hammer, Great', 'Hammer', '1D10+3+dm', 1, 'Crushing', 'Long', '2H', 15, true, '9/9', 'Average', 2.5),
    w('Hammer, Sledge', 'Hammer', '2D6+2+dm', 1, 'Crushing', 'Medium', '2H', 15, true, '11/7', 'Inexpensive', 2.0),
    w('Hammer, War', 'Hammer', '1D6+2+dm', 1, 'Crushing', 'Medium', '1H', 20, true, '11/9', 'Average', 2.0),
    w('Katana', 'Sword', '1D10+1+dm', 1, 'Bleeding', 'Medium', '1H or 2H', 15, true, '11/11', 'Expensive', 1.5, 'Used one-handed, damage modifier is halved.'),
    w('Knife (Historic)', 'Dagger', '1D3+1+dm', 1, 'Impaling', 'Short', '1H', 15, true, '4/4', 'Inexpensive', 0.5),
    w('Lance', 'Spear', '1D8+1+dm', 1, 'Impaling', 'Long', '1H', 15, true, '9/8', 'Inexpensive', 3.5, 'Mounted, uses the mount’s damage modifier instead of the rider’s.'),
    w('Mace, Heavy', 'Mace', '1D8+2+dm', 1, 'Crushing', 'Medium', '2H', 20, true, '14/9', 'Average', 2.5),
    w('Mace, Light', 'Mace', '1D6+2+dm', 1, 'Crushing', 'Medium', '1H', 20, true, '7/7', 'Average', 1.0),
    w('Maul, War', 'Hammer', '1D10+2+dm', 1, 'Crushing', 'Medium', '2H', 20, true, '13/7', 'Average', 2.5),
    w('Naginata', 'Polearm', '2D6+2+dm', 1, 'Bleeding', 'Long', '2H', 15, true, '7/11', 'Expensive', 2.0),
    w('Pike', 'Polearm', '1D10+2+dm', 1, 'Impaling', 'Long', '2H', 15, true, '11/7', 'Inexpensive', 3.5),
    w('Rapier', 'Sword', '1D6+1+dm', 1, 'Impaling', 'Medium', '1H', 15, true, '7/13', 'Expensive', 1.0),
    w('Saber', 'Sword', '1D8+1+dm', 1, 'Bleeding', 'Medium', '1H', 20, true, '7/11', 'Average', 1.5),
    w('Sai', 'Dagger', '1D6+dm', 1, 'Crushing', 'Medium', '1H', 20, true, '5/11', 'Inexpensive', 1.0, 'Traditionally a blunt weapon used to parry and strike.'),
    w('Scimitar', 'Sword', '1D8+1+dm', 1, 'Bleeding', 'Medium', '1H', 19, true, '8/8', 'Average', 1.5),
    w('Scythe', 'Improvised', '2D6+1+dm', 1, 'Impaling', 'Long', '2H', 20, true, '12/10', 'Inexpensive', 2.5),
    w('Sickle', 'Improvised', '1D6+1+dm', 1, 'Impaling', 'Medium', '1H', 12, true, '7/9', 'Inexpensive', 0.5),
    w('Staff, Quarterstaff', 'Staff', '1D8+dm', 1, 'Crushing', 'All', '2H', 20, true, '9/9', 'Cheap', 1.5),
    w('Staff, Short', 'Staff', '1D6+dm', 1, 'Crushing', 'Medium', '1H', 15, true, '7/9', 'Cheap', 0.5),
    w('Sword Cane', 'Sword', '1D6+dm', 1, 'Impaling', 'Medium', '1H', 12, true, '7/11', 'Expensive', 1.0),
    w('Sword, Bastard Sword', 'Sword', '1D10+1+dm', 1, 'Bleeding', 'Medium', '1H or 2H', 20, true, '13 or 9/9', 'Average', 2.0, 'Used one-handed, damage modifier is halved (STR req 13 one-handed, 9 two-handed).'),
    w('Sword, Broad Sword', 'Sword', '1D8+1+dm', 1, 'Bleeding', 'Medium', '1H', 20, true, '9/7', 'Average', 1.5),
    w('Sword, Great Sword', 'Sword', '2D8+dm', 1, 'Bleeding', 'Medium/Long', '2H', 18, true, '14/13', 'Expensive', 3.5),
    w('Sword, Long Sword', 'Sword', '1D8+dm', 1, 'Bleeding', 'Medium', '1H', 15, true, '7/9', 'Average', 1.5),
    w('Sword, Short Sword', 'Sword', '1D6+1+dm', 1, 'Impaling', 'Medium', '1H', 20, true, '5/5', 'Cheap', 1.0),
    w('Trident', 'Polearm', '1D6+1+dm', 1, 'Impaling', 'Long', '1H or 2H', 18, true, '9/7', 'Average', 2.0),
    w('Wakizashi', 'Sword', '1D6+1+dm', 1, 'Bleeding', 'Medium', '1H', 13, true, '7/9', 'Expensive', 1.0),
    w('Whip', 'Other', '1D3−1', 1, 'Entangle', 'Long', '1H', 4, false, '9/10', 'Cheap', 0.5)
  ];
  var MODERN_MELEE = [
    w('Brass Knuckles', 'Brawl', 'Brawl +2', 1, 'Crushing', 'Short', '1H', 18, false, '5/—', 'Cheap', 0.1),
    w('Chainsaw', 'Improvised', '2D8', 1, 'Bleeding', 'Medium', '2H', 20, false, '11/11', 'Average', 8.0),
    w('Knife, Butcher', 'Dagger', '1D6+dm', 1, 'Impaling', 'Short', '1H', 12, false, '5/7', 'Cheap', 0.3),
    w('Knife, Pocket', 'Dagger', '1D4+dm', 1, 'Impaling', 'Short', '1H', 9, false, '—/5', 'Cheap', 0.1),
    w('Knife, Switchblade', 'Dagger', '1D4+dm', 1, 'Impaling', 'Short', '1H', 7, false, '—/5', 'Cheap', 0.1),
    w('Taser, Contact', 'Other/Brawl', 'Special', 1, null, 'Short', '1H', 7, false, '5/7', 'Expensive', 0.3, 'Stuns the target — see Stunning, p.154.')
  ];
  var MODERN_MISSILE = [
    w('Flamethrower', 'Other', '2D6+fire', 1, null, '25m', '2H', 6, false, '10/8', 'Expensive', 8.0, 'A hit target catches fire, taking 1D6+2/round until extinguished.'),
    w('Gun, Machine', 'Machine Gun', '2D6+4', '1, 3, or burst', 'Impaling', '90m', '2H', 11, false, '9/5', 'Expensive', 3.0),
    w('Gun, Mini-', 'Machine Gun', '2D6+4', 3, 'Impaling', '400m', '2H', 14, false, '16/12', 'Expensive', 6.0),
    w('Gun, Submachine', 'Submachine Gun', '1D8', '2 or burst', 'Impaling', '40m', '1H or 2H', 8, false, '9/6', 'Expensive', 2.0),
    w('Pistol, Derringer', 'Pistol', '1D6', 1, 'Impaling', '3m', '1H', 5, false, '5/5', 'Average', 0.3),
    w('Pistol, Flintlock', 'Pistol', '1D6+1', 0.25, 'Impaling', '10m', '1H', 8, false, '7/5', 'Average', 1.0),
    w('Pistol, Heavy', 'Pistol', '1D10+2', 1, 'Impaling', '15m', '1H', 8, false, '11/7', 'Average', 1.5),
    w('Pistol, Light', 'Pistol', '1D6', 3, 'Impaling', '10m', '1H', 6, false, '5/5', 'Average', 0.7),
    w('Pistol, Medium', 'Pistol', '1D8', 2, 'Impaling', '20m', '1H', 8, false, '7/5', 'Average', 1.0),
    w('Revolver, Heavy', 'Revolver', '1D10+2', 1, 'Impaling', '20m', '1H', 14, false, '11/5', 'Average', 1.5),
    w('Revolver, Light', 'Revolver', '1D6', 2, 'Impaling', '15m', '1H', 10, false, '5/5', 'Average', 0.7),
    w('Revolver, Medium', 'Revolver', '1D8', 1, 'Impaling', '25m', '1H', 12, false, '7/5', 'Average', 1.0),
    w('Rifle, Assault', 'Rifle', '2D6+2', '2 or burst', 'Impaling', '90m', '2H', 12, false, '10/5', 'Expensive', 3.5),
    w('Rifle, Bolt-action', 'Rifle', '2D6+4', 0.5, 'Impaling', '110m', '2H', 12, false, '7/5', 'Average', 3.0),
    w('Rifle, Elephant', 'Rifle', '3D6+4', '1 or 2', 'Impaling', '100m', '2H', 12, false, '13/5', 'Average', 4.5),
    w('Rifle, Musket', 'Rifle', '1D10+4', 0.25, 'Impaling', '60m', '2H', 12, false, '9/5', 'Average', 3.5),
    w('Rifle, Sniper', 'Rifle', '2D10+4', 1, 'Impaling', '250m', '2H', 10, false, '12/7', 'Expensive', 4.0, 'Base chance halved without a bipod; range halved without a scope.'),
    w('Rifle, Sporting', 'Rifle', '2D6', 1, 'Impaling', '80m', '2H', 12, false, '7/5', 'Average', 3.0),
    w('Shotgun, Automatic', 'Shotgun', '4D6/2D6/1D6', '1 or 2', 'Impaling', '10/20/50m', '2H', 14, false, '11/5', 'Expensive', 4.0, 'Damage by range increment.'),
    w('Shotgun, Double-barreled', 'Shotgun', '4D6/2D6/1D6', '1 or 2', 'Impaling', '10/20/50m', '2H', 12, false, '9/5', 'Average', 3.5, 'Damage by range increment.'),
    w('Shotgun, Sawn-off', 'Shotgun', '4D6/1D6', '1 or 2', 'Impaling', '5/20m', '1H', 14, false, '9/5', 'Average', 2.0, 'Not effective beyond 20m.'),
    w('Shotgun, Sporting', 'Shotgun', '4D6/2D6/1D6', 1, 'Impaling', '10/20/50m', '2H', 10, false, '7/5', 'Average', 3.0, 'Damage by range increment.'),
    w('Spray, Chemical', 'Other', 'Special', 1, null, '2m', '1H', 2, false, '3/7', 'Average', 0.2, 'A low-POT contact poison.'),
    w('Taser, Dart', 'Other', 'Special', 0.5, null, 'DEX', '1H', 8, false, '3/7', 'Expensive', 0.5, 'Stuns the target — see Stunning, p.154.')
  ];
  var ADVANCED_MELEE = [
    w('Axe, Vibro-', 'Polearm', '2D8+4+dm', 1, 'Bleeding', 'Medium', '2H', 20, true, '11/5', 'Average', 3.0),
    w('Knife, Vibro-', 'Dagger', '2D4+2+dm', 1, 'Bleeding', 'Short', '1H', 16, true, '7/7', 'Average', 0.5),
    w('Lance, Stun', 'Staff', '1D6+dm+stun', 1, 'Knockback', 'Long', '2H', 18, true, '9/5', 'Average', 2.5, 'Roll damage vs. target CON; loser is stunned 1D3+1 rounds.'),
    w('Sword, Energy', 'Sword', '2D10+dm', 1, 'Impaling', 'Medium', '1H', 30, true, '11/15', 'Priceless', 1.0, 'Halves the target’s effective armor value (round up).'),
    w('Sword, Monofilament', 'Sword', '3D12', 1, 'Bleeding', 'Medium', '1H', 12, false, '5/15', 'Expensive', 0.5, 'Ignores half the target’s armor value (round up); fumbling risks hitting yourself.'),
    w('Sword, Vibro-', 'Sword', '2D6+3+dm', 1, 'Bleeding', 'Medium', '1H', 18, true, '9/7', 'Expensive', 1.5),
    w('Whip, Shock', 'Other', '1+½db+stun', 1, 'Entangle', 'Long', '1H', 10, false, '7/9', 'Average', 1.0, 'Roll damage vs. target CON; loser is stunned 1D3+1 rounds.')
  ];
  var ADVANCED_MISSILE = [
    w('Pistol, Blaster', 'Pistol, Energy', '1D8+2', 2, 'Impaling', '15m', '1H', 14, false, null, 'Average', 1.0),
    w('Pistol, Disintegrator', 'Pistol, Energy', '3D4+1', 1, null, '10m', '1H', 12, false, null, 'Expensive', 1.0),
    w('Pistol, Electromagnetic Pulse', 'Pistol, Energy', '2D6 vs. tech', 1, null, '15m', '1H', 12, false, null, 'Average', 1.0, 'Vs. robots/machines: resistance roll vs. CON stuns 1D3+1 rounds on a hit; damage exceeding HP knocks it ‘unconscious’ (restored with Repair).'),
    w('Pistol, Flechette', 'Pistol, Energy', '2D4', '1 or burst', 'Impaling', '15m', '1H', 14, false, null, 'Average', 0.8, 'Half damage vs. hardened armor.'),
    w('Pistol, Laser', 'Pistol, Energy', '1D8', 3, 'Impaling', '20m', '1H', 14, false, null, 'Average', 1.0),
    w('Pistol, Plasma', 'Pistol, Energy', '2D10+2', 1, 'Impaling', '30m', '1H', 18, false, null, 'Expensive', 1.2),
    w('Pistol, Shock', 'Pistol, Energy', '2D4', 1, 'Knockback', '15m', '1H', 12, false, null, 'Average', 1.0),
    w('Pistol, Stun', 'Pistol, Energy', '2D6 stun', 1, 'Knockback', '15m', '1H', 16, false, null, 'Average', 1.0),
    w('Rifle, Blaster', 'Rifle, Energy', '2D8+3', 2, 'Impaling', '60m', '2H', 20, false, null, 'Average', 1.0),
    w('Rifle, Disintegrator', 'Rifle, Energy', '3D6+2', 1, null, '30m', '2H', 18, false, null, 'Expensive', 2.0),
    w('Rifle, Electromagnetic Pulse', 'Rifle, Energy', '3D8 vs. tech', 1, null, '75m', '2H', 18, false, null, 'Average', 2.0, 'As Pistol, EMP but longer ranged.'),
    w('Rifle, Laser', 'Rifle, Energy', '2D8', 2, 'Impaling', '100m', '2H', 20, false, null, 'Average', 1.5),
    w('Rifle, Plasma', 'Rifle, Energy', '2D10+4', 1, 'Impaling', '70m', '2H', 18, false, null, 'Expensive', 2.0),
    w('Rifle, Shock', 'Rifle, Energy', '3D8', 1, 'Knockback', '50m', '2H', 18, false, null, 'Average', 1.5),
    w('Rifle, Sonic', 'Rifle, Energy', '1D3+2', 1, 'Knockback', '50m', '2H', 16, false, null, 'Average', 2.0, 'Damages a living target each round it hits; vs. an unliving target, resistance roll vs. CON/armor/HP.'),
    w('Rifle, Stun', 'Rifle, Energy', '2D8 stun', 1, 'Knockback', '50m', '2H', 22, false, null, 'Average', 1.5, 'Resistance roll vs. CON: success takes only minimum (2) damage; loss stuns 1D3+1 rounds.')
  ];

  var WEAPONS = [].concat(PRIMITIVE_MELEE, PRIMITIVE_MISSILE, HISTORIC_MELEE, MODERN_MELEE, MODERN_MISSILE, ADVANCED_MELEE, ADVANCED_MISSILE);
  WEAPONS.slice(0, PRIMITIVE_MELEE.length + PRIMITIVE_MISSILE.length).forEach(function (e) { e.source = 'Weapon (Primitive)'; });
  HISTORIC_MELEE.forEach(function (e) { e.source = 'Weapon (Historic)'; });
  MODERN_MELEE.concat(MODERN_MISSILE).forEach(function (e) { e.source = 'Weapon (Modern)'; });
  ADVANCED_MELEE.concat(ADVANCED_MISSILE).forEach(function (e) { e.source = 'Weapon (Advanced)'; });

  function a(name, av, randomAv, burden, enc, mod, fits, locations, cost) {
    return { name: name, category: 'Items', source: 'Armor',
      body: '**AV** ' + av + (randomAv ? ' (random ' + randomAv + ')' : '') +
        ' · **Burden** ' + burden + ' · **Enc** ' + enc +
        (mod ? ' · **Skill modifier** ' + mod : '') +
        (fits ? ' · **Fits SIZ** ' + fits : '') +
        ' · **Locations** ' + locations + ' · **Cost** ' + cost };
  }
  var ARMOR = [
    a('Helmet (Primitive)', '+1', '+1 point', 'Light', 0.5, '−5% to Perception skills', '±1', 'Head', 'Cheap'),
    a('Hide Armor', 1, '1D3−1', 'Light', 3.5, null, '±3', 'All', 'Cheap'),
    a('Chain', 7, '1D8−1', 'Moderate', 20.0, '−20% to Physical skills', '−2', 'All', 'Expensive'),
    a('Clothing, Heavy', 1, '1D2−1', 'None', 2.5, null, '±2', 'All', 'Cheap'),
    a('Helmet, Heavy (Ancient/Medieval)', '+2', '+2 points', 'Light', 2.5, '−50% to Perception skills', '±0', 'Head', 'Average'),
    a('Helmet, Light (Ancient/Medieval)', '+1', '+1 point', 'None', 1.5, '−15% to Perception skills', '±1', 'Head', 'Inexpensive'),
    a('Lamellar', 6, '1D8−1', 'Moderate', 18.0, '−15% to Physical skills', '±1', 'All but head', 'Expensive'),
    a('Leather, Soft', 1, '1D6−1', 'Light', 3.5, null, '±2', 'All', 'Inexpensive'),
    a('Leather, Hard', 2, '1D6', 'Moderate', 5.0, '−10% to Physical skills', '±1', 'All', 'Average'),
    a('Leather, Cuirbouilli', 3, '2D3', 'Light', 5.0, '−10% to Physical skills', '±0', 'All', 'Expensive'),
    a('Padded/Quilted', 1, '1D2−1', 'None', 3.0, null, '±2', 'All', 'Inexpensive'),
    a('Padded/Quilted, Heavy', 2, '1D3−1', 'Light', 4.0, '−5% to Physical skills', '±1', 'All', 'Inexpensive'),
    a('Plate, Full', 8, '1D10', 'Cumbersome', 25.0, '−25% to Physical skills', '−1', 'All but head', 'Expensive'),
    a('Plate, Half', 7, '1D8', 'Moderate', 18.0, '−20% to Physical skills', '−1', 'All but head', 'Expensive'),
    a('Ring Armor', 5, '1D6', 'Light', 10.0, '−10% to Physical skills', '±1', 'All but head', 'Average'),
    a('Scale Armor', 6, '2D4−1', 'Moderate', 20.0, '−15% to Physical skills', '±1', 'All but head', 'Average'),
    a('Ballistic Cloth', '3/5', '1D3/1D6−1', 'Light', 4.0, '−10% to Physical skills', '±1', 'Arms, Chest', 'Expensive'),
    a('Bulletproof Vest, Early', 4, '1D4', 'Moderate', 11.0, '−25% to Physical skills', '±1', 'Chest', 'Expensive'),
    a('Bulletproof Vest, Modern', '4/8', '1D4/1D8', 'Light', 8.0, '−5% to Physical skills', '±3', 'Chest', 'Expensive'),
    a('Flak Jacket', 4, '1D4', 'Moderate', 8.0, '−10% to Physical skills', '±2', 'Arms, Chest', 'Expensive'),
    a('Helmet, Heavy (Modern)', '+6', '+3 points', 'Light', 3.5, '−25% to Perception skills', '±1', 'Head', 'Average'),
    a('Helmet, Light (Modern)', '+3', '+2 points', 'None', 2.5, '−10% to Perception skills', '±2', 'Head', 'Inexpensive'),
    a('Riot Gear', '12/6', '1D10+2', 'Moderate', 12.0, '−10% to Physical skills', '±1', 'All (includes helmet)', 'Expensive'),
    a('Adaptive Mesh', 6, '1D4+2', 'Light', 2.0, '−5% to Physical skills', '±1', 'All', 'Expensive'),
    a('Assault Armor, Light', 8, '2D6', 'Moderate', 12.0, '−10% to Physical skills', '±1', 'All (includes helmet)', 'Expensive'),
    a('Assault Armor', 10, '2D4+2', 'Moderate', 16.0, '−25% to Physical skills', '±1', 'All (includes helmet)', 'Expensive'),
    a('Energy Armor', '1-20', null, 'Light', 4.0, '−5% to Hide/Stealth/Perception per AV', 'Any', 'All (worn alone)', 'Expensive'),
    a('Helmet, Heavy (Advanced)', '+4', '+4', 'Light', 5.0, '−15% to Perception skills', '±1', 'Head', 'Average'),
    a('Helmet, Light (Advanced)', '+3', '+2', 'None', 2.0, '−5% to Perception skills', '±2', 'Head', 'Average'),
    a('Powered Assault Armor, Light', 14, '2D6+2', 'Cumbersome', 36.0, '−20% to Physical/Manipulation skills; +3 STR, −3 DEX', '±1', 'All', 'Priceless'),
    a('Powered Assault Armor, Heavy', 16, '4D4', 'Cumbersome', 48.0, '−50% to Physical/Manipulation skills; +6 STR, −6 DEX', '±1', 'All', 'Priceless')
  ];

  function s(name, base, avhp, dmg, atk, special, burden, locations, req, enc, cost) {
    return { name: name, category: 'Items', source: 'Shield',
      body: '**Base chance** ' + base + ' · **AV/HP** ' + avhp + ' · **Damage** ' + dmg +
        ' · **Attacks/round** ' + atk + (special ? ' · **Special** ' + special : '') +
        ' · **Burden** ' + burden + ' · **Locations** ' + locations +
        (req ? ' · **STR/DEX** ' + req : '') + ' · **Enc** ' + enc + ' · **Cost** ' + cost };
  }
  var SHIELDS = [
    s('Shield, Primitive', '10%', 10, '1D2+dm', 1, 'Knockback', 'Light', 'Arm', '5/7', 2.0, 'Cheap'),
    s('Shield, Buckler', '05%', 15, '1D2+dm', 1, 'Knockback', 'Light', 'Arm', '5/7', 1.0, 'Average'),
    s('Shield, Full', '15%', 22, '1D4+dm', 1, 'Knockback', 'Moderate', 'Arm, Chest, Head', '11/9', 5.0, 'Average'),
    s('Shield, Half', '15%', 15, '1D2+dm', 1, 'Knockback', 'Moderate', 'Arm, Chest', '5/7', 3.0, 'Average'),
    s('Shield, Heater', '15%', 20, '1D3+dm', 1, 'Knockback', 'Moderate', 'Arm, Chest', '9/9', 3.0, 'Average'),
    s('Shield, Hoplite', '15%', 26, '1D4+dm', 1, 'Knockback', 'Cumbersome', 'Abdomen, Arm, Chest', '12/8', 7.0, 'Average'),
    s('Shield, Kite', '15%', 22, '1D4+dm', 1, 'Knockback', 'Moderate', 'Abdomen, Arm, Chest', '11/9', 5.0, 'Average'),
    s('Shield, Large Round', '15%', 22, '1D4+dm', 1, 'Knockback', 'Moderate', 'Abdomen, Arm, Chest', '11/9', 5.0, 'Average'),
    s('Shield, Round', '15%', 20, '1D3+dm', 1, 'Knockback', 'Moderate', 'Arm, Chest', '9/9', 4.0, 'Average'),
    s('Shield, Spiked', '15%', 20, '1D3+dm', 1, 'Impale', 'Moderate', 'Arm, Chest', '9/9', 5.0, 'Average'),
    s('Shield, Target', '15%', 15, '1D2+dm', 1, 'Knockback', 'Light', 'Arm, Chest', '5/7', 3.0, 'Cheap'),
    s('Shield, Riot', '15%', 16, '1D3+dm', 1, 'Knockback', 'Moderate', 'Abdomen, Arm, Chest, Head', '9/9', 3.0, 'Expensive'),
    s('Shield, Energy', '20%', 25, '1D2+dm', 1, 'Knockback', 'Light', 'Arm, Chest', '3/3', 1.0, 'Expensive')
  ];

  var GEAR = [
    { name: 'Herbalist or Midwife’s Kit', category: 'Items', source: 'Medical Gear', body: 'Bandages, poultices, thread and needle, and herbal remedies of varying efficacy; used with the Knowledge (Herbalism) skill. Usually cheap.' },
    { name: 'First Aid Kit', category: 'Items', source: 'Medical Gear', body: 'Sterile bandages, minor ointments, eyewash, poison treatment, and small tools. Used with the First Aid skill. Usually cheap.' },
    { name: 'Doctor’s Bag', category: 'Items', source: 'Medical Gear', body: 'Pills, antibiotics, a stethoscope, and diagnostic/emergency-treatment tools. Used with First Aid, or Medicine for procedures. Expensive.' },
    { name: 'Surgery Kit', category: 'Items', source: 'Medical Gear', body: 'Sterile surgical tools, gloves, dressings, antiseptics, sutures — essential for the Medicine skill’s surgery use. Expensive.' },
    { name: 'Trauma Kit', category: 'Items', source: 'Medical Gear', body: 'Battlefield-oriented supplies: adrenalin shots, antitoxins, wound-packing gear, a portable defibrillator, limited surgical tools. Expensive.' },
    { name: 'Medi-kit', category: 'Items', source: 'Medical Gear', body: 'Advanced dermal regenerators, hypo-sprays, clotting agents, and a simple medical scanner. Makes First Aid attempts Easy and doubles hit points healed. Expensive.' },
    { name: 'Auto-doc', category: 'Items', source: 'Medical Gear', body: 'A fully automated medical treatment system with 100% Medicine and First Aid, doubling hit points restored and halving recovery time. Expensive to Priceless.' },
    { name: 'Chemistry Set', category: 'Items', source: 'Other Gear', body: 'Small quantities of chemicals, a microscope, and mixing/storage tools for basic Science (Chemistry) tasks. Cheap.' },
    { name: 'Computer', category: 'Items', source: 'Other Gear', body: 'Aids Appraise, Art, Gaming, Knowledge, Science, Teach, and especially Research: up to +20% if suitable for the skill, none for an average setup, up to −20% for an inferior one.' },
    { name: 'Criminology Kit', category: 'Items', source: 'Other Gear', body: 'Fingerprint and trace-evidence tools: collection bags, magnifying glasses, chemicals, black-light and normal flashlights. Expensive.' },
    { name: 'Disguise Kit', category: 'Items', source: 'Other Gear', body: 'Skin dyes, makeup, wigs, false teeth/hair, and styling tools to change appearance. Cheap to Average commercially, Expensive if high-quality.' },
    { name: 'Lockpicks', category: 'Items', source: 'Other Gear', body: 'From a few single picks to a sophisticated set with stethoscope and drills for opening locks. Cheap to Expensive.' },
    { name: 'Suppressor / Silencer', category: 'Items', source: 'Other Gear', body: 'Muffles a firearm’s report but halves its base range; wears out after 1D100+10 shots. Cannot fit a shotgun or heavy machine gun. Expensive and often Restricted.' },
    { name: 'Telescopic Scope / Laser Sight', category: 'Items', source: 'Other Gear', body: 'A scope doubles a firearm’s base range; a laser sight quadruples it. Especially effective with Aimed Attacks. Average value (precision scopes may be Expensive).' }
  ];

  var EQUIPMENT = [].concat(WEAPONS, ARMOR, SHIELDS, GEAR);

  var DATA = [].concat(POWERS, EQUIPMENT);

  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  root.BRP_COMPENDIUM_SEED = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
