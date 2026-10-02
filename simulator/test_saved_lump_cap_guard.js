'use strict';

// Load into Sim is volatile execution, not repository deployment. Verify the
// actual trust boundary: exact inspected bytes, metadata, then C-list validation
// must all finish before either boot or installation can mutate the simulator.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const actionable = require('./actionable_errors.js');
const src = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const start = src.indexOf('async function _loadLumpBinaryIntoSim(');
const end = src.indexOf('\n// ── Run Selftest shortcut', start);
assert(start >= 0 && end > start);
const loader = src.slice(start, end);
const digest = 'a'.repeat(64);

async function exercise({ fail, delay = false, source = loader } = {}) {
    const events = [];
    const errors = [];
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const context = vm.createContext({
        ...actionable,
        window: {},
        alert: message => errors.push(String(message)),
        appendOutput: message => errors.push(String(message)),
        _executionIdentityHashWords: async () => {
            events.push('hash');
            return fail === 'hash' ? 'b'.repeat(64) : digest;
        },
        _lumpBinaryInspection: () => ({ binary_hash: digest }),
        _loadSavedLumpCapabilities: async () => {
            events.push('metadata-start');
            if (delay) await pending;
            if (fail === 'metadata') throw new Error('missing hash-bound metadata');
            events.push('metadata-end');
            return { approval: {} };
        },
        _validateSavedLumpClist: () => {
            events.push('validate');
            if (fail === 'clist') throw new Error('invalid C-list');
            return [];
        },
        fetch: async url => {
            assert.equal(url, '/api/lump/test-token/words',
                'volatile execution must not request deployment authorization');
            if (fail === 'http') return {
                ok: false, status: 403, text: async () => '{"error":"denied"}',
            };
            return { ok: true, json: async () => ({ words: fail === 'empty' ? [] : [1] }) };
        },
        instantBoot: () => events.push('boot'),
        sim: {
            bootComplete: false,
            parseLumpHeader: () => ({ valid: fail !== 'header', cc: 0 }),
            loadLumpBinary: () => { events.push('load'); return false; },
        },
    });
    vm.runInContext(source, context);
    const running = context._loadLumpBinaryIntoSim('test-token', 'Test', null, 10);
    await new Promise(resolve => setImmediate(resolve));
    const beforeRelease = events.slice();
    release();
    await running;
    return { events, errors, beforeRelease };
}

(async () => {
    for (const fail of ['http', 'empty', 'hash', 'metadata', 'header', 'clist']) {
        const result = await exercise({ fail });
        assert(!result.events.includes('boot') && !result.events.includes('load'), fail);
        assert(result.errors.length > 0, `${fail} must be visible`);
        console.log(`PASS ${fail} rejection precedes simulator mutation`);
    }
    const accepted = await exercise({ delay: true });
    assert(accepted.beforeRelease.includes('metadata-start'));
    assert(!accepted.beforeRelease.includes('boot') && !accepted.beforeRelease.includes('load'));
    assert.deepEqual(accepted.events,
        ['hash', 'metadata-start', 'metadata-end', 'validate', 'boot', 'load']);
    console.log('PASS inspected bytes and awaited validation precede volatile installation');

    // Prove the harness would detect both missing await and missing validation.
    const unawaited = await exercise({ delay: true,
        source: loader.replace('await _loadSavedLumpCapabilities(token, data)',
            '_loadSavedLumpCapabilities(token, data)') });
    assert(unawaited.beforeRelease.includes('load'));
    const bypassed = await exercise({ fail: 'clist',
        source: loader.replace('_validateSavedLumpClist(installWords, _runHeader, _savedMetadata, sim)', '[]') });
    assert(bypassed.events.includes('load'));
    console.log('PASS harness detects unawaited metadata and bypassed C-list validation');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});