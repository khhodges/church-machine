'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

global.ChurchAssembler = require(path.join(__dirname, 'assembler.js'));
global.METHOD_REGISTER_CONVENTIONS = {};
global.BOOT_UPLOADS = [];
const CLOOMCCompiler = require(path.join(__dirname, 'cloomc_compiler.js'));

function compile(source) {
    const result = new CLOOMCCompiler().compile(source, []);
    assert.deepEqual(result.errors, [], JSON.stringify(result.errors, null, 2));
    return result;
}

function wrapSelfTest(rawSource) {
    const lines = rawSource.split('\n');
    const capStart = lines.findIndex(line => /^\s*capabilities\s*\{/.test(line));
    const capEnd = lines.findIndex((line, index) => index > capStart && /^\s*\}/.test(line));
    assert.ok(capStart >= 0 && capEnd > capStart, 'fixture must contain a capabilities block');

    const capabilities = lines.slice(capStart, capEnd + 1)
        .join('\n')
        .replace(/\bSelfTest(\s+E\b)/, 'SELF$1');
    const body = lines.slice(capEnd + 1)
        .join('\n')
        .replace(/\bLOAD (CR(?:1[0-5]|[0-9])),\s*SelfTest\b/g, 'LOAD $1, SELF');
    return [
        'abstraction Church.Machine.PostFlash.SelfTest {',
        capabilities,
        'method Run {',
        body,
        '}',
        '}',
    ].join('\n');
}

const snippet = [
    'abstraction MethodAssembly {',
    'capabilities { SELF E }',
    'method Run {',
    'start:',
    '    IADD DR1, DR0, #0       ; explicit success status',
    '    LOAD CR1, SELF          ; CR1 = E-GT from c-list row 0',
    '',
    '    BRANCHEQ forward',
    'backward:',
    '    RETURN',
    'forward:',
    '    BRANCH backward',
    '}',
    '}',
].join('\n');
const snippetBefore = snippet;
const snippetResult = compile(snippet);
assert.equal(snippet, snippetBefore, 'compile must not mutate source text');
assert.deepEqual(snippetResult.capabilities.map(cap => cap.name), ['SELF']);
assert.equal(snippetResult.capabilities[0].compiler_owned_self, true);
assert.deepEqual(snippetResult.capabilities[0].rights, ['E']);
assert.equal(snippetResult.methods[0].code[1] & 0x7FFF, 0,
    'LOAD SELF must encode canonical c-list row zero');
assert.equal(snippetResult.methods[0].code[2] & 0x7FFF, 2,
    'forward branch must resolve relative to its own instruction');
assert.equal(snippetResult.methods[0].code[4] & 0x7FFF, 0x7FFF,
    'backward branch must resolve to the earlier method label');
assert.ok(snippetResult.methods[0].sourceLines.includes(
    '    LOAD CR1, SELF          ; CR1 = E-GT from c-list row 0\n\n    BRANCHEQ forward'
), 'saved method source must preserve comments and blank lines exactly');
const snippetMapping = snippetResult.manifest.find(entry => entry.name === 'Run').mapping;
assert.equal(snippetMapping.find(entry => entry.desc === 'BRANCHEQ forward').src, 8,
    'manifest must retain the branch original editor line');

const invalid = snippet.replace('LOAD CR1, SELF', 'LOAD CR1, Missing');
const invalidResult = new CLOOMCCompiler().compile(invalid, []);
const missingError = invalidResult.errors.find(error => /Unknown capability 'Missing'/.test(error.message));
assert.ok(missingError, JSON.stringify(invalidResult.errors));
assert.equal(missingError.line, 6,
    'diagnostic must identify the original instruction, not the following blank line');

const fixturePath = path.join(__dirname, 'examples', 'post_flash_selftest.cloomc');
const fixtureBefore = fs.readFileSync(fixturePath);
const fixtureHash = crypto.createHash('sha256').update(fixtureBefore).digest('hex');
const wrapped = wrapSelfTest(fixtureBefore.toString('utf8'));
const wrappedBefore = wrapped;
const fullResult = compile(wrapped);
assert.equal(wrapped, wrappedBefore, 'full compile must not mutate wrapped source');
assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'),
    fixtureHash,
    'full compile must not mutate the saved fixture',
);
assert.deepEqual(fullResult.capabilities.map(cap => cap.name), ['SELF', 'Next']);
assert.equal(fullResult.capabilities[0].compiler_owned_self, true);
assert.ok(fullResult.methods[0].code.length > 300, 'full SelfTest method must be assembled');

const worker = spawnSync(process.execPath, [path.join(__dirname, '..', 'server', 'compile_worker.js')], {
    input: JSON.stringify({ source: wrapped, language: 'auto', tier: 0 }),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
});
assert.equal(worker.status, 0, worker.stderr);
const workerResult = JSON.parse(worker.stdout);
assert.equal(workerResult.ok, true, workerResult.error);
assert.equal(workerResult.language, 'javascript');
assert.equal(workerResult.methods[0].name, 'Run');
assert.deepEqual(workerResult.capabilities.map(cap => ({
    name: cap.name, row: cap.relocation_row, pending: cap.pending_symbolic,
})), [
    { name: 'SELF', row: 0, pending: false },
    { name: 'Next', row: 1, pending: true },
]);
assert.equal(workerResult.compiler_record.source_hash,
    crypto.createHash('sha256').update(Buffer.from(wrapped, 'utf8')).digest('hex'));

console.log('PASS CLOOMC method assembly: SELF row zero, labels, line mapping, full SelfTest, worker path');