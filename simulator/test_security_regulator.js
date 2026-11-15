'use strict';
// Offline native instruction tests. No server, saved artifacts or live bindings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Compiler = require('./cloomc_compiler');
const builder = require('./lump_builder');
const Simulator = require('./simulator');
const Thread = require('./thread_design');
const source = fs.readFileSync(__dirname + '/cloomc/security_regulator.cloomc', 'utf8');
function compile(text) {
    const compiled = new Compiler().compile(text, []);
    assert.deepEqual(compiled.errors, []);
    const lump = builder.buildLump(compiled);
    return {compiled, lump, api: builder.buildApiDefinition(compiled, lump.words)};
}
const sr = compile(source);
assert.deepEqual(sr.compiled.methods.map(m => m.name), ['LOADM', 'SAVEM', 'SWITCHM']);
function run({method = 'LOADM', index = 1, nullValue = false,
    controlRights = 'W', sourceNull = false, direct = false} = {}) {
    const s = new Simulator();
    const gt = (slot, rights = '', seq = 0, b = 0) => s.createGT(seq, slot,
        {...Object.fromEntries([...rights].map(p => [p, 1])), B: b}, 1) >>> 0;
    const target = compile(`abstraction test.Homes {
capabilities { SELF E, test.Value R, test.Other R }
method Idle() { HALT }
}`);
    const methodIndex = sr.compiled.methods.findIndex(m => m.name === method);
    const caller = compile(`abstraction test.Caller {
capabilities { SELF E, ide.SecurityRegulator E, test.Homes, test.Value R }
method Run() {
 ${sourceNull ? 'LOAD CR1, NULL' : 'LOAD CR1, CR6, #2'}
 ${nullValue ? 'LOAD CR2, NULL' : 'LOAD CR2, CR6, #3'}
 LOAD CR0, CR6, #1
 CALL CR0, #${methodIndex}
 HALT
}
}`);
    const CODE = 2048, HOMES = 4096, VALUE = 6144, CALLER = 8192;
    s.withNamespaceWrite('isolated SR test', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(20, CODE, sr.lump.words.length - 1, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(21, HOMES, target.lump.words.length - 1, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(22, VALUE, 7, 0, 0, 1, 7, 0, 0);
        s.writeNSEntry(23, 0xFFFFFF1C, 0, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(24, CALLER, caller.lump.words.length - 1, 0, 0, 1, 0, 0, 0);
    });
    s.memory[0] = 0xF900820C;
    const layout = Thread.layout(256, 32);
    s.memory[17] = s._packProtectedIndicator(layout.stackEnd - 4, 1, {}, 0);
    const srGT = gt(20, 'E'), callerGT = gt(24, 'E');
    const value = nullValue ? 0 : gt(22, 'R', 7, 1);
    const rows = HOMES + target.lump.words.length - 3;
    s.memory.set(sr.lump.words, CODE);
    s.memory.set([srGT, gt(23, controlRights)], CODE + sr.lump.words.length - 2);
    s.memory.set(target.lump.words, HOMES);
    s.memory.set([gt(21, 'E'), value, value], rows);
    s.memory.set(caller.lump.words, CALLER);
    s.memory.set([callerGT, srGT, sourceNull ? 0 : gt(21), value],
        CALLER + caller.lump.words.length - 4);
    s.bootComplete = true;
    s.mElevation = false;
    s.petNameMemory.clear();
    s.programCapabilities = null;
    s.cr[12] = {word0: gt(1), word1: 0, word2: 255, word3: 0, m: 0};
    const entry = direct ? sr : caller;
    const identity = direct ? srGT : callerGT;
    const slot = direct ? 20 : 24;
    s._installLumpHeaderContext(s.parseGT(identity), slot, s.readNSEntry(slot),
        s.parseLumpHeader(entry.lump.words[0]));
    if (direct) {
        s._writeCR(1, sourceNull ? 0 : gt(21), sourceNull ? null : s.readNSEntry(21));
        s._writeCR(2, value, value ? s.readNSEntry(22) : null);
    }
    s.dr[1] = index;
    s.pc = entry.lump.words[1 + (direct ? methodIndex : 0)] - 1;
    const before = Array.from(s.memory.slice(rows, rows + 3));
    let fault, returned = false, sawM = false;
    s.on('fault', e => { fault = e; });
    for (let i = 0; i < 250 && !fault; i++) {
        const fetch = s._fetchInstruction();
        assert(fetch.ok);
        if (direct && (s.memory[fetch.addr] >>> 27) === 3) {
            returned = true;
            break;
        }
        s.step();
        sawM ||= s.cr[1].m === 1;
        if (s.halted && !fault) { returned = true; break; }
    }
    return {s, fault, returned, sawM, value, before,
        rows: Array.from(s.memory.slice(rows, rows + 3))};
}
for (const nullValue of [false, true]) {
    const f = run({nullValue});
    assert(f.returned, JSON.stringify(f.fault));
    assert.equal(f.s.dr[1], 0);
    assert.equal(f.s.cr[1].word0 >>> 0, f.value);
    assert.equal(f.s.cr[1].m, 0);
    assert.equal(f.s.cr[11].word0, 0);
    assert.deepEqual(f.rows, f.before);
    assert.equal(f.s.callStack.length, 0);
    assert(f.sawM);
}
for (const direct of [false, true]) {
    const f = run({method: 'SAVEM', direct});
    assert(f.returned, JSON.stringify(f.fault));
    assert.equal(f.s.dr[1], 0);
    assert.equal(f.rows[1], (f.value & 0x7fffffff) >>> 0);
    assert.equal(f.rows[0], f.before[0]);
    assert.equal(f.rows[2], f.before[2]);
    if (direct) assert.equal(f.s.cr[2].word0 >>> 0, f.value);
}
for (const method of ['LOADM', 'SAVEM', 'SWITCHM']) {
    for (const index of [1024, 0xffffffff]) {
        const f = run({method, index});
        assert(f.returned, JSON.stringify(f.fault));
        assert.equal(f.s.dr[1], 2);
        assert.deepEqual(f.rows, f.before);
        assert(!f.sawM);
    }
}
for (const options of [
    {controlRights: 'R'}, {index: 3}, {sourceNull: true},
    {method: 'SAVEM', index: 0}, {method: 'SAVEM', index: 3},
    {method: 'SWITCHM'}, // source has no explicit L
]) {
    const f = run(options);
    assert(f.fault, JSON.stringify(options));
    assert(!f.returned);
    assert.deepEqual(f.rows, f.before);
}
console.log('PASS SR: native LOADM/SAVEM, CALL/RETURN, NULL, B-copy, M custody, index rejection and fault boundaries');
