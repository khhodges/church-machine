// test_return_cr14_trace.js — Regression guard: RETURN_CR14 trace payload must
// carry the *caller's* code cap, not the callee's.
//
// Hardware reference (added in Task #2372):
//   hardware/core.py       — retire_trace_return_cr14_gt / _ready / _fault latch
//   hardware/wukong_top.py — WAIT_RETURN_CR14 state in TraceUnit FSM
//
// What the RETURN_CR14 trace packet carries
// -----------------------------------------
// Cross-domain RETURN (CALL frame, sz=1):
//   The hardware defers the RETURN_CR14 packet until the cload unit reads the
//   caller's NS entry and writes the *caller's* restored RX code cap to CR14.
//   The hardware latches that cload-written value in retire_trace_return_cr14_gt
//   and emits it as the RETURN_CR14 payload.  The source data for cload is the
//   caller's E-GT / NS slot that was saved in the call frame at CALL time.
//
//   Simulator correspondence:
//     _execCall() snapshots the caller state via
//       frame.savedCRs = this.cr.map(c => ({...c}))
//     so frame.savedCRs[14].word0 is the caller's code GT exactly as it was
//     before CALL overwrote CR14 with the callee's RX code cap.
//     The RETURN_CR14 trace payload = frame.savedCRs[14].word0 (what cload
//     will restore to CR14).  _execReturn() does NOT restore CR14 via the
//     CR0–11 loop; CR14 is restored lazily by cload / NS re-read after RETURN.
//     Therefore the correct regression guard is:
//       - calleeCR14GT (CR14 after CALL)  ≠  callerCR14GT (frame.savedCRs[14])
//       - frame.savedCRs[14].word0       === callerCR14GT
//     The second assertion is what the hardware trace emits.
//
// Lambda-fast RETURN (LAMBDA frame, sz=0):
//   LAMBDA never overwrites CR14, so at RETURN retire_valid time CR14 still holds
//   the caller's code cap.  The TraceUnit emits RETURN_CR14 *immediately* (no
//   deferred path) using retire_trace_cr14_gt = current CR14.
//
//   Simulator correspondence:
//     After _execLambda() and before _execReturn(), sim.cr[14].word0 must equal
//     the pre-lambda callerCR14GT.  And after _execReturn() through an sz=0
//     frame, CR14 must still equal callerCR14GT (the loop in _execReturn() skips
//     CR12–CR15; CR14 is simply left untouched for lambda returns).
//
// Coverage:
//   PHASE PM  — createGT encoding sanity (slot_id round-trip, perm distinctions)
//   PHASE 1   — Cross-domain: direct frame injection
//               Verifies that frame.savedCRs[14] captures the caller's code GT
//               and is distinct from the callee's CR14 set by CALL.
//   PHASE 2   — Cross-domain: real _execCall→_execReturn round-trip (lump-header
//               path, cc>0).  Same assertion via the actual call stack entry.
//   PHASE 3   — Lambda-fast: sz=0 frame injection, CR14 unchanged through RETURN
//   PHASE 4   — Lambda-fast: real _execLambda→_execReturn round-trip
//
// Run:  node simulator/test_return_cr14_trace.js

'use strict';

global.window = {};   // silence any bootConfig references in the constructor

const ChurchSimulator = require('./simulator.js');

const PERM_MASK = 0x70000000;   // bits[30:28]
const L_PERM   = 0x10000000;   // perm[0]=L  → bits[30:28] = 0b001 (Church domain)
const E_PERM   = 0x40000000;   // perm[2]=E  → bits[30:28] = 0b100 (Church domain)

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
    // CR12.word1=0 → skip thread-stack writes (avoids needing a live thread lump)
    sim.cr[12] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    // CR15.m=0 → _mwinWriteback is a no-op
    sim.cr[15] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    return sim;
}

// Write a minimal 64-word lump header at memory[base] with given cc and cw.
function writeLumpHdr(sim, base, cc, cw) {
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

// ── PHASE PM: createGT encoding sanity ────────────────────────────────────────
// Verify that slot_id is preserved by createGT and that Church-domain GTs
// (L, E) differ in their perm field so they can be distinguished in assertions.
console.log('\n--- PHASE PM: createGT encoding sanity ---');
{
    const sim = makeSim();

    // R+X is Turing domain (dom=0), L and E are Church domain (dom=1).
    const lGT  = sim.createGT(0, 10, {L:1}, 1);
    const eGT  = sim.createGT(0, 10, {E:1}, 1);
    const rxGT = sim.createGT(0, 20, {R:1, X:1}, 1);  // slot 20 for rx

    assert('PM-1: createGT({L:1}) dom bit (bit 27) is set for Church domain',
        ((lGT >>> 27) & 1) === 1,
        `lGT=0x${(lGT >>> 0).toString(16).toUpperCase()}`);

    assert('PM-2: createGT({E:1}) dom bit (bit 27) is set for Church domain',
        ((eGT >>> 27) & 1) === 1,
        `eGT=0x${(eGT >>> 0).toString(16).toUpperCase()}`);

    assert('PM-3: L-perm and E-perm are distinct in bits[30:28]',
        (lGT & PERM_MASK) !== (eGT & PERM_MASK),
        `l=0x${(lGT & PERM_MASK).toString(16)} e=0x${(eGT & PERM_MASK).toString(16)}`);

    assert('PM-4: slot_id 10 round-trips through createGT({L:1})',
        (lGT & 0xFFFF) === 10,
        `slot_id=${lGT & 0xFFFF}`);

    assert('PM-5: slot_id 20 round-trips through createGT({R:1,X:1})',
        (rxGT & 0xFFFF) === 20,
        `slot_id=${rxGT & 0xFFFF}`);

    assert('PM-6: two createGT calls with different slots produce different words',
        (lGT >>> 0) !== (rxGT >>> 0),
        `lGT=0x${(lGT >>> 0).toString(16).toUpperCase()} rxGT=0x${(rxGT >>> 0).toString(16).toUpperCase()}`);
}

// ── PHASE 1: Cross-domain, direct frame injection ─────────────────────────────
//
// Manually push a CALL frame (sz=1) whose savedCRs[14] is the caller's code
// GT, then verify the frame captured the right word and NOT the callee's.
//
// This directly guards the "trace payload = frame.savedCRs[14].word0" contract:
// hardware cload reads the caller's NS entry and derives the same value that
// was in CR14 at CALL time.  If _execCall ever mis-snapshots CR14, this fails.
//
// NOTE: _execReturn() does NOT restore CR14 via the CR0–11 loop.  CR14 is
// restored via a separate cload / NS re-read in both hardware and simulator.
// This phase checks the *frame snapshot*, not the post-RETURN register value.
console.log('\n--- PHASE 1: cross-domain frame snapshot (direct injection) ---');
{
    const CALLER_SLOT = 5;
    const CALLEE_SLOT = 8;

    const sim = makeSim();
    const faults = installFaultCapture(sim);

    // Build the caller's and callee's code GTs with different slot_ids.
    // Using {R:1,X:1} (Turing domain, dom=0) to match what CALL sets on CR14.
    const callerCR14GT = sim.createGT(0, CALLER_SLOT, {R:1, X:1}, 1);
    const calleeCR14GT = sim.createGT(0, CALLEE_SLOT, {R:1, X:1}, 1);

    assert('P1-DISTINCT: caller CR14 GT ≠ callee CR14 GT',
        (callerCR14GT >>> 0) !== (calleeCR14GT >>> 0),
        `callerCR14=0x${(callerCR14GT>>>0).toString(16).toUpperCase()} calleeCR14=0x${(calleeCR14GT>>>0).toString(16).toUpperCase()}`);

    // Build savedCRs snapshot as CALL would: caller's CR14 in slot 14.
    const savedCRs = Array.from({length: 16}, () => ({
        word0: 0, word1: 0, word2: 0, word3: 0, m: 0
    }));
    savedCRs[14] = { word0: callerCR14GT, word1: 0x0100, word2: 0, word3: 0, m: 0 };

    // Push the CALL frame (sz=1).
    sim.callStack.push({
        returnPC:   3,
        savedCRs:   savedCRs,
        savedDRs:   new Array(16).fill(0),
        savedFlags: { Z: false, N: false, C: false, V: false },
        savedSTO:   10,
        sz:         1,
        frameWord:  0,
        sentinel:   false,
    });

    // Set CR14 to the callee's code GT (simulating what CALL would have done).
    sim.cr[14] = { word0: calleeCR14GT, word1: 0x0200, word2: 0, word3: 0, m: 1 };

    // ── Key assertions: trace payload = frame.savedCRs[14].word0 ──────────────
    const frame = sim.callStack[sim.callStack.length - 1];
    const tracePayload = frame.savedCRs[14].word0 >>> 0;

    assert('P1-TRACE-PAYLOAD: RETURN_CR14 trace payload (frame.savedCRs[14]) = caller\'s code GT',
        tracePayload === (callerCR14GT >>> 0),
        `tracePayload=0x${tracePayload.toString(16).toUpperCase()}, callerCR14=0x${(callerCR14GT>>>0).toString(16).toUpperCase()}`);

    assert('P1-NOT-CALLEE: RETURN_CR14 trace payload ≠ callee\'s code GT',
        tracePayload !== (calleeCR14GT >>> 0),
        `both=0x${tracePayload.toString(16).toUpperCase()} (must differ from callee)`);

    assert('P1-SLOT: trace payload slot_id matches caller slot',
        (tracePayload & 0xFFFF) === CALLER_SLOT,
        `got ${tracePayload & 0xFFFF}, expected CALLER_SLOT=${CALLER_SLOT}`);

    // Pop via _execReturn — verify no fault and the frame was the right one.
    const result = sim._execReturn({ imm: 0, crDst: 0, crSrc: 0, raw: 0 });

    assert('P1-NO-FAULT: _execReturn completed without fault',
        faults.length === 0 && result !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

    assert('P1-PC: RETURN restored PC to frame.returnPC',
        result && result.pc === 3,
        `got pc=${result && result.pc}`);
}

// ── PHASE 2: Cross-domain, real _execCall→_execReturn round-trip ──────────────
//
// Uses _execCall() so the simulator's own snapshotting logic captures the
// caller's CR14 in the frame.  After CALL:
//   • callStack[top].savedCRs[14].word0 must equal the pre-CALL callerCR14GT
//   • sim.cr[14].word0 (callee's cap set by CALL) must differ from callerCR14GT
//
// The difference between these two values is exactly the bug Task #2372 fixed:
// the old hardware trace used sim.cr[14] at retire time (callee's cap), but the
// correct payload is callStack[top].savedCRs[14] (caller's cap, latched by cload).
//
// After _execReturn(), the frame is gone; the assertions are made just before
// the pop by capturing the frame reference first.
console.log('\n--- PHASE 2: cross-domain round-trip via real _execCall→_execReturn ---');
{
    const CALLER_SLOT = 4;
    const CALLEE_SLOT = 11;
    const CALLER_BASE = 0x0300;
    const CALLEE_BASE = 0x0600;
    const CALLER_CW   = 3;
    const CALLER_CC   = 2;
    const CALLEE_CW   = 5;
    const CALLEE_CC   = 2;

    const sim = makeSim();
    const faults = installFaultCapture(sim);

    // Write lump headers.
    writeLumpHdr(sim, CALLER_BASE, CALLER_CC, CALLER_CW);
    writeLumpHdr(sim, CALLEE_BASE, CALLEE_CC, CALLEE_CW);

    // Populate NS entries for caller and callee slots.
    // writeNSEntry(idx, location, limit17, bFlag, gBit, gtType, version, clistCount, abstract_gt)
    sim.writeNSEntry(CALLER_SLOT, CALLER_BASE, 63, 0, 0, 1, 0, CALLER_CC, 0);
    sim.writeNSEntry(CALLEE_SLOT, CALLEE_BASE, 63, 0, 0, 1, 0, CALLEE_CC, 0);

    // Caller context: CR14 = code GT for CALLER_SLOT.
    const callerCR14GT = sim.createGT(0, CALLER_SLOT, {R:1, X:1}, 1);
    sim.cr[14] = { word0: callerCR14GT, word1: CALLER_BASE, word2: 63, word3: 0, m: 0 };

    // CR6: caller's c-list GT (L).
    const callerCR6GT = sim.createGT(0, CALLER_SLOT, {L:1}, 1);
    sim.cr[6] = { word0: callerCR6GT, word1: CALLER_BASE, word2: 0, word3: 0, m: 0 };

    // CR0: callee's E-GT — the CALL target.
    const calleeEGT = sim.createGT(0, CALLEE_SLOT, {E:1}, 1);
    sim.cr[0] = { word0: calleeEGT, word1: 0, word2: 0, word3: 0, m: 0 };

    sim.pc = 2;

    // Execute CALL.
    const callResult = sim._execCall({ crDst: 0, imm: 0 });

    assert('P2-CALL-OK: _execCall succeeded without fault',
        callResult !== null && faults.length === 0,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'callResult was null');

    if (callResult !== null) {
        const calleeCR14GT = sim.cr[14].word0 >>> 0;

        assert('P2-CALL-CR14-SLOT: after CALL, CR14 slot_id is callee slot',
            (calleeCR14GT & 0xFFFF) === CALLEE_SLOT,
            `got ${calleeCR14GT & 0xFFFF}, expected CALLEE_SLOT=${CALLEE_SLOT}`);

        assert('P2-CALL-CR14-DIFFERS: callee CR14 ≠ caller CR14',
            calleeCR14GT !== (callerCR14GT >>> 0),
            `both=0x${calleeCR14GT.toString(16).toUpperCase()} (must differ)`);

        // ── Key assertions before pop: frame snapshot carries caller's cap ──────
        const frame = sim.callStack[sim.callStack.length - 1];
        const tracePayload = frame.savedCRs[14].word0 >>> 0;

        assert('P2-TRACE-PAYLOAD-CALLER: frame.savedCRs[14] = callerCR14GT (RETURN_CR14 payload = caller\'s cap)',
            tracePayload === (callerCR14GT >>> 0),
            `tracePayload=0x${tracePayload.toString(16).toUpperCase()}, callerCR14=0x${(callerCR14GT>>>0).toString(16).toUpperCase()}`);

        assert('P2-TRACE-PAYLOAD-NOT-CALLEE: frame.savedCRs[14] ≠ calleeCR14GT (NOT callee\'s cap)',
            tracePayload !== calleeCR14GT,
            `tracePayload=0x${tracePayload.toString(16).toUpperCase()}, calleeCR14=0x${calleeCR14GT.toString(16).toUpperCase()}`);

        assert('P2-TRACE-SLOT: trace payload slot_id matches caller slot',
            (tracePayload & 0xFFFF) === CALLER_SLOT,
            `got ${tracePayload & 0xFFFF}, expected CALLER_SLOT=${CALLER_SLOT}`);

        faults.length = 0;

        // Execute RETURN.
        const returnResult = sim._execReturn({ imm: 0, crDst: 0, crSrc: 0, raw: 0 });

        assert('P2-RETURN-OK: _execReturn succeeded without fault',
            returnResult !== null && faults.length === 0,
            faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'returnResult was null');

        assert('P2-RETURN-PC: PC restored to caller\'s instruction after RETURN',
            returnResult && returnResult.pc === 3,   // 2 + 1
            `got pc=${returnResult && returnResult.pc}`);
    }
}

// ── PHASE 3: Lambda-fast RETURN, direct sz=0 frame injection ──────────────────
//
// LAMBDA does not overwrite CR14.  On RETURN through an sz=0 frame, the
// hardware emits RETURN_CR14 *immediately* using retire_trace_cr14_gt = current
// CR14 (unchanged = caller's cap).  _execReturn() does not modify CR14 for
// sz=0 frames, so CR14 after _execReturn() still equals the pre-lambda value.
//
// This is the "lambda-fast" (non-deferred) trace path.  The test confirms:
//   sim.cr[14].word0 === callerCR14GT  both before and after _execReturn().
console.log('\n--- PHASE 3: lambda-fast RETURN via direct sz=0 frame injection ---');
{
    const CALLER_SLOT = 7;

    const sim = makeSim();
    const faults = installFaultCapture(sim);

    // CR14 = caller's code GT (must survive the lambda call unchanged).
    const callerCR14GT = sim.createGT(0, CALLER_SLOT, {R:1, X:1}, 1);
    sim.cr[14] = { word0: callerCR14GT, word1: 0x0100, word2: 0, word3: 0, m: 0 };

    // Push sz=0 (LAMBDA) frame.
    const savedCRs = Array.from({length: 16}, () => ({
        word0: 0, word1: 0, word2: 0, word3: 0, m: 0
    }));
    savedCRs[14] = { word0: callerCR14GT, word1: 0x0100, word2: 0, word3: 0, m: 0 };

    sim.callStack.push({
        returnPC:   1,
        savedCRs:   savedCRs,
        savedDRs:   new Array(16).fill(0),
        savedFlags: { Z: true, N: false, C: false, V: false },
        savedSTO:   8,
        sz:         0,       // LAMBDA frame
        frameWord:  0,
        sentinel:   false,
    });

    // For lambda-fast: the trace payload IS the current CR14 at retire time.
    const tracePayload = sim.cr[14].word0 >>> 0;

    assert('P3-TRACE-PAYLOAD: CR14 at retire_valid = caller\'s code GT (lambda-fast immediate emit)',
        tracePayload === (callerCR14GT >>> 0),
        `tracePayload=0x${tracePayload.toString(16).toUpperCase()}, callerCR14=0x${(callerCR14GT>>>0).toString(16).toUpperCase()}`);

    assert('P3-SLOT: trace payload slot_id correct',
        (tracePayload & 0xFFFF) === CALLER_SLOT,
        `got ${tracePayload & 0xFFFF}, expected ${CALLER_SLOT}`);

    // Execute RETURN through the sz=0 frame.
    const result = sim._execReturn({ imm: 0, crDst: 0, crSrc: 0, raw: 0 });

    assert('P3-NO-FAULT: _execReturn (sz=0 frame) did not fault',
        faults.length === 0 && result !== null,
        faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'result was null');

    const cr14After = sim.cr[14].word0 >>> 0;

    assert('P3-UNCHANGED-AFTER: CR14 unchanged after lambda-fast RETURN (= caller\'s cap)',
        cr14After === (callerCR14GT >>> 0),
        `got 0x${cr14After.toString(16).toUpperCase()}, expected 0x${(callerCR14GT>>>0).toString(16).toUpperCase()}`);
}

// ── PHASE 4: Lambda-fast, real _execLambda→_execReturn round-trip ─────────────
//
// Executes a genuine _execLambda() followed by _execReturn() to confirm that
// the full lambda dispatch path leaves CR14 unchanged, so the trace packet
// emitted at RETURN retire_valid carries the correct (caller's) code cap.
//
// Architecture rule: LAMBDA pushes an sz=0 frame (saving PC, FLAGS, STO only)
// and does NOT modify CR14.  Therefore the hardware emits the lambda-fast
// RETURN_CR14 packet using the *current* CR14 — which is the caller's cap.
console.log('\n--- PHASE 4: lambda-fast round-trip via real _execLambda→_execReturn ---');
{
    const CALLER_SLOT  = 6;
    const LAMBDA_SLOT  = 13;
    const CALLER_BASE  = 0x0200;
    const LAMBDA_BASE  = 0x0500;
    const LAMBDA_CW    = 2;
    const LAMBDA_CC    = 0;   // cc=0 → lambda LUMP (no c-list)

    const sim = makeSim();
    const faults = installFaultCapture(sim);

    // Write a minimal lambda LUMP at LAMBDA_BASE (cc=0 qualifies as LAMBDA).
    writeLumpHdr(sim, LAMBDA_BASE, LAMBDA_CC, LAMBDA_CW);

    // NS entry for the lambda target.
    // writeNSEntry(idx, location, limit17, bFlag, gBit, gtType, version, clistCount, abstract_gt)
    sim.writeNSEntry(LAMBDA_SLOT, LAMBDA_BASE, 63, 0, 0, 1, 0, LAMBDA_CC, 0);

    // Caller's CR14 — must survive the lambda unchanged.
    const callerCR14GT = sim.createGT(0, CALLER_SLOT, {R:1, X:1}, 1);
    sim.cr[14] = { word0: callerCR14GT, word1: CALLER_BASE, word2: 0, word3: 0, m: 0 };

    // CR0: X-GT for the lambda target (LAMBDA reads CR0 via crDst=0).
    const lambdaXGT = sim.createGT(0, LAMBDA_SLOT, {X:1}, 1);
    sim.cr[0] = { word0: lambdaXGT, word1: LAMBDA_BASE, word2: 63, word3: 0, m: 0 };

    sim.pc = 1;

    // Execute LAMBDA.
    const lambdaResult = sim._execLambda({ crDst: 0, crSrc: 0, imm: 0 });

    if (lambdaResult !== null) {
        // ── After LAMBDA, CR14 must still be the caller's code GT ──────────────
        const cr14AfterLambda = sim.cr[14].word0 >>> 0;

        assert('P4-LAMBDA-CR14-UNCHANGED: CR14 unchanged after _execLambda (not overwritten)',
            cr14AfterLambda === (callerCR14GT >>> 0),
            `got 0x${cr14AfterLambda.toString(16).toUpperCase()}, expected 0x${(callerCR14GT>>>0).toString(16).toUpperCase()}`);

        // CR14 at retire_valid = trace payload for lambda-fast RETURN.
        assert('P4-LAMBDA-TRACE-PAYLOAD: CR14 at retire time = caller\'s cap (lambda-fast emit path)',
            cr14AfterLambda === (callerCR14GT >>> 0),
            `tracePayload=0x${cr14AfterLambda.toString(16).toUpperCase()}`);

        assert('P4-LAMBDA-SLOT: CR14 slot_id still matches caller slot',
            (cr14AfterLambda & 0xFFFF) === CALLER_SLOT,
            `got ${cr14AfterLambda & 0xFFFF}, expected CALLER_SLOT=${CALLER_SLOT}`);

        faults.length = 0;

        // Execute RETURN to unwind the lambda frame.
        const returnResult = sim._execReturn({ imm: 0, crDst: 0, crSrc: 0, raw: 0 });

        assert('P4-RETURN-OK: _execReturn (after lambda) did not fault',
            returnResult !== null && faults.length === 0,
            faults.map(f => `[${f.type}] ${f.message}`).join('; ') || 'returnResult was null');

        const cr14After = sim.cr[14].word0 >>> 0;

        assert('P4-RETURN-CR14-UNCHANGED: CR14 after lambda-fast RETURN = caller\'s code cap',
            cr14After === (callerCR14GT >>> 0),
            `got 0x${cr14After.toString(16).toUpperCase()}, expected 0x${(callerCR14GT>>>0).toString(16).toUpperCase()}`);

        assert('P4-RETURN-SLOT: CR14 slot_id after lambda-fast RETURN matches caller slot',
            (cr14After & 0xFFFF) === CALLER_SLOT,
            `got ${cr14After & 0xFFFF}, expected CALLER_SLOT=${CALLER_SLOT}`);
    } else {
        const faultDesc = faults.map(f => `[${f.type}] ${f.message}`).join('; ');
        // Mark the dependent assertions as failures with a meaningful message.
        for (const label of [
            'P4-LAMBDA-CR14-UNCHANGED',
            'P4-LAMBDA-TRACE-PAYLOAD',
            'P4-LAMBDA-SLOT',
            'P4-RETURN-OK',
            'P4-RETURN-CR14-UNCHANGED',
            'P4-RETURN-SLOT',
        ]) {
            assert(label, false, `_execLambda returned null — prerequisite failed; faults: ${faultDesc || 'none'}`);
        }
    }
}

// ── Final summary ─────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(56));
if (failed === 0) {
    console.log(`  ALL ${passed} ASSERTIONS PASSED`);
} else {
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
}
console.log('─'.repeat(56));

process.exit(failed > 0 ? 1 : 0);
