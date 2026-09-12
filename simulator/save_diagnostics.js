'use strict';

// Browser-side diagnostics for the LUMP save transaction.  This module is
// deliberately independent of the save implementation: every public method
// is best-effort and failures are swallowed so diagnostics can never change a
// save result (or report a failure about reporting a failure).

const _SAVE_DIAGNOSTICS_STORAGE_KEY = 'church.lump-save-diagnostics:v1';
const _SAVE_DIAGNOSTICS_MAX_EVENTS = 120;
const _SAVE_DIAGNOSTICS_MAX_BYTES = 128 * 1024;
const _SAVE_DIAGNOSTICS_BATCH_SIZE = 20;
const _SAVE_DIAGNOSTICS_MAX_TEXT = 512;
const _SAVE_DIAGNOSTICS_MAX_STACK = 2048;
const _SAVE_DIAGNOSTICS_RETRY_BASE_MS = 250;
const _SAVE_DIAGNOSTICS_RETRY_MAX_MS = 30 * 1000;

const _SAVE_DIAGNOSTICS_STAGES = new Set([
    'capture', 'prepare', 'confirm', 'commit', 'reload', 'reconcile',
    'ns_table', 'transport'
]);
const _SAVE_DIAGNOSTICS_OUTCOMES = new Set([
    'committed', 'rejected', 'unknown'
]);

function _diagnosticRoot() {
    if (typeof globalThis !== 'undefined') return globalThis;
    if (typeof window !== 'undefined') return window;
    return {};
}

function _diagnosticStorage(root, supplied) {
    if (supplied) return supplied;
    try {
        return root && root.localStorage ? root.localStorage : null;
    } catch (_) {
        return null;
    }
}

function _diagnosticNow(options) {
    try {
        const value = typeof options.now === 'function' ? Number(options.now()) : Date.now();
        return Number.isFinite(value) ? value : Date.now();
    } catch (_) {
        return Date.now();
    }
}

function _diagnosticId(prefix, options) {
    try {
        const root = _diagnosticRoot();
        if (root.crypto && typeof root.crypto.randomUUID === 'function') {
            return root.crypto.randomUUID();
        }
    } catch (_) {}
    const now = _diagnosticNow(options).toString(36);
    let random = '';
    try {
        random = Math.random().toString(36).slice(2, 14);
    } catch (_) {
        random = '0';
    }
    return prefix + '-' + now + '-' + random;
}

function _diagnosticSafeId(value, fallback) {
    let text = '';
    try {
        text = value === null || value === undefined ? '' : String(value);
    } catch (_) {
        return fallback || '';
    }
    if (/^[A-Za-z0-9._:-]{8,160}$/.test(text)) return text;
    return fallback || '';
}

function _diagnosticSafeScalar(value, max) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return text.slice(0, max || 160);
}

// This helper remains exported for small UI call sites, but diagnostics never
// persist arbitrary error prose.  Error records use the allowlisted
// classification below and a location-only stack.
function _redactDiagnosticText(value, max) {
    let text = '';
    try {
        text = value === null || value === undefined ? '' : String(value);
    } catch (_) {
        return '[REDACTED]';
    }
    text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
    text = text.replace(/\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
        '[REDACTED AUTHORIZATION]');
    text = text.replace(
        /(["']?\b(?:authorization|cookie|set-cookie|session(?:[_ -]?token|[_ -]?id)?|csrf|xsrf|password|passwd|secret|credential(?:s)?|approval[_ -]?token|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|token|payload|source(?:[_ -]?text)?|binary(?:[_ -]?data|[_ -]?contents)?|request[_ -]?body|response[_ -]?body)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
        '$1[REDACTED]'
    );
    text = text.replace(/([?&](?:token|key|secret|password|session|cookie|auth|authorization)[^=&#\s]*=)[^&#\s]+/gi,
        '$1[REDACTED]');
    // JSON-shaped payload/source values can contain nested braces and quoted
    // fields. They are never useful to a save-stage diagnostic.
    text = text.replace(
        /(["']?\b(?:payload|request[_ -]?body|response[_ -]?body|source(?:[_ -]?text)?|binary(?:[_ -]?data|[_ -]?contents)?)["']?\s*[:=]\s*)(?:\{[\s\S]*\}|\[[\s\S]*\]|"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
        '$1[REDACTED]'
    );
    // JWTs and long opaque values are credentials or payload fragments in
    // practice.  Hashes are not needed to diagnose a stage boundary.
    text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){1,2}\b/g,
        '[REDACTED]');
    text = text.replace(/\b(?:0x)?[0-9a-f]{32,}\b/gi, '[REDACTED]');
    text = text.replace(/\s+/g, ' ').trim();
    return text.slice(0, max || _SAVE_DIAGNOSTICS_MAX_TEXT);
}

const _SAVE_DIAGNOSTIC_REASON_BY_CODE = Object.freeze({
    capture_failed: 'Save capture failed before the repository request.',
    preflight_rejected: 'The repository rejected save preparation.',
    approval_rejected: 'The repository rejected the approval step.',
    commit_rejected: 'The repository rejected the save.',
    commit_unknown: 'The repository could not confirm the save outcome.',
    reconciliation_unknown: 'Reconciliation could not confirm the save outcome.',
    repository_unavailable: 'The repository was unavailable.',
    invalid_response: 'The repository returned an invalid response.',
    reload_failed: 'The repository committed, but local reload failed.',
    namespace_save_failed: 'Namespace state could not be saved.',
    timeout: 'The save request timed out.',
    authorization_rejected: 'Repository authorization was rejected.',
    diagnostic_failure: 'Save diagnostics could not be recorded.',
    unexpected_failure: 'An unexpected save-stage failure occurred.',
});

const _SAVE_DIAGNOSTIC_KINDS = new Set([
    'capture_failed', 'preflight_rejected', 'approval_rejected',
    'commit_rejected', 'commit_unknown', 'reconciliation_unknown',
    'repository_unavailable', 'invalid_response', 'reload_failed',
    'namespace_save_failed', 'timeout', 'authorization_rejected',
    'diagnostic_failure', 'unexpected_failure',
]);

function _diagnosticRead(error, field) {
    try {
        const value = error && error[field];
        return typeof value === 'string' ? value : '';
    } catch (_) {
        return '';
    }
}

function _diagnosticErrorLocation(error) {
    const stack = _diagnosticRead(error, 'stack');
    // Keep only a local filename and line/column. This intentionally drops
    // function names, URLs, query strings, source excerpts, and messages.
    const match = stack.match(
        /(?:^|[\s(])\/?((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|cjs|ts|tsx|jsx|html)):(\d+):(\d+)(?:\)|\s|$)/
    );
    if (!match) return '';
    const file = match[1].split('/').pop();
    return `${file}:${match[2]}:${match[3]}`;
}

function _diagnosticErrorCode(stage, outcome, error, values) {
    const normalizedStage = _diagnosticStage(stage);
    const normalizedOutcome = _diagnosticOutcome(outcome);
    const kind = _diagnosticRead(error, 'kind').toLowerCase();
    const name = _diagnosticRead(error, 'name').toLowerCase();
    const status = values && Number.isFinite(Number(values.http_status))
        ? Number(values.http_status) : 0;
    if (normalizedStage === 'capture') return 'capture_failed';
    if (normalizedStage === 'prepare') return 'preflight_rejected';
    if (normalizedStage === 'confirm') return 'approval_rejected';
    if (normalizedStage === 'reload') return 'reload_failed';
    if (normalizedStage === 'reconcile') return 'reconciliation_unknown';
    if (normalizedStage === 'ns_table') return 'namespace_save_failed';
    if (kind === 'timeout' || kind === 'abort' || name === 'aborterror' ||
            name === 'timeouterror') return 'timeout';
    if (status === 401 || status === 403) return 'authorization_rejected';
    if (status >= 500) return 'repository_unavailable';
    if (kind === 'protocol' || kind === 'invalid_response') return 'invalid_response';
    if (kind === 'server' || kind === 'transport' || kind === 'network') {
        return 'repository_unavailable';
    }
    if (kind === 'validation' || kind === 'ide' ||
            (status >= 400 && status < 500)) return 'commit_rejected';
    if (normalizedOutcome === 'rejected') return 'commit_rejected';
    return 'commit_unknown';
}

function _serializeDiagnosticError(error, stage, outcome, values) {
    const code = _diagnosticErrorCode(stage, outcome, error, values);
    const result = {
        code: _SAVE_DIAGNOSTIC_KINDS.has(code) ? code : 'unexpected_failure',
        reason: _SAVE_DIAGNOSTIC_REASON_BY_CODE[code] ||
            _SAVE_DIAGNOSTIC_REASON_BY_CODE.unexpected_failure,
    };
    const location = _diagnosticErrorLocation(error);
    if (location) result.stack = location;
    return result;
}

function _diagnosticEntryPoint(value, fallback) {
    const text = _diagnosticSafeScalar(value, 96);
    if (text && /^[A-Za-z0-9_.:/ -]+$/.test(text)) return text;
    return fallback || 'unknown';
}

function _diagnosticMetadata(metadata) {
    const source = metadata && typeof metadata === 'object' ? metadata : {};
    const result = {};
    for (const field of ['diagnostic_attempt_id', 'operation_id', 'candidate_id',
        'save_plan_id', 'plan_id']) {
        const value = _diagnosticSafeId(source[field]);
        if (value) {
            const key = field === 'save_plan_id' ? 'plan_id' : field;
            result[key] = value;
        }
    }
    return result;
}

function _diagnosticOutcome(value) {
    const outcome = String(value || 'unknown').toLowerCase();
    return _SAVE_DIAGNOSTICS_OUTCOMES.has(outcome) ? outcome : 'unknown';
}

function _diagnosticStage(value) {
    const stage = String(value || 'commit').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return _SAVE_DIAGNOSTICS_STAGES.has(stage) ? stage : 'commit';
}

function _diagnosticJsonSize(value) {
    try {
        return JSON.stringify(value).length;
    } catch (_) {
        return Number.MAX_SAFE_INTEGER;
    }
}

function createSaveDiagnostics(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const root = opts.root || _diagnosticRoot();
    const storage = _diagnosticStorage(root, opts.storage);
    const contexts = new Map();
    let deliveryInFlight = null;
    let deliveryTimer = null;
    let retryAttempt = 0;
    let eventSequence = 0;

    function readQueue() {
        if (!storage || typeof storage.getItem !== 'function') return [];
        try {
            const parsed = JSON.parse(storage.getItem(_SAVE_DIAGNOSTICS_STORAGE_KEY) || '[]');
            if (!Array.isArray(parsed)) return [];
            let migrated = false;
            const rows = parsed.filter(item =>
                item && typeof item === 'object' && item.attempt_id).map(item => {
                if (_diagnosticSafeId(item.event_id)) return item;
                eventSequence++;
                migrated = true;
                return Object.assign({}, item, {
                    event_id: `${_diagnosticId('event', opts)}-${eventSequence}`,
                });
            });
            if (migrated) {
                try {
                    storage.setItem(_SAVE_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(rows));
                } catch (_) {}
            }
            return rows;
        } catch (_) {
            return [];
        }
    }

    function writeQueue(queue) {
        if (!storage || typeof storage.setItem !== 'function') return false;
        try {
            let bounded = Array.isArray(queue) ? queue.slice(-_SAVE_DIAGNOSTICS_MAX_EVENTS) : [];
            while (bounded.length && _diagnosticJsonSize(bounded) > _SAVE_DIAGNOSTICS_MAX_BYTES) {
                bounded.shift();
            }
            storage.setItem(_SAVE_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(bounded));
            return true;
        } catch (_) {}
        return false;
    }

    function retryDelay() {
        if (!retryAttempt) return 0;
        return Math.min(_SAVE_DIAGNOSTICS_RETRY_MAX_MS,
            _SAVE_DIAGNOSTICS_RETRY_BASE_MS * Math.pow(2, retryAttempt - 1));
    }

    function scheduleFlush(delay) {
        if (!storage) return;
        if (deliveryTimer !== null || deliveryInFlight) return;
        const schedule = typeof opts.setTimeout === 'function'
            ? opts.setTimeout
            : (typeof setTimeout === 'function' ? setTimeout : null);
        if (!schedule) return;
        try {
            deliveryTimer = schedule(function() {
                deliveryTimer = null;
                flush();
            }, Math.max(0, Number(delay) || 0));
            // A test scheduler (or a host shim) may return undefined. Keep a
            // sentinel so concurrent appenders cannot schedule duplicate sends.
            if (deliveryTimer === null || deliveryTimer === undefined) {
                deliveryTimer = true;
            }
        } catch (_) {
            deliveryTimer = null;
        }
    }

    function ensureContext(metadata, entryPoint) {
        const source = metadata && typeof metadata === 'object' ? metadata : {};
        let attemptId = _diagnosticSafeId(source.diagnostic_attempt_id);
        if (!attemptId) {
            attemptId = _diagnosticId('diag', opts);
            try { source.diagnostic_attempt_id = attemptId; } catch (_) {}
        }
        let context = contexts.get(attemptId);
        if (!context) {
            context = {
                attempt_id: attemptId,
                started_at_ms: _diagnosticNow(opts),
                entry_point: _diagnosticEntryPoint(entryPoint, 'unknown'),
                operation_id: null,
                candidate_id: null,
                plan_id: null,
                capture_recorded: false,
            };
            contexts.set(attemptId, context);
        }
        const ids = _diagnosticMetadata(source);
        for (const key of ['operation_id', 'candidate_id', 'plan_id']) {
            if (ids[key]) context[key] = ids[key];
        }
        if (entryPoint) context.entry_point = _diagnosticEntryPoint(
            entryPoint, context.entry_point);
        return context;
    }

    function update(metadata, values) {
        try {
            const context = ensureContext(metadata, values && values.entry_point);
            const source = values && typeof values === 'object' ? values : {};
            for (const key of ['operation_id', 'candidate_id', 'plan_id']) {
                const value = _diagnosticSafeId(source[key]);
                if (value) context[key] = value;
            }
            const ids = _diagnosticMetadata(metadata);
            for (const key of ['operation_id', 'candidate_id', 'plan_id']) {
                if (ids[key]) context[key] = ids[key];
            }
            return context;
        } catch (_) {
            return null;
        }
    }

    function append(event) {
        try {
            const queue = readQueue();
            queue.push(event);
            writeQueue(queue);
            scheduleFlush();
        } catch (_) {}
    }

    function record(metadata, stage, eventName, values) {
        try {
            const extra = values && typeof values === 'object' ? values : {};
            const context = update(metadata, extra);
            if (!context) return null;
            const now = _diagnosticNow(opts);
            const elapsed = Math.max(0, Math.min(
                2147483647, Math.round(now - context.started_at_ms)));
            eventSequence++;
            const eventId = `${_diagnosticId('event', opts)}-${eventSequence}`;
            const outcome = _diagnosticOutcome(extra.outcome);
            const record = {
                event_id: eventId,
                attempt_id: context.attempt_id,
                operation_id: context.operation_id || null,
                candidate_id: context.candidate_id || null,
                plan_id: context.plan_id || null,
                stage: _diagnosticStage(stage),
                event: _diagnosticEntryPoint(eventName, 'event'),
                entry_point: context.entry_point || 'unknown',
                outcome,
                elapsed_ms: elapsed,
                http_status: Number.isFinite(Number(extra.http_status))
                    ? Number(extra.http_status) : null,
                error: extra.error
                    ? _serializeDiagnosticError(extra.error, stage, outcome, extra)
                    : null,
                // occurred_at is the client occurrence time retained in the
                // queue. timestamp remains for older server readers.
                occurred_at: new Date(now).toISOString(),
            };
            record.timestamp = record.occurred_at;
            append(record);
            return record;
        } catch (_) {
            return null;
        }
    }

    function begin(metadata, entryPoint, values) {
        try {
            const context = ensureContext(metadata, entryPoint);
            if (!context.capture_recorded) {
                context.capture_recorded = true;
                record(metadata, 'capture', 'start', Object.assign({
                    outcome: 'unknown'
                }, values || {}));
            }
            return context;
        } catch (_) {
            return null;
        }
    }

    function stageStart(metadata, stage, entryPoint, values) {
        begin(metadata, entryPoint, values);
        return record(metadata, stage, 'start', values);
    }

    function stageComplete(metadata, stage, outcome, values) {
        try {
            const extra = Object.assign({}, values || {}, { outcome: outcome || 'unknown' });
            return record(metadata, stage, 'complete', extra);
        } catch (_) {
            return null;
        }
    }

    function stageException(metadata, stage, error, values) {
        try {
            const extra = Object.assign({}, values || {}, {
                error: error,
                outcome: values && values.outcome ? values.outcome : 'unknown',
            });
            return record(metadata, stage, 'exception', extra);
        } catch (_) {
            return null;
        }
    }

    function flush() {
        if (deliveryInFlight) return deliveryInFlight;
        if (deliveryTimer !== null) return Promise.resolve(false);
        if (!storage) return Promise.resolve(false);
        const fetchImpl = opts.fetch || (root && typeof root.fetch === 'function'
            ? root.fetch.bind(root) : null);
        if (!fetchImpl) return Promise.resolve(false);
        const queue = readQueue();
        if (!queue.length) return Promise.resolve(true);
        const batch = queue.slice(0, _SAVE_DIAGNOSTICS_BATCH_SIZE);
        const sentIds = new Set(batch.map(item => item && item.event_id).filter(Boolean));
        let retryNeeded = false;
        if (!sentIds.size) {
            retryAttempt = Math.min(16, retryAttempt + 1);
            scheduleFlush(retryDelay());
            return Promise.resolve(false);
        }
        let request;
        try {
            request = Promise.resolve(fetchImpl('/api/lumps/save-diagnostics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ events: batch }),
                keepalive: true,
            })).then(function(response) {
                const ok = response && (response.ok === true ||
                    (Number(response.status) >= 200 && Number(response.status) < 300));
                if (!ok) {
                    retryAttempt = Math.min(16, retryAttempt + 1);
                    retryNeeded = true;
                    return false;
                }
                return Promise.resolve(typeof response.json === 'function'
                    ? response.json() : null).then(function(ack) {
                    const accepted = ack && ack.ok === false ? null :
                        (Array.isArray(ack && ack.accepted_event_ids)
                        ? new Set(ack.accepted_event_ids.filter(id => sentIds.has(id)))
                        : null);
                    if (!accepted) {
                        retryAttempt = Math.min(16, retryAttempt + 1);
                        retryNeeded = true;
                        return false;
                    }
                    // Remove exactly acknowledged IDs from the current queue.
                    // Events appended while the request was in flight remain.
                    const current = readQueue();
                    const retained = current.filter(item =>
                        !accepted.has(item && item.event_id));
                    if (!writeQueue(retained)) {
                        retryAttempt = Math.min(16, retryAttempt + 1);
                        retryNeeded = true;
                        return false;
                    }
                    if (accepted.size < sentIds.size) {
                        retryAttempt = Math.min(16, retryAttempt + 1);
                        retryNeeded = true;
                    } else {
                        retryAttempt = 0;
                    }
                    return true;
                });
            }).catch(function() {
                retryAttempt = Math.min(16, retryAttempt + 1);
                retryNeeded = true;
                return false;
            }).finally(function() {
                deliveryInFlight = null;
                if (readQueue().length) {
                    scheduleFlush(retryNeeded ? retryDelay() : 0);
                }
            });
        } catch (_) {
            return Promise.resolve(false);
        }
        deliveryInFlight = request;
        return request;
    }

    function clear() {
        try {
            if (storage && typeof storage.removeItem === 'function') {
                storage.removeItem(_SAVE_DIAGNOSTICS_STORAGE_KEY);
            }
        } catch (_) {}
    }

    function getQueue() {
        return readQueue().slice();
    }

    return {
        begin,
        capture: begin,
        ensure: ensureContext,
        update,
        record,
        log: record,
        stageStart,
        stageComplete,
        stageException,
        flush,
        clear,
        getQueue,
        serializeError: _serializeDiagnosticError,
        redact: _redactDiagnosticText,
        storageKey: _SAVE_DIAGNOSTICS_STORAGE_KEY,
        maxEvents: _SAVE_DIAGNOSTICS_MAX_EVENTS,
    };
}

const _saveDiagnostics = createSaveDiagnostics();
const _saveDiagnosticsApi = {
    createSaveDiagnostics,
    serializeError: _serializeDiagnosticError,
    redact: _redactDiagnosticText,
    storageKey: _SAVE_DIAGNOSTICS_STORAGE_KEY,
    maxEvents: _SAVE_DIAGNOSTICS_MAX_EVENTS,
};

if (typeof window !== 'undefined') {
    window.LumpSaveDiagnostics = _saveDiagnostics;
    window._lumpSaveDiagnostics = _saveDiagnostics;
    // Delivery after a refresh is intentionally asynchronous and isolated.
    try {
        if (typeof setTimeout === 'function') setTimeout(function() {
            _saveDiagnostics.flush();
        }, 0);
    } catch (_) {}
}

if (typeof module !== 'undefined') {
    module.exports = Object.assign(_saveDiagnosticsApi, {
        _saveDiagnostics: _saveDiagnostics,
        _redactDiagnosticText,
        _serializeDiagnosticError,
    });
}
