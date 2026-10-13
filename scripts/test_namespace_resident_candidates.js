'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const frame = require('../simulator/lump-content-frame');
const {
    prepare, readFrozen, checkOutput, html, capabilityTestPreflight,
} = require('./prepare_namespace_resident_candidates');
const ROOT = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function candidate() {
    const words = Array(64).fill(0);
    words[0] = 0xf8000401;
    const raw = Buffer.alloc(256);
    words.forEach((word, i) => raw.writeUInt32BE(word >>> 0, i * 4));
    return {ok: true, abstractionName: 'WukongCallHome', words,
        lump_binary: raw.toString('base64'),
        compiler_record: {binary_hash: sha(raw), source_hash: sha('source')},
        capabilities: [{symbolic_self: true}]};
}

async function frozenApi(name, methods) {
    const embedded = await frame.lumpBuildContentFrame({methods}, null, 'api');
    const words = Array(64).fill(0);
    words[0] = 0xf8000001;
    embedded.frameWords.forEach((word, index) => { words[index + 1] = word; });
    const raw = Buffer.alloc(words.length * 4);
    words.forEach((word, index) => raw.writeUInt32BE(word >>> 0, index * 4));
    const filename = `${name}.lump`;
    return {
        selected: {name, filename, sha256: sha(raw)},
        raw,
    };
}

async function lumpWithSource(name, source) {
    const embedded = await frame.lumpBuildContentFrame(
        {name, methods: []}, source, 'full');
    const words = Array(64).fill(0);
    words[0] = 0xf8000001;
    embedded.frameWords.forEach((word, index) => { words[index + 1] = word; });
    const raw = Buffer.alloc(words.length * 4);
    words.forEach((word, index) => raw.writeUInt32BE(word >>> 0, index * 4));
    return raw;
}

async function trustedCallFixture() {
    const selfTest = await frozenApi('SelfTest', [{name: 'Run', index: 0}]);
    const callHome = await frozenApi('WukongCallHome', [{name: 'Main', index: 0}]);
    return {
        review: {proposal: {selectedArtifacts: [
            selfTest.selected, callHome.selected,
        ]}},
        frozen: {
            [`lumps/${selfTest.selected.filename}`]: selfTest.raw,
            [`lumps/${callHome.selected.filename}`]: callHome.raw,
        },
    };
}

test('explicit per-artifact consent; no implied, unknown, or repeated grants', async () => {
    for (const names of [undefined, [], ['SelfTest'], ['WukongCallHome', 'WukongCallHome']]) {
        await assert.rejects(prepare('.', '.', names), /authorization/);
    }
});
test('CapabilityTest stays uncompiled without exact Thread aliases and selected CALL APIs', async () => {
    const {review, frozen} = await trustedCallFixture();
    const source = 'CALL SelfTest, Run\nCALL WukongCallHome, Main';
    const result = capabilityTestPreflight(
        source, {node: 'kjhh1', aliases: {}, definitions: {}}, review, frozen);
    for (const name of ['Thread.2', 'Thread.3', 'Boot.Thread']) {
        assert.ok(result.blockers.some(message => message.includes(name)), name);
    }
    assert.equal(result.blockers.some(message => message.includes('CALL API')), false);
    assert.deepEqual(Object.keys(result.callApiAuthorities).sort(),
        ['SelfTest', 'WukongCallHome']);
    const missingApis = capabilityTestPreflight(source, {
        node: 'kjhh1',
        aliases: {
            'Thread.2': 'kjhh1.Thread2',
            'Thread.3': 'kjhh1.Thread3',
            'Boot.Thread': 'kjhh1.BootThread',
        },
        definitions: {},
    }, {proposal: {selectedArtifacts: []}}, {});
    assert.ok(missingApis.blockers.some(message => message.includes('SelfTest')));
    assert.ok(missingApis.blockers.some(message => message.includes('WukongCallHome')));

    const trusted = capabilityTestPreflight(source, {
        node: 'kjhh1',
        aliases: {
            'Thread.2': 'kjhh1.Thread2',
            'Thread.3': 'kjhh1.Thread3',
            'Boot.Thread': 'kjhh1.BootThread',
        },
        definitions: {},
    }, review, frozen);
    assert.deepEqual(trusted.blockers, []);
    assert.equal(trusted.callApiAuthorities.SelfTest.api.methods[0].name, 'Run');
    assert.equal(trusted.callApiAuthorities.WukongCallHome.api.methods[0].name, 'Main');

    const badMethod = capabilityTestPreflight(
        'CALL SelfTest, Missing\nCALL WukongCallHome, Main', {
            node: 'kjhh1',
            aliases: {
                'Thread.2': 'kjhh1.Thread2',
                'Thread.3': 'kjhh1.Thread3',
                'Boot.Thread': 'kjhh1.BootThread',
            },
            definitions: {},
        }, review, frozen);
    assert.ok(badMethod.blockers.some(message => message.includes('not a known method')));
});
test('prepare records missing authority without invoking the compiler', async () => {
    const staging = path.join(ROOT, 'generated-artifacts');
    const reviewDir = fs.mkdtempSync(path.join(staging, 'resident-preflight-review-'));
    const output = path.join(staging, `resident-preflight-output-${crypto.randomUUID()}`);
    const inputsDir = path.join(reviewDir, 'inputs');
    fs.mkdirSync(path.join(inputsDir, 'lumps'), {recursive: true});
    let invokedCompiler = false;
    const originalExecFileSync = childProcess.execFileSync;
    try {
        const artifacts = [];
        const binaryInputs = {
            'CapabilityTest': await lumpWithSource('CapabilityTest',
                'CALL SelfTest, Run\nCALL WukongCallHome, Main'),
            'SelfTest': (await frozenApi('SelfTest', [{name: 'Run', index: 0}])).raw,
            'WukongCallHome': (await frozenApi(
                'WukongCallHome', [{name: 'Main', index: 0}])).raw,
        };
        const inputs = {};
        for (const [name, raw] of Object.entries(binaryInputs)) {
            const filename = `${name}.lump`;
            fs.writeFileSync(path.join(inputsDir, 'lumps', filename), raw);
            inputs[`lumps/${filename}`] = sha(raw);
            artifacts.push({name, filename, sha256: sha(raw)});
        }
        fs.writeFileSync(path.join(reviewDir, 'candidate.json'), JSON.stringify({
            status: 'review-only',
            activationAllowed: false,
            proposal: {
                format: 'ascending-nst-metadata-slot0-v1',
                selectedArtifacts: artifacts,
            },
            inputs,
        }));
        childProcess.execFileSync = () => {
            invokedCompiler = true;
            throw new Error('compiler must not run when trusted aliases are missing');
        };
        const record = await prepare(reviewDir, output, ['CapabilityTest']);
        assert.equal(invokedCompiler, false);
        assert.equal(record.candidates.length, 0);
        assert.equal(record.failures.length, 1);
        assert.match(record.failures[0].error, /Thread\.2/);
        assert.match(record.failures[0].error, /Thread\.3/);
        assert.match(record.failures[0].error, /Boot\.Thread/);
        assert.match(record.failures[0].error, /Thread\.2 alias/);
        assert.equal(fs.existsSync(path.join(output, 'CapabilityTest/candidate.lump')), false);
    } finally {
        childProcess.execFileSync = originalExecFileSync;
        fs.rmSync(reviewDir, {recursive: true, force: true});
        fs.rmSync(output, {recursive: true, force: true});
    }
});
test('compiler bytes, source and declared identity must agree', () => {
    assert.equal(checkOutput(candidate(), 'source', 'WukongCallHome').length, 256);
    assert.throws(() => checkOutput(candidate(), 'changed', 'WukongCallHome'), /evidence mismatch/);
    assert.throws(() => checkOutput(candidate(), 'source', 'CapabilityTest'), /identity changed/);
    const result = candidate();
    result.words[1] = 1;
    assert.throws(() => checkOutput(result, 'source', 'WukongCallHome'), /word mismatch/);
});
test('concrete GTs cannot leak into compiler candidates', () => {
    const result = candidate(), raw = Buffer.from(result.lump_binary, 'base64');
    raw.writeUInt32BE(0x32000002, 252);
    result.words[63] = 0x32000002;
    result.lump_binary = raw.toString('base64');
    result.compiler_record.binary_hash = sha(raw);
    assert.throws(() => checkOutput(result, 'source', 'WukongCallHome'), /unresolved/);
});
test('compiler failure and missing SELF are explicit errors', () => {
    assert.throws(() => checkOutput({ok: false, error: 'bad opcode'}, '', 'WukongCallHome'), /bad opcode/);
    const result = candidate();
    result.capabilities[0].symbolic_self = false;
    assert.throws(() => checkOutput(result, 'source', 'WukongCallHome'), /unresolved/);
});
test('frozen hash, traversal and symlink checks do not write inputs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-resident-test-'));
    try {
        fs.mkdirSync(path.join(root, 'inputs'));
        fs.writeFileSync(path.join(root, 'inputs', 'sample'), 'unchanged');
        const review = {inputs: {sample: sha('unchanged')}};
        assert.equal(readFrozen(root, review).sample.toString(), 'unchanged');
        assert.throws(() => readFrozen(root, {inputs: {sample: sha('changed')}}), /hash mismatch/);
        assert.throws(() => readFrozen(root, {inputs: {'../sample': sha('unchanged')}}), /Unsafe/);
        fs.symlinkSync(path.join(root, 'inputs', 'sample'), path.join(root, 'inputs', 'alias'));
        assert.throws(() => readFrozen(root, {inputs: {alias: sha('unchanged')}}), /Unsafe/);
        assert.equal(fs.readFileSync(path.join(root, 'inputs', 'sample'), 'utf8'), 'unchanged');
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
test('review cannot imply approval, and compiler diagnostics are escaped', () => {
    const text = html({layoutReviewSha256: 'abc',
        failures: [{name: 'CapabilityTest', error: 'Unknown <Thread> owner'}], candidates: [{
        name: 'WukongCallHome', previousWords: 1024, words: 4096, codeWords: 2,
        previousCodeWords: 1, sha256: 'hash', warnings: [{message: '<script>bad()</script>'}],
    }]});
    assert.match(text, /Not installable or executable/);
    assert.match(text, /&lt;script&gt;/);
    assert.doesNotMatch(text, /<script>/);
    assert.match(text, /Unknown &lt;Thread&gt; owner/);
    assert.match(text, /No binary was produced/);
});
