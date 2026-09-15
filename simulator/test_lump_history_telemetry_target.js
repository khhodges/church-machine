'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
const start = source.indexOf('async function _fetchAndShowLumpTimeline(');
const end = source.indexOf('\nfunction ', start + 1);
assert.ok(start >= 0 && end > start, 'timeline helper is available');

const body = {innerHTML: '', className: ''};
const responses = [
    {
        ok: true,
        json: async () => ({
            history: [{
                version: 2,
                current: true,
                binary_available: true,
                cw: 20,
                cc: 5,
                lump_size: 512,
            }],
        }),
    },
    {
        ok: true,
        json: async () => ({
            versions: [{
                lump_version: 27,
                lump_token: '4a000002',
                compiled_at: 1789474381,
                device_count: 0,
                total_faults: 0,
                total_steps: 0,
                stable_status: 'unknown',
                observed: false,
            }],
        }),
    },
];
const context = {
    document: {
        getElementById(id) {
            return id === 'lumpHistoryBody_4a00000a' ? body : null;
        },
    },
    fetch: async () => responses.shift(),
    _lumpTokenIdentity: value => value,
    _escHtml: value => String(value),
    _lumpBinaryInspection: value => value,
    _historyActivationEligibility: () => ({status: 'unknown', reasons: []}),
    _lumpsCache: [{
        token: '4a000002',
        abstraction: 'CapabilityTest',
        lump_version: 27,
        compiled_at: 1789474381,
        cw: 21,
        cc: 5,
        lump_size: 512,
        content_profile: 'full',
    }],
    Date,
    Number,
    Boolean,
    String,
    isNaN,
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

(async () => {
    await context._fetchAndShowLumpTimeline('4a00000a', {
        token: '4a00000a',
        abstraction: 'CapabilityTest',
        lump_version: 2,
    });

    assert.match(body.innerHTML, /data-version="27"[^>]+cursor:pointer/);
    assert.match(
        body.innerHTML,
        /_lumpHistorySelectRow\(this,'4a000002',27,[^)]*'4a000002','',true\)/,
        'telemetry-only v27 selects and previews its actual active token');
    assert.match(
        body.innerHTML,
        /_lumpHistoryPreview\('4a000002',27,[^)]*'4a000002','',true\)/,
        'the v27 Preview button reads the corrected active binary');
    console.log('PASS telemetry-only History rows select their active destination token');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});