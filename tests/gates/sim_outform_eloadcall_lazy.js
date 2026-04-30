'use strict';
// Headless harness used to gate the Mode 2 (Outform) lazy-load path in
// _execEloadcall.
//
// Verifies that ELOADCALL — a fused LOAD+TPERM+CALL instruction (opcode 8) —
// correctly intercepts an Outform GT (type=2) in the source c-list slot and
// triggers the Mode 2 lazy loader before the TPERM and CALL phases execute.
//
//   1. A c-list slot whose GT carries type=2 (Outform) fires the Mode 2
//      intercept inside _execEloadcall, not just inside _execLoad / _execCall.
//
//   2. After the lazy load, the in-flight slot GT is promoted Outform→Inform
//      so the TPERM check (mLoad 'E') succeeds on a valid Inform GT.
//
//   3. lazyManifest[slot].loaded is true and NS word1 gtType is 1 (Inform)
//      after the instruction completes.
//
//   4. A plain Inform GT in the same c-list slot does NOT trigger Mode 2.
//
// Exits with code 0 on success, 1 on failure (errors written to stderr).

global.window = { bootConfig: {} };

const ChurchSimulator = require('../../simulator/simulator.js');

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
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

// ─── Helper: initialise CR6 to a valid c-list capability ─────────────────────
//
// After a full boot with cc=0 (no c-list in the default boot entry), the
// NUC_CLIST step sets CR6 to all-zeros.  ELOADCALL [CR6 + n] then faults with
// NULL_CAP before reaching the Mode 2 path under test.
//
// This helper points CR6 at a 2-slot scratch region starting at address 500
// (safely between the code buffer at ~384 and the NS table at 64512).  The
// region is zeroed by default and can be populated by the test before the
// ELOADCALL instruction fires.

function setupCR6(sim) {
    const slotIdx = sim.bootEntrySlot;
    const nsBase  = sim.NS_TABLE_BASE + slotIdx * sim.NS_ENTRY_WORDS;
    const gt_seq  = (sim.memory[nsBase + 2] >>> 25) & 0x7F;
    const eGT     = sim.createGT(gt_seq, slotIdx, { E: 1 }, 1);
    sim.cr[6] = {
        word0: eGT,
        word1: 500,
        word2: sim.packNSWord1(0, 0, 0, 0, 0, 1, 2),
        word3: 0,
        m:     0,
    };
}

// ─── Test 1: ELOADCALL on Outform GT fires Mode 2 loader ─────────────────────
//
// Writes an Outform GT (type=2) for NS[16] into c-list offset 1 of CR6,
// then executes ELOADCALL CR0, [CR6 + 1].  Verifies that the Mode 2 loader
// fires, the instruction completes without fault, and NS[16] is promoted.

(function testEloadcallOutformMode2() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Boot did not complete for ELOADCALL Outform Mode 2 test');
        return;
    }

    const slideRule = BOOT_UPLOADS.find(b => b.index === 16);
    if (!slideRule) {
        fail('SlideRule (index=16) not found in BOOT_UPLOADS');
        return;
    }

    setupCR6(sim);

    // Register slot 16 as cold; initLazyManifest writes gtType=2 into NS word1.
    sim.initLazyManifest({
        16: {
            priority: 'cold',
            label:    'SlideRule',
            source:   'boot_upload',
            bootUpload: slideRule,
        }
    });

    // Confirm NS[16] is now Outform (gtType=2).
    const nsBase = sim.NS_TABLE_BASE + 16 * sim.NS_ENTRY_WORDS;
    const w1cold = sim.parseNSWord1(sim.memory[nsBase + 1]);
    if (w1cold.gtType !== 2) {
        fail(`Pre-condition: NS[16] gtType should be 2, got ${w1cold.gtType}`);
        return;
    }

    // Build an Outform GT (type=2) for NS slot 16 with Enter permission.
    const nsW2 = sim.memory[nsBase + 2];
    const gt_seq = (nsW2 >>> 25) & 0x7F;
    const outformGT = sim.createGT(gt_seq, 16, { E: 1 }, 2);

    const parsedBefore = sim.parseGT(outformGT);
    if (parsedBefore.type !== 2) {
        fail(`Outform GT type should be 2, got ${parsedBefore.type}`);
        return;
    }

    // Write the Outform GT into c-list slot 1 of CR6.
    // (Slot 0 is the CLOOMC entry; slot 1 is safe for test manipulation.)
    const clistBase = sim.cr[6].word1;
    sim.memory[clistBase + 1] = outformGT >>> 0;

    // Encode ELOADCALL CR0, [CR6 + 1]  (opcode=8, cond=AL=0xE, crDst=0, crSrc=6, imm=1).
    const ELOADCALL_OPCODE = 8;
    const eloadcallInstr = sim.encodeInstruction(ELOADCALL_OPCODE, 0xE /* AL */, 0, 6, 1);
    const codeBase = sim.cr[14].word1;
    sim.memory[codeBase + 1] = eloadcallInstr >>> 0;
    sim.pc = 0;
    sim.halted = false;

    const outputBefore = sim.output;
    const faultsBefore = sim.faultLog.length;

    sim.step();

    const newOutput = sim.output.slice(outputBefore.length);
    const newFaults = sim.faultLog.slice(faultsBefore);

    // (a) Mode 2 loader log line must have fired.
    if (!newOutput.includes(`[LOADER] ELOADCALL: c-list [CR6 + 1] is Outform GT (NS[16])`)) {
        fail('Mode 2 loader log line not found in output after ELOADCALL on Outform GT\n' +
             'Output delta:\n' + newOutput);
        return;
    }

    // (b) No faults — the Mode 2 intercept must prevent any TYPE or SEAL fault.
    if (newFaults.length > 0) {
        fail('Unexpected fault after ELOADCALL on Outform GT: ' +
             newFaults.map(f => `${f.type}: ${f.message}`).join('; '));
        return;
    }

    // (c) lazyManifest[16].loaded must be true after the lazy load completed.
    if (!sim.lazyManifest[16] || !sim.lazyManifest[16].loaded) {
        fail('lazyManifest[16].loaded is not true after ELOADCALL on Outform GT');
        return;
    }

    // (d) NS[16] word1 gtType must now be 1 (Inform) after promotion.
    const w1after = sim.parseNSWord1(sim.memory[nsBase + 1]);
    if (w1after.gtType !== 1) {
        fail(`Expected NS[16] gtType=1 (Inform) after Mode 2 ELOADCALL, got ${w1after.gtType}`);
        return;
    }

    // (e) Output must contain the ELOADCALL completion descriptor, proving the
    //     instruction ran through the full LOAD+TPERM+CALL path successfully.
    if (!newOutput.includes('ELOADCALL CR0, [CR6 + 1]') &&
        !newOutput.includes('LOAD+TPERM+CALL')) {
        fail('ELOADCALL completion descriptor not found in output — instruction may not have completed\n' +
             'Output delta:\n' + newOutput);
        return;
    }

    console.log('[PASS] ELOADCALL on Outform GT: Mode 2 lazy load fired, lump installed, NS[16] promoted to Inform');
    console.log('[PASS] lazyManifest[16].loaded = true, NS[16] word1 gtType = 1 (Inform)');
})();

// ─── Test 2: ELOADCALL on Inform GT does NOT trigger Mode 2 ──────────────────
//
// Registers slot 16 as warm (Inform stays in NS word1), writes a normal
// Inform GT into the c-list slot, and verifies Mode 2 log is absent.

(function testEloadcallInformNoMode2() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Boot did not complete for ELOADCALL Inform (no Mode 2) test');
        return;
    }

    const slideRule = BOOT_UPLOADS.find(b => b.index === 16);
    if (!slideRule) {
        fail('SlideRule (index=16) not found in BOOT_UPLOADS');
        return;
    }

    setupCR6(sim);

    // Register as warm so NS entry stays Inform (gtType=1).
    sim.initLazyManifest({
        16: {
            priority: 'warm',
            label:    'SlideRule',
            source:   'boot_upload',
            bootUpload: slideRule,
        }
    });

    const nsBase = sim.NS_TABLE_BASE + 16 * sim.NS_ENTRY_WORDS;
    const w1 = sim.parseNSWord1(sim.memory[nsBase + 1]);
    if (w1.gtType !== 1) {
        fail(`Pre-condition: warm NS[16] should remain gtType=1, got ${w1.gtType}`);
        return;
    }

    // Build a normal Inform GT (type=1) with Enter permission.
    const nsW2 = sim.memory[nsBase + 2];
    const gt_seq = (nsW2 >>> 25) & 0x7F;
    const informGT = sim.createGT(gt_seq, 16, { E: 1 }, 1);

    const clistBase = sim.cr[6].word1;
    sim.memory[clistBase + 1] = informGT >>> 0;

    const ELOADCALL_OPCODE = 8;
    const eloadcallInstr = sim.encodeInstruction(ELOADCALL_OPCODE, 0xE /* AL */, 0, 6, 1);
    const codeBase = sim.cr[14].word1;
    sim.memory[codeBase + 1] = eloadcallInstr >>> 0;
    sim.pc = 0;
    sim.halted = false;

    const outputBefore = sim.output;

    sim.step();

    const newOutput = sim.output.slice(outputBefore.length);

    // Must NOT contain the Mode 2 log line.
    if (newOutput.includes('[LOADER] ELOADCALL: c-list') &&
        newOutput.includes('is Outform GT')) {
        fail('Mode 2 loader incorrectly triggered for an Inform GT in ELOADCALL');
        return;
    }

    console.log('[PASS] ELOADCALL on Inform GT: Mode 2 path not triggered');
})();

// ─── Test 3: Outform intercept fires even when lump already installed ─────────
//
// After a first ELOADCALL installs the lump (lazyManifest[16].loaded = true),
// the c-list slot still holds the stale Outform GT.  A second ELOADCALL from
// the same slot must still promote the GT to Inform and complete without fault.

(function testEloadcallOutformAlreadyLoaded() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Boot did not complete for ELOADCALL already-loaded Outform test');
        return;
    }

    const slideRule = BOOT_UPLOADS.find(b => b.index === 16);
    if (!slideRule) {
        fail('SlideRule (index=16) not found in BOOT_UPLOADS');
        return;
    }

    setupCR6(sim);

    sim.initLazyManifest({
        16: {
            priority: 'cold',
            label:    'SlideRule',
            source:   'boot_upload',
            bootUpload: slideRule,
        }
    });

    const nsBase = sim.NS_TABLE_BASE + 16 * sim.NS_ENTRY_WORDS;
    const nsW2 = sim.memory[nsBase + 2];
    const gt_seq = (nsW2 >>> 25) & 0x7F;
    const outformGT = sim.createGT(gt_seq, 16, { E: 1 }, 2);

    const clistBase = sim.cr[6].word1;
    sim.memory[clistBase + 1] = outformGT >>> 0;

    const ELOADCALL_OPCODE = 8;
    const eloadcallInstr = sim.encodeInstruction(ELOADCALL_OPCODE, 0xE /* AL */, 0, 6, 1);
    const codeBase = sim.cr[14].word1;
    sim.memory[codeBase + 1] = eloadcallInstr >>> 0;

    // First ELOADCALL — triggers Mode 2 loader.
    sim.pc = 0;
    sim.halted = false;
    sim.step();

    if (!sim.lazyManifest[16] || !sim.lazyManifest[16].loaded) {
        fail('First ELOADCALL: lazyManifest[16].loaded is not true after Mode 2 load');
        return;
    }

    // Confirm c-list slot still holds the stale Outform GT.
    const slotAfterFirst = sim.parseGT(sim.memory[clistBase + 1]);
    if (slotAfterFirst.type !== 2) {
        fail(`Expected c-list slot 1 to still hold Outform GT (type=2) after first ELOADCALL, got type=${slotAfterFirst.type}`);
        return;
    }

    // Second ELOADCALL from the same slot (lump already installed, slot unchanged).
    sim.memory[codeBase + 1] = eloadcallInstr >>> 0;
    sim.pc = 0;
    sim.halted = false;
    const faultsBefore = sim.faultLog.length;
    sim.step();

    const newFaults = sim.faultLog.slice(faultsBefore);
    if (newFaults.length > 0) {
        fail('Second ELOADCALL: unexpected fault: ' +
             newFaults.map(f => `${f.type}: ${f.message}`).join('; '));
        return;
    }

    console.log('[PASS] Repeated ELOADCALL from stale Outform c-list slot: completes without fault on both calls');
})();

// ─── Report ──────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    for (const e of ERRORS) process.stderr.write('[FAIL] ' + e + '\n');
    process.exit(1);
}
process.exit(0);
