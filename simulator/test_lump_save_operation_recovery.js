'use strict';

// Focused regression coverage for idempotent save reconciliation. This stays
// DOM-free so it can run under Node without a browser.
const {
    _lumpSaveRequest,
    _lumpSaveEnsureOperationId,
    _lumpSaveReconcilePendingOperations,
} = require('./lump_save_handler.js');

let pass = 0;
let fail = 0;
function check(label, condition) {
    console.log((condition ? 'PASS ' : 'FAIL ') + label);
    condition ? pass++ : fail++;
}
function jsonResponse(status, value) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(value),
    };
}

(async () => {
    const payload = { binary: [0xF8000400, 0], metadata: { operation_id: 'saved-op-0001' } };
    let postHeaders = null;
    let commitResponse = null;
    const recovered = await _lumpSaveRequest(async (url, options) => {
        if (options.method === 'POST') {
            postHeaders = options.headers;
            throw new TypeError('connection reset after request body');
        }
        check('reconciliation uses the durable save-operation endpoint',
            url === '/api/lumps/save-operations/saved-op-0001');
        return jsonResponse(200, {
            committed: true,
            response: { ok: true, token: 'cafebabe', operation_id: 'saved-op-0001' },
        });
    }, '/api/lumps/save', payload, response => { commitResponse = response; });
    check('lost POST response resolves from committed operation record',
        recovered.token === 'cafebabe' && commitResponse === recovered);
    check('POST carries stable operation header and metadata',
        postHeaders['X-Lump-Save-Operation'] === 'saved-op-0001' &&
        recovered.operation_id === 'saved-op-0001' &&
        payload.metadata.operation_id === undefined);

    const rejectedPayload = { binary: [0xF8000400, 0], metadata: { operation_id: 'saved-op-0002' } };
    try {
        await _lumpSaveRequest(async (_url, options) => {
            if (options.method === 'POST') throw new TypeError('connection reset');
            return jsonResponse(200, { committed: false, response: { error: 'rejected before commit' } });
        }, '/api/lumps/save', rejectedPayload);
        check('proven uncommitted operation rejects', false);
    } catch (error) {
        check('proven uncommitted operation remains retryable without invented success',
            error.kind === 'transport' && error.committed === false &&
            error.operation_id === 'saved-op-0002');
    }

    const correctedAttempts = [];
    const correctedPayload = {
        binary: [0xF8000400, 0],
        metadata: { operation_id: 'rejected-attempt', operation_key: 'corrected-save' },
    };
    let postAttempt = 0;
    const corrected = await _lumpSaveRequest(async (_url, options) => {
        if (options.method !== 'POST') {
            return jsonResponse(200, { committed: false });
        }
        correctedAttempts.push(options.headers['X-Lump-Save-Operation']);
        postAttempt++;
        return postAttempt === 1
            ? jsonResponse(422, {
                error: 'canonical identity changed',
                namespace_identity_failed: true,
                failure_owner: 'ide',
                committed: false,
                safe_retry: true,
            })
            : jsonResponse(200, { ok: true, token: 'corrected-token' });
    }, '/api/lumps/save', correctedPayload, null, {
        attempted: false,
        rebuildPayload: async payload => ({
            binary: payload.binary.slice(),
            metadata: Object.assign({}, payload.metadata, { corrected: true }),
        }),
    });
    check('proven rejected correction uses a new attempt operation id',
        corrected.token === 'corrected-token' &&
        correctedAttempts.length === 2 &&
        correctedAttempts[0] !== correctedAttempts[1]);

    // Simulate a reload with a retained unknown-operation journal. Once the
    // startup ledger lookup proves it settled, the logical mapping must be
    // retired so reconstructing the same deliberate save receives a new id.
    const oldSessionStorage = global.sessionStorage;
    const store = new Map();
    global.sessionStorage = {
        get length() { return store.size; },
        key: index => Array.from(store.keys())[index] || null,
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key),
    };
    const reloadedPayload = {
        binary: [0xF8000400, 0],
        metadata: { operation_key: 'reload-settled-key' },
    };
    store.set('church.lump-save-operation:reload-settled-key', 'settled-operation');
    store.set('church.lump-save-pending:settled-operation', JSON.stringify({
        operation_id: 'settled-operation',
        url: '/api/lumps/save',
        payload: {
            binary: reloadedPayload.binary,
            metadata: { operation_id: 'settled-operation', operation_key: 'reload-settled-key' },
        },
    }));
    await _lumpSaveReconcilePendingOperations(async () =>
        jsonResponse(200, { committed: false, response: { error: 'rejected' } }));
    const freshAfterReload = _lumpSaveEnsureOperationId(reloadedPayload);
    check('startup settled reconciliation retires mapping for deliberate new save',
        freshAfterReload !== 'settled-operation' &&
        !store.has('church.lump-save-pending:settled-operation'));
    global.sessionStorage = oldSessionStorage;

    const callbackPayload = { binary: [0xF8000400, 0], metadata: {} };
    const operationId = _lumpSaveEnsureOperationId(callbackPayload);
    const committed = await _lumpSaveRequest(async (_url, options) => {
        check('generated operation id is sent on commit',
            options.headers['X-Lump-Save-Operation'] === operationId);
        return jsonResponse(200, { ok: true, token: 'facefeed', operation_id: operationId });
    }, '/api/lumps/save', callbackPayload, () => {
        throw new Error('render failed after durable save');
    });
    check('post-commit callback error remains a successful save',
        committed.token === 'facefeed' &&
        /render failed/.test(committed.post_commit_error || ''));

    console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
})().catch(error => {
    console.error(error);
    process.exit(1);
});