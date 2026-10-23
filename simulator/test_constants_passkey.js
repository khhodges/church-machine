'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('../tests/simulator/cr6_contract_fixture');
const Compiler = require('./cloomc_compiler');
const {assembleLump} = require('./lump_assembler');
const api = require('./abstract_gt_phase1');
const {savePasskeyImage, restorePasskeyImage} = require('./passkey_saved_image');
const os = require('node:os');
global.window.bootConfig.step1.totalNamespaceWords = 32768;

function compile(text) {
    const c = new Compiler().compile(text, []);
    assert.deepEqual(c.errors, []);
    const lump = assembleLump(c.methods.map(m => m.code));
    assert.deepEqual(lump.errors || [], []);
    const sites = new Map();
    let offset = c.methods.length;
    for (const m of c.methods) {
        const a = new global.ChurchAssembler();
        const body = m.sourceLines.replace(/^method[^{]+\{/, '').replace(/\}\s*$/, '');
        a.assemble(body);
        assert.deepEqual(a.errors, []);
        for (const [, label] of body.matchAll(/^(\w+):\s*\n\s*HARDFAULT/gm)) {
            sites.set(offset + a.labels[label], label);
        }
        offset += m.code.length;
    }
    return {c, lump, sites};
}
const constants = compile(api.source('constants'));
const passkey = compile(api.source('passkey'));
assert.deepEqual(constants.c.methods.map(m => m.name), ['Get', 'value']);
assert.deepEqual(passkey.c.methods.map(m => m.name), ['NewProof']);
const pool = [...api.source('passkey').matchAll(/^\s*\.word (0x[0-9a-f]+)$/gm)].map(m => Number(m[1]));
assert.equal(pool.length, 100);
assert.equal(new Set(pool).size, 100);
assert.deepEqual(Array.from(passkey.lump.buf.slice(3, 103)), pool);
assert.equal(api.REAL_VALUES.length, 100);
const approved = fs.readFileSync(path.join(__dirname, '../docs/reviews/mint-phase1/abstract-constants.md'), 'utf8');
assert.deepEqual([...approved.matchAll(/^\| \d+ \| ([A-Z0-9_]+) \|/gm)].map(m => m[1]), api.NAMES);
assert.equal(api.fixed(Math.PI), 205887);
assert.throws(() => api.fixed(Infinity));
assert.throws(() => api.fixed(32768));
assert.throws(() => api.encodeName(''));
assert.throws(() => api.encodeName('A'.repeat(32)));
assert.throws(() => api.stateImage(0));
// Existing assembler raw-data directive remains range-checked in method bodies.
for (const literal of ['-1', '0x100000000', 'bogus']) {
    const r = new Compiler().compile(`abstraction test.Raw {\ncapabilities { SELF E }\nmethod Run {\n.word ${literal}\n}\n}`, []);
    assert(r.errors.some(e => /\.word requires/.test(e.message)));
}

const circleSource = fs.readFileSync(path.join(__dirname, 'cloomc/constants_circle.cloomc'), 'utf8');
const circle = compile(circleSource);
function setup({capacity = 101, proofSource, restored, token = api.packAbstract(0, 41)} = {}) {
    const f = fixture(true), s = f.sim;
    const STATE = 0x5000, CSCRATCH = 0x4900, NAME = 0x4800, CATALOGUE = 0x3800;
    function data(slot, base, words, rights) {
        const size = Math.max(64, 2 ** Math.ceil(Math.log2(words.length)));
        s.memory.fill(0, base, base + size);
        s.memory.set(words, base);
        s.memory[base] = s.packLumpHeader(Math.log2(size)-6, 0, 0, 0);
        s.withNamespaceWrite('TEST ONLY separate Constants/Passkey data', () =>
            s.writeNSEntry(slot, base, size - 1, 0, 0, 1, 0, 0, 0));
        return s.createGT(0, slot, rights, 1);
    }
    function loadView(slot, base) {
        s.withNamespaceWrite('TEST ONLY private scratch L view', () =>
            s.writeNSEntry(slot, base, 0, 0, 0, 1, 0, 0, 0));
        return s.createGT(0, slot, {L: 1}, 1);
    }
    const stateWords = restored ? restored.stateWords : api.stateImage(capacity);
    const stateGT = data(43, STATE, stateWords, {R: 1, W: 1});
    const catalogueGT = data(44, CATALOGUE, api.catalogueImage(), {R: 1});
    const scratchGT = data(45, CSCRATCH, new Uint32Array(64), {R: 1, W: 1});
    const constantLoad = loadView(46, CSCRATCH + 1);
    const proofLoad = loadView(47, STATE + 4);
    const nameGT = data(48, NAME, api.encodeName('PI'), {R: 1});
    const constantDomain = f.install(32, constants.lump.buf.slice(1), [scratchGT, catalogueGT, constantLoad]);
    const p = proofSource ? compile(proofSource) : passkey;
    const proofDomain = f.install(33, p.lump.buf.slice(1), [stateGT, proofLoad]);
    const artifactWords = s.memory.slice(proofDomain.base,
        proofDomain.base + proofDomain.hdr.lumpSize);
    if (restored) {
        assert.deepEqual(artifactWords, restored.artifactWords);
        // Restore the exact private words, including the original DATA header.
        s.memory.set(restored.stateWords, STATE);
    }
    const callers = {};
    callers.get = f.compile(30, `
        LOAD CR2, CR6, #1
        LOAD CR0, CR6, #2
        CALL CR0, #0
        HALT
    `, [nameGT, constantDomain.gt]);
    callers.value = f.compile(31, `
        LOAD CR2, CR6, #1
        LOAD CR0, CR6, #2
        CALL CR0, #0
        LOAD CR0, CR6, #2
        CALL CR0, #1
        HALT
    `, [nameGT, constantDomain.gt]);
    callers.proof = f.compile(34, `
        LOAD CR2, CR6, #1
        LOAD CR0, CR6, #2
        CALL CR0, #0
        HALT
    `, [nameGT, proofDomain.gt]);
    callers.token = f.compile(35, `
        ${token === 0 ? 'LOAD CR1, NULL' : 'LOAD CR1, CR6, #1'}
        LOAD CR0, CR6, #2
        CALL CR0, #1
        HALT
    `, [token, constantDomain.gt]);
    const circleDomain = f.install(36, circle.lump.buf.slice(1), [nameGT, constantDomain.gt]);
    callers.circle = f.compile(37, 'LOAD CR0, CR6, #1\nCALL CR0, #0\nHALT', [circleDomain.gt]);
    // Test the actual issued token through Constants.value, not a host copy.
    callers.proofAsValue = f.compile(38, `
        LOAD CR2, CR6, #1
        LOAD CR0, CR6, #2
        CALL CR0, #0
        LOAD CR0, CR6, #3
        CALL CR0, #1
        HALT
    `, [nameGT, proofDomain.gt, constantDomain.gt]);
    let fault;
    s.fault = (type, message) => { fault = {type, message}; s.halted = true; };
    function invoke(which, name = 'PI') {
        s.memory.fill(0, NAME+1, NAME+64);
        const words = typeof name === 'string' ? api.encodeName(name) : name;
        s.memory.set(words.slice(1), NAME+1);
        fault = null;
        s.halted = false;
        f.activate(callers[which]);
        let remaining = 100000;
        while (!s.halted && remaining-- > 0) s.step();
        assert(s.halted, 'bounded native execution');
        const sites = which === 'proof' ? p.sites : constants.sites;
        return {fault, site: fault && sites.get(s.pc), gt: s.cr[1].word0 >>> 0,
            status: s.dr[1], real: s.dr[2] | 0, imaginary: s.dr[3] | 0, fractional: s.dr[1]};
    }
    return {s, invoke, STATE, CSCRATCH, NAME, CATALOGUE,
        snapshot: () => ({artifactWords,
            stateWords: s.memory.slice(STATE, STATE + stateWords.length)})};
}
function rejected(result, site) {
    assert(result.fault, `expected ${site}`);
    assert.equal(result.site, site, JSON.stringify(result.fault));
}
const f = setup();
for (const [i, name] of api.NAMES.entries()) {
    const r = f.invoke('value', name);
    assert.equal(r.fault, null, `${name}: ${JSON.stringify(r.fault)}`);
    assert.equal(r.gt, api.packAbstract(0, i+1));
    assert.equal(r.status, 16);
    assert.equal(r.fractional, 16);
    assert.equal(r.real, api.fixed(api.REAL_VALUES[i]) | 0, name);
    assert.equal(r.imaginary, name === 'I' ? 65536 : name === 'NEG_I' ? -65536 : 0);
    assert(Math.abs(r.real / 65536 - api.REAL_VALUES[i]) <= 0.5/65536);
    assert.equal(f.s.memory[f.CSCRATCH+1], 0);
    for (const reg of [0,2,3,4,7,8,9,10,11]) assert.equal(f.s.cr[reg].word0, 0);
}
assert.equal(f.invoke('get', 'PHI').gt, f.invoke('get', 'GOLDEN_RATIO').gt);
assert.equal(f.invoke('value', 'PHI').real, f.invoke('value', 'GOLDEN_RATIO').real);
assert.equal(f.invoke('value', 'NEG_ONE').real, -65536);
assert.equal(f.invoke('value', 'HALF').real, 32768);
const area = f.invoke('circle', 'PI');
assert.equal(area.fault, null, JSON.stringify(area.fault));
assert.equal(area.real, 823548);
assert.equal(area.fractional, 16);
assert(Math.abs(area.real/65536 - 4*Math.PI) < 4/65536);
assert.equal(f.invoke('token').real, 205887);
rejected(setup().invoke('get', 'UNKNOWN'), 'constant_unknown');
rejected(setup().invoke('get', [0,0]), 'constant_bad_name');
rejected(setup({token: api.packAbstract(0, 999)}).invoke('token'), 'value_unknown');
assert.equal(setup({token: 0}).invoke('token').fault?.type, 'NULL_CAP');
rejected(setup().invoke('proofAsValue', 'Mint'), 'value_unknown');
const corrupt = setup();
corrupt.s.memory[corrupt.CATALOGUE+2+40*36+35] = 32;
rejected(corrupt.invoke('value', 'PI'), 'value_bad_catalogue');
const badCatalogue = setup();
badCatalogue.s.memory[badCatalogue.CATALOGUE+1] = 0;
rejected(badCatalogue.invoke('get'), 'constant_bad_catalogue');

const keys = setup();
for (let i=0; i<100; i++) {
    const r = keys.invoke('proof', `Name${i}`);
    assert.equal(r.fault, null, JSON.stringify(r.fault));
    assert.equal(r.gt, pool[i]);
    assert.equal(r.gt >>> 31, 0);
    assert.equal(keys.s.memory[keys.STATE+1], i+1);
    assert.equal(keys.s.memory[keys.STATE+3], i+1);
    assert.equal(keys.s.memory[keys.STATE+4], 0);
}
rejected(keys.invoke('proof', 'End'), 'proof_no_random');
const duplicate = setup();
assert.equal(duplicate.invoke('proof', 'Mint').fault, null);
const before = Array.from(duplicate.s.memory.slice(duplicate.STATE, duplicate.STATE+4096));
rejected(duplicate.invoke('proof', 'Mint'), 'proof_duplicate');
assert.deepEqual(Array.from(duplicate.s.memory.slice(duplicate.STATE, duplicate.STATE+4096)), before);
const full = setup({capacity: 1});
assert.equal(full.invoke('proof', 'Mint').fault, null);
rejected(full.invoke('proof', 'Other'), 'proof_full');
rejected(setup().invoke('proof', [0,1,32]), 'proof_bad_name');
const badCursor = setup();
badCursor.s.memory[badCursor.STATE+3] = 101;
rejected(badCursor.invoke('proof', 'Mint'), 'proof_bad_state');
const invalidState = setup();
invalidState.s.memory[invalidState.STATE+1] = 102;
rejected(invalidState.invoke('proof', 'Mint'), 'proof_bad_state');
let n=0;
const collision = setup({proofSource: api.source('passkey').replace(/^\s*\.word 0x[0-9a-f]+$/gm,
    () => '    .word 0x' + pool[n++ < 2 ? 0 : 1].toString(16))});
assert.equal(collision.invoke('proof', 'Mint').gt, pool[0]);
assert.equal(collision.invoke('proof', 'Other').gt, pool[1]);
assert.equal(collision.s.memory[collision.STATE+3], 3);
const badPool = setup({proofSource: api.source('passkey').replace(/\.word 0x[0-9a-f]+/, '.word 0')});
rejected(badPool.invoke('proof', 'Mint'), 'proof_bad_pool');

// Saved restart uses only a disposable directory and fresh simulator RAM.
const savedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'passkey-restart-'));
try {
    const filename = path.join(savedDir, 'private.json');
    const original = setup();
    for (let i = 0; i < 3; i++) assert.equal(original.invoke('proof', `Saved${i}`).gt, pool[i]);
    const captured = original.snapshot();
    savePasskeyImage(filename, captured);
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    const restored = restorePasskeyImage(filename, captured.artifactWords);
    assert.deepEqual(restored, captured);
    const restarted = setup({restored});
    const beforeDuplicate = restarted.snapshot().stateWords;
    rejected(restarted.invoke('proof', 'Saved0'), 'proof_duplicate');
    assert.deepEqual(restarted.snapshot().stateWords, beforeDuplicate);
    for (let i = 3; i < 100; i++) {
        const r = restarted.invoke('proof', `Saved${i}`);
        assert.equal(r.fault, null);
        assert.equal(r.gt, pool[i]);
    }
    savePasskeyImage(filename, restarted.snapshot());
    const exhausted = setup({restored: restorePasskeyImage(filename, captured.artifactWords)});
    const terminal = exhausted.snapshot().stateWords;
    rejected(exhausted.invoke('proof', 'NewAfterRestart'), 'proof_no_random');
    rejected(exhausted.invoke('proof', 'Saved99'), 'proof_duplicate');
    assert.deepEqual(exhausted.snapshot().stateWords, terminal);
    savePasskeyImage(filename, exhausted.snapshot());
    const again = setup({restored: restorePasskeyImage(filename, captured.artifactWords)});
    rejected(again.invoke('proof', 'StillExhausted'), 'proof_no_random');
    const different = captured.artifactWords.slice();
    different[3] ^= 1;
    assert.throws(() => restorePasskeyImage(filename, different), /exact selected artifact/);
    const invalid = exhausted.snapshot();
    invalid.stateWords[3] = 0;
    const validFile = fs.readFileSync(filename);
    assert.throws(() => savePasskeyImage(filename, invalid), /state/);
    assert.deepEqual(fs.readFileSync(filename), validFile);
    const damaged = JSON.parse(validFile);
    damaged.payload.state[3] = 0;
    fs.writeFileSync(filename, JSON.stringify(damaged));
    assert.throws(() => restorePasskeyImage(filename, captured.artifactWords), /integrity/);
    fs.writeFileSync(filename, '{');
    assert.throws(() => restorePasskeyImage(filename, captured.artifactWords));
    fs.unlinkSync(filename);
    assert.throws(() => restorePasskeyImage(filename, captured.artifactWords), /ENOENT/);
    savePasskeyImage(filename, full.snapshot());
    const fullRestart = setup({restored: restorePasskeyImage(filename, full.snapshot().artifactWords)});
    rejected(fullRestart.invoke('proof', 'Other'), 'proof_full');
    // Cursor can exceed count after collision skips; never infer it from count.
    const skipped = original.snapshot();
    skipped.stateWords[3] = 5;
    savePasskeyImage(filename, skipped);
    const skipRestart = setup({restored: restorePasskeyImage(filename, skipped.artifactWords)});
    assert.equal(skipRestart.invoke('proof', 'AfterSkippedEntries').gt, pool[5]);
} finally {
    fs.rmSync(savedDir, {recursive: true, force: true});
}
console.log('PASS: separate native Constants/Passkey; 100 numerical values, complex values, pi circle calculation, original 100-proof pool, negative paths and cleanup.');
