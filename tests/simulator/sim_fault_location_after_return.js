'use strict';
// Headless harness used by tests/simulator/test_fault_location_after_return.py.
//
// Regression test for the analogous bug class identified in Task #653: after a
// RETURN that crosses a lump boundary back to the caller's lump, any subsequent
// fault must be attributed to the caller's (boot-entry) lump — not to the lump
// that was executing before the RETURN.
//
// The mechanism is the same as the Task #649 fix: crSnapshot[14] is captured
// at fault time, so its word0 & 0xFFFF gives the NS index of the lump that was
// current when the fault occurred, and word1 gives that lump's base address.
//
// Test plan:
//   1. Boot the simulator.
//   2. Load the SlideRule lump (NS slot 16) so it is resident in memory.
//   3. Execute a CALL E-GT instruction that switches CR14 from the boot-entry
//      lump to SlideRule (push a call-stack frame saving the boot-entry state).
//   4. Write a RETURN instruction at SlideRule's first instruction slot and
//      execute it, which pops the frame and restores CR14 to the boot-entry lump.
//   5. Verify CR14 now names the boot-entry lump (not SlideRule).
//   6. Trigger a NULL_CAP fault inside the boot-entry lump by nulling CR0 and
//      writing CALL CR0 at the boot-entry's first instruction slot.
//   7. Assert that crSnapshot[14].word0 & 0xFFFF equals the boot-entry NS slot,
//      not 16 (SlideRule).
//   8. Assert the lump base offset is non-negative and within the boot-entry lump.
//
// Exits with code 0 on success, 1 on failure (errors written to stderr).

global.window = { bootConfig: {} };

const ChurchSimulator = require('../../simulator/simulator.js');
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// Load boot_uploads.js so the BOOT_UPLOADS global is available.
const bootUploadsCode = fs.readFileSync(
    path.join(__dirname, '..', '..', 'simulator', 'boot_uploads.js'), 'utf8');
vm.runInThisContext(bootUploadsCode);

const ERRORS = [];
function fail(msg) { ERRORS.push(msg); }

// ─── Helper: fully boot the simulator ────────────────────────────────────────

function bootSim() {
    const sim = new ChurchSimulator();
    let steps = 0;
    while (!sim.bootComplete && !sim.halted && steps < 300) {
        sim._bootStep();
        steps++;
    }
    return sim;
}

// ─── Test: fault after RETURN is attributed to the caller's (boot-entry) lump ─

(function testFaultLocationAfterReturn() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Boot did not complete: ' +
             (sim.faultLog && sim.faultLog.length
                 ? sim.faultLog[sim.faultLog.length - 1].message
                 : '(no fault)'));
        return;
    }

    // ── Step 1: Install SlideRule lump (NS slot 16) into memory ──────────────
    const slideRule = BOOT_UPLOADS.find(b => b.index === 16);
    if (!slideRule) {
        fail('SlideRule (index=16) not found in BOOT_UPLOADS');
        return;
    }

    sim.initLazyManifest({
        16: {
            priority: 'warm',
            label:    'SlideRule',
            source:   'boot_upload',
            bootUpload: slideRule,
        }
    });

    const loadOk = sim.lazyLoad(16);
    if (!loadOk) {
        fail('lazyLoad(16) failed — SlideRule lump could not be installed');
        return;
    }

    // ── Step 2: Record boot-entry context before the CALL ────────────────────
    const bootEntryNsIdx  = sim.cr[14].word0 & 0xFFFF;
    const bootCodeBase    = sim.cr[14].word1 >>> 0;
    const bootEntryLabel  = (sim.nsLabels && sim.nsLabels[bootEntryNsIdx])
        || ('NS[' + bootEntryNsIdx + ']');

    // ── Step 3: Build an E-GT for NS[16] and put it in CR1, then CALL ────────
    const nsW2   = sim.memory[sim.NS_TABLE_BASE + 16 * sim.NS_ENTRY_WORDS + 2];
    const gt_seq = (nsW2 >>> 25) & 0x7F;
    const eGT16  = sim.createGT(gt_seq, 16, { E: 1 }, 1);
    sim.cr[1].word0 = eGT16;

    // Clear the M-bit so the CALL proceeds cleanly without a writeback stall.
    if (sim.cr[15]) sim.cr[15].m = 0;

    const CALL_OPCODE   = 2;
    const RETURN_OPCODE = 3;

    // Write CALL AL, CR1, CR1 at the boot-entry lump's first instruction slot.
    sim.memory[bootCodeBase + 1] = sim.encodeInstruction(CALL_OPCODE, 0xE, 1, 0, 0);

    sim.pc     = 0;
    sim.halted = false;

    const faultsBefore = sim.faultLog.length;
    sim.step();   // Execute CALL CR1 — switches CR14 to SlideRule

    if (sim.faultLog.length > faultsBefore) {
        const f = sim.faultLog[faultsBefore];
        fail('CALL to SlideRule (NS[16]) faulted unexpectedly: [' + f.type + '] ' + f.message);
        return;
    }

    // Confirm CR14 now points to SlideRule before attempting the RETURN.
    const cr14AfterCall   = sim.cr[14];
    const cr14NsIdxAfterCall = cr14AfterCall.word0 & 0xFFFF;
    if (cr14NsIdxAfterCall !== 16) {
        fail('After CALL, CR14 should point to NS[16] (SlideRule), but word0 & 0xFFFF = ' +
             cr14NsIdxAfterCall);
        return;
    }

    const slideRuleBase = cr14AfterCall.word1 >>> 0;

    // ── Step 4: Write RETURN at SlideRule's first slot and execute it ─────────
    // cond = 0xE (AL = always), imm = 0 (no mask — preserve all caller CRs).
    sim.memory[slideRuleBase + 1] = sim.encodeInstruction(RETURN_OPCODE, 0xE, 0, 0, 0);

    sim.pc     = 0;
    sim.halted = false;

    const faultsBefore2 = sim.faultLog.length;
    sim.step();   // Execute RETURN — pops frame, restores CR14 to boot-entry lump

    if (sim.faultLog.length > faultsBefore2) {
        const f = sim.faultLog[faultsBefore2];
        fail('RETURN from SlideRule faulted unexpectedly: [' + f.type + '] ' + f.message);
        return;
    }

    // ── Step 5: Verify CR14 has been restored to the boot-entry lump ──────────
    const cr14AfterReturn    = sim.cr[14];
    const cr14NsIdxAfterRet  = cr14AfterReturn.word0 & 0xFFFF;

    if (cr14NsIdxAfterRet === 16) {
        fail(
            'After RETURN, CR14 still names SlideRule (NS[16]) — ' +
            'the RETURN did not restore the caller\'s lump context'
        );
        return;
    }

    if (cr14NsIdxAfterRet !== bootEntryNsIdx) {
        fail(
            'After RETURN, CR14 names NS[' + cr14NsIdxAfterRet + '] ' +
            '("' + (sim.nsLabels[cr14NsIdxAfterRet] || '?') + '") — ' +
            'expected NS[' + bootEntryNsIdx + '] (boot-entry: "' + bootEntryLabel + '")'
        );
        return;
    }

    console.log('[PASS] After RETURN, CR14 correctly restored to boot-entry NS[' +
                bootEntryNsIdx + '] ("' + bootEntryLabel + '")');

    // ── Step 6: Trigger a NULL_CAP fault inside the boot-entry lump ───────────
    // Null CR0, write CALL CR0 at the boot-entry's first instruction slot.
    sim.cr[0] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };
    sim.memory[bootCodeBase + 1] = sim.encodeInstruction(CALL_OPCODE, 0xE, 0, 0, 0);

    sim.pc     = 0;
    sim.halted = false;

    const faultsBefore3 = sim.faultLog.length;
    sim.step();   // Fetch from boot-entry slot 0; CALL CR0 (null) → NULL_CAP
    const newFaults = sim.faultLog.slice(faultsBefore3);

    if (newFaults.length === 0) {
        fail('Expected a NULL_CAP fault in the boot-entry lump, but no fault was recorded');
        return;
    }

    const f = newFaults[0];

    // ── Step 7: Core assertion — crSnapshot[14] names the boot-entry lump ─────
    if (!f.crSnapshot || !f.crSnapshot[14]) {
        fail('Fault entry is missing crSnapshot[14]');
        return;
    }

    const faultCR14  = f.crSnapshot[14];
    const faultNsIdx = faultCR14.word0 & 0xFFFF;

    if (faultNsIdx === 16) {
        fail(
            'crSnapshot[14] reports NS[16] (SlideRule) — fault incorrectly attributed to the ' +
            'lump that executed before the RETURN (SlideRule), not the caller\'s boot-entry lump. ' +
            'This is the class of bug Task #653 guards against.'
        );
        return;
    }

    if (faultNsIdx !== bootEntryNsIdx) {
        fail(
            'crSnapshot[14] reports NS[' + faultNsIdx + '] ' +
            '("' + (sim.nsLabels[faultNsIdx] || '?') + '") — ' +
            'expected boot-entry NS[' + bootEntryNsIdx + '] ("' + bootEntryLabel + '")'
        );
        return;
    }

    const faultLabel = (sim.nsLabels && sim.nsLabels[faultNsIdx]) || ('NS[' + faultNsIdx + ']');
    console.log('[PASS] crSnapshot[14] correctly names boot-entry NS[' + faultNsIdx + '] ' +
                '("' + faultLabel + '") after RETURN from SlideRule');

    // ── Step 8: Offset is non-negative and within the boot-entry lump ─────────
    const faultBase = faultCR14.word1 >>> 0;
    const faultPC   = (f.physicalPC !== undefined && f.physicalPC !== null)
        ? f.physicalPC >>> 0
        : f.pc;
    const offset = faultPC - faultBase;

    if (offset < 0) {
        fail('Fault offset is negative (' + offset + '): physicalPC=0x' +
             faultPC.toString(16) + ' base=0x' + faultBase.toString(16) +
             ' — offset is not relative to the boot-entry lump');
        return;
    }

    const nsEntry  = sim.readNSEntry(bootEntryNsIdx);
    const lumpSize = nsEntry ? (nsEntry.word1_limit & 0x1FFFF) : 256;
    if (offset >= lumpSize) {
        fail('Fault offset ' + offset + ' exceeds boot-entry lump size ' + lumpSize +
             ' — offset is not relative to the boot-entry lump base');
        return;
    }

    console.log('[PASS] Fault offset ' + offset + ' is within boot-entry lump (size ' + lumpSize + ')');
    console.log('[PASS] physicalPC=0x' + faultPC.toString(16) +
                ', base=0x' + faultBase.toString(16));
})();

// ─── Second assertion: boot-entry and SlideRule have different labels ─────────
//
// Confirms the test has discriminating power: if both lumps had the same label
// the NS-index assertions above could pass spuriously.

(function testBootSlotAndSlideRuleHaveDifferentLabels() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Boot did not complete for label-discrimination test');
        return;
    }

    const bootLabel  = sim.nsLabels[sim.bootEntrySlot] || ('NS[' + sim.bootEntrySlot + ']');
    const slideLabel = sim.nsLabels[16] || 'NS[16]';

    if (bootLabel === slideLabel) {
        fail('Boot-entry label ("' + bootLabel + '") equals SlideRule label — ' +
             'test has no discriminating power against the wrong-lump-after-RETURN bug');
        return;
    }

    console.log('[PASS] Boot-entry label "' + bootLabel +
                '" differs from SlideRule label "' + slideLabel + '"');
    console.log('[PASS] Fault-location assertions in the primary test have discriminating power');
})();

// ─── Report ──────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    for (const e of ERRORS) process.stderr.write('[FAIL] ' + e + '\n');
    process.exit(1);
}
process.exit(0);
