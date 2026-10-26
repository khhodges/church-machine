'use strict';
const assert = require('node:assert/strict');
const Assembler = require('./assembler');
const Simulator = require('./simulator');
for (let source = 0; source < 16; source++) {
    const a = new Assembler();
    const word = a.assemble(`CHANGE CR${source}`).words[0] >>> 0;
    assert.deepEqual(a.errors, []);
    assert.equal(word, (0x27000000 | source << 15) >>> 0);
    assert.equal(a.assemble(a.disassemble(word)).words[0] >>> 0, word);
    if (source !== 13) {
        const receiver = {
            cr: Array.from({length:16}, (_, i) => ({word0: i + 100})),
            _activateChangeThread(gt) { return gt; },
        };
        assert.equal(Simulator.prototype._execChangeCore.call(receiver,
            {crDst:0, crSrc:source, imm:0}, 42), source + 100);
    }
}
for (const word of [0x27110000, 0x27198000]) {
    const a = new Assembler();
    assert.equal(a.assemble(a.disassemble(word)).words[0] >>> 0, word);
}
let fault;
Simulator.prototype._execChangeCore.call({
    fault(code) { fault = code; },
}, {crDst:0, crSrc:13, imm:0}, 1);
assert.equal(fault, 'INVALID_OP');
console.log('PASS canonical CHANGE encoding, source selection, reserved CR13 and historical inspection');
