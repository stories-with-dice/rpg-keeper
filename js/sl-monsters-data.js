/* js/sl-monsters-data.js — hand-authored from Silent Legions (Sine Nomine),
 * The Bestiary chapter: the creature-template table (11 entity types ×
 * Weak/Average/Strong, p.150) and the named Nefarious Entities (Mundane
 * Humans, Human Cultists, Monstrous Humans, Undead, Uncanny Abominations,
 * p.157-165). Loaded by index.html as a <script> (works from file://), read
 * by js/sl-seed.js the same way js/monsters-data.js is read by js/seed.js.
 *
 * Unlike BRP, a Silent Legions stat block is OSR-shaped (descending AC, d8
 * Hit Dice, a d20 hit bonus, 2d6 Morale), so each def uses the plain OSR
 * `def` shape from js/monsters.js — ac {asc:null, desc, thac0:null}, hd,
 * hdNum, hp, move, moraleML, atkBonus, attacks/attacksText, saveTargets/
 * savesText, abilities — with `source: 'sl'` plus four SL-only fields:
 *   skill        the creature's flat skill-check bonus (2d6 + skill)
 *   madness      Madness its presence inflicts, in the book's notation
 *                ('None', '1', '1d6', or 'None / 1d6' = disguised / true form)
 *   slaughterDie its attacks' Slaughter die ('1d6' unless the book says
 *                otherwise; 'None' for attacks that never Slaughter)
 *   mundaneImmune the book's AC asterisk: ordinary harm doesn't work on it
 * Every monster saves on one target, 15 − ½HD rounded up (savesText '14+');
 * the named entries keep the book's printed value even where it differs
 * from that formula (Vampire, Cancer Man, Slasher). HD "1d4 hp" is stored
 * as '½' (hp 2) and "1 hp" as '0' (hp 1); otherwise hp is the d8 average,
 * ⌊4.5 × HD⌋. Descriptions and abilities are short paraphrases, not the
 * book's text.
 */
(function (root) {
  // a(label, count, toHit, damage, note) — one attack row (js/monsters.js shape).
  function a(label, count, toHit, damage, note) {
    return { label: label, count: count, toHit: toHit, damage: damage || '', note: note || '', raw: '' };
  }
  var wpn = function (toHit, note) { return a('weapon', 1, toHit, '', note || 'by weapon'); };

  var UNDEAD = { name: 'Undead', text: 'Immune to poison, disease, suffocation, hunger, and Slaughter from mundane weapons.' };

  /* ---- Creature templates (p.150): [tier, AC, HD, attacks, move, ML, skill, madness] ---- */
  var TEMPLATES = [
    { type: 'Common Human', desc: 'An ordinary person with no special talent. Weak suits children and the frail; Strong suits veterans and hardened criminals.',
      tiers: [
        ['Weak', 9, '1 hp', [wpn(-1)], "30'", 6, 0, 'None'],
        ['Average', 9, '1d4 hp', [wpn(0)], "30'", 7, 1, 'None'],
        ['Strong', 8, '1', [wpn(1)], "30'", 8, 2, 'None']] },
    { type: 'Skilled Human', desc: 'An exceptional person: a cult lieutenant, a leader, or a top expert. Weak suits minor lieutenants; Strong suits serious cult leaders.',
      tiers: [
        ['Weak', 8, '1', [wpn(1)], "30'", 8, 1, 'None'],
        ['Average', 8, '3', [wpn(3)], "30'", 9, 2, 'None'],
        ['Strong', 7, '6', [wpn(6)], "30'", 10, 4, 'None']] },
    { type: 'Verminous Beast', desc: 'Small, vicious creatures in packs or swarms; one stat line can stand for a whole small group. Weak suits rats and other mundane pests.',
      tiers: [
        ['Weak', 8, '1 hp', [a('bite', 1, 0, '', '1 damage')], "10'", 6, 1, 'None'],
        ['Average', 7, '1d4 hp', [a('bite', 1, 1, '1d4')], "20'", 6, 2, 'None'],
        ['Strong', 6, '1', [a('bite', 2, 2, '1d6')], "30'", 7, 3, '1']] },
    { type: 'Large Predator', desc: 'A lone hunter such as a tiger or a shark; Weak also suits pack wolves. The stronger lines suit supernatural beasts. Mundane animals inflict no Madness.',
      tiers: [
        ['Weak', 9, '2', [a('bite', 1, 2, '1d6')], "30'", 7, 2, 'None'],
        ['Average', 7, '4', [a('bite', 1, 4, '1d8'), a('claw', 2, 4, '1d6')], "40'", 8, 3, 'None'],
        ['Strong', 5, '6', [a('bite', 1, 6, '1d10'), a('claw', 2, 6, '1d8')], "40'", 9, 4, '1']] },
    { type: 'Undead Humanoid', desc: 'Zombies, skeletons, ghouls, and other solid risen dead.', abilities: [UNDEAD],
      tiers: [
        ['Weak', 8, '1', [a('bite', 1, 2, '1d4')], "30'", 12, 0, '1'],
        ['Average', 6, '3', [a('bite', 1, 4, '1d4'), a('claw', 2, 4, '1d6')], "30'", 12, 1, '1d4'],
        ['Strong', 4, '6', [a('bite', 1, 6, '1d8'), a('claw', 2, 6, '1d6')], "30'", 12, 3, '1d8']] },
    { type: 'Amorphous Terror', desc: 'A shapeless, pliable horror; the stronger tiers are bigger masses.',
      abilities: [{ name: 'Formless', text: 'Usually immune to Slaughter from mundane weapons, and can flow through tiny gaps.' }],
      tiers: [
        ['Weak', 6, '3', [a('tendril', 1, 3, '1d8')], "20'", 9, 2, '1d6'],
        ['Average', 5, '5', [a('tendril', 2, 5, '1d8')], "30'", 10, 2, '1d8'],
        ['Strong', 4, '7', [a('tendril', 4, 7, '1d10')], "40'", 11, 2, '1d10']] },
    { type: 'Stalking Hunter', desc: 'A solitary ambusher that strikes from cover and avoids fair fights. Mundane stalking animals inflict no Madness.',
      tiers: [
        ['Weak', 7, '2', [a('bite', 1, 4, '1d8')], "40'", 7, 3, '1d4'],
        ['Average', 6, '3', [a('bite', 1, 6, '1d8'), a('claw', 2, 6, '1d6')], "40'", 8, 4, '1d6'],
        ['Strong', 5, '4', [a('bite', 1, 8, '1d10'), a('claw', 2, 8, '1d8')], "50'", 9, 5, '1d10']] },
    { type: 'Hulking Brute', desc: 'A giant or another huge creature: easy to hit, hard to bring down. A mundane big animal inflicts no Madness.',
      tiers: [
        ['Weak', 8, '4', [a('smash', 1, 4, '1d8')], "30'", 8, 1, '1d6'],
        ['Average', 7, '6', [a('smash', 2, 5, '1d10')], "30'", 9, 2, '1d8'],
        ['Strong', 6, '8', [a('smash', 3, 6, '1d10')], "40'", 10, 3, '1d10']] },
    { type: 'Humanoid Thing', desc: 'A mostly human creature touched by the outer dark: a humanoid alien, an occult construct, or an altered person. Uses a weapon as well as its bite.',
      tiers: [
        ['Weak', 9, '1', [a('bite', 1, 1, '1d4'), wpn(1)], "30'", 7, 1, '1d4'],
        ['Average', 8, '2', [a('bite', 1, 2, '1d6'), wpn(2)], "30'", 8, 2, '1d6'],
        ['Strong', 6, '4', [a('bite', 2, 4, '1d6'), wpn(4)], "40'", 9, 3, '1d8']] },
    { type: 'Armored Abomination', desc: 'A golem-like thing made of tougher stuff than flesh; it relies on resilience more than bulk.',
      abilities: [{ name: 'Tough', text: 'Usually immune to Slaughter from mundane weapons.' }],
      tiers: [
        ['Weak', 5, '2', [a('smash', 1, 2, '1d6')], "20'", 8, 1, '1d4'],
        ['Average', 4, '4', [a('smash', 1, 4, '1d6'), a('bite', 1, 4, '1d6')], "30'", 9, 2, '1d6'],
        ['Strong', 3, '6', [a('smash', 2, 6, '1d8'), a('bite', 1, 6, '1d8')], "30'", 10, 3, '1d8']] },
    { type: 'Outer Entity', desc: 'An avatar or lieutenant of the Mythos gods. Even the Weak tier can terrorize a low-level party.',
      abilities: [{ name: 'Otherworldly', text: 'Usually immune to non-magical weapons.' }],
      tiers: [
        ['Weak', 4, '4', [a('tentacle', 2, 4, '1d6')], "30'", 12, 4, '1d8'],
        ['Average', 3, '8', [a('tentacle', 4, 8, '1d8')], "40'", 12, 5, '1d10'],
        ['Strong', 2, '12', [a('tentacle', 6, 12, '1d8')], "50'", 12, 6, '1d12']] }
  ];

  var DATA = [];
  TEMPLATES.forEach(function (t) {
    t.tiers.forEach(function (r) {
      DATA.push({ name: t.type + ' (' + r[0] + ')', desc: t.desc, ac: r[1], hd: r[2], attacks: r[3], move: r[4],
        ml: r[5], skill: r[6], madness: r[7], abilities: (t.abilities || []).slice() });
    });
  });

  /* ---- Named entities (p.157-165) ---- */
  DATA = DATA.concat([
    /* Mundane Humans (p.157) */
    { name: 'Ordinary Human', desc: 'Shopkeepers, bystanders, and petty hooligans. Rarely good at violence and quick to flee; more trouble through the authority of their jobs.',
      ac: 9, hd: '1d4 hp', attacks: [wpn(-1)], move: "30'", ml: 6, skill: 1, madness: 'None', save: 15 },
    { name: 'Human Heavy', desc: 'A cop, a soldier, or a veteran thug: someone used to violence and willing to hurt people.',
      ac: 9, hd: '1', attacks: [wpn(1)], move: "30'", ml: 8, skill: 1, madness: 'None', save: 15 },
    { name: 'Human Expert', desc: 'A professional with real talent in a non-combat field, such as a scientist or an archaeologist.',
      ac: 9, hd: '1', attacks: [wpn(0)], move: "30'", ml: 7, skill: 3, madness: 'None', save: 15 },
    { name: 'Human Leader', desc: 'A police sergeant, a gang boss, or another smart, tough person who can lead and fight.',
      ac: 8, hd: '4', attacks: [wpn(4, 'weapon dmg +1')], move: "30'", ml: 9, skill: 2, madness: 'None', save: 13 },

    /* Human Cultists (p.158) */
    { name: 'Cultist', desc: 'A rank-and-file member: an ordinary person made stubborn by indoctrination. Often more dangerous through mundane jobs and connections.',
      ac: 9, hd: '1d4 hp', attacks: [wpn(0)], move: "30'", ml: 9, skill: 1, madness: 'None', save: 15 },
    { name: 'Cult Enforcer', desc: 'The cult’s muscle and lieutenants, who keep ordinary members obedient and silent.',
      ac: 8, hd: '3', attacks: [wpn(3)], move: "30'", ml: 11, skill: 2, madness: 'None', save: 14 },
    { name: 'Cult High Priest', desc: 'The leader of a local cult of modest power, usually a sorcerer. Use the Nemesis rules or an inhuman template for priests of greater faiths.',
      ac: 8, hd: '6', attacks: [wpn(4)], move: "30'", ml: 12, skill: 3, madness: 'None', save: 12,
      abilities: [{ name: 'Sorcerer', text: 'Usually knows spells, and may carry physical changes from the power it serves.' }] },

    /* Monstrous Humans (p.158) */
    { name: 'Serial Killer', desc: 'A cunning, fully human murderer who slips the police and is very hard to put down.',
      ac: 8, hd: '5', attacks: [a('weapon', 2, 5, '', 'weapon dmg +1')], move: "30'", ml: 9, skill: 3, madness: 'None / 1', save: 13 },
    { name: 'Slasher', desc: 'A killer changed by the outer night who haunts places from its old life and stalks lone victims.',
      ac: 4, mundaneImmune: true, hd: '6', attacks: [a('slash', 1, null, '1d4', 'grows each hit')], move: "40'", ml: 12, skill: 5,
      madness: '1d6', slaughterDie: 'None', save: 10,
      abilities: [
        { name: 'Never misses', text: 'Its attacks always hit. The first hit in a fight does 1d4; each later hit steps the die up (1d6, 1d8, 1d10, 1d12, 1d20). Its hits never Slaughter.' },
        { name: 'Unkillable', text: 'Only sorcery, magical weapons, or harm from the environment (falls, fire, suffocation) can damage it.' }] },
    { name: 'Mad Scientist', desc: 'A sorcerer in a lab coat who explains impossible things with demented science and always needs fresh materials.',
      ac: 8, hd: '6', attacks: [a('device', 1, 6, '', 'by device')], move: "30'", ml: 8, skill: 5, madness: 'None / 1d4', save: 12,
      abilities: [{ name: 'Devices', text: 'Carries gadgets that copy 1d4+1 spells useful to it; only the scientist can make them work.' }] },

    /* Undead (p.159) */
    { name: 'Zombie', desc: 'An animated corpse with arrested decay and little or no mind.',
      ac: 7, hd: '2', attacks: [a('rend', 1, 1, '1d6')], move: "20'", ml: 12, skill: 0, madness: '1d6', save: 14,
      abilities: [UNDEAD, { name: 'Shatter', text: 'Only breaking its skeleton stops it: shotguns and two-handed melee weapons Slaughter it on every hit.' }] },
    { name: 'Ghoul', desc: 'A faster, smarter zombie, often in groups of 2–4, that craves human flesh. Well-fed ghouls can pass for living people and sometimes run cannibal cults.',
      ac: 7, hd: '3', attacks: [a('claw', 2, 3, '1d4')], move: "40'", ml: 8, skill: 1, madness: 'None / 1d6', save: 14,
      abilities: [UNDEAD] },
    { name: 'Ghost', desc: 'A dead soul bound to a place by a task it can no longer finish.',
      ac: 9, mundaneImmune: true, hd: '4', attacks: [a('touch', 1, 4, '1d4', '+1d6 Madness')], move: "30' insubstantial", ml: 12, skill: 1,
      madness: '1d6', slaughterDie: 'None', save: 13,
      abilities: [UNDEAD,
        { name: 'Chilling touch', text: 'Never Slaughters. Each touch also inflicts 1d6 Madness. Objects important to its life or death can drive it back.' }] },
    { name: 'Vampire', desc: 'The classic blood-drinking undead, each with its own set of weaknesses.',
      ac: 6, mundaneImmune: true, hd: '8', attacks: [a('strike', 2, 8, '1d6+2')], move: "30'", ml: 10, skill: 3, madness: 'None / 1d4', save: 12,
      abilities: [UNDEAD,
        { name: 'Personal weaknesses', text: 'Usually harmed only by magic weapons, fire, or sorcery; some also fear holy water, stakes, or limb-severing blades. An occultist who knows its true name and origin can roll Int/Occult (difficulty 9) to find a weakness, with one more roll for each new fact about its life.' }] },

    /* Uncanny Abominations (p.160-165) */
    { name: 'Blistered Priest', desc: 'A thing posing as a cleric or a therapist. It feeds on its flock’s anguish, keeps their lives miserable, and teaches them ever worse self-mortification.',
      ac: 8, hd: '7', attacks: [a('smash', 1, 5, '1d8', '+1d6 Madness')], move: "30'", ml: 10, skill: 3, madness: 'None / 1d4', save: 12,
      abilities: [{ name: 'Bursting boils', text: 'Its hits also inflict 1d6 Madness. Anyone who hits it in melee takes its smash damage too, with no Slaughter.' }] },
    { name: 'Cancer Man', desc: 'A survivor of early radiation experiments whose body is a mass of tumors. Looks normal, if thin, at a glance.',
      ac: 9, hd: '8', attacks: [wpn(6)], move: "30'", ml: 11, skill: 4, madness: 'None / 1d6', save: 12,
      abilities: [
        { name: 'Infectious touch', text: 'Its touch gives a fast, incurable mystical cancer (no save) that kills in one week per point of CON. It can sense through the tumors and, late in the illness, puppet the victim. Only its death cures the victims.' },
        { name: 'Regenerates', text: 'Heals to full at the start of each round while above 0 HP, unless dosed with heavy chemotherapy drugs.' }] },
    { name: 'Drowned King', desc: 'A sorcerer-monarch from a sunken realm. It folds a city’s passages into a hidden palace and drives its court to bloodshed and excess to taste their passions.',
      ac: 6, hd: '12', attacks: [a('smite', 1, 10, '1d12')], move: "30'", ml: 11, skill: 4, madness: '1d10', save: 9,
      abilities: [
        { name: 'Compulsion', text: 'Creatures of 1 HD or less must obey it; others make a Mental Effect save every round. Showing physical proof of legitimate authority over the place makes the bearer immune.' },
        { name: 'Sorcerer', text: 'Knows a wide range of blasphemous spells.' }] },
    { name: 'Fetch', desc: 'A silent, car-sized spider-thing with spiked carapace, sent by a sorcerer after one victim. Killing it sends a new Fetch after the summoner.',
      ac: 5, hd: '8', attacks: [a('claw', 3, 8, '1d6')], move: "40'", ml: 12, skill: 3, madness: '1d10', slaughterDie: '1d8', save: 11,
      abilities: [
        { name: 'Unseen hunter', text: 'Only its prey can see it, unless someone sincerely believes in it; cameras never show it. It shows itself to the prey seven times, closer each time.' },
        { name: 'Impale', text: 'A victim brought to 0 HP is impaled alive on its spikes instead of dying, and takes 1d12 Madness each round while pinned.' }] },
    { name: 'Gray Waif', desc: 'A scavenger entity that poses as a helpless young person in need of rescue, and steers its protectors into disaster.',
      ac: 5, mundaneImmune: true, hd: '7', attacks: [a('tentacle', 4, 6, '1d8')], move: "30'", ml: 9, skill: 3, madness: 'None / 1d10', save: 12,
      abilities: [
        { name: 'Illusion', text: 'Its human seeming fools sorcery and close inspection. Even in that form, mundane harm leaves only bruises and scratches.' },
        { name: 'Troublemaker', text: 'Its presence makes innocent words and acts look like threats or insults, which provokes its “rescuers” into needless fights.' }] },
    { name: 'Harbinger', desc: 'A person gripped by a syndrome that shapes events toward a coming disaster and blocks every attempt to prepare for it.',
      ac: 2, hd: '5', attacks: [wpn(5)], move: "30'", ml: 10, skill: 3, madness: 'None / 1d6', save: 13,
      abilities: [
        { name: 'Foresight', text: 'Can be harmed only by magical artifacts or sorcery.' },
        { name: 'Doppelgangers', text: 'When someone fails to play their part in the disaster, a perfect duplicate appears to do it instead.' },
        { name: 'Cure', text: 'Preventing the disaster completely ends the syndrome.' }] },
    { name: 'Lycanthrope', desc: 'A person infested by an alien predator parasite, able to become a beast or a hybrid at will.',
      ac: 7, mundaneImmune: true, hd: '7', attacks: [a('bite', 1, 8, '1d6'), a('claw', 2, 8, '1d6')], move: "40'", ml: 11, skill: 3,
      madness: '1d8', slaughterDie: '1d8', save: 12,
      abilities: [
        { name: 'Silver', text: 'In beast or hybrid form only magic weapons, spells, or silver harm it; in human form it needs one of those to go below 1 HP. Changing shape takes one round.' },
        { name: 'Spawn', text: 'A badly hurt survivor can become a new host within a month unless the progenitor is killed.' }] },
    { name: 'Macguffin Servant (Medium)', desc: 'Animated clothing or furniture that the Macguffin (an entity that copies a desired object, then corrupts its owner’s things) raises to defend itself.',
      ac: 6, hd: '1', attacks: [a('batter', 1, 0, '1d6')], move: "20'", ml: 12, skill: 0, madness: '1', save: 15,
      abilities: [{ name: 'Inanimate', text: 'An animated object, not a living thing.' }] },
    { name: 'Shibboleth (Average)', desc: 'An alien intruder, usually insect- or octopus-like, that settles in isolated towns whose people cannot speak of it.',
      ac: 7, hd: '3', attacks: [a('tentacle', 2, 3, '1d8')], move: "30'", ml: 10, skill: 2, madness: '1d8', save: 14,
      abilities: [
        { name: 'Unnameable', text: 'Witnesses can’t speak, write, or hint about them. Fighting one needs a Mental Effect save, rerolled each round. Pushing through the silence costs 1d10 Madness and lasts one week.' },
        { name: 'Alien tech', text: 'Their devices crumble to powder when taken from their owners.' }] },
    { name: 'Spoken One', desc: 'A bull-sized mass of slimy tissue that grows stronger as fragments of its name are repeated, and buds human-seeming servants.',
      ac: 7, hd: '8', attacks: [a('tendril', 4, 6, '1d8', '+1d6 acid next round')], move: "20'", ml: 12, skill: 2, madness: '1d10',
      slaughterDie: '1d6', save: 11,
      abilities: [
        { name: 'Hardy', text: 'Immune to Slaughter. Bullets do minimum damage, but shotguns do normal damage.' },
        { name: 'Acidic', text: 'A melee attacker takes 1d6 each time they hit it. Its tendril hits do another 1d6 the following round.' }] },
    { name: 'Walker Between', desc: 'A ragged, faceless thing from the spaces between realms that wants to break every boundary, and opens gates for cults at a terrible price.',
      ac: 5, hd: '8', attacks: [a('claw', 2, null, '1d8')], atkBonus: 8, move: "100' teleport", ml: 12, skill: 2, madness: '1d8',
      slaughterDie: '1d12', save: 11,
      abilities: [
        { name: 'Distortion', text: 'Immune to all attacks and targeted spells from beyond melee range, and to Slaughter from mundane weapons.' },
        { name: 'Hit bonus', text: 'The book prints none for its claws; +8 (equal to its HD) is assumed here.' }] }
  ]);

  var fmtMod = function (n) { return (n >= 0 ? '+' : '') + n; };

  DATA.forEach(function (d) {
    var hpOnly = /hp$/.test(d.hd) ? d.hd : null;
    var hd = d.hd === '1 hp' ? '0' : d.hd === '1d4 hp' ? '½' : d.hd;
    var hdNum = hd === '½' ? 0.5 : parseFloat(hd) || 0;
    var hp = d.hd === '1 hp' ? 1 : d.hd === '1d4 hp' ? 2 : Math.floor(hdNum * 4.5);
    var save = d.save != null ? d.save : Math.ceil(15 - hdNum / 2);
    var first = d.attacks[0];
    var atkBonus = d.atkBonus != null ? d.atkBonus : (first && first.toHit != null ? first.toHit : 0);
    var attacksText = d.attacks.map(function (x) {
      var dmg = [x.damage, x.note].filter(Boolean).join(' ');
      return (x.count > 1 ? x.count + ' ' : '') + x.label + (x.toHit != null ? ' ' + fmtMod(x.toHit) : '') + (dmg ? ' (' + dmg + ')' : '');
    }).join(' + ');
    var abilities = (d.abilities || []).slice();
    if (d.mundaneImmune) abilities.unshift({ name: 'AC*', text: 'Resists ordinary harm: usually only a magical artifact or sorcery can hurt it.' });

    d.id = 'sl-' + d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    d.source = 'sl';
    d.ac = { asc: null, desc: d.ac, thac0: null };
    d.mundaneImmune = !!d.mundaneImmune;
    d.hd = hd;
    d.hdNum = hdNum;
    d.hp = hp;
    d.align = '';
    d.xp = null;
    d.moraleML = d.ml;
    delete d.ml;
    d.atkBonus = atkBonus;
    d.attacksText = attacksText;
    d.stats = null;
    d.saveTargets = { Save: save };
    d.savesText = save + '+';
    delete d.save;
    d.slaughterDie = d.slaughterDie || '1d6';
    d.abilities = abilities;
    d.raw = [d.name, d.desc,
      'AC ' + d.ac.desc + (d.mundaneImmune ? '*' : '') + ', HD ' + (hpOnly || hd) + ' (' + hp + 'hp), Atk ' + attacksText +
      ', Move ' + d.move + ', ML ' + d.moraleML + ', Skill ' + fmtMod(d.skill) + ', Madness ' + d.madness +
      ', Slaughter ' + d.slaughterDie + ', Save ' + d.savesText]
      .concat(abilities.map(function (x) { return x.name + '. ' + x.text; })).join('\n');
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  root.SL_MONSTER_LIBRARY = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
