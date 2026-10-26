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

const { iconFromSvg, titleCase } = require('../js/icons.js');
const { AUTHORS } = require('./icon-authors.js');

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
        paths: iconFromSvg(fs.readFileSync(path.join(sub, f), 'utf8'), author + '/' + f, true)
      });
    });
  });
  const target = path.join(__dirname, '..', 'data', 'token-icons.json');
  fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
  console.log('Wrote ' + out.length + ' icons to ' + path.relative(process.cwd(), target));
}

if (require.main === module) main();
