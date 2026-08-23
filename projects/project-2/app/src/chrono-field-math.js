const { CHRONO_FIELD_STATS } = require('./chrono-field-stones');

const CF_STATS = CHRONO_FIELD_STATS;
const STAT_BY_NAME = Object.fromEntries(CF_STATS.map((stat) => [stat.name, stat]));

// Duration/Speed/Cooldown are permanent, one-way UW stone investments.
const LEVEL_STAT_KEYS = ['Duration', 'Speed', 'Cooldown'];

const CF_SUBSTAT_LABELS = {
    'Chrono Field - Duration': 'duration',
    'Chrono Field - Cooldown': 'cooldown',
    'Chrono Field - Speed Reduction': 'speedReduction',
};

/**
 * Core-module substat rarity values, from the session handoff doc (verified
 * against the game's compiled code) — not from thetowersdk's own static
 * catalog, whose "Chrono Field - Duration" Legendary entry is corrupted
 * ("43s" where the other two tiers and this doc agree on "+4s").
 */
const CF_SUBSTAT_OPTIONS = {
    duration: [
        { rarity: 'Legendary', value: 4 },
        { rarity: 'Mythic', value: 7 },
        { rarity: 'Ancestral', value: 10 },
    ],
    cooldown: [
        { rarity: 'Legendary', value: -4 },
        { rarity: 'Mythic', value: -7 },
        { rarity: 'Ancestral', value: -10 },
    ],
    speedReduction: [
        { rarity: 'Epic', value: 3 },
        { rarity: 'Legendary', value: 8 },
        { rarity: 'Mythic', value: 11 },
        { rarity: 'Ancestral', value: 15 },
    ],
};

function parseSignedNumber(text) {
    if (typeof text !== 'string') return null;
    const match = text.match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
}

function slotOverrideKey(moduleKey, slotNumber) {
    return `${moduleKey}:${slotNumber}`;
}

/**
 * A module's Chrono Field contribution, per slot: a hypothetical pick (from
 * `hypotheticalOverrides`) wins if set, otherwise the slot's real rolled
 * value counts if it's an unlocked Chrono Field substat, otherwise 0.
 */
function sumChronoFieldContributions(slots, moduleKey, hypotheticalOverrides) {
    const totals = { duration: 0, cooldown: 0, speedReduction: 0 };
    for (const slot of slots) {
        const override = hypotheticalOverrides?.get(slotOverrideKey(moduleKey, slot.slot));
        if (override) {
            totals[override.stat] += override.value;
            continue;
        }
        if (!slot.unlocked || !slot.isChronoField) continue;
        const key = CF_SUBSTAT_LABELS[slot.label];
        const value = parseSignedNumber(slot.displayValue);
        if (key && value != null) totals[key] += value;
    }
    return totals;
}

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
    CF_SUBSTAT_OPTIONS,
    maxLevel,
    levelValue,
    cumulativeCost,
    computeEffectiveChronoField,
    sumChronoFieldContributions,
    slotOverrideKey,
};
