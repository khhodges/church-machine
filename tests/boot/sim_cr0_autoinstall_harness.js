// Harness for test_boot_cr0_autoinstall.py (Task #661).
//
// Exercises the B:05 auto-install path that writes the boot-entry E-GT into
// the thread lump's CR0 home slot (offset +244) when that slot is zero.
//
// Input (stdin, JSON):
//   {
//     "config":      { ... boot config ... },
//     "imageBase64": "<base64 raw LE binary>",
//     "skipWindow":  false
//   }
//
// Protocol:
//   1. Load the boot image exactly as sim_boot_loader.js does.
//   2. Run _bootStep() until sim.bootStep === 5  (B:05 not yet executed).
//   3. Read threadLoc from readNSEntry(1).word0_location.
//   4. Zero memory[threadLoc + THREAD_CAPS_OFFSET] to simulate an empty CR0.
//   5. Run one more _bootStep()  (executes B:05).
//   6. Report the CR0 home value, the expected GT, bootEntrySlot, faultLog, …

const THREAD_CAPS_OFFSET = 244;

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
    const env = JSON.parse(raw);
    const cfg = env.config || null;
    const imgBuf = Buffer.from(env.imageBase64 || '', 'base64');

    if (env.skipWindow) {
        // no global.window — simulator uses historical 65536-word default
    } else {
        global.window = { bootConfig: cfg || {} };
    }

    const ChurchSimulator = require('../../simulator/simulator.js');
    const sim = new ChurchSimulator();

    // Wipe memory so every byte comes from the boot image.
    sim.memory.fill(0);

    const ab = imgBuf.buffer.slice(
        imgBuf.byteOffset,
        imgBuf.byteOffset + imgBuf.byteLength
    );
    const loaded = sim.loadBootImage(ab);

    // ── Phase 1: run boot steps up to (but NOT including) B:05 ──────────────
    // B:05 is case 5; the step counter becomes 5 after B:04 finishes.
    const MAX_PRE = 32;
    let preIters = 0;
    while (preIters < MAX_PRE && sim.bootStep < 5 && !sim.bootComplete && !sim.halted) {
        sim._bootStep();
        preIters++;
    }

    const bootStepBeforeB05 = sim.bootStep | 0;

    // ── Phase 2: locate CR0 home slot and zero it ────────────────────────────
    const threadEntry = sim.readNSEntry(1);   // NS slot 1 = Boot.Thread
    const threadLoc   = threadEntry ? (threadEntry.word0_location >>> 0) : null;
    const cr0Addr     = threadLoc !== null ? threadLoc + THREAD_CAPS_OFFSET : null;
    const valueBeforeZero = (cr0Addr !== null) ? (sim.memory[cr0Addr] >>> 0) : null;

    if (cr0Addr !== null) {
        sim.memory[cr0Addr] = 0;   // simulate never-installed CR0
    }

    const zeroed = (cr0Addr !== null) ? (sim.memory[cr0Addr] >>> 0) === 0 : false;

    // ── Phase 3: run B:05 ───────────────────────────────────────────────────
    const outputBefore = sim.output || '';
    const b05Returned  = (sim.bootStep === 5 && !sim.bootComplete && !sim.halted)
        ? sim._bootStep()
        : null;
    const bootStepAfterB05 = sim.bootStep | 0;

    // ── Phase 4: collect results ─────────────────────────────────────────────
    const cr0HomeValue   = (cr0Addr !== null) ? (sim.memory[cr0Addr] >>> 0) : null;
    const expectedGT     = sim.createGT(0, sim.bootEntrySlot, {E:1}, 1) >>> 0;
    const outputDelta    = (sim.output || '').slice(outputBefore.length);
    const autoInstallMsg = outputDelta.includes('CR0 home') && outputDelta.includes('auto-installed');

    const status = {
        loaded:              loaded === true,
        bootStepBeforeB05:   bootStepBeforeB05,
        bootStepAfterB05:    bootStepAfterB05,
        threadLoc:           threadLoc,
        cr0Addr:             cr0Addr,
        valueBeforeZero:     valueBeforeZero,
        zeroed:              zeroed,
        b05Returned:         b05Returned,
        cr0HomeValue:        cr0HomeValue,
        expectedGT:          expectedGT,
        bootEntrySlot:       sim.bootEntrySlot | 0,
        autoInstallLogged:   autoInstallMsg,
        faultLog: (sim.faultLog || []).map((f) => ({
            type: f.type, message: f.message, pc: f.pc, step: f.step,
        })),
        halted:       sim.halted === true,
        bootComplete: sim.bootComplete === true,
        b05OutputDelta: outputDelta,
    };

    process.stdout.write(JSON.stringify(status));
});
