'use strict';

// Focused, DOM-free coverage for the browser save diagnostic contract.
const {
    createSaveDiagnostics,
    serializeError,
} = require('./save_diagnostics.js');
const {
    _lumpSaveDefaultOperationKey,
} = require('./lump_save_handler.js');

let pass = 0;
let fail = 0;
function check(label, condition) {
    console.log((condition ? 'PASS ' : 'FAIL ') + label);
    condition ? pass++ : fail++;
}

function storageMock() {
    const values = new Map();
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
    };
}

// Error values are serialized as fields, including nested causes, without
// retaining request bodies, source excerpts, or credentials.
{
    const cause = new Error(
        'payload={"source":"secret source"} authorization=Bearer abc123 ' +
        'session_token=xyz password=hunter2'
    );
    const error = new TypeError('save failed; binary=deadbeef token=abc');
    error.cause = cause;
    const serialized = serializeError(error);
    const text = JSON.stringify(serialized);
    check('Error serialization keeps only safe reason classification',
        serialized.code === 'commit_unknown' &&
        typeof serialized.reason === 'string' &&
        !serialized.message && !serialized.cause &&
        /^[A-Za-z0-9_.-]+:\d+:\d+$/.test(serialized.stack || ''));
    check('Error serialization redacts payload/source/credentials',
        !text.includes('secret source') &&
        !text.includes('abc123') &&
        !text.includes('hunter2') &&
        !text.includes('deadbeef') &&
        !text.includes('source'));
    check('Error serialization never throws for non-Error values',
        serializeError({ message: 'payload=private', cause: { message: 'token=private' } })
            .reason === 'The repository could not confirm the save outcome.');
    const leakText = [
        '?key=supersecret',
        'authorization Basic c3VwZXJzZWNyZXQ=',
        'payload={"source":"nested source text"}',
    ].join(' ');
    check('redaction helper removes query, Basic auth, and nested payloads',
        !require('./save_diagnostics.js').redact(leakText).includes('supersecret') &&
        !require('./save_diagnostics.js').redact(leakText).includes('c3VwZXJzZWNyZXQ') &&
        !require('./save_diagnostics.js').redact(leakText).includes('nested source text'));
}

// The queue is bounded, persisted, and delivery is scheduled rather than
// performed synchronously in the save call.
{
    const storage = storageMock();
    const timers = [];
    let fetchCalls = 0;
    let now = 1000;
    const logger = createSaveDiagnostics({
        root: {},
        storage,
        now: () => now,
        setTimeout: fn => { timers.push(fn); return timers.length; },
        fetch: async (_url, options) => {
            fetchCalls++;
            const sent = JSON.parse(options.body).events;
            check('delivery uses the diagnostics endpoint and event batch',
                _url === '/api/lumps/save-diagnostics' &&
                options.method === 'POST' &&
                sent.length > 0 && sent.every(event => event.event_id));
            return {
                ok: true,
                status: 202,
                json: async () => ({
                    accepted_event_ids: sent.map(event => event.event_id),
                }),
            };
        },
    });
    const metadata = { operation_id: 'operation-1234' };
    const context = logger.begin(metadata, 'test.save');
    now += 25;
    logger.stageComplete(metadata, 'commit', 'committed', { http_status: 200 });
    const queued = logger.getQueue();
    const keys = Object.keys(queued[queued.length - 1]).sort();
    check('begin adds diagnostic_attempt_id to save metadata',
        !!metadata.diagnostic_attempt_id && context.attempt_id === metadata.diagnostic_attempt_id);
    check('events follow the bounded server schema',
        keys.includes('attempt_id') &&
        keys.includes('event_id') &&
        keys.includes('occurred_at') &&
        keys.includes('timestamp') &&
        keys.includes('error') &&
        !keys.includes('message'));
    check('each queued event has a unique event_id',
        new Set(queued.map(event => event.event_id)).size === queued.length);
    check('diagnostic delivery is nonblocking',
        fetchCalls === 0 && timers.length === 1);
    timers.shift()();
    // The flush promise is allowed to settle after the scheduled callback.
    setImmediate(() => {
        check('successful delivery clears the persisted batch',
            logger.getQueue().length === 0 && fetchCalls === 1);
    });
}

// A failed logger/storage cannot escape into the save path, and local retention
// never exceeds the documented event bound.
{
    const brokenStorage = {
        getItem: () => { throw new Error('storage unavailable'); },
        setItem: () => { throw new Error('storage unavailable'); },
    };
    const logger = createSaveDiagnostics({
        root: {},
        storage: brokenStorage,
        setTimeout: () => 1,
        fetch: () => { throw new Error('network unavailable'); },
    });
    let didNotThrow = true;
    try {
        const metadata = {};
        logger.begin(metadata, 'failure.test');
        logger.record(metadata, 'commit', 'exception', { error: new Error('logger test') });
    } catch (_) {
        didNotThrow = false;
    }
    check('logger/storage failure cannot affect a save caller', didNotThrow);

    const storage = storageMock();
    const bounded = createSaveDiagnostics({ root: {}, storage, setTimeout: () => 1 });
    const metadata = {};
    bounded.begin(metadata, 'bounded.test');
    for (let i = 0; i < 200; i++) {
        bounded.record(metadata, 'commit', 'exception', {
            error: new Error('bounded event ' + i),
        });
    }
    check('persisted diagnostics queue is bounded',
        bounded.getQueue().length <= bounded.maxEvents);
}

// The correlation field is intentionally outside the canonical operation key.
{
    const base = {
        binary: [0x1f000000, 0],
        metadata: { abstraction: 'Example', operation_key: 'stable-key' },
    };
    const withAttempt = {
        binary: base.binary.slice(),
        metadata: Object.assign({}, base.metadata, {
            diagnostic_attempt_id: 'diagnostic-attempt-123',
        }),
    };
    check('diagnostic_attempt_id does not alter idempotency key',
        _lumpSaveDefaultOperationKey(base) === _lumpSaveDefaultOperationKey(withAttempt));
}

// Malicious Error accessors must be treated as an unavailable reason, not
// allowed to escape through a save caller.
{
    const evil = {};
    Object.defineProperties(evil, {
        name: { get: () => { throw new Error('name getter'); } },
        message: { get: () => { throw new Error('message getter'); } },
        stack: { get: () => { throw new Error('stack getter'); } },
        cause: { get: () => { throw new Error('cause getter'); } },
    });
    const logger = createSaveDiagnostics({ root: {}, storage: storageMock() });
    let didNotThrow = true;
    try {
        logger.stageException({}, 'commit', evil);
        logger.redact(evil);
    } catch (_) {
        didNotThrow = false;
    }
    check('malicious Error getters cannot escape the logger', didNotThrow);
}

async function testPartialAckAndConcurrentInsertion() {
    const storage = storageMock();
    const timers = [];
    const pending = [];
    const delays = [];
    const logger = createSaveDiagnostics({
        root: {},
        storage,
        setTimeout: (fn, delay) => {
            delays.push(delay);
            timers.push(fn);
            return timers.length;
        },
        fetch: (_url, options) => new Promise(resolve => {
            pending.push({ resolve, sent: JSON.parse(options.body).events });
        }),
    });
    const metadata = {};
    logger.begin(metadata, 'ack.flow');
    logger.stageComplete(metadata, 'prepare', 'unknown');
    const firstTimer = timers.shift();
    firstTimer();
    while (!pending.length) await new Promise(resolve => setImmediate(resolve));
    const first = pending.shift();
    // This event arrives after the first request was sent and must not be
    // removed by an index/slice-based acknowledgement.
    logger.stageComplete(metadata, 'commit', 'committed');
    first.resolve({
        ok: true,
        status: 202,
        json: async () => ({ accepted_event_ids: [first.sent[0].event_id] }),
    });
    await new Promise(resolve => setImmediate(resolve));
    check('partial ACK removes exactly acknowledged event IDs',
        logger.getQueue().some(item => item.event === 'complete') &&
        !logger.getQueue().some(item => item.event_id === first.sent[0].event_id));
    check('failed/partial ACK schedules bounded backoff',
        timers.length === 1 && delays.some(delay => delay >= 250));

    timers.shift()();
    while (!pending.length) await new Promise(resolve => setImmediate(resolve));
    const second = pending.shift();
    logger.stageComplete(metadata, 'reload', 'unknown');
    second.resolve({
        ok: true,
        status: 202,
        json: async () => ({ accepted_event_ids: second.sent.map(item => item.event_id) }),
    });
    await new Promise(resolve => setImmediate(resolve));
    check('concurrent insertion remains queued after partial ACK',
        logger.getQueue().some(item => item.stage === 'reload'));

    if (timers.length) {
        timers.shift()();
        while (!pending.length) await new Promise(resolve => setImmediate(resolve));
        const third = pending.shift();
        third.resolve({
            ok: true,
            status: 202,
            json: async () => ({ accepted_event_ids: third.sent.map(item => item.event_id) }),
        });
        await new Promise(resolve => setImmediate(resolve));
    }
    check('all persisted IDs eventually clear after ACK',
        logger.getQueue().length === 0);
}

setImmediate(async () => {
    await testPartialAckAndConcurrentInsertion();
    console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
});
