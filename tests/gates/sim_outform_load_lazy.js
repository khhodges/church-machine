'use strict';
// Headless harness used by tests/gates/test_outform_load_lazy.py.
//
// Verifies the Mode 2 (Outform) lazy-load path in _execLoad:
//
//   1. A c-list slot whose GT carries type=2 (Outform) triggers _dispatchLoaderLoad
//      when LOAD is executed.
//
//   2. After the lazy load completes the destination CR holds an Inform GT
//      (type=1), not the original Outform GT.
//
//   3. lazyManifest[slot].loaded is true after the LOAD instruction returns.
//
//   4. A plain Inform GT in the same c-list slot does NOT trigger the Mode 2
//      path — LOAD on an already-loaded slot succeeds normally.
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
// NUC_CLIST step sets CR6 to all-zeros.  LOAD [CR6 + n] then faults with
// NULL_CAP before reaching the Mode 2 path under test.
//
// This helper points CR6 at a 2-slot scratch region starting at address 500
// (safely between the code buffer at ~384 and the NS table at 64512).  The
// region is zeroed by default and can be populated by the test before the
// LOAD instruction fires.

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

// ─── Test 1: LOAD on Outform GT fires Mode 2 loader and CR holds Inform GT ───

(function testLoadOutformMode2() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Boot did not complete for LOAD Outform Mode 2 test');
        return;
    }

    const slideRule = BOOT_UPLOADS.find(b => b.index === 16);
    if (!slideRule) {
        fail('SlideRule (index=16) not found in BOOT_UPLOADS');
        return;
    }

    setupCR6(sim);

    // Register slot 16 as cold and call initLazyManifest (writes gtType=2 into NS word1).
    sim.initLazyManifest({
        16: {
            priority: 'cold',
            label:    'SlideRule',
            source:   'boot_upload',
            bootUpload: slideRule,
        }
    });

    // Confirm NS[16] is Outform (gtType=2).
    const nsBase = sim.NS_TABLE_BASE + 16 * sim.NS_ENTRY_WORDS;
    const w1cold = sim.parseNSWord1(sim.memory[nsBase + 1]);
    if (w1cold.gtType !== 2) {
        fail(`Pre-condition: NS[16] gtType should be 2, got ${w1cold.gtType}`);
        return;
    }

    // Build an Outform GT (type=2) for NS slot 16 and write it into the c-list
    // that CR6 points to (at offset 0 for simplicity).
    const nsW2 = sim.memory[nsBase + 2];
    const gt_seq = (nsW2 >>> 25) & 0x7F;
    const outformGT = sim.createGT(gt_seq, 16, { E: 1 }, 2);

    const parsedBefore = sim.parseGT(outformGT);
    if (parsedBefore.type !== 2) {
        fail(`Outform GT type should be 2, got ${parsedBefore.type}`);
        return;
    }

    // Write the Outform GT into c-list slot 1 (slot 0 is the CLOOMC entry and
    // requires X/RX permissions only; use slot 1 to avoid the DOMAIN_PURITY check).
    const clistBase = sim.cr[6].word1;
    sim.memory[clistBase + 1] = outformGT >>> 0;

    // Encode a LOAD instruction: LOAD CR0, [CR6 + 1]
    // crDst=0, crSrc=6, imm=1
    const LOAD_OPCODE = 0;
    const loadInstr = sim.encodeInstruction(LOAD_OPCODE, 0xE /* AL */, 0, 6, 1);
    const codeBase = sim.cr[14].word1;
    sim.memory[codeBase + 1] = loadInstr >>> 0;
    sim.pc = 0;
    sim.halted = false;

    const outputBefore = sim.output;
    const faultsBefore = sim.faultLog.length;

    sim.step();

    const newOutput = sim.output.slice(outputBefore.length);
    const newFaults = sim.faultLog.slice(faultsBefore);

    // (a) Loader log line must have fired.
    if (!newOutput.includes('[LOADER] LOAD: CR0 is Outform GT (NS[16])')) {
        fail('Mode 2 loader log line not found in output after LOAD CR0 (Outform GT)\n' +
             'Output delta:\n' + newOutput);
        return;
    }

    // (b) No faults.
    if (newFaults.length > 0) {
        fail('Unexpected fault after LOAD on Outform GT: ' +
             newFaults.map(f => `${f.type}: ${f.message}`).join('; '));
        return;
    }

    // (c) CR0 must hold an Inform GT (type=1) after the LOAD.
    const cr0After = sim.parseGT(sim.cr[0].word0);
    if (cr0After.type !== 1) {
        fail(`Expected CR0 to hold Inform GT (type=1) after Mode 2 LOAD, got type=${cr0After.type} (${cr0After.typeName})`);
        return;
    }

    // (d) lazyManifest[16].loaded must be true.
    if (!sim.lazyManifest[16] || !sim.lazyManifest[16].loaded) {
        fail('lazyManifest[16].loaded is not true after LOAD on Outform GT');
        return;
    }

    // (e) NS[16] word1 gtType must now be 1 (Inform).
    const w1after = sim.parseNSWord1(sim.memory[nsBase + 1]);
    if (w1after.gtType !== 1) {
        fail(`Expected NS[16] gtType=1 (Inform) after Mode 2 LOAD, got ${w1after.gtType}`);
        return;
    }

    console.log('[PASS] LOAD on Outform GT: Mode 2 lazy load fired, lump installed, CR0 promoted to Inform');
    console.log('[PASS] lazyManifest[16].loaded = true, NS[16] word1 gtType = 1 (Inform)');
})();

// ─── Test 2: LOAD on already-Inform GT does not trigger Mode 2 ───────────────

(function testLoadInformNoMode2() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Boot did not complete for LOAD Inform (no Mode 2) test');
        return;
    }

    const slideRule = BOOT_UPLOADS.find(b => b.index === 16);
    if (!slideRule) {
        fail('SlideRule (index=16) not found in BOOT_UPLOADS');
        return;
    }

    setupCR6(sim);

    // Register as warm (not cold) so NS entry stays Inform (gtType=1).
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

    // Build a normal Inform GT (type=1) and write it into the c-list at CR6.
    const nsW2 = sim.memory[nsBase + 2];
    const gt_seq = (nsW2 >>> 25) & 0x7F;
    const informGT = sim.createGT(gt_seq, 16, { E: 1 }, 1);

    const clistBase = sim.cr[6].word1;
    sim.memory[clistBase + 1] = informGT >>> 0;

    const LOAD_OPCODE = 0;
    const loadInstr = sim.encodeInstruction(LOAD_OPCODE, 0xE /* AL */, 0, 6, 1);
    const codeBase = sim.cr[14].word1;
    sim.memory[codeBase + 1] = loadInstr >>> 0;
    sim.pc = 0;
    sim.halted = false;

    const outputBefore = sim.output;
    const faultsBefore = sim.faultLog.length;

    sim.step();

    const newOutput = sim.output.slice(outputBefore.length);
    const newFaults = sim.faultLog.slice(faultsBefore);

    // Must NOT contain Mode 2 log line.
    if (newOutput.includes('[LOADER] LOAD: CR0 is Outform GT')) {
        fail('Mode 2 loader incorrectly triggered for an Inform GT');
        return;
    }

    // No faults expected.
    if (newFaults.length > 0) {
        fail('Unexpected fault after LOAD on Inform GT: ' +
             newFaults.map(f => `${f.type}: ${f.message}`).join('; '));
        return;
    }

    // CR0 must hold an Inform GT.
    const cr0After = sim.parseGT(sim.cr[0].word0);
    if (cr0After.type !== 1) {
        fail(`Expected CR0 to hold Inform GT (type=1), got type=${cr0After.type}`);
        return;
    }

    console.log('[PASS] LOAD on Inform GT: Mode 2 path not triggered, CR0 holds Inform GT normally');
})();

// ─── Test 3: Repeated LOAD from an Outform c-list slot always yields Inform ───
//
// After the first LOAD triggers Mode 2 and the lump is installed, the c-list
// slot still holds the stale Outform GT.  A second LOAD from that slot must
// still deliver an Inform GT to the destination CR (not an Outform GT).

(function testRepeatedLoadOutformYieldsInform() {
    const sim = bootSim();
    if (!sim.bootComplete) {
        fail('Boot did not complete for repeated-LOAD test');
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

    const LOAD_OPCODE = 0;
    const loadInstr = sim.encodeInstruction(LOAD_OPCODE, 0xE /* AL */, 0, 6, 1);
    const codeBase = sim.cr[14].word1;
    sim.memory[codeBase + 1] = loadInstr >>> 0;

    // First LOAD — triggers Mode 2 loader.
    sim.pc = 0;
    sim.halted = false;
    sim.step();

    if (!sim.lazyManifest[16] || !sim.lazyManifest[16].loaded) {
        fail('First LOAD: lazyManifest[16].loaded is not true after Mode 2 load');
        return;
    }

    // Confirm c-list slot still holds the stale Outform GT.
    const slotAfterFirst = sim.parseGT(sim.memory[clistBase + 1]);
    if (slotAfterFirst.type !== 2) {
        fail(`Expected c-list slot 1 to still hold Outform GT (type=2) after first LOAD, got type=${slotAfterFirst.type}`);
        return;
    }

    // Second LOAD from the same slot (lump already loaded, slot unchanged).
    sim.memory[codeBase + 1] = loadInstr >>> 0;
    sim.pc = 0;
    sim.halted = false;
    const faultsBefore = sim.faultLog.length;
    sim.step();

    const newFaults = sim.faultLog.slice(faultsBefore);
    if (newFaults.length > 0) {
        fail('Second LOAD: unexpected fault: ' +
             newFaults.map(f => `${f.type}: ${f.message}`).join('; '));
        return;
    }

    const cr0After = sim.parseGT(sim.cr[0].word0);
    if (cr0After.type !== 1) {
        fail(`Second LOAD: expected CR0 to hold Inform GT (type=1), got type=${cr0After.type} (${cr0After.typeName})`);
        return;
    }

    console.log('[PASS] Repeated LOAD from stale Outform c-list slot: CR0 holds Inform GT on both loads');
})();

// ─── Report ──────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    for (const e of ERRORS) process.stderr.write('[FAIL] ' + e + '\n');
    process.exit(1);
}
process.exit(0);
