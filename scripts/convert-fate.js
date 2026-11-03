#!/usr/bin/env node
'use strict';

/*
 * convert-fate.js — build the Fate Core Compendium seed (data/seed-fate.json)
 * from the Fate NPC Generator data in data/fate/ (copied from the
 * fate-rpg-foundry repo):
 *   data/fate/stunts.json        598 stunts → category "Stunts", `skill` = the
 *                                stunt's skill, `settings` from its tags
 *   data/fate/aspect-lists.json  the RPGnet wiki aspect lists → category
 *                                "Aspects", `skill` = the list ("Trouble",
 *                                "Scene: Weather"); the Compendium filter is
 *                                "Skill / kind"
 * Each entry has a `ref` ("fate-stunt:<id>", "fate-aspect:<list>:<n>") so two
 * entries with the same name stay apart in the seed store (js/seeds.js).
 * The body ends with the source and the license of the text.
 *
 * Usage: node scripts/convert-fate.js [--out data/seed-fate.json] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = path.join(ROOT, outArg !== -1 ? args[outArg + 1] : 'data/seed-fate.json');
const DRY = args.includes('--dry-run');
// Goes up when the output changes, so every campaign is offered the new seed.
const VERSION = 1;

const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/fate', f), 'utf8'));
const stunts = read('stunts.json');
const aspects = read('aspect-lists.json');

// Stunt tags → the Compendium "Setting" values.
const SETTING = { generic: 'Generic', fantasy: 'Fantasy', modern: 'Modern', nautical: 'Nautical', scifi: 'Sci-fi' };

// A short source name for the Compendium "Source" filter; the full one is in the body.
function shortSource(src) {
  const s = String(src || '');
  if (/^Fate System Toolkit/i.test(s)) return 'Fate System Toolkit';
  if (/^Fate Core/i.test(s)) return 'Fate Core';
  if (/Spirit of the Century/i.test(s)) return 'Spirit of the Century SRD';
  if (/dfrpg-resources/i.test(s)) return 'DFRPG Resources wiki';
  if (/^Peter Blake$/i.test(s)) return 'Evil Hat wiki (Peter Blake)';
  return s || 'Evil Hat wiki';
}

const out = [];
stunts.stunts.forEach(s => {
  const name = String(s.name || '').trim();
  if (!name || !s.text) return;
  const settings = (s.tags || []).map(t => SETTING[t]).filter(Boolean);
  const lines = [String(s.text).trim(), ''];
  if (s.requires) lines.push('*Requires:* ' + s.requires);
  lines.push('*Skill:* ' + s.skill + (s.group ? ' · *Group:* ' + s.group : ''));
  lines.push('*Source:* ' + s.source + ' · *License:* ' + s.license);
  out.push({ name, category: 'Stunts', source: shortSource(s.source), skill: s.skill || '', settings: settings.length ? settings : ['Generic'],
    ref: 'fate-stunt:' + s.id, body: lines.join('\n') });
});

// List keys → the "kind" shown in the Skill / kind filter.
const KIND = {
  highConcepts: 'High Concept', troubles: 'Trouble', beliefs: 'Belief', dispositions: 'Disposition',
  expertise: 'Expertise', friends: 'Friend', enemies: 'Enemy', gear: 'Gear'
};
const kindOf = key => KIND[key] || key.replace(/^scene\./, 'Scene: ').replace(/^situational\./, 'Situation: ')
  .replace(/: (\w)/, (m, c) => ': ' + c.toUpperCase());
Object.keys(aspects.lists).forEach(key => {
  if (key === 'questions') return; // GM prompts, not aspects
  aspects.lists[key].forEach((phrase, i) => {
    const name = String(phrase || '').trim().replace(/\.$/, '');
    // Skip notes left in the source page ("(These are …)", "Some good questions to ask:").
    if (!name || /^\(.*\)$/.test(name) || /:$/.test(name) || name.length > 90) return;
    out.push({ name, category: 'Aspects', source: 'RPGnet Aspects List', skill: kindOf(key), settings: ['Generic'],
      ref: 'fate-aspect:' + key + ':' + i,
      body: '*' + kindOf(key) + '* aspect.\n\n*Source:* ' + aspects.source + ' · *License:* ' + aspects.license });
  });
});

const seed = { system: 'fate', version: VERSION, compendium: out, monsters: [] };
console.log('stunts: ' + out.filter(e => e.category === 'Stunts').length + ', aspects: ' + out.filter(e => e.category === 'Aspects').length);
// One entry per line: small, and a diff shows each changed entry.
const text = '{"system":"fate","version":' + seed.version + ',"monsters":[],"compendium":[\n' +
  seed.compendium.map(e => JSON.stringify(e)).join(',\n') + '\n]}\n';
if (!DRY) fs.writeFileSync(OUT, text);
