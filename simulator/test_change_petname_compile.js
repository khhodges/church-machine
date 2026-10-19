'use strict';
// Compiler-only: no saved files, simulator mutation, or hardware.
const assert = require('node:assert/strict');
const Assembler = require('./assembler');
global.ChurchAssembler = Assembler;
const Compiler = require('./cloomc_compiler');
function assemble(source, rows = {}) {
    const a = new Assembler();
    a.setLocalClistSlots(rows);
    const result = a.assemble(source);
    assert.deepEqual(result.errors, [], source);
    return result.words;
}
const rows = {'Thread.3': 9};
const indexed = assemble('CHANGE CR12, CR6, #9');
for (const source of ['CHANGE Thread.3', 'CHANGE CR6, #9', 'CHANGE CR6[9]',
    'CHANGE CR6[Thread.3]', 'CHANGE CR6, Thread.3']) {
    assert.deepEqual(assemble(source, rows), indexed, source);
}
assert.equal(indexed.length, 1, 'no inserted LOAD or scratch register');
assert.deepEqual(assemble('CHANGENE Thread.3', rows),
    assemble('CHANGENE CR12, CR6, #9'));
assert.notDeepEqual(assemble('CHANGE CR6, #0'), assemble('CHANGE CR6'));
assert.deepEqual(assemble('.pet target CR7\nCHANGE target'), assemble('CHANGE CR7'));
assert.deepEqual(assemble('capabilities {\n SELF E\n Thread.3\n}\nCHANGE Thread.3'),
    assemble('CHANGE CR6, #1'));
const disassembler = new Assembler();
assert.deepEqual(assemble(disassembler.disassemble(indexed[0])), indexed);
assert.match(disassembler.disassemble(indexed[0], {9: 'Thread.3'}), /Thread\.3/);
for (const source of ['CHANGE Missing.Thread', 'CHANGE CR6, #-1',
    'CHANGE CR6, #32768', 'CHANGE CR6, #1.5', 'CHANGE CR6[9], #1']) {
    const a = new Assembler(), result = a.assemble(source);
    assert(result.errors.length, source);
    assert.equal(result.words.length, 0, 'invalid indexed form must not emit a different CHANGE');
}
// Full frontend normalizes the compiler-owned SELF row before native assembly.
const source = operand => `Abstraction ide.ChangeTest {
capabilities {
 SELF E
 ${Array.from({length: 8}, (_, i) => 'ide.Cap' + i).join('\n ')}
 Thread.3
}
method Run {
 CHANGE ${operand}
}
}`;
const named = new Compiler().compileAssembly(source('Thread.3'), []);
const numeric = new Compiler().compileAssembly(source('CR6, #9'), []);
assert.deepEqual(named.errors, []);
assert.deepEqual(numeric.errors, []);
assert(named.methods[0].code.length);
assert.deepEqual(named.methods[0].code, numeric.methods[0].code);
assert.equal(named.methods[0].code[0], indexed[0]);
console.log('PASS CHANGE PetName compiler: exact rows, indexed shorthand, direct/alias preservation, conditions, diagnostics and full frontend');
