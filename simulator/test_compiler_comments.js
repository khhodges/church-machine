'use strict';

// Regression tests for CLOOMC++ method-body comments and editor line numbers.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.METHOD_REGISTER_CONVENTIONS = {};
global.BOOT_UPLOADS = [];
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'cloomc_compiler.js'), 'utf8'));

const compiler = new CLOOMCCompiler();
let failures = 0;

function check(label, condition, detail = '') {
    if (condition) {
        console.log(`PASS ${label}`);
    } else {
        failures++;
        console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    }
}

const commentedProgram = [
    'abstraction Commented {',
    '  method run() {',
    '    // CR0 != null is documentation, not an expression.',
    '    let answer = 1; // initialize the result',
    '    return answer;',
    '  }',
    '}',
].join('\n');

const commentedResult = compiler.compile(commentedProgram, []);
check('whole-line and trailing // comments compile cleanly',
    commentedResult.errors.length === 0,
    JSON.stringify(commentedResult.errors));

const invalidProgram = [
    'abstraction Invalid {',
    '  method run() {',
    '    // The following line is intentionally invalid.',
    '    let answer = unknownValue;',
    '    return answer;',
    '  }',
    '}',
].join('\n');

const invalidResult = compiler.compile(invalidProgram, []);
const unknownError = invalidResult.errors.find(error =>
    /Cannot resolve expression: unknownValue/.test(error.message));
check('diagnostic identifies the statement line after a comment',
    unknownError && unknownError.line === 4,
    JSON.stringify(invalidResult.errors));

if (failures > 0) process.exit(1);
console.log('All CLOOMC comment tests passed.');