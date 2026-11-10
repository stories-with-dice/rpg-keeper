'use strict';

/*
 * The Downtime tab (Shadowdark only): js/downtime.js (pure rules engine) and
 * js/downtime-ui.js (the tab), with data/downtime-shadowdark.json.
 */

const { test } = require('node:test');
// Values from the app live in jsdom's realm: compare them with deepEqual, not deepStrictEqual.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../js/downtime.js');
const { boot } = require('./helpers/boot.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'downtime-shadowdark.json'), 'utf8'));
const gulzund = fs.readFileSync(path.join(__dirname, '..', 'data', 'gulzund-blize-shadowdark.txt'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

// Fixed dice: spec is [[face, sides], ...], one pair per die() call.
// die(sides) = floor(rng() * sides) + 1, so face f of an n-sided die is (f - 0.5) / n.
function rngFor(spec) {
  const q = spec.slice();
  return () => { const s = q.shift(); return s ? (s[0] - 0.5) / s[1] : 0.01; };
}
const pc = extra => Object.assign(D.newRecord(), {
  id: 'p1', name: 'Pip', level: 1, xp: 0, luck: 0, mods: { STR: 0, DEX: 0, CON: 0, INT: 2, WIS: 0, CHA: 1 }, hd: 'd4', caster: 'INT',
  renown: 0, gp: 1000
}, extra || {});

test('data/downtime-shadowdark.json: event sets, activities, and every table they name', () => {
  assert.deepEqual(data.eventSets.map(s => s.kind), ['core', 'wr', 'devotion', 'training', 'study']);
  data.eventSets.forEach(s => assert.ok(data.tables[s.outcome], s.outcome));
  ['wrpg-carousing-benefit-benefit', 'wrpg-carousing-mishap-mishap', 'core-treasure-0-3', 'gmc-treasure-10', 'core-rumors']
    .forEach(id => assert.ok(data.tables[id], id));
  assert.equal(data.tables['wrpg-carousing-benefit-benefit'].rows.length, 100);
  assert.deepEqual(data.activities.map(a => a.key), ['learning', 'spiritualism', 'skulduggery', 'martial', 'research']);
  assert.deepEqual(data.classes.Wizard, { hd: 'd4', caster: 'INT' });
  assert.deepEqual(data.classes.Priest, { hd: 'd6', caster: 'WIS' });
  assert.deepEqual(data.classes.Fighter, { hd: 'd8', caster: 'none' });
});

test('readSheet / writeSheetNumber: level, XP, luck, stat modifiers, and class from a Shadowdark sheet', () => {
  const s = D.readSheet(gulzund, data.classes);
  assert.deepEqual(s, { level: 1, xp: 0, luck: 0, mods: { STR: -1, DEX: 1, CON: 3, INT: 0, WIS: 0, CHA: 4 }, className: 'Witch', hd: 'd4', caster: 'CHA' });
  const after = D.writeSheetNumber(D.writeSheetNumber(gulzund, 'XP', 7), 'Luck', 2);
  assert.match(after, /\*\*XP\*\* 7/);
  assert.match(after, /\*\*XP:\*\* 7/, 'the Advancement line too');
  assert.match(after, /\*\*Luck\*\* 🍀 2/);
  assert.match(D.writeLevel(gulzund, 2), /Level 2 Lawful/);
  assert.equal(D.sheetHas('# Bob\nSTR +1', 'XP'), false);
  assert.equal(D.readSheet('# Bob\nLevel 3\n- STR +2\n- CHA: -1\nXP: 12', data.classes).xp, 12);
});

test('small rules: renown bonus, lowered DC, XP to level', () => {
  assert.deepEqual([3, 4, 8, 12].map(D.renownBonus), [0, 1, 2, 3]);
  assert.deepEqual([0, 1, 2, 3, 4].map(n => D.loweredDc(18, n)), [18, 15, 12, 9, 9]);
  assert.equal(D.loweredDc(9, 2), 9);
  assert.deepEqual([0, 1, 4].map(D.xpToLevel), [10, 10, 40]);
});

test('applyText: wealth, renown, luck, next-roll bonuses, and debts from result text', () => {
  const ctx = { rng: () => 0.5, treasureRules: 'core', wr: true, tag: 't' };
  let p = pc();
  D.applyText(data, p, 'A gloating thief burgled 50% of your wealth; -3 renown', ctx);
  assert.equal(p.gp, 500);
  assert.equal(p.renown, -3);
  p = pc();
  D.applyText(data, p, 'You lost a bet to a hated rival; -1 renown and lose 50 gp', ctx);
  assert.equal(p.gp, 950);
  D.applyText(data, p, 'You won 50 gp against a famous gambler; +1 renown', ctx);
  assert.equal(p.gp, 1000);
  assert.equal(p.renown, 0);
  D.applyText(data, p, 'Gain 4 XP and a luck token', ctx);
  assert.equal(p.xp, 4);
  assert.equal(p.luck, 1);
  D.applyText(data, p, 'You outsing a famous bard; +5 to next carousing event roll', ctx);
  assert.equal(p.nextCarouse, 5);
  D.applyText(data, p, 'Gain 4 XP and a debt equal to half of your remaining gp', ctx);
  assert.ok(p.ongoing.some(o => /Debt: 500 gp/.test(o)));
  D.applyText(data, p, 'You got an awful, hidden tattoo; -1 renown if anyone sees it', ctx);
  assert.equal(p.renown, 0, 'a conditional renown loss is not applied');
  const lines = D.applyText(data, p, 'Gain 6 XP and an 80- 100 item from your treasure table', ctx);
  assert.ok(lines.some(l => l.kind === 'treasure' && l.tableId === 'core-treasure-0-3'));
});

test('carouse (Western Reaches): pays the share, rolls 1d8 + bonuses, applies XP and the d100 rolls', () => {
  const set = data.eventSets.find(s => s.kind === 'wr');
  const ev = set.events[1]; // 100 gp, +1
  // d8 = 8 → total 8 + 1 + 1 renown (renown 4) = 10: 1 mishap, 1 benefit, XP 5.
  // benefit d100 = 15 (+1 renown), mishap d100 = 63 (-1 renown).
  const rng = rngFor([[8, 8], [15, 100], [63, 100]]);
  const out = D.carouse({ data, set, event: ev, pcs: [pc({ renown: 4 }), pc({ id: 'p2', name: 'Out' })], ids: ['p1'], group: [], useRenown: true, rng });
  const r = out.results[0];
  assert.equal(out.share, 100);
  assert.equal(r.total, 10);
  assert.equal(r.xp, 5);
  assert.equal(r.gpAfter, 900);
  const p1 = out.pcs.find(p => p.id === 'p1');
  assert.equal(p1.renown, 4, '+1 from the benefit, -1 from the mishap');
  assert.equal(p1.usedDowntime, true);
  assert.ok(r.lines.some(l => l.kind === 'benefit' && /arm-wrestling/.test(l.text)));
  assert.ok(r.lines.some(l => l.kind === 'mishap' && /unflattering new nickname/.test(l.text)));
  assert.strictEqual(out.pcs.find(p => p.id === 'p2').usedDowntime, false, 'a PC who did not take part is unchanged');
});

test('carouse (core): the outcome text gives XP, a wealth loss, and a one-time bonus is used up', () => {
  const set = data.eventSets.find(s => s.kind === 'core');
  // d8 = 1, +0 event, +1 one-time = 2: stocks, fined 20% of total wealth, 2 XP.
  const out = D.carouse({ data, set, event: set.events[0], pcs: [pc({ nextCarouse: 1, gp: 130 })], ids: ['p1'], group: [], useRenown: false, rng: rngFor([[1, 8], [2, 4]]) });
  const p = out.pcs[0];
  assert.equal(out.results[0].total, 2);
  assert.equal(p.xp, 2);
  assert.equal(p.gp, 80, '130 − 30 = 100, then −20%');
  assert.equal(p.nextCarouse, 0);
  assert.match(out.results[0].lines.find(l => l.kind === 'outcome').text, /stocks for 1d4 \[2\] days/);
});

test('downtimeCheck: a failure lowers the DC next time, a success resets it, and costs are paid', () => {
  const act = data.activities.find(a => a.key === 'spiritualism');
  const opt = act.groups[0].options.find(o => o.key === 'insight'); // DC 15, 50 gp
  let r = D.downtimeCheck({ pc: pc(), activity: act, option: opt, rng: rngFor([[3, 20]]) });
  assert.equal(r.success, false);
  assert.equal(r.pc.gp, 950);
  assert.equal(r.pc.failures['spiritualism.insight'], 1);
  assert.equal(D.checkDc(r.pc, act, opt).dc, 12);
  r = D.downtimeCheck({ pc: r.pc, activity: act, option: opt, rng: rngFor([[12, 20]]) });
  assert.equal(r.success, true);
  assert.equal(r.pc.failures['spiritualism.insight'], 0);
  const strength = act.groups[0].options.find(o => o.key === 'strength');
  r = D.downtimeCheck({ pc: pc(), activity: act, option: strength, rng: rngFor([[20, 20]]) });
  assert.equal(r.pc.xp, 2);
  const bard = D.downtimeCheck({ pc: pc({ bardAdv: true }), activity: act, option: strength, rng: rngFor([[2, 20], [19, 20]]) });
  assert.equal(bard.success, true, 'ADV takes the higher die');
});

test('downtimeCheck: a Skulduggery rumor changes another PC\'s renown; spell checks use the casting stat', () => {
  const sk = data.activities.find(a => a.key === 'skulduggery');
  const rumor = sk.groups[0].options.find(o => o.rumor);
  const r = D.downtimeCheck({ pc: pc(), activity: sk, option: rumor, rumorTarget: { id: 'p9', dir: -1 }, rng: rngFor([[15, 20]]) });
  assert.deepEqual(r.rumor, { id: 'p9', dir: -1 });
  const research = data.activities.find(a => a.key === 'research');
  const g = research.groups.find(x => D.groupApplies(x, pc()));
  assert.match(g.label, /INT or CHA/);
  assert.deepEqual(D.bestStat(pc(), g.options[0]), { stat: 'INT (spellcasting)', mod: 2 });
  assert.equal(research.groups.filter(x => D.groupApplies(x, pc({ caster: 'CHA' }))).length, 2, 'a CHA caster sees both lists');
});

test('Wizards and Thieves: a full game keeps every coin', () => {
  for (let i = 0; i < 20; i++) {
    const g = D.wizardsAndThieves([{ name: 'A', coins: 20 }, { name: 'B', coins: 20 }, { name: 'C', coins: 20 }]);
    const left = /Pot of (\d+) left/.exec(g.log[g.log.length - 1]);
    assert.equal(g.final.reduce((a, p) => a + p.coins, 0) + (left ? +left[1] : 0), 60);
    assert.ok(g.winner);
  }
});

test('Downtime tab: shows only in Shadowdark; a carousing roll writes XP into the sheet and the rest into the record', async () => {
  const { T, window, document } = await boot();
  const $ = s => document.querySelector(s);
  const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };
  T.createCharacter(gulzund);
  const ch = T.state.characters[T.state.characters.length - 1];
  T.setSystem('shadowdark');
  assert.equal($('.tab-btn[data-tab="downtime"]').hidden, false);
  T.showTab('downtime');
  assert.match($('#dt-root').textContent, /Gulzund Blize/);
  assert.equal(T.downtimePc(ch).renown, 4, 'renown starts at the CHA modifier');

  T.state.downtime.records[ch.id] = Object.assign(T.Downtime.newRecord(), { gp: 300 });
  T.state.downtime.ui.kind = 'core';
  T.state.downtime.ui.eventIdx = 0;
  T.state.downtime.ui.ids = [ch.id];
  T.renderDowntime();
  $('[data-dt-view="carousing"]').click();
  const go = $('[data-act="carouse"]');
  assert.equal(go.disabled, false);
  go.click();
  await settle();
  const rec = T.state.downtime.records[ch.id];
  assert.ok(rec.gp <= 270, 'the 30 gp share is paid');
  assert.equal(rec.usedDowntime, true);
  const xp = T.Downtime.readSheet(ch.body, T.data.downtime.classes).xp;
  assert.ok(xp >= 2, 'the sheet has the new XP');
  assert.match(T.state.log[T.state.log.length - 1].formula, /Carousing \(core\)/);

  $('[data-act="undo"]').click();
  await settle();
  assert.equal(T.Downtime.readSheet(ch.body, T.data.downtime.classes).xp, 0, 'Undo restores the sheet');
  assert.equal(T.state.downtime.records[ch.id].gp, 300);

  T.setSystem('wwn');
  assert.equal($('.tab-btn[data-tab="downtime"]').hidden, true);
  assert.equal($('.tab-btn.is-active').dataset.tab, 'character', 'the open Downtime tab closes');
  window.close();
});

test('state.downtime: ensureStateShape fills the form defaults and drops records of deleted characters', async () => {
  const { T, window } = await boot();
  T.state.downtime = { records: { gone: { gp: '5' } }, ui: { kind: 'wr' } };
  T.ensureStateShape();
  assert.deepEqual(T.state.downtime.records, {});
  assert.equal(T.state.downtime.ui.kind, 'wr');
  assert.equal(T.state.downtime.ui.wtCoins, 20);
  window.close();
});
