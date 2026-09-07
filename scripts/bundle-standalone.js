#!/usr/bin/env node
'use strict';

/*
 * scripts/bundle-standalone.js — produces one self-contained HTML file with
 * every <script src>, <link rel="stylesheet" href">, and the favicon inlined
 * (CSS url(...) assets — the Font Awesome webfonts — go in too, as base64
 * data URIs) so the result needs no other files at all: no js/, css/,
 * vendor/, images/, nothing but the one HTML file.
 *
 * This does NOT change how the app is normally used — open index.html, no
 * build step (see AGENTS.md) — it's an opt-in convenience artifact, built by
 * .github/workflows/release.yml and attached to each GitHub Release.
 *
 * Usage: node scripts/bundle-standalone.js [--out dist/index.html]
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

const MIME_BY_EXT = {
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function dataUri(absPath) {
  const mime = MIME_BY_EXT[path.extname(absPath).toLowerCase()] || 'application/octet-stream';
  return 'data:' + mime + ';base64,' + fs.readFileSync(absPath).toString('base64');
}

// Inline every url(...) in a CSS string that points at a local file
// (resolved relative to `cssDir`) as a base64 data URI. Already-inline
// (data:) or external (http(s):) references are left alone; anything that
// doesn't resolve to a real file is left as-is too, rather than failing.
function inlineCssUrls(css, cssDir) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _quote, ref) => {
    if (/^(data:|https?:)/i.test(ref)) return whole;
    const abs = path.join(cssDir, ref.split(/[?#]/)[0]);
    if (!fs.existsSync(abs)) return whole;
    return 'url(' + dataUri(abs) + ')';
  });
}

function main() {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf('--out');
  const outPath = outFlag >= 0 ? path.resolve(args[outFlag + 1]) : path.join(ROOT, 'dist', 'index.html');

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  const icon = document.querySelector('link[rel="icon"]');
  if (icon) {
    const abs = path.join(ROOT, icon.getAttribute('href'));
    if (fs.existsSync(abs)) icon.setAttribute('href', dataUri(abs));
  }

  document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    const abs = path.join(ROOT, link.getAttribute('href'));
    const css = inlineCssUrls(fs.readFileSync(abs, 'utf8'), path.dirname(abs));
    const style = document.createElement('style');
    style.textContent = css;
    link.replaceWith(style);
  });

  document.querySelectorAll('script[src]').forEach(script => {
    const abs = path.join(ROOT, script.getAttribute('src'));
    const code = fs.readFileSync(abs, 'utf8');
    const inline = document.createElement('script');
    // Defensive: a literal "</script>" inside vendored code would otherwise
    // prematurely close this tag. None of today's vendored files have one.
    inline.textContent = code.replace(/<\/script>/gi, '<\\/script>');
    script.replaceWith(inline);
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, dom.serialize());
  const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
  console.log('Wrote ' + path.relative(ROOT, outPath) + '  (' + sizeMb + ' MB, fully self-contained)');
}

main();
