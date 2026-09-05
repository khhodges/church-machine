'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto, createHash } = require('crypto');
const ChurchSimulator = require('./simulator.js');
const LumpContentFrame = require('./lump-content-frame.js');

let passed = 0;
let failed = 0;
function check(label, condition) {
    console.log((condition ? 'PASS ' : 'FAIL ') + label);
    condition ? passed++ : failed++;
}

const source = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const start = source.indexOf('const _LUMP_APPROVAL_FIELDS');
const endMarker = 'window._requestLumpApprovalIntent = _requestLumpApprovalIntent;';
const end = source.indexOf(endMarker, start) + endMarker.length;
if (start < 0 || end < endMarker.length) throw new Error('approval-intent helpers not found');

const requests = [];
const sandbox = {
    crypto: webcrypto,
    window: {},
    Uint8Array,
    Set,
    Object,
    Array,
    Number,
    fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ url, options, body });
        if (url === '/api/lumps/save-plan') {
            return {
                ok: true,
                json: async () => ({
                    plan_id: body.metadata.token === 'same-token' ? 'replace-plan' : 'create-plan',
                    action: body.metadata.token === 'same-token' ? 'replace' : 'save',
                    consequence: body.metadata.token === 'same-token' ? 'replace' : 'create',
                    digest: body.metadata.token === 'canonicalized'
                        ? 'f'.repeat(64)
                        : createHash('sha256').update(Buffer.from(
                            body.binary.flatMap(word => [
                                (word >>> 24) & 0xFF, (word >>> 16) & 0xFF,
                                (word >>> 8) & 0xFF, word & 0xFF
                            ])
                        )).digest('hex'),
                    current_lump: body.metadata.token === 'same-token'
                        ? { abstraction: 'Named.Current', token: 'same-token' } : null
                })
            };
        }
        return {
            ok: true,
            json: async () => ({
                intent: 'one-time-intent',
                digest: body.digest,
                action: body.action,
                plan_id: body.plan
            })
        };
    }
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end), sandbox);

(async () => {
    const words = [0xF8000400, 0x12345678];
    const bytes = Buffer.alloc(8);
    words.forEach((word, i) => bytes.writeUInt32BE(word >>> 0, i * 4));
    const expected = createHash('sha256').update(bytes).digest('hex');

    async function flow(confirmed, token) {
        const metadata = {
            abstraction: 'Approved.Name',
            token,
            author: 'Alice',
            cw: 999,
            cc: 999,
            lump_size: 4096,
            source: 'not approval metadata',
            methods: [{ name: 'Mallory' }],
            capabilities: [{ name: 'MalloryCap' }],
            language: 'mallory',
            profile: 'mallory',
            content_type: 'mallory',
            api_definition: { methods: [] },
            clist_entries: [0],
            typ: 7
        };
        const plan = await sandbox.window._requestLumpSavePlan(words, metadata);
        if (!confirmed) return null;
        return sandbox.window._requestLumpApprovalIntent(words, plan.action, metadata, plan);
    }

    await flow(false);
    check('cancellation obtains only a pre-confirmation save plan',
        requests.length === 1 && requests[0].url === '/api/lumps/save-plan');

    const result = await flow(true);
    check('intent requested only after a save plan and confirmation', requests.length === 3);
    check('request uses approval-intent endpoint',
        requests[2].url === '/api/lumps/approval-intent');
    check('digest is lowercase SHA-256 of exact big-endian words',
        requests[2].body.digest === expected && /^[0-9a-f]{64}$/.test(expected));
    check('request binds action and explicit confirmation',
        requests[2].body.action === 'save' && requests[2].body.confirmation === true &&
        requests[2].body.plan === 'create-plan');
    check('approval object uses strict non-intrinsic allowlist',
        requests[2].body.approval.abstraction === 'Approved.Name' &&
        requests[2].body.approval.author === 'Alice' &&
        !('cw' in requests[2].body.approval) &&
        !['cc', 'lump_size', 'source', 'methods', 'capabilities', 'language',
            'profile', 'content_type', 'api_definition', 'clist_entries', 'typ']
            .some(key => key in requests[2].body.approval));
    check('server one-time intent is returned to mutation caller',
        result.intent === 'one-time-intent' && result.digest === expected);
    check('server plan determines create/replace display, including named current LUMP',
        sandbox.window._formatLumpSavePlan({
            action: 'save', consequence: 'create'
        }) === 'Create a new LUMP.' &&
        sandbox.window._formatLumpSavePlan({
            action: 'replace', consequence: 'replace',
            current_lump: { abstraction: 'Named.Current' }
        }) === 'Replace current LUMP "Named.Current".');
    const newToken = await flow(true);
    const newTokenPlanRequest = requests[3];
    const newTokenIntentRequest = requests[4];
    check('same abstraction with a new token remains a server-authored create',
        newTokenPlanRequest.body.metadata.token === undefined &&
        newTokenIntentRequest.body.action === 'save' && newToken.plan_id === 'create-plan');
    const same = await flow(true, 'same-token');
    const samePlanRequest = requests[5];
    const sameIntentRequest = requests[6];
    check('same-token replacement binds the returned plan, not a local inference',
        samePlanRequest.url === '/api/lumps/save-plan' &&
        sameIntentRequest.body.action === 'replace' &&
        sameIntentRequest.body.plan === 'replace-plan' && same.plan_id === 'replace-plan');
    await flow(true, 'canonicalized');
    check('save intent uses the server canonical digest when preflight changes bytes',
        requests[8].body.digest === 'f'.repeat(64));

    const memory = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
    const shell = fs.readFileSync(path.join(__dirname, 'app-shell.js'), 'utf8');
    const lumps = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
    check('retired metadata endpoint is absent',
        !memory.includes('/meta') && !lumps.includes('/meta'));
    check('retired WIP source endpoint is absent', !shell.includes('/wip-source'));

    const loaderStart = lumps.indexOf('async function _loadLumpBinaryIntoSim(');
    const loaderEnd = lumps.indexOf('\nasync function _lumpGTNameCommit', loaderStart);
    const localLoader = lumps.slice(loaderStart, loaderEnd);
    check('local simulator deployment confirms, consumes deploy intent, then loads',
        loaderStart >= 0 && loaderEnd > loaderStart &&
        localLoader.includes('_loadSavedLumpCapabilities(token, data)') &&
        localLoader.includes('if (!confirm(`Deploy "') &&
        localLoader.includes("_requestLumpApprovalIntent(rawWords, 'deploy'") &&
        localLoader.includes("fetch('/api/lumps/deploy-authorize'") &&
        localLoader.indexOf("fetch('/api/lumps/deploy-authorize'") <
            localLoader.indexOf('sim.loadLumpBinary('));
    check('cancel or authorization failure occurs before simulator mutation',
        localLoader.indexOf('if (!confirm(`Deploy "') <
            localLoader.indexOf('if (!sim.bootComplete && typeof instantBoot') &&
        localLoader.indexOf('if (!_deployAuth.ok || !_deployResult.ok)') <
            localLoader.indexOf('if (!sim.bootComplete && typeof instantBoot'));
    check('authorization succeeds before any boot-entry memory mutation',
        localLoader.indexOf('if (!_deployAuth.ok || !_deployResult.ok)') <
            localLoader.indexOf('sim.bootEntrySlot = _BOOT_SLOT'));

    // A strict approval has no capability/method/profile/language fields. Build
    // declarations from the exact embedded frame + c-list and install the same
    // immutable words after preflight.
    const frame = await LumpContentFrame.lumpBuildContentFrame(
        { methods: [{ name: 'Exact' }], capabilities: [] }, '', { profile: 'api' });
    const binary = new Array(64).fill(0);
    binary[0] = (((0x1F << 27) >>> 0) | (1 << 10) | 1) >>> 0;
    binary[1] = 0;
    binary.splice(2, frame.frameWords.length, ...frame.frameWords);
    binary[63] = 0x1800002a;
    const inspected = await LumpContentFrame.lumpInspectContentFrame(binary);
    const binaryBytes = Buffer.alloc(binary.length * 4);
    binary.forEach((word, i) => binaryBytes.writeUInt32BE(word >>> 0, i * 4));
    const binaryHash = createHash('sha256').update(binaryBytes).digest('hex');
    const strictApproval = {
        binary_hash: binaryHash,
        abstraction: 'Strict.Binary',
        grants: ['X'],
        capability_type: 0,
    };
    const metadataStart = lumps.indexOf('function _hashBoundLumpApproval(');
    const metadataEnd = lumps.indexOf('\nfunction _validateSavedLumpClist', metadataStart);
    const metadataSandbox = {
        ChurchSimulator,
        LumpContentFrame,
        Set,
        window: {},
        fetch: async () => ({
            ok: true,
            json: async () => ({ approval: strictApproval })
        })
    };
    vm.createContext(metadataSandbox);
    vm.runInContext(lumps.slice(metadataStart, metadataEnd), metadataSandbox);
    const strictMetadata = await metadataSandbox._loadSavedLumpCapabilities(
        'deadbeef', { words: binary, binary_hash: binaryHash });
    const validatorStart = lumps.indexOf('function _validateSavedLumpClist(');
    const validatorEnd = lumps.indexOf('\nfunction _validateLinkedPortableClist', validatorStart);
    const validatorSandbox = { ChurchSimulator };
    vm.createContext(validatorSandbox);
    vm.runInContext(lumps.slice(validatorStart, validatorEnd), validatorSandbox);
    const loadSim = new ChurchSimulator();
    const loadHeader = loadSim.parseLumpHeader(binary[0]);
    const preflight = validatorSandbox._validateSavedLumpClist(
        binary, loadHeader, strictMetadata, loadSim);
    const loaded = loadSim.loadLumpBinary(binary, 41);
    check('strict approval loads from exact binary c-list without intrinsic approval fields',
        inspected.headerValid && inspected.contentFrameValid &&
        strictMetadata.capabilities.length === 1 &&
        strictMetadata.capabilities[0].binary_word === binary[63] &&
        strictMetadata.methods[0].name === 'Exact' &&
        strictMetadata.profile === 'api' &&
        !('capabilities' in strictMetadata.approval) &&
        preflight.length === 1 && loaded === true);
    const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'app.py'), 'utf8');
    check('deploy authorization server contract consumes one-time deploy intent',
        server.includes('@app.route(\"/api/lumps/deploy-authorize\", methods=[\"POST\"])') &&
        server.includes('_consume_lump_approval_intent(payload.get(\"approval_intent\"), digest, \"deploy\")'));
    check('server consumption removes an intent before validating it, preventing replay',
        server.includes('_LUMP_APPROVAL_INTENTS.pop(str(intent or \"\"), None)'));

    const compile = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
    const run = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
    check('all browser save callers obtain server save-plan approval first',
        lumps.includes('_confirmLumpSavePlan(words, metadata') &&
        compile.includes('window._confirmLumpSavePlan(') &&
        run.includes('window._confirmLumpSavePlan(') &&
        memory.includes('window._confirmLumpSavePlan('));
    check('save-plan request preserves the original binary and metadata payload',
        lumps.includes('body: JSON.stringify({ binary: words, metadata: metadata || {} })') &&
        !lumps.includes('metadata.source =') &&
        !compile.includes('savePayload.metadata.source ='));
    const saveStart = compile.indexOf('async function compileAndBuild()');
    const saveEnd = compile.indexOf('\nfunction ', saveStart + 1);
    const saveFlow = compile.slice(saveStart, saveEnd > saveStart ? saveEnd : undefined);
    check('genuine immutable save submits a confirmed one-time intent atomically',
        saveFlow.includes('window._confirmLumpSavePlan(') &&
        saveFlow.includes('savePayload.metadata.approval_intent = _buildApproval.intent.intent') &&
        saveFlow.indexOf('approval_intent = _buildApproval.intent.intent') <
            saveFlow.indexOf("fetch('/api/lumps/save'"));

    const forkStart = lumps.indexOf('const _onFirstEdit = async () =>');
    const forkEnd = lumps.indexOf('const _newVer = _fd.new_version', forkStart);
    const forkFlow = lumps.slice(forkStart, forkEnd);
    check('genuine fork submits its post-confirmation intent for one-time consumption',
        forkStart >= 0 && forkEnd > forkStart &&
        forkFlow.includes("_requestLumpApprovalIntent(\n                                _words, 'fork'") &&
        forkFlow.includes('body: JSON.stringify({ approval_intent: _forkIntent.intent })'));

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
})().catch(error => {
    console.error(error);
    process.exit(1);
});