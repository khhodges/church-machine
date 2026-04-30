// Headless harness used by tests/gates/test_cr14_first_activation.py.
//
// Verifies that CHANGE CR14 / CR15 first-activation synthesises a valid
// R+X Golden Token instead of writing the raw thread-lump header word
// (magic + cc + cw) into the code register.
//
// Two phases:
//   Phase 1 — CHANGE CR14 first-activation
//     Inject a CHANGE CR14 instruction (crSrc=12, imm=TARGET_IDX) at PC=0
//     in the boot code lump.  Execute step().  Assert no fault fires and
//     that CR14.word0 is an R+X GT (not the raw lump header word).
//
//   Phase 2 — instruction fetch from the switched-in thread
//     After the CHANGE, the CPU is in thread slot TARGET_IDX at PC=0.
//     CR14 now covers NS slot TARGET_IDX's lump.  Write a cond=Never (NV)
//     placeholder at fetchAddr = cr14.word1 + 1 + 0 (the fetch address for
//     PC=0 in the new thread) and call step() once more.  The critical
//     check is _fetchInstruction's mLoad(cr14GT, 'X', 14, fetchAddr): if
//     the synthesised GT had the wrong gt_seq the VERSION fault would fire
//     here.  Assert no VERSION or BOUNDS fault fires on this second step.
//
// Stdout: single JSON object

'use strict';

global.window = { bootConfig: {} };

const { bootSim } = require('./sim_helpers');

const sim = bootSim();

if (!sim.bootComplete) {
    process.stdout.write(JSON.stringify({ error: 'boot did not complete' }) + '\n');
    process.exit(0);
}

// Locate the code-lump base from CR14 so we can inject the instruction.
// _fetchInstruction computes: fetchAddr = cr14.word1 + 1 + pc
// For PC=0 that is cr14.word1 + 1.
const cr14Boot = sim.cr[14];
if (!cr14Boot || !cr14Boot.word1) {
    process.stdout.write(JSON.stringify({ error: 'CR14 unavailable after boot' }) + '\n');
    process.exit(0);
}
const codeBase = cr14Boot.word1;

// Target NS slot for the CHANGE.  Slot 1 is Boot.Thread (always present).
// _currentThreadSlot is null before any CHANGE, so _threadContextMap has
// no entry for slot 1 yet → guaranteed first-activation path.
const TARGET_IDX = 1;

// Retrieve the target NS entry to read the raw lump header word (for
// comparison in the assertion).
const entry = sim.readNSEntry(TARGET_IDX);
if (!entry) {
    process.stdout.write(JSON.stringify({ error: `NS entry ${TARGET_IDX} not found` }) + '\n');
    process.exit(0);
}
const rawLumpHeader = sim.memory[entry.word0_location] >>> 0;

// ── Phase 1: CHANGE CR14 first-activation ────────────────────────────────
// Encode:  CHANGE (opcode=4), cond=0xE (AL), crDst=14, crSrc=12, imm=TARGET_IDX
const changeInstr = sim.encodeInstruction(4, 0xE, 14, 12, TARGET_IDX);
// Write at the physical address the CPU will fetch for PC=0.
sim.memory[codeBase + 1] = changeInstr >>> 0;

sim.pc = 0;
sim.halted = false;
const faultsBefore1 = sim.faultLog ? sim.faultLog.length : 0;
sim.step();
const newFaults1 = sim.faultLog ? sim.faultLog.slice(faultsBefore1) : [];

const cr14After = sim.cr[14];
const cr14Word0 = cr14After ? (cr14After.word0 >>> 0) : null;

let parsedR = false;
let parsedX = false;
if (cr14Word0 !== null) {
    const p = sim.parseGT(cr14Word0);
    parsedR = !!(p && p.permissions && p.permissions['R']);
    parsedX = !!(p && p.permissions && p.permissions['X']);
}

// ── Phase 2: instruction fetch from the switched-in thread ───────────────
// After the CHANGE, PC=0 and CR14 now covers entry.word0_location.
// The fetch address for PC=0 is cr14.word1 + 1 + 0 = entry.word0_location + 1.
// Write a cond=NV (Never) NOP so the decode stage silently skips; we only
// care that _fetchInstruction's mLoad(cr14GT, 'X', 14, fetchAddr) succeeds.
let phase2Faulted = null;
let phase2FaultCode = null;
let phase2FaultMsg  = null;

if (newFaults1.length === 0 && cr14After && cr14After.word1 !== undefined) {
    const fetchAddr = (cr14After.word1 + 1 + 0) >>> 0;
    if (fetchAddr < sim.memory.length) {
        // cond=NV (0xF) ensures the instruction is a legal no-op regardless
        // of opcode — the decode fence runs but execution is skipped.
        const nvNop = sim.encodeInstruction(0, 0xF, 0, 0, 0);
        sim.memory[fetchAddr] = nvNop >>> 0;
    }

    // sim is now in slot TARGET_IDX at PC=0.  Call step().
    sim.halted = false;
    const faultsBefore2 = sim.faultLog ? sim.faultLog.length : 0;
    sim.step();
    const newFaults2 = sim.faultLog ? sim.faultLog.slice(faultsBefore2) : [];
    // Filter to faults that fire during the fetch/decode phase (VERSION, BOUNDS, NULL_CAP).
    // We exclude PRIV_REG because the NV instruction still passes the decode fence
    // even when it targets a non-privileged register.
    phase2Faulted    = newFaults2.length > 0;
    phase2FaultCode  = newFaults2.length ? newFaults2[0].type    : null;
    phase2FaultMsg   = newFaults2.length ? newFaults2[0].message : null;
}

process.stdout.write(JSON.stringify({
    // Phase 1 results
    faulted:      newFaults1.length > 0,
    faultCode:    newFaults1.length ? newFaults1[0].type    : null,
    faultMsg:     newFaults1.length ? newFaults1[0].message : null,
    cr14Word0Hex: cr14Word0 !== null ? ('0x' + cr14Word0.toString(16).padStart(8, '0')) : null,
    rawLumpHeaderHex: '0x' + rawLumpHeader.toString(16).padStart(8, '0'),
    cr14IsRX:     parsedR && parsedX,
    cr14HasR:     parsedR,
    cr14HasX:     parsedX,
    cr14NotLumpHeader: cr14Word0 !== rawLumpHeader,
    // Phase 2 results (instruction fetch from switched-in thread)
    phase2Faulted,
    phase2FaultCode,
    phase2FaultMsg,
    phase2VersionOrBoundsFault: phase2FaultCode === 'VERSION' || phase2FaultCode === 'BOUNDS' || phase2FaultCode === 'NULL_CAP',
}) + '\n');
