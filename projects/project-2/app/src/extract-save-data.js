const {
    readModulesFromSaveRoot,
    readLabsFromSaveRoot,
    readUltimateWeaponsFromSaveRoot,
    getUltimateWeaponSaveSlotNames,
    decodeModuleSubstats,
    isLabResearchMaxed,
    MODULE_SAVE_ASSIST_TYPE_TO_CATEGORY,
    MODULE_SAVE_ASSIST_SLOTS_KEY,
} = require('thetowersdk/save');

// From thetowersdk@0.5.3's UW_LAB_INDICES (dist/mechanics/lab-research.js).
// Inlined instead of importing `thetowersdk/mechanics` to avoid pulling in
// ~900KB of unrelated mechanics modules for one lookup index.
const CHRONO_FIELD_DURATION_LAB_INDEX = 53;

const CF_SUBSTAT_LABELS = {
    'Chrono Field - Duration': 'duration',
    'Chrono Field - Cooldown': 'cooldown',
    'Chrono Field - Speed Reduction': 'speedReduction',
};

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
            isChronoField: Boolean(CF_SUBSTAT_LABELS[label]),
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

/** Fraction (0-1) applied to an assist-slot Core module's substat contribution. */
function readCoreAssistEfficiency(parsedRoot, labsExtract, warnings) {
    try {
        const coreSlotIndex = Object.entries(MODULE_SAVE_ASSIST_TYPE_TO_CATEGORY)
            .find(([, category]) => category === 'Core')?.[0];
        const assistSlots = parsedRoot?.[MODULE_SAVE_ASSIST_SLOTS_KEY];
        const coreSlot = coreSlotIndex != null && Array.isArray(assistSlots)
            ? assistSlots[Number(coreSlotIndex)]
            : null;
        const stoneLevel = coreSlot?.substatEfficiencyLevel;

        const labRow = (labsExtract?.researches || [])
            .find((row) => /assist module substats/i.test(row.displayName || '') && /core/i.test(row.displayName || ''));
        const labLevel = labRow?.level ?? 0;

        if (typeof stoneLevel !== 'number') {
            warnings.push('Could not read assist-module efficiency from this save — assuming 0% for assist Core substats.');
            return 0;
        }

        return Math.max(0, Math.min(1, (1 + stoneLevel + labLevel) / 100));
    } catch {
        warnings.push('Could not read assist-module efficiency from this save — assuming 0% for assist Core substats.');
        return 0;
    }
}

function readChronoFieldLevels(parsedRoot, warnings) {
    try {
        const extract = readUltimateWeaponsFromSaveRoot(parsedRoot);
        const names = getUltimateWeaponSaveSlotNames();
        const slotIndex = names.indexOf('Chrono Field');
        const slot = extract?.slots.find((entry) => entry.slotIndex === slotIndex);
        const [duration, speed, cooldown] = slot?.baseStatLevels || [];
        if (duration == null || speed == null || cooldown == null) throw new Error('missing stat levels');
        return { duration, speed, cooldown };
    } catch {
        warnings.push('Could not read Chrono Field stone levels from this save.');
        return { duration: 0, speed: 0, cooldown: 0 };
    }
}

function readDurationLabMaxed(parsedRoot, labsExtract, warnings) {
    try {
        const row = labsExtract?.researches.find((entry) => entry.index === CHRONO_FIELD_DURATION_LAB_INDEX);
        if (!row) throw new Error('lab row not found');
        return isLabResearchMaxed(CHRONO_FIELD_DURATION_LAB_INDEX, row.level);
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
    const labsExtract = readLabsFromSaveRoot(parsedRoot);

    const stones = typeof parsedRoot?.stones === 'number' ? parsedRoot.stones : null;

    return {
        stones,
        levels: readChronoFieldLevels(parsedRoot, warnings),
        durationLabMaxed: readDurationLabMaxed(parsedRoot, labsExtract, warnings),
        assistCoreEfficiency: readCoreAssistEfficiency(parsedRoot, labsExtract, warnings),
        coreModules: collectCoreModules(modulesExtract, warnings),
        defaultPrimaryKey: findEquippedCoreKey(modulesExtract, 'primary'),
        defaultAssistKey: findEquippedCoreKey(modulesExtract, 'assist'),
        warnings,
    };
}

module.exports = { extractSaveData };
