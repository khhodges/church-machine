// Headless harness used by tests/test_boot_image_loads_and_boots.py.
//
// Reads a JSON envelope from stdin of the form:
//   {
//     "config":       { ... boot config (same shape as window.bootConfig) ... }
//                     OR omitted/null for the "no bootConfig at all" scenario,
//     "imageBase64":  "<base64-encoded raw 32-bit LE boot image binary>",
//     "skipWindow":   true  // if set, do NOT define global.window at all
//                           // (mirrors the IDE booting before any project
//                           //  bootConfig has been saved)
//   }
//
// Then:
//   1. Sets global.window.bootConfig so ChurchSimulator sizes memory[]
//      to match the image (and so loadBootImage honours Step-3 reserved
//      empty NS slots).
//   2. Instantiates ChurchSimulator (which runs reset() ->
//      _initNamespaceTable()).
//   3. Zeros memory[] before overlaying the image, so the test really
//      exercises loadBootImage() rather than re-reading whatever
//      _initNamespaceTable() happens to have written.
//   4. Calls loadBootImage(imageBuffer).
//   5. Drives _bootStep() until bootComplete or halted (or a safety
//      cap of 64 iterations is hit).
//   6. Emits a JSON status report on stdout (single line) describing the
//      outcome -- bootComplete, halted, bootStep, faultLog, nsCount,
//      a peek at CR12/CR14/CR15/CR6, PC and STO.
//
// Usage:
//   echo '{"config":{...},"imageBase64":"..."}' | node tests/sim_boot_loader.js

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
    const env = JSON.parse(raw);
    const cfg = env.config || null;
    const imgBuf = Buffer.from(env.imageBase64 || '', 'base64');

    if (env.skipWindow) {
        // Leave global.window undefined so the simulator takes the
        // "no project bootConfig" branch in _namespaceMemoryWords()
        // (defaults to the historical 65536-word memory window).
    } else {
        global.window = { bootConfig: cfg || {} };
    }

    const ChurchSimulator = require('../../simulator/simulator.js');
    const sim = new ChurchSimulator();

    // Wipe memory so the only source of NS-table / lump bytes is the boot image.
    sim.memory.fill(0);

    // loadBootImage takes an ArrayBuffer-like; pass a fresh ArrayBuffer copy.
    const ab = imgBuf.buffer.slice(
        imgBuf.byteOffset,
        imgBuf.byteOffset + imgBuf.byteLength
    );
    const loaded = sim.loadBootImage(ab);

    // Drive the boot state machine to completion. _bootStep() returns false
    // when bootComplete or halted; cap iterations defensively.
    const MAX_STEPS = 64;
    let iters = 0;
    const stepSnapshots = [];
    while (iters < MAX_STEPS && !sim.bootComplete && !sim.halted) {
        const bootStepBefore = sim.bootStep | 0;
        const outputBefore   = sim.output || '';
        const advanced = sim._bootStep();
        iters++;
        stepSnapshots.push({
            iteration:      iters,
            bootStepBefore: bootStepBefore,
            bootStepAfter:  sim.bootStep | 0,
            outputDelta:    (sim.output || '').slice(outputBefore.length),
        });
        if (!advanced) break;
    }

    const crSnap = (i) => {
        const c = sim.cr[i];
        if (!c) return null;
        return {
            word0: c.word0 >>> 0,
            word1: c.word1 >>> 0,
            word2: c.word2 >>> 0,
            word3: c.word3 >>> 0,
            m: c.m | 0,
        };
    };

    const status = {
        loaded: loaded === true,
        bootComplete: sim.bootComplete === true,
        halted: sim.halted === true,
        bootStep: sim.bootStep | 0,
        iterations: iters,
        nsCount: sim.nsCount | 0,
        memoryWords: sim.memory.length | 0,
        nsTableBase: sim.NS_TABLE_BASE | 0,
        pc: sim.pc | 0,
        sto: sim.sto | 0,
        mElevation: sim.mElevation === true,
        ledBits: sim.ledBits | 0,
        faultLog: (sim.faultLog || []).map((f) => ({
            type: f.type, message: f.message, pc: f.pc, step: f.step,
        })),
        callStackDepth: (sim.callStack || []).length,
        sentinelOnTop:
            (sim.callStack && sim.callStack.length > 0)
                ? sim.callStack[sim.callStack.length - 1].sentinel === true
                : false,
        cr6: crSnap(6),
        cr12: crSnap(12),
        cr14: crSnap(14),
        cr15: crSnap(15),
        auditLog: (sim.auditLog || []).map((e) => ({
            gate:   e.gate,
            label:  e.label,
            nsIndex: e.nsIndex != null ? e.nsIndex : null,
            result: e.result,
            checks: e.checks || null,
            bootStepName: e.bootStepName || null,
        })),
        pipelineOutput: typeof sim._auditPipeline === 'function'
            ? sim._auditPipeline()
            : [],
        consoleOutput: sim.output || '',
        stepSnapshots: stepSnapshots,
    };
    process.stdout.write(JSON.stringify(status));
});
