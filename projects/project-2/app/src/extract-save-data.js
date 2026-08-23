const {
    readModulesFromSaveRoot,
    MODULE_SAVE_ASSIST_TYPE_TO_CATEGORY,
    MODULE_SAVE_ASSIST_SLOTS_KEY,
} = require('thetowersdk/internal/save/modules');
const { decodeModuleSubstats } = require('thetowersdk/internal/save/module-effects-decode');
const { assistEfficiency } = require('thetowersdk/internal/mechanics/effective-paths-assist-efficiency');
const { CHRONO_FIELD_SUBSTAT_KEYS } = require('./constants');

// Stable save-array positions from thetowersdk@0.5.3. Reading these two lab
// levels directly avoids bundling the SDK's complete lab catalog.
const CHRONO_FIELD_DURATION_LAB_INDEX = 53;
const CHRONO_FIELD_DURATION_LAB_MAX = 30;
const ASSIST_CORE_SUBSTATS_LAB_INDEX = 233;
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

function friendlyModuleLabel(rarityLabel, mappedName, note) {
    const rarity = rarityLabel || 'Unknown rarity';
    const name = mappedName || 'Core module';
    return `${rarity} ${name} (${note})`;
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
            label: friendlyModuleLabel(item.rarityLabel, item.mappedName, `equipped, ${item.role === 'primary' ? 'Primary' : 'Assist'}`),
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
            label: friendlyModuleLabel(item.rarityLabel, item.mappedName, 'inventory'),
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
