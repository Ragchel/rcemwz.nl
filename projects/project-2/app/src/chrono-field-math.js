const { CHRONO_FIELD_STATS } = require('./chrono-field-stones');

const CF_STATS = CHRONO_FIELD_STATS;
const STAT_BY_NAME = Object.fromEntries(CF_STATS.map((stat) => [stat.name, stat]));

// Duration/Speed/Cooldown are permanent, one-way UW stone investments.
const LEVEL_STAT_KEYS = ['Duration', 'Speed', 'Cooldown'];

function parseTableValue(rawValue) {
    const match = String(rawValue).match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : 0;
}

function maxLevel(statName) {
    return STAT_BY_NAME[statName].levels.length - 1;
}

/** The stat's value (seconds or %) at a given permanent stone level. */
function levelValue(statName, level) {
    const stat = STAT_BY_NAME[statName];
    const clamped = Math.max(0, Math.min(level, stat.levels.length - 1));
    return parseTableValue(stat.levels[clamped].value);
}

/** Cumulative stones spent to reach a level from 0. */
function cumulativeCost(statName, level) {
    const stat = STAT_BY_NAME[statName];
    const clamped = Math.max(0, Math.min(level, stat.levels.length - 1));
    let total = 0;
    for (let i = 1; i <= clamped; i += 1) {
        const cost = stat.levels[i].cost;
        total += typeof cost === 'number' ? cost : 0;
    }
    return total;
}

/**
 * Effective Chrono Field stats for one loadout.
 *
 * `levels` are the account-wide permanent stone levels (shared across loadouts).
 * `substats` are the signed contributions from the loadout's equipped Core
 * module substats (already scaled by assist efficiency where relevant).
 * `labs`/`perk`/`battleCondition` are per-loadout booleans confirmed by the
 * player, since the save only reflects currently-equipped gear.
 */
function computeEffectiveChronoField({ levels, substats, durationLabMaxed, runPerkActive, battleConditionActive }) {
    const durationLevelValue = levelValue('Duration', levels.duration);
    const cooldownLevelValue = levelValue('Cooldown', levels.cooldown);
    const speedLevelValue = levelValue('Speed', levels.speed);

    const durationEff = durationLevelValue
        + substats.duration
        + (durationLabMaxed ? 30 : 0)
        + (runPerkActive ? 5 : 0)
        - (battleConditionActive ? 10 : 0);

    const cooldownEff = cooldownLevelValue + substats.cooldown;
    const speedReductionEff = speedLevelValue + substats.speedReduction;

    return {
        durationEff,
        cooldownEff,
        speedReductionEff,
        permanent: durationEff >= cooldownEff,
        marginSeconds: durationEff - cooldownEff,
    };
}

module.exports = {
    LEVEL_STAT_KEYS,
    maxLevel,
    levelValue,
    cumulativeCost,
    computeEffectiveChronoField,
};
