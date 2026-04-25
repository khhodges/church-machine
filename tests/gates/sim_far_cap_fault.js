'use strict';
// Headless harness used by tests/test_far_cap_fault.py.
//
// Verifies two properties of the Far-capability fault path:
//
//   1. LOAD_NUC (boot step 4) fires an F_BIT fault when the boot-entry
//      NS slot has its F-bit set (word1 bit 30).  The seal is computed
//      from (location, limit17) only, so flipping bit 30 does not break
//      the CRC seal check, letting the fault path be reached cleanly.
//
//   2. _FAULT_CODES['F_BIT'] in simulator/app.js equals 0x0F (not null),
//      confirming the hardware code is wired correctly.
//
// Exits with code 0 on success, 1 on failure (errors written to stderr).

global.window = { bootConfig: {} };

const ChurchSimulator = require('../../simulator/simulator.js');
const fs   = require('fs');
const path = require('path');

const ERRORS = [];
function fail(msg) { ERRORS.push(msg); }

// ─── Test 1: NUC_CLIST fires F_BIT when boot-entry NS slot has F=1 ──────────

(function testLoadNucFBitFault() {
    const sim = new ChurchSimulator();

    // Drive boot steps 0–5 (B:00 through B:05 INIT_ABSTR).  We stop just
    // before B:06 NUC_CLIST (bootStep === 6) so we can inject F=1 into the
    // boot-entry slot before NUC_CLIST sees it.
    //
    // B:05 INIT_ABSTR uses M-elevation (requiredPerm=null) and does not check
    // the F-bit itself.  B:06 NUC_CLIST then performs an explicit
    // parseNSWord1(...).f === 1 check and fires the F_BIT fault.
    let iterations = 0;
    while (!sim.bootComplete && !sim.halted && sim.bootStep < 6 && iterations < 200) {
        sim._bootStep();
        iterations++;
    }

    if (sim.halted) {
        fail('Simulator halted during boot steps 0–5: ' +
             (sim.faultLog && sim.faultLog.length
                 ? sim.faultLog[sim.faultLog.length - 1].message
                 : '(no fault message)'));
        return;
    }
    if (sim.bootComplete) {
        fail('Boot completed before reaching step 6 — unexpected');
        return;
    }
    if (sim.bootStep !== 6) {
        fail(`Expected bootStep=6 after driving steps 0–5, got ${sim.bootStep}`);
        return;
    }

    // Inject F=1 (bit 30) into the boot-entry slot's word1.
    // The CRC seal covers only (word0_location, limit17) — bit 30 is outside
    // that range — so the seal remains valid and mLoad in B:06 passes the seal
    // check.  The explicit F-bit check inside B:06 NUC_CLIST then fires the fault.
    const slotIdx  = sim.bootEntrySlot;
    const memBase  = sim.NS_TABLE_BASE + slotIdx * sim.NS_ENTRY_WORDS;
    sim.memory[memBase + 1] = (sim.memory[memBase + 1] | (1 << 30)) >>> 0;

    // Run B:06 NUC_CLIST: should now fault with F_BIT.
    const faultsBefore = sim.faultLog.length;
    sim._bootStep();
    const newFaults = sim.faultLog.slice(faultsBefore);

    if (newFaults.length === 0) {
        fail('No fault fired after NUC_CLIST with F=1 in boot-entry NS slot');
        return;
    }

    const fBitFault = newFaults.find(f => f.type === 'F_BIT');
    if (!fBitFault) {
        fail('Expected fault type F_BIT, got: ' +
             newFaults.map(f => f.type).join(', '));
        return;
    }

    console.log('[PASS] NUC_CLIST F_BIT fault fired: "' + fBitFault.message + '"');
})();

// ─── Test 2: _FAULT_CODES['F_BIT'] === 0x0F in app.js ───────────────────────

(function testFaultCodeValue() {
    const appPath = path.join(__dirname, '..', '..', 'simulator', 'app-run.js');
    let src;
    try {
        src = fs.readFileSync(appPath, 'utf8');
    } catch (e) {
        fail('Could not read simulator/app.js: ' + e.message);
        return;
    }

    // Match the F_BIT key inside the _FAULT_CODES object literal.
    // The line looks like: BIND:0x0E, F_BIT:0x0F,
    const match = src.match(/\bF_BIT\s*:\s*(0x[0-9a-fA-F]+|\d+|null)\b/);
    if (!match) {
        fail('Could not locate F_BIT entry in _FAULT_CODES table in simulator/app.js');
        return;
    }

    const raw = match[1];
    if (raw === 'null') {
        fail("_FAULT_CODES['F_BIT'] is null in app.js — expected 0x0F");
        return;
    }

    const code = raw.startsWith('0x') ? parseInt(raw, 16) : parseInt(raw, 10);
    if (code !== 0x0F) {
        fail("_FAULT_CODES['F_BIT'] = 0x" + code.toString(16) +
             ' in app.js — expected 0x0F');
        return;
    }

    console.log("[PASS] _FAULT_CODES['F_BIT'] = 0x" +
                code.toString(16).toUpperCase() + ' (correct hardware code)');
})();

// ─── Test 3: CALL instruction fires F_BIT at runtime (not just during boot) ──

(function testCallFBitFaultRuntime() {
    const sim = new ChurchSimulator();

    // Boot the simulator completely so the runtime CALL path is reachable.
    let steps = 0;
    while (!sim.bootComplete && !sim.halted && steps < 200) {
        sim._bootStep();
        steps++;
    }

    if (!sim.bootComplete) {
        fail('Boot did not complete for CALL runtime test: ' +
             (sim.faultLog && sim.faultLog.length
                 ? sim.faultLog[sim.faultLog.length - 1].message
                 : '(no fault)'));
        return;
    }

    // After boot, CR6.word0 is an E-perm GT (type=1 Inform) pointing to
    // bootEntrySlot.  Flip the F-bit (bit 30) in that NS entry's word1.
    // The CRC seal covers only (word0_location, limit17) — bit 30 is
    // outside that range — so the seal stays valid, mLoad passes, and
    // only the explicit F-bit check at simulator.js ~line 2372 fires.
    const slotIdx = sim.bootEntrySlot;
    const memBase = sim.NS_TABLE_BASE + slotIdx * sim.NS_ENTRY_WORDS;
    sim.memory[memBase + 1] = (sim.memory[memBase + 1] | (1 << 30)) >>> 0;

    // Encode a CALL CR6 instruction and write it at the fetch address for PC=0.
    // Instruction layout: [31:27] opcode | [26:23] cond | [22:19] crDst | ...
    //   CALL opcode = 2 (index in the simulator names array)
    //   cond = 0xE (AL = Always)
    //   crDst = 6  (CR6 holds the E-perm GT for bootEntrySlot)
    const CALL_OPCODE = 2;
    const codeBase = sim.cr[14].word1;
    const instr = sim.encodeInstruction(CALL_OPCODE, 0xE, 6, 0, 0);
    sim.memory[codeBase + 1] = instr >>> 0;

    // Reset PC and clear halted state so step() executes our instruction.
    sim.pc = 0;
    sim.halted = false;

    const faultsBefore = sim.faultLog.length;
    sim.step();
    const newFaults = sim.faultLog.slice(faultsBefore);

    if (newFaults.length === 0) {
        fail('No fault fired by CALL CR6 with F=1 in NS entry (runtime CALL path)');
        return;
    }

    const fBitFault = newFaults.find(f => f.type === 'F_BIT');
    if (!fBitFault) {
        fail('Expected fault type F_BIT from runtime CALL, got: ' +
             newFaults.map(f => f.type).join(', '));
        return;
    }

    console.log('[PASS] CALL F_BIT runtime fault fired: "' + fBitFault.message + '"');
})();

// ─── Test 4: mSave fires F_BIT when the TARGET NS slot has F=1 ───────────────
//
// The mSave gate checks the F-bit on the TARGET slot (not the source).
// _execSave now resolves the C-list NS index and passes it as targetIdx, so
// the Far-bit policy is enforced symmetrically with CALL/LOAD.  This test
// exercises the same gate directly (bypassing the SAVE instruction path) and
// serves as the regression anchor ensuring the check remains correct.
//
//   1. Boot the simulator so valid NS entries exist.
//   2. Build a synthetic GT for bootEntrySlot with B=1 (so bindPass succeeds)
//      and a matching gt_seq (so the version check passes).  The CRC seal on
//      the NS entry is not affected because the seal covers only
//      (word0_location, limit17) — bit 30 (F) is outside that range.
//   3. Inject F=1 into bootEntrySlot's word1 and pass bootEntrySlot as targetIdx.
//   4. Assert mSave returns { ok: false, fault: 'F_BIT' }.

(function testMSaveFBitFault() {
    const sim = new ChurchSimulator();

    // Boot the simulator completely so all NS entries are initialised.
    let steps = 0;
    while (!sim.bootComplete && !sim.halted && steps < 200) {
        sim._bootStep();
        steps++;
    }

    if (!sim.bootComplete) {
        fail('Boot did not complete for mSave F_BIT test: ' +
             (sim.faultLog && sim.faultLog.length
                 ? sim.faultLog[sim.faultLog.length - 1].message
                 : '(no fault)'));
        return;
    }

    // Read the boot-entry NS entry to extract the current gt_seq so the
    // synthetic GT passes the version check inside mSave.
    const slotIdx = sim.bootEntrySlot;
    const memBase = sim.NS_TABLE_BASE + slotIdx * sim.NS_ENTRY_WORDS;
    const word2   = sim.memory[memBase + 2];
    const gt_seq  = (word2 >>> 25) & 0x7F;

    // Construct a synthetic GT with B=1 so that bindPass succeeds and
    // execution reaches the farPass check.  Only the GT bits are modified;
    // the NS entry itself (and therefore its CRC seal) is untouched here.
    const syntheticGT = sim.createGT(gt_seq, slotIdx, { B: 1, E: 1 }, 1);

    // Inject F=1 (bit 30) into the target slot's word1.  The seal covers
    // only (word0_location, limit17) so bit 30 is safe to flip without
    // invalidating the seal.
    sim.memory[memBase + 1] = (sim.memory[memBase + 1] | (1 << 30)) >>> 0;

    // Call mSave directly with targetIdx=slotIdx so the far-bit check fires.
    const result = sim.mSave(syntheticGT, slotIdx, 6);

    if (result.ok) {
        fail('mSave unexpectedly succeeded when target slot has F=1 — F_BIT check missing');
        return;
    }

    if (result.fault !== 'F_BIT') {
        fail('Expected mSave to return F_BIT when target slot has F=1, got: ' + result.fault);
        return;
    }

    console.log('[PASS] mSave F_BIT fault fired for far target slot: "' + result.message + '"');
})();

// ─── Report ──────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    for (const e of ERRORS) process.stderr.write('[FAIL] ' + e + '\n');
    process.exit(1);
}
process.exit(0);
