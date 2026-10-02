'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
vm.runInThisContext(fs.readFileSync(__dirname + '/assembler.js', 'utf8'));
const Simulator = require('./simulator.js');
for (const mnemonic of ['ELOADCALL', 'XLOADLAMBDA']) {
    for (const suffix of ['', 'EQ', 'NV']) {
        const asm = new ChurchAssembler();
        assert.strictEqual(asm._assembleLine(`${mnemonic}${suffix} CR1, CR6, 1`, 1, 0), null);
        assert(asm.errors.some(error => /retired/.test(error.message)));
        const result = new ChurchAssembler().assemble(`${mnemonic}${suffix} CR1, CR6, 1`);
        assert(result.errors.some(error => /retired/.test(error.message)),
            'public compile must return an actionable retirement diagnostic');
    }
}
// The internal entry points also reject debug/direct callers before consulting
// capabilities or starting any legacy load/call sequence.
for (const method of ['_execEloadcall', '_execXloadlambda']) {
    let fault;
    const receiver = {fault(code, message) { fault = {code, message}; }};
    assert.strictEqual(Simulator.prototype[method].call(receiver, {}), null);
    assert.strictEqual(fault.code, 'INVALID_OP');
    assert.match(fault.message, /retired/);
}
// Exercise the actual step path, including condition-false encodings.
for (const opcode of [8, 9]) {
    for (const condition of [14, 15]) {
        const sim = new Simulator();
        sim.bootComplete = true;
        sim.halted = false;
        const word = ((opcode << 27) | (condition << 23)) >>> 0;
        sim._fetchInstruction = () => ({ok: true, word, addr: 0});
        const before = JSON.stringify({cr: sim.cr, dr: sim.dr, pc: sim.pc, sto: sim.sto});
        let fault;
        sim.fault = (code, message) => { fault = {code, message}; };
        sim.step();
        assert(fault, 'step must reject the retired instruction');
        assert.strictEqual(fault.code, 'INVALID_OP');
        assert.strictEqual(JSON.stringify({cr: sim.cr, dr: sim.dr, pc: sim.pc, sto: sim.sto}), before);
    }
}
console.log('Retired opcode compilation and simulator rejection: PASS');