'use strict';

// Regression coverage for capability-register null predicates. These are an
// ABI construct for native-bound system LUMPs, never a data-register coercion.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.METHOD_REGISTER_CONVENTIONS = {};
global.BOOT_UPLOADS = [];
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'cloomc_compiler.js'), 'utf8'));

let checks = 0;
function check(label, condition, detail = '') {
    assert.ok(condition, `${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`PASS ${label}`);
    checks++;
}

function compile(source) {
    return new CLOOMCCompiler().compile(source, []);
}

const canonicalBankSource = fs.readFileSync(
    path.join(__dirname, 'cloomc', 'bank.cloomc'), 'utf8',
);
const bankResult = compile(canonicalBankSource);
const createManifest = bankResult.manifest.find(method => method.name === 'Create');
check('canonical Bank source compiles through the normal editor compiler',
    bankResult.errors.length === 0, JSON.stringify(bankResult.errors));
check('CR0 != null uses Bank’s fail-closed native predicate serialization',
    createManifest.mapping.some(entry =>
        entry.desc === 'if (CR0 != null) [native capability predicate; static fallback fails closed]'));

const nullPathResult = compile([
    'abstraction Bank {',
    '  method NullPath() {',
    '    if (CR0 == null) {',
    '      return(7)',
    '    }',
    '    return(0)',
    '  }',
    '}',
].join('\n'));
const nullPathManifest = nullPathResult.manifest.find(method => method.name === 'NullPath');
check('CR0 == null is recognized as the native null path',
    nullPathResult.errors.length === 0 &&
    nullPathManifest.mapping.some(entry =>
        entry.desc === 'if (CR0 == null) [native capability predicate; static fallback]'),
    JSON.stringify(nullPathResult.errors));

const dataNullResult = compile([
    'abstraction Bank {',
    '  method BadDataTest() {',
    '    if (DR0 != null) {',
    '      return(1)',
    '    }',
    '    return(0)',
    '  }',
    '}',
].join('\n'));
check('DR0 cannot be compared to null as a capability predicate',
    dataNullResult.errors.some(error => /Cannot resolve expression: null/.test(error.message)),
    JSON.stringify(dataNullResult.errors));

const mixedRegisterResult = compile([
    'abstraction Bank {',
    '  method BadMixedTest() {',
    '    if (CR0 != DR0) {',
    '      return(1)',
    '    }',
    '    return(0)',
    '  }',
    '}',
].join('\n'));
check('a capability register cannot be compared to a data register',
    mixedRegisterResult.errors.some(error => /Cannot resolve expression: CR0/.test(error.message)),
    JSON.stringify(mixedRegisterResult.errors));

if (checks !== 5) process.exit(1);
console.log(`All ${checks} capability-predicate compiler checks passed.`);