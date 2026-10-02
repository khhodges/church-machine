// Isolated commentary tests; no simulator execution or browser required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const misc = fs.readFileSync('simulator/app-misc.js', 'utf8');
const run = fs.readFileSync('simulator/app-run.js', 'utf8');
const ctx = vm.createContext({
    sim: new Proxy({}, { get() { throw Error('Historical commentary read live simulator'); } }),
    _nsOwnerOf() { throw Error('Historical commentary read live ownership'); }
});
vm.runInContext(misc.slice(misc.indexOf('var CM_MNEMONICS'), misc.indexOf('// ── Boot ROM / Boot.Abstr Word Cache')), ctx);
vm.runInContext(run.slice(run.indexOf('function _callReturnInstructionLocation('), run.indexOf('function _ensureCallReturnDrilldownStyles(')), ctx);
const describe = (mnemonic, imm = 0, dst = 2, src = 5) =>
    ctx._instrPlainEnglish({ mnemonic, imm, dst, src, cond: 'NE' });
for (const m of Object.values(ctx.CM_MNEMONICS).concat('HALT')) {
    assert.match(describe(m), /^Static decode \(symbolic; execution and operand values unavailable\): Predicate NE;/);
}
assert.match(describe('DWRITE', 0x4003), /Write DR2 through CR5 at word offset #3/);
for (const mnemonic of ['DREAD', 'DWRITE']) {
    assert.match(describe(mnemonic, (9 << 4) | 7), /word offset #9 \+ DR7/);
    assert.match(describe(mnemonic, 0x7FFF), /word offset #16383/);
}
assert.match(describe('LOAD', 0x40), /C-list row unsigned32\(DR0\) \+ 4 through CR5 into CR2/);
assert.match(describe('SAVE', 0x40), /CR2 into C-list row unsigned32\(DR0\) \+ 4 through CR5/);
assert.match(describe('CALL', (3 << 5) | 7, 3, 6), /CR6\[7\], method index #3/);
assert.doesNotMatch(describe('CALL', (3 << 5) | 7, 3, 6), /CR6\[103\]|CR3/);
assert.match(describe('ELOADCALL', (127 << 5) | 31), /row #31.*method #127/);
assert.match(describe('SHR', 35), /arithmetic right \(sign-fill\).*#3/);
assert.match(describe('SHR', 3), /logical right \(zero-fill\).*#3/);
for (const mnemonic of ['DREAD','BFEXT','BFINS','IADD','ISUB','SHL','SHR']) {
    assert.match(describe(mnemonic, 1, 0), /DR0 destination write is discarded/);
}
assert.doesNotMatch(describe('DWRITE', 1, 0), /discarded/);
assert.match(describe('TPERM', 13), /FRAME/);
assert.match(describe('TPERM', 14), /EXACT.*match Z=1, mismatch Z=0, no fault/);
assert.match(describe('TPERM', 0x7FFF), /Attenuate CR2/);
assert.match(describe('BFINS', 0), /BOUNDS fault if executed/);
assert.match(describe('CHANGE', 0, 14), /Thread-context switch/);
assert.match(describe('CALL', 3), /CR2 .*method index #3/);
assert.match(describe('IADD', 0x4007), /DR5 and #7/);
assert.match(describe('ISUB', 9), /Subtract DR9 from DR5/);
assert.match(describe('SHL', 35), /DR5 left by #3/);
assert.match(describe('BFEXT', (7 << 5) | 4), /bit 7, width 4/);
assert.doesNotMatch(describe('RETURN', 7), /status/);
assert.doesNotMatch(describe('LAMBDA'), /closure/);
assert.equal(ctx._instrRoleAnnotation({ mnemonic: 'DWRITE', dst: 5, src: 5 }), 'Instance data');
assert.equal(ctx._instrRoleAnnotation({ mnemonic: 'DREAD', dst: 6, src: 6 }), 'C-List');
const captured = { nia: 123, kind: 'CALL', nia_label: 'Boot.Main', call_depth: 2, cr14_gt: 0 };
const location = ctx._callReturnInstructionLocation(captured);
assert.equal(location.rawWord, null);
assert.equal(location.lump, 'Boot');
assert.equal(location.method, 'Main');
assert.equal(location.callDepth, 2);
assert.equal(location.cr14, 0);
assert.equal(ctx._callReturnInstructionLocation({ nia: 123 }).callDepth, null);
const word = ((17 << 27) | (14 << 23) | (2 << 19) | (5 << 15) | 3) >>> 0;
assert.equal(ctx._cmDecodeWord(word, 123).text, 'DWRITE DR2, CR5, #3');
const packedCall = ((2 << 27) | (14 << 23) | (6 << 15) | (3 << 5) | 7) >>> 0;
assert.equal(ctx._cmDecodeWord(packedCall, 123).text, 'CALL CR6[7], #3');
const registerCall = ((2 << 27) | (14 << 23) | (2 << 19) | 103) >>> 0;
assert.equal(ctx._cmDecodeWord(registerCall, 123).text, 'CALL CR2, #103');
assert.match(describe('CALL', 103), /method index #103/);
assert.equal(ctx._callReturnInstructionLocation({ nia: 123, observed_instr_word: word }).rawWord, word);
assert.match(run, /line\.executionEvidence = evidence/);
assert.match(run, /evidence && evidence\.description/);
assert.match(run, /callLink\._traceEvent = Object\.freeze/);
assert.match(run, /returnLink\._traceEvent = Object\.freeze/);
// Render an old result after unrelated live state has become inaccessible.
const makeNode = () => ({
    children: [], listeners: {},
    appendChild(child) { this.children.push(child); },
    addEventListener(name, callback) { this.listeners[name] = callback; }
});
ctx.document = { createElement: makeNode, createTextNode: text => ({ text }) };
vm.runInContext(run.slice(run.indexOf('function _appendSimulatorStepLog('),
    run.indexOf('let _wukongStaleBannerDismissed')), ctx);
const eventLocation = Object.freeze({ kind: 'CALL', physicalPC: 71, callDepth: 1 });
const evidence = Object.freeze({ description: 'Recorded effect', post: Object.freeze({ stepCount: 17 }) });
const result = { desc: 'stale fallback', executionEvidence: evidence, eventLocation };
const container = makeNode();
ctx._appendSimulatorStepLog(result, container);
assert.equal(container.children[0].executionEvidence, evidence);
assert.equal(container.children[0].children[0].text, '\n[17] Recorded effect ');
let opened;
ctx._openCallReturnDrilldown = event => { opened = event; };
container.children[0].children[1].listeners.click({ stopPropagation() {} });
assert.equal(opened, eventLocation);
assert.equal(opened.physicalPC, 71);
console.log('instruction commentary trace audit: passed');