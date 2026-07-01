// Headless harness: simulates real startup order (initAbstractions → reset)
// and writes {nsCount, slot8IsZero} as JSON to stdout.
//
// Validates that _getHardwareBootCatalog() is never influenced by the
// abstractionRegistry, so NS table is always exactly 8 slots at cold boot.

global.window = { bootConfig: {} };

const ChurchSimulator = require('../../simulator/simulator.js');

// Build a minimal mock registry with 44 abstract slots (like the real app).
const mockAbstractions = {};
for (let i = 0; i < 44; i++) {
    mockAbstractions[i] = {
        index: i,
        name: `MockAbs${i}`,
        perms: { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 },
        chainable: false,
        handler: null,
        freedNSSlot: false,
    };
}
const mockRegistry = {
    abstractions: mockAbstractions,
    getAbstraction: (idx) => mockAbstractions[idx] || null,
    dispatchMethod: () => null,
    activate: () => {},
    reportFault: () => {},
};

const sim = new ChurchSimulator();

// Mimic real startup: initAbstractions first, then reset (which runs
// _initNamespaceTable → _getHardwareBootCatalog).
sim.initAbstractions(mockRegistry, [], []);
sim.reset();

// Slot 8 words: should all be zero (not written by hardware boot catalog).
const NS_ENTRY_WORDS = 4;
const nsTableBase = sim.memory.length - (sim.NS_TABLE_RESERVE / 4 | 0);
const slot8Base = nsTableBase + 8 * NS_ENTRY_WORDS;
const slot8Words = Array.from({ length: NS_ENTRY_WORDS }, (_, j) => sim.memory[slot8Base + j]);
const slot8IsZero = slot8Words.every(w => w === 0);

process.stdout.write(JSON.stringify({
    nsCount: sim.nsCount,
    slot8IsZero,
    slot8Words: slot8Words.map(w => '0x' + w.toString(16).padStart(8, '0')),
}));
