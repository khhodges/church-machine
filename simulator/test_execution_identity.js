// Browser-side execution identity provenance regression coverage.
//
// Run: node simulator/test_execution_identity.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const shell = fs.readFileSync(path.join(__dirname, 'app-shell.js'), 'utf8');
const lumps = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const appRun = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const begin = shell.indexOf('// ── Execution identity');
const end = shell.indexOf('// Called by _loadLumpBinaryIntoSim', begin);
if (begin < 0 || end < 0) throw new Error('Unable to extract execution identity controller');
const CONTROLLER = shell.slice(begin, end);

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
    if (condition) {
        passed++;
        console.log('  PASS ' + name);
    } else {
        failed++;
        console.error('  FAIL ' + name + (detail ? ' — ' + detail : ''));
    }
}

function makeEnv() {
    const dom = new JSDOM(`<!doctype html><html><body>
        <textarea id="asmEditor"></textarea>
        <div id="executionIdentityEditor"></div>
        <div id="executionIdentityTrace"></div>
        <div id="executionIdentityHwTrace"></div>
        <div id="executionIdentityAnnouncement" role="status"></div>
    </body></html>`, { url: 'https://example.test/simulator/', runScripts: 'outside-only' });
    const sandbox = {
        window: dom.window,
        document: dom.window.document,
        console,
        JSON,
        Array,
        Number,
        String,
        Math,
        Uint8Array,
        DataView,
    };
    vm.createContext(sandbox);
    vm.runInContext(CONTROLLER, sandbox, { filename: 'app-shell.execution-identity.js' });
    return { dom, api: sandbox.window.ExecutionIdentity };
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

(function testEditorRunAndStaleness() {
    const { dom, api } = makeEnv();
    api.begin({
        abstraction: 'Math.Add',
        token: 'cafebabe',
        source: 'RETURN',
        nsSlot: 12,
        nsSequence: 7,
        runKind: 'editor',
        runStatus: 'assembled',
    });
    api.markLive({ nsSlot: 12, nsSequence: 7, runStatus: 'ready' });
    api.setBinaryVerification(HASH_A, HASH_A);
    check('EI-1 clean editor run is current', api.get().status === 'current');
    check('EI-2 current state records identity fields',
        api.get().abstraction === 'Math.Add' && api.get().token === 'cafebabe' &&
        api.get().nsSlot === 12 && api.get().nsSequence === 7);

    api.updateEditor('RETURN');
    check('EI-3 unchanged editor remains current', api.get().status === 'current');
    // This is the same controller update used after openLumpInEditor assigns
    // recovered source or restores/discards a saved-LUMP draft.
    api.updateEditor('different saved LUMP source');
    check('EI-3a opening or restoring another saved LUMP makes the prior run stale',
        api.get().status === 'stale' && api.get().sourceStatus === 'stale');
    api.updateEditor('RETURN');
    api.updateEditor('HALT');
    check('EI-4 editor mutation becomes stale', api.get().status === 'stale' &&
        api.get().sourceStatus === 'stale');

    const editorStrip = dom.window.document.getElementById('executionIdentityEditor');
    const traceStrip = dom.window.document.getElementById('executionIdentityTrace');
    check('EI-5 editor strip shows accessible stale text',
        /STALE EDITOR/.test(editorStrip.textContent) &&
        /Program/.test(editorStrip.textContent) &&
        /Token/.test(editorStrip.textContent) &&
        /Source/.test(editorStrip.textContent) &&
        /Binary/.test(editorStrip.textContent) &&
        /NS/.test(editorStrip.textContent) &&
        /Execution identity: STALE EDITOR/.test(editorStrip.getAttribute('aria-label') || ''));
    check('EI-6 trace strip mirrors identity', /STALE EDITOR/.test(traceStrip.textContent));
    check('EI-6a only the dedicated announcement region is live',
        !editorStrip.hasAttribute('role') && !traceStrip.hasAttribute('role') &&
        dom.window.document.getElementById('executionIdentityAnnouncement').getAttribute('role') === 'status');
})();

(function testBinaryStatesAndSavedLumpSource() {
    const { dom, api } = makeEnv();
    api.begin({
        abstraction: 'Saved.Program',
        token: '01234567',
        sourceHash: HASH_A,
        binaryHash: HASH_A,
        nsSlot: 8,
        runKind: 'saved-lump',
    });
    api.markLive({ nsSlot: 8, runStatus: 'ready' });
    api.setBinaryVerification(HASH_A, HASH_B);
    check('EI-7 changed fetched binary is mismatched', api.get().status === 'mismatched' &&
        api.get().binaryStatus === 'mismatched');
    check('EI-8 binary mismatch is visible in hardware trace strip',
        /MISMATCHED BINARY/.test(dom.window.document.getElementById('executionIdentityHwTrace').textContent));

    api.setBinaryVerification(null, null);
    check('EI-9 missing compile-time baseline is unverified',
        api.get().status === 'unverified' && api.get().binaryStatus === 'unverified');
    api.updateEditor('unrelated editor contents');
    check('EI-10 saved SHA provenance is recorded, not falsely marked stale',
        api.get().sourceStatus === 'recorded' && api.get().status === 'unverified');
    api.setBinaryVerification(HASH_A, HASH_A);
    check('EI-10a opaque source hashes remain unverified even when binary matches',
        api.get().sourceComparable === false && api.get().binaryStatus === 'verified' &&
        api.get().status === 'unverified' && /Source bytes are unavailable/.test(api.get().reason));

    api.begin({ abstraction: 'Saved.Program', token: '01234567', source: 'RETURN', binaryHash: HASH_A });
    api.updateEditor('different editor program');
    api.markLive({ runStatus: 'ready' });
    api.setBinaryVerification(HASH_A, HASH_A);
    check('EI-10b saved source versus current editor is stale',
        api.get().sourceStatus === 'stale' && api.get().status === 'stale');

    api.begin({ abstraction: 'SourceFree.Program', token: '76543210', source: '', binaryHash: HASH_A });
    api.updateEditor('unrelated editor program');
    api.markLive({ runStatus: 'ready' });
    api.setBinaryVerification(HASH_A, HASH_A);
    check('EI-10c empty saved source is compared with a nonempty editor',
        api.get().sourceComparable === true && api.get().sourceStatus === 'stale' &&
        api.get().status === 'stale');
})();

(function testClearAndControllerSurface() {
    const { api } = makeEnv();
    api.begin({ abstraction: 'SelfTest', token: '059dc47f', source: 'RETURN', runKind: 'selftest' });
    api.markLive({ runStatus: 'running' });
    api.clear('Reset cleared the previous execution identity');
    check('EI-11 reset/program clear loses trusted live identity',
        api.get().status === 'unverified' && api.get().liveMemoryKnown === false &&
        /Reset cleared/.test(api.get().reason));
    check('EI-12 controller exposes word verification for saved LUMPs',
        typeof api.verifyWords === 'function' && typeof api.hashWords === 'function');
    check('EI-13 saved and SelfTest paths use sidecar binary baselines, not response hashes',
        /binaryHash:\s*_savedMetadata\.binaryHash/.test(lumps) &&
        /verifyWords\(rawWords,\s*_savedMetadata\.binaryHash,\s*token\)/.test(lumps) &&
        /selfTestDetail && selfTestDetail\.binary_hash/.test(lumps));
    check('EI-14 load paths compare saved/SelfTest source against the actual editor',
        (lumps.match(/ExecutionIdentity\.updateEditor\(editor\.value\)/g) || []).length === 2);
    check('EI-14a available empty source stays comparable instead of falling back to an opaque hash',
        /sourceHash:\s*_savedMetadata\.source !== null \? null/.test(lumps) &&
        /typeof selfTestDetail\.source === 'string'/.test(lumps));
    check('EI-14b saved-LUMP source and draft assignments update execution identity',
        /_setSavedLumpEditorSource\(_savedDraft\)/.test(lumps) &&
        /_setSavedLumpEditorSource\(window\._editorOriginalDisasm \|\| ''\)/.test(lumps) &&
        /_setSavedLumpEditorSource\(_recoveredSource\)/.test(lumps) &&
        /ExecutionIdentity\.updateEditor\(asmEd\.value\)/.test(lumps));
    check('EI-15 assembled programs verify their local compiled binary',
        /ExecutionIdentity\.hashWords\(_aplWords\)/.test(appRun) &&
        /ExecutionIdentity\.verifyWords\(_aplWords, expected, _aplToken\)/.test(appRun));
    check('EI-16 fault clear, fault reboot, and hardware reboot clear identity',
        (appRun.match(/ExecutionIdentity\.clear\(/g) || []).length >= 5 &&
        /Fault clear reset/.test(appRun) && /Fault reboot reset/.test(appRun) &&
        /Hardware reboot reset/.test(appRun));
})();

if (failed) {
    console.error(`\n${failed} execution identity test(s) failed; ${passed} passed.`);
    process.exit(1);
}
console.log(`\nAll ${passed} execution identity tests passed.`);