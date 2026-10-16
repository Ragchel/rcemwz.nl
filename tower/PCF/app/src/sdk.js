// Every thetowersdk import this app makes, gathered in one place.
//
// thetowersdk@0.12 only exports its public entry points (`thetowersdk/save`,
// `/mechanics`, `/data`, …) and ships them as CommonJS barrels that require
// every module beneath them, so importing a single function through one pulls
// in ~1MB (gzipped) of catalogs this app never touches. These requires point
// straight at the individual dist files instead, bypassing the package's
// `exports` map via a relative path. That is NOT a supported surface: when
// upgrading the SDK, check that each file below still exists and still
// exports these names (`npm test` and `npm run build` will both fail loudly
// if one moved). Paths verified against thetowersdk@0.12.0.
const {
    readModulesFromSaveRoot,
    MODULE_SAVE_ASSIST_TYPE_TO_CATEGORY,
    MODULE_SAVE_ASSIST_SLOTS_KEY,
} = require('../node_modules/thetowersdk/dist/save/modules/read.js');
const { decodeModuleSubstats } = require('../node_modules/thetowersdk/dist/save/modules/decode.js');
const { computeCoinsPerHourFromSaveRoot } = require('../node_modules/thetowersdk/dist/save/battle/history.js');
const {
    buildRelicTemplateIdLookup,
    findRelicTemplateIdFromSaveIndex,
} = require('../node_modules/thetowersdk/dist/save/catalogs/relic-template-match.js');
const {
    RELIC_TEMPLATES,
    computeLabSpeedRelicBonusPercent,
} = require('../node_modules/thetowersdk/dist/data/relics/data.js');
const {
    assistEfficiency,
    cumulativeAssistEfficiencyStoneCost,
    maxStoneLevel,
} = require('../node_modules/thetowersdk/dist/mechanics/effective-paths/assist-efficiency.js');
const {
    labCoinCostToReachLevel,
    labDurationDaysToReachLevel,
    labMaxCatalogLevel,
} = require('../node_modules/thetowersdk/dist/mechanics/effective-paths/lab-costs.js');

module.exports = {
    readModulesFromSaveRoot,
    MODULE_SAVE_ASSIST_TYPE_TO_CATEGORY,
    MODULE_SAVE_ASSIST_SLOTS_KEY,
    decodeModuleSubstats,
    computeCoinsPerHourFromSaveRoot,
    buildRelicTemplateIdLookup,
    findRelicTemplateIdFromSaveIndex,
    RELIC_TEMPLATES,
    computeLabSpeedRelicBonusPercent,
    assistEfficiency,
    cumulativeAssistEfficiencyStoneCost,
    maxStoneLevel,
    labCoinCostToReachLevel,
    labDurationDaysToReachLevel,
    labMaxCatalogLevel,
};
