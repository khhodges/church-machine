// Regression coverage for exact CALL/RETURN instruction location resolution.
'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const marker = 'function _callReturnInstructionLocation(';
const start = src.indexOf(marker);
if (start < 0) throw new Error('drill-down resolver not found');
let depth = 0;
let end = -1;
for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
}
if (end < 0) throw new Error('could not extract drill-down resolver');

const sandbox = {
    sim: {
        memory: [0, 0x10000000, 0x10000000, 0x18000000],
        nsLabels: { 2: 'Nested.Abs' },
        callStack: [{}, {}],
    },
    _cmDecodeWord(word, addr) {
        return { mnemonic: word === 0x10000000 ? 'CALL' : 'RETURN',
            text: (word === 0x10000000 ? 'CALL' : 'RETURN') + ' @' + addr };
    },
    _nsOwnerOf(addr) {
        return { nsIdx: 2, label: 'Nested.Abs', base: 0 };
    },
};
vm.runInNewContext(src.slice(start, end) + '\nthis.resolve = _callReturnInstructionLocation;', sandbox);

const first = sandbox.resolve({ kind: 'CALL', nia: 1, instrWord: 0x10000000,
    nia_label: 'Nested.Abs.outer' }, {});
const second = sandbox.resolve({ kind: 'RETURN', nia: 3, instrWord: 0x18000000,
    nia_label: 'Nested.Abs.inner' }, {});
assert.strictEqual(first.physicalAddress, 1);
assert.strictEqual(second.physicalAddress, 3);
assert.notStrictEqual(first.physicalAddress, second.physicalAddress);
assert.strictEqual(first.method, 'outer');
assert.strictEqual(second.method, 'inner');
assert.strictEqual(first.rawWord, 0x10000000);
assert.strictEqual(second.rawWord, 0x18000000);

const sourceLess = sandbox.resolve({ kind: 'RETURN', nia: 2 }, {});
assert.strictEqual(sourceLess.physicalAddress, 2);
assert.strictEqual(sourceLess.rawWord, null);
assert.strictEqual(sourceLess.lump, null);
assert.strictEqual(sourceLess.method, null);
assert.strictEqual(sourceLess.callDepth, null);
assert.strictEqual(sourceLess.offset, null);
assert.strictEqual(sourceLess.operands, null);

// Recorded fields, including zero values, win over all unrelated live state.
const recorded = {
    kind: 'RETURN', physicalPC: 41, instrWord: 0x18000000,
    lump: 'Recorded.Abs', method: 'exit', offset: 0, callDepth: 0,
    cr14: 0, cr12: 0
};
const historical = sandbox.resolve(recorded, recorded);
assert.strictEqual(historical.physicalAddress, 41);
assert.strictEqual(historical.rawWord, 0x18000000);
assert.strictEqual(historical.lump, 'Recorded.Abs');
assert.strictEqual(historical.method, 'exit');
assert.strictEqual(historical.offset, 0);
assert.strictEqual(historical.callDepth, 0);
assert.strictEqual(historical.cr14, 0);
assert.strictEqual(historical.cr12, 0);
sandbox.sim = new Proxy({}, { get() { throw new Error('live simulator read'); } });
sandbox._nsOwnerOf = () => { throw new Error('live ownership read'); };
assert.strictEqual(sandbox.resolve(recorded, recorded).physicalAddress, 41);
assert.strictEqual(sandbox.resolve({ kind: 'RETURN', nia: 2 }).rawWord, null);

// A hardware push carries no CR GT. Poll-level latest CRs and a later
// simulator snapshot are not operands of the historical retirement.
const hwPush = sandbox.resolve({
    kind: 'CALL', ev_type: 8, nia: 3, instr: null,
    cr14_gt: 0xDEADBEEF, cr12_gt: 0xCAFEBABE,
    call_depth: 2, disasm: 'CALL CR6, #0',
}, {cr14: 0x1234, instrWord: 0x18000000});
assert.strictEqual(hwPush.rawWord, null);
assert.strictEqual(hwPush.cr14, null);
assert.strictEqual(hwPush.cr12, null);
assert.strictEqual(hwPush.callDepth, 2);
assert.strictEqual(hwPush.operands, 'CALL CR6, #0'); // symbolic decode only
const hwCr14 = sandbox.resolve({
    kind: 'RETURN', ev_type: 11, nia: 3,
    payload_gt: 0, cr14_gt: 0xDEADBEEF, instr: 0x18000000
});
assert.strictEqual(hwCr14.rawWord, 0x18000000);
assert.strictEqual(hwCr14.cr14, 0);
assert.strictEqual(hwCr14.cr12, null);

console.log('CALL/RETURN drill-down resolver tests passed');