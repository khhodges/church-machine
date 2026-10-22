'use strict';
const assert = require('node:assert/strict');
const Assembler = require('./assembler');
global.ChurchAssembler = Assembler;
const Compiler = require('./cloomc_compiler');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');

const source = `top:
    IADD DR1, DR1, #1
    MCMP DR1, #3
    BRANCHLT top
    BRANCH done
    HARDFAULT "wrong continuation"
done:
    HALT`;
const asm = new Assembler();
const built = asm.assemble(source);
assert.deepEqual(built.errors, []);
assert.equal(built.words[2], 0xBD840002); // LT, DR0 minus 2
assert.equal(built.words[3], 0xBF000002); // AL, DR0 plus 2
assert.equal(asm.disassemble(0xBF040013), 'BRANCH  -19');
assert.equal(asm.disassemble(0xBF140003), 'BRANCH  DR2 - 3');
assert.equal(asm.assemble('BRANCH NE DR2 - 3').words[0], 0xB8940003);
for (const word of [0xBF03FFFF, 0xBF07FFFF, 0xBF140003]) {
    const text = asm.disassemble(word);
    // Bounds diagnostics are expected for static targets outside this one-word
    // fixture; the emitted instruction must still retain all 18 magnitude bits.
    assert.equal(new Assembler().assemble(text).words[0], word);
}
for (const literal of ['262144', '-262144', '3junk'])
    assert(new Assembler().assemble(`BRANCH ${literal}`).errors.length);
const cc = new Compiler().compile(`abstraction test.Branch {
    capabilities { SELF E }
    method Run() { ${source} }
}`, []);
assert.deepEqual(cc.errors, []);
assert.deepEqual(cc.methods[0].code.slice(0, built.words.length), built.words);
const {sim, compile, activate} = fixture(true);
activate(compile(30, source));
sim.pc = 1;
for (let i = 0; i < 100 && !sim.halted; i++) sim.step();
assert(sim.halted);
assert.equal(sim.dr[1], 3);
const encoded = new Compiler().encode(23, 14, 0, 0, -262143);
assert.equal(encoded, 0xBF07FFFF);
function runGenerated(code, argument = 0) {
    const f = fixture(true);
    f.activate(f.install(30, code));
    f.sim.dr[1] = argument;
    f.sim.dr[2] = 2;
    // Stop before the enclosing RETURN: these tests exercise generated
    // arithmetic/loop bodies, not an invented host CALL continuation.
    for (let i = 0; i < 1000 && !f.sim.halted; i++) {
        const word = code[f.sim.pc];
        if ((word >>> 27) === 3) return f.sim;
        f.sim.step();
    }
    assert(f.sim.halted, 'generated loop must terminate');
    return f.sim;
}
for (const [expr, expected] of [['x * x', 49], ['x / y', 3], ['x % y', 1]]) {
    const result = new Compiler().compile(`abstraction test.Arithmetic {
        method Run(x, y) = ${expr}
    }`, []);
    assert.deepEqual(result.errors, []);
    assert.equal(runGenerated(result.methods[0].code, 7).dr[1], expected);
}
const repeat = new Compiler()._compileSymbolicMethod({
    name: 'Run', params: [],
    body: ['V0 = 0', 'repeat 3 as i', 'V0 = V0 + 1', 'end', 'halt']
        .map((text, i) => ({text, line: i + 1})),
}, [], [], []);
assert.deepEqual(repeat.errors, []);
assert.equal(runGenerated(repeat.code).dr[4], 3);
// Exercise English translation and its generated while-loop continuation.
const english = new Compiler().compileEnglish(`Create an abstraction called Loop
Add a method called Run
Set n to 3
While n is greater than 0
Set n to n minus 1
End while
Return n`, []);
assert.deepEqual(english.errors, []);
assert.equal(runGenerated(english.methods[0].code).dr[1], 0);
console.log('PASS: shared BRANCH encoding, compiler equality, disassembly, limits and native loop');
require('./test_factory_branch_encoding');
