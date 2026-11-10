'use strict';

/*
 * Worlds Without Number: the sheet text and monster stat line (js/wwn.js),
 * the ```wwn fence, target-number rolls ("1d20>=14"), WWN monsters in the
 * Bestiary and Combat, the bundled seed (data/seed-wwn.json), the WWN tables,
 * and the condensed spell switch (a pack's entries with altOf / aka).
 * Pack text in this file is made up.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, rigRandom, face, click, setValue, answerImport } = require('./helpers/boot.js');
const W = require('../js/wwn.js');

const SHEET = '# Tamsin [WWN]\n\nHP: 8/8; System Strain: 0/14\n\n```wwn\nClass: Expert\nLevel: 1\n' +
  'STR 9  DEX 14  CON 12  INT 18  WIS 7  CHA 10\nAttack: +0\nSkills: Notice-1, Sneak-0 (DEX), Know-1\nFoci: Alert-1\nEffort: 1\n```\n';

async function wwnBoot(opts) {
  const b = await boot(opts);
  const $ = s => b.window.document.querySelector(s);
  const $$ = s => Array.from(b.window.document.querySelectorAll(s));
  const tab = name => click($$('#tabs .tab-btn').find(x => x.dataset.tab === name));
  const wwn = () => { tab('settings'); setValue($('#set-system'), 'wwn'); };
  const logText = () => $$('#log-list li').map(li => li.textContent).join('\n');
  return Object.assign(b, { $, $$, tab, wwn, logText });
}

test('WwnSheet.parse: class, level, attributes, attack, skills with an attribute, foci; modifiers and saves', () => {
  const d = W.parse(SHEET.match(/```wwn\n([\s\S]*?)```/)[1]);
  assert.equal(d.cls, 'Expert');
  assert.equal(d.level, 1);
  assert.deepEqual(d.attrs, { STR: 9, DEX: 14, CON: 12, INT: 18, WIS: 7, CHA: 10 });
  assert.equal(d.attack, 0);
  assert.deepEqual(d.skills, [{ name: 'Notice', level: 1, attr: null }, { name: 'Sneak', level: 0, attr: 'DEX' }, { name: 'Know', level: 1, attr: null }]);
  assert.deepEqual(d.foci, [{ name: 'Alert', level: 1 }]);
  assert.deepEqual([3, 4, 7, 8, 13, 14, 17, 18].map(W.attrMod), [-2, -1, -1, 0, 0, 1, 1, 2]);
  // 16 − level − the better modifier: Physical (STR 9, CON 12) 15, Evasion (DEX +1, INT +2) 13, Mental (WIS −1, CHA 0) 15, Luck 15
  assert.deepEqual(W.saves(d).map(s => s.name + ' ' + s.target), ['Physical 15', 'Evasion 13', 'Mental 15', 'Luck 15']);
  assert.deepEqual(W.skillCheck(d, d.skills[0]), { attr: 'WIS', formula: '2d6+0' }, 'Notice adds WIS −1');
  assert.deepEqual(W.skillCheck(d, d.skills[2]), { attr: 'INT', formula: '2d6+3' });
});

test('WwnSheet monsters: a book table row, the keyed text, and Shock', () => {
  const d = W.parseStatLine("Barbarian Warlord  8  16a  +10 x2  Wpn+4  Wpn+4/-  30'  10  3  +2  11+");
  assert.equal(d.name, 'Barbarian Warlord');
  assert.equal(d.source, 'wwn');
  assert.deepEqual([d.hd, d.hdNum, d.hp, d.ac.asc, d.armored], ['8', 8, 36, 16, true]);
  assert.deepEqual(d.attacks.map(a => [a.count, a.toHit, a.damage, a.note]), [[2, 10, '', 'by weapon+4']]);
  assert.deepEqual([d.moraleML, d.instinct, d.skill, d.saveTargets.Save, d.savesText], [10, 3, 2, 11, '11+']);
  const again = W.parseMonsterText(d.raw + '\nA warlord of the steppe.');
  assert.equal(again.statLine, d.statLine, 'the keyed text parses back to the same stats');
  assert.equal(again.desc, 'A warlord of the steppe.');
  const two = W.parseMonsters("Thug  1  13a  +1  Wpn  Wpn  30'  8  4  +1  15+\nWolf  2  12  +2  1d6  1/13  40'  7  6  +1  14+");
  assert.deepEqual(two.map(m => m.name), ['Thug', 'Wolf']);
  assert.equal(W.shockText('2/13'), '2 damage on a miss vs AC 13 or less');
  assert.equal(W.shockText('-'), 'None');
});

test('the bundled WWN seed: spells, arts, foci, and monsters are in the WWN Compendium and Bestiary', async () => {
  const { T, $$, tab, wwn } = await wwnBoot();
  assert.ok(T.seedWwn() > 250, 'the boot of a test resets the state; a first run seeds it (js/seed.js seedMissing)');
  wwn();
  const comp = T.compendiumForSystem();
  assert.ok(comp.filter(e => e.category === 'Spells').length >= 80, 'the High Magic, Elementalist, and Necromancer spells');
  assert.ok(comp.some(e => e.name === 'The Coruscating Coffin' && /Level 1/.test(e.source)));
  assert.ok(comp.some(e => e.name === 'Alert' && e.source === 'Focus'));
  assert.ok(comp.every(e => e.seedRef && e.system === 'wwn'));
  const mons = T.monstersForSystem();
  assert.ok(mons.length >= 90);
  assert.ok(mons.every(m => m.source === 'wwn' && m.hdNum > 0 && m.saveTargets.Save));
  tab('bestiary');
  assert.ok($$('#mb-list .comp-name').map(n => n.textContent).includes('Veteran Soldier'));
  tab('tables');
  assert.ok(T.data.tables.some(t => t.name === 'WWN Human Encounters' && t.origin === 'Worlds Without Number'));
});

test('System switch: WWN gets its own Character dropdown, Compendium, Bestiary, and HP + System Strain trackers', async () => {
  const { T, $, $$, tab, wwn, window } = await wwnBoot();
  T.reset();
  T.createCharacter('# Garrick [Shadowdark]\nHP: 5/5');
  T.createCharacter(SHEET);
  T.state.compendium.push({ id: 'cw1', name: 'Alert', category: 'Abilities', source: 'Focus', body: 'Hard to surprise.', system: 'wwn' });
  T.state.monsters.push(Object.assign(W.parseStatLine("Thug  1  13a  +1  Wpn  Wpn  30'  8  4  +1  15+"), { id: 'mw1', system: 'wwn' }));
  T.renderAll();
  wwn();
  tab('character');
  assert.deepEqual($$('#char-select option').map(o => o.textContent), ['Tamsin (WWN)']);
  assert.deepEqual($$('#consumables-list .cons-row').map(r => r.dataset.name), ['HP (Tamsin)', 'System Strain (Tamsin)']);
  tab('compendium');
  assert.deepEqual($$('#comp-list .comp-name').map(n => n.textContent), ['Alert']);
  tab('bestiary');
  assert.deepEqual($$('#mb-list .comp-name').map(n => n.textContent), ['Thug']);
  assert.equal($('#mb-gen').hidden, true, 'the Shadowdark PL generator is hidden for WWN');
  tab('settings');
  assert.equal($('#set-wwn-spells-row').hidden, false);
  setValue($('#set-system'), 'shadowdark');
  assert.equal($('#set-wwn-spells-row').hidden, true);
  tab('character');
  assert.deepEqual($$('#char-select option').map(o => o.textContent), ['Garrick (Shadowdark)']);
  assert.equal(T.state.characters.length, 2, 'nothing deleted by switching');
  window.close();
});

test('the ```wwn panel: saves roll 1d20 against the target, skills roll 2d6 + skill + attribute', async () => {
  const { T, $, $$, wwn, logText, window } = await wwnBoot();
  T.reset();
  wwn();
  T.createCharacter(SHEET);
  T.refreshCharUI();
  const panel = $('#mode-view .wwn-sheet');
  assert.ok(panel, 'the fence renders as a panel');
  assert.deepEqual($$('#mode-view .wwn-save').map(s => s.textContent), ['Physical 15+', 'Evasion 13+', 'Mental 15+', 'Luck 15+']);
  assert.deepEqual($$('#mode-view .wwn-skill').map(s => s.dataset.formula), ['2d6+0', '2d6+1', '2d6+3']);
  let restore = rigRandom(window, [face(15, 20)]);
  click($$('#mode-view .wwn-save')[1]);
  restore();
  assert.match(logText(), /1d20 ≥ 13/);
  assert.match(logText(), /vs 13: Success \(\+2\)/);
  restore = rigRandom(window, [face(2, 20)]);
  click($$('#mode-view .wwn-save')[0]);
  restore();
  assert.match(logText(), /vs 15: Failure \(-13\)/);
  window.close();
});

test('a target roll keeps working with modifiers added after the target', async () => {
  const { T, logText, window } = await wwnBoot();
  const restore = rigRandom(window, [face(10, 20)]);
  T.doRoll('1d20>=14+2', 'Test');
  restore();
  assert.match(logText(), /1d20\+2 ≥ 14/);
  assert.match(logText(), /vs 14: Failure \(-2\)/);
  window.close();
});

test('Combat: a WWN monster shows Skill, Instinct, and Shock; Instinct rolls 1d10 against the score; a hit names the AC', async () => {
  const { T, $, logText, window } = await wwnBoot();
  T.reset();
  T.state.settings.system = 'wwn';
  const d = Object.assign(W.parseStatLine("Wolf  2  12  +2  1d6  1/13  40'  7  6  +1  14+"), { id: 'mw2', system: 'wwn' });
  T.state.monsters.push(d);
  T.addMonsterEntry(d);
  T.state.combat.selectedId = T.state.combat.entries[0].id;
  T.renderAll();
  const detail = $('#combatant-detail');
  assert.ok(detail.querySelector('.cbt-instinct'), 'an Instinct button');
  assert.match(detail.textContent, /1d10 vs 6/);
  assert.match(detail.textContent, /1\/13/);
  let restore = rigRandom(window, [face(4, 10)]);
  click(detail.querySelector('.cbt-instinct'));
  restore();
  assert.match(logText(), /acts on instinct/);
  restore = rigRandom(window, [face(9, 20)]);
  click(detail.querySelector('.cbt-atk'));
  restore();
  assert.match(logText(), /hits AC 11 or less; on a miss, Shock 1 if AC 13 or less/);
  window.close();
});

test('Bestiary: WWN monsters are pasted as text (a name and a keyed stat line, or book rows), and edited the same way', async () => {
  const { T, $, wwn, window } = await wwnBoot();
  T.reset();
  wwn();
  T.openMonsterModal();
  setValue($('#mm-paste-area'), "Bandit Captain\nHD 3, AC 15a, Atk +4, Dmg Wpn+1, Shock Wpn+1, Move 30', ML 9, Inst 3, Skill +1, Save 14+\nLeads the band.");
  click($('#mm-parse-lib'));
  const m = T.state.monsters.find(x => x.name === 'Bandit Captain');
  assert.ok(m);
  assert.deepEqual([m.system, m.hd, m.ac.asc, m.instinct, m.desc], ['wwn', '3', 15, 3, 'Leads the band.']);
  window.close();
});

const condensedPack = () => ({
  pack: { name: 'Condensed test pack', system: 'wwn' },
  compendium: [{ ref: 'test:c:spark', name: 'Sparky Bolt', category: 'Spells', source: 'Test (condensed)',
    altOf: 'wwn:spell:the-coruscating-coffin', aka: 'The Coruscating Coffin', body: 'Short made-up text.' }]
});

test('condensed spells: Settings → WWN spell text switches between the book entry and the pack entry; the book name finds both', async () => {
  const { T, $, tab, wwn, window } = await wwnBoot();
  T.seedWwn();
  wwn();
  await answerImport(window, () => T.importData(new window.File([JSON.stringify(condensedPack())], 'pack.json', { type: 'application/json' })));
  const alt = T.state.compendium.find(e => e.name === 'Sparky Bolt');
  assert.deepEqual([alt.altOf, alt.aka, alt.system], ['wwn:spell:the-coruscating-coffin', 'The Coruscating Coffin', 'wwn']);
  const names = () => T.compendiumForSystem().map(e => e.name);
  assert.ok(names().includes('The Coruscating Coffin'));
  assert.ok(!names().includes('Sparky Bolt'), 'book mode hides the condensed entry');
  tab('settings');
  setValue($('#set-wwn-spells'), 'condensed');
  assert.equal(T.state.settings.wwnSpellText, 'condensed');
  assert.ok(names().includes('Sparky Bolt'));
  assert.ok(!names().includes('The Coruscating Coffin'), 'condensed mode hides the book entry it replaces');
  assert.deepEqual(T.compByExactName('The Coruscating Coffin').map(e => e.name), ['Sparky Bolt'], 'a [Book Name] link finds the condensed entry');
  setValue($('#set-wwn-spells'), 'book');
  assert.deepEqual(T.compByExactName('The Coruscating Coffin').map(e => e.name), ['The Coruscating Coffin']);
  window.close();
});
