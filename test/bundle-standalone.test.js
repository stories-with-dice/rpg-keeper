'use strict';

/*
 * Validates scripts/bundle-standalone.js — the single-file build published
 * by .github/workflows/release.yml on every push to main (see AGENTS.md
 * "What this is"). Runs the real bundler as a subprocess (not required()'d
 * in-process — it's a one-shot CLI, not a module) and boots the result in
 * its own isolated directory to prove it truly needs no other files.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');

test('bundle-standalone: one self-contained file that boots on its own, no sibling files needed', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osr-bundle-'));
  const outPath = path.join(outDir, 'index.html');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'bundle-standalone.js'), '--out', outPath]);

  const html = fs.readFileSync(outPath, 'utf8');
  assert.ok(!/\s(?:src|href)="(?:js|css|vendor|images)\//.test(html),
    'no external js/css/vendor/image reference left in the markup');
  assert.match(html, /<style>/, 'stylesheets were inlined as <style>');
  assert.match(html, /window\.OSR/, 'app code was inlined as <script>');

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push(e.message));

  const dom = await JSDOM.fromFile(outPath, {
    url: 'file:///' + outPath.replace(/\\/g, '/'),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.addEventListener('error', e => errors.push('window error: ' + e.message), true);
  await new Promise(resolve => setTimeout(resolve, 1000));

  assert.deepEqual(errors, [], 'no script/resource errors while booting');
  assert.ok(window.OSR, 'window.OSR is set up');
  assert.ok(window.OSR.state.characters.length > 0, 'first-run character seeding ran');
  assert.ok(window.OSR.state.monsters.length > 0, 'the bundled monster library loaded');

  window.close();
  fs.rmSync(outDir, { recursive: true, force: true });
});
