#!/usr/bin/env node
'use strict';

/*
 * convert-tables.js — convert the RFC4180 CSV random tables in data/tables/
 * (one file per table, header row "<formula>,Details", e.g. "d100,Details")
 * into the app's internal table format and write the seed library
 * (data/tables.json + js/tables-data.js, mirroring scripts/convert-bestiary.js).
 *
 * Each CSV row is `range,text`: range is a single value ("01"), a span
 * ("02-03"), or "00" (percentile-dice shorthand for the top of a d100
 * range, e.g. after "98-99" — parsed as 100, not 0).
 *
 * A table's tag comes from TAG_MAP (by filename slug) below — keep this in
 * sync when adding a new table CSV. See AGENTS.md's "Tables tab" section.
 *
 * Usage:
 *   node scripts/convert-tables.js [--dir data/tables] [--out data/tables.json]
 *                                  [--js-out js/tables-data.js] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const TAG_MAP = {
  arctic: 'Wilderness', desert: 'Wilderness', forest: 'Wilderness', grassland: 'Wilderness',
  jungle: 'Wilderness', mountain: 'Wilderness', swamp: 'Wilderness',
  ocean: 'Aquatic', river_and_coast: 'Aquatic',
  cave: 'Underground', deep_tunnels: 'Underground', ruins: 'Underground', tomb: 'Underground',
  artisan_district: 'City', castle_district: 'City', high_district: 'City', low_district: 'City',
  market: 'City', slums: 'City', temple_district: 'City', university_district: 'City',
  tavern: 'Tavern'
};

// Display-name overrides for slugs that don't title-case cleanly.
const NAME_MAP = { river_and_coast: 'River & Coast' };

function titleCase(slug) {
  return slug.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Minimal RFC4180 CSV parser: handles quoted fields with embedded commas,
// newlines, and doubled ("") quotes — this data has both (e.g. market.csv's
// `"A dart with a note lands at a PC's feet: ""meet at Liona's"""`).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// "01" -> {lo:1,hi:1}; "02-03" -> {lo:2,hi:3}; "00" -> {lo:100,hi:100}
// (percentile-dice shorthand for the top of the range, never a literal 0).
function parseRange(token) {
  const t = token.trim();
  if (t === '00') return { lo: 100, hi: 100 };
  const m = t.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const lo = parseInt(m[1], 10);
  return { lo: lo, hi: m[2] ? parseInt(m[2], 10) : lo };
}

function convertFile(filePath) {
  const slug = path.basename(filePath, '.csv');
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const header = rows[0] || [];
  const formula = (header[0] || 'd100').trim();
  const entries = rows.slice(1).filter(r => r.length >= 2 && r[0].trim() !== '').map(r => {
    const range = parseRange(r[0]);
    if (!range) throw new Error(`${slug}.csv: unparseable range "${r[0]}"`);
    return { range: r[0].trim(), lo: range.lo, hi: range.hi, text: r[1].trim() };
  });
  const tag = TAG_MAP[slug];
  if (!tag) throw new Error(`${slug}.csv: no tag in TAG_MAP — add one in scripts/convert-tables.js`);
  return { id: slug, name: NAME_MAP[slug] || titleCase(slug), tag: tag, formula: formula, entries: entries };
}

function main() {
  const args = process.argv.slice(2);
  const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const flag = f => args.includes(f);

  const root = path.join(__dirname, '..');
  const dir = opt('--dir') || path.join(root, 'data', 'tables');
  const outPath = opt('--out') || path.join(root, 'data', 'tables.json');
  const jsOutPath = opt('--js-out') || path.join(root, 'js', 'tables-data.js');
  const dry = flag('--dry-run') || flag('--dry');

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort();
  if (!files.length) { console.error('No .csv files found in ' + dir); process.exit(1); }

  const tables = files.map(f => convertFile(path.join(dir, f)));
  const tags = Array.from(new Set(tables.map(t => t.tag)));

  console.log(`Converted ${tables.length} tables from ${path.relative(root, dir)} (${tables.reduce((n, t) => n + t.entries.length, 0)} entries total)`);
  console.log(`Tags (${tags.length}): ${tags.join(', ')}`);

  if (dry) {
    console.log('\n--dry-run, sample output:\n' + JSON.stringify(tables.slice(0, 1), null, 2));
    return;
  }

  fs.writeFileSync(outPath, JSON.stringify(tables, null, 2) + '\n');
  console.log(`Wrote ${path.relative(root, outPath)}`);

  // A <script>-loadable copy so it works over file:// where fetch() is blocked.
  const js =
    '/* Auto-generated by scripts/convert-tables.js — do not edit by hand. */\n' +
    '(function (root) {\n' +
    '  var DATA = ' + JSON.stringify(tables) + ';\n' +
    '  if (typeof module !== "undefined" && module.exports) module.exports = DATA;\n' +
    '  root.TABLES_LIBRARY = DATA;\n' +
    '})(typeof window !== "undefined" ? window : globalThis);\n';
  fs.writeFileSync(jsOutPath, js);
  console.log(`Wrote ${path.relative(root, jsOutPath)}`);
}

module.exports = { parseCsv, parseRange, convertFile, titleCase };

if (require.main === module) main();
