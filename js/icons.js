/* js/icons.js — game-icons.net icons for map tokens: the SVG check shared
 * with scripts/build-token-icons.js, and (in the app) the search and download
 * of more icons for the Tokens panel (js/tokens.js).
 *
 * An icon is { id: '<author>/<name>', name, author, paths: [d, …] }: only
 * the path data of a 512 × 512 game-icons.net SVG, never the SVG itself, so
 * nothing from a downloaded file but numbers and path letters reaches the page.
 *
 * Search: data/game-icons-index.json (made by scripts/build-icon-index.js from
 * the repository listing) is fetched the first time the search box is used,
 * and searched here, without the network. Use: the icon's SVG is fetched from
 * the game-icons GitHub repository through jsDelivr (ICON_URL), checked, and
 * kept in the campaign (state.customIcons), so it syncs with the campaign.
 * This fetch, made only when the user clicks a search result, is the app's
 * second network use after Dropbox (see AGENTS.md "What this is").
 */
(function (root) {
  'use strict';

  const ICON_URL = 'https://cdn.jsdelivr.net/gh/game-icons/icons@master/';
  const BACKGROUND = 'M0 0h512v512H0z';
  const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;

  // The icon paths of a game-icons.net SVG. `strict` (the build script)
  // refuses any element but <svg> and <path>; otherwise other elements are
  // ignored, and only the paths are kept. Either way: a viewBox other than
  // 0 0 512 512, a transform, path data with anything but path commands and
  // numbers, or no path at all is refused. Throws with the reason.
  function iconFromSvg(text, file, strict) {
    const what = file || 'icon';
    text = String(text || '');
    if (!/<svg\b[^>]*viewBox="0 0 512 512"/.test(text)) throw new Error(what + ': not a 512 × 512 game-icons.net SVG');
    if (strict) {
      const odd = (text.match(/<\/?([a-zA-Z]+)/g) || []).map(t => t.replace(/[</]/g, '')).filter(t => t !== 'svg' && t !== 'path');
      if (odd.length) throw new Error(what + ': has <' + odd[0] + '>; only <path> is allowed');
    }
    if (/transform=/.test(text)) throw new Error(what + ': has a transform');
    const paths = Array.from(text.matchAll(/<path\b[^>]*?\sd="([^"]+)"/g)).map(m => m[1]).filter(d => d !== BACKGROUND);
    if (!paths.length) throw new Error(what + ': no icon path');
    paths.forEach(d => { if (!PATH_DATA.test(d)) throw new Error(what + ': odd path data'); });
    return paths;
  }

  const titleCase = s => String(s).split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const api = { ICON_URL, iconFromSvg, titleCase };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ---- In the app ---- */
  const OSR = root.OSR = root.OSR || {};
  let index = null;     // [{ id, name, author }] once loaded
  let loading = null;

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch('data/game-icons-index.json')
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(list => { index = list; return list; })
        .finally(() => { loading = null; });
    }
    return loading;
  }

  // Icons whose name, id, or author has every word of `q`, best first: a
  // name that starts with the query, then a name with it, then the rest.
  function searchIcons(list, q, max) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const scored = [];
    list.forEach(i => {
      const hay = (i.name + ' ' + i.id + ' ' + i.author).toLowerCase();
      if (!words.every(w => hay.indexOf(w) !== -1)) return;
      const name = i.name.toLowerCase(), all = words.join(' ');
      scored.push([name.startsWith(all) ? 0 : name.indexOf(all) !== -1 ? 1 : 2, i.name, i]);
    });
    scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
    return scored.slice(0, max || 40).map(s => s[2]);
  }

  // All icons a token can use: the presets, then this campaign's downloads.
  function allIcons() {
    return (OSR.data && OSR.data.tokenIcons || []).concat((OSR.state && OSR.state.customIcons) || []);
  }

  // Downloads icon `entry` ({ id, name, author } from the index), keeps its
  // paths in state.customIcons, and resolves to the icon. A preset or an
  // icon already downloaded is not fetched again.
  async function useIcon(entry) {
    const have = allIcons().find(i => i.id === entry.id);
    if (have) return have;
    let res;
    try { res = await fetch(ICON_URL + entry.id + '.svg'); }
    catch (e) { throw new Error('Cannot reach game-icons (' + e.message + '). Are you offline?'); }
    if (!res.ok) throw new Error('game-icons answered HTTP ' + res.status + ' for ' + entry.id + '.');
    const icon = { id: entry.id, name: entry.name, author: entry.author, paths: iconFromSvg(await res.text(), entry.id, false) };
    if (!Array.isArray(OSR.state.customIcons)) OSR.state.customIcons = [];
    OSR.state.customIcons.push(icon);
    OSR.save();
    return icon;
  }

  // A stored icon from older or imported data: only well-formed ones stay.
  function ensureCustomIcons(state) {
    if (!Array.isArray(state.customIcons)) { state.customIcons = []; return; }
    state.customIcons = state.customIcons.filter(i => i && typeof i.id === 'string' && Array.isArray(i.paths) &&
      i.paths.length && i.paths.every(d => typeof d === 'string' && PATH_DATA.test(d)))
      .map(i => ({ id: i.id, name: String(i.name || i.id), author: String(i.author || ''), paths: i.paths.slice() }));
  }

  /* ---- Search box (Tokens panel) ---- */

  const { $, escapeHtml } = OSR;
  let lastResults = [];

  async function renderIconSearch() {
    const q = $('#icon-search').value;
    const out = $('#icon-results');
    if (!q.trim()) { out.innerHTML = ''; lastResults = []; return; }
    let list;
    try { list = await loadIndex(); }
    catch (e) { out.innerHTML = '<span class="hint">The icon list did not load (' + escapeHtml(e.message) + ').</span>'; return; }
    if ($('#icon-search').value !== q) return; // a newer search runs
    lastResults = searchIcons(list, q, 40);
    out.innerHTML = lastResults.length
      ? lastResults.map((i, n) => '<button type="button" class="btn icon-result" data-n="' + n + '" title="' + escapeHtml(i.id) + '">' +
        escapeHtml(i.name) + ' <span class="icon-author">' + escapeHtml(i.author) + '</span></button>').join('')
      : '<span class="hint">No icon matches “' + escapeHtml(q) + '”.</span>';
  }

  async function onResultClick(e) {
    const b = e.target.closest('.icon-result');
    const sc = OSR.activeScene && OSR.activeScene();
    if (!b || !sc) return;
    const entry = lastResults[Number(b.dataset.n)];
    if (!entry) return;
    b.disabled = true;
    OSR.setMapStatus('Downloading the icon “' + entry.name + '”…');
    try {
      const icon = await useIcon(entry);
      const v = OSR.mapView(sc);
      OSR.addToken(sc, { iconId: icon.id, x: v.x + v.w / 2, y: v.y + v.h / 2, size: Number($('#token-size').value) || 1, color: ($('#token-color') || {}).value });
      OSR.setMapStatus('Added “' + icon.name + '” by ' + icon.author + '.');
      if (OSR.renderSettings) OSR.renderSettings(); // the credits list its author
    } catch (err) {
      OSR.setMapStatus(err.message);
    } finally { b.disabled = false; }
  }

  function wireIcons() {
    let t = null;
    $('#icon-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderIconSearch, 150); });
    $('#icon-search').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); renderIconSearch(); } });
    $('#icon-results').addEventListener('click', onResultClick);
  }

  Object.assign(OSR, { ICON_URL, iconFromSvg, searchIcons, loadIconIndex: loadIndex, allIcons, useIcon, ensureCustomIcons, renderIconSearch, wireIcons });
})(typeof window !== 'undefined' ? window : globalThis);
