/* js/campaigns.js — the Campaign selector (header #campaign-select) and
 * Settings → Campaign (Rename, Delete).
 *
 * A campaign is a separate OSR.state, kept as its own documents in IndexedDB
 * (js/store.js). OSR.campaigns / OSR.campaignId live in js/core.js, which
 * also loads and saves them. Switching saves the current campaign first,
 * then loads the other one and re-renders every panel. A new campaign gets
 * the default Bestiary and Compendium of every system, but no example
 * characters.
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml, uid } = OSR;
  const NEW = '__new';

  function currentCampaign() {
    return OSR.campaigns.find(c => c.id === OSR.campaignId) || null;
  }

  function renderCampaigns() {
    const sel = $('#campaign-select');
    if (sel) {
      sel.innerHTML = OSR.campaigns.map(c =>
        '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + '</option>').join('') +
        '<option value="' + NEW + '">+ New campaign…</option>';
      sel.value = OSR.campaignId || '';
    }
    const hint = $('#set-campaign-hint');
    if (hint) {
      const cur = currentCampaign();
      hint.textContent = (cur ? 'This is “' + cur.name + '”. ' : '') +
        'Each campaign has its own characters, Journal, log, combat, Bestiary, and Compendium. ' +
        'Switch or create campaigns with the selector next to the title.';
    }
    const del = $('#set-campaign-delete');
    if (del) del.disabled = OSR.campaigns.length < 2;
  }

  // The panels that show OSR.state (same list as js/io.js's finishLoad()).
  function renderAll() {
    OSR.mode = 'view';
    OSR.applyTheme();
    OSR.refreshCharUI();
    OSR.renderNotes();
    OSR.renderLog();
    OSR.renderCombat();
    OSR.renderMonsterBrowser();
    OSR.renderCompendium();
    OSR.renderTables();
    OSR.renderSettings();
    renderCampaigns();
  }

  // Saves the current campaign (and lets a running Dropbox pass finish), then
  // loads campaign `id`. An empty campaign gets the default seeds.
  async function switchCampaign(id) {
    if (!OSR.campaigns.some(c => c.id === id) || id === OSR.campaignId) { renderCampaigns(); return; }
    await OSR.flushSave();
    if (OSR.dropboxBeforeCampaignSwitch) await OSR.dropboxBeforeCampaignSwitch();
    const had = await OSR.loadCampaign(id);
    await OSR.writeCampaigns();
    if (!had) OSR.seedMissing(false);
    if (!OSR.activeChar() && OSR.state.characters.length) OSR.state.activeId = OSR.state.characters[0].id;
    OSR.resetCompendiumFilters();
    OSR.resetTableFilters();
    renderAll();
    OSR.save();
    if (OSR.dropboxCampaignChanged) OSR.dropboxCampaignChanged();
  }

  async function createCampaign(name) {
    name = String(name || '').trim();
    if (!name) { renderCampaigns(); return null; }
    const c = { id: uid(), name, createdAt: Date.now(), primary: false };
    OSR.campaigns.push(c);
    await switchCampaign(c.id);
    OSR.pushNote('Campaign', 'Created “' + name + '”');
    return c;
  }

  async function renameCampaign(id, name) {
    const c = OSR.campaigns.find(x => x.id === id);
    name = String(name || '').trim();
    if (!c || !name || name === c.name) return;
    c.name = name;
    await OSR.writeCampaigns();
    renderCampaigns();
  }

  // Deletes campaign `id` from this browser. Its Dropbox file stays.
  async function deleteCampaign(id) {
    const c = OSR.campaigns.find(x => x.id === id);
    if (!c || OSR.campaigns.length < 2) return false;
    if (!confirm('Delete the campaign “' + c.name + '” from this browser?\n\n' +
        'Its characters, Journal, log, combat, Bestiary, and Compendium are removed here. ' +
        'A copy in your Dropbox stays. Export it first to keep a file.')) return false;
    if (id === OSR.campaignId) await switchCampaign(OSR.campaigns.find(x => x.id !== id).id);
    OSR.campaigns = OSR.campaigns.filter(x => x.id !== id);
    await OSR.writeCampaigns();
    await OSR.store.deleteDocs(id);
    if (OSR.dropboxForgetCampaign) OSR.dropboxForgetCampaign(id);
    renderCampaigns();
    return true;
  }

  function wireCampaigns() {
    $('#campaign-select').addEventListener('change', e => {
      const v = e.target.value;
      if (v === NEW) createCampaign(prompt('Name of the new campaign:', ''));
      else switchCampaign(v);
    });
    $('#set-campaign-rename').addEventListener('click', () => {
      const c = currentCampaign();
      if (c) renameCampaign(c.id, prompt('New name for the campaign:', c.name));
    });
    $('#set-campaign-delete').addEventListener('click', () => {
      const c = currentCampaign();
      if (c) deleteCampaign(c.id);
    });
  }

  Object.assign(OSR, {
    currentCampaign, renderCampaigns, switchCampaign, createCampaign, renameCampaign, deleteCampaign, wireCampaigns
  });
})(window.OSR = window.OSR || {});
