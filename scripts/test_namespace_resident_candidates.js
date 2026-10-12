'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {prepare, readFrozen, checkOutput, html} = require('./prepare_namespace_resident_candidates');
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
test('explicit per-artifact consent; no implied, unknown, or repeated grants', async () => {
    for (const names of [undefined, [], ['SelfTest'], ['WukongCallHome', 'WukongCallHome']]) {
        await assert.rejects(prepare('.', '.', names), /authorization/);
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
