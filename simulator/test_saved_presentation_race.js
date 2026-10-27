'use strict';
// Read-only display race: no HTTP server, storage writes or real save requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const start = code.indexOf('async function _fetchAndPresentCommittedLump(');
const end = code.indexOf('\nwindow._fetchAndPresentCommittedLump', start);
assert(start >= 0 && end > start);
const commitStart = code.indexOf('function _commitSavedLumpClientState(');
const commitEnd = code.indexOf('\nwindow._commitSavedLumpClientState', commitStart);
assert(commitStart >= 0 && commitEnd > commitStart);
const commitContext = {window:{}, document:{getElementById:()=>null}};
vm.createContext(commitContext);
vm.runInContext(code.slice(commitStart,commitEnd),commitContext);
const descriptor = commitContext._commitSavedLumpClientState(
    {token:'B',lump:'B.lump',digest:'a'.repeat(64)}, {}, null);
assert.equal(descriptor.binary_hash,'a'.repeat(64),
    'save response digest pins the subsequent canonical binary fetch');

(async () => {
    for (const outcome of ['success', 'error']) {
        for (const superseded of [false, true]) {
            let release;
            const displayed = [];
            const context = {
                window: {}, console,
                fetch: () => new Promise(resolve => { release = resolve; }),
                _savedLumpPresentationStillOwnsSource: () => true,
                _isExactSavedLumpWordArray: Array.isArray,
                _readSavedLumpExactTail: () => null,
                _getSavedLumpWordUsageSummary: async () => '64 words',
                _formatCanonicalSavedLumpWords: () => 'exact saved words',
                _showCanonicalSavedLumpBesideSource: (...args) => displayed.push(args),
            };
            vm.createContext(context);
            vm.runInContext(code.slice(start, end), context);
            const work = context._fetchAndPresentCommittedLump(
                {token:'B'}, {filename:'B.lump',binary_hash:'abc'}, {source:'B',epoch:1});
            if (superseded) context.window._binaryPresentationEpoch++;
            release({ok:outcome === 'success',status:503,json:async()=>({
                filename:'B.lump',binary_hash:'abc',words:[0xf8000400,0],
            })});
            const result = await work;
            assert.equal(displayed.length, superseded ? 0 : 1,
                'neither stale bytes nor a stale error may replace a newer compile');
            assert.equal(result, !superseded && outcome === 'success');
        }
    }
    console.log('PASS saved presentation: current success/error render; stale success/error cannot replace newer output');
})().catch(error => { console.error(error); process.exitCode = 1; });
