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

const ChurchSimulator = require('../simulator/simulator.js');
const fs   = require('fs');
const path = require('path');

const ERRORS = [];
function fail(msg) { ERRORS.push(msg); }

// ─── Test 1: LOAD_NUC fires F_BIT when boot-entry NS slot has F=1 ────────────

(function testLoadNucFBitFault() {
    const sim = new ChurchSimulator();

    // Drive boot steps 0–2.  Steps 3 and 4 (INIT_ABSTR / LOAD_NUC) always
    // execute together as an indivisible pair in a single _bootStep() call —
    // case 3 falls through into case 4 with no intervening break.  We stop
    // just before that combined call (bootStep === 3) so we can inject F=1
    // into the boot-entry slot before either step sees it.
    //
    // Step 3's mLoad is called with requiredPerm=null and M-elevation, so it
    // does not fail on the F-bit.  Step 4 then performs an explicit
    // parseNSWord1(...).f === 1 check and fires the F_BIT fault.
    let iterations = 0;
    while (!sim.bootComplete && !sim.halted && sim.bootStep < 3 && iterations < 200) {
        sim._bootStep();
        iterations++;
    }

    if (sim.halted) {
        fail('Simulator halted during boot steps 0–2: ' +
             (sim.faultLog && sim.faultLog.length
                 ? sim.faultLog[sim.faultLog.length - 1].message
                 : '(no fault message)'));
        return;
    }
    if (sim.bootComplete) {
        fail('Boot completed before reaching step 3 — unexpected');
        return;
    }
    if (sim.bootStep !== 3) {
        fail(`Expected bootStep=3 after driving steps 0–2, got ${sim.bootStep}`);
        return;
    }

    // Inject F=1 (bit 30) into the boot-entry slot's word1.
    // The CRC seal covers only (word0_location, limit17) — bit 30 is outside
    // that range — so the seal remains valid and mLoad in step 3 passes.
    // The explicit F-bit check inside step 4 (LOAD_NUC) then fires the fault.
    const slotIdx  = sim.bootEntrySlot;
    const memBase  = sim.NS_TABLE_BASE + slotIdx * sim.NS_ENTRY_WORDS;
    sim.memory[memBase + 1] = (sim.memory[memBase + 1] | (1 << 30)) >>> 0;

    // Run step 4: LOAD_NUC should now fault with F_BIT.
    const faultsBefore = sim.faultLog.length;
    sim._bootStep();
    const newFaults = sim.faultLog.slice(faultsBefore);

    if (newFaults.length === 0) {
        fail('No fault fired after LOAD_NUC with F=1 in boot-entry NS slot');
        return;
    }

    const fBitFault = newFaults.find(f => f.type === 'F_BIT');
    if (!fBitFault) {
        fail('Expected fault type F_BIT, got: ' +
             newFaults.map(f => f.type).join(', '));
        return;
    }

    console.log('[PASS] LOAD_NUC F_BIT fault fired: "' + fBitFault.message + '"');
})();

// ─── Test 2: _FAULT_CODES['F_BIT'] === 0x0F in app.js ───────────────────────

(function testFaultCodeValue() {
    const appPath = path.join(__dirname, '..', 'simulator', 'app.js');
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

// ─── Report ──────────────────────────────────────────────────────────────────

if (ERRORS.length > 0) {
    for (const e of ERRORS) process.stderr.write('[FAIL] ' + e + '\n');
    process.exit(1);
}
process.exit(0);
