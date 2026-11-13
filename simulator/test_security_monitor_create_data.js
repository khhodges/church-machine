'use strict';
// Offline setup and instruction stepping only: no allocator or monitor callback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Compiler = require('./cloomc_compiler');
const builder = require('./lump_builder');
const Simulator = require('./simulator');
const Thread = require('./thread_design');
const source = fs.readFileSync(__dirname + '/cloomc/security_monitor_create_data.cloomc', 'utf8');
function compile(text) {
    const compiled = new Compiler().compile(text, []);
    assert.deepEqual(compiled.errors, []);
    const lump = builder.buildLump(compiled);
    return {compiled, lump, api: builder.buildApiDefinition(compiled, lump.words)};
}
const candidate = compile(source);
const aliases = new Map();
const raw = source.split('\n').map(line => {
    const declaration = line.match(/^\s*\.pet\s+(\w+)\s+((?:CR|DR)\d+)\s*$/);
    if (declaration) { aliases.set(declaration[1], declaration[2]); return ''; }
    const [code, ...comments] = line.split(';');
    return code.replace(/\b[A-Za-z_]\w*\b/g, word => aliases.get(word) || word) +
        (comments.length ? ';' + comments.join(';') : '');
}).join('\n');
// Only compare instructions: source text in the self-definition differs.
assert(candidate.compiled.methods[0].code.length > 0);
assert.deepEqual(compile(raw).compiled.methods.map(m => m.code),
    candidate.compiled.methods.map(m => m.code));
function run({version = 7, requestedVersion = version, slot = 22, throughCall = false,
    authorize = true, controlRights = 'W', scratchRights = 'W'} = {}) {
    const s = new Simulator(), CODE = 2048, WORD = 4096, BLOCK = 4352;
    // Negative fixture is an independently compiled candidate, not a runtime
    // mutation of the M grant or host replacement of an instruction.
    const built = authorize ? candidate : compile(source.replace('#259', '#257'));
    const gt = (index, rights, seq = 0) => s.createGT(seq, index,
        Object.fromEntries([...rights].map(p => [p, 1])), 1) >>> 0;
    s.withNamespaceWrite('disposable native Create fixture', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(20, CODE, built.lump.words.length - 1, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(21, WORD, 0, 0, 0, 1, 0, 0, 0);
        s.writeNSEntry(22, BLOCK, 7, 0, 0, 1, version, 0, 0);
        s.writeNSEntry(23, 0xFFFFFF1C, 0, 0, 0, 1, 0, 0, 0);
    });
    s.memory[0] = 0xF900820C;
    const layout = Thread.layout(256, 32);
    s.memory[17] = s._packProtectedIndicator(layout.stackEnd - 4, 1, {}, 0);
    s.memory.set(built.lump.words, CODE);
    const self = gt(20, 'E');
    s.memory.set([self, gt(21, scratchRights), gt(23, controlRights)],
        CODE + built.lump.words.length - 3);
    s.bootComplete = true;
    s.mElevation = false;
    s.petNameMemory.clear();
    s.programCapabilities = null;
    s.cr[12] = {word0: gt(1, ''), word1: 0, word2: 255, word3: 0, m: 0};
    s._writeCR(0, self, s.readNSEntry(20));
    s._installLumpHeaderContext(s.parseGT(self), 20, s.readNSEntry(20),
        s.parseLumpHeader(built.lump.words[0]));
    s.dr[2] = slot;
    s.dr[3] = requestedVersion;
    s.dr[5] = 0x1234;
    s.pc = built.lump.words[1 + built.api.methods.Create[0]] - 1;
    let fault, returned = false, sawM = false;
    s.on('fault', e => { fault = e; });
    let caller;
    if (throughCall) {
        caller = compile(`abstraction ide.NativeMonitorCaller {
capabilities { SELF E, ide.SecurityMonitorCreateData E }
method Run {
 LOAD CR1, CR6, #1
 CALL CR1, #0
 HALT
}
}`);
        const base = 8192;
        s.withNamespaceWrite('disposable native caller', () =>
            s.writeNSEntry(24, base, caller.lump.words.length - 1, 0, 0, 1, 0, 0, 0));
        s.memory.set(caller.lump.words, base);
        const callerGT = gt(24, 'E');
        s.memory.set([callerGT, self], base + caller.lump.words.length - 2);
        s._installLumpHeaderContext(s.parseGT(callerGT), 24, s.readNSEntry(24),
            s.parseLumpHeader(caller.lump.words[0]));
        s.pc = caller.lump.words[1 + caller.api.methods[0].index] - 1;
    }
    assert.deepEqual(s.cr.map(cr => cr.m || 0),
        Array.from({length:16}, (_, index) => [6,14].includes(index) ? 1 : 0),
        'bounded fixture starts with no unrelated M grants');
    // The faithful machine's CALL/RETURN header microcode and return telemetry
    // reconstruct code views. Neither produces the requested DATA GT.
    // Deny every other host construction, particularly target slot 22.
    const machineCreate = s.createGT.bind(s);
    s.createGT = (seq, index, permissions, type) => {
        assert(throughCall && [20,24].includes(index) && seq === 0 && type === 1 &&
            [undefined,0,1].includes(permissions.R) && permissions.X === 1 && !permissions.W &&
            !permissions.L && !permissions.S && !permissions.E && !permissions.B,
        'runtime host DATA GT manufacture or unexpected machine authority');
        return machineCreate(seq, index, permissions, type);
    };
    for (let n = 0; n < 200 && !fault; n++) {
        const fetch = s._fetchInstruction();
        assert(fetch.ok);
        const instruction = s.memory[fetch.addr] >>> 0;
        if (!throughCall && instruction >>> 27 === 3) { returned = true; break; }
        s.step();
        sawM ||= s.cr[7].m === 1;
        if (throughCall && s.halted && !fault) { returned = true; break; }
    }
    return {s, fault, returned, sawM, scratch: s.memory[WORD]};
}
const invoked = run({throughCall:true});
assert(invoked.returned, JSON.stringify(invoked.fault));
assert.equal(invoked.s.cr[1].word0 >>> 0, 0x32070016);
assert.equal(invoked.scratch, 0);
assert.equal(invoked.s.cr[7].word0, 0);
assert.equal(invoked.s.cr[8].word0, 0);
assert.equal(invoked.s.parseGT(invoked.s.cr[6].word0).index, 24,
    'RETURN restores caller execution identity, not monitor authority');
assert.equal(invoked.s.callStack.length, 0, 'native CALL frame was consumed');
assert.equal(invoked.s.dr[5], 0x1234, 'DR5 convention is preserved across the service');
for (const version of [0, 7, 511]) {
    const f = run({version});
    assert(f.returned, JSON.stringify(f.fault));
    assert(f.sawM);
    assert.equal(f.s.cr[1].word0 >>> 0, (0x32000000 + (version << 16) + 22) >>> 0);
    assert.equal(f.s.cr[1].m, 0);
    assert.equal(f.s.cr[7].m, 0);
    assert.equal(f.s.cr[6].m, 1);
    assert.equal(f.s.cr[14].m, 1, 'existing code-view M is not cleared incidentally');
    assert.equal(f.s.dr[5], 0x1234);
    assert.equal(f.s.cr[7].word0, 0);
    assert.equal(f.s.cr[8].word0, 0);
    assert.equal(f.scratch, 0);
    assert.equal(f.s.dr[1], 1);
    const homes = Thread.layout(256, 32).capsStart;
    assert.equal(f.s.memory[homes + 1], f.s.cr[1].word0);
    assert.equal(f.s.memory[homes + 7], 0);
    assert.equal(f.s.memory[homes + 8], 0);
}
for (const options of [
    {authorize:false}, {controlRights:'R'}, {scratchRights:'R'},
    {requestedVersion:8}, {requestedVersion:512}, {slot:65536},
]) {
    const f = run(options);
    assert(f.fault, JSON.stringify(options));
    assert.equal(f.returned, false);
    assert.equal(f.s.dr[1], 0);
}
console.log('PASS native Create: DATA packing, M-authorized GT LOAD, CALL/RETURN, alias equivalence, cleanup and rejection');
