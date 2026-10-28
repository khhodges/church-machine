'use strict';
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const Assembler = require('./assembler');
global.ChurchAssembler = Assembler;
const Compiler = require('./cloomc_compiler');
for (const instruction of ['CALL test.Target', 'CALLEQ test.Target.Run', 'CALL test.Target, Run']) {
    const asm = new Assembler();
    asm.setLocalClistSlots({'test.Target': 1});
    const result = asm.assemble(instruction);
    assert(result.errors.some(e => /Cannot encode CALL.*unresolved/.test(e.message)));
    assert(!(result.symbolicCalls || []).length);
    const source = `abstraction test.Caller {
capabilities {
SELF E
test.Target E
}
method Start {
${instruction}
RETURN
}
}`;
    const browserResult = new Compiler().compile(source, []);
    assert(browserResult.errors.some(e => e.line === 7 && /Cannot encode CALL/.test(e.message)),
        JSON.stringify(browserResult.errors));
    const worker = spawnSync(process.execPath, ['server/compile_worker.js'], {
        input: JSON.stringify({source, language:'assembly', tier:2}), encoding:'utf8'
    });
    assert.equal(worker.status, 0, worker.stderr);
    const response = JSON.parse(worker.stdout);
    assert.equal(response.ok, false, worker.stdout);
    assert.match(worker.stdout, /Cannot encode CALL.*unresolved/);
    assert(!response.words, 'failed compilation must not return a candidate');
    assert(response.errors.some(e => e.line === 7), 'error must identify the CALL source line');
}
const nativeSource = 'abstraction test.Native {\ncapabilities {\nSELF E\ntest.Target E\n}\nmethod Run() {\nCALL test.Target.Run\n}\n}';
const native = spawnSync(process.execPath, ['server/compile_worker.js'], {
    input: JSON.stringify({source:nativeSource, language:'javascript'}), encoding:'utf8'
});
const nativeResult = JSON.parse(native.stdout);
assert.equal(nativeResult.ok, false);
assert.match(nativeResult.error, /Cannot encode CALL.*unresolved/);
const explicit = new Assembler().assemble('CALL CR1, #1');
assert.equal(explicit.errors.length, 0, JSON.stringify(explicit.errors));
assert.equal(explicit.words[0] >>> 27, 2);
console.log('PASS unresolved named CALL fails in assembler and server; explicit CALL remains encoded');
