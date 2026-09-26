const { initPlotter } = require('./orbit-plotter');

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('calculator')) return;

    initPlotter();
});
