'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const TS = require('../js/table-syntax.js');

// A ctx whose dice return the queued totals in order; resolve() looks up `tables` by name.
function ctx(tables, totals) {
  const q = totals.slice();
  return {
    resolve: name => tables.find(t => t.name.toLowerCase() === String(name).trim().toLowerCase()) || null,
    roll: f => (TS.formulaRange(f) ? { total: q.shift(), detail: f } : null)
  };
}
const table = (name, source) => Object.assign(TS.parseTable(source), { id: name, name });

test('formulaRange: plain dice, sums, keep-highest, and non-dice', () => {
  assert.deepEqual(TS.formulaRange('d12'), { min: 1, max: 12 });
  assert.deepEqual(TS.formulaRange('2d6+1'), { min: 3, max: 13 });
  assert.deepEqual(TS.formulaRange('4d6kh3'), { min: 3, max: 18 });
  assert.deepEqual(TS.formulaRange('d%'), { min: 1, max: 100 });
  assert.equal(TS.formulaRange('twelve'), null);
  assert.equal(TS.formulaRange('5'), null, 'a bare number is not a die');
});

test('parseTable: ranges with - or –, "0" as 10 on a d10, auto-numbered lines, comments', () => {
  const t = TS.parseTable('d10\n# kinds of place\n1-2: A ruin\n3–5: A camp\n6: A tower\nA well\n8-0: Open ground\n');
  assert.deepEqual(t.entries.map(e => [e.lo, e.hi, e.text]),
    [[1, 2, 'A ruin'], [3, 5, 'A camp'], [6, 6, 'A tower'], [7, 7, 'A well'], [8, 10, 'Open ground']]);
  assert.deepEqual(t.problems, []);
});

test('parseTable: "00" is 100 on a d100; a text colon without digits is not a range', () => {
  const t = TS.parseTable('d100\n01-99: Calm\n00: Storm: heavy\n');
  assert.deepEqual(t.entries.map(e => [e.lo, e.hi]), [[1, 99], [100, 100]]);
  const u = TS.parseTable('d2\nSticky: slows you\nBright: shines\n');
  assert.deepEqual(u.entries.map(e => [e.lo, e.text]), [[1, 'Sticky: slows you'], [2, 'Bright: shines']]);
});

test('parseTable: reports a bad die, gaps, overlaps, out-of-range values, and cell-count mismatches', () => {
  assert.equal(TS.parseTable('twelve\n1: x').problems[0].level, 'error');
  assert.equal(TS.parseTable('d6\n').problems[0].msg, 'The table has no entries.');
  const msgs = TS.parseTable('d6 | A | B\n1-2: x | y\n2: x | y\n7: z\n').problems.map(p => p.msg);
  assert.ok(msgs.some(m => /overlaps line 2 at 2/.test(m)), msgs.join('; '));
  assert.ok(msgs.some(m => /No entry for 3–6/.test(m)), msgs.join('; '));
  assert.ok(msgs.some(m => /7 is outside d6/.test(m)), msgs.join('; '));
  assert.ok(msgs.some(m => /has 1 cells; line 1 has 2 columns/.test(m)), msgs.join('; '));
});

test('rollTable: a master table rolls on sub-tables, a column, dice, and repeats', () => {
  const words = table('Words', 'd2 | Kind | Color\n1: Order | Grey\n2: Ring | Teal\n');
  const beast = table('Beast', 'd2\n1: owl\n2: [Words.Color] newt\n');
  const master = table('Name', 'd4\n1: The [Words.Kind] of the [Words.Color] [Beast]\n2: [2x Beast]\n3: [1d3] [Words]\n4: [Nothing]\n');
  const all = [words, beast, master];

  let tree = TS.rollTable(master, ctx(all, [1, 1, 2, 2, 1]));
  assert.equal(TS.nodeText(tree), 'The Order of the Teal Grey newt');
  assert.equal(tree.parts[1].column, 'Kind');

  tree = TS.rollTable(master, ctx(all, [2, 1, 1]));
  assert.equal(TS.nodeText(tree), 'owl, owl');
  assert.equal(tree.parts[0].kind, 'repeat');

  tree = TS.rollTable(master, ctx(all, [3, 2, 2]));
  assert.equal(TS.nodeText(tree), '2 Ring / Teal', 'no column: every cell, joined');

  tree = TS.rollTable(master, ctx(all, [4]));
  assert.equal(TS.nodeText(tree), '[Nothing?]');
  assert.match(tree.parts[0].error, /no table named "Nothing"/);
});

test('rollTable: a table that rolls on itself stops with an error', () => {
  const loop = table('Loop', 'd1\n1: again [Loop]\n');
  const tree = TS.rollTable(loop, ctx([loop], [1, 1]));
  assert.equal(TS.nodeText(tree), 'again [Loop?]');
  assert.match(tree.parts[1].error, /rolls on itself/);
});

test('rerollAt: rolls one sub-result again and keeps the rest', () => {
  const color = table('Color', 'd3\n1: red\n2: blue\n3: green\n');
  const master = table('M', 'd1\n1: A [Color] cat with [Color] eyes\n');
  const c = ctx([color, master], [1, 1, 2, 3]);
  const tree = TS.rollTable(master, c);
  assert.equal(TS.nodeText(tree), 'A red cat with blue eyes');
  TS.rerollAt(tree, [3], c);
  assert.equal(TS.nodeText(tree), 'A red cat with green eyes');
  assert.equal(TS.nodeAt(tree, [3]).roll, 3);
});

test('highlight: keeps the text and marks ranges, refs, dice, unknown refs, and pipes', () => {
  const sub = table('Sub', 'd2\n1: a\n2: b\n');
  const src = 'd6 | A\n1-2: [Sub] [1d4] [Nope] | x\n';
  const html = TS.highlight(src, ctx([sub], []).resolve);
  assert.equal(html.replace(/<[^>]+>/g, ''), src + '\n');
  assert.match(html, /<span class="hl-range">1-2: <\/span>/);
  assert.match(html, /<span class="hl-ref">\[Sub\]<\/span>/);
  assert.match(html, /<span class="hl-dice">\[1d4\]<\/span>/);
  assert.match(html, /<span class="hl-bad">\[Nope\]<\/span>/);
  assert.match(html, /<span class="hl-pipe">\|<\/span>/);
});

test('renameRefs: renames plain, column, and repeated refs; leaves other names', () => {
  assert.equal(TS.renameRefs('[Old] [old.Hue] [2x Old] [Older] [1d4]', 'Old', 'New'),
    '[New] [New.Hue] [2x New] [Older] [1d4]');
});

test('toSource: a built-in table round-trips through parseTable', () => {
  const t = { formula: 'd100', entries: [{ range: '01-99', lo: 1, hi: 99, text: 'Calm' }, { range: '00', lo: 100, hi: 100, text: 'Storm' }] };
  const back = TS.parseTable(TS.toSource(t));
  assert.deepEqual(back.entries.map(e => [e.lo, e.hi, e.text]), [[1, 99, 'Calm'], [100, 100, 'Storm']]);
});
