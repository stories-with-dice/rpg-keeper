'use strict';

/*
 * Fate Core: the sheet text (js/fate.js), Fate dice, the ```fate fence,
 * the aspect tracker, the NPC and encounter generators (js/fate-npc.js,
 * js/fate-ui.js), Fate rows in Combat, and the Fate Compendium seed.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const { boot, rigRandom, face, click, setValue } = require('./helpers/boot.js');
const FateSheet = require('../js/fate.js');

const SHEET = '# Wyn [Fate]\n\nFate Points: 3/3\n\nAthletics: +2\n\n```fate\nHigh Concept: Knight of the Salt\nTrouble: Owes the King\n' +
  'Aspect: Never Again\n\nGreat (+4): Fight\nGood (+3): Will, Notice\nLore: +1\n\nStunt: Shield Wall. +2 to defend with Fight.\nRefresh: 3\n\n' +
  'Physical Stress: [ ] [ ] [ ]\nMental Stress: [ ] [ ] [ ] [ ]\n\nMild:\nModerate:\nSevere:\n```\n';
const NPC = 'Harbor Thug\nHigh Concept: Dockside Muscle\nFair (+2): Fight\nAverage (+1): Physique\nStress: [ ] [ ]\nMild:\nMob: 3';

async function fateBoot(opts) {
  const b = await boot(opts);
  const $ = s => b.window.document.querySelector(s);
  const $$ = s => Array.from(b.window.document.querySelectorAll(s));
  const tab = name => click($$('#tabs .tab-btn').find(x => x.dataset.tab === name));
  const fate = () => { tab('settings'); setValue($('#set-system'), 'fate'); };
  const logText = () => $$('#log-list li').map(li => li.textContent).join('\n');
  return Object.assign(b, { $, $$, tab, fate, logText });
}

test('FateSheet.parse: aspects, ladder and "Skill: +N" lines, stunts, stress, consequences, NPC name', () => {
  const d = FateSheet.parseNpc('Wyn\n' + SHEET.match(/```fate\n([\s\S]*?)```/)[1]);
  assert.equal(d.name, 'Wyn');
  assert.deepEqual(d.aspects.map(a => a.label + ': ' + a.text), ['High Concept: Knight of the Salt', 'Trouble: Owes the King', 'Aspect: Never Again']);
  assert.deepEqual(d.skills.map(s => s.name + ' ' + s.rank), ['Fight 4', 'Will 3', 'Notice 3', 'Lore 1']);
  assert.deepEqual(d.stunts, [{ name: 'Shield Wall', text: '+2 to defend with Fight.' }]);
  assert.equal(d.refresh, 3);
  assert.deepEqual(d.stress.map(t => t.name + ' ' + t.boxes.length), ['Physical Stress 3', 'Mental Stress 4']);
  assert.deepEqual(d.consequences.map(c => c.label + ' ' + c.value), ['Mild 2', 'Moderate 4', 'Severe 6']);
  assert.equal(FateSheet.ladderLabel(-1), 'Poor (−1)');
  assert.equal(FateSheet.ladderLabel(5), 'Superb (+5)');
});

test('FateSheet rewriters: check and clear one stress box, set a consequence, clear all stress', () => {
  let t = 'Physical Stress: [ ] [ ]\nMental Stress: [1] [2]\nMild:\nModerate: Old Wound';
  t = FateSheet.setStressBox(t, 1, 1, true);
  assert.equal(t.split('\n')[1], 'Mental Stress: [ ] [x]');
  t = FateSheet.setConsequence(t, 0, 'Bruised Ribs');
  assert.equal(t.split('\n')[2], 'Mild: Bruised Ribs');
  t = FateSheet.setConsequence(t, 1, '');
  assert.equal(t.split('\n')[3], 'Moderate:');
  assert.equal(FateSheet.clearStress(t).split('\n')[1], 'Mental Stress: [ ] [ ]');
});

test('Fate dice: 4dF terms roll −1/0/+1, a bare modifier rolls 4dF in Fate, the log shows the ladder, Invoke +2 adds to it', async () => {
  const { T, window, fate, $ } = await fateBoot();
  const restore = rigRandom(window, [face(3, 3), face(3, 3), face(2, 3), face(1, 3)]); // + + 0 −
  const r = T.evalFormula('4dF+2');
  assert.equal(r.total, 3);
  assert.ok(r.fate);
  assert.equal(T.evalFormula('+2').normalized, '1d20+2', 'outside Fate a bare modifier still rolls 1d20');
  fate();
  T.doRoll('+2', 'Test');
  assert.equal(T.lastFate.total, 3);
  assert.match($('#dice-last').textContent, /4dF \[[+0− ]{7}\] \+2 → Good \(\+3\)/, 'the four faces, then the ladder');
  assert.equal($('#dice-fate-actions').hidden, false, 'Invoke +2 / Reroll show after a Fate roll');
  click($('#dice-fate-invoke'));
  assert.equal(T.lastFate.total, 5);
  assert.match($('#dice-last').textContent, /Superb \(\+5\)/);
  assert.deepEqual(Array.from(window.document.querySelectorAll('#dice-grid button')).map(b => b.dataset.formula).slice(0, 3), ['4dF-1', '4dF', '4dF+1']);
  restore();
  window.close();
});

test('Fate character: the ```fate fence classifies it, renders the panel, rolls skills as 4dF+N, and View mode edits stress and consequences', async () => {
  const { T, window, fate, $, $$, tab, logText } = await fateBoot();
  fate();
  T.createCharacter(SHEET);
  const ch = T.activeChar();
  assert.equal(T.charSystemKey(ch), 'fate');
  assert.ok(!T.state.consumables.some(c => c.name === 'HP (Wyn)'), 'no HP tracker: Fate has stress boxes');
  assert.ok(T.state.consumables.some(c => c.name === 'Fate Points (Wyn)' && c.max === 3), 'Fate Points is a sheet resource');
  tab('character');
  assert.ok($('#mode-view .fate-sheet'));
  const fight = $$('#mode-view .fate-skill').find(s => s.textContent === 'Fight');
  assert.equal(fight.dataset.formula, '4dF+4');
  assert.equal($$('#mode-view .roll').find(s => s.dataset.varName === 'Athletics').dataset.formula, '4dF+2',
    'a "Skill: +N" line outside the fence rolls 4dF+N in Fate');
  assert.equal($$('#mode-view .fate-rank .roll').length, 0, 'the rank labels are not rolls');
  assert.ok(T.charVars(ch).some(v => v.name === 'Lore' && v.value === 1), 'fence skills are $variables');

  click($$('#mode-view .fate-box')[1]);
  assert.match(T.activeChar().body, /Physical Stress: \[ \] \[x\] \[ \]/);
  assert.match(logText(), /Physical Stress box 2 checked/);
  click($$('#mode-view .fate-box')[1]);
  assert.match(T.activeChar().body, /Physical Stress: \[ \] \[ \] \[ \]/, 'a checked box clears');

  const mild = $$('#mode-view .fate-cons')[0];
  mild.value = 'Sprained Wrist';
  mild.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.match(T.activeChar().body, /Mild: Sprained Wrist/);
  assert.match(logText(), /Mild consequence: Sprained Wrist/);
  window.close();
});

test('Aspect tracker: shows only in Fate; boosts go away when invoked; New scene keeps game aspects and gives the GM 1 fate point per PC', async () => {
  const { T, window, fate, $, $$ } = await fateBoot();
  assert.equal($('#fate-aspects-panel').hidden, true, 'hidden outside Fate');
  fate();
  assert.equal($('#fate-aspects-panel').hidden, false);
  T.createCharacter(SHEET);
  T.createCharacter(SHEET.replace('# Wyn', '# Ash'));
  T.addAspect('Thick Fog', 'scene');
  T.addAspect('Off Balance', 'boost');
  T.addAspect('The Crown Is Missing', 'game');
  assert.deepEqual($$('#fate-aspect-list .fate-asp-text').map(i => i.value), ['Thick Fog', 'Off Balance', 'The Crown Is Missing']);
  const boost = $$('#fate-aspect-list .fate-asp')[1];
  click(boost.querySelector('.fate-asp-invoke'));
  assert.deepEqual(T.state.fateScene.aspects.map(a => a.text), ['Thick Fog', 'The Crown Is Missing'], 'a boost is used up');
  click($$('#fate-aspect-list .fate-asp')[0].querySelector('.fate-asp-inc'));
  assert.equal(T.state.fateScene.aspects[0].invokes, 1);
  window.confirm = () => true;
  click($('#fate-new-scene'));
  assert.deepEqual(T.state.fateScene.aspects.map(a => a.text), ['The Crown Is Missing']);
  assert.equal(T.state.fateScene.gmPoints, 2, 'two Fate PCs');
  window.close();
});

test('NPC generator: the same seed makes the same NPC; its text parses back; Add to Bestiary and Combat', async () => {
  const { T, window, fate, $, tab } = await fateBoot();
  fate();
  const a = T.npcText(window.FateNpc.generateNpc(T.data.fate, { seed: 'fixed', importance: 'supporting', genre: 'fantasy' }));
  const b = T.npcText(window.FateNpc.generateNpc(T.data.fate, { seed: 'fixed', importance: 'supporting', genre: 'fantasy' }));
  assert.equal(a, b);
  const parsed = FateSheet.parseNpc(a);
  assert.ok(parsed.name && parsed.skills.length >= 3 && parsed.aspects.length >= 3);
  assert.deepEqual(parsed.stress.map(t => t.name), ['Physical Stress', 'Mental Stress']);

  tab('bestiary');
  assert.equal($('#fate-gen-open').hidden, false);
  click($('#fate-gen-open'));
  setValue($('#fg-seed'), 'fixed');
  click($('#fg-generate'));
  assert.ok(T.fateGenNpc, 'the preview NPC');
  click($('#fg-add-combat'));
  const def = T.state.monsters.find(m => m.source === 'fate');
  assert.equal(def.system, 'fate');
  assert.equal(def.importance, 'supporting');
  assert.ok(T.state.combat.entries.some(e => e.monster && e.monster.source === 'fate'));
  assert.match($('#mb-list').textContent, /Supporting · .*Peak /);
  window.close();
});

test('Encounter generator: Combat → Populate encounter adds every member and sets the GM fate points', async () => {
  const { T, window, fate, $, tab } = await fateBoot();
  fate();
  tab('combat');
  assert.match($('#cb-populate-hd').textContent, /Populate encounter/);
  click($('#cb-populate-hd'));
  assert.equal($('#fate-enc-modal').hidden, false);
  assert.equal($('#populate-hd-modal').hidden, true, 'not the HD modal');
  setValue($('#fe-level'), 'climactic');
  setValue($('#fe-pcs'), '4');
  setValue($('#fe-seed'), 'enc');
  click($('#fe-generate'));
  const n = T.fateGenEncounter.members.length;
  assert.ok(n >= 6, 'a boss, threats, a hitter, and a mob');
  click($('#fe-add'));
  assert.equal(T.state.combat.entries.length, n);
  assert.equal(T.state.fateScene.gmPoints, 4);
  assert.equal(T.state.monsters.filter(m => m.source === 'fate').length, 0, 'not added to the Bestiary unless ticked');
  window.close();
});

test('Fate in Combat: a stress box on a row, Taken out, Clear stress; a character\'s boxes are written to its sheet', async () => {
  const { T, window, fate, $, $$, tab } = await fateBoot();
  fate();
  T.createCharacter(SHEET);
  const ch = T.activeChar();
  const def = FateSheet.npcDef(NPC);
  def.id = 'thug'; def.system = 'fate';
  T.state.monsters.push(def);
  T.addMonsterEntry(def);
  T.addCharEntry(ch.id);
  tab('combat');
  const rows = () => $$('#tracker-list .cbt-row');
  click(rows()[0].querySelector('.cbt-fate-box[data-box="1"]'));
  assert.match(T.state.combat.entries[0].monster.raw, /Stress: \[ \] \[x\]/);
  assert.equal(T.state.monsters.find(m => m.id === 'thug').raw, NPC, 'the Bestiary def is untouched');
  click(rows()[1].querySelector('.cbt-fate-box[data-track="1"][data-box="0"]'));
  assert.match(T.state.characters[0].body, /Mental Stress: \[x\] \[ \] \[ \] \[ \]/);
  click(rows()[0].querySelector('.cbt-takenout'));
  assert.equal(T.entryDown(T.state.combat.entries[0]), true);
  assert.ok(rows()[0].classList.contains('is-down'));
  T.setSelected(T.state.combat.entries[0].id);
  click($('#combatant-detail .cbt-fate-clear'));
  assert.match(T.state.combat.entries[0].monster.raw, /Stress: \[ \] \[ \]/);
  assert.match(T.state.characters[0].body, /Mental Stress: \[ \] \[ \] \[ \] \[ \]/);
  assert.equal($('#dice-apply').hidden, true, 'no Apply damage in Fate');
  window.close();
});

test('Bestiary: a pasted Fate NPC (name first, --- between two) becomes a fate def', async () => {
  const { T, window, fate, $ } = await fateBoot();
  fate();
  T.openMonsterModal();
  setValue($('#mm-paste-area'), NPC + '\n---\nCult Fanatic\nHigh Concept: True Believer\nGood (+3): Will');
  click($('#mm-parse-lib'));
  const defs = T.state.monsters.filter(m => m.source === 'fate');
  assert.deepEqual(defs.map(d => d.name), ['Harbor Thug', 'Cult Fanatic']);
  assert.equal(defs[1].hdNum, 3, 'the peak skill is the level the Peak filter uses');
  assert.equal(T.levelLabel('fate'), 'Peak');
  window.close();
});

test('Compendium: a fresh install seeds the Fate stunts and aspects; Skill / kind and Setting filter them', async () => {
  const { T, window, fate, $, $$, tab } = await fateBoot({ freshSeed: true });
  const fateEntries = T.state.compendium.filter(e => e.system === 'fate');
  assert.ok(fateEntries.filter(e => e.category === 'Stunts').length > 500);
  assert.ok(fateEntries.filter(e => e.category === 'Aspects').length > 500);
  assert.ok(fateEntries.every(e => e.seedRef && e.ref), 'each has its own ref: names repeat');
  fate();
  tab('compendium');
  assert.equal($('#comp-skill-row').hidden, false);
  setValue($('#comp-skill'), 'Fight');
  const n = $$('#comp-list .comp-row').length;
  assert.equal(n, fateEntries.filter(e => e.skill === 'Fight').length);
  const fantasy = $$('#comp-settings input').find(i => i.dataset.setting === 'Generic');
  fantasy.checked = false;
  fantasy.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok($$('#comp-list .comp-row').length < n, 'unticking Generic hides the generic Fight stunts');
  window.close();
});
