#!/usr/bin/env node
'use strict';

/*
 * convert-spells-from-shadowdark-resources.js — turn the structured spell list
 * in data/spell_data.json into Compendium seed entries with a tidy Markdown body.
 *
 * Output is a JSON array of { name, category, body } objects, written by
 * default to data/spells.json (for http fetch / inspection) AND, as a
 * <script>-loadable copy, to js/spells-data.js (window.SPELLS_LIBRARY) so the
 * spells are available on file:// too, where fetch() is blocked.
 * js/compendium-seed.js reads window.SPELLS_LIBRARY when present, falling
 * back to fetching data/spells.json — and folds the entries into the bundled
 * seed automatically. No manual splicing needed. Every entry's category is
 * "Spells" (matches the Compendium category filter).
 *
 * Body layout:
 *   # Fireball
 *
 *   **Class**: Wizard
 *   **Tier**: 3
 *   **Range**: Far
 *   **Duration**: Instant
 *   **DC**: 13
 *   **Source**: Core
 *
 *   A raging ball of fire …
 *
 * Usage:
 *   node scripts/convert-spells-from-shadowdark-resources.js [input.json] \
 *        [--out data/spells.json] [--js-out js/spells-data.js] [--no-js] \
 *        [--no-heading] [--dry-run]
 *
 *   input.json    defaults to data/spell_data.json
 *   --out         target JSON file (default data/spells.json)
 *   --js-out      target <script>-loadable file (default js/spells-data.js)
 *   --no-js       skip writing the js-out file
 *   --no-heading  omit the leading "# Name" line from each body
 *   --dry-run     print a summary + the first 2 entries, write nothing
 */

const fs = require('fs');
const path = require('path');

function cap(s) {
  s = String(s || '').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// "priest", ["wizard"], ["priest","wizard"] -> "Priest", "Wizard", "Priest / Wizard"
function classList(classes) {
  const arr = (Array.isArray(classes) ? classes : [classes])
    .map(c => cap(c)).filter(Boolean);
  arr.sort((a, b) => a.localeCompare(b));
  return arr;
}

function buildBody(spell, opts) {
  opts = opts || {};
  const classes = classList(spell.classes);
  const meta = [];
  meta.push('**' + (classes.length > 1 ? 'Classes' : 'Class') + '**: ' + (classes.join(' / ') || '—'));
  if (spell.tier != null && spell.tier !== '') meta.push('**Tier**: ' + spell.tier);
  if (spell.range) meta.push('**Range**: ' + spell.range);
  if (spell.duration) meta.push('**Duration**: ' + spell.duration);
  if (spell.dc != null && spell.dc !== '') meta.push('**DC**: ' + spell.dc);
  if (spell.source) meta.push('**Source**: ' + spell.source);

  const desc = String(spell.description || '').trim();

  const parts = [];
  if (!opts.noHeading) parts.push('# ' + String(spell.name || '').trim());
  parts.push(meta.join('\n'));
  if (desc) parts.push(desc);
  return parts.join('\n\n');
}

// A compendium-seed.js DATA entry. category "Spells" matches the Compendium filter.
function toEntry(spell, opts) {
  return {
    name: String(spell.name || '').trim(),
    category: 'Spells',
    body: buildBody(spell, opts || {})
  };
}

function convert(spells, opts) {
  return spells
    .map(s => toEntry(s, opts))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// One JSON object per line, wrapped in an array — matches compendium-seed.js's
// one-entry-per-line style and is valid JSON you can splice into DATA.
function formatEntries(entries) {
  return '[\n' + entries.map(e => '  ' + JSON.stringify(e)).join(',\n') + '\n]\n';
}

function main() {
  const args = process.argv.slice(2);
  const OPTS_WITH_VALUE = ['--out'];
  const flag = f => args.includes(f);
  const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { if (OPTS_WITH_VALUE.includes(args[i])) i++; continue; }
    positional.push(args[i]);
  }

  const root = path.join(__dirname, '..');
  const inPath = positional[0] || path.join(root, 'data', 'spell_data.json');
  const outPath = opt('--out') || path.join(root, 'data', 'spells.json');
  const jsOutPath = opt('--js-out') || path.join(root, 'js', 'spells-data.js');
  const noHeading = flag('--no-heading');
  const writeJs = !flag('--no-js');
  const dry = flag('--dry-run') || flag('--dry');

  const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const spells = Array.isArray(raw) ? raw : (raw.spells || raw.data || []);
  if (!spells.length) { console.error('No spells found in ' + inPath); process.exit(1); }

  const entries = convert(spells, { noHeading: noHeading });

  const dupes = entries
    .map(e => e.name.toLowerCase())
    .filter((n, i, a) => a.indexOf(n) !== i);
  console.log('Converted ' + entries.length + ' spells from ' + path.relative(root, inPath) +
    ' into { name, category: "Spells", body } seed entries');
  if (dupes.length) console.warn('  WARNING duplicate names: ' + [...new Set(dupes)].join(', '));

  if (dry) {
    console.log('\n--dry-run, first 2 entries:\n' + formatEntries(entries.slice(0, 2)));
    return;
  }

  fs.writeFileSync(outPath, formatEntries(entries));
  console.log('Wrote ' + path.relative(root, outPath));

  if (writeJs) {
    // A <script>-loadable copy so the seed works over file:// where fetch() is blocked.
    var js =
      '/* Auto-generated by scripts/convert-spells-from-shadowdark-resources.js — do not edit by hand. */\n' +
      '(function (root) {\n' +
      '  var DATA = ' + JSON.stringify(entries) + ';\n' +
      '  if (typeof module !== "undefined" && module.exports) module.exports = DATA;\n' +
      '  root.SPELLS_LIBRARY = DATA;\n' +
      '})(typeof window !== "undefined" ? window : globalThis);\n';
    fs.writeFileSync(jsOutPath, js);
    console.log('Wrote ' + path.relative(root, jsOutPath));
  }
  console.log('js/compendium-seed.js reads window.SPELLS_LIBRARY (file://) or fetches data/spells.json (http) automatically — no manual splicing needed');
}

module.exports = { cap, classList, buildBody, toEntry, convert, formatEntries };

if (require.main === module) main();
