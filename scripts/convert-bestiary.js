#!/usr/bin/env node
'use strict';

/*
 * convert-bestiary.js — convert a structured Shadowdark bestiary JSON into the
 * app's internal monster format (the `def` shape produced by js/monsters.js) and
 * write it to the seed library (data/monsters.json).
 *
 * It reuses the real parser (js/monsters.js): for each bestiary entry it
 * reconstructs a Shadowdark stat block and runs it through MonsterParse.parseOne,
 * then attaches the entry's structured `actions` as abilities.
 *
 * Usage:
 *   node scripts/convert-bestiary.js [input.json] [--out data/monsters.json]
 *                                    [--dry-run] [--no-merge]
 *
 *   input.json   defaults to data/bestiary_data.json
 *   --out        target file (default data/monsters.json)
 *   --dry-run    print a summary + first 2 converted monsters, write nothing
 *   --no-merge   don't preserve existing non-Shadowdark monsters from --out
 */

const fs = require('fs');
const path = require('path');
const MonsterParse = require('../js/monsters.js');

const MINOR_WORDS = new Set(['of', 'the', 'and', 'a', 'an', 'to', 'in', 'on', 'with', 'for', 'de', 'von', 'the']);

function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g, (word, offset, full) => {
      if (offset > 0 && MINOR_WORDS.has(word)) return word;
      return word.replace(/^[a-z]/, c => c.toUpperCase())
                 .replace(/([-'’])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
    });
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function statLine(name, m) {
  const st = m.stats || {};
  const acNote = m.armor_type ? ` (${m.armor_type})` : '';
  return `AC ${m.ac}${acNote}, HP ${m.hp}, ATK ${m.attack || 'none'}, MV ${m.movement || 'near'}, ` +
    `S ${st.str}, D ${st.dex}, C ${st.con}, I ${st.int}, W ${st.wis}, Ch ${st.cha}, ` +
    `AL ${m.alignment}, LV ${m.level}`;
}

function buildRaw(name, m, abilities) {
  return [name, (m.description || '').trim(), statLine(name, m)]
    .concat(abilities.map(a => (a.name ? a.name + '. ' : '') + a.text))
    .filter(Boolean)
    .join('\n');
}

function convert(m) {
  const name = titleCase(m.name);
  const def = MonsterParse.parseOne(name + '\n' + (m.description || '') + '\n' + statLine(name, m));
  if (!def) throw new Error('parseOne returned null for ' + m.name);

  const abilities = (m.actions || [])
    .map(a => ({ name: (a.name || '').trim(), text: (a.description || '').trim() }))
    .filter(a => a.name || a.text);

  def.id = 'sd-' + slug(name);
  def.name = name;
  def.source = 'shadowdark';
  def.desc = (m.description || '').trim();
  def.abilities = abilities;
  def.raw = buildRaw(name, m, abilities);
  return def;
}

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const flag = f => args.includes(f);
  const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

  const root = path.join(__dirname, '..');
  const inPath = positional[0] || path.join(root, 'data', 'bestiary_data.json');
  const outPath = opt('--out') || path.join(root, 'data', 'monsters.json');
  const jsOutPath = opt('--js-out') || path.join(root, 'js', 'monsters-data.js');
  const dry = flag('--dry-run') || flag('--dry');
  const merge = !flag('--no-merge');
  const writeJs = !flag('--no-js');

  const rawInput = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const entries = Array.isArray(rawInput) ? rawInput : (rawInput.monsters || rawInput.data || []);
  if (!entries.length) { console.error('No entries found in ' + inPath); process.exit(1); }

  const converted = entries.map(convert).sort((a, b) => a.name.localeCompare(b.name));

  let preserved = [];
  if (merge && fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (Array.isArray(prev)) preserved = prev.filter(d => d && d.source !== 'shadowdark');
    } catch (_) { /* ignore unreadable existing file */ }
  }

  const all = converted.concat(preserved);

  // Sanity report
  const unparsedAtk = converted.filter(d => d.attacksText && d.attacksText !== 'none' && !d.attacks.length);
  const zeroHd = converted.filter(d => d.hdNum === 0);
  console.log(`Converted ${converted.length} Shadowdark monsters from ${path.relative(root, inPath)}`);
  if (preserved.length) {
    console.log(`Preserved ${preserved.length} non-Shadowdark: ${preserved.map(d => d.name).join(', ')}`);
  }
  console.log(`Total: ${all.length}`);
  if (zeroHd.length) console.log(`  note: ${zeroHd.length} at LV 0 (${zeroHd.map(d => d.name).join(', ')})`);
  if (unparsedAtk.length) {
    console.warn(`  WARNING ${unparsedAtk.length} with unparsed attacks:`);
    unparsedAtk.forEach(d => console.warn(`    ${d.name}: "${d.attacksText}"`));
  }

  if (dry) {
    console.log('\n--dry-run, sample output:\n' + JSON.stringify(converted.slice(0, 2), null, 2));
    return;
  }

  fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + '\n');
  console.log(`Wrote ${path.relative(root, outPath)}`);

  if (writeJs) {
    // A <script>-loadable copy so the seed works over file:// where fetch() is blocked.
    const js =
      '/* Auto-generated by scripts/convert-bestiary.js — do not edit by hand. */\n' +
      '(function (root) {\n' +
      '  var DATA = ' + JSON.stringify(all) + ';\n' +
      '  if (typeof module !== "undefined" && module.exports) module.exports = DATA;\n' +
      '  root.MONSTER_LIBRARY = DATA;\n' +
      '})(typeof window !== "undefined" ? window : globalThis);\n';
    fs.writeFileSync(jsOutPath, js);
    console.log(`Wrote ${path.relative(root, jsOutPath)}`);
  }
}

module.exports = { convert, titleCase, slug, statLine, buildRaw };

if (require.main === module) main();
