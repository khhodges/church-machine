// Headless harness used by tests/test_privilege_fence_cr12_15.py.
//
// Boots the simulator with a minimal default config, then injects
// individual instruction words at PC=0 (the code-lump start), calls
// step() once, and reports whether a PRIV_REG fault fired and what the
// full fault string says.
//
// Stdin: JSON array of scenario objects, each with:
//   { "name": "...", "opcode": N, "cond": N, "crDst": N, "crSrc": N, "imm": N,
//     "preloadCaps": [{ "cr": N, "word0": N, "word1": N }, ...] }
//
//   preloadCaps (optional): list of CR slots to overwrite after boot, before
//   step() is called.  Useful for injecting authority caps (e.g. S-perm with
//   CR_PORT location) that the boot sequence doesn't install in user CRs.
//
// Stdout: JSON array of result objects, each with:
//   { "name": "...", "faulted": bool, "faultCode": "...", "faultMsg": "..." }
//
// Usage:
//   echo '[{"name":"...","opcode":0,"cond":0,"crDst":12,"crSrc":0,"imm":0}]' \
//     | node tests/sim_priv_fence.js

'use strict';

global.window = { bootConfig: {} };

const { bootSim } = require('./sim_helpers');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
    const scenarios = JSON.parse(raw);
    const results = [];

    for (const sc of scenarios) {
        // Fresh sim + boot on every scenario so state doesn't bleed through.
        const sim = bootSim();

        if (!sim.bootComplete) {
            results.push({ name: sc.name, error: 'boot did not complete' });
            continue;
        }

        // Find the code-lump base from CR14.  _fetchInstruction computes:
        //   fetchAddr = cr14.word1 + 1 + this.pc
        // The +1 skips the lump header word.  For PC=0 that is cr14.word1 + 1.
        const cr14 = sim.cr[14];
        const codeBase = cr14 ? cr14.word1 : null;
        if (codeBase == null) {
            results.push({ name: sc.name, error: 'CR14.word1 is null after boot' });
            continue;
        }

        // Encode the instruction.  Use cond=0xE (AL=Always) if the scenario
        // does not specify a condition, so the privilege fence is always reached.
        const cond = (sc.cond != null) ? sc.cond : 0xE;
        const instr = sim.encodeInstruction(
            sc.opcode, cond, sc.crDst, sc.crSrc, sc.imm);

        // Write at the physical address the CPU will fetch for PC=0.
        sim.memory[codeBase + 1] = instr >>> 0;

        // Inject authority caps before step() if the scenario requests it.
        // This lets tests supply S-perm caps with CR_PORT locations without
        // needing a full privilege-manager boot.
        if (Array.isArray(sc.preloadCaps)) {
            for (const cap of sc.preloadCaps) {
                if (sim.cr[cap.cr] === undefined) sim.cr[cap.cr] = {};
                sim.cr[cap.cr].word0 = cap.word0 >>> 0;
                sim.cr[cap.cr].word1 = cap.word1 >>> 0;
            }
        }

        // Reset PC and clear halted/fault state so step() runs cleanly.
        sim.pc = 0;
        sim.halted = false;

        // Capture the fault log before and after.
        const faultsBefore = sim.faultLog ? sim.faultLog.length : 0;

        sim.step();

        const faultsAfter  = sim.faultLog ? sim.faultLog.length : 0;
        const newFaults    = sim.faultLog ? sim.faultLog.slice(faultsBefore) : [];

        const privFault    = newFaults.find(f => f.type === 'PRIV_REG');
        results.push({
            name:      sc.name,
            faulted:   newFaults.length > 0,
            privFault: !!privFault,
            faultCode: newFaults.length ? newFaults[0].type : null,
            faultMsg:  newFaults.length ? newFaults[0].message : null,
        });
    }

    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
});
