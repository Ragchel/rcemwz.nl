const {
    readModulesFromSaveRoot,
    MODULE_SAVE_ASSIST_TYPE_TO_CATEGORY,
    MODULE_SAVE_ASSIST_SLOTS_KEY,
} = require('thetowersdk/internal/save/modules');
const { decodeModuleSubstats } = require('thetowersdk/internal/save/module-effects-decode');
const { assistEfficiency } = require('thetowersdk/internal/mechanics/effective-paths-assist-efficiency');
const { computeCoinsPerHourFromSaveRoot } = require('thetowersdk/internal/save/battle-history');
// Deep imports instead of `thetowersdk/internal/save/relics` — that module
// also drops in `save/workshop.js` for two generic array-coercion helpers,
// which drags along the ~3MB workshop catalog for nothing this app uses.
// This combination only pulls in the (much smaller) relic import catalog.
const { buildRelicTemplateIdLookup, findRelicTemplateIdFromSaveIndex } = require('thetowersdk/internal/save/catalogs/relic-template-match');
const { RELIC_TEMPLATES, computeLabSpeedRelicBonusPercent } = require('thetowersdk/internal/data/relics');
const { CHRONO_FIELD_SUBSTAT_KEYS } = require('./constants');

// Stable save-array positions from thetowersdk@0.5.3. Reading these two lab
// levels directly avoids bundling the SDK's complete lab catalog.
const CHRONO_FIELD_DURATION_LAB_INDEX = 53;
const CHRONO_FIELD_DURATION_LAB_MAX = 30;
const ASSIST_CORE_SUBSTATS_LAB_INDEX = 233;
// "Labs Coin Discount" — the level feeding thetowersdk's own
// `labCoinDiscount(level) = level * 0.003` formula, read directly so the lab
// path's coin estimate uses the player's real discount instead of asking.
const LABS_COIN_DISCOUNT_LAB_INDEX = 35;
const LABS_COIN_DISCOUNT_PER_LEVEL = 0.003;
// "Labs Speed" — the level feeding thetowersdk's `labSpeedTotal` formula
// alongside relic bonuses, read directly for the same reason as the coin
// discount above (so the lab path's day estimate uses the player's real
// speed instead of asking for it).
const LABS_SPEED_LAB_INDEX = 36;
const RESEARCH_LEVELS_KEY = 'researchLevel';

// Chrono Field is slot 3 in the save's Ultimate Weapon arrays, with three
// base-stat levels per slot in Duration / Speed / Cooldown order.
const CHRONO_FIELD_SAVE_SLOT = 3;
const UW_LEVELS_KEY = 'ultimateWeaponLevel';
const UW_STATS_PER_SLOT = 3;

const MODULE_SUBSTAT_SLOT_COUNT = 8;
// Confirmed only for the 8th slot (player-confirmed from live gameplay, not
// in SDK data). Slots 1-7's own unlock thresholds aren't known, so those are
// shown as "not yet unlocked" without a specific level requirement.
const EIGHTH_SLOT_MODULE_LEVEL = 241;

function decodeSlots(effects, effectLocked) {
    const paddedEffects = Array.from({ length: MODULE_SUBSTAT_SLOT_COUNT }, (_, i) => effects?.[i] ?? 0);

    let decoded = [];
    try {
        decoded = decodeModuleSubstats(paddedEffects, 'Core');
    } catch {
        decoded = [];
    }

    return paddedEffects.map((effectId, index) => {
        const slot = index + 1;
        if (!effectId) {
            return {
                slot,
                unlocked: false,
                // Defaults locked like any real substat: the player has to
                // explicitly mark it Changeable before the planner touches it.
                locked: true,
                note: slot === MODULE_SUBSTAT_SLOT_COUNT ? `Needs module level ${EIGHTH_SLOT_MODULE_LEVEL}` : null,
            };
        }
        const substat = decoded[index];
        const label = substat?.label ?? 'Unknown substat';
        return {
            slot,
            unlocked: true,
            label,
            rarity: substat?.tier ?? null,
            displayValue: substat?.displayValue ?? null,
            locked: Boolean(effectLocked?.[index]),
            isChronoField: Boolean(CHRONO_FIELD_SUBSTAT_KEYS[label]),
        };
    });
}

function friendlyModuleLabel(rarityLabel, mappedName, note, level) {
    const rarity = rarityLabel || 'Unknown rarity';
    const name = mappedName || 'Core module';
    // Level is included so two owned copies of the same rarity+name — e.g.
    // a farm-dedicated and a tournament-dedicated Dimension Core — read as
    // distinct entries instead of identical-looking duplicates.
    const levelPart = typeof level === 'number' ? ` L${level}` : '';
    return `${rarity} ${name}${levelPart} (${note})`;
}

function collectCoreModules(modulesExtract, warnings) {
    const owned = [];
    if (!modulesExtract) {
        warnings.push('Could not read owned modules from this save.');
        return owned;
    }

    for (const item of modulesExtract.equipped || []) {
        if (item.category !== 'Core') continue;
        const slots = decodeSlots(item.effects, item.effectLocked);
        owned.push({
            key: `equipped:${item.slotKey}`,
            label: friendlyModuleLabel(item.rarityLabel, item.mappedName, `equipped, ${item.role === 'primary' ? 'Primary' : 'Assist'}`, item.level),
            role: item.role,
            level: item.level,
            slots,
        });
    }

    (modulesExtract.inventory || []).forEach((item, index) => {
        if (item.category !== 'Core') return;
        const slots = decodeSlots(item.effects, item.effectLocked);
        owned.push({
            key: `inventory:${item.recordIndex ?? index}`,
            label: friendlyModuleLabel(item.rarityLabel, item.mappedName, 'inventory', item.level),
            role: null,
            level: item.level,
            slots,
        });
    });

    if (owned.length === 0) warnings.push('No Core modules found in this save.');
    return owned;
}

function findEquippedCoreKey(modulesExtract, role) {
    const item = (modulesExtract?.equipped || []).find((entry) => entry.category === 'Core' && entry.role === role);
    return item ? `equipped:${item.slotKey}` : null;
}

function numberAt(values, index) {
    const raw = Array.isArray(values) ? values[index] : null;
    if (raw == null) return null;
    const value = Number(raw && typeof raw === 'object' && 'value__' in raw ? raw.value__ : raw);
    return Number.isFinite(value) ? value : null;
}

/**
 * The assist-slot Core module's substat efficiency: the fraction (0-1)
 * applied to an assist module's substat contribution, plus the raw stone
 * level behind it (the lab level is a fixed input, but the stone level is
 * something the planner can consider leveling further).
 */
function readCoreAssistEfficiency(parsedRoot, warnings) {
    const fallback = { fraction: 0, stoneLevel: 0, labLevel: 0 };
    try {
        const coreSlotIndex = Object.entries(MODULE_SAVE_ASSIST_TYPE_TO_CATEGORY)
            .find(([, category]) => category === 'Core')?.[0];
        const assistSlots = parsedRoot?.[MODULE_SAVE_ASSIST_SLOTS_KEY];
        const coreSlot = coreSlotIndex != null && Array.isArray(assistSlots)
            ? assistSlots[Number(coreSlotIndex)]
            : null;
        const stoneLevel = coreSlot?.substatEfficiencyLevel;
        const labLevel = numberAt(parsedRoot?.[RESEARCH_LEVELS_KEY], ASSIST_CORE_SUBSTATS_LAB_INDEX) ?? 0;

        if (typeof stoneLevel !== 'number') {
            warnings.push('Could not read assist-module efficiency from this save — assuming 0% for assist Core substats.');
            return fallback;
        }

        const fraction = Math.max(0, Math.min(1, assistEfficiency({ hasAssist: true, stoneLevel, labLevel })));
        return { fraction, stoneLevel, labLevel };
    } catch {
        warnings.push('Could not read assist-module efficiency from this save — assuming 0% for assist Core substats.');
        return fallback;
    }
}

function readChronoFieldLevels(parsedRoot, warnings) {
    try {
        const levels = parsedRoot?.[UW_LEVELS_KEY];
        const offset = CHRONO_FIELD_SAVE_SLOT * UW_STATS_PER_SLOT;
        const duration = numberAt(levels, offset);
        const speed = numberAt(levels, offset + 1);
        const cooldown = numberAt(levels, offset + 2);
        if (duration == null || speed == null || cooldown == null) throw new Error('missing stat levels');
        return { duration, speed, cooldown };
    } catch {
        warnings.push('Could not read Chrono Field stone levels from this save.');
        return { duration: 0, speed: 0, cooldown: 0 };
    }
}

function readDurationLabMaxed(parsedRoot, warnings) {
    try {
        const level = numberAt(parsedRoot?.[RESEARCH_LEVELS_KEY], CHRONO_FIELD_DURATION_LAB_INDEX);
        if (level == null) throw new Error('lab row not found');
        return level >= CHRONO_FIELD_DURATION_LAB_MAX;
    } catch {
        warnings.push('Could not read the Chrono Field Duration lab from this save — assuming it is not maxed.');
        return false;
    }
}

function readLabsCoinDiscountFraction(parsedRoot, warnings) {
    try {
        const level = numberAt(parsedRoot?.[RESEARCH_LEVELS_KEY], LABS_COIN_DISCOUNT_LAB_INDEX);
        if (level == null) throw new Error('lab row not found');
        return level * LABS_COIN_DISCOUNT_PER_LEVEL;
    } catch {
        warnings.push('Could not read the Labs Coin Discount lab from this save — assuming no discount.');
        return 0;
    }
}

function readLabsSpeedLabLevel(parsedRoot, warnings) {
    try {
        const level = numberAt(parsedRoot?.[RESEARCH_LEVELS_KEY], LABS_SPEED_LAB_INDEX);
        if (level == null) throw new Error('lab row not found');
        return level;
    } catch {
        warnings.push('Could not read the Labs Speed lab from this save — assuming level 0.');
        return 0;
    }
}

const RELICS_SAVE_PROFILE_KEY = 'profileRelics';
const RELICS_SAVE_UNLOCKED_KEY = 'relicsUnlocked';
const RELIC_STATE_UNLOCKED_VALUE = 1;

/** A `relicsUnlocked` entry can be a plain boolean or an enum-wrapped state (0 = locked, 1+ = unlocked). */
function isRelicEntryUnlocked(raw) {
    if (typeof raw === 'boolean') return raw;
    const value = raw && typeof raw === 'object' && 'value__' in raw ? raw.value__ : raw;
    return typeof value === 'number' && value >= RELIC_STATE_UNLOCKED_VALUE;
}

const RELIC_TEMPLATE_ID_LOOKUP = buildRelicTemplateIdLookup(RELIC_TEMPLATES);

/** Percent lab-speed bonus from unlocked relics (e.g. "Ancient Tome" +1.5%) — the other real, save-readable source besides the Labs Speed lab. */
function readLabSpeedRelicPercent(parsedRoot, warnings) {
    try {
        const unlockedIndices = new Set(
            (Array.isArray(parsedRoot?.[RELICS_SAVE_PROFILE_KEY]) ? parsedRoot[RELICS_SAVE_PROFILE_KEY] : [])
                .map((value) => Number(value))
                .filter((index) => Number.isInteger(index) && index >= 0),
        );
        const unlockedFlags = Array.isArray(parsedRoot?.[RELICS_SAVE_UNLOCKED_KEY]) ? parsedRoot[RELICS_SAVE_UNLOCKED_KEY] : [];
        unlockedFlags.forEach((flag, index) => {
            if (isRelicEntryUnlocked(flag)) unlockedIndices.add(index);
        });

        const tracked = {};
        for (const index of unlockedIndices) {
            const templateId = findRelicTemplateIdFromSaveIndex(index, RELIC_TEMPLATES, RELIC_TEMPLATE_ID_LOOKUP);
            if (templateId) tracked[templateId] = true;
        }
        return computeLabSpeedRelicBonusPercent(tracked);
    } catch {
        warnings.push('Could not read relic Lab Speed bonuses from this save — assuming 0%.');
        return 0;
    }
}

/**
 * The player's recent coins/hour, the same way the game's own stat panel
 * derives it: mean of the three best runs in battle history. Used to turn a
 * lab's coin cost into a rough "days of farming" estimate — a peak rate, not
 * a sustained one, so that estimate is optimistic by nature.
 */
function readCoinsPerHour(parsedRoot, warnings) {
    try {
        const rate = computeCoinsPerHourFromSaveRoot(parsedRoot);
        if (rate == null) throw new Error('no qualifying battle history runs');
        return rate;
    } catch {
        warnings.push('Could not read recent coins/hour from this save — the lab plan will skip the farming-time estimate.');
        return null;
    }
}

/**
 * Reads everything the calculator needs from a decoded playerInfo.dat root.
 * Best-effort: any field that can't be located degrades to a safe default
 * plus a human-readable warning, instead of throwing.
 */
function extractSaveData(parsedRoot) {
    const warnings = [];

    const modulesExtract = readModulesFromSaveRoot(parsedRoot);

    const stones = typeof parsedRoot?.stones === 'number' ? parsedRoot.stones : null;
    const assistCoreEfficiencyInfo = readCoreAssistEfficiency(parsedRoot, warnings);

    return {
        stones,
        levels: readChronoFieldLevels(parsedRoot, warnings),
        durationLabMaxed: readDurationLabMaxed(parsedRoot, warnings),
        labsCoinDiscountFraction: readLabsCoinDiscountFraction(parsedRoot, warnings),
        labsSpeedLabLevel: readLabsSpeedLabLevel(parsedRoot, warnings),
        labSpeedRelicPercent: readLabSpeedRelicPercent(parsedRoot, warnings),
        coinsPerHour: readCoinsPerHour(parsedRoot, warnings),
        assistCoreEfficiency: assistCoreEfficiencyInfo.fraction,
        // The stone-level side of assist efficiency — separate from the
        // fraction above because the planner can consider leveling it
        // further, while the lab level stays a fixed input like other labs.
        assistCoreEfficiencyStoneLevel: assistCoreEfficiencyInfo.stoneLevel,
        assistCoreEfficiencyLabLevel: assistCoreEfficiencyInfo.labLevel,
        coreModules: collectCoreModules(modulesExtract, warnings),
        defaultPrimaryKey: findEquippedCoreKey(modulesExtract, 'primary'),
        defaultAssistKey: findEquippedCoreKey(modulesExtract, 'assist'),
        warnings,
    };
}

module.exports = { extractSaveData };
