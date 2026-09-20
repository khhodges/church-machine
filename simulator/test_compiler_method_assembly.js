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

// Regression for the conditional LOAD lines shown in the browser report. Keep
// the instructions at editor lines 68/69: this distinguishes compiler line
// conversion from visual wrapping or from adding/removing wrapper source.
const conditionalBodyPrefix = Array.from({ length: 64 }, (_, i) =>
    `    // screenshot context line ${i + 1}`);
const conditionalSource = [
    'abstraction ConditionalLoadScreenshot {',
    'capabilities { SELF E Next E }',
    'method Run {',
    ...conditionalBodyPrefix,
    '    LOADEQ CR1, CR6, #0 ; line 68: conditional SELF load',
    '    LOADNE CR2, CR6, #1 // line 69: conditional Next load',
    '    RETURN',
    '}',
    '}',
].join('\n');
const conditionalBefore = conditionalSource;
const conditionalResult = compile(conditionalSource);
assert.equal(conditionalSource, conditionalBefore,
    'conditional native compile must not mutate source text');
const conditionalCode = conditionalResult.methods[0].code;
const directConditional = new global.ChurchAssembler().assemble([
    'LOADEQ CR1, CR6, #0',
    'LOADNE CR2, CR6, #1',
    'RETURN',
].join('\n'));
assert.deepEqual(directConditional.errors, []);
assert.deepEqual(conditionalCode, directConditional.words,
    'CLOOMC native handoff must use assembler numeric encoding');
assert.equal((conditionalCode[0] >>> 23) & 0xF, 0, 'LOADEQ must encode EQ condition bits');
assert.equal((conditionalCode[1] >>> 23) & 0xF, 1, 'LOADNE must encode NE condition bits');
const conditionalMapping = conditionalResult.manifest.find(entry => entry.name === 'Run').mapping;
assert.deepEqual(conditionalMapping.slice(0, 2).map(entry => entry.src), [68, 69],
    'reported source lines must match the original editor lines');

const detector = new CLOOMCCompiler();
assert.ok(detector._detectAssembly('LOADEQ CR1, CR6, #0 ; comment'));
assert.ok(detector._detectAssembly('LOADNE CR2, CR6, #1 // comment'));
const assemblerAuthority = new global.ChurchAssembler();
for (const opcode of Object.keys(assemblerAuthority.opcodes)) {
    assert.equal(detector._nativeMnemonic(opcode).opcode, opcode);
    for (const condition of Object.keys(assemblerAuthority.conditions)) {
        assert.equal(detector._nativeMnemonic(opcode + condition).condition, condition,
            `${opcode}${condition} must follow assembler opcode/condition recognition`);
    }
}
assert.equal(detector._nativeMnemonic('LOADHS CR1, CR6, #0').condition, 'HS',
    'assembler condition aliases must be recognized');
assert.equal(detector._nativeMnemonic('LOADNEVER CR1, CR6, #0'), null,
    'junk opcode prefixes must not be admitted as native instructions');
assert.equal(detector._nativeMnemonic('BRANCHXYZ target'), null,
    'junk branch suffixes must not be admitted as native instructions');

// Unsuffixed RETURN belongs to the CLOOMC expression path, which runs before
// native handoff. Guard both previously-supported source forms while retaining
// conditional RETURN as a native assembler instruction.
const returnVariableResult = compile([
    'abstraction ReturnVariable {',
    'capabilities { SELF E }',
    'method Run(value) {',
    '    RETURN value;',
    '}',
    '}',
].join('\n'));
assert.deepEqual(returnVariableResult.methods[0].params, ['value']);
assert.equal((returnVariableResult.methods[0].code[0] >>> 27) & 0x1F, 3,
    'RETURN variable already in DR1 must remain a valid CLOOMC return expression');

const returnNumericResult = compile([
    'abstraction ReturnNumeric {',
    'capabilities { SELF E }',
    'method Run {',
    '    RETURN 7;',
    '}',
    '}',
].join('\n'));
assert.equal((returnNumericResult.methods[0].code.at(-1) >>> 27) & 0x1F, 3,
    'RETURN numeric source form must remain a CLOOMC return expression');
assert.ok(returnNumericResult.methods[0].code.length > 1,
    'RETURN numeric must emit its value before returning');

const conditionalReturnResult = compile([
    'abstraction ConditionalReturn {',
    'capabilities { SELF E }',
    'method Run {',
    '    RETURNNE ; native conditional return',
    '}',
    '}',
].join('\n'));
assert.equal((conditionalReturnResult.methods[0].code[0] >>> 27) & 0x1F, 3);
assert.equal((conditionalReturnResult.methods[0].code[0] >>> 23) & 0xF, 1,
    'conditional RETURN must continue through native assembler handoff');

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

const conditionalWorker = spawnSync(process.execPath, [path.join(__dirname, '..', 'server', 'compile_worker.js')], {
    input: JSON.stringify({ source: conditionalSource, language: 'auto', tier: 0 }),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
});
assert.equal(conditionalWorker.status, 0, conditionalWorker.stderr);
const conditionalWorkerResult = JSON.parse(conditionalWorker.stdout);
assert.equal(conditionalWorkerResult.ok, true, conditionalWorkerResult.error);
assert.equal(conditionalWorkerResult.methods[0].name, 'Run',
    'worker path must compile the conditional native method');
assert.equal(conditionalWorkerResult.compiler_record.source_hash,
    crypto.createHash('sha256').update(Buffer.from(conditionalSource, 'utf8')).digest('hex'),
    'worker must attest the unchanged conditional source');

console.log('PASS CLOOMC method assembly: conditional LOAD/comments, exact lines, encodings, full SelfTest, worker path');