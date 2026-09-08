'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'app-cr-detail.js'), 'utf8');
const start = source.indexOf('async function injectCRCodeToFPGA');
const end = source.indexOf('\n\nfunction _quickHash', start);
if (start < 0 || end < 0) throw new Error('actual patch handler not found');

let uploads = 0;
let uploadedBytes = null;
const memory = new Uint32Array([0x11223344, 0xAABBCCDD]);
const sandbox = {
    window: {
        TargetState: {
            authorizeDestination: function() {
                return { ok: true, target: { deviceUid: 'board-a', liveSessionId: 'session-a' } };
            },
        },
    },
    sim: { memory },
    DataView,
    Uint8Array,
    injectCRCode: function() {
        memory[1] = 0xDEADBEEF;
        return { newWords: [0xDEADBEEF], baseLoc: 1 };
    },
    _wukongLoadToHardware: async function(bytes) {
        uploads++;
        uploadedBytes = new Uint8Array(bytes);
        return true;
    },
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end), sandbox);
function check(ok, message) {
    if (!ok) throw new Error(message);
    console.log('✓ ' + message);
}
(async function() {
    const ok = await sandbox.injectCRCodeToFPGA({ textContent: '', scrollTop: 0, scrollHeight: 0 });
    const view = new DataView(uploadedBytes.buffer);
    check(ok && uploads === 1, 'actual patch handler uses one correlated runtime upload');
    check(view.getUint32(4, true) === 0xDEADBEEF,
        'actual patch handler materializes edited bytes in exact full runtime image');
    sandbox.injectCRCode = function() { return false; };
    uploads = 0;
    check(await sandbox.injectCRCodeToFPGA({ textContent: '', scrollTop: 0, scrollHeight: 0 }) === false &&
        uploads === 0, 'unsafe patch state fails before any hardware request');
})().catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});