'use strict';

// Mock the transport boundary to exercise the lifecycle distinctions without
// launching a browser or a server.
const {
    _lumpSaveRequest,
} = require('./lump_save_handler.js');

let pass = 0;
let fail = 0;
function check(label, condition) {
    console.log((condition ? 'PASS ' : 'FAIL ') + label);
    condition ? pass++ : fail++;
}

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    };
}

function storage() {
    const values = new Map();
    return {
        get length() { return values.size; },
        key: index => Array.from(values.keys())[index] || null,
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
    };
}

function diagnosticsMock() {
    const events = [];
    let nextAttempt = 0;
    function metadata(source) {
        if (!source.diagnostic_attempt_id) {
            nextAttempt++;
            source.diagnostic_attempt_id = `flow-attempt-${nextAttempt}`;
        }
        return source;
    }
    function push(metadataValue, stage, event, values) {
        const metadataObject = metadata(metadataValue);
        events.push(Object.assign({
            attempt_id: metadataObject.diagnostic_attempt_id,
            stage, event,
        }, values || {}));
        return events[events.length - 1];
    }
    return {
        events,
        begin: (m, entry) => {
            metadata(m);
            push(m, 'capture', 'start', { entry_point: entry, outcome: 'unknown' });
            return { attempt_id: m.diagnostic_attempt_id };
        },
        update: (m, values) => {
            Object.assign(m, values || {});
            metadata(m);
        },
        record: push,
        stageStart: (m, stage, entry, values) =>
            push(m, stage, 'start', Object.assign({ entry_point: entry }, values || {})),
        stageComplete: (m, stage, outcome, values) =>
            push(m, stage, 'complete', Object.assign({ outcome }, values || {})),
        stageException: (m, stage, error, values) =>
            push(m, stage, 'exception', Object.assign({ outcome: 'unknown' }, values || {})),
    };
}

async function main() {
    const previousStorage = globalThis.sessionStorage;
    const previousDiagnostics = globalThis.LumpSaveDiagnostics;
    globalThis.sessionStorage = storage();
    const diagnostics = diagnosticsMock();
    globalThis.LumpSaveDiagnostics = diagnostics;
    try {
        const successPayload = { binary: [0x1f000000, 0], metadata: {} };
        await _lumpSaveRequest(
            async () => response(200, {
                ok: true, token: '0xabc', operation_id: 'operation-success',
            }),
            '/api/lumps/save', successPayload, async () => {});
        check('success flow records committed commit and reload',
            diagnostics.events.some(e => e.stage === 'commit' &&
                e.event === 'complete' && e.outcome === 'committed') &&
            diagnostics.events.some(e => e.stage === 'reload' &&
                e.event === 'complete' && e.outcome === 'committed'));

        const preflight = { diagnostic_attempt_id: 'flow-preflight' };
        diagnostics.stageStart(preflight, 'prepare', 'flow.preflight',
            { outcome: 'unknown' });
        diagnostics.stageException(preflight, 'prepare',
            new Error('payload={"source":"must-not-retain"}'),
            { outcome: 'rejected' });
        check('preflight rejection records rejected without payload text',
            diagnostics.events.some(e => e.stage === 'prepare' &&
                e.event === 'exception' && e.outcome === 'rejected') &&
            !JSON.stringify(diagnostics.events).includes('must-not-retain'));

        const cancelled = { diagnostic_attempt_id: 'flow-cancelled' };
        diagnostics.record(cancelled, 'confirm', 'cancelled', { outcome: 'unknown' });
        check('user cancellation records an explicit unknown outcome',
            diagnostics.events.some(e => e.stage === 'confirm' &&
                e.event === 'cancelled' && e.outcome === 'unknown'));

        const unknownPayload = { binary: [1, 2], metadata: {} };
        let unknownCalls = 0;
        let unknownError = false;
        try {
            await _lumpSaveRequest(async url => {
                unknownCalls++;
                if (url.includes('/save-operations/')) {
                    return response(200, { committed: null });
                }
                throw new Error('network failure');
            }, '/api/lumps/save', unknownPayload);
        } catch (_) {
            unknownError = true;
        }
        check('unknown transport outcome records reconciliation',
            unknownError && unknownCalls === 2 &&
            diagnostics.events.some(e => e.stage === 'reconcile' &&
                e.event === 'complete' && e.outcome === 'unknown'));

        const reloadPayload = { binary: [3, 4], metadata: {} };
        await _lumpSaveRequest(
            async () => response(200, {
                ok: true, token: '0xdef', operation_id: 'operation-reload',
            }),
            '/api/lumps/save', reloadPayload, async () => {
                throw new Error('render failed with payload source text');
            });
        const serialized = JSON.stringify(diagnostics.events);
        check('committed save separates reload failure',
            diagnostics.events.some(e => e.stage === 'commit' &&
                e.event === 'complete' && e.outcome === 'committed') &&
            diagnostics.events.some(e => e.stage === 'reload' &&
                e.event === 'exception' && e.outcome === 'unknown') &&
            !serialized.includes('render failed'));
    } finally {
        globalThis.sessionStorage = previousStorage;
        globalThis.LumpSaveDiagnostics = previousDiagnostics;
    }
    console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
    if (fail) process.exitCode = 1;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
