'use strict';
// Regression: a capability declared in a source C-List is valid shorthand in
// the two-operand LOAD form. It is not a CR alias until explicitly loaded.

const ChurchAssembler = require('./assembler.js');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
    if (condition) { console.log('PASS ' + label); passed++; }
    else { console.error('FAIL ' + label + (detail ? ': ' + detail : '')); failed++; }
}

const source = [
    'capabilities {',
    '    SelfTest E',
    '}',
    'LOAD CR2, SelfTest',
    '.pet selfGT CR2',
    'TPERM selfGT, EXACT, selfGT',
].join('\n');
const result = new ChurchAssembler().assemble(source);

check('NCL-1: LOAD accepts a declared named C-List entry', result.errors.length === 0,
    result.errors.map(error => error.message).join(' | '));
check('NCL-2: named LOAD reads from CR6 row 0',
    result.words.length >= 1 &&
    ((result.words[0] >>> 19) & 0xF) === 2 &&
    ((result.words[0] >>> 15) & 0xF) === 6 &&
    (result.words[0] & 0x7FFF) === 0,
    result.words[0] && '0x' + result.words[0].toString(16));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);