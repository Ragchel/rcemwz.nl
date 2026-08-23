const { initCalculator } = require('./ui');

document.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('[data-cf-calculator]');
    if (!root) return;

    initCalculator(root);
});
