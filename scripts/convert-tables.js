#!/usr/bin/env node
'use strict';

/*
 * convert-tables.js — convert the RFC4180 CSV random tables in data/tables/
 * (one file per table, header row "<formula>,Details", e.g. "d100,Details")
 * into the app's internal table format and write the seed library
 * (data/tables.json, mirroring scripts/convert-bestiary.js).
 *
 * Each CSV row is `range,text`: range is a single value ("01"), a span
 * ("02-03"), or "00" (percentile-dice shorthand for the top of a d100
 * range, e.g. after "98-99" — parsed as 100, not 0).
 *
 * Each table gets the Tables tab's filter fields: `origin` (shown as
 * "Source"), `setting`, and `output` (js/tables.js lists the allowed
 * settings and outputs). DEFAULT_META applies to every CSV; META (by filename
 * slug) overrides it for one table. See docs/agents/monsters.md "Tables tab".
 *
 * Usage:
 *   node scripts/convert-tables.js [--dir data/tables] [--out data/tables.json]
 *                                  [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const SETTINGS = ['Fantasy', 'Modern', 'Horror'];
const OUTPUTS = ['Encounter', 'Entity', 'Location', 'Adventure', 'Group', 'Other'];
const DEFAULT_META = { origin: 'Shadowdark', setting: 'Fantasy', output: 'Encounter' };
const META = {};

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
  const meta = Object.assign({}, DEFAULT_META, META[slug]);
  if (SETTINGS.indexOf(meta.setting) === -1) throw new Error(`${slug}.csv: unknown setting "${meta.setting}"`);
  if (OUTPUTS.indexOf(meta.output) === -1) throw new Error(`${slug}.csv: unknown output "${meta.output}"`);
  return { id: slug, name: NAME_MAP[slug] || titleCase(slug), origin: meta.origin, setting: meta.setting, output: meta.output,
    formula: formula, entries: entries };
}

function main() {
  const args = process.argv.slice(2);
  const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const flag = f => args.includes(f);

  const root = path.join(__dirname, '..');
  const dir = opt('--dir') || path.join(root, 'data', 'tables');
  const outPath = opt('--out') || path.join(root, 'data', 'tables.json');
  const dry = flag('--dry-run') || flag('--dry');

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort();
  if (!files.length) { console.error('No .csv files found in ' + dir); process.exit(1); }

  const tables = files.map(f => convertFile(path.join(dir, f)));

  console.log(`Converted ${tables.length} tables from ${path.relative(root, dir)} (${tables.reduce((n, t) => n + t.entries.length, 0)} entries total)`);

  if (dry) {
    console.log('\n--dry-run, sample output:\n' + JSON.stringify(tables.slice(0, 1), null, 2));
    return;
  }

  fs.writeFileSync(outPath, JSON.stringify(tables, null, 2) + '\n');
  console.log(`Wrote ${path.relative(root, outPath)}`);

}

module.exports = { parseCsv, parseRange, convertFile, titleCase, SETTINGS, OUTPUTS };

if (require.main === module) main();
