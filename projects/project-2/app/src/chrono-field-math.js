const { CHRONO_FIELD_STATS } = require('./chrono-field-stones');
const { CHRONO_FIELD_SUBSTAT_KEYS } = require('./constants');
const {
    assistEfficiency: computeAssistEfficiencyFraction,
    cumulativeAssistEfficiencyStoneCost,
    maxStoneLevel: assistEfficiencyMaxStoneLevel,
} = require('thetowersdk/internal/mechanics/effective-paths-assist-efficiency');
const {
    labCoinCostToReachLevel,
    labDurationDaysToReachLevel,
    labMaxCatalogLevel,
} = require('thetowersdk/internal/mechanics/effective-paths-lab-costs');

// Only the "substat" efficiency track matters here — Chrono Field's
// contributions are all substats, never the "multiplier" track.
const ASSIST_CORE_EFFICIENCY_MAX_STONE_LEVEL = assistEfficiencyMaxStoneLevel('substat');

// The same assist-efficiency slot can also be raised by researching this lab
// instead of buying stone levels — a coins-and-time path rather than a
// stones one. Catalog slug confirmed against thetowersdk's
// `LAB_RESEARCH_BY_INDEX[233]` ("Assist Module Substats - Core"), the same
// save index `extract-save-data.js` reads the lab level from.
const ASSIST_CORE_EFFICIENCY_LAB_SLUG = 'assist_module_substats_core';
const ASSIST_CORE_EFFICIENCY_MAX_LAB_LEVEL = labMaxCatalogLevel(ASSIST_CORE_EFFICIENCY_LAB_SLUG);

function assistCoreEfficiencyFraction(stoneLevel, labLevel) {
    return Math.max(0, Math.min(1, computeAssistEfficiencyFraction({ hasAssist: true, stoneLevel, labLevel })));
}

/** Stones to take the assist Core substat-efficiency slot from one level to another. */
function assistCoreEfficiencyCumulativeCost(fromLevel, toLevel) {
    return cumulativeAssistEfficiencyStoneCost('substat', fromLevel, toLevel);
}

/**
 * Coins and days of research to take the assist Core substat-efficiency
 * *lab* from one level to another — the alternative to buying stone levels.
 * Doesn't account for coin-discount or lab-speed labs (those stay out of
 * scope, same as every other lab here); returns `null` past the catalog's
 * known levels.
 */
function assistCoreEfficiencyLabCumulativeCost(fromLevel, toLevel) {
    let coins = 0;
    let days = 0;
    for (let level = fromLevel + 1; level <= toLevel; level += 1) {
        const levelCoins = labCoinCostToReachLevel(ASSIST_CORE_EFFICIENCY_LAB_SLUG, level);
        const levelDays = labDurationDaysToReachLevel(ASSIST_CORE_EFFICIENCY_LAB_SLUG, level);
        if (levelCoins == null || levelDays == null) return null;
        coins += levelCoins;
        days += levelDays;
    }
    return { coins, days };
}

const CF_STATS = CHRONO_FIELD_STATS;
const STAT_BY_NAME = Object.fromEntries(CF_STATS.map((stat) => [stat.name, stat]));
const LEVEL_VALUES_BY_NAME = Object.fromEntries(CF_STATS.map((stat) => [
    stat.name,
    stat.levels.map((level) => parseTableValue(level.value)),
]));
const CUMULATIVE_COSTS_BY_NAME = Object.fromEntries(CF_STATS.map((stat) => {
    let total = 0;
    return [stat.name, stat.levels.map((level, index) => {
        if (index > 0 && typeof level.cost === 'number') total += level.cost;
        return total;
    })];
}));

// Duration/Speed/Cooldown are permanent, one-way UW stone investments.
const LEVEL_STAT_KEYS = ['Duration', 'Speed', 'Cooldown'];

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

// Ordinal ranking, lowest first — used to prefer an easier-to-obtain rarity
// when more than one choice would satisfy a target equally well.
const RARITY_TIER = { Epic: 1, Legendary: 2, Mythic: 3, Ancestral: 4 };

// All 10 non-empty substat choices flattened, for enumerating candidates.
const CF_SUBSTAT_OPTION_LIST = Object.entries(CF_SUBSTAT_OPTIONS).flatMap(
    ([stat, options]) => options.map((option) => ({ stat, ...option })),
);

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
        const key = CHRONO_FIELD_SUBSTAT_KEYS[slot.label];
        const value = parseSignedNumber(slot.displayValue);
        if (key && value != null) totals[key] += value;
    }
    return totals;
}

/**
 * Which Chrono Field stats a module already carries for real (any slot,
 * regardless of lock state) — a module can only roll one substat of a given
 * type at a time, so this is what the planner must avoid duplicating.
 */
function usedChronoFieldStats(slots) {
    const used = new Set();
    for (const slot of slots) {
        if (!slot.unlocked || !slot.isChronoField) continue;
        const stat = CHRONO_FIELD_SUBSTAT_KEYS[slot.label];
        if (stat) used.add(stat);
    }
    return used;
}

const EMPTY_CONTRIBUTION = { duration: 0, cooldown: 0, speedReduction: 0 };

/**
 * A loadout's Chrono Field substat contribution, kept as separate primary/
 * assist totals rather than merged — so a caller can show *where* the final
 * number comes from (e.g. "assist module substat, scaled 34%") instead of
 * just the combined result.
 */
function computeLoadoutSubstatsBreakdown(coreModules, primaryKey, assistKey, hypotheticalOverrides) {
    const byKey = coreModules instanceof Map
        ? coreModules
        : new Map(coreModules.map((module) => [module.key, module]));
    const primaryModule = byKey.get(primaryKey);
    const assistModule = byKey.get(assistKey);
    return {
        primary: primaryModule
            ? sumChronoFieldContributions(primaryModule.slots, primaryModule.key, hypotheticalOverrides)
            : EMPTY_CONTRIBUTION,
        assist: assistModule
            ? sumChronoFieldContributions(assistModule.slots, assistModule.key, hypotheticalOverrides)
            : EMPTY_CONTRIBUTION,
    };
}

/**
 * A loadout's total Chrono Field substat contribution: primary module at
 * full value, assist module scaled by `assistEfficiency` — the same
 * weighting the game applies, per the handoff doc.
 */
function computeLoadoutSubstats(coreModules, primaryKey, assistKey, assistEfficiency, hypotheticalOverrides) {
    const { primary, assist } = computeLoadoutSubstatsBreakdown(coreModules, primaryKey, assistKey, hypotheticalOverrides);
    return {
        duration: primary.duration + assist.duration * assistEfficiency,
        cooldown: primary.cooldown + assist.cooldown * assistEfficiency,
        speedReduction: primary.speedReduction + assist.speedReduction * assistEfficiency,
    };
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
    const values = LEVEL_VALUES_BY_NAME[statName];
    const clamped = Math.max(0, Math.min(level, values.length - 1));
    return values[clamped];
}

/** Cumulative stones spent to reach a level from 0. */
function cumulativeCost(statName, level) {
    const costs = CUMULATIVE_COSTS_BY_NAME[statName];
    const clamped = Math.max(0, Math.min(level, costs.length - 1));
    return costs[clamped];
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
    CF_SUBSTAT_OPTION_LIST,
    RARITY_TIER,
    ASSIST_CORE_EFFICIENCY_MAX_STONE_LEVEL,
    ASSIST_CORE_EFFICIENCY_MAX_LAB_LEVEL,
    maxLevel,
    levelValue,
    cumulativeCost,
    computeEffectiveChronoField,
    computeLoadoutSubstats,
    computeLoadoutSubstatsBreakdown,
    sumChronoFieldContributions,
    usedChronoFieldStats,
    slotOverrideKey,
    assistCoreEfficiencyFraction,
    assistCoreEfficiencyCumulativeCost,
    assistCoreEfficiencyLabCumulativeCost,
};
