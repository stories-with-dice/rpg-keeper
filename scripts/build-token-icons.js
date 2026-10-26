#!/usr/bin/env node
'use strict';

/*
 * build-token-icons.js — make data/token-icons.json, the preset map tokens of
 * the Maps tab, from game-icons.net SVG files (https://game-icons.net, the
 * GitHub repository game-icons/icons: one folder per author, <author>/<name>.svg,
 * CC BY 3.0 — or CC0 where its license.txt says so).
 *
 * Usage:
 *   node scripts/build-token-icons.js <folder with author/name.svg files>
 *
 * Only the `d` of each icon's <path> elements is kept (never the SVG
 * itself), without the black 512 × 512 background square. An icon with any
 * other element, a transform, or a viewBox other than 0 0 512 512 is refused:
 * the app draws the paths in its own <svg>, so nothing else from the file
 * can reach the page.
 */

const fs = require('fs');
const path = require('path');

// The authors' names as game-icons.net credits them (license.txt).
const AUTHORS = {
  lorc: 'Lorc', delapouite: 'Delapouite', skoll: 'Skoll', darkzaitzev: 'DarkZaitzev',
  cathelineau: 'Cathelineau', faithtoken: 'Faithtoken', 'caro-asercion': 'Caro Asercion'
};
const BACKGROUND = 'M0 0h512v512H0z';

function iconFromSvg(text, file) {
  if (!/viewBox="0 0 512 512"/.test(text)) throw new Error(file + ': not a 512 × 512 game-icons.net SVG');
  const tags = text.match(/<\/?([a-zA-Z]+)/g).map(t => t.replace(/[</]/g, ''));
  const odd = tags.filter(t => t !== 'svg' && t !== 'path');
  if (odd.length) throw new Error(file + ': has <' + odd[0] + '>; only <path> is allowed');
  if (/transform=/.test(text)) throw new Error(file + ': has a transform');
  const paths = [...text.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(m => m[1]).filter(d => d !== BACKGROUND);
  if (!paths.length) throw new Error(file + ': no icon path');
  paths.forEach(d => { if (!/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(d)) throw new Error(file + ': odd path data'); });
  return paths;
}

const titleCase = s => s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage: node scripts/build-token-icons.js <folder>'); process.exit(1); }
  const out = [];
  fs.readdirSync(dir).sort().forEach(author => {
    const sub = path.join(dir, author);
    if (!fs.statSync(sub).isDirectory()) return;
    fs.readdirSync(sub).filter(f => f.endsWith('.svg')).sort().forEach(f => {
      const name = f.replace(/\.svg$/, '');
      out.push({
        id: author + '/' + name,
        name: titleCase(name),
        author: AUTHORS[author] || titleCase(author),
        paths: iconFromSvg(fs.readFileSync(path.join(sub, f), 'utf8'), author + '/' + f)
      });
    });
  });
  const target = path.join(__dirname, '..', 'data', 'token-icons.json');
  fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
  console.log('Wrote ' + out.length + ' icons to ' + path.relative(process.cwd(), target));
}

module.exports = { iconFromSvg, titleCase };
if (require.main === module) main();
