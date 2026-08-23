const {
    maxLevel,
    cumulativeCost,
    computeEffectiveChronoField,
    computeLoadoutSubstats,
    CF_SUBSTAT_OPTIONS,
    CF_SUBSTAT_OPTION_LIST,
    RARITY_TIER,
    slotOverrideKey,
} = require('./chrono-field-math');

/**
 * Finds the cheapest additional stone investment (Duration/Cooldown/Speed
 * levels only increase from the player's current levels — these are one-way)
 * that keeps permanent Chrono Field and reaches `targetSlowPercent` on every
 * loadout passed in. Loadouts share the same account-wide levels, so a combo
 * must satisfy all of them at once.
 *
 * @param {{duration:number, cooldown:number, speed:number}} currentLevels
 * @param {Array<{substats:{duration:number,cooldown:number,speedReduction:number}, durationLabMaxed:boolean, runPerkActive:boolean, battleConditionActive:boolean}>} loadouts
 * @param {number} targetSlowPercent
 */
function findCheapestInvestment(currentLevels, loadouts, targetSlowPercent) {
    const currentCost = cumulativeCost('Duration', currentLevels.duration)
        + cumulativeCost('Cooldown', currentLevels.cooldown)
        + cumulativeCost('Speed', currentLevels.speed);

    let best = null;

    for (let speed = currentLevels.speed; speed <= maxLevel('Speed'); speed += 1) {
        for (let cooldown = currentLevels.cooldown; cooldown <= maxLevel('Cooldown'); cooldown += 1) {
            for (let duration = currentLevels.duration; duration <= maxLevel('Duration'); duration += 1) {
                const levels = { duration, cooldown, speed };
                // `levels` must come after the spread — `loadout` carries its own
                // (current, unmodified) `levels` field that would otherwise win.
                const results = loadouts.map((loadout) => computeEffectiveChronoField({ ...loadout, levels }));

                const allPermanent = results.every((result) => result.permanent);
                const allAtTarget = results.every((result) => result.speedReductionEff >= targetSlowPercent);
                if (!allPermanent || !allAtTarget) continue;

                const cost = cumulativeCost('Duration', duration)
                    + cumulativeCost('Cooldown', cooldown)
                    + cumulativeCost('Speed', speed);
                const additionalCost = cost - currentCost;

                if (!best || additionalCost < best.additionalCost) {
                    best = { levels, additionalCost, results };
                }

                // Duration only needs to grow until pCF/target is met; once found,
                // higher duration only costs more for this (cooldown, speed) pair.
                break;
            }
        }
    }

    return best;
}

function mergeOverrides(base, extra) {
    const merged = new Map(base);
    for (const [key, value] of extra) merged.set(key, value);
    return merged;
}

function evaluateLoadouts(loadouts, coreModules, assistEfficiency, overrides, levels) {
    return loadouts.map((loadout) => {
        const substats = computeLoadoutSubstats(coreModules, loadout.primaryKey, loadout.assistKey, assistEfficiency, overrides);
        return computeEffectiveChronoField({ levels, substats, ...loadout });
    });
}

function isSatisfied(results, target) {
    return results.every((result) => result.permanent && result.speedReductionEff >= target);
}

// Above this many simultaneously eligible slots, exhaustively trying every
// combination of substat choices (11 per slot, including "leave it alone")
// stops being fast enough for a one-click search — falls back to the greedy
// pass below instead.
const MAX_EXHAUSTIVE_SLOTS = 5;

/**
 * Tries every combination of "leave alone" / one of 10 Chrono Field substat
 * choices across `eligibleSlots`, at the player's *current* stone levels, and
 * returns the smallest assignment (fewest slots, then easiest rarities) that
 * satisfies every loadout — or null if none does (or there are too many
 * slots to search exhaustively).
 */
function findAssignmentAtCurrentLevels(eligibleSlots, coreModules, assistEfficiency, loadouts, fixedOverrides, currentLevels, target) {
    const slotCount = eligibleSlots.length;
    if (slotCount === 0 || slotCount > MAX_EXHAUSTIVE_SLOTS) return null;

    const choiceCount = CF_SUBSTAT_OPTION_LIST.length + 1; // +1 for "leave alone"
    const totalCombos = choiceCount ** slotCount;
    let best = null;

    for (let combo = 0; combo < totalCombos; combo += 1) {
        let remainder = combo;
        const extra = new Map();
        const assignment = [];

        for (let i = 0; i < slotCount; i += 1) {
            const choice = remainder % choiceCount;
            remainder = Math.floor(remainder / choiceCount);
            if (choice === 0) continue;

            const option = CF_SUBSTAT_OPTION_LIST[choice - 1];
            const slot = eligibleSlots[i];
            extra.set(slotOverrideKey(slot.moduleKey, slot.slotNumber), { stat: option.stat, value: option.value });
            assignment.push({ ...slot, stat: option.stat, rarity: option.rarity, value: option.value });
        }
        if (assignment.length === 0) continue; // the "nothing needed" case is checked separately

        const overrides = mergeOverrides(fixedOverrides, extra);
        const results = evaluateLoadouts(loadouts, coreModules, assistEfficiency, overrides, currentLevels);
        if (!isSatisfied(results, target)) continue;

        const tierSum = assignment.reduce((sum, item) => sum + RARITY_TIER[item.rarity], 0);
        const isBetter = !best
            || assignment.length < best.assignment.length
            || (assignment.length === best.assignment.length && tierSum < best.tierSum);
        if (isBetter) best = { assignment, tierSum };
    }

    return best ? best.assignment : null;
}

/**
 * Greedily assigns eligible slots to the best (Ancestral-tier) substat that
 * closes whichever gap — speed reduction, or permanent-uptime margin — is
 * currently worst across loadouts, at max stone levels. Not necessarily the
 * cheapest possible assignment (see `findAssignmentAtCurrentLevels` for
 * that), but a fast, reasonable fallback when there are too many eligible
 * slots to search exhaustively, or when levels need to grow regardless.
 */
function greedyMaxAssignment(eligibleSlots, coreModules, assistEfficiency, loadouts, fixedOverrides, target) {
    const maxLevels = { duration: maxLevel('Duration'), cooldown: maxLevel('Cooldown'), speed: maxLevel('Speed') };
    const overrides = new Map();
    const assignment = [];
    const remaining = [...eligibleSlots];

    while (remaining.length > 0) {
        const combined = mergeOverrides(fixedOverrides, overrides);
        const results = evaluateLoadouts(loadouts, coreModules, assistEfficiency, combined, maxLevels);

        const speedShort = Math.max(0, ...results.map((result) => target - result.speedReductionEff));
        const marginShort = Math.max(0, ...results.map((result) => -result.marginSeconds));
        if (speedShort <= 0 && marginShort <= 0) break;

        const stat = speedShort > 0 ? 'speedReduction' : 'duration';
        const bestOption = CF_SUBSTAT_OPTIONS[stat][CF_SUBSTAT_OPTIONS[stat].length - 1];

        const slot = remaining.shift();
        overrides.set(slotOverrideKey(slot.moduleKey, slot.slotNumber), { stat, value: bestOption.value });
        assignment.push({ ...slot, stat, rarity: bestOption.rarity, value: bestOption.value });
    }

    return { overrides, assignment };
}

/**
 * The full plan: which (if any) not-yet-decided substat slots to fill, and
 * which (if any) additional stone levels to buy, to reach `target` on every
 * loadout while keeping permanent uptime. `fixedOverrides` are the player's
 * own manual picks (from the "plan a reroll" selects) — treated as already
 * decided; only `eligibleSlots` without one of those are up for the planner
 * to suggest. Returns null if the target is unreachable even after using
 * every eligible slot at its best rarity and maxing every stone level.
 */
function findCheapestPlan({ currentLevels, coreModules, assistEfficiency, loadouts, eligibleSlots, fixedOverrides, target }) {
    const baseline = evaluateLoadouts(loadouts, coreModules, assistEfficiency, fixedOverrides, currentLevels);
    if (isSatisfied(baseline, target)) {
        return { levels: null, assignment: [], additionalCost: 0 };
    }

    const exhaustiveAssignment = findAssignmentAtCurrentLevels(
        eligibleSlots, coreModules, assistEfficiency, loadouts, fixedOverrides, currentLevels, target,
    );
    if (exhaustiveAssignment) {
        return { levels: null, assignment: exhaustiveAssignment, additionalCost: 0 };
    }

    const { overrides: greedyOverrides, assignment: greedyAssignment } = greedyMaxAssignment(
        eligibleSlots, coreModules, assistEfficiency, loadouts, fixedOverrides, target,
    );
    const combinedOverrides = mergeOverrides(fixedOverrides, greedyOverrides);
    const loadoutsForLevelSearch = loadouts.map((loadout) => ({
        substats: computeLoadoutSubstats(coreModules, loadout.primaryKey, loadout.assistKey, assistEfficiency, combinedOverrides),
        durationLabMaxed: loadout.durationLabMaxed,
        runPerkActive: loadout.runPerkActive,
        battleConditionActive: loadout.battleConditionActive,
    }));

    const best = findCheapestInvestment(currentLevels, loadoutsForLevelSearch, target);
    if (!best) return null;

    const levelsChanged = best.levels.duration !== currentLevels.duration
        || best.levels.cooldown !== currentLevels.cooldown
        || best.levels.speed !== currentLevels.speed;

    return {
        levels: levelsChanged ? best.levels : null,
        assignment: greedyAssignment,
        additionalCost: best.additionalCost,
    };
}

module.exports = { findCheapestInvestment, findCheapestPlan };
