'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
const bindingStart = source.indexOf('function _compileCallApiBindings(');
const bindingEnd = source.indexOf('\n// Auto-fill rights for capabilities', bindingStart);
assert.notEqual(bindingStart, -1);
assert.notEqual(bindingEnd, -1);

const context = {
    _isCompilerSelfCapability(cap) {
        return !!cap && cap.compiler_owned_self === true;
    },
};
vm.createContext(context);
vm.runInContext(source.slice(bindingStart, bindingEnd), context);

let bindings = context._compileCallApiBindings([
    { name: 'SELF', compiler_owned_self: true },
    {
        name: 'org.example.Echo#7',
        T: 'A0B0C0D0',
        binary_hash: 'F'.repeat(64),
        rights: ['E'],
    },
    { name: 'Future', rights: ['E'] },
    { name: 'UART_DEV', rights: ['R', 'W'], null_row: true },
]);

bindings = JSON.parse(JSON.stringify(bindings));
assert.deepEqual(bindings, [
    {
        petname: 'org.example.Echo',
        token: 'a0b0c0d0',
        binary_hash: 'f'.repeat(64),
    },
    { petname: 'Future' },
]);

const parsed = JSON.parse(JSON.stringify(context._sourceCallApiBindings(`
capabilities {
    SELF E,
    org.example.Echo#7 T=A0B0C0D0 binary_hash=${'F'.repeat(64)} rights=E type=inform,
    Future E
}
CALL CR6[org.example.Echo], #0
`)));
assert.deepEqual(parsed, [
    {
        petname: 'org.example.Echo',
        token: 'a0b0c0d0',
        binary_hash: 'f'.repeat(64),
    },
    { petname: 'Future' },
]);

console.log('compile CALL API preparation tests passed');