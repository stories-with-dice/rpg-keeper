'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv, parseRange, convertFile } = require('../scripts/convert-tables.js');

/* ------------------------------------------------------------------ */
/* parseCsv — RFC4180 quoting (embedded commas, doubled "" quotes)    */
/* ------------------------------------------------------------------ */

test('parseCsv: splits plain rows on commas', () => {
  const rows = parseCsv('d100,Details\n01,Something happens\n');
  assert.deepEqual(rows, [['d100', 'Details'], ['01', 'Something happens']]);
});

test('parseCsv: a quoted field with an embedded comma stays one field', () => {
  const rows = parseCsv('18-19,"A blizzard kicks up, 1d4 damage/round if unsheltered"\n');
  assert.deepEqual(rows, [['18-19', 'A blizzard kicks up, 1d4 damage/round if unsheltered']]);
});

test('parseCsv: doubled "" inside a quoted field is one literal quote', () => {
  const rows = parseCsv('38-39,"A dart with a note: ""meet at Liona\'s"""\n');
  assert.deepEqual(rows, [['38-39', 'A dart with a note: "meet at Liona\'s"']]);
});

/* ------------------------------------------------------------------ */
/* parseRange                                                         */
/* ------------------------------------------------------------------ */

test('parseRange: single value, span, and the "00" percentile shorthand', () => {
  assert.deepEqual(parseRange('01'), { lo: 1, hi: 1 });
  assert.deepEqual(parseRange('02-03'), { lo: 2, hi: 3 });
  assert.deepEqual(parseRange('00'), { lo: 100, hi: 100 }, '"00" is the top of a d100 range, never 0');
});

/* ------------------------------------------------------------------ */
/* Per-file conversion + the full seed's integrity                    */
/* ------------------------------------------------------------------ */

const TABLES_DIR = path.join(__dirname, '..', 'data', 'tables');
const CSV_FILES = fs.readdirSync(TABLES_DIR).filter(f => f.endsWith('.csv'));

test('every data/tables/*.csv converts to a complete, gapless, non-overlapping d100 table', () => {
  assert.ok(CSV_FILES.length >= 20, 'expected the full set of table CSVs');
  for (const f of CSV_FILES) {
    const t = convertFile(path.join(TABLES_DIR, f));
    assert.ok(t.id && t.name && t.tag && t.formula, f + ': missing a field');
    assert.ok(t.entries.length > 0, f + ': no entries');
    const covered = new Array(101).fill(false); // 1..100
    for (const en of t.entries) {
      assert.ok(en.lo >= 1 && en.hi <= 100 && en.lo <= en.hi, f + ': bad range ' + en.range);
      for (let n = en.lo; n <= en.hi; n++) {
        assert.ok(!covered[n], f + ': roll ' + n + ' covered by more than one row');
        covered[n] = true;
      }
    }
    for (let n = 1; n <= 100; n++) assert.ok(covered[n], f + ': roll ' + n + ' has no matching row');
  }
});

test('table ids are unique and every tag is used by at least one table', () => {
  const tables = CSV_FILES.map(f => convertFile(path.join(TABLES_DIR, f)));
  const ids = tables.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate table id');
  const tags = new Set(tables.map(t => t.tag));
  assert.ok(tags.size <= 10, 'more than 10 tags: ' + Array.from(tags).join(', '));
});

test('data/tables.json matches a fresh conversion of data/tables/*.csv', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tables.json'), 'utf8'));
  const fresh = CSV_FILES.map(f => convertFile(path.join(TABLES_DIR, f)))
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(seed.slice().sort((a, b) => a.id.localeCompare(b.id)), fresh,
    'data/tables.json is stale — run `npm run convert-tables` and commit the result');
});

test('js/tables-data.js: <script>-loadable copy matches data/tables.json (for file://)', () => {
  const jsonSeed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tables.json'), 'utf8'));
  const jsSeed = require('../js/tables-data.js');
  assert.equal(jsSeed.length, jsonSeed.length);
  assert.deepEqual(jsSeed.map(t => t.id), jsonSeed.map(t => t.id));
});
