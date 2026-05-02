// Harness used by tests/boot/test_boot_abstr_exec.py.
//
// Reads a JSON envelope from stdin:
//   { "config": {...}, "imageBase64": "<base64>", "skipWindow": false }
//
// This harness exercises the 3-instruction Boot.Abstr program that runs
// after the boot state machine (B:00–B:08) completes:
//
//   [0] CHANGE AL, CR12, CR12, #1   — switch to Boot.Thread (RESTORE_CALL)
//   [1] TPERM  AL, CR0,  #E         — restrict CR0 to E-permission only
//   [2] CALL   AL, CR0,  CR0        — enter configured first abstraction
//
// Design note: CHANGE CR12 (system-wide path) normally requires S-perm on the
// source capability register.  For the self-referential boot-ROM pattern
// (crSrc=crDst=12) on first activation, the simulator's isFirstActivation
// bypass handles S-perm naturally — no test-fixture state manipulation needed.
// The harness calls step() directly with no preconditions on mElevation.
//
// Output (single JSON line on stdout):
//   loaded, bootComplete, bootFaults,
//   threadCaps0 (raw GT word at thread[+244] after boot),
//   changeStep  { faulted, cr0After, descContainsRestoreCall },
//   tpermStep   { cr0After, eOnly, hasEPerm },
//   callStep    { callEnteredClean, callDepthDelta, pcAfterCall, newFaults },
//   allFaults

'use strict';

const THREAD_CAPS_OFFSET = 244;  // mirrors simulator.js constant

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
    const env = JSON.parse(raw);
    const cfg = env.config || null;
    const imgBuf = Buffer.from(env.imageBase64 || '', 'base64');

    if (env.skipWindow) {
        // Leave global.window undefined.
    } else {
        global.window = { bootConfig: cfg || {} };
    }

    const ChurchSimulator = require('../../simulator/simulator.js');
    const sim = new ChurchSimulator();
    sim.memory.fill(0);

    const ab = imgBuf.buffer.slice(
        imgBuf.byteOffset,
        imgBuf.byteOffset + imgBuf.byteLength
    );
    const loaded = sim.loadBootImage(ab);

    // ── Phase 1: drive the boot state machine to completion ──────────────────
    const MAX_BOOT_STEPS = 64;
    let bootIters = 0;
    while (bootIters < MAX_BOOT_STEPS && !sim.bootComplete && !sim.halted) {
        const advanced = sim._bootStep();
        bootIters++;
        if (!advanced) break;
    }

    const bootFaults = (sim.faultLog || []).map((f) => ({
        type: f.type, message: f.message, pc: f.pc, step: f.step,
    }));
    const callDepthAfterBoot = (sim.callStack || []).length;

    // ── Helpers ───────────────────────────────────────────────────────────────

    const crSnap = (i) => {
        const c = sim.cr[i];
        if (!c) return null;
        return { word0: c.word0 >>> 0, word1: c.word1 >>> 0,
                 word2: c.word2 >>> 0, word3: c.word3 >>> 0, m: c.m | 0 };
    };

    // Parse permission bits from a GT word0.
    // Layout: permBits = (gt32 >>> 25) & 0x7F
    //   bit6=B  bit5=E  bit4=S  bit3=L  bit2=X  bit1=W  bit0=R
    const parsePerms = (word0) => {
        const p = (word0 >>> 25) & 0x7F;
        return { B:(p>>>6)&1, E:(p>>>5)&1, S:(p>>>4)&1,
                 L:(p>>>3)&1, X:(p>>>2)&1, W:(p>>>1)&1, R:(p>>>0)&1 };
    };

    const isEOnly = (word0) => {
        if (!word0) return false;
        const p = parsePerms(word0);
        return p.E === 1 && p.R === 0 && p.W === 0 && p.X === 0 &&
               p.L === 0 && p.S === 0 && p.B === 0;
    };

    const drainNewFaults = (countBefore) =>
        (sim.faultLog || []).slice(countBefore).map((f) => ({
            type: f.type, message: f.message, pc: f.pc, step: f.step,
        }));

    // ── Read thread[+244] (CR0 home slot, auto-installed by B:05) ────────────
    // CR12.word1 is the physical base address of the Boot.Thread lump.
    const threadBase = (sim.cr[12] && sim.cr[12].word1) || 0;
    const threadCaps0Word = (threadBase > 0)
        ? (sim.memory[threadBase + THREAD_CAPS_OFFSET] >>> 0)
        : 0;

    // ── Phase 2a: Step 0 — CHANGE AL, CR12, CR12, #1 ─────────────────────────
    // No preconditions needed: the simulator's isFirstActivation bypass handles
    // the S-perm gate for the self-referential boot-ROM pattern (crSrc=crDst=12,
    // no prior thread context saved).  CHANGE then performs RESTORE_CALL, loading
    // CR0–CR11 from the Boot.Thread caps zone (thread[+244..+255]).
    let changeStep;
    {
        const faultsBefore = (sim.faultLog || []).length;
        const r = sim.step();
        // Clear stale M-bits from the boot phase so CALL's _mwinWriteback() does not fire.
        sim._resetAllMBits();
        const newFaults = drainNewFaults(faultsBefore);
        changeStep = {
            faulted:                newFaults.length > 0 || sim.halted,
            newFaults:              newFaults,
            cr0After:               crSnap(0),
            halted:                 sim.halted === true,
            descContainsRestoreCall: r && typeof r.desc === 'string'
                                        && r.desc.includes('RESTORE_CALL'),
            result:                 r ? { pc: r.pc, desc: r.desc || null } : null,
        };
    }

    // ── Phase 2b: Step 1 — TPERM AL, CR0, #E ─────────────────────────────────
    let tpermStep;
    {
        const faultsBefore = (sim.faultLog || []).length;
        const r = sim.step();
        const newFaults = drainNewFaults(faultsBefore);
        const cr0w  = crSnap(0);
        tpermStep = {
            cr0After:    cr0w,
            hasEPerm:    cr0w !== null && parsePerms(cr0w.word0).E === 1,
            eOnly:       cr0w !== null && isEOnly(cr0w.word0),
            newFaults:   newFaults,
            halted:      sim.halted === true,
            result:      r ? { pc: r.pc, desc: r.desc || null } : null,
        };
    }

    // ── Phase 2c: Step 2 — CALL AL, CR0, CR0 ─────────────────────────────────
    let callStep;
    {
        const faultsBefore = (sim.faultLog || []).length;
        const r = sim.step();
        const newFaults = drainNewFaults(faultsBefore);
        const depthAfter = (sim.callStack || []).length;
        callStep = {
            newFaults:        newFaults,
            halted:           sim.halted === true,
            callDepthDelta:   depthAfter - callDepthAfterBoot,
            pcAfterCall:      sim.pc | 0,
            callEnteredClean: newFaults.length === 0 &&
                              !sim.halted &&
                              depthAfter === callDepthAfterBoot + 1 &&
                              (sim.pc | 0) === 1,
            result:           r ? { pc: r.pc, desc: r.desc || null } : null,
        };
    }

    const status = {
        loaded:              loaded === true,
        bootComplete:        sim.bootComplete === true,
        bootFaults:          bootFaults,
        bootEntrySlot:       sim.bootEntrySlot | 0,
        callDepthAfterBoot:  callDepthAfterBoot,

        // thread[+244] — boot-entry E-GT auto-installed by B:05 INIT_ABSTR
        threadBase:          threadBase | 0,
        threadCaps0:         threadCaps0Word | 0,
        threadCaps0HasEPerm: parsePerms(threadCaps0Word).E === 1,
        threadCaps0NSIndex:  threadCaps0Word & 0xFFFF,

        changeStep:  changeStep,
        tpermStep:   tpermStep,
        callStep:    callStep,

        allFaults: (sim.faultLog || []).map((f) => ({
            type: f.type, message: f.message, pc: f.pc, step: f.step,
        })),
        consoleOutput: (sim.output || '').slice(0, 4096),
    };

    process.stdout.write(JSON.stringify(status));
});
