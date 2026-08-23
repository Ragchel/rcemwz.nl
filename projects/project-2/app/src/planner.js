const { maxLevel, cumulativeCost, computeEffectiveChronoField } = require('./chrono-field-math');

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

module.exports = { findCheapestInvestment };
