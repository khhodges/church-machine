'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    _lumpSaveRequest,
    _lumpSaveFailureClassification,
} = require('./lump_save_handler.js');

let passed = 0;
let failed = 0;
function check(name, value) {
    if (value) { console.log('PASS', name); passed++; }
    else { console.log('FAIL', name); failed++; }
}

function response(status, body) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(body),
    });
}

(async function() {
    let commits = 0;
    await _lumpSaveRequest(
        () => response(200, '{"ok":true,"token":"00000a00"}'),
        '/api/lumps/save', {}, () => { commits++; });
    check('valid JSON success commits browser state once', commits === 1);

    commits = 0;
    try {
        await _lumpSaveRequest(
            () => response(422, '{"error":"Church E-only required"}'),
            '/api/lumps/save', {}, () => { commits++; });
        check('validation rejects promise', false);
    } catch (error) {
        check('JSON validation is classified validation',
            error.kind === 'validation' && /Church E-only/.test(error.message));
    }
    check('validation does not commit browser state', commits === 0);

    const ideClassification = _lumpSaveFailureClassification(422, {
        namespace_identity_failed: true,
        failure_owner: 'ide',
        committed: false,
        safe_retry: true,
    });
    check('canonical identity failure is IDE-owned and safe only when proven pre-commit',
        ideClassification.kind === 'ide' &&
        ideClassification.committed === false &&
        ideClassification.safeRetry === true);
    const legacyIdentityClassification = _lumpSaveFailureClassification(422, {
        namespace_identity_failed: true,
    });
    check('legacy identity marker never implies a known commit result or safe retry',
        legacyIdentityClassification.kind === 'ide' &&
        legacyIdentityClassification.committed === null &&
        legacyIdentityClassification.safeRetry === false);

    let recoveryRequests = 0;
    let rebuilds = 0;
    commits = 0;
    const recovered = await _lumpSaveRequest(
        () => {
            recoveryRequests++;
            return recoveryRequests === 1
                ? response(422, JSON.stringify({
                    error: 'Namespace identity changed during canonicalization',
                    failure_owner: 'ide',
                    namespace_identity_failed: true,
                    committed: false,
                    safe_retry: true,
                }))
                : response(200, '{"ok":true,"token":"00000a01"}');
        },
        '/api/lumps/save', { binary: [1, 2] }, () => { commits++; }, {
            attempted: false,
            rebuildPayload: payload => {
                rebuilds++;
                return JSON.parse(JSON.stringify(payload));
            },
        });
    check('proven pre-commit IDE failure rebuilds and retries once internally',
        recovered.token === '00000a01' && recoveryRequests === 2 &&
        rebuilds === 1 && commits === 1);

    try {
        await _lumpSaveRequest(
            () => response(500, '{"error":"boot transaction rolled back"}'),
            '/api/lumps/save', {}, () => {});
        check('JSON server failure rejects promise', false);
    } catch (error) {
        check('JSON 5xx is server failure and preserves message',
            error.kind === 'server' &&
            error.status === 500 &&
            /boot transaction rolled back/.test(error.message));
    }

    try {
        await _lumpSaveRequest(
            () => response(500, '<html>server traceback</html>'),
            '/api/lumps/save', {}, () => {});
        check('HTML rejects promise', false);
    } catch (error) {
        check('HTML/malformed response is protocol, not network',
            error.kind === 'protocol' && /HTTP 500/.test(error.message));
    }

    try {
        await _lumpSaveRequest(
            () => Promise.reject(new TypeError('connection refused')),
            '/api/lumps/save', {}, () => {});
        check('transport rejects promise', false);
    } catch (error) {
        check('true fetch rejection is transport', error.kind === 'transport');
    }

    const source = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    const start = source.indexOf('function confirmSaveToNamespace()');
    const end = source.indexOf('function saveNamespaceState()', start);
    const body = source.slice(start, end);
    check('server request precedes simulator replacement mutation',
        body.indexOf('_lumpSaveRequest(') < body.indexOf('sim.saveToNamespaceAt('));
    const successCallback = body.slice(body.indexOf("_lumpSaveRequest(fetch, '/api/lumps/save'"));
    check('confirmed repository success closes modal before local state work',
        successCallback.indexOf('closeSaveDialog();') >= 0 &&
        successCallback.indexOf('closeSaveDialog();') < successCallback.indexOf('sim.saveToNamespaceAt('));
    check('successful save gives actionable Namespace and Run guidance',
        successCallback.includes('Open Namespace to inspect it') &&
        successCallback.includes('choose Run to execute'));
    check('IDE-owned failure preserves source without programmer retry guidance',
        successCallback.includes('IDE Save Incident') &&
        successCallback.includes('source and settings remain preserved') &&
        !successCallback.includes('Correct the LUMP or Namespace settings, then click Save again.'));
    check('safe recovery regenerates both save plan and approval binding',
        successCallback.includes('window._requestLumpSavePlan(') &&
        successCallback.includes('window._requestLumpApprovalIntent(') &&
        successCallback.includes('delete rebuilt.metadata.approval_intent'));
    check('clearing modal feedback also clears a prior incident lock',
        source.includes('delete status.dataset.incident;'));
    check('generic screenshot retry wording cannot return',
        !source.includes('Save did not complete. Review the settings, then click Save again.'));
    check('save payload carries destination sequence for server-owned identity binding',
        body.includes('namespace_sequence: _targetSequence'));
    check('transport and protocol failures have distinct UI titles',
        body.includes('LUMP Repository Network Failure') &&
        body.includes('LUMP Repository Protocol Failure') &&
        body.includes('LUMP Repository Server Failure'));

    const editorSource = fs.readFileSync(path.join(__dirname, 'app-lump-editor.js'), 'utf8');
    function extractFunction(name) {
        const marker = `function ${name}(`;
        const start = editorSource.indexOf(marker);
        if (start < 0) throw new Error(`missing ${name}`);
        const brace = editorSource.indexOf('{', start);
        let depth = 0;
        for (let i = brace; i < editorSource.length; i++) {
            if (editorSource[i] === '{') depth++;
            if (editorSource[i] === '}' && --depth === 0) return editorSource.slice(start, i + 1);
        }
        throw new Error(`unterminated ${name}`);
    }
    const residentContext = {};
    vm.createContext(residentContext);
    vm.runInContext(
        'var FIXED_BOOT_STEP2_SLOT_COUNT = 11;\n' +
        extractFunction('_isFixedBootStep2Slot') + '\n' +
        extractFunction('_rlBuildStep2Lumps'),
        residentContext);
    const step2Rows = residentContext._rlBuildStep2Lumps({
        10: {
            loadPolicy: 'Resident', abstraction: 'CapabilityTest',
            lumpToken: '00000a00', physAddr: 2048, lumpSize: 512
        },
        11: {
            loadPolicy: 'Resident', abstraction: 'UserProgram',
            lumpToken: '12345678', physAddr: 4096, lumpSize: 64
        }
    });
    check('CapabilityTest fixed slot 10 is omitted from Step-2 payload',
        step2Rows.length === 1 && step2Rows[0].nsSlot === 11);
    check('valid programmer resident row remains in Step-2 payload',
        step2Rows[0].abstraction === 'UserProgram' &&
        step2Rows[0].physAddr === 4096 && step2Rows[0].lumpSize === 64);

    const saveStart = editorSource.indexOf('window.lumpEditorRLSave = function ()');
    const saveEnd = editorSource.indexOf('window.lumpEditorRLGenerate', saveStart);
    const saveBody = editorSource.slice(saveStart, saveEnd);
    check('Resident Save rejects duplicate clicks while request is unresolved',
        saveBody.includes('if (_rl.saveInFlight) return;') &&
        saveBody.includes('_rl.saveInFlight = true;'));
    check('Resident Save clears in-flight state for every terminal outcome',
        saveBody.includes('.finally(function()') &&
        saveBody.includes('_rl.saveInFlight = false;'));
    check('Resident Save surfaces server-provided failure reasons',
        saveBody.includes('res.body.error'));
    check('Resident Save persists the selected Lightning Bolt slot with the config',
        saveBody.includes('bootEntrySlot: (function ()') &&
        saveBody.includes("localStorage.getItem('bootEntrySlot')"));
    check('Resident config load restores a server-saved Lightning Bolt on a fresh browser',
        editorSource.includes('var savedBootSlot = cfg && cfg.bootEntrySlot;') &&
        editorSource.includes('setBootEntrySlot(savedBootSlot);'));

    console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
})().catch(error => {
    console.error(error);
    process.exit(1);
});