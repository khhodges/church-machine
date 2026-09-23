'use strict';

// Real simulator CALL/RETURN, with the production address selector and row HTML.
// No repository binary, editor document or Namespace file is modified.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
global.window = {};
const Simulator = require('./simulator.js');
const Assembler = require('./assembler.js');
const source = fs.readFileSync(__dirname + '/app-memory.js', 'utf8');
const helper = source.slice(source.indexOf('function _currentSimulatorInstructionAddress('),
    source.indexOf('function updateCRDetail('));
const context = vm.createContext({});
vm.runInContext(helper, context);
const currentAddress = context._currentSimulatorInstructionAddress;
const sim = new Simulator();
sim.bootComplete = false;
const base = 0x590, callee = 0xA00, cc = 11;
sim.memory[base] = ((0x1F << 27) | (4 << 23) | (34 << 10) | cc) >>> 0;
sim.memory[base + 31] = 0x17030001;
sim.memory[base + 32] = 0x17030007;
sim.memory[base + 33] = 0xBF007FE1;
sim.memory[callee] = ((0x1F << 27) | (2 << 10) | 1) >>> 0;
// Ordinary CALL selector zero enters the legacy LUMP at PC=1.
sim.memory[callee + 2] = sim.encodeInstruction(3, 14, 0, 0, 0);
sim.writeNSEntry(10, base, 1012, 0, 0, 1, 0, cc, 0);
sim.writeNSEntry(7, callee, 62, 0, 0, 1, 0, 1, 0);
sim.nsLabels[10] = 'CapabilityTest';
sim.nsLabels[7] = 'Callee';
const callerRX = sim.createGT(0, 10, {R: 1, X: 1}, 1);
const callerL = sim.createGT(0, 10, {L: 1}, 1);
const calleeE = sim.createGT(0, 7, {E: 1}, 1);
const clist = base + 1024 - cc;
sim.memory[clist + 1] = calleeE;
sim.memory[clist + 7] = calleeE;
sim.cr[14] = {word0: callerRX, word1: base, word2: 1012, word3: 0, m: 0};
sim.cr[6] = {word0: callerL, word1: clist, word2: 1012, word3: 0, m: 0};
sim.cr[12] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
sim.cr[15] = {word0: 0, word1: 0, word2: 0, word3: 0, m: 0};
sim.bootComplete = true;
sim.pc = 30;
const faults = [];
sim.on('fault', fault => faults.push(fault));

// Execute the actual row classification and address/word HTML from updateCRDetail.
const markerStart = source.indexOf('            const _liveNIA = _currentSimulatorInstructionAddress(sim);');
const marker = source.slice(markerStart, source.indexOf('            const isGateHL', markerStart));
const rowStart = source.indexOf('            codeHtml += `<tr class="${rowClass}">`;', markerStart);
const rowEnd = source.indexOf('\n', source.indexOf('codeHtml += `<td class="cr-gt">', rowStart));
const rowHTML = source.slice(rowStart, rowEnd);
const editor = {value: 'My unchanged CapabilityTest draft'};
function render(address) {
    const ctx = vm.createContext({
        sim, addr: address, word: sim.memory[address],
        _currentSimulatorInstructionAddress: currentAddress,
        editor,
    });
    vm.runInContext(marker + '\nlet codeHtml = ""; const rowClass = isPC ? "code-pc-row" : "";\n' +
        rowHTML + '\nresult = codeHtml;', ctx);
    return ctx.result;
}
assert.equal(currentAddress(sim), 0x5AF);
assert(render(0x5AF).includes('class="code-pc-row"'));
assert(sim.step(), 'first CALL succeeds');
assert.equal(sim.cr[14].word1, callee);
assert.equal(currentAddress(sim), callee + 2);
assert(!render(0x5AF).includes('class="code-pc-row"'), 'caller loses marker during callee execution');
assert(render(callee + 2).includes('class="code-pc-row"'));
assert(sim.step(), 'RETURN succeeds');
assert.equal(sim.parseGT(sim.cr[14].word0).index, 10, 'RETURN restores caller identity');
assert.equal(sim.parseGT(sim.cr[14].word0).permissions.X, 1, 'restored caller permits instruction fetch');
assert.equal(sim.cr[14].word1, base, 'RETURN restores the exact loaded caller base');
assert.equal(sim.pc, 31, 'RETURN restores logical continuation');
assert.equal(sim.physicalPC, callee + 2, 'trace address still describes retired RETURN');
assert.equal(currentAddress(sim), 0x5B0, 'current instruction is next fetch, not retired RETURN');
const html = render(0x5B0);
assert(html.includes('class="code-pc-row"'));
assert(html.includes('0x05B0') && html.includes('0x17030007'));
assert(new Assembler().disassemble(sim.memory[0x5B0]).includes('CR6[0x0007]'));
assert(!render(callee + 2).includes('class="code-pc-row"'));

// Scroll the actual production callback: next row wins over an old gate selection.
const scrollStart = source.indexOf('    requestAnimationFrame(() => {', markerStart);
const scrollEnd = source.indexOf('\n    });', scrollStart) + '\n    });'.length;
let scrolled = null;
const row = {scrollIntoView: options => { scrolled = options; }};
vm.runInNewContext(source.slice(scrollStart, scrollEnd), {
    requestAnimationFrame: fn => fn(),
    contentEl: {querySelector: selector => selector === '.code-pc-row' ? row : null},
    _crDetailHighlightPC: 0,
});
assert.equal(scrolled.block, 'center');
assert.equal(scrolled.behavior, 'auto');

assert(sim.step(), 'next CALL succeeds');
assert.equal(currentAddress(sim), callee + 2);
assert(!render(0x5B0).includes('class="code-pc-row"'), 'next step clears stale caller marker');
assert(sim.step(), 'second RETURN succeeds');
assert.equal(currentAddress(sim), 0x5B1);
assert(render(0x5B1).includes('class="code-pc-row"'));
assert.equal(editor.value, 'My unchanged CapabilityTest draft');
assert.equal(faults.length, 0);

// The CR detail refresh changes only inspection context, never source ownership.
const detailSource = fs.readFileSync(__dirname + '/app-cr-detail.js', 'utf8');
const switchStart = detailSource.indexOf('function _asmSrcSwitchContext(');
const switchEnd = detailSource.indexOf('\n}', switchStart) + 2;
const owner = {kind: 'lump', id: 'my-owned-document'};
const sourceContext = vm.createContext({editor, owner, _asmEditorNsIdx: 10});
vm.runInContext(detailSource.slice(switchStart, switchEnd) +
    '\n_asmSrcSwitchContext(7); _asmSrcSwitchContext(10);', sourceContext);
assert.equal(sourceContext._asmEditorNsIdx, 10);
assert.equal(sourceContext.owner, owner);
assert.equal(editor.value, 'My unchanged CapabilityTest draft');

// A newer repository/Namespace placement must not remap the executing words.
sim.bootComplete = false;
sim.writeNSEntry(10, 0xC00, 1012, 0, 0, 1, 0, cc, 0);
sim.bootComplete = true;
assert.equal(currentAddress(sim), 0x5B1, 'cursor follows loaded CR14, not a newer Namespace revision');
sim.hardwareSnapshot = {nia: 0x111};
assert.equal(currentAddress(sim), 0x5B1, 'hardware cursor must not drive simulator marker');
sim.cr[14].word0 = 0;
assert.equal(currentAddress(sim), null, 'invalid execution authority never falls back to inspected base');
assert(!render(0x5B1).includes('class="code-pc-row"'));
sim.bootComplete = false;
assert.equal(currentAddress(sim), null, 'no program marker before boot');
console.log('PASS real CALL/RETURN caller/callee identity, next-instruction row, scroll, stale clearing and hardware isolation');