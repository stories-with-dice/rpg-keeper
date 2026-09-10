/* js/characters.js — character CRUD, View/Edit mode rendering, and the
 * View-mode text-selection -> "Add/link to Compendium" context menu.
 */
(function (OSR) {
  'use strict';
  const { $, $$, escapeHtml, uid } = OSR;

  function detectNameSystem(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let name = 'Untitled', system = '';
    if (lines.length) {
      let first = lines[0].replace(/^#+\s*/, '').replace(/^\*+|\*+$/g, '').trim();
      const sysM = first.match(/\[([^\]]+)\]\s*$/);
      if (sysM) { system = sysM[1].trim(); first = first.replace(/\[[^\]]+\]\s*$/, '').trim(); }
      name = first || 'Untitled';
    }
    if (!system) {
      if (/shadowdark/i.test(text)) system = 'Shadowdark';
      else if (/\bWWN\b|worlds without number/i.test(text)) system = 'WWN';
    }
    return { name, system };
  }

  const DEFAULT_BLANK_OSR = '# New Character\n\n*System — Level 1*\n\n> **AC** 10 · **HP** 6/6\n\n## Abilities\n\n- STR +0\n- DEX +0\n';
  // Has a (near-empty) ```ua fence so a blank character created while System
  // is Unknown Armies is itself classified 'ua3e' by charSystemKey() below —
  // otherwise it would vanish from the Character dropdown the instant it's
  // created (filtered out as an 'osr' character in a ua3e-filtered list).
  const DEFAULT_BLANK_UA = '# New Character [Unknown Armies]\n\n```ua\nIdentities\n\nWound Threshold: 50\n\n' +
    'Shock\nHelplessness: 0 hardened / 0 failed\nIsolation: 0 hardened / 0 failed\nSelf: 0 hardened / 0 failed\n' +
    'Unnatural: 0 hardened / 0 failed\nViolence: 0 hardened / 0 failed\n```\n';

  function createCharacter(body, opts) {
    opts = opts || {};
    const state = OSR.state;
    const usedBody = body != null ? body :
      (OSR.currentSystem && OSR.currentSystem() === 'ua3e' ? DEFAULT_BLANK_UA : DEFAULT_BLANK_OSR);
    const det = detectNameSystem(usedBody);
    const ch = {
      id: uid(),
      name: opts.name || det.name,
      system: opts.system || det.system,
      nameLocked: !!opts.name,
      body: usedBody,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.characters.push(ch);
    OSR.ensureHpTracker(ch);
    syncWoundTracker(ch);
    state.activeId = ch.id;
    OSR.mode = 'view';
    OSR.save();
    refreshCharUI();
  }

  /* ---- Unknown Armies 3rd Edition: ```ua statblock fence ---- */
  // A ```ua fenced block (see js/ua-statblock.js) is parsed and rendered as a
  // formatted panel in View mode; Edit mode always shows the raw fenced text
  // (it's just the plain textarea echoing ch.body). A malformed/absent fence
  // simply falls through to marked's normal <pre><code> rendering.
  const UA_FENCE_RE = /```ua[ \t]*\r?\n([\s\S]*?)\r?\n```/g;

  // Which System bucket a character belongs to for the Character dropdown —
  // unlike the free-text `ch.system` display label (e.g. "Shadowdark",
  // "Unknown Armies"), this is derived from whether the sheet actually has a
  // ```ua fence, so it can't drift out of sync with what's actually rendered.
  function charSystemKey(ch) {
    UA_FENCE_RE.lastIndex = 0;
    return UA_FENCE_RE.test((ch && ch.body) || '') ? 'ua3e' : 'osr';
  }
  function charactersForSystem() {
    const sys = OSR.currentSystem ? OSR.currentSystem() : 'osr';
    return OSR.state.characters.filter(c => charSystemKey(c) === sys);
  }

  // A single feature clause ("Substitutes for Dodge") -> HTML with its verb
  // highlighted; the target ability name additionally gets `.ua-sub` (shared
  // with that ability's cell in the Abilities table, and with this
  // identity's own name below) when the clause is a live Substitutes-for
  // link — i.e. the target is a real ability name (`subAbilities` is the
  // Set of ability names computeSubstitutions() actually resolved).
  function uaFeatureClauseHtml(f, subAbilities) {
    if (f.kind === 'other') return escapeHtml(f.raw);
    const isSubLink = f.kind === 'substitutes' && subAbilities.has(f.target);
    const verbHtml = '<span class="ua-feature-kw ua-feature-' + f.kind + '">' + escapeHtml(f.verb) + '</span>';
    const targetHtml = isSubLink ? '<span class="ua-sub">' + escapeHtml(f.target) + '</span>' : escapeHtml(f.target);
    return verbHtml + (f.target ? ' ' + targetHtml : '');
  }

  // One row of clickable Hardened/Failed dots (9 or 5 of them). `data-value`
  // records the current count directly (rather than making the click
  // handler re-derive it by counting .is-filled buttons); `data-fence`
  // identifies which ```ua fence in the body this belongs to (see
  // renderUABlocks/patchUAFence — normally 0, only matters if a sheet
  // somehow has more than one fence).
  function uaDotsHtml(meter, field, value, max, fenceIndex) {
    let html = '<span class="ua-dots' + (field === 'failed' ? ' ua-dots-failed' : '') + '"' +
      ' data-meter="' + escapeHtml(meter) + '" data-field="' + field + '"' +
      ' data-fence="' + fenceIndex + '" data-value="' + value + '">';
    for (let n = 1; n <= max; n++) {
      html += '<button type="button" class="ua-dot' + (n <= value ? ' is-filled' : '') + '" data-n="' + n + '"' +
        ' title="Set ' + (field === 'hardened' ? 'Hardened' : 'Failed') + ' to ' + n + '"></button>';
    }
    return html + '</span>';
  }

  function uaStatblockHtml(def, opts) {
    opts = opts || {};
    const fenceIndex = opts.fenceIndex != null ? opts.fenceIndex : 0;
    const UAS = window.UAStatblock;
    const subs = UAS.computeSubstitutions(def.identities); // { AbilityName: {pct, identityName, obsession} }
    const subAbilities = new Set(Object.keys(subs));
    // Identities whose name should get the shared `.ua-sub` treatment too —
    // any identity that's the source of at least one live substitution link.
    const subIdentityNames = new Set(Object.values(subs).map(s => s.identityName));

    // Every relationship, keyed by its normalized role, so each meter row
    // can pull out the one relationship linked to it (p.41).
    const relByRole = new Map(def.relationships.map(r => [UAS.normalizeRole(r.role), r]));
    const totalHardened = UAS.METER_ORDER.reduce((sum, m) => sum + (def.abilities[m].hardened || 0), 0);

    const abilityHtml = (name, computedPct) => {
      const sub = subs[name];
      if (!sub) return escapeHtml(name) + ' ' + computedPct + '%';
      const title = escapeHtml(name) + ': ' + computedPct + '% computed, substituted by ' +
        escapeHtml(sub.identityName) + ' ' + sub.pct + '%';
      return '<span class="ua-sub" title="' + title + '">' + escapeHtml(name) + '</span> ' + sub.pct + '%';
    };

    // One row per meter — relationship, meter name (w/ Defend/Coerce
    // tooltip), Hardened/Failed dot tracks each paired with the ability it
    // drives — laid out left-to-right like the physical character sheet
    // (p.6-10 of the sample sheets: Protégé | Fitness/Dodge dots | Helplessness | Failures, …).
    const meterRows = UAS.METER_ORDER.map(meter => {
      const a = def.abilities[meter];
      const da = UAS.METER_DEFEND_ATTACK[meter];
      const relRole = UAS.METER_RELATIONSHIP[meter];
      const rel = relByRole.get(UAS.normalizeRole(relRole));
      // rel.name is '' for an unfilled placeholder line ("Favorite: __%") —
      // rel.text itself is still truthy ("__%"), so check .name, not .text.
      const relHtml = '<div class="ua-meter-rel"><span class="ua-rel-role">' + escapeHtml(relRole) + '</span>' +
        '<span class="ua-rel-val">' + (rel && rel.name ? escapeHtml(rel.text) : '<i>unfilled</i>') + '</span></div>';
      const syndrome = a.failed >= 5
        ? '<span class="ua-badge-syndrome" title="5 failures in one meter — note an Insanity Syndrome (p.27)">Insanity syndrome</span>' : '';

      return '<div class="ua-meter-row">' + relHtml +
        '<div class="ua-meter-main">' +
          '<div class="ua-meter-head"><span class="ua-meter-name" title="Defend with ' + da.defend +
            '. Coerce with ' + da.coerce + '.">' + escapeHtml(meter) + '</span>' + syndrome + '</div>' +
          '<div class="ua-track-row"><span class="ua-track-label">Hardened</span>' +
            uaDotsHtml(meter, 'hardened', a.hardened, 9, fenceIndex) +
            '<span class="ua-track-count">' + a.hardened + '/9</span>' +
            '<span class="ua-ability-label">' + abilityHtml(a.upbeatName, a.upbeatPct) + '</span></div>' +
          '<div class="ua-track-row"><span class="ua-track-label">Failed</span>' +
            uaDotsHtml(meter, 'failed', a.failed, 5, fenceIndex) +
            '<span class="ua-track-count">' + a.failed + '/5</span>' +
            '<span class="ua-ability-label">' + abilityHtml(a.downbeatName, a.downbeatPct) + '</span></div>' +
        '</div></div>';
    }).join('');

    const identities = def.identities.length ? '<h4>Identities</h4><ul class="ua-identities">' + def.identities.map(id => {
      const nameHtml = subIdentityNames.has(id.name)
        ? '<b class="ua-sub">' + escapeHtml(id.name) + '</b>' : '<b>' + escapeHtml(id.name) + '</b>';
      const featuresHtml = UAS.parseFeatures(id.features).map(f => uaFeatureClauseHtml(f, subAbilities)).join(', ');
      return '<li>' + nameHtml + ' ' + id.pct + '%' +
        (id.obsession ? ' <span class="badge">Obsession</span>' : '') +
        (featuresHtml ? ': ' + featuresHtml : '') + '</li>';
    }).join('') + '</ul>' : '';

    const passionRow = (label, p) => p ? '<div class="ua-passion"><b>' + escapeHtml(label) + '</b>' +
      (p.meter ? ' (' + escapeHtml(p.meter) + ')' : '') + ': ' + escapeHtml(p.text) + '</div>' : '';
    const passions = (def.passions.fear || def.passions.noble || def.passions.rage)
      ? '<h4>Passions</h4><div class="ua-passions">' + passionRow('Fear', def.passions.fear) +
        passionRow('Noble', def.passions.noble) + passionRow('Rage', def.passions.rage) + '</div>' : '';

    const wt = def.woundThreshold != null
      ? '<div class="ua-wound"><b>Wound Threshold</b>: ' + def.woundThreshold + '</div>' : '';
    const burnout = totalHardened >= 25
      ? '<div class="ua-burnout" title="25 or more hardened notches total — mark Burnout (p.30)">' +
        '⚠ Burned out (' + totalHardened + ' hardened total)</div>' : '';

    return '<div class="ua-block">' + identities + passions + wt + burnout +
      '<h4>Shock</h4><div class="ua-meters">' + meterRows + '</div></div>';
  }

  // Splices `transform(innerText)`'s result back into the Nth ```ua fence
  // found in `body` (0-indexed) — used by the Shock-dot click handler below
  // to rewrite exactly the fence a click came from (uaStatblockHtml threads
  // opts.fenceIndex into each .ua-dots span's data-fence for this purpose).
  function patchUAFence(body, fenceIndex, transform) {
    let idx = -1;
    UA_FENCE_RE.lastIndex = 0;
    return String(body || '').replace(UA_FENCE_RE, (whole, inner) => {
      idx++;
      return idx === fenceIndex ? whole.replace(inner, transform(inner)) : whole;
    });
  }

  // Click-to-edit: adjusts one Shock meter's Hardened/Failed count directly
  // from View mode by rewriting the relevant ```ua fence line in ch.body —
  // there's no separate structured state for this, the fence text IS the
  // source of truth (same idea as Wound Threshold via syncWoundTracker).
  // Abilities (including any identity's Substitutes-for override) recompute
  // automatically on the next render since they're always derived from the
  // fence text, never stored separately.
  function setUAShockValue(ch, fenceIndex, meter, field, value) {
    if (!ch || !window.UAStatblock) return;
    ch.body = patchUAFence(ch.body, fenceIndex, inner => window.UAStatblock.setShockValue(inner, meter, field, value));
    ch.updatedAt = Date.now();
    syncWoundTracker(ch);
    OSR.save();
    refreshCharUI();
  }

  // Replaces every ```ua fence in a character's raw body with its rendered
  // HTML panel, wrapped in blank lines so marked (no `sanitize` option — see
  // js/main.js) treats it as a raw HTML block and passes it through
  // untouched. Used instead of a bare marked.parse(ch.body) everywhere a
  // character body is rendered, so the statblock renders consistently in the
  // sheet view, the two-character split, and Combat's combatant detail.
  function renderUABlocks(body) {
    if (!window.UAStatblock) return String(body || '');
    let fenceIndex = -1;
    return String(body || '').replace(UA_FENCE_RE, (whole, inner) => {
      fenceIndex++;
      return '\n\n' + uaStatblockHtml(window.UAStatblock.parseUAStatblock(inner), { fenceIndex: fenceIndex }) + '\n\n';
    });
  }
  function renderCharMarkdown(body) { return marked.parse(renderUABlocks(body)); }

  // Every ```ua fence's Wound Threshold (last one wins) syncs the
  // campaign-global "Wounds (Name)" tracker's max, mirroring how name/system
  // resync from sheet text on save (see saveEdit). Current wounds taken
  // (the tracker's value) is left alone, same as HP's value is untouched.
  function syncWoundTracker(ch) {
    if (!window.UAStatblock || !ch) return;
    let threshold = null;
    let m;
    UA_FENCE_RE.lastIndex = 0;
    while ((m = UA_FENCE_RE.exec(ch.body || ''))) {
      const wt = window.UAStatblock.parseUAStatblock(m[1]).woundThreshold;
      if (wt != null) threshold = wt;
    }
    if (threshold != null) OSR.ensureWoundTracker(ch, threshold);
  }

  // Second column character, if one is selected and it isn't the same as A.
  function charB() {
    const state = OSR.state;
    if (!state.activeIdB || state.activeIdB === state.activeId) return null;
    return state.characters.find(c => c.id === state.activeIdB) || null;
  }

  function fillCharOptions(sel, selectedId, opts) {
    opts = opts || {};
    sel.innerHTML = '';
    if (opts.noneLabel != null) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = opts.noneLabel;
      if (!selectedId) o.selected = true;
      sel.appendChild(o);
    }
    charactersForSystem().forEach(c => {
      if (opts.exclude && c.id === opts.exclude) return;
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name + (c.system ? ' (' + c.system + ')' : '');
      if (c.id === selectedId) o.selected = true;
      sel.appendChild(o);
    });
  }

  function refreshCharUI() {
    const state = OSR.state;
    // The Character dropdowns only ever list the active System's characters
    // (see charSystemKey) — if activeId/activeIdB point outside that bucket
    // (a dangling id, or the System setting just changed), fall back to the
    // first character in the current bucket, same as the existing
    // dangling-id recovery this replaces.
    const inSystem = charactersForSystem();
    if (!inSystem.some(c => c.id === state.activeId)) {
      state.activeId = inSystem.length ? inSystem[0].id : null;
    }
    if (state.activeIdB && (state.activeIdB === state.activeId ||
        !inSystem.some(c => c.id === state.activeIdB))) {
      state.activeIdB = null;
    }

    fillCharOptions($('#char-select'), state.activeId, {});
    fillCharOptions($('#char-select-b'), state.activeIdB, { noneLabel: '— none —', exclude: state.activeId });
    $('#char-select-b').disabled = inSystem.length < 2;

    const ch = OSR.activeChar();
    const b = charB();
    const has = inSystem.length > 0;
    $('#char-empty').hidden = has;
    $('#char-view').hidden = !ch;
    $('#btn-rename').disabled = !ch;
    $('#btn-delete').disabled = !ch;

    // The single header meta only makes sense for one character; two-character
    // mode labels each column instead.
    const meta = $('#char-meta');
    if (ch && !b) {
      meta.hidden = false;
      $('#view-name').textContent = ch.name;
      const sb = $('#view-system');
      sb.hidden = !ch.system;
      sb.textContent = ch.system || '';
    } else {
      meta.hidden = true;
    }

    if (ch) setMode(OSR.mode);
    OSR.renderNotes();
    OSR.renderConsumables();
  }

  // Split a sheet body at the FIRST standalone `---` line: text before it goes
  // in the left column, text after it in the right. Returns [left, null] when
  // there is no such line.
  function splitBodyColumns(body) {
    const lines = String(body || '').split(/\r?\n/);
    const idx = lines.findIndex(l => /^\s*---\s*$/.test(l));
    if (idx === -1) return [body || '', null];
    return [lines.slice(0, idx).join('\n'), lines.slice(idx + 1).join('\n')];
  }

  function charColHtml(md, head) {
    return '<div class="char-col">' +
      (head || '') +
      '<div class="char-col-body markdown-body">' + renderCharMarkdown(md) + '</div>' +
      '</div>';
  }

  function charColHead(ch) {
    return '<div class="char-col-head"><span class="char-name">' + escapeHtml(ch.name) + '</span>' +
      (ch.system ? '<span class="badge">' + escapeHtml(ch.system) + '</span>' : '') + '</div>';
  }

  function renderCharView() {
    const host = $('#mode-view');
    const a = OSR.activeChar();
    const b = charB();
    if (!a) { host.innerHTML = ''; host.classList.remove('has-cols'); return; }
    if (b) {
      // Two characters — one per column. Any `---` in a body is a plain rule.
      host.classList.add('has-cols');
      host.innerHTML = '<div class="char-cols">' +
        charColHtml(a.body, charColHead(a)) +
        charColHtml(b.body, charColHead(b)) + '</div>';
      // Annotate per column so each side's $refs resolve (and show values on
      // hover) against its own character's variables, not the other's.
      const cols = $$('.char-cols > .char-col', host);
      OSR.annotate(cols[0], { vars: OSR.charVars(a) });
      OSR.annotate(cols[1], { vars: OSR.charVars(b) });
    } else {
      const parts = splitBodyColumns(a.body);
      const vars = OSR.charVars(a);
      if (parts[1] == null) {
        host.classList.remove('has-cols');
        host.innerHTML = renderCharMarkdown(a.body);
        OSR.annotate(host, { vars: vars });
      } else {
        host.classList.add('has-cols');
        host.innerHTML = '<div class="char-cols">' +
          charColHtml(parts[0]) + charColHtml(parts[1]) + '</div>';
        $$('.char-cols > .char-col', host).forEach(col => OSR.annotate(col, { vars: vars }));
      }
    }
  }

  // Edit mode mirrors View mode's layout: one textarea per selected character,
  // side by side in two columns when Character B is also selected.
  function renderCharEdit() {
    const host = $('#edit-host');
    const a = OSR.activeChar();
    const b = charB();
    if (!a) { host.innerHTML = ''; host.classList.remove('has-cols'); return; }
    const areaHtml = ch =>
      '<textarea class="edit-col-area" spellcheck="false" data-id="' + ch.id + '">' +
      escapeHtml(ch.body || '') + '</textarea>';
    if (b) {
      host.classList.add('has-cols');
      host.innerHTML = '<div class="char-cols">' +
        '<div class="char-col">' + charColHead(a) + areaHtml(a) + '</div>' +
        '<div class="char-col">' + charColHead(b) + areaHtml(b) + '</div>' +
        '</div>';
    } else {
      host.classList.remove('has-cols');
      host.innerHTML = areaHtml(a);
    }
  }

  function setMode(m) {
    OSR.mode = m;
    const ch = OSR.activeChar();
    $('#btn-mode-view').classList.toggle('is-active', m === 'view');
    $('#btn-mode-edit').classList.toggle('is-active', m === 'edit');
    $('#mode-view').hidden = m !== 'view';
    $('#mode-edit').hidden = m !== 'edit';
    if (!ch) return;
    if (m === 'view') renderCharView();
    else renderCharEdit();
  }

  // Keep the character's "HP (Name)" tracker label in sync when the name changes.
  function renameHpTracker(oldLabel, ch) {
    if (OSR.hpTrackerLabel(ch) === oldLabel) return;
    const hpc = OSR.state.consumables.find(c => c.name === oldLabel);
    if (hpc) hpc.name = OSR.hpTrackerLabel(ch);
    OSR.ensureHpTracker(ch);
  }

  // Same idea for the Unknown Armies "Wounds (Name)" tracker — but only rename
  // an existing one; it's created lazily by syncWoundTracker() once a ```ua
  // fence with a Wound Threshold is actually present.
  function renameWoundTracker(oldLabel, ch) {
    if (OSR.woundTrackerLabel(ch) === oldLabel) return;
    const c = OSR.state.consumables.find(x => x.name === oldLabel);
    if (c) c.name = OSR.woundTrackerLabel(ch);
  }

  function saveEdit() {
    const areas = $$('#edit-host .edit-col-area');
    if (!areas.length) return;
    areas.forEach(area => {
      const ch = OSR.state.characters.find(c => c.id === area.dataset.id);
      if (!ch) return;
      const oldLabel = OSR.hpTrackerLabel(ch);
      const oldWoundLabel = OSR.woundTrackerLabel(ch);
      ch.body = area.value;
      ch.updatedAt = Date.now();
      const det = detectNameSystem(ch.body);
      if (!ch.nameLocked) ch.name = det.name;
      if (det.system) ch.system = det.system;
      renameHpTracker(oldLabel, ch);
      renameWoundTracker(oldWoundLabel, ch);
      syncWoundTracker(ch);
    });
    OSR.save();
    setMode('view');
    refreshCharUI();
  }

  function renameChar() {
    const ch = OSR.activeChar();
    if (!ch) return;
    const n = prompt('Character name:', ch.name);
    if (n == null) return;
    const oldLabel = OSR.hpTrackerLabel(ch);
    const oldWoundLabel = OSR.woundTrackerLabel(ch);
    ch.name = n.trim() || ch.name;
    ch.nameLocked = true;
    renameHpTracker(oldLabel, ch);
    renameWoundTracker(oldWoundLabel, ch);
    OSR.save();
    refreshCharUI();
  }

  function deleteChar() {
    const ch = OSR.activeChar();
    if (!ch) return;
    if (!confirm('Delete "' + ch.name + '"? This cannot be undone.')) return;
    const state = OSR.state;
    const label = OSR.hpTrackerLabel(ch);
    const woundLabel = OSR.woundTrackerLabel(ch);
    state.characters = state.characters.filter(c => c.id !== ch.id);
    state.consumables = state.consumables.filter(c => c.name !== label && c.name !== woundLabel);
    if (state.activeIdB === ch.id) state.activeIdB = null;
    state.activeId = state.characters.length ? state.characters[0].id : null;
    OSR.save();
    refreshCharUI();
  }

  /* ---- View-mode selection -> new/existing Compendium entry (rewrites the sheet) ---- */
  // Set by the "Add to Compendium" context-menu item; consumed by saveCompEntry
  // (js/compendium.js) — cross-file, so it lives on OSR rather than as a
  // module-local variable.
  OSR.pendingCompLink = null;  // { charId, part: 0|1|null, find: <selected text> }
  let selMenuData = null;      // { text, tgt } while #sel-menu is open

  // Which character (and, for a split single-char view, which half) owns the
  // node the selection sits in.
  function charViewTarget(node) {
    const a = OSR.activeChar();
    if (!a) return null;
    const el = node && node.nodeType === 1 ? node : (node && node.parentNode);
    const col = el && el.closest ? el.closest('#mode-view .char-cols > .char-col') : null;
    if (charB()) {
      if (!col) return { ch: a, part: null };
      const cols = $$('#mode-view .char-cols > .char-col');
      return { ch: cols[1] === col ? charB() : a, part: null };
    }
    if (col) {
      const cols = $$('#mode-view .char-cols > .char-col');
      return { ch: a, part: cols[1] === col ? 1 : 0 };
    }
    return { ch: a, part: null };
  }

  // Replace the first occurrence of `find` in `text` with `link`. Falls back to
  // a whitespace-tolerant match (a rendered selection can collapse newlines /
  // markdown punctuation). Returns { ok, text }.
  function linkifyInText(text, find, link) {
    const src = String(text || '');
    const i = src.indexOf(find);
    if (i !== -1) return { ok: true, text: src.slice(0, i) + link + src.slice(i + find.length) };
    const toks = find.trim().split(/\s+/).filter(Boolean)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!toks.length) return { ok: false, text: src };
    const m = src.match(new RegExp(toks.join('[\\s\\S]{0,3}?')));
    if (m) return { ok: true, text: src.slice(0, m.index) + link + src.slice(m.index + m[0].length) };
    return { ok: false, text: src };
  }

  function applyPendingCompLink(entryName) {
    const p = OSR.pendingCompLink;
    OSR.pendingCompLink = null;
    if (!p) return;
    const ch = OSR.state.characters.find(c => c.id === p.charId);
    if (!ch) return;
    const link = '[' + entryName + ']';
    let res;
    if (p.part == null) {
      res = linkifyInText(ch.body || '', p.find, link);
      if (res.ok) ch.body = res.text;
    } else {
      const lines = String(ch.body || '').split(/\r?\n/);
      const si = lines.findIndex(l => /^\s*---\s*$/.test(l));
      if (si === -1) {
        res = linkifyInText(ch.body || '', p.find, link);
        if (res.ok) ch.body = res.text;
      } else {
        let left = lines.slice(0, si).join('\n'), right = lines.slice(si + 1).join('\n');
        res = linkifyInText(p.part === 1 ? right : left, p.find, link);
        if (res.ok) {
          if (p.part === 1) right = res.text; else left = res.text;
          ch.body = left + '\n' + lines[si] + '\n' + right;
        }
      }
    }
    if (!res || !res.ok) {
      OSR.pushNote('Compendium', 'created "' + entryName + '" (couldn\'t locate the selected text to link)');
      return;
    }
    ch.updatedAt = Date.now();
    OSR.save();
    refreshCharUI();
  }

  function openSelMenu(x, y, text, tgt) {
    const m = $('#sel-menu');
    const short = text.length > 44 ? text.slice(0, 42) + '…' : text;
    const r = OSR.compResolve(text);
    const matches = r.items;
    let html = '<div class="ctx-head">Add &ldquo;' + escapeHtml(short) + '&rdquo;</div>';
    if (matches.length) {
      html += '<div class="ctx-sub">' + (r.fuzzy ? 'Similar entries' : 'Matching entries') + '</div>' +
        '<div class="ctx-list">' + matches.map((en, i) => {
          const sc = r.scores && r.scores[i];
          const pct = r.fuzzy && typeof sc === 'number'
            ? '<span class="ctx-check">&asymp;' + Math.round((1 - sc) * 100) + '%</span>' : '';
          return '<button class="ctx-item" data-act="link" data-id="' + en.id + '" type="button">' +
            '<i class="fa-solid fa-book"></i><span>' + escapeHtml(en.name) + '</span>' +
            '<span class="badge">' + escapeHtml(en.category) + '</span>' + pct + '</button>';
        }).join('') + '</div>';
    }
    html += '<button class="ctx-item ctx-new" data-act="add-comp" type="button">' +
      '<i class="fa-solid fa-plus"></i><span>' +
      (matches.length ? 'Create new entry&hellip;' : 'Add &ldquo;' + escapeHtml(short) + '&rdquo; to Compendium') +
      '</span></button>';
    m.innerHTML = html;
    m.hidden = false;
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - m.offsetWidth - 8)) + 'px';
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - m.offsetHeight - 8)) + 'px';
    selMenuData = { text: text, tgt: tgt };
  }
  // Link the current selection to an existing Compendium entry (no editor):
  // the selected text is replaced with [entry.name], even when that name
  // differs from what was selected.
  function linkSelToExisting(en) {
    const d = selMenuData;
    if (!d || !en) return;
    OSR.pendingCompLink = { charId: d.tgt.ch.id, part: d.tgt.part, find: d.text };
    OSR.pushNote('Compendium', 'linked "' + d.text + '" to "' + en.name + '" (' + en.category + ' · ' +
      (en.source || OSR.COMPENDIUM_DEFAULT_SOURCE) + ')');
    applyPendingCompLink(en.name);
  }
  function closeSelMenu() { $('#sel-menu').hidden = true; selMenuData = null; }

  function wireCharacters() {
    $('#char-select').addEventListener('change', e => {
      OSR.state.activeId = e.target.value;
      if (OSR.state.activeIdB === OSR.state.activeId) OSR.state.activeIdB = null;
      OSR.mode = 'view';
      OSR.save();
      refreshCharUI();
    });
    $('#char-select-b').addEventListener('change', e => {
      OSR.state.activeIdB = e.target.value || null;
      OSR.mode = 'view';
      OSR.save();
      refreshCharUI();
    });
    $('#btn-new-blank').addEventListener('click', () => createCharacter(null));
    $('#btn-new-paste').addEventListener('click', OSR.pasteFromClipboard);
    $('#btn-new-text').addEventListener('click', () => OSR.openPasteModal(''));
    $('#btn-rename').addEventListener('click', renameChar);
    $('#btn-delete').addEventListener('click', deleteChar);

    // View / edit
    $('#btn-mode-view').addEventListener('click', () => setMode('view'));
    $('#btn-mode-edit').addEventListener('click', () => setMode('edit'));
    $('#btn-save').addEventListener('click', saveEdit);
    $('#btn-cancel').addEventListener('click', () => setMode('view'));

    // In the character editor, typing "[" or "]" while text is selected wraps
    // the selection in brackets instead of replacing it.
    $('#edit-host').addEventListener('keydown', e => {
      if (e.key !== '[' && e.key !== ']') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ta = e.target;
      if (!ta.classList || !ta.classList.contains('edit-col-area')) return;
      const s = ta.selectionStart, en = ta.selectionEnd;
      if (s == null || s === en) return; // nothing selected — insert normally
      e.preventDefault();
      const v = ta.value;
      ta.value = v.slice(0, s) + '[' + v.slice(s, en) + ']' + v.slice(en);
      ta.selectionStart = s + 1;
      ta.selectionEnd = en + 1;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Clickable rolls inside the rendered sheet. In two-character mode a click
    // in the right column is logged under (and rolls $variables from)
    // character B.
    $('#mode-view').addEventListener('click', e => {
      // A Unknown Armies Shock meter's Hardened/Failed dot: click dot N to set
      // the count to N, or click the currently-topmost filled dot again to
      // drop it back to N-1 — same "fill up to here" interaction as the
      // physical sheet's circles/boxes.
      const dot = e.target.closest('.ua-dot');
      if (dot) {
        const wrap = dot.closest('.ua-dots');
        const tgt = charViewTarget(e.target);
        if (!wrap || !tgt || !tgt.ch) return;
        const n = parseInt(dot.dataset.n, 10);
        const cur = parseInt(wrap.dataset.value, 10) || 0;
        setUAShockValue(tgt.ch, parseInt(wrap.dataset.fence, 10) || 0, wrap.dataset.meter, wrap.dataset.field, n === cur ? n - 1 : n);
        return;
      }
      const el = e.target.closest('.roll');
      if (!el) return;
      const tgt = charViewTarget(e.target);
      const ch = tgt && tgt.ch;
      OSR.doRoll(el.dataset.formula, ch ? ch.name : 'Character', OSR.charVars(ch));
    });

    // Right-click a text selection in View mode → "Add … to Compendium".
    // Right-clicking a dice-formula span itself instead opens the roll
    // popup (js/dice-ui.js's document-level contextmenu handler).
    $('#mode-view').addEventListener('contextmenu', e => {
      if (e.target.closest('.roll')) return;
      const sel = window.getSelection();
      const text = sel ? sel.toString().replace(/\s+$/, '').replace(/^\s+/, '') : '';
      if (!text || !sel.anchorNode || !$('#mode-view').contains(sel.anchorNode)) return;
      e.preventDefault();
      const tgt = charViewTarget(sel.anchorNode);
      if (!tgt || !tgt.ch) return;
      openSelMenu(e.clientX, e.clientY, text, tgt);
    });
    $('#sel-menu').addEventListener('click', e => {
      const item = e.target.closest('.ctx-item');
      if (!item || !selMenuData) return;
      const d = selMenuData;
      if (item.dataset.act === 'link') {
        const en = OSR.state.compendium.find(x => x.id === item.dataset.id);
        linkSelToExisting(en);
        closeSelMenu();
        return;
      }
      if (item.dataset.act === 'add-comp') {
        closeSelMenu();
        OSR.pendingCompLink = { charId: d.tgt.ch.id, part: d.tgt.part, find: d.text };
        OSR.openCompEntry(null, { name: d.text.replace(/\s+/g, ' ').trim() });
      }
    });
    document.addEventListener('mousedown', e => {
      if (!$('#sel-menu').hidden && !(e.target instanceof Element && e.target.closest('#sel-menu'))) closeSelMenu();
    });
    document.addEventListener('scroll', closeSelMenu, true);
    window.addEventListener('resize', closeSelMenu);
  }

  Object.assign(OSR, {
    detectNameSystem, createCharacter, charSystemKey, charactersForSystem, charB, fillCharOptions, refreshCharUI,
    splitBodyColumns, charColHtml, charColHead, renderCharView, renderCharEdit,
    setMode, renameHpTracker, renameWoundTracker, saveEdit, renameChar, deleteChar,
    charViewTarget, linkifyInText, applyPendingCompLink,
    openSelMenu, closeSelMenu, linkSelToExisting, wireCharacters,
    uaStatblockHtml, renderUABlocks, renderCharMarkdown, syncWoundTracker,
    patchUAFence, setUAShockValue,
    get selMenuData() { return selMenuData; }
  });
})(window.OSR = window.OSR || {});
