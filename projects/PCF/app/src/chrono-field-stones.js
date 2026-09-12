/**
 * Chrono Field per-level value/stone-cost table, vendored from
 * thetowersdk@0.5.3's `uwStoneChartData.chrono_field` (dist/data/ultimate-weapon-stones.js).
 *
 * Copied locally instead of importing `thetowersdk/data` because that barrel
 * pulls in ~5MB of unrelated game data (workshop, glossary, player stats, ...)
 * for the sake of this one small, stable table. Refresh from the package if
 * a future thetowersdk version changes Chrono Field's stone costs.
 */
const CHRONO_FIELD_STATS = [
    {
        name: 'Duration', levels: [
            { level: 0, value: '5s', cost: 'Unlock' },
            { level: 1, value: '6s', cost: 5 },
            { level: 2, value: '7s', cost: 14 },
            { level: 3, value: '8s', cost: 23 },
            { level: 4, value: '9s', cost: 32 },
            { level: 5, value: '10s', cost: 41 },
            { level: 6, value: '11s', cost: 50 },
            { level: 7, value: '12s', cost: 59 },
            { level: 8, value: '13s', cost: 68 },
            { level: 9, value: '14s', cost: 77 },
            { level: 10, value: '15s', cost: 86 },
            { level: 11, value: '16s', cost: 95 },
            { level: 12, value: '17s', cost: 104 },
            { level: 13, value: '18s', cost: 113 },
            { level: 14, value: '19s', cost: 122 },
            { level: 15, value: '20s', cost: 131 },
            { level: 16, value: '21s', cost: 140 },
            { level: 17, value: '22s', cost: 149 },
            { level: 18, value: '23s', cost: 158 },
            { level: 19, value: '24s', cost: 167 },
            { level: 20, value: '25s', cost: 176 },
            { level: 21, value: '26s', cost: 185 },
            { level: 22, value: '27s', cost: 194 },
            { level: 23, value: '28s', cost: 203 },
            { level: 24, value: '29s', cost: 212 },
            { level: 25, value: '30s', cost: 221 },
            { level: 26, value: '31s', cost: 230 },
            { level: 27, value: '32s', cost: 239 },
            { level: 28, value: '33s', cost: 248 },
            { level: 29, value: '34s', cost: 257 },
            { level: 30, value: '35s', cost: 266 },
            { level: 31, value: '36s', cost: 275 },
            { level: 32, value: '37s', cost: 284 },
            { level: 33, value: '38s', cost: 293 },
            { level: 34, value: '39s', cost: 302 },
            { level: 35, value: '40s', cost: 311 },
        ],
    },
    {
        name: 'Speed', levels: [
            { level: 0, value: '20%', cost: 'Unlock' },
            { level: 1, value: '25%', cost: 15 },
            { level: 2, value: '30%', cost: 25 },
            { level: 3, value: '35%', cost: 40 },
            { level: 4, value: '40%', cost: 60 },
            { level: 5, value: '45%', cost: 120 },
            { level: 6, value: '50%', cost: 150 },
            { level: 7, value: '55%', cost: 200 },
            { level: 8, value: '60%', cost: 300 },
            { level: 9, value: '65%', cost: 450 },
            { level: 10, value: '70%', cost: 650 },
            { level: 11, value: '75%', cost: 900 },
        ],
    },
    {
        name: 'Cooldown', levels: [
            { level: 0, value: '180s', cost: 'Unlock' },
            { level: 1, value: '170s', cost: 10 },
            { level: 2, value: '160s', cost: 31 },
            { level: 3, value: '150s', cost: 52 },
            { level: 4, value: '140s', cost: 73 },
            { level: 5, value: '130s', cost: 94 },
            { level: 6, value: '120s', cost: 115 },
            { level: 7, value: '110s', cost: 136 },
            { level: 8, value: '100s', cost: 157 },
            { level: 9, value: '90s', cost: 178 },
            { level: 10, value: '80s', cost: 199 },
            { level: 11, value: '70s', cost: 220 },
            { level: 12, value: '60s', cost: 241 },
        ],
    },
    {
        name: 'Chrono Loop', levels: [
            { level: 0, value: '10%', cost: 'Unlock' },
            { level: 1, value: '15%', cost: 400 },
            { level: 2, value: '20%', cost: 500 },
            { level: 3, value: '25%', cost: 610 },
            { level: 4, value: '30%', cost: 730 },
            { level: 5, value: '35%', cost: 860 },
            { level: 6, value: '40%', cost: 1000 },
            { level: 7, value: '45%', cost: 1150 },
            { level: 8, value: '50%', cost: 1300 },
            { level: 9, value: '55%', cost: 1500 },
            { level: 10, value: '60%', cost: 1700 },
            { level: 11, value: '65%', cost: 1950 },
            { level: 12, value: '70%', cost: 2200 },
            { level: 13, value: '75%', cost: 2450 },
        ],
    },
];

module.exports = { CHRONO_FIELD_STATS };
