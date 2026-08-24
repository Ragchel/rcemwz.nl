const { decodePlayerInfoSaveBytes } = require('./decode-save');
const { extractSaveData } = require('./extract-save-data');
const {
    computeEffectiveChronoField,
    computeLoadoutSubstats,
    computeLoadoutSubstatsBreakdown,
    cumulativeCost,
    levelValue,
    assistCoreEfficiencyCumulativeCost,
    assistCoreEfficiencyFraction,
    assistCoreEfficiencyLabCumulativeCost,
    slotOverrideKey,
} = require('./chrono-field-math');
const { findCheapestPlan, findCheapestPlanViaLab } = require('./planner');

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

const COIN_SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

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
function sourceLineHtml(label, unit, terms) {
    const nonZero = terms.filter((term) => term.value !== 0);
    if (nonZero.length === 0) nonZero.push(terms[0]);
    const pieces = nonZero.map((term, index) => {
        const magnitude = `${Math.abs(term.value).toFixed(1)}${unit}`;
        if (index === 0) return `${term.value < 0 ? '−' : ''}${magnitude} (${escapeHtml(term.text)})`;
        return ` ${term.value >= 0 ? '+' : '−'} ${magnitude} (${escapeHtml(term.text)})`;
    });
    return `<li>${escapeHtml(label)}: ${pieces.join('')}</li>`;
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
        { text: 'battle condition', value: battleConditionActive ? -10 : 0 },
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
                ${sourceLineHtml('Speed reduction', '%', speedTerms)}
            </ul>
        </details>`;
}

function substatLineHtml(item) {
    const sign = item.value > 0 ? '+' : '';
    const unit = item.stat === 'speedReduction' ? '%' : 's';
    const note = item.note ? ` (${item.note})` : '';
    return `<li>Slot ${item.slotNumber} of ${escapeHtml(item.moduleLabel)}: roll ${CF_STAT_LABELS[item.stat]} ${sign}${item.value}${unit} (${item.rarity})${escapeHtml(note)}</li>`;
}

/**
 * What each loadout's Duration/Cooldown/Speed Reduction actually comes out
 * to once the whole plan is applied — the new stone levels, the suggested
 * substats, and (if raised) the new assist efficiency — combined with that
 * loadout's own lab/perk/battle-condition inputs. The raw stone-level table
 * value alone isn't this: two loadouts can end up with different effective
 * numbers from the very same level, depending on their own substats/perks.
 */
function finalLoadoutResultHtml(loadout, plan, data) {
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

    const statusClass = result.permanent ? 'is-reached' : 'is-short';
    const statusText = result.permanent ? 'permanent' : 'not permanent';
    return `<p>${escapeHtml(loadout.label)} ends up at: <span class="cf-result-status ${statusClass}">${statusText}</span> — `
        + `${result.speedReductionEff.toFixed(1)}% slow, ${result.durationEff.toFixed(1)}s duration, ${result.cooldownEff.toFixed(1)}s cooldown</p>`
        + breakdownDetailsHtml({
            levels: finalLevels,
            efficiency: finalEfficiency,
            breakdown,
            durationLabMaxed: loadout.durationLabMaxed,
            runPerkActive: loadout.runPerkActive,
            battleConditionActive: loadout.battleConditionActive,
        });
}

/**
 * `loadoutContexts` need an `id`/`label` (e.g. "farming"/"Farming") alongside
 * their `primaryKey`/`assistKey`, so the substat assignment — which belongs
 * to a module, not a loadout — can be grouped by whichever loadout(s)
 * currently use that module, sorted by module within each group. Levels and
 * assist efficiency are account-wide, so those stay a single shared list.
 */
function renderPlanHtml(plan, data, loadoutContexts) {
    const parts = [];

    for (const loadout of loadoutContexts) {
        const items = plan.assignment
            .filter((item) => item.moduleKey === loadout.primaryKey || item.moduleKey === loadout.assistKey)
            .slice()
            .sort((a, b) => a.moduleLabel.localeCompare(b.moduleLabel) || a.slotNumber - b.slotNumber);

        const section = items.length > 0
            ? `<p>${escapeHtml(loadout.label)} — get these substats:</p><ul>${items.map(substatLineHtml).join('')}</ul>`
            : '';
        parts.push(section + finalLoadoutResultHtml(loadout, plan, data));
    }

    const levelChanges = [];
    if (plan.levels) {
        if (plan.levels.duration !== data.levels.duration) {
            const cost = cumulativeCost('Duration', plan.levels.duration) - cumulativeCost('Duration', data.levels.duration);
            levelChanges.push(`Duration to level ${plan.levels.duration} — ${cost.toLocaleString()} stones`);
        }
        if (plan.levels.cooldown !== data.levels.cooldown) {
            const cost = cumulativeCost('Cooldown', plan.levels.cooldown) - cumulativeCost('Cooldown', data.levels.cooldown);
            levelChanges.push(`Cooldown to level ${plan.levels.cooldown} — ${cost.toLocaleString()} stones`);
        }
        if (plan.levels.speed !== data.levels.speed) {
            const cost = cumulativeCost('Speed', plan.levels.speed) - cumulativeCost('Speed', data.levels.speed);
            levelChanges.push(`Speed Reduction to level ${plan.levels.speed} — ${cost.toLocaleString()} stones`);
        }
    }
    if (plan.assistEfficiencyLevel != null) {
        const cost = assistCoreEfficiencyCumulativeCost(data.assistCoreEfficiencyStoneLevel, plan.assistEfficiencyLevel);
        levelChanges.push(`Assist Module Substats (Core) to level ${plan.assistEfficiencyLevel} — ${cost.toLocaleString()} stones`);
    }
    if (plan.assistEfficiencyLabLevel != null) {
        levelChanges.push(`Assist Module Substats (Core) lab to level ${plan.assistEfficiencyLabLevel} — `
            + `${formatCoins(plan.labCoinCost)} coins, ${formatResearchDays(plan.labDurationDays)} of research (no stones)`);
    }
    if (levelChanges.length > 0) {
        parts.push(`<p>Level up:</p><ul>${levelChanges.map((change) => `<li>${escapeHtml(change)}</li>`).join('')}</ul>`);
    }

    parts.push(planCostSummaryHtml(plan));

    return parts.join('');
}

/** The plan's total cost line — mentions coins/research days too when the plan raises assist efficiency via the lab instead of stones. */
function planCostSummaryHtml(plan) {
    const pieces = [];
    if (plan.additionalCost > 0) pieces.push(`${plan.additionalCost.toLocaleString()} Power Stones`);
    if (plan.assistEfficiencyLabLevel != null) {
        pieces.push(`${formatCoins(plan.labCoinCost)} coins`, `${formatResearchDays(plan.labDurationDays)} of research`);
    }
    if (pieces.length === 0) return '<p>You already meet that target on both loadouts with permanent uptime.</p>';
    return `<p>${pieces.join(' + ')} total.</p>`;
}

function slotsHtml(module, lockOverrides) {
    if (!module) return '<p class="cf-module-slots-empty">Choose a module to see its substats.</p>';

    const items = module.slots.map((slot) => {
        const locked = isSlotLocked(module, slot, lockOverrides);
        const classes = ['cf-module-slot'];
        if (slot.unlocked && slot.isChronoField) classes.push('is-cf');
        if (!slot.unlocked) classes.push('is-empty');
        if (locked) classes.push('is-locked');

        const note = slot.note ? ` — ${escapeHtml(slot.note)}` : '';
        const label = slot.unlocked
            ? `${slot.rarity ? `${escapeHtml(slot.rarity)} ` : ''}${escapeHtml(slot.label)}${slot.displayValue ? ` ${escapeHtml(slot.displayValue)}` : ''}`
            : `Not yet unlocked${note}`;

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

function renderModuleSlots(container, modulesByKey, key, lockOverrides) {
    const module = modulesByKey.get(key);
    container.innerHTML = slotsHtml(module, lockOverrides);
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

function renderResult(container, result, breakdownArgs) {
    const statusClass = result.permanent ? 'is-reached' : 'is-short';
    const statusText = result.permanent ? 'Permanent uptime reached' : 'Not permanent yet';
    const marginLabel = result.permanent ? 'Margin to spare' : 'Still short by';
    container.innerHTML = `
        <span class="cf-result-status ${statusClass}">${statusText}</span>
        <dl>
            <dt>Speed reduction</dt><dd>${result.speedReductionEff.toFixed(1)}%</dd>
            <dt>Duration</dt><dd>${formatSeconds(result.durationEff)}</dd>
            <dt>Cooldown</dt><dd>${formatSeconds(result.cooldownEff)}</dd>
            <dt>${marginLabel}</dt><dd>${formatSeconds(Math.abs(result.marginSeconds))}</dd>
        </dl>
        ${breakdownDetailsHtml(breakdownArgs)}
    `;
}

function loadoutCardHtml(id, title, coreModules, extraToggleHtml, defaults) {
    return `
        <div class="cf-loadout" data-cf-loadout="${id}">
            <h3>${title}</h3>
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
            ${extraToggleHtml}
            <div class="cf-result" data-cf-result aria-live="polite"></div>
        </div>
    `;
}

function renderWorkspace(workspace, data) {
    const modulesByKey = new Map(data.coreModules.map((module) => [module.key, module]));
    const defaultKeys = {
        primaryKey: data.defaultPrimaryKey || NONE_KEY,
        assistKey: data.defaultAssistKey || NONE_KEY,
    };

    workspace.innerHTML = `
        <div class="cf-loadouts">
            ${loadoutCardHtml('farming', 'Farming loadout', data.coreModules, `
                <div class="cf-loadout-toggle">
                    <input type="checkbox" id="cf-farming-perk" data-cf-run-perk>
                    <label for="cf-farming-perk">"Chrono Field Duration +5s" run perk reliably picked</label>
                </div>
            `, defaultKeys)}
            ${loadoutCardHtml('tournament', 'Tournament loadout', data.coreModules, `
                <div class="cf-loadout-toggle">
                    <input type="checkbox" id="cf-tournament-bc" data-cf-battle-condition>
                    <label for="cf-tournament-bc">"Reduce Chrono Field duration by 10s" battle condition active</label>
                </div>
            `, defaultKeys)}
        </div>
        <div class="cf-planner">
            <h3>Plan your build</h3>
            <p>Uses any slot marked Changeable to figure out what to roll there, on top of stone levels.</p>
            <form class="cf-planner-form" data-cf-planner-form>
                <div class="cf-loadout-field">
                    <label for="cf-target-slow">Target speed reduction (%)</label>
                    <input type="number" id="cf-target-slow" min="20" max="100" step="1" value="90" data-cf-target>
                </div>
                <button type="submit">Find the cheapest plan</button>
            </form>
            <div class="cf-planner-result" data-cf-planner-result aria-live="polite"></div>
        </div>
    `;

    const state = {
        farming: { primaryKey: defaultKeys.primaryKey, assistKey: defaultKeys.assistKey, runPerkActive: false },
        tournament: { primaryKey: defaultKeys.primaryKey, assistKey: defaultKeys.assistKey, battleConditionActive: false },
    };
    // Shared across both loadout cards: a module's locked/changeable marking
    // is a property of the module itself, not of which card is showing it.
    const lockOverrides = new Map();
    const cards = new Map(LOADOUT_IDS.map((id) => [
        id,
        workspace.querySelector(`[data-cf-loadout="${id}"]`),
    ]));

    function recompute(id) {
        const card = cards.get(id);
        const inputs = loadoutInputs(data, modulesByKey, state[id]);
        const result = computeEffectiveChronoField(inputs);
        const breakdown = computeLoadoutSubstatsBreakdown(modulesByKey, state[id].primaryKey, state[id].assistKey);
        renderResult(card.querySelector('[data-cf-result]'), result, {
            levels: data.levels,
            efficiency: data.assistCoreEfficiency,
            breakdown,
            durationLabMaxed: data.durationLabMaxed,
            runPerkActive: inputs.runPerkActive,
            battleConditionActive: inputs.battleConditionActive,
        });
    }

    function recomputeAll() {
        for (const id of LOADOUT_IDS) recompute(id);
    }

    // A module can be visible in both loadouts, so redraw every slot panel
    // whenever its locked/changeable state changes.
    function renderAllModuleSlots() {
        for (const id of LOADOUT_IDS) {
            const card = cards.get(id);
            renderModuleSlots(card.querySelector('[data-cf-primary-slots]'), modulesByKey, state[id].primaryKey, lockOverrides);
            renderModuleSlots(card.querySelector('[data-cf-assist-slots]'), modulesByKey, state[id].assistKey, lockOverrides);
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
        });
        card.querySelector('[data-cf-assist]').addEventListener('change', (event) => {
            state[id].assistKey = event.target.value;
            refreshWorkspace();
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
    });

    workspace.querySelector('[data-cf-run-perk]').addEventListener('change', (event) => {
        state.farming.runPerkActive = event.target.checked;
        recompute('farming');
    });
    workspace.querySelector('[data-cf-battle-condition]').addEventListener('change', (event) => {
        state.tournament.battleConditionActive = event.target.checked;
        recompute('tournament');
    });

    workspace.querySelector('[data-cf-planner-form]').addEventListener('submit', (event) => {
        event.preventDefault();
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

            const plan = findCheapestPlan(plannerArgs);
            // Raising assist efficiency via the lab (coins + days, no stones)
            // is an alternative to buying stone levels for it — only worth
            // taking when it actually reaches a lower stone cost.
            const labPlan = findCheapestPlanViaLab(plannerArgs);
            const cheaper = !plan ? labPlan
                : (labPlan && labPlan.additionalCost < plan.additionalCost) ? labPlan
                : plan;

            if (!cheaper) {
                resultEl.innerHTML = '<p>No plan reaches that target on both loadouts, even using every available substat slot and maxing stone levels. Try a lower target.</p>';
                return;
            }

            const lead = (!plan && labPlan)
                ? '<p>Not reachable by buying stone levels alone — raising the Assist Module Substats (Core) lab gets there instead:</p>'
                : '';
            resultEl.innerHTML = lead + renderPlanHtml(cheaper, data, loadoutContexts);
        } catch (error) {
            resultEl.innerHTML = `<p>Could not plan an investment (${escapeHtml(error.message)}).</p>`;
        }
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
