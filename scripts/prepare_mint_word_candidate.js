'use strict';
// Separate, unbound software candidate. Never publishes or builds a boot image.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
global.ChurchAssembler = require('../simulator/assembler');
const Compiler = require('../simulator/cloomc_compiler');
const builder = require('../simulator/lump_builder');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = 'c32e5b555453b0ea2b6c7b8a749d81285a923758f9181fcffa6f9ad941c4ee01';
const BIT = 'a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function once(text, from, to) {
    if (text.split(from).length !== 2) throw Error('Saved Mint source anchor drift');
    return text.replace(from, to);
}
function readSaved() {
    return JSON.parse(execFileSync('python3', [path.join(__dirname, 'read_saved_mint_candidate.py')],
        {cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024}));
}
function adapt(source) {
    if (sha(source) !== SOURCE) throw Error('Pinned saved Mint source hash mismatch');
    const start = source.indexOf('create_descriptor_prepare:');
    const end = source.indexOf('create_data_set_slot:', start);
    if (start < 0 || end <= start) throw Error('Missing descriptor block');
    let body = source.slice(start, end);
    body = once(body, '    BFEXT DR4, DR7, #16, #16',
        `    ; Frozen boot BIT: reject extents outside its 16384-word RAM.
    ; Alignment has already been checked; retain byte base until success.
    SHR DR13, DR8, #2
    IADD DR4, DR0, #1
    SHL DR4, DR4, #14
    MCMP DR13, DR4
    BRANCHHS TODO_CREATE_DESCRIPTOR_INPUT_INVALID
    ISUB DR4, DR4, DR13
    MCMP DR6, DR4
    BRANCHHI TODO_CREATE_DESCRIPTOR_INPUT_INVALID
    BFEXT DR4, DR7, #16, #16`);
    body = once(body, '    BRANCH create_descriptor_integrity',
        `    ; W0 uses resident words; integrity must cover that encoded value.
    SHR DR8, DR8, #2
    BRANCH create_descriptor_integrity`);
    return source.slice(0, start) + body + source.slice(end);
}
function compile(source) {
    const compiled = new Compiler().compile(source, []);
    if (compiled.errors.length) throw Error(JSON.stringify(compiled.errors));
    const packed = builder.buildLump(compiled);
    const api = builder.buildApiDefinition(compiled, packed.words);
    return {compiled, packed, api, words: builder.embedSelfDefinition(packed.words, api, source, 0)};
}
function prepare() {
    const saved = readSaved();
    const baseline = compile(saved.source);
    const cw = (baseline.packed.words[0] >>> 10) & 8191;
    // A different compiler is not permission to silently change the baseline.
    if (JSON.stringify(Array.from(baseline.packed.words.slice(1, 1 + cw))) !==
        JSON.stringify(saved.executableWords)) throw Error('Current compiler does not reproduce saved executable');
    const source = adapt(saved.source);
    const candidate = compile(source);
    if (JSON.stringify(candidate.api) !== JSON.stringify(baseline.api))
        throw Error('Public API/binding contract changed');
    const bytes = Buffer.alloc(candidate.words.length * 4);
    candidate.words.forEach((w, i) => bytes.writeUInt32BE(w >>> 0, i * 4));
    return {saved, source, candidate, bytes, receipt: {
        status: 'OFFLINE UNBOUND CREATE CANDIDATE — NOT INSTALLABLE',
        bitstreamSha256: BIT, originalBinarySha256: saved.primarySha256,
        originalSourceSha256: saved.sourceSha256, originalBundleId: saved.bundleId,
        sourceSha256: sha(source), candidateSha256: sha(bytes),
        passkey: 'included and ignored', baselineExecutableReproduced: true,
        scope: 'CREATE descriptor word addressing only; other methods unchanged and not qualified',
        limitations: ['No full CREATE execution', 'No RTL replay', 'No bindings or boot image',
            'DESTROY still uses the original byte-address contract; not qualified for these objects'],
        installationAllowed: false, hardwareProgrammingAllowed: false, releaseApproved: false,
    }};
}
if (require.main === module) {
    const result = prepare();
    const dest = path.join(ROOT, 'generated-artifacts', 'mint-word-candidate-' + result.receipt.sourceSha256.slice(0, 12));
    fs.mkdirSync(dest, {recursive: false}); // Never overwrite a previous candidate.
    fs.writeFileSync(path.join(dest, 'candidate.cloomc'), result.source, {flag: 'wx'});
    fs.writeFileSync(path.join(dest, 'candidate-UNBOUND.lump'), result.bytes, {flag: 'wx'});
    fs.writeFileSync(path.join(dest, 'receipt.json'), JSON.stringify(result.receipt, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify({directory: path.relative(ROOT, dest), ...result.receipt}, null, 2));
}
module.exports = {readSaved, adapt, prepare, sha};
