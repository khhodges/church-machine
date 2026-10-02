'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const A = require('./assembler');
const source = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const implementation = source.slice(source.indexOf('function _computeReferencedCListSlots('),
    source.indexOf('// ── Unsaved NS changes'));
const pack = (n, cw, cc, typ) => ((31 << 27) | (n << 23) | (cw << 10) | (typ << 8) | cc) >>> 0;
function fixture(code) {
    const result = new A().assemble(code);
    assert.deepEqual(result.errors, []);
    const memory = new Uint32Array(512);
    memory[64] = pack(0, result.words.length, 4, 0);
    memory.set(result.words, 65);
    memory.set([0x4A000014, 0x4A000015, 0, 0x4A000016], 124);
    const writes = [];
    const sim = {
        memory, cr: [], nsLabels: {},
        readNSEntry: () => ({word0_location:64}),
        parseLumpHeader: w => ({valid:true, cw:(w >>> 10) & 8191, cc:w & 255,
            typ:0, n_minus_6:0, lumpSize:64}),
        writePersistentWord: (addr, value) => {writes.push(addr); memory[addr] = value;},
        packLumpHeader: pack, parseGT: w => ({index:w & 65535}),
        _nsSlotBase: () => 0, parseNSWord1: () => ({limit:63, gtSeq:0, g:0}),
        withNamespaceWrite: (_why, fn) => fn(), writeNSEntry: () => {},
    };
    const editor = {value:code};
    const context = vm.createContext({sim, window:{},
        document:{getElementById:id=>id === 'asmEditor' ? editor : null},
        updateCRDetail:()=>{}, showPatchModal:()=>{}});
    vm.runInContext(implementation, context);
    return {context, sim, memory, writes, editor};
}
(async () => {
    for (const op of ['LOAD', 'SAVE']) {
        const {context, memory} = fixture(`${op} CR1, CR6, #1`);
        const refs = context._computeReferencedCListSlots(65, 1);
        assert.ok(refs.direct.has(1));
        assert.ok(!refs.direct.has(16));
        context.window.zeroAllUnrefSlots(20);
        assert.equal(memory[125], 0x4A000015, 'referenced row survives');
        assert.equal(memory[124], 0x4A000014, 'SELF survives');
        assert.equal(memory[127], 0, 'only unreferenced capability is removed');
    }
    for (const op of ['LOAD', 'SAVE']) for (const expr of ['DR11', 'DR15 + 1023', 'DR1 - 3']) {
        const {context, memory, writes} = fixture(`${op} CR1, CR6, ${expr}`);
        const before = memory.slice();
        const refs = context._computeReferencedCListSlots(65, 1);
        assert.equal(refs.dynamicIndices, true);
        for (let row=0; row<256; row++) assert.ok(refs.direct.has(row));
        context.window.zeroAllUnrefSlots(20);
        await context.window.applyPOLA(20);
        assert.deepEqual(memory, before, 'dynamic indexing blocks all destructive mutation');
        assert.deepEqual(writes, []);
    }
    for (const op of ['LOAD', 'SAVE']) {
      for (const expression of ['#3', 'DR0 + 3', 'DR0+0x3', 'DR0 + #0b11']) {
        const {context, memory, editor} = fixture(`  ${op}NE CR1, CR6, ${expression} ; keep comment`);
        const beforeInstruction = memory[65];
        await context.window.applyPOLA(20);
        assert.equal(memory[64] & 255, 2);
        assert.equal(memory[126], 0x4A000014);
        assert.equal(memory[127], 0x4A000016);
        assert.equal(memory[65], ((beforeInstruction & ~0x3FF0) | 16) >>> 0,
            'safe compaction changes only magnitude, preserving predicate, registers, sign and opcode');
        assert.equal((memory[65] >>> 4) & 1023, 1);
        const reassembled = new A().assemble(editor.value);
        assert.deepEqual(reassembled.errors, []);
        assert.deepEqual(reassembled.words, [memory[65]], 'editor reassembles to compacted memory');
        assert.ok(editor.value.includes('; keep comment'));
      }
    }
    // An explicitly referenced NULL must remain NULL, not alias a live row.
    {
        const {context, memory} = fixture('LOAD CR1, CR6, #2\nSAVE CR2, CR6, #3');
        await context.window.applyPOLA(20);
        assert.equal(memory[64] & 255, 3);
        assert.equal(memory[126], 0);
        assert.equal(memory[127], 0x4A000016);
    }
    console.log('PASS compact C-list reference, zeroing, dynamic containment and semantic compaction');
})().catch(error => { console.error(error); process.exitCode = 1; });