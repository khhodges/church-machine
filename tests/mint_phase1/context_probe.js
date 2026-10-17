'use strict';
// Test harness privilege constructs/observes RAM; NONE of these helpers is a
// proposed Mint API. No filesystem writes, server, boot image, or hardware.
const assert = require('node:assert/strict');
const Simulator = require('../../simulator/simulator.js');
const v = require('./context-vectors.json');
const n = x => Number(x);

function fixture() {
    const s = new Simulator();
    s.bootComplete = false;
    s.withNamespaceWrite('isolated Mint context feasibility', () => {
        s.writeNSEntry(1, 0, 255, 0, 0, 1, 0, 0, 0);
        for (let slot = 2; slot <= 4; slot++)
            s.writeNSEntry(slot, slot * 256, 63, 0, 0, 1, 0, 1, 0);
    });
    s.memory[0] = n(v.thread_header);
    // Thread identity has no ordinary data permission.
    s.cr[12] = {word0: 0x02000001, word1: 0, word2: 255, word3: 0, m: 0};
    s.cr[5] = {word0: 0x32000001, word1: 18, word2: 193, word3: 0, m: 0};
    for (let slot = 2; slot <= 4; slot++) s.memory[slot * 256] = n(v.code_header);
    s.cr[14] = {word0: n(v.caller_x), word1: 512, word2: 63, word3: 0, m: 0};
    s.cr[6] = {word0: n(v.caller_l), word1: 575, word2: 63, word3: 0, m: 1};
    s.memory[17] = 0x1000 | v.initial_sto;
    s.memory[242] = n(v.caller_e);
    s.memory[243] = n(v.root_frame);
    s.sto = v.initial_sto;
    s.pc = 1;
    s.bootComplete = true;
    return s;
}
function call(s, slot) {
    s.cr[0] = {word0: 0x4a000000 | slot, word1: slot * 256,
        word2: 63, word3: 0, m: 0};
    assert.ok(s._execCall(s.decodeInstruction(n(v.call_word))));
}
const result = {returns: {}, masks: {}};
{
    const s = fixture();
    s.dr[1] = n(v.verifier_e); // caller-supplied "requester" is only data
    call(s, 3);
    assert.equal(s.memory[240], n(v.caller_e));
    assert.equal(s.memory[241], n(v.outer_frame));
    s.pc = 2;
    call(s, 4);
    assert.equal(s.memory[238], n(v.mint_e));
    assert.equal(s.memory[239], n(v.inner_frame));
    result.nested = [s.memory[240], s.memory[241], s.memory[238], s.memory[239]];
    // Even a forged diagnostic shadow cannot replace the protected requester.
    s.callStack = [{sz: 1, frameAddress: 239, returnPC: 77,
        companionGT: n(v.verifier_e), savedSTO: 99, savedCRs: s.cr.map(c => ({...c}))}];
    assert.ok(s._execReturn({imm: 0}));
    assert.equal(s.pc, 3);
    assert.equal(s.cr[14].word1, 768);
    s.callStack = [];
    assert.ok(s._execReturn({imm: 0}));
    assert.equal(s.pc, 2);
    assert.equal(s.cr[14].word1, 512);
}
{
    const active = fixture();
    const suspended = fixture();
    call(suspended, 3);
    suspended.callStack = [];
    // A distinct suspended Thread retains caller 2 even though the active
    // Thread only has its poison root. Test-side RAM observation, NOT a scan API.
    assert.equal(active.memory[17] & 0xfff, 241);
    assert.equal(suspended.memory[17] & 0xfff, 239);
    assert.equal(suspended.memory[240], n(v.caller_e));
    result.suspendedDependency = suspended.memory[240];
    suspended.memory[241] = n(v.outer_frame) - 1;
    const before = suspended.memory[17];
    assert.equal(suspended._execReturn({imm: 0}), null);
    assert.equal(suspended.memory[17], before);
}
{
    const s = fixture();
    const d = s.decodeInstruction(n(v.thread_read_word));
    assert.equal(d.opcode, 16);
    assert.equal(d.crSrc, 12);
    let fault;
    s.on('fault', e => { fault = e.type; });
    assert.equal(s._execDread(d), null);
    assert.equal(fault, 'PERMISSION'); // JS mLoad's permission label differs from RTL PERM_R.
    result.threadReadFault = fault;
}
for (const c of v.return_cases) {
    // Model a suspended image presented to RETURN, with NO host call history.
    // This is not a CHANGE test or an all-Thread scan service.
    const s = fixture();
    s.memory[17] = 0x1000 | 239;
    s.memory[240] = n(c.companion);
    s.memory[241] = n(c.frame);
    s.sto = 239;
    s.callStack = [];
    let fault;
    s.on('fault', e => { fault = e.type; });
    const before = [s.memory[17], s.pc, structuredClone(s.cr)];
    const ok = !!s._execReturn({imm: 0});
    assert.equal(ok, c.ok, c.name);
    if (!ok) assert.deepEqual([s.memory[17], s.pc, s.cr], before, c.name);
    result.returns[c.name] = {ok, fault: fault || null};
}
for (const word of v.return_words) {
    const s = fixture();
    call(s, 3);
    s.callStack = [];
    const d = s.decodeInstruction(n(word));
    assert.equal(d.opcode, 3);
    // Real capability value retained by mask, not a DR-to-CR conversion.
    s.cr[1] = {...s.cr[14]};
    const supplied = s.cr[1].word0;
    assert.ok(s._execReturn(d));
    assert.equal(s.cr[1].word0, d.imm & 2 ? supplied : 0);
    result.masks[d.imm] = s.cr[1].word0 !== 0;
}
{
    const s = fixture();
    s.cr[9] = {...s.cr[14]};
    const d = s.decodeInstruction(n(v.lambda_word));
    assert.equal(d.opcode, 7);
    assert.equal(d.crDst, 9);
    const cr6 = structuredClone(s.cr[6]);
    assert.ok(s._execLambda(d));
    assert.deepEqual(s.cr[6], cr6);
    result.lambda = {pc: s.pc, sto: s.memory[17] & 0xfff};
    assert.equal(s.pc, 2); // inline, NOT target location 512
    assert.equal(result.lambda.sto, 240);
    s.callStack = [];
    assert.ok(s._execReturn({imm: 2}));
    assert.equal(s.pc, 2);
    assert.equal(s.memory[17] & 0xfff, 241);
}
console.log(JSON.stringify(result));
