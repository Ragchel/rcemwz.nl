const { decodePlayerInfoSaveBytes } = require('./decode-save');
const { extractSaveData } = require('./extract-save-data');
const {
    computeEffectiveChronoField,
    computeLoadoutSubstats,
    computeLoadoutSubstatsBreakdown,
    levelValue,
    assistCoreEfficiencyFraction,
    assistCoreEfficiencyLabCumulativeCost,
    durationLabCumulativeCost,
    ASSIST_CORE_EFFICIENCY_MAX_LAB_LEVEL,
    CHRONO_FIELD_DURATION_LAB_MAX_LEVEL,
    SPEED_REDUCTION_CAP_PERCENT,
    slotOverrideKey,
} = require('./chrono-field-math');
const { findCheapestPlan, findCheapestPlanViaLab } = require('./planner');

const PREFS_STORAGE_KEY = 'cf-calculator-prefs-v1';

/**
 * The player's own workspace choices (module picks, locked/changeable
 * marks, perk/battle-condition toggles, planner inputs) — not the save
 * itself, which can't be remembered across a reload for security reasons
 * and has to be re-chosen each time anyway.
 */
function loadStoredPrefs() {
    try {
        const raw = localStorage.getItem(PREFS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveStoredPrefs(prefs) {
    try {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // Private browsing / storage disabled — losing persistence is fine, the calculator still works without it.
    }
}

const NONE_KEY = '__none__';
const LOADOUT_IDS = ['farming', 'tournament'];
const LOADOUT_LABELS = { farming: 'Farming', tournament: 'Tournament' };
const CF_STAT_LABELS = {
    duration: 'Chrono Field Duration',
    cooldown: 'Chrono Field Cooldown',
    speedReduction: 'Chrono Field Speed Reduction',
};

function moduleOptionsHtml(coreModules, selectedKey) {
    const options = [`<option value="${NONE_KEY}"${selectedKey === NONE_KEY ? ' selected' : ''}>None equipped</option>`];
    for (const module of coreModules) {
        const selected = module.key === selectedKey ? ' selected' : '';
        options.push(`<option value="${escapeHtml(module.key)}"${selected}>${escapeHtml(module.label)}</option>`);
    }
    return options.join('');
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
}

/** Whether a slot reads as locked: the save's own state, unless the player has toggled it here. */
function isSlotLocked(module, slot, lockOverrides) {
    const key = slotOverrideKey(module.key, slot.slot);
    return lockOverrides.has(key) ? lockOverrides.get(key) : slot.locked;
}

/**
 * Every slot the planner is free to suggest something for: whichever slots
 * are explicitly marked Changeable, across whichever modules are currently
 * selected in either loadout. Not-yet-unlocked slots default to locked, same
 * as any real substat — the player has to mark one Changeable before the
 * planner will suggest anything for it.
 */
function collectEligibleSlots(modulesByKey, state, lockOverrides) {
    const moduleKeys = new Set([
        state.farming.primaryKey, state.farming.assistKey,
        state.tournament.primaryKey, state.tournament.assistKey,
    ]);

    const eligible = [];
    for (const key of moduleKeys) {
        if (key === NONE_KEY) continue;
        const module = modulesByKey.get(key);
        if (!module) continue;

        for (const slot of module.slots) {
            if (isSlotLocked(module, slot, lockOverrides)) continue;
            eligible.push({ moduleKey: module.key, moduleLabel: module.label, slotNumber: slot.slot, note: slot.note || null });
        }
    }
    return eligible;
}

// The Tower's own suffixes (lowercase/uppercase are distinct: q = quadrillion, Q = quintillion).
const COIN_SUFFIXES = ['', 'K', 'M', 'B', 'T', 'q', 'Q', 's', 'S', 'O', 'N', 'd'];

function formatCoins(value) {
    if (!Number.isFinite(value) || value <= 0) return '0';
    const tier = Math.max(0, Math.min(COIN_SUFFIXES.length - 1, Math.floor(Math.log10(value) / 3)));
    const scaled = value / 10 ** (tier * 3);
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${scaled.toFixed(digits)}${COIN_SUFFIXES[tier]}`;
}

function formatResearchDays(days) {
    const totalMinutes = Math.round(days * 24 * 60);
    const wholeDays = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    if (wholeDays > 0) return `${wholeDays}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

/**
 * Renders one Duration/Cooldown/Speed Reduction figure as the sum of terms
 * that produced it (level table value, lab/perk/battle-condition, primary
 * and assist substats), skipping any term that's zero. `terms[0]` sets the
 * line's sign convention; later terms show their own sign.
 */
function sourceLineHtml(label, unit, terms, cap) {
    const nonZero = terms.filter((term) => term.value !== 0);
    if (nonZero.length === 0) nonZero.push(terms[0]);
    const pieces = nonZero.map((term, index) => {
        const magnitude = `${Math.abs(term.value).toFixed(1)}${unit}`;
        if (index === 0) return `${term.value < 0 ? '−' : ''}${magnitude} (${escapeHtml(term.text)})`;
        return ` ${term.value >= 0 ? '+' : '−'} ${magnitude} (${escapeHtml(term.text)})`;
    });
    const rawTotal = terms.reduce((sum, term) => sum + term.value, 0);
    const cappedNote = cap != null && rawTotal > cap ? ` — capped at ${cap}${unit}` : '';
    return `<li>${escapeHtml(label)}: ${pieces.join('')}${cappedNote}</li>`;
}

/**
 * A collapsible "where these numbers come from" breakdown for one loadout's
 * final Duration/Cooldown/Speed Reduction — the aggregate figures alone
 * don't show how much came from stone levels vs. labs/perks vs. substats,
 * which two loadouts can split differently even at the same stone levels.
 */
function breakdownDetailsHtml({ levels, efficiency, breakdown, durationLabMaxed, runPerkActive, battleConditionActive }) {
    const assistLabel = `assist module substat, ×${Math.round(efficiency * 100)}%`;

    const durationTerms = [
        { text: `Duration level ${levels.duration}`, value: levelValue('Duration', levels.duration) },
        { text: 'Duration lab maxed', value: durationLabMaxed ? 30 : 0 },
        { text: 'run perk', value: runPerkActive ? 5 : 0 },
        { text: 'Ultimate Weapon Durations battle condition', value: battleConditionActive ? -10 : 0 },
        { text: 'primary module substat', value: breakdown.primary.duration },
        { text: assistLabel, value: breakdown.assist.duration * efficiency },
    ];
    const cooldownTerms = [
        { text: `Cooldown level ${levels.cooldown}`, value: levelValue('Cooldown', levels.cooldown) },
        { text: 'primary module substat', value: breakdown.primary.cooldown },
        { text: assistLabel, value: breakdown.assist.cooldown * efficiency },
    ];
    const speedTerms = [
        { text: `Speed level ${levels.speed}`, value: levelValue('Speed', levels.speed) },
        { text: 'primary module substat', value: breakdown.primary.speedReduction },
        { text: assistLabel, value: breakdown.assist.speedReduction * efficiency },
    ];

    return `
        <details class="cf-breakdown">
            <summary>Where these numbers come from</summary>
            <ul>
                ${sourceLineHtml('Duration', 's', durationTerms)}
                ${sourceLineHtml('Cooldown', 's', cooldownTerms)}
                ${sourceLineHtml('Speed reduction', '%', speedTerms, SPEED_REDUCTION_CAP_PERCENT)}
            </ul>
        </details>`;
}

/**
 * What each loadout's Duration/Cooldown/Speed Reduction actually comes out
 * to once the whole plan is applied — the new stone levels, the suggested
 * substats, and (if raised) the new assist efficiency — combined with that
 * loadout's own lab/perk/battle-condition inputs. The raw stone-level table
 * value alone isn't this: two loadouts can end up with different effective
 * numbers from the very same level, depending on their own substats/perks.
 */
function computeFinalLoadoutResult(loadout, plan, data) {
    const finalOverrides = new Map(
        plan.assignment.map((item) => [slotOverrideKey(item.moduleKey, item.slotNumber), { stat: item.stat, value: item.value }]),
    );
    const finalLevels = plan.levels || data.levels;
    const finalStoneLevel = plan.assistEfficiencyLevel ?? data.assistCoreEfficiencyStoneLevel;
    const finalLabLevel = plan.assistEfficiencyLabLevel ?? data.assistCoreEfficiencyLabLevel;
    const finalEfficiency = (plan.assistEfficiencyLevel != null || plan.assistEfficiencyLabLevel != null)
        ? assistCoreEfficiencyFraction(finalStoneLevel, finalLabLevel)
        : data.assistCoreEfficiency;
    const breakdown = computeLoadoutSubstatsBreakdown(data.coreModules, loadout.primaryKey, loadout.assistKey, finalOverrides);
    const substats = computeLoadoutSubstats(data.coreModules, loadout.primaryKey, loadout.assistKey, finalEfficiency, finalOverrides);
    const result = computeEffectiveChronoField({
        levels: finalLevels,
        substats,
        durationLabMaxed: loadout.durationLabMaxed,
        runPerkActive: loadout.runPerkActive,
        battleConditionActive: loadout.battleConditionActive,
    });
    return { result, breakdown, levels: finalLevels, efficiency: finalEfficiency };
}

/** One table cell: the current level, or the current (struck through) on one line and the new one below it, same as a planned slot. */
function levelCellHtml(before, after, formatLevel) {
    if (after == null || after === before) return formatLevel(before);
    return `<span class="cf-slot-before">${formatLevel(before)}</span><span class="cf-slot-after">${formatLevel(after)}</span>`;
}

/**
 * The account-wide stone/lab levels behind Duration/Cooldown/Speed Reduction
 * and the assist Core substat-efficiency lab, as a table — the save's
 * current values with no `plan`, or `current → after` per cell once one's
 * applied. Stays a table either way, so finding a plan doesn't change the
 * shape of this box. Which substats to roll is shown at the affected slot
 * itself (see `slotsHtml`'s "is-planned" state), not repeated here.
 */
function renderInvestmentTableHtml(data, plan, lead) {
    const durationLabMaxedAfter = plan?.durationLabCoinCost != null;
    const durationLabCell = data.durationLabMaxed
        ? 'Maxed (+30s)'
        : `Level ${data.durationLabLevel}/${CHRONO_FIELD_DURATION_LAB_MAX_LEVEL}`;

    const rows = [
        ['Duration', levelCellHtml(data.levels.duration, plan?.levels?.duration, (lvl) => `Level ${lvl} (${levelValue('Duration', lvl)}s)`),
            durationLabMaxedAfter ? `<span class="cf-slot-before">${durationLabCell}</span><span class="cf-slot-after">Maxed (+30s)</span>` : durationLabCell],
        ['Cooldown', levelCellHtml(data.levels.cooldown, plan?.levels?.cooldown, (lvl) => `Level ${lvl} (${levelValue('Cooldown', lvl)}s)`), '—'],
        ['Speed reduction', levelCellHtml(data.levels.speed, plan?.levels?.speed, (lvl) => `Level ${lvl} (${levelValue('Speed', lvl)}%)`), '—'],
        ['Assist Module Substats (Core)',
            levelCellHtml(data.assistCoreEfficiencyStoneLevel, plan?.assistEfficiencyLevel, (lvl) => `Level ${lvl} (+${lvl}%)`),
            levelCellHtml(data.assistCoreEfficiencyLabLevel, plan?.assistEfficiencyLabLevel, (lvl) => `Level ${lvl} (+${lvl}%)`)],
    ];

    const table = `
        <table class="cf-investment-table">
            <thead><tr><th scope="col">Current</th><th scope="col">Stone</th><th scope="col">Lab</th></tr></thead>
            <tbody>
                ${rows.map(([label, stone, lab]) => `<tr><th scope="row">${label}</th><td>${stone}</td><td>${lab}</td></tr>`).join('')}
            </tbody>
        </table>`;

    // On the same line as each other: the plan's total cost (when there is
    // one) followed by how many Power Stones are on hand right now.
    const costText = plan ? planCostSummaryHtml(plan, data) : '';
    const stonesText = data.stones != null ? `${data.stones.toLocaleString()} Power Stones available.` : '';
    const summaryParts = [costText, stonesText].filter(Boolean);
    const summary = summaryParts.length > 0 ? `<p class="cf-investment-summary">${summaryParts.join(' ')}</p>` : '';

    return `${lead || ''}${table}${summary}`;
}

/** Rough days of farming to earn `coins` at the save's recent coins/hour — `null` when that rate isn't known. A peak rate (best 3 runs), so an optimistic estimate. */
function farmingDaysToEarn(coins, coinsPerHour) {
    if (!coinsPerHour || coinsPerHour <= 0) return null;
    return coins / coinsPerHour / 24;
}

/**
 * The plan's total cost — mentions coins/research days too when the plan
 * raises assist efficiency via the lab instead of stones. Returns bare text
 * (the quantities bolded), not a `<p>`, so the caller can put it on the same
 * line as the "N Power Stones available" line.
 */
function planCostSummaryHtml(plan, data) {
    const pieces = [];
    if (plan.additionalCost > 0) pieces.push(`<strong>${plan.additionalCost.toLocaleString()}</strong> Power Stones`);
    if (plan.assistEfficiencyLabLevel != null) {
        pieces.push(`<strong>${formatCoins(plan.labCoinCost)}</strong> coins`, `<strong>${formatResearchDays(plan.labDurationDays)}</strong> of research`);
        const farmingDays = farmingDaysToEarn(plan.labCoinCost, data.coinsPerHour);
        if (farmingDays != null) pieces.push(`<strong>~${formatResearchDays(farmingDays)}</strong> of farming to earn the coins`);
    }
    if (plan.durationLabCoinCost != null) {
        pieces.push(`<strong>${formatCoins(plan.durationLabCoinCost)}</strong> coins`, `<strong>${formatResearchDays(plan.durationLabDurationDays)}</strong> of research`);
        const farmingDays = farmingDaysToEarn(plan.durationLabCoinCost, data.coinsPerHour);
        if (farmingDays != null) pieces.push(`<strong>~${formatResearchDays(farmingDays)}</strong> of farming to earn the coins`);
    }
    if (pieces.length === 0) {
        return plan.assignment.length > 0
            ? 'No stone or coin cost — just reroll the highlighted substat(s).'
            : 'You already meet that target on both loadouts with permanent uptime.';
    }
    return `${pieces.join(' + ')} total.`;
}

/** One suggested substat, formatted the same way a real rolled substat would read (e.g. "Mythic Chrono Field Speed Reduction +11%"). */
function plannedSlotLabelHtml(item) {
    const sign = item.value > 0 ? '+' : '';
    const unit = item.stat === 'speedReduction' ? '%' : 's';
    return `${escapeHtml(item.rarity)} ${escapeHtml(CF_STAT_LABELS[item.stat])} ${sign}${item.value}${unit}`;
}

/** `moduleKey -> (slotNumber -> assignment item)`, for looking up which slot(s) a module has a plan suggestion for. `null` when no plan is applied. */
function buildPlannedByModule(plan) {
    if (!plan) return null;
    const map = new Map();
    for (const item of plan.assignment) {
        if (!map.has(item.moduleKey)) map.set(item.moduleKey, new Map());
        map.get(item.moduleKey).set(item.slotNumber, item);
    }
    return map;
}

function slotsHtml(module, lockOverrides, plannedForModule) {
    if (!module) return '<p class="cf-module-slots-empty">Choose a module to see its substats.</p>';

    const items = module.slots.map((slot) => {
        const locked = isSlotLocked(module, slot, lockOverrides);
        const planned = plannedForModule?.get(slot.slot);
        const classes = ['cf-module-slot'];
        if (slot.unlocked && slot.isChronoField) classes.push('is-cf');
        if (!slot.unlocked) classes.push('is-empty');
        if (locked) classes.push('is-locked');
        if (planned) classes.push('is-planned');

        const note = slot.note ? ` — ${escapeHtml(slot.note)}` : '';
        const beforeLabel = slot.unlocked
            ? `${slot.rarity ? `${escapeHtml(slot.rarity)} ` : ''}${escapeHtml(slot.label)}${slot.displayValue ? ` ${escapeHtml(slot.displayValue)}` : ''}`
            : `Not yet unlocked${note}`;
        const label = planned
            ? `<span class="cf-slot-before">${beforeLabel}</span><span class="cf-slot-after">${plannedSlotLabelHtml(planned)}</span>`
            : beforeLabel;

        return `
            <li class="${classes.join(' ')}">
                <span class="cf-module-slot-label">Slot ${slot.slot}: ${label}</span>
                <button type="button" class="cf-module-slot-toggle" data-cf-slot-toggle
                    data-module-key="${escapeHtml(module.key)}" data-slot="${slot.slot}"
                    aria-pressed="${locked ? 'true' : 'false'}"
                    title="Click to mark this slot as locked or changeable">${locked ? 'Locked' : 'Changeable'}</button>
            </li>`;
    });

    return `<ul class="cf-module-slots">${items.join('')}</ul>`;
}

function renderModuleSlots(container, modulesByKey, key, lockOverrides, plannedByModule) {
    const module = modulesByKey.get(key);
    container.innerHTML = slotsHtml(module, lockOverrides, plannedByModule?.get(key));
}

function loadoutInputs(data, modulesByKey, loadoutState) {
    return {
        levels: data.levels,
        substats: computeLoadoutSubstats(modulesByKey, loadoutState.primaryKey, loadoutState.assistKey, data.assistCoreEfficiency),
        durationLabMaxed: data.durationLabMaxed,
        runPerkActive: Boolean(loadoutState.runPerkActive),
        battleConditionActive: Boolean(loadoutState.battleConditionActive),
    };
}

function formatSeconds(value) {
    return `${value.toFixed(1)}s`;
}

function statusBadgeHtml(result) {
    const statusClass = result.permanent ? 'is-reached' : 'is-short';
    const statusText = result.permanent ? 'Permanent uptime reached' : 'Not permanent yet';
    return `<span class="cf-result-status ${statusClass}">${statusText}</span>`;
}

/** One `<dt>`/`<dd>` pair, showing `before → after` (after bolded) when a plan changes the value, otherwise just the single value. */
function statRowHtml(label, before, after, unit, digits) {
    const beforeText = before.toFixed(digits);
    if (after == null || after.toFixed(digits) === beforeText) {
        return `<dt>${label}</dt><dd>${(after ?? before).toFixed(digits)}${unit}</dd>`;
    }
    return `<dt>${label}</dt><dd>${beforeText}${unit} <span class="cf-slot-arrow" aria-hidden="true">→</span> <strong>${after.toFixed(digits)}${unit}</strong></dd>`;
}

/**
 * The loadout's current Duration/Cooldown/Speed Reduction (`before`), plus,
 * once a plan is applied, what they become (`after`) — shown as `before →
 * after` per stat rather than only the final numbers, so it's clear what the
 * plan actually changes versus what was already true beforehand.
 */
function renderResult(container, before, after, breakdownArgs) {
    const shown = after || before;
    const statusHtml = (after && before.permanent !== after.permanent)
        ? `${statusBadgeHtml(before)} <span class="cf-slot-arrow" aria-hidden="true">→</span> ${statusBadgeHtml(after)}`
        : statusBadgeHtml(shown);
    const marginLabel = shown.permanent ? 'Margin to spare' : 'Still short by';
    container.innerHTML = `
        ${statusHtml}
        <dl>
            ${statRowHtml('Speed reduction', before.speedReductionEff, after?.speedReductionEff, '%', 1)}
            ${statRowHtml('Duration', before.durationEff, after?.durationEff, 's', 1)}
            ${statRowHtml('Cooldown', before.cooldownEff, after?.cooldownEff, 's', 1)}
            <dt>${marginLabel}</dt><dd>${formatSeconds(Math.abs(shown.marginSeconds))}</dd>
        </dl>
        ${breakdownDetailsHtml(breakdownArgs)}
    `;
}

function loadoutCardHtml(id, title, coreModules, extraToggleHtml, defaults) {
    return `
        <div class="cf-loadout" data-cf-loadout="${id}">
            <h3>${title}</h3>
            <div class="cf-loadout-body">
                <div class="cf-loadout-main">
                    <div class="cf-core-modules">
                        <div class="cf-loadout-field">
                            <label for="cf-${id}-primary">Primary Core module</label>
                            <select id="cf-${id}-primary" data-cf-primary>${moduleOptionsHtml(coreModules, defaults.primaryKey)}</select>
                            <div class="cf-module-slots-wrap" data-cf-primary-slots></div>
                        </div>
                        <div class="cf-loadout-field">
                            <label for="cf-${id}-assist">Assist Core module</label>
                            <select id="cf-${id}-assist" data-cf-assist>${moduleOptionsHtml(coreModules, defaults.assistKey)}</select>
                            <div class="cf-module-slots-wrap" data-cf-assist-slots></div>
                        </div>
                    </div>
                </div>
                <div class="cf-loadout-side">
                    <div class="cf-result" data-cf-result aria-live="polite"></div>
                    ${extraToggleHtml}
                </div>
            </div>
        </div>
    `;
}

function renderWorkspace(workspace, data) {
    const modulesByKey = new Map(data.coreModules.map((module) => [module.key, module]));
    const defaultKeys = {
        primaryKey: data.defaultPrimaryKey || NONE_KEY,
        assistKey: data.defaultAssistKey || NONE_KEY,
    };

    // Restore the player's last workspace choices for this browser, falling
    // back to the save's own equipped defaults for anything unset or no
    // longer valid (e.g. a module key from an inventory that's since changed).
    const storedPrefs = loadStoredPrefs();
    const validKey = (key) => key === NONE_KEY || modulesByKey.has(key);
    function resolveLoadoutDefaults(id, extraDefaults) {
        const stored = storedPrefs?.[id];
        const extra = {};
        for (const [field, fallback] of Object.entries(extraDefaults)) {
            extra[field] = stored && typeof stored[field] === 'boolean' ? stored[field] : fallback;
        }
        return {
            primaryKey: stored && validKey(stored.primaryKey) ? stored.primaryKey : defaultKeys.primaryKey,
            assistKey: stored && validKey(stored.assistKey) ? stored.assistKey : defaultKeys.assistKey,
            ...extra,
        };
    }
    const farmingInitial = resolveLoadoutDefaults('farming', { runPerkActive: true });
    const tournamentInitial = resolveLoadoutDefaults('tournament', { battleConditionActive: true });
    const initialTarget = Number.isFinite(storedPrefs?.target)
        ? Math.min(SPEED_REDUCTION_CAP_PERCENT, storedPrefs.target)
        : SPEED_REDUCTION_CAP_PERCENT;
    const initialLabSpeed = [1, 1.5, 2, 3, 4, 5, 6, 7, 8].includes(storedPrefs?.labSpeedMultiplier) ? storedPrefs.labSpeedMultiplier : 1;
    const initialLabCap = Number.isInteger(storedPrefs?.assistLabCap)
        && storedPrefs.assistLabCap >= data.assistCoreEfficiencyLabLevel
        && storedPrefs.assistLabCap <= ASSIST_CORE_EFFICIENCY_MAX_LAB_LEVEL
        ? storedPrefs.assistLabCap
        : ASSIST_CORE_EFFICIENCY_MAX_LAB_LEVEL;

    workspace.innerHTML = `
        <div class="cf-planner">
            <h3>Plan your build</h3>
            <p>Uses any slot marked Changeable to figure out what to roll there, on top of stone levels. Applying a plan highlights the changed slot(s) below and shows before/after stats on each loadout.</p>
            <div class="cf-planner-row">
                <form class="cf-planner-form cf-planner-box" data-cf-planner-form>
                    <div class="cf-loadout-field">
                        <label for="cf-target-slow">Target speed reduction (%)</label>
                        <input type="number" id="cf-target-slow" min="20" max="${SPEED_REDUCTION_CAP_PERCENT}" step="1" value="${initialTarget}" data-cf-target>
                    </div>
                    <div class="cf-loadout-field">
                        <label for="cf-lab-speed">Lab boost (elite cells)</label>
                        <select id="cf-lab-speed" data-cf-lab-speed>
                            ${[1, 1.5, 2, 3, 4, 5, 6, 7, 8].map((x) => `<option value="${x}"${x === initialLabSpeed ? ' selected' : ''}>${x === 1 ? 'None' : `${x}x`}</option>`).join('')}
                        </select>
                    </div>
                    <div class="cf-loadout-field">
                        <label for="cf-lab-cap">Cap Assist Module Substats lab at level</label>
                        <input type="number" id="cf-lab-cap" min="${data.assistCoreEfficiencyLabLevel}" max="${ASSIST_CORE_EFFICIENCY_MAX_LAB_LEVEL}" step="1" value="${initialLabCap}" data-cf-lab-cap>
                    </div>
                    <div class="cf-planner-actions">
                        <button type="submit" class="cf-planner-submit">Find the cheapest plan</button>
                        <button type="button" class="cf-reset-button" data-cf-reset title="Discard every change made here and go back to what the save file itself says">Reset to save file</button>
                    </div>
                </form>
                <div class="cf-investment-box cf-planner-box">
                    <h4>Investment</h4>
                    <div class="cf-planner-result" data-cf-planner-result aria-live="polite">${renderInvestmentTableHtml(data, null)}</div>
                </div>
            </div>
        </div>
        <div class="cf-loadouts">
            ${loadoutCardHtml('farming', 'Farming loadout', data.coreModules, `
                <div class="cf-loadout-toggle">
                    <input type="checkbox" id="cf-farming-perk" data-cf-run-perk${farmingInitial.runPerkActive ? ' checked' : ''}>
                    <label for="cf-farming-perk">"Chrono Field Duration +5s" run perk reliably picked</label>
                </div>
            `, farmingInitial)}
            ${loadoutCardHtml('tournament', 'Tournament loadout', data.coreModules, `
                <div class="cf-loadout-toggle">
                    <input type="checkbox" id="cf-tournament-bc" data-cf-battle-condition${tournamentInitial.battleConditionActive ? ' checked' : ''}>
                    <label for="cf-tournament-bc">"Ultimate Weapon Durations" battle condition active (-10s Chrono Field duration)</label>
                </div>
            `, tournamentInitial)}
        </div>
    `;

    const state = {
        farming: { primaryKey: farmingInitial.primaryKey, assistKey: farmingInitial.assistKey, runPerkActive: farmingInitial.runPerkActive },
        tournament: { primaryKey: tournamentInitial.primaryKey, assistKey: tournamentInitial.assistKey, battleConditionActive: tournamentInitial.battleConditionActive },
    };
    // Shared across both loadout cards: a module's locked/changeable marking
    // is a property of the module itself, not of which card is showing it.
    const lockOverrides = new Map(Array.isArray(storedPrefs?.lockOverrides) ? storedPrefs.lockOverrides : []);
    const cards = new Map(LOADOUT_IDS.map((id) => [
        id,
        workspace.querySelector(`[data-cf-loadout="${id}"]`),
    ]));

    // The last plan the search produced, so the Lab speed multiplier can
    // update its coin/day estimate live without re-running the search —
    // that search picks the plan by stone cost alone, which speed never
    // changes, so only the display needs to change.
    let lastResult = null;
    // The plan currently reflected in the loadout cards below (highlighted
    // slots, before/after stats) — same as `lastResult.plan`/`loadoutContexts`
    // once a search succeeds, `null` again once it's cleared or reset.
    let appliedPlan = null;
    let appliedLoadoutContexts = null;

    function renderPlanResult() {
        const resultEl = workspace.querySelector('[data-cf-planner-result]');
        resultEl.innerHTML = lastResult
            ? renderInvestmentTableHtml(data, lastResult.plan, lastResult.lead)
            : renderInvestmentTableHtml(data, null);
    }

    function persist() {
        const targetInput = workspace.querySelector('[data-cf-target]');
        const labSpeedSelect = workspace.querySelector('[data-cf-lab-speed]');
        const labCapInput = workspace.querySelector('[data-cf-lab-cap]');
        saveStoredPrefs({
            farming: { ...state.farming },
            tournament: { ...state.tournament },
            lockOverrides: Array.from(lockOverrides.entries()),
            target: Number(targetInput?.value),
            labSpeedMultiplier: Number(labSpeedSelect?.value),
            assistLabCap: Number(labCapInput?.value),
        });
    }

    function recompute(id) {
        const card = cards.get(id);
        const inputs = loadoutInputs(data, modulesByKey, state[id]);
        const before = computeEffectiveChronoField(inputs);
        const beforeBreakdown = computeLoadoutSubstatsBreakdown(modulesByKey, state[id].primaryKey, state[id].assistKey);
        const beforeBreakdownArgs = {
            levels: data.levels,
            efficiency: data.assistCoreEfficiency,
            breakdown: beforeBreakdown,
            durationLabMaxed: data.durationLabMaxed,
            runPerkActive: inputs.runPerkActive,
            battleConditionActive: inputs.battleConditionActive,
        };

        let after = null;
        let afterBreakdownArgs = null;
        const appliedLoadout = appliedLoadoutContexts?.find((entry) => entry.id === id);
        if (appliedPlan && appliedLoadout) {
            const final = computeFinalLoadoutResult(appliedLoadout, appliedPlan, data);
            after = final.result;
            afterBreakdownArgs = {
                levels: final.levels,
                efficiency: final.efficiency,
                breakdown: final.breakdown,
                durationLabMaxed: appliedLoadout.durationLabMaxed,
                runPerkActive: appliedLoadout.runPerkActive,
                battleConditionActive: appliedLoadout.battleConditionActive,
            };
        }

        renderResult(card.querySelector('[data-cf-result]'), before, after, afterBreakdownArgs || beforeBreakdownArgs);
    }

    function recomputeAll() {
        for (const id of LOADOUT_IDS) recompute(id);
    }

    // A module can be visible in both loadouts, so redraw every slot panel
    // whenever its locked/changeable state changes.
    function renderAllModuleSlots() {
        const plannedByModule = buildPlannedByModule(appliedPlan);
        for (const id of LOADOUT_IDS) {
            const card = cards.get(id);
            renderModuleSlots(card.querySelector('[data-cf-primary-slots]'), modulesByKey, state[id].primaryKey, lockOverrides, plannedByModule);
            renderModuleSlots(card.querySelector('[data-cf-assist-slots]'), modulesByKey, state[id].assistKey, lockOverrides, plannedByModule);
        }
    }

    function refreshWorkspace() {
        renderAllModuleSlots();
        recomputeAll();
    }

    for (const id of LOADOUT_IDS) {
        const card = cards.get(id);
        card.querySelector('[data-cf-primary]').addEventListener('change', (event) => {
            state[id].primaryKey = event.target.value;
            refreshWorkspace();
            persist();
            // Which modules/slots are eligible can change the plan itself, not
            // just the display — same reasoning as the perk/battle-condition
            // toggles below, so re-run rather than leave a stale plan showing.
            if (lastResult) runPlanner();
        });
        card.querySelector('[data-cf-assist]').addEventListener('change', (event) => {
            state[id].assistKey = event.target.value;
            refreshWorkspace();
            persist();
            if (lastResult) runPlanner();
        });
    }
    refreshWorkspace();

    workspace.addEventListener('click', (event) => {
        const button = event.target.closest('[data-cf-slot-toggle]');
        if (!button) return;

        const overrideKey = slotOverrideKey(button.dataset.moduleKey, Number(button.dataset.slot));
        const currentlyLocked = button.getAttribute('aria-pressed') === 'true';
        lockOverrides.set(overrideKey, !currentlyLocked);
        renderAllModuleSlots();
        persist();
        // Locking/unlocking a slot changes which slots the planner is even
        // allowed to use, so a standing plan needs a fresh search too.
        if (lastResult) runPlanner();
    });

    workspace.querySelector('[data-cf-run-perk]').addEventListener('change', (event) => {
        state.farming.runPerkActive = event.target.checked;
        recompute('farming');
        persist();
        // A displayed plan's "ends up at" figures and suggested levels can
        // both depend on this, so keep it in sync rather than leaving it
        // showing what the previous checkbox state would have produced.
        if (lastResult) runPlanner();
    });
    workspace.querySelector('[data-cf-battle-condition]').addEventListener('change', (event) => {
        state.tournament.battleConditionActive = event.target.checked;
        recompute('tournament');
        persist();
        if (lastResult) runPlanner();
    });
    // The save's own speed sources (Labs Speed lab level, relic bonus) plus
    // whatever the player enters for anything else (events, ...). Kept as a
    // function since the "extra" part can change after the plan is found.
    function speedModifiers() {
        return {
            labSpeedLabLevel: data.labsSpeedLabLevel,
            labSpeedRelicPct: data.labSpeedRelicPercent / 100,
            speedUpMultiplier: Number(workspace.querySelector('[data-cf-lab-speed]').value) || 1,
        };
    }

    workspace.querySelector('[data-cf-target]').addEventListener('input', persist);
    workspace.querySelector('[data-cf-target]').addEventListener('change', () => {
        // `change` (fires on blur/enter, not every keystroke) rather than
        // `input` — the target changes what's reachable at all, so it needs
        // a full re-plan, not just a display update, but re-running the
        // whole search on every digit typed would be wasteful.
        if (lastResult) runPlanner();
    });
    workspace.querySelector('[data-cf-lab-speed]').addEventListener('change', () => {
        persist();
        // The plan itself (which slots, which stone levels) never depends on
        // lab speed — only whichever lab route's day estimate is showing
        // does — so changing this re-derives just that number instead of
        // re-running the search.
        if (!lastResult) return;
        let changed = false;
        if (lastResult.plan.assistEfficiencyLabLevel != null) {
            const labCost = assistCoreEfficiencyLabCumulativeCost(
                data.assistCoreEfficiencyLabLevel, lastResult.plan.assistEfficiencyLabLevel,
                { coinDiscountFraction: data.labsCoinDiscountFraction, ...speedModifiers() },
            );
            if (labCost) {
                lastResult.plan.labCoinCost = labCost.coins;
                lastResult.plan.labDurationDays = labCost.days;
                changed = true;
            }
        }
        if (lastResult.plan.durationLabCoinCost != null) {
            const labCost = durationLabCumulativeCost(
                data.durationLabLevel, CHRONO_FIELD_DURATION_LAB_MAX_LEVEL,
                { coinDiscountFraction: data.labsCoinDiscountFraction, ...speedModifiers() },
            );
            if (labCost) {
                lastResult.plan.durationLabCoinCost = labCost.coins;
                lastResult.plan.durationLabDurationDays = labCost.days;
                changed = true;
            }
        }
        if (changed) renderPlanResult();
    });
    workspace.querySelector('[data-cf-lab-cap]').addEventListener('change', () => {
        persist();
        // Unlike the speed multiplier, the cap can change which plan is
        // cheapest (or whether the lab route is even reachable), so this
        // needs a full re-plan rather than just updating a display number.
        if (lastResult) runPlanner();
    });

    function runPlanner() {
        const resultEl = workspace.querySelector('[data-cf-planner-result]');

        try {
            const target = Number(workspace.querySelector('[data-cf-target]').value);
            if (!Number.isFinite(target)) {
                resultEl.innerHTML = '<p>Enter a target speed reduction first.</p>';
                return;
            }

            const loadoutContexts = LOADOUT_IDS.map((id) => ({
                id,
                label: LOADOUT_LABELS[id],
                primaryKey: state[id].primaryKey,
                assistKey: state[id].assistKey,
                durationLabMaxed: data.durationLabMaxed,
                runPerkActive: Boolean(state[id].runPerkActive),
                battleConditionActive: Boolean(state[id].battleConditionActive),
            }));

            const plannerArgs = {
                currentLevels: data.levels,
                coreModules: data.coreModules,
                assistEfficiencyStoneLevel: data.assistCoreEfficiencyStoneLevel,
                assistEfficiencyLabLevel: data.assistCoreEfficiencyLabLevel,
                loadouts: loadoutContexts,
                eligibleSlots: collectEligibleSlots(modulesByKey, state, lockOverrides),
                fixedOverrides: new Map(),
                target,
            };

            const coinDiscountFraction = data.labsCoinDiscountFraction;
            const maxLabLevel = Number(workspace.querySelector('[data-cf-lab-cap]').value) || data.assistCoreEfficiencyLabLevel;

            // Three independent ways to close the gap, each evaluated on its
            // own and compared by stone cost: buy stone levels outright, buy
            // assist-module substat efficiency via its lab instead of
            // stones, or finish the (all-or-nothing) Chrono Field Duration
            // lab instead of buying extra Duration stone levels. Whichever
            // reaches the target in the fewest stones wins; the others are
            // dropped rather than combined, so this isn't the true joint
            // optimum across all three, just the best of each considered
            // separately — matches how the assist-lab option already works.
            const candidates = [];

            const plan = findCheapestPlan(plannerArgs);
            if (plan) candidates.push({ plan, loadoutContexts, lead: '' });

            const labPlan = findCheapestPlanViaLab({ ...plannerArgs, coinDiscountFraction, ...speedModifiers(), maxLabLevel });
            if (labPlan) {
                candidates.push({
                    plan: labPlan,
                    loadoutContexts,
                    lead: !plan ? '<p>Not reachable by buying stone levels alone — raising the Assist Module Substats (Core) lab gets there instead:</p>' : '',
                });
            }

            if (!data.durationLabMaxed) {
                const maxedLoadoutContexts = loadoutContexts.map((loadout) => ({ ...loadout, durationLabMaxed: true }));
                const durationLabPlan = findCheapestPlan({ ...plannerArgs, loadouts: maxedLoadoutContexts });
                if (durationLabPlan) {
                    const labCost = durationLabCumulativeCost(
                        data.durationLabLevel, CHRONO_FIELD_DURATION_LAB_MAX_LEVEL, { coinDiscountFraction, ...speedModifiers() },
                    );
                    if (labCost) {
                        durationLabPlan.durationLabCoinCost = labCost.coins;
                        durationLabPlan.durationLabDurationDays = labCost.days;
                        candidates.push({
                            plan: durationLabPlan,
                            loadoutContexts: maxedLoadoutContexts,
                            lead: (!plan && !labPlan) ? '<p>Not reachable by buying stone levels alone — finishing the Chrono Field Duration lab gets there instead:</p>' : '',
                        });
                    }
                }
            }

            if (candidates.length === 0) {
                lastResult = null;
                appliedPlan = null;
                appliedLoadoutContexts = null;
                resultEl.innerHTML = '<p>No plan reaches that target on both loadouts, even using every available substat slot and maxing stone levels. Try a lower target.</p>'
                    + renderInvestmentTableHtml(data, null);
                refreshWorkspace();
                return;
            }

            lastResult = candidates.reduce((best, candidate) => (
                !best || candidate.plan.additionalCost < best.plan.additionalCost ? candidate : best
            ));
            // Apply the winning plan to the loadout cards themselves — highlight
            // the slots it picks and show each loadout's before/after stats —
            // not just list it in the investment box below.
            appliedPlan = lastResult.plan;
            appliedLoadoutContexts = lastResult.loadoutContexts;
            refreshWorkspace();
            renderPlanResult();
        } catch (error) {
            resultEl.innerHTML = `<p>Could not plan an investment (${escapeHtml(error.message)}).</p>`;
        }
    }

    workspace.querySelector('[data-cf-planner-form]').addEventListener('submit', (event) => {
        event.preventDefault();
        runPlanner();
    });

    workspace.querySelector('[data-cf-reset]').addEventListener('click', () => {
        // Back to exactly what the save file itself says: no lock overrides,
        // no applied plan, and the save's own equipped modules/perk defaults —
        // the same starting point as a fresh load with no stored prefs.
        lockOverrides.clear();
        appliedPlan = null;
        appliedLoadoutContexts = null;
        lastResult = null;

        state.farming = { primaryKey: defaultKeys.primaryKey, assistKey: defaultKeys.assistKey, runPerkActive: true };
        state.tournament = { primaryKey: defaultKeys.primaryKey, assistKey: defaultKeys.assistKey, battleConditionActive: true };

        workspace.querySelector('#cf-farming-primary').value = state.farming.primaryKey;
        workspace.querySelector('#cf-farming-assist').value = state.farming.assistKey;
        workspace.querySelector('#cf-tournament-primary').value = state.tournament.primaryKey;
        workspace.querySelector('#cf-tournament-assist').value = state.tournament.assistKey;
        workspace.querySelector('[data-cf-run-perk]').checked = true;
        workspace.querySelector('[data-cf-battle-condition]').checked = true;
        // Target speed reduction, lab boost, and the assist-lab cap are planner
        // preferences, not save-file state — reset leaves them as the player
        // set them, rather than snapping back to their first-load defaults.

        refreshWorkspace();
        renderPlanResult();
        persist();
    });
}

function setStatus(statusEl, text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', Boolean(isError));
}

function initCalculator(root) {
    const fileInput = root.querySelector('[data-cf-file-input]');
    const statusEl = root.querySelector('[data-cf-status]');
    const workspace = root.querySelector('[data-cf-workspace]');

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        setStatus(statusEl, 'Reading save file…');
        workspace.hidden = true;

        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const { parsedRoot } = decodePlayerInfoSaveBytes(bytes);
            const data = extractSaveData(parsedRoot);

            renderWorkspace(workspace, data);
            workspace.hidden = false;

            setStatus(
                statusEl,
                data.warnings.length
                    ? `Save loaded with some fields unavailable: ${data.warnings.join(' ')}`
                    : 'Save loaded. Assign your Core modules below.',
                data.warnings.length > 0,
            );
        } catch (error) {
            setStatus(statusEl, `Could not read that save file (${error.message}).`, true);
        }
    });
}

module.exports = { initCalculator };
