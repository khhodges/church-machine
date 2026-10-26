'use strict';
// Independent software checks; do NOT translate/admit the experimental image.
const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
global.window = {bootConfig: {step1: {totalNamespaceWords: 16384,
    namespaceLumpWords: 64, threadLumpWords: 256, threadCount: 3}}};
const Simulator = require('./simulator.js');
const bytes = fs.readFileSync(require('path').join(__dirname,
    '../docs/phase-1/reload-evidence/new-layout-amoeba-runtime/candidate-le.bin'));
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
    '2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451');
const sim = new Simulator();
assert.equal(sim.loadBootImage(bytes.buffer.slice(bytes.byteOffset,
    bytes.byteOffset + bytes.length)), false);
assert.match(sim.lastBootImageError, /Namespace Header V2/);
const instruction = bytes.readUInt32LE(0x3504);
assert.equal(instruction, 2);
const decoded = sim.decodeInstruction(instruction);
assert.equal(decoded.opcode, 0);
assert.equal(decoded.cond, 0); // EQ: skipped when reset Z is zero.
assert.equal(!!sim.checkCondition(decoded.cond), false);

for (const operation of ['LOAD', 'CALL', 'CHANGE']) {
    const s = new Simulator();
    // Synthetic dirty live bank, not an assertion of admitted candidate state.
    for (const cr of s.cr) Object.assign(cr,
        {word0: 0x4a000011, word1: 0x1234, word2: 255, word3: 99, m: 1});
    s._returnToBoot('offline-authority-probe');
    assert(s.cr.every(cr => Object.values(cr).every(v => v === 0)));
    let fault;
    s.fault = code => { fault = code; s.halted = true; };
    const d = {crSrc: 1, crDst: 1, imm: 0, indexRegister: 0,
        indexMagnitude: 0, indexSubtract: false};
    if (operation === 'LOAD') s._execLoad(d);
    if (operation === 'CALL') s._execCall(d);
    if (operation === 'CHANGE') s._execChange(d, 0);
    assert(fault, `${operation} must not use pre-reset authority`);
    assert(s.cr.every(cr => Object.values(cr).every(v => v === 0)));
    console.log(`${operation} after reset: ${fault}`);
}
console.log('Exact-image admission rejection, conditional decode, and reset authority checks passed');
