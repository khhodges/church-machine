'use strict';

// Historical filename retained for the RETURN regression runner. ELOADCALL's
// flat-entry fallback is retired, not a supported CALL compatibility path.
// Exercise rejection using disposable RAM, never a saved CapabilityTest,
// catalog "latest", or the committed boot image.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Sim, fixture } = require('../tests/simulator/cr6_contract_fixture');

for (const condition of [14, 15]) { // AL and NV: retirement precedes predicates.
    const { sim, install, activate } = fixture(true);
    const flatTarget = install(31, [
        sim.encodeInstruction(22, 14, 1, 1, 1), // executable ISUB, no method table
        0,
    ]);
    const retiredWord = sim.encodeInstruction(8, condition, 0, 6, 1);
    const caller = install(30, [retiredWord, 0], [flatTarget.gt]);
    activate(caller);
    assert.strictEqual(sim._nextPhysicalAddr(), caller.base + 1);
    assert.strictEqual(sim._fetchInstruction().word, retiredWord,
        'real fetch reads the isolated retired encoding');

    const snapshot = () => ({
        cr: sim.cr.map(cr => ({ ...cr })),
        dr: Array.from(sim.dr),
        memory: sim.memory.slice(),
        pc: sim.pc,
        sto: sim.sto,
        callStack: JSON.stringify(sim.callStack),
        stepCount: sim.stepCount,
    });
    const before = snapshot();
    const faults = [];
    // Capture at the fault boundary, before recovery can reset the machine.
    // The separate corrupt-Thread case below retains the real fault handler.
    sim.fault = (type, message) => faults.push({ type, message });
    assert.strictEqual(sim.step(), null,
        'retired ELOADCALL must not retire or enter a flat LUMP');
    assert.strictEqual(faults.length, 1);
    assert.strictEqual(faults[0].type, 'INVALID_OP');
    assert.match(faults[0].message, /ELOADCALL is retired.*Correct the source explicitly and recompile/);
    assert.deepStrictEqual(snapshot(), before,
        'rejection leaves capabilities, Thread, memory, stack and PC unchanged');
    assert.strictEqual(sim.cr[14].word1, caller.base,
        'rejection never installs the flat target as CR14');
}

// Preserve the independent active-Thread geometry and fault-listener regression.
// Constructor boot data and the target are private RAM fixtures, not disk images.
const { sim: corrupt, install } = fixture(true);
const targetLump = install(30, [0]);
corrupt.fault = Sim.prototype.fault.bind(corrupt);
const corruptThreadBase = corrupt._activeThreadBase();
assert.notStrictEqual(corruptThreadBase, null, 'fixture has an active Thread');
assert.ok(corrupt._threadLayoutAtBase(corruptThreadBase),
    'fixture starts with valid protected Thread geometry');
corrupt.memory[corruptThreadBase] = 0;
let emittedTerminalFaults = 0;
corrupt.on('fault', () => { emittedTerminalFaults++; });
assert.strictEqual(corrupt._writeCR(0, targetLump.gt, corrupt.readNSEntry(targetLump.slot)), false,
    'invalid active Thread geometry fails closed when a CR home is materialized');
assert.strictEqual(corrupt.faultLog.length, 1,
    'invalid Thread geometry raises exactly one terminal fault');
assert.strictEqual(emittedTerminalFaults, 1,
    'invalid Thread geometry emits exactly one fault for the modal listener');
assert.match(corrupt.faultLog[0].message, /active Thread.*invalid geometry/,
    'terminal fault remains explicit for the UI fault-modal listener');
const appRunSource = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
assert.match(appRunSource,
    /sim\.faultLog\.length > 0[\s\S]*showFaultModal\(terminalFault\)/,
    'run completion retains the visible terminal-fault modal fallback');

console.log('Retired ELOADCALL flat-entry rejection and Thread fault regressions passed');
