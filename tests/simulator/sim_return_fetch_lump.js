// sim_return_fetch_lump.js — Confirm instruction fetch stays on the correct
// caller lump after RETURN in step-by-step simulation.
//
// Hardware reference:
//   hardware/call.py — after RETURN, a cload fires that restores CR14 (the
//   caller's code capability) from the call-frame NS entry.  Without the
//   simulator equivalent, _fetchInstruction computes physicalPC from the
//   callee's CR14.word1 (lump base), silently fetching from the wrong lump.
//
// What is being tested
// --------------------
// After CALL, CR14 is overwritten with the callee's RX code capability.
// _execReturn() restores CR0–CR11 from the saved frame, but it must ALSO
// restore CR14 so that the next _fetchInstruction() uses
//   caller's CR14.word1 + 1 + returnPC
// rather than
//   callee's CR14.word1 + 1 + returnPC   (wrong lump!)
//
// Test structure
// --------------
// Each phase:
//   1. Places a CALL instruction in caller lump body at PC=0.
//   2. Places a RETURN instruction in callee lump body at PC=1
//      (because _execCall sets PC=1 for methodIndex=0).
//   3. Places a distinctive sentinel word at caller lump PC=1 (returnPC).
//   4. Calls sim.step() three times:
//        step1 → CALL  (enters callee, CR14 updated to callee's cap)
//        step2 → RETURN (comes back to caller, CR14 MUST be restored)
//        step3 → fetch from caller lump; physicalPC must equal caller's slot
//   5. Asserts step3.physicalPC is inside the caller's lump and NOT the
//      callee's lump.
//
// Phase 1: lump-header CALL path (cc>0)
//   Callee has a valid lump header with cc>0 so _execCall takes the
//   hasLumpHeader branch and sets CR14 to callee RX GT.
//
// Phase 2: non-lump-header CALL path (cc=0)
//   Callee (CALLEE_CC0_SLOT) has cc=0; memory[callee_base] is an RX GT
//   pointing to a separate CODE_SLOT.  _execCall's non-lump-header branch
//   reads clist[0] and sets CR14 to CODE_SLOT's RX cap, so CR14.word1
//   diverges from the caller's and the fetch-after-return bug is observable.
//
// Instruction encoding:
//   CALL   opcode=2  cond=14(AL)  crDst=0  crSrc=0  imm=0
//   RETURN opcode=3  cond=14(AL)  crDst=0  crSrc=0  imm=0
//   SENTINEL: opcode=3 cond=0(EQ) crDst=0 crSrc=0 imm=0  → RETURN EQ
//             skipped when Z=false (which it is after RETURN restores
//             savedFlags that had Z=false at CALL time).
//             physicalPC is still captured by _fetchInstruction before the
//             condition check, so result.physicalPC is the meaningful value.
//
// Run:  node tests/simulator/sim_return_fetch_lump.js

'use strict';

global.window = {};   // silence any bootConfig references in the constructor

const ChurchSimulator = require('../../simulator/simulator.js');

function writeTestNsEntry(sim, ...args) {
    const bootComplete = sim.bootComplete;
    sim.bootComplete = false;
    try {
        return sim.writeNSEntry(...args);
    } finally {
        sim.bootComplete = bootComplete;
    }
}

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
        failed++;
    }
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function makeSim() {
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    if (!sim.cr) sim.cr = new Array(16).fill(null);
    for (let i = 0; i < 16; i++) {
        if (!sim.cr[i]) {
            sim.cr[i] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
        }
    }
    // CR12.word1=0 → skip thread-stack writes in _execCall/_execReturn
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    // CR15.m=0 → _mwinWriteback is a no-op
    sim.cr[15] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    // Z=false so the RETURN EQ sentinel is skipped on step3
    sim.flags = { Z: false, N: false, C: false, V: false };
    return sim;
}

// Write a minimal 64-word lump header at memory[base] (cc, cw in header).
function writeLumpHdr(sim, base, cc, cw) {
    // lumpSizePow2=6 (64 words) so n_minus_6=0 → lumpSize field = 0b11111 (0x1F)
    const hdr = ((0x1F << 27) | (0 << 23) | (cw << 10) | cc) >>> 0;
    sim.memory[base] = hdr;
}

// Intercept faults so phases can assert no faults fired.
function installFaultCapture(sim) {
    const faults = [];
    const origFault = sim.fault.bind(sim);
    sim.fault = (type, msg) => { faults.push({ type, message: msg }); origFault(type, msg); };
    return faults;
}

// ── PHASE 1: lump-header CALL path (cc>0) ─────────────────────────────────────
//
// Memory layout:
//   CALLER_BASE+0  lump header (cc=2, cw=4)
//   CALLER_BASE+1  CALL AL CR0 (PC=0 in caller)
//   CALLER_BASE+2  RETURN EQ sentinel (PC=1 in caller = returnPC after CALL)
//
//   CALLEE_BASE+0  lump header (cc=2, cw=4)
//   CALLEE_BASE+1  (c-list area — not the RETURN location)
//   CALLEE_BASE+2  RETURN AL (PC=1 in callee; _execCall sets PC=1 for imm=0)
//
// Step trace:
//   step1 (PC=0, fetch=CALLER_BASE+1): CALL → callee PC=1, CR14=callee RX GT
//   step2 (PC=1, fetch=CALLEE_BASE+2): RETURN → caller PC=1, CR14 restored to caller RX GT
//   step3 (PC=1, fetch=CALLER_BASE+2): RETURN EQ skipped (Z=false); physicalPC=CALLER_BASE+2
//
console.log('\n--- PHASE 1: lump-header CALL path (cc>0) ---');
{
    const CALLER_SLOT = 5;
    const CALLER_BASE = 0x0400;
    const CALLER_CC   = 2;
    const CALLER_CW   = 4;

    const CALLEE_SLOT = 12;
    const CALLEE_BASE = 0x0600;
    const CALLEE_CC   = 2;
    const CALLEE_CW   = 4;

    // Encoding:
    //   CALL   = (2<<27)|(14<<23) = 0x10700000
    //   RETURN = (3<<27)|(14<<23) = 0x18700000
    //   SENTINEL (RETURN EQ) = (3<<27)|(0<<23) = 0x18000000
    const sim = makeSim();
    const faults = installFaultCapture(sim);

    const CALL_WORD     = sim.encodeInstruction(2, 14, 0, 0, 0);  // CALL AL CR0
    const RETURN_WORD   = sim.encodeInstruction(3, 14, 0, 0, 0);  // RETURN AL
    const SENTINEL_WORD = sim.encodeInstruction(3,  0, 0, 0, 0);  // RETURN EQ (sentinel, skipped)

    // Caller lump
    writeLumpHdr(sim, CALLER_BASE, CALLER_CC, CALLER_CW);
    sim.memory[CALLER_BASE + 1] = CALL_WORD;      // PC=0 → caller's first instruction
    sim.memory[CALLER_BASE + 2] = SENTINEL_WORD;  // PC=1 → returnPC landing spot

    // Callee lump
    writeLumpHdr(sim, CALLEE_BASE, CALLEE_CC, CALLEE_CW);
    sim.memory[CALLEE_BASE + 2] = RETURN_WORD;    // PC=1 → callee's first instruction after CALL

    // Confirm distinct sentinel is not accidentally in callee
    assert('P1-SETUP: SENTINEL_WORD differs from RETURN_WORD',
        SENTINEL_WORD !== RETURN_WORD,
        `sentinel=0x${SENTINEL_WORD.toString(16)} return=0x${RETURN_WORD.toString(16)}`);

    // NS entries
    writeTestNsEntry(sim, CALLER_SLOT, CALLER_BASE, 63, 0, 0, 1, 0, CALLER_CC, 0);
    writeTestNsEntry(sim, CALLEE_SLOT, CALLEE_BASE, 63, 0, 0, 1, 0, CALLEE_CC, 0);

    // CR14 = caller's RX code cap
    const callerRXGT = sim.createGT(0, CALLER_SLOT, {R:1, X:1}, 1);
    sim.cr[14] = { word0: callerRXGT, word1: CALLER_BASE, word2: 63, word3: 0, m: 0 };

    // CR0 = callee's E-GT (CALL target)
    const calleeEGT = sim.createGT(0, CALLEE_SLOT, {E:1}, 1);
    sim.cr[0] = { word0: calleeEGT, word1: 0, word2: 0, word3: 0, m: 0 };

    sim.pc = 0;

    // ── step1: should execute CALL ─────────────────────────────────────────────
    const step1 = sim.step();

    assert('P1-STEP1-NO-FAULT: CALL executed without fault',
        step1 !== null && faults.length === 0,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'step1 was null');

    if (step1 !== null) {
        assert('P1-STEP1-OPCODE: step1 dispatched opcode=2 (CALL)',
            step1.instr && step1.instr.opcode === 2,
            `opcode=${step1.instr && step1.instr.opcode}`);

        // After CALL, CR14 must be the callee's cap
        const calleeCR14w0 = sim.cr[14].word0 >>> 0;
        assert('P1-CALL-CR14-CALLEE: after CALL, CR14 slot_id = callee slot',
            (calleeCR14w0 & 0xFFFF) === CALLEE_SLOT,
            `slot_id=${calleeCR14w0 & 0xFFFF}, expected CALLEE_SLOT=${CALLEE_SLOT}`);

        assert('P1-CALL-CR14-DIFFERS: callee CR14 differs from caller CR14',
            calleeCR14w0 !== (callerRXGT >>> 0),
            `both=0x${calleeCR14w0.toString(16)} (must differ)`);

        faults.length = 0;

        // ── step2: should execute RETURN from callee ───────────────────────────
        //   fetch from CALLEE_BASE+1+1 = CALLEE_BASE+2 (PC=1 in callee)
        const expectedCalleePC = CALLEE_BASE + 2;
        assert('P1-STEP2-SETUP: RETURN_WORD at expected callee fetch address',
            sim.memory[expectedCalleePC] === RETURN_WORD,
            `mem[0x${expectedCalleePC.toString(16)}]=0x${(sim.memory[expectedCalleePC]||0).toString(16)}, expected 0x${RETURN_WORD.toString(16)}`);

        const step2 = sim.step();

        assert('P1-STEP2-NO-FAULT: RETURN executed without fault',
            step2 !== null && faults.length === 0,
            faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'step2 was null');

        if (step2 !== null) {
            assert('P1-STEP2-OPCODE: step2 dispatched opcode=3 (RETURN)',
                step2.instr && step2.instr.opcode === 3,
                `opcode=${step2.instr && step2.instr.opcode}`);

            assert('P1-STEP2-PC: after RETURN, PC = returnPC (1)',
                sim.pc === 1,
                `sim.pc=${sim.pc}, expected 1`);

            // CR14 must be restored to caller's cap
            const afterReturnCR14w0 = sim.cr[14].word0 >>> 0;
            assert('P1-CR14-RESTORED-SLOT: after RETURN, CR14 slot_id = caller slot',
                (afterReturnCR14w0 & 0xFFFF) === CALLER_SLOT,
                `slot_id=${afterReturnCR14w0 & 0xFFFF}, expected CALLER_SLOT=${CALLER_SLOT}`);

            assert('P1-CR14-RESTORED-WORD1: after RETURN, CR14.word1 = caller lump base',
                sim.cr[14].word1 === CALLER_BASE,
                `CR14.word1=0x${sim.cr[14].word1.toString(16)}, expected CALLER_BASE=0x${CALLER_BASE.toString(16)}`);

            faults.length = 0;

            // ── step3: fetch must come from caller lump, not callee lump ──────
            const expectedCallerFetch = CALLER_BASE + 2;  // CALLER_BASE + 1 + returnPC(1)
            const wrongCalleeFetch    = CALLEE_BASE + 2;  // what the bug would produce

            assert('P1-STEP3-SETUP: SENTINEL_WORD at expected caller fetch address',
                sim.memory[expectedCallerFetch] === SENTINEL_WORD,
                `mem[0x${expectedCallerFetch.toString(16)}]=0x${(sim.memory[expectedCallerFetch]||0).toString(16)}, expected SENTINEL=0x${SENTINEL_WORD.toString(16)}`);

            const step3 = sim.step();

            assert('P1-STEP3-NO-FAULT: third step executed without fault',
                step3 !== null && faults.length === 0,
                faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'step3 was null');

            if (step3 !== null) {
                const physPC = step3.physicalPC;

                assert('P1-FETCH-CALLER: step3 fetched from caller\'s lump (physicalPC = CALLER_BASE+2)',
                    physPC === expectedCallerFetch,
                    `physicalPC=0x${physPC.toString(16)}, expected CALLER_BASE+2=0x${expectedCallerFetch.toString(16)}`);

                assert('P1-NOT-CALLEE: step3 did NOT fetch from callee\'s lump (physicalPC ≠ CALLEE_BASE+2)',
                    physPC !== wrongCalleeFetch,
                    `physicalPC=0x${physPC.toString(16)} must ≠ CALLEE_BASE+2=0x${wrongCalleeFetch.toString(16)}`);
            }
        }
    }
}

// ── PHASE 2: non-lump-header CALL path (cc=0) ─────────────────────────────────
//
// A cc=0 callee means the lump header has cc=0 (no embedded c-list), so
// _execCall takes the non-lump-header else branch.  That branch reads
// memory[nsEntry.word0_location] as a GT word and, if it carries X-perm,
// sets CR14 to the matching RX code cap — pointing to a THIRD NS slot
// (CALLEE_CODE_SLOT).  This diverges CR14.word1 from the caller's lump base,
// making the fetch-after-RETURN bug observable in exactly the same way.
//
// Memory layout:
//   CALLER2_BASE+0  lump header (cc=2, cw=4)
//   CALLER2_BASE+1  CALL AL CR0
//   CALLER2_BASE+2  RETURN EQ sentinel
//
//   CALLEE_CC0_BASE+0  RX GT for CALLEE_CODE_SLOT (used by _execCall as clist[0])
//                      NOT a valid lump header — hasLumpHeader = false
//   (rest of CALLEE_CC0 slot unused)
//
//   CALLEE_CODE_BASE+0  lump header (cc=0, cw=4) — body of the cc=0 callee
//   CALLEE_CODE_BASE+2  RETURN AL (callee code PC=1 → fetch=CODE_BASE+2)
//
// Step trace:
//   step1 (PC=0, fetch=CALLER2_BASE+1): CALL → callee_code PC=1, CR14=CALLEE_CODE RX GT
//   step2 (PC=1, fetch=CALLEE_CODE_BASE+2): RETURN → caller PC=1, CR14 restored
//   step3 (PC=1, fetch=CALLER2_BASE+2): RETURN EQ skipped; physicalPC=CALLER2_BASE+2
//
console.log('\n--- PHASE 2: non-lump-header CALL path (cc=0) ---');
{
    const CALLER2_SLOT      = 6;
    const CALLER2_BASE      = 0x1000;
    const CALLER2_CC        = 2;
    const CALLER2_CW        = 4;

    const CALLEE_CC0_SLOT   = 17;
    const CALLEE_CC0_BASE   = 0x1100;

    const CALLEE_CODE_SLOT  = 18;
    const CALLEE_CODE_BASE  = 0x1200;
    const CALLEE_CODE_CC    = 0;
    const CALLEE_CODE_CW    = 4;

    const sim2 = makeSim();
    const faults2 = installFaultCapture(sim2);

    const CALL_WORD2     = sim2.encodeInstruction(2, 14, 0, 0, 0);
    const RETURN_WORD2   = sim2.encodeInstruction(3, 14, 0, 0, 0);
    const SENTINEL_WORD2 = sim2.encodeInstruction(3,  0, 0, 0, 0);

    // Caller2 lump
    writeLumpHdr(sim2, CALLER2_BASE, CALLER2_CC, CALLER2_CW);
    sim2.memory[CALLER2_BASE + 1] = CALL_WORD2;
    sim2.memory[CALLER2_BASE + 2] = SENTINEL_WORD2;

    // CALLEE_CC0 "lump": word0 is an RX GT for CALLEE_CODE_SLOT.
    // This is NOT a valid lump header so hasLumpHeader=false and _execCall
    // falls through to the non-lump-header branch which reads it as clist[0].
    const codeRXGT = sim2.createGT(0, CALLEE_CODE_SLOT, {R:1, X:1}, 1);
    sim2.memory[CALLEE_CC0_BASE] = codeRXGT;   // clist[0] = code GT for CODE_SLOT

    // CALLEE_CODE lump (actual code body for cc=0 callee)
    writeLumpHdr(sim2, CALLEE_CODE_BASE, CALLEE_CODE_CC, CALLEE_CODE_CW);
    sim2.memory[CALLEE_CODE_BASE + 2] = RETURN_WORD2;  // PC=1 in code lump

    // NS entries
    writeTestNsEntry(sim2, CALLER2_SLOT,     CALLER2_BASE,     63, 0, 0, 1, 0, CALLER2_CC,     0);
    writeTestNsEntry(sim2, CALLEE_CC0_SLOT,  CALLEE_CC0_BASE,  63, 0, 0, 1, 0, 0 /* cc=0 */,   0);
    writeTestNsEntry(sim2, CALLEE_CODE_SLOT, CALLEE_CODE_BASE, 63, 0, 0, 1, 0, CALLEE_CODE_CC, 0);

    // CR14 = caller2's RX code cap
    const caller2RXGT = sim2.createGT(0, CALLER2_SLOT, {R:1, X:1}, 1);
    sim2.cr[14] = { word0: caller2RXGT, word1: CALLER2_BASE, word2: 63, word3: 0, m: 0 };

    // CR0 = E-GT for CALLEE_CC0_SLOT (the CALL target)
    const cc0EGT = sim2.createGT(0, CALLEE_CC0_SLOT, {E:1}, 1);
    sim2.cr[0] = { word0: cc0EGT, word1: 0, word2: 0, word3: 0, m: 0 };

    sim2.pc = 0;

    // ── step1: CALL ────────────────────────────────────────────────────────────
    const step1 = sim2.step();

    assert('P2-STEP1-NO-FAULT: CALL (cc=0 path) executed without fault',
        step1 !== null && faults2.length === 0,
        faults2.map(f => `[${f.type}] ${f.message}`).join('; ') || 'step1 was null');

    if (step1 !== null) {
        assert('P2-STEP1-OPCODE: step1 dispatched opcode=2 (CALL)',
            step1.instr && step1.instr.opcode === 2,
            `opcode=${step1.instr && step1.instr.opcode}`);

        // After cc=0 CALL, CR14 should point to CALLEE_CODE_SLOT (from clist[0])
        const calleeCR14w0 = sim2.cr[14].word0 >>> 0;
        assert('P2-CALL-CR14-CODE-SLOT: after CALL (cc=0), CR14 slot_id = CALLEE_CODE_SLOT',
            (calleeCR14w0 & 0xFFFF) === CALLEE_CODE_SLOT,
            `slot_id=${calleeCR14w0 & 0xFFFF}, expected CALLEE_CODE_SLOT=${CALLEE_CODE_SLOT}`);

        assert('P2-CALL-CR14-WORD1: CR14.word1 = CALLEE_CODE_BASE after CALL',
            sim2.cr[14].word1 === CALLEE_CODE_BASE,
            `CR14.word1=0x${sim2.cr[14].word1.toString(16)}, expected=0x${CALLEE_CODE_BASE.toString(16)}`);

        assert('P2-CALL-CR14-DIFFERS: callee CR14 differs from caller CR14',
            calleeCR14w0 !== (caller2RXGT >>> 0),
            `both=0x${calleeCR14w0.toString(16)} (must differ)`);

        faults2.length = 0;

        // ── step2: RETURN from callee code lump ───────────────────────────────
        const expectedCodeFetch = CALLEE_CODE_BASE + 2;  // CODE_BASE+1+PC(1)
        assert('P2-STEP2-SETUP: RETURN_WORD at expected code-lump fetch address',
            sim2.memory[expectedCodeFetch] === RETURN_WORD2,
            `mem[0x${expectedCodeFetch.toString(16)}]=0x${(sim2.memory[expectedCodeFetch]||0).toString(16)}`);

        const step2 = sim2.step();

        assert('P2-STEP2-NO-FAULT: RETURN (cc=0 path) executed without fault',
            step2 !== null && faults2.length === 0,
            faults2.map(f => `[${f.type}] ${f.message}`).join('; ') || 'step2 was null');

        if (step2 !== null) {
            assert('P2-STEP2-OPCODE: step2 dispatched opcode=3 (RETURN)',
                step2.instr && step2.instr.opcode === 3,
                `opcode=${step2.instr && step2.instr.opcode}`);

            assert('P2-STEP2-PC: after RETURN, PC = returnPC (1)',
                sim2.pc === 1,
                `sim2.pc=${sim2.pc}, expected 1`);

            // CR14 must be restored to caller2's cap
            const afterReturnCR14w0 = sim2.cr[14].word0 >>> 0;
            assert('P2-CR14-RESTORED-SLOT: after RETURN, CR14 slot_id = CALLER2_SLOT',
                (afterReturnCR14w0 & 0xFFFF) === CALLER2_SLOT,
                `slot_id=${afterReturnCR14w0 & 0xFFFF}, expected CALLER2_SLOT=${CALLER2_SLOT}`);

            assert('P2-CR14-RESTORED-WORD1: after RETURN, CR14.word1 = CALLER2_BASE',
                sim2.cr[14].word1 === CALLER2_BASE,
                `CR14.word1=0x${sim2.cr[14].word1.toString(16)}, expected=0x${CALLER2_BASE.toString(16)}`);

            faults2.length = 0;

            // ── step3: fetch must come from caller2 lump ──────────────────────
            const expectedCallerFetch = CALLER2_BASE + 2;    // CALLER2_BASE+1+returnPC(1)
            const wrongCodeFetch      = CALLEE_CODE_BASE + 2; // what the bug would produce

            assert('P2-STEP3-SETUP: SENTINEL_WORD at expected caller2 fetch address',
                sim2.memory[expectedCallerFetch] === SENTINEL_WORD2,
                `mem[0x${expectedCallerFetch.toString(16)}]=0x${(sim2.memory[expectedCallerFetch]||0).toString(16)}`);

            const step3 = sim2.step();

            assert('P2-STEP3-NO-FAULT: third step (cc=0) executed without fault',
                step3 !== null && faults2.length === 0,
                faults2.map(f => `[${f.type}] ${f.message}`).join('; ') || 'step3 was null');

            if (step3 !== null) {
                const physPC2 = step3.physicalPC;

                assert('P2-FETCH-CALLER: step3 fetched from caller2 lump (physicalPC = CALLER2_BASE+2)',
                    physPC2 === expectedCallerFetch,
                    `physicalPC=0x${physPC2.toString(16)}, expected CALLER2_BASE+2=0x${expectedCallerFetch.toString(16)}`);

                assert('P2-NOT-CALLEE-CODE: step3 did NOT fetch from callee code lump (physicalPC ≠ CALLEE_CODE_BASE+2)',
                    physPC2 !== wrongCodeFetch,
                    `physicalPC=0x${physPC2.toString(16)} must ≠ CALLEE_CODE_BASE+2=0x${wrongCodeFetch.toString(16)}`);
            }
        }
    }
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
if (failed === 0) {
    console.log(`  ALL ${passed} ASSERTIONS PASSED`);
} else {
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
}
console.log('─'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
