const {
    maxLevel,
    cumulativeCost,
    computeEffectiveChronoField,
    computeLoadoutSubstats,
    usedChronoFieldStats,
    CF_SUBSTAT_OPTIONS,
    CF_SUBSTAT_OPTION_LIST,
    RARITY_TIER,
    ASSIST_CORE_EFFICIENCY_MAX_STONE_LEVEL,
    slotOverrideKey,
    assistCoreEfficiencyFraction,
    assistCoreEfficiencyCumulativeCost,
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

/** Per-module, which Chrono Field stats are already real on that module — a module can't roll the same substat type twice. */
function buildUsedStatsByModule(coreModules) {
    const map = new Map();
    const modules = coreModules instanceof Map ? coreModules.values() : coreModules;
    for (const module of modules) map.set(module.key, usedChronoFieldStats(module.slots));
    return map;
}

/** True if `assignment` would put the same stat on the same module twice — either against a real existing one, or against itself. */
function hasDuplicateStatPerModule(assignment, usedStatsByModule) {
    const seenByModule = new Map();
    for (const item of assignment) {
        if (usedStatsByModule.get(item.moduleKey)?.has(item.stat)) return true;
        let seen = seenByModule.get(item.moduleKey);
        if (!seen) {
            seen = new Set();
            seenByModule.set(item.moduleKey, seen);
        }
        if (seen.has(item.stat)) return true;
        seen.add(item.stat);
    }
    return false;
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
    const usedStatsByModule = buildUsedStatsByModule(coreModules);
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
        if (hasDuplicateStatPerModule(assignment, usedStatsByModule)) continue; // can't roll the same substat twice on one module

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
    const usedStatsByModule = buildUsedStatsByModule(coreModules);
    const overrides = new Map();
    const assignment = [];
    let remaining = [...eligibleSlots];

    const canTakeStat = (slot, stat) => !usedStatsByModule.get(slot.moduleKey)?.has(stat);

    while (remaining.length > 0) {
        const combined = mergeOverrides(fixedOverrides, overrides);
        const results = evaluateLoadouts(loadouts, coreModules, assistEfficiency, combined, maxLevels);

        const speedShort = Math.max(0, ...results.map((result) => target - result.speedReductionEff));
        const marginShort = Math.max(0, ...results.map((result) => -result.marginSeconds));
        if (speedShort <= 0 && marginShort <= 0) break;

        // Duration and Cooldown both close the same permanent-uptime margin —
        // try Duration first, fall back to Cooldown if every remaining slot's
        // module already has a Duration substat.
        const statCandidates = speedShort > 0 ? ['speedReduction'] : ['duration', 'cooldown'];
        let stat = null;
        let slot = null;
        for (const candidate of statCandidates) {
            const match = remaining.find((entry) => canTakeStat(entry, candidate));
            if (match) {
                stat = candidate;
                slot = match;
                break;
            }
        }
        if (!slot) break; // every remaining slot's module already carries this substat type — can't help further

        const bestOption = CF_SUBSTAT_OPTIONS[stat][CF_SUBSTAT_OPTIONS[stat].length - 1];
        overrides.set(slotOverrideKey(slot.moduleKey, slot.slotNumber), { stat, value: bestOption.value });
        assignment.push({ ...slot, stat, rarity: bestOption.rarity, value: bestOption.value });
        usedStatsByModule.get(slot.moduleKey)?.add(stat);
        remaining = remaining.filter((entry) => entry !== slot);
    }

    return { overrides, assignment };
}

/**
 * The full plan: which (if any) not-yet-decided substat slots to fill, and
 * which (if any) additional stone levels to buy, to reach `target` on every
 * loadout while keeping permanent uptime, at one fixed assist-efficiency
 * fraction. `fixedOverrides` are the player's own manual picks (from the
 * "plan a reroll" selects) — treated as already decided; only
 * `eligibleSlots` without one of those are up for the planner to suggest.
 * Returns null if the target is unreachable even after using every eligible
 * slot at its best rarity and maxing every stone level.
 */
function findCheapestPlanAtEfficiency({ currentLevels, coreModules, assistEfficiency, loadouts, eligibleSlots, fixedOverrides, target }) {
    const modulesByKey = new Map(coreModules.map((module) => [module.key, module]));
    const baseline = evaluateLoadouts(loadouts, modulesByKey, assistEfficiency, fixedOverrides, currentLevels);
    if (isSatisfied(baseline, target)) {
        return { levels: null, assignment: [], additionalCost: 0 };
    }

    const exhaustiveAssignment = findAssignmentAtCurrentLevels(
        eligibleSlots, modulesByKey, assistEfficiency, loadouts, fixedOverrides, currentLevels, target,
    );
    if (exhaustiveAssignment) {
        return { levels: null, assignment: exhaustiveAssignment, additionalCost: 0 };
    }

    const { overrides: greedyOverrides, assignment: greedyAssignment } = greedyMaxAssignment(
        eligibleSlots, modulesByKey, assistEfficiency, loadouts, fixedOverrides, target,
    );
    const combinedOverrides = mergeOverrides(fixedOverrides, greedyOverrides);
    const loadoutsForLevelSearch = loadouts.map((loadout) => ({
        substats: computeLoadoutSubstats(modulesByKey, loadout.primaryKey, loadout.assistKey, assistEfficiency, combinedOverrides),
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

/**
 * The full plan, also considering whether leveling up the assist Core
 * module's substat efficiency — a separate stone investment from Duration/
 * Cooldown/Speed and from substat slots — makes the target cheaper overall.
 * A higher efficiency only ever helps (it scales the assist module's
 * contribution up), so this sweeps every stone level from the player's
 * current one to the track's cap, combining each with the cheapest
 * level/substat plan at that efficiency, and keeps the cheapest total.
 */
function findCheapestPlan({
    currentLevels, coreModules, assistEfficiencyStoneLevel, assistEfficiencyLabLevel,
    loadouts, eligibleSlots, fixedOverrides, target,
}) {
    let best = null;

    for (let stoneLevel = assistEfficiencyStoneLevel; stoneLevel <= ASSIST_CORE_EFFICIENCY_MAX_STONE_LEVEL; stoneLevel += 1) {
        const assistEfficiency = assistCoreEfficiencyFraction(stoneLevel, assistEfficiencyLabLevel);
        const innerPlan = findCheapestPlanAtEfficiency({
            currentLevels, coreModules, assistEfficiency, loadouts, eligibleSlots, fixedOverrides, target,
        });
        if (!innerPlan) continue;

        const efficiencyCost = assistCoreEfficiencyCumulativeCost(assistEfficiencyStoneLevel, stoneLevel) ?? 0;
        const totalCost = innerPlan.additionalCost + efficiencyCost;

        if (!best || totalCost < best.additionalCost) {
            best = {
                levels: innerPlan.levels,
                assignment: innerPlan.assignment,
                assistEfficiencyLevel: stoneLevel !== assistEfficiencyStoneLevel ? stoneLevel : null,
                additionalCost: totalCost,
            };
        }
    }

    return best;
}

module.exports = { findCheapestInvestment, findCheapestPlan };
