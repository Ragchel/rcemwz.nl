const { decodePlayerInfoSaveBytes } = require('./decode-save');
const { extractSaveData } = require('./extract-save-data');
const { computeEffectiveChronoField } = require('./chrono-field-math');
const { findCheapestInvestment } = require('./planner');

const NONE_KEY = '__none__';
const EMPTY_CF = { duration: 0, cooldown: 0, speedReduction: 0 };

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

function slotLockKey(moduleKey, slotNumber) {
    return `${moduleKey}:${slotNumber}`;
}

/** Whether a slot reads as locked: the save's own state, unless the player has toggled it here. */
function isSlotLocked(module, slot, lockOverrides) {
    const key = slotLockKey(module.key, slot.slot);
    return lockOverrides.has(key) ? lockOverrides.get(key) : slot.locked;
}

function slotsHtml(module, lockOverrides) {
    if (!module) return '<p class="cf-module-slots-empty">Choose a module to see its substats.</p>';

    const items = module.slots.map((slot) => {
        if (!slot.unlocked) {
            const note = slot.note ? ` — ${escapeHtml(slot.note)}` : '';
            return `<li class="cf-module-slot is-empty">Slot ${slot.slot}: Not yet unlocked${note}</li>`;
        }
        const locked = isSlotLocked(module, slot, lockOverrides);
        const classes = ['cf-module-slot'];
        if (slot.isChronoField) classes.push('is-cf');
        if (locked) classes.push('is-locked');
        const rarity = slot.rarity ? `${escapeHtml(slot.rarity)} ` : '';
        const value = slot.displayValue ? ` ${escapeHtml(slot.displayValue)}` : '';
        return `
            <li class="${classes.join(' ')}">
                <span class="cf-module-slot-label">Slot ${slot.slot}: ${rarity}${escapeHtml(slot.label)}${value}</span>
                <button type="button" class="cf-module-slot-toggle" data-cf-slot-toggle
                    data-module-key="${escapeHtml(module.key)}" data-slot="${slot.slot}"
                    aria-pressed="${locked ? 'true' : 'false'}"
                    title="Click to mark this substat as locked or changeable">${locked ? 'Locked' : 'Changeable'}</button>
            </li>`;
    });

    return `<ul class="cf-module-slots">${items.join('')}</ul>`;
}

function renderModuleSlots(container, data, key, lockOverrides, onToggle) {
    const module = data.coreModules.find((entry) => entry.key === key);
    container.innerHTML = slotsHtml(module, lockOverrides);

    container.querySelectorAll('[data-cf-slot-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
            const overrideKey = slotLockKey(button.dataset.moduleKey, Number(button.dataset.slot));
            const currentlyLocked = button.getAttribute('aria-pressed') === 'true';
            lockOverrides.set(overrideKey, !currentlyLocked);
            onToggle();
        });
    });
}

function loadoutSubstats(data, primaryKey, assistKey) {
    const byKey = new Map(data.coreModules.map((module) => [module.key, module]));
    const primary = byKey.get(primaryKey)?.cf ?? EMPTY_CF;
    const assist = byKey.get(assistKey)?.cf ?? EMPTY_CF;
    const efficiency = data.assistCoreEfficiency;
    return {
        duration: primary.duration + assist.duration * efficiency,
        cooldown: primary.cooldown + assist.cooldown * efficiency,
        speedReduction: primary.speedReduction + assist.speedReduction * efficiency,
    };
}

function loadoutInputs(data, loadoutState) {
    return {
        levels: data.levels,
        substats: loadoutSubstats(data, loadoutState.primaryKey, loadoutState.assistKey),
        durationLabMaxed: data.durationLabMaxed,
        runPerkActive: Boolean(loadoutState.runPerkActive),
        battleConditionActive: Boolean(loadoutState.battleConditionActive),
    };
}

function formatSeconds(value) {
    return `${value.toFixed(1)}s`;
}

function renderResult(container, result) {
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
    `;
}

function loadoutCardHtml(id, title, coreModules, extraToggleHtml, defaults) {
    return `
        <div class="cf-loadout" data-cf-loadout="${id}">
            <h3>${title}</h3>
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
            ${extraToggleHtml}
            <div class="cf-result" data-cf-result aria-live="polite"></div>
        </div>
    `;
}

function renderWorkspace(workspace, data) {
    const defaultKeys = {
        primaryKey: data.defaultPrimaryKey || NONE_KEY,
        assistKey: data.defaultAssistKey || NONE_KEY,
    };

    workspace.innerHTML = `
        <div class="cf-loadouts">
            ${loadoutCardHtml('normal', 'Normal loadout', data.coreModules, `
                <div class="cf-loadout-toggle">
                    <input type="checkbox" id="cf-normal-perk" data-cf-run-perk>
                    <label for="cf-normal-perk">"Chrono Field Duration +5s" run perk reliably picked</label>
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
            <h3>Plan a stone investment</h3>
            <form class="cf-planner-form" data-cf-planner-form>
                <div class="cf-loadout-field">
                    <label for="cf-target-slow">Target speed reduction (%)</label>
                    <input type="number" id="cf-target-slow" min="20" max="100" step="1" value="90" data-cf-target>
                </div>
                <button type="submit">Find cheapest levels</button>
            </form>
            <div class="cf-planner-result" data-cf-planner-result aria-live="polite"></div>
        </div>
    `;

    const state = {
        normal: { primaryKey: defaultKeys.primaryKey, assistKey: defaultKeys.assistKey, runPerkActive: false },
        tournament: { primaryKey: defaultKeys.primaryKey, assistKey: defaultKeys.assistKey, battleConditionActive: false },
    };
    // Shared across both loadout cards: a module's locked/changeable marking
    // is a property of the module itself, not of which card is showing it.
    const lockOverrides = new Map();

    function recompute(id) {
        const card = workspace.querySelector(`[data-cf-loadout="${id}"]`);
        const result = computeEffectiveChronoField(loadoutInputs(data, state[id]));
        renderResult(card.querySelector('[data-cf-result]'), result);
    }

    // A module's locked/changeable marking can be visible on both loadout
    // cards at once (they can share the same module) — refresh every slot
    // panel so a toggle in one card stays in sync with the other.
    function refreshAllSlotPanels() {
        for (const id of ['normal', 'tournament']) {
            const card = workspace.querySelector(`[data-cf-loadout="${id}"]`);
            renderModuleSlots(card.querySelector('[data-cf-primary-slots]'), data, state[id].primaryKey, lockOverrides, refreshAllSlotPanels);
            renderModuleSlots(card.querySelector('[data-cf-assist-slots]'), data, state[id].assistKey, lockOverrides, refreshAllSlotPanels);
        }
    }

    for (const id of ['normal', 'tournament']) {
        const card = workspace.querySelector(`[data-cf-loadout="${id}"]`);
        card.querySelector('[data-cf-primary]').addEventListener('change', (event) => {
            state[id].primaryKey = event.target.value;
            refreshAllSlotPanels();
            recompute(id);
        });
        card.querySelector('[data-cf-assist]').addEventListener('change', (event) => {
            state[id].assistKey = event.target.value;
            refreshAllSlotPanels();
            recompute(id);
        });
        recompute(id);
    }
    refreshAllSlotPanels();

    workspace.querySelector('[data-cf-run-perk]').addEventListener('change', (event) => {
        state.normal.runPerkActive = event.target.checked;
        recompute('normal');
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

            const loadouts = ['normal', 'tournament'].map((id) => loadoutInputs(data, state[id]));
            const best = findCheapestInvestment(data.levels, loadouts, target);

            if (!best) {
                resultEl.innerHTML = '<p>No stone investment within the available levels reaches that target on both loadouts. Try a lower target.</p>';
                return;
            }

            const changes = [];
            if (best.levels.duration !== data.levels.duration) changes.push(`Duration to level ${best.levels.duration}`);
            if (best.levels.cooldown !== data.levels.cooldown) changes.push(`Cooldown to level ${best.levels.cooldown}`);
            if (best.levels.speed !== data.levels.speed) changes.push(`Speed Reduction to level ${best.levels.speed}`);

            resultEl.innerHTML = changes.length === 0
                ? '<p>You already meet that target on both loadouts with permanent uptime.</p>'
                : `<p>Level up: </p><ul>${changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul><p>${best.additionalCost.toLocaleString()} more Power Stones, keeping permanent uptime on both loadouts.</p>`;
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
