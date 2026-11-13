'use strict';
// Fixture provisioning and instruction stepping only. No host service dispatch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Compiler = require('./cloomc_compiler');
const builder = require('./lump_builder');
const Simulator = require('./simulator');
const source = fs.readFileSync(__dirname + '/cloomc/queue_transfer_primitives.cloomc', 'utf8');
const CODE = 2048, DATA = 4096, ENTRIES = 4352;
function fixture(text = source) {
    const compiled = new Compiler().compile(text, []);
    assert.deepEqual(compiled.errors, []);
    const packed = builder.buildLump(compiled);
    const api = builder.buildApiDefinition(compiled, packed.words);
    const s = new Simulator();
    const gt = (slot, rights) => s.createGT(0, slot,
        Object.fromEntries([...rights].map(r => [r, 1])), 1) >>> 0;
    s.withNamespaceWrite('disposable native queue component fixture', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(20, CODE, packed.words.length - 1, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(21, DATA, 7, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(22, ENTRIES, 63, 0, 0, 1, 0, 0, 0);
    });
    s.memory[0] = 0xF900820C;
    s.memory.set(packed.words, CODE);
    s.memory.fill(0x12345678, DATA, DATA + 8);
    s.memory[ENTRIES] = 0xF8000002; // C-list with SELF + one payload
    s.memory[ENTRIES + 62] = gt(22, 'E');
    const caps = [gt(20, 'E'), gt(21, 'RWB'), gt(22, 'LS')];
    // Source's declared imports only; no runtime callback is registered.
    s.memory.set(caps.slice(0, compiled.capabilities.length),
        CODE + packed.words.length - compiled.capabilities.length);
    s.bootComplete = true;
    s.mElevation = false;
    s.petNameMemory.clear();
    s.programCapabilities = null;
    s.cr[12] = {word0: gt(1, ''), word1: 0, word2: 255, word3: 0, m: 0};
    let fault;
    s.on('fault', event => { fault = event; });
    function run(method, size = 8, stopAfterWrites = Infinity) {
        s._writeCR(0, caps[0], s.readNSEntry(20));
        s._installLumpHeaderContext(s.parseGT(caps[0]), 20, s.readNSEntry(20),
            s.parseLumpHeader(packed.words[0]));
        s._writeCR(2, caps[1], s.readNSEntry(21));
        s.dr[2] = size;
        s.pc = packed.words[1 + api.methods[method][0]] - 1;
        let writes = 0;
        for (let steps = 0; steps < 1000; steps++) {
            const instruction = s.memory[CODE + 1 + s.pc] >>> 0;
            if (instruction >>> 27 === 3) return {returned: true, writes};
            s.step();
            if (fault) return {fault, writes};
            if (instruction >>> 27 === 17 && ++writes === stopAfterWrites)
                return {cut: true, writes};
        }
        throw Error('native component did not terminate');
    }
    return {s, run};
}
let f = fixture();
assert(f.run('ClearBlock').returned);
assert.deepEqual(Array.from(f.s.memory.slice(DATA, DATA + 8)), Array(8).fill(0));
assert.equal(f.s.cr[2].word0, 0);
assert.equal(f.s.dr[1], 1);
for (let cut = 1; cut <= 8; cut++) {
    f = fixture();
    assert(f.run('ClearBlock', 8, cut).cut);
    assert.equal(f.s.dr[1], 0, 'partial clearing never signals completion');
    assert.deepEqual(Array.from(f.s.memory.slice(DATA, DATA + cut)), Array(cut).fill(0));
}
for (const size of [0, 9]) {
    f = fixture();
    assert(f.run('ClearBlock', size).fault, 'zero or beyond-bounds clearing faults');
    assert.equal(f.s.dr[1], 0);
}
for (const [phase, irreversible, count, success] of [
    [1, 0, 1, true], [1, 0, 2, true], [2, 0, 1, false],
    [3, 0, 1, false], [1, 1, 1, false], [0, 0, 1, false],
    [1, 0, 0, false],
]) {
    f = fixture();
    f.s.memory.set([phase, irreversible, count], DATA);
    const before = Array.from(f.s.memory.slice(DATA, DATA + 8));
    const result = f.run('CancelUnusedReservation');
    if (success) {
        assert(result.returned);
        assert.equal(f.s.memory[DATA], 0);
        assert.equal(f.s.memory[DATA + 2], count - 1);
    } else {
        assert(result.fault);
        assert.deepEqual(Array.from(f.s.memory.slice(DATA, DATA + 8)), before);
    }
}
for (const cut of [1, 2]) {
    f = fixture();
    f.s.memory.set([1, 0, 1], DATA);
    assert(f.run('CancelUnusedReservation', 8, cut).cut);
    assert.equal(f.s.dr[1], 0);
    assert.equal(f.s.memory[DATA], 0, 'interrupted cancellation cannot be retried as reserved');
}
// Counterexample, not Stage: queue store + clearing one CR leaves another usable.
f = fixture(`abstraction ide.TransferCounterexample {
passkey required;
capabilities { SELF E, ide.WorkingBlock RW, ide.QueueEntries LS }
method Probe() -> Void {
 .pet WorkingBlock CR7
 .pet RetainedCopy CR8
 .pet QueueEntries CR9
 LOAD WorkingBlock, CR6, #1
 LOAD RetainedCopy, CR6, #1
 LOAD QueueEntries, CR6, #2
 SAVE WorkingBlock, QueueEntries, #1
 LOAD WorkingBlock, NULL
 IADD DR2, DR0, #123
 DWRITE DR2, RetainedCopy, #0, DR0
 RETURNAL #0
}
}`);
const probe = f.run('Probe');
assert(probe.returned, JSON.stringify(probe));
assert.equal(f.s.cr[7].word0, 0);
assert.notEqual(f.s.cr[8].word0, 0);
assert.equal(f.s.memory[DATA], 123, 'retained working copy still authorizes a write');
assert.notEqual(f.s.memory[ENTRIES + 63], 0, 'GT was actually stored in queue custody');
console.log('PASS native clearing, cancellation guards, write cuts, bounds faults and retained-copy counterexample');
