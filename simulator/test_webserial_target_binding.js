'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'webserial.js'), 'utf8');
const sandbox = {
    console,
    navigator: { serial: {} },
    Uint8Array,
    setTimeout,
    clearTimeout,
    fetch: async function() { throw new Error('network must not be reached'); },
};
sandbox.window = {
    addEventListener: function() {},
    TargetState: {
        authorize: function() {
            throw new Error('global bridge authority must not be borrowed');
        },
    },
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const TangSerial = vm.runInContext('TangSerial', sandbox);

let passed = 0;
function check(ok, message) {
    if (!ok) throw new Error(message);
    passed++;
    console.log('✓ ' + message);
}
async function blocked(promise, operation) {
    try {
        await promise;
        check(false, operation + ' unexpectedly succeeded');
    } catch (error) {
        check(/cannot verify the exact device UID\/session/.test(error.message) &&
            /bridge\/server Runtime Upload path/.test(error.message),
        operation + ' fails closed without transport-proven UID/session');
    }
}

(async function() {
    await blocked(TangSerial.uploadToFPGA([], []), 'WebSerial upload');
    await blocked(TangSerial.patchLump(0, [0]), 'WebSerial patch');
    await blocked(TangSerial.runFPGA(), 'WebSerial run');
    await blocked(TangSerial.readBRAM(0, 1), 'WebSerial readback');
    check(TangSerial.isSupported(), 'diagnostic UART capability detection remains available');
    console.log('webserial-target-binding: ' + passed + ' assertions passed');
})().catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});