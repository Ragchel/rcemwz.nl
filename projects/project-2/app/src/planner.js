const {
    maxLevel,
    cumulativeCost,
    computeEffectiveChronoField,
    computeLoadoutSubstats,
    sumChronoFieldContributions,
    usedChronoFieldStats,
    CF_SUBSTAT_OPTIONS,
    CF_SUBSTAT_OPTION_LIST,
    RARITY_TIER,
    ASSIST_CORE_EFFICIENCY_MAX_STONE_LEVEL,
    ASSIST_CORE_EFFICIENCY_MAX_LAB_LEVEL,
    slotOverrideKey,
    assistCoreEfficiencyFraction,
    assistCoreEfficiencyCumulativeCost,
    assistCoreEfficiencyLabCumulativeCost,
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
// pass below instead. Each combo here also runs a full stone-level search
// (see `findCheapestAssignmentAndLevels`), so when that whole thing is
// itself being swept across ~70 assist-efficiency levels, the exhaustive
// cap needs to be much smaller to stay fast — see `maxExhaustiveSlots` below.
const MAX_EXHAUSTIVE_SLOTS = 5;
const MAX_EXHAUSTIVE_SLOTS_DURING_EFFICIENCY_SWEEP = 2;

/**
 * Tries every combination of "leave alone" / one of 10 Chrono Field substat
 * choices across `eligibleSlots`, and for each *valid* combination (no
 * module gets the same substat twice) finds the cheapest stone-level combo
 * on top of it — substats are free in this model, so using more of them can
 * only ever reduce or match the stone-level cost, never raise it, which is
 * why this searches the two together instead of picking a "just enough"
 * substat set first and only then shopping for levels. Returns the overall
 * cheapest `{assignment, levels, additionalCost}`, or null if either there
 * are too many slots to search exhaustively or nothing reaches the target
 * even at max levels with every slot used.
 */
function findCheapestAssignmentAndLevels(eligibleSlots, coreModules, assistEfficiency, loadouts, fixedOverrides, currentLevels, target, maxExhaustiveSlots) {
    const slotCount = eligibleSlots.length;
    if (slotCount > maxExhaustiveSlots) return null;

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
        if (hasDuplicateStatPerModule(assignment, usedStatsByModule)) continue; // can't roll the same substat twice on one module

        const overrides = mergeOverrides(fixedOverrides, extra);
        const loadoutsForSearch = loadouts.map((loadout) => ({
            substats: computeLoadoutSubstats(coreModules, loadout.primaryKey, loadout.assistKey, assistEfficiency, overrides),
            durationLabMaxed: loadout.durationLabMaxed,
            runPerkActive: loadout.runPerkActive,
            battleConditionActive: loadout.battleConditionActive,
        }));
        const levelResult = findCheapestInvestment(currentLevels, loadoutsForSearch, target);
        if (!levelResult) continue; // this substat choice can't reach the target even at max levels

        const tierSum = assignment.reduce((sum, item) => sum + RARITY_TIER[item.rarity], 0);
        const isBetter = !best
            || levelResult.additionalCost < best.additionalCost
            || (levelResult.additionalCost === best.additionalCost && (
                assignment.length < best.assignment.length
                || (assignment.length === best.assignment.length && tierSum < best.tierSum)
            ));
        if (isBetter) best = { assignment, levels: levelResult.levels, additionalCost: levelResult.additionalCost, tierSum };
    }

    return best;
}

/**
 * Greedily assigns eligible slots to the best (Ancestral-tier) substat,
 * continuing as long as doing so could still reduce the *cheapest* possible
 * stone levels — checked at level 0, not the target/max level, since
 * substats are free here and more of them can only lower (never raise) the
 * stone-level cost that `findCheapestInvestment` finds afterward. Stops once
 * every axis is already satisfied even at level 0 (more would be wasted) or
 * no remaining slot's module can take another useful stat. Not necessarily
 * the cheapest possible assignment (see `findCheapestAssignmentAndLevels`
 * for that), but a fast, reasonable fallback when there are too many
 * eligible slots to search exhaustively.
 */
function greedyMaxAssignment(eligibleSlots, coreModules, assistEfficiency, loadouts, fixedOverrides, target) {
    const minLevels = { duration: 0, cooldown: 0, speed: 0 };
    const usedStatsByModule = buildUsedStatsByModule(coreModules);
    const overrides = new Map();
    const assignment = [];
    let remaining = [...eligibleSlots];

    const canTakeStat = (slot, stat) => !usedStatsByModule.get(slot.moduleKey)?.has(stat);

    while (remaining.length > 0) {
        const combined = mergeOverrides(fixedOverrides, overrides);
        const results = evaluateLoadouts(loadouts, coreModules, assistEfficiency, combined, minLevels);

        const speedStillHelps = results.some((result) => result.speedReductionEff < target);
        const marginStillHelps = results.some((result) => !result.permanent);
        if (!speedStillHelps && !marginStillHelps) break; // every axis already met at the cheapest possible level

        const statCandidates = [
            ...(speedStillHelps ? ['speedReduction'] : []),
            ...(marginStillHelps ? ['duration', 'cooldown'] : []),
        ];
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
        if (!slot) break; // every remaining slot's module already carries every stat that could still help

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
function findCheapestPlanAtEfficiency({ currentLevels, coreModules, assistEfficiency, loadouts, eligibleSlots, fixedOverrides, target, maxExhaustiveSlots }) {
    const modulesByKey = new Map(coreModules.map((module) => [module.key, module]));

    if (eligibleSlots.length <= maxExhaustiveSlots) {
        const found = findCheapestAssignmentAndLevels(
            eligibleSlots, modulesByKey, assistEfficiency, loadouts, fixedOverrides, currentLevels, target, maxExhaustiveSlots,
        );
        if (!found) return null;

        const levelsChanged = found.levels.duration !== currentLevels.duration
            || found.levels.cooldown !== currentLevels.cooldown
            || found.levels.speed !== currentLevels.speed;

        return {
            levels: levelsChanged ? found.levels : null,
            assignment: found.assignment,
            additionalCost: found.additionalCost,
        };
    }

    // Too many eligible slots to search exhaustively — fall back to a fast
    // greedy substat pick (not necessarily the cheapest) and search levels
    // on top of it.
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
 * Whether raising assist efficiency could possibly change anything: either a
 * loadout's assist module already carries a real Chrono Field substat (whose
 * contribution efficiency would scale up), or one of its slots is eligible
 * for the planner to put one there. If neither is true for any loadout,
 * efficiency has nothing to scale and the sweep below would just be wasted
 * work — every level would produce the identical plan.
 */
function assistEfficiencyCouldMatter(coreModules, loadouts, eligibleSlots) {
    const modulesByKey = coreModules instanceof Map ? coreModules : new Map(coreModules.map((module) => [module.key, module]));
    const assistKeys = new Set(loadouts.map((loadout) => loadout.assistKey));

    for (const key of assistKeys) {
        const module = modulesByKey.get(key);
        if (!module) continue;
        const contribution = sumChronoFieldContributions(module.slots, module.key, null);
        if (contribution.duration || contribution.cooldown || contribution.speedReduction) return true;
    }
    return eligibleSlots.some((slot) => assistKeys.has(slot.moduleKey));
}

/**
 * The full plan, also considering whether leveling up the assist Core
 * module's substat efficiency — a separate stone investment from Duration/
 * Cooldown/Speed and from substat slots — makes the target cheaper overall.
 * A higher efficiency only ever helps (it scales the assist module's
 * contribution up), so this sweeps every stone level from the player's
 * current one to the track's cap, combining each with the cheapest
 * level/substat plan at that efficiency, and keeps the cheapest total. Skips
 * the sweep entirely (a single pass at the current level) when the assist
 * module has nothing for a higher efficiency to scale.
 */
function findCheapestPlan({
    currentLevels, coreModules, assistEfficiencyStoneLevel, assistEfficiencyLabLevel,
    loadouts, eligibleSlots, fixedOverrides, target,
}) {
    const sweeping = assistEfficiencyCouldMatter(coreModules, loadouts, eligibleSlots);
    const maxSweepLevel = sweeping ? ASSIST_CORE_EFFICIENCY_MAX_STONE_LEVEL : assistEfficiencyStoneLevel;
    // The exhaustive substat search below also runs a full stone-level search
    // per combination, so when that's repeated across up to ~70 efficiency
    // levels, it needs a much smaller slot cap to stay fast (see the two
    // MAX_EXHAUSTIVE_SLOTS* constants) — a single pass can afford the full one.
    const maxExhaustiveSlots = sweeping ? MAX_EXHAUSTIVE_SLOTS_DURING_EFFICIENCY_SWEEP : MAX_EXHAUSTIVE_SLOTS;

    let best = null;

    for (let stoneLevel = assistEfficiencyStoneLevel; stoneLevel <= maxSweepLevel; stoneLevel += 1) {
        const assistEfficiency = assistCoreEfficiencyFraction(stoneLevel, assistEfficiencyLabLevel);
        const innerPlan = findCheapestPlanAtEfficiency({
            currentLevels, coreModules, assistEfficiency, loadouts, eligibleSlots, fixedOverrides, target, maxExhaustiveSlots,
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

/**
 * Same idea as `findCheapestPlan`, but raises the assist Core module's
 * substat-efficiency *lab* level instead of its stone level — the same slot,
 * paid for in coins and research days instead of Power Stones. The stone
 * level stays fixed at the player's current one throughout the sweep.
 *
 * Returned as a separate plan (with `assistEfficiencyLabLevel`/`labCoinCost`/
 * `labDurationDays` instead of `assistEfficiencyLevel`) rather than blended
 * into `findCheapestPlan`'s result, since stones and coins aren't the same
 * currency — the caller decides whether the lab route is worth showing
 * (typically: it reaches a lower `additionalCost` in stones than the
 * stone-only plan, meaning the lab investment covers what would otherwise
 * have been bought with stones).
 */
function findCheapestPlanViaLab({
    currentLevels, coreModules, assistEfficiencyStoneLevel, assistEfficiencyLabLevel,
    loadouts, eligibleSlots, fixedOverrides, target,
}) {
    const sweeping = assistEfficiencyCouldMatter(coreModules, loadouts, eligibleSlots);
    const maxSweepLevel = sweeping ? ASSIST_CORE_EFFICIENCY_MAX_LAB_LEVEL : assistEfficiencyLabLevel;
    const maxExhaustiveSlots = sweeping ? MAX_EXHAUSTIVE_SLOTS_DURING_EFFICIENCY_SWEEP : MAX_EXHAUSTIVE_SLOTS;

    let best = null;

    for (let labLevel = assistEfficiencyLabLevel; labLevel <= maxSweepLevel; labLevel += 1) {
        const assistEfficiency = assistCoreEfficiencyFraction(assistEfficiencyStoneLevel, labLevel);
        const innerPlan = findCheapestPlanAtEfficiency({
            currentLevels, coreModules, assistEfficiency, loadouts, eligibleSlots, fixedOverrides, target, maxExhaustiveSlots,
        });
        if (!innerPlan) continue;

        const labCost = labLevel !== assistEfficiencyLabLevel
            ? assistCoreEfficiencyLabCumulativeCost(assistEfficiencyLabLevel, labLevel)
            : { coins: 0, days: 0 };
        if (!labCost) continue; // past the lab catalog's known levels

        // Stones are the currency this shares with the stone-only plan, so
        // that's what ranks candidates; a smaller lab-level jump (less coin/
        // time) breaks ties, same reasoning as preferring a lower tier substat.
        const isBetter = !best
            || innerPlan.additionalCost < best.additionalCost
            || (innerPlan.additionalCost === best.additionalCost && labLevel < best.labLevel);

        if (isBetter) {
            best = {
                levels: innerPlan.levels,
                assignment: innerPlan.assignment,
                labLevel,
                assistEfficiencyLabLevel: labLevel !== assistEfficiencyLabLevel ? labLevel : null,
                additionalCost: innerPlan.additionalCost,
                labCoinCost: labCost.coins,
                labDurationDays: labCost.days,
            };
        }
    }

    return best;
}

module.exports = { findCheapestInvestment, findCheapestPlan, findCheapestPlanViaLab };
