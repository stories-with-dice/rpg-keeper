/* js/sl-compendium-seed.js — hand-authored default Compendium content for
 * the Silent Legions system (Sine Nomine): the Spells of the Gray Path and
 * Occult Disciplines from the Sorcery chapter (p.34-51), short rules
 * references for casting, disciplines, the Slaughter die, and vehicles,
 * and the Equipment tables (weapons, armor, gear, vehicles, p.17-19).
 *
 * Loaded by index.html as a <script> (works from file://); read by
 * js/sl-seed.js's seedSlCompendium(), which tags every entry `system: 'sl'`
 * and keeps each entry's own `category`/`source` (same as js/brp-seed.js).
 *
 * Each entry is { name, category: 'Spells'|'Powers'|'Rules'|'Items', source,
 * body }. `source` doubles as the Compendium's per-system Source filter:
 * 'Spell Level 1'…'Spell Level 5', 'Discipline', 'Sorcery'/'Combat'
 * (rules), 'Weapon (Melee|Ranged|Firearm|Heavy)', 'Armor',
 * 'Gear', 'Vehicle'. Bodies are short paraphrases of the rules, not the
 * book's text. Dice stay in plain notation (1d6, 2d6+2) so js/annotate.js
 * auto-links them as rolls.
 */
(function (root) {
  function spell(level, name, body) {
    return { name: name, category: 'Spells', source: 'Spell Level ' + level,
      body: '**Level** ' + level + ' · **Cost** 1 Expertise or ' + level + ' Madness — see [Casting Spells]\n\n' + body };
  }

  var SPELLS = [
    /* ---- Level 1 ---- */
    spell(1, 'Bending the Heart of the King', 'Uses up an arcane connection to make a human target feel real friendship toward a subject the caster picks. It lasts until the subject offends the target, and it can’t override real hatred.'),
    spell(1, 'The Circle of Inward Eyes', 'Detects whether an item or a place is enchanted. On Wis/Occult vs 7 the caster also learns whether a human placed the magic; vs 8, its rough power; vs 10, a three-word hint of what it does.'),
    spell(1, 'Distant Seal of Alarm', 'Draws a hidden eye on a surface. When anything bigger than a cat comes within 10 m, the caster sees through it for a round, or up to 5 minutes per Occult level, and can’t act meanwhile. Works once.'),
    spell(1, 'The Red Expurgation of the Sword', 'Heals one subject per 10 minutes of chanting. Gentle form: 1d6+1 HP per subject level after a night’s rest, for 2 Madness. Harsh form: 2d6+2 HP per caster Occult level at once, for 1d4+1 Madness. No effect on poison or disease.'),
    spell(1, 'Rite of Censing the Crooked Road', 'Smoke from a flame drifts to every gate or dimensional anomaly within 30 m, even hidden or dormant ones. It shows nothing about how to open or close them.'),
    spell(1, 'The Safe-Kept Quintessence of Flesh', 'An hour’s ritual turns a willing ally’s blood into a dose of dust. Thrown over that ally later (one action), it heals 1d8 HP plus 2 per Occult level of its maker, and gives 1 Madness.'),
    spell(1, 'Sigil of the Righteous Threshold', 'A clay amulet set over a door, window, or container makes it impassable to everyone except the caster and chosen allies. Breaking the portal by force destroys the amulet.'),
    spell(1, 'The Silvered Blade of Sacrifice', 'Enchants a ritual knife. Taking 1d4 HP of blood from a willing or helpless human lets the wielder reroll one failed hit roll, Physical Effect save, or physical skill check within the hour, for 1 Madness. Works once.'),
    spell(1, 'The Walker Beneath the Moon', 'The caster and up to six allies see in total darkness until sunrise, and a group moving quietly uses its best Stealth result. Direct sunlight ends it.'),
    spell(1, 'Whispers of the Scribe', 'While the caster keeps calm and focused, she learns one document’s language, age, magical power, and topic each round. It shows whether a grimoire holds spells, but not which ones.'),

    /* ---- Level 2 ---- */
    spell(2, 'Converse With the Ancestors', 'Ask a skull one question per Occult level; each answer is three words at most. For each question the GM rolls 1d10: if the roll is at most the years since death, hostile powers twist that answer and every later one.'),
    spell(2, 'Dust of Scouring False Seeming', 'Powder thrown at a target within 3 m: on a failed Magic save it shows its true form (its least human one) and can’t hide it for half an hour. Each witness sure of its disguise gives it +1 on the save.'),
    spell(2, 'Friendship of the Ones Behind', 'Done in perfect darkness: unseen powers bring a small, unguarded object whose location the caster knows before the next sunrise. If light gets in, the spell fails and everyone present takes 1d8 Madness.'),
    spell(2, 'The Merciful Rack of Ibn Baraka', 'A torment rite on a restrained subject. If the victim or the caster makes a Mental Effect save, possession or mind control ends (unless an outer god’s servant caused it). The victim takes 1d8 Madness; the caster takes 1d8 if it fails.'),
    spell(2, 'The Messengers of the Air', 'With an arcane connection, a two-way telepathic talk of up to 10 minutes that the target can’t shut out. Using up the connection can instead compel the target to travel to the ritual site (Mental Effect save resists).'),
    spell(2, 'The Seal of the Drowned Kings', 'Marks on the throats of up to five allies let them breathe, see, and move normally underwater for 24 hours, safe from cold and pressure. Erasing a mark ends it for that person.'),
    spell(2, 'Truths Written in Red', 'Soaking a human-made text in the caster’s blood lets her read it, codes included. A short text costs 1d4 HP; a long tome costs half her maximum HP, which won’t heal until she stops studying it.'),
    spell(2, 'Unsealing the Vault of Wisdom', 'Breaks wards, magical traps, and curses tied to one door or container, including [Sigil of the Righteous Threshold]. If a seal is too strong, it shows the best way to undo it. It doesn’t open mundane locks.'),

    /* ---- Level 3 ---- */
    spell(3, 'Binding the Crimson Sword', 'Binds a melee or thrown weapon to a wielder who gives 1d6 HP of blood. It never breaks while they live, they always sense where it is, and it counts as magical for Slaughter against unnatural creatures (each such Slaughter costs the wielder 1d4 HP). It fails anyone else in a real fight.'),
    spell(3, 'Binding Shut the Way', 'Seals a gate into another realm. Only long rituals and sacrifices can reopen it, but the caster can always undo his own seal.'),
    spell(3, 'The Black Lamp', 'Makes a lamp whose invisible light, seen only by those who took part in the rite, outlines enchanted objects and bewitched people. It lasts until put out or out of fuel.'),
    spell(3, 'Cleansing Light of the Dawn', 'Cleanses one building or site. Hostile magic ends unless an artifact or entity sustains it, curses break unless an outer god’s envoy laid them, and cult rites fail there for one month per Occult level. The curse’s author glimpses the caster.'),
    spell(3, 'The Seal of the Yellowed Fang', 'A decorated claw or fang shown to natural animals (up to six of one kind) makes them docile and obedient for one hour per Occult level. Works once.'),
    spell(3, 'The Sign of the King', 'Destroying an arcane connection compels its source, at any distance, to do one act not wholly against their nature. An out-of-character act allows a Mental Effect save.'),
    spell(3, 'The Staff of Turning Back the Way', 'A charged rod draws an invisible line up to 20 m long that supernatural entities can’t cross or see past until nightfall, unless they spend 1d6+2 rounds breaking it. Works once.'),
    spell(3, 'The Walker Beneath the Earth', 'The caster and up to six allies move through solid matter at normal speed. Mundane weapons can’t hurt them, but magic and fire can. Each round intangible costs 1d4 Madness; ending the spell while someone is inside matter kills them.'),

    /* ---- Level 4 ---- */
    spell(4, 'Eyes of the Distant Mind', 'With earth or a fragment taken from a place, scry anywhere within 200 m of where it came from. The caster is unaware of her own surroundings. Each half hour past the first 30 minutes in a week: Magic save or 1d4 Madness.'),
    spell(4, 'Incantation of the Thrice-Shared Eye', 'Links up to seven allies: telepathy at any range and a sense of each other’s location, health, and mood. They are surprised only if all are, and all use the best initiative roll. Counts against the caster’s lasting tokens.'),
    spell(4, 'Kill the Weakness of the Soul', 'Until dawn, a willing subject (not the caster) feels no fear or mercy, gains no Bloodshed Madness, obeys the caster short of suicide, and fails every social check. Afterward they forget that whole time.'),
    spell(4, 'The Mists of Unveiled Knowing', 'The caster’s blood (1d4 HP per 3 m of radius, which can kill her) becomes a silent red mist that replays the area’s most emotional recent event, or one she chooses, for as long as she chants.'),
    spell(4, 'The Scourging Seal of Solomon', 'A clay disc, activated with 1d4 HP of blood. One side up: supernatural creatures can’t come within 10 m without a Magic save (once per hour), and take 2d6 per Occult level of its maker when they break through. Other side up: that damage hits the first one to enter.'),
    spell(4, 'The Vermilion Mark of Sanctity', 'An amulet that makes its wearer immune to possession and telepathic reading. The wearer also can’t use telepathy or mind-affecting magic. Removing it ends the effect.'),

    /* ---- Level 5 ---- */
    spell(5, 'Band of Unhindered Escape', 'Breaking a woven ring stops time for 1d4+1 rounds for the user and allies within 10 m. Handling a time-frozen object costs 1d8 Madness; living creatures can’t be affected. Everyone takes 1d4 Madness when time resumes.'),
    spell(5, 'The Little House Without Windows', 'A token opens (one action) a hidden portal to an endless maze of gray rooms that seals once the caster enters. No hunger, thirst, or fatigue inside; wounds heal normally. 1 Madness per day after the first. Anything left inside is lost.'),
    spell(5, 'The Pandect of Light', 'An hour of drawing wards a mansion-sized building or a 30 m circle against every supernatural entity and physically altered human, and gives the caster a Magic save to dispel hostile magic sent in. Lowering it costs 5d6 damage (Magic save for half; no save if the sigils are defaced).'),
    spell(5, 'The Ravenous Worms of Hazai', 'Breaking a clay figure fills 3 m with worms that devour corpses at once and deal 3d6 per round to the living; humans also take 1d6 Madness in the first round. The maker takes 1d6 per round to contain them; if they fall, the area grows 20 m per round for 1d4 rounds.'),
    spell(5, 'Rite of the Wetted Knife', 'A weapon that has struck a type of creature before can harm and Slaughter that type even when it normally can’t, and rolls its Slaughter die twice, keeping the higher. Lasts until the caster ends it; one creature type per weapon.'),
    spell(5, 'Stealing the Road to Hell', 'Opens a path through a nightmare realm for the caster and up to twelve allies, at most once a week. Int/Occult vs 6 to reach a prepared site, 10 a visited one, 14 one only heard of. Failure lands them somewhere very dangerous.')
  ];

  function discipline(name, intro, levels) {
    return { name: name, category: 'Powers', source: 'Discipline',
      body: intro + ' See [Using Disciplines].\n\n' +
        levels.map(function (t, i) { return '- **Level-' + i + '**: ' + t; }).join('\n') };
  }

  var DISCIPLINES = [
    discipline('Enlightened Hand', 'Supernatural martial arts focused on bodily control and toughness.', [
      'Unarmed attacks do a base 1d6, and striking harmful flesh doesn’t hurt the adept.',
      'Base AC 3 for the next hour.',
      'Can stabilize after a mortal wound, or fake death while staying aware.',
      'Unarmed base damage 2d6; counts as magical for hitting and Slaughter.',
      'Keep acting at 0 HP for up to 3 rounds, paying 5 Madness per extra round.']),
    discipline('Precognition', 'Glimpses of the most likely future. Visions are clear but incomplete.', [
      'A few seconds’ warning before an ambush or trap; can trigger on its own if the PC pays.',
      'Predict the result of a simple random event, such as a game of chance.',
      'See the most likely way the user will be badly harmed in body or mind within a week.',
      'Foretell the likely result, within an hour, of a course of action; once per hour.',
      'A one-word answer to a simple question about a future event; once per week per event.']),
    discipline('Pyrokinesis', 'Fire powers; also a model for other attack disciplines.', [
      'A candle flame on the body: ignore 2 fire damage per round, and fire can’t Slaughter the user.',
      'A torch flame on the body adds 1d6 fire damage to unarmed attacks; ignore 5 fire damage per round.',
      'Ignite an easily flammable object in sight (not one worn or carried).',
      'A visible creature bursts into flame: 2d6 damage with a 1d8 Slaughter die; an Evasion save avoids it.',
      'Flames do 2d8 with a 1d10 Slaughter die; immune to heat and smoke and can see through them.']),
    discipline('Sacred Blade', 'A bond with one melee or thrown weapon (never a firearm or bow). A bound thrown weapon returns to the hand.', [
      'A day of bonding gives +1 to hit and damage with the weapon, and a sense of its direction and distance.',
      'Eyes and cameras overlook the bonded weapon until it is drawn, unless magic searches for it.',
      'Counts as magical for hitting and Slaughter; the bonus becomes +2.',
      'Its Slaughter die grows one step (1d6 to 1d8, and so on, to 1d12).',
      'The bonus becomes +3, and no non-magical force can break the weapon.']),
    discipline('Telekinesis', 'Move objects with the mind. It can’t lift the user or unwilling targets, or pull items from an alert target.', [
      'Handle objects up to 100 g as deftly as with two hands.',
      'Handle objects up to 5 kg.',
      'Handle several objects up to 100 kg.',
      'Strike a visible target for 1d8 damage with a 1d6 Slaughter die (not magical against supernatural foes).',
      'The blow does 2d6 with a 1d8 Slaughter die; weight limit 200 kg.']),
    discipline('Telepathy', 'Mind reading within sight. Supernatural entities are immune, and a target who makes its Mental Effect save is immune for 24 hours.', [
      'Wis/Telepathy vs 8 to sense emotions and strong surface thoughts; after a successful Mental Effect save, know that something tried to affect the mind.',
      'Contact a willing person the user has met within 1 km; read surface thoughts of a target in sight (Mental Effect save resists).',
      'Contact range 20 km; ask one question of a target’s memory for a one-sentence answer on a failed save.',
      'Contact range 300 km; question a target in detail on one topic on a failed save.',
      'Global contact range; search a target’s whole memory on a failed save.']),
    discipline('Warding', 'Quick, invisible wards that affect only supernatural entities.', [
      'After failing a save against magic, delay its effect by one round.',
      'Ward a doorway or a line; supernatural foes need one round per Warding level to break it. One ward at a time; usable every other round.',
      'Keep supernatural foes 5 m away and block their powers on the user, for one round per level; once per minute.',
      'Seal the user or others: reroll failed saves against magic, at 1 Madness per hour.',
      'A 5 m zone that moves with the warder hides the group from supernatural foes unless they engage or make noise; 30 minutes, once per hour.']),
    discipline('Witchfinding', 'Real techniques for detecting sorcerers and their magic.', [
      'Know when a magical effect targets the user (no details).',
      'Tell whether magic was used in an area in the past week; Wis/Occult vs 6 + 1 per day since for a two-word impression.',
      'By skin contact, learn whether a person has ever cast a spell or joined a ritual (Mental Effect save resists; then immune for 10 minutes).',
      'After a round studying a person within 10 m, tell whether magic affects them; Wis/Occult vs 9 for who cast it and two words on each spell.',
      'Track a studied supernatural or enchanted creature for a day, or gain +2 on a Magic or sorcerous Mental Effect save, even after rolling.'])
  ];

  var RULES = [
    { name: 'Casting Spells', category: 'Rules', source: 'Sorcery', body:
      'A spell takes 10 minutes of ritual per level unless it says otherwise, and needs small ritual tools. Injury or disruption ruins it, and the cost is still paid.\n\n' +
      '**Cost:** spend 1 Expertise, or gain Madness equal to the spell level.\n\n' +
      '**Above your skill:** if the spell level is higher than your Occult skill, also roll Int/Occult vs 6 + level. On a failure, let it fizzle, or take more Madness equal to its level to force it (Expertise can’t pay this).\n\n' +
      '**Learning:** needs Occult-0 and one week per level with a book or teacher, then Int/Occult vs 6 + level (a teacher adds their Occult skill). Every attempt costs 1 Madness; success adds Madness equal to the level.\n\n' +
      '**Lasting tokens:** a sorcerer can keep at most Scholar level + Int modifier + Occult skill ritual items active.' },
    { name: 'Using Disciplines', category: 'Rules', source: 'Sorcery', body:
      'Activating a discipline is a free action: spend 1 Expertise, or gain Madness equal to the discipline level + 1. Every known level then works for 15 minutes. Pay separately for each discipline.\n\n' +
      '**Learning:** a tutor with level-2, one month, 1 skill point, and 5 Madness for level-0. Raise it later like a class skill, up to level-4.\n\n' +
      '**Mastery:** a month’s effort, 1 permanent Expertise, and 10 Madness make level-0 free to use; each later level costs 5 more Madness.' },
    { name: 'Slaughter Die', category: 'Rules', source: 'Combat', body:
      'Roll a weapon’s Slaughter die with its damage. On 6 or more, the damage is tripled. Most monsters use 1d6. Many abominations and all undead ignore Slaughter from mundane weapons. Hit rolls are 1d20 + attribute modifier + combat skill + attack bonus + the target’s AC; 20 or more hits.' },
    { name: 'Burst and Suppressive Fire', category: 'Rules', source: 'Combat', body:
      '**Burst fire** (weapons marked burst): spend 3 rounds of ammo for +2 to hit, damage, and the Slaughter roll.\n\n' +
      '**Suppressive fire** (heavy machine gun): fire double ammo; everyone in the arc within normal range takes half damage, with the normal Slaughter chance, unless they make the better of a Luck or Evasion save or are behind hard cover.\n\n' +
      '**Spray and pray** (burst weapons with at least half a magazine): empties the magazine for one hit roll against each target in front, up to the rounds left; anyone hit gets the better of a Luck or Evasion save to avoid it.' },
    { name: 'Vehicles', category: 'Rules', source: 'Vehicle', body:
      'In a chase, the other vehicle’s Speed is a penalty to Vehicle skill checks. Armor is subtracted from weapon damage, except from Gunnery weapons. A stationary vehicle within 10 m is hit automatically; otherwise attack AC 9 minus its Speed (and minus your own vehicle’s Speed if you are moving). At half HP its Speed halves; at 0 HP everyone aboard makes a Luck save or takes its maximum HP in damage (half on a success).' }
  ];

  var COST = { Che: 'Cheap', Com: 'Common', Exp: 'Expensive', Ext: 'Extravagant' };
  var BURST = 'Burst fire capable — see [Burst and Suppressive Fire].';

  // w(name, source, damage, slaughter, attribute, range, magazine, costCode, note)
  function w(name, source, dmg, slaughter, attr, range, mag, cost, note) {
    var bits = ['**Damage** ' + dmg, '**Slaughter** ' + slaughter, '**Attribute** ' + attr];
    if (range) bits.push('**Range** ' + range + ' m');
    if (mag) bits.push('**Magazine** ' + mag);
    bits.push('**Cost** ' + (COST[cost] || 'N/A'));
    return { name: name, category: 'Items', source: 'Weapon (' + source + ')', body: bits.join(' · ') + (note ? '\n\n' + note : '') };
  }

  var WEAPONS = [
    w('Unarmed Attack', 'Melee', '1d2 + skill', 'special', 'Str/Dex', '', '', '', 'Adds the Combat/Unarmed level to damage. Slaughter die by that skill: untrained none, level-0 1d6, level-1 1d8, level-2 1d10, level-3+ 1d12. Can deal subdual damage.'),
    w('Knife', 'Melee', '1d4', '1d6', 'Str/Dex', '6/9', '', 'Che', 'Can be thrown.'),
    w('Club', 'Melee', '1d4', 'none', 'Str', '6/9', '', '', 'Can be thrown.'),
    w('Sword or 1H Melee', 'Melee', '1d8', '1d6', 'Str/Dex', '', '', 'Com'),
    w('Spear', 'Melee', '1d6', '1d6', 'Str', '10/20', '', 'Che', 'Can be thrown.'),
    w('Great Weapon', 'Melee', '2d6', '1d10', 'Str', '', '', 'Com', 'Covers any proper two-handed melee weapon.'),
    w('Taser', 'Melee', '1d8', '1d6', 'Str/Dex', '', '1', 'Com', 'Deals subdual damage.'),
    w('Bow', 'Ranged', '1d6', '1d6', 'Dex', '100/150', '1', 'Com'),
    w('Crossbow', 'Ranged', '1d8', '1d6', 'Dex', '100/150', '1', 'Com', 'Reloading takes an extra action.'),
    w('Frag Grenade', 'Ranged', '2d6', '1d8', 'Dex', '10/30', '', 'Com', 'Always attacks AC 9; a miss lands 1d10 m away in a random direction. Hits everyone within 5 m (Luck save for half), minus 1 damage per point of AC below 6.'),
    w('Revolver', 'Firearm', '1d8', '1d6', 'Dex', '30/100', '6', 'Com'),
    w('Semi-auto Pistol', 'Firearm', '1d6+1', '1d6', 'Dex', '30/100', '12', 'Com'),
    w('Rifle', 'Firearm', '1d10+2', '1d8', 'Dex', '200/400', '6', 'Com'),
    w('Shotgun, Break', 'Firearm', '3d4', '1d10', 'Dex', '10/30', '2', 'Com'),
    w('Shotgun, Pump', 'Firearm', '3d4', '1d10', 'Dex', '10/30', '6', 'Com'),
    w('Submachine Gun', 'Firearm', '1d8', '1d6', 'Dex', '30/100', '20', 'Exp', BURST),
    w('Combat Rifle', 'Firearm', '1d12', '1d8', 'Dex', '100/300', '30', 'Exp', BURST),
    w('Combat Shotgun', 'Firearm', '3d4', '1d10', 'Dex', '10/30', '12', 'Exp', BURST),
    w('Sniper Rifle', 'Firearm', '2d8', '1d12', 'Dex', '1,000/2,000', '1', 'Exp', 'After a full round aiming from a steady rest at an unaware target, a hit forces a Physical Effect save, minus the sniper’s Combat/Projectile skill; failure kills anything not immune to Slaughter.'),
    w('Heavy Machine Gun', 'Heavy', '3d6', '1d12', 'Dex', '500/2,000', '10', 'Ext', 'Can lay suppressive fire — see [Burst and Suppressive Fire]. A full ammo load counts as three items.'),
    w('Rocket Launcher', 'Heavy', '3d10', '1d20', 'Dex', '1,000/2,000', '1', 'Ext', 'Reloading takes an extra action.')
  ];

  var NOT_VS_GUNS = 'Gives no protection against firearms or explosives.';
  // ar(name, ac, enc, costCode, note)
  function ar(name, ac, enc, cost, note) {
    return { name: name, category: 'Items', source: 'Armor',
      body: '**AC** ' + ac + ' · **Enc** ' + enc + ' · **Cost** ' + COST[cost] + '\n\n' + note +
        ' Your AC is the armor’s AC minus your Dex modifier, and never worse than 9.' };
  }

  var ARMOR = [
    ar('Leather Armor', '7', 1, 'Com', 'Old-style armor; racing gear and protective clothing can stand in. ' + NOT_VS_GUNS),
    ar('Mail Armor', '5', 2, 'Exp', 'Only a few artisans make real mail. ' + NOT_VS_GUNS),
    ar('Plate Armor', '3', 3, 'Ext', 'Only a few artisans make real plate. ' + NOT_VS_GUNS),
    ar('Shield', '1 better', 1, 'Com', 'Usually a riot shield. ' + NOT_VS_GUNS),
    ar('Armored Longcoat', '7', 1, 'Exp', 'A reinforced coat or duster that passes for normal clothing at a glance, but not under close inspection.'),
    ar('Armored Undersuit', '7', 1, 'Exp', 'Tight ballistic underclothing. Gives no protection against melee weapons or fists.'),
    ar('Ballistic Vest', '6', 2, 'Exp', 'Plainly armor; wearing it openly draws police interest.'),
    ar('Military Body Armor', '4', 3, 'Ext', 'Plates, pads, and joint protection; plainly armor.')
  ];

  var SMALL = 'Too small to track unless carried in bulk.';
  var BUNDLE = 'Three can be bundled as one item (an extra turn to unpack).';
  // g(name, enc, costCode, note)
  function g(name, enc, cost, note) {
    return { name: name, category: 'Items', source: 'Gear',
      body: '**Enc** ' + enc + ' · **Cost** ' + COST[cost] + (note ? '\n\n' + note : '') };
  }

  var GEAR = [
    g('Ammunition (20 rounds or 1 magazine)', 1, 'Com', BUNDLE),
    g('Backpack with internal frame', 1, 'Com'),
    g('Body Bag', 1, 'Che', BUNDLE),
    g('Electronics Kit', 1, 'Com'),
    g('Emergency First Aid Kit', 1, 'Com'),
    g('Fake ID, Excellent', '—', 'Exp', SMALL),
    g('Fake ID, Poor', '—', 'Com', SMALL),
    g('Gas Mask', 1, 'Com'),
    g('Geiger Counter', 1, 'Com'),
    g('Hazmat Suit, Level A', 4, 'Exp'),
    g('Holster, Custom', 1, 'Com', 'Includes tailoring; a pistol-sized weapon in it counts as Readied. A normal concealed-carry holster leaves it Stowed.'),
    g('Laptop Computer', 1, 'Com'),
    g('Mechanic’s Field Kit', 3, 'Com'),
    g('Rations, 1 day', 1, 'Che', BUNDLE),
    g('Rope, nylon, 20 m', 1, 'Che'),
    g('Satellite Phone', 1, 'Exp'),
    g('Smartphone', '—', 'Com', SMALL),
    g('Two-man Tent', 3, 'Com'),
    g('Water Bladder, 1 day', 2, 'Che')
  ];

  // v(name, speed, armor, hp, crew, costCode)
  function v(name, speed, armor, hp, crew, cost) {
    return { name: name, category: 'Items', source: 'Vehicle',
      body: '**Speed** ' + speed + ' · **Armor** ' + armor + ' · **HP** ' + hp + ' · **Crew** ' + crew +
        ' · **Cost** ' + (COST[cost] || 'N/A') + '\n\nSee [Vehicles].' };
  }

  var VEHICLES = [
    v('Car', 0, 6, 30, 5, 'Exp'),
    v('Motorcycle', 1, 4, 10, 2, 'Exp'),
    v('Helicopter, Small', 2, 5, 15, 2, 'Exp'),
    v('Helicopter, Large', 3, 6, 20, 6, 'Ext'),
    v('Plane, Prop', 2, 5, 20, 6, 'Exp'),
    v('Plane, Jet', 4, 8, 25, 20, 'Ext'),
    v('Sailboat', 0, 6, 30, 6, 'Exp'),
    v('Powerboat', 1, 6, 30, 6, 'Ext'),
    v('Tank', 1, 20, 50, 3, '')
  ];

  var DATA = [].concat(SPELLS, DISCIPLINES, RULES, WEAPONS, ARMOR, GEAR, VEHICLES);

  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  root.SL_COMPENDIUM_SEED = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
