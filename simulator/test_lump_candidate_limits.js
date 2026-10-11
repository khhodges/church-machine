'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const frame = require('./lump-content-frame');
const { codeWords: CW, clistCount: CC, allocationWords: MAX } = frame.LUMP_FORMAT_LIMITS;
assert.equal(CW, 8191);
assert.equal(CC, 255);
assert.equal(MAX, 32768);
assert.deepEqual(frame.lumpCandidateLayout(CW, CC, MAX - 1 - CW - CC),
    { lumpSize: MAX, nMinus6: 9 });
for (const args of [[CW + 1, 0], [0, CC + 1], [CW, CC, MAX - CW - CC]]) {
    assert.throws(() => frame.lumpCandidateLayout(...args), /No LUMP was saved; your draft is unchanged/);
}
const lumps = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
const start = lumps.indexOf('window.showFormatLump = async function()');
const format = lumps.slice(start, lumps.indexOf('\n};', start) + 3);
const run = fs.readFileSync(__dirname + '/app-run.js', 'utf8');
const fallbackStart = run.indexOf('var _svCC = _caps.length;', run.indexOf('// Fallback: build from scratch'));
const fallbackEnd = run.indexOf("if (typeof CapabilityTokens === 'undefined')", fallbackStart);
assert(fallbackStart > 0 && fallbackEnd > fallbackStart);
// Execute the production fallback through allocation/copy, stopping before
// capability resolution and publication (those have their own audit tests).
const fallback = 'window.fallback = async function() {\n' +
    run.slice(fallbackStart, fallbackEnd) + '\nreturn _svBinary;\n};';

async function check(path, cw, cc, fw, valid) {
    const words = Array(cw).fill(0), caps = Array.from({ length: cc }, () => ({}));
    const original = JSON.stringify({ words, caps });
    const editor = { value: '; draft must stay exact\nHALT\n' };
    const entry = { abstraction: 'ide.Test', sources: { memory: { words, capabilities: caps, sourceText: editor.value } } };
    const alerts = [];
    let binary = null, allocations = 0, built = 0;
    const context = {
        ...require('./actionable_errors'),
        console,
        Array: new Proxy(Array, { construct(target, args) {
            allocations++;
            assert(args[0] <= MAX, 'never allocate an oversized binary');
            return Reflect.construct(target, args);
        } }),
        LumpContentFrame: { ...frame, lumpBuildContentFrame: async () => {
            built++;
            return { frameWords: Array(fw).fill(0) };
        } },
        LumpRegistry: { getCurrent: () => 'fixture', resolve: () => entry },
        document: { getElementById: () => editor },
        alert: message => alerts.push(message),
        fetch: async (url, options) => {
            assert.equal(url, '/api/ide-hierarchy');
            assert.equal(options.cache, 'no-store');
            return { ok: true, status: 200, text: async () => '{}' };
        },
        CapabilityTokens: {
            hierarchyConfigurationError: () => null,
            checkLeafOwnership: () => ({}),
            materialize: (_caps, candidate) => {
                binary = candidate;
                throw new Error('test stop after valid allocation');
            },
        },
        _formatLumpApiDefinition: () => ({}),
        _svWords: words, _caps: caps, _saveSnapshot: null, _snapshotPending: null,
        _svAbsName: 'ide.Test', _svBinary: null,
        localStorage: { getItem: () => null },
        _lumpSaveSubmittedSource: () => editor.value,
        _pendingLumpData: { stale: true }, _saveNSPreparedSnapshot: { stale: true },
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(path === 'format' ? format : fallback, context);
    const result = await (path === 'format' ? context.showFormatLump() : context.fallback());
    if (path === 'fallback') binary = result;
    if (valid) {
        assert(binary, path + ' accepts exact limits');
        assert.equal(binary.length, frame.lumpCandidateLayout(cw, cc, fw).lumpSize);
        assert.equal((binary[0] >>> 10) & 0x1FFF, cw);
        assert.equal(binary[0] & 0xFF, cc);
        assert.equal((binary[0] >>> 8) & 3, 0, 'CC cannot spill into type');
        assert.equal((binary[0] >>> 23) & 15, Math.log2(binary.length) - 6);
    } else {
        assert.equal(allocations, 0);
        assert.equal(binary == null, true);
        assert.equal(context._pendingLumpData, null);
        assert.equal(context._saveNSPreparedSnapshot, null);
        assert.match(alerts.join('\n'), /No LUMP was saved; your draft is unchanged/);
        assert.match(alerts.join('\n'), /Split|Reduce/);
        if (cw > CW || cc > CC) assert.equal(built, 0);
    }
    assert.equal(editor.value, entry.sources.memory.sourceText);
    assert.equal(JSON.stringify({ words, caps }), original);
}
(async () => {
    // Repacking the destination name is a second allocation boundary after
    // Format review. Use the real repacker with controlled frame lengths.
    const ide = require('./idx1-ide');
    const inspect = frame.lumpInspectContentFrame, build = frame.lumpBuildContentFrame;
    const original = Array(64).fill(0);
    original[0] = ((31 << 27) | (1 << 10) | 1) >>> 0;
    original[1] = 123;
    original[63] = 456;
    const before = original.slice();
    try {
        frame.lumpInspectContentFrame = async () => ({
            contentFrameValid: true, apiDefinition: { name: 'old' }, profile: 'full',
        });
        frame.lumpBuildContentFrame = async () => ({ frameWords: Array(MAX - 3).fill(0) });
        const renamed = await ide.nameSavedCandidate(original, 'new', 'draft');
        assert.equal(renamed.length, MAX);
        assert.equal(renamed[1], 123);
        assert.equal(renamed[MAX - 1], 456);
        frame.lumpBuildContentFrame = async () => ({ frameWords: Array(MAX - 2).fill(0) });
        await assert.rejects(ide.nameSavedCandidate(original, 'new', 'draft'),
            /No LUMP was saved; your draft is unchanged/);
        assert.deepEqual(original, before);
    } finally {
        frame.lumpInspectContentFrame = inspect;
        frame.lumpBuildContentFrame = build;
    }
    for (const path of ['format', 'fallback']) {
        for (const args of [
            [CW, 1, 1, true], [1, CC, 1, true],
            [CW, CC, MAX - 1 - CW - CC, true],
            [CW + 1, 1, 1, false], [1, CC + 1, 1, false],
            [CW, CC, MAX - CW - CC, false],
            [1, 1, MAX + 1, false],
        ]) await check(path, ...args);
    }
    console.log('PASS canonical formatter limits: exact maxima, overflow rejection, no allocation/save, draft preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
