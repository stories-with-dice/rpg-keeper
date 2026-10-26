#!/usr/bin/env node
'use strict';

/*
 * build-icon-index.js — make data/game-icons-index.json, the list the Maps
 * tab's icon search looks in (js/icons.js), from the jsDelivr listing of the
 * game-icons GitHub repository.
 *
 * Usage:
 *   curl -s 'https://data.jsdelivr.com/v1/packages/gh/game-icons/icons@master?structure=flat' > listing.json
 *   node scripts/build-icon-index.js listing.json
 *
 * Output: [{ id: '<author>/<name>', name, author }], sorted by id. Only the
 * names are stored; the icons themselves are downloaded when used.
 */

const fs = require('fs');
const path = require('path');
const { titleCase } = require('../js/icons.js');
const { AUTHORS } = require('./icon-authors.js');

function indexFromListing(listing) {
  return (listing.files || [])
    .map(f => f.name)
    .filter(n => /^\/[a-z0-9-]+\/[a-z0-9-]+\.svg$/.test(n))
    .map(n => {
      const [, author, name] = /^\/([^/]+)\/([^/]+)\.svg$/.exec(n);
      return { id: author + '/' + name, name: titleCase(name), author: AUTHORS[author] || titleCase(author) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/build-icon-index.js <listing.json>'); process.exit(1); }
  const out = indexFromListing(JSON.parse(fs.readFileSync(file, 'utf8')));
  const target = path.join(__dirname, '..', 'data', 'game-icons-index.json');
  fs.writeFileSync(target, JSON.stringify(out) + '\n');
  console.log('Wrote ' + out.length + ' icons to ' + path.relative(process.cwd(), target));
}

module.exports = { indexFromListing };
if (require.main === module) main();
