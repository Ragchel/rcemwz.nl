const assert = require('node:assert/strict');
const test = require('node:test');

const {
    computeEffectiveChronoField,
    computeLoadoutSubstats,
    cumulativeCost,
    levelValue,
} = require('../src/chrono-field-math');
const { extractSaveData } = require('../src/extract-save-data');
const { findCheapestInvestment } = require('../src/planner');

test('stone table lookups clamp levels and precompute cumulative costs', () => {
    assert.equal(levelValue('Duration', 0), 5);
    assert.equal(levelValue('Duration', 999), 40);
    assert.equal(cumulativeCost('Duration', 2), 19);
    assert.equal(cumulativeCost('Duration', -1), 0);
});

test('loadout substats accept both module arrays and indexed maps', () => {
    const modules = [{
        key: 'core-1',
        slots: [{
            slot: 1,
            unlocked: true,
            isChronoField: true,
            label: 'Chrono Field - Duration',
            displayValue: '+10s',
        }],
    }];
    const expected = { duration: 10, cooldown: 0, speedReduction: 0 };

    assert.deepEqual(computeLoadoutSubstats(modules, 'core-1', null, 0), expected);
    assert.deepEqual(computeLoadoutSubstats(new Map([['core-1', modules[0]]]), 'core-1', null, 0), expected);
});

test('effective stats report permanent uptime and its margin', () => {
    const result = computeEffectiveChronoField({
        levels: { duration: 35, cooldown: 12, speed: 11 },
        substats: { duration: 0, cooldown: 0, speedReduction: 0 },
        durationLabMaxed: true,
        runPerkActive: false,
        battleConditionActive: false,
    });

    assert.equal(result.permanent, true);
    assert.equal(result.marginSeconds, 10);
    assert.equal(result.speedReductionEff, 75);
});

test('planner returns a zero-cost plan when current levels meet the target', () => {
    const plan = findCheapestInvestment(
        { duration: 35, cooldown: 12, speed: 11 },
        [{
            substats: { duration: 0, cooldown: 0, speedReduction: 0 },
            durationLabMaxed: true,
            runPerkActive: false,
            battleConditionActive: false,
        }],
        75,
    );

    assert.equal(plan.additionalCost, 0);
});

test('save extraction reads the two required lab levels and Chrono Field levels directly', () => {
    const researchLevel = Array(234).fill(0);
    researchLevel[53] = 30;
    researchLevel[233] = 12;
    const ultimateWeaponLevel = Array(27).fill(0);
    ultimateWeaponLevel.splice(9, 3, 20, 8, 10);

    const data = extractSaveData({
        researchLevel,
        ultimateWeaponLevel,
        moduleEquipped: [],
        assistModuleSlots: [{}, {}, {}, { substatEfficiencyLevel: 7 }],
        inventory: [],
    });

    assert.deepEqual(data.levels, { duration: 20, speed: 8, cooldown: 10 });
    assert.equal(data.durationLabMaxed, true);
    assert.equal(data.assistCoreEfficiency, 0.2);
});

test('missing save arrays keep safe defaults and produce warnings', () => {
    const data = extractSaveData({});

    assert.deepEqual(data.levels, { duration: 0, speed: 0, cooldown: 0 });
    assert.equal(data.durationLabMaxed, false);
    assert.ok(data.warnings.some((warning) => warning.includes('stone levels')));
    assert.ok(data.warnings.some((warning) => warning.includes('Duration lab')));
});
