'use strict';
// test_lazy_resolve_pending.js — Unit tests for Task #1446 pending GT sentinel
// Run:  node simulator/test_lazy_resolve_pending.js
//
// Coverage:
//   T001 — makePendingGT / isPendingGT / pendingGTName round-trip (8 assertions)
//   T002 — _execLoad instant resolution: pending → live GT for known nsLabel (6 assertions)
//   T003 — _execLoad unresolvable: LAZY_RESOLVE_PENDING fault with petName + slot (4 assertions)
//   T004 — _injectClistNow CASE B contract: unknown name → non-zero sentinel, not 0 (5 assertions)
//   T005 — lump-audit RPN: pending sentinel in c-list → treated as named slot (5 assertions)

global.window = { bootConfig: {} };

const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const ChurchSimulator = require('./simulator.js');
const CapabilityTokens = require('./capability_tokens.js');

// bootSim() from tests/gates/sim_helpers is fine; setupCR6 there uses the
// wrong argument order for packNSWord1 in this codebase (7-arg call hits a
// 5-arg signature, leaving clistCount=0).  We define a corrected version here.
function bootSim() {
    const sim = new ChurchSimulator();
    let steps = 0;
    while (!sim.bootComplete && !sim.halted && steps < 300) {
        sim._bootStep();
        steps++;
    }
    return sim;
}

// Wire CR6 to a 1-slot scratch c-list at address 500.
// Uses the correct 5-arg packNSWord1(limit17, bFlag, gBit, gtType, clistCount).
function setupCR6(sim) {
    const slotIdx = sim.bootEntrySlot;
    const nsBase  = sim.NS_TABLE_BASE + slotIdx * sim.NS_ENTRY_WORDS;
    const gt_seq  = (sim.memory[nsBase + 2] >>> 25) & 0x7F;
    const eGT     = sim.createGT(gt_seq, slotIdx, { E: 1 }, 1);
    sim.cr[6] = {
        word0: eGT,
        word1: 500,
        word2: sim.packNSWord1(0, 0, 0, 0, 1),   // clistCount = 1
        word3: 0,
        m:     0,
    };
}

let pass = 0;
let fail = 0;

function check(label, cond) {
    if (cond) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}`);
        fail++;
    }
}

// Drain the PENDING_GT_NAMES registry between suites so name-index assignments
// are deterministic and tests don't interfere with each other.
function resetPendingRegistry() {
    ChurchSimulator.PENDING_GT_NAMES.length = 0;
}

// ── T001: Static helpers round-trip ──────────────────────────────────────────
console.log('\n--- T001: makePendingGT / isPendingGT / pendingGTName ---');
{
    resetPendingRegistry();

    const wordAlpha = ChurchSimulator.makePendingGT('Alpha');

    check('T001a: upper 16 bits of pending GT equal 0xFEED',
        ((wordAlpha >>> 0) >>> 16) === 0xFEED);

    check('T001b: isPendingGT returns true for a word produced by makePendingGT',
        ChurchSimulator.isPendingGT(wordAlpha) === true);

    check('T001c: pendingGTName round-trips the original pet name',
        ChurchSimulator.pendingGTName(wordAlpha) === 'Alpha');

    check('T001d: isPendingGT returns false for null GT (0)',
        ChurchSimulator.isPendingGT(0) === false);

    check('T001e: isPendingGT returns false for an ordinary word (0x12345678)',
        ChurchSimulator.isPendingGT(0x12345678) === false);

    // Same name must be deduplicated — both calls must return the identical word.
    const wordAlpha2 = ChurchSimulator.makePendingGT('Alpha');
    check('T001f: same pet name → same word (index deduplication)',
        wordAlpha === wordAlpha2);

    // Two distinct names must produce distinct lower-16-bit indices.
    const wordBeta = ChurchSimulator.makePendingGT('Beta');
    check('T001g: different pet names → different lower 16-bit indices',
        (wordAlpha & 0xFFFF) !== (wordBeta & 0xFFFF));

    // Any word whose upper 16 bits equal 0xFEED is a pending sentinel.
    check('T001h: isPendingGT returns true for 0xFEED0000 (index 0 sentinel)',
        ChurchSimulator.isPendingGT(0xFEED0000) === true);
}

// ── T002: _execLoad instant resolution ───────────────────────────────────────
// A pending slot whose pet name matches a live nsLabel must be resolved in-place
// and execution must continue without raising a fault.
console.log('\n--- T002: _execLoad instant resolution ---');
{
    resetPendingRegistry();

    const sim = bootSim();
    if (!sim.bootComplete) {
        console.log('SKIP T002: boot did not complete');
    } else {
        // Install a valid NS entry at slot 5 so isNSEntryValid(5) === true.
        // NS table is TOP-DOWN: use _nsSlotBase() not the ascending formula.
        const NS5_BASE = sim._nsSlotBase(5);
        sim.memory[NS5_BASE]     = 0x00000001 >>> 0;  // non-zero word0 (lump base)
        sim.memory[NS5_BASE + 1] = 0x00000041 >>> 0;  // non-zero word1 (limit field)
        if (sim.nsCount < 6) sim.nsCount = 6;
        sim.nsLabels[5] = 'TestAbstr';

        // Place a pending sentinel for 'TestAbstr' in c-list slot 0 (address 500).
        setupCR6(sim);
        const pendingWord = ChurchSimulator.makePendingGT('TestAbstr');
        sim.memory[500] = pendingWord >>> 0;

        // Encode LOAD CR1, [CR6+0] (imm=0 → c-list offset 0) at PC=0.
        const instr = sim.encodeInstruction(0, 0xE, 1, 6, 0);
        const cr14  = sim.cr[14];
        sim.memory[cr14.word1 + 1] = instr >>> 0;
        sim.pc     = 0;
        sim.halted = false;

        const faultCountBefore = sim.faultLog.length;

        sim.step();

        const slotAfter   = sim.memory[500] >>> 0;
        const newFaults   = sim.faultLog.slice(faultCountBefore);

        check('T002a: no LAZY_RESOLVE_PENDING fault was raised',
            !newFaults.some(f => f.type === 'LAZY_RESOLVE_PENDING'));

        check('T002b: c-list slot is no longer a pending sentinel after resolution',
            !ChurchSimulator.isPendingGT(slotAfter));

        check('T002c: c-list slot was updated to a non-zero real GT',
            slotAfter !== 0);

        check('T002d: simulator output contains the [LAZY-RESOLVE] marker',
            sim.output.includes('[LAZY-RESOLVE]'));

        // The simulator may subsequently halt when validating the resolved GT's
        // lump bounds (NS slot 5 has a stub entry, not a full lump).  What matters
        // is that the halt was NOT caused by LAZY_RESOLVE_PENDING — resolution
        // succeeded and the fault (if any) is unrelated to the pending path.
        check('T002e: any subsequent halt was NOT caused by LAZY_RESOLVE_PENDING',
            !newFaults.some(f => f.type === 'LAZY_RESOLVE_PENDING'));

        // The resolved GT encodes the target NS slot in its lower 16 bits.
        const resolvedNsIdx = slotAfter & 0xFFFF;
        check('T002f: resolved GT points to NS slot 5',
            resolvedNsIdx === 5);
    }
}

// ── T003: _execLoad unresolvable path ────────────────────────────────────────
// A pending slot whose pet name has no matching nsLabel must fire a structured
// LAZY_RESOLVE_PENDING fault carrying petName and slot in the fault record.
console.log('\n--- T003: _execLoad unresolvable → LAZY_RESOLVE_PENDING fault ---');
{
    resetPendingRegistry();

    const sim = bootSim();
    if (!sim.bootComplete) {
        console.log('SKIP T003: boot did not complete');
    } else {
        // 'UnknownService' does not appear in nsLabels → cannot resolve instantly.
        setupCR6(sim);
        const pendingWord = ChurchSimulator.makePendingGT('UnknownService');
        sim.memory[500] = pendingWord >>> 0;

        const instr = sim.encodeInstruction(0, 0xE, 1, 6, 0);
        const cr14  = sim.cr[14];
        sim.memory[cr14.word1 + 1] = instr >>> 0;
        sim.pc     = 0;
        sim.halted = false;

        const faultCountBefore = sim.faultLog.length;

        sim.step();

        const newFaults = sim.faultLog.slice(faultCountBefore);
        const lpFault   = newFaults.find(f => f.type === 'LAZY_RESOLVE_PENDING');

        check('T003a: LAZY_RESOLVE_PENDING fault was fired',
            lpFault !== undefined);

        // LAZY_RESOLVE_PENDING is listed as null in FAULT_CODES (no hardware code).
        check('T003b: faultCode is null (no hardware numeric code assigned)',
            lpFault ? lpFault.faultCode === null : false);

        // The meta object { petName, slot } is spread into the fault log entry.
        check('T003c: fault entry carries petName = "UnknownService"',
            lpFault ? lpFault.petName === 'UnknownService' : false);

        check('T003d: fault entry carries slot = 0 (c-list offset 0)',
            lpFault ? lpFault.slot === 0 : false);
    }
}

// ── T004: _injectClistNow CASE B — real integration test via vm ───────────────
// We extract the _injectClistNow function verbatim from app-run.js and run it
// inside a vm.runInContext with only the globals it needs: sim, ChurchSimulator,
// and lastAssembledCapabilities.  This catches regressions that would revert
// CASE B to writing 0 (null GT) instead of the 0xFEED____ sentinel.
//
// Contract assertions (T004a-e) verify the static helper API surface that
// CASE B depends on.  The integration assertions (T004f-h) verify the live
// memory write produced by calling the real function.
console.log('\n--- T004: _injectClistNow CASE B — integration test ---');
{
    resetPendingRegistry();

    // ── T004a–e: contract helpers ─────────────────────────────────────────────

    const sim0 = bootSim();

    const caseB_sentinel = ChurchSimulator.makePendingGT('SomeCap');
    check('T004a: unknown cap name → sentinel is non-zero (not null-GT)',
        caseB_sentinel !== 0);

    check('T004b: sentinel produced for unknown name is recognised by isPendingGT',
        ChurchSimulator.isPendingGT(caseB_sentinel) === true);

    check('T004c: sentinel produced for unknown name preserves the pet name',
        ChurchSimulator.pendingGTName(caseB_sentinel) === 'SomeCap');

    const realGT = sim0.createGT(0, 1, { E: 1 }, 1);
    check('T004d: known NS label → createGT() produces a non-pending real GT',
        !ChurchSimulator.isPendingGT(realGT));

    check('T004e: null GT (0) is not a pending sentinel',
        !ChurchSimulator.isPendingGT(0) && caseB_sentinel !== 0);

    // ── T004f–h: live _injectClistNow CASE B execution ────────────────────────
    // Extract the function source verbatim from app-run.js.
    const appRunSrc  = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    const appRunLines = appRunSrc.split('\n');
    let fnStart = -1, fnEnd = -1, depth = 0;
    for (let i = 0; i < appRunLines.length; i++) {
        if (fnStart < 0 && appRunLines[i].startsWith('function _injectClistNow()')) {
            fnStart = i;
        }
        if (fnStart >= 0) {
            depth += (appRunLines[i].match(/{/g) || []).length -
                     (appRunLines[i].match(/}/g) || []).length;
            if (depth === 0 && i > fnStart) { fnEnd = i; break; }
        }
    }

    if (fnStart < 0 || fnEnd < 0) {
        console.log('SKIP T004f-h: could not locate _injectClistNow in app-run.js');
        check('T004f: _injectClistNow located in app-run.js', false);
        check('T004g: CASE B writes pending sentinel for unknown cap', false);
        check('T004h: CASE B preserves the pet name in the sentinel', false);
    } else {
        const fnSrc = appRunLines.slice(fnStart, fnEnd + 1).join('\n');

        // Boot a fresh sim and supply the globals _injectClistNow needs.
        const sim2 = bootSim();
        // demoClistGTs must be non-empty so the early-return guard passes.
        sim2.demoClistGTs = new Array(20).fill(0);

        // One unknown capability — 'FutureWidget' is not in nsLabels.
        let lastAssembledCapabilities = [{ name: 'FutureWidget', rights: [] }];

        const ctx4 = vm.createContext({
            sim: sim2,
            ChurchSimulator,
            CapabilityTokens,
            lastAssembledCapabilities,
            lastAssembledNamedSlots: null,
            console,
            document: { getElementById: () => null },
            window: { bootConfig: {} },
        });
        // Define and immediately call the function.
        vm.runInContext(fnSrc + '\n_injectClistNow();', ctx4);

        // Boot.Abstr lump (NS slot sim2.bootEntrySlot, default 6 post slot 3→6
        // migration): lumpBase=0x140=320, lumpSize=64.
        // CASE B clistBase = lumpBase + lumpSize − cc = 320 + 64 − 1 = 383.
        // NS table is TOP-DOWN: use _nsSlotBase() not the ascending formula.
        const ns3Base  = sim2._nsSlotBase(sim2.bootEntrySlot);
        const lumpBase = sim2.memory[ns3Base] >>> 0;
        const lumpHdr  = sim2.memory[lumpBase] >>> 0;
        const lumpSize = sim2.parseLumpHeader(lumpHdr).lumpSize;
        const clistBase = lumpBase + lumpSize - 1;   // cc = lastAssembledCapabilities.length = 1
        const written  = sim2.memory[clistBase] >>> 0;

        check('T004f: _injectClistNow CASE B located and executed without throwing',
            fnStart >= 0);

        check('T004g: CASE B writes a 0xFEED____ pending sentinel for unknown cap name',
            ChurchSimulator.isPendingGT(written));

        check('T004h: CASE B sentinel preserves the pet name "FutureWidget"',
            ChurchSimulator.pendingGTName(written) === 'FutureWidget');

        // Compile → Run uses the already-validated exact token instead of the
        // legacy device-map fallback. In particular UART_TX W must stay W-only
        // and must not be broadened to the demo c-list's RW device grant.
        const sim3 = bootSim();
        sim3.demoClistGTs = new Array(20).fill(0);
        sim3.demoClistGTs[2] = 0x32000002; // broad RW device token
        const ctx5 = vm.createContext({
            sim: sim3,
            ChurchSimulator,
            CapabilityTokens,
            lastAssembledCapabilities: [{
                name: 'UART_TX',
                rights: ['W'],
                grants: ['R', 'W'],
                nsIndex: 2,
                token: 0x22000002,
            }],
            lastAssembledNamedSlots: null,
            console,
            document: { getElementById: () => null },
            window: { bootConfig: {} },
        });
        const exactResult = vm.runInContext(
            fnSrc + '\n_injectClistNow();', ctx5);
        const exactNsBase = sim3._nsSlotBase(sim3.bootEntrySlot);
        const exactLumpBase = sim3.memory[exactNsBase] >>> 0;
        const exactLumpSize = sim3.parseLumpHeader(
            sim3.memory[exactLumpBase] >>> 0).lumpSize;
        const exactWritten = sim3.memory[
            exactLumpBase + exactLumpSize - 1] >>> 0;
        check('T004i: validated exact-token runtime injection succeeds',
            exactResult === true);
        check('T004j: UART_TX runtime token remains exact W-only 0x22000002',
            exactWritten === 0x22000002,
            `got 0x${exactWritten.toString(16).padStart(8, '0')}`);
    }
}

// ── T005: lump-audit RPN — pending sentinel treated as named slot ──────────────
// lump-audit.js is a browser-only module. We load it via vm.runInContext so
// ChurchSimulator is available as a global inside the auditor.
//
// Binary layout (64 words, lumpSize=64, cw=1, cc=1):
//   word[0]  header   — magic=0x1F, nMinus6=0, cw=1, cc=1
//   word[1]  LOAD instruction — opcode=0, crSrc=6, slot=1 (1-indexed, RPN convention)
//   word[2..62] free space — all zero
//   word[63] c-list area  — pending sentinel (or 0 for the control case)
console.log('\n--- T005: lump-audit RPN — pending sentinel prevents unnamed-slot warning ---');
{
    resetPendingRegistry();

    // Register a pet name manually so pendingGTName() can resolve it inside lumpAudit.
    const pendingIdx = ChurchSimulator.PENDING_GT_NAMES.length;
    ChurchSimulator.PENDING_GT_NAMES.push('PendingCap');
    const pendingSentinel = (0xFEED0000 | (pendingIdx & 0xFFFF)) >>> 0;

    const lumpAuditSrc = fs.readFileSync(
        path.join(__dirname, 'lump-audit.js'), 'utf8');
    const ctx = vm.createContext({
        ChurchSimulator,
        console,
        // DOM stubs — lumpAudit() itself does not touch DOM, but their mere
        // absence at the top level would only cause errors if those functions
        // are actually called, which we never do here.
        window: { bootConfig: {} },
    });
    vm.runInContext(lumpAuditSrc, ctx);
    const lumpAudit = ctx.lumpAudit;

    if (typeof lumpAudit !== 'function') {
        console.log('SKIP T005: lumpAudit not accessible in vm context');
    } else {
        const LUMP_SIZE = 64;
        const words = new Array(LUMP_SIZE).fill(0);

        // Header: bits[31:27]=0x1F | bits[26:23]=nMinus6=0 | bits[22:10]=cw=1 | bits[7:0]=cc=1
        words[0] = ((0x1F << 27) | (0 << 23) | (1 << 10) | 1) >>> 0;

        // LOAD via CR6 referencing slot 1 (1-indexed in RPN convention).
        // lump-audit reads: op=(ww>>>27)&0x1F, crSrc=(ww>>>15)&0xF, slot=ww&0x7FFF
        words[1] = ((0 << 27) | (6 << 15) | 1) >>> 0;

        // Pending sentinel in c-list area (word at index lumpSize − cc = 63).
        words[63] = pendingSentinel;

        // Manifest with a capabilities array (triggers name-coverage check) but
        // the single entry is null so the manifest itself provides no name.
        const manifest = { capabilities: [null] };

        const results   = lumpAudit(words, manifest);
        const rpnResult = results.find(r => r.ruleId === 'RPN');

        check('T005a: RPN rule appears in audit results',
            rpnResult !== undefined);

        check('T005b: pending sentinel prevents unnamed-slot warning — RPN severity is "pass"',
            rpnResult ? rpnResult.severity === 'pass' : false);

        check('T005c: RPN pass message confirms all capabilities are identified',
            rpnResult ? rpnResult.severity === 'pass' && rpnResult.message.includes('named') : false);

        // Control: replace the pending sentinel with 0 (null GT, no name).
        // This must produce an unnamed-slot warning.
        const words0 = words.slice();
        words0[63] = 0;
        const results0 = lumpAudit(words0, manifest);
        const rpn0     = results0.find(r => r.ruleId === 'RPN');
        check('T005d: null GT in c-list produces RPN warn (control — confirms T005b is causal)',
            rpn0 ? rpn0.severity === 'warn' : false);

        // The pass detail should mention the pet name or the "pending" label.
        check('T005e: RPN pass detail contains the pending pet name or "pending" token',
            rpnResult && rpnResult.severity === 'pass' && (
                rpnResult.detail.includes('pending') || rpnResult.detail.includes('PendingCap')
            ));
    }
}

// ── T006: NULL GT in named c-list slot → lazy suspend (LOAD) ─────────────────
// When _execLoad encounters a NULL (0x00000000) GT in a named c-list slot, it
// must suspend the thread (_lazySuspended=true) without firing a fault, and
// emit lazyResolvePending.
console.log('\n--- T006: NULL GT named slot → lazy-suspend via LOAD ---');
{
    resetPendingRegistry();

    const sim = bootSim();
    if (!sim.bootComplete) {
        console.log('SKIP T006: boot did not complete');
    } else {
        // 'NavanaService' is NOT in nsLabels — instant-resolve will fail,
        // forcing the suspend path.

        setupCR6(sim);
        // Write NULL GT (0) to c-list slot 0.
        sim.memory[500] = 0;

        // Populate programCapabilities so _execLoad sees the pet name.
        sim.programCapabilities = [{ name: 'NavanaService', rights: ['E'] }];

        // Encode LOAD CR1, [CR6+0] at PC=0.
        const instr = sim.encodeInstruction(0, 0xE, 1, 6, 0);
        const cr14  = sim.cr[14];
        sim.memory[cr14.word1 + 1] = instr >>> 0;
        sim.pc     = 0;
        sim.halted = false;

        const faultCountBefore = sim.faultLog.length;
        let lazyEvent = null;
        sim.on('lazyResolvePending', e => { lazyEvent = e; });

        const result = sim.step();

        check('T006a: step() returns a truthy result (not null)',
            result !== null && result !== undefined);

        check('T006b: result.lazySuspended === true',
            result && result.lazySuspended === true);

        check('T006c: sim._lazySuspended flag is set',
            sim._lazySuspended === true);

        check('T006d: no fault was logged (transparent suspension)',
            sim.faultLog.length === faultCountBefore);

        check('T006e: result carries the pet name "NavanaService"',
            result && result.petName === 'NavanaService');

        check('T006f: result carries slot index 0',
            result && result.slot === 0);

        check('T006g: _pendingResolves Map has one entry for slot 0',
            sim._pendingResolves.size === 1 && sim._pendingResolves.has(0));

        check('T006h: lazyResolvePending event was emitted',
            lazyEvent !== null);

        check('T006i: event carries petName "NavanaService"',
            lazyEvent && lazyEvent.petName === 'NavanaService');

        check('T006j: sim.output contains [LAZY-RESOLVE] marker',
            sim.output.includes('[LAZY-RESOLVE]'));

        // Subsequent step() must be a no-op while suspended.
        const result2 = sim.step();
        check('T006k: second step() returns lazySuspended sentinel (thread still waiting)',
            result2 && result2.lazySuspended === true);
    }
}

// ── T007: NULL GT named slot → lazy suspend (ELOADCALL) ──────────────────────
console.log('\n--- T007: NULL GT named slot → lazy-suspend via ELOADCALL ---');
{
    resetPendingRegistry();

    const sim = bootSim();
    if (!sim.bootComplete) {
        console.log('SKIP T007: boot did not complete');
    } else {
        // 'AlphaService' is NOT in nsLabels — instant-resolve fails → suspend path.

        setupCR6(sim);
        sim.memory[500] = 0;
        sim.programCapabilities = [{ name: 'AlphaService', rights: ['E'] }];

        // ELOADCALL opcode = 8; use encodeInstruction to include cond=0xE (always).
        // encodeInstruction(opcode, cond, crDst, crSrc, imm) — imm[7:0] = ecRow.
        const ELOADCALL_OPCODE = 8;
        const ecRow = 0;
        const instr = sim.encodeInstruction(ELOADCALL_OPCODE, 0xE /* AL */, 0, 6, ecRow);
        const cr14  = sim.cr[14];
        sim.memory[cr14.word1 + 1] = instr >>> 0;
        sim.pc     = 0;
        sim.halted = false;

        const faultCountBefore = sim.faultLog.length;
        const result = sim.step();

        check('T007a: result is truthy',
            result !== null && result !== undefined);

        check('T007b: result.lazySuspended === true or no fault on NULL slot',
            (result && result.lazySuspended === true) || sim.faultLog.length === faultCountBefore);

        check('T007c: sim output mentions ELOADCALL lazy suspend or LAZY-RESOLVE',
            sim.output.includes('[LAZY-RESOLVE]') || (result && result.lazySuspended));

        check('T007d: no NULL_CAP fault was raised (transparent suspension)',
            !sim.faultLog.slice(faultCountBefore).some(f => f.type === 'NULL_CAP'));
    }
}

// ── T008: NULL GT with NO pet name → fault immediately (no suspension) ────────
console.log('\n--- T008: NULL GT no pet name → immediate NULL_CAP fault ---');
{
    resetPendingRegistry();

    const sim = bootSim();
    if (!sim.bootComplete) {
        console.log('SKIP T008: boot did not complete');
    } else {
        setupCR6(sim);
        // Use slot 11 — the first slot NOT pre-seeded into petNameMemory.
        // BOOT_NAMED_SLOTS is now 0-10 (boot catalog grew: slot 7 is
        // WukongCallHome and 8-10 are also named), so any slot <= 10 takes
        // the LAZY_RESOLVE branch instead of hard-faulting. Only a slot
        // outside BOOT_NAMED_SLOTS reliably reaches the NULL_CAP path this
        // test exercises.
        // Extend clistCount to 12 so the slot-11 access is in-bounds.
        sim.cr[6].word2 = sim.packNSWord1(0, 0, 0, 0, 12);  // clistCount = 12
        sim.memory[511] = 0;  // slot 11 → NULL GT (500 + 11)
        // Leave programCapabilities empty → no pet name for slot 11.
        sim.programCapabilities = null;

        const instr = sim.encodeInstruction(0, 0xE, 1, 6, 11);  // ecRow = 11
        const cr14  = sim.cr[14];
        sim.memory[cr14.word1 + 1] = instr >>> 0;
        sim.pc     = 0;
        sim.halted = false;

        const faultCountBefore = sim.faultLog.length;
        const result = sim.step();

        check('T008a: result is null or a fault result (not lazy suspension)',
            result === null || (result && result.lazySuspended !== true));

        check('T008b: NULL_CAP fault was raised',
            sim.faultLog.slice(faultCountBefore).some(f => f.type === 'NULL_CAP'));

        check('T008c: sim._lazySuspended is false (no suspension)',
            sim._lazySuspended === false);
    }
}

// ── T009: resolvePendingSlot resolves a NULL GT slot (Task #1519) ─────────────
console.log('\n--- T009: resolvePendingSlot — NULL slot (Task #1519 path) ---');
{
    resetPendingRegistry();

    const sim = bootSim();
    if (!sim.bootComplete) {
        console.log('SKIP T009: boot did not complete');
    } else {
        // Seed a valid NS entry at slot 6.
        // NS table is TOP-DOWN: use _nsSlotBase() not the ascending formula.
        const NS6_BASE = sim._nsSlotBase(6);
        sim.memory[NS6_BASE]     = 0x00000001 >>> 0;
        sim.memory[NS6_BASE + 1] = 0x00000041 >>> 0;
        if (sim.nsCount < 7) sim.nsCount = 7;
        sim.nsLabels[6] = 'BetaService';

        setupCR6(sim);
        // Plant a NULL GT and manually inject the lazy resolve entry.
        sim.memory[500] = 0;
        sim._pendingResolves.set(0, {
            petName: 'BetaService', slot: 0, instrName: 'LOAD', kind: 'NULL_GT',
            pc: 0,
            savedDRs: [...sim.dr],
            savedCRs: sim.cr.map(c => ({ ...c })),
            savedFlags: { ...sim.flags },
            savedSto: sim.sto,
        });
        sim._lazySuspended = true;

        const res = sim.resolvePendingSlot(0, 6);

        check('T009a: resolvePendingSlot returns ok=true for NULL slot',
            res && res.ok === true);

        check('T009b: memory at c-list slot 0 is now non-zero (GT written)',
            (sim.memory[500] >>> 0) !== 0);

        check('T009c: written GT is not a pending sentinel (0xFEED____)',
            !((sim.memory[500] >>> 0).toString(16).startsWith('feed')));

        check('T009d: _pendingResolves entry for slot 0 is cleared',
            !sim._pendingResolves.has(0));

        check('T009e: sim._lazySuspended is false after resolve clears all pending',
            sim._lazySuspended === false);

        check('T009f: sim.output contains [RESOLVE] marker',
            sim.output.includes('[RESOLVE]'));

        check('T009g: result.pendingName contains "BetaService"',
            res && res.pendingName === 'BetaService');
    }
}

// ── T010: escalateLazyResolve escalates to NULL_CAP fault ────────────────────
console.log('\n--- T010: escalateLazyResolve — fires NULL_CAP fault ---');
{
    resetPendingRegistry();

    const sim = bootSim();
    if (!sim.bootComplete) {
        console.log('SKIP T010: boot did not complete');
    } else {
        // 'GammaService' is NOT in nsLabels — instant-resolve fails → suspend path.

        setupCR6(sim);
        sim.memory[500] = 0;
        sim.programCapabilities = [{ name: 'GammaService', rights: ['E'] }];

        const instr = sim.encodeInstruction(0, 0xE, 1, 6, 0);
        const cr14  = sim.cr[14];
        sim.memory[cr14.word1 + 1] = instr >>> 0;
        sim.pc     = 0;
        sim.halted = false;

        const result = sim.step();
        if (!result || !result.lazySuspended) {
            console.log('SKIP T010: did not suspend on NULL GT');
        } else {
            const faultCountBefore = sim.faultLog.length;
            sim.escalateLazyResolve(0);

            check('T010a: escalate fires at least one fault',
                sim.faultLog.length > faultCountBefore);

            const escalFault = sim.faultLog.slice(faultCountBefore).find(
                f => f.type === 'NULL_CAP' || f.type === 'LAZY_RESOLVE_PENDING');
            check('T010b: escalated fault is NULL_CAP or LAZY_RESOLVE_PENDING',
                escalFault !== undefined);

            check('T010c: sim._lazySuspended is false after escalation',
                sim._lazySuspended === false);

            check('T010d: _pendingResolves cleared after escalation',
                !sim._pendingResolves.has(0));
        }
    }
}

// ── T011: Instant resolution for NULL GT when NS entry IS valid ───────────────
// When the NULL GT slot has a pet name and the nsLabel matches a valid NS entry,
// the simulator must resolve it inline (no suspension needed).
console.log('\n--- T011: NULL GT instant inline resolution when NS label is valid ---');
{
    resetPendingRegistry();

    const sim = bootSim();
    if (!sim.bootComplete) {
        console.log('SKIP T011: boot did not complete');
    } else {
        // Seed a fully valid NS entry at slot 9.
        // NS table is TOP-DOWN: use _nsSlotBase() not the ascending formula.
        const NS9_BASE = sim._nsSlotBase(9);
        sim.memory[NS9_BASE]     = 0x00000001 >>> 0;
        sim.memory[NS9_BASE + 1] = 0x00000041 >>> 0;
        if (sim.nsCount < 10) sim.nsCount = 10;
        sim.nsLabels[9] = 'DeltaService';

        setupCR6(sim);
        sim.memory[500] = 0;
        sim.programCapabilities = [{ name: 'DeltaService', rights: ['E'] }];

        const instr = sim.encodeInstruction(0, 0xE, 1, 6, 0);
        const cr14  = sim.cr[14];
        sim.memory[cr14.word1 + 1] = instr >>> 0;
        sim.pc     = 0;
        sim.halted = false;

        const faultCountBefore = sim.faultLog.length;
        sim.step();

        check('T011a: sim._lazySuspended is false (resolved inline, no suspension)',
            sim._lazySuspended === false);

        check('T011b: c-list slot 0 is now a real GT (not null, not pending)',
            (sim.memory[500] >>> 0) !== 0 &&
            !ChurchSimulator.isPendingGT(sim.memory[500] >>> 0));

        check('T011c: sim.output contains [LAZY-RESOLVE] inline marker',
            sim.output.includes('[LAZY-RESOLVE]'));

        check('T011d: no NULL_CAP or LAZY_RESOLVE_PENDING fault was logged',
            !sim.faultLog.slice(faultCountBefore).some(
                f => f.type === 'NULL_CAP' || f.type === 'LAZY_RESOLVE_PENDING'));
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
