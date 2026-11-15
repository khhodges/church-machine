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
for (const [i, method] of sr.compiled.methods.entries()) {
    if (method.visibility === 'private') assert.equal(sr.lump.words[i + 1], 0);
}
assert.deepEqual(sr.compiled.methods.filter(m => m.visibility !== 'private').map(m => m.name),
    ['LOADM', 'SAVEM', 'SWITCHM', 'MintM', 'SetB', 'IncrementVersion', 'SetNear', 'SetFar']);
function run({method = 'LOADM', index = 1, nullValue = false,
    controlRights = 'W', sourceNull = false, direct = false, version = 7,
    ctype = 1, permissions = 2, mintSlot = 22} = {}) {
    const s = new Simulator();
    const gt = (slot, rights = '', seq = 0, b = 0) => s.createGT(seq, slot,
        {...Object.fromEntries([...rights].map(p => [p, 1])), B: b}, 1) >>> 0;
    const target = compile(`abstraction test.Homes {
capabilities { SELF E, test.Value R, test.Other R }
method Idle() { HALT }
}`);
    const methodIndex = sr.compiled.methods.findIndex(m => m.name === method);
    const indexed = ['SetB', 'IncrementVersion', 'SetNear', 'SetFar'].includes(method);
    const targets = [0, 1, 2, 3, 4, 7, 8, 9, 10];
    const setup = indexed
        ? targets.map(n => nullValue ? `LOAD CR${n}, NULL` : `LOAD CR${n}, CR6, #3`).join('\n')
        : `${sourceNull ? 'LOAD CR1, NULL' : 'LOAD CR1, CR6, #2'}
           ${nullValue ? 'LOAD CR2, NULL' : 'LOAD CR2, CR6, #3'}`;
    const caller = compile(`abstraction test.Caller {
capabilities { SELF E, ide.SecurityRegulator E, test.Homes, test.Value R }
method Run() {
 ${setup}
 LOAD CR11, CR6, #1
 CALL CR11, #${methodIndex}
 HALT
}
}`);
    const CODE = 2048, HOMES = 4096, VALUE = 6144, CALLER = 8192;
    s.withNamespaceWrite('isolated SR test', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(20, CODE, sr.lump.words.length - 1, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(21, HOMES, target.lump.words.length - 1, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(22, VALUE, 7, 0, 0, 1, version, 0, 0);
        s.writeNSEntry(23, 0xFFFFFF1C, 0, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(24, CALLER, caller.lump.words.length - 1, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(25, 10000, 63, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(26, s.memory.length - 1024, 1023, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(27, 11000, 0, 0, 0, 1, 0, 0, 0);
    });
    s.memory[0] = 0xF900820C;
    const layout = Thread.layout(256, 32);
    s.memory[17] = s._packProtectedIndicator(layout.stackEnd - 4, 1, {}, 0);
    const srGT = gt(20, 'E'), callerGT = gt(24, 'E');
    // Indexed methods start with the B=0 entry state specified by CALL's RTL.
    // LOADM's source row deliberately retains B=1 to test exact loaded results.
    const value = nullValue ? 0 : gt(22, 'R', version, indexed ? 0 : 1);
    const rows = HOMES + target.lump.words.length - 3;
    s.memory.set(sr.lump.words, CODE);
    s.memory.set([srGT, gt(23, controlRights), gt(25, 'S'), gt(25, 'RW'),
        gt(26, 'RW'), gt(27, 'R')], CODE + sr.lump.words.length - 6);
    assert.equal(target.lump.words.length, 64);
    s.memory[10000] = target.lump.words[0];
    s.memory[10061] = gt(25, 'E');
    s.memory[11000] = 1024;
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
    if (method === 'MintM') {
        s.dr[1] = ctype;
        s.dr[2] = permissions;
        s.dr[3] = mintSlot;
    }
    s.pc = entry.lump.words[1 + (direct ? methodIndex : 0)] - 1;
    const machineCreate = s.createGT.bind(s);
    s.createGT = (seq, slot, rights, type) => {
        assert(!direct && [20, 24].includes(slot) && seq === 0 && type === 1 &&
            rights.X === 1 && !rights.W && !rights.L && !rights.S && !rights.E,
        'Only architectural CALL/RETURN code views may use host GT construction');
        return machineCreate(seq, slot, rights, type);
    };
    const before = Array.from(s.memory.slice(rows, rows + 3));
    let fault, returned = false, sawM = false;
    s.on('fault', e => { fault = e; });
    for (let i = 0; i < 2000 && !fault; i++) {
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
    return {s, fault, returned, sawM, value, before, gt,
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
    {method: '_Select'}, // private dispatch entries cannot be called
    {method: 'SetB', controlRights: 'R'},
]) {
    const f = run(options);
    assert(f.fault, JSON.stringify(options));
    assert(!f.returned);
    assert.deepEqual(f.rows, f.before);
}
console.log('PASS SR: native LOADM/SAVEM, CALL/RETURN, NULL, B-copy, M custody, index rejection and fault boundaries');

for (const index of [0, 1, 2, 3, 4, 7, 8, 9, 10]) {
    const f = run({method: 'SetB', index});
    assert(f.returned, JSON.stringify(f.fault));
    assert.equal(f.s.dr[1], 0);
    assert.equal(f.s.cr[index].word0 >>> 0, (f.value | 0x80000000) >>> 0);
    assert.equal(f.s.cr[11].word0, 0);
    assert.equal(f.s.memory[10062], 0);
    assert.equal(f.s.memory[10063], 0);
    for (const other of [0, 1, 2, 3, 4, 7, 8, 9, 10].filter(n => n !== index)) {
        assert.equal(f.s.cr[other].word0 >>> 0, (f.value & 0x7fffffff) >>> 0);
    }
}
for (const version of [0, 7, 510, 511]) {
    const f = run({method: 'IncrementVersion', index: 7, version});
    assert(f.returned, JSON.stringify(f.fault));
    assert.equal(f.s.dr[1], version === 511 ? 1 : 0);
    assert.equal(f.s.cr[7].word0, 0);
    const entry = f.s.readNSEntry(22);
    assert.equal(f.s.parseNSWord1(entry.word1_limit).gtSeq, Math.min(version + 1, 511));
    assert(f.s.validateMAC(entry), 'version update also updates integrity32');
    assert.equal(entry.word0_location, 6144);
    assert.equal(f.s.parseNSWord1(entry.word1_limit).limit, 7);
    if (version < 511) assert.equal(f.s.mLoad(f.value, null).fault, 'VERSION');
}
for (const method of ['SetB', 'IncrementVersion', 'SetNear', 'SetFar']) {
    for (const index of [5, 6, 11, 12, 15, 16, 0xffffffff]) {
        const f = run({method, index});
        assert(f.returned, JSON.stringify(f.fault));
        assert.equal(f.s.dr[1], 2);
        assert.equal(f.s.parseNSWord1(f.s.readNSEntry(22).word1_limit).gtSeq, 7);
    }
    const f = run({method, index: 3, nullValue: true});
    assert(f.returned, JSON.stringify(f.fault));
    assert.equal(f.s.dr[1], 3);
    assert.equal(f.s.cr[3].word0, 0);
}
for (const version of [0, 7, 511]) {
    for (const permissions of [0, 2, 6, 14, 3, 5, 7, 9]) {
        const f = run({method: 'MintM', version, permissions});
        assert(f.returned, JSON.stringify(f.fault));
        assert.equal(f.s.dr[1], 0);
        assert.equal(f.s.cr[1].word0 >>> 0,
            ((permissions << 27) | (1 << 25) | (version << 16) | 22) >>> 0);
        assert.equal(f.s.parseNSWord1(f.s.readNSEntry(22).word1_limit).gtSeq, version);
        assert.equal(f.s.memory[10062], 0);
        assert.equal(f.s.memory[10063], 0);
    }
}
for (const [options, status] of [
    [{ctype: 0}, 4], [{ctype: 2}, 4], [{ctype: 3}, 4],
    [{permissions: 11}, 5], [{permissions: 16}, 5],
    [{mintSlot: 65536}, 6], [{mintSlot: 256}, 6], [{mintSlot: 28}, 6],
]) {
    const f = run({method: 'MintM', ...options});
    assert(f.returned, JSON.stringify(f.fault));
    assert.equal(f.s.dr[1], status);
}
console.log('PASS SR: native SetB for every allowed CR, Inform MintM, authoritative IncrementVersion and exhaustion');

for (const method of ['SetNear', 'SetFar']) {
    for (const index of [0, 1, 2, 3, 4, 7, 8, 9, 10]) {
        const f = run({method, index});
        assert(f.returned, JSON.stringify(f.fault));
        assert.equal(f.s.dr[1], 0);
        const entry = f.s.readNSEntry(22);
        const far = method === 'SetFar' ? 1 : 0;
        assert.equal(entry.word1_limit >>> 31, far);
        assert.equal(f.s.cr[index].word2 >>> 31, far);
        assert.equal(f.s.cr[index].word0 >>> 0, f.value);
        assert(f.s.validateMAC(entry));
        assert.equal(f.s.parseNSWord1(entry.word1_limit).gtSeq, 7);
    }
}
console.log('PASS SR: SetNear/SetFar update authoritative F and selected descriptor without changing GT identity');
