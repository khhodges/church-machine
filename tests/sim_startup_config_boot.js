// Boot integration harness for Startup.Config (Task #396).
//
// Verifies that the real boot sequence (B:00-B:04+B:05a) automatically
// dispatches Startup.Config.Execute() during boot completion (B:05a in
// simulator.js).  This replicates the dispatch that BOOT_ROM_WORDS[7]
// performs via Boot.Abstr c-list[4].  No manual post-boot dispatch is needed —
// the boot step itself calls abstractionRegistry.dispatchMethod(2, 'Execute').
//
// Steps:
//   1. Initialize simulator, AbstractionRegistry, SystemAbstractions.
//   2. Drive _bootStep() until bootComplete (B:00-B:05).
//   3. After boot, inspect sim.auditLog for 'Startup.Config.Execute' entry.
//   4. Print a JSON report to stdout.
//
// Print format (all fields documented here):
//   {
//     "bootComplete":            true  // boot steps completed
//     "faultLog":                []    // empty on clean boot
//     "startupConfigEntry":      {...} // gate-log entry from Execute()
//     "executeResult":           null  // not separately tracked (boot dispatches internally)
//     "auditLogHasStartup":      true  // true iff gate-log entry exists
//     "ledBits":                 63    // 0x3F on success
//     "dispatchedToSlot":        4     // nsIndex from the gate-log entry
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

// --- Drive boot state machine (B:00–B:05) ---
// B:05a inside the boot sequence automatically calls
// abstractionRegistry.dispatchMethod(STARTUP_CONFIG_NS_SLOT, 'Execute', sim, {}).
const MAX_BOOT = 32;
let bootIters = 0;
while (bootIters < MAX_BOOT && !sim.bootComplete && !sim.halted) {
    const advanced = sim._bootStep();
    bootIters++;
    if (!advanced) break;
}

const scEntry = (sim.auditLog || []).find(e => e.gate === 'Startup.Config.Execute');

const out = {
    bootComplete:       sim.bootComplete === true,
    faultLog:           (sim.faultLog || []).map(f => ({
                            type: f.type, message: f.message
                        })),
    startupConfigEntry: scEntry || null,
    executeResult:      null,  // dispatched internally by boot; not captured as a separate return value
    auditLogHasStartup: scEntry !== undefined,
    ledBits:            sim.ledBits | 0,
    dispatchedToSlot:   scEntry ? (scEntry.nsIndex | 0) : -1,
};

process.stdout.write(JSON.stringify(out) + '\n');
