'use strict';
// Isolated synthetic words only; never load or rewrite a user LUMP.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(__dirname + '/app-cr-detail.js', 'utf8');
const context = vm.createContext({
    _drTag: n => `DR${n}`,
    sim: new Proxy({}, {get() { throw new Error('static decoder read live simulator'); }}),
});
vm.runInContext(source.slice(source.indexOf('function _codeViewCallContext(')), context);
const word = (op, dst = 1, src = 1, imm = 0, cond = 14) =>
    ((op << 27) | (cond << 23) | (dst << 19) | (src << 15) | imm) >>> 0;
const decode = (op, dst, src, imm, cond) =>
    context._decompileWord(word(op, dst, src, imm, cond), 99, 7, 100, {1:'staleLED'}, null);
const text = (...args) => decode(...args).desc;
for (const register of [12, 13]) {
    const explanation = text(4, register, register, 0);
    assert(explanation.includes(`Thread GT held in CR${register}`));
    assert(explanation.includes('self-target resumes after CHANGE'));
    assert(!/\[0\]|system capability load|PRIV_REG/.test(explanation));
}
for (let op = 0; op < 31; op++) {
    assert.equal(decode(op).kind, 'static', `opcode ${op}`);
    for (let cond = 0; cond < 16; cond++) {
        const d = decode(op, 1, 1, 0, cond);
        assert(d.desc);
        if (cond === 15) assert(d.desc.includes('[never]'));
    }
}
// Reported ISUB/IADD/DWRITE/SWITCH sequence, including same source/destination.
const sequence = [word(22,1,1,1), word(21,1,1,0x5000), word(17,1,2,0x4000), word(5,15,6,7)];
const descriptions = sequence.map(w => context._decompileWord(w, 99, 7, 100, {}, null).desc);
assert(descriptions[1].includes('DR1 + #4096'));
assert(!descriptions.join(' ').includes('8192'));
context.sim = {dr: Array(16).fill(0xFFFFFFFF), cr: [], ledBits: 31};
assert.deepEqual(sequence.map(w => context._decompileWord(w, 99, 7, 100, {}, null).desc), descriptions);
context.sim = null; // reset / detached artifact: same symbolic result
assert.deepEqual(sequence.map(w => context._decompileWord(w, 99, 7, 100, {}, null).desc), descriptions);
assert(text(21,0,0,0x7FFF).includes('#16383')); // not signed -1
assert(text(22,1,0,0x4001).includes('DR0(0) − #1'));
assert(text(21,0,1,1).includes('DR0 write discarded'));
assert(text(16,0,2,0x4003).includes('CR2[#3]'));
assert(text(17,1,2,(10 << 4) | 3).includes('CR2[#10 + DR3]'));
assert(text(18,1,2,(31 << 5) | 1).includes('[31:31]'));
assert(text(18,1,2,0).includes('BOUNDS'));
assert(text(19,1,2,(31 << 5) | 2).includes('BOUNDS'));
assert(text(19,1,2,8).includes('low 8 bits'));
assert(text(20).includes('no register write'));
assert(text(23,0,0,0x7FFF).includes('− 1 words'));
assert(text(24,1,1,0).includes('shift 0'));
assert(text(25,1,1,63).includes('sign-fill'));
assert(text(25,1,1,31).includes('zero-fill'));
assert(text(2,1,6,7).includes('unresolved C-list target'));
assert.equal(text(2,1,0), 'call CR1, method #0');
assert.equal(text(2,1,0,103), 'call CR1, method #103');
assert(text(2,1,6,(3 << 5) | 7).includes('CR6[0x0007], method #3'));
assert(text(3,0,0,0x7FFF).includes('mask 0xFFF'));
assert(text(3).includes('set bits keep callee'));
assert(text(6,1,2,0).includes('not permission removal'));
const exact = text(6,1,2,14);
assert(exact.includes('EXACT'));
assert(exact.includes('CR1.GT with CR2.GT'));
assert(exact.includes('match Z=1, mismatch Z=0, no fault'));
assert(!exact.includes('BIND'));
assert(text(6,1,2,13).includes('FRAME'));
assert(text(6,1,2,0x7FFF).includes('no expansion'));
assert(text(6,1,2,15).includes('reserved'));
assert(text(8,1,6,(7 << 5) | 3).includes('CR6[3]'));
assert(text(8,1,6,(7 << 5) | 3).includes('method #7'));
assert(text(5,15,15,0).includes('M required')); // not an assumed no-op
assert(text(4,1,1,0).includes('Thread GT held in CR1'));
assert(!text(4,1,1,0).includes('PRIV_REG'));
assert.equal(context._decompileWord(0), null);
assert.equal(context._decompileWord(0xF8000000), null);
const lumps = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
assert(lumps.includes('if (((_cw2 >>> 27) & 0x1F) !== 23) continue;'));
assert(lumps.includes('_decompileWord(w, 0, null, 0, null, _commentContext)'));
assert(!lumps.includes('const _unusedAutoComment'));
assert(!source.includes('sim.dr'));
console.log('PASS static commentary: all opcode/condition decodes, live-state isolation, encoding boundaries and listing integration');