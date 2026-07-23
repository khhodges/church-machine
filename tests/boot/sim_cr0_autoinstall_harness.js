// Harness for test_boot_cr0_autoinstall.py (Tasks #661, #663, #665).
//
// Exercises three branches of the B:05 CR0 auto-install guard:
//
//   Default mode  (sentinelValue absent / 0, nullifyThreadNSEntry absent):
//     Zeros memory[threadLoc + THREAD_CAPS_OFFSET] before running B:05 so the
//     guard fires and writes the boot-entry E-GT.
//
//   Sentinel mode  (sentinelValue non-zero):
//     Writes a caller-supplied non-zero value into the CR0 slot before B:05 so
//     the guard's "already populated" branch is taken and the slot is left
//     unchanged.  Used by Task #663 to verify the skip path.
//
//   Nullify mode  (nullifyThreadNSEntry: true):
//     Blanks NS slot 1 (Boot.Thread) in the namespace table so that
//     readNSEntry(1) returns null before B:05 runs.  Verifies that B:05
//     silently skips the CR0 write without faulting (Task #665).
//
// Input (stdin, JSON):
//   {
//     "config":                { ... boot config ... },
//     "imageBase64":           "<base64 raw LE binary>",
//     "skipWindow":            false,
//     "sentinelValue":         0,    // optional — non-zero activates sentinel mode
//     "nullifyThreadNSEntry":  false // optional — true activates nullify mode
//   }
//
// Protocol:
//   1. Load the boot image exactly as sim_boot_loader.js does.
//   2. Run _bootStep() until sim.bootStep === 5  (B:05 not yet executed).
//   3. Read threadLoc from readNSEntry(1).word0_location.
//   4a. Default mode:  zero memory[threadLoc + THREAD_CAPS_OFFSET].
//   4b. Sentinel mode: write sentinelValue into that slot.
//   4c. Nullify mode:  blank all four words of NS slot 1 so readNSEntry(1)
//       returns null; cr0Addr is preserved from step 3 for result checking.
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
    const sentinelValue = (env.sentinelValue !== undefined && env.sentinelValue !== null)
        ? (env.sentinelValue >>> 0)
        : 0;
    const sentinelMode  = sentinelValue !== 0;
    const nullifyMode   = !!env.nullifyThreadNSEntry;

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

    // ── Phase 2: locate CR0 home slot and set it up ──────────────────────────
    const threadEntry = sim.readNSEntry(1);   // NS slot 1 = Boot.Thread
    const threadLoc   = threadEntry ? (threadEntry.word0_location >>> 0) : null;
    const cr0Addr     = threadLoc !== null ? threadLoc + THREAD_CAPS_OFFSET : null;
    const valueBeforeWrite = (cr0Addr !== null) ? (sim.memory[cr0Addr] >>> 0) : null;

    let nullified = false;
    if (nullifyMode) {
        // Blank NS slot 1 so readNSEntry(1) returns null when B:05 runs.
        // We keep cr0Addr derived above so we can assert CR0 was not written.
        const ns1Base = sim._nsSlotBase(1);
        sim.memory[ns1Base + 0] = 0;
        sim.memory[ns1Base + 1] = 0;
        sim.memory[ns1Base + 2] = 0;
        sim.memory[ns1Base + 3] = 0;
        nullified = sim.readNSEntry(1) === null;
    } else if (cr0Addr !== null) {
        sim.memory[cr0Addr] = sentinelMode ? sentinelValue : 0;
    }

    const zeroed          = (!sentinelMode && !nullifyMode && cr0Addr !== null) ? (sim.memory[cr0Addr] >>> 0) === 0 : false;
    const sentinelWritten = (sentinelMode && !nullifyMode && cr0Addr !== null)
        ? (sim.memory[cr0Addr] >>> 0) === sentinelValue
        : false;

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
        valueBeforeWrite:    valueBeforeWrite,
        zeroed:              zeroed,
        sentinelValue:       sentinelValue,
        sentinelWritten:     sentinelWritten,
        nullified:           nullified,
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
