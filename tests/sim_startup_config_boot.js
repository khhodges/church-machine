// Boot integration harness for Startup.Config (Task #396).
//
// Simulates a complete boot sequence — B:00 through BOOT_ROM_WORDS execution —
// and verifies that Startup.Config.Execute() is invoked by the CALL instruction
// in BOOT_ROM_WORDS[7] (CALL AL, CR0, CR0 after loading c-list[4]).
//
// The harness:
//   1. Creates a ChurchSimulator with the default boot config.
//   2. Initialises AbstractionRegistry + SystemAbstractions (so dispatchMethod works).
//   3. Calls sim.initAbstractions(...) — wires the registry into the simulator.
//   4. Drives _bootStep() until bootComplete (B:00–B:04).
//   5. Continues step() until the auditLog contains 'Startup.Config.Execute'
//      or a safety cap is reached.
//   6. Prints a JSON report to stdout.
//
// Print format:
//   {
//     "bootComplete":       boolean,
//     "halted":             boolean,
//     "faultLog":           [...],
//     "startupConfigEntry": <auditLog entry for Startup.Config.Execute> | null,
//     "auditLog":           [...],    // all audit log entries
//     "ledBits":            number,   // 0x3F on success
//     "entrySlot":          number    // NS slot Startup.Config dispatched to
//   }

global.window = {
    bootConfig: {
        step1: {
            totalNamespaceWords:  16384,
            namespaceLumpWords:      64,
            threadLumpWords:        256,
            abstractionLumpWords:   256,
        }
    }
};

const ChurchSimulator     = require('../simulator/simulator.js');
const AbstractionRegistry = require('../simulator/abstractions.js');
const SystemAbstractions  = require('../simulator/system_abstractions.js');

const sim      = new ChurchSimulator();
const registry = new AbstractionRegistry();
const sys      = new SystemAbstractions(registry);
sim.initAbstractions(registry, sys, null);

// --- Phase 1: drive the boot state machine (B:00–B:04) ---
const MAX_BOOT = 32;
let bootIters = 0;
while (bootIters < MAX_BOOT && !sim.bootComplete && !sim.halted) {
    const advanced = sim._bootStep();
    bootIters++;
    if (!advanced) break;
}

// --- Phase 2: drive CPU instructions until Startup.Config.Execute appears ---
const MAX_CPU = 256;
let cpuIters = 0;
let startupConfigEntry = null;

while (cpuIters < MAX_CPU && !sim.halted) {
    // Check auditLog for Startup.Config.Execute BEFORE stepping (it may already be there)
    const scEntry = (sim.auditLog || []).find(e => e.gate === 'Startup.Config.Execute');
    if (scEntry) {
        startupConfigEntry = scEntry;
        break;
    }
    try {
        sim.step();
    } catch (e) {
        break;
    }
    cpuIters++;
}

// Final check after last step
if (!startupConfigEntry) {
    const scEntry = (sim.auditLog || []).find(e => e.gate === 'Startup.Config.Execute');
    if (scEntry) startupConfigEntry = scEntry;
}

const out = {
    bootComplete:       sim.bootComplete === true,
    halted:             sim.halted === true,
    faultLog:           (sim.faultLog || []).map(f => ({
                            type: f.type, message: f.message
                        })),
    startupConfigEntry: startupConfigEntry || null,
    auditLog:           (sim.auditLog || []).map(e => ({
                            gate: e.gate,
                            label: e.label,
                            nsIndex: e.nsIndex != null ? e.nsIndex : null,
                            result: e.result,
                            bootStepName: e.bootStepName || null,
                        })),
    ledBits:            sim.ledBits | 0,
    entrySlot:          startupConfigEntry ? (startupConfigEntry.nsIndex | 0) : -1,
};

process.stdout.write(JSON.stringify(out) + '\n');
