'use strict';
const assert = require('assert');
global.ChurchAssembler = require('./assembler');
const Compiler = require('./cloomc_compiler');
const Builder = require('./lump_builder');
const compiler = new Compiler();
const raw = '; Abstraction: test.Methods\ncapabilities {\nSELF E\n}\nBRANCH stash\nstash:\nRETURN';
const rejected = compiler.compileAssembly(raw, []);
assert(rejected.errors.some(e => /explicit method declarations/.test(e.message)));
assert.deepStrictEqual(rejected.methods, []);
assert(compiler.compile('abstraction test.Empty {\ncapabilities { SELF E }\n}', []).errors.length);
assert.deepStrictEqual(new global.ChurchAssembler().assemble('IADD DR1, DR0, #1\nRETURN').errors, [],
    'low-level instruction assembly remains available');
const source = `abstraction test.Methods {
capabilities { SELF E, test.Missing E }
method Stash() {
IADD DR1, DR0, #999
RETURN
}
method Reveal() {
CALL test.Missing.Run
RETURN
}
}`;
const compiled = compiler.compileAssembly(source, []);
assert.deepStrictEqual(compiled.errors, []);
assert.deepStrictEqual(compiled.methods.map(m => m.name), ['Stash', 'Reveal']);
const built = Builder.buildLump(compiled);
assert.strictEqual(built.words[1], 3, 'one compiler-owned dispatch table');
assert.strictEqual(built.words[2], 5);
assert.strictEqual(built.cw, 6);
const api = Builder.buildApiDefinition(compiled, {cw: built.cw, cc: built.cc});
assert.deepStrictEqual(api.methods.map(m => m.name), ['Stash', 'Reveal']);
assert.strictEqual(api.symbolic_binding.calls[0].full_name, 'test.Missing.Run');
console.log('PASS explicit callable declarations, dispatch ownership, symbolic external calls, raw assembler boundary');
