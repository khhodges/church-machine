'use strict';
// Execute the compiled native bodies in the EXISTING machine, not a queue model.
// Namespace writes below are disposable test privilege, never installation.
const assert = require('node:assert/strict');
const Simulator = require('../simulator/simulator');
const {prepare} = require('./build_free_handler_example');
const r = prepare();
assert(Simulator.isSinglePerm({L: 1, S: 1}).ok,
    'BLOCKED: FreeCList requires LS, but the current simulator rejects LS. Do not substitute S or bypass the guard.');
const CODE = 2048, STATE = 4096, AMOEBA = 5120, APP = 6144;
function fixture() {
    const s = new Simulator();
    const gt = (slot, rights) => s.createGT(0, slot,
        Object.fromEntries([...rights].map(x => [x, 1])), 1) >>> 0;
    s.withNamespaceWrite('TEST PRIVILEGE: isolated FreeHandler example', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(20, CODE, r.words.length - 1, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(21, STATE, 63, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(22, AMOEBA, r.amoebaWords.length - 1, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(23, APP, 63, 0, 0, 1, 0, 0, 0);
        for (const o of r.setup.objects)
            s.writeNSEntry(o.slot, o.baseWord, o.limit, 0, 0, 1, 0, 0, 0);
    });
    s.memory[0] = 0xF900820C;
    s.memory.set(r.words, CODE);
    s.memory.set(r.state, STATE);
    s.memory.set(r.objectWords, r.setup.baseWord);
    s.memory.set(r.amoebaWords, AMOEBA);
    s.memory[APP] = 0xF8000800; // tiny application: method table and HALT
    s.memory[APP + 1] = 2;
    s.memory[APP + 2] = 0xF6000000;
    const amoebaGT = gt(22, 'E');
    const thread = r.setup.objects[7];
    for (const relocation of r.setup.thread.relocations)
        s.memory[thread.baseWord + relocation.wordOffset] = amoebaGT;
    const objectGTs = r.setup.objects.map(o => gt(o.slot, o.rights.join('')));
    const caps = [gt(20, 'E'), gt(21, 'RW'), ...objectGTs, gt(thread.slot, 'S')];
    s.memory.set(caps, CODE + r.words.length - caps.length);
    s.bootComplete = true;
    s.mElevation = false;
    s.petNameMemory.clear();
    s.programCapabilities = null;
    s.cr[12] = {word0: gt(1, ''), word1: 0, word2: 255, word3: 0, m: 0};
    let fault;
    s.on('fault', event => { fault = event; });
    function run(name, input = 0) {
        fault = null;
        s.halted = false;
        s.dr.fill(0);
        const owner = s.readNSEntry(20);
        s._writeCR(0, caps[0], owner);
        s._installLumpHeaderContext(s.parseGT(caps[0]), 20, owner, s.parseLumpHeader(r.words[0]));
        s.pc = r.words[1 + r.api.methods[name][0]] - 1;
        if (input) s._writeCR(2, input, s.readNSEntry(s.parseGT(input).index));
        else s.cr[2] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
        // Stop at authored RETURN; CALL/RETURN preservation is checked by the
        // binary contract suite, not faked by a second executor here.
        let steps = 0;
        while (!fault && !s.halted && steps++ < 250) {
            if (s.memory[CODE + 1 + s.pc] >>> 27 === 3)
                return {gt: s.cr[1].word0 >>> 0, status: s.dr[1], fault: null};
            s.step();
        }
        if (!fault) throw Error(`${name} did not reach its RETURN: pc=${s.pc}`);
        return {fault};
    }
    return {s, gt, run, objectGTs, thread, caps};
}
const f = fixture();
for (const [name, indices] of [['Free64', [0, 1, 2]], ['Free128', [3, 4]], ['Free256', [5]]]) {
    for (const i of indices) {
        assert.deepEqual(f.run(name), {gt: f.objectGTs[i], status: 0, fault: null}, name);
    }
    assert.deepEqual(f.run(name), {gt: 0, status: 1, fault: null}, `${name} exhausts`);
}
assert.deepEqual(f.run('FreeCList'), {gt: f.objectGTs[6], status: 0, fault: null});
assert.deepEqual(f.run('FreeCList'), {gt: 0, status: 1, fault: null});
assert(Array.from(f.s.memory.slice(r.setup.objects[6].baseWord + 64,
    r.setup.objects[6].baseWord + 128)).every(w => w === 0));
const before = Array.from(f.s.memory.slice(f.thread.baseWord, f.thread.baseWord + 512));
const app = f.gt(23, 'EB');
assert.deepEqual(f.run('FreeThread', app), {gt: f.objectGTs[7], status: 0, fault: null});
const after = Array.from(f.s.memory.slice(f.thread.baseWord, f.thread.baseWord + 512));
assert.equal(after[501], app, 'application supplied through API reaches saved CR1');
assert.deepEqual(after.map((w, i) => w !== before[i] ? i : -1).filter(i => i >= 0), [501],
    'only saved CR1 changes; Amoeba CR0, protected frames, stack and heap remain untouched');
assert.deepEqual(f.run('FreeThread', app), {gt: 0, status: 1, fault: null});
for (const token of f.objectGTs) {
    assert.deepEqual(f.run('Release', token), {gt: 0, status: 0, fault: null});
    assert.deepEqual(f.run('Release', token), {gt: 0, status: 3, fault: null});
}
assert.equal(f.s.memory[STATE + 11], 8, 'all eight kinds fit the quarantine queue');
assert.deepEqual(f.run('FreeThread', app), {gt: 0, status: 1, fault: null});
assert.deepEqual(f.run('FreeCList'), {gt: 0, status: 1, fault: null});
assert.deepEqual(f.run('Release', app), {gt: 0, status: 2, fault: null});
const fresh = fixture();
assert.deepEqual(fresh.run('Release', fresh.objectGTs[7]), {gt: 0, status: 3, fault: null});
assert(fresh.run('FreeThread').fault, 'NULL application must fault, not issue a Thread');
const denied = fixture();
assert(denied.run('FreeThread', denied.gt(23, 'E')).fault, 'SAVE requires source transfer authority');
assert.equal(denied.s.memory[STATE + 35], 0, 'failed binding does not mark Thread issued');
assert.equal(denied.s.memory[denied.thread.baseWord + 501], 0);
const noWrite = fixture();
noWrite.s.memory[CODE + r.words.length - 1] = noWrite.gt(noWrite.thread.slot, '');
assert(noWrite.run('FreeThread', noWrite.gt(23, 'EB')).fault,
    'private Thread S permission is mandatory');
assert.equal(noWrite.s.memory[STATE + 35], 0);
assert.equal(noWrite.s.memory[noWrite.thread.baseWord + 501], 0);
const corrupt = fixture();
corrupt.s.memory[STATE + 34] = 99;
assert(corrupt.run('FreeCList').fault, 'corrupt singleton state must hard-fault');
console.log('PASS: real compiled method bodies, finite inventories, empty C-list, saved CR1 binding, quarantine and transfer denial; no live state changed');
