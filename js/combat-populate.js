/* js/combat-populate.js — Combat's "+ Populate by HD…" modal: spend a total
 * Hit Dice budget on monsters drawn from the current system's Bestiary
 * (OSR.monstersForSystem(), same library js/monster-modals.js and
 * js/monster-browser.js read), with an optional exact monster count. The
 * planner always spends the whole budget exactly (never over/under), then
 * the modal shows the proposal for confirmation before anything is added to
 * combat — reroll or go back and change the inputs, or confirm to add every
 * picked monster via OSR.addMonsterEntry() (same entry point Add-to-Combat
 * buttons elsewhere use).
 *
 * The budget and every monster's HD cost are tracked in half-HD integer
 * "units" (HD * 2) so the planner is exact-integer coin-change, not floating
 * point: a monster whose own HD is literally "0" (Shadowdark/OSE's weakest
 * tier) still costs 1 unit = 0.5 HD, never 0 — see effectiveHdUnits().
 */
(function (OSR) {
  'use strict';
  const { $, escapeHtml } = OSR;

  const MAX_BUDGET_UNITS = 1000; // 500 HD — generous, keeps the DP tables small
  const MAX_COUNT = 200;

  function effectiveHdUnits(d) {
    const hd = d.hdNum != null ? d.hdNum : (window.MonsterParse ? MonsterParse.hdNum(d.hd) : 0);
    return Math.max(1, Math.round(hd * 2));
  }

  // Only monsters with real HD data can be planned against -> Map<units, [def, ...]>.
  function monstersByUnit(monsters) {
    const map = new Map();
    monsters.forEach(d => {
      if (d.hdNum == null && !d.hd) return;
      const u = effectiveHdUnits(d);
      if (!map.has(u)) map.set(u, []);
      map.get(u).push(d);
    });
    return map;
  }

  // Unbounded coin-change feasibility (any monster count, repeats allowed):
  // feasible[s] is true if some combination of `units` sums to exactly s.
  function feasibleSums(units, budgetUnits) {
    const feasible = new Array(budgetUnits + 1).fill(false);
    feasible[0] = true;
    for (let s = 1; s <= budgetUnits; s++) feasible[s] = units.some(u => u <= s && feasible[s - u]);
    return feasible;
  }
  // Same, but constrained to exactly countN picks: feasible[k][s].
  function feasibleSumsWithCount(units, budgetUnits, countN) {
    const feasible = Array.from({ length: countN + 1 }, () => new Array(budgetUnits + 1).fill(false));
    feasible[0][0] = true;
    for (let k = 1; k <= countN; k++) {
      for (let s = 0; s <= budgetUnits; s++) feasible[k][s] = units.some(u => u <= s && feasible[k - 1][s - u]);
    }
    return feasible;
  }
  function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Random-walk backtrack over a feasibility table to a valid combination of
  // units summing to budgetUnits — unconstrained count (countN == null, the
  // algorithm decides how many monsters) or exactly countN of them. Returns
  // an array of units, or null if no combination reaches the budget exactly.
  function pickUnitPlan(units, budgetUnits, countN) {
    const plan = [];
    if (countN == null) {
      const feasible = feasibleSums(units, budgetUnits);
      if (!feasible[budgetUnits]) return null;
      let s = budgetUnits;
      while (s > 0) {
        const u = randomChoice(units.filter(x => x <= s && feasible[s - x]));
        plan.push(u);
        s -= u;
      }
    } else {
      const feasible = feasibleSumsWithCount(units, budgetUnits, countN);
      if (!feasible[countN][budgetUnits]) return null;
      let s = budgetUnits, k = countN;
      while (k > 0) {
        const u = randomChoice(units.filter(x => x <= s && feasible[k - 1][s - x]));
        plan.push(u);
        s -= u;
        k--;
      }
    }
    return plan;
  }

  // monsters: the pool to plan against (pass OSR.monstersForSystem()).
  // totalHd/count come straight off the form (count may be '' or null for "auto").
  // Returns { ok:true, picks:[def, ...], totalHd, count } or { ok:false, reason }.
  function buildHdPopulatePlan(monsters, totalHd, count) {
    const budgetUnits = Math.round(Number(totalHd) * 2);
    if (!(budgetUnits > 0)) return { ok: false, reason: 'Enter a total HD greater than 0.' };
    if (budgetUnits > MAX_BUDGET_UNITS) return { ok: false, reason: 'Total HD is too large (max ' + (MAX_BUDGET_UNITS / 2) + ').' };
    const countStr = String(count == null ? '' : count).trim();
    const countN = countStr === '' ? null : Math.round(Number(countStr));
    if (countN != null && !(countN > 0)) return { ok: false, reason: 'Number of monsters must be at least 1.' };
    if (countN != null && countN > MAX_COUNT) return { ok: false, reason: 'Number of monsters is too large (max ' + MAX_COUNT + ').' };
    const byUnit = monstersByUnit(monsters);
    const units = Array.from(byUnit.keys()).sort((a, b) => a - b);
    if (!units.length) return { ok: false, reason: 'No monsters with HD in the current Bestiary to build from.' };
    const plan = pickUnitPlan(units, budgetUnits, countN);
    if (!plan) {
      return {
        ok: false,
        reason: countN != null
          ? "Can't spend exactly " + (budgetUnits / 2) + ' HD across exactly ' + countN + ' monster(s) with the HD values currently in the Bestiary — try a different count.'
          : "Can't spend exactly " + (budgetUnits / 2) + ' HD with the HD values currently in the Bestiary.'
      };
    }
    const picks = plan.map(u => randomChoice(byUnit.get(u)));
    return { ok: true, picks, totalHd: budgetUnits / 2, count: picks.length };
  }

  /* ---- modal ---- */
  let currentPlan = null;

  function openPopulateHdModal() {
    currentPlan = null;
    $('#php-setup').hidden = false;
    $('#php-confirm').hidden = true;
    $('#php-setup-msg').textContent = '';
    $('#populate-hd-modal').hidden = false;
    $('#php-total-hd').focus();
  }
  function closePopulateHdModal() {
    $('#populate-hd-modal').hidden = true;
    currentPlan = null;
    OSR.hideLibPreview();
  }
  // One row per pick (not grouped) so each monster gets its own hover
  // preview + reroll-this-one-slot control. `data-id` (the def's own id in
  // state.monsters) is what OSR.showLibPreview() (js/monster-modals.js,
  // shared with the "Add monster" modal's library hover card) keys off.
  function renderPlanList() {
    if (!currentPlan) return;
    const byUnit = monstersByUnit(OSR.monstersForSystem());
    $('#php-list').innerHTML = currentPlan.picks.map((d, i) => {
      const canReroll = (byUnit.get(effectiveHdUnits(d)) || []).length > 1;
      return '<li class="comp-row php-row" data-idx="' + i + '" data-id="' + escapeHtml(String(d.id || '')) + '">' +
        '<div class="comp-row-head">' +
          '<span class="comp-name">' + escapeHtml(d.name) + '</span>' +
          '<button class="btn php-row-reroll" type="button"' + (canReroll ? '' : ' disabled') +
            ' title="Reroll — replace with another monster of the same HD">' +
            '<i class="fa-solid fa-dice-d20"></i></button>' +
          '<span class="badge">HD ' + escapeHtml(String(d.hd || '?')) + '</span>' +
        '</div></li>';
    }).join('');
  }
  function renderPlanPreview(plan) {
    currentPlan = plan;
    renderPlanList();
    $('#php-total-out').textContent = plan.totalHd;
    $('#php-count-out').textContent = plan.count;
    $('#php-setup').hidden = true;
    $('#php-confirm').hidden = false;
  }
  function generatePlan() {
    const plan = buildHdPopulatePlan(OSR.monstersForSystem(), $('#php-total-hd').value, $('#php-count').value);
    if (!plan.ok) { $('#php-setup-msg').textContent = plan.reason; return; }
    $('#php-setup-msg').textContent = '';
    renderPlanPreview(plan);
  }
  // Replace just the one picked monster at `idx` with a different monster
  // sharing the same effective HD — the budget/count never change.
  function rerollPick(idx) {
    if (!currentPlan || !currentPlan.picks[idx]) return;
    const d = currentPlan.picks[idx];
    const byUnit = monstersByUnit(OSR.monstersForSystem());
    const candidates = (byUnit.get(effectiveHdUnits(d)) || []).filter(x => x !== d);
    if (!candidates.length) return;
    currentPlan.picks[idx] = randomChoice(candidates);
    OSR.hideLibPreview();
    renderPlanList();
  }
  function backToSetup() {
    OSR.hideLibPreview();
    $('#php-confirm').hidden = true;
    $('#php-setup').hidden = false;
  }
  function confirmPlan() {
    if (!currentPlan) return;
    currentPlan.picks.forEach(d => OSR.addMonsterEntry(d));
    OSR.pushNote('Populate by HD', 'added ' + currentPlan.count + ' monster(s), ' + currentPlan.totalHd + ' HD total');
    closePopulateHdModal();
  }

  function onPlanListClick(e) {
    const btn = e.target.closest('.php-row-reroll');
    if (!btn) return;
    rerollPick(Number(btn.closest('.php-row').dataset.idx));
  }

  function wirePopulateHd() {
    $('#cb-populate-hd').addEventListener('click', openPopulateHdModal);
    $('#php-close').addEventListener('click', closePopulateHdModal);
    $('#populate-hd-modal').addEventListener('click', e => { if (e.target === $('#populate-hd-modal')) closePopulateHdModal(); });
    $('#php-generate').addEventListener('click', generatePlan);
    $('#php-reroll').addEventListener('click', generatePlan);
    $('#php-back').addEventListener('click', backToSetup);
    $('#php-confirm-add').addEventListener('click', confirmPlan);
    $('#php-list').addEventListener('click', onPlanListClick);
    $('#php-list').addEventListener('mouseover', e => {
      const li = e.target.closest('.php-row[data-id]');
      if (li && li.dataset.id) OSR.showLibPreview(li);
    });
    $('#php-list').addEventListener('mouseleave', OSR.hideLibPreview);
    $('#php-list').addEventListener('scroll', OSR.hideLibPreview);
  }

  Object.assign(OSR, {
    effectiveHdUnits, monstersByUnit, feasibleSums, feasibleSumsWithCount, pickUnitPlan,
    buildHdPopulatePlan, openPopulateHdModal, closePopulateHdModal, wirePopulateHd
  });
})(window.OSR = window.OSR || {});
